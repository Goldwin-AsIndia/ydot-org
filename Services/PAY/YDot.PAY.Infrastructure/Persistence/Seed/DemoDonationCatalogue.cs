using YDot.PAY.Domain.Enums;

namespace YDot.PAY.Infrastructure.Persistence.Seed;

/// <summary>
/// The demonstration donations of the two activated sample Organisations: who gave, how much, to
/// which campaign, through which QR code or link, by which payment method - and what became of
/// the payment and of the receipt.
///
/// DATA, KEPT APART FROM THE SEEDER'S LOGIC. <see cref="DemoDonationSeeder"/> decides HOW a row is
/// written - an intent, its attempts, the gateway events behind them, the donation and its
/// receipt - and this file says WHAT happened. One line here is one donor's one attempt to give.
///
/// NINETY-FOUR PAYMENTS PER ORGANISATION, ACROSS LAST MONTH AND THIS ONE, because Payments and
/// Receipts is a work list whose whole shape depends on the mix: its tiles count by outcome, each
/// outcome offers a different action, and the receipt column has five answers of its own. A set
/// that was all successes would exercise one column of it. Each Organisation therefore has:
///
///   Success   72   receipt Sent, Pending, Failed and Not sent all present
///   Pending   11   authorised and waiting, timed out, links expired, cancelled, links re-issued
///                  - twelve rows on the page with the one gateway event nothing claims
///   Fail      11   declined cards, UPI timeouts, empty wallets, and three that failed twice -
///                  fourteen gateway events
///
/// Every view of the queue therefore opens on at least twelve rows. Twenty-six of the successes
/// are the gifts of the DonorCare people's own supporters and nine the bank transfers of head
/// office's institutional donors, so every My Donors list carries real giving.
///
/// EVERY PAYMENT METHOD A DONOR CAN CHOOSE IS HERE - UPI, card, net banking and wallet - and
/// every gift is attributed the way a real one is: to a campaign, and where the donor arrived by
/// one, to the QR code or link that brought them.
///
/// THE SAME PEOPLE AND CAMPAIGNS APPEAR IN DON AND CAM. A donor is named by the e-mail address
/// DON's catalogue and IAM's donor-portal account both carry, a campaign by CAM's code, a
/// tracking asset by the code CAM mints for it, and a lead by its own address - see
/// <c>DemoIds</c> for the contract. Nothing here is a foreign key, so the three services seed in
/// any order; but change a name in one catalogue and the gift belongs to nobody.
///
/// THE DATES ARE RELATIVE TO THE DAY THE DATA IS SEEDED: a day of last month, a point part-way
/// through this one, or minutes ago. Whenever a database is created, the donations are recent.
///
/// THESE ARE INVENTED, AND THE OLD SEEDER'S CAUTION STILL HOLDS. A donation is a record that
/// money moved, and none of this money did - which is why the whole set is off unless
/// <c>PaymentSettings:SeedSampleDonations</c> asks for it, and why every id starts <c>5eed</c>. A
/// receipt marked Sent here was never e-mailed to anybody: it shows what the screen looks like
/// when one has been. Every person and company is fictional, every PAN is a synthetic value in
/// the correct format, and every address is on the reserved <c>.test</c> domain.
/// </summary>
internal static class DemoDonationCatalogue
{
    /// <summary>
    /// One Organisation's payments.
    ///
    /// <paramref name="Places"/> names the place each offline QR code stands at, by the code CAM
    /// mints for it. The product makes ONE QR CODE PER PLACE, so a gift scanned from one is
    /// attributed to that place as well as to the asset - and the place's id is derived from the
    /// code and this name, exactly as CAM derives it, so the two must read the same.
    /// </summary>
    internal sealed record DemoOrganisation(
        string Subdomain,
        IReadOnlyDictionary<string, string> Campaigns,
        IReadOnlyDictionary<string, string> Places,
        IReadOnlyList<DemoGiver> Givers,
        IReadOnlyList<DemoGift> Gifts);

    /// <summary>
    /// A donor as they fill in the donation form: the snapshot every intent, donation and receipt
    /// of theirs carries.
    /// </summary>
    internal sealed record DemoGiver(
        string Email,
        string Name,
        string Mobile,
        string Pan,
        string AddressLine1,
        string? AddressLine2,
        string City,
        string PostalCode,
        bool NewDonor = false);

    /// <summary>One attempt to give. <c>Paid(...)</c> and <c>Gift(...)</c> below write the rows.</summary>
    internal sealed record DemoGift(
        string Donor,
        string Campaign,
        decimal Amount,
        PaymentMethodType Method,
        DemoWhen At,
        DemoOutcome Outcome,
        DonationSourceType Source,
        string? Asset,
        DemoReceipt Receipt,
        string? Lead);

    /// <summary>What became of the payment.</summary>
    internal enum DemoOutcome
    {
        /// <summary>Captured first time.</summary>
        Paid,

        /// <summary>The first attempt failed; the donor tried again and it went through.</summary>
        PaidOnRetry,

        /// <summary>Refused once. The row still offers a retry.</summary>
        Failed,

        /// <summary>Refused, retried and refused again - the point at which it goes to support.</summary>
        FailedTwice,

        /// <summary>Authorised by the bank and not yet captured.</summary>
        Authorised,

        /// <summary>Authorised, then no answer from the gateway: to be verified, never retried.</summary>
        TimedOut,

        /// <summary>The payment link ran out before the donor paid.</summary>
        Expired,

        /// <summary>The donor backed out on the payment page.</summary>
        Cancelled,

        /// <summary>
        /// The donor closed the first payment page and a fresh link has been issued; it is still
        /// inside its validity and has not been paid yet.
        /// </summary>
        AwaitingPayment
    }

    /// <summary>What became of the donor's copy of the receipt.</summary>
    internal enum DemoReceipt
    {
        /// <summary>No receipt: the payment did not complete.</summary>
        None,

        Delivered,

        /// <summary>Queued for sending.</summary>
        Pending,

        /// <summary>The donor's mail server refused it.</summary>
        Failed,

        /// <summary>Issued, and never sent.</summary>
        NotSent
    }

    internal enum DemoPeriod
    {
        LastMonth,
        ThisMonth,
        MinutesAgo
    }

    /// <summary>
    /// When a gift was made, relative to the moment the data is seeded.
    ///
    /// <see cref="DemoPeriod.LastMonth"/> carries a day of the month and a time of day in Indian
    /// Standard Time; <see cref="DemoPeriod.ThisMonth"/> a fraction of the part of this month
    /// that has already gone, so the gifts spread from the first to today whichever day that is;
    /// <see cref="DemoPeriod.MinutesAgo"/> a number of minutes.
    /// </summary>
    internal readonly record struct DemoWhen(DemoPeriod Period, double Value, int Hour = 0, int Minute = 0);

    // =============================================================================================
    // How the rows are written
    // =============================================================================================

    private static DemoWhen LastMonth(int day, int hour, int minute) =>
        new(DemoPeriod.LastMonth, day, hour, minute);

    private static DemoWhen ThisMonth(double fraction) => new(DemoPeriod.ThisMonth, fraction);

    private static DemoWhen MinutesAgo(int minutes) => new(DemoPeriod.MinutesAgo, minutes);

    /// <summary>A gift that went through, with what happened to its receipt.</summary>
    private static DemoGift Paid(
        string donor, string campaign, decimal amount, PaymentMethodType method, DemoWhen at,
        DonationSourceType source, string? asset = null, DemoReceipt receipt = DemoReceipt.Delivered,
        string? lead = null, bool onRetry = false) =>
        new(donor, campaign, amount, method, at, onRetry ? DemoOutcome.PaidOnRetry : DemoOutcome.Paid,
            source, asset, receipt, lead);

    /// <summary>A gift that did not go through, or has not yet.</summary>
    private static DemoGift Gift(
        string donor, string campaign, decimal amount, PaymentMethodType method, DemoWhen at,
        DemoOutcome outcome, DonationSourceType source, string? asset = null) =>
        new(donor, campaign, amount, method, at, outcome, source, asset, DemoReceipt.None, null);

    // Shorter names for the enum members the gift rows use on every line.
    private const PaymentMethodType Upi = PaymentMethodType.Upi;
    private const PaymentMethodType Card = PaymentMethodType.Card;
    private const PaymentMethodType NetBanking = PaymentMethodType.NetBanking;
    private const PaymentMethodType Wallet = PaymentMethodType.Wallet;
    private const DonationSourceType Qr = DonationSourceType.QrCode;
    private const DonationSourceType Web = DonationSourceType.Website;
    private const DonationSourceType Direct = DonationSourceType.DirectLink;
    private const DonationSourceType Mail = DonationSourceType.Email;
    private const DonationSourceType Social = DonationSourceType.Social;
    private const DonationSourceType Link = DonationSourceType.CampaignLink;
    private const DonationSourceType Fundraiser = DonationSourceType.FundraiserLead;

    internal static readonly IReadOnlyList<DemoOrganisation> Organisations =
    [
        // ============ SMILE FOUNDATION ============================================================
        new(
            Subdomain: "smilefoundation",
            Campaigns: new Dictionary<string, string>
            {
                ["SF-EDU-2026"] = "Educate a Child 2026",
                ["SF-HEALTH-2026"] = "Health on Wheels - Mobile Clinic Appeal",
                ["SF-NUTRITION-2026"] = "Midday Nutrition for Every Classroom",
                ["SF-LIVELIHOOD-2026"] = "Women's Livelihood - Tailoring Units",
                ["SF-MONSOON-2026"] = "Monsoon Health Camps 2026",
                ["SF-FLOOD-2026"] = "Assam Flood Relief 2026"
            },
            Places: new Dictionary<string, string>
            {
                ["SF-EDU-2026-QR-001"] = "Government senior secondary school gate, Saket",
                ["SF-EDU-2026-QR-002"] = "Shopping mall atrium kiosk, Saket",
                ["SF-EDU-2026-QR-003"] = "Hauz Khas Metro station concourse",
                ["SF-EDU-2026-QR-004"] = "Teachers' Day fundraiser stall, Lodhi Road",
                ["SF-HEALTH-2026-QR-001"] = "Mobile clinic van 1 - Dharavi route",
                ["SF-HEALTH-2026-QR-002"] = "Mobile clinic van 2 - Govandi route",
                ["SF-NUTRITION-2026-QR-001"] = "Tech park food court table tents, Outer Ring Road",
                ["SF-NUTRITION-2026-QR-002"] = "Indiranagar community hall notice board",
                ["SF-LIVELIHOOD-2026-QR-001"] = "Self-help group exhibition counter, Madhapur",
                ["SF-MONSOON-2026-QR-001"] = "Health camp registration desk, Salt Lake Sector V"
            },
            Givers:
            [
                new("harish.gopal@mail.test", "Harish Gopal", "9847012365", "AKQPG4821H",
                    "14, Chittoor Road", "Ernakulam South", "Kochi", "682016"),
                new("lakshmi.venkatesh@mail.test", "Lakshmi Venkatesh", "9840275136", "BLRPV7352K",
                    "Flat 3B, Sai Nivas, 27 Venkatakrishna Road", "Mandaveli", "Chennai", "600028"),
                new("siddharth.dinesh@mail.test", "Siddharth Dinesh", "9830164572", "CDXPD2946M",
                    "BE-112, Sector I", "Salt Lake City", "Kolkata", "700064"),
                new("meera.krishnan@mail.test", "Meera Krishnan", "9845163027", "AMGPK6017Q",
                    "No. 218, 6th Main, HAL 2nd Stage", "Indiranagar", "Bengaluru", "560038"),
                new("anand.raghavan@mail.test", "Anand Raghavan", "9841052736", "BFTPR3380L",
                    "Old No. 9, New No. 17, Second Street", "R.A. Puram", "Chennai", "600028"),
                new("divya.mahesh@mail.test", "Divya Mahesh", "9820471356", "CKWPM5194C",
                    "B-704, Sea Breeze Apartments, Carter Road", "Bandra (West)", "Mumbai", "400050"),
                new("rajiv.narayan@mail.test", "Rajiv Narayan", "9810364527", "AHYPN8823F",
                    "C-42, Second Floor", "Defence Colony", "New Delhi", "110024"),
                new("sunita.prasad@mail.test", "Sunita Prasad", "9839027415", "DJNPP4471B",
                    "3/114, Vivek Khand", "Gomti Nagar", "Lucknow", "226010"),
                new("thomas.mathew@mail.test", "Thomas Mathew", "9847260318", "BQSPM7608R",
                    "Kizhakkethil House, Kaloor-Kadavanthra Road", "Kadavanthra", "Kochi", "682020",
                    NewDonor: true),
                new("ayesha.karim@mail.test", "Ayesha Karim", "9849315072", "CRMPK9135D",
                    "8-2-293/82, Road No. 10", "Banjara Hills", "Hyderabad", "500034"),
                new("nikhil.sanjay@mail.test", "Nikhil Sanjay", "9822640715", "AZLPS2259N",
                    "Flat 12, Sahyadri Residency, Law College Road", "Erandwane", "Pune", "411004"),
                new("revathi.sundar@mail.test", "Revathi Sundar", "9843107526", "DTBPS6694J",
                    "41, Bharathi Park 2nd Cross", "Saibaba Colony", "Coimbatore", "641011"),
                new("csr@meridiantextiles.test", "Meridian Textiles Private Limited", "4222450138", "AAGCM4175E",
                    "SF No. 218, Avinashi Road", "Peelamedu", "Coimbatore", "641004"),
                new("giving@northbridgelogistics.test", "Northbridge Logistics LLP", "2226837410", "AAPFN9021H",
                    "Unit 6, Kalpataru Square, Kondivita Road", "Andheri (East)", "Mumbai", "400059"),
                new("gautam.vijay@mail.test", "Gautam Vijay", "9820536174", "BWEPV3046T",
                    "A-1203, Lakeview Towers, Hiranandani Gardens", "Powai", "Mumbai", "400076",
                    NewDonor: true),

                // ---- DonorCare's supporters: the same people as DON's catalogue -----------------
                new("rakesh.bhaskar@mail.test", "Rakesh Bhaskar", "9811402736", "BKRPB5130K",
                    "H-17, Lajpat Nagar III", null, "New Delhi", "110024"),
                new("smita.harish@mail.test", "Smita Harish", "9871230564", "CSHPH2047L",
                    "Flat 1102, Tower 4, DLF Park Place", "Sector 54", "Gurugram", "122011"),
                new("vandana.ashok@mail.test", "Vandana Ashok", "9810526473", "AVNPA6612M",
                    "C-213, Sector 50", null, "Noida", "201301"),
                new("pradeep.anil@mail.test", "Pradeep Anil", "9839614028", "DPRPA3907Q",
                    "2/45, Vineet Khand", "Gomti Nagar", "Lucknow", "226010"),
                new("nirmala.vikram@mail.test", "Nirmala Vikram", "9829073615", "BNMPV8254T",
                    "B-14, Bapu Nagar", null, "Jaipur", "302015"),
                new("simran.jasbir@mail.test", "Simran Jasbir", "9815307462", "CSJPJ4471F",
                    "House 2234, Sector 15-C", null, "Chandigarh", "160015"),
                new("alok.suresh@mail.test", "Alok Suresh", "9811730264", "AALPS9038D",
                    "A-52, Second Floor", "Greater Kailash I", "New Delhi", "110048"),
                new("komal.ravindra@mail.test", "Komal Ravindra", "9811563042", "DKRPR1726H",
                    "D-9", "Malviya Nagar", "New Delhi", "110017", NewDonor: true),
                new("tanvir.ahmed@mail.test", "Tanvir Ahmed", "9871304265", "BTAPA5583J",
                    "Flat 304, Tower 2", "Sector 49", "Gurugram", "122018", NewDonor: true),
                new("kaveri.srinath@mail.test", "Kaveri Srinath", "9845207316", "CKSPS7190B",
                    "No. 46, 4th Cross", "Malleswaram", "Bengaluru", "560003"),
                new("jayanthi.vasu@mail.test", "Jayanthi Vasu", "9840713526", "AJVPV2864N",
                    "Flat 2C, Lakshmi Apartments, 14 Bazullah Road", "T. Nagar", "Chennai", "600017"),
                new("roshan.joseph@mail.test", "Roshan Joseph", "9847306152", "DRJPJ6305C",
                    "Plot 22", "Panampilly Nagar", "Kochi", "682036"),
                new("sangeetha.mani@mail.test", "Sangeetha Mani", "9843520617", "BSMPM3418G",
                    "18, Race Course Road", null, "Coimbatore", "641018"),
                new("prasanna.gopi@mail.test", "Prasanna Gopi", "9849031527", "CPGPG8842R",
                    "Flat 301, Sai Krupa Residency, Road No. 12", "Banjara Hills", "Hyderabad", "500034"),
                new("deepika.arun@mail.test", "Deepika Arun", "9886142035", "ADKPA4097S",
                    "No. 1120, 7th Main", "Vijayanagar 2nd Stage", "Mysuru", "570017"),
                new("vinay.raghu@mail.test", "Vinay Raghu", "9848620371", "DVRPR5731E",
                    "Door 9-29-17, Balaji Nagar", "Siripuram", "Visakhapatnam", "530003"),
                new("akhil.raveendran@mail.test", "Akhil Raveendran", "9847152063", "BARPR2650W",
                    "Kalpaka", "Kadavanthra", "Kochi", "682020", NewDonor: true),
                new("nandhini.prabhakar@mail.test", "Nandhini Prabhakar", "9840531726", "CNPPP9183Y",
                    "New No. 8, Second Avenue", "Besant Nagar", "Chennai", "600090", NewDonor: true),

                // ---- Head office's institutional book: the same organisations as DON's ----------
                new("csr@aravalipower.test", "Aravali Power Solutions Limited", "1244612390", "AACCA5172F",
                    "Plot 18", "Sector 44", "Gurugram", "122003"),
                new("giving@konkanshipping.test", "Konkan Shipping Private Limited", "2266104538", "AAGCK3409M",
                    "5th Floor, Maker Chambers IV", "Nariman Point", "Mumbai", "400021"),
                new("csr@deccansoftware.test", "Deccan Software Services LLP", "4023157604", "AAJFD6612Q",
                    "Tower B, Cyber Gateway", "HITEC City", "Hyderabad", "500081"),
                new("grants@shreegangatrust.test", "Shree Ganga Charitable Trust", "1126431079", "AAATS7735N",
                    "14, Prithviraj Road", null, "New Delhi", "110011"),
                new("vikrant.harsh@mail.test", "Vikrant Harsh", "9810752346", "ADVPH4418K",
                    "W-12", "Greater Kailash II", "New Delhi", "110048"),
                new("sharada.venkat@mail.test", "Sharada Venkat", "9845361027", "BSVPV7026L",
                    "No. 9, 2nd Main", "Sadashivanagar", "Bengaluru", "560080"),
                new("leela.ravindran@mail.test", "Leela Ravindran", "9840162735", "CLRPR3391A",
                    "22, Poes Garden", "Teynampet", "Chennai", "600086")
            ],
            Gifts:
            [
                // ---- Last month ------------------------------------------------------------------
                Paid("harish.gopal@mail.test", "SF-EDU-2026", 6_000m, Upi, LastMonth(2, 10, 42), Qr,
                    "SF-EDU-2026-QR-001"),
                Paid("giving@northbridgelogistics.test", "SF-FLOOD-2026", 300_000m, NetBanking,
                    LastMonth(2, 15, 20), Direct),
                Paid("lakshmi.venkatesh@mail.test", "SF-EDU-2026", 12_000m, Card, LastMonth(3, 19, 15), Mail,
                    "SF-EDU-2026-LP-005"),
                Paid("siddharth.dinesh@mail.test", "SF-FLOOD-2026", 5_000m, NetBanking, LastMonth(4, 8, 55), Social,
                    "SF-FLOOD-2026-LP-001"),
                Paid("meera.krishnan@mail.test", "SF-NUTRITION-2026", 2_500m, Upi, LastMonth(5, 13, 20), Qr,
                    "SF-NUTRITION-2026-QR-001"),
                Paid("csr@meridiantextiles.test", "SF-EDU-2026", 250_000m, NetBanking, LastMonth(6, 15, 5), Direct),
                Paid("anand.raghavan@mail.test", "SF-HEALTH-2026", 10_000m, Card, LastMonth(7, 21, 40), Social,
                    "SF-HEALTH-2026-LP-004"),
                Paid("divya.mahesh@mail.test", "SF-LIVELIHOOD-2026", 3_500m, Wallet, LastMonth(8, 11, 10), Qr,
                    "SF-LIVELIHOOD-2026-QR-001"),
                Paid("rajiv.narayan@mail.test", "SF-MONSOON-2026", 75_000m, NetBanking, LastMonth(9, 9, 30), Qr,
                    "SF-MONSOON-2026-QR-001"),
                Paid("revathi.sundar@mail.test", "SF-LIVELIHOOD-2026", 12_000m, Card, LastMonth(9, 20, 25), Social,
                    "SF-LIVELIHOOD-2026-LP-002"),
                Paid("sunita.prasad@mail.test", "SF-FLOOD-2026", 1_100m, Upi, LastMonth(10, 18, 25), Web,
                    "SF-FLOOD-2026-LP-002"),
                Paid("nikhil.sanjay@mail.test", "SF-EDU-2026", 25_000m, NetBanking, LastMonth(11, 12, 0), Web,
                    "SF-EDU-2026-LP-006"),
                Paid("ayesha.karim@mail.test", "SF-LIVELIHOOD-2026", 5_000m, Card, LastMonth(12, 16, 45), Qr,
                    "SF-LIVELIHOOD-2026-QR-001", DemoReceipt.NotSent),
                Paid("nikhil.sanjay@mail.test", "SF-HEALTH-2026", 1_500m, Wallet, LastMonth(13, 20, 5), Mail,
                    "SF-HEALTH-2026-LP-003"),
                Paid("revathi.sundar@mail.test", "SF-NUTRITION-2026", 3_000m, Upi, LastMonth(14, 7, 50), Link,
                    "SF-NUTRITION-2026-LP-003"),
                Paid("harish.gopal@mail.test", "SF-FLOOD-2026", 2_000m, Upi, LastMonth(15, 22, 10), Social,
                    "SF-FLOOD-2026-LP-001"),
                Gift("lakshmi.venkatesh@mail.test", "SF-MONSOON-2026", 4_000m, Card, LastMonth(16, 10, 15),
                    DemoOutcome.Failed, Web),
                Paid("siddharth.dinesh@mail.test", "SF-EDU-2026", 6_000m, Card, LastMonth(17, 14, 35), Social,
                    "SF-EDU-2026-LP-007", onRetry: true),
                Paid("meera.krishnan@mail.test", "SF-HEALTH-2026", 5_000m, NetBanking, LastMonth(18, 9, 5), Mail,
                    "SF-HEALTH-2026-LP-003"),
                Gift("anand.raghavan@mail.test", "SF-MONSOON-2026", 2_000m, Upi, LastMonth(19, 17, 30),
                    DemoOutcome.Expired, Link, "SF-MONSOON-2026-LP-002"),
                Paid("divya.mahesh@mail.test", "SF-EDU-2026", 18_000m, Card, LastMonth(20, 20, 50), Web,
                    "SF-EDU-2026-LP-009"),
                Paid("rajiv.narayan@mail.test", "SF-NUTRITION-2026", 10_000m, NetBanking, LastMonth(22, 11, 25), Direct),
                Gift("sunita.prasad@mail.test", "SF-EDU-2026", 501m, Upi, LastMonth(23, 8, 15),
                    DemoOutcome.Failed, Qr, "SF-EDU-2026-QR-003"),
                Paid("anand.raghavan@mail.test", "SF-HEALTH-2026", 7_500m, Upi, LastMonth(24, 19, 40), Direct),
                Gift("ayesha.karim@mail.test", "SF-EDU-2026", 6_000m, Wallet, LastMonth(25, 13, 5),
                    DemoOutcome.Cancelled, Social, "SF-EDU-2026-LP-007"),
                Paid("nikhil.sanjay@mail.test", "SF-EDU-2026", 12_000m, Card, LastMonth(26, 21, 15), Mail,
                    "SF-EDU-2026-LP-005", DemoReceipt.Failed),
                Paid("giving@northbridgelogistics.test", "SF-HEALTH-2026", 100_000m, NetBanking,
                    LastMonth(27, 12, 30), Direct, receipt: DemoReceipt.NotSent),
                Paid("revathi.sundar@mail.test", "SF-EDU-2026", 6_000m, Upi, LastMonth(28, 10, 0), Link,
                    "SF-EDU-2026-LP-008"),

                // ---- This month ------------------------------------------------------------------
                Paid("harish.gopal@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.05), Qr,
                    "SF-EDU-2026-QR-001"),
                Paid("lakshmi.venkatesh@mail.test", "SF-NUTRITION-2026", 5_000m, Card, ThisMonth(0.12), Direct),
                Paid("siddharth.dinesh@mail.test", "SF-HEALTH-2026", 3_000m, Wallet, ThisMonth(0.18), Social,
                    "SF-HEALTH-2026-LP-004"),
                Paid("meera.krishnan@mail.test", "SF-EDU-2026", 15_000m, NetBanking, ThisMonth(0.25), Web,
                    "SF-EDU-2026-LP-006"),
                Gift("anand.raghavan@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.31),
                    DemoOutcome.FailedTwice, Qr, "SF-EDU-2026-QR-002"),
                Paid("divya.mahesh@mail.test", "SF-HEALTH-2026", 2_500m, Upi, ThisMonth(0.38), Qr,
                    "SF-HEALTH-2026-QR-001"),
                Paid("rajiv.narayan@mail.test", "SF-EDU-2026", 50_000m, NetBanking, ThisMonth(0.44), Direct),
                Paid("sunita.prasad@mail.test", "SF-NUTRITION-2026", 1_000m, Wallet, ThisMonth(0.50), Link,
                    "SF-NUTRITION-2026-LP-003", DemoReceipt.NotSent),
                Paid("ayesha.karim@mail.test", "SF-HEALTH-2026", 4_000m, Upi, ThisMonth(0.63), Social,
                    "SF-HEALTH-2026-LP-004", DemoReceipt.Failed),
                Gift("nikhil.sanjay@mail.test", "SF-NUTRITION-2026", 2_000m, Upi, ThisMonth(0.70),
                    DemoOutcome.Authorised, Qr, "SF-NUTRITION-2026-QR-002"),
                Paid("revathi.sundar@mail.test", "SF-HEALTH-2026", 3_500m, Card, ThisMonth(0.76), Mail,
                    "SF-HEALTH-2026-LP-003"),
                Paid("csr@meridiantextiles.test", "SF-NUTRITION-2026", 150_000m, NetBanking, ThisMonth(0.82),
                    Direct, receipt: DemoReceipt.Pending),
                Gift("harish.gopal@mail.test", "SF-HEALTH-2026", 2_000m, Wallet, ThisMonth(0.86),
                    DemoOutcome.Failed, Social, "SF-HEALTH-2026-LP-004"),
                Paid("thomas.mathew@mail.test", "SF-HEALTH-2026", 7_500m, Upi, ThisMonth(0.90), Fundraiser,
                    lead: "thomas.mathew@mail.test"),
                Paid("lakshmi.venkatesh@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.93), Qr,
                    "SF-EDU-2026-QR-002", DemoReceipt.Pending),
                Paid("gautam.vijay@mail.test", "SF-HEALTH-2026", 11_000m, Card, ThisMonth(0.95), Fundraiser,
                    lead: "gautam.vijay@mail.test"),
                Gift("siddharth.dinesh@mail.test", "SF-EDU-2026", 12_000m, Card, MinutesAgo(95),
                    DemoOutcome.TimedOut, Web, "SF-EDU-2026-LP-006"),
                Gift("meera.krishnan@mail.test", "SF-NUTRITION-2026", 1_500m, Upi, MinutesAgo(40),
                    DemoOutcome.AwaitingPayment, Link, "SF-NUTRITION-2026-LP-003"),

                // ---- DonorCare's supporters, last month ------------------------------------------
                Paid("rakesh.bhaskar@mail.test", "SF-EDU-2026", 6_000m, Upi, LastMonth(5, 11, 35), Qr,
                    "SF-EDU-2026-QR-004"),
                Paid("kaveri.srinath@mail.test", "SF-NUTRITION-2026", 3_000m, Upi, LastMonth(3, 13, 10), Qr,
                    "SF-NUTRITION-2026-QR-001"),
                Paid("jayanthi.vasu@mail.test", "SF-EDU-2026", 6_000m, Card, LastMonth(9, 18, 40), Mail,
                    "SF-EDU-2026-LP-005"),
                Paid("smita.harish@mail.test", "SF-HEALTH-2026", 2_500m, Card, LastMonth(10, 20, 15), Direct),
                Paid("vandana.ashok@mail.test", "SF-NUTRITION-2026", 1_500m, Upi, LastMonth(12, 9, 20), Link,
                    "SF-NUTRITION-2026-LP-003"),
                Paid("roshan.joseph@mail.test", "SF-HEALTH-2026", 5_000m, NetBanking, LastMonth(14, 12, 25), Mail,
                    "SF-HEALTH-2026-LP-003", DemoReceipt.Failed),
                Paid("pradeep.anil@mail.test", "SF-EDU-2026", 12_000m, NetBanking, LastMonth(18, 10, 50), Web,
                    "SF-EDU-2026-LP-006"),
                Paid("sangeetha.mani@mail.test", "SF-NUTRITION-2026", 2_000m, Upi, LastMonth(19, 19, 5), Qr,
                    "SF-NUTRITION-2026-QR-002"),
                Paid("nirmala.vikram@mail.test", "SF-LIVELIHOOD-2026", 5_000m, Card, LastMonth(21, 16, 30), Social,
                    "SF-LIVELIHOOD-2026-LP-002"),
                Paid("prasanna.gopi@mail.test", "SF-EDU-2026", 12_000m, NetBanking, LastMonth(22, 14, 0), Direct,
                    receipt: DemoReceipt.NotSent),
                Paid("deepika.arun@mail.test", "SF-EDU-2026", 3_000m, Wallet, LastMonth(25, 21, 20), Social,
                    "SF-EDU-2026-LP-007"),
                Paid("simran.jasbir@mail.test", "SF-HEALTH-2026", 2_000m, Wallet, LastMonth(26, 17, 45), Social,
                    "SF-HEALTH-2026-LP-004"),

                // ---- DonorCare's supporters, this month ------------------------------------------
                Paid("nirmala.vikram@mail.test", "SF-EDU-2026", 3_000m, Upi, ThisMonth(0.10), Qr,
                    "SF-EDU-2026-QR-002"),
                Paid("rakesh.bhaskar@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.15), Qr,
                    "SF-EDU-2026-QR-001"),
                Paid("kaveri.srinath@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.20), Web,
                    "SF-EDU-2026-LP-006"),
                Paid("vinay.raghu@mail.test", "SF-HEALTH-2026", 2_500m, Upi, ThisMonth(0.28), Qr,
                    "SF-HEALTH-2026-QR-002"),
                Paid("alok.suresh@mail.test", "SF-EDU-2026", 25_000m, NetBanking, ThisMonth(0.33), Direct,
                    receipt: DemoReceipt.Pending),
                Paid("smita.harish@mail.test", "SF-HEALTH-2026", 2_500m, Card, ThisMonth(0.40), Mail,
                    "SF-HEALTH-2026-LP-003"),
                Paid("jayanthi.vasu@mail.test", "SF-NUTRITION-2026", 1_500m, Upi, ThisMonth(0.47), Link,
                    "SF-NUTRITION-2026-LP-003"),
                Paid("vandana.ashok@mail.test", "SF-NUTRITION-2026", 1_500m, Upi, ThisMonth(0.55), Link,
                    "SF-NUTRITION-2026-LP-003"),
                Paid("sangeetha.mani@mail.test", "SF-NUTRITION-2026", 2_000m, Upi, ThisMonth(0.58), Qr,
                    "SF-NUTRITION-2026-QR-002"),
                Paid("deepika.arun@mail.test", "SF-HEALTH-2026", 1_500m, Upi, ThisMonth(0.66), Social,
                    "SF-HEALTH-2026-LP-004"),
                Paid("komal.ravindra@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.92), Fundraiser,
                    lead: "komal.ravindra@mail.test"),
                Paid("akhil.raveendran@mail.test", "SF-NUTRITION-2026", 4_500m, Upi, ThisMonth(0.94), Fundraiser,
                    lead: "akhil.raveendran@mail.test"),
                Paid("tanvir.ahmed@mail.test", "SF-HEALTH-2026", 10_000m, Card, ThisMonth(0.96), Fundraiser,
                    lead: "tanvir.ahmed@mail.test"),
                Paid("nandhini.prabhakar@mail.test", "SF-EDU-2026", 12_000m, Card, ThisMonth(0.97), Fundraiser,
                    lead: "nandhini.prabhakar@mail.test"),

                // ---- Fail: seven more, so the queue's Fail view holds a full page ----------------
                Gift("kaveri.srinath@mail.test", "SF-EDU-2026", 6_000m, Card, LastMonth(6, 20, 40),
                    DemoOutcome.Failed, Web, "SF-EDU-2026-LP-006"),
                Gift("smita.harish@mail.test", "SF-HEALTH-2026", 2_500m, Card, LastMonth(16, 19, 55),
                    DemoOutcome.Failed, Mail, "SF-HEALTH-2026-LP-003"),
                Gift("revathi.sundar@mail.test", "SF-EDU-2026", 6_000m, Upi, LastMonth(20, 8, 40),
                    DemoOutcome.Failed, Qr, "SF-EDU-2026-QR-003"),
                Gift("vinay.raghu@mail.test", "SF-HEALTH-2026", 2_500m, Wallet, ThisMonth(0.12),
                    DemoOutcome.Failed, Qr, "SF-HEALTH-2026-QR-002"),
                Gift("pradeep.anil@mail.test", "SF-EDU-2026", 12_000m, Upi, ThisMonth(0.22),
                    DemoOutcome.FailedTwice, Web, "SF-EDU-2026-LP-006"),
                Gift("jayanthi.vasu@mail.test", "SF-NUTRITION-2026", 1_500m, Upi, ThisMonth(0.35),
                    DemoOutcome.Failed, Link, "SF-NUTRITION-2026-LP-003"),
                Gift("divya.mahesh@mail.test", "SF-NUTRITION-2026", 1_500m, Card, ThisMonth(0.48),
                    DemoOutcome.FailedTwice, Direct),

                // ---- Pending: six more - links that ran out, pages the donor left, one still open ---
                Gift("simran.jasbir@mail.test", "SF-EDU-2026", 3_000m, Upi, LastMonth(8, 12, 15),
                    DemoOutcome.Expired, Link, "SF-EDU-2026-LP-008"),
                Gift("vandana.ashok@mail.test", "SF-HEALTH-2026", 2_000m, Card, LastMonth(23, 21, 30),
                    DemoOutcome.Cancelled, Social, "SF-HEALTH-2026-LP-004"),
                Gift("alok.suresh@mail.test", "SF-EDU-2026", 12_000m, NetBanking, ThisMonth(0.08),
                    DemoOutcome.Expired, Web, "SF-EDU-2026-LP-006"),
                Gift("sangeetha.mani@mail.test", "SF-NUTRITION-2026", 1_500m, Wallet, ThisMonth(0.42),
                    DemoOutcome.Cancelled, Qr, "SF-NUTRITION-2026-QR-002"),
                Gift("deepika.arun@mail.test", "SF-EDU-2026", 6_000m, Card, ThisMonth(0.80),
                    DemoOutcome.Cancelled, Social, "SF-EDU-2026-LP-007"),
                Gift("kaveri.srinath@mail.test", "SF-NUTRITION-2026", 3_000m, Upi, MinutesAgo(20),
                    DemoOutcome.AwaitingPayment, Link, "SF-NUTRITION-2026-LP-003"),

                // ---- Head office's institutional gifts, by bank transfer -------------------------
                Paid("csr@aravalipower.test", "SF-EDU-2026", 200_000m, NetBanking, LastMonth(4, 15, 40), Direct),
                Paid("vikrant.harsh@mail.test", "SF-EDU-2026", 100_000m, NetBanking, LastMonth(11, 12, 15), Direct),
                Paid("giving@konkanshipping.test", "SF-HEALTH-2026", 150_000m, NetBanking, LastMonth(15, 16, 20), Direct),
                Paid("leela.ravindran@mail.test", "SF-EDU-2026", 50_000m, NetBanking, LastMonth(19, 11, 30), Direct),
                Paid("csr@deccansoftware.test", "SF-EDU-2026", 120_000m, NetBanking, LastMonth(24, 14, 45), Direct,
                    receipt: DemoReceipt.NotSent),
                Paid("grants@shreegangatrust.test", "SF-NUTRITION-2026", 300_000m, NetBanking, ThisMonth(0.18), Direct,
                    receipt: DemoReceipt.Pending),
                Paid("giving@konkanshipping.test", "SF-HEALTH-2026", 50_000m, NetBanking, ThisMonth(0.36), Direct),
                Paid("sharada.venkat@mail.test", "SF-NUTRITION-2026", 75_000m, NetBanking, ThisMonth(0.52), Direct),
                Paid("leela.ravindran@mail.test", "SF-EDU-2026", 50_000m, NetBanking, ThisMonth(0.74), Direct)
            ]),

        // ============ HELPAGE INDIA ===============================================================
        new(
            Subdomain: "helpageindia",
            Campaigns: new Dictionary<string, string>
            {
                ["HAI-ELDERCARE-2026"] = "Care for the Elderly - Annual Appeal 2026",
                ["HAI-MOBILECARE-2026"] = "Mobile Healthcare Units - Care at the Doorstep",
                ["HAI-SIGHT-2026"] = "Restore Sight - Cataract Surgeries 2026",
                ["HAI-DIGITAL-2026"] = "Digital Literacy for Seniors",
                ["HAI-PHYSIO-2026"] = "Physiotherapy at Home",
                ["HAI-HEATWAVE-2026"] = "Heatwave Relief for Elders 2026"
            },
            Places: new Dictionary<string, string>
            {
                ["HAI-ELDERCARE-2026-QR-001"] = "Residents' association notice board, Safdarjung Enclave",
                ["HAI-ELDERCARE-2026-QR-002"] = "Green Park Metro station concourse",
                ["HAI-ELDERCARE-2026-QR-003"] = "Senior citizens' walk kiosk, Lodhi Road",
                ["HAI-ELDERCARE-2026-QR-004"] = "International Day of Older Persons stall, Lodhi Road",
                ["HAI-MOBILECARE-2026-QR-001"] = "Mobile healthcare unit 1 - Aliganj route",
                ["HAI-MOBILECARE-2026-QR-002"] = "Mobile healthcare unit 2 - Chinhat route",
                ["HAI-SIGHT-2026-QR-001"] = "Eye camp registration desk, Egmore",
                ["HAI-SIGHT-2026-QR-002"] = "Community hall notice board, T. Nagar",
                ["HAI-DIGITAL-2026-QR-001"] = "Senior tech fair counter, Jayanagar 4th Block",
                ["HAI-PHYSIO-2026-QR-001"] = "Physiotherapy centre front desk, Dadar (West)"
            },
            Givers:
            [
                new("ajay.sekar@mail.test", "Ajay Sekar", "9884031275", "BHKPS3907T",
                    "Plot 56, 4th Avenue", "Ashok Nagar", "Chennai", "600083"),
                new("ishita.rakesh@mail.test", "Ishita Rakesh", "9836527014", "CNVPR8842A",
                    "P-214, CIT Scheme VII M", "Kankurgachi", "Kolkata", "700054"),
                new("kiran.manoj@mail.test", "Kiran Manoj", "9815246307", "AQJPM5510G",
                    "House 1184, Sector 21-B", null, "Chandigarh", "160022"),
                new("geetha.raman@mail.test", "Geetha Raman", "9840731625", "DLWPR2063P",
                    "12/5, Kamakoti Street", "West Mambalam", "Chennai", "600033"),
                new("joseph.daniel@mail.test", "Joseph Daniel", "9846215703", "BXTPD7729E",
                    "Puthenpurackal, Convent Road", "Ernakulam North", "Kochi", "682018"),
                new("padma.narayanan@mail.test", "Padma Narayanan", "9886402517", "CEHPN4418S",
                    "No. 77, 9th Cross, 3rd Block", "Jayanagar", "Bengaluru", "560011"),
                new("farida.yusuf@mail.test", "Farida Yusuf", "9820315647", "AWRPY6350K",
                    "Flat 502, Gulmohar Heights, S.V. Road", "Santacruz (West)", "Mumbai", "400054"),
                new("vinod.kishore@mail.test", "Vinod Kishore", "9811640275", "DPGPK1987C",
                    "B-3/27, Safdarjung Enclave", null, "New Delhi", "110029"),
                new("anita.jagdish@mail.test", "Anita Jagdish", "9830427165", "BMSPJ8076L",
                    "22/1, Hindustan Park", "Gariahat", "Kolkata", "700029"),
                new("ramesh.chandran@mail.test", "Ramesh Chandran", "9847530216", "CZKPC3642H",
                    "TC 9/1124, Sasthamangalam", null, "Thiruvananthapuram", "695010",
                    NewDonor: true),
                new("sheela.mohan@mail.test", "Sheela Mohan", "9849260731", "AFNPM9253D",
                    "Plot 88, Road No. 3", "Jubilee Hills", "Hyderabad", "500033"),
                new("prakash.subhash@mail.test", "Prakash Subhash", "9822071346", "DKQPS5804R",
                    "5, Shivtirth Society, Karve Road", "Kothrud", "Pune", "411038"),
                new("csr@kaveriagro.test", "Kaveri Agro Industries Limited", "8025584130", "AABCK6127F",
                    "No. 31, Residency Road", null, "Bengaluru", "560025"),
                new("csr@silverlinepharma.test", "Silverline Pharma Distributors Private Limited", "2226591470", "AAHCS2284M",
                    "Plot C-21, G Block", "Bandra Kurla Complex", "Mumbai", "400051"),
                new("santosh.vinay@mail.test", "Santosh Vinay", "9839417260", "BNLPV6172D",
                    "4/27, Vishal Khand", "Gomti Nagar", "Lucknow", "226010",
                    NewDonor: true),

                // ---- Donor Services' supporters: the same people as DON's catalogue -------------
                new("sushma.raghunath@mail.test", "Sushma Raghunath", "9811207346", "BSRPR4062H",
                    "D-24, Second Floor", "Hauz Khas", "New Delhi", "110016"),
                new("vijay.lakshman@mail.test", "Vijay Lakshman", "9871502634", "CVLPL7319K",
                    "Flat 902, Tower C, Uniworld City", "Sector 30", "Gurugram", "122001"),
                new("neelima.shankar@mail.test", "Neelima Shankar", "9810637245", "ANSPS2584M",
                    "B-118, Sector 26", null, "Noida", "201301"),
                new("ramakant.bhushan@mail.test", "Ramakant Bhushan", "9839705126", "DRBPB6937Q",
                    "C-1/22, Sector C", "Aliganj", "Lucknow", "226024"),
                new("usha.govind@mail.test", "Usha Govind", "9829341706", "BUGPG1846T",
                    "45, Shanti Path", "Tilak Nagar", "Jaipur", "302004"),
                new("gurpreet.inderjit@mail.test", "Gurpreet Inderjit", "9815470263", "CGIPI5502F",
                    "House 512, Sector 8-B", null, "Chandigarh", "160009"),
                new("sameer.ishwar@mail.test", "Sameer Ishwar", "9811360427", "ASIPI8270D",
                    "E-45, Third Floor", "Kalkaji", "New Delhi", "110019"),
                new("payal.hitesh@mail.test", "Payal Hitesh", "9811624053", "DPHPH3615H",
                    "C-71, Second Floor", "Sarvodaya Enclave", "New Delhi", "110017", NewDonor: true),
                new("rahul.devraj@mail.test", "Rahul Devraj", "9871240536", "BRDPD7048J",
                    "Flat 1704, Tower 6", "Sector 54", "Gurugram", "122011", NewDonor: true),
                new("sharmila.dipankar@mail.test", "Sharmila Dipankar", "9830214765", "CSDPD2931B",
                    "15/2, Gariahat Road", "Ballygunge", "Kolkata", "700019"),
                new("arnab.sukumar@mail.test", "Arnab Sukumar", "9836014527", "AASPS6458N",
                    "AE-312, Sector I", "Salt Lake City", "Kolkata", "700064"),
                new("rina.partha@mail.test", "Rina Partha", "9437206513", "DRPPP4127C",
                    "Plot 112", "Saheed Nagar", "Bhubaneswar", "751007"),
                new("moloy.tapan@mail.test", "Moloy Tapan", "9435120746", "BMTPT8364G",
                    "House 14, Zoo Narengi Road", null, "Guwahati", "781024"),
                new("kakoli.ashim@mail.test", "Kakoli Ashim", "9830571246", "CKAPA1795R",
                    "P-41, Lake Road", null, "Kolkata", "700029"),
                new("nilanjana.amit@mail.test", "Nilanjana Amit", "9831620475", "ANAPA9603S",
                    "Flat 5B, Sunrise Apartments, 21 Hazra Road", null, "Kolkata", "700026"),
                new("rajib.supriyo@mail.test", "Rajib Supriyo", "9835406127", "DRSPS3286E",
                    "Road No. 4", "Rajendra Nagar", "Patna", "800016"),
                new("ananya.sourav@mail.test", "Ananya Sourav", "9830652174", "BASPS5719W",
                    "22B, Southern Avenue", null, "Kolkata", "700029", NewDonor: true),
                new("abhijit.tarun@mail.test", "Abhijit Tarun", "9831047265", "CATPT6842Y",
                    "BD-56, Sector I", "Salt Lake City", "Kolkata", "700064", NewDonor: true),

                // ---- Head office's institutional book: the same organisations as DON's ----------
                new("csr@sahyadricement.test", "Sahyadri Cement Limited", "2025536418", "AACCS6094G",
                    "Survey No. 45", "Baner Road", "Pune", "411045"),
                new("giving@coromandellogistics.test", "Coromandel Logistics Private Limited", "4428391047", "AAHCC1857R",
                    "88, Rajaji Salai", null, "Chennai", "600001"),
                new("csr@indusfintech.test", "Indus Fintech Services LLP", "8041765203", "AAKFI4730B",
                    "Level 9, Prestige Tech Park", "Outer Ring Road", "Bengaluru", "560103"),
                new("grants@annapurnaseva.test", "Sri Annapurna Seva Trust", "1123354076", "AAATA2269D",
                    "6, Jor Bagh", null, "New Delhi", "110003"),
                new("kishan.dayal@mail.test", "Kishan Dayal", "9811084352", "AKDPD5612E",
                    "C-9", "Vasant Vihar", "New Delhi", "110057"),
                new("malini.raghavendra@mail.test", "Malini Raghavendra", "9886257031", "BMRPR8147C",
                    "No. 31, 8th Cross", "Malleswaram", "Bengaluru", "560003"),
                new("hemalatha.srinivasan@mail.test", "Hemalatha Srinivasan", "9840271538", "CHSPS2093W",
                    "17, Boat Club Road", "Raja Annamalai Puram", "Chennai", "600028")
            ],
            Gifts:
            [
                // ---- Last month ------------------------------------------------------------------
                Paid("ajay.sekar@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, LastMonth(1, 11, 5), Qr,
                    "HAI-ELDERCARE-2026-QR-001"),
                Paid("csr@silverlinepharma.test", "HAI-HEATWAVE-2026", 250_000m, NetBanking,
                    LastMonth(2, 14, 40), Direct),
                Paid("ishita.rakesh@mail.test", "HAI-ELDERCARE-2026", 10_000m, Card, LastMonth(3, 20, 10), Mail,
                    "HAI-ELDERCARE-2026-LP-005"),
                Paid("kiran.manoj@mail.test", "HAI-HEATWAVE-2026", 4_000m, NetBanking, LastMonth(4, 9, 35), Social,
                    "HAI-HEATWAVE-2026-LP-001"),
                Paid("geetha.raman@mail.test", "HAI-SIGHT-2026", 4_500m, Upi, LastMonth(5, 12, 50), Qr,
                    "HAI-SIGHT-2026-QR-001"),
                Paid("csr@kaveriagro.test", "HAI-ELDERCARE-2026", 200_000m, NetBanking, LastMonth(6, 16, 15), Direct),
                Paid("joseph.daniel@mail.test", "HAI-MOBILECARE-2026", 9_000m, Card, LastMonth(7, 21, 5), Social,
                    "HAI-MOBILECARE-2026-LP-004"),
                Paid("padma.narayanan@mail.test", "HAI-DIGITAL-2026", 2_000m, Wallet, LastMonth(8, 10, 30), Qr,
                    "HAI-DIGITAL-2026-QR-001"),
                Paid("farida.yusuf@mail.test", "HAI-PHYSIO-2026", 60_000m, NetBanking, LastMonth(9, 10, 10), Qr,
                    "HAI-PHYSIO-2026-QR-001"),
                Paid("prakash.subhash@mail.test", "HAI-DIGITAL-2026", 8_000m, Card, LastMonth(9, 19, 45), Social,
                    "HAI-DIGITAL-2026-LP-002"),
                Paid("vinod.kishore@mail.test", "HAI-HEATWAVE-2026", 800m, Upi, LastMonth(10, 17, 55), Web,
                    "HAI-HEATWAVE-2026-LP-002"),
                Paid("sheela.mohan@mail.test", "HAI-ELDERCARE-2026", 20_000m, NetBanking, LastMonth(11, 13, 20), Web,
                    "HAI-ELDERCARE-2026-LP-006"),
                Paid("anita.jagdish@mail.test", "HAI-DIGITAL-2026", 4_000m, Card, LastMonth(12, 15, 30), Qr,
                    "HAI-DIGITAL-2026-QR-001", DemoReceipt.NotSent),
                Paid("sheela.mohan@mail.test", "HAI-MOBILECARE-2026", 3_000m, Wallet, LastMonth(13, 19, 25), Mail,
                    "HAI-MOBILECARE-2026-LP-003"),
                Paid("prakash.subhash@mail.test", "HAI-SIGHT-2026", 4_500m, Upi, LastMonth(14, 8, 40), Link,
                    "HAI-SIGHT-2026-LP-003"),
                Paid("ajay.sekar@mail.test", "HAI-HEATWAVE-2026", 1_600m, Upi, LastMonth(15, 21, 30), Social,
                    "HAI-HEATWAVE-2026-LP-001"),
                Gift("ishita.rakesh@mail.test", "HAI-PHYSIO-2026", 3_600m, Card, LastMonth(16, 11, 45),
                    DemoOutcome.Failed, Web),
                Paid("kiran.manoj@mail.test", "HAI-ELDERCARE-2026", 5_000m, Card, LastMonth(17, 15, 10), Social,
                    "HAI-ELDERCARE-2026-LP-007", DemoReceipt.Failed, onRetry: true),
                Paid("geetha.raman@mail.test", "HAI-MOBILECARE-2026", 6_000m, NetBanking, LastMonth(18, 10, 25), Mail,
                    "HAI-MOBILECARE-2026-LP-003"),
                Gift("joseph.daniel@mail.test", "HAI-PHYSIO-2026", 1_800m, Upi, LastMonth(19, 18, 5),
                    DemoOutcome.Expired, Link, "HAI-PHYSIO-2026-LP-002"),
                Paid("padma.narayanan@mail.test", "HAI-ELDERCARE-2026", 15_000m, Card, LastMonth(20, 20, 20), Web,
                    "HAI-ELDERCARE-2026-LP-009"),
                Paid("farida.yusuf@mail.test", "HAI-SIGHT-2026", 9_000m, NetBanking, LastMonth(22, 12, 5), Direct),
                Gift("vinod.kishore@mail.test", "HAI-ELDERCARE-2026", 501m, Upi, LastMonth(23, 9, 10),
                    DemoOutcome.Failed, Qr, "HAI-ELDERCARE-2026-QR-002"),
                Paid("joseph.daniel@mail.test", "HAI-MOBILECARE-2026", 6_000m, Upi, LastMonth(24, 20, 15), Direct),
                Gift("anita.jagdish@mail.test", "HAI-ELDERCARE-2026", 5_000m, Wallet, LastMonth(25, 14, 0),
                    DemoOutcome.Cancelled, Social, "HAI-ELDERCARE-2026-LP-007"),
                Paid("sheela.mohan@mail.test", "HAI-ELDERCARE-2026", 10_000m, Card, LastMonth(26, 22, 5), Mail,
                    "HAI-ELDERCARE-2026-LP-005", DemoReceipt.Failed),
                Paid("csr@silverlinepharma.test", "HAI-MOBILECARE-2026", 120_000m, NetBanking,
                    LastMonth(27, 11, 50), Direct, receipt: DemoReceipt.NotSent),
                Paid("prakash.subhash@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, LastMonth(28, 9, 45), Link,
                    "HAI-ELDERCARE-2026-LP-008"),

                // ---- This month ------------------------------------------------------------------
                Paid("ajay.sekar@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.06), Qr,
                    "HAI-ELDERCARE-2026-QR-001"),
                Paid("ishita.rakesh@mail.test", "HAI-SIGHT-2026", 4_500m, Card, ThisMonth(0.13), Direct),
                Paid("kiran.manoj@mail.test", "HAI-MOBILECARE-2026", 3_000m, Wallet, ThisMonth(0.19), Social,
                    "HAI-MOBILECARE-2026-LP-004"),
                Paid("geetha.raman@mail.test", "HAI-ELDERCARE-2026", 12_000m, NetBanking, ThisMonth(0.26), Web,
                    "HAI-ELDERCARE-2026-LP-006"),
                Gift("joseph.daniel@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.32),
                    DemoOutcome.FailedTwice, Qr, "HAI-ELDERCARE-2026-QR-003"),
                Paid("padma.narayanan@mail.test", "HAI-MOBILECARE-2026", 3_000m, Upi, ThisMonth(0.39), Qr,
                    "HAI-MOBILECARE-2026-QR-001"),
                Paid("farida.yusuf@mail.test", "HAI-ELDERCARE-2026", 75_000m, NetBanking, ThisMonth(0.45), Direct),
                Paid("vinod.kishore@mail.test", "HAI-SIGHT-2026", 1_000m, Wallet, ThisMonth(0.51), Link,
                    "HAI-SIGHT-2026-LP-003", DemoReceipt.NotSent),
                Paid("anita.jagdish@mail.test", "HAI-MOBILECARE-2026", 3_000m, Upi, ThisMonth(0.64), Social,
                    "HAI-MOBILECARE-2026-LP-004"),
                Gift("sheela.mohan@mail.test", "HAI-SIGHT-2026", 2_000m, Upi, ThisMonth(0.71),
                    DemoOutcome.Authorised, Qr, "HAI-SIGHT-2026-QR-002"),
                Paid("prakash.subhash@mail.test", "HAI-MOBILECARE-2026", 3_500m, Card, ThisMonth(0.77), Mail,
                    "HAI-MOBILECARE-2026-LP-003"),
                Paid("csr@kaveriagro.test", "HAI-SIGHT-2026", 150_000m, NetBanking, ThisMonth(0.83),
                    Direct, receipt: DemoReceipt.Pending),
                Gift("ajay.sekar@mail.test", "HAI-MOBILECARE-2026", 2_000m, Wallet, ThisMonth(0.87),
                    DemoOutcome.Failed, Social, "HAI-MOBILECARE-2026-LP-004"),
                Paid("ramesh.chandran@mail.test", "HAI-MOBILECARE-2026", 6_000m, Upi, ThisMonth(0.90), Fundraiser,
                    lead: "ramesh.chandran@mail.test"),
                Paid("geetha.raman@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.93), Qr,
                    "HAI-ELDERCARE-2026-QR-002", DemoReceipt.Pending),
                Paid("santosh.vinay@mail.test", "HAI-MOBILECARE-2026", 21_000m, Card, ThisMonth(0.95), Fundraiser,
                    lead: "santosh.vinay@mail.test"),
                Gift("ishita.rakesh@mail.test", "HAI-ELDERCARE-2026", 10_000m, Card, MinutesAgo(95),
                    DemoOutcome.TimedOut, Web, "HAI-ELDERCARE-2026-LP-006"),
                Gift("kiran.manoj@mail.test", "HAI-SIGHT-2026", 4_500m, Upi, MinutesAgo(40),
                    DemoOutcome.AwaitingPayment, Link, "HAI-SIGHT-2026-LP-003"),

                // ---- Donor Services' supporters, last month --------------------------------------
                Paid("sharmila.dipankar@mail.test", "HAI-SIGHT-2026", 4_500m, Upi, LastMonth(3, 12, 40), Qr,
                    "HAI-SIGHT-2026-QR-001"),
                Paid("sushma.raghunath@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, LastMonth(4, 10, 20), Qr,
                    "HAI-ELDERCARE-2026-QR-001"),
                Paid("arnab.sukumar@mail.test", "HAI-ELDERCARE-2026", 5_000m, Card, LastMonth(9, 19, 10), Mail,
                    "HAI-ELDERCARE-2026-LP-005"),
                Paid("vijay.lakshman@mail.test", "HAI-SIGHT-2026", 4_500m, Card, LastMonth(11, 21, 0), Link,
                    "HAI-SIGHT-2026-LP-003"),
                Paid("neelima.shankar@mail.test", "HAI-ELDERCARE-2026", 2_500m, Upi, LastMonth(13, 8, 50), Link,
                    "HAI-ELDERCARE-2026-LP-008"),
                Paid("rina.partha@mail.test", "HAI-MOBILECARE-2026", 6_000m, NetBanking, LastMonth(14, 11, 35), Mail,
                    "HAI-MOBILECARE-2026-LP-003", DemoReceipt.Failed),
                Paid("ramakant.bhushan@mail.test", "HAI-MOBILECARE-2026", 6_000m, NetBanking, LastMonth(17, 15, 25), Mail,
                    "HAI-MOBILECARE-2026-LP-003"),
                Paid("moloy.tapan@mail.test", "HAI-ELDERCARE-2026", 2_000m, Upi, LastMonth(19, 18, 15), Qr,
                    "HAI-ELDERCARE-2026-QR-003"),
                Paid("usha.govind@mail.test", "HAI-DIGITAL-2026", 2_000m, Card, LastMonth(20, 16, 5), Social,
                    "HAI-DIGITAL-2026-LP-002"),
                Paid("kakoli.ashim@mail.test", "HAI-ELDERCARE-2026", 10_000m, NetBanking, LastMonth(22, 13, 30), Direct,
                    receipt: DemoReceipt.NotSent),
                Paid("gurpreet.inderjit@mail.test", "HAI-MOBILECARE-2026", 3_000m, Wallet, LastMonth(25, 20, 45), Social,
                    "HAI-MOBILECARE-2026-LP-004"),
                Paid("nilanjana.amit@mail.test", "HAI-ELDERCARE-2026", 3_000m, Wallet, LastMonth(26, 22, 10), Social,
                    "HAI-ELDERCARE-2026-LP-007"),

                // ---- Donor Services' supporters, this month --------------------------------------
                Paid("usha.govind@mail.test", "HAI-ELDERCARE-2026", 3_000m, Upi, ThisMonth(0.11), Qr,
                    "HAI-ELDERCARE-2026-QR-002"),
                Paid("sushma.raghunath@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.14), Qr,
                    "HAI-ELDERCARE-2026-QR-004"),
                Paid("sharmila.dipankar@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.21), Web,
                    "HAI-ELDERCARE-2026-LP-006"),
                Paid("rajib.supriyo@mail.test", "HAI-MOBILECARE-2026", 3_000m, Upi, ThisMonth(0.27), Qr,
                    "HAI-MOBILECARE-2026-QR-002"),
                Paid("sameer.ishwar@mail.test", "HAI-ELDERCARE-2026", 25_000m, NetBanking, ThisMonth(0.31), Direct,
                    receipt: DemoReceipt.Pending),
                Paid("vijay.lakshman@mail.test", "HAI-SIGHT-2026", 4_500m, Card, ThisMonth(0.38), Link,
                    "HAI-SIGHT-2026-LP-003"),
                Paid("arnab.sukumar@mail.test", "HAI-SIGHT-2026", 2_000m, Upi, ThisMonth(0.46), Link,
                    "HAI-SIGHT-2026-LP-003"),
                Paid("neelima.shankar@mail.test", "HAI-ELDERCARE-2026", 2_500m, Upi, ThisMonth(0.53), Link,
                    "HAI-ELDERCARE-2026-LP-008"),
                Paid("moloy.tapan@mail.test", "HAI-ELDERCARE-2026", 2_000m, Upi, ThisMonth(0.57), Qr,
                    "HAI-ELDERCARE-2026-QR-003"),
                Paid("nilanjana.amit@mail.test", "HAI-MOBILECARE-2026", 1_500m, Upi, ThisMonth(0.67), Social,
                    "HAI-MOBILECARE-2026-LP-004"),
                Paid("payal.hitesh@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.92), Fundraiser,
                    lead: "payal.hitesh@mail.test"),
                Paid("ananya.sourav@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.94), Fundraiser,
                    lead: "ananya.sourav@mail.test"),
                Paid("rahul.devraj@mail.test", "HAI-SIGHT-2026", 9_000m, Card, ThisMonth(0.96), Fundraiser,
                    lead: "rahul.devraj@mail.test"),
                Paid("abhijit.tarun@mail.test", "HAI-MOBILECARE-2026", 12_000m, Card, ThisMonth(0.97), Fundraiser,
                    lead: "abhijit.tarun@mail.test"),

                // ---- Fail: seven more, so the queue's Fail view holds a full page ----------------
                Gift("sharmila.dipankar@mail.test", "HAI-ELDERCARE-2026", 5_000m, Card, LastMonth(6, 20, 25),
                    DemoOutcome.Failed, Web, "HAI-ELDERCARE-2026-LP-006"),
                Gift("vijay.lakshman@mail.test", "HAI-SIGHT-2026", 4_500m, Card, LastMonth(16, 19, 40),
                    DemoOutcome.Failed, Link, "HAI-SIGHT-2026-LP-003"),
                Gift("prakash.subhash@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, LastMonth(20, 9, 0),
                    DemoOutcome.Failed, Qr, "HAI-ELDERCARE-2026-QR-003"),
                Gift("rajib.supriyo@mail.test", "HAI-MOBILECARE-2026", 3_000m, Wallet, ThisMonth(0.12),
                    DemoOutcome.Failed, Qr, "HAI-MOBILECARE-2026-QR-002"),
                Gift("ramakant.bhushan@mail.test", "HAI-ELDERCARE-2026", 6_000m, Upi, ThisMonth(0.22),
                    DemoOutcome.FailedTwice, Web, "HAI-ELDERCARE-2026-LP-006"),
                Gift("arnab.sukumar@mail.test", "HAI-SIGHT-2026", 2_000m, Upi, ThisMonth(0.35),
                    DemoOutcome.Failed, Link, "HAI-SIGHT-2026-LP-003"),
                Gift("padma.narayanan@mail.test", "HAI-SIGHT-2026", 4_500m, Card, ThisMonth(0.48),
                    DemoOutcome.FailedTwice, Direct),

                // ---- Pending: six more - links that ran out, pages the donor left, one still open ---
                Gift("gurpreet.inderjit@mail.test", "HAI-ELDERCARE-2026", 3_000m, Upi, LastMonth(8, 12, 30),
                    DemoOutcome.Expired, Link, "HAI-ELDERCARE-2026-LP-008"),
                Gift("neelima.shankar@mail.test", "HAI-MOBILECARE-2026", 2_000m, Card, LastMonth(23, 21, 15),
                    DemoOutcome.Cancelled, Social, "HAI-MOBILECARE-2026-LP-004"),
                Gift("sameer.ishwar@mail.test", "HAI-ELDERCARE-2026", 12_000m, NetBanking, ThisMonth(0.08),
                    DemoOutcome.Expired, Web, "HAI-ELDERCARE-2026-LP-006"),
                Gift("moloy.tapan@mail.test", "HAI-SIGHT-2026", 1_500m, Wallet, ThisMonth(0.42),
                    DemoOutcome.Cancelled, Qr, "HAI-SIGHT-2026-QR-002"),
                Gift("nilanjana.amit@mail.test", "HAI-ELDERCARE-2026", 5_000m, Card, ThisMonth(0.80),
                    DemoOutcome.Cancelled, Social, "HAI-ELDERCARE-2026-LP-007"),
                Gift("sharmila.dipankar@mail.test", "HAI-SIGHT-2026", 2_000m, Upi, MinutesAgo(20),
                    DemoOutcome.AwaitingPayment, Link, "HAI-SIGHT-2026-LP-003"),

                // ---- Head office's institutional gifts, by bank transfer -------------------------
                Paid("csr@sahyadricement.test", "HAI-ELDERCARE-2026", 200_000m, NetBanking, LastMonth(4, 15, 40), Direct),
                Paid("kishan.dayal@mail.test", "HAI-ELDERCARE-2026", 100_000m, NetBanking, LastMonth(11, 12, 15), Direct),
                Paid("giving@coromandellogistics.test", "HAI-SIGHT-2026", 150_000m, NetBanking, LastMonth(15, 16, 20), Direct),
                Paid("hemalatha.srinivasan@mail.test", "HAI-ELDERCARE-2026", 50_000m, NetBanking, LastMonth(19, 11, 30), Direct),
                Paid("csr@indusfintech.test", "HAI-MOBILECARE-2026", 120_000m, NetBanking, LastMonth(24, 14, 45), Direct,
                    receipt: DemoReceipt.NotSent),
                Paid("grants@annapurnaseva.test", "HAI-ELDERCARE-2026", 300_000m, NetBanking, ThisMonth(0.18), Direct,
                    receipt: DemoReceipt.Pending),
                Paid("giving@coromandellogistics.test", "HAI-SIGHT-2026", 45_000m, NetBanking, ThisMonth(0.36), Direct),
                Paid("malini.raghavendra@mail.test", "HAI-SIGHT-2026", 72_000m, NetBanking, ThisMonth(0.52), Direct),
                Paid("hemalatha.srinivasan@mail.test", "HAI-ELDERCARE-2026", 50_000m, NetBanking, ThisMonth(0.74), Direct)
            ])
    ];
}
