using YDots.DON.Application.Common.Models;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Common.Abstractions.Persistence;

/// <summary>
/// The figures behind DON's part of the landing page that no list already answers.
///
/// EVERY READ GOES THROUGH THE SAME SCOPE GATE AS THE LISTS: the fundraising team, holding
/// <c>don.records.view-all</c>, sees the Organisation; DonorCare sees the leads they own, the
/// donors they look after and the follow-ups on either - My Leads, My Donors and their own
/// Follow-up Queue, counted.
/// </summary>
public interface IDonorDashboardReadService
{
    /// <summary>Leads by status, drafts left out.</summary>
    Task<IReadOnlyDictionary<LeadStatus, int>> GetLeadStatusCountsAsync(
        AccessScope scope, CancellationToken cancellationToken);

    /// <summary>The first few leads at one status - the soonest due first, then the newest.</summary>
    Task<IReadOnlyList<DashboardLeadRow>> GetLeadsAtStageAsync(
        AccessScope scope, LeadStatus status, int take, CancellationToken cancellationToken);

    /// <summary>The newest leads captured, drafts left out.</summary>
    Task<IReadOnlyList<DashboardLeadRow>> GetLatestLeadsAsync(
        AccessScope scope, int take, CancellationToken cancellationToken);

    /// <summary>When each lead in the window was captured, and when each was converted.</summary>
    Task<(IReadOnlyList<DateTimeOffset> Captured, IReadOnlyList<DateTimeOffset> Converted)> GetLeadMomentsAsync(
        AccessScope scope, DateTimeOffset fromUtc, CancellationToken cancellationToken);

    /// <summary>
    /// Leads converted at or after <paramref name="fromUtc"/> and before <paramref name="beforeUtc"/>,
    /// for one campaign when <paramref name="campaignId"/> is given.
    /// </summary>
    Task<int> CountConvertedAsync(
        AccessScope scope, DateTimeOffset fromUtc, DateTimeOffset beforeUtc, Guid? campaignId,
        CancellationToken cancellationToken);

    /// <summary>When each follow-up completed since <paramref name="fromUtc"/> was completed.</summary>
    Task<IReadOnlyList<DateTimeOffset>> GetCompletedFollowUpsAsync(
        AccessScope scope, DateTimeOffset fromUtc, CancellationToken cancellationToken);

    /// <summary>Leads per campaign, most first.</summary>
    Task<IReadOnlyList<DashboardTally>> GetLeadsByCampaignAsync(
        AccessScope scope, CancellationToken cancellationToken);

    /// <summary>Leads per source as captured, most first; a blank source is its own row.</summary>
    Task<IReadOnlyList<DashboardTally>> GetLeadsBySourceAsync(
        AccessScope scope, CancellationToken cancellationToken);

    /// <summary>Open follow-ups, soonest due first, undated ones last.</summary>
    Task<IReadOnlyList<DashboardFollowUpRow>> GetNextFollowUpsAsync(
        AccessScope scope, int take, CancellationToken cancellationToken);

    /// <summary>Open leads and open follow-ups per owner, busiest first.</summary>
    Task<IReadOnlyList<DashboardWorkloadRow>> GetWorkloadAsync(
        AccessScope scope, int take, CancellationToken cancellationToken);

    /// <summary>Decisions waiting on the Fundraising Manager.</summary>
    Task<DonorDashboardCounts> GetCountsAsync(
        AccessScope scope, CancellationToken cancellationToken);
}

public sealed record DashboardLeadRow(
    Guid Id,
    string Reference,
    string Name,
    string? CampaignName,
    string Source,
    LeadStatus Status,
    LeadTemperature Temperature,
    DonationPotential Potential,
    string? OwnerName,
    DateTimeOffset? NextActionDueUtc,
    DateTimeOffset CreatedAtUtc);

/// <summary>A labelled count.</summary>
public sealed record DashboardTally(string Key, string Label, int Count);

public sealed record DashboardFollowUpRow(
    Guid Id,
    string Reference,

    /// <summary>The donor's name, else the lead's - who the follow-up is about.</summary>
    string? RecordName,

    string? NextAction,
    string? Purpose,
    ConsentChannel Channel,
    DateTimeOffset? DueAtUtc);

public sealed record DashboardWorkloadRow(
    Guid OwnerUserId,
    string OwnerName,
    int OpenLeads,
    int OpenFollowUps);

public sealed record DonorDashboardCounts(
    int DonorsAwaitingApproval,
    int DuplicatesToReview,
    int VerificationsEscalated);
