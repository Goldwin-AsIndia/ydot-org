using YDots.CAM.Domain.Enums;

namespace YDots.CAM.Infrastructure.Persistence.Seed;

/// <summary>
/// The demonstration campaigns, readiness checklists and tracking assets of the two activated
/// sample Organisations.
///
/// DATA, KEPT APART FROM THE SEEDER'S LOGIC, in the way IAM's SampleOrganisationCatalogue is.
/// <see cref="DemoCampaignSeeder"/> decides HOW a row is written; this file says WHAT is written.
/// Renaming a campaign, moving a date or adding a tracking asset is an edit here and nowhere else.
///
/// SIXTEEN CAMPAIGNS PER ORGANISATION, ACROSS ALL NINE STATUSES. The register's whole vocabulary
/// is status - its tiles count by it, its filter lists all nine, and each offers different
/// buttons - so a set that was uniformly Active would leave most of the screen unreachable:
///
///   Draft 2 · Submitted 2 · Scheduled 4 · Active 3 · Paused 1 · Closing 1 · Closed 2 ·
///   Cancelled 1
///
/// NO CAMPAIGN IS LEFT IN APPROVED: approval schedules a campaign, and Scheduled is where an
/// approved campaign waits until it is Active. Two of the four Scheduled campaigns were approved
/// on or after their start date and are set to manual activation, so they wait for the
/// Organisation Admin's Activate.
///
/// EVERY DATE IS RELATIVE TO THE DAY THE DATA IS SEEDED, never a calendar date. A campaign seeded
/// with the dates of the day this was written would be expired on every database created
/// afterwards. <c>StartsIn</c> and <c>EndsIn</c> count days from today, negative for the past; the
/// timeline counts days AGO. Three rules keep the set true to the product whenever it is seeded:
///
///   - a Scheduled campaign set to activate automatically starts in the future (one whose start
///     date had come would already be Active); a manual one may have started already;
///   - the three Active campaigns started more than two months ago, so every donation PAY seeds
///     "last month" falls inside a campaign that was already running;
///   - nothing was paused, closed or asked to close more than eight days ago, so those donations
///     also fall before the campaign stopped taking money.
///
/// THE PEOPLE ARE THE ORGANISATION'S OWN, named by username and resolved against IAM when the
/// data is written. A Campaign Executive creates, submits and asks to close; the Campaign Manager
/// approves, pauses, resumes and approves the close - so no row breaks the rule that nobody decides
/// their own work, and each account finds its own campaigns in the register.
///
/// THE ORGANISATIONS ARE REAL AND THE CAMPAIGNS ARE NOT. Smile Foundation and HelpAge India are
/// named as IAM seeds them; every campaign, figure, place and outcome below is invented for the
/// demonstration and themed on the kind of work each charity is known for.
/// </summary>
internal static class DemoCampaignCatalogue
{
    internal sealed record DemoOrganisation(
        string Subdomain,
        string Administrator,
        string DigitalExecutive,
        string TermsAndNotice,
        IReadOnlyList<DemoCampaign> Campaigns,
        IReadOnlyList<DemoAsset> Assets);

    /// <summary>
    /// One campaign.
    ///
    /// <paramref name="Owners"/> lists usernames, the primary owner first.
    /// <paramref name="Readiness"/> is one character per entry of <see cref="Checklist"/>, in
    /// order - see <see cref="ReadinessMark"/>.
    /// </summary>
    internal sealed record DemoCampaign(
        string Code,
        string Name,
        CampaignStatus Status,
        string Fund,
        string Purpose,
        string PublicDescription,
        int StartsIn,
        int EndsIn,
        decimal Target,
        decimal Budget,
        decimal Ask,
        string City,
        string Zip,
        string Creator,
        string Approver,
        string[] Owners,
        string[] Channels,
        DemoTimeline Timeline,
        string Readiness,
        LifecycleActivation Activation = LifecycleActivation.Manual,
        DemoReason? Pause = null,
        DemoReason? Close = null);

    /// <summary>When each step of the campaign's life happened, in days before today.</summary>
    internal sealed record DemoTimeline(
        int Created,
        int? Submitted = null,
        int? Approved = null,
        int? Activated = null,
        int? Paused = null,
        int? Resumed = null,
        int? CloseRequested = null,
        int? Closed = null,
        int? Cancelled = null);

    internal sealed record DemoReason(
        string Category,
        string Detail,
        string? Impact = null,
        string? Summary = null);

    /// <summary>
    /// One tracking asset. Its code is not written here: it is minted the way the product mints
    /// it, from the campaign's code, the asset type and its position among the campaign's assets
    /// - SF-EDU-2026-QR-001 - which is why the ORDER of this list matters to PAY, whose
    /// demonstration donations name assets by that code.
    ///
    /// <paramref name="Places"/> is for an offline QR code and nothing else, which is the rule
    /// the product enforces in both directions.
    /// </summary>
    internal sealed record DemoAsset(
        string Campaign,
        TrackingAssetType Type,
        string Channel,
        string Source,
        string Medium,
        string ContentTag,
        TrackingAssetStatus Status,
        long Usage,
        string Creator,
        string[]? Places = null);

    /// <summary>
    /// One line of the pre-launch checklist, with the words each outcome is recorded in.
    /// </summary>
    internal sealed record DemoCheck(
        string Name,
        ReadinessCheckCategory Category,
        bool Required,
        string Criteria,
        string Description,
        string PassedNote,
        string FailedNote,
        string BlockerNote,
        string ResolutionNote);

    /// <summary>What one character of a campaign's <c>Readiness</c> string means.</summary>
    internal static class ReadinessMark
    {
        /// <summary>Not yet looked at.</summary>
        public const char Pending = '-';

        public const char Passed = 'P';

        /// <summary>Failed on a verdict, with nobody yet asked to clear it.</summary>
        public const char Failed = 'F';

        /// <summary>Failed, with an open blocker assigned to its owner.</summary>
        public const char Blocked = 'B';

        /// <summary>Passed, after a blocker was raised against it and resolved.</summary>
        public const char Recovered = 'R';
    }

    /// <summary>
    /// The pre-launch checklist every demonstration campaign carries: twelve checks, two in each
    /// of the six categories the checklist screen groups by.
    ///
    /// THE FIRST SIX ARE THE PRODUCT'S OWN, named exactly as <c>DefaultReadinessChecks</c> names
    /// them, because those are the six a campaign created through the wizard is given. The second
    /// six are the kind an Organisation adds for itself; three of them are advisory rather than
    /// required for launch, so the screen shows a check that can fail without holding anything up.
    /// </summary>
    internal static readonly IReadOnlyList<DemoCheck> Checklist =
    [
        new("Public content status", ReadinessCheckCategory.Content, true,
            "The public description and the donor-facing page have been read and approved by "
            + "whoever owns the campaign's messaging.",
            "Covers the wording a donor sees before they give.",
            "Appeal copy and the donation page were proofread and signed off.",
            "The opening paragraph still quotes last year's beneficiary figures.",
            "Programme team to confirm this year's beneficiary figures before the copy can be approved.",
            "Updated figures received from the programme team; the copy was corrected and re-approved."),

        new("Budget approval", ReadinessCheckCategory.Budget, true,
            "The campaign's budget and target figures have been agreed with finance.",
            "The target the campaign asks for and what it may spend to reach it.",
            "Target and budget agreed with finance and recorded against the annual plan.",
            "Finance has not yet signed off the revised media spend.",
            "Finance to confirm the revised media spend fits this quarter's allocation.",
            "Finance approved the revised spend within the quarter's allocation."),

        new("Tracking readiness", ReadinessCheckCategory.Tracking, true,
            "Every tracking asset the campaign needs has been created, approved and activated, "
            + "and at least one has been tested end to end.",
            "A QR code that resolves to nothing produces gifts nobody can attribute.",
            "All launch assets are active and a test scan reached the donation form.",
            "The launch assets are not yet active, so a scan cannot be attributed.",
            "Launch QR codes and links must be approved and activated before a test scan can be run.",
            "Assets were approved and activated; a test scan resolved to the donation form."),

        new("Payment readiness", ReadinessCheckCategory.Payment, true,
            "The payment gateway is configured for this campaign and a test gift has settled.",
            "The one check whose failure costs money rather than accuracy.",
            "Gateway configured and a test gift settled to the organisation's account.",
            "The test gift was captured but has not settled.",
            "Waiting for the gateway to confirm settlement of the test gift before launch.",
            "Settlement of the test gift was confirmed by the gateway."),

        new("Template readiness", ReadinessCheckCategory.Template, true,
            "The receipt and thank-you templates for this campaign exist and have been previewed.",
            "A donor who gives and hears nothing back is the most expensive kind of mistake.",
            "Receipt and thank-you templates previewed with the campaign name and fund.",
            "The thank-you message still names the previous campaign.",
            "Thank-you template to be updated with this campaign's name and impact line.",
            "Template updated and previewed; it now names this campaign correctly."),

        new("Consent notice version", ReadinessCheckCategory.Consent, true,
            "The consent wording and any tax or data notices are published and current.",
            "Compliance wording is version-controlled; confirm the campaign points at the live one.",
            "The donation form shows the current privacy notice and consent terms.",
            "The donation form still links to the superseded privacy notice.",
            "Legal to publish the current privacy notice before the form can point at it.",
            "Current notice published and linked from the donation form."),

        new("Campaign imagery and beneficiary consent", ReadinessCheckCategory.Content, true,
            "Every photograph and story used in the campaign has a signed release on file.",
            "A story told without permission is a harm to the person in it, however well it raises.",
            "Signed releases are on file for every photograph and story in use.",
            "Two photographs in the launch set have no release on file.",
            "Field team to collect the two outstanding releases or replace the photographs.",
            "Outstanding releases collected and filed; the launch set is cleared for use."),

        new("Fundraising cost ratio within policy", ReadinessCheckCategory.Budget, false,
            "Planned fundraising cost is within the board's ceiling as a share of the target.",
            "Advisory: a campaign over the ceiling can still launch, but the board is told.",
            "Planned cost is within the board's ceiling for a campaign of this size.",
            "Planned cost is above the board's ceiling; recorded for the next board report.",
            "Campaign manager to reduce paid media or note the exception for the board.",
            "Paid media was reduced and the ratio is back within the ceiling."),

        new("UTM naming and channel tagging reviewed", ReadinessCheckCategory.Tracking, false,
            "Source, medium and content tags follow the organisation's naming convention.",
            "Advisory: inconsistent tags do not stop a gift, they only blur the reporting.",
            "Tags follow the naming convention across every asset.",
            "Three assets use free-text content tags that reporting will not group.",
            "Digital executive to rename the three content tags to the agreed convention.",
            "Content tags renamed to the agreed convention."),

        new("Refund and failed-payment handling briefed", ReadinessCheckCategory.Payment, false,
            "Donor care has been briefed on refunds, failed payments and retries for this campaign.",
            "Advisory: the people who answer the telephone should hear about a campaign before donors do.",
            "Donor care briefed on refunds, failed payments and retries.",
            "Donor care has not been briefed on this campaign.",
            "Campaign owner to brief donor care before the first appeal goes out.",
            "Donor care briefing held and the notes circulated."),

        new("80G receipt wording verified", ReadinessCheckCategory.Template, true,
            "The receipt carries the organisation's 80G registration and the correct financial year.",
            "The receipt is the tax document a donor claims relief with.",
            "Receipt shows the 80G registration and the current financial year.",
            "The receipt preview shows last financial year's 80G validity line.",
            "Finance to confirm the current 80G validity line for the receipt template.",
            "Current 80G validity line confirmed by finance and applied to the template."),

        new("Communication opt-in wording approved", ReadinessCheckCategory.Consent, true,
            "The e-mail, telephone and WhatsApp opt-in wording on the form has been approved.",
            "What a donor agrees to hear about, in the words they agreed to it in.",
            "Opt-in wording for e-mail, telephone and WhatsApp approved.",
            "The WhatsApp opt-in line is missing from the form.",
            "Compliance to approve the WhatsApp opt-in line before it is added to the form.",
            "WhatsApp opt-in line approved and added to the form.")
    ];

    // =============================================================================================
    // Channel sets, named once so a campaign's list and its assets' channels cannot drift apart
    // =============================================================================================

    private static readonly string[] EveryPublicChannel =
        ["WEBSITE", "EMAIL", "SOCIAL", "OFFLINE", "MESSAGING", "SEARCH", "PARTNER", "REFERRAL"];

    private static readonly string[] OutreachChannels = ["OFFLINE", "EMAIL", "SOCIAL", "WEBSITE"];

    private static readonly string[] CommunityChannels = ["OFFLINE", "MESSAGING", "WEBSITE", "SOCIAL"];

    private static readonly string[] FestiveChannels = ["EMAIL", "OFFLINE", "SOCIAL", "WEBSITE", "MESSAGING"];

    private static readonly string[] GroundChannels = ["OFFLINE", "SOCIAL", "MESSAGING"];

    private static readonly string[] OnlineChannels = ["WEBSITE", "EMAIL", "PARTNER"];

    private static readonly string[] DigitalChannels = ["WEBSITE", "SOCIAL", "EMAIL"];

    private static readonly string[] LocalChannels = ["OFFLINE", "SOCIAL"];

    private static readonly string[] CampChannels = ["OFFLINE", "MESSAGING"];

    private static readonly string[] ReliefChannels = ["SOCIAL", "WEBSITE", "OFFLINE"];

    private static readonly string[] AppealChannels = ["WEBSITE", "EMAIL", "OFFLINE"];

    private const string Everything = "PPPPPPPPPPPP";

    private const string Untouched = "------------";

    internal static readonly IReadOnlyList<DemoOrganisation> Organisations =
    [
        // ============ SMILE FOUNDATION ============================================================
        new(
            Subdomain: "smilefoundation",
            Administrator: "anjali.prakash",
            DigitalExecutive: "arjun.mohan",
            TermsAndNotice:
                "Donations to Smile Foundation are eligible for deduction under Section 80G of the "
                + "Income Tax Act, 1961. A receipt is e-mailed as soon as your payment is confirmed; "
                + "please give your PAN to claim the deduction. Your gift is applied to the programme "
                + "named on this page, and where a campaign is over-subscribed the balance supports "
                + "the same cause in the next programme cycle. Donations are not ordinarily refunded; "
                + "write to donor care within seven days of a duplicate or mistaken payment. Your "
                + "contact details are used only to service your donation and to send the updates "
                + "you have agreed to receive.",
            Campaigns:
            [
                new("SF-EDU-2026", "Educate a Child 2026", CampaignStatus.Active,
                    "Education Fund",
                    "Fund a full year of schooling - fees, books, uniform and a learning mentor - "
                    + "for children from low-income families at the foundation's education centres.",
                    "Six thousand rupees keeps one child in school for a year: fees, books, a "
                    + "uniform and a mentor who makes sure they stay. Sponsor a child today and "
                    + "receive a progress note every term.",
                    StartsIn: -99, EndsIn: 174,
                    Target: 1_500_000m, Budget: 180_000m, Ask: 6_000m,
                    City: "New Delhi", Zip: "110049",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["rohan.suresh", "sneha.ramesh"],
                    Channels: EveryPublicChannel,
                    Timeline: new(Created: 128, Submitted: 124, Approved: 120, Activated: 99),
                    Readiness: "PPRPPPPPPPPP",
                    Activation: LifecycleActivation.Auto),

                new("SF-HEALTH-2026", "Health on Wheels - Mobile Clinic Appeal", CampaignStatus.Active,
                    "Healthcare Fund",
                    "Keep two mobile clinics on the road for a year, bringing a doctor, a "
                    + "pharmacist and free medicines to settlements with no clinic of their own.",
                    "A mobile clinic reaches families who would otherwise go without a doctor. "
                    + "Two thousand five hundred rupees covers a day of consultations and "
                    + "medicines for a whole lane.",
                    StartsIn: -75, EndsIn: 106,
                    Target: 800_000m, Budget: 95_000m, Ask: 2_500m,
                    City: "Mumbai", Zip: "400093",
                    Creator: "arjun.mohan", Approver: "rohan.suresh",
                    Owners: ["rohan.suresh", "arjun.mohan"],
                    Channels: OutreachChannels,
                    Timeline: new(Created: 96, Submitted: 92, Approved: 88, Activated: 75,
                        Paused: 40, Resumed: 36),
                    Readiness: "PPPPPPPP-PPP",
                    Pause: new("Operational",
                        "Both mobile clinic vans were taken off the road for scheduled servicing, "
                        + "so outreach and solicitation were held until they returned.",
                        "Donors already in conversation were told the appeal would resume within "
                        + "the week; scheduled posts were held.")),

                new("SF-NUTRITION-2026", "Midday Nutrition for Every Classroom", CampaignStatus.Active,
                    "Nutrition Programme",
                    "Provide a hot midday meal on every school day for children at the "
                    + "foundation's learning centres, so no child studies on an empty stomach.",
                    "One thousand five hundred rupees gives a child a hot, balanced midday meal "
                    + "for a full school term. A fed child stays in class, and stays in school.",
                    StartsIn: -66, EndsIn: 144,
                    Target: 600_000m, Budget: 70_000m, Ask: 1_500m,
                    City: "Bengaluru", Zip: "560038",
                    Creator: "arjun.mohan", Approver: "rohan.suresh",
                    Owners: ["arjun.mohan", "rohan.suresh"],
                    Channels: CommunityChannels,
                    Timeline: new(Created: 84, Submitted: 80, Approved: 77, Activated: 66),
                    Readiness: "PPPPPPPFPPPP",
                    Activation: LifecycleActivation.Auto),

                new("SF-DIWALI-2026", "Diwali of Hope - Festive Giving 2026", CampaignStatus.Scheduled,
                    "Education Fund",
                    "The festive-season appeal: a gift made in a family's name funds school kits "
                    + "and a festive meal for children at the foundation's centres.",
                    "This Diwali, light a lamp in a child's life. Two thousand one hundred rupees "
                    + "gives a school kit and a festive meal - and we will send a greeting in your "
                    + "family's name.",
                    StartsIn: 10, EndsIn: 45,
                    Target: 1_000_000m, Budget: 120_000m, Ask: 2_100m,
                    City: "New Delhi", Zip: "110049",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["sneha.ramesh", "rohan.suresh"],
                    Channels: FestiveChannels,
                    Timeline: new(Created: 18, Submitted: 14, Approved: 11),
                    Readiness: "PPBPP-PP-P-P",
                    Activation: LifecycleActivation.Auto),

                new("SF-WINTER-2026", "Warm Winters - Blanket and Woollens Drive", CampaignStatus.Scheduled,
                    "Community Relief Fund",
                    "Distribute blankets and woollens to children and elderly family members in "
                    + "the communities the foundation works with before the cold sets in.",
                    "Nine hundred rupees buys a warm blanket and a set of woollens for a child "
                    + "facing a north Indian winter without either.",
                    StartsIn: 24, EndsIn: 100,
                    Target: 500_000m, Budget: 45_000m, Ask: 900m,
                    City: "Lucknow", Zip: "226010",
                    Creator: "arjun.mohan", Approver: "rohan.suresh",
                    Owners: ["arjun.mohan", "rohan.suresh"],
                    Channels: GroundChannels,
                    Timeline: new(Created: 9, Submitted: 7, Approved: 5),
                    Readiness: "PP---P-P----"),

                new("SF-STEM-2026", "Girls in STEM Scholarship Fund", CampaignStatus.Scheduled,
                    "Scholarship Fund",
                    "Award two-year scholarships to girls entering science and technology "
                    + "streams in senior secondary school, with a laptop and a mentor.",
                    "Twelve thousand rupees funds a year of a girl's science education - "
                    + "tuition, a laptop share and a mentor from industry.",
                    StartsIn: -3, EndsIn: 180,
                    Target: 1_200_000m, Budget: 90_000m, Ask: 12_000m,
                    City: "Bengaluru", Zip: "560001",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["sneha.ramesh", "rohan.suresh"],
                    Channels: OnlineChannels,
                    Timeline: new(Created: 16, Submitted: 9, Approved: 2),
                    Readiness: "PPFBP-PPP-PP"),

                new("SF-SKILLS-2026", "Youth Skilling and Employability Drive", CampaignStatus.Scheduled,
                    "Livelihood Fund",
                    "Train young people in retail, healthcare support and digital skills, and "
                    + "place them in their first formal job within six months.",
                    "Seven thousand five hundred rupees trains one young person for a first job "
                    + "and supports them through their first three months at work.",
                    StartsIn: -1, EndsIn: 150,
                    Target: 900_000m, Budget: 85_000m, Ask: 7_500m,
                    City: "Hyderabad", Zip: "500082",
                    Creator: "arjun.mohan", Approver: "rohan.suresh",
                    Owners: ["arjun.mohan", "rohan.suresh"],
                    Channels: DigitalChannels,
                    Timeline: new(Created: 14, Submitted: 8, Approved: 1),
                    Readiness: "PPPPPPPPPPRP"),

                new("SF-LIVELIHOOD-2026", "Women's Livelihood - Tailoring Units", CampaignStatus.Paused,
                    "Livelihood Fund",
                    "Set up tailoring units run by women's self-help groups, each with machines, "
                    + "training and a first order book.",
                    "Five thousand rupees buys a sewing machine and a month of training for one "
                    + "woman joining a self-help tailoring unit.",
                    StartsIn: -120, EndsIn: 60,
                    Target: 400_000m, Budget: 40_000m, Ask: 5_000m,
                    City: "Hyderabad", Zip: "500082",
                    Creator: "arjun.mohan", Approver: "rohan.suresh",
                    Owners: ["rohan.suresh", "arjun.mohan"],
                    Channels: LocalChannels,
                    Timeline: new(Created: 150, Submitted: 146, Approved: 141, Activated: 120,
                        Paused: 5),
                    Readiness: Everything,
                    Pause: new("Supplier readiness",
                        "The sewing-machine supplier has pushed delivery back by three weeks, so "
                        + "new gifts cannot be applied to units on the promised date. Solicitation "
                        + "is paused until the revised delivery schedule is confirmed.",
                        "Existing donors were sent an update by e-mail. The Instagram link was "
                        + "deactivated; the exhibition QR code stays live for enquiries.")),

                new("SF-MONSOON-2026", "Monsoon Health Camps 2026", CampaignStatus.Closing,
                    "Healthcare Fund",
                    "Run free health camps through the monsoon months in flood-prone "
                    + "neighbourhoods, screening for water-borne illness and treating on the spot.",
                    "Two thousand rupees pays for one family's screening and medicines at a "
                    + "monsoon health camp.",
                    StartsIn: -110, EndsIn: -4,
                    Target: 250_000m, Budget: 30_000m, Ask: 2_000m,
                    City: "Kolkata", Zip: "700091",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["rohan.suresh", "sneha.ramesh"],
                    Channels: CampChannels,
                    Timeline: new(Created: 135, Submitted: 131, Approved: 127, Activated: 110,
                        CloseRequested: 3),
                    Readiness: Everything,
                    Close: new("Campaign period ended",
                        "The monsoon camp season closed on schedule. Every planned camp was held "
                        + "and the donor report for the season is ready to send.",
                        "Donors receive the season report and an invitation to the winter drive. "
                        + "The WhatsApp link is being disabled.",
                        "All planned camps were held. Unspent funds carry into the Health on "
                        + "Wheels programme, as the campaign terms state.")),

                new("SF-FLOOD-2026", "Assam Flood Relief 2026", CampaignStatus.Closed,
                    "Disaster Response Fund",
                    "Emergency relief for families displaced by the floods: dry rations, clean "
                    + "water, hygiene kits and temporary learning spaces for children.",
                    "One thousand rupees gives a displaced family dry rations, clean water and "
                    + "a hygiene kit for a week.",
                    StartsIn: -118, EndsIn: -7,
                    Target: 500_000m, Budget: 25_000m, Ask: 1_000m,
                    City: "Kolkata", Zip: "700091",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["rohan.suresh", "sneha.ramesh"],
                    Channels: ReliefChannels,
                    Timeline: new(Created: 121, Submitted: 120, Approved: 119, Activated: 118,
                        CloseRequested: 7, Closed: 6),
                    Readiness: Everything,
                    Close: new("Relief phase complete",
                        "The emergency relief phase has ended and the families supported have "
                        + "returned home or moved to government rehabilitation sites.",
                        "Donors were thanked and sent the relief report. All links and QR codes "
                        + "for the appeal were deactivated.",
                        "Relief distribution is complete. Any balance supports rebuilding the "
                        + "learning spaces damaged by the floods.")),

                new("SF-ANNUAL-2025", "Annual Giving 2025-26", CampaignStatus.Closed,
                    "General Fund",
                    "The foundation's always-on appeal for the 2025-26 financial year, "
                    + "supporting education, healthcare and livelihood programmes where the need "
                    + "was greatest.",
                    "Your gift supported the foundation's education, healthcare and livelihood "
                    + "programmes through the 2025-26 year.",
                    StartsIn: -555, EndsIn: -191,
                    Target: 4_000_000m, Budget: 400_000m, Ask: 3_000m,
                    City: "New Delhi", Zip: "110049",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["rohan.suresh"],
                    Channels: AppealChannels,
                    Timeline: new(Created: 580, Submitted: 575, Approved: 570, Activated: 555,
                        CloseRequested: 185, Closed: 183),
                    Readiness: Everything,
                    Activation: LifecycleActivation.Auto,
                    Close: new("Financial year ended",
                        "The 2025-26 financial year has closed and the appeal has been replaced "
                        + "by the programme campaigns for 2026-27.",
                        "Regular donors were moved to the 2026-27 campaigns with their consent.",
                        "Year closed and reported. Receipts for the year were issued in full.")),

                new("SF-DIGITAL-2027", "Digital Classrooms 2027", CampaignStatus.Submitted,
                    "Education Fund",
                    "Equip the foundation's learning centres with smart classrooms - a "
                    + "projector, tablets and a trained facilitator in each.",
                    "Fifteen thousand rupees equips a share of a smart classroom that fifty "
                    + "children will learn in every day.",
                    StartsIn: 85, EndsIn: 265,
                    Target: 2_500_000m, Budget: 250_000m, Ask: 15_000m,
                    City: "Chennai", Zip: "600017",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["sneha.ramesh", "rohan.suresh"],
                    Channels: DigitalChannels,
                    Timeline: new(Created: 6, Submitted: 2),
                    Readiness: "P-----------",
                    Activation: LifecycleActivation.Auto),

                new("SF-CSR-2027", "Corporate Partnership Drive FY 2026-27", CampaignStatus.Submitted,
                    "Corporate Partnerships",
                    "Invite companies to adopt a learning centre or a mobile clinic for a year "
                    + "under their CSR programme, with quarterly impact reporting.",
                    "Partner with Smile Foundation under your CSR programme: adopt a learning "
                    + "centre or a mobile clinic and receive audited quarterly impact reports.",
                    StartsIn: 40, EndsIn: 174,
                    Target: 7_500_000m, Budget: 300_000m, Ask: 100_000m,
                    City: "Mumbai", Zip: "400093",
                    Creator: "arjun.mohan", Approver: "rohan.suresh",
                    Owners: ["rohan.suresh", "arjun.mohan"],
                    Channels: OnlineChannels,
                    Timeline: new(Created: 4, Submitted: 1),
                    Readiness: "PF----------"),

                new("SF-RUN-2027", "Run for Education - Delhi Half Marathon 2027", CampaignStatus.Draft,
                    "Education Fund",
                    "A charity-runner programme for the Delhi half marathon: runners raise "
                    + "sponsorship for the Educate a Child programme.",
                    "Run for a child's education. Every runner who raises one thousand five "
                    + "hundred rupees funds a term of schooling.",
                    StartsIn: 120, EndsIn: 150,
                    Target: 800_000m, Budget: 150_000m, Ask: 1_500m,
                    City: "New Delhi", Zip: "110049",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["sneha.ramesh"],
                    Channels: FestiveChannels,
                    Timeline: new(Created: 3),
                    Readiness: Untouched),

                new("SF-SUMMER-2027", "Summer Learning Camps 2027", CampaignStatus.Draft,
                    "Education Fund",
                    "Six-week summer camps that keep children reading, playing and learning "
                    + "while schools are closed.",
                    "Four thousand rupees sends a child to a six-week summer learning camp with "
                    + "books, sport and a daily meal.",
                    StartsIn: 175, EndsIn: 240,
                    Target: 600_000m, Budget: 60_000m, Ask: 4_000m,
                    City: "Pune", Zip: "411004",
                    Creator: "arjun.mohan", Approver: "rohan.suresh",
                    Owners: ["arjun.mohan"],
                    Channels: GroundChannels,
                    Timeline: new(Created: 1),
                    Readiness: Untouched),

                new("SF-BOOKS-2025", "Books for All - Community Library Drive", CampaignStatus.Cancelled,
                    "Education Fund",
                    "Stock community libraries at the foundation's centres with age-graded "
                    + "books in local languages.",
                    "Seven hundred and fifty rupees adds ten books in a child's own language to "
                    + "a community library.",
                    StartsIn: -260, EndsIn: -200,
                    Target: 300_000m, Budget: 20_000m, Ask: 750m,
                    City: "Kolkata", Zip: "700091",
                    Creator: "sneha.ramesh", Approver: "rohan.suresh",
                    Owners: ["sneha.ramesh"],
                    Channels: LocalChannels,
                    Timeline: new(Created: 290, Cancelled: 270),
                    Readiness: Untouched,
                    Close: new("Merged into another campaign",
                        "The library drive was folded into Educate a Child before it was "
                        + "submitted, so the draft was cancelled rather than launched."))
            ],
            Assets:
            [
                // ---- Educate a Child: twelve assets, every type and every status ---------------
                new("SF-EDU-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "school-gate-poster", TrackingAssetStatus.Active, 486, "sneha.ramesh",
                    ["Government senior secondary school gate, Saket",
                     "Shopping mall atrium kiosk, Saket",
                     "Hauz Khas Metro station concourse"]),
                new("SF-EDU-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "teachers-day-stall", TrackingAssetStatus.Active, 212, "sneha.ramesh",
                    ["Teachers' Day fundraiser stall, Lodhi Road"]),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "EMAIL", "NEWSLETTER", "EMAIL",
                    "september-newsletter", TrackingAssetStatus.Active, 934, "arjun.mohan"),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "WEBSITE", "WEBSITE", "ORGANIC",
                    "homepage-hero-banner", TrackingAssetStatus.Active, 1_520, "arjun.mohan"),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "SOCIAL", "INSTAGRAM", "PAID_SOCIAL",
                    "reels-back-to-school", TrackingAssetStatus.Active, 2_764, "arjun.mohan"),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "MESSAGING", "WHATSAPP", "SOCIAL",
                    "whatsapp-supporter-broadcast", TrackingAssetStatus.Active, 648, "arjun.mohan"),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "SEARCH", "GOOGLE", "CPC",
                    "search-sponsor-a-child", TrackingAssetStatus.Active, 1_187, "arjun.mohan"),
                new("SF-EDU-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "office-cafeteria-standee", TrackingAssetStatus.DisableRequested, 143, "sneha.ramesh",
                    ["Business park food court standee, Gurugram road"]),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "SOCIAL", "FACEBOOK", "SOCIAL",
                    "facebook-pinned-post", TrackingAssetStatus.Inactive, 77, "arjun.mohan"),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "PARTNER", "PARTNER_SITE", "REFERRAL",
                    "giving-platform-listing", TrackingAssetStatus.Approved, 0, "arjun.mohan"),
                new("SF-EDU-2026", TrackingAssetType.LandingPage, "REFERRAL", "PARTNER_SITE", "BANNER",
                    "alumni-network-banner", TrackingAssetStatus.Submitted, 0, "sneha.ramesh"),
                new("SF-EDU-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "childrens-day-mela", TrackingAssetStatus.Draft, 0, "sneha.ramesh",
                    ["Children's Day mela stall, INA"]),

                // ---- Health on Wheels ----------------------------------------------------------
                new("SF-HEALTH-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "mobile-van-side-panel", TrackingAssetStatus.Active, 318, "arjun.mohan",
                    ["Mobile clinic van 1 - Dharavi route", "Mobile clinic van 2 - Govandi route"]),
                new("SF-HEALTH-2026", TrackingAssetType.LandingPage, "EMAIL", "NEWSLETTER", "EMAIL",
                    "health-impact-mailer", TrackingAssetStatus.Active, 402, "arjun.mohan"),
                new("SF-HEALTH-2026", TrackingAssetType.LandingPage, "SOCIAL", "FACEBOOK", "PAID_SOCIAL",
                    "doctor-on-wheels-video", TrackingAssetStatus.Active, 1_293, "arjun.mohan"),

                // ---- Midday Nutrition ----------------------------------------------------------
                new("SF-NUTRITION-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "canteen-table-tent", TrackingAssetStatus.Active, 174, "arjun.mohan",
                    ["Tech park food court table tents, Outer Ring Road",
                     "Indiranagar community hall notice board"]),
                new("SF-NUTRITION-2026", TrackingAssetType.LandingPage, "MESSAGING", "WHATSAPP", "SMS",
                    "parent-teacher-group", TrackingAssetStatus.Active, 256, "arjun.mohan"),
                new("SF-NUTRITION-2026", TrackingAssetType.LandingPage, "WEBSITE", "WEBSITE", "BANNER",
                    "nutrition-landing-page", TrackingAssetStatus.Submitted, 0, "arjun.mohan"),

                // ---- Diwali of Hope: prepared ahead of launch ------------------------------------
                new("SF-DIWALI-2026", TrackingAssetType.LandingPage, "EMAIL", "NEWSLETTER", "EMAIL",
                    "diwali-early-bird-mailer", TrackingAssetStatus.Approved, 0, "sneha.ramesh"),
                new("SF-DIWALI-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "diwali-mela-stall", TrackingAssetStatus.Draft, 0, "sneha.ramesh",
                    ["Diwali mela stall, Dilli Haat"]),

                // ---- Women's Livelihood (paused) ----------------------------------------------------
                new("SF-LIVELIHOOD-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "exhibition-counter", TrackingAssetStatus.Active, 96, "arjun.mohan",
                    ["Self-help group exhibition counter, Madhapur"]),
                new("SF-LIVELIHOOD-2026", TrackingAssetType.LandingPage, "SOCIAL", "INSTAGRAM", "SOCIAL",
                    "artisan-stories", TrackingAssetStatus.Inactive, 211, "arjun.mohan"),

                // ---- Monsoon Health Camps (closing) ----------------------------------------------
                new("SF-MONSOON-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "camp-registration-desk", TrackingAssetStatus.Active, 164, "sneha.ramesh",
                    ["Health camp registration desk, Salt Lake Sector V"]),
                new("SF-MONSOON-2026", TrackingAssetType.LandingPage, "MESSAGING", "WHATSAPP", "SOCIAL",
                    "monsoon-camp-broadcast", TrackingAssetStatus.DisableRequested, 133, "sneha.ramesh"),

                // ---- Assam Flood Relief (closed): everything taken down ----------------------------
                new("SF-FLOOD-2026", TrackingAssetType.LandingPage, "SOCIAL", "FACEBOOK", "SOCIAL",
                    "flood-relief-urgent-appeal", TrackingAssetStatus.Inactive, 1_876, "sneha.ramesh"),
                new("SF-FLOOD-2026", TrackingAssetType.LandingPage, "WEBSITE", "WEBSITE", "BANNER",
                    "emergency-homepage-banner", TrackingAssetStatus.Inactive, 2_240, "arjun.mohan"),
                new("SF-FLOOD-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "relief-collection-point", TrackingAssetStatus.Inactive, 301, "sneha.ramesh",
                    ["Relief collection point, Salt Lake regional office"])
            ]),

        // ============ HELPAGE INDIA ===============================================================
        new(
            Subdomain: "helpageindia",
            Administrator: "arvind.murali",
            DigitalExecutive: "ritu.anil",
            TermsAndNotice:
                "Donations to HelpAge India are eligible for deduction under Section 80G of the "
                + "Income Tax Act, 1961. A receipt is e-mailed as soon as your payment is confirmed; "
                + "please give your PAN to claim the deduction. Your gift is applied to the elder-care "
                + "programme named on this page, and where a campaign is over-subscribed the balance "
                + "supports the same cause in the next programme cycle. Donations are not ordinarily "
                + "refunded; write to donor services within seven days of a duplicate or mistaken "
                + "payment. Your contact details are used only to service your donation and to send "
                + "the updates you have agreed to receive.",
            Campaigns:
            [
                new("HAI-ELDERCARE-2026", "Care for the Elderly - Annual Appeal 2026", CampaignStatus.Active,
                    "Elder Care Fund",
                    "The annual appeal for elder care: medicines, a monthly ration and a "
                    + "caring visit for destitute older people with nobody else to turn to.",
                    "Five thousand rupees supports a destitute elder for six months - "
                    + "medicines, a monthly ration and a visit from somebody who cares.",
                    StartsIn: -103, EndsIn: 170,
                    Target: 1_800_000m, Budget: 200_000m, Ask: 5_000m,
                    City: "New Delhi", Zip: "110016",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["priyanka.naveen", "ritu.anil"],
                    Channels: EveryPublicChannel,
                    Timeline: new(Created: 130, Submitted: 126, Approved: 121, Activated: 103),
                    Readiness: "PPPPRPPPPPPP",
                    Activation: LifecycleActivation.Auto),

                new("HAI-MOBILECARE-2026", "Mobile Healthcare Units - Care at the Doorstep", CampaignStatus.Active,
                    "Healthcare Fund",
                    "Keep mobile healthcare units running in districts where older people "
                    + "cannot travel to a clinic, with a doctor, a pharmacist and free medicines.",
                    "Three thousand rupees keeps a mobile healthcare unit on its round for a "
                    + "day, treating older people at their own doorstep.",
                    StartsIn: -80, EndsIn: 100,
                    Target: 900_000m, Budget: 110_000m, Ask: 3_000m,
                    City: "Lucknow", Zip: "226024",
                    Creator: "aditya.ganesh", Approver: "priyanka.naveen",
                    Owners: ["priyanka.naveen", "aditya.ganesh"],
                    Channels: OutreachChannels,
                    Timeline: new(Created: 101, Submitted: 97, Approved: 92, Activated: 80,
                        Paused: 47, Resumed: 44),
                    Readiness: "PPPPPPPPP-PP",
                    Pause: new("Operational",
                        "A change of medical officer left two units without a doctor for three "
                        + "days, so outreach was held until cover was arranged.",
                        "Supporters already in conversation were told the appeal would resume "
                        + "within the week; scheduled posts were held.")),

                new("HAI-SIGHT-2026", "Restore Sight - Cataract Surgeries 2026", CampaignStatus.Active,
                    "Healthcare Fund",
                    "Fund free cataract surgeries for older people who have lost their sight to "
                    + "a condition that a twenty-minute operation can reverse.",
                    "Four thousand five hundred rupees restores an elder's sight: screening, "
                    + "surgery, a lens and the follow-up visits.",
                    StartsIn: -70, EndsIn: 140,
                    Target: 750_000m, Budget: 80_000m, Ask: 4_500m,
                    City: "Chennai", Zip: "600008",
                    Creator: "aditya.ganesh", Approver: "priyanka.naveen",
                    Owners: ["aditya.ganesh", "priyanka.naveen"],
                    Channels: CommunityChannels,
                    Timeline: new(Created: 90, Submitted: 86, Approved: 82, Activated: 70),
                    Readiness: "PPPPPPPPFPPP",
                    Activation: LifecycleActivation.Auto),

                new("HAI-WINTER-2026", "Winter Relief - Warmth for Elders", CampaignStatus.Scheduled,
                    "Relief Fund",
                    "Distribute blankets, woollens and hot meals to older people sleeping rough "
                    + "or in unheated homes through the north Indian winter.",
                    "One thousand two hundred rupees gives an elder a blanket, woollens and a "
                    + "week of hot meals in the coldest month.",
                    StartsIn: 12, EndsIn: 95,
                    Target: 1_200_000m, Budget: 100_000m, Ask: 1_200m,
                    City: "New Delhi", Zip: "110016",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["ritu.anil", "priyanka.naveen"],
                    Channels: FestiveChannels,
                    Timeline: new(Created: 20, Submitted: 15, Approved: 12),
                    Readiness: "PPBPP-PP-P-P",
                    Activation: LifecycleActivation.Auto),

                new("HAI-DIWALI-2026", "Light a Life this Diwali", CampaignStatus.Scheduled,
                    "Elder Care Fund",
                    "The festive appeal: a gift made in a family's name gives an elder in a "
                    + "care home new clothes, sweets and company on Diwali.",
                    "Two thousand five hundred rupees gives an elder in a care home new "
                    + "clothes, sweets and a festive meal this Diwali.",
                    StartsIn: 20, EndsIn: 40,
                    Target: 600_000m, Budget: 50_000m, Ask: 2_500m,
                    City: "Mumbai", Zip: "400028",
                    Creator: "aditya.ganesh", Approver: "priyanka.naveen",
                    Owners: ["aditya.ganesh", "priyanka.naveen"],
                    Channels: GroundChannels,
                    Timeline: new(Created: 10, Submitted: 8, Approved: 6),
                    Readiness: "PP---P-P----"),

                new("HAI-HELPLINE-2026", "Elder Helpline - Keep the Line Open", CampaignStatus.Scheduled,
                    "Helpline Fund",
                    "Fund the counsellors and the call centre behind the elder helpline, which "
                    + "answers older people facing abuse, abandonment or a medical emergency.",
                    "One thousand rupees answers ten calls from older people who have nobody "
                    + "else to ring.",
                    StartsIn: -2, EndsIn: 200,
                    Target: 1_000_000m, Budget: 75_000m, Ask: 1_000m,
                    City: "New Delhi", Zip: "110016",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["ritu.anil", "priyanka.naveen"],
                    Channels: OnlineChannels,
                    Timeline: new(Created: 15, Submitted: 8, Approved: 1),
                    Readiness: "PPFBP-PPP-PP"),

                new("HAI-DAYCARE-2026", "Adopt a Day-Care Centre", CampaignStatus.Scheduled,
                    "Elder Care Fund",
                    "Sponsor a day-care centre where older people spend the day in company, "
                    + "with a meal, a health check and something to do.",
                    "Twenty-five thousand rupees runs a day-care centre for a month - a meal, "
                    + "a health check and company for forty elders.",
                    StartsIn: -1, EndsIn: 160,
                    Target: 1_500_000m, Budget: 120_000m, Ask: 25_000m,
                    City: "Kolkata", Zip: "700019",
                    Creator: "aditya.ganesh", Approver: "priyanka.naveen",
                    Owners: ["aditya.ganesh", "priyanka.naveen"],
                    Channels: DigitalChannels,
                    Timeline: new(Created: 13, Submitted: 7, Approved: 1),
                    Readiness: "PPPPPPPPPPRP"),

                new("HAI-DIGITAL-2026", "Digital Literacy for Seniors", CampaignStatus.Paused,
                    "Active Ageing Fund",
                    "Teach older people to use a smartphone safely - video calls, digital "
                    + "payments and recognising a fraud - in small neighbourhood classes.",
                    "Two thousand rupees teaches an elder to video-call family, pay a bill and "
                    + "spot a fraud on their own telephone.",
                    StartsIn: -125, EndsIn: 55,
                    Target: 350_000m, Budget: 35_000m, Ask: 2_000m,
                    City: "Bengaluru", Zip: "560011",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["priyanka.naveen", "ritu.anil"],
                    Channels: LocalChannels,
                    Timeline: new(Created: 152, Submitted: 148, Approved: 143, Activated: 125,
                        Paused: 5),
                    Readiness: Everything,
                    Pause: new("Programme review",
                        "Tablet procurement is being re-tendered after the first supplier failed "
                        + "quality checks, so new gifts are held until the revised timeline is "
                        + "agreed.",
                        "Existing supporters were sent an update by e-mail. The Instagram link "
                        + "was deactivated; the tech-fair QR code stays live for enquiries.")),

                new("HAI-PHYSIO-2026", "Physiotherapy at Home", CampaignStatus.Closing,
                    "Healthcare Fund",
                    "Send physiotherapists to the homes of older people recovering from a "
                    + "fall, a stroke or surgery who cannot travel to a clinic.",
                    "One thousand eight hundred rupees pays for a month of home physiotherapy "
                    + "for an elder learning to walk again.",
                    StartsIn: -112, EndsIn: -4,
                    Target: 300_000m, Budget: 32_000m, Ask: 1_800m,
                    City: "Mumbai", Zip: "400028",
                    Creator: "aditya.ganesh", Approver: "priyanka.naveen",
                    Owners: ["priyanka.naveen", "aditya.ganesh"],
                    Channels: CampChannels,
                    Timeline: new(Created: 138, Submitted: 134, Approved: 129, Activated: 112,
                        CloseRequested: 3),
                    Readiness: Everything,
                    Close: new("Campaign period ended",
                        "The pilot period has ended on schedule and the home-visit rota is fully "
                        + "funded to the end of the financial year.",
                        "Supporters receive the pilot report and an invitation to the winter "
                        + "appeal. The WhatsApp link is being disabled.",
                        "Pilot complete and funded. The service continues under the Mobile "
                        + "Healthcare Units programme.")),

                new("HAI-HEATWAVE-2026", "Heatwave Relief for Elders 2026", CampaignStatus.Closed,
                    "Relief Fund",
                    "Emergency summer relief: drinking-water kiosks, oral rehydration and "
                    + "cooling shelters for older people during the heatwave.",
                    "Eight hundred rupees gave an elder water, rehydration salts and a cool "
                    + "place to rest through the worst of the heat.",
                    StartsIn: -165, EndsIn: -7,
                    Target: 600_000m, Budget: 40_000m, Ask: 800m,
                    City: "Lucknow", Zip: "226024",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["priyanka.naveen", "ritu.anil"],
                    Channels: ReliefChannels,
                    Timeline: new(Created: 170, Submitted: 168, Approved: 166, Activated: 165,
                        CloseRequested: 7, Closed: 6),
                    Readiness: Everything,
                    Close: new("Relief phase complete",
                        "The heatwave has passed and the water kiosks and cooling shelters have "
                        + "been stood down for the season.",
                        "Supporters were thanked and sent the relief report. All links and QR "
                        + "codes for the appeal were deactivated.",
                        "Relief complete for the season. Any balance is held for next summer's "
                        + "preparedness.")),

                new("HAI-ANNUAL-2025", "Annual Appeal 2025-26", CampaignStatus.Closed,
                    "General Fund",
                    "The organisation's always-on appeal for the 2025-26 financial year, "
                    + "supporting healthcare, livelihood and care programmes for older people.",
                    "Your gift supported healthcare, livelihood and care for older people "
                    + "through the 2025-26 year.",
                    StartsIn: -555, EndsIn: -191,
                    Target: 5_000_000m, Budget: 500_000m, Ask: 2_500m,
                    City: "New Delhi", Zip: "110016",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["priyanka.naveen"],
                    Channels: AppealChannels,
                    Timeline: new(Created: 582, Submitted: 577, Approved: 571, Activated: 555,
                        CloseRequested: 186, Closed: 184),
                    Readiness: Everything,
                    Activation: LifecycleActivation.Auto,
                    Close: new("Financial year ended",
                        "The 2025-26 financial year has closed and the appeal has been replaced "
                        + "by the programme campaigns for 2026-27.",
                        "Regular supporters were moved to the 2026-27 campaigns with their consent.",
                        "Year closed and reported. Receipts for the year were issued in full.")),

                new("HAI-LIVELIHOOD-2027", "Elder Self-Help Groups - Livelihood Fund", CampaignStatus.Submitted,
                    "Livelihood Fund",
                    "Seed the revolving funds of elder self-help groups, so older people can "
                    + "start a small trade and stop depending on anybody else.",
                    "Ten thousand rupees seeds the revolving fund of an elder self-help group "
                    + "and starts five small livelihoods.",
                    StartsIn: 85, EndsIn: 265,
                    Target: 2_000_000m, Budget: 180_000m, Ask: 10_000m,
                    City: "Chennai", Zip: "600008",
                    Creator: "aditya.ganesh", Approver: "priyanka.naveen",
                    Owners: ["aditya.ganesh", "priyanka.naveen"],
                    Channels: DigitalChannels,
                    Timeline: new(Created: 5, Submitted: 2),
                    Readiness: "P-----------",
                    Activation: LifecycleActivation.Auto),

                new("HAI-CSR-2027", "Corporate Champions for Elder Care FY 2026-27", CampaignStatus.Submitted,
                    "Corporate Partnerships",
                    "Invite companies to adopt a mobile healthcare unit or a day-care centre "
                    + "for a year under their CSR programme, with quarterly impact reporting.",
                    "Partner with HelpAge India under your CSR programme: adopt a mobile "
                    + "healthcare unit or a day-care centre and receive audited quarterly reports.",
                    StartsIn: 35, EndsIn: 174,
                    Target: 6_000_000m, Budget: 250_000m, Ask: 150_000m,
                    City: "Mumbai", Zip: "400028",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["priyanka.naveen", "ritu.anil"],
                    Channels: OnlineChannels,
                    Timeline: new(Created: 4, Submitted: 1),
                    Readiness: "PF----------"),

                new("HAI-WALKATHON-2027", "Walkathon for Elders 2027", CampaignStatus.Draft,
                    "Active Ageing Fund",
                    "A sponsored inter-generational walk: grandparents and grandchildren walk "
                    + "together and raise sponsorship for elder day-care centres.",
                    "Walk with a grandparent. Every walker who raises five hundred rupees funds "
                    + "a week at a day-care centre for one elder.",
                    StartsIn: 110, EndsIn: 112,
                    Target: 500_000m, Budget: 90_000m, Ask: 500m,
                    City: "New Delhi", Zip: "110016",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["ritu.anil"],
                    Channels: FestiveChannels,
                    Timeline: new(Created: 2),
                    Readiness: Untouched),

                new("HAI-PALLIATIVE-2027", "Palliative Care at Home", CampaignStatus.Draft,
                    "Healthcare Fund",
                    "Bring pain relief, nursing and dignity to older people with a terminal "
                    + "illness who wish to spend their last months at home.",
                    "Six thousand rupees provides a month of home nursing and pain relief for "
                    + "an elder in their last months.",
                    StartsIn: 150, EndsIn: 330,
                    Target: 1_200_000m, Budget: 100_000m, Ask: 6_000m,
                    City: "Kochi", Zip: "682018",
                    Creator: "aditya.ganesh", Approver: "priyanka.naveen",
                    Owners: ["aditya.ganesh"],
                    Channels: OnlineChannels,
                    Timeline: new(Created: 1),
                    Readiness: Untouched),

                new("HAI-CALENDAR-2025", "Grandparents' Day Calendar Sale", CampaignStatus.Cancelled,
                    "Elder Care Fund",
                    "A fundraising calendar illustrated by residents of the organisation's "
                    + "care homes, sold in aid of the Elder Care Fund.",
                    "Three hundred and fifty rupees buys a calendar painted by elders in our "
                    + "care homes.",
                    StartsIn: -300, EndsIn: -240,
                    Target: 200_000m, Budget: 60_000m, Ask: 350m,
                    City: "New Delhi", Zip: "110016",
                    Creator: "ritu.anil", Approver: "priyanka.naveen",
                    Owners: ["ritu.anil"],
                    Channels: LocalChannels,
                    Timeline: new(Created: 330, Cancelled: 310),
                    Readiness: Untouched,
                    Close: new("Printing cost too high",
                        "Printing quotes came in above the expected sale income, so the draft "
                        + "was cancelled before it was submitted."))
            ],
            Assets:
            [
                // ---- Care for the Elderly: twelve assets, every type and every status ----------
                new("HAI-ELDERCARE-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "residents-association-poster", TrackingAssetStatus.Active, 512, "ritu.anil",
                    ["Residents' association notice board, Safdarjung Enclave",
                     "Green Park Metro station concourse",
                     "Senior citizens' walk kiosk, Lodhi Road"]),
                new("HAI-ELDERCARE-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "older-persons-day-stall", TrackingAssetStatus.Active, 238, "ritu.anil",
                    ["International Day of Older Persons stall, Lodhi Road"]),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "EMAIL", "NEWSLETTER", "EMAIL",
                    "september-newsletter", TrackingAssetStatus.Active, 1_021, "ritu.anil"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "WEBSITE", "WEBSITE", "ORGANIC",
                    "homepage-donate-button", TrackingAssetStatus.Active, 1_764, "ritu.anil"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "SOCIAL", "INSTAGRAM", "PAID_SOCIAL",
                    "grandparents-stories-reel", TrackingAssetStatus.Active, 2_410, "ritu.anil"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "MESSAGING", "WHATSAPP", "SOCIAL",
                    "whatsapp-supporter-broadcast", TrackingAssetStatus.Active, 705, "ritu.anil"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "SEARCH", "GOOGLE", "CPC",
                    "search-donate-for-elderly", TrackingAssetStatus.Active, 1_342, "ritu.anil"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "pharmacy-counter-standee", TrackingAssetStatus.DisableRequested, 156, "aditya.ganesh",
                    ["Neighbourhood pharmacy counters, South Delhi"]),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "SOCIAL", "FACEBOOK", "SOCIAL",
                    "facebook-pinned-appeal", TrackingAssetStatus.Inactive, 91, "ritu.anil"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "PARTNER", "PARTNER_SITE", "REFERRAL",
                    "employee-giving-portal-listing", TrackingAssetStatus.Approved, 0, "ritu.anil"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.LandingPage, "REFERRAL", "PARTNER_SITE", "BANNER",
                    "senior-living-partner-banner", TrackingAssetStatus.Submitted, 0, "aditya.ganesh"),
                new("HAI-ELDERCARE-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "republic-day-health-camp", TrackingAssetStatus.Draft, 0, "aditya.ganesh",
                    ["Republic Day health camp, Qutab Institutional Area"]),

                // ---- Mobile Healthcare Units ---------------------------------------------------
                new("HAI-MOBILECARE-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "mobile-unit-side-panel", TrackingAssetStatus.Active, 286, "aditya.ganesh",
                    ["Mobile healthcare unit 1 - Aliganj route",
                     "Mobile healthcare unit 2 - Chinhat route"]),
                new("HAI-MOBILECARE-2026", TrackingAssetType.LandingPage, "EMAIL", "NEWSLETTER", "EMAIL",
                    "doorstep-care-impact-mailer", TrackingAssetStatus.Active, 377, "ritu.anil"),
                new("HAI-MOBILECARE-2026", TrackingAssetType.LandingPage, "SOCIAL", "FACEBOOK", "PAID_SOCIAL",
                    "doctor-at-the-doorstep-video", TrackingAssetStatus.Active, 1_108, "ritu.anil"),

                // ---- Restore Sight -------------------------------------------------------------
                new("HAI-SIGHT-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "eye-camp-registration-desk", TrackingAssetStatus.Active, 192, "aditya.ganesh",
                    ["Eye camp registration desk, Egmore",
                     "Community hall notice board, T. Nagar"]),
                new("HAI-SIGHT-2026", TrackingAssetType.LandingPage, "MESSAGING", "WHATSAPP", "SMS",
                    "eye-camp-volunteer-group", TrackingAssetStatus.Active, 244, "aditya.ganesh"),
                new("HAI-SIGHT-2026", TrackingAssetType.LandingPage, "WEBSITE", "WEBSITE", "BANNER",
                    "restore-sight-landing-page", TrackingAssetStatus.Submitted, 0, "ritu.anil"),

                // ---- Winter Relief: prepared ahead of launch ---------------------------------------
                new("HAI-WINTER-2026", TrackingAssetType.LandingPage, "EMAIL", "NEWSLETTER", "EMAIL",
                    "winter-early-appeal-mailer", TrackingAssetStatus.Approved, 0, "ritu.anil"),
                new("HAI-WINTER-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "blanket-collection-drive", TrackingAssetStatus.Draft, 0, "ritu.anil",
                    ["Blanket collection point, Qutab Institutional Area"]),

                // ---- Digital Literacy for Seniors (paused) ----------------------------------------
                new("HAI-DIGITAL-2026", TrackingAssetType.QRCode, "OFFLINE", "EVENT", "PRINT",
                    "senior-tech-fair-counter", TrackingAssetStatus.Active, 88, "ritu.anil",
                    ["Senior tech fair counter, Jayanagar 4th Block"]),
                new("HAI-DIGITAL-2026", TrackingAssetType.LandingPage, "SOCIAL", "INSTAGRAM", "SOCIAL",
                    "silver-surfers-stories", TrackingAssetStatus.Inactive, 197, "ritu.anil"),

                // ---- Physiotherapy at Home (closing) ---------------------------------------------
                new("HAI-PHYSIO-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "physiotherapy-centre-desk", TrackingAssetStatus.Active, 149, "aditya.ganesh",
                    ["Physiotherapy centre front desk, Dadar (West)"]),
                new("HAI-PHYSIO-2026", TrackingAssetType.LandingPage, "MESSAGING", "WHATSAPP", "SOCIAL",
                    "caregiver-group-broadcast", TrackingAssetStatus.DisableRequested, 121, "aditya.ganesh"),

                // ---- Heatwave Relief (closed): everything taken down ------------------------------
                new("HAI-HEATWAVE-2026", TrackingAssetType.LandingPage, "SOCIAL", "FACEBOOK", "SOCIAL",
                    "heatwave-urgent-appeal", TrackingAssetStatus.Inactive, 1_690, "ritu.anil"),
                new("HAI-HEATWAVE-2026", TrackingAssetType.LandingPage, "WEBSITE", "WEBSITE", "BANNER",
                    "heatwave-emergency-banner", TrackingAssetStatus.Inactive, 2_085, "ritu.anil"),
                new("HAI-HEATWAVE-2026", TrackingAssetType.QRCode, "OFFLINE", "QR_POSTER", "PRINT",
                    "water-kiosk-poster", TrackingAssetStatus.Inactive, 274, "aditya.ganesh",
                    ["Drinking-water kiosk, Hazratganj", "Charbagh railway station concourse"])
            ])
    ];
}
