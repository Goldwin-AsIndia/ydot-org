using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.PAY.Application.Common.Abstractions.Services;
using YDot.PAY.Application.Common.Settings;
using YDot.PAY.Domain.Common;
using YDot.PAY.Domain.Entities;
using YDot.PAY.Domain.Enums;
using static YDot.PAY.Infrastructure.Persistence.Seed.DemoDonationCatalogue;

namespace YDot.PAY.Infrastructure.Persistence.Seed;

/// <summary>What one attempt at seeding the demonstration donations came to.</summary>
public enum DemoSeedOutcome
{
    /// <summary><c>PaymentSettings:SeedSampleDonations</c> is off. Nothing was looked at.</summary>
    Disabled,

    /// <summary>IAM has not created and activated an Organisation yet. Try again shortly.</summary>
    Waiting,

    /// <summary>Every Organisation in the catalogue holds its demonstration donations.</summary>
    Completed
}

/// <summary>
/// Writes <see cref="DemoDonationCatalogue"/> into the two activated sample Organisations.
///
/// EVERY GIFT IS ASSEMBLED THE WAY A REAL ONE IS, not written straight into a register. Each has
/// an intent carrying what the donor typed, one or two attempts against the gateway, and a
/// gateway event behind each attempt with the attempt's own reference on it; a gift that went
/// through additionally has a donation, a numbered receipt and a record of how the receipt was
/// delivered. A row that skipped any of those would draw on Payments and Receipts and then behave
/// differently from a real one the moment somebody pressed a button on it.
///
/// THE RECEIPT NUMBERS COME FROM THE REAL SEQUENCE. Tax authorities expect an Organisation's
/// receipts to run unbroken through a financial year, and the product allocates them from a
/// counter row for exactly that reason. The demonstration receipts take the next numbers from
/// that same counter, in the order the gifts were made, and leave it pointing at the last one -
/// so the first real receipt issued afterwards follows on rather than colliding.
///
/// IT WAITS FOR IAM AND FOR NOTHING ELSE. The Organisation's id is IAM's to generate; every
/// other id here - the campaign, the tracking asset, the donor, the lead - is derived, so CAM and
/// DON need not have seeded first.
///
/// ONCE PER ORGANISATION, AND ALL OF IT OR NONE. An Organisation that already holds any
/// demonstration donation is left exactly as it is, and one Organisation's set is one save.
///
/// THE ROWS ARE WRITTEN AS BUILT. <see cref="SaveAsBuiltAsync"/> goes round the context's audit
/// stamp, which would otherwise set every CreatedAtUtc to this minute and put two months of
/// giving on one afternoon.
/// </summary>
public sealed class DemoDonationSeeder(
    PaymentDbContext context,
    IOptions<PaymentSettings> paymentOptions,
    IDateTimeProvider clock,
    ILogger<DemoDonationSeeder> logger)
{
    /// <summary>India and the Indian Rupee, seed constants in IAM's global master catalogue.</summary>
    private static readonly Guid IndiaCountryId = Guid.Parse("11111111-1111-1111-1111-111111111001");

    private static readonly Guid InrCurrencyId = Guid.Parse("55555555-5555-5555-5555-555555555001");

    /// <summary>The offset the gifts' times of day are chosen in: the donors give in IST.</summary>
    private static readonly TimeSpan IndiaOffset = TimeSpan.FromMinutes(330);

    private const string Currency = "INR";

    /// <summary>What the public donation form records as the notice a donor agreed to.</summary>
    private const string ConsentVersion = "Privacy Notice v3.2 · Consent Terms v1.4";

    /// <summary>The gateway's charge on a captured payment: two per cent, plus GST on the fee.</summary>
    private const decimal GatewayFeeRate = 0.0236m;

    private readonly PaymentSettings _settings = paymentOptions.Value;

    public async Task<DemoSeedOutcome> SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_settings.SeedSampleDonations)
        {
            return DemoSeedOutcome.Disabled;
        }

        var waiting = false;

        foreach (var organisation in Organisations)
        {
            waiting |= !await SeedOrganisationAsync(organisation, cancellationToken);
        }

        return waiting ? DemoSeedOutcome.Waiting : DemoSeedOutcome.Completed;
    }

    /// <summary>False means "not yet": IAM has not created and activated the Organisation.</summary>
    private async Task<bool> SeedOrganisationAsync(
        DemoOrganisation organisation, CancellationToken cancellationToken)
    {
        var tenant = await ReadTenantAsync(organisation.Subdomain, cancellationToken);

        if (tenant is null)
        {
            return false;
        }

        var keyed = organisation.Gifts
            .Select((gift, index) => (Gift: gift, Key: $"{index + 1:000}|{gift.Donor}|{gift.Campaign}"))
            .ToList();

        var intentIds = keyed.Select(item => DemoIds.Of("intent", organisation.Subdomain, item.Key)).ToList();

        var alreadySeeded = await context.DonationIntents
            .IgnoreQueryFilters()
            .AnyAsync(intent => intent.TenantId == tenant.Id && intentIds.Contains(intent.Id),
                cancellationToken);

        if (alreadySeeded)
        {
            return true;
        }

        var now = clock.UtcNow;
        var places = await ReadPlacesAsync(cancellationToken);
        var givers = organisation.Givers.ToDictionary(giver => giver.Email, StringComparer.OrdinalIgnoreCase);

        var counters = await context.ReceiptNumberCounters
            .Where(counter => counter.TenantId == tenant.Id)
            .ToDictionaryAsync(counter => counter.FinancialYear, cancellationToken);

        var batch = new Batch(organisation, tenant, now, places, counters);
        var paid = 0;

        // IN THE ORDER THE GIFTS WERE MADE, because that is the order their receipts are numbered
        // in. A register whose receipt numbers ran against the dates would be the first thing an
        // auditor queried.
        foreach (var (gift, key) in keyed.OrderBy(item => Resolve(item.Gift.At, now)))
        {
            AddGift(batch, gift, key, givers[gift.Donor], ref paid);
        }

        AddUnmatchedEvent(batch);

        await SaveAsBuiltAsync(cancellationToken);

        logger.LogInformation(
            "Seeded the demonstration donations for {Subdomain}: {Total} payment(s), of which "
            + "{Paid} went through and were receipted.",
            organisation.Subdomain, keyed.Count, paid);

        return true;
    }

    // =============================================================================================
    // One gift
    // =============================================================================================

    private void AddGift(Batch batch, DemoGift gift, string key, DemoGiver giver, ref int paid)
    {
        var subdomain = batch.Organisation.Subdomain;
        var at = Resolve(gift.At, batch.Now);

        // The form was filled in a few minutes before the donor reached the payment page.
        var startedAt = at.AddMinutes(-4);
        var isCompany = giver.Pan.Length > 3 && giver.Pan[3] != 'P';
        var place = batch.Places.GetValueOrDefault(giver.City);
        var succeeded = gift.Outcome is DemoOutcome.Paid or DemoOutcome.PaidOnRetry;

        var intent = new DonationIntent
        {
            Id = DemoIds.Of("intent", subdomain, key),
            TenantId = batch.Tenant.Id,
            BusinessUnitId = batch.Tenant.BusinessUnitId,
            IntentReference = "INT-" + Token(Readable, 12, subdomain, key, "intent"),
            SourceType = gift.Source,
            CampaignId = DemoIds.Of("campaign", subdomain, gift.Campaign),
            TrackingAssetId = gift.Asset is null ? null : DemoIds.Of("tracking-asset", subdomain, gift.Asset),
            TrackingReference = gift.Asset is null ? null : DemoIds.TrackingReference(subdomain, gift.Asset),
            LeadId = gift.Lead is null ? null : DemoIds.Of("lead", subdomain, gift.Lead),

            // The donor record is linked once the money is in, which is when the product finds
            // or creates one - an unpaid intent names nobody yet.
            DonorId = succeeded ? DemoIds.Of("donor", subdomain, giver.Email) : null,

            DonorName = giver.Name,
            Email = giver.Email,
            NormalisedEmail = giver.Email.ToLowerInvariant(),
            Mobile = "+91" + giver.Mobile,
            TaxIdentifier = giver.Pan,
            AddressLine1 = giver.AddressLine1,
            AddressLine2 = giver.AddressLine2,
            CountryId = IndiaCountryId,
            StateId = place?.StateId,
            CityId = place?.CityId,
            PostalCode = giver.PostalCode,
            Amount = Money(gift.Amount),
            CurrencyId = InrCurrencyId,
            ConsentGiven = true,
            ConsentVersion = ConsentVersion,
            ConsentGivenAtUtc = startedAt,
            AllowPublicRecognition = isCompany,
            PublicRecognitionName = isCompany ? giver.Name : null,
            ExistingDonorMatched = !giver.NewDonor,
            ExistingDonorCheckedAtUtc = startedAt,
            CreatedAtUtc = startedAt,

            // Nobody was signed in: the donation form is public.
            CreatedByUserId = Guid.Empty,
            Version = 1
        };

        context.DonationIntents.Add(intent);

        PaymentAttempt Attempt(int number, PaymentAttemptStatus status, DateTimeOffset initiatedAt)
        {
            var attempt = new PaymentAttempt
            {
                Id = DemoIds.Of("attempt", subdomain, $"{key}|{number}"),
                TenantId = intent.TenantId,
                BusinessUnitId = intent.BusinessUnitId,
                DonationIntentId = intent.Id,
                AttemptNumber = number,
                Status = status,
                GatewayName = _settings.SeedGatewayName,
                GatewayReference = "pay_" + Token(Alphanumeric, 14, subdomain, key, $"payment{number}"),
                MethodType = gift.Method,
                MaskedInstrument = Instrument(gift.Method, giver, key),
                RequestedAmount = Money(gift.Amount),
                InitiatedAtUtc = initiatedAt,
                IdempotencyKey = Token(Hex, 32, subdomain, key, $"idempotency{number}"),
                CreatedAtUtc = initiatedAt,
                CreatedByUserId = Guid.Empty,
                Version = 1
            };

            intent.Attempts.Add(attempt);
            intent.AttemptCount = number;
            intent.LastAttemptAtUtc = initiatedAt;
            intent.UpdatedAtUtc = initiatedAt;
            intent.Version++;

            return attempt;
        }

        void Event(PaymentAttempt attempt, PaymentEventType type, DateTimeOffset occurredAt)
        {
            context.PaymentEvents.Add(new PaymentEvent
            {
                Id = DemoIds.Of("event", subdomain, $"{key}|{attempt.AttemptNumber}|{type}"),
                TenantId = intent.TenantId,
                BusinessUnitId = intent.BusinessUnitId,
                DonationIntentId = intent.Id,
                PaymentAttemptId = attempt.Id,
                EventType = type,
                Status = PaymentEventStatus.Processed,
                GatewayName = _settings.SeedGatewayName,
                GatewayEventId = "evt_" + Token(Alphanumeric, 14, subdomain, key, $"event{attempt.AttemptNumber}{type}"),
                GatewayReference = attempt.GatewayReference,
                Amount = Money(gift.Amount),
                OccurredAtUtc = occurredAt,
                ReceivedAtUtc = occurredAt.AddSeconds(2),
                ProcessedAtUtc = occurredAt.AddSeconds(3),

                // SIGNED, because a real event from the gateway is - and an unverified event is
                // deliberately never acted on.
                SignatureVerified = true,

                ProcessingAttempts = 1,
                CreatedAtUtc = occurredAt.AddSeconds(2),
                CreatedByUserId = Guid.Empty,
                Version = 1
            });

            intent.UpdatedAtUtc = occurredAt.AddSeconds(3);
        }

        PaymentAttempt Fail(int number, DateTimeOffset initiatedAt, Failure failure)
        {
            var attempt = Attempt(number, PaymentAttemptStatus.Failed, initiatedAt);

            attempt.FailedAtUtc = initiatedAt.AddSeconds(35);
            attempt.GatewayResultCode = failure.Code;
            attempt.GatewayMessage = failure.GatewayMessage;
            attempt.DonorFacingMessage = failure.DonorMessage;
            attempt.UpdatedAtUtc = attempt.FailedAtUtc;
            attempt.Version = 2;

            Event(attempt, PaymentEventType.Failed, attempt.FailedAtUtc.Value);

            return attempt;
        }

        PaymentAttempt Capture(int number, DateTimeOffset initiatedAt)
        {
            var attempt = Attempt(number, PaymentAttemptStatus.Succeeded, initiatedAt);

            attempt.AuthorisedAtUtc = initiatedAt.AddSeconds(8);
            attempt.CapturedAtUtc = initiatedAt.AddSeconds(20);
            attempt.CapturedAmount = Money(gift.Amount);
            attempt.GatewayResultCode = "captured";
            attempt.UpdatedAtUtc = attempt.CapturedAtUtc;
            attempt.Version = 2;

            Event(attempt, PaymentEventType.Captured, attempt.CapturedAtUtc.Value);

            return attempt;
        }

        switch (gift.Outcome)
        {
            case DemoOutcome.Paid:
                AddDonation(batch, gift, key, giver, intent, Capture(1, at), ++paid);
                break;

            case DemoOutcome.PaidOnRetry:
                Fail(1, at, FirstTryFailure(gift.Method));
                AddDonation(batch, gift, key, giver, intent, Capture(2, at.AddMinutes(12)), ++paid);
                break;

            case DemoOutcome.Failed:
                intent.Status = DonationIntentStatus.Failed;
                intent.FailureReason = Fail(1, at, FinalFailure(gift.Method)).GatewayMessage;
                break;

            case DemoOutcome.FailedTwice:
                Fail(1, at, FinalFailure(gift.Method));
                intent.Status = DonationIntentStatus.Failed;
                intent.FailureReason = Fail(2, at.AddMinutes(25), FinalFailure(gift.Method)).GatewayMessage;
                break;

            case DemoOutcome.Authorised:
            {
                var attempt = Attempt(1, PaymentAttemptStatus.Authorised, at);

                attempt.AuthorisedAtUtc = at.AddSeconds(8);
                attempt.GatewayResultCode = "authorized";
                Event(attempt, PaymentEventType.Authorised, attempt.AuthorisedAtUtc.Value);

                intent.Status = DonationIntentStatus.PaymentInProgress;
                break;
            }

            case DemoOutcome.TimedOut:
            {
                // UNKNOWN IS NOT FAILURE. The bank authorised the payment and then the gateway
                // stopped answering, so the attempt is to be verified with the provider - never
                // retried, because retrying an attempt that in fact succeeded charges twice.
                var attempt = Attempt(1, PaymentAttemptStatus.TimedOut, at);

                attempt.AuthorisedAtUtc = at.AddSeconds(8);
                attempt.GatewayMessage =
                    "No response from the gateway within the timeout; the outcome is being verified.";
                attempt.DonorFacingMessage =
                    "We are confirming your payment with your bank. Please do not pay again.";
                Event(attempt, PaymentEventType.Authorised, attempt.AuthorisedAtUtc.Value);

                intent.Status = DonationIntentStatus.PaymentInProgress;
                break;
            }

            case DemoOutcome.Expired:
            {
                var attempt = Attempt(1, PaymentAttemptStatus.Abandoned, at);
                var expiredAt = at.AddMinutes(_settings.DefaultPaymentLinkValidityMinutes);

                attempt.GatewayResultCode = "expired";
                Event(attempt, PaymentEventType.Expired, expiredAt);

                intent.Status = DonationIntentStatus.Expired;
                intent.PaymentLinkExpiresAtUtc = expiredAt;
                break;
            }

            case DemoOutcome.Cancelled:
            {
                var attempt = Attempt(1, PaymentAttemptStatus.Abandoned, at);

                attempt.GatewayResultCode = "cancelled";
                attempt.DonorFacingMessage = "You cancelled this payment. No money has left your account.";
                Event(attempt, PaymentEventType.Cancelled, at.AddSeconds(90));

                intent.Status = DonationIntentStatus.Cancelled;
                intent.CancellationReason = "The donor cancelled on the payment page.";
                break;
            }

            case DemoOutcome.AwaitingPayment:
            {
                // The donor closed the first payment page; a fresh link was issued and is still
                // inside its validity, waiting to be paid.
                var first = Attempt(1, PaymentAttemptStatus.Abandoned, at);

                first.GatewayResultCode = "cancelled";
                Event(first, PaymentEventType.Cancelled, at.AddMinutes(2));

                var reissuedAt = at.AddMinutes(10);
                var second = Attempt(2, PaymentAttemptStatus.Pending, reissuedAt);

                second.GatewayResultCode = "created";

                intent.Status = DonationIntentStatus.AwaitingPayment;
                intent.PaymentLinkExpiresAtUtc =
                    reissuedAt.AddMinutes(_settings.DefaultPaymentLinkValidityMinutes);
                break;
            }
        }
    }

    /// <summary>
    /// The donation a captured payment becomes, its receipt, and what happened to the donor's
    /// copy.
    ///
    /// SETTLED AND RECONCILED BY AGE, the way they really arrive: the gateway pays out two days
    /// after capture and finance matches the bank credit a day or so later. A gift from this week
    /// is therefore recorded and not yet settled, which is the gap the reconciled total in DON is
    /// there to show.
    /// </summary>
    private void AddDonation(
        Batch batch, DemoGift gift, string key, DemoGiver giver, DonationIntent intent,
        PaymentAttempt attempt, int sequence)
    {
        var subdomain = batch.Organisation.Subdomain;
        var donatedAt = attempt.CapturedAtUtc!.Value;
        var age = batch.Now - donatedAt;
        var settled = age >= TimeSpan.FromDays(3);
        var address = Address(giver);

        intent.Status = DonationIntentStatus.Paid;

        var donation = new Donation
        {
            Id = DemoIds.Of("donation", subdomain, key),
            TenantId = intent.TenantId,
            BusinessUnitId = intent.BusinessUnitId,
            DonationReference = "DON-" + Token(Readable, 12, subdomain, key, "donation"),
            DonationIntentId = intent.Id,
            PaymentAttemptId = attempt.Id,
            DonorId = intent.DonorId,
            CampaignId = intent.CampaignId,
            Amount = Money(gift.Amount),
            RefundedAmount = MoneyValue.Zero(Currency),
            CurrencyId = InrCurrencyId,
            DonorName = giver.Name,
            DonorEmail = giver.Email,
            DonorMobile = intent.Mobile,
            DonorTaxIdentifier = giver.Pan,
            DonorAddress = address,
            Status = settled ? DonationStatus.Settled : DonationStatus.Recorded,
            DonatedAtUtc = donatedAt,
            MethodType = gift.Method,
            GatewayReference = attempt.GatewayReference,
            SettlementStatus = settled ? SettlementStatus.Settled : SettlementStatus.Pending,
            ReconciliationStatus = ReconciliationStatus.Unreconciled,
            SourceType = gift.Source,
            TrackingAssetId = intent.TrackingAssetId,
            LeadId = intent.LeadId,
            CreatedAtUtc = donatedAt,
            CreatedByUserId = Guid.Empty,
            Version = 1
        };

        if (settled)
        {
            var settledAt = donatedAt.AddDays(2);
            var fee = decimal.Round(gift.Amount * GatewayFeeRate, 2, MidpointRounding.AwayFromZero);

            donation.SettledAtUtc = settledAt;

            // One batch per Organisation per day, which is how a gateway pays out.
            donation.SettlementBatchReference =
                "setl_" + Token(Alphanumeric, 14, subdomain, settledAt.ToString("yyyyMMdd"), "settlement");

            donation.GatewayFee = Money(fee);
            donation.NetAmount = Money(gift.Amount - fee);
            donation.UpdatedAtUtc = settledAt;
            donation.Version = 2;

            if (age >= TimeSpan.FromDays(5))
            {
                // Most match on their own. One in a dozen needs a person, and one is still open.
                (donation.ReconciliationStatus, donation.ReconciliationNote) = (sequence % 13) switch
                {
                    3 => (ReconciliationStatus.ManuallyResolved,
                        "Matched by hand: the bank narration carried the payer's own reference "
                        + "rather than the gateway reference."),
                    7 => (ReconciliationStatus.Discrepancy,
                        "The bank credit is short of the gateway report by the fee on this gift; "
                        + "raised with the gateway."),
                    _ => (ReconciliationStatus.Matched, (string?)null)
                };

                if (donation.ReconciliationStatus != ReconciliationStatus.Discrepancy)
                {
                    donation.ReconciledAtUtc = settledAt.AddDays(1);
                }

                donation.UpdatedAtUtc = settledAt.AddDays(1);
                donation.Version = 3;
            }
        }

        context.Donations.Add(donation);

        // ---- The receipt -----------------------------------------------------------------------
        var financialYear = clock.FinancialYearFor(donatedAt);
        var issuedAt = donatedAt.AddSeconds(5);

        var receipt = new Receipt
        {
            Id = DemoIds.Of("receipt", subdomain, key),
            TenantId = intent.TenantId,
            BusinessUnitId = intent.BusinessUnitId,
            DonationId = donation.Id,
            VersionNumber = 1,
            ReceiptNumber =
                $"{_settings.ReceiptNumberPrefix}/{financialYear}/{NextReceiptNumber(batch, financialYear):00000}",
            Status = ReceiptStatus.Issued,
            DeliveryStatus = gift.Receipt switch
            {
                DemoReceipt.Delivered => ReceiptDeliveryStatus.Delivered,
                DemoReceipt.Pending => ReceiptDeliveryStatus.Pending,
                DemoReceipt.Failed => ReceiptDeliveryStatus.Failed,
                _ => ReceiptDeliveryStatus.NotSent
            },
            FinancialYear = financialYear,
            Amount = Money(gift.Amount),
            DonorName = giver.Name,
            DonorEmail = giver.Email,
            DonorAddress = address,
            DonorTaxIdentifier = giver.Pan,

            // NAMED ON THE RECEIPT, so the campaign column on a successful row has something to
            // say. The product leaves this to a correction; a demonstration register that showed
            // a dash for every gift's campaign would hide the one link the page is asked about.
            CampaignOrFundName = batch.Organisation.Campaigns.GetValueOrDefault(gift.Campaign),

            OrganisationTaxReference = batch.Tenant.Pan,
            TaxExemptionReference = batch.Tenant.Pan is null ? null : $"{batch.Tenant.Pan}F20214",
            IssuedAtUtc = issuedAt,
            CreatedAtUtc = issuedAt,
            CreatedByUserId = Guid.Empty,
            Version = 1
        };

        context.Receipts.Add(receipt);

        if (gift.Receipt is DemoReceipt.None or DemoReceipt.NotSent)
        {
            return;
        }

        var attemptedAt = issuedAt.AddSeconds(3);

        var delivery = new ReceiptDelivery
        {
            Id = DemoIds.Of("receipt-delivery", subdomain, key),
            TenantId = intent.TenantId,
            BusinessUnitId = intent.BusinessUnitId,
            ReceiptId = receipt.Id,
            Channel = "Email",
            Destination = giver.Email,
            Status = receipt.DeliveryStatus,
            AttemptedAtUtc = attemptedAt,
            CreatedAtUtc = attemptedAt,
            CreatedByUserId = Guid.Empty,
            Version = 1
        };

        switch (gift.Receipt)
        {
            case DemoReceipt.Delivered:
                delivery.DeliveredAtUtc = attemptedAt.AddSeconds(4);
                delivery.ProviderReference = "msg_" + Token(Alphanumeric, 14, subdomain, key, "message");
                break;

            case DemoReceipt.Failed:
                delivery.FailureReason = sequence % 2 == 0
                    ? "The recipient's mail server rejected the message: the mailbox is full."
                    : "The recipient's mail server rejected the address as undeliverable.";
                break;
        }

        receipt.UpdatedAtUtc = delivery.DeliveredAtUtc ?? attemptedAt;
        receipt.Version = 2;

        context.ReceiptDeliveries.Add(delivery);
    }

    /// <summary>
    /// One gateway event that matched no attempt, which is the row a signed-in member of staff is
    /// there to investigate: a webhook carrying a payment reference this Organisation never
    /// issued. It belongs to no donor, so no donor ever sees it.
    /// </summary>
    private void AddUnmatchedEvent(Batch batch)
    {
        var subdomain = batch.Organisation.Subdomain;
        var occurredAt = Resolve(new DemoWhen(DemoPeriod.MinutesAgo, 180), batch.Now);

        context.PaymentEvents.Add(new PaymentEvent
        {
            Id = DemoIds.Of("event", subdomain, "unmatched"),
            TenantId = batch.Tenant.Id,
            BusinessUnitId = batch.Tenant.BusinessUnitId,
            EventType = PaymentEventType.Captured,
            Status = PaymentEventStatus.Failed,
            GatewayName = _settings.SeedGatewayName,
            GatewayEventId = "evt_" + Token(Alphanumeric, 14, subdomain, "unmatched", "event"),
            GatewayReference = "pay_" + Token(Alphanumeric, 14, subdomain, "unmatched", "payment"),
            Amount = Money(2_500m),
            OccurredAtUtc = occurredAt,
            ReceivedAtUtc = occurredAt.AddSeconds(2),
            SignatureVerified = true,
            ProcessingError =
                "No payment attempt carries this gateway reference, so the event could not be "
                + "applied to a donation. Held for review.",
            ProcessingAttempts = 3,
            CreatedAtUtc = occurredAt.AddSeconds(2),
            CreatedByUserId = Guid.Empty,
            UpdatedAtUtc = occurredAt.AddMinutes(10),
            Version = 4
        });
    }

    // =============================================================================================
    // What the gateway said
    // =============================================================================================

    private sealed record Failure(string Code, string GatewayMessage, string DonorMessage);

    /// <summary>Why a payment that was never completed was refused.</summary>
    private static Failure FinalFailure(PaymentMethodType method) =>
        method switch
        {
            PaymentMethodType.Card => new(
                "BAD_REQUEST_ERROR",
                "Payment failed: the card was declined by the issuing bank.",
                "Your bank declined this payment. No money has left your account."),
            PaymentMethodType.Upi => new(
                "GATEWAY_ERROR",
                "Payment failed: the UPI collect request was not approved in time.",
                "The UPI request timed out before it was approved. No money has left your account."),
            PaymentMethodType.Wallet => new(
                "BAD_REQUEST_ERROR",
                "Payment failed: insufficient balance in the wallet.",
                "Your wallet did not have enough balance for this payment."),
            _ => new(
                "BAD_REQUEST_ERROR",
                "Payment failed: the net banking session was closed before it completed.",
                "The bank's page was closed before the payment completed. No money has left your account.")
        };

    /// <summary>Why a first attempt failed where the donor then tried again and succeeded.</summary>
    private static Failure FirstTryFailure(PaymentMethodType method) =>
        method == PaymentMethodType.Card
            ? new(
                "BAD_REQUEST_ERROR",
                "Payment failed: 3-D Secure authentication was not completed.",
                "Your bank's verification step was not completed. Please try again.")
            : FinalFailure(method);

    /// <summary>
    /// The instrument as a gateway reports it: masked, and never enough to identify an account.
    /// </summary>
    private static string Instrument(PaymentMethodType method, DemoGiver giver, string key)
    {
        var pick = StableHash(giver.Email + method);

        switch (method)
        {
            case PaymentMethodType.Upi:
                var handle = giver.Email[..giver.Email.IndexOf('@')].Replace(".", string.Empty);
                string[] providers = ["okhdfcbank", "okicici", "oksbi", "okaxis", "ybl", "paytm"];

                return $"{handle[..Math.Min(2, handle.Length)]}****@{providers[pick % providers.Length]}";

            case PaymentMethodType.Card:
                string[] networks = ["Visa", "Mastercard", "RuPay"];

                return $"**** **** **** {1000 + (StableHash(key + giver.Email) % 9000)} ({networks[pick % networks.Length]})";

            case PaymentMethodType.NetBanking:
                string[] banks = ["HDFC", "ICIC", "SBIN", "UTIB", "KKBK"];

                return $"Net banking - {banks[pick % banks.Length]}";

            case PaymentMethodType.Wallet:
                string[] wallets = ["Paytm", "PhonePe", "Amazon Pay", "MobiKwik"];

                return $"{wallets[pick % wallets.Length]} wallet ****{giver.Mobile[^4..]}";

            default:
                return string.Empty;
        }
    }

    // =============================================================================================
    // Small things
    // =============================================================================================

    private sealed record TenantRow(Guid Id, Guid BusinessUnitId, string? Pan);

    private sealed record PlaceRow(Guid CityId, Guid StateId);

    /// <summary>Everything one Organisation's rows are built from.</summary>
    private sealed record Batch(
        DemoOrganisation Organisation,
        TenantRow Tenant,
        DateTimeOffset Now,
        IReadOnlyDictionary<string, PlaceRow> Places,
        Dictionary<string, ReceiptNumberCounter> Counters);

    /// <summary>
    /// The next receipt number of a financial year, taken from the Organisation's own counter
    /// row - which is tracked, so the save leaves it at the last number issued and the first real
    /// receipt afterwards follows on.
    /// </summary>
    private int NextReceiptNumber(Batch batch, string financialYear)
    {
        if (!batch.Counters.TryGetValue(financialYear, out var counter))
        {
            counter = new ReceiptNumberCounter
            {
                Id = DemoIds.Of("receipt-counter", batch.Organisation.Subdomain, financialYear),
                TenantId = batch.Tenant.Id,
                FinancialYear = financialYear,
                LastNumber = 0
            };

            batch.Counters[financialYear] = counter;
            context.ReceiptNumberCounters.Add(counter);
        }

        return ++counter.LastNumber;
    }

    private static MoneyValue Money(decimal amount) => MoneyValue.Create(amount, Currency);

    private static string Address(DemoGiver giver) =>
        string.Join(", ", new[] { giver.AddressLine1, giver.AddressLine2, $"{giver.City} {giver.PostalCode}" }
            .Where(part => !string.IsNullOrWhiteSpace(part)));

    /// <summary>No 0, O, 1, I or L - the alphabet the product mints its public references from.</summary>
    private const string Readable = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    private const string Alphanumeric = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    private const string Hex = "0123456789abcdef";

    /// <summary>
    /// A reference that looks minted and is in fact derived, so the same gift gets the same
    /// reference whenever it is seeded and no two gifts share one.
    /// </summary>
    private static string Token(string alphabet, int length, params string[] parts)
    {
        var hash = SHA512.HashData(Encoding.UTF8.GetBytes(string.Join('|', parts)));
        var characters = new char[length];

        for (var index = 0; index < length; index++)
        {
            characters[index] = alphabet[hash[index] % alphabet.Length];
        }

        return new string(characters);
    }

    /// <summary>A hash that is the same in every process, unlike <c>string.GetHashCode</c>.</summary>
    private static int StableHash(string value)
    {
        unchecked
        {
            var hash = 17;

            foreach (var character in value)
            {
                hash = (hash * 31) + character;
            }

            return hash & int.MaxValue;
        }
    }

    // =============================================================================================
    // Time
    // =============================================================================================

    /// <summary>
    /// Turns "the ninth of last month at half past nine" into a moment, from the moment the data
    /// is seeded.
    ///
    /// MONTHS ARE COUNTED IN INDIAN STANDARD TIME, because that is the calendar the donors give
    /// by and the one Payments and Receipts prints. A gift at one in the morning on the first is
    /// this month's in India while it is still last month's in UTC.
    ///
    /// NOTHING IS EVER IN THE FUTURE. A point part-way through this month is taken from the part
    /// of it that has already gone, so the gifts spread from the first to today whichever day
    /// today is - and on the first of a month they simply fall close together.
    /// </summary>
    private static DateTimeOffset Resolve(DemoWhen when, DateTimeOffset now)
    {
        var local = now.ToOffset(IndiaOffset);
        var monthStart = new DateTimeOffset(local.Year, local.Month, 1, 0, 0, 0, IndiaOffset);
        var latest = now.AddMinutes(-3);

        switch (when.Period)
        {
            case DemoPeriod.LastMonth:
                return monthStart.AddMonths(-1)
                    .AddDays(when.Value - 1)
                    .AddHours(when.Hour)
                    .AddMinutes(when.Minute)
                    .ToUniversalTime();

            case DemoPeriod.MinutesAgo:
            {
                var moment = now.AddMinutes(-when.Value);

                // Still this month, even where the month is only minutes old.
                return (moment > monthStart ? moment : monthStart + ((now - monthStart) / 2)).ToUniversalTime();
            }

            default:
            {
                var elapsed = latest - monthStart;

                if (elapsed <= TimeSpan.Zero)
                {
                    return latest.ToUniversalTime();
                }

                var moment = monthStart + TimeSpan.FromSeconds(Math.Floor(elapsed.TotalSeconds * when.Value));

                // People give during the day. A point that falls in the small hours is moved to
                // later the same morning, where that is still in the past.
                if (moment.Hour < 7)
                {
                    var morning = new DateTimeOffset(moment.Year, moment.Month, moment.Day, 7, 0, 0, IndiaOffset)
                        .AddMinutes(moment.Minute + (moment.Hour * 37));

                    if (morning < latest)
                    {
                        moment = morning;
                    }
                }

                return moment.ToUniversalTime();
            }
        }
    }

    // =============================================================================================
    // Saving, and reading what other modules own
    // =============================================================================================

    /// <summary>
    /// Saves the tracked rows exactly as they were built.
    ///
    /// THIS OVERLOAD IS CHOSEN ON PURPOSE. <see cref="PaymentDbContext"/> stamps CreatedAtUtc,
    /// CreatedByUserId and Version in its override of <c>SaveChangesAsync(CancellationToken)</c>,
    /// which is right for a request and wrong here: it would overwrite every backdated creation
    /// time with this minute. The two-argument overload is the one that override itself ends up
    /// calling, so going to it directly performs the same save without the stamp. Every row above
    /// therefore sets its own Organisation, creation time and version.
    /// </summary>
    private Task<int> SaveAsBuiltAsync(CancellationToken cancellationToken) =>
        context.SaveChangesAsync(acceptAllChangesOnSuccess: true, cancellationToken);

    /// <summary>
    /// The Organisation behind a subdomain, once IAM has created and activated it - by subdomain
    /// because that is the one name for an Organisation that is the same in every database. Its
    /// PAN comes with it, for the receipts to print.
    /// </summary>
    private async Task<TenantRow?> ReadTenantAsync(string subdomain, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT id, business_unit_id, pan_number FROM iam_tenants WHERE subdomain = @value AND status = 'Active' LIMIT 1",
            subdomain,
            reader => new TenantRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.IsDBNull(2) ? null : reader.GetString(2)),
            cancellationToken);

        return rows.FirstOrDefault();
    }

    /// <summary>The Indian cities of the global master, by name, each with its state.</summary>
    private async Task<IReadOnlyDictionary<string, PlaceRow>> ReadPlacesAsync(
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT city.name, city.id, city.state_province_id
            FROM gm_cities AS city
            INNER JOIN gm_state_provinces AS state ON state.id = city.state_province_id
            WHERE state.country_id = @value
            """,
            IndiaCountryId,
            reader => (Name: reader.GetString(0), Place: new PlaceRow(reader.GetGuid(1), reader.GetGuid(2))),
            cancellationToken);

        return rows
            .GroupBy(row => row.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First().Place, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Runs one read against a table another module owns.
    ///
    /// NOTHING HERE THROWS. Before IAM has created its schema the table does not exist at all,
    /// which is an ordinary state on a first start and not a fault - so a failed read is an empty
    /// answer, and the caller reports that it is still waiting.
    /// </summary>
    private async Task<List<TRow>> QueryAsync<TRow>(
        string sql, object value, Func<System.Data.Common.DbDataReader, TRow> map,
        CancellationToken cancellationToken)
    {
        var rows = new List<TRow>();
        var connection = context.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;

        try
        {
            if (opened)
            {
                await context.Database.OpenConnectionAsync(cancellationToken);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = sql;

            var parameter = command.CreateParameter();
            parameter.ParameterName = "value";
            parameter.Value = value;
            command.Parameters.Add(parameter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(map(reader));
            }
        }
        catch (Exception exception) when (exception is System.Data.Common.DbException or InvalidOperationException)
        {
            logger.LogDebug(
                exception,
                "A table the demonstration donations depend on could not be read yet. Expected "
                + "before IAM has created its schema; the seed is retried.");

            return [];
        }
        finally
        {
            if (opened && connection.State == System.Data.ConnectionState.Open)
            {
                await context.Database.CloseConnectionAsync();
            }
        }

        return rows;
    }
}
