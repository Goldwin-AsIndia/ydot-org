namespace YDot.IAM.Application.Common.Settings;

/// <summary>
/// Controls what a fresh database is initialised with.
///
/// The seeder is idempotent: it reconciles rather than inserting blindly, so it can run on
/// every start without duplicating anything. That is what lets a new permission or menu node
/// appear simply by deploying, with no hand-written migration.
/// </summary>
public sealed class SeedSettings
{
    public const string SectionName = "SeedSettings";

    /// <summary>Master switch for everything below.</summary>
    public bool Enabled { get; set; } = true;

    // ---- BusinessUnit -------------------------------------------------------------------
    public string BusinessUnitCode { get; set; } = "BU001";

    public string BusinessUnitName { get; set; } = "NGoPlanet";

    /// <summary>The apex domain every Organisation subdomain hangs off.</summary>
    public string RootDomain { get; set; } = "ngoplanet.com";

    /// <summary>
    /// Where the platform's own notices go - an Organisation waiting for review, for one. Written
    /// to the business unit as its contact and support address when the unit is first created.
    ///
    /// SEPARATE FROM THE PLATFORM ADMIN'S ADDRESS, because it is a mailbox and not an account. It
    /// used to be the same setting, so the root account's address had to be a real inbox. Blank
    /// falls back to <see cref="SuperAdminEmail"/>.
    /// </summary>
    public string PlatformContactEmail { get; set; } = string.Empty;

    // ---- The Platform Admin ---------------------------------------------------------------
    //
    // THE ONE PLATFORM ADMIN. The platform has exactly one account at platform level, and these
    // settings describe it. There used to be two - a system account called "superadmin" and a
    // named administrator beside it - and the named one is now the only one: Vikram Anand, the
    // platform operations lead. Changing these on a database that already has its Platform Admin
    // changes that account; it never adds a second. See IamDbSeeder.SeedSuperAdminAsync.
    public string SuperAdminEmail { get; set; } = "vikram.anand@ngoplanet.test";

    public string SuperAdminUsername { get; set; } = "vikram.anand";

    public string SuperAdminFirstName { get; set; } = "Vikram";

    public string SuperAdminLastName { get; set; } = "Anand";

    /// <summary>Job title shown on the account. Optional.</summary>
    public string SuperAdminDesignation { get; set; } = "Platform Operations Lead";

    /// <summary>Ten subscriber digits; the country code is +91. Optional.</summary>
    public string SuperAdminMobile { get; set; } = string.Empty;

    /// <summary>
    /// Development convenience only. In any real deployment leave this empty and the seeder
    /// creates the account with no password, so the only way in is the invitation link.
    /// </summary>
    public string SuperAdminPassword { get; set; } = string.Empty;

    // ---- Sample Organisations -------------------------------------------------------------
    /// <summary>
    /// Creates the demonstration Organisations and their people - listed in
    /// <c>SampleOrganisationCatalogue</c> in the Infrastructure seed folder.
    /// </summary>
    public bool SeedSampleTenants { get; set; } = true;

    /// <summary>
    /// The id given to the first activated sample Organisation - Smile Foundation - rather
    /// than a generated one.
    ///
    /// WHY THIS IS CONFIGURATION AND NOT A GENERATED GUID. It gives one Organisation the same id
    /// in every database, which is what lets a script, a bookmark or a support note written
    /// against one environment name it in another.
    ///
    /// NOTHING ELSE HAS TO AGREE WITH IT ANY MORE. CAM, DON and PAY used to stamp their
    /// demonstration data with their own copy of this value, and a copy that differed put those
    /// rows where no real user's token could reach them - present in the database and returned
    /// to nobody. Each of them now finds its Organisations by SUBDOMAIN in this module's own
    /// table when it seeds, which also covers HelpAge India, whose id is generated.
    ///
    /// It is only ever read on a database that has never been seeded. Changing it afterwards
    /// renames nothing and moves nothing - the Organisation keeps the id it was created with.
    /// </summary>
    public Guid SampleOrganisationId { get; set; } =
        Guid.Parse("9fb11890-a08e-4adc-95ca-8e4d71f4dd21");

    /// <summary>
    /// The password shared by every seeded Organisation account - administrators, staff and
    /// donors.
    ///
    /// Separate from the Platform Admin's password on purpose: these are demonstration logins
    /// that appear in a document, and the platform's credential should not be the same string as
    /// something written in a guide. Leave it empty and only the Organisation
    /// administrators are seeded, which is what any deployment that is not a demonstration
    /// should do.
    /// </summary>
    public string RoleAccountPassword { get; set; } = string.Empty;

    /// <summary>Seeds the global permission catalogue and the menu catalogue.</summary>
    public bool SeedCatalogues { get; set; } = true;

    // ---- Payment gateway ----------------------------------------------------------------
    /// <summary>
    /// Gives every sample Organisation a Razorpay configuration on the Payment Configuration
    /// screen, built from the three keys below - see <c>PaymentGatewayConfigurationSeeder</c>.
    ///
    /// THE KEYS ARE SEED INPUT AND NOTHING ELSE. They are sealed into
    /// iam_payment_gateway_configurations, one row per Organisation, and the payments service
    /// takes every payment with the row belonging to the donation's Organisation. No service
    /// reads them from the environment at payment time.
    ///
    /// OFF BY DEFAULT: it is a development convenience, and only a test key (rzp_test_) is ever
    /// seeded, whatever this says.
    /// </summary>
    public bool SeedPaymentGateways { get; set; }

    /// <summary>RAZORPAY_KEY_ID: the public half of the test key pair.</summary>
    public string RazorpayKeyId { get; set; } = string.Empty;

    /// <summary>RAZORPAY_KEY_SECRET: the secret half. Sealed before it reaches a column.</summary>
    public string RazorpayKeySecret { get; set; } = string.Empty;

    /// <summary>RAZORPAY_WEBHOOK_SECRET: optional, and blank on a machine Razorpay cannot reach.</summary>
    public string RazorpayWebhookSecret { get; set; } = string.Empty;
}
