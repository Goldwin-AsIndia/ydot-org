using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.PAY.Application.Common.Settings;
using YDot.PAY.Domain.Entities;

namespace YDot.PAY.Infrastructure.Gateway;

/// <summary>
/// Resolves a gateway credential from the Organisation's own configuration, and from nowhere
/// else.
///
/// THE CREDENTIAL COMES FROM THE ORGANISATION'S ROW IN iam_payment_gateway_configurations - the
/// Payment Configuration screen's table, where IAM seals it (from an administrator's entry, or
/// from the deployment's test keys at seed time). It is opened here, at the moment of use, with
/// the key the two services share.
///
/// THERE IS NO FALL-BACK TO A DEPLOYMENT KEY. There used to be: an Organisation with no
/// configuration, or one whose credential would not open, was silently paid with
/// <c>PaymentGateways:{reference}:ApiKey</c> from this service's environment. That made a
/// payment look healthy while it settled into whichever merchant account the environment named -
/// for a shared default, somebody else's - and it hid a credential IAM and PAY could no longer
/// agree on behind a donation that still worked. Now either the Organisation's own credential is
/// used, or no payment is attempted and the caller reports PAYMENT_GATEWAY_NOT_CONFIGURED.
///
/// THE ORGANISATION IS CHECKED BEFORE ANYTHING IS OPENED. The account must belong to the
/// Organisation the configuration belongs to, and must name that configuration row - the marker
/// <see cref="ConfiguredGatewayAccountRepository"/> writes into <c>ApiKeyReference</c>. An account
/// that arrived any other way is refused rather than paired with whichever row the Organisation
/// has now.
///
/// <see cref="GatewayConfigurationSettings.UseTenantConfiguration"/> false is the one way back to
/// the deployment's credentials, and it is a restart with that setting changed, never a
/// fall-through.
/// </summary>
internal sealed class TenantConfiguredCredentialResolver(
    ConfigurationGatewayCredentialResolver fallback,
    TenantGatewayConfigurationReader configurations,
    GatewayCredentialUnsealer unsealer,
    IOptions<GatewayConfigurationSettings> settings,
    IConfiguration deploymentConfiguration,
    ILogger<TenantConfiguredCredentialResolver> logger) : IGatewayCredentialResolver
{
    /// <summary>
    /// The marker written into <c>ApiKeyReference</c> by
    /// <see cref="ConfiguredGatewayAccountRepository"/>.
    ///
    /// WHY A MARKER RATHER THAN A NULL. Null already means "no credential configured" and is
    /// reported to a donor as PAYMENT_GATEWAY_NOT_CONFIGURED; reusing it would make an
    /// Organisation that HAS configured a gateway indistinguishable from one that has not. The
    /// prefix says "look in the tenant configuration", and the configuration id after it makes a
    /// log line traceable to the row it came from - and is checked against the row
    /// <see cref="Resolve"/> opens, so a credential is only ever paired with the account built
    /// from it.
    /// </summary>
    private const string ReferencePrefix = "tenant-config:";

    private readonly GatewayConfigurationSettings _settings = settings.Value;

    /// <summary>The marker for one configuration.</summary>
    public static string ReferenceFor(TenantGatewayConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        return ReferencePrefix + configuration.Id.ToString("N");
    }

    public GatewayCredential? Resolve(PaymentGatewayAccount account)
    {
        ArgumentNullException.ThrowIfNull(account);

        if (!_settings.UseTenantConfiguration)
        {
            return fallback.Resolve(account);
        }

        var configuration = configurations.GetActive(account.TenantId);

        if (configuration is null)
        {
            logger.LogWarning(
                "Organisation {TenantId} has no active payment gateway configuration, so there is "
                + "no credential to take a payment with. Configure one on the Payment "
                + "Configuration screen.",
                account.TenantId);

            return null;
        }

        if (configuration.TenantId != account.TenantId
            || !string.Equals(account.ApiKeyReference, ReferenceFor(configuration), StringComparison.Ordinal))
        {
            logger.LogError(
                "Refused a credential for gateway account {AccountId}: it does not name "
                + "organisation {TenantId}'s active gateway configuration {ConfigurationId}. No "
                + "payment request was made with it.",
                account.Id,
                account.TenantId,
                configuration.Id);

            return null;
        }

        var credential = Build(configuration);

        if (credential is null)
        {
            // Blank, or sealed with a key this service cannot derive - the unsealer has already
            // said which. Refused rather than replaced with another key.
            logger.LogError(
                "Organisation {TenantId} has an active {Provider} gateway configuration "
                + "({ConfigurationId}), but no usable credential could be read from it. Payments "
                + "for this organisation are refused until it is corrected.",
                account.TenantId,
                configuration.Provider,
                configuration.Id);
        }

        return credential;
    }

    /// <summary>
    /// Turns a configuration row into the credential the adapters want.
    ///
    /// THE API KEY IS ASSEMBLED AS <c>key:secret</c>, which is the shape
    /// <see cref="RazorpayGateway"/> splits on for HTTP Basic authentication and for handing the
    /// key id - the half that may be published - to Checkout in the browser. The secret after the
    /// colon never leaves this process.
    /// </summary>
    private GatewayCredential? Build(TenantGatewayConfiguration configuration)
    {
        var apiKey = unsealer.Unseal(configuration.ApiKeyCipher);

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return null;
        }

        var secret = unsealer.Unseal(configuration.SecretKeyCipher);

        var composed = string.IsNullOrWhiteSpace(secret) ? apiKey : $"{apiKey}:{secret}";

        var webhookSecret = unsealer.Unseal(configuration.WebhookSecretCipher);

        var baseUrl = BaseUrlFor(configuration);

        // THE GENERIC ADAPTER HAS NO DEFAULT ADDRESS TO FALL BACK ON, unlike the provider
        // adapters: "hosted checkout" is whatever endpoint the deployment stood up, so a blank
        // base URL there is not a gap to paper over - it is a configuration this service cannot
        // act on, and building a request against an empty address would throw on the donation
        // path. Declining here means no payment request is made at all.
        if (string.IsNullOrWhiteSpace(baseUrl)
            && string.Equals(configuration.Provider, "HostedCheckout", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        return new GatewayCredential(baseUrl, composed, webhookSecret);
    }

    /// <summary>
    /// Where the provider's API lives.
    ///
    /// THE CONFIGURATION SCREEN DOES NOT ASK FOR THIS, AND SHOULD NOT. A base URL is a property
    /// of the provider, not of the merchant; a form that let somebody type one would let somebody
    /// type a URL that is not the provider's, and a merchant credential posted to an attacker's
    /// host is the worst outcome this whole feature can produce.
    ///
    /// So it comes from the deployment's own configuration -
    /// <c>PaymentGateways:{provider}:BaseUrl</c> - and otherwise from the adapter's built-in
    /// default. That is the ordinary case: every adapter already knows its provider's address,
    /// and RazorpayGateway substitutes api.razorpay.com for a blank one.
    /// </summary>
    private string BaseUrlFor(TenantGatewayConfiguration tenantConfiguration)
    {
        var configured =
            deploymentConfiguration[$"PaymentGateways:{tenantConfiguration.Provider}:BaseUrl"]
            ?? deploymentConfiguration["PaymentGateways:Default:BaseUrl"];

        return string.IsNullOrWhiteSpace(configured) ? string.Empty : configured;
    }
}
