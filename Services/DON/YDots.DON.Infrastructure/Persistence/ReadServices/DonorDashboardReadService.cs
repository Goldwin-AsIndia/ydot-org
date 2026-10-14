using Microsoft.EntityFrameworkCore;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Infrastructure.Persistence.ReadServices;

/// <summary>
/// DON's landing-page figures, counted in the database.
///
/// THE THREE SCOPE GATES BELOW ARE THE LISTS' OWN, line for line - <c>LeadRepository</c>,
/// <c>DonorReadService</c> and the follow-up repository each keep theirs private, so they are
/// restated here rather than loosened there. Change one of those and change its twin here, or the
/// dashboard and the list it summarises will disagree about whose records count.
/// </summary>
public sealed class DonorDashboardReadService(DonDbContext context) : IDonorDashboardReadService
{
    /// <summary>A lead still being worked - LeadRepository's OpenStatuses.</summary>
    private static readonly LeadStatus[] OpenLeadStatuses =
    [
        LeadStatus.New, LeadStatus.Assigned, LeadStatus.Contacted, LeadStatus.Qualified, LeadStatus.Nurture
    ];

    /// <summary>A follow-up still needing doing - the follow-up repository's OpenStatuses.</summary>
    private static readonly FollowUpStatus[] OpenFollowUpStatuses =
    [
        FollowUpStatus.Planned, FollowUpStatus.Assigned, FollowUpStatus.Rescheduled
    ];

    public async Task<IReadOnlyDictionary<LeadStatus, int>> GetLeadStatusCountsAsync(
        AccessScope scope, CancellationToken cancellationToken)
    {
        var counts = await Leads(scope)
            .GroupBy(lead => lead.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        return counts.ToDictionary(entry => entry.Status, entry => entry.Count);
    }

    public async Task<IReadOnlyList<DashboardLeadRow>> GetLeadsAtStageAsync(
        AccessScope scope, LeadStatus status, int take, CancellationToken cancellationToken)
    {
        var query = Leads(scope).Where(lead => lead.Status == status);

        // A worked stage leads with what is due soonest; a finished one with what finished last.
        query = OpenLeadStatuses.Contains(status)
            ? query.OrderBy(lead => lead.NextActionDueUtc == null)
                .ThenBy(lead => lead.NextActionDueUtc)
                .ThenByDescending(lead => lead.CreatedAtUtc)
            : query.OrderByDescending(lead => lead.ConvertedAtUtc ?? lead.CreatedAtUtc);

        return await ProjectAsync(query.Take(take), cancellationToken);
    }

    public async Task<IReadOnlyList<DashboardLeadRow>> GetLatestLeadsAsync(
        AccessScope scope, int take, CancellationToken cancellationToken) =>
        await ProjectAsync(Leads(scope).OrderByDescending(lead => lead.CreatedAtUtc).Take(take), cancellationToken);

    public async Task<(IReadOnlyList<DateTimeOffset> Captured, IReadOnlyList<DateTimeOffset> Converted)> GetLeadMomentsAsync(
        AccessScope scope, DateTimeOffset fromUtc, CancellationToken cancellationToken)
    {
        var captured = await Leads(scope)
            .Where(lead => lead.CreatedAtUtc >= fromUtc)
            .Select(lead => lead.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var converted = await Leads(scope)
            .Where(lead => lead.ConvertedAtUtc != null && lead.ConvertedAtUtc >= fromUtc)
            .Select(lead => lead.ConvertedAtUtc!.Value)
            .ToListAsync(cancellationToken);

        return (captured, converted);
    }

    public async Task<int> CountConvertedAsync(
        AccessScope scope, DateTimeOffset fromUtc, DateTimeOffset beforeUtc, Guid? campaignId,
        CancellationToken cancellationToken) =>
        await Leads(scope)
            .Where(lead => lead.ConvertedAtUtc != null
                           && lead.ConvertedAtUtc >= fromUtc
                           && lead.ConvertedAtUtc < beforeUtc
                           && (campaignId == null || lead.CampaignId == campaignId))
            .CountAsync(cancellationToken);

    public async Task<IReadOnlyList<DateTimeOffset>> GetCompletedFollowUpsAsync(
        AccessScope scope, DateTimeOffset fromUtc, CancellationToken cancellationToken) =>
        await FollowUps(scope)
            .Where(task => task.Status == FollowUpStatus.Completed
                           && task.CompletedAtUtc != null
                           && task.CompletedAtUtc >= fromUtc)
            .Select(task => task.CompletedAtUtc!.Value)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<DashboardTally>> GetLeadsByCampaignAsync(
        AccessScope scope, CancellationToken cancellationToken)
    {
        var rows = await Leads(scope)
            .GroupBy(lead => new { lead.CampaignId, Name = lead.Campaign != null ? lead.Campaign.Name : null })
            .Select(group => new { group.Key.CampaignId, group.Key.Name, Count = group.Count() })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows
                .OrderByDescending(row => row.Count)
                .Select(row => new DashboardTally(row.CampaignId.ToString(), row.Name ?? "No campaign", row.Count))
        ];
    }

    public async Task<IReadOnlyList<DashboardTally>> GetLeadsBySourceAsync(
        AccessScope scope, CancellationToken cancellationToken)
    {
        var rows = await Leads(scope)
            .GroupBy(lead => lead.Source)
            .Select(group => new { Source = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        // Sources are typed text; "Website" and "website " are the same source to anybody reading.
        return
        [
            .. rows
                .GroupBy(row => (row.Source ?? string.Empty).Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(group => new DashboardTally(
                    group.Key.ToUpperInvariant(),
                    group.Key,
                    group.Sum(row => row.Count)))
                .OrderByDescending(tally => tally.Count)
        ];
    }

    public async Task<IReadOnlyList<DashboardFollowUpRow>> GetNextFollowUpsAsync(
        AccessScope scope, int take, CancellationToken cancellationToken)
    {
        var rows = await FollowUps(scope)
            .Where(task => OpenFollowUpStatuses.Contains(task.Status))
            .OrderBy(task => task.DueAtUtc == null)
            .ThenBy(task => task.DueAtUtc)
            .Take(take)
            .Select(task => new
            {
                task.Id,
                task.FollowUpReference,
                task.NextAction,
                task.Purpose,
                task.PermittedChannel,
                task.DueAtUtc,
                Donor = task.Donor == null
                    ? null
                    : new
                    {
                        task.Donor.DonorType,
                        task.Donor.FirstName,
                        task.Donor.LastName,
                        task.Donor.OrganisationName,
                        task.Donor.DonorNumber
                    },
                Lead = task.Lead == null
                    ? null
                    : new { task.Lead.DisplayName, task.Lead.FirstName, task.Lead.LastName }
            })
            .ToListAsync(cancellationToken);

        // THE NAME RULES ARE THE ENTITIES' OWN, applied to the few columns read: a donor's
        // DisplayName and LeadMappingConfig.BuildDisplayName - the Follow-up Queue's words exactly.
        return
        [
            .. rows.Select(row => new DashboardFollowUpRow(
                row.Id,
                row.FollowUpReference,
                row.Donor is not null
                    ? new Donor
                    {
                        DonorType = row.Donor.DonorType,
                        FirstName = row.Donor.FirstName,
                        LastName = row.Donor.LastName,
                        OrganisationName = row.Donor.OrganisationName,
                        DonorNumber = row.Donor.DonorNumber
                    }.DisplayName
                    : row.Lead is not null
                        ? LeadMappingConfig.BuildDisplayName(new Lead
                        {
                            DisplayName = row.Lead.DisplayName,
                            FirstName = row.Lead.FirstName,
                            LastName = row.Lead.LastName
                        })
                        : null,
                row.NextAction,
                row.Purpose,
                row.PermittedChannel,
                row.DueAtUtc))
        ];
    }

    public async Task<IReadOnlyList<DashboardWorkloadRow>> GetWorkloadAsync(
        AccessScope scope, int take, CancellationToken cancellationToken)
    {
        var leads = await Leads(scope)
            .Where(lead => OpenLeadStatuses.Contains(lead.Status)
                           && lead.ConvertedDonorId == null
                           && lead.OwnerUserId != null)
            .GroupBy(lead => new { lead.OwnerUserId, lead.OwnerName })
            .Select(group => new { group.Key.OwnerUserId, group.Key.OwnerName, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var followUps = await FollowUps(scope)
            .Where(task => OpenFollowUpStatuses.Contains(task.Status))
            .GroupBy(task => new { task.RelationshipOwnerUserId, task.RelationshipOwnerName })
            .Select(group => new { group.Key.RelationshipOwnerUserId, group.Key.RelationshipOwnerName, Count = group.Count() })
            .ToListAsync(cancellationToken);

        // One row per person. A name can differ between rows written at different times; the
        // first non-blank one stands for them.
        var owners = leads
            .Select(row => (Id: row.OwnerUserId!.Value, Name: row.OwnerName))
            .Concat(followUps.Select(row => (Id: row.RelationshipOwnerUserId, Name: row.RelationshipOwnerName)))
            .GroupBy(owner => owner.Id)
            .Select(group => new DashboardWorkloadRow(
                group.Key,
                group.Select(owner => owner.Name).FirstOrDefault(name => !string.IsNullOrWhiteSpace(name))?.Trim()
                    ?? "Unnamed colleague",
                leads.Where(row => row.OwnerUserId == group.Key).Sum(row => row.Count),
                followUps.Where(row => row.RelationshipOwnerUserId == group.Key).Sum(row => row.Count)))
            .OrderByDescending(row => row.OpenLeads + row.OpenFollowUps)
            .ThenBy(row => row.OwnerName, StringComparer.OrdinalIgnoreCase)
            .Take(take)
            .ToList();

        return owners;
    }

    public async Task<DonorDashboardCounts> GetCountsAsync(
        AccessScope scope, CancellationToken cancellationToken)
    {
        var donors = Donors(scope);

        var awaitingApproval = await donors
            .CountAsync(donor => donor.ApprovalState == ApprovalState.PendingApproval, cancellationToken);

        // The Duplicate Review list narrows by Organisation only, and so does this count. Only the
        // Fundraising Manager is shown it, and they work the whole Organisation.
        var duplicates = await context.DonorMergeCases
            .AsNoTracking()
            .Where(mergeCase => mergeCase.OrganisationId == scope.OrganisationId
                                && (mergeCase.Status == DonorMergeCaseStatus.Active
                                    || mergeCase.Status == DonorMergeCaseStatus.UnderReview))
            .CountAsync(cancellationToken);

        var escalated = await context.DonorIdentityVerifications
            .AsNoTracking()
            .Where(verification => verification.OrganisationId == scope.OrganisationId
                                   && verification.Status == VerificationStatus.Escalated
                                   && donors.Any(donor => donor.Id == verification.DonorId))
            .CountAsync(cancellationToken);

        return new DonorDashboardCounts(awaitingApproval, duplicates, escalated);
    }

    // =========================================================================================
    // The scope gates - see the note on the class
    // =========================================================================================

    /// <summary>LeadRepository.ApplyScope, plus its "not a draft" rule.</summary>
    private IQueryable<Lead> Leads(AccessScope scope)
    {
        var leads = context.Leads
            .AsNoTracking()
            .Where(lead => lead.OrganisationId == scope.OrganisationId && !lead.IsDraft);

        if (scope.IsOrganisationWide)
        {
            return leads;
        }

        var explicitRecordIds = scope.ExplicitRecordIds;
        if (explicitRecordIds.Count > 0)
        {
            return leads.Where(lead => explicitRecordIds.Contains(lead.Id));
        }

        leads = leads.Where(lead => lead.OwnerUserId == scope.UserId);

        var campaignIds = scope.CampaignIds;
        if (campaignIds.Count > 0)
        {
            leads = leads.Where(lead => campaignIds.Contains(lead.CampaignId));
        }

        var geographyCodes = scope.GeographyCodes;
        if (geographyCodes.Count > 0)
        {
            leads = leads.Where(lead => lead.GeographyCode != null && geographyCodes.Contains(lead.GeographyCode));
        }

        return leads;
    }

    /// <summary>DonorReadService.ApplyScope.</summary>
    private IQueryable<Donor> Donors(AccessScope scope)
    {
        var donors = context.Donors.AsNoTracking().Where(donor => donor.OrganisationId == scope.OrganisationId);

        if (scope.IsOrganisationWide)
        {
            return donors;
        }

        var explicitRecordIds = scope.ExplicitRecordIds;

        return explicitRecordIds.Count > 0
            ? donors.Where(donor => explicitRecordIds.Contains(donor.Id))
            : donors.Where(donor => donor.RelationshipOwnerUserId == scope.UserId);
    }

    /// <summary>The follow-up repository's ApplyScope.</summary>
    private IQueryable<FollowUpTask> FollowUps(AccessScope scope)
    {
        var tasks = context.FollowUpTasks.AsNoTracking().Where(task => task.OrganisationId == scope.OrganisationId);

        if (scope.IsOrganisationWide)
        {
            return tasks;
        }

        return tasks.Where(task =>
            task.RelationshipOwnerUserId == scope.UserId
            || (task.Lead != null && task.Lead.OwnerUserId == scope.UserId)
            || (task.Donor != null && task.Donor.RelationshipOwnerUserId == scope.UserId));
    }

    private static async Task<IReadOnlyList<DashboardLeadRow>> ProjectAsync(
        IQueryable<Lead> query, CancellationToken cancellationToken)
    {
        var rows = await query
            .Select(lead => new
            {
                lead.Id,
                lead.LeadReference,
                lead.DisplayName,
                lead.FirstName,
                lead.LastName,
                CampaignName = lead.Campaign != null ? lead.Campaign.Name : null,
                lead.Source,
                lead.Status,
                lead.Temperature,
                lead.DonationPotential,
                lead.OwnerName,
                lead.NextActionDueUtc,
                lead.CreatedAtUtc
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(row => new DashboardLeadRow(
                row.Id,
                row.LeadReference,
                LeadMappingConfig.BuildDisplayName(new Lead
                {
                    DisplayName = row.DisplayName,
                    FirstName = row.FirstName,
                    LastName = row.LastName
                }) is { Length: > 0 } name ? name : row.LeadReference,
                row.CampaignName,
                row.Source,
                row.Status,
                row.Temperature,
                row.DonationPotential,
                row.OwnerName,
                row.NextActionDueUtc,
                row.CreatedAtUtc))
        ];
    }
}
