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
using YDots.DON.Application.Features.CommunicationTimeline;
using YDots.DON.Application.Features.LeadWorkQueue.DTOs;
using YDots.DON.Application.Features.Leads.DTOs;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.LeadWorkQueue.Queries.GetLeadWorkQueue;

/// <summary>SCR-DON-001 GET. Prioritise new, due, overdue and nurture leads.</summary>
public sealed record GetLeadWorkQueueQuery(LeadSearchFilter Filter);

/// <summary>GET one lead from the queue, for the detail panel.</summary>
public sealed record GetLeadDetailQuery(Guid LeadId);

/// <summary>
/// GET the queue as CSV - the Export Leads action. Every lead the filter matches, not just the
/// page on screen, with contact masked unless the caller may see it.
/// </summary>
public sealed record ExportLeadsQuery(LeadSearchFilter Filter);

public sealed class LeadWorkQueueQueryHandler(
    ILeadRepository leadRepository,
    ICampaignRepository campaignRepository,
    IConsentRepository consentRepository,
    IExportService exportService,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<LeadWorkQueueQueryHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<LeadWorkQueueResponse>> HandleAsync(
        GetLeadWorkQueueQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Getting lead work queue.");

        var filter = query.Filter;

        PrepareFilter(filter);

        var page = await leadRepository.SearchAsync(filter, currentUser.Scope, cancellationToken);
        var now = clock.UtcNow;
        var canSeeContact = currentUser.CanSeeContact();

        // The SLA badge is recalculated on read. Overdue happens because time passed, not
        // because somebody saved the record, so a stored value would be wrong most of the day.
        //
        // ONLY FOR A LEAD STILL IN THE QUEUE. A conversion leaves the last planned date on the
        // record, and recalculating from it marked every converted lead on the Converted tab as
        // overdue - for a contact nobody will ever make.
        foreach (var lead in page.Items)
        {
            lead.SlaState = LeadMappingConfig.IsWorked(lead)
                ? LeadMappingConfig.CalculateSlaState(lead.NextActionDueUtc, now, _settings)
                : SlaState.NotApplicable;
        }

        var rows = page.Items
            .Select(lead => lead.ToListItemResponse(canSeeContact, now, _settings, currentUser.HasPermission))
            .ToList();

        var campaigns = await campaignRepository.GetActiveAsync(currentUser.OrganisationId, cancellationToken);

        // THE OWNER FILTER OFFERS EVERYBODY WHO HAS OWNED A LEAD HERE, former colleagues included,
        // so a lead left with somebody who has moved on can still be found and re-routed.
        var owners = await leadRepository.GetOwnerFilterOptionsAsync(currentUser.OrganisationId, cancellationToken);

        // MY LEADS COUNTS ITS OWN LEADS. The cards and the pipeline used to count the whole scope
        // whatever the grid showed, so My Leads printed the organisation's totals over one
        // person's rows.
        var countOwner = filter.OnlyMine == true ? currentUser.UserId : (Guid?)null;
        var (todayStart, todayEnd) = ReportingCalendar.Today(now, _settings);
        var counts = await leadRepository.GetStatusCountsAsync(currentUser.OrganisationId, currentUser.Scope, countOwner, cancellationToken);
        var summary = await leadRepository.GetQueueSummaryAsync(
            currentUser.OrganisationId, currentUser.Scope, countOwner, now, todayStart, todayEnd, cancellationToken);
        var sources = await leadRepository.GetSourcesAsync(currentUser.OrganisationId, currentUser.Scope, cancellationToken);

        var response = new LeadWorkQueueResponse(
            ScreenIds.LeadWorkQueue,
            ScreenRoutes.LeadWorkQueue,
            new PagedResponse<LeadListItemResponse>(rows, page.TotalCount, page.Page, page.PageSize),
            [.. campaigns.Select(campaign => new LookupItem(campaign.Id.ToString(), campaign.Name, campaign.Code))],
            [.. owners.Select(owner => new LookupItem(owner.UserId.ToString(), owner.Name, owner.TeamCode))],
            ToLookup<LeadStatus>(),
            ToLookup<SlaState>(),
            SupportedLanguages.All,

            // The words a person reads - "Requested callback", not "CallbackRequested". The rows
            // carry the value; the screens label it from this list, as the timeline does.
            [.. Enum.GetValues<ContactOutcome>().Select(outcome =>
                new LookupItem(outcome.ToString(), CommunicationCatalogue.OutcomeLabel(outcome)))],
            counts,
            summary,
            ToLookup<LeadTemperature>(),
            ToLookup<DonationPotential>(),
            BuildPermittedActions(),
            DescribeFilter(filter),
            DescribeScope(),
            now,
            rows.Count == 0 ? ScreenState.Empty : ScreenState.Initial,
            [.. sources.Select(source => new LookupItem(source, source))]);

        logger.LogInformation("Lead work queue loaded successfully. ResultCount: {ResultCount}, TotalCount: {TotalCount}, Page: {Page}", rows.Count, page.TotalCount, page.Page);

        return Result.Success(response);
    }

    public async Task<Result<ExportFile>> HandleAsync(
        ExportLeadsQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Lead export started with maximum row limit {MaximumRows}.", _settings.ExportMaximumRows);

        var filter = query.Filter;
        PrepareFilter(filter);

        var leads = await leadRepository.ExportAsync(filter, currentUser.Scope, _settings.ExportMaximumRows, cancellationToken);
        var canSeeContact = currentUser.CanSeeContact();
        var now = clock.UtcNow;

        var rows = leads
            .Select(lead => (IReadOnlyList<string>)
            [
                lead.LeadReference,
                LeadMappingConfig.BuildDisplayName(lead),
                ContactMasking.Phone(lead.MobileNumber, canSeeContact) ?? string.Empty,
                ContactMasking.Email(lead.EmailAddress, canSeeContact) ?? string.Empty,
                lead.Campaign?.Name ?? string.Empty,
                lead.Source,
                lead.OwnerName ?? "Unassigned",
                lead.Status.ToString(),
                lead.Temperature.ToString(),
                lead.DonationPotential.ToString(),
                Domain.Services.LeadHealth.Calculate(lead, now).ToString(System.Globalization.CultureInfo.InvariantCulture),
                lead.NextAction ?? string.Empty,
                lead.NextActionDueUtc?.ToString("u") ?? string.Empty,
                lead.LastContactOutcome.ToString(),
                lead.LastContactedAtUtc?.ToString("u") ?? string.Empty,
                lead.PreferredLanguage,
                lead.CreatedAtUtc.ToString("u")
            ])
            .ToList();

        var file = exportService.CreateCsv(
            "ydot-leads",
            ["Lead reference", "Name", "Mobile", "E-mail", "Campaign", "Source", "Owner", "Stage",
             "Temperature", "Donation potential", "Health", "Next action", "Next contact",
             "Last outcome", "Last contacted", "Language", "Captured"],
            rows);

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.LeadsExported, nameof(Lead), null, AuditResult.Succeeded,
                $"{rows.Count} lead(s) exported. Reference {file.Reference}."),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Lead export completed successfully. Exported {RowCount} row(s).", rows.Count);

        return Result.Success(file);
    }

    /// <summary>
    /// The rules every read of the queue shares, the page and the export alike.
    ///
    /// MY LEADS IS THE CALLER'S OWN, resolved from the token rather than from anything the browser
    /// sends.
    ///
    /// A CONVERTED LEAD LEAVES THE QUEUE. The role flow says a lead that donates becomes a donor
    /// and joins the owner's donor list; the comment in the repository has always said converted
    /// leads are hidden by default, and nothing hid them - All Leads listed every converted lead
    /// beside the live ones. Only the Converted tab, or asking for the Converted stage itself,
    /// brings them back.
    /// </summary>
    private void PrepareFilter(LeadSearchFilter filter)
    {
        if (filter.OnlyMine == true)
        {
            filter.OwnerUserId = currentUser.UserId;
            logger.LogInformation("Lead work queue restricted to the current user's records.");
        }

        if (filter.IsConverted is null && filter.Status != LeadStatus.Converted)
        {
            filter.IsConverted = false;
        }

        // RECENTLY ADDED IS THE LAST WEEK'S LEADS, NEWEST FIRST - the same window its count uses.
        // The window is the server's: a browser that sent its own cut-off could ask for any.
        filter.CreatedAfterUtc = filter.RecentlyAdded == true
            ? clock.UtcNow.AddDays(-LeadSearchFilter.RecentlyAddedDays)
            : null;

        if (filter.RecentlyAdded == true)
        {
            filter.NewestFirst = true;
        }

        // THE FOLLOW-UP STATE IS READ AGAINST THE ORGANISATION'S DAY, the same boundaries the
        // row's FollowUpState and the summary's due-today and overdue counts use.
        var (todayStart, todayEnd) = ReportingCalendar.Today(clock.UtcNow, _settings);

        (filter.HasNextContact, filter.NextContactFromUtc, filter.NextContactBeforeUtc) =
            filter.FollowUpState?.Trim().Replace(" ", string.Empty).ToUpperInvariant() switch
            {
                "OVERDUE" => (true, null, todayStart),
                "DUETODAY" => (true, todayStart, todayEnd),
                "UPCOMING" => (true, todayEnd, null),
                "NONE" => (false, null, null),
                _ => ((bool?)null, (DateTimeOffset?)null, (DateTimeOffset?)null)
            };

        // An SLA filter is a window too, and takes the window when both are asked for.
        LeadMappingConfig.ApplySlaWindow(filter, clock.UtcNow, _settings);
    }

    public async Task<Result<LeadDetailResponse>> HandleAsync(
        GetLeadDetailQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Getting lead detail.");

        var lead = await leadRepository.GetByIdAsync(query.LeadId, cancellationToken);

        if (lead is null || lead.OrganisationId != currentUser.OrganisationId)
        {
            logger.LogWarning("Lead detail request rejected because the lead was not found in the current organisation scope.");
            return Result.Failure<LeadDetailResponse>(Error.NotFound("That lead was not found inside your scope."));
        }

        if (currentUser.Scope.IsOwnRecordsOnly && lead.OwnerUserId != currentUser.UserId)
        {
            logger.LogWarning("Lead detail request rejected because the lead is outside the current user's record scope.");
            return Result.Failure<LeadDetailResponse>(Error.NotFound("That lead was not found inside your scope."));
        }

        lead.SlaState = LeadMappingConfig.CalculateSlaState(lead.NextActionDueUtc, clock.UtcNow, _settings);

        var consents = await consentRepository.GetForLeadAsync(lead.Id, cancellationToken);

        logger.LogInformation("Lead detail loaded successfully.");

        return Result.Success(lead.ToDetailResponse(
            currentUser.CanSeeContact(), currentUser.CanSeeEvidence(), consents, currentUser.HasPermission));
    }

    /// <summary>
    /// The verbs the queue screen may draw.
    ///
    /// "CREATE" IS A LEAD-CAPTURE RIGHT, NOT A QUEUE ONE, and it is listed here because the
    /// Create Lead button lives on this screen while the form it opens belongs to SCR-DON-002.
    /// Without it the screen had no honest way to ask the question and inferred the answer from
    /// <c>Accept</c>/<c>Contact</c> - two queue verbs that say nothing about whether the caller
    /// can save a lead, so a reader who could pick work up was offered a form the API would
    /// refuse.
    /// </summary>
    private IReadOnlyList<string> BuildPermittedActions()
    {
        var actions = new List<string> { "Filter", "Open" };

        if (currentUser.HasPermission(PermissionCodes.LeadCaptureSave))
        {
            actions.Add("Create");
        }

        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueAccept))
        {
            actions.Insert(0, "Accept");
        }

        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueAssign))
        {
            actions.Add("Assign");
        }

        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueContact))
        {
            actions.Add("Contact");
        }

        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueQualify))
        {
            actions.Add("Qualify");
        }

        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueClose))
        {
            actions.Add("Close");
        }

        // Temperature and donation potential are the fundraiser's reading of a lead, set through
        // their own action - the same people who may qualify it.
        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueQualify))
        {
            actions.Add("Score");
        }

        // Export Leads. The file is masked by the same rule as the screen, and scoped the same way.
        if (currentUser.HasPermission(PermissionCodes.DonorsExport))
        {
            actions.Add("Export");
        }

        return actions;
    }

    private string DescribeScope() =>
        currentUser.Scope.IsOwnRecordsOnly ? "Records assigned to you" : "Your whole organisation";

    /// <summary>
    /// The "active filter summary" the screen has to show. Written as plain language rather
    /// than a chip list so it also reads correctly to a screen reader.
    /// </summary>
    private static string DescribeFilter(LeadSearchFilter filter)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            parts.Add("search filter");
        }

        if (filter.CampaignId is not null)
        {
            parts.Add("campaign filter");
        }

        if (filter.OwnerUserId is not null)
        {
            parts.Add("owner filter");
        }

        if (filter.Status is not null)
        {
            parts.Add($"status {filter.Status}");
        }

        if (filter.SlaState is not null)
        {
            parts.Add($"SLA {filter.SlaState}");
        }

        if (!string.IsNullOrWhiteSpace(filter.PreferredLanguage))
        {
            parts.Add($"language {filter.PreferredLanguage}");
        }

        if (filter.DueBeforeUtc is not null)
        {
            parts.Add($"due before {filter.DueBeforeUtc:yyyy-MM-dd}");
        }

        if (filter.DueAfterUtc is not null)
        {
            parts.Add($"due after {filter.DueAfterUtc:yyyy-MM-dd}");
        }

        if (filter.OnlyMine == true)
        {
            parts.Add("only my leads");
        }

        return parts.Count == 0 ? "No filters applied." : "Filtered by " + string.Join(", ", parts) + ".";
    }

    private static IReadOnlyList<LookupItem> ToLookup<TEnum>() where TEnum : struct, Enum =>
        [.. Enum.GetValues<TEnum>().Select(value => new LookupItem(value.ToString(), value.ToString()))];
}