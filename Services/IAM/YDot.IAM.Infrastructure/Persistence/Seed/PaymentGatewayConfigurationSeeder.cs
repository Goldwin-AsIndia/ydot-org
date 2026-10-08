using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.IAM.Application.Common.Abstractions.Services;
using YDot.IAM.Application.Common.Settings;
using YDot.IAM.Domain.Entities.Configuration;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Infrastructure.Persistence.Seed;

/// <summary>
/// Gives each sample Organisation a Razorpay configuration built from the deployment's test keys.
///
/// THE .env KEYS END UP IN THE TABLE, SEALED, AND THAT IS THE ONLY PLACE A PAYMENT READS THEM.
/// RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET reach this service as seed input. They are sealed with
/// the protector the Payment Configuration screen uses and written to
/// iam_payment_gateway_configurations, one row per Organisation. The payments service holds no
/// Razorpay key of its own: it opens the row belonging to the donation's Organisation at the
/// moment it takes the payment, so the seeded row and one an administrator types on the screen
/// are used in exactly the same way.
///
/// WHAT IT WILL AND WILL NOT DO:
///
///   * Only the sample Organisations from <see cref="SampleOrganisationCatalogue"/>. Sweeping the
///     tenant table would put one merchant account behind every charity on the platform.
///   * Only an Organisation with NO configuration at all. A row an administrator created, edited,
///     deactivated or replaced with another provider is theirs, and is never touched.
///   * Only a test key. A key that does not begin rzp_test_ is refused outright: an active row
///     for every Organisation is harmless when the worst case is a declined test charge, and not
///     when the key moves real money.
///
/// THE ROW IS A SANDBOX ROW AND IT IS ACTIVE, which is what the screen itself produces for a
/// test key saved with "Active" on. Each one is written with a "Created" line in its change log,
/// attributed to the seed rather than to a person, so the screen's history says where it came
/// from.
/// </summary>
public sealed class PaymentGatewayConfigurationSeeder(
    IamDbContext context,
    IPaymentSecretProtector protector,
    IOptions<SeedSettings> seedOptions,
    IOptions<ClientAppSettings> clientOptions,
    ILogger<PaymentGatewayConfigurationSeeder> logger)
{
    private const string TestKeyPrefix = "rzp_test_";

    private readonly SeedSettings _seed = seedOptions.Value;
    private readonly ClientAppSettings _client = clientOptions.Value;

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_seed.Enabled || !_seed.SeedSampleTenants || !_seed.SeedPaymentGateways)
        {
            return;
        }

        var keyId = _seed.RazorpayKeyId.Trim();
        var keySecret = _seed.RazorpayKeySecret.Trim();

        if (keyId.Length == 0 || keySecret.Length == 0)
        {
            logger.LogWarning(
                "Payment gateway seeding is on, but RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not "
                + "both set, so no Organisation was given a Razorpay configuration. Set both in .env "
                + "and restart, or configure each Organisation on the Payment Configuration screen.");

            return;
        }

        if (!keyId.StartsWith(TestKeyPrefix, StringComparison.Ordinal))
        {
            logger.LogWarning(
                "Payment gateway seeding is on, but RAZORPAY_KEY_ID is not a test key (rzp_test_). "
                + "Refusing to seed it: configure live keys deliberately, per Organisation, on the "
                + "Payment Configuration screen.");

            return;
        }

        var subdomains = SampleOrganisationCatalogue.Organisations
            .Select(sample => sample.Subdomain)
            .ToList();

        var organisations = await context.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(tenant => subdomains.Contains(tenant.Subdomain))
            .Select(tenant => new { tenant.Id, tenant.BusinessUnitId, tenant.Name, tenant.DefaultCurrency })
            .ToListAsync(cancellationToken);

        var alreadyConfigured = (await context.PaymentGatewayConfigurations
                .IgnoreQueryFilters()
                .Select(configuration => configuration.TenantId)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var webhookSecret = _seed.RazorpayWebhookSecret.Trim();
        var now = DateTimeOffset.UtcNow;
        var seeded = new List<string>();

        foreach (var organisation in organisations.Where(row => !alreadyConfigured.Contains(row.Id)))
        {
            var configuration = new PaymentGatewayConfiguration
            {
                TenantId = organisation.Id,
                BusinessUnitId = organisation.BusinessUnitId,
                Provider = PaymentGatewayProvider.Razorpay,
                Environment = PaymentGatewayEnvironment.Sandbox,
                DisplayName = "Razorpay test account",

                ApiKeyCipher = protector.Protect(keyId),
                ApiKeyHint = protector.Hint(keyId),
                SecretKeyCipher = protector.Protect(keySecret),
                HasSecretKey = true,
                WebhookSecretCipher = protector.Protect(webhookSecret),
                HasWebhookSecret = webhookSecret.Length > 0,

                // The address the screen's "Use ours" button fills in, so editing a seeded row
                // does not start with a field to correct.
                WebhookUrl = $"{_client.BaseUrl.TrimEnd('/')}/pay-api/webhooks/razorpay",
                SubscribedEvents = "payment.failure,payment.success",

                SettlementCurrencyCode = string.IsNullOrWhiteSpace(organisation.DefaultCurrency)
                    ? "INR"
                    : organisation.DefaultCurrency.Trim().ToUpperInvariant(),
                PaymentLinkValidityMinutes = 60,
                EnabledMethods = "card,netbanking,upi,wallet",
                IsActive = true,
                Notes = "Seeded from RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the deployment's .env. "
                        + "Razorpay test mode: replace it with this organisation's own keys before "
                        + "taking real donations.",
                CreatedByUserId = Guid.Empty
            };

            await context.PaymentGatewayConfigurations.AddAsync(configuration, cancellationToken);

            await context.PaymentGatewayConfigurationAudits.AddAsync(new PaymentGatewayConfigurationAudit
            {
                TenantId = configuration.TenantId,
                BusinessUnitId = configuration.BusinessUnitId,
                ConfigurationId = configuration.Id,
                Provider = configuration.Provider,
                Environment = configuration.Environment,
                Action = PaymentGatewayConfigurationAction.Created,
                NewValue = "Razorpay / Sandbox (active)",
                ActorUserId = null,
                ActorDisplayName = "System seed",
                OccurredAtUtc = now,
                Reason = "Seeded from the deployment's Razorpay test keys.",
                CreatedByUserId = Guid.Empty
            }, cancellationToken);

            seeded.Add(organisation.Name);
        }

        if (seeded.Count == 0)
        {
            return;
        }

        await context.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Seeded a Razorpay test configuration ({KeyHint}) for {Count} organisation(s): {Organisations}.",
            protector.Hint(keyId),
            seeded.Count,
            string.Join(", ", seeded));
    }
}
