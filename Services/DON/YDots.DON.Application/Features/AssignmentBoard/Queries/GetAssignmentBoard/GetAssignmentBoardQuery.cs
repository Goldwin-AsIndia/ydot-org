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
using YDots.DON.Application.Features.AssignmentBoard.DTOs;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.AssignmentBoard.Queries.GetAssignmentBoard;


/// <summary>SCR-DON-006 GET. Balance ownership by team, language, workload and SLA.</summary>
public sealed record GetAssignmentBoardQuery(LeadSearchFilter Filter);

/// <summary>SCR-DON-006 Inspect history. The append-only ownership trail for one lead.</summary>
public sealed record GetAssignmentHistoryQuery(Guid LeadId);

/// <summary>
/// The board's Donors view: donors to give an owner to, or to move between owners.
///
/// THE ROLE FLOW PUTS IT HERE: a donor who gave without ever being a lead is created with no
/// owner, "and the Tenant Admin can subsequently assign the donor to an owner through the
/// Assignment Board". The board had a Donors switch that drew an empty page.
/// </summary>
public sealed record GetDonorAssignmentBoardQuery(LeadSearchFilter Filter);

/// <summary>The append-only ownership trail for one donor.</summary>
public sealed record GetDonorOwnershipHistoryQuery(Guid DonorId);

public sealed class AssignmentBoardQueryHandler(
    ILeadRepository leadRepository,
    IDonorRepository donorRepository,
    IFollowUpRepository followUpRepository,
    IDonationLedger ledger,
    ICampaignRepository campaignRepository,
    IConsentRepository consentRepository,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<AssignmentBoardQueryHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<AssignmentBoardResponse>> HandleAsync(
        GetAssignmentBoardQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Assignment board retrieval started.");

        var filter = query.Filter;
        var now = clock.UtcNow;

        // A CONVERTED LEAD IS NOT ROUTED HERE. It became a donor and left the queue; what is owned
        // now is the donor, on the board's Donors view. The board listed them among the leads,
        // offering to reassign something nobody works any more.
        if (filter.IsConverted is null && filter.Status != LeadStatus.Converted)
        {
            filter.IsConverted = false;
        }

        // The SLA filter is read against the clock, not against the word last stored on the lead.
        LeadMappingConfig.ApplySlaWindow(filter, now, _settings);

        var page = await leadRepository.SearchAsync(filter, currentUser.Scope, cancellationToken);
        var strip = await leadRepository.GetAssignmentCountsAsync(
            currentUser.OrganisationId, currentUser.Scope, now, now.AddHours(_settings.SlaDueSoonHours), cancellationToken);
        var workloads = await leadRepository.GetOpenWorkCountsByOwnerAsync(currentUser.OrganisationId, cancellationToken);
        var knownOwners = await leadRepository.GetKnownOwnersAsync(currentUser.OrganisationId, cancellationToken);
        var campaigns = await campaignRepository.GetActiveAsync(currentUser.OrganisationId, cancellationToken);

        var owners = knownOwners
            .Select(owner =>
            {
                var openWork = workloads.TryGetValue(owner.UserId, out var count) ? count : 0;
                return new OwnerWorkloadResponse(
                    owner.UserId,
                    owner.Name,
                    owner.TeamCode,
                    openWork,
                    LeadMappingConfig.CalculateWorkloadBand(openWork, _settings).ToString());
            })
            .ToList();

        if (filter.WorkloadBand is not null)
        {
            owners = [.. owners.Where(owner => string.Equals(owner.WorkloadBand, filter.WorkloadBand.ToString(), StringComparison.Ordinal))];
        }

        var rows = new List<AssignmentBoardRowResponse>(page.Items.Count);

        foreach (var lead in page.Items)
        {
            lead.SlaState = LeadMappingConfig.CalculateSlaState(lead.NextActionDueUtc, now, _settings);

            var suggestion = SuggestOwner(lead, owners);
            var currentOwnerLoad = lead.OwnerUserId is not null && workloads.TryGetValue(lead.OwnerUserId.Value, out var load)
                ? load
                : 0;

            rows.Add(new AssignmentBoardRowResponse(
                lead.Id,
                lead.LeadReference,
                BuildPreview(lead),
                lead.Campaign?.Name,
                lead.OwnerUserId,
                lead.OwnerName,
                suggestion?.UserId,
                suggestion?.Name,
                BuildRationale(lead, suggestion),
                currentOwnerLoad,
                lead.NextAction,
                lead.NextActionDueUtc,
                lead.SlaState.ToString(),
                lead.PreferredLanguage,
                lead.TeamCode,
                lead.Status.ToString(),
                lead.Version));
        }

        var teams = knownOwners
            .Where(owner => !string.IsNullOrWhiteSpace(owner.TeamCode))
            .Select(owner => owner.TeamCode!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(team => new LookupItem(team, team))
            .ToList();

        var response = new AssignmentBoardResponse(
            ScreenIds.AssignmentBoard,
            ScreenRoutes.AssignmentBoard,
            new PagedResponse<AssignmentBoardRowResponse>(rows, page.TotalCount, page.Page, page.PageSize),
            owners,
            [.. campaigns.Select(campaign => new LookupItem(campaign.Id.ToString(), campaign.Name, campaign.Code))],
            teams,
            SupportedLanguages.All,
            ToLookup<WorkloadBand>(),
            ToLookup<SlaState>(),
            BuildPermittedActions(),
            DescribeFilter(filter),
            DescribeScope(),
            _settings.BulkRouteMaximumItems,
            rows.Count == 0 ? ScreenState.Empty : ScreenState.Initial,
            strip.Unassigned,
            strip.Assigned,
            strip.DueSoon);

        logger.LogInformation("Assignment board retrieved successfully with {RowCount} row(s) from {TotalCount} matching lead(s).", rows.Count, page.TotalCount);

        return Result.Success(response);
    }

    public async Task<Result<AssignmentBoardLeadResponse>> HandleAsync(
        GetAssignmentHistoryQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Assignment history retrieval started for LeadId {LeadId}.", query.LeadId);

        var lead = await leadRepository.GetByIdAsync(query.LeadId, cancellationToken);

        if (lead is null || lead.OrganisationId != currentUser.OrganisationId)
        {
            logger.LogWarning("Assignment history retrieval failed for LeadId {LeadId} because the lead was not found inside the current scope.", query.LeadId);

            return Result.Failure<AssignmentBoardLeadResponse>(
                Error.NotFound("That lead was not found inside your scope."));
        }

        var history = await leadRepository.GetAssignmentHistoryAsync(lead.Id, cancellationToken);
        var consents = await consentRepository.GetForLeadAsync(lead.Id, cancellationToken);

        var detail = lead.ToDetailResponse(currentUser.CanSeeContact(), currentUser.CanSeeEvidence(), consents, currentUser.HasPermission);

        var historyResponse = new AssignmentHistoryResponse(
            lead.Id,
            lead.LeadReference,
            [.. history.Select(item => new AssignmentHistoryItemResponse(
                item.Id,
                item.PreviousOwnerUserId,
                item.PreviousOwnerName,
                item.NewOwnerUserId,
                item.NewOwnerName,
                item.AssignmentReason,
                item.EffectiveAtUtc,
                item.AssignedByUserId,
                item.IsBulkRoute))]);

        logger.LogInformation("Assignment history retrieved successfully for LeadId {LeadId} with {HistoryCount} history record(s).", query.LeadId, history.Count);

        return Result.Success(new AssignmentBoardLeadResponse(detail, historyResponse));
    }

    public async Task<Result<AssignmentBoardResponse>> HandleAsync(
        GetDonorAssignmentBoardQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Donor assignment board retrieval started.");

        var filter = query.Filter;
        var now = clock.UtcNow;

        bool? hasOwner = filter.AssignmentState switch
        {
            LeadAssignmentState.Unassigned => false,
            LeadAssignmentState.Assigned => true,
            _ => null
        };

        var (donors, total) = await donorRepository.SearchForAssignmentAsync(
            filter.Search, hasOwner, filter.OwnerUserId, filter.Skip, filter.PageSize,
            currentUser.OrganisationId, cancellationToken);

        // A DONOR RELATIONSHIP IS THE WORKLOAD HERE, not open leads - the board is weighing who can
        // take one more donor to look after.
        var workloads = await donorRepository.GetOwnedDonorCountsAsync(currentUser.OrganisationId, cancellationToken);
        var knownOwners = await leadRepository.GetKnownOwnersAsync(currentUser.OrganisationId, cancellationToken);

        var owners = knownOwners
            .Select(owner =>
            {
                var load = workloads.TryGetValue(owner.UserId, out var count) ? count : 0;
                return new OwnerWorkloadResponse(
                    owner.UserId, owner.Name, owner.TeamCode, load,
                    LeadMappingConfig.CalculateWorkloadBand(load, _settings).ToString());
            })
            .ToList();

        var strip = await donorRepository.GetAssignmentCountsAsync(currentUser.OrganisationId, cancellationToken);
        var dueSoon = await followUpRepository.CountDonorsDueAsync(
            currentUser.OrganisationId, now, now.AddHours(_settings.SlaDueSoonHours), cancellationToken);

        var ids = donors.Select(donor => donor.Id).ToList();
        var giving = await ledger.GetGivingAsync(currentUser.OrganisationId, ids, cancellationToken);
        var nextFollowUps = await followUpRepository.GetNextOpenForDonorsAsync(ids, cancellationToken);

        var rows = donors
            .Select(donor =>
            {
                var suggestion = owners
                    .Where(owner => owner.UserId != donor.RelationshipOwnerUserId)
                    .OrderBy(owner => owner.OpenWorkCount)
                    .ThenBy(owner => owner.Name, StringComparer.Ordinal)
                    .FirstOrDefault();

                var currentLoad = donor.RelationshipOwnerUserId is Guid ownerId && workloads.TryGetValue(ownerId, out var count)
                    ? count
                    : 0;

                nextFollowUps.TryGetValue(donor.Id, out var next);
                giving.TryGetValue(donor.Id, out var given);

                return new AssignmentBoardRowResponse(
                    donor.Id,
                    donor.DonorNumber,
                    $"{donor.DonorNumber} · {donor.DisplayName} · {donor.Status}",
                    given?.LastCampaignName,
                    donor.RelationshipOwnerUserId,
                    donor.RelationshipOwnerName,
                    suggestion?.UserId,
                    suggestion?.Name,
                    suggestion is null ? null : $"{suggestion.OpenWorkCount} donor(s) owned, band {suggestion.WorkloadBand}",
                    currentLoad,
                    next?.NextAction ?? next?.Purpose,
                    next?.DueAtUtc,
                    LeadMappingConfig.CalculateSlaState(next?.DueAtUtc, now, _settings).ToString(),
                    donor.PreferredLanguage,
                    null,
                    donor.Status.ToString(),
                    donor.Version,
                    "Donor");
            })
            .ToList();

        var response = new AssignmentBoardResponse(
            ScreenIds.AssignmentBoard,
            ScreenRoutes.AssignmentBoard,
            new PagedResponse<AssignmentBoardRowResponse>(rows, total, filter.Page, filter.PageSize),
            owners,
            [],
            [],
            SupportedLanguages.All,
            ToLookup<WorkloadBand>(),
            ToLookup<SlaState>(),
            BuildPermittedActions(),
            hasOwner switch
            {
                false => "Donors with no owner.",
                true => "Donors with an owner.",
                _ => "Every donor."
            },
            DescribeScope(),
            _settings.BulkRouteMaximumItems,
            rows.Count == 0 ? ScreenState.Empty : ScreenState.Initial,
            strip.Unassigned,
            strip.Assigned,
            dueSoon);

        logger.LogInformation("Donor assignment board retrieved with {RowCount} row(s) of {TotalCount}.", rows.Count, total);

        return Result.Success(response);
    }

    public async Task<Result<AssignmentHistoryResponse>> HandleAsync(
        GetDonorOwnershipHistoryQuery query,
        CancellationToken cancellationToken = default)
    {
        var donor = await donorRepository.GetByIdAsync(query.DonorId, cancellationToken);

        if (donor is null || donor.OrganisationId != currentUser.OrganisationId)
        {
            return Result.Failure<AssignmentHistoryResponse>(Error.DonorNotFound());
        }

        var changes = await donorRepository.GetOwnerChangesAsync(donor.Id, cancellationToken);

        return Result.Success(new AssignmentHistoryResponse(
            donor.Id,
            donor.DonorNumber,
            [.. changes.Select(change => new AssignmentHistoryItemResponse(
                change.Id,
                change.PreviousOwnerUserId,
                change.PreviousOwnerName,
                change.NewOwnerUserId,
                change.NewOwnerName,
                change.Reason,
                change.EffectiveAtUtc,
                change.AssignedByUserId,
                change.IsBulkRoute))]));
    }

    /// <summary>
    /// Suggests an owner. Language first, then team, then whoever is least loaded. It is a
    /// suggestion and nothing else: the manager still has to press Assign, and the reason they
    /// type is what gets recorded, not this rationale.
    /// </summary>
    private static OwnerWorkloadResponse? SuggestOwner(Lead lead, IReadOnlyList<OwnerWorkloadResponse> owners)
    {
        if (owners.Count == 0)
        {
            return null;
        }

        var candidates = owners.Where(owner => owner.UserId != lead.OwnerUserId).ToList();
        if (candidates.Count == 0)
        {
            return null;
        }

        var sameTeam = string.IsNullOrWhiteSpace(lead.TeamCode)
            ? candidates
            : [.. candidates.Where(owner => string.Equals(owner.TeamCode, lead.TeamCode, StringComparison.OrdinalIgnoreCase))];

        var pool = sameTeam.Count > 0 ? sameTeam : candidates;

        return pool.OrderBy(owner => owner.OpenWorkCount).ThenBy(owner => owner.Name, StringComparer.Ordinal).First();
    }

    private static string? BuildRationale(Lead lead, OwnerWorkloadResponse? suggestion)
    {
        if (suggestion is null)
        {
            return null;
        }

        var reasons = new List<string>();

        if (!string.IsNullOrWhiteSpace(lead.TeamCode)
            && string.Equals(lead.TeamCode, suggestion.TeamCode, StringComparison.OrdinalIgnoreCase))
        {
            reasons.Add("same team");
        }

        reasons.Add($"{suggestion.OpenWorkCount} open item(s), band {suggestion.WorkloadBand}");

        return string.Join(", ", reasons);
    }

    /// <summary>
    /// "Lead preview" on the board. Reference and name only: the board is a routing screen, so
    /// it never needs the contact details and therefore never carries them.
    /// </summary>
    private static string BuildPreview(Lead lead) =>
        $"{lead.LeadReference} · {LeadMappingConfig.BuildDisplayName(lead)} · {lead.Source}";

    private IReadOnlyList<string> BuildPermittedActions()
    {
        var actions = new List<string> { "Inspect history" };

        if (currentUser.HasPermission(PermissionCodes.AssignmentBoardAssign))
        {
            actions.Insert(0, "Assign");
        }

        if (currentUser.HasPermission(PermissionCodes.AssignmentBoardReassign))
        {
            actions.Add("Reassign");
        }

        if (currentUser.HasPermission(PermissionCodes.AssignmentBoardBulkRoute))
        {
            actions.Add("Bulk route");
        }

        return actions;
    }

    private string DescribeScope() =>
        currentUser.Scope.IsOwnRecordsOnly ? "Records assigned to you" : "Your whole organisation";

    private static string DescribeFilter(LeadSearchFilter filter)
    {
        var parts = new List<string>();

        if (filter.CampaignId is not null)
        {
            parts.Add("campaign filter");
        }

        if (!string.IsNullOrWhiteSpace(filter.TeamCode))
        {
            parts.Add($"team {filter.TeamCode}");
        }

        if (!string.IsNullOrWhiteSpace(filter.PreferredLanguage))
        {
            parts.Add($"language {filter.PreferredLanguage}");
        }

        if (filter.WorkloadBand is not null)
        {
            parts.Add($"workload {filter.WorkloadBand}");
        }

        if (filter.SlaState is not null)
        {
            parts.Add($"SLA {filter.SlaState}");
        }

        return parts.Count == 0 ? "No filters applied." : "Filtered by " + string.Join(", ", parts) + ".";
    }

    private static IReadOnlyList<LookupItem> ToLookup<TEnum>() where TEnum : struct, Enum =>
        [.. Enum.GetValues<TEnum>().Select(value => new LookupItem(value.ToString(), value.ToString()))];
}