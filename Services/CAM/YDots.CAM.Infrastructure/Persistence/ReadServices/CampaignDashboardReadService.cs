using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Domain.Entities;
using YDots.CAM.Domain.Enums;

namespace YDots.CAM.Infrastructure.Persistence.ReadServices;

/// <summary>
/// CAM's landing-page figures, counted in the database.
///
/// THE SCOPE RULE IS THE REGISTER'S, copied rather than reinvented: a caller limited to their own
/// records sees the campaigns they created or own, and everything hanging off those. A dashboard
/// that counted wider than the register would tell somebody about campaigns they cannot open.
///
/// THE GIFT FIGURES ARE READ FROM THE PAYMENT TABLES, as <c>FinancialDirectory</c> reads them -
/// read-only, over the shared database, with PAY's own definitions left to PAY. Traced means
/// arrived through a tracking asset; a voided gift is not money and is left out.
/// </summary>
public sealed class CampaignDashboardReadService(
    CampaignDbContext context,
    ILogger<CampaignDashboardReadService> logger) : ICampaignDashboardReadService
{
    public async Task<IReadOnlyList<DashboardCampaignRow>> GetStageRowsAsync(
        AccessScope scope, CampaignStatus status, int take, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var query = Scoped(scope).Where(campaign => campaign.Status == status);

        query = status switch
        {
            CampaignStatus.Active or CampaignStatus.Paused or CampaignStatus.Closing =>
                query.OrderBy(campaign => campaign.EndDate).ThenBy(campaign => campaign.Code),
            CampaignStatus.Closed or CampaignStatus.Cancelled =>
                query.OrderByDescending(campaign => campaign.EndDate).ThenBy(campaign => campaign.Code),
            _ => query.OrderBy(campaign => campaign.StartDate).ThenBy(campaign => campaign.Code)
        };

        return await Project(query.Take(take)).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DashboardCampaignRow>> GetCalendarAsync(
        AccessScope scope, DateOnly from, DateOnly to, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var query = Scoped(scope).Where(campaign =>
            ((campaign.Status == CampaignStatus.Approved || campaign.Status == CampaignStatus.Scheduled)
             && campaign.StartDate >= from && campaign.StartDate <= to)
            || ((campaign.Status == CampaignStatus.Active
                 || campaign.Status == CampaignStatus.Paused
                 || campaign.Status == CampaignStatus.Closing)
                && campaign.EndDate <= to));

        return await Project(query.OrderBy(campaign => campaign.StartDate).Take(50)).ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DashboardCampaignRow>> GetAllCampaignsAsync(
        AccessScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        return await Project(Scoped(scope).OrderBy(campaign => campaign.Name).ThenBy(campaign => campaign.Code))
            .ToListAsync(cancellationToken);
    }

    public async Task<CampaignDashboardCounts> GetCountsAsync(
        AccessScope scope, Guid? checkOwnerUserId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var campaigns = Scoped(scope);

        var closureRequests = await context.CampaignLifecycleActions
            .AsNoTracking()
            .Where(action => action.ActionType == CampaignLifecycleActionType.RequestClose
                             && action.ActionStatus == CampaignLifecycleActionStatus.Pending
                             && campaigns.Any(campaign => campaign.Id == action.CampaignId))
            .CountAsync(cancellationToken);

        var assets = await context.TrackingAssets
            .AsNoTracking()
            .Where(asset => !scope.IsOwnRecordsOnly
                            || asset.CreatedByUserId == scope.UserId
                            || asset.Campaign.Owners.Any(owner => owner.OwnerId == scope.UserId))
            .GroupBy(asset => asset.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        int Assets(params TrackingAssetStatus[] statuses) =>
            assets.Where(entry => statuses.Contains(entry.Status)).Sum(entry => entry.Count);

        // READINESS IS COUNTED BEFORE LAUNCH ONLY. A check on a campaign already live or closed
        // has done its job, and counting it would bury the checks that still decide a launch.
        var prelaunch = campaigns.Where(campaign =>
            campaign.Status == CampaignStatus.Draft
            || campaign.Status == CampaignStatus.Submitted
            || campaign.Status == CampaignStatus.Approved
            || campaign.Status == CampaignStatus.Scheduled);

        var checks = await context.CampaignReadinessChecks
            .AsNoTracking()
            .Where(check => prelaunch.Any(campaign => campaign.Id == check.CampaignId))
            .GroupBy(check => new
            {
                check.Status,
                Mine = checkOwnerUserId == null || check.OwnerUserId == checkOwnerUserId
            })
            .Select(group => new { group.Key.Status, group.Key.Mine, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var blockersOpen = await context.CampaignReadinessBlockers
            .AsNoTracking()
            .Where(blocker => !blocker.IsResolved
                              && prelaunch.Any(campaign => campaign.Id == blocker.ReadinessCheck.CampaignId))
            .CountAsync(cancellationToken);

        int Checks(ReadinessCheckStatus status) =>
            checks.Where(entry => entry.Status == status).Sum(entry => entry.Count);

        // WHICH CAMPAIGN EACH QUEUE STARTS AT - the soonest to launch, or the oldest request.
        var nextClosure = await context.CampaignLifecycleActions
            .AsNoTracking()
            .Where(action => action.ActionType == CampaignLifecycleActionType.RequestClose
                             && action.ActionStatus == CampaignLifecycleActionStatus.Pending
                             && campaigns.Any(campaign => campaign.Id == action.CampaignId))
            .OrderBy(action => action.EffectiveAtUtc)
            .Select(action => action.Campaign.Code)
            .FirstOrDefaultAsync(cancellationToken);

        var nextCheck = await NextPrelaunchCodeAsync(
            prelaunch,
            campaign => campaign.ReadinessChecks.Any(check =>
                check.Status == ReadinessCheckStatus.Pending
                && (checkOwnerUserId == null || check.OwnerUserId == checkOwnerUserId)),
            cancellationToken);

        var nextFailed = await NextPrelaunchCodeAsync(
            prelaunch,
            campaign => campaign.ReadinessChecks.Any(check => check.Status == ReadinessCheckStatus.Failed),
            cancellationToken);

        var nextBlocker = await NextPrelaunchCodeAsync(
            prelaunch,
            campaign => campaign.ReadinessChecks.Any(check => check.Blockers.Any(blocker => !blocker.IsResolved)),
            cancellationToken);

        return new CampaignDashboardCounts(
            closureRequests,
            assets.Sum(entry => entry.Count),
            Assets(TrackingAssetStatus.Draft),
            Assets(TrackingAssetStatus.Submitted),
            Assets(TrackingAssetStatus.Approved, TrackingAssetStatus.Active,
                TrackingAssetStatus.DisableRequested, TrackingAssetStatus.Inactive),
            Assets(TrackingAssetStatus.Active),
            Assets(TrackingAssetStatus.DisableRequested),
            checks.Sum(entry => entry.Count),
            Checks(ReadinessCheckStatus.Passed),
            Checks(ReadinessCheckStatus.Pending),
            Checks(ReadinessCheckStatus.Failed),
            checks.Where(entry => entry.Status == ReadinessCheckStatus.Pending && entry.Mine).Sum(entry => entry.Count),
            blockersOpen,
            nextClosure,
            nextCheck,
            nextFailed,
            nextBlocker);
    }

    private static Task<string?> NextPrelaunchCodeAsync(
        IQueryable<Campaign> prelaunch,
        System.Linq.Expressions.Expression<Func<Campaign, bool>> waiting,
        CancellationToken cancellationToken) =>
        prelaunch
            .Where(waiting)
            .OrderBy(campaign => campaign.StartDate)
            .ThenBy(campaign => campaign.Code)
            .Select(campaign => campaign.Code)
            .FirstOrDefaultAsync(cancellationToken)!;

    public async Task<DashboardAttributionTotals> GetAttributionAsync(
        Guid tenantId, AccessScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var empty = new DashboardAttributionTotals(string.Empty, 0m, 0, 0m, 0, [], 0);

        if (tenantId == Guid.Empty)
        {
            return empty;
        }

        // A caller limited to their own campaigns sees the gifts made to those campaigns only.
        Guid[]? campaignIds = scope.IsOwnRecordsOnly
            ? await Scoped(scope).Select(campaign => campaign.Id).ToArrayAsync(cancellationToken)
            : null;

        var narrowing = campaignIds is null ? string.Empty : " AND donation.campaign_id = ANY(@campaign_ids)";

        // ONE GROUPED READ. The attribution explorer pages through every donation to build the
        // same breakdown in memory; the landing page needs only the sums, and the grouping keys
        // are a join away.
        var breakdownSql = $"""
            SELECT
                donation.currency_code,
                COALESCE(channel.code, ''),
                COALESCE(channel.name, ''),
                donation.tracking_asset_id IS NOT NULL AS traced,
                COUNT(*)::int,
                COALESCE(SUM(donation.amount), 0)
            FROM pay_donations AS donation
            LEFT JOIN cam_tracking_assets AS asset ON asset.id = donation.tracking_asset_id
            LEFT JOIN cam_channels AS channel ON channel.id = asset.channel_id
            WHERE donation.tenant_id = @tenant_id
              AND donation.status <> 'Voided'{narrowing}
            GROUP BY donation.currency_code, channel.code, channel.name, traced
            """;

        // Only assets CAM still holds: a gift can carry the id of an asset that no longer exists,
        // and counting it would let "brought a gift" outgrow "created".
        var assetsSql = $"""
            SELECT COUNT(DISTINCT donation.tracking_asset_id)::int
            FROM pay_donations AS donation
            JOIN cam_tracking_assets AS asset ON asset.id = donation.tracking_asset_id
            WHERE donation.tenant_id = @tenant_id
              AND donation.status <> 'Voided'{narrowing}
            """;

        var groups = new List<(string Currency, string Code, string Name, bool Traced, int Count, decimal Amount)>();
        int assetsWithGifts;

        try
        {
            await using (var command = await CreateCommandAsync(breakdownSql, tenantId, campaignIds, cancellationToken))
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                while (await reader.ReadAsync(cancellationToken))
                {
                    groups.Add((
                        reader.GetString(0).Trim(),
                        reader.GetString(1),
                        reader.GetString(2),
                        reader.GetBoolean(3),
                        reader.GetInt32(4),
                        reader.GetDecimal(5)));
                }
            }

            await using (var command = await CreateCommandAsync(assetsSql, tenantId, campaignIds, cancellationToken))
            {
                assetsWithGifts = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken) ?? 0);
            }
        }
        catch (NpgsqlException exception)
        {
            // A landing page that cannot reach the payment tables shows its other tiles; the
            // gift sources tile simply has nothing to say.
            logger.LogError(exception, "Could not read the gift sources for organisation {TenantId}.", tenantId);
            return empty;
        }

        // THE ORGANISATION'S MAIN CURRENCY, by number of gifts - PAY's rule for its own totals, so
        // the two tiles that report traced money agree. Shares are never taken across currencies.
        var currency = groups
            .GroupBy(group => group.Currency, StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(group => group.Sum(entry => entry.Count))
            .Select(group => group.Key)
            .FirstOrDefault() ?? string.Empty;

        var inCurrency = groups
            .Where(group => string.Equals(group.Currency, currency, StringComparison.OrdinalIgnoreCase))
            .ToList();

        var traced = inCurrency.Where(group => group.Traced).ToList();

        return new DashboardAttributionTotals(
            currency,
            inCurrency.Sum(group => group.Amount),
            inCurrency.Sum(group => group.Count),
            traced.Sum(group => group.Amount),
            traced.Sum(group => group.Count),
            [
                .. traced
                    .GroupBy(group => (group.Code, group.Name))
                    .Select(group => new DashboardChannelTotal(
                        group.Key.Code,
                        group.Key.Name,
                        group.Sum(entry => entry.Amount),
                        group.Sum(entry => entry.Count)))
                    .OrderByDescending(channel => channel.Amount)
            ],
            assetsWithGifts);
    }

    /// <summary>Campaigns the caller may see - the register's own rule.</summary>
    private IQueryable<Campaign> Scoped(AccessScope scope)
    {
        var query = context.Campaigns.AsNoTracking();

        return scope.IsOwnRecordsOnly
            ? query.Where(campaign =>
                campaign.CreatedByUserId == scope.UserId
                || campaign.Owners.Any(owner => owner.OwnerId == scope.UserId))
            : query;
    }

    private static IQueryable<DashboardCampaignRow> Project(IQueryable<Campaign> query) =>
        query.Select(campaign => new DashboardCampaignRow(
            campaign.Id,
            campaign.Code,
            campaign.Name,
            campaign.FundOrProgramme,
            campaign.Status,
            campaign.StartDate,
            campaign.EndDate,
            campaign.TargetAmount,
            campaign.CurrencyId));

    private async Task<NpgsqlCommand> CreateCommandAsync(
        string sql, Guid tenantId, Guid[]? campaignIds, CancellationToken cancellationToken)
    {
        var connection = (NpgsqlConnection)context.Database.GetDbConnection();

        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken);
        }

        var command = new NpgsqlCommand(sql, connection);

        if (context.Database.CurrentTransaction?.GetDbTransaction() is NpgsqlTransaction transaction)
        {
            command.Transaction = transaction;
        }

        command.Parameters.Add(new NpgsqlParameter("tenant_id", NpgsqlDbType.Uuid) { Value = tenantId });

        if (campaignIds is not null)
        {
            command.Parameters.Add(new NpgsqlParameter("campaign_ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
            {
                Value = campaignIds
            });
        }

        return command;
    }
}
