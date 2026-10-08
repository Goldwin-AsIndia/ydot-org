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
/// FORTY-SIX PAYMENTS PER ORGANISATION, ACROSS LAST MONTH AND THIS ONE, because Payments and
/// Receipts is a work list whose whole shape depends on the mix: its tiles count by outcome, each
/// outcome offers a different action, and the receipt column has five answers of its own. A set
/// that was all successes would exercise one column of it. Each Organisation therefore has:
///
///   Success   37   receipt Sent, Pending, Failed and Not sent all present
///   Pending    5   authorised and waiting, timed out, link expired, cancelled, link re-issued
///   Fail       4   declined card, UPI timeout, empty wallet, and one that failed twice
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
    internal sealed record DemoOrganisation(
        string Subdomain,
        IReadOnlyDictionary<string, string> Campaigns,
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
                    NewDonor: true)
            ],
            Gifts:
            [
                // ---- Last month ------------------------------------------------------------------
                Paid("harish.gopal@mail.test", "SF-EDU-2026", 6_000m, Upi, LastMonth(2, 10, 42), Qr,
                    "SF-EDU-2026-QR-001"),
                Paid("giving@northbridgelogistics.test", "SF-FLOOD-2026", 300_000m, NetBanking,
                    LastMonth(2, 15, 20), Direct),
                Paid("lakshmi.venkatesh@mail.test", "SF-EDU-2026", 12_000m, Card, LastMonth(3, 19, 15), Mail,
                    "SF-EDU-2026-SL-003"),
                Paid("siddharth.dinesh@mail.test", "SF-FLOOD-2026", 5_000m, NetBanking, LastMonth(4, 8, 55), Social,
                    "SF-FLOOD-2026-SL-001"),
                Paid("meera.krishnan@mail.test", "SF-NUTRITION-2026", 2_500m, Upi, LastMonth(5, 13, 20), Qr,
                    "SF-NUTRITION-2026-QR-001"),
                Paid("csr@meridiantextiles.test", "SF-EDU-2026", 250_000m, NetBanking, LastMonth(6, 15, 5), Direct),
                Paid("anand.raghavan@mail.test", "SF-HEALTH-2026", 10_000m, Card, LastMonth(7, 21, 40), Social,
                    "SF-HEALTH-2026-UTM-003"),
                Paid("divya.mahesh@mail.test", "SF-LIVELIHOOD-2026", 3_500m, Wallet, LastMonth(8, 11, 10), Qr,
                    "SF-LIVELIHOOD-2026-QR-001"),
                Paid("rajiv.narayan@mail.test", "SF-MONSOON-2026", 75_000m, NetBanking, LastMonth(9, 9, 30), Qr,
                    "SF-MONSOON-2026-QR-001"),
                Paid("revathi.sundar@mail.test", "SF-LIVELIHOOD-2026", 12_000m, Card, LastMonth(9, 20, 25), Social,
                    "SF-LIVELIHOOD-2026-SL-002"),
                Paid("sunita.prasad@mail.test", "SF-FLOOD-2026", 1_100m, Upi, LastMonth(10, 18, 25), Web,
                    "SF-FLOOD-2026-UTM-002"),
                Paid("nikhil.sanjay@mail.test", "SF-EDU-2026", 25_000m, NetBanking, LastMonth(11, 12, 0), Web,
                    "SF-EDU-2026-UTM-004"),
                Paid("ayesha.karim@mail.test", "SF-LIVELIHOOD-2026", 5_000m, Card, LastMonth(12, 16, 45), Qr,
                    "SF-LIVELIHOOD-2026-QR-001", DemoReceipt.NotSent),
                Paid("nikhil.sanjay@mail.test", "SF-HEALTH-2026", 1_500m, Wallet, LastMonth(13, 20, 5), Mail,
                    "SF-HEALTH-2026-SL-002"),
                Paid("revathi.sundar@mail.test", "SF-NUTRITION-2026", 3_000m, Upi, LastMonth(14, 7, 50), Link,
                    "SF-NUTRITION-2026-SL-002"),
                Paid("harish.gopal@mail.test", "SF-FLOOD-2026", 2_000m, Upi, LastMonth(15, 22, 10), Social,
                    "SF-FLOOD-2026-SL-001"),
                Gift("lakshmi.venkatesh@mail.test", "SF-MONSOON-2026", 4_000m, Card, LastMonth(16, 10, 15),
                    DemoOutcome.Failed, Web),
                Paid("siddharth.dinesh@mail.test", "SF-EDU-2026", 6_000m, Card, LastMonth(17, 14, 35), Social,
                    "SF-EDU-2026-LP-005", onRetry: true),
                Paid("meera.krishnan@mail.test", "SF-HEALTH-2026", 5_000m, NetBanking, LastMonth(18, 9, 5), Mail,
                    "SF-HEALTH-2026-SL-002"),
                Gift("anand.raghavan@mail.test", "SF-MONSOON-2026", 2_000m, Upi, LastMonth(19, 17, 30),
                    DemoOutcome.Expired, Link, "SF-MONSOON-2026-SL-002"),
                Paid("divya.mahesh@mail.test", "SF-EDU-2026", 18_000m, Card, LastMonth(20, 20, 50), Web,
                    "SF-EDU-2026-UTM-007"),
                Paid("rajiv.narayan@mail.test", "SF-NUTRITION-2026", 10_000m, NetBanking, LastMonth(22, 11, 25), Direct),
                Gift("sunita.prasad@mail.test", "SF-EDU-2026", 501m, Upi, LastMonth(23, 8, 15),
                    DemoOutcome.Failed, Qr, "SF-EDU-2026-QR-001"),
                Paid("anand.raghavan@mail.test", "SF-HEALTH-2026", 7_500m, Upi, LastMonth(24, 19, 40), Direct),
                Gift("ayesha.karim@mail.test", "SF-EDU-2026", 6_000m, Wallet, LastMonth(25, 13, 5),
                    DemoOutcome.Cancelled, Social, "SF-EDU-2026-LP-005"),
                Paid("nikhil.sanjay@mail.test", "SF-EDU-2026", 12_000m, Card, LastMonth(26, 21, 15), Mail,
                    "SF-EDU-2026-SL-003", DemoReceipt.Failed),
                Paid("giving@northbridgelogistics.test", "SF-HEALTH-2026", 100_000m, NetBanking,
                    LastMonth(27, 12, 30), Direct, receipt: DemoReceipt.NotSent),
                Paid("revathi.sundar@mail.test", "SF-EDU-2026", 6_000m, Upi, LastMonth(28, 10, 0), Link,
                    "SF-EDU-2026-SL-006"),

                // ---- This month ------------------------------------------------------------------
                Paid("harish.gopal@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.05), Qr,
                    "SF-EDU-2026-QR-001"),
                Paid("lakshmi.venkatesh@mail.test", "SF-NUTRITION-2026", 5_000m, Card, ThisMonth(0.12), Direct),
                Paid("siddharth.dinesh@mail.test", "SF-HEALTH-2026", 3_000m, Wallet, ThisMonth(0.18), Social,
                    "SF-HEALTH-2026-UTM-003"),
                Paid("meera.krishnan@mail.test", "SF-EDU-2026", 15_000m, NetBanking, ThisMonth(0.25), Web,
                    "SF-EDU-2026-UTM-004"),
                Gift("anand.raghavan@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.31),
                    DemoOutcome.FailedTwice, Qr, "SF-EDU-2026-QR-002"),
                Paid("divya.mahesh@mail.test", "SF-HEALTH-2026", 2_500m, Upi, ThisMonth(0.38), Qr,
                    "SF-HEALTH-2026-QR-001"),
                Paid("rajiv.narayan@mail.test", "SF-EDU-2026", 50_000m, NetBanking, ThisMonth(0.44), Direct),
                Paid("sunita.prasad@mail.test", "SF-NUTRITION-2026", 1_000m, Wallet, ThisMonth(0.50), Link,
                    "SF-NUTRITION-2026-SL-002", DemoReceipt.NotSent),
                Paid("ayesha.karim@mail.test", "SF-HEALTH-2026", 4_000m, Upi, ThisMonth(0.63), Social,
                    "SF-HEALTH-2026-UTM-003", DemoReceipt.Failed),
                Gift("nikhil.sanjay@mail.test", "SF-NUTRITION-2026", 2_000m, Upi, ThisMonth(0.70),
                    DemoOutcome.Authorised, Qr, "SF-NUTRITION-2026-QR-001"),
                Paid("revathi.sundar@mail.test", "SF-HEALTH-2026", 3_500m, Card, ThisMonth(0.76), Mail,
                    "SF-HEALTH-2026-SL-002"),
                Paid("csr@meridiantextiles.test", "SF-NUTRITION-2026", 150_000m, NetBanking, ThisMonth(0.82),
                    Direct, receipt: DemoReceipt.Pending),
                Gift("harish.gopal@mail.test", "SF-HEALTH-2026", 2_000m, Wallet, ThisMonth(0.86),
                    DemoOutcome.Failed, Social, "SF-HEALTH-2026-UTM-003"),
                Paid("thomas.mathew@mail.test", "SF-HEALTH-2026", 7_500m, Upi, ThisMonth(0.90), Fundraiser,
                    lead: "thomas.mathew@mail.test"),
                Paid("lakshmi.venkatesh@mail.test", "SF-EDU-2026", 6_000m, Upi, ThisMonth(0.93), Qr,
                    "SF-EDU-2026-QR-002", DemoReceipt.Pending),
                Paid("gautam.vijay@mail.test", "SF-HEALTH-2026", 11_000m, Card, ThisMonth(0.95), Fundraiser,
                    lead: "gautam.vijay@mail.test"),
                Gift("siddharth.dinesh@mail.test", "SF-EDU-2026", 12_000m, Card, MinutesAgo(95),
                    DemoOutcome.TimedOut, Web, "SF-EDU-2026-UTM-004"),
                Gift("meera.krishnan@mail.test", "SF-NUTRITION-2026", 1_500m, Upi, MinutesAgo(40),
                    DemoOutcome.AwaitingPayment, Link, "SF-NUTRITION-2026-SL-002")
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
                    NewDonor: true)
            ],
            Gifts:
            [
                // ---- Last month ------------------------------------------------------------------
                Paid("ajay.sekar@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, LastMonth(1, 11, 5), Qr,
                    "HAI-ELDERCARE-2026-QR-001"),
                Paid("csr@silverlinepharma.test", "HAI-HEATWAVE-2026", 250_000m, NetBanking,
                    LastMonth(2, 14, 40), Direct),
                Paid("ishita.rakesh@mail.test", "HAI-ELDERCARE-2026", 10_000m, Card, LastMonth(3, 20, 10), Mail,
                    "HAI-ELDERCARE-2026-SL-003"),
                Paid("kiran.manoj@mail.test", "HAI-HEATWAVE-2026", 4_000m, NetBanking, LastMonth(4, 9, 35), Social,
                    "HAI-HEATWAVE-2026-SL-001"),
                Paid("geetha.raman@mail.test", "HAI-SIGHT-2026", 4_500m, Upi, LastMonth(5, 12, 50), Qr,
                    "HAI-SIGHT-2026-QR-001"),
                Paid("csr@kaveriagro.test", "HAI-ELDERCARE-2026", 200_000m, NetBanking, LastMonth(6, 16, 15), Direct),
                Paid("joseph.daniel@mail.test", "HAI-MOBILECARE-2026", 9_000m, Card, LastMonth(7, 21, 5), Social,
                    "HAI-MOBILECARE-2026-UTM-003"),
                Paid("padma.narayanan@mail.test", "HAI-DIGITAL-2026", 2_000m, Wallet, LastMonth(8, 10, 30), Qr,
                    "HAI-DIGITAL-2026-QR-001"),
                Paid("farida.yusuf@mail.test", "HAI-PHYSIO-2026", 60_000m, NetBanking, LastMonth(9, 10, 10), Qr,
                    "HAI-PHYSIO-2026-QR-001"),
                Paid("prakash.subhash@mail.test", "HAI-DIGITAL-2026", 8_000m, Card, LastMonth(9, 19, 45), Social,
                    "HAI-DIGITAL-2026-SL-002"),
                Paid("vinod.kishore@mail.test", "HAI-HEATWAVE-2026", 800m, Upi, LastMonth(10, 17, 55), Web,
                    "HAI-HEATWAVE-2026-UTM-002"),
                Paid("sheela.mohan@mail.test", "HAI-ELDERCARE-2026", 20_000m, NetBanking, LastMonth(11, 13, 20), Web,
                    "HAI-ELDERCARE-2026-UTM-004"),
                Paid("anita.jagdish@mail.test", "HAI-DIGITAL-2026", 4_000m, Card, LastMonth(12, 15, 30), Qr,
                    "HAI-DIGITAL-2026-QR-001", DemoReceipt.NotSent),
                Paid("sheela.mohan@mail.test", "HAI-MOBILECARE-2026", 3_000m, Wallet, LastMonth(13, 19, 25), Mail,
                    "HAI-MOBILECARE-2026-SL-002"),
                Paid("prakash.subhash@mail.test", "HAI-SIGHT-2026", 4_500m, Upi, LastMonth(14, 8, 40), Link,
                    "HAI-SIGHT-2026-SL-002"),
                Paid("ajay.sekar@mail.test", "HAI-HEATWAVE-2026", 1_600m, Upi, LastMonth(15, 21, 30), Social,
                    "HAI-HEATWAVE-2026-SL-001"),
                Gift("ishita.rakesh@mail.test", "HAI-PHYSIO-2026", 3_600m, Card, LastMonth(16, 11, 45),
                    DemoOutcome.Failed, Web),
                Paid("kiran.manoj@mail.test", "HAI-ELDERCARE-2026", 5_000m, Card, LastMonth(17, 15, 10), Social,
                    "HAI-ELDERCARE-2026-LP-005", DemoReceipt.Failed, onRetry: true),
                Paid("geetha.raman@mail.test", "HAI-MOBILECARE-2026", 6_000m, NetBanking, LastMonth(18, 10, 25), Mail,
                    "HAI-MOBILECARE-2026-SL-002"),
                Gift("joseph.daniel@mail.test", "HAI-PHYSIO-2026", 1_800m, Upi, LastMonth(19, 18, 5),
                    DemoOutcome.Expired, Link, "HAI-PHYSIO-2026-SL-002"),
                Paid("padma.narayanan@mail.test", "HAI-ELDERCARE-2026", 15_000m, Card, LastMonth(20, 20, 20), Web,
                    "HAI-ELDERCARE-2026-UTM-007"),
                Paid("farida.yusuf@mail.test", "HAI-SIGHT-2026", 9_000m, NetBanking, LastMonth(22, 12, 5), Direct),
                Gift("vinod.kishore@mail.test", "HAI-ELDERCARE-2026", 501m, Upi, LastMonth(23, 9, 10),
                    DemoOutcome.Failed, Qr, "HAI-ELDERCARE-2026-QR-001"),
                Paid("joseph.daniel@mail.test", "HAI-MOBILECARE-2026", 6_000m, Upi, LastMonth(24, 20, 15), Direct),
                Gift("anita.jagdish@mail.test", "HAI-ELDERCARE-2026", 5_000m, Wallet, LastMonth(25, 14, 0),
                    DemoOutcome.Cancelled, Social, "HAI-ELDERCARE-2026-LP-005"),
                Paid("sheela.mohan@mail.test", "HAI-ELDERCARE-2026", 10_000m, Card, LastMonth(26, 22, 5), Mail,
                    "HAI-ELDERCARE-2026-SL-003", DemoReceipt.Failed),
                Paid("csr@silverlinepharma.test", "HAI-MOBILECARE-2026", 120_000m, NetBanking,
                    LastMonth(27, 11, 50), Direct, receipt: DemoReceipt.NotSent),
                Paid("prakash.subhash@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, LastMonth(28, 9, 45), Link,
                    "HAI-ELDERCARE-2026-SL-006"),

                // ---- This month ------------------------------------------------------------------
                Paid("ajay.sekar@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.06), Qr,
                    "HAI-ELDERCARE-2026-QR-001"),
                Paid("ishita.rakesh@mail.test", "HAI-SIGHT-2026", 4_500m, Card, ThisMonth(0.13), Direct),
                Paid("kiran.manoj@mail.test", "HAI-MOBILECARE-2026", 3_000m, Wallet, ThisMonth(0.19), Social,
                    "HAI-MOBILECARE-2026-UTM-003"),
                Paid("geetha.raman@mail.test", "HAI-ELDERCARE-2026", 12_000m, NetBanking, ThisMonth(0.26), Web,
                    "HAI-ELDERCARE-2026-UTM-004"),
                Gift("joseph.daniel@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.32),
                    DemoOutcome.FailedTwice, Qr, "HAI-ELDERCARE-2026-QR-002"),
                Paid("padma.narayanan@mail.test", "HAI-MOBILECARE-2026", 3_000m, Upi, ThisMonth(0.39), Qr,
                    "HAI-MOBILECARE-2026-QR-001"),
                Paid("farida.yusuf@mail.test", "HAI-ELDERCARE-2026", 75_000m, NetBanking, ThisMonth(0.45), Direct),
                Paid("vinod.kishore@mail.test", "HAI-SIGHT-2026", 1_000m, Wallet, ThisMonth(0.51), Link,
                    "HAI-SIGHT-2026-SL-002", DemoReceipt.NotSent),
                Paid("anita.jagdish@mail.test", "HAI-MOBILECARE-2026", 3_000m, Upi, ThisMonth(0.64), Social,
                    "HAI-MOBILECARE-2026-UTM-003"),
                Gift("sheela.mohan@mail.test", "HAI-SIGHT-2026", 2_000m, Upi, ThisMonth(0.71),
                    DemoOutcome.Authorised, Qr, "HAI-SIGHT-2026-QR-001"),
                Paid("prakash.subhash@mail.test", "HAI-MOBILECARE-2026", 3_500m, Card, ThisMonth(0.77), Mail,
                    "HAI-MOBILECARE-2026-SL-002"),
                Paid("csr@kaveriagro.test", "HAI-SIGHT-2026", 150_000m, NetBanking, ThisMonth(0.83),
                    Direct, receipt: DemoReceipt.Pending),
                Gift("ajay.sekar@mail.test", "HAI-MOBILECARE-2026", 2_000m, Wallet, ThisMonth(0.87),
                    DemoOutcome.Failed, Social, "HAI-MOBILECARE-2026-UTM-003"),
                Paid("ramesh.chandran@mail.test", "HAI-MOBILECARE-2026", 6_000m, Upi, ThisMonth(0.90), Fundraiser,
                    lead: "ramesh.chandran@mail.test"),
                Paid("geetha.raman@mail.test", "HAI-ELDERCARE-2026", 5_000m, Upi, ThisMonth(0.93), Qr,
                    "HAI-ELDERCARE-2026-QR-002", DemoReceipt.Pending),
                Paid("santosh.vinay@mail.test", "HAI-MOBILECARE-2026", 21_000m, Card, ThisMonth(0.95), Fundraiser,
                    lead: "santosh.vinay@mail.test"),
                Gift("ishita.rakesh@mail.test", "HAI-ELDERCARE-2026", 10_000m, Card, MinutesAgo(95),
                    DemoOutcome.TimedOut, Web, "HAI-ELDERCARE-2026-UTM-004"),
                Gift("kiran.manoj@mail.test", "HAI-SIGHT-2026", 4_500m, Upi, MinutesAgo(40),
                    DemoOutcome.AwaitingPayment, Link, "HAI-SIGHT-2026-SL-002")
            ])
    ];
}
