using YDot.PAY.Application.Common.Models;
using YDot.PAY.Domain.Enums;

namespace YDot.PAY.Application.Common.Abstractions.Persistence;

/// <summary>
/// The figures behind the landing page that no register already answers.
///
/// EVERYTHING HERE IS COUNTED IN THE DATABASE OR READ AS A LEAN PROJECTION. The page used to fetch
/// the newest hundred donations and work out the giving curve, the top campaigns and the top
/// supporters from them in the browser, so an Organisation taking more than a hundred gifts a
/// fortnight saw a curve and two rankings made of whichever hundred came first.
///
/// EVERY METHOD TAKES THE CALLER'S <see cref="AccessScope"/> and applies it exactly as the donation
/// register does - own records for a narrowed member of staff, own giving for a donor - so a tile
/// can never disclose more than the register behind it.
/// </summary>
public interface IPaymentDashboardReadService
{
    /// <summary>
    /// One row per donation since <paramref name="fromUtc"/> (or ever, when null) and before
    /// <paramref name="beforeUtc"/> (or now), voided gifts left out, newest first and at most
    /// <paramref name="maximumRows"/> of them - a few columns and keys, never the aggregate.
    /// </summary>
    Task<IReadOnlyList<DashboardDonationRow>> GetDonationRowsAsync(
        AccessScope scope,
        DateTimeOffset? fromUtc,
        int maximumRows,
        CancellationToken cancellationToken,
        DateTimeOffset? beforeUtc = null);

    /// <summary>
    /// Shares the donation statistics do not carry: how many gifts could be receipted and how many
    /// are, how many people gave, and how much of the money is traced to a tracking asset - the
    /// money totals in <paramref name="currencyCode"/> only, so no total ever adds two currencies.
    /// </summary>
    Task<DashboardDonationTotals> GetTotalsAsync(
        AccessScope scope,
        string currencyCode,
        CancellationToken cancellationToken);

    /// <summary>How the caller's donation intents stand - started, paid, still open, failed.</summary>
    Task<DashboardIntentCounts> GetIntentCountsAsync(
        AccessScope scope,
        CancellationToken cancellationToken);
}

/// <summary>One donation as the page's groupings need it.</summary>
public sealed record DashboardDonationRow(
    DateTimeOffset DonatedAtUtc,
    decimal Amount,
    string CurrencyCode,
    DonationStatus Status,
    Guid? CampaignId,

    /// <summary>
    /// Who gave, as one key: the e-mail they typed, otherwise their donor record, otherwise their
    /// name - the order the totals count supporters in. Two gifts with one key are one supporter.
    /// </summary>
    string DonorKey,

    string DonorName,
    PaymentMethodType? MethodType,
    ReconciliationStatus Reconciliation,

    /// <summary>Whether the gift holds an issued receipt now.</summary>
    bool IsReceipted);

/// <summary>Totals over every donation in scope, voided ones excluded.</summary>
public sealed record DashboardDonationTotals(
    /// <summary>Recorded, settled or partly refunded - the gifts a receipt can be issued for.</summary>
    int ReceiptableCount,

    /// <summary>Of those, the ones holding an issued receipt now.</summary>
    int ReceiptedCount,

    /// <summary>Distinct supporters, by the same key as <see cref="DashboardDonationRow.DonorKey"/>.</summary>
    int SupporterCount,

    /// <summary>Distinct campaigns given to.</summary>
    int CampaignCount,

    decimal TotalAmount,

    /// <summary>The part of <see cref="TotalAmount"/> that arrived through a tracking asset.</summary>
    decimal TracedAmount);

/// <summary>Donation intents by where they stand. Drafts are not counted as started.</summary>
public sealed record DashboardIntentCounts(
    int Started,
    int Paid,
    int InProgress,
    int Failed);
