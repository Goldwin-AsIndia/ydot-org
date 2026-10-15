using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.PAY.Application.Common.Abstractions.Persistence;
using YDot.PAY.Application.Common.Abstractions.Security;
using YDot.PAY.Application.Common.Abstractions.Services;
using YDot.PAY.Application.Common.Constants;
using YDot.PAY.Application.Common.Formatting;
using YDot.PAY.Application.Common.Models;
using YDot.PAY.Application.Common.Results;
using YDot.PAY.Application.Common.Settings;
using YDot.PAY.Application.Features.Dashboard.DTOs;
using YDot.PAY.Application.Features.Donations.DTOs;
using YDot.PAY.Application.Features.Payments.DTOs;
using YDot.PAY.Application.Features.Receipts.DTOs;
using YDot.PAY.Application.Features.Refunds.DTOs;
using YDot.PAY.Application.Features.Shared.Mappings;
using YDot.PAY.Domain.Enums;
using static YDot.PAY.Application.Features.Dashboard.PaymentDashboardCatalogue;

namespace YDot.PAY.Application.Features.Dashboard.Queries;

/// <summary>PAY's part of the landing page, for whoever is asking.</summary>
public sealed record GetPaymentDashboardQuery(DashboardFilter Filter);

/// <summary>
/// The money on the landing page: what came in, how it stands, where it came from and who gave
/// it - or, for a donor, their own giving and the payments they have still to finish.
///
/// TWO PAGES FROM ONE ENDPOINT, chosen by WHOSE RECORDS THE CALLER MAY READ rather than by role
/// name. A member of staff holding <c>pay.donations.view</c> gets the Organisation's figures (or
/// their own, under a narrowing data scope); a donor - whose scope is their own giving - gets
/// theirs, worded to them. A caller with no donation access gets nothing here and the page fills
/// those tiles from the modules they can read.
///
/// EVERY FIGURE IS EXACT. The curve, the campaign ranking and the supporters used to be drawn in
/// the browser from the newest hundred gifts; they are grouped here over every gift in the
/// window, and the shares come from the database's own counts.
///
/// THE WORK QUEUES ARE ONLY COUNTED FOR SOMEBODY WHO WORKS THEM. Receipts to issue, failed
/// payments, refunds and chargebacks each appear in Needs Attention only for a caller holding the
/// permission that acts on them, and are not queried at all otherwise.
/// </summary>
public sealed class PaymentDashboardQueryHandler(
    IPaymentDashboardReadService dashboard,
    IDonationReadService donations,
    IReceiptReadService receipts,
    IRefundReadService refunds,
    IPaymentEventReadService events,
    ICampaignDirectory campaigns,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<PaymentSettings> paymentOptions,
    ILogger<PaymentDashboardQueryHandler> logger)
{
    /// <summary>Rows a donor's "payments to finish" list shows.</summary>
    private const int AgendaRows = 6;

    /// <summary>The moment, the zone and the caller, worked out once per request.</summary>
    private sealed record View(
        Guid TenantId,
        AccessScope Scope,
        TimeZoneInfo Zone,
        DateTimeOffset Now,
        DateOnly Today,
        bool CanSeeSensitiveDonor);

    public async Task<Result<DashboardResponse>> HandleAsync(
        GetPaymentDashboardQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var zone = DashboardFormat.ResolveZone(query.Filter.TimeZone, paymentOptions.Value.DisplayTimeZone);
        var now = clock.UtcNow;

        // No shortcut outside an Organisation: the Platform Admin passes every permission check,
        // and a donation started with no Organisation behind it belongs to nobody.
        var actions = tenantContext.TenantId is null ? [] : Actions();

        // NO ORGANISATION, OR NO DONATION ACCESS: NOTHING TO SAY, AND NOT A REFUSAL. The Platform
        // Admin outside an Organisation and a Fundraiser who never touches money both land on the
        // same page; an empty answer lets it fill these tiles from what they can read.
        if (tenantContext.TenantId is not Guid tenantId
            || !currentUser.HasPermission(PermissionCodes.DonationsView))
        {
            logger.LogInformation("Payment dashboard has nothing for this caller.");
            return Result.Success(Empty(zone, now, actions));
        }

        var view = new View(
            tenantId,
            currentUser.Scope,
            zone,
            now,
            DashboardFormat.LocalDate(now, zone),
            currentUser.HasPermission(PermissionCodes.DonationsViewSensitiveDonor));

        logger.LogInformation(
            "Payment dashboard requested. Donor view: {IsDonor}.", view.Scope.IsDonorSelfService);

        var response = view.Scope.IsDonorSelfService
            ? await DonorAsync(view, actions, cancellationToken)
            : await StaffAsync(view, actions, cancellationToken);

        logger.LogInformation(
            "Payment dashboard completed. {Headlines} headline(s), {Attention} attention item(s).",
            response.Headlines.Count,
            response.Attention.Count);

        return Result.Success(response);
    }

    // =========================================================================================
    // Staff: the Organisation's money
    // =========================================================================================

    private async Task<DashboardResponse> StaffAsync(
        View view, IReadOnlyList<DashboardActionResponse> actions, CancellationToken cancellationToken)
    {
        var statistics = await donations.GetStatisticsAsync(view.Scope, cancellationToken);
        var currency = statistics.TotalAmount.CurrencyCode;
        var totals = await dashboard.GetTotalsAsync(view.Scope, currency, cancellationToken);

        var firstDay = view.Today.AddDays(-(WindowDays - 1));
        var rows = await dashboard.GetDonationRowsAsync(
            view.Scope, DashboardFormat.StartOfDayUtc(firstDay, view.Zone), MaximumWindowRows, cancellationToken);
        var isPartial = rows.Count >= MaximumWindowRows;

        var latest = await donations.SearchAsync(
            new DonationSearchFilter { Page = 1, PageSize = FeedRows },
            view.Scope,
            view.CanSeeSensitiveDonor,
            cancellationToken);

        var names = await CampaignNamesAsync(view.TenantId, rows.Select(row => row.CampaignId), cancellationToken);

        // The work queues, each read only for somebody who may see it.
        int? receiptsIssued = Can(PermissionCodes.ReceiptsView)
            ? (await receipts.ListNewestIssuedAsync(
                new ReceiptRegisterFilter { Status = "Success" }, 0, view.Scope, view.CanSeeSensitiveDonor, cancellationToken)).TotalCount
            : null;

        int? openRefunds = Can(PermissionCodes.RefundsView)
            ? await CountRefundsAsync(new RefundSearchFilter { OpenOnly = true }, view, cancellationToken)
            : null;

        int? refundsAwaitingDecision = CanAny(PermissionCodes.RefundsApprove, PermissionCodes.RefundsReject)
            ? await CountRefundsAsync(new RefundSearchFilter { Status = RefundStatus.Requested }, view, cancellationToken)
            : null;

        int? openChargebacks = Can(PermissionCodes.ChargebacksView)
            ? await CountChargebacksAsync(new ChargebackSearchFilter { OpenOnly = true }, view, cancellationToken)
            : null;

        int? overdueChargebacks = Can(PermissionCodes.ChargebacksSubmitEvidence)
            ? await CountChargebacksAsync(new ChargebackSearchFilter { OverdueOnly = true }, view, cancellationToken)
            : null;

        int? failedPayments = Can(PermissionCodes.PaymentsViewEvents)
                              && CanAny(PermissionCodes.PaymentsSafeRetry, PermissionCodes.IntentsResendLink)
            ? (await events.ListNewestAsync(EventFilter(PaymentOutcomeFilter.Fail), 0, cancellationToken)).TotalCount
            : null;

        // ---- The fortnight, one point a day -------------------------------------------------
        var inCurrency = rows.Where(row => row.CurrencyCode == currency).ToList();
        var points = DailyPoints(rows, currency, firstDay, view);
        var windowTotal = inCurrency.Sum(row => row.Amount);
        var windowAverage = inCurrency.Count > 0 ? windowTotal / inCurrency.Count : 0m;
        var windowLargest = inCurrency.Count > 0 ? inCurrency.Max(row => row.Amount) : 0m;

        var settledShare = DashboardFormat.Share(statistics.SettledCount, statistics.TotalCount);
        var receiptedShare = DashboardFormat.Share(totals.ReceiptedCount, totals.ReceiptableCount);
        var tracedShare = DashboardFormat.Share(totals.TracedAmount, totals.TotalAmount);
        var payments = RouteOf(PaymentsAndReceipts);

        var headlines = new List<DashboardHeadlineResponse>
        {
            new("pay.funds", Ranks.Funds, "Funds received", "ri-wallet-3-line", "ok",
                Headline(statistics.NetAmount),
                statistics.TotalCount == 0 ? "Nothing received yet" : $"after {Headline(statistics.TotalRefunded)} refunded",
                settledShare ?? 0m,
                settledShare is { } settled ? $"{settled:0}% of gifts settled" : "Waiting for the first gift",
                payments,
                new DashboardSparkResponse("line", [.. points.Select(point => point.Value)])),

            new("pay.gifts", Ranks.Gifts, "Gifts received", "ri-heart-3-line", "wait",
                DashboardFormat.Count(statistics.TotalCount),
                totals.SupporterCount == 0
                    ? "No supporters on record yet"
                    : $"from {DashboardFormat.Counted(totals.SupporterCount, "supporter", "supporters")}",
                receiptedShare ?? 0m,
                receiptedShare is { } receipted ? $"{receipted:0}% receipted" : "No receipts issued yet",
                payments,
                new DashboardSparkResponse("bars", [.. points.Select(point => (decimal)point.Count)]))
        };

        var counters = new List<DashboardCounterResponse>();

        if (receiptsIssued is { } issued)
        {
            counters.Add(new("pay.receipts-issued", Ranks.ReceiptsIssued, "Receipts issued", "ri-receipt-line", issued, payments));
        }

        if (openRefunds is { } refundCount)
        {
            counters.Add(new("pay.open-refunds", Ranks.OpenRefunds, "Open refunds", "ri-refund-2-line", refundCount, null));
        }

        if (openChargebacks is { } chargebackCount)
        {
            counters.Add(new("pay.open-chargebacks", Ranks.OpenChargebacks, "Open chargebacks", "ri-alarm-warning-line", chargebackCount, null));
        }

        var attention = new List<DashboardAttentionItemResponse>();

        if (Can(PermissionCodes.ReceiptsIssue))
        {
            attention.Add(new("pay.receipts-to-issue", 10, "Receipts to issue",
                "Donations received without a receipt", statistics.AwaitingReceiptCount, "ri-receipt-line", payments));
        }

        if (failedPayments is { } failed)
        {
            attention.Add(new("pay.failed-payments", 20, "Failed payments to follow up",
                "Retry them or resend the payment link", failed, "ri-flashlight-line", payments));
        }

        // The three below are real figures with no working screen to settle them in - the Finance
        // screens are switched off - so they are reported without a link.
        if (Can(PermissionCodes.DonationsReconcile))
        {
            attention.Add(new("pay.unreconciled", 30, "Not yet reconciled",
                "Donations not matched to a settlement", statistics.UnreconciledCount, "ri-scales-3-line", null));
        }

        if (refundsAwaitingDecision is { } awaitingDecision)
        {
            attention.Add(new("pay.refunds-awaiting", 40, "Refund requests awaiting a decision",
                "Requested and not yet decided", awaitingDecision, "ri-refund-2-line", null));
        }

        if (overdueChargebacks is { } overdue)
        {
            attention.Add(new("pay.chargebacks-overdue", 50, "Chargebacks past evidence deadline",
                "Respond before the dispute is lost", overdue, "ri-alarm-warning-line", null));
        }

        if (openChargebacks is { } open && CanAny(PermissionCodes.ChargebacksSubmitEvidence, PermissionCodes.ChargebacksResolve))
        {
            attention.Add(new("pay.chargebacks-open", 60, "Open chargebacks",
                "Disputed by the donor's bank", open, "ri-error-warning-line", null));
        }

        // ---- The tiles ------------------------------------------------------------------------
        var trend = new DashboardTrendPanelResponse(
            Ranks.StaffPanel,
            "Giving",
            isPartial
                ? $"Last {WindowDays} days · newest {DashboardFormat.Count(rows.Count)} gifts"
                : $"Last {WindowDays} days",
            "money",
            currency,
            "gift",
            "gifts",
            points,
            rows.Count == 0
                ? []
                :
                [
                    new("collected", windowTotal, "money"),
                    new("gifts", rows.Count, "count"),
                    new("average", windowAverage, "money")
                ],
            Link("Payments", PaymentsAndReceipts),
            payments,
            new DashboardEmptyStateResponse(
                $"No gifts in the last {WindowDays} days",
                "The giving curve draws itself as donations are recorded.",
                Link("New donation", NewDonation)));

        var health = new DashboardHealthPanelResponse(
            Ranks.StaffPanel,
            "Donation health",
            Link("Queue", PaymentsAndReceipts),
            Slices(statistics, payments),
            settledShare,
            statistics.TotalCount == 0 ? "no gifts yet" : "settled",
            [
                new("settled", "Settled", "money confirmed", settledShare, "ok", payments),
                new("receipted", "Receipted", "receipts issued", receiptedShare, "wait", payments),
                new("traced", "Traced", "source known", tracedShare, "warn", RouteOf(TrackingAssetManager))
            ]);

        var register = RouteOf(CampaignRegister);
        var ranking = new DashboardRankingPanelResponse(
            Ranks.StaffPanel,
            "Top campaigns",
            $"Last {WindowDays} days",
            "money",
            currency,
            "gift",
            "gifts",
            [
                .. inCurrency
                    .GroupBy(row => row.CampaignId)
                    .Select(group => new { group.Key, Amount = group.Sum(row => row.Amount), Count = group.Count() })
                    .OrderByDescending(entry => entry.Amount)
                    .Take(5)
                    .Select(entry => new DashboardRankingItemResponse(
                        entry.Key?.ToString() ?? "general",
                        NameOf(names, entry.Key),
                        entry.Amount,
                        entry.Count,
                        DashboardFormat.ShareOf(entry.Amount, windowTotal),
                        register))
            ],
            [],
            null,
            Link("Compare in the register", CampaignRegister),
            new DashboardEmptyStateResponse("No ranking yet", "Campaigns appear here once gifts arrive."));

        var supportersInWindow = inCurrency.Select(row => row.DonorKey).Distinct(StringComparer.Ordinal).Count();
        var donorList = RouteOf(DonorList);
        var leaders = new DashboardRankingPanelResponse(
            Ranks.StaffPanel,
            "Top supporters",
            $"Last {WindowDays} days",
            "money",
            currency,
            "gift",
            "gifts",
            [
                .. inCurrency
                    .GroupBy(row => row.DonorKey, StringComparer.Ordinal)
                    .Select(group => new
                    {
                        group.Key,
                        Name = group.OrderByDescending(row => row.DonatedAtUtc).First().DonorName,
                        Amount = group.Sum(row => row.Amount),
                        Count = group.Count()
                    })
                    .OrderByDescending(entry => entry.Amount)
                    .Take(4)
                    .Select(entry => new DashboardRankingItemResponse(
                        entry.Key,
                        string.IsNullOrWhiteSpace(entry.Name) ? Anonymous : entry.Name.Trim(),
                        entry.Amount,
                        entry.Count,
                        DashboardFormat.ShareOf(entry.Amount, windowTotal),
                        donorList))
            ],
            inCurrency.Count == 0
                ? []
                :
                [
                    new("average gift", windowAverage, "money", Route: donorList),
                    new("largest gift", windowLargest, "money",
                        DashboardFormat.Counted(supportersInWindow, "supporter", "supporters"), Route: donorList)
                ],
            Link($"{WindowDays} days", DonorList),
            Link("See all donors", DonorList),
            new DashboardEmptyStateResponse("No supporters yet", "Your most generous donors appear here once gifts arrive."));

        var feed = Feed(Ranks.StaffPanel, "Latest donations", latest.Items, currency, payments,
            Link("Open payments & receipts", PaymentsAndReceipts),
            new DashboardEmptyStateResponse(
                "No donations yet",
                "Gifts from every channel are listed here, newest first.",
                Link("New donation", NewDonation)));

        return new DashboardResponse(
            Module,
            view.Now,
            view.Zone.Id,
            view.Scope.IsOwnRecordsOnly ? "Donations you recorded" : "Your whole organisation",
            headlines,
            counters,
            [.. attention.Where(item => item.Count > 0)],
            actions,
            new DashboardPanelsResponse(
                Trend: trend,
                Health: health,
                Ranking: ranking,
                Leaders: leaders,
                Feed: feed));
    }

    // =========================================================================================
    // Donor: their own giving
    // =========================================================================================

    private async Task<DashboardResponse> DonorAsync(
        View view, IReadOnlyList<DashboardActionResponse> actions, CancellationToken cancellationToken)
    {
        var statistics = await donations.GetStatisticsAsync(view.Scope, cancellationToken);
        var currency = statistics.TotalAmount.CurrencyCode;
        var totals = await dashboard.GetTotalsAsync(view.Scope, currency, cancellationToken);
        var intents = await dashboard.GetIntentCountsAsync(view.Scope, cancellationToken);

        // A donor's whole history - a few gifts a year, so every view of it is exact.
        var rows = await dashboard.GetDonationRowsAsync(view.Scope, null, MaximumDonorRows, cancellationToken);
        var inCurrency = rows.Where(row => row.CurrencyCode == currency).ToList();

        var latest = await donations.SearchAsync(
            new DonationSearchFilter { Page = 1, PageSize = FeedRows },
            view.Scope,
            view.CanSeeSensitiveDonor,
            cancellationToken);

        var receiptsIssued = Can(PermissionCodes.ReceiptsView)
            ? (await receipts.ListNewestIssuedAsync(
                new ReceiptRegisterFilter { Status = "Success" }, 0, view.Scope, view.CanSeeSensitiveDonor, cancellationToken)).TotalCount
            : 0;

        // THE SAME PENDING AND FAILED ROWS THE DONOR'S PAYMENTS & RECEIPTS PAGE SHOWS - the event
        // queue, narrowed to their e-mail - so the two never disagree about what is waiting.
        var canSeeEvents = Can(PermissionCodes.PaymentsViewEvents);
        (IReadOnlyList<PaymentEventListItemResponse> Items, int TotalCount) pending = canSeeEvents
            ? await events.ListNewestAsync(EventFilter(PaymentOutcomeFilter.Pending), AgendaRows, cancellationToken)
            : ([], 0);
        (IReadOnlyList<PaymentEventListItemResponse> Items, int TotalCount) failed = canSeeEvents
            ? await events.ListNewestAsync(EventFilter(PaymentOutcomeFilter.Fail), AgendaRows, cancellationToken)
            : ([], 0);
        var toFinish = pending.TotalCount + failed.TotalCount;

        var open = await campaigns.GetDonatableCampaignsAsync(view.TenantId, cancellationToken);
        var names = await CampaignNamesAsync(view.TenantId, rows.Select(row => row.CampaignId), cancellationToken);

        var payments = RouteOf(PaymentsAndReceipts);
        var settledShare = DashboardFormat.Share(statistics.SettledCount, statistics.TotalCount);
        var receiptedShare = DashboardFormat.Share(totals.ReceiptedCount, totals.ReceiptableCount);
        var completedShare = DashboardFormat.Share(intents.Paid, intents.Started);

        // ---- Twelve months, one point a month -----------------------------------------------
        var firstMonth = new DateOnly(view.Today.Year, view.Today.Month, 1).AddMonths(-(DonorMonths - 1));
        var points = MonthlyPoints(rows, currency, firstMonth, view);
        var inYear = inCurrency.Where(row => DashboardFormat.LocalDate(row.DonatedAtUtc, view.Zone) >= firstMonth).ToList();
        var yearTotal = inYear.Sum(row => row.Amount);
        var allTotal = inCurrency.Sum(row => row.Amount);
        var average = inCurrency.Count > 0 ? allTotal / inCurrency.Count : 0m;
        var largest = inCurrency.Count > 0 ? inCurrency.Max(row => row.Amount) : 0m;

        var financialYear = clock.FinancialYearFor(TimeZoneInfo.ConvertTime(view.Now, view.Zone));
        var giftsThisYear = rows.Count(row =>
            clock.FinancialYearFor(TimeZoneInfo.ConvertTime(row.DonatedAtUtc, view.Zone)) == financialYear);

        var headlines = new List<DashboardHeadlineResponse>
        {
            new("pay.funds", Ranks.Funds, "Your giving", "ri-wallet-3-line", "ok",
                Headline(statistics.NetAmount),
                statistics.TotalCount == 0
                    ? "Nothing given yet"
                    : statistics.TotalRefunded.Amount > 0m
                        ? $"after {Headline(statistics.TotalRefunded)} refunded"
                        : $"across {DashboardFormat.Counted(totals.CampaignCount, "campaign", "campaigns")}",
                settledShare ?? 0m,
                settledShare is { } settled ? $"{settled:0}% of your gifts settled" : "Waiting for your first gift",
                payments,
                new DashboardSparkResponse("line", [.. points.Select(point => point.Value)])),

            new("pay.gifts", Ranks.Gifts, "Your gifts", "ri-heart-3-line", "wait",
                DashboardFormat.Count(statistics.TotalCount),
                statistics.TotalCount == 0
                    ? "No gifts yet"
                    : $"to {DashboardFormat.Counted(totals.CampaignCount, "campaign", "campaigns")}",
                receiptedShare ?? 0m,
                receiptedShare is { } receipted ? $"{receipted:0}% receipted" : "No receipts issued yet",
                payments,
                new DashboardSparkResponse("bars", [.. points.Select(point => (decimal)point.Count)])),

            new("pay.receipts", Ranks.DonorReceipts, "Your receipts", "ri-receipt-line", "warn",
                DashboardFormat.Count(receiptsIssued),
                receiptsIssued == 0 ? "None issued yet" : "for your tax records",
                receiptedShare ?? 0m,
                statistics.AwaitingReceiptCount > 0
                    ? $"{DashboardFormat.Counted(statistics.AwaitingReceiptCount, "gift", "gifts")} awaiting a receipt"
                    : "Every gift receipted",
                payments,
                null),

            new("pay.to-finish", Ranks.DonorToFinish, "Payments to finish", "ri-time-line", "brand",
                DashboardFormat.Count(toFinish),
                toFinish == 0 ? "Nothing waiting" : $"{failed.TotalCount} failed · {pending.TotalCount} pending",
                completedShare ?? 0m,
                completedShare is { } completed ? $"{completed:0}% of payments completed" : "No payments started yet",
                payments,
                null)
        };

        var newDonation = RouteOf(NewDonation);
        var counters = new List<DashboardCounterResponse>
        {
            new("pay.my-receipts", 20, "Receipts", "ri-receipt-line", receiptsIssued, payments),
            new("pay.my-campaigns", 30, "Campaigns supported", "ri-megaphone-line", totals.CampaignCount, null),
            new("pay.my-year", 40, $"Gifts in FY {financialYear}", "ri-calendar-check-line", giftsThisYear, payments),
            new("pay.open-campaigns", 50, "Open for giving", "ri-heart-add-line", open.Count, newDonation)
        };

        var attention = new List<DashboardAttentionItemResponse>();

        if (toFinish > 0 && CanAny(PermissionCodes.IntentsCreate, PermissionCodes.PaymentsSafeRetry))
        {
            attention.Add(new("pay.payments-to-finish", 10, "Payments to finish",
                "Continue or retry them from Payments & Receipts", toFinish, "ri-time-line", payments));
        }

        // ---- The tiles ------------------------------------------------------------------------
        var trend = new DashboardTrendPanelResponse(
            Ranks.DonorPanel,
            "Your giving",
            $"Last {DonorMonths} months",
            "money",
            currency,
            "gift",
            "gifts",
            points,
            inYear.Count == 0
                ? []
                :
                [
                    new("given", yearTotal, "money"),
                    new("gifts", inYear.Count, "count"),
                    new("average", yearTotal / inYear.Count, "money")
                ],
            Link("Payments", PaymentsAndReceipts),
            payments,
            new DashboardEmptyStateResponse(
                $"No gifts in the last {DonorMonths} months",
                "Your giving appears here month by month.",
                Link("Donate", NewDonation)));

        var health = new DashboardHealthPanelResponse(
            Ranks.DonorPanel,
            "Your donations",
            Link("Payments", PaymentsAndReceipts),
            Slices(statistics, payments),
            settledShare,
            statistics.TotalCount == 0 ? "no gifts yet" : "settled",
            [
                new("settled", "Settled", "money confirmed", settledShare, "ok", payments),
                new("receipted", "Receipted", "receipts issued", receiptedShare, "wait", payments),
                new("completed", "Completed", "payments finished", completedShare, "warn", payments)
            ]);

        var openByCampaign = open.ToDictionary(campaign => campaign.Id);
        IReadOnlyDictionary<string, string>? GiveTo(Guid? campaignId) =>
            campaignId is { } id && openByCampaign.TryGetValue(id, out var campaign)
                ? new Dictionary<string, string> { ["campaignCode"] = campaign.Code }
                : null;

        var supported = inCurrency
            .GroupBy(row => row.CampaignId)
            .Select(group => new
            {
                group.Key,
                Amount = group.Sum(row => row.Amount),
                Count = group.Count(),
                Last = group.Max(row => row.DonatedAtUtc)
            })
            .OrderByDescending(entry => entry.Amount)
            .ToList();

        var ranking = new DashboardRankingPanelResponse(
            Ranks.DonorPanel,
            "Campaigns you support",
            "All your gifts",
            "money",
            currency,
            "gift",
            "gifts",
            [
                .. supported.Take(5).Select(entry => new DashboardRankingItemResponse(
                    entry.Key?.ToString() ?? "general",
                    NameOf(names, entry.Key),
                    entry.Amount,
                    entry.Count,
                    DashboardFormat.ShareOf(entry.Amount, allTotal),
                    GiveTo(entry.Key) is null ? null : newDonation,
                    GiveTo(entry.Key)))
            ],
            [],
            null,
            Link("Give again", NewDonation),
            new DashboardEmptyStateResponse("No campaigns yet", "The campaigns you give to appear here."));

        var leaders = new DashboardRankingPanelResponse(
            Ranks.DonorPanel,
            "Your giving by year",
            "Financial years, for your tax records",
            "money",
            currency,
            "gift",
            "gifts",
            [
                .. inCurrency
                    .GroupBy(row => clock.FinancialYearFor(TimeZoneInfo.ConvertTime(row.DonatedAtUtc, view.Zone)))
                    .OrderByDescending(group => group.Key, StringComparer.Ordinal)
                    .Take(4)
                    .Select(group => new DashboardRankingItemResponse(
                        group.Key,
                        $"FY {group.Key}",
                        group.Sum(row => row.Amount),
                        group.Count(),
                        DashboardFormat.ShareOf(group.Sum(row => row.Amount), allTotal),
                        payments))
            ],
            inCurrency.Count == 0
                ? []
                :
                [
                    new("average gift", average, "money", Route: payments),
                    new("largest gift", largest, "money",
                        DashboardFormat.Counted(inCurrency.Count, "gift", "gifts"), Route: payments)
                ],
            Link("Receipts", PaymentsAndReceipts),
            Link("Open payments & receipts", PaymentsAndReceipts),
            new DashboardEmptyStateResponse(
                "No gifts yet", "Each financial year's giving appears here, for your tax records."));

        var feed = Feed(Ranks.DonorPanel, "Your latest donations", latest.Items, currency, payments,
            Link("Open payments & receipts", PaymentsAndReceipts),
            new DashboardEmptyStateResponse(
                "No donations yet",
                "Every gift you make is listed here, newest first.",
                Link("Donate", NewDonation)));

        var methods = inCurrency
            .GroupBy(row => row.MethodType)
            .Select(group => new { Method = group.Key, Amount = group.Sum(row => row.Amount), Count = group.Count() })
            .OrderByDescending(entry => entry.Amount)
            .ToList();
        var shownMethods = methods.Take(4).ToList();
        var otherMethods = methods.Skip(4).ToList();

        var sources = new DashboardSharePanelResponse(
            Ranks.DonorPanel,
            "How you give",
            "money",
            currency,
            "gifts",
            DashboardFormat.ShareOf(inCurrency.Where(row => IsOnline(row.MethodType)).Sum(row => row.Amount), allTotal),
            "Paid online",
            "is how you give most",
            [
                .. shownMethods.Select(entry => new DashboardShareItemResponse(
                    entry.Method?.ToString() ?? "unknown",
                    entry.Method is { } method ? PaymentMappingConfig.Describe(method) : "Not stated",
                    DashboardFormat.ShareOf(entry.Amount, allTotal),
                    entry.Count,
                    entry.Amount,
                    IconOf(entry.Method),
                    payments))
            ],
            otherMethods.Count == 0
                ? null
                : new DashboardShareItemResponse(
                    "other",
                    "Other ways",
                    DashboardFormat.ShareOf(otherMethods.Sum(entry => entry.Amount), allTotal),
                    otherMethods.Sum(entry => entry.Count),
                    otherMethods.Sum(entry => entry.Amount),
                    "ri-more-line",
                    payments),
            null,
            Link("Payments", PaymentsAndReceipts),
            new DashboardEmptyStateResponse(
                "No gifts yet", "How you pay appears here once you give.", Link("Donate", NewDonation)));

        var funnel = new DashboardFunnelPanelResponse(
            Ranks.DonorPanel,
            "Your payments",
            DashboardFormat.ShareOf(intents.Paid, intents.Started),
            "Payments completed",
            $"{DashboardFormat.Count(intents.Paid)} of {DashboardFormat.Counted(intents.Started, "payment", "payments")} went through",
            [
                new("Started", intents.Started, intents.Started > 0 ? 100m : 0m, "brand", payments),
                new("Paid", intents.Paid, DashboardFormat.ShareOf(intents.Paid, intents.Started), "wait", payments),
                new("Receipted", totals.ReceiptedCount, DashboardFormat.ShareOf(totals.ReceiptedCount, intents.Started), "ok", payments)
            ],
            toFinish > 0
                ? new DashboardFunnelAlertResponse(
                    $"{DashboardFormat.Counted(toFinish, "payment", "payments")} to finish", "Open payments", payments, false)
                : new DashboardFunnelAlertResponse("Every payment went through", "Open payments", payments, true),
            Link("Payments", PaymentsAndReceipts));

        var agenda = new DashboardAgendaPanelResponse(
            Ranks.DonorPanel,
            "Payments to finish",
            [
                .. failed.Items.Select(item => (Item: item, Failed: true))
                    .Concat(pending.Items.Select(item => (Item: item, Failed: false)))
                    .OrderByDescending(entry => entry.Item.ReceivedAtUtc)
                    .Take(AgendaRows)
                    .Select(entry => ToAgendaItem(entry.Item, entry.Failed, payments))
            ],
            [
                new("to finish", toFinish, "count", Route: payments),
                new("failed", failed.TotalCount, "count", IsAlert: failed.TotalCount > 0, Route: payments)
            ],
            Link("Open payments & receipts", PaymentsAndReceipts),
            new DashboardEmptyStateResponse(
                "No payments waiting",
                "Every payment you started has gone through.",
                Link("Donate", NewDonation)));

        var pipeline = new DashboardPipelinePanelResponse(
            Ranks.DonorPanel,
            "Campaigns",
            $"{DashboardFormat.Count(open.Count)} open now",
            $"{DashboardFormat.Count(totals.CampaignCount)} supported",
            open.Count == 0 && supported.Count > 0 ? "supported" : "open",
            [
                new DashboardPipelineStageResponse(
                    "open",
                    "Open for giving",
                    open.Count,
                    "No campaigns open right now",
                    [
                        .. open.Take(4).Select(campaign => new DashboardPipelineRowResponse(
                            campaign.Id.ToString(),
                            campaign.Code,
                            campaign.Name,
                            "Open for giving",
                            campaign.Code,
                            null,
                            OpenCampaignMeta(campaign),
                            0m,
                            OpenUntil(campaign.Availability, view.Today),
                            false,
                            newDonation,
                            newDonation is null ? null : new Dictionary<string, string> { ["campaignCode"] = campaign.Code }))
                    ],
                    "active"),
                new DashboardPipelineStageResponse(
                    "supported",
                    "You've supported",
                    totals.CampaignCount,
                    "No campaigns supported yet",
                    [
                        .. supported.Where(entry => entry.Key is not null).Take(4).Select(entry =>
                        {
                            var giveTo = GiveTo(entry.Key);
                            return new DashboardPipelineRowResponse(
                                entry.Key!.Value.ToString(),
                                giveTo?["campaignCode"] ?? string.Empty,
                                NameOf(names, entry.Key),
                                "You've supported",
                                DashboardFormat.Counted(entry.Count, "gift", "gifts"),
                                null,
                                [
                                    new DashboardMetaResponse("ri-hand-coin-line", "given", Amount: entry.Amount, CurrencyCode: currency),
                                    new DashboardMetaResponse("ri-gift-line", DashboardFormat.Counted(entry.Count, "gift", "gifts"))
                                ],
                                DashboardFormat.ShareOf(entry.Amount, allTotal),
                                $"Last gift {DashboardFormat.DayLabel(DashboardFormat.LocalDate(entry.Last, view.Zone))}",
                                false,
                                giveTo is null ? null : newDonation,
                                giveTo);
                        })
                    ],
                    "approved")
            ],
            "Nothing is at this stage right now.",
            Link("Donate", NewDonation),
            Link("Give to a campaign", NewDonation),
            null);

        return new DashboardResponse(
            Module,
            view.Now,
            view.Zone.Id,
            "Your own giving",
            headlines,
            counters,
            attention,
            actions,
            new DashboardPanelsResponse(
                Trend: trend,
                Health: health,
                Agenda: agenda,
                Pipeline: pipeline,
                Ranking: ranking,
                Leaders: leaders,
                Feed: feed,
                Sources: sources,
                Funnel: funnel));
    }

    // =========================================================================================
    // Shared pieces
    // =========================================================================================

    /// <summary>
    /// The command-bar shortcut PAY offers: starting a donation, for whoever may. It used to be
    /// "Record donation" on every role's page, opening the Offline Donation Entry screen - which
    /// is switched off in the menu because it saves nothing.
    /// </summary>
    private IReadOnlyList<DashboardActionResponse> Actions() =>
        Can(NewDonation.Permission)
            ? [new("pay.new-donation", Ranks.NewDonation,
                currentUser.Scope.IsDonorSelfService ? "Donate" : "New donation",
                "ri-hand-coin-line", NewDonation.Route, true)]
            : [];

    private static DashboardResponse Empty(
        TimeZoneInfo zone, DateTimeOffset now, IReadOnlyList<DashboardActionResponse> actions) =>
        new(Module, now, zone.Id, null, [], [], [], actions, new DashboardPanelsResponse());

    private IReadOnlyList<DashboardTrendPointResponse> DailyPoints(
        IReadOnlyList<DashboardDonationRow> rows, string currency, DateOnly firstDay, View view)
    {
        var buckets = rows
            .GroupBy(row => DashboardFormat.LocalDate(row.DonatedAtUtc, view.Zone))
            .ToDictionary(
                group => group.Key,
                group => (Value: group.Where(row => row.CurrencyCode == currency).Sum(row => row.Amount), Count: group.Count()));

        return
        [
            .. Enumerable.Range(0, WindowDays).Select(offset =>
            {
                var day = firstDay.AddDays(offset);
                buckets.TryGetValue(day, out var bucket);
                return new DashboardTrendPointResponse(
                    day, DashboardFormat.DayLabel(day), bucket.Value, bucket.Count, day == view.Today);
            })
        ];
    }

    private IReadOnlyList<DashboardTrendPointResponse> MonthlyPoints(
        IReadOnlyList<DashboardDonationRow> rows, string currency, DateOnly firstMonth, View view)
    {
        var buckets = rows
            .Select(row => (Row: row, Day: DashboardFormat.LocalDate(row.DonatedAtUtc, view.Zone)))
            .Where(entry => entry.Day >= firstMonth)
            .GroupBy(entry => new DateOnly(entry.Day.Year, entry.Day.Month, 1))
            .ToDictionary(
                group => group.Key,
                group => (
                    Value: group.Where(entry => entry.Row.CurrencyCode == currency).Sum(entry => entry.Row.Amount),
                    Count: group.Count()));

        var thisMonth = new DateOnly(view.Today.Year, view.Today.Month, 1);

        return
        [
            .. Enumerable.Range(0, DonorMonths).Select(offset =>
            {
                var month = firstMonth.AddMonths(offset);
                buckets.TryGetValue(month, out var bucket);
                return new DashboardTrendPointResponse(
                    month, DashboardFormat.MonthLabel(month), bucket.Value, bucket.Count, month == thisMonth);
            })
        ];
    }

    /// <summary>
    /// The donation states as four slices. Settled and awaiting settlement lead to Payments &amp;
    /// Receipts; refunded and charged back lead nowhere, because no working screen handles them.
    /// </summary>
    private static IReadOnlyList<DashboardSliceResponse> Slices(DonationStatisticsResponse statistics, string? payments) =>
    [
        new("settled", PaymentDashboardCatalogue.Slices.Settled, statistics.SettledCount, "ok", payments),
        new("awaiting", PaymentDashboardCatalogue.Slices.AwaitingSettlement, statistics.RecordedCount, "wait", payments),
        new("refunded", PaymentDashboardCatalogue.Slices.Refunded, statistics.RefundedCount, "warn", null),
        new("charged-back", PaymentDashboardCatalogue.Slices.ChargedBack, statistics.ChargedBackCount, "bad", null)
    ];

    private static DashboardFeedPanelResponse Feed(
        int rank,
        string title,
        IReadOnlyList<DonationListItemResponse> items,
        string currency,
        string? route,
        DashboardLinkResponse? link,
        DashboardEmptyStateResponse empty)
    {
        var settled = items.Count(item => item.Status == DonationStatus.Settled);
        var inProgress = items.Count(item => item.Status == DonationStatus.Recorded);

        var chips = new List<DashboardChipResponse> { new("settled", settled, "ok", "ri-checkbox-circle-fill") };

        if (inProgress > 0)
        {
            chips.Add(new("awaiting settlement", inProgress, "wait", "ri-time-line"));
        }

        return new DashboardFeedPanelResponse(
            rank,
            title,
            "money",
            currency,
            $"Latest {DashboardFormat.Counted(items.Count, "gift", "gifts")}",
            items.Where(item => item.Amount.CurrencyCode == currency).Sum(item => item.Amount.Amount),
            chips,
            [
                .. items.Select(item => new DashboardFeedItemResponse(
                    item.Id.ToString(),
                    string.IsNullOrWhiteSpace(item.DonorName) ? Anonymous : item.DonorName.Trim(),
                    item.DonationReference,
                    item.DonatedAtUtc,
                    item.CampaignName ?? GeneralGiving,
                    item.StatusDescription,
                    ToneOf(item.Status),
                    item.Amount.Amount,
                    item.Amount.Display,
                    IconOf(item.MethodType),
                    route))
            ],
            link,
            empty);
    }

    /// <summary>A headline figure: whole rupees, because a tile is read at a glance, not audited.</summary>
    private static string Headline(MoneyResponse money) =>
        MoneyText.Format(money.Amount, money.CurrencyCode, MoneyStyle.Whole);

    private DashboardAgendaItemResponse ToAgendaItem(PaymentEventListItemResponse item, bool failed, string? payments)
    {
        // A PENDING PAYMENT IS CONTINUED WHERE IT WAS STARTED, on the donation form, from its own
        // reference. A FAILED one is retried from Payments & Receipts, where Retry checks with the
        // provider first so a payment that actually went through is never taken twice.
        var continueHere = !failed
                           && !string.IsNullOrWhiteSpace(item.IntentReference)
                           && Can(NewDonation.Permission);

        return new DashboardAgendaItemResponse(
            item.Id.ToString(),
            item.ReceivedAtUtc,
            string.IsNullOrWhiteSpace(item.CampaignName) ? GeneralGiving : item.CampaignName,
            $"{item.Amount?.Display ?? string.Empty} · {(failed ? "Payment failed" : "Payment pending")}".Trim(' ', '·'),
            failed ? "Retry" : "Continue",
            failed,
            continueHere ? NewDonation.Route : payments,
            continueHere ? new Dictionary<string, string> { ["intent"] = item.IntentReference! } : null);
    }

    /// <summary>
    /// "105d left" for a campaign whose availability reads "Open until 27 Jan 2027" - the same words
    /// a campaign row uses for its end - and the availability itself when it names no date.
    /// </summary>
    private static string OpenUntil(string availability, DateOnly today)
    {
        const string Prefix = "Open until ";

        return availability.StartsWith(Prefix, StringComparison.Ordinal)
               && DateOnly.TryParseExact(
                   availability[Prefix.Length..].Trim(),
                   ["dd MMM yyyy", "d MMM yyyy"],
                   System.Globalization.CultureInfo.InvariantCulture,
                   System.Globalization.DateTimeStyles.None,
                   out var until)
            ? DashboardFormat.EndsLabel(until, today)
            : availability;
    }

    private static IReadOnlyList<DashboardMetaResponse> OpenCampaignMeta(PublicCampaignSummary campaign)
    {
        var meta = new List<DashboardMetaResponse> { new("ri-hashtag", campaign.Code) };

        if (campaign.CampaignAmount > 0m)
        {
            meta.Add(new("ri-focus-3-line", "suggested", Amount: campaign.CampaignAmount, CurrencyCode: campaign.CurrencyCode));
        }

        meta.Add(new("ri-time-line", campaign.Availability));
        return meta;
    }

    private async Task<int> CountRefundsAsync(RefundSearchFilter filter, View view, CancellationToken cancellationToken)
    {
        filter.Page = 1;
        filter.PageSize = 1;
        return (await refunds.SearchRefundsAsync(filter, view.Scope, view.CanSeeSensitiveDonor, cancellationToken)).TotalCount;
    }

    private async Task<int> CountChargebacksAsync(ChargebackSearchFilter filter, View view, CancellationToken cancellationToken)
    {
        filter.Page = 1;
        filter.PageSize = 1;
        return (await refunds.SearchChargebacksAsync(filter, view.Scope, view.CanSeeSensitiveDonor, cancellationToken)).TotalCount;
    }

    private static PaymentEventSearchFilter EventFilter(PaymentOutcomeFilter outcome) =>
        new() { PaymentOutcome = outcome, Page = 1, PageSize = 1 };

    private async Task<IReadOnlyDictionary<Guid, string>> CampaignNamesAsync(
        Guid tenantId, IEnumerable<Guid?> campaignIds, CancellationToken cancellationToken)
    {
        var ids = campaignIds.Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();

        return ids.Count == 0
            ? new Dictionary<Guid, string>()
            : await campaigns.GetCampaignNamesAsync(tenantId, ids, cancellationToken);
    }

    private static string NameOf(IReadOnlyDictionary<Guid, string> names, Guid? campaignId) =>
        campaignId is { } id && names.TryGetValue(id, out var name) ? name : GeneralGiving;

    private bool Can(string permission) => currentUser.HasPermission(permission);

    private bool CanAny(params string[] permissions) => currentUser.HasAnyPermission(permissions);

    private string? RouteOf(Screen screen) => Can(screen.Permission) ? screen.Route : null;

    private DashboardLinkResponse? Link(string label, Screen screen) =>
        Can(screen.Permission) ? new DashboardLinkResponse(label, screen.Route) : null;
}
