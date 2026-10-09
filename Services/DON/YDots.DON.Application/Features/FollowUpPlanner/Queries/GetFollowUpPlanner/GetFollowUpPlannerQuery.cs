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

namespace YDots.DON.Application.Features.FollowUpPlanner.Queries.GetFollowUpPlanner;

/// <summary>DON-UI-08 GET list.</summary>
public sealed record GetFollowUpPlannerQuery(FollowUpSearchFilter Filter);

/// <summary>DON-UI-08 GET one.</summary>
public sealed record GetFollowUpDetailQuery(Guid FollowUpId);

/// <summary>
/// GET the consent warning for a donor before anything is scheduled. The screen calls this as
/// soon as a donor is selected, which is what lets it show the warning before the person has
/// filled in the rest of the form.
/// </summary>
public sealed record GetConsentWarningQuery(Guid? DonorId, Guid? LeadId);

/// <summary>
/// The read side of the follow-up planner, queue and execution screens.
///
/// THE SCOPE IS THE SERVER'S DECISION, NOT THE SCREEN'S. The role flow gives the fundraising team
/// "all scheduled follow-ups within the tenant" and DonorCare "all follow-ups assigned to the
/// currently logged-in owner". Both are the same endpoint: AccessScope narrows a caller without
/// <c>don.records.view-all</c> to the follow-ups assigned to them and those raised on the records
/// they own, so the Follow-up Queue no longer has to send onlyMine to look right - and a browser
/// that leaves it off cannot widen anything.
/// </summary>
public sealed class FollowUpPlannerQueryHandler(
    IFollowUpRepository followUpRepository,
    IConsentRepository consentRepository,
    IDonorRepository donorRepository,
    IPeopleDirectory people,
    IDonationLedger ledger,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<FollowUpPlannerQueryHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<FollowUpPlannerResponse>> HandleAsync(
        GetFollowUpPlannerQuery query,
        CancellationToken cancellationToken = default)
    {
        var filter = query.Filter;

        logger.LogInformation("Follow-up planner list retrieval started for organisation {OrganisationId}.", currentUser.OrganisationId);

        // "My follow-ups" means assigned to me - the queue's own Mine view. It narrows; the scope
        // above it is unchanged.
        if (filter.OnlyMine == true)
        {
            filter.RelationshipOwnerUserId = currentUser.UserId;
            logger.LogInformation("Follow-up planner list restricted to follow-ups assigned to the current user.");
        }

        var page = await followUpRepository.SearchAsync(filter, currentUser.Scope, cancellationToken);
        var now = clock.UtcNow;
        var viewer = FollowUpViewer.For(currentUser, now, _settings);

        var rows = await BuildRowsAsync(page.Items, viewer, cancellationToken);

        var owners = await people.GetAssignableAsync(currentUser.OrganisationId, cancellationToken);
        var (todayStart, todayEnd) = ReportingCalendar.Today(now, _settings);
        var counts = await followUpRepository.GetSummaryAsync(
            currentUser.Scope, filter.LeadId, filter.DonorId, now, todayStart, todayEnd, cancellationToken);

        var response = new FollowUpPlannerResponse(
            ScreenIds.FollowUpPlanner,
            ScreenRoutes.FollowUpPlanner,
            new PagedResponse<FollowUpResponse>(rows, page.TotalCount, page.Page, page.PageSize),
            ToLookup<ConsentChannel>(),
            ToLookup<FollowUpPriority>(),
            ToLookup<FollowUpStatus>(),
            SupportedLanguages.All,
            [.. owners.Select(owner => new LookupItem(owner.UserId.ToString(), owner.Name))],
            _settings.CurrentNoticeVersion,
            BuildPermittedActions(),
            DescribeFilter(filter),
            DescribeScope(),
            rows.Count == 0 ? ScreenState.Empty : ScreenState.Initial,
            BuildSummary(counts),
            FollowUpExecutionCatalogue.ExecutionStatuses,
            FollowUpExecutionCatalogue.CompletionReasons,
            FollowUpExecutionCatalogue.Dispositions,
            FollowUpExecutionCatalogue.ContactChannels);

        logger.LogInformation("Follow-up planner list retrieval completed successfully. Returned {RowCount} rows out of {TotalCount} for organisation {OrganisationId}.", rows.Count, page.TotalCount, currentUser.OrganisationId);

        return Result.Success(response);
    }

    public async Task<Result<FollowUpResponse>> HandleAsync(
        GetFollowUpDetailQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Follow-up detail retrieval started for follow-up {FollowUpId}.", query.FollowUpId);

        var task = await followUpRepository.GetByIdAsync(query.FollowUpId, cancellationToken);

        if (task is null || task.OrganisationId != currentUser.OrganisationId || !IsInScope(task))
        {
            logger.LogWarning("Follow-up {FollowUpId} was not found inside the current user's scope.", query.FollowUpId);

            return Result.Failure<FollowUpResponse>(Error.NotFound("That follow-up was not found inside your scope."));
        }

        var rows = await BuildRowsAsync([task], FollowUpViewer.For(currentUser, clock.UtcNow, _settings), cancellationToken);

        logger.LogInformation("Follow-up detail retrieval completed successfully for follow-up {FollowUpId}.", query.FollowUpId);

        return Result.Success(rows[0]);
    }

    public async Task<Result<ConsentWarningResponse>> HandleAsync(
        GetConsentWarningQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Consent warning retrieval started for the selected follow-up target.");

        if (query.DonorId is null && query.LeadId is null)
        {
            logger.LogWarning("Consent warning retrieval failed because neither donor nor lead was provided.");

            return Result.Failure<ConsentWarningResponse>(Error.Validation(
                "Enter Donor or lead reference before the consent warning can be checked."));
        }

        var warning = await BuildWarningAsync(query.DonorId, query.LeadId, cancellationToken);

        logger.LogInformation("Consent warning retrieval completed successfully.");

        return Result.Success(warning);
    }

    /// <summary>
    /// The rows, with everything each one needs: its consent warning, its history with the names
    /// of the people who acted, and the donor's campaign where the follow-up is about a donor.
    ///
    /// THE HISTORY AND THE NAMES ARE FETCHED ONCE FOR THE PAGE, not per row.
    /// </summary>
    private async Task<List<FollowUpResponse>> BuildRowsAsync(
        IReadOnlyList<FollowUpTask> tasks,
        FollowUpViewer viewer,
        CancellationToken cancellationToken)
    {
        if (tasks.Count == 0)
        {
            return [];
        }

        var audit = await followUpRepository.GetHistoryAsync([.. tasks.Select(task => task.Id)], cancellationToken);
        var names = await people.GetNamesAsync(
            currentUser.OrganisationId,
            [.. audit.Where(entry => entry.ActorUserId is not null).Select(entry => entry.ActorUserId!.Value)],
            cancellationToken);

        var donorIds = tasks.Where(task => task.DonorId is not null).Select(task => task.DonorId!.Value).Distinct().ToList();
        var giving = await ledger.GetGivingAsync(currentUser.OrganisationId, donorIds, cancellationToken);

        var rows = new List<FollowUpResponse>(tasks.Count);

        foreach (var task in tasks)
        {
            var warning = await BuildWarningAsync(task.DonorId, task.LeadId, cancellationToken);

            var history = audit
                .Where(entry => entry.TargetId == task.Id)
                .Select(entry => new FollowUpHistoryEntryResponse(
                    entry.CreatedAtUtc,
                    DescribeAction(entry.ActionCode),
                    entry.Reason,
                    entry.ActorUserId is Guid actor && names.TryGetValue(actor, out var name) ? name : null))
                .ToList();

            var donorCampaign = task.DonorId is Guid donorId && giving.TryGetValue(donorId, out var given)
                ? given.LastCampaignName
                : null;

            rows.Add(task.ToResponse(viewer, warning, history, donorCampaign));
        }

        return rows;
    }

    /// <summary>The audit code as the history list words it.</summary>
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

    /// <summary>The same rule the repository applies to the list, for a single follow-up.</summary>
    private bool IsInScope(FollowUpTask task) =>
        currentUser.Scope.IsOrganisationWide
        || task.RelationshipOwnerUserId == currentUser.UserId
        || task.Lead?.OwnerUserId == currentUser.UserId
        || task.Donor?.RelationshipOwnerUserId == currentUser.UserId;

    private async Task<ConsentWarningResponse> BuildWarningAsync(
        Guid? donorId,
        Guid? leadId,
        CancellationToken cancellationToken)
    {
        Donor? donor = null;
        IReadOnlyList<Consent> consents = [];

        if (donorId is not null)
        {
            donor = await donorRepository.GetByIdAsync(donorId.Value, cancellationToken);
            consents = await consentRepository.GetCurrentForDonorAsync(donorId.Value, cancellationToken);
        }
        else if (leadId is not null)
        {
            consents = await consentRepository.GetForLeadAsync(leadId.Value, cancellationToken);
        }

        return FollowUpMappingConfig.BuildConsentWarning(donor, consents);
    }

    private IReadOnlyList<string> BuildPermittedActions()
    {
        var actions = new List<string> { "View" };

        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerSchedule))
        {
            actions.Insert(0, "Schedule follow-up");
        }

        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerAssign))
        {
            actions.Add("Assign");
        }

        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerMarkComplete))
        {
            actions.Add("Mark complete");
        }

        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerReschedule))
        {
            actions.Add("Reschedule");
        }

        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerCancelTask))
        {
            actions.Add("Cancel task");
        }

        if (currentUser.HasPermission(PermissionCodes.DonorsExport))
        {
            actions.Add("Export");
        }

        return actions;
    }

    private string DescribeScope() =>
        currentUser.Scope.IsOwnRecordsOnly
            ? "Follow-ups assigned to you, and those on the leads and donors you own"
            : "Your whole organisation";

    /// <summary>The counts, with the two ratios and the health word the queue's panel prints.</summary>
    private static FollowUpQueueSummaryResponse BuildSummary(FollowUpCounts counts)
    {
        var counted = counts.Total - counts.Cancelled;
        var completionRate = counted <= 0 ? 0 : (int)Math.Round(counts.Completed * 100m / counted);
        var overduePercent = counts.Open <= 0 ? 0 : (int)Math.Round(counts.Overdue * 100m / counts.Open);

        var health = overduePercent switch
        {
            < 5 => "Healthy",
            <= 15 => "Warning",
            _ => "Critical"
        };

        return new FollowUpQueueSummaryResponse(
            counts.Total, counts.Open, counts.DueToday, counts.Upcoming, counts.Overdue,
            counts.CompletedToday, counts.Escalated, counts.AssignedToMe,
            counts.Completed, counts.Cancelled, completionRate, overduePercent, health);
    }

    private static string DescribeFilter(FollowUpSearchFilter filter)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            parts.Add("search filter");
        }

        if (filter.DonorId is not null)
        {
            parts.Add("donor filter");
        }

        if (filter.LeadId is not null)
        {
            parts.Add("lead filter");
        }

        if (filter.Status is not null)
        {
            parts.Add($"status {filter.Status}");
        }

        if (filter.Priority is not null)
        {
            parts.Add($"priority {filter.Priority}");
        }

        if (filter.PermittedChannel is not null)
        {
            parts.Add($"channel {filter.PermittedChannel}");
        }

        if (filter.DueBeforeUtc is not null)
        {
            parts.Add($"due before {filter.DueBeforeUtc:yyyy-MM-dd}");
        }

        if (filter.OnlyMine == true)
        {
            parts.Add("only my tasks");
        }

        return parts.Count == 0 ? "No filters applied." : "Filtered by " + string.Join(", ", parts) + ".";
    }

    private static IReadOnlyList<LookupItem> ToLookup<TEnum>() where TEnum : struct, Enum =>
        [.. Enum.GetValues<TEnum>().Select(value => new LookupItem(value.ToString(), value.ToString()))];
}
