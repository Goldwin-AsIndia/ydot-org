using Microsoft.Extensions.Logging;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Features.Campaigns.DTOs;
using YDots.CAM.Application.Features.Dashboard.DTOs;
using YDots.CAM.Domain.Enums;
using static YDots.CAM.Application.Features.Dashboard.CampaignDashboardCatalogue;

namespace YDots.CAM.Application.Features.Dashboard.Queries;

/// <summary>CAM's part of the landing page, for whoever is asking.</summary>
public sealed record GetCampaignDashboardQuery(DashboardFilter Filter);

/// <summary>
/// The campaigns on the landing page: the pipeline, what starts and ends soon, where traced gifts
/// came from, how the tracking assets are doing - and the decisions and preparation waiting on the
/// caller.
///
/// THE EXECUTIVE / MANAGER SPLIT DECIDES NEEDS ATTENTION. A Campaign Manager is shown what waits
/// for a decision - submissions, closure requests, assets to approve or take down, paused
/// campaigns, blockers - and a Campaign Executive what waits for preparation - drafts, their own
/// readiness checks, failed checks, asset drafts. Each row needs the permission that acts on it,
/// so a person holding both roles sees both halves, and the Organisation Admin sees everything.
///
/// NOTHING FOR A CALLER WHO CANNOT READ CAMPAIGNS. A Fundraiser or a Donor gets an empty answer
/// and the page fills those tiles from the modules they can read.
/// </summary>
public sealed class CampaignDashboardQueryHandler(
    ICampaignDashboardReadService dashboard,
    ICampaignReadService campaigns,
    IFinancialDirectory financial,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    ILogger<CampaignDashboardQueryHandler> logger)
{
    /// <summary>Entries the calendar tile lists.</summary>
    private const int CalendarRows = 6;

    public async Task<Result<DashboardResponse>> HandleAsync(
        GetCampaignDashboardQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var zone = DashboardFormat.ResolveZone(query.Filter.TimeZone, null);
        var now = clock.UtcNow;
        var today = DashboardFormat.LocalDate(now, zone);
        var scope = currentUser.Scope;

        if (tenantContext.TenantId is not Guid tenantId || !Can(PermissionCodes.CampaignsView))
        {
            logger.LogInformation("Campaign dashboard has nothing for this caller.");
            return Result.Success(new DashboardResponse(
                Module, now, zone.Id, null, [], [], [], [], new DashboardPanelsResponse()));
        }

        logger.LogInformation("Campaign dashboard requested.");

        var statistics = await campaigns.GetStatisticsAsync(scope, cancellationToken);

        var stageRows = new Dictionary<CampaignStatus, IReadOnlyList<DashboardCampaignRow>>();
        foreach (var stage in Stages)
        {
            stageRows[stage.Status] = await dashboard.GetStageRowsAsync(scope, stage.Status, RowsPerStage, cancellationToken);
        }

        var calendar = await dashboard.GetCalendarAsync(scope, today, today.AddDays(CalendarDays), cancellationToken);

        // The Organisation Admin is counted against every pending check: no record-level rule may
        // stop them, and "only the check's owner passes or fails it" exempts them.
        var counts = await dashboard.GetCountsAsync(
            scope, IsOrganisationAdmin ? null : currentUser.UserId, cancellationToken);

        var canAttribution = Can(PermissionCodes.AttributionView);
        var canAssets = Can(PermissionCodes.TrackingAssetsView);
        var attribution = canAttribution || canAssets
            ? await dashboard.GetAttributionAsync(tenantId, scope, cancellationToken)
            : null;

        var currencyIds = stageRows.Values.SelectMany(rows => rows).Concat(calendar)
            .Select(row => row.CurrencyId)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToList();
        var currencies = await financial.GetCurrencyCodesAsync(currencyIds, cancellationToken);

        var response = new DashboardResponse(
            Module,
            now,
            zone.Id,
            scope.IsOwnRecordsOnly ? "Campaigns you own" : "Your whole organisation",
            Headlines(statistics, counts, attribution),
            Counters(counts, calendar, today),
            Attention(statistics, counts, stageRows),
            Can(Wizard.Permission)
                ? [new("cam.new-campaign", Ranks.NewCampaign, "New campaign", "ri-megaphone-line", Wizard.Route, false)]
                : [],
            new DashboardPanelsResponse(
                Health: Health(statistics, counts, attribution),
                Agenda: Calendar(calendar, today, zone),
                Pipeline: Pipeline(statistics, stageRows, today, currencies),
                Sources: canAttribution ? Sources(attribution!) : null,
                Funnel: canAssets ? AssetFunnel(counts, attribution) : null));

        logger.LogInformation(
            "Campaign dashboard completed. {Attention} attention item(s).", response.Attention.Count);

        return Result.Success(response);
    }

    // =========================================================================================
    // The rail, the counters and Needs Attention
    // =========================================================================================

    private IReadOnlyList<DashboardHeadlineResponse> Headlines(
        CampaignStatisticsResponse statistics, CampaignDashboardCounts counts, DashboardAttributionTotals? attribution)
    {
        var register = RouteOf(Register);
        var stageCounts = Stages.Select(stage => (decimal)CountOf(statistics, stage.Status)).ToList();
        var activeIndex = Stages.ToList().FindIndex(stage => stage.Status == CampaignStatus.Active);

        var headlines = new List<DashboardHeadlineResponse>
        {
            new("cam.live", Ranks.Live, "Campaigns live", "ri-megaphone-line", "warn",
                DashboardFormat.Count(statistics.Active),
                statistics.Total == 0
                    ? "No campaigns created yet"
                    : statistics.Active > 0
                        ? $"out of {DashboardFormat.Count(statistics.Total)} in total"
                        : $"none live · {DashboardFormat.Count(statistics.Total)} in the pipeline",
                DashboardFormat.Share(statistics.Active, statistics.Total) ?? 0m,
                $"{DashboardFormat.Count(statistics.Draft)} draft · {DashboardFormat.Count(statistics.Scheduled)} scheduled",
                register,
                new DashboardSparkResponse("stages", stageCounts, activeIndex))
        };

        // THE FOURTH CARD FOLLOWS THE HALF THE CALLER WORKS IN. A Manager's is what waits for
        // their decision; an Executive's is what they are still preparing.
        var decides = CanAny(PermissionCodes.CampaignsApprove, PermissionCodes.CampaignsApproveClose,
            PermissionCodes.TrackingAssetsApprove, PermissionCodes.TrackingAssetsDeactivate);

        if (decides)
        {
            var campaignsWaiting = (Can(PermissionCodes.CampaignsApprove) ? statistics.Submitted : 0)
                                   + (Can(PermissionCodes.CampaignsApproveClose) ? counts.ClosureRequestsPending : 0);
            var assetsWaiting = (Can(PermissionCodes.TrackingAssetsApprove) ? counts.AssetsSubmitted : 0)
                                + (Can(PermissionCodes.TrackingAssetsDeactivate) ? counts.AssetsDisableRequested : 0);

            headlines.Add(new("cam.decisions", Ranks.Pipeline, "Awaiting your decision", "ri-checkbox-multiple-line", "brand",
                DashboardFormat.Count(campaignsWaiting + assetsWaiting),
                $"{DashboardFormat.Counted(campaignsWaiting, "campaign", "campaigns")} · {DashboardFormat.Counted(assetsWaiting, "asset", "assets")}",
                DashboardFormat.Share(counts.ChecksPassed, counts.ChecksTotal) ?? 0m,
                counts.ChecksTotal == 0
                    ? "No readiness checks open"
                    : $"{DashboardFormat.Share(counts.ChecksPassed, counts.ChecksTotal):0}% of readiness checks passed",
                register,
                null));
        }
        else if (Can(PermissionCodes.CampaignsSubmit))
        {
            headlines.Add(new("cam.preparing", Ranks.Pipeline, "In preparation", "ri-draft-line", "brand",
                DashboardFormat.Count(statistics.Draft + statistics.Submitted),
                $"{DashboardFormat.Count(statistics.Draft)} draft · {DashboardFormat.Count(statistics.Submitted)} submitted",
                DashboardFormat.Share(counts.ChecksPassed, counts.ChecksTotal) ?? 0m,
                counts.ChecksTotal == 0
                    ? "No readiness checks open"
                    : $"{DashboardFormat.Share(counts.ChecksPassed, counts.ChecksTotal):0}% of readiness checks passed",
                register,
                null));
        }

        if (Can(PermissionCodes.TrackingAssetsView))
        {
            headlines.Add(new("cam.assets", Ranks.AssetsLive, "Tracking assets live", "ri-qr-code-line", "ok",
                DashboardFormat.Count(counts.AssetsActive),
                $"of {DashboardFormat.Counted(counts.AssetsTotal, "asset", "assets")} created",
                DashboardFormat.Share(counts.AssetsActive, counts.AssetsTotal) ?? 0m,
                $"{DashboardFormat.Count(attribution?.AssetsWithGifts ?? 0)} brought a gift",
                RouteOf(AssetManager),
                null));
        }

        if (attribution is not null && Can(PermissionCodes.AttributionView))
        {
            var traced = DashboardFormat.Share(attribution.TracedAmount, attribution.TotalAmount);

            headlines.Add(new("cam.traced", Ranks.Traced, "Gifts traced", "ri-radar-line", "wait",
                traced is { } share ? $"{share:0}%" : "—",
                $"{DashboardFormat.Count(attribution.TracedCount)} of {DashboardFormat.Counted(attribution.TotalCount, "gift", "gifts")}",
                traced ?? 0m,
                "source known",
                RouteOf(AssetManager),
                null));
        }

        return headlines;
    }

    private IReadOnlyList<DashboardCounterResponse> Counters(
        CampaignDashboardCounts counts, IReadOnlyList<DashboardCampaignRow> calendar, DateOnly today)
    {
        var counters = new List<DashboardCounterResponse>();

        if (Can(PermissionCodes.TrackingAssetsView))
        {
            counters.Add(new("cam.assets-live", Ranks.CounterAssetsLive, "Tracking assets live", "ri-qr-code-line",
                counts.AssetsActive, RouteOf(AssetManager)));
        }

        if (Can(PermissionCodes.ReadinessView))
        {
            counters.Add(new("cam.checks-open", Ranks.CounterChecksOpen, "Readiness checks open", "ri-list-check-3",
                counts.ChecksPending, RouteOf(Register)));
        }

        counters.Add(new("cam.ending-soon", Ranks.CounterEndingSoon, $"Ending in {CalendarDays} days", "ri-hourglass-line",
            calendar.Count(row => IsRunning(row.Status) && row.EndDate >= today), RouteOf(Register)));

        if (CanAny(PermissionCodes.CampaignsApproveClose, PermissionCodes.CampaignsRequestClose))
        {
            counters.Add(new("cam.closures", Ranks.CounterClosures, "Closure requests", "ri-door-closed-line",
                counts.ClosureRequestsPending, RouteOf(Register)));
        }

        return counters;
    }

    private IReadOnlyList<DashboardAttentionItemResponse> Attention(
        CampaignStatisticsResponse statistics,
        CampaignDashboardCounts counts,
        IReadOnlyDictionary<CampaignStatus, IReadOnlyList<DashboardCampaignRow>> stageRows)
    {
        var items = new List<DashboardAttentionItemResponse>();
        var assets = RouteOf(AssetManager);

        string? FirstCode(CampaignStatus status) =>
            stageRows.TryGetValue(status, out var rows) && rows.Count > 0 ? rows[0].Code : null;

        // ---- The Manager's half: decisions ----------------------------------------------------
        if (Can(PermissionCodes.CampaignsApprove))
        {
            items.Add(CampaignItem("cam.awaiting-approval", 10, "Campaigns awaiting approval",
                "Submitted and not yet approved", statistics.Submitted, "ri-file-list-3-line",
                FirstCode(CampaignStatus.Submitted)));
        }

        if (Can(PermissionCodes.CampaignsApproveClose))
        {
            items.Add(CampaignItem("cam.closure-requests", 15, "Closure requests to decide",
                "Asked to close and not yet decided", counts.ClosureRequestsPending, "ri-door-closed-line",
                counts.NextClosureCampaignCode));
        }

        if (Can(PermissionCodes.TrackingAssetsApprove))
        {
            items.Add(new("cam.assets-awaiting", 20, "Tracking assets awaiting approval",
                "Submitted and not yet approved", counts.AssetsSubmitted, "ri-qr-code-line", assets));
        }

        if (Can(PermissionCodes.TrackingAssetsDeactivate))
        {
            items.Add(new("cam.assets-takedown", 25, "Tracking assets to take down",
                "Asked to be disabled", counts.AssetsDisableRequested, "ri-forbid-line", assets));
        }

        if (Can(PermissionCodes.CampaignsResume))
        {
            items.Add(CampaignItem("cam.paused", 30, "Paused campaigns",
                "Not collecting until resumed", statistics.Paused, "ri-pause-circle-line",
                FirstCode(CampaignStatus.Paused)));
        }

        if (Can(PermissionCodes.ReadinessResolveBlockers))
        {
            items.Add(ReadinessItem("cam.blockers", 35, "Readiness blockers to resolve",
                "Holding a launch back", counts.BlockersOpen, "ri-error-warning-line", counts.NextBlockerCampaignCode));
        }

        // ---- The Executive's half: preparation ---------------------------------------------
        //
        // THE ROUTINE QUEUES ARE NOT THE ORGANISATION ADMIN'S. They hold every permission, so they
        // would be shown every draft and every pending check in the Organisation - the Executives'
        // day-to-day work - above the decisions and exceptions that are actually theirs. Failed
        // checks stay: a failure holds a launch back, which is an exception worth an admin's eye.
        var routine = !IsOrganisationAdmin;

        if (routine && CanAny(PermissionCodes.ReadinessPass, PermissionCodes.ReadinessFail))
        {
            items.Add(ReadinessItem("cam.checks-to-complete", 40, "Readiness checks to complete",
                "Pass or fail them before launch", counts.ChecksPendingForCaller, "ri-list-check-3",
                counts.NextCheckCampaignCode));
        }

        if (Can(PermissionCodes.ReadinessEdit))
        {
            items.Add(ReadinessItem("cam.checks-failed", 45, "Failed readiness checks",
                "Put them right or the launch waits", counts.ChecksFailed, "ri-close-circle-line",
                counts.NextFailedCampaignCode));
        }

        if (routine && Can(PermissionCodes.CampaignsSubmit))
        {
            items.Add(CampaignItem("cam.drafts", 50, "Campaign drafts to submit",
                "Prepared and not yet sent for approval", statistics.Draft, "ri-draft-line",
                FirstCode(CampaignStatus.Draft)));
        }

        if (routine && Can(PermissionCodes.TrackingAssetsSubmit))
        {
            items.Add(new("cam.asset-drafts", 55, "Tracking asset drafts",
                "Created and not yet submitted", counts.AssetsDraft, "ri-qr-scan-2-line", assets));
        }

        return [.. items.Where(item => item.Count > 0)];
    }

    /// <summary>
    /// A row about campaigns: one campaign opens its detail page (where pause, resume and close
    /// live), several open the register.
    /// </summary>
    private DashboardAttentionItemResponse CampaignItem(
        string key, int rank, string label, string hint, int count, string icon, string? firstCode) =>
        count == 1 && firstCode is not null && Can(Detail.Permission)
            ? new(key, rank, label, hint, count, icon, Detail.Route, new Dictionary<string, string> { ["ref"] = firstCode })
            : new(key, rank, label, hint, count, icon, RouteOf(Register));

    /// <summary>A row about readiness opens the checklist of the soonest campaign it concerns.</summary>
    private DashboardAttentionItemResponse ReadinessItem(
        string key, int rank, string label, string hint, int count, string icon, string? campaignCode) =>
        campaignCode is not null && Can(Readiness.Permission)
            ? new(key, rank, label, hint, count, icon, Readiness.Route, new Dictionary<string, string> { ["ref"] = campaignCode })
            : new(key, rank, label, hint, count, icon, RouteOf(Register));

    // =========================================================================================
    // The tiles
    // =========================================================================================

    private DashboardPipelinePanelResponse Pipeline(
        CampaignStatisticsResponse statistics,
        IReadOnlyDictionary<CampaignStatus, IReadOnlyList<DashboardCampaignRow>> stageRows,
        DateOnly today,
        IReadOnlyDictionary<Guid, string> currencies) =>
        new(
            Ranks.PipelinePanel,
            "Campaigns",
            $"{DashboardFormat.Count(statistics.Active)} live now",
            $"{DashboardFormat.Count(statistics.Total)} in total",
            "active",
            [
                .. Stages.Select(stage => new DashboardPipelineStageResponse(
                    stage.Key,
                    stage.Label,
                    CountOf(statistics, stage.Status),
                    $"No {stage.Label.ToLowerInvariant()} campaigns",
                    [.. stageRows[stage.Status].Select(row => PipelineRow(row, stage.Label, today, currencies))]))
            ],
            "Nothing is at this stage right now.",
            Link("New campaign", Wizard),
            Link("Open the campaign register", Register),
            statistics.Cancelled > 0 ? $"{DashboardFormat.Count(statistics.Cancelled)} cancelled" : null);

    private DashboardPipelineRowResponse PipelineRow(
        DashboardCampaignRow row, string stageLabel, DateOnly today, IReadOnlyDictionary<Guid, string> currencies)
    {
        var elapsed = ElapsedPercent(row, today);
        var (when, urgent) = Timing(row, today);

        var meta = new List<DashboardMetaResponse> { new("ri-hashtag", row.Code) };

        if (row.TargetAmount > 0m)
        {
            meta.Add(new("ri-focus-3-line", "goal", Amount: row.TargetAmount,
                CurrencyCode: currencies.TryGetValue(row.CurrencyId, out var code) ? code : null));
        }

        meta.Add(new("ri-time-line", when, urgent));

        var detail = Can(Detail.Permission);

        return new DashboardPipelineRowResponse(
            row.Id.ToString(),
            row.Code,
            row.Name,
            $"{stageLabel} · {row.FundOrProgramme}",
            $"{row.Code} · {row.FundOrProgramme}",
            elapsed,
            meta,
            elapsed ?? 0m,
            when,
            urgent,
            detail ? Detail.Route : null,
            detail ? new Dictionary<string, string> { ["ref"] = row.Code } : null);
    }

    private DashboardAgendaPanelResponse Calendar(
        IReadOnlyList<DashboardCampaignRow> calendar, DateOnly today, TimeZoneInfo zone)
    {
        var entries = calendar
            .Select(row => (Row: row, Starts: !IsRunning(row.Status), Day: IsRunning(row.Status) ? row.EndDate : row.StartDate))
            .OrderBy(entry => entry.Day)
            .ThenBy(entry => entry.Row.Code, StringComparer.Ordinal)
            .ToList();

        var detail = Can(Detail.Permission);
        var starting = entries.Count(entry => entry.Starts);
        var overdue = entries.Count(entry => !entry.Starts && entry.Day < today);

        return new DashboardAgendaPanelResponse(
            Ranks.CalendarPanel,
            "Campaign calendar",
            [
                .. entries.Take(CalendarRows).Select(entry => new DashboardAgendaItemResponse(
                    entry.Row.Id.ToString(),
                    DashboardFormat.StartOfDayUtc(entry.Day, zone),
                    entry.Row.Name,
                    $"{(entry.Starts ? "Starts" : "Ends")} · {entry.Row.Code}",
                    DashboardFormat.DueLabel(entry.Day, today),
                    !entry.Starts && entry.Day < today,
                    detail ? Detail.Route : null,
                    detail ? new Dictionary<string, string> { ["ref"] = entry.Row.Code } : null))
            ],
            [
                new("starting soon", starting, "count", Route: RouteOf(Register)),
                new("ending soon", entries.Count - starting, "count", IsAlert: overdue > 0, Route: RouteOf(Register))
            ],
            Link("Open the campaign register", Register),
            new DashboardEmptyStateResponse(
                $"Nothing in the next {CalendarDays} days",
                "Campaign starts and ends appear here as they come up.",
                Link("New campaign", Wizard)));
    }

    private DashboardSharePanelResponse Sources(DashboardAttributionTotals attribution)
    {
        var assets = RouteOf(AssetManager);
        var untracedAmount = attribution.TotalAmount - attribution.TracedAmount;

        return new DashboardSharePanelResponse(
            Ranks.SourcesPanel,
            "Gift sources",
            "money",
            attribution.CurrencyCode,
            "gifts",
            DashboardFormat.ShareOf(attribution.TracedAmount, attribution.TotalAmount),
            "Traced to a source",
            "leads the way",
            [
                .. attribution.Channels.Take(4).Select(channel => new DashboardShareItemResponse(
                    channel.Code,
                    // A gift can name a tracking asset CAM no longer holds; it is still traced, to a
                    // channel nobody can now say - "Unspecified", the attribution summary's word.
                    string.IsNullOrWhiteSpace(channel.Name) ? "Unspecified" : channel.Name,
                    DashboardFormat.ShareOf(channel.Amount, attribution.TotalAmount),
                    channel.Count,
                    channel.Amount,
                    ChannelIcon(channel.Code),
                    assets))
            ],
            untracedAmount > 0m
                ? new DashboardShareItemResponse(
                    "untraced",
                    "Not traced",
                    DashboardFormat.ShareOf(untracedAmount, attribution.TotalAmount),
                    attribution.TotalCount - attribution.TracedCount,
                    untracedAmount,
                    "ri-question-line",
                    assets)
                : null,
            "add links",
            Link("Tracking links", AssetManager),
            new DashboardEmptyStateResponse(
                "No traced gifts yet",
                "Create QR codes and tracking links so every gift shows where it came from.",
                Link("Create", AssetManager)));
    }

    private DashboardFunnelPanelResponse AssetFunnel(
        CampaignDashboardCounts counts, DashboardAttributionTotals? attribution)
    {
        var assets = RouteOf(AssetManager);
        var withGifts = attribution?.AssetsWithGifts ?? 0;

        DashboardFunnelAlertResponse alert =
            Can(PermissionCodes.TrackingAssetsApprove) && counts.AssetsSubmitted > 0
                ? new($"{DashboardFormat.Counted(counts.AssetsSubmitted, "asset", "assets")} awaiting approval", "Review now", assets, false)
                : Can(PermissionCodes.TrackingAssetsSubmit) && counts.AssetsDraft > 0
                    ? new($"{DashboardFormat.Counted(counts.AssetsDraft, "draft", "drafts")} to submit", "Open assets", assets, false)
                    : new("Nothing waiting on an asset", "Open assets", assets, true);

        return new DashboardFunnelPanelResponse(
            Ranks.AssetFunnelPanel,
            "Tracking assets",
            DashboardFormat.ShareOf(withGifts, counts.AssetsTotal),
            "Assets that brought a gift",
            $"{DashboardFormat.Count(withGifts)} of {DashboardFormat.Counted(counts.AssetsTotal, "tracking asset", "tracking assets")} brought a gift",
            [
                new("Created", counts.AssetsTotal, counts.AssetsTotal > 0 ? 100m : 0m, "brand", assets),
                new("Approved", counts.AssetsApproved, DashboardFormat.ShareOf(counts.AssetsApproved, counts.AssetsTotal), "wait", assets),
                new("Live now", counts.AssetsActive, DashboardFormat.ShareOf(counts.AssetsActive, counts.AssetsTotal), "warn", assets),
                new("Brought a gift", withGifts, DashboardFormat.ShareOf(withGifts, counts.AssetsTotal), "ok", assets)
            ],
            alert,
            Link("Assets", AssetManager));
    }

    /// <summary>
    /// The campaigns as a donut, for a caller who cannot read donations - PAY's Donation health
    /// outranks it for everybody who can.
    /// </summary>
    private DashboardHealthPanelResponse Health(
        CampaignStatisticsResponse statistics, CampaignDashboardCounts counts, DashboardAttributionTotals? attribution)
    {
        var register = RouteOf(Register);
        var assets = RouteOf(AssetManager);
        var live = DashboardFormat.Share(statistics.Active, statistics.Total);

        return new DashboardHealthPanelResponse(
            Ranks.HealthPanel,
            "Campaign health",
            Link("Register", Register),
            [
                new("live", "Live", statistics.Active, "ok", register),
                new("preparing", "In preparation",
                    statistics.Draft + statistics.Submitted + statistics.Approved + statistics.Scheduled, "wait", register),
                new("held", "Paused or closing", statistics.Paused + statistics.Closing, "warn", register),
                new("ended", "Closed or cancelled", statistics.Closed + statistics.Cancelled, "bad", register)
            ],
            live,
            statistics.Total == 0 ? "no campaigns yet" : "live",
            [
                new("readiness", "Readiness", "checks passed",
                    DashboardFormat.Share(counts.ChecksPassed, counts.ChecksTotal), "ok", register),
                new("assets", "Assets live", "tracking assets",
                    DashboardFormat.Share(counts.AssetsActive, counts.AssetsTotal), "wait", assets),
                new("traced", "Traced", "source known",
                    attribution is null ? null : DashboardFormat.Share(attribution.TracedAmount, attribution.TotalAmount),
                    "warn", assets)
            ]);
    }

    // =========================================================================================
    // Small rules
    // =========================================================================================

    private static bool IsRunning(CampaignStatus status) =>
        status is CampaignStatus.Active or CampaignStatus.Paused or CampaignStatus.Closing;

    /// <summary>How the row words its dates for the stage it is at - and whether that is urgent.</summary>
    private static (string When, bool Urgent) Timing(DashboardCampaignRow row, DateOnly today)
    {
        if (row.Status is CampaignStatus.Closed or CampaignStatus.Cancelled)
        {
            return (DashboardFormat.EndedLabel(row.EndDate), false);
        }

        if (!IsRunning(row.Status))
        {
            return (DashboardFormat.StartsLabel(row.StartDate, today), false);
        }

        // Running: a fortnight or less to go, or already past the end date, is worth a colour.
        return (DashboardFormat.EndsLabel(row.EndDate, today), row.EndDate.DayNumber - today.DayNumber <= 14);
    }

    /// <summary>
    /// How far through its own dates the campaign is - the register's rule: nothing before it
    /// starts, 100 from its end date, and a same-day campaign is fully elapsed on its day.
    /// </summary>
    private static decimal? ElapsedPercent(DashboardCampaignRow row, DateOnly today)
    {
        if (today < row.StartDate)
        {
            return null;
        }

        if (today >= row.EndDate)
        {
            return 100m;
        }

        var span = row.EndDate.DayNumber - row.StartDate.DayNumber;
        return span <= 0 ? 100m : Math.Round((today.DayNumber - row.StartDate.DayNumber) * 100m / span);
    }

    private static int CountOf(CampaignStatisticsResponse statistics, CampaignStatus status) => status switch
    {
        CampaignStatus.Draft => statistics.Draft,
        CampaignStatus.Submitted => statistics.Submitted,
        CampaignStatus.Approved => statistics.Approved,
        CampaignStatus.Scheduled => statistics.Scheduled,
        CampaignStatus.Active => statistics.Active,
        CampaignStatus.Paused => statistics.Paused,
        CampaignStatus.Closing => statistics.Closing,
        CampaignStatus.Closed => statistics.Closed,
        CampaignStatus.Cancelled => statistics.Cancelled,
        _ => 0
    };

    /// <summary>
    /// The Organisation Admin: the flag the founding administrator carries, or the role anybody
    /// later given it holds - the flag alone misses the second kind.
    /// </summary>
    private bool IsOrganisationAdmin =>
        currentUser.IsTenantAdmin
        || currentUser.Roles.Contains(RoleCodes.TenantAdmin, StringComparer.OrdinalIgnoreCase);

    private bool Can(string permission) => currentUser.HasPermission(permission);

    private bool CanAny(params string[] permissions) => currentUser.HasAnyPermission(permissions);

    private string? RouteOf(Screen screen) => Can(screen.Permission) ? screen.Route : null;

    private DashboardLinkResponse? Link(string label, Screen screen) =>
        Can(screen.Permission) ? new DashboardLinkResponse(label, screen.Route) : null;
}
