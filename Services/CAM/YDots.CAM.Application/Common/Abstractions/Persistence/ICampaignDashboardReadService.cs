using YDots.CAM.Application.Common.Models;
using YDots.CAM.Domain.Enums;

namespace YDots.CAM.Application.Common.Abstractions.Persistence;

/// <summary>
/// The figures behind CAM's part of the landing page.
///
/// EVERY READ IS NARROWED BY THE CALLER'S <see cref="AccessScope"/> exactly as the campaign
/// register narrows it - a caller limited to their own records sees the campaigns they created or
/// own, and the assets, checks and gifts belonging to those - so the dashboard never counts a
/// campaign the register would not list.
/// </summary>
public interface ICampaignDashboardReadService
{
    /// <summary>
    /// The first <paramref name="take"/> campaigns at one stage, in the order that matters for it:
    /// soonest to start for those not yet live, soonest to end for those running, most recently
    /// ended for those closed.
    /// </summary>
    Task<IReadOnlyList<DashboardCampaignRow>> GetStageRowsAsync(
        AccessScope scope, CampaignStatus status, int take, CancellationToken cancellationToken);

    /// <summary>
    /// Approved and scheduled campaigns starting on or before <paramref name="to"/>, and running
    /// ones ending on or before it - an end already passed included, since a live campaign past
    /// its end date is the one most in need of a look.
    /// </summary>
    Task<IReadOnlyList<DashboardCampaignRow>> GetCalendarAsync(
        AccessScope scope, DateOnly from, DateOnly to, CancellationToken cancellationToken);

    /// <summary>Every campaign the caller may see, by name - the Executive dashboard's scope list.</summary>
    Task<IReadOnlyList<DashboardCampaignRow>> GetAllCampaignsAsync(
        AccessScope scope, CancellationToken cancellationToken);

    /// <summary>The work waiting at each decision point.</summary>
    Task<CampaignDashboardCounts> GetCountsAsync(
        AccessScope scope, Guid? checkOwnerUserId, CancellationToken cancellationToken);

    /// <summary>
    /// Every gift the Organisation received, voided ones aside, split by the channel of the tracking
    /// asset it arrived through - read from the payment tables in one grouped query.
    /// </summary>
    Task<DashboardAttributionTotals> GetAttributionAsync(
        Guid tenantId, AccessScope scope, CancellationToken cancellationToken);
}

/// <summary>A campaign as a pipeline row or a calendar entry needs it.</summary>
public sealed record DashboardCampaignRow(
    Guid Id,
    string Code,
    string Name,
    string FundOrProgramme,
    CampaignStatus Status,
    DateOnly StartDate,
    DateOnly EndDate,
    decimal TargetAmount,
    Guid CurrencyId);

/// <summary>Counts at each point where a campaign, an asset or a check waits for somebody.</summary>
public sealed record CampaignDashboardCounts(
    /// <summary>Closure requests nobody has decided yet.</summary>
    int ClosureRequestsPending,

    int AssetsTotal,
    int AssetsDraft,
    int AssetsSubmitted,

    /// <summary>Assets that were approved at some point - approved, live, retiring or retired.</summary>
    int AssetsApproved,

    int AssetsActive,
    int AssetsDisableRequested,

    /// <summary>Readiness checks on campaigns not yet launched.</summary>
    int ChecksTotal,

    int ChecksPassed,
    int ChecksPending,
    int ChecksFailed,

    /// <summary>
    /// Pending checks the caller owns - or every pending check, when no owner was given (the
    /// Organisation Admin, whom no record-level rule may stop).
    /// </summary>
    int ChecksPendingForCaller,

    int BlockersOpen,

    /// <summary>
    /// The campaign each kind of waiting work is soonest due on, so a Needs Attention row can open
    /// that campaign rather than a list: a closure request, a pending check of the caller's, a
    /// failed check and an open blocker. Null when there is none.
    /// </summary>
    string? NextClosureCampaignCode,

    string? NextCheckCampaignCode,
    string? NextFailedCampaignCode,
    string? NextBlockerCampaignCode);

/// <summary>Gifts by how they were traced, in the Organisation's main currency.</summary>
public sealed record DashboardAttributionTotals(
    string CurrencyCode,
    decimal TotalAmount,
    int TotalCount,
    decimal TracedAmount,
    int TracedCount,
    IReadOnlyList<DashboardChannelTotal> Channels,

    /// <summary>Distinct tracking assets that brought at least one gift.</summary>
    int AssetsWithGifts);

/// <summary>Traced gifts through one channel.</summary>
public sealed record DashboardChannelTotal(
    string Code,
    string Name,
    decimal Amount,
    int Count);
