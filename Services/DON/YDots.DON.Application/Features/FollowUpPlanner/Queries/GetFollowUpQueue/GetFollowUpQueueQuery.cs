using System.Globalization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.DTOs;
using YDots.DON.Application.Features.FollowUpPlanner.DTOs;
using YDots.DON.Application.Features.FollowUpPlanner.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.FollowUpPlanner.Queries.GetFollowUpQueue;

/// <summary>GET the Follow-up Queue: the filtered rows, and every figure, tab and option it shows.</summary>
public sealed record GetFollowUpQueueQuery(FollowUpQueueFilter Filter);

/// <summary>GET the Follow-up Queue as CSV, under the same filters - the queue's Export.</summary>
public sealed record ExportFollowUpQueueQuery(FollowUpQueueFilter Filter);

/// <summary>
/// The Follow-up Queue (DON-UI-08, queue view).
///
/// THE WHOLE SCOPE IS READ ONCE AND EVERYTHING IS ANSWERED FROM IT. A row's due state, its
/// "escalated" reading, its consent block and its campaign come from the row as a whole - several
/// tables, one of them the payments module - so the queue's filters cannot all be WHERE clauses.
/// The screen used to download every page and decide all of this itself; it now asks, and the
/// tabs, tiles, pulse panel, rows and export are all answered here by one set of rules
/// (FollowUpQueueCatalogue), over the same rows.
///
/// THE SCOPE IS THE PLANNER'S: AccessScope narrows a caller without don.records.view-all to the
/// follow-ups assigned to them and those raised on the leads and donors they own.
/// </summary>
public sealed class FollowUpQueueQueryHandler(
    IFollowUpRepository followUpRepository,
    IConsentRepository consentRepository,
    IPeopleDirectory people,
    IDonationLedger ledger,
    IExportService exportService,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<FollowUpQueueQueryHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<FollowUpQueueResponse>> HandleAsync(
        GetFollowUpQueueQuery query,
        CancellationToken cancellationToken = default)
    {
        var filter = query.Filter;
        var now = clock.UtcNow;
        var today = ReportingCalendar.DateOf(now, _settings);

        logger.LogInformation("Follow-up queue retrieval started for organisation {OrganisationId}.", currentUser.OrganisationId);

        var rows = await LoadRowsAsync(filter, now, cancellationToken);
        var matched = Filter(rows, filter);
        var cap = Math.Max(1, _settings.ExportMaximumRows);
        var owners = await people.GetAssignableAsync(currentUser.OrganisationId, cancellationToken);

        var response = new FollowUpQueueResponse(
            ScreenIds.FollowUpPlanner,
            ScreenRoutes.FollowUpPlanner,
            [.. matched.Take(cap)],
            matched.Count,
            matched.Count > cap,
            BuildSummary(rows),
            BuildPulse(rows, today),
            FollowUpQueueCatalogue.Views(rows),
            FollowUpQueueCatalogue.Tiles(rows),
            FollowUpQueueCatalogue.StatusOptions,
            FollowUpQueueCatalogue.ChannelOptions,
            [.. Enum.GetValues<FollowUpPriority>().Select(priority => new LookupItem(priority.ToString(), priority.ToString()))],
            [.. owners.Select(owner => new LookupItem(owner.UserId.ToString(), owner.Name))],
            [.. rows
                .GroupBy(row => row.RelationshipOwnerUserId)
                .Select(group => new LookupItem(
                    group.Key.ToString(),
                    group.Select(row => row.RelationshipOwnerName).FirstOrDefault(name => !string.IsNullOrWhiteSpace(name)) ?? "Unassigned"))
                .OrderBy(option => option.Label, StringComparer.CurrentCultureIgnoreCase)],
            [.. rows
                .Select(row => row.CampaignName)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name!)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.CurrentCultureIgnoreCase)
                .Select(name => new LookupItem(name, name))],
            FollowUpQueueCatalogue.BoardColumns,
            FollowUpQueueCatalogue.SortOptions,
            FollowUpExecutionCatalogue.ExecutionStatuses,
            FollowUpExecutionCatalogue.CompletionReasons,
            FollowUpExecutionCatalogue.Dispositions,
            FollowUpExecutionCatalogue.ContactChannels,
            BuildPermittedActions(),
            currentUser.Scope.IsOwnRecordsOnly
                ? "Follow-ups assigned to you, and those on the leads and donors you own"
                : "Your whole organisation",
            now,
            today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

        logger.LogInformation(
            "Follow-up queue retrieval completed. {MatchedCount} of {ScopeCount} follow-up(s) matched for organisation {OrganisationId}.",
            matched.Count, rows.Count, currentUser.OrganisationId);

        return Result.Success(response);
    }

    public async Task<Result<ExportFile>> HandleAsync(
        ExportFollowUpQueueQuery query,
        CancellationToken cancellationToken = default)
    {
        var now = clock.UtcNow;

        logger.LogInformation("Follow-up queue export started with maximum row limit {MaximumRows}.", _settings.ExportMaximumRows);

        var rows = await LoadRowsAsync(query.Filter, now, cancellationToken);
        var matched = Filter(rows, query.Filter).Take(Math.Max(1, _settings.ExportMaximumRows)).ToList();

        var lines = matched
            .Select(row =>
            {
                var due = row.DueAtUtc is null ? (DateTimeOffset?)null : ReportingCalendar.ToLocal(row.DueAtUtc.Value, _settings);

                return (IReadOnlyList<string>)
                [
                    row.FollowUpReference,
                    row.RecordDisplayName ?? string.Empty,
                    row.DonorId is not null ? "Donor" : "Lead",
                    row.DonorReference ?? row.LeadReference ?? string.Empty,
                    FollowUpQueueCatalogue.ChannelLabel(row.PermittedChannel),
                    row.Purpose ?? string.Empty,
                    due?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? string.Empty,
                    due?.ToString("HH:mm", CultureInfo.InvariantCulture) ?? string.Empty,
                    row.RelationshipOwnerName ?? string.Empty,
                    row.Priority,
                    row.QueueStatus,
                    row.CampaignName ?? string.Empty
                ];
            })
            .ToList();

        var file = exportService.CreateCsv(
            "ydot-follow-ups",
            ["Follow-up ID", "Related to", "Record type", "Record reference", "Type", "Purpose", "Due date",
             "Due time", "Assigned to", "Priority", "Status", "Campaign"],
            lines);

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.FollowUpsExported, nameof(FollowUpTask), null, AuditResult.Succeeded,
                $"{lines.Count} follow-up(s) exported. Reference {file.Reference}."),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Follow-up queue export completed. Exported {RowCount} row(s).", lines.Count);

        return Result.Success(file);
    }

    /// <summary>
    /// Every follow-up in scope as a row, with its consent warning, history and campaign.
    /// FIVE READS FOR THE WHOLE SET, whatever its size - the planner's row builder reads the
    /// consent rows twice per follow-up, which is fine for a page of ten and not for a queue.
    /// </summary>
    private async Task<List<FollowUpResponse>> LoadRowsAsync(
        FollowUpQueueFilter filter,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var tasks = await followUpRepository.GetQueueAsync(currentUser.Scope, filter.LeadId, filter.DonorId, cancellationToken);

        if (tasks.Count == 0)
        {
            return [];
        }

        var viewer = FollowUpViewer.For(currentUser, now, _settings);

        var donorIds = tasks.Where(task => task.DonorId is not null).Select(task => task.DonorId!.Value).Distinct().ToList();
        var leadIds = tasks.Where(task => task.DonorId is null && task.LeadId is not null).Select(task => task.LeadId!.Value).Distinct().ToList();

        var donorConsents = await consentRepository.GetCurrentForDonorsAsync(donorIds, cancellationToken);
        var leadConsents = await consentRepository.GetForLeadsAsync(leadIds, cancellationToken);
        var giving = await ledger.GetGivingAsync(currentUser.OrganisationId, donorIds, cancellationToken);

        var audit = await followUpRepository.GetHistoryAsync([.. tasks.Select(task => task.Id)], cancellationToken);
        var historyByTask = audit
            .Where(entry => entry.TargetId is not null)
            .GroupBy(entry => entry.TargetId!.Value)
            .ToDictionary(group => group.Key, group => group.ToList());

        var names = await people.GetNamesAsync(
            currentUser.OrganisationId,
            [.. audit.Where(entry => entry.ActorUserId is not null).Select(entry => entry.ActorUserId!.Value).Distinct()],
            cancellationToken);

        var rows = new List<FollowUpResponse>(tasks.Count);

        foreach (var task in tasks)
        {
            // The same warning BuildWarningAsync gives: a donor's current consents, else the lead's.
            IReadOnlyList<Consent> consents = task.DonorId is Guid donorId
                ? donorConsents.GetValueOrDefault(donorId) ?? []
                : task.LeadId is Guid leadId ? leadConsents.GetValueOrDefault(leadId) ?? [] : [];

            var warning = FollowUpMappingConfig.BuildConsentWarning(task.Donor, consents);

            var history = (historyByTask.GetValueOrDefault(task.Id) ?? [])
                .Select(entry => new FollowUpHistoryEntryResponse(
                    entry.CreatedAtUtc,
                    DescribeAction(entry.ActionCode),
                    entry.Reason,
                    entry.ActorUserId is Guid actor && names.TryGetValue(actor, out var name) ? name : null))
                .ToList();

            var donorCampaign = task.DonorId is Guid id && giving.TryGetValue(id, out var given) ? given.LastCampaignName : null;

            rows.Add(task.ToResponse(viewer, warning, history, donorCampaign));
        }

        return rows;
    }

    /// <summary>The audit code as the history list words it - the planner's wording.</summary>
    private static string DescribeAction(string actionCode) =>
        actionCode switch
        {
            AuditActionCodes.FollowUpScheduled => "Scheduled",
            AuditActionCodes.FollowUpAssigned => "Reassigned",
            AuditActionCodes.FollowUpEscalated => "Escalated",
            AuditActionCodes.FollowUpCompleted => "Completed",
            AuditActionCodes.FollowUpRescheduled => "Rescheduled",
            AuditActionCodes.FollowUpCancelled => "Cancelled",
            _ => actionCode
        };

    /// <summary>The filters, then the order. Each filter is the rule its option was counted by.</summary>
    private List<FollowUpResponse> Filter(IReadOnlyList<FollowUpResponse> rows, FollowUpQueueFilter filter)
    {
        var statuses = FollowUpQueueFilter.Split(filter.Statuses);
        var channels = FollowUpQueueFilter.Split(filter.Channels);
        var priorities = FollowUpQueueFilter.Split(filter.Priorities);
        var ids = filter.ParseFollowUpIds();
        var term = filter.Search?.Trim();
        var view = filter.View?.Trim();

        IEnumerable<FollowUpResponse> matched = rows;

        if (!string.IsNullOrWhiteSpace(filter.FollowUpIds))
        {
            // A list that names nothing valid matches nothing, never the whole queue.
            matched = matched.Where(row => ids.Contains(row.Id));
        }

        if (!string.IsNullOrEmpty(view))
        {
            matched = matched.Where(row => row.QueueViews?.Contains(view, StringComparer.OrdinalIgnoreCase) == true);
        }

        if (statuses.Count > 0)
        {
            matched = matched.Where(row => statuses.Contains(row.QueueStatus, StringComparer.OrdinalIgnoreCase));
        }

        if (channels.Count > 0)
        {
            matched = matched.Where(row => channels.Contains(row.PermittedChannel, StringComparer.OrdinalIgnoreCase));
        }

        if (priorities.Count > 0)
        {
            matched = matched.Where(row => priorities.Contains(row.Priority, StringComparer.OrdinalIgnoreCase));
        }

        if (filter.AssignedToUserId is Guid assignee)
        {
            matched = matched.Where(row => row.RelationshipOwnerUserId == assignee);
        }

        if (!string.IsNullOrWhiteSpace(filter.Campaign))
        {
            matched = matched.Where(row => string.Equals(row.CampaignName, filter.Campaign.Trim(), StringComparison.OrdinalIgnoreCase));
        }

        if (filter.DueFrom is not null || filter.DueTo is not null || filter.DueOn is not null)
        {
            matched = matched.Where(row =>
            {
                if (row.DueAtUtc is null) return false;
                var day = ReportingCalendar.DateOf(row.DueAtUtc.Value, _settings);
                return (filter.DueFrom is null || day >= filter.DueFrom)
                       && (filter.DueTo is null || day <= filter.DueTo)
                       && (filter.DueOn is null || day == filter.DueOn);
            });
        }

        if (!string.IsNullOrEmpty(term))
        {
            matched = matched.Where(row =>
                Contains(row.FollowUpReference, term)
                || Contains(row.RecordDisplayName, term)
                || Contains(row.DonorReference, term)
                || Contains(row.LeadReference, term)
                || Contains(row.Purpose, term)

                // The phone as the row shows it - masked for a caller who may not see it, so the
                // search cannot be used to confirm a number the screen withholds.
                || Contains(row.ContactPhone, term));
        }

        return Order(matched, filter.Sort);
    }

    private static bool Contains(string? value, string term) =>
        value?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false;

    /// <summary>
    /// Latest due first (the default), earliest first, or by status with the latest first within
    /// each. A follow-up with no due date goes to the end in every order.
    /// </summary>
    private static List<FollowUpResponse> Order(IEnumerable<FollowUpResponse> rows, string? sort)
    {
        var undatedLast = rows.OrderBy(row => row.DueAtUtc is null);

        var ordered = (sort?.Trim().ToLowerInvariant()) switch
        {
            "oldest" => undatedLast.ThenBy(row => row.DueAtUtc),
            "status" => undatedLast
                .ThenBy(row => FollowUpQueueCatalogue.StatusRank(row.QueueStatus))
                .ThenByDescending(row => row.DueAtUtc),
            _ => undatedLast.ThenByDescending(row => row.DueAtUtc)
        };

        return [.. ordered.ThenBy(row => row.Id)];
    }

    /// <summary>
    /// The headline counts, over the same rows the tabs count. The Escalated figure uses the
    /// queue's escalated rule; the planner's SQL summary counts only open escalations.
    /// </summary>
    private static FollowUpQueueSummaryResponse BuildSummary(IReadOnlyCollection<FollowUpResponse> rows)
    {
        var open = rows.Count(row => row.IsOpen);
        var overdue = rows.Count(row => row.IsOverdue);
        var completed = rows.Count(row => row.Status == nameof(FollowUpStatus.Completed));
        var cancelled = rows.Count(row => row.Status == nameof(FollowUpStatus.Cancelled));

        var counted = rows.Count - cancelled;
        var completionRate = counted <= 0 ? 0 : (int)Math.Round(completed * 100m / counted);
        var overduePercent = open <= 0 ? 0 : (int)Math.Round(overdue * 100m / open);

        var health = overduePercent switch
        {
            < 5 => "Healthy",
            <= 15 => "Warning",
            _ => "Critical"
        };

        return new FollowUpQueueSummaryResponse(
            rows.Count,
            open,
            rows.Count(row => row.QueueViews?.Contains(FollowUpQueueCatalogue.TodayView) == true),
            rows.Count(row => row.QueueViews?.Contains(FollowUpQueueCatalogue.UpcomingView) == true),
            overdue,
            rows.Count(row => row.QueueViews?.Contains(FollowUpQueueCatalogue.CompletedTodayView) == true),
            rows.Count(FollowUpQueueCatalogue.IsEscalated),
            rows.Count(row => row.IsOpen && row.IsAssignedToMe),
            completed,
            cancelled,
            completionRate,
            overduePercent,
            health);
    }

    /// <summary>The pulse panel, the agenda and the date rail, over the whole scope.</summary>
    private FollowUpQueuePulseResponse BuildPulse(IReadOnlyList<FollowUpResponse> rows, DateOnly today)
    {
        var open = rows.Where(row => row.IsOpen).ToList();
        var breached = open.Count(row => row.IsOverdue);
        var approaching = open.Count(row => !row.IsOverdue && row.DueState == "Due Today");

        DateOnly? DayOf(FollowUpResponse row) =>
            row.DueAtUtc is null ? null : ReportingCalendar.DateOf(row.DueAtUtc.Value, _settings);

        var ages = open
            .Where(row => !row.IsOverdue && row.DueAtUtc is not null)
            .Select(row => DayOf(row)!.Value.DayNumber - today.DayNumber)
            .Where(days => days >= 0);

        var notCancelled = rows.Where(row => row.QueueStatus != FollowUpQueueCatalogue.Cancelled && row.DueAtUtc is not null).ToList();

        var dayCounts = notCancelled
            .GroupBy(row => DayOf(row)!.Value)
            .OrderBy(group => group.Key)
            .ToDictionary(
                group => group.Key.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                group => group.Count(),
                StringComparer.Ordinal);

        FollowUpAgendaItemResponse Agenda(FollowUpResponse row) =>
            new(row.Id, row.DueAtUtc, row.PermittedChannel, FollowUpQueueCatalogue.ChannelLabel(row.PermittedChannel),
                row.RecordDisplayName ?? row.FollowUpReference, row.QueueStatus, row.IsOpen);

        const int agendaRows = 5;

        var todays = notCancelled.Where(row => DayOf(row) == today).OrderBy(row => row.DueAtUtc).ToList();
        var agendaToday = todays.Take(agendaRows).Select(Agenda).ToList();
        var agendaNext = agendaToday.Count >= agendaRows
            ? []
            : open
                .Where(row => row.DueAtUtc is not null && DayOf(row) > today)
                .OrderBy(row => row.DueAtUtc)
                .Take(agendaRows - agendaToday.Count)
                .Select(Agenda)
                .ToList();

        return new FollowUpQueuePulseResponse(
            open.Count - breached - approaching,
            approaching,
            breached,
            FollowUpQueueCatalogue.AgeBuckets(ages),
            open.Count(FollowUpQueueCatalogue.IsBlocked),
            dayCounts,
            agendaToday,
            agendaNext,
            todays.Count(row => !row.IsOpen),
            todays.Count(row => row.IsOpen));
    }

    /// <summary>The queue's verbs - the planner's, for the same permissions.</summary>
    private IReadOnlyList<string> BuildPermittedActions()
    {
        var actions = new List<string> { "View" };

        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerSchedule)) actions.Insert(0, "Schedule follow-up");
        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerAssign)) actions.Add("Assign");
        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerMarkComplete)) actions.Add("Mark complete");
        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerReschedule)) actions.Add("Reschedule");
        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerCancelTask)) actions.Add("Cancel task");
        if (currentUser.HasPermission(PermissionCodes.DonorsExport)) actions.Add("Export");

        return actions;
    }
}
