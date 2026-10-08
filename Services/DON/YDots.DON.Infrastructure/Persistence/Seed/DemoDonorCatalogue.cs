using YDots.DON.Domain.Enums;

namespace YDots.DON.Infrastructure.Persistence.Seed;

/// <summary>
/// The demonstration donors, leads and follow-up work of the two activated sample Organisations.
///
/// DATA, KEPT APART FROM THE SEEDER'S LOGIC, in the way IAM's SampleOrganisationCatalogue is.
/// <see cref="DemoDonorSeeder"/> decides HOW a row is written; this file says WHAT is written.
///
/// WHAT EACH ORGANISATION GETS, and why the numbers are what they are:
///
///   22 donors   every donor type, status and approval state; twelve of them are the people who
///               hold a donor-portal login in IAM, matched on the same e-mail address
///   64 leads    every pipeline stage from New to Converted, cold to hot, across four owners and
///               an unassigned pool - so the Lead Work Queue, each owner's My Leads and the
///               Assignment Board all open on real work
///   follow-ups  one open task behind every lead that is being worked, the completed call behind
///               every lead that has been spoken to, and the stewardship tasks owed to donors -
///               which is what fills each person's own Follow-up Queue
///
/// A LEAD ROW CARRIES ITS OWN HISTORY. The seeder derives the rest from it rather than asking
/// for it twice: who it is assigned to becomes an assignment row, the last contact becomes an
/// entry on the communication timeline and a completed follow-up, the next action becomes an open
/// follow-up on the same medium. One line here is therefore one coherent story on five screens.
///
/// THE SAME PEOPLE APPEAR IN PAY. A donor's gifts are seeded by the payments module against the
/// e-mail address written here, and a converted lead is named there by the same address - see
/// <c>DemoIds</c> for the contract. Change an address in one catalogue and the donor's giving
/// history belongs to nobody.
///
/// EVERY DATE IS RELATIVE TO THE DAY THE DATA IS SEEDED. <c>Joined</c>, <c>captured</c> and
/// <c>contacted</c> count days AGO; <c>due</c> counts days from now and is negative for work that
/// is already overdue, which is what puts the Overdue and Breached badges on the queue.
///
/// THE ORGANISATIONS ARE REAL AND EVERYBODY ELSE IS INVENTED. Every person and company below is
/// fictional, no name carries a caste or community marker - each surname is a common given name
/// used as a patronymic, the rule IAM's catalogue sets - and every e-mail address is on the
/// reserved <c>.test</c> domain, so nothing this environment sends can reach a real inbox.
/// </summary>
internal static class DemoDonorCatalogue
{
    internal sealed record DemoOrganisation(
        string Subdomain,
        string Administrator,
        string Manager,
        int ReferenceBase,
        IReadOnlyDictionary<string, string> Teams,
        IReadOnlyList<DemoCampaign> Campaigns,
        IReadOnlyList<DemoDonor> Donors,
        IReadOnlyList<DemoLead> Leads,
        IReadOnlyList<DemoTask> Stewardship,
        IReadOnlyList<DemoPromise> Promises,
        IReadOnlyList<DemoDocument> Documents,
        DemoDuplicate Duplicate);

    /// <summary>
    /// One of CAM's campaigns, as DON's own campaign table mirrors it. <paramref name="Open"/> is
    /// false for one that has closed since leads were taken against it.
    /// </summary>
    internal sealed record DemoCampaign(string Code, string Name, bool Open, int StartsIn, int EndsIn);

    /// <summary>
    /// One donor.
    ///
    /// <paramref name="Consents"/> is a space-separated list of two-character marks: a channel -
    /// E-mail, Sms, WhatsApp, Phone call, pOst - and what the donor said about it: <c>+</c>
    /// granted, <c>-</c> withdrawn, <c>?</c> asked and not yet answered, <c>x</c> granted and
    /// since expired, <c>s</c> granted after an earlier record was corrected.
    /// </summary>
    internal sealed record DemoDonor(
        DonorType Type,
        string? First,
        string? Last,
        string? Organisation,
        string? Email,
        string? Mobile,
        string Language,
        DonorStatus Status,
        ApprovalState Approval,
        string? Owner,
        int Joined,
        string? Address = null,
        string Consents = "",
        DemoVerification? Verified = null,
        string[]? Tags = null,
        bool DoNotContact = false,
        string? Notes = null,
        string? Reason = null,
        string? MergedInto = null,
        string? FromLead = null,
        bool CreatedByGift = false,
        string? Key = null)
    {
        /// <summary>What <c>DemoIds</c> derives this donor's id from.</summary>
        public string IdKey => Email ?? Key ?? $"phone:{Mobile}";
    }

    internal sealed record DemoVerification(
        VerificationStatus Status, VerificationChannel Channel, int DaysAgo);

    /// <summary>One lead. <c>Lead(...)</c> below is how the rows are written.</summary>
    internal sealed record DemoLead(
        string First,
        string Last,
        string Mobile,
        string? Email,
        string Language,
        string City,
        string Campaign,
        string Source,
        LeadStatus Status,
        LeadTemperature Temperature,
        DonationPotential Potential,
        string? Owner,
        int Captured,
        string? NextAction,
        double? Due,
        ConsentChannel Medium,
        ContactOutcome LastOutcome,
        int? Contacted,
        ConsentState Consent,
        string? Notes,
        string? Closure,
        string? ConvertedTo,
        string? PreviousOwner)
    {
        /// <summary>What <c>DemoIds</c> derives this lead's id from.</summary>
        public string IdKey => Email ?? Mobile;
    }

    /// <summary>A follow-up owed to a donor rather than to a lead.</summary>
    internal sealed record DemoTask(
        string Donor,
        string Owner,
        string Purpose,
        ConsentChannel Medium,
        string NextAction,
        double Due,
        FollowUpPriority Priority,
        FollowUpStatus Status,
        string? Outcome = null);

    internal sealed record DemoPromise(
        string Donor,
        decimal Amount,
        decimal Outstanding,
        int Promised,
        int Due,
        PromiseStatus Status,
        string Campaign,
        string Notes);

    internal sealed record DemoDocument(
        string Donor,
        string Kind,
        string Name,
        string Description,
        DocumentClassification Classification,
        long SizeInBytes);

    /// <summary>The one duplicate review behind the Organisation's merged donor record.</summary>
    internal sealed record DemoDuplicate(
        string Survivor,
        string Duplicate,
        string Name,
        string Evidence,
        string ConflictingFields,
        string Reason);

    /// <summary>The tags a donor can carry: the stable code, the label and what it means.</summary>
    internal static readonly IReadOnlyDictionary<string, (string Name, string Description)> Tags =
        new Dictionary<string, (string, string)>
        {
            ["MAJOR_GIVER"] = ("Major giver", "Cumulative giving above the major-gift threshold."),
            ["REGULAR_GIVER"] = ("Regular giver", "Gives in most months of the year."),
            ["CORPORATE"] = ("Corporate partner", "An organisation giving under its CSR programme."),
            ["VOLUNTEER"] = ("Volunteer", "Also gives time at the organisation's events and centres."),
            ["EIGHTY_G"] = ("80G receipt required", "Claims tax relief and needs a PAN-bearing receipt."),
            ["FIRST_GIFT"] = ("First-time donor", "Made a first gift in the last two months.")
        };

    // =============================================================================================
    // How the rows are written
    // =============================================================================================

    private static DemoDonor Person(
        string name, string mobile, string language, DonorStatus status, ApprovalState approval,
        string? owner, int joined, string? address = null, string consents = "",
        DemoVerification? verified = null, string[]? tags = null, bool doNotContact = false,
        string? notes = null, string? reason = null, string? fromLead = null,
        bool createdByGift = false)
    {
        var (first, last) = Split(name);

        return new DemoDonor(
            DonorType.Individual, first, last, null, EmailFor(first, last), mobile, language, status,
            approval, owner, joined, address, consents, verified, tags, doNotContact, notes, reason,
            FromLead: fromLead, CreatedByGift: createdByGift);
    }

    private static DemoDonor Company(
        string name, string email, string telephone, DonorStatus status, ApprovalState approval,
        string owner, int joined, string address, string consents = "",
        DemoVerification? verified = null, string[]? tags = null, string? notes = null) =>
        new(DonorType.Organisation, null, null, name, email, telephone, "en-IN", status, approval,
            owner, joined, address, consents, verified, tags, Notes: notes);

    /// <summary>
    /// One lead, written as a sentence: who, where, what they asked about and how, where they are
    /// in the pipeline, who holds them, and what happens next.
    ///
    /// THE E-MAIL ADDRESS AND THE MOBILE NUMBER ARE WORKED OUT, not typed, unless a row says
    /// otherwise - the address from the name, the number from the city and the name - so sixty
    /// rows stay readable. A lead who later became a donor passes the donor's own number.
    /// </summary>
    private static DemoLead Lead(
        string name, string city, string language, string campaign, string source,
        LeadStatus status, LeadTemperature temperature, DonationPotential potential, string? owner,
        int captured, string? next = null, double? due = null,
        ConsentChannel via = ConsentChannel.PhoneCall,
        ContactOutcome last = ContactOutcome.NotContacted, int? contacted = null,
        ConsentState consent = ConsentState.Granted, bool email = true, string? mobile = null,
        string? notes = null, string? closure = null, string? convertedTo = null,
        string? previousOwner = null)
    {
        var (first, last2) = Split(name);

        return new DemoLead(
            first, last2, mobile ?? MobileFor(city, name), email ? EmailFor(first, last2) : null,
            language, city, campaign, source, status, temperature, potential, owner, captured, next,
            due, via, last, contacted, consent, notes, closure, convertedTo, previousOwner);
    }

    private static (string First, string Last) Split(string name)
    {
        var space = name.LastIndexOf(' ');

        return space <= 0 ? (name, string.Empty) : (name[..space], name[(space + 1)..]);
    }

    private static string EmailFor(string first, string last) =>
        $"{first}.{last}".Replace(" ", string.Empty).Replace("'", string.Empty).ToLowerInvariant()
        + "@mail.test";

    /// <summary>The mobile-number series a telecom circle is known by, for a plausible number.</summary>
    private static readonly IReadOnlyDictionary<string, string> MobileSeries =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Mumbai"] = "9820", ["Thane"] = "9821", ["Pune"] = "9822", ["Nagpur"] = "9823",
            ["Nashik"] = "9850", ["Ahmedabad"] = "9825", ["Surat"] = "9824", ["Vadodara"] = "9879",
            ["New Delhi"] = "9811", ["Noida"] = "9810", ["Gurugram"] = "9871", ["Jaipur"] = "9829",
            ["Chandigarh"] = "9815", ["Lucknow"] = "9839", ["Kanpur"] = "9838", ["Varanasi"] = "9415",
            ["Prayagraj"] = "9450", ["Dehradun"] = "9837", ["Patna"] = "9835",
            ["Bengaluru"] = "9845", ["Mysuru"] = "9886", ["Mangaluru"] = "9844",
            ["Chennai"] = "9840", ["Coimbatore"] = "9843", ["Madurai"] = "9842", ["Tiruchirappalli"] = "9443",
            ["Hyderabad"] = "9849", ["Visakhapatnam"] = "9848", ["Vijayawada"] = "9866",
            ["Kochi"] = "9847", ["Thiruvananthapuram"] = "9846", ["Kozhikode"] = "9895",
            ["Kolkata"] = "9830", ["Bhubaneswar"] = "9437", ["Guwahati"] = "9435"
        };

    private static string MobileFor(string city, string name)
    {
        unchecked
        {
            var hash = 17;

            foreach (var character in name)
            {
                hash = (hash * 31) + character;
            }

            var series = MobileSeries.GetValueOrDefault(city, "9818");

            return series + ((hash & int.MaxValue) % 1_000_000).ToString("000000");
        }
    }

    // Shorter names for the enum members the lead rows use on every line.
    private const LeadTemperature Cold = LeadTemperature.Cold;
    private const LeadTemperature Warm = LeadTemperature.Warm;
    private const LeadTemperature Hot = LeadTemperature.Hot;
    private const DonationPotential Low = DonationPotential.Low;
    private const DonationPotential Medium = DonationPotential.Medium;
    private const DonationPotential High = DonationPotential.High;
    private const ConsentChannel ByEmail = ConsentChannel.Email;
    private const ConsentChannel ByPhone = ConsentChannel.PhoneCall;
    private const ConsentChannel ByWhatsApp = ConsentChannel.WhatsApp;
    private const ConsentChannel BySms = ConsentChannel.Sms;
    private const ContactOutcome Reached = ContactOutcome.Reached;
    private const ContactOutcome NoAnswer = ContactOutcome.NoAnswer;
    private const ContactOutcome Callback = ContactOutcome.CallbackRequested;

    private static DemoVerification Verified(VerificationChannel channel, int daysAgo) =>
        new(VerificationStatus.Verified, channel, daysAgo);

    internal static readonly IReadOnlyList<DemoOrganisation> Organisations =
    [
        // ============ SMILE FOUNDATION ============================================================
        new(
            Subdomain: "smilefoundation",
            Administrator: "anjali.prakash",
            Manager: "kavita.ashok",
            ReferenceBase: 1,
            Teams: new Dictionary<string, string>
            {
                ["manish.vinod"] = "WEST",
                ["pooja.srinivas"] = "SOUTH",
                ["kavita.ashok"] = "NORTH",
                ["anjali.prakash"] = "INSTITUTIONAL"
            },
            Campaigns:
            [
                new("SF-EDU-2026", "Educate a Child 2026", true, -99, 174),
                new("SF-HEALTH-2026", "Health on Wheels - Mobile Clinic Appeal", true, -75, 106),
                new("SF-NUTRITION-2026", "Midday Nutrition for Every Classroom", true, -66, 144),
                new("SF-DIWALI-2026", "Diwali of Hope - Festive Giving 2026", true, 10, 45),
                new("SF-WINTER-2026", "Warm Winters - Blanket and Woollens Drive", true, 24, 100),
                new("SF-STEM-2026", "Girls in STEM Scholarship Fund", true, -3, 180),
                new("SF-SKILLS-2026", "Youth Skilling and Employability Drive", true, -1, 150),
                new("SF-LIVELIHOOD-2026", "Women's Livelihood - Tailoring Units", true, -120, 60),
                new("SF-MONSOON-2026", "Monsoon Health Camps 2026", false, -110, -4),
                new("SF-FLOOD-2026", "Assam Flood Relief 2026", false, -118, -7)
            ],
            Donors:
            [
                // ---- The twelve donor-portal accounts IAM seeds --------------------------------
                Person("Harish Gopal", "9847012365", "ml-IN", DonorStatus.Active, ApprovalState.Approved,
                    "pooja.srinivas", 210, "14, Chittoor Road, Ernakulam South, Kochi 682016",
                    "Es S+ W+ P+", Verified(VerificationChannel.Sms, 180), ["REGULAR_GIVER", "EIGHTY_G"]),
                Person("Lakshmi Venkatesh", "9840275136", "ta-IN", DonorStatus.Active, ApprovalState.Approved,
                    "pooja.srinivas", 195, "Flat 3B, Sai Nivas, 27 Venkatakrishna Road, Mandaveli, Chennai 600028",
                    "E+ W+ S+ P-", Verified(VerificationChannel.Email, 170), ["REGULAR_GIVER"]),
                Person("Siddharth Dinesh", "9830164572", "en-IN", DonorStatus.Active, ApprovalState.Approved,
                    "kavita.ashok", 160, "BE-112, Sector I, Salt Lake City, Kolkata 700064",
                    "E+ P+", new(VerificationStatus.ChallengeSent, VerificationChannel.Sms, 0), ["EIGHTY_G"]),
                Person("Meera Krishnan", "9845163027", "kn-IN", DonorStatus.Active, ApprovalState.Approved,
                    "pooja.srinivas", 140, "No. 218, 6th Main, HAL 2nd Stage, Indiranagar, Bengaluru 560038",
                    "E+ W+ S+", Verified(VerificationChannel.WhatsApp, 120), ["REGULAR_GIVER", "VOLUNTEER"]),
                Person("Anand Raghavan", "9841052736", "ta-IN", DonorStatus.Active, ApprovalState.Approved,
                    "pooja.srinivas", 110, "Old No. 9, New No. 17, Second Street, R.A. Puram, Chennai 600028",
                    "E+ P+ W-", Verified(VerificationChannel.Email, 90), ["EIGHTY_G"]),
                Person("Divya Mahesh", "9820471356", "mr-IN", DonorStatus.Active, ApprovalState.Approved,
                    "manish.vinod", 120, "B-704, Sea Breeze Apartments, Carter Road, Bandra (West), Mumbai 400050",
                    "E+ W+ P+ S-", Verified(VerificationChannel.Sms, 100), ["REGULAR_GIVER"]),
                Person("Rajiv Narayan", "9810364527", "hi-IN", DonorStatus.Active, ApprovalState.Approved,
                    "kavita.ashok", 300, "C-42, Second Floor, Defence Colony, New Delhi 110024",
                    "E+ P+ O+", Verified(VerificationChannel.PhoneCall, 280), ["MAJOR_GIVER", "EIGHTY_G"]),
                Person("Sunita Prasad", "9839027415", "hi-IN", DonorStatus.Active, ApprovalState.Approved,
                    "kavita.ashok", 95, "3/114, Vivek Khand, Gomti Nagar, Lucknow 226010",
                    "E+ W+ S?", new(VerificationStatus.Failed, VerificationChannel.Sms, 60)),
                Person("Thomas Mathew", "9847260318", "ml-IN", DonorStatus.Active, ApprovalState.Approved,
                    "pooja.srinivas", 2, "Kizhakkethil House, Kaloor-Kadavanthra Road, Kadavanthra, Kochi 682020",
                    "E+ W+ P+", new(VerificationStatus.NotStarted, VerificationChannel.Email, 1), ["FIRST_GIFT"],
                    notes: "Created automatically from a completed donation.",
                    fromLead: "thomas.mathew@mail.test", createdByGift: true),
                Person("Ayesha Karim", "9849315072", "te-IN", DonorStatus.Active, ApprovalState.Approved,
                    "pooja.srinivas", 85, "8-2-293/82, Road No. 10, Banjara Hills, Hyderabad 500034",
                    "E+ W+", new(VerificationStatus.Escalated, VerificationChannel.WhatsApp, 30), ["VOLUNTEER"]),
                Person("Nikhil Sanjay", "9822640715", "mr-IN", DonorStatus.Active, ApprovalState.Approved,
                    "manish.vinod", 75, "Flat 12, Sahyadri Residency, Law College Road, Erandwane, Pune 411004",
                    "Ex P+ W+", new(VerificationStatus.Expired, VerificationChannel.Email, 6)),
                Person("Revathi Sundar", "9843107526", "ta-IN", DonorStatus.Active, ApprovalState.Approved,
                    "pooja.srinivas", 65, "41, Bharathi Park 2nd Cross, Saibaba Colony, Coimbatore 641011",
                    "E+ W+ P+ S+ O+", new(VerificationStatus.Cancelled, VerificationChannel.Sms, 40), ["REGULAR_GIVER"]),

                // ---- Companies giving under their CSR programmes -------------------------------
                Company("Meridian Textiles Private Limited", "csr@meridiantextiles.test", "4222450138",
                    DonorStatus.Active, ApprovalState.Approved, "anjali.prakash", 330,
                    "SF No. 218, Avinashi Road, Peelamedu, Coimbatore 641004",
                    "E+ P+ O+", Verified(VerificationChannel.PhoneCall, 320), ["CORPORATE", "MAJOR_GIVER"]),
                Company("Northbridge Logistics LLP", "giving@northbridgelogistics.test", "2226837410",
                    DonorStatus.Active, ApprovalState.Approved, "anjali.prakash", 150,
                    "Unit 6, Kalpataru Square, Kondivita Road, Andheri (East), Mumbai 400059",
                    "E+ P+", tags: ["CORPORATE"]),
                Company("Saffron Leaf Foods Private Limited", "csr@saffronleaffoods.test", "8041237650",
                    DonorStatus.Prospect, ApprovalState.PendingApproval, "anjali.prakash", 3,
                    "No. 12, 100 Feet Road, Koramangala, Bengaluru 560034", "E+",
                    notes: "The CSR committee has approved an education partnership in principle; "
                           + "the signed documents are awaited."),

                // ---- Everybody else: one record in each state the register can show ------------
                Person("Gautam Vijay", "9820536174", "en-IN", DonorStatus.Active, ApprovalState.Approved,
                    "manish.vinod", 1, "A-1203, Lakeview Towers, Hiranandani Gardens, Powai, Mumbai 400076",
                    "E+", tags: ["FIRST_GIFT"],
                    notes: "Created automatically from a completed donation.",
                    fromLead: "gautam.vijay@mail.test", createdByGift: true),
                Person("Latha Murugan", "9811574203", "ta-IN", DonorStatus.Prospect, ApprovalState.NotSubmitted,
                    "kavita.ashok", 2, consents: "E+ P+",
                    notes: "Converted from a lead met at the Teachers' Day stall; first gift expected this month.",
                    fromLead: "latha.murugan@mail.test"),
                Person("Kishore Babu", "9848216539", "te-IN", DonorStatus.Prospect, ApprovalState.Rejected,
                    "pooja.srinivas", 25,
                    notes: "Approval was declined: the contact details on the form could not be "
                           + "confirmed. The record is kept for reference."),
                Person("Usha Rajan", "9840618273", "ta-IN", DonorStatus.Restricted, ApprovalState.Cancelled,
                    "pooja.srinivas", 130, consents: "E- P- W-", doNotContact: true,
                    reason: "The donor asked for her record to be restricted and for all contact to stop."),
                Person("Mohan Shekhar", "9811283746", "hi-IN", DonorStatus.Archived, ApprovalState.Approved,
                    "kavita.ashok", 420, consents: "E+",
                    reason: "Moved abroad and closed his Indian bank account; no further giving is expected."),
                new(DonorType.Individual, "Lakshmi", "V.", null, null, "9840275199", "ta-IN",
                    DonorStatus.Merged, ApprovalState.Approved, "pooja.srinivas", 200,
                    Notes: "A second record created from a telephone enquiry, merged into the "
                           + "donor's main record.",
                    MergedInto: "lakshmi.venkatesh@mail.test"),
                new(DonorType.Anonymous, null, null, null, null, null, "en-IN",
                    DonorStatus.Active, ApprovalState.Approved, null, 50,
                    Notes: "An anonymous gift left in the collection box at the Teachers' Day stall.",
                    Key: "anonymous-collection-box")
            ],
            Leads:
            [
                // ---- Manish Vinod, West: eighteen, the heaviest book on the team ---------------
                Lead("Rohit Mahesh", "Mumbai", "mr-IN", "SF-EDU-2026", "Educate a Child QR poster",
                    LeadStatus.Assigned, Warm, Medium, "manish.vinod", 3,
                    "Introduction call about sponsoring a child", 1, ByPhone),
                Lead("Sonal Kishore", "Pune", "mr-IN", "SF-NUTRITION-2026", "WhatsApp broadcast reply",
                    LeadStatus.Assigned, Cold, Low, "manish.vinod", 2,
                    "Send the nutrition programme one-pager", 2, ByWhatsApp),
                Lead("Imtiaz Salim", "Mumbai", "hi-IN", "SF-HEALTH-2026", "Mobile clinic van QR code",
                    LeadStatus.Assigned, Warm, Medium, "manish.vinod", 5,
                    "Introduction call", -1, ByPhone, previousOwner: "pooja.srinivas"),
                Lead("Pallavi Anand", "Thane", "mr-IN", "SF-EDU-2026", "Instagram lead form",
                    LeadStatus.Assigned, Hot, High, "manish.vinod", 1,
                    "Call today - asked about sponsoring two children", 0, ByPhone),
                Lead("Deepa Ravi", "Mumbai", "en-IN", "SF-EDU-2026", "Website enquiry form",
                    LeadStatus.Contacted, Warm, Medium, "manish.vinod", 9,
                    "E-mail the sponsorship brochure and the 80G note", 1, ByEmail, Reached, 2),
                Lead("Yogesh Prasad", "Nagpur", "hi-IN", "SF-HEALTH-2026", "Newsletter sign-up",
                    LeadStatus.Contacted, Cold, Low, "manish.vinod", 11,
                    "Second call attempt", -2, ByPhone, NoAnswer, 3),
                Lead("Fatima Rahim", "Mumbai", "hi-IN", "SF-LIVELIHOOD-2026", "Self-help group exhibition counter",
                    LeadStatus.Contacted, Warm, Medium, "manish.vinod", 12,
                    "Call back after six in the evening", 0.5, ByPhone, Callback, 4),
                Lead("Girish Narayan", "Pune", "mr-IN", "SF-NUTRITION-2026", "Referral from an existing donor",
                    LeadStatus.Contacted, Hot, High, "manish.vinod", 6,
                    "Share the monthly giving options on WhatsApp", 1, ByWhatsApp, Reached, 1),
                Lead("Nandini Suresh", "Surat", "gu-IN", "SF-EDU-2026", "Facebook lead form",
                    LeadStatus.Contacted, Warm, Low, "manish.vinod", 14,
                    "Send a sponsored child's progress story", 3, ByEmail, Reached, 6),
                Lead("Abhay Vinay", "Mumbai", "en-IN", "SF-EDU-2026", "Corporate employee giving desk",
                    LeadStatus.Qualified, Hot, High, "manish.vinod", 10,
                    "Send the payment link for two sponsorships", 0, ByEmail, Reached, 2),
                Lead("Rekha Mohan", "Pune", "mr-IN", "SF-HEALTH-2026", "Health camp registration desk",
                    LeadStatus.Qualified, Hot, Medium, "manish.vinod", 13,
                    "Confirm the UPI gift and the PAN for the 80G receipt", 1, ByWhatsApp, Reached, 3),
                Lead("Sameer Javed", "Mumbai", "hi-IN", "SF-NUTRITION-2026", "Referral from an existing donor",
                    LeadStatus.Qualified, Warm, High, "manish.vinod", 16,
                    "Call to confirm the annual pledge", -1, ByPhone, Reached, 5),
                Lead("Jyoti Santosh", "Vadodara", "gu-IN", "SF-EDU-2026", "Website enquiry form",
                    LeadStatus.Qualified, Hot, Medium, "manish.vinod", 7,
                    "E-mail the bank transfer details", 2, ByEmail, Reached, 1),
                Lead("Mahesh Umesh", "Nashik", "mr-IN", "SF-DIWALI-2026", "Newsletter sign-up",
                    LeadStatus.Nurture, Cold, Medium, "manish.vinod", 24,
                    "Call when the Diwali appeal opens", 10, ByPhone, Callback, 12),
                Lead("Shruti Paresh", "Ahmedabad", "gu-IN", "SF-WINTER-2026", "Instagram lead form",
                    LeadStatus.Nurture, Warm, Low, "manish.vinod", 22,
                    "Share the winter drive plan in November", 24, ByWhatsApp, Reached, 15),
                Lead("Dilip Ajit", "Mumbai", "hi-IN", "SF-STEM-2026", "Alumni network event",
                    LeadStatus.Nurture, Warm, High, "manish.vinod", 18,
                    "Invite to the scholarship launch", 5, ByEmail, Reached, 9),
                Lead("Gautam Vijay", "Mumbai", "en-IN", "SF-HEALTH-2026", "Referral from an existing donor",
                    LeadStatus.Converted, Hot, High, "manish.vinod", 15,
                    via: ByPhone, last: Reached, contacted: 5, mobile: "9820536174",
                    notes: "Referred by a regular giver; asked to fund a full clinic day.",
                    convertedTo: "gautam.vijay@mail.test"),
                Lead("Prem Lokesh", "Pune", "mr-IN", "SF-FLOOD-2026", "Facebook lead form",
                    LeadStatus.Closed, Cold, Low, "manish.vinod", 40,
                    via: ByPhone, last: ContactOutcome.NotInterested, contacted: 20,
                    closure: "Enquired during the flood appeal, which has since closed, and is not "
                             + "interested in the other programmes."),

                // ---- Pooja Srinivas, South: fourteen ---------------------------------------------
                Lead("Swathi Kannan", "Hyderabad", "te-IN", "SF-LIVELIHOOD-2026", "Self-help group exhibition counter",
                    LeadStatus.Assigned, Warm, Medium, "pooja.srinivas", 4,
                    "Introduction call", 1, ByPhone),
                Lead("Naveen Prabhu", "Bengaluru", "kn-IN", "SF-NUTRITION-2026", "Tech park food court QR code",
                    LeadStatus.Assigned, Cold, Low, "pooja.srinivas", 3,
                    "Send the programme summary", 2, ByEmail),
                Lead("Asha Selvam", "Chennai", "ta-IN", "SF-EDU-2026", "Website enquiry form",
                    LeadStatus.Assigned, Hot, Medium, "pooja.srinivas", 6,
                    "Call - asked to be rung before Friday", -1, ByPhone),
                Lead("Ravi Senthil", "Coimbatore", "ta-IN", "SF-EDU-2026", "Educate a Child QR poster",
                    LeadStatus.Contacted, Warm, Medium, "pooja.srinivas", 8,
                    "WhatsApp the sponsorship details in Tamil", 1, ByWhatsApp, Reached, 2),
                Lead("Shabana Aslam", "Hyderabad", "te-IN", "SF-HEALTH-2026", "Newsletter sign-up",
                    LeadStatus.Contacted, Cold, Low, "pooja.srinivas", 12,
                    "Second call attempt", -3, ByPhone, NoAnswer, 4),
                Lead("Vimala Jayan", "Kochi", "ml-IN", "SF-NUTRITION-2026", "Referral from an existing donor",
                    LeadStatus.Contacted, Hot, High, "pooja.srinivas", 5,
                    "E-mail the monthly giving form", 1, ByEmail, Reached, 1),
                Lead("Kiran Babu", "Visakhapatnam", "te-IN", "SF-SKILLS-2026", "Google search enquiry",
                    LeadStatus.Contacted, Warm, Medium, "pooja.srinivas", 9,
                    "Call back on Saturday morning", 2, ByPhone, Callback, 3),
                Lead("Madhu Saravanan", "Chennai", "ta-IN", "SF-EDU-2026", "Corporate employee giving desk",
                    LeadStatus.Qualified, Hot, High, "pooja.srinivas", 11,
                    "Send the payment link", 0, ByWhatsApp, Reached, 2),
                Lead("Bhavani Chandran", "Mysuru", "kn-IN", "SF-STEM-2026", "Alumni network event",
                    LeadStatus.Qualified, Warm, High, "pooja.srinivas", 13,
                    "Confirm the scholarship pledge by e-mail", 1, ByEmail, Reached, 4),
                Lead("Suresh Gopalan", "Madurai", "ta-IN", "SF-DIWALI-2026", "WhatsApp broadcast reply",
                    LeadStatus.Nurture, Cold, Low, "pooja.srinivas", 26,
                    "Message when the Diwali appeal opens", 10, ByWhatsApp, Callback, 14),
                Lead("Anjana Madhavan", "Kochi", "ml-IN", "SF-EDU-2026", "Instagram lead form",
                    LeadStatus.Nurture, Warm, Medium, "pooja.srinivas", 21,
                    "Share the term-end progress report", 18, ByEmail, Reached, 10),
                Lead("Thomas Mathew", "Kochi", "ml-IN", "SF-HEALTH-2026", "Referral from an existing donor",
                    LeadStatus.Converted, Hot, Medium, "pooja.srinivas", 30,
                    via: ByPhone, last: Reached, contacted: 6, mobile: "9847260318",
                    notes: "Asked for the payment link after a call about the mobile clinics.",
                    convertedTo: "thomas.mathew@mail.test"),
                Lead("Hameed Farooq", "Hyderabad", "te-IN", "SF-MONSOON-2026", "Health camp registration desk",
                    LeadStatus.Closed, Cold, Low, "pooja.srinivas", 35,
                    via: ByPhone, last: ContactOutcome.WrongNumber, contacted: 18, email: false,
                    closure: "The mobile number on the camp form belongs to somebody else and no "
                             + "e-mail address was given."),
                Lead("Saroja Rajan", "Chennai", "ta-IN", "SF-EDU-2026", "Website enquiry form",
                    LeadStatus.Suppressed, Cold, Low, "pooja.srinivas", 19,
                    via: ByPhone, last: ContactOutcome.DoNotContact, contacted: 8,
                    consent: ConsentState.Withdrawn,
                    notes: "Asked not to be contacted again and was removed from every appeal."),

                // ---- Kavita Ashok, the Fundraising Manager's own book: twelve -------------------
                Lead("Amit Sunil", "New Delhi", "hi-IN", "SF-EDU-2026", "Teachers' Day fundraiser stall",
                    LeadStatus.Assigned, Warm, High, "kavita.ashok", 4,
                    "Introduction call", 1, ByPhone),
                Lead("Neelam Satish", "Lucknow", "hi-IN", "SF-WINTER-2026", "WhatsApp broadcast reply",
                    LeadStatus.Assigned, Cold, Medium, "kavita.ashok", 2,
                    "Send the winter drive outline", 3, ByWhatsApp),
                Lead("Tarun Rakesh", "Chandigarh", "pa-IN", "SF-EDU-2026", "Website enquiry form",
                    LeadStatus.Contacted, Warm, Medium, "kavita.ashok", 10,
                    "E-mail the 80G details", 1, ByEmail, Reached, 3),
                Lead("Shalini Ramesh", "Noida", "hi-IN", "SF-HEALTH-2026", "Newsletter sign-up",
                    LeadStatus.Contacted, Hot, High, "kavita.ashok", 5,
                    "Call to discuss sponsoring a clinic day", 0, ByPhone, Reached, 1),
                Lead("Zaheer Akbar", "New Delhi", "hi-IN", "SF-NUTRITION-2026", "Referral from an existing donor",
                    LeadStatus.Contacted, Warm, Medium, "kavita.ashok", 13,
                    "Call back after office hours", -1, ByPhone, Callback, 5),
                Lead("Preeti Vivek", "Jaipur", "hi-IN", "SF-STEM-2026", "Alumni network event",
                    LeadStatus.Contacted, Cold, Low, "kavita.ashok", 17,
                    "Third call attempt, then an e-mail", -4, ByPhone, NoAnswer, 6),
                Lead("Sudhir Pramod", "Gurugram", "en-IN", "SF-EDU-2026", "Corporate employee giving desk",
                    LeadStatus.Qualified, Hot, High, "kavita.ashok", 9,
                    "Send the payment link for five sponsorships", 1, ByEmail, Reached, 2),
                Lead("Aruna Girish", "New Delhi", "hi-IN", "SF-SKILLS-2026", "Google search enquiry",
                    LeadStatus.Qualified, Warm, Medium, "kavita.ashok", 12,
                    "Share the bank details for a transfer", 2, ByEmail, Reached, 4),
                Lead("Vikas Naresh", "Lucknow", "hi-IN", "SF-HEALTH-2026", "Health camp registration desk",
                    LeadStatus.Qualified, Hot, Medium, "kavita.ashok", 6,
                    "Confirm the gift on WhatsApp", 0, ByWhatsApp, Reached, 1),
                Lead("Kamala Jagdish", "New Delhi", "hi-IN", "SF-DIWALI-2026", "Newsletter sign-up",
                    LeadStatus.Nurture, Warm, High, "kavita.ashok", 20,
                    "Invite to the Diwali mela stall", 9, ByEmail, Reached, 11),
                Lead("Rajendra Subhash", "Jaipur", "hi-IN", "SF-WINTER-2026", "Facebook lead form",
                    LeadStatus.Nurture, Cold, Low, "kavita.ashok", 28,
                    "Call in the first week of November", 26, ByPhone, Callback, 16),
                Lead("Latha Murugan", "New Delhi", "ta-IN", "SF-EDU-2026", "Teachers' Day fundraiser stall",
                    LeadStatus.Converted, Hot, Medium, "kavita.ashok", 9,
                    via: ByPhone, last: Reached, contacted: 3, mobile: "9811574203",
                    notes: "Met at the Teachers' Day stall; will sponsor one child from this month.",
                    convertedTo: "latha.murugan@mail.test"),

                // ---- Anjali Prakash: institutional relationships held at head office: twelve ----
                Lead("Ashwin Mukesh", "Mumbai", "en-IN", "SF-EDU-2026", "CSR desk referral",
                    LeadStatus.Assigned, Warm, High, "anjali.prakash", 4,
                    "Introductory call with the CSR head", 2, ByPhone,
                    notes: "CSR manager at a logistics company; interested in adopting a learning centre."),
                Lead("Renuka Vinod", "Bengaluru", "en-IN", "SF-STEM-2026", "Board member introduction",
                    LeadStatus.Assigned, Hot, High, "anjali.prakash", 2,
                    "Send the scholarship partnership deck", 1, ByEmail,
                    notes: "Heads the foundation of a technology company; introduced by a board member."),
                Lead("Sanjay Krishnan", "Chennai", "en-IN", "SF-EDU-2026", "Trust and foundation enquiry",
                    LeadStatus.Contacted, Warm, High, "anjali.prakash", 10,
                    "E-mail the audited accounts and the 12A and 80G certificates", 1, ByEmail, Reached, 3,
                    notes: "Trustee of a family foundation that funds primary education."),
                Lead("Meenakshi Sundar", "Coimbatore", "ta-IN", "SF-NUTRITION-2026", "CSR desk referral",
                    LeadStatus.Contacted, Hot, High, "anjali.prakash", 8,
                    "Arrange a visit to the Bengaluru learning centre", 4, ByPhone, Reached, 2,
                    notes: "CSR lead at an engineering firm; wants to see a centre before committing."),
                Lead("Rajesh Anup", "Pune", "en-IN", "SF-SKILLS-2026", "Corporate employee giving desk",
                    LeadStatus.Contacted, Warm, Medium, "anjali.prakash", 13,
                    "Call back after their board meeting", 6, ByPhone, Callback, 5,
                    notes: "HR head exploring a payroll-giving scheme for skilling."),
                Lead("Farzana Nazir", "Hyderabad", "en-IN", "SF-HEALTH-2026", "CSR desk referral",
                    LeadStatus.Contacted, Cold, Medium, "anjali.prakash", 15,
                    "Follow up by e-mail", -2, ByEmail, NoAnswer, 7,
                    notes: "Sustainability manager at a pharmaceutical distributor."),
                Lead("Venkat Raman", "Chennai", "en-IN", "SF-EDU-2026", "Board member introduction",
                    LeadStatus.Qualified, Hot, High, "anjali.prakash", 14,
                    "Send the draft agreement for a three-year partnership", 3, ByEmail, Reached, 2,
                    notes: "Managing director of a manufacturing group; ready to adopt two centres."),
                Lead("Shobha Dinesh", "Mumbai", "en-IN", "SF-HEALTH-2026", "CSR desk referral",
                    LeadStatus.Qualified, Hot, High, "anjali.prakash", 16,
                    "Share the mobile clinic adoption budget", 1, ByEmail, Reached, 4,
                    notes: "CSR head at a financial services company; budget cycle closes this month."),
                Lead("Nitin Rahul", "Gurugram", "en-IN", "SF-STEM-2026", "Trust and foundation enquiry",
                    LeadStatus.Qualified, Warm, High, "anjali.prakash", 19,
                    "Submit the grant application form", 7, ByEmail, Reached, 6,
                    notes: "Programme officer at a grant-making trust; application window is open."),
                Lead("Lata Uday", "Kolkata", "bn-IN", "SF-WINTER-2026", "Board member introduction",
                    LeadStatus.Nurture, Warm, Medium, "anjali.prakash", 25,
                    "Reconnect after their CSR committee meets", 20, ByEmail, Reached, 13,
                    notes: "Company secretary of a tea company; committee meets next month."),
                Lead("Ibrahim Yusuf", "Mumbai", "en-IN", "SF-DIWALI-2026", "Corporate employee giving desk",
                    LeadStatus.Nurture, Cold, Medium, "anjali.prakash", 30,
                    "Propose a Diwali payroll-giving drive", 8, ByEmail, Callback, 17,
                    notes: "Employee engagement lead at a retail chain."),
                Lead("Kalpana Ajit", "New Delhi", "en-IN", "SF-FLOOD-2026", "Trust and foundation enquiry",
                    LeadStatus.Closed, Cold, Low, "anjali.prakash", 45,
                    via: ByEmail, last: ContactOutcome.NotInterested, contacted: 25,
                    closure: "Their trust funds only projects in Gujarat, which is outside the "
                             + "foundation's programme geography this year."),

                // ---- Nobody's yet: eight new leads waiting on the Assignment Board ---------------
                Lead("Aravind Selvam", "Chennai", "ta-IN", "SF-EDU-2026", "Educate a Child QR poster",
                    LeadStatus.New, Cold, Low, null, 1, "Assign to a fundraiser", 1, ByPhone),
                Lead("Bhavna Paresh", "Ahmedabad", "gu-IN", "SF-EDU-2026", "Instagram lead form",
                    LeadStatus.New, Warm, Medium, null, 1, "Assign to a fundraiser", 1, ByWhatsApp),
                Lead("Chetan Yogesh", "Pune", "mr-IN", "SF-NUTRITION-2026", "Website enquiry form",
                    LeadStatus.New, Cold, Low, null, 2, "Assign to a fundraiser", 0, ByEmail),
                Lead("Devika Rajan", "Kochi", "ml-IN", "SF-HEALTH-2026", "Mobile clinic van QR code",
                    LeadStatus.New, Warm, Low, null, 2, "Assign to a fundraiser", 0, ByPhone, email: false),
                Lead("Eshwar Prasad", "Hyderabad", "te-IN", "SF-SKILLS-2026", "Google search enquiry",
                    LeadStatus.New, Hot, High, null, 0, "Assign to a fundraiser", 1, ByPhone),
                Lead("Gayatri Mohan", "New Delhi", "hi-IN", "SF-STEM-2026", "Alumni network event",
                    LeadStatus.New, Warm, High, null, 3, "Assign to a fundraiser", -1, ByEmail),
                Lead("Javed Karim", "Lucknow", "hi-IN", "SF-WINTER-2026", "WhatsApp broadcast reply",
                    LeadStatus.New, Cold, Medium, null, 1, "Assign to a fundraiser", 2, ByWhatsApp,
                    consent: ConsentState.NotProvided),
                Lead("Kusum Ramesh", "Kolkata", "bn-IN", "SF-EDU-2026", "Facebook lead form",
                    LeadStatus.New, Cold, Low, null, 4, "Assign to a fundraiser", -2, BySms,
                    consent: ConsentState.Pending)
            ],
            Stewardship:
            [
                new("csr@meridiantextiles.test", "anjali.prakash",
                    "Agree the renewal of the CSR partnership and the reporting calendar for next year.",
                    ByEmail, "Send the renewal proposal and book the review meeting", 3,
                    FollowUpPriority.High, FollowUpStatus.Planned),
                new("giving@northbridgelogistics.test", "anjali.prakash",
                    "Thank the partner for the relief gift and share the flood relief report.",
                    ByPhone, "Call the CSR head with the relief report", 1,
                    FollowUpPriority.Normal, FollowUpStatus.Assigned),
                new("csr@saffronleaffoods.test", "anjali.prakash",
                    "Collect the signed partnership documents so the donor record can be approved.",
                    ByEmail, "Chase the signed agreement and the KYC documents", -1,
                    FollowUpPriority.High, FollowUpStatus.Rescheduled),
                new("rajiv.narayan@mail.test", "kavita.ashok",
                    "Steward a major donor after a large gift to Educate a Child.",
                    ByPhone, "Thank-you call and an invitation to visit a learning centre", 0,
                    FollowUpPriority.High, FollowUpStatus.Planned),
                new("siddharth.dinesh@mail.test", "kavita.ashok",
                    "Help the donor complete a card payment that timed out at the bank.",
                    ByWhatsApp, "Confirm whether the card payment went through", 0,
                    FollowUpPriority.Urgent, FollowUpStatus.Assigned),
                new("sunita.prasad@mail.test", "kavita.ashok",
                    "Resolve a failed identity check before the 80G receipt can be corrected.",
                    ByPhone, "Verify the donor's identity by telephone", 2,
                    FollowUpPriority.Normal, FollowUpStatus.Planned),
                new("divya.mahesh@mail.test", "manish.vinod",
                    "Share the term report for the three children the donor sponsors.",
                    ByWhatsApp, "Send the term report on WhatsApp", 4,
                    FollowUpPriority.Normal, FollowUpStatus.Planned),
                new("nikhil.sanjay@mail.test", "manish.vinod",
                    "The receipt e-mail bounced; confirm a working address for receipts.",
                    ByPhone, "Call to confirm the e-mail address for receipts", -2,
                    FollowUpPriority.High, FollowUpStatus.Assigned),
                new("ayesha.karim@mail.test", "pooja.srinivas",
                    "The receipt e-mail was rejected by the donor's mail server; confirm the address.",
                    ByWhatsApp, "Confirm the e-mail address and resend the receipt", 1,
                    FollowUpPriority.High, FollowUpStatus.Planned),
                new("harish.gopal@mail.test", "pooja.srinivas",
                    "Invite a regular giver to see the mobile clinic his gifts support.",
                    ByPhone, "Invite to a mobile clinic visit in Kochi", 6,
                    FollowUpPriority.Low, FollowUpStatus.Planned),
                new("lakshmi.venkatesh@mail.test", "pooja.srinivas",
                    "Annual thank-you for a regular giver.",
                    ByEmail, "Send the annual impact letter", -5,
                    FollowUpPriority.Normal, FollowUpStatus.Completed,
                    "Impact letter sent; the donor replied that she will continue her monthly gift."),
                new("usha.rajan@mail.test", "pooja.srinivas",
                    "Annual thank-you call.",
                    ByPhone, "Thank-you call", -9,
                    FollowUpPriority.Low, FollowUpStatus.Cancelled,
                    "The donor asked not to be contacted, so the task was cancelled.")
            ],
            Promises:
            [
                new("rajiv.narayan@mail.test", 100_000m, 100_000m, 20, 25, PromiseStatus.Open,
                    "SF-EDU-2026", "Pledged at the donor meet, to be paid after the festival season."),
                new("csr@meridiantextiles.test", 500_000m, 100_000m, 60, 30, PromiseStatus.PartiallyFulfilled,
                    "SF-EDU-2026", "Annual CSR commitment; the balance is due next quarter."),
                new("divya.mahesh@mail.test", 18_000m, 0m, 45, -15, PromiseStatus.Fulfilled,
                    "SF-EDU-2026", "Pledged three sponsorships and paid in full."),
                new("sunita.prasad@mail.test", 5_000m, 0m, 90, -30, PromiseStatus.Lapsed,
                    "SF-NUTRITION-2026", "Pledged at a community event and not received by the due date."),
                new("nikhil.sanjay@mail.test", 10_000m, 0m, 30, 10, PromiseStatus.Cancelled,
                    "SF-STEM-2026", "Withdrawn by the donor after a change in circumstances.")
            ],
            Documents:
            [
                new("harish.gopal@mail.test", "CONSENT", "Signed consent form",
                    "Scanned paper consent form collected at a donor meet.",
                    DocumentClassification.Confidential, 184_320),
                new("csr@meridiantextiles.test", "AGREEMENT", "CSR partnership agreement 2026-27",
                    "Signed partnership agreement and reporting schedule.",
                    DocumentClassification.Restricted, 912_384),
                new("rajiv.narayan@mail.test", "FORM10BE", "Form 10BE acknowledgement",
                    "Certificate of donation issued for the previous financial year.",
                    DocumentClassification.Internal, 96_256)
            ],
            Duplicate: new(
                "lakshmi.venkatesh@mail.test", "phone:9840275199",
                "Possible duplicate - Lakshmi Venkatesh",
                "The same first name, the same street address and telephone numbers that differ "
                + "only in their last two digits.",
                "Surname (Venkatesh / V.), e-mail address (present / missing), mobile number.",
                "Confirmed with the donor by telephone that both records are hers; the record "
                + "created from the telephone enquiry was merged into her main record.")),

        // ============ HELPAGE INDIA ===============================================================
        new(
            Subdomain: "helpageindia",
            Administrator: "arvind.murali",
            Manager: "vivek.sridhar",

            // FAR FROM SMILE FOUNDATION'S RANGE, ON PURPOSE. Follow-up, verification, pledge and
            // duplicate-review references are unique across the whole platform, while the product
            // numbers each Organisation's next one from its own highest. Starting the two
            // Organisations five hundred apart is what stops the first follow-up either of them
            // creates from landing on a number the other already holds.
            ReferenceBase: 501,
            Teams: new Dictionary<string, string>
            {
                ["nisha.karthik"] = "SOUTH",
                ["gaurav.deepak"] = "NORTH",
                ["vivek.sridhar"] = "NATIONAL",
                ["arvind.murali"] = "INSTITUTIONAL"
            },
            Campaigns:
            [
                new("HAI-ELDERCARE-2026", "Care for the Elderly - Annual Appeal 2026", true, -103, 170),
                new("HAI-MOBILECARE-2026", "Mobile Healthcare Units - Care at the Doorstep", true, -80, 100),
                new("HAI-SIGHT-2026", "Restore Sight - Cataract Surgeries 2026", true, -70, 140),
                new("HAI-WINTER-2026", "Winter Relief - Warmth for Elders", true, 12, 95),
                new("HAI-DIWALI-2026", "Light a Life this Diwali", true, 20, 40),
                new("HAI-HELPLINE-2026", "Elder Helpline - Keep the Line Open", true, -2, 200),
                new("HAI-DAYCARE-2026", "Adopt a Day-Care Centre", true, -1, 160),
                new("HAI-DIGITAL-2026", "Digital Literacy for Seniors", true, -125, 55),
                new("HAI-PHYSIO-2026", "Physiotherapy at Home", false, -112, -4),
                new("HAI-HEATWAVE-2026", "Heatwave Relief for Elders 2026", false, -165, -7)
            ],
            Donors:
            [
                // ---- The twelve donor-portal accounts IAM seeds --------------------------------
                Person("Ajay Sekar", "9884031275", "ta-IN", DonorStatus.Active, ApprovalState.Approved,
                    "nisha.karthik", 220, "Plot 56, 4th Avenue, Ashok Nagar, Chennai 600083",
                    "Es S+ W+ P+", Verified(VerificationChannel.Sms, 190), ["REGULAR_GIVER", "EIGHTY_G"]),
                Person("Ishita Rakesh", "9836527014", "bn-IN", DonorStatus.Active, ApprovalState.Approved,
                    "vivek.sridhar", 200, "P-214, CIT Scheme VII M, Kankurgachi, Kolkata 700054",
                    "E+ W+ S+ P-", Verified(VerificationChannel.Email, 175), ["REGULAR_GIVER"]),
                Person("Kiran Manoj", "9815246307", "pa-IN", DonorStatus.Active, ApprovalState.Approved,
                    "gaurav.deepak", 165, "House 1184, Sector 21-B, Chandigarh 160022",
                    "E+ P+", new(VerificationStatus.ChallengeSent, VerificationChannel.Sms, 0), ["EIGHTY_G"]),
                Person("Geetha Raman", "9840731625", "ta-IN", DonorStatus.Active, ApprovalState.Approved,
                    "nisha.karthik", 145, "12/5, Kamakoti Street, West Mambalam, Chennai 600033",
                    "E+ W+ S+", Verified(VerificationChannel.WhatsApp, 125), ["REGULAR_GIVER", "VOLUNTEER"]),
                Person("Joseph Daniel", "9846215703", "ml-IN", DonorStatus.Active, ApprovalState.Approved,
                    "nisha.karthik", 115, "Puthenpurackal, Convent Road, Ernakulam North, Kochi 682018",
                    "E+ P+ W-", Verified(VerificationChannel.Email, 95), ["EIGHTY_G"]),
                Person("Padma Narayanan", "9886402517", "kn-IN", DonorStatus.Active, ApprovalState.Approved,
                    "nisha.karthik", 125, "No. 77, 9th Cross, 3rd Block, Jayanagar, Bengaluru 560011",
                    "E+ W+ P+ S-", Verified(VerificationChannel.Sms, 105), ["REGULAR_GIVER"]),
                Person("Farida Yusuf", "9820315647", "hi-IN", DonorStatus.Active, ApprovalState.Approved,
                    "vivek.sridhar", 310, "Flat 502, Gulmohar Heights, S.V. Road, Santacruz (West), Mumbai 400054",
                    "E+ P+ O+", Verified(VerificationChannel.PhoneCall, 290), ["MAJOR_GIVER", "EIGHTY_G"]),
                Person("Vinod Kishore", "9811640275", "hi-IN", DonorStatus.Active, ApprovalState.Approved,
                    "gaurav.deepak", 100, "B-3/27, Safdarjung Enclave, New Delhi 110029",
                    "E+ W+ S?", new(VerificationStatus.Failed, VerificationChannel.Sms, 55)),
                Person("Anita Jagdish", "9830427165", "bn-IN", DonorStatus.Active, ApprovalState.Approved,
                    "vivek.sridhar", 90, "22/1, Hindustan Park, Gariahat, Kolkata 700029",
                    "E+ W+", new(VerificationStatus.Escalated, VerificationChannel.WhatsApp, 28), ["VOLUNTEER"]),
                Person("Ramesh Chandran", "9847530216", "ml-IN", DonorStatus.Active, ApprovalState.Approved,
                    "nisha.karthik", 2, "TC 9/1124, Sasthamangalam, Thiruvananthapuram 695010",
                    "E+ W+ P+", new(VerificationStatus.NotStarted, VerificationChannel.Email, 1), ["FIRST_GIFT"],
                    notes: "Created automatically from a completed donation.",
                    fromLead: "ramesh.chandran@mail.test", createdByGift: true),
                Person("Sheela Mohan", "9849260731", "te-IN", DonorStatus.Active, ApprovalState.Approved,
                    "nisha.karthik", 80, "Plot 88, Road No. 3, Jubilee Hills, Hyderabad 500033",
                    "Ex P+ W+", new(VerificationStatus.Expired, VerificationChannel.Email, 6)),
                Person("Prakash Subhash", "9822071346", "mr-IN", DonorStatus.Active, ApprovalState.Approved,
                    "vivek.sridhar", 70, "5, Shivtirth Society, Karve Road, Kothrud, Pune 411038",
                    "E+ W+ P+ S+ O+", new(VerificationStatus.Cancelled, VerificationChannel.Sms, 38), ["REGULAR_GIVER"]),

                // ---- Companies giving under their CSR programmes -------------------------------
                Company("Kaveri Agro Industries Limited", "csr@kaveriagro.test", "8025584130",
                    DonorStatus.Active, ApprovalState.Approved, "arvind.murali", 340,
                    "No. 31, Residency Road, Bengaluru 560025",
                    "E+ P+ O+", Verified(VerificationChannel.PhoneCall, 325), ["CORPORATE", "MAJOR_GIVER"]),
                Company("Silverline Pharma Distributors Private Limited", "csr@silverlinepharma.test", "2226591470",
                    DonorStatus.Active, ApprovalState.Approved, "arvind.murali", 155,
                    "Plot C-21, G Block, Bandra Kurla Complex, Mumbai 400051",
                    "E+ P+", tags: ["CORPORATE"]),
                Company("Greenfield Housing Finance Limited", "csr@greenfieldhousing.test", "1141627350",
                    DonorStatus.Prospect, ApprovalState.PendingApproval, "arvind.murali", 3,
                    "7th Floor, Tower B, Nehru Place, New Delhi 110019", "E+",
                    notes: "The CSR committee has approved support for a day-care centre in "
                           + "principle; the signed documents are awaited."),

                // ---- Everybody else: one record in each state the register can show ------------
                Person("Santosh Vinay", "9839417260", "hi-IN", DonorStatus.Active, ApprovalState.Approved,
                    "gaurav.deepak", 1, "4/27, Vishal Khand, Gomti Nagar, Lucknow 226010",
                    "E+", tags: ["FIRST_GIFT"],
                    notes: "Created automatically from a completed donation.",
                    fromLead: "santosh.vinay@mail.test", createdByGift: true),
                Person("Lalitha Sekar", "9811905263", "ta-IN", DonorStatus.Prospect, ApprovalState.NotSubmitted,
                    "vivek.sridhar", 2, consents: "E+ P+",
                    notes: "Converted from a lead met at the Older Persons' Day stall; first gift "
                           + "expected this month.",
                    fromLead: "lalitha.sekar@mail.test"),
                Person("Dinesh Naveen", "9845720918", "kn-IN", DonorStatus.Prospect, ApprovalState.Rejected,
                    "nisha.karthik", 27,
                    notes: "Approval was declined: the contact details on the form could not be "
                           + "confirmed. The record is kept for reference."),
                Person("Kamala Sundar", "9840392761", "ta-IN", DonorStatus.Restricted, ApprovalState.Cancelled,
                    "nisha.karthik", 135, consents: "E- P- W-", doNotContact: true,
                    reason: "The donor asked for her record to be restricted and for all contact to stop."),
                Person("Gopal Krishna", "9811472638", "hi-IN", DonorStatus.Archived, ApprovalState.Approved,
                    "gaurav.deepak", 430, consents: "E+",
                    reason: "The donor has passed away; the family asked for his record to be closed."),
                new(DonorType.Individual, "Ishita", "R.", null, null, "9836527041", "bn-IN",
                    DonorStatus.Merged, ApprovalState.Approved, "vivek.sridhar", 205,
                    Notes: "A second record created from a telephone enquiry, merged into the "
                           + "donor's main record.",
                    MergedInto: "ishita.rakesh@mail.test"),
                new(DonorType.Anonymous, null, null, null, null, null, "en-IN",
                    DonorStatus.Active, ApprovalState.Approved, null, 45,
                    Notes: "An anonymous gift left in the collection box at the Older Persons' Day stall.",
                    Key: "anonymous-collection-box")
            ],
            Leads:
            [
                // ---- Nisha Karthik, South: eighteen, the heaviest book on the team --------------
                Lead("Arun Selvam", "Chennai", "ta-IN", "HAI-SIGHT-2026", "Eye camp registration desk",
                    LeadStatus.Assigned, Warm, Medium, "nisha.karthik", 3,
                    "Introduction call about sponsoring a cataract surgery", 1, ByPhone),
                Lead("Bindu Jayan", "Kochi", "ml-IN", "HAI-ELDERCARE-2026", "WhatsApp broadcast reply",
                    LeadStatus.Assigned, Cold, Low, "nisha.karthik", 2,
                    "Send the elder care one-pager", 2, ByWhatsApp),
                Lead("Fathima Ismail", "Bengaluru", "kn-IN", "HAI-DIGITAL-2026", "Senior tech fair counter",
                    LeadStatus.Assigned, Warm, Medium, "nisha.karthik", 5,
                    "Introduction call", -1, ByPhone, previousOwner: "gaurav.deepak"),
                Lead("Ganesh Murugan", "Coimbatore", "ta-IN", "HAI-ELDERCARE-2026", "Instagram lead form",
                    LeadStatus.Assigned, Hot, High, "nisha.karthik", 1,
                    "Call today - asked about supporting two elders", 0, ByPhone),
                Lead("Hema Kannan", "Chennai", "ta-IN", "HAI-ELDERCARE-2026", "Website enquiry form",
                    LeadStatus.Contacted, Warm, Medium, "nisha.karthik", 9,
                    "E-mail the sponsorship brochure and the 80G note", 1, ByEmail, Reached, 2),
                Lead("Dinesh Babu", "Madurai", "ta-IN", "HAI-MOBILECARE-2026", "Newsletter sign-up",
                    LeadStatus.Contacted, Cold, Low, "nisha.karthik", 11,
                    "Second call attempt", -2, ByPhone, NoAnswer, 3),
                Lead("Indira Raghavan", "Bengaluru", "kn-IN", "HAI-DIGITAL-2026", "Senior tech fair counter",
                    LeadStatus.Contacted, Warm, Medium, "nisha.karthik", 12,
                    "Call back after six in the evening", 0.5, ByPhone, Callback, 4),
                Lead("Jacob Abraham", "Kochi", "ml-IN", "HAI-SIGHT-2026", "Referral from an existing donor",
                    LeadStatus.Contacted, Hot, High, "nisha.karthik", 6,
                    "Share the monthly giving options on WhatsApp", 1, ByWhatsApp, Reached, 1),
                Lead("Kavya Prabhu", "Mysuru", "kn-IN", "HAI-ELDERCARE-2026", "Facebook lead form",
                    LeadStatus.Contacted, Warm, Low, "nisha.karthik", 14,
                    "Send an elder's story from the day-care centre", 3, ByEmail, Reached, 6),
                Lead("Lokesh Naveen", "Bengaluru", "en-IN", "HAI-ELDERCARE-2026", "Employee giving portal",
                    LeadStatus.Qualified, Hot, High, "nisha.karthik", 10,
                    "Send the payment link for two sponsorships", 0, ByEmail, Reached, 2),
                Lead("Malathi Sundar", "Chennai", "ta-IN", "HAI-SIGHT-2026", "Eye camp registration desk",
                    LeadStatus.Qualified, Hot, Medium, "nisha.karthik", 13,
                    "Confirm the UPI gift and the PAN for the 80G receipt", 1, ByWhatsApp, Reached, 3),
                Lead("Nirmala Gopalan", "Thiruvananthapuram", "ml-IN", "HAI-MOBILECARE-2026", "Referral from an existing donor",
                    LeadStatus.Qualified, Warm, High, "nisha.karthik", 16,
                    "Call to confirm the annual pledge", -1, ByPhone, Reached, 5),
                Lead("Prabha Senthil", "Tiruchirappalli", "ta-IN", "HAI-ELDERCARE-2026", "Website enquiry form",
                    LeadStatus.Qualified, Hot, Medium, "nisha.karthik", 7,
                    "E-mail the bank transfer details", 2, ByEmail, Reached, 1),
                Lead("Raghu Madhavan", "Kozhikode", "ml-IN", "HAI-DIWALI-2026", "Newsletter sign-up",
                    LeadStatus.Nurture, Cold, Medium, "nisha.karthik", 24,
                    "Call when the Diwali appeal opens", 15, ByPhone, Callback, 12),
                Lead("Elizabeth George", "Kochi", "ml-IN", "HAI-WINTER-2026", "Instagram lead form",
                    LeadStatus.Nurture, Warm, Low, "nisha.karthik", 22,
                    "Share the winter relief plan in November", 24, ByWhatsApp, Reached, 15),
                Lead("Chandra Mohan", "Hyderabad", "te-IN", "HAI-DAYCARE-2026", "Residents' association QR poster",
                    LeadStatus.Nurture, Warm, High, "nisha.karthik", 18,
                    "Invite to visit a day-care centre", 5, ByEmail, Reached, 9),
                Lead("Ramesh Chandran", "Thiruvananthapuram", "ml-IN", "HAI-MOBILECARE-2026", "Referral from an existing donor",
                    LeadStatus.Converted, Hot, Medium, "nisha.karthik", 30,
                    via: ByPhone, last: Reached, contacted: 6, mobile: "9847530216",
                    notes: "Asked for the payment link after a call about the mobile healthcare units.",
                    convertedTo: "ramesh.chandran@mail.test"),
                Lead("Stephen Paul", "Chennai", "ta-IN", "HAI-HEATWAVE-2026", "Facebook lead form",
                    LeadStatus.Closed, Cold, Low, "nisha.karthik", 40,
                    via: ByPhone, last: ContactOutcome.NotInterested, contacted: 20,
                    closure: "Enquired during the heatwave appeal, which has since closed, and is "
                             + "not interested in the other programmes."),

                // ---- Gaurav Deepak, North: fourteen ----------------------------------------------
                Lead("Alok Rajesh", "Lucknow", "hi-IN", "HAI-MOBILECARE-2026", "Mobile healthcare unit QR code",
                    LeadStatus.Assigned, Warm, Medium, "gaurav.deepak", 4,
                    "Introduction call", 1, ByPhone),
                Lead("Bharti Sunil", "Kanpur", "hi-IN", "HAI-ELDERCARE-2026", "Residents' association QR poster",
                    LeadStatus.Assigned, Cold, Low, "gaurav.deepak", 3,
                    "Send the programme summary", 2, ByEmail),
                Lead("Chandni Rakesh", "New Delhi", "hi-IN", "HAI-HELPLINE-2026", "Website enquiry form",
                    LeadStatus.Assigned, Hot, Medium, "gaurav.deepak", 6,
                    "Call - asked to be rung before Friday", -1, ByPhone),
                Lead("Dev Narayan", "Varanasi", "hi-IN", "HAI-ELDERCARE-2026", "Older Persons' Day stall",
                    LeadStatus.Contacted, Warm, Medium, "gaurav.deepak", 8,
                    "WhatsApp the sponsorship details in Hindi", 1, ByWhatsApp, Reached, 2),
                Lead("Geeta Ramesh", "Lucknow", "hi-IN", "HAI-MOBILECARE-2026", "Newsletter sign-up",
                    LeadStatus.Contacted, Cold, Low, "gaurav.deepak", 12,
                    "Second call attempt", -3, ByPhone, NoAnswer, 4),
                Lead("Hari Prasad", "Prayagraj", "hi-IN", "HAI-SIGHT-2026", "Referral from an existing donor",
                    LeadStatus.Contacted, Hot, High, "gaurav.deepak", 5,
                    "E-mail the monthly giving form", 1, ByEmail, Reached, 1),
                Lead("Jaya Vinod", "Dehradun", "hi-IN", "HAI-DAYCARE-2026", "Google search enquiry",
                    LeadStatus.Contacted, Warm, Medium, "gaurav.deepak", 9,
                    "Call back on Saturday morning", 2, ByPhone, Callback, 3),
                Lead("Kailash Umesh", "New Delhi", "hi-IN", "HAI-ELDERCARE-2026", "Employee giving portal",
                    LeadStatus.Qualified, Hot, High, "gaurav.deepak", 11,
                    "Send the payment link", 0, ByWhatsApp, Reached, 2),
                Lead("Leela Satish", "Jaipur", "hi-IN", "HAI-HELPLINE-2026", "Inbound call to donor services",
                    LeadStatus.Qualified, Warm, High, "gaurav.deepak", 13,
                    "Confirm the helpline pledge by e-mail", 1, ByEmail, Reached, 4),
                Lead("Mukul Anup", "Patna", "hi-IN", "HAI-DIWALI-2026", "WhatsApp broadcast reply",
                    LeadStatus.Nurture, Cold, Low, "gaurav.deepak", 26,
                    "Message when the Diwali appeal opens", 15, ByWhatsApp, Callback, 14),
                Lead("Irfan Hameed", "Lucknow", "hi-IN", "HAI-WINTER-2026", "Instagram lead form",
                    LeadStatus.Nurture, Warm, Medium, "gaurav.deepak", 21,
                    "Share the winter relief plan when the appeal opens", 12, ByEmail, Reached, 10),
                Lead("Santosh Vinay", "Lucknow", "hi-IN", "HAI-MOBILECARE-2026", "Referral from an existing donor",
                    LeadStatus.Converted, Hot, High, "gaurav.deepak", 15,
                    via: ByPhone, last: Reached, contacted: 5, mobile: "9839417260",
                    notes: "Referred by a regular giver; asked to fund a week of a mobile unit's rounds.",
                    convertedTo: "santosh.vinay@mail.test"),
                Lead("Naseem Riyaz", "Kanpur", "hi-IN", "HAI-PHYSIO-2026", "Inbound call to donor services",
                    LeadStatus.Closed, Cold, Low, "gaurav.deepak", 35,
                    via: ByPhone, last: ContactOutcome.WrongNumber, contacted: 18, email: false,
                    closure: "The mobile number taken on the call belongs to somebody else and no "
                             + "e-mail address was given."),
                Lead("Pushpa Girish", "New Delhi", "hi-IN", "HAI-ELDERCARE-2026", "Website enquiry form",
                    LeadStatus.Suppressed, Cold, Low, "gaurav.deepak", 19,
                    via: ByPhone, last: ContactOutcome.DoNotContact, contacted: 8,
                    consent: ConsentState.Withdrawn,
                    notes: "Asked not to be contacted again and was removed from every appeal."),

                // ---- Vivek Sridhar, the Fundraising Manager's own book: twelve ------------------
                Lead("Anil Jagdish", "New Delhi", "hi-IN", "HAI-ELDERCARE-2026", "Older Persons' Day stall",
                    LeadStatus.Assigned, Warm, High, "vivek.sridhar", 4,
                    "Introduction call", 1, ByPhone),
                Lead("Charu Vivek", "Mumbai", "mr-IN", "HAI-WINTER-2026", "WhatsApp broadcast reply",
                    LeadStatus.Assigned, Cold, Medium, "vivek.sridhar", 2,
                    "Send the winter relief outline", 3, ByWhatsApp),
                Lead("Dhruv Sanjay", "Pune", "mr-IN", "HAI-ELDERCARE-2026", "Website enquiry form",
                    LeadStatus.Contacted, Warm, Medium, "vivek.sridhar", 10,
                    "E-mail the 80G details", 1, ByEmail, Reached, 3),
                Lead("Ekta Rahul", "Mumbai", "hi-IN", "HAI-MOBILECARE-2026", "Newsletter sign-up",
                    LeadStatus.Contacted, Hot, High, "vivek.sridhar", 5,
                    "Call to discuss sponsoring a unit for a month", 0, ByPhone, Reached, 1),
                Lead("Faisal Javed", "Kolkata", "bn-IN", "HAI-SIGHT-2026", "Referral from an existing donor",
                    LeadStatus.Contacted, Warm, Medium, "vivek.sridhar", 13,
                    "Call back after office hours", -1, ByPhone, Callback, 5),
                Lead("Gopal Krishnan", "Kolkata", "bn-IN", "HAI-DAYCARE-2026", "Residents' association QR poster",
                    LeadStatus.Contacted, Cold, Low, "vivek.sridhar", 17,
                    "Third call attempt, then an e-mail", -4, ByPhone, NoAnswer, 6),
                Lead("Hemant Nitin", "Mumbai", "en-IN", "HAI-ELDERCARE-2026", "Employee giving portal",
                    LeadStatus.Qualified, Hot, High, "vivek.sridhar", 9,
                    "Send the payment link for five sponsorships", 1, ByEmail, Reached, 2),
                Lead("Isha Tarun", "New Delhi", "hi-IN", "HAI-HELPLINE-2026", "Google search enquiry",
                    LeadStatus.Qualified, Warm, Medium, "vivek.sridhar", 12,
                    "Share the bank details for a transfer", 2, ByEmail, Reached, 4),
                Lead("Jatin Varun", "Pune", "mr-IN", "HAI-MOBILECARE-2026", "Mobile healthcare unit QR code",
                    LeadStatus.Qualified, Hot, Medium, "vivek.sridhar", 6,
                    "Confirm the gift on WhatsApp", 0, ByWhatsApp, Reached, 1),
                Lead("Kanta Subhash", "New Delhi", "hi-IN", "HAI-DIWALI-2026", "Newsletter sign-up",
                    LeadStatus.Nurture, Warm, High, "vivek.sridhar", 20,
                    "Invite to the care home's Diwali evening", 9, ByEmail, Reached, 11),
                Lead("Lalit Pramod", "Kolkata", "bn-IN", "HAI-WINTER-2026", "Facebook lead form",
                    LeadStatus.Nurture, Cold, Low, "vivek.sridhar", 28,
                    "Call in the first week of November", 26, ByPhone, Callback, 16),
                Lead("Lalitha Sekar", "New Delhi", "ta-IN", "HAI-ELDERCARE-2026", "Older Persons' Day stall",
                    LeadStatus.Converted, Hot, Medium, "vivek.sridhar", 9,
                    via: ByPhone, last: Reached, contacted: 3, mobile: "9811905263",
                    notes: "Met at the Older Persons' Day stall; will support one elder from this month.",
                    convertedTo: "lalitha.sekar@mail.test"),

                // ---- Arvind Murali: institutional relationships held at head office: twelve -----
                Lead("Madhav Ravi", "Mumbai", "en-IN", "HAI-MOBILECARE-2026", "CSR desk referral",
                    LeadStatus.Assigned, Warm, High, "arvind.murali", 4,
                    "Introductory call with the CSR head", 2, ByPhone,
                    notes: "CSR manager at an insurance company; interested in adopting a mobile unit."),
                Lead("Nalini Suresh", "Bengaluru", "en-IN", "HAI-DAYCARE-2026", "Board member introduction",
                    LeadStatus.Assigned, Hot, High, "arvind.murali", 2,
                    "Send the day-care partnership deck", 1, ByEmail,
                    notes: "Heads the foundation of a technology company; introduced by a board member."),
                Lead("Omar Farooq", "Hyderabad", "en-IN", "HAI-ELDERCARE-2026", "Trust and foundation enquiry",
                    LeadStatus.Contacted, Warm, High, "arvind.murali", 10,
                    "E-mail the audited accounts and the 12A and 80G certificates", 1, ByEmail, Reached, 3,
                    notes: "Trustee of a family foundation that funds care for older people."),
                Lead("Poonam Ashok", "New Delhi", "hi-IN", "HAI-SIGHT-2026", "CSR desk referral",
                    LeadStatus.Contacted, Hot, High, "arvind.murali", 8,
                    "Arrange a visit to an eye camp in Chennai", 4, ByPhone, Reached, 2,
                    notes: "CSR lead at an eyewear retailer; wants to see a camp before committing."),
                Lead("Rajan Mathew", "Kochi", "en-IN", "HAI-HELPLINE-2026", "Employee giving portal",
                    LeadStatus.Contacted, Warm, Medium, "arvind.murali", 13,
                    "Call back after their board meeting", 6, ByPhone, Callback, 5,
                    notes: "HR head exploring a payroll-giving scheme for the helpline."),
                Lead("Sarita Mahesh", "Pune", "en-IN", "HAI-MOBILECARE-2026", "CSR desk referral",
                    LeadStatus.Contacted, Cold, Medium, "arvind.murali", 15,
                    "Follow up by e-mail", -2, ByEmail, NoAnswer, 7,
                    notes: "Sustainability manager at an automotive supplier."),
                Lead("Tanuja Mohan", "Chennai", "en-IN", "HAI-ELDERCARE-2026", "Board member introduction",
                    LeadStatus.Qualified, Hot, High, "arvind.murali", 14,
                    "Send the draft agreement for a three-year partnership", 3, ByEmail, Reached, 2,
                    notes: "Managing director of a hospital group; ready to adopt two day-care centres."),
                Lead("Uma Shankar", "Mumbai", "en-IN", "HAI-MOBILECARE-2026", "CSR desk referral",
                    LeadStatus.Qualified, Hot, High, "arvind.murali", 16,
                    "Share the mobile unit adoption budget", 1, ByEmail, Reached, 4,
                    notes: "CSR head at a bank; the budget cycle closes this month."),
                Lead("Varsha Dilip", "Gurugram", "en-IN", "HAI-DAYCARE-2026", "Trust and foundation enquiry",
                    LeadStatus.Qualified, Warm, High, "arvind.murali", 19,
                    "Submit the grant application form", 7, ByEmail, Reached, 6,
                    notes: "Programme officer at a grant-making trust; the application window is open."),
                Lead("Wasim Akbar", "Kolkata", "bn-IN", "HAI-WINTER-2026", "Board member introduction",
                    LeadStatus.Nurture, Warm, Medium, "arvind.murali", 25,
                    "Reconnect after their CSR committee meets", 20, ByEmail, Reached, 13,
                    notes: "Company secretary of a jute company; the committee meets next month."),
                Lead("Yamini Prasad", "Hyderabad", "en-IN", "HAI-DIWALI-2026", "Employee giving portal",
                    LeadStatus.Nurture, Cold, Medium, "arvind.murali", 30,
                    "Propose a Diwali payroll-giving drive", 8, ByEmail, Callback, 17,
                    notes: "Employee engagement lead at a retail chain."),
                Lead("Zubin Daniel", "Mumbai", "en-IN", "HAI-HEATWAVE-2026", "Trust and foundation enquiry",
                    LeadStatus.Closed, Cold, Low, "arvind.murali", 45,
                    via: ByEmail, last: ContactOutcome.NotInterested, contacted: 25,
                    closure: "Their trust funds only child-welfare projects, which is outside the "
                             + "organisation's work with older people."),

                // ---- Nobody's yet: eight new leads waiting on the Assignment Board ---------------
                Lead("Aditi Lokesh", "Bengaluru", "kn-IN", "HAI-ELDERCARE-2026", "Residents' association QR poster",
                    LeadStatus.New, Cold, Low, null, 1, "Assign to a fundraiser", 1, ByPhone),
                Lead("Balu Senthil", "Coimbatore", "ta-IN", "HAI-SIGHT-2026", "Instagram lead form",
                    LeadStatus.New, Warm, Medium, null, 1, "Assign to a fundraiser", 1, ByWhatsApp),
                Lead("Cyril Francis", "Kochi", "ml-IN", "HAI-MOBILECARE-2026", "Website enquiry form",
                    LeadStatus.New, Cold, Low, null, 2, "Assign to a fundraiser", 0, ByEmail),
                Lead("Damini Paresh", "Ahmedabad", "gu-IN", "HAI-ELDERCARE-2026", "Mobile healthcare unit QR code",
                    LeadStatus.New, Warm, Low, null, 2, "Assign to a fundraiser", 0, ByPhone, email: false),
                Lead("Esha Vijay", "Mumbai", "mr-IN", "HAI-DAYCARE-2026", "Google search enquiry",
                    LeadStatus.New, Hot, High, null, 0, "Assign to a fundraiser", 1, ByPhone),
                Lead("Firoz Salim", "New Delhi", "hi-IN", "HAI-HELPLINE-2026", "Inbound call to donor services",
                    LeadStatus.New, Warm, High, null, 3, "Assign to a fundraiser", -1, ByEmail),
                Lead("Gita Naresh", "Lucknow", "hi-IN", "HAI-WINTER-2026", "WhatsApp broadcast reply",
                    LeadStatus.New, Cold, Medium, null, 1, "Assign to a fundraiser", 2, ByWhatsApp,
                    consent: ConsentState.NotProvided),
                Lead("Hari Babu", "Hyderabad", "te-IN", "HAI-ELDERCARE-2026", "Facebook lead form",
                    LeadStatus.New, Cold, Low, null, 4, "Assign to a fundraiser", -2, BySms,
                    consent: ConsentState.Pending)
            ],
            Stewardship:
            [
                new("csr@kaveriagro.test", "arvind.murali",
                    "Agree the renewal of the CSR partnership and the reporting calendar for next year.",
                    ByEmail, "Send the renewal proposal and book the review meeting", 3,
                    FollowUpPriority.High, FollowUpStatus.Planned),
                new("csr@silverlinepharma.test", "arvind.murali",
                    "Thank the partner for the relief gift and share the heatwave relief report.",
                    ByPhone, "Call the CSR head with the relief report", 1,
                    FollowUpPriority.Normal, FollowUpStatus.Assigned),
                new("csr@greenfieldhousing.test", "arvind.murali",
                    "Collect the signed partnership documents so the donor record can be approved.",
                    ByEmail, "Chase the signed agreement and the KYC documents", -1,
                    FollowUpPriority.High, FollowUpStatus.Rescheduled),
                new("farida.yusuf@mail.test", "vivek.sridhar",
                    "Steward a major donor after a large gift to the annual appeal.",
                    ByPhone, "Thank-you call and an invitation to visit a day-care centre", 0,
                    FollowUpPriority.High, FollowUpStatus.Planned),
                new("ishita.rakesh@mail.test", "vivek.sridhar",
                    "Help the donor complete a card payment that timed out at the bank.",
                    ByWhatsApp, "Confirm whether the card payment went through", 0,
                    FollowUpPriority.Urgent, FollowUpStatus.Assigned),
                new("prakash.subhash@mail.test", "vivek.sridhar",
                    "Share the quarterly report for the elders the donor supports.",
                    ByEmail, "Send the quarterly report", 5,
                    FollowUpPriority.Normal, FollowUpStatus.Planned),
                new("vinod.kishore@mail.test", "gaurav.deepak",
                    "Resolve a failed identity check before the 80G receipt can be corrected.",
                    ByPhone, "Verify the donor's identity by telephone", 2,
                    FollowUpPriority.Normal, FollowUpStatus.Planned),
                new("kiran.manoj@mail.test", "gaurav.deepak",
                    "The receipt e-mail bounced; confirm a working address for receipts.",
                    ByPhone, "Call to confirm the e-mail address for receipts", -2,
                    FollowUpPriority.High, FollowUpStatus.Assigned),
                new("sheela.mohan@mail.test", "nisha.karthik",
                    "The receipt e-mail was rejected by the donor's mail server; confirm the address.",
                    ByWhatsApp, "Confirm the e-mail address and resend the receipt", 1,
                    FollowUpPriority.High, FollowUpStatus.Planned),
                new("ajay.sekar@mail.test", "nisha.karthik",
                    "Invite a regular giver to see the eye camp his gifts support.",
                    ByPhone, "Invite to an eye camp visit in Chennai", 6,
                    FollowUpPriority.Low, FollowUpStatus.Planned),
                new("geetha.raman@mail.test", "nisha.karthik",
                    "Annual thank-you for a regular giver.",
                    ByEmail, "Send the annual impact letter", -5,
                    FollowUpPriority.Normal, FollowUpStatus.Completed,
                    "Impact letter sent; the donor replied that she will continue her monthly gift."),
                new("kamala.sundar@mail.test", "nisha.karthik",
                    "Annual thank-you call.",
                    ByPhone, "Thank-you call", -9,
                    FollowUpPriority.Low, FollowUpStatus.Cancelled,
                    "The donor asked not to be contacted, so the task was cancelled.")
            ],
            Promises:
            [
                new("farida.yusuf@mail.test", 100_000m, 100_000m, 20, 25, PromiseStatus.Open,
                    "HAI-ELDERCARE-2026", "Pledged at the supporters' evening, to be paid after the festival season."),
                new("csr@kaveriagro.test", 500_000m, 150_000m, 60, 30, PromiseStatus.PartiallyFulfilled,
                    "HAI-ELDERCARE-2026", "Annual CSR commitment; the balance is due next quarter."),
                new("padma.narayanan@mail.test", 15_000m, 0m, 45, -15, PromiseStatus.Fulfilled,
                    "HAI-ELDERCARE-2026", "Pledged support for three elders and paid in full."),
                new("vinod.kishore@mail.test", 5_000m, 0m, 90, -30, PromiseStatus.Lapsed,
                    "HAI-SIGHT-2026", "Pledged at a community event and not received by the due date."),
                new("sheela.mohan@mail.test", 10_000m, 0m, 30, 10, PromiseStatus.Cancelled,
                    "HAI-DAYCARE-2026", "Withdrawn by the donor after a change in circumstances.")
            ],
            Documents:
            [
                new("ajay.sekar@mail.test", "CONSENT", "Signed consent form",
                    "Scanned paper consent form collected at a supporters' evening.",
                    DocumentClassification.Confidential, 176_128),
                new("csr@kaveriagro.test", "AGREEMENT", "CSR partnership agreement 2026-27",
                    "Signed partnership agreement and reporting schedule.",
                    DocumentClassification.Restricted, 884_736),
                new("farida.yusuf@mail.test", "FORM10BE", "Form 10BE acknowledgement",
                    "Certificate of donation issued for the previous financial year.",
                    DocumentClassification.Internal, 98_304)
            ],
            Duplicate: new(
                "ishita.rakesh@mail.test", "phone:9836527041",
                "Possible duplicate - Ishita Rakesh",
                "The same first name, the same street address and telephone numbers that differ "
                + "only in their last two digits.",
                "Surname (Rakesh / R.), e-mail address (present / missing), mobile number.",
                "Confirmed with the donor by telephone that both records are hers; the record "
                + "created from the telephone enquiry was merged into her main record."))
    ];
}
