using YDot.PAY.Application.Common.Constants;
using YDot.PAY.Domain.Enums;

namespace YDot.PAY.Application.Features.Dashboard;

/// <summary>
/// The words, ranks and destinations of PAY's part of the landing page.
///
/// A ROUTE IS ONLY EVER SENT WITH THE PERMISSION ITS SCREEN ASKS FOR. Each screen below names the
/// code the client's route guard checks, and the handler drops the link for a caller without it -
/// a tile that leads to "you do not have access" is the broken screen the menu catalogue was
/// rebuilt to stop showing.
///
/// THE FINANCE SCREENS ARE NOT HERE. Finance Workbench, Reconciliation and Offline Donation Entry
/// are switched off in the menu catalogue because no service sits behind them - they render the
/// invented records their components hold. The page used to send "Record donation", refunds,
/// chargebacks and reconciliation there. Those figures are still reported; they simply lead
/// nowhere until a screen exists that works them, and "Record donation" became New Donation, the
/// screen the Donations menu itself offers.
///
/// RANKS ARE SHARED WITH IAM, CAM AND DON. Lower wins a tile; the rail shows the four lowest. The
/// numbers are chosen so an Organisation Admin, who receives every module's cards, sees Funds,
/// Gifts, Campaigns and Leads in that order - see the note on the contract.
/// </summary>
public static class PaymentDashboardCatalogue
{
    public const string Module = "PAY";

    /// <summary>The staff curve, rankings and supporters cover the last fortnight.</summary>
    public const int WindowDays = 14;

    /// <summary>A donor gives a few times a year, so their curve covers twelve months.</summary>
    public const int DonorMonths = 12;

    /// <summary>
    /// The most window rows read for the staff curve. Fourteen days of a very busy Organisation fit
    /// comfortably; past it the curve says it covers the newest gifts only rather than pretending.
    /// </summary>
    public const int MaximumWindowRows = 50_000;

    /// <summary>A donor's whole history, bounded all the same.</summary>
    public const int MaximumDonorRows = 5_000;

    /// <summary>Rows in the latest-donations feed.</summary>
    public const int FeedRows = 6;

    /// <summary>A screen this module's tiles lead to, and the permission its route guard asks for.</summary>
    public sealed record Screen(string Route, string Permission);

    public static readonly Screen PaymentsAndReceipts =
        new("/app/donations/payment-event-queue", PermissionCodes.PaymentsViewEvents);

    /// <summary>The Donations menu's own "New Donation" - the screen that starts a gift.</summary>
    public static readonly Screen NewDonation =
        new("/app/donations/public-donation-initiation", PermissionCodes.IntentsCreate);

    // Screens of other modules a payment tile leads to. The codes are the ones the client's guards
    // check for those routes; PAY grants none of them, it only reads them off the caller's token.
    public static readonly Screen CampaignRegister =
        new("/app/fundraising/campaigns/campaign-register", "cam.campaigns.view");

    public static readonly Screen TrackingAssetManager =
        new("/app/fundraising/campaigns/tracking-asset-manager", "cam.tracking-assets.view");

    public static readonly Screen DonorList =
        new("/app/fundraising/relationships/donor-list", "don.donors.view");

    /// <summary>Lower wins. See the note on the class.</summary>
    public static class Ranks
    {
        public const int Funds = 10;
        public const int Gifts = 20;
        public const int DonorReceipts = 25;
        public const int DonorToFinish = 26;

        public const int ReceiptsIssued = 20;
        public const int OpenRefunds = 60;
        public const int OpenChargebacks = 70;

        /// <summary>PAY's own tiles for staff - nothing outranks money on Giving or Donation health.</summary>
        public const int StaffPanel = 10;

        /// <summary>A donor's tiles. They are the only ones a donor receives, so any rank wins.</summary>
        public const int DonorPanel = 30;

        public const int NewDonation = 30;
    }

    /// <summary>The donation states as the health donut groups them.</summary>
    public static class Slices
    {
        public const string Settled = "Settled";
        public const string AwaitingSettlement = "Awaiting settlement";
        public const string Refunded = "Refunded";
        public const string ChargedBack = "Charged back";
    }

    /// <summary>
    /// The colour a donation's state reads in. The same four tones the health donut uses, so a
    /// settled gift in the feed is the colour of the settled slice.
    /// </summary>
    public static string ToneOf(DonationStatus status) => status switch
    {
        DonationStatus.Settled => "ok",
        DonationStatus.Recorded => "wait",
        DonationStatus.PartiallyRefunded or DonationStatus.Refunded => "warn",
        DonationStatus.ChargedBack => "bad",
        _ => "mute"
    };

    /// <summary>The glyph for how a gift was paid.</summary>
    public static string IconOf(PaymentMethodType? method) => method switch
    {
        PaymentMethodType.Upi => "ri-qr-code-line",
        PaymentMethodType.Card => "ri-bank-card-line",
        PaymentMethodType.NetBanking or PaymentMethodType.BankTransfer => "ri-bank-line",
        PaymentMethodType.Wallet => "ri-wallet-3-line",
        PaymentMethodType.Cash => "ri-money-rupee-circle-line",
        PaymentMethodType.Cheque => "ri-file-list-3-line",
        PaymentMethodType.DirectDebit => "ri-repeat-line",
        _ => "ri-hand-coin-line"
    };

    /// <summary>
    /// Whether a method is paid through a payment provider rather than handed over in person.
    /// A donor's "paid online" share counts these.
    /// </summary>
    public static bool IsOnline(PaymentMethodType? method) => method is
        PaymentMethodType.Card or PaymentMethodType.NetBanking or PaymentMethodType.Upi
        or PaymentMethodType.Wallet or PaymentMethodType.DirectDebit;

    /// <summary>What a gift with no campaign is filed under.</summary>
    public const string GeneralGiving = "General giving";

    /// <summary>What a gift with no donor name is shown as.</summary>
    public const string Anonymous = "Anonymous";
}
