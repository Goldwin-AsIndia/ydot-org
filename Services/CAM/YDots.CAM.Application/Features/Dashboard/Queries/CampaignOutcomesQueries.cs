using Microsoft.Extensions.Logging;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Features.Dashboard.DTOs;
using YDots.CAM.Domain.Enums;
using static YDots.CAM.Application.Features.Dashboard.CampaignDashboardCatalogue;

namespace YDots.CAM.Application.Features.Dashboard.Queries;

/// <summary>CAM's outcome figures for a period and scope - the Executive dashboard.</summary>
public sealed record GetCampaignOutcomesQuery(DashboardOutcomesFilter Filter);

/// <summary>
/// How many campaigns ran in the period, and the campaigns the period can be narrowed to.
///
/// IT REPLACES AN INVENTED FIGURE AND AN INVENTED PICKER. The page said "18 active campaigns" and
/// offered four campaigns that exist nowhere ("CAMP-2026-0178 · Maharashtra"); the count is now
/// the campaigns that were live during the period, and the picker lists the caller's own.
///
/// "LIVE IN THE PERIOD" means launched and running on at least one of its days: Active, Paused,
/// Closing or Closed, with its own dates touching the period. A draft or a scheduled campaign has
/// not run yet; a cancelled one never did.
/// </summary>
public sealed class CampaignOutcomesQueryHandler(
    ICampaignDashboardReadService dashboard,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    ILogger<CampaignOutcomesQueryHandler> logger)
{
    public async Task<Result<DashboardOutcomesResponse>> HandleAsync(
        GetCampaignOutcomesQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var zone = DashboardFormat.ResolveZone(query.Filter.TimeZone, null);
        var now = clock.UtcNow;
        var (period, error) = DashboardPeriods.Resolve(query.Filter, DashboardFormat.LocalDate(now, zone));

        if (period is null)
        {
            logger.LogInformation("Campaign outcomes refused: {Reason}", error);
            return Result.Failure<DashboardOutcomesResponse>(Error.Validation(error!));
        }

        if (tenantContext.TenantId is null || !currentUser.HasPermission(PermissionCodes.CampaignsView))
        {
            logger.LogInformation("Campaign outcomes have nothing for this caller.");
            return Result.Success(Response(period, now, zone, [], []));
        }

        logger.LogInformation("Campaign outcomes requested for {From} to {To}.", period.From, period.To);

        var campaigns = await dashboard.GetAllCampaignsAsync(currentUser.Scope, cancellationToken);
        var inScope = query.Filter.CampaignId is { } campaignId
            ? campaigns.Where(campaign => campaign.Id == campaignId).ToList()
            : campaigns;

        int Live(DateOnly from, DateOnly to) => inScope.Count(campaign =>
            campaign.Status is CampaignStatus.Active or CampaignStatus.Paused
                or CampaignStatus.Closing or CampaignStatus.Closed
            && campaign.StartDate <= to
            && campaign.EndDate >= from);

        var register = currentUser.HasPermission(Register.Permission)
            ? new DashboardLinkResponse("Open the campaign register", Register.Route)
            : null;

        var metrics = new List<DashboardOutcomeMetricResponse>
        {
            new("campaigns-live", 20, "Campaigns live",
                Live(period.From, period.To), "count", string.Empty,
                "Campaigns running on at least one day of the period",
                "Campaigns that have launched - Active, Paused, Closing or Closed - whose own start and end dates touch the period. Drafts and scheduled campaigns have not run yet; cancelled ones never did.",
                period.CompareFrom is { } compareFrom && period.CompareTo is { } compareTo ? Live(compareFrom, compareTo) : null,
                register)
        };

        var options = campaigns
            .Where(campaign => campaign.Status != CampaignStatus.Cancelled)
            .Select(campaign => new DashboardScopeOptionResponse(
                campaign.Id,
                campaign.Code,
                campaign.Name,
                $"Campaign · {campaign.Status} · {campaign.FundOrProgramme}"))
            .ToList();

        return Result.Success(Response(period, now, zone, metrics, options));
    }

    private static DashboardOutcomesResponse Response(
        DashboardPeriods.Period period,
        DateTimeOffset now,
        TimeZoneInfo zone,
        IReadOnlyList<DashboardOutcomeMetricResponse> metrics,
        IReadOnlyList<DashboardScopeOptionResponse> options) =>
        new(Module, now, zone.Id, DashboardPeriods.ZoneLabel(zone, now),
            period.From, period.To, period.CompareFrom, period.CompareTo,
            metrics, null, options, [], DashboardPeriods.Comparisons(period));
}
