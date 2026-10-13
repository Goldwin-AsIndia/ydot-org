using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.PAY.Application.Common.Abstractions.Persistence;
using YDot.PAY.Application.Common.Abstractions.Security;
using YDot.PAY.Application.Common.Abstractions.Services;
using YDot.PAY.Application.Common.Constants;
using YDot.PAY.Application.Common.Models;
using YDot.PAY.Application.Common.Results;
using YDot.PAY.Application.Common.Settings;
using YDot.PAY.Application.Features.Payments.DTOs;
using YDot.PAY.Application.Features.Receipts.DTOs;
using YDot.PAY.Domain.Enums;

namespace YDot.PAY.Application.Features.Payments.Queries;

/// <summary>The Payments &amp; Receipts page - every payment event and the receipt it produced.</summary>
public sealed record GetPaymentActivityQuery(PaymentActivityFilter Filter);

/// <summary>
/// The Payments &amp; Receipts page: issued receipts (Success) and the gateway events that failed
/// or are still pending, as one paged list with one set of totals.
///
/// THE UNION IS EXACT. Each source is asked for its newest <c>skip + pageSize</c> rows, the two
/// are merged by time and the page is cut from the merge - the same method the Receipt Register
/// uses for its own two halves. The screen used to do this itself with two hundred rows from each
/// source, so beyond two hundred the pager and the total were wrong.
///
/// EACH TILE IS COUNTED WHERE ITS ROWS COME FROM: Success from the receipts, Pending and Fail from
/// the event queue. Asking one source for another's count is the bug the screen used to have.
/// </summary>
public sealed class PaymentActivityQueryHandler(
    IPaymentEventReadService events,
    IReceiptReadService receipts,
    ICampaignDirectory campaigns,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<PaymentSettings> paymentOptions,
    ILogger<PaymentActivityQueryHandler> logger)
{
    public const string Success = "Success";
    public const string Pending = "Pending";
    public const string Fail = "Fail";

    /// <summary>The page's status choices, in the order the dropdown lists them.</summary>
    public static IReadOnlyList<PaymentOption> StatusOptions { get; } =
    [
        new(Success, Success, "Payment successful"),
        new(Pending, Pending, "Payment pending"),
        new(Fail, Fail, "Payment failed")
    ];

    public async Task<Result<PaymentActivityResponse>> HandleAsync(
        GetPaymentActivityQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var filter = query.Filter;
        var outcome = StatusOptions.FirstOrDefault(option =>
            string.Equals(option.Value, filter.Outcome?.Trim(), StringComparison.OrdinalIgnoreCase))?.Value;
        var search = string.IsNullOrWhiteSpace(filter.Search) ? null : filter.Search.Trim();
        var ceiling = filter.Skip + filter.PageSize;

        logger.LogInformation("Payments and receipts activity requested. Outcome {Outcome}.", outcome ?? "All");

        // A caller who may not read receipts sees the queue's half only, rather than a refusal of
        // the whole page.
        var canSeeReceipts = currentUser.HasPermission(PermissionCodes.ReceiptsView);
        var canSeeDonor = currentUser.HasPermission(PermissionCodes.DonationsViewSensitiveDonor);

        (IReadOnlyList<IssuedReceiptRow> Rows, int TotalCount, decimal TotalAmount, string Currency) successHalf = canSeeReceipts
            ? await receipts.ListNewestIssuedAsync(
                new ReceiptRegisterFilter { Search = search, Status = Success },
                outcome is null or Success ? ceiling : 0,
                currentUser.Scope,
                canSeeDonor,
                cancellationToken)
            : ((IReadOnlyList<IssuedReceiptRow>)[], 0, 0m, "INR");

        var pendingHalf = await events.ListNewestAsync(
            EventFilter(search, PaymentOutcomeFilter.Pending), outcome == Pending ? ceiling : 0, cancellationToken);
        var failHalf = await events.ListNewestAsync(
            EventFilter(search, PaymentOutcomeFilter.Fail), outcome == Fail ? ceiling : 0, cancellationToken);

        // "All statuses" reads the queue's two halves together, in the queue's own order.
        IReadOnlyList<PaymentEventListItemResponse> queueRows = outcome switch
        {
            Pending => pendingHalf.Items,
            Fail => failHalf.Items,
            null => (await events.ListNewestAsync(EventFilter(search, null), ceiling, cancellationToken)).Items,
            _ => Array.Empty<PaymentEventListItemResponse>()
        };

        var campaignNames = await CampaignNamesAsync(successHalf.Rows, cancellationToken);

        var merged = successHalf.Rows
            .Select(row => FromReceipt(row, campaignNames))
            .Concat(queueRows.Select(FromEvent))
            .OrderByDescending(row => row.OccurredAtUtc ?? DateTimeOffset.MinValue)
            .ThenBy(row => row.Key, StringComparer.Ordinal)
            .Skip(filter.Skip)
            .Take(filter.PageSize)
            .ToList();

        var total = outcome switch
        {
            Success => successHalf.TotalCount,
            Pending => pendingHalf.TotalCount,
            Fail => failHalf.TotalCount,
            _ => successHalf.TotalCount + pendingHalf.TotalCount + failHalf.TotalCount
        };

        var summary = new PaymentActivitySummaryResponse(
            successHalf.TotalCount + pendingHalf.TotalCount + failHalf.TotalCount,
            MoneyResponse.Plain(successHalf.TotalAmount, successHalf.Currency),
            successHalf.TotalCount,
            pendingHalf.TotalCount,
            failHalf.TotalCount);

        logger.LogInformation("Payments and receipts activity completed. {RowCount} of {TotalCount} row(s).", merged.Count, total);

        return Result.Success(new PaymentActivityResponse(
            new PagedResponse<PaymentActivityRowResponse>(merged, total, filter.Page, filter.PageSize),
            summary,
            StatusOptions,
            TimeZoneLabel(),
            clock.UtcNow));
    }

    private static PaymentEventSearchFilter EventFilter(string? search, PaymentOutcomeFilter? outcome) =>
        new() { Search = search, PaymentOutcome = outcome, Page = 1, PageSize = 1 };

    /// <summary>Campaign names for receipts that do not print one, read once for the page from CAM.</summary>
    private async Task<IReadOnlyDictionary<Guid, string>> CampaignNamesAsync(
        IReadOnlyList<IssuedReceiptRow> rows, CancellationToken cancellationToken)
    {
        var ids = rows
            .Where(row => string.IsNullOrWhiteSpace(row.Row.CampaignOrFundName) && row.CampaignId is not null)
            .Select(row => row.CampaignId!.Value)
            .Distinct()
            .ToList();

        return ids.Count == 0 || tenantContext.TenantId is not Guid tenantId
            ? new Dictionary<Guid, string>()
            : await campaigns.GetCampaignNamesAsync(tenantId, ids, cancellationToken);
    }

    private PaymentActivityRowResponse FromReceipt(IssuedReceiptRow issued, IReadOnlyDictionary<Guid, string> campaignNames)
    {
        var row = issued.Row;
        var campaign = !string.IsNullOrWhiteSpace(row.CampaignOrFundName)
            ? row.CampaignOrFundName
            : issued.CampaignId is Guid id && campaignNames.TryGetValue(id, out var name) ? name : null;

        var receiptStatus = ReceiptStatusOf(row.ReceiptNumber, row.DeliveryState);

        var actions = new List<string>();
        if (receiptStatus != "Not generated" && currentUser.HasPermission(PermissionCodes.ReceiptsResend))
        {
            actions.Add("Resend");
        }

        return new PaymentActivityRowResponse(
            row.Reference,
            row.Id,
            row.Reference,
            row.ReceiptNumber ?? row.Reference,
            null,
            row.DonorSnapshot,
            row.DonorEmail,
            campaign,
            row.Amount,
            Success,
            "Payment successful",
            receiptStatus,
            row.ReceiptNumber,
            row.ReceiptDateUtc,
            0,
            0,
            null,
            actions);
    }

    private PaymentActivityRowResponse FromEvent(PaymentEventListItemResponse item)
    {
        var status = string.Equals(item.PaymentOutcome, Fail, StringComparison.OrdinalIgnoreCase) ? Fail : Pending;

        var actions = new List<string>();
        if (status == Fail && item.DonationIntentId is not null)
        {
            if (currentUser.HasPermission(PermissionCodes.PaymentsSafeRetry)) actions.Add("Retry");
            if (currentUser.HasPermission(PermissionCodes.IntentsResendLink)) actions.Add("ResendLink");
        }

        if (status == Pending && !string.IsNullOrWhiteSpace(item.IntentReference)
            && currentUser.HasPermission(PermissionCodes.IntentsCreate))
        {
            actions.Add("ContinuePayment");
        }

        return new PaymentActivityRowResponse(
            item.GatewayEventId,
            item.Id,
            item.GatewayEventId,
            item.IntentReference ?? string.Empty,
            item.DonationIntentId,
            item.DonorName,
            item.DonorEmail,
            item.CampaignName,
            item.Amount,
            status,
            status == Fail ? "Payment failed" : "Payment pending",

            // A failed or still-pending payment never has a receipt.
            "Not generated",
            null,
            item.ReceivedAtUtc,
            item.ProcessingAttempts,
            item.Version,
            item.ProcessingError,
            actions);
    }

    /// <summary>
    /// What reached the donor, from the delivery state rather than from whether a number exists:
    /// a receipt whose e-mail bounced is "Failed", one never sent is "Not sent".
    /// </summary>
    private static string ReceiptStatusOf(string? receiptNumber, string? deliveryState)
    {
        if (string.IsNullOrWhiteSpace(receiptNumber))
        {
            return "Not generated";
        }

        return (deliveryState ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "delivered" => "Sent",
            "pending" => "Pending",
            "failed" => "Failed",
            _ => "Not sent"
        };
    }

    /// <summary>"Asia/Kolkata · UTC+05:30" - the zone this deployment prints its dates in.</summary>
    private string TimeZoneLabel()
    {
        var zoneId = paymentOptions.Value.DisplayTimeZone;

        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
            var offset = zone.GetUtcOffset(clock.UtcNow);
            return $"{zoneId} · UTC{(offset < TimeSpan.Zero ? "-" : "+")}{offset.Duration():hh\\:mm}";
        }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException or ArgumentException)
        {
            return "UTC";
        }
    }
}
