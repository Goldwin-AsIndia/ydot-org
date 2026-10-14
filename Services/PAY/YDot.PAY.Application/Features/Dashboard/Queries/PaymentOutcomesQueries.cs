using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.PAY.Application.Common.Abstractions.Persistence;
using YDot.PAY.Application.Common.Abstractions.Security;
using YDot.PAY.Application.Common.Abstractions.Services;
using YDot.PAY.Application.Common.Constants;
using YDot.PAY.Application.Common.Results;
using YDot.PAY.Application.Common.Settings;
using YDot.PAY.Application.Features.Dashboard.DTOs;
using YDot.PAY.Domain.Enums;
using static YDot.PAY.Application.Features.Dashboard.PaymentDashboardCatalogue;

namespace YDot.PAY.Application.Features.Dashboard.Queries;

/// <summary>PAY's outcome figures for a period and scope - the Executive dashboard.</summary>
public sealed record GetPaymentOutcomesQuery(DashboardOutcomesFilter Filter);

/// <summary>
/// The money behind the Executive dashboard: what was reconciled, who gave, what was receipted and
/// what is still an exception - over the period and campaign asked about, against the comparison
/// period, with the day-by-day curve.
///
/// IT REPLACES FOUR INVENTED FIGURES. The page showed "₹48.72 L", "24,582 beneficiaries",
/// "3,842 sticks of stock" and "7 exceptions" to everybody. Beneficiaries and stock have no service
/// on this platform, so their tiles now hold donors who gave and receipted gifts - figures this
/// module can stand behind.
///
/// THE PRESETS ARE PAY'S because the financial year is: PAY files every receipt under it.
/// </summary>
public sealed class PaymentOutcomesQueryHandler(
    IPaymentDashboardReadService dashboard,
    IDonationReadService donations,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<PaymentSettings> paymentOptions,
    ILogger<PaymentOutcomesQueryHandler> logger)
{
    /// <summary>The most donations read for one period and its comparison together.</summary>
    private const int MaximumRows = 200_000;

    public async Task<Result<DashboardOutcomesResponse>> HandleAsync(
        GetPaymentOutcomesQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var zone = DashboardFormat.ResolveZone(query.Filter.TimeZone, paymentOptions.Value.DisplayTimeZone);
        var now = clock.UtcNow;
        var today = DashboardFormat.LocalDate(now, zone);

        var (period, error) = DashboardPeriods.Resolve(query.Filter, today);
        if (period is null)
        {
            logger.LogInformation("Payment outcomes refused: {Reason}", error);
            return Result.Failure<DashboardOutcomesResponse>(Error.Validation(error!));
        }

        var presets = Presets(today, now, zone);
        var comparisons = DashboardPeriods.Comparisons(period);

        if (tenantContext.TenantId is null || !currentUser.HasPermission(PermissionCodes.DonationsView))
        {
            logger.LogInformation("Payment outcomes have nothing for this caller.");
            return Result.Success(Response(period, now, zone, [], null, presets, comparisons));
        }

        logger.LogInformation(
            "Payment outcomes requested for {From} to {To}. Campaign: {CampaignId}.",
            period.From, period.To, query.Filter.CampaignId);

        var scope = currentUser.Scope;
        var currency = (await donations.GetStatisticsAsync(scope, cancellationToken)).TotalAmount.CurrencyCode;

        var rows = (await dashboard.GetDonationRowsAsync(
                scope,
                DashboardFormat.StartOfDayUtc(period.Earliest, zone),
                MaximumRows,
                cancellationToken,
                DashboardFormat.StartOfDayUtc(period.Latest.AddDays(1), zone)))
            .Where(row => query.Filter.CampaignId is null || row.CampaignId == query.Filter.CampaignId)
            .Select(row => (Row: row, Day: DashboardFormat.LocalDate(row.DonatedAtUtc, zone)))
            .ToList();

        var current = rows.Where(entry => DashboardPeriods.Within(entry.Day, period.From, period.To)).Select(entry => entry.Row).ToList();
        var compared = period.CompareFrom is null
            ? null
            : rows.Where(entry => DashboardPeriods.Within(entry.Day, period.CompareFrom, period.CompareTo)).Select(entry => entry.Row).ToList();

        // One pass over the rows for the curve: each day's money (in the main currency) and gifts.
        var byDay = rows
            .GroupBy(entry => entry.Day)
            .ToDictionary(
                group => group.Key,
                group => (
                    Amount: group.Where(entry => entry.Row.CurrencyCode == currency).Sum(entry => entry.Row.Amount),
                    Count: group.Count()));

        var payments = RouteOf(PaymentsAndReceipts);
        var donorList = RouteOf(DonorList);

        var metrics = new List<DashboardOutcomeMetricResponse>
        {
            new("reconciled-collection", 10, "Reconciled collection",
                Reconciled(current, currency), "money", currency,
                "Donations matched to a settlement",
                $"Every gift in the period whose reconciliation is Matched or Manually resolved, summed in {currency}. Voided gifts are left out, and gifts in another currency are not added in.",
                compared is null ? null : Reconciled(compared, currency),
                Drill("Open payments & receipts", payments)),

            new("donors", 30, "Donors who gave",
                Donors(current), "count", currency,
                "Different people who gave in the period",
                "Distinct donors with at least one gift in the period that was not voided - one person by their e-mail, else their donor record, else their name.",
                compared is null ? null : Donors(compared),
                Drill("Open all donors", donorList)),

            new("receipted", 40, "Receipted gifts",
                current.Count(row => row.IsReceipted), "count", currency,
                "Gifts in the period holding an issued receipt",
                "Gifts made in the period whose current receipt has been issued. A voided receipt puts its gift back among the unreceipted.",
                compared?.Count(row => row.IsReceipted),
                Drill("Open payments & receipts", payments)),

            new("exceptions", 60, "Open exceptions",
                Exceptions(current), "count", currency,
                "Gifts not reconciled, in discrepancy or charged back",
                "Gifts in the period whose reconciliation is still Unreconciled or a Discrepancy, plus those charged back by the donor's bank.",
                compared is null ? null : Exceptions(compared),
                Drill("Open payments & receipts", payments))
        };

        var series = new DashboardOutcomeSeriesResponse(
            $"Donations ({currency})",
            "money",
            "Gifts",
            "count",
            currency,
            [
                .. Enumerable.Range(0, period.Days).Select(offset =>
                {
                    var day = period.From.AddDays(offset);
                    var compareDay = period.CompareFrom?.AddDays(offset);
                    var onDay = byDay.GetValueOrDefault(day);
                    var onCompareDay = compareDay is { } other && compared is not null
                        ? byDay.GetValueOrDefault(other)
                        : default;

                    return new DashboardOutcomePointResponse(
                        day,
                        DashboardFormat.DayLabel(day),
                        onDay.Amount,
                        onDay.Count,
                        compareDay is null || compared is null ? null : onCompareDay.Amount,
                        compareDay is null || compared is null ? null : onCompareDay.Count);
                })
            ]);

        logger.LogInformation("Payment outcomes completed. {Count} gift(s) in the period.", current.Count);

        return Result.Success(Response(period, now, zone, metrics, series, presets, comparisons));
    }

    private static DashboardOutcomesResponse Response(
        DashboardPeriods.Period period,
        DateTimeOffset now,
        TimeZoneInfo zone,
        IReadOnlyList<DashboardOutcomeMetricResponse> metrics,
        DashboardOutcomeSeriesResponse? series,
        IReadOnlyList<DashboardPeriodResponse> presets,
        IReadOnlyList<DashboardPeriodResponse> comparisons) =>
        new(Module, now, zone.Id, DashboardPeriods.ZoneLabel(zone, now),
            period.From, period.To, period.CompareFrom, period.CompareTo,
            metrics, series, [], presets, comparisons);

    /// <summary>
    /// Ready-made periods, each with its dates worked out here so the page never does calendar
    /// arithmetic: the last 30 days, this month, last month, this financial year and the last one.
    /// </summary>
    private IReadOnlyList<DashboardPeriodResponse> Presets(DateOnly today, DateTimeOffset now, TimeZoneInfo zone)
    {
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        var financialYear = clock.FinancialYearFor(TimeZoneInfo.ConvertTime(now, zone));

        // The financial year starts on 1 April - the rule FinancialYearFor files receipts by.
        var yearStart = new DateOnly(today.Month >= 4 ? today.Year : today.Year - 1, 4, 1);
        var lastYearStart = yearStart.AddYears(-1);

        return
        [
            new("last-30", "Last 30 days", today.AddDays(-29), today),
            new("this-month", "This month", monthStart, today),
            new("last-month", "Last month", monthStart.AddMonths(-1), monthStart.AddDays(-1)),
            new("this-financial-year", $"Financial year {financialYear}",
                yearStart, today.DayNumber - yearStart.DayNumber + 1 > DashboardPeriods.MaximumDays ? yearStart.AddDays(DashboardPeriods.MaximumDays - 1) : today),
            new("last-financial-year", $"Financial year {clock.FinancialYearFor(TimeZoneInfo.ConvertTime(now, zone).AddYears(-1))}",
                lastYearStart, yearStart.AddDays(-1))
        ];
    }

    private static decimal Reconciled(IEnumerable<DashboardDonationRow> rows, string currency) =>
        rows.Where(row => row.CurrencyCode == currency
                          && row.Reconciliation is ReconciliationStatus.Matched or ReconciliationStatus.ManuallyResolved)
            .Sum(row => row.Amount);

    private static int Donors(IEnumerable<DashboardDonationRow> rows) =>
        rows.Select(row => row.DonorKey).Distinct(StringComparer.Ordinal).Count();

    private static int Exceptions(IEnumerable<DashboardDonationRow> rows) =>
        rows.Count(row => row.Status == DonationStatus.ChargedBack
                          || row.Reconciliation is ReconciliationStatus.Unreconciled or ReconciliationStatus.Discrepancy);

    private string? RouteOf(Screen screen) => currentUser.HasPermission(screen.Permission) ? screen.Route : null;

    private static DashboardLinkResponse? Drill(string label, string? route) =>
        route is null ? null : new DashboardLinkResponse(label, route);
}
