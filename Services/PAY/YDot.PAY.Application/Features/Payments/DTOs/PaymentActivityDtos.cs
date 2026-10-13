using YDot.PAY.Application.Common.Models;
using YDot.PAY.Application.Features.Receipts.DTOs;

namespace YDot.PAY.Application.Features.Payments.DTOs;

/// <summary>
/// Query string of GET /api/v1/payments/activity - the Payments &amp; Receipts page.
/// </summary>
public sealed class PaymentActivityFilter : PaginationRequest
{
    /// <summary>Success, Pending or Fail. Unset returns all three - the page's "All statuses".</summary>
    public string? Outcome { get; set; }
}

/// <summary>
/// One line of the Payments &amp; Receipts page: an issued receipt (Success) or a gateway event that
/// failed or is still pending.
///
/// ONE SHAPE FOR BOTH SOURCES, BUILT HERE. The page used to fetch two hundred rows from each of
/// two endpoints, reshape them itself and page the merge in the browser - so past two hundred the
/// totals and the pager were wrong, and the receipt column's words were decided in the browser
/// from a delivery enum.
/// </summary>
public sealed record PaymentActivityRowResponse(
    /// <summary>Unique on the page: the gateway event id, or the receipt's own reference.</summary>
    string Key,

    /// <summary>The event id for a Pending or Fail line; the receipt id for a Success line.</summary>
    Guid Id,
    string EventReference,

    /// <summary>The receipt number for a Success line; the donation reference otherwise.</summary>
    string ReceiptOrIntentReference,
    Guid? DonationIntentId,
    string? DonorName,

    /// <summary>Masked unless the caller may see unmasked donor detail.</summary>
    string? DonorEmail,
    string? CampaignName,
    MoneyResponse? Amount,

    /// <summary>Success, Pending or Fail.</summary>
    string PaymentStatus,

    /// <summary>"Payment successful", "Payment pending", "Payment failed".</summary>
    string PaymentStatusLabel,

    /// <summary>Sent, Pending, Failed, Not sent or Not generated - what reached the donor.</summary>
    string ReceiptStatus,
    string? ReceiptNumber,
    DateTimeOffset? OccurredAtUtc,
    int ProcessingAttempts,
    long Version,
    string? ProcessingError,

    /// <summary>
    /// What the caller may do from this line: Retry and ResendLink on a failed payment,
    /// ContinuePayment on a pending one, Resend on a receipt. A line with none shows no action.
    /// </summary>
    IReadOnlyList<string> PermittedActions);

/// <summary>The five tiles, counted over the whole scope (and the search), not the page.</summary>
public sealed record PaymentActivitySummaryResponse(
    int TotalEvents,

    /// <summary>Successful money only - a failed or pending payment moved nothing.</summary>
    MoneyResponse TotalAmount,
    int Successful,
    int Pending,
    int Failed);

/// <summary>The page: its rows, its tiles, its status choices and its clock.</summary>
public sealed record PaymentActivityResponse(
    PagedResponse<PaymentActivityRowResponse> Rows,
    PaymentActivitySummaryResponse Summary,

    /// <summary>Success / Pending / Fail with their words; the value goes back as <c>outcome</c>.</summary>
    IReadOnlyList<PaymentOption> StatusOptions,

    /// <summary>The zone the page's dates are read in, e.g. "Asia/Kolkata · UTC+05:30".</summary>
    string OperatingTimeZoneLabel,
    DateTimeOffset AsAtUtc);

/// <summary>An issued receipt as the register shows it, with the campaign its donation was for.</summary>
public sealed record IssuedReceiptRow(ReceiptRegisterRowResponse Row, Guid? CampaignId);
