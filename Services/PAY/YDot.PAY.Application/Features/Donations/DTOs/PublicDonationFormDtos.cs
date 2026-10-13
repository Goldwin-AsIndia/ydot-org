namespace YDot.PAY.Application.Features.Donations.DTOs;

/// <summary>
/// GET /api/public/donations/form-settings - what the donation forms show and check before an
/// intent exists.
///
/// SERVED, NOT TYPED INTO THE PAGES. Both donation forms read these from a client-side constant:
/// a consent version naming no published notice (and sent back to be stored on every intent), a
/// time zone, and an amount ceiling of five lakh while the server's own limit was ten million.
/// They come from PaymentSettings now, the same values the server records and enforces.
/// </summary>
public sealed record PublicDonationFormSettingsResponse(
    /// <summary>The privacy notice a consent given now is recorded against - stamped by the server.</summary>
    string ConsentNoticeVersion,

    /// <summary>The notice as a person reads it, for the consent line's tooltip.</summary>
    string ConsentNoticeLabel,

    /// <summary>The largest single donation the server accepts.</summary>
    decimal MaximumDonationAmount,

    /// <summary>The IANA zone dates are printed in, e.g. Asia/Kolkata.</summary>
    string OperatingTimeZone,

    /// <summary>The zone with its offset, e.g. "Asia/Kolkata · UTC+05:30".</summary>
    string OperatingTimeZoneLabel,

    DateTimeOffset AsAtUtc,

    /// <summary>What a donor may do on the form: Submit, ContinueToPayment.</summary>
    IReadOnlyList<string> PermittedActions);
