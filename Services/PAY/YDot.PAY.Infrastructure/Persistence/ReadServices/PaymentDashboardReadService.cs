using Microsoft.EntityFrameworkCore;
using YDot.PAY.Application.Common.Abstractions.Persistence;
using YDot.PAY.Application.Common.Models;
using YDot.PAY.Domain.Entities;
using YDot.PAY.Domain.Enums;

namespace YDot.PAY.Infrastructure.Persistence.ReadServices;

/// <summary>
/// The landing page's payment figures, counted where the rows live.
///
/// THE SCOPE IS APPLIED THE WAY THE REGISTERS APPLY IT, line for line: a member of staff narrowed
/// to their own records sees the donations they recorded, a donor sees the gifts made under their
/// e-mail and nothing else, and a donor whose token carries no e-mail sees nothing at all rather
/// than everything. A dashboard tile is a disclosure like any grid row, so it must never be the
/// one read that forgot.
/// </summary>
public sealed class PaymentDashboardReadService(PaymentDbContext context) : IPaymentDashboardReadService
{
    public async Task<IReadOnlyList<DashboardDonationRow>> GetDonationRowsAsync(
        AccessScope scope,
        DateTimeOffset? fromUtc,
        int maximumRows,
        CancellationToken cancellationToken,
        DateTimeOffset? beforeUtc = null)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var query = CountedDonations(scope);

        if (fromUtc is { } from)
        {
            query = query.Where(donation => donation.DonatedAtUtc >= from);
        }

        if (beforeUtc is { } before)
        {
            query = query.Where(donation => donation.DonatedAtUtc < before);
        }

        var rows = await query
            .OrderByDescending(donation => donation.DonatedAtUtc)
            .Take(maximumRows)
            .Select(donation => new
            {
                donation.DonatedAtUtc,
                donation.Amount.Amount,
                donation.Amount.CurrencyCode,
                donation.Status,
                donation.CampaignId,
                donation.DonorId,
                donation.DonorEmail,
                donation.DonorName,
                donation.MethodType,
                donation.ReconciliationStatus,
                IsReceipted = donation.Receipts.Any(receipt => receipt.Status == ReceiptStatus.Issued)
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(row => new DashboardDonationRow(
                row.DonatedAtUtc,
                row.Amount,
                row.CurrencyCode,
                row.Status,
                row.CampaignId,
                DonorKeyOf(row.DonorEmail, row.DonorId, row.DonorName),
                row.DonorName,
                row.MethodType,
                row.ReconciliationStatus,
                row.IsReceipted))
        ];
    }

    public async Task<DashboardDonationTotals> GetTotalsAsync(
        AccessScope scope,
        string currencyCode,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var counted = CountedDonations(scope);

        // The same three states the receipt queue works from: money still held, in full or in
        // part. A refunded or charged-back gift has nothing left to receipt.
        var receiptable = counted.Where(donation =>
            donation.Status == DonationStatus.Recorded
            || donation.Status == DonationStatus.Settled
            || donation.Status == DonationStatus.PartiallyRefunded);

        var receiptableCount = await receiptable.CountAsync(cancellationToken);

        // Against the receipts themselves, as the register does, so a voided receipt puts the
        // donation back among the unreceipted at once.
        var receiptedCount = await receiptable
            .Where(donation => donation.Receipts.Any(receipt => receipt.Status == ReceiptStatus.Issued))
            .CountAsync(cancellationToken);

        // SUPPORTERS ARE COUNTED BY THE KEY THE ROWS CARRY: their e-mail, else their donor record,
        // else their name. Three distinct counts over three disjoint sets add up to one, which is
        // what a single COUNT(DISTINCT) over a computed key would give without asking the database
        // to build a string per row.
        var byEmail = await counted
            .Where(donation => donation.DonorEmail != string.Empty)
            .Select(donation => donation.DonorEmail.ToLower())
            .Distinct()
            .CountAsync(cancellationToken);

        var byRecord = await counted
            .Where(donation => donation.DonorEmail == string.Empty && donation.DonorId != null)
            .Select(donation => donation.DonorId)
            .Distinct()
            .CountAsync(cancellationToken);

        var byName = await counted
            .Where(donation => donation.DonorEmail == string.Empty && donation.DonorId == null)
            .Select(donation => donation.DonorName.ToLower())
            .Distinct()
            .CountAsync(cancellationToken);

        var campaignCount = await counted
            .Where(donation => donation.CampaignId != null)
            .Select(donation => donation.CampaignId)
            .Distinct()
            .CountAsync(cancellationToken);

        // TRACED MEANS ARRIVED THROUGH A TRACKING ASSET - CAM's definition, word for word. A gift
        // filed against a campaign by hand is credited to the campaign and traced to nothing.
        var money = await counted
            .Where(donation => donation.Amount.CurrencyCode == currencyCode)
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Total = group.Sum(donation => donation.Amount.Amount),
                Traced = group.Sum(donation => donation.TrackingAssetId != null ? donation.Amount.Amount : 0m)
            })
            .FirstOrDefaultAsync(cancellationToken);

        return new DashboardDonationTotals(
            receiptableCount,
            receiptedCount,
            byEmail + byRecord + byName,
            campaignCount,
            money?.Total ?? 0m,
            money?.Traced ?? 0m);
    }

    public async Task<DashboardIntentCounts> GetIntentCountsAsync(
        AccessScope scope,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var query = context.DonationIntents.AsNoTracking();

        if (scope.IsOwnRecordsOnly)
        {
            query = query.Where(intent => intent.CreatedByUserId == scope.UserId);
        }

        if (scope.IsDonorSelfService)
        {
            query = scope.HasDonorIdentity
                ? query.Where(intent => intent.NormalisedEmail == scope.DonorEmail)
                : query.Where(_ => false);
        }

        var counts = await query
            .GroupBy(intent => intent.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);

        int For(params DonationIntentStatus[] statuses) =>
            counts.Where(entry => statuses.Contains(entry.Status)).Sum(entry => entry.Count);

        // A draft was never put in front of a payment provider, so it is not a payment started.
        return new DashboardIntentCounts(
            counts.Where(entry => entry.Status != DonationIntentStatus.Draft).Sum(entry => entry.Count),
            For(DonationIntentStatus.Paid),
            For(DonationIntentStatus.AwaitingPayment, DonationIntentStatus.PaymentInProgress),
            For(DonationIntentStatus.Failed));
    }

    /// <summary>Every donation the caller may see, voided ones left out.</summary>
    private IQueryable<Donation> CountedDonations(AccessScope scope)
    {
        var query = context.Donations
            .AsNoTracking()
            .Where(donation => donation.Status != DonationStatus.Voided);

        if (scope.IsOwnRecordsOnly)
        {
            query = query.Where(donation => donation.CreatedByUserId == scope.UserId);
        }

        if (scope.IsDonorSelfService)
        {
            query = scope.HasDonorIdentity
                ? query.Where(donation => donation.DonorEmail.ToLower() == scope.DonorEmail)
                : query.Where(_ => false);
        }

        return query;
    }

    private static string DonorKeyOf(string email, Guid? donorId, string name)
    {
        if (!string.IsNullOrWhiteSpace(email))
        {
            return "mail:" + email.Trim().ToLowerInvariant();
        }

        return donorId is { } id
            ? "id:" + id.ToString("N")
            : "name:" + name.Trim().ToLowerInvariant();
    }
}
