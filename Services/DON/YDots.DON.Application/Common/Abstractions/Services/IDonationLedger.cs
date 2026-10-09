namespace YDots.DON.Application.Common.Abstractions.Services;

/// <summary>What one donor has given, read from the payments module's own records.</summary>
/// <param name="Received">Net money that arrived: recorded and settled gifts, less anything refunded.</param>
/// <param name="Refunded">Money returned - refunds and chargebacks.</param>
/// <param name="GiftCount">Gifts that count towards <paramref name="Received"/>.</param>
/// <param name="Reconciled">The part of <paramref name="Received"/> finance has matched to the bank.</param>
public sealed record DonorGiving(
    Guid DonorId,
    decimal Received,
    decimal Refunded,
    int GiftCount,
    decimal? LastGiftAmount,
    DateTimeOffset? LastGiftAtUtc,
    Guid? LastCampaignId,
    string? LastCampaignName,
    string Currency,
    DateTimeOffset? FirstGiftAtUtc,
    decimal Reconciled);

/// <summary>One gift, as the Donor 360 Donations tab and the history export list it.</summary>
public sealed record DonationRecord(
    Guid Id,
    string Reference,
    DateTimeOffset DonatedAtUtc,
    decimal Amount,
    decimal RefundedAmount,
    string Currency,
    string Status,
    Guid? CampaignId,
    string? CampaignName);

/// <summary>What one donor gave to one campaign.</summary>
public sealed record CampaignGiving(
    Guid CampaignId,
    string? CampaignCode,
    string? CampaignName,
    decimal Amount,
    int GiftCount,
    DateTimeOffset LastGiftAtUtc);

/// <summary>
/// The donor's giving, as the PAYMENTS module recorded it.
///
/// WHY DON READS IT RATHER THAN KEEPING ITS OWN COPY. DON had a projection table for this -
/// <c>don_donor_donation_summaries</c> - and nothing ever wrote to it except the demonstration
/// seeder. A real gift taken through the donor form was recorded by PAY and never reached DON, so
/// every real donor showed "never given" and a lifetime of zero. Reading the source on demand
/// cannot drift from it, and a donor list page asks for at most a hundred donors at a time.
///
/// THE ARITHMETIC IS DEFINED HERE ONCE. Received is net of refunds; a voided gift counts for
/// nothing; a chargeback is money gone. Every screen that shows a giving figure gets it from here,
/// so the Donor List, Donor 360 and the exports cannot disagree with one another.
/// </summary>
public interface IDonationLedger
{
    /// <summary>Giving per donor, for the donors named. Donors who never gave are absent.</summary>
    Task<IReadOnlyDictionary<Guid, DonorGiving>> GetGivingAsync(
        Guid organisationId,
        IReadOnlyCollection<Guid> donorIds,
        CancellationToken cancellationToken = default);

    /// <summary>One donor's gifts, newest first.</summary>
    Task<IReadOnlyList<DonationRecord>> GetDonationsAsync(
        Guid organisationId,
        Guid donorId,
        int maximumRows,
        CancellationToken cancellationToken = default);

    /// <summary>One donor's giving, campaign by campaign.</summary>
    Task<IReadOnlyList<CampaignGiving>> GetCampaignGivingAsync(
        Guid organisationId,
        Guid donorId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// How many of these donors gave since an instant, and how much they gave in that time - the
    /// Donor List's "Gave in the last 90 days".
    /// </summary>
    Task<(int Donors, decimal Amount, string Currency)> GetPeriodGivingAsync(
        Guid organisationId,
        IReadOnlyCollection<Guid> donorIds,
        DateTimeOffset sinceUtc,
        CancellationToken cancellationToken = default);
}
