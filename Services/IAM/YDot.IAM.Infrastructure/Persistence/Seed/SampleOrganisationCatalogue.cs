using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Infrastructure.Persistence.Seed;

/// <summary>
/// The demonstration data the seeder writes: the platform's named administrators, and the
/// Organisations with their profiles, departments, branches and people.
///
/// DATA, KEPT APART FROM THE SEEDER'S LOGIC. <see cref="IamDbSeeder"/> decides HOW a row is
/// written - idempotently, in dependency order, with filters bypassed - and this file says WHAT
/// is written. Changing a name, adding a branch or moving somebody to another team is an edit
/// here and nowhere else.
///
/// FOUR ORGANISATIONS, IN TWO STATES:
///
///   Smile Foundation           ACTIVE    full profile, structure, nine staff and twelve donors
///   HelpAge India              ACTIVE    full profile, structure, nine staff and twelve donors
///   Global Relief Foundation   INVITED   profile and an administrator holding a pending invitation
///   Unity for Change           INVITED   profile and an administrator holding a pending invitation
///
/// AN INVITED ORGANISATION HAS NO STAFF. Until its administrator accepts the invitation and the
/// platform approves the registration, nobody but that administrator may hold a session in it -
/// see <c>Tenant.PermitsSession</c> - so seeding a team into one would create accounts that
/// cannot sign in.
///
/// THE ADDRESSES ARE REAL FOR THE TWO REAL CHARITIES AND EVERYTHING ELSE IS INVENTED. Smile
/// Foundation and HelpAge India are named with their registered offices, public websites and
/// founding years. Every person is fictional, the founding day and month are representative, and
/// every registration number, PAN, TAN and GSTIN is a synthetic value in the correct format - not
/// the organisation's own.
///
/// NO NAME CARRIES A CASTE OR COMMUNITY MARKER, and that is a rule rather than a coincidence. No
/// surname that announces a caste is used anywhere in this file: every surname is a common given
/// name used the way a patronymic is - Anjali Prakash, Rohan Suresh - which is how many Indians
/// write their names precisely to avoid one. Keep to it when adding a person: the names surface
/// in usernames, e-mail addresses, the user directory and every audit row.
///
/// EVERY E-MAIL ADDRESS IS ON THE RESERVED .test DOMAIN (RFC 2606), so no message this
/// environment sends - an invitation, a reset link, a receipt - can ever reach a real inbox,
/// whatever mail relay it is pointed at. Point IAM_MAIL_REDIRECT_TO at a mailbox you own to
/// watch them arrive.
/// </summary>
internal static class SampleOrganisationCatalogue
{
    /// <summary>One Organisation, with everything the seeder needs to create it.</summary>
    internal sealed record SampleOrganisation(
        string Name,
        string LegalName,
        string Subdomain,
        TenantStatus Status,
        bool UsesConfiguredId,
        string OrganisationType,
        string Description,
        string WebsiteUrl,
        string RegistrationNumber,
        string TaxIdentificationNumber,
        string PanNumber,
        string? GstNumber,
        DateTimeOffset EstablishedOn,
        SampleAddress Address,
        int MaximumUsers,
        SamplePerson Administrator,
        IReadOnlyList<SampleDepartment> Departments,
        IReadOnlyList<SampleUnit> Units,
        IReadOnlyList<SamplePerson> Staff)
    {
        public bool IsActive => Status == TenantStatus.Active;
    }

    internal sealed record SampleAddress(
        string Line1, string? Line2, string City, string State, string PostalCode,
        string Country = "India");

    internal sealed record SampleDepartment(
        string Code, string Name, string Description, int Order, string? HeadUsername = null);

    internal sealed record SampleUnit(
        string Code, string Name, string UnitType, SampleAddress Address, string ContactEmail,
        int Order);

    /// <summary>
    /// One person. <see cref="Mobile"/> is the ten subscriber digits; every number here is Indian,
    /// so the country code is always +91.
    /// </summary>
    internal sealed record SamplePerson(
        string RoleCode,
        string FirstName,
        string LastName,
        string Username,
        string Email,
        string Mobile,
        string? Designation = null,
        string? EmployeeNumber = null,
        string? DepartmentCode = null,
        string? UnitCode = null,
        string? ManagerUsername = null,
        DateTimeOffset? JoinedOn = null,
        UserAccountCategory Category = UserAccountCategory.Employee,
        EngagementType Engagement = EngagementType.FullTime)
    {
        public string DisplayName => $"{FirstName} {LastName}";
    }

    // THE PLATFORM ADMIN IS NOT LISTED HERE. There is one, and SeedSettings describes it - Vikram
    // Anand in every configuration this repository ships. It used to be a system account
    // ("superadmin") with Vikram listed here as a second, named administrator.

    internal static readonly IReadOnlyList<SampleOrganisation> Organisations =
    [
        // ============ SMILE FOUNDATION - ACTIVE =============================================
        //
        // TAKES THE CONFIGURED ID, and is the only one that does, so its id is the same in every
        // database. CAM, DON and PAY do not depend on it: their demonstration data finds this
        // Organisation and HelpAge India by SUBDOMAIN, so the two subdomains below are what those
        // three catalogues are keyed on. Rename one here and its campaigns, donors and donations
        // are seeded into nobody.
        new(
            Name: "Smile Foundation",
            LegalName: "Smile Foundation",
            Subdomain: "smilefoundation",
            Status: TenantStatus.Active,
            UsesConfiguredId: true,
            OrganisationType: "Non-profit / NGO",
            Description:
                "A national development organisation working for the education, healthcare and "
                + "livelihood of underprivileged children, their families and communities across "
                + "India.",
            WebsiteUrl: "https://www.smilefoundationindia.org",
            RegistrationNumber: "DL-TR-2002-004417",
            TaxIdentificationNumber: "DELS27145C",
            PanNumber: "AAATS4392K",
            GstNumber: "07AAATS4392K1Z5",
            EstablishedOn: On(2002, 2, 4),
            Address: new("161 B/4, 3rd Floor, Gulmohar House", "Yusuf Sarai Community Centre",
                "New Delhi", "Delhi", "110049"),
            MaximumUsers: 50,
            Administrator: new(RoleCodes.TenantAdmin, "Anjali", "Prakash", "anjali.prakash",
                "anjali.prakash@smilefoundationindia.test", "9810452307",
                "Head - Operations and Administration", "SF-1004", "ADM", "HO",
                JoinedOn: On(2014, 6, 16)),
            Departments:
            [
                new("ADM", "Administration and Operations",
                    "Office administration, compliance, vendors and platform administration.",
                    10, "anjali.prakash"),
                new("CAM", "Campaigns and Communications",
                    "Fundraising campaigns, digital media, events and brand communication.",
                    20, "rohan.suresh"),
                new("IG", "Individual Giving",
                    "Donor acquisition, lead management and supporter relationships.",
                    30, "kavita.ashok"),
                new("DC", "Donor Care",
                    "Supporter queries, receipts, 80G certificates and contact preferences.",
                    40, "neha.rajesh"),
                new("PROG", "Programmes",
                    "Education, healthcare, livelihood and women's empowerment programmes.", 50),
                new("FIN", "Finance and Accounts",
                    "Receipting, reconciliation, statutory filings and audit.", 60),
                new("HR", "Human Resources",
                    "Recruitment, onboarding, payroll and staff welfare.", 70),
                new("IT", "Technology",
                    "Systems, data protection and information security.", 80)
            ],
            Units:
            [
                new("HO", "Head Office - New Delhi", "Head Office",
                    new("161 B/4, 3rd Floor, Gulmohar House", "Yusuf Sarai Community Centre",
                        "New Delhi", "Delhi", "110049"),
                    "headoffice@smilefoundationindia.test", 10),
                new("MUM", "Mumbai Regional Office", "Regional Office",
                    new("2nd Floor, Shree Ganesh Chambers", "Andheri-Kurla Road, Andheri (East)",
                        "Mumbai", "Maharashtra", "400093"),
                    "mumbai@smilefoundationindia.test", 20),
                new("BLR", "Bengaluru Regional Office", "Regional Office",
                    new("No. 42, 1st Cross", "Indiranagar 2nd Stage",
                        "Bengaluru", "Karnataka", "560038"),
                    "bengaluru@smilefoundationindia.test", 30),
                new("HYD", "Hyderabad Regional Office", "Regional Office",
                    new("6-3-1090, Raj Bhavan Road", "Somajiguda",
                        "Hyderabad", "Telangana", "500082"),
                    "hyderabad@smilefoundationindia.test", 40),
                new("KOL", "Kolkata Regional Office", "Regional Office",
                    new("DN-24, Sector V", "Salt Lake City",
                        "Kolkata", "West Bengal", "700091"),
                    "kolkata@smilefoundationindia.test", 50),
                new("CHN", "Chennai Regional Office", "Regional Office",
                    new("No. 14, Venkatnarayana Road", "T. Nagar",
                        "Chennai", "Tamil Nadu", "600017"),
                    "chennai@smilefoundationindia.test", 60)
            ],
            Staff:
            [
                new(RoleCodes.CampaignManager, "Rohan", "Suresh", "rohan.suresh",
                    "rohan.suresh@smilefoundationindia.test", "9811736420", "Campaign Manager",
                    "SF-1021", "CAM", "HO", "anjali.prakash", On(2017, 4, 3)),
                new(RoleCodes.CampaignExecutive, "Sneha", "Ramesh", "sneha.ramesh",
                    "sneha.ramesh@smilefoundationindia.test", "9873015642", "Campaign Executive",
                    "SF-1058", "CAM", "HO", "rohan.suresh", On(2021, 8, 2)),
                new(RoleCodes.CampaignExecutive, "Arjun", "Mohan", "arjun.mohan",
                    "arjun.mohan@smilefoundationindia.test", "9886420731",
                    "Campaign Executive - Digital", "SF-1063", "CAM", "BLR", "rohan.suresh",
                    On(2022, 1, 10)),
                new(RoleCodes.FundraisingManager, "Kavita", "Ashok", "kavita.ashok",
                    "kavita.ashok@smilefoundationindia.test", "9818264053", "Fundraising Manager",
                    "SF-1017", "IG", "HO", "anjali.prakash", On(2016, 9, 12)),
                new(RoleCodes.FundraiserExecutive, "Manish", "Vinod", "manish.vinod",
                    "manish.vinod@smilefoundationindia.test", "9820637145", "Fundraiser Executive",
                    "SF-1072", "IG", "MUM", "kavita.ashok", On(2022, 7, 18)),
                new(RoleCodes.FundraiserExecutive, "Pooja", "Srinivas", "pooja.srinivas",
                    "pooja.srinivas@smilefoundationindia.test", "9849071526", "Fundraiser Executive",
                    "SF-1079", "IG", "HYD", "kavita.ashok", On(2023, 2, 6)),
                new(RoleCodes.DonorCare, "Neha", "Rajesh", "neha.rajesh",
                    "neha.rajesh@smilefoundationindia.test", "9871530264", "Donor Care Lead",
                    "SF-1033", "DC", "HO", "anjali.prakash", On(2018, 11, 5)),
                new(RoleCodes.DonorCare, "Farhan", "Rashid", "farhan.rashid",
                    "farhan.rashid@smilefoundationindia.test", "9716482035",
                    "Donor Care Associate", "SF-1084", "DC", "HO", "neha.rajesh", On(2023, 9, 4)),
                Donor("Harish", "Gopal", "9847012365"),
                Donor("Lakshmi", "Venkatesh", "9840275136"),
                Donor("Siddharth", "Dinesh", "9830164572"),

                // TWELVE DONORS, NOT THREE, because the demonstration donations in PAY are spread
                // across them: each of these signs in to the donor portal and sees their own gifts
                // and receipts, matched on this e-mail address. DON's sample donors and PAY's
                // sample donations name the same twelve addresses - add a donor here and nowhere
                // else and they simply have an empty portal.
                Donor("Meera", "Krishnan", "9845163027"),
                Donor("Anand", "Raghavan", "9841052736"),
                Donor("Divya", "Mahesh", "9820471356"),
                Donor("Rajiv", "Narayan", "9810364527"),
                Donor("Sunita", "Prasad", "9839027415"),
                Donor("Thomas", "Mathew", "9847260318"),
                Donor("Ayesha", "Karim", "9849315072"),
                Donor("Nikhil", "Sanjay", "9822640715"),
                Donor("Revathi", "Sundar", "9843107526")
            ]),

        // ============ HELPAGE INDIA - ACTIVE ================================================
        new(
            Name: "HelpAge India",
            LegalName: "HelpAge India",
            Subdomain: "helpageindia",
            Status: TenantStatus.Active,
            UsesConfiguredId: false,
            OrganisationType: "Social welfare organisation",
            Description:
                "A national organisation working for the cause and care of disadvantaged older "
                + "persons through healthcare, livelihood, elder-rights advocacy and disaster "
                + "response.",
            WebsiteUrl: "https://www.helpageindia.org",
            RegistrationNumber: "S-9283 of 1978",
            TaxIdentificationNumber: "DELH08311B",
            PanNumber: "AAAAH2716M",
            GstNumber: "07AAAAH2716M1ZT",
            EstablishedOn: On(1978, 4, 17),
            Address: new("C-14, Qutab Institutional Area", null, "New Delhi", "Delhi", "110016"),
            MaximumUsers: 50,
            Administrator: new(RoleCodes.TenantAdmin, "Arvind", "Murali", "arvind.murali",
                "arvind.murali@helpageindia.test", "9811027439",
                "Director - Administration and IT", "HAI-2009", "ADM", "HO",
                JoinedOn: On(2012, 3, 19)),
            Departments:
            [
                new("ADM", "Administration and IT",
                    "Office administration, information technology and platform administration.",
                    10, "arvind.murali"),
                new("CAM", "Campaigns and Communications",
                    "Appeals, media campaigns, events and public communication.",
                    20, "priyanka.naveen"),
                new("RM", "Resource Mobilisation",
                    "Individual giving, lead generation and supporter relationships.",
                    30, "vivek.sridhar"),
                new("DS", "Donor Services",
                    "Supporter queries, receipts, tax certificates and preferences.",
                    40, "shalini.balaji"),
                new("PROG", "Elder Care Programmes",
                    "Mobile healthcare units, elder self-help groups, cataract care and helplines.",
                    50),
                new("FIN", "Finance",
                    "Receipting, reconciliation, budgeting and statutory compliance.", 60),
                new("HR", "Human Resources",
                    "Recruitment, learning and development, and staff welfare.", 70)
            ],
            Units:
            [
                new("HO", "Head Office - New Delhi", "Head Office",
                    new("C-14, Qutab Institutional Area", null, "New Delhi", "Delhi", "110016"),
                    "headoffice@helpageindia.test", 10),
                new("MUM", "Mumbai State Office", "State Office",
                    new("3rd Floor, Laxmi Commercial Premises", "Dadar (West)",
                        "Mumbai", "Maharashtra", "400028"),
                    "mumbai@helpageindia.test", 20),
                new("CHN", "Chennai State Office", "State Office",
                    new("No. 7, Halls Road", "Egmore", "Chennai", "Tamil Nadu", "600008"),
                    "chennai@helpageindia.test", 30),
                new("KOL", "Kolkata State Office", "State Office",
                    new("12, Ballygunge Circular Road", "Ballygunge",
                        "Kolkata", "West Bengal", "700019"),
                    "kolkata@helpageindia.test", 40),
                new("BLR", "Bengaluru State Office", "State Office",
                    new("No. 18, 2nd Main Road", "Jayanagar 4th Block",
                        "Bengaluru", "Karnataka", "560011"),
                    "bengaluru@helpageindia.test", 50),
                new("LKO", "Lucknow State Office", "State Office",
                    new("B-41, Sector C", "Aliganj", "Lucknow", "Uttar Pradesh", "226024"),
                    "lucknow@helpageindia.test", 60)
            ],
            Staff:
            [
                new(RoleCodes.CampaignManager, "Priyanka", "Naveen", "priyanka.naveen",
                    "priyanka.naveen@helpageindia.test", "9899341672", "Campaign Manager",
                    "HAI-2034", "CAM", "HO", "arvind.murali", On(2016, 7, 11)),
                new(RoleCodes.CampaignExecutive, "Aditya", "Ganesh", "aditya.ganesh",
                    "aditya.ganesh@helpageindia.test", "9822513064", "Campaign Executive",
                    "HAI-2071", "CAM", "MUM", "priyanka.naveen", On(2021, 5, 17)),
                new(RoleCodes.CampaignExecutive, "Ritu", "Anil", "ritu.anil",
                    "ritu.anil@helpageindia.test", "9958207413",
                    "Campaign Executive - Digital", "HAI-2078", "CAM", "HO", "priyanka.naveen",
                    On(2022, 3, 7)),
                new(RoleCodes.FundraisingManager, "Vivek", "Sridhar", "vivek.sridhar",
                    "vivek.sridhar@helpageindia.test", "9810673258", "Fundraising Manager",
                    "HAI-2026", "RM", "HO", "arvind.murali", On(2015, 1, 5)),
                new(RoleCodes.FundraiserExecutive, "Nisha", "Karthik", "nisha.karthik",
                    "nisha.karthik@helpageindia.test", "9845370126", "Fundraiser Executive",
                    "HAI-2083", "RM", "BLR", "vivek.sridhar", On(2022, 10, 3)),
                new(RoleCodes.FundraiserExecutive, "Gaurav", "Deepak", "gaurav.deepak",
                    "gaurav.deepak@helpageindia.test", "9839415207", "Fundraiser Executive",
                    "HAI-2088", "RM", "LKO", "vivek.sridhar", On(2023, 6, 12)),
                new(RoleCodes.DonorCare, "Shalini", "Balaji", "shalini.balaji",
                    "shalini.balaji@helpageindia.test", "9873462051", "Donor Services Lead",
                    "HAI-2045", "DS", "HO", "arvind.murali", On(2018, 2, 19)),
                new(RoleCodes.DonorCare, "Imran", "Iqbal", "imran.iqbal",
                    "imran.iqbal@helpageindia.test", "9831207564", "Donor Services Executive",
                    "HAI-2091", "DS", "KOL", "shalini.balaji", On(2024, 1, 15)),
                Donor("Ajay", "Sekar", "9884031275"),
                Donor("Ishita", "Rakesh", "9836527014"),
                Donor("Kiran", "Manoj", "9815246307"),

                // Twelve here as well, for the reason given on Smile Foundation's list above.
                Donor("Geetha", "Raman", "9840731625"),
                Donor("Joseph", "Daniel", "9846215703"),
                Donor("Padma", "Narayanan", "9886402517"),
                Donor("Farida", "Yusuf", "9820315647"),
                Donor("Vinod", "Kishore", "9811640275"),
                Donor("Anita", "Jagdish", "9830427165"),
                Donor("Ramesh", "Chandran", "9847530216"),
                Donor("Sheela", "Mohan", "9849260731"),
                Donor("Prakash", "Subhash", "9822071346")
            ]),

        // ============ GLOBAL RELIEF FOUNDATION - INVITED ====================================
        new(
            Name: "Global Relief Foundation",
            LegalName: "Global Relief Foundation Trust",
            Subdomain: "globalrelief",
            Status: TenantStatus.Invited,
            UsesConfiguredId: false,
            OrganisationType: "International organisation",
            Description:
                "A humanitarian relief organisation providing emergency food, shelter and medical "
                + "aid to communities affected by floods, cyclones and other disasters.",
            WebsiteUrl: "https://www.globalrelieffoundation.in",
            RegistrationNumber: "E-28541 (Mumbai)",
            TaxIdentificationNumber: "MUMG14522D",
            PanNumber: "AAATG6158R",
            GstNumber: null,
            EstablishedOn: On(2011, 9, 26),
            Address: new("Unit 402, Sai Krupa Business Centre", "Andheri-Kurla Road, Andheri (East)",
                "Mumbai", "Maharashtra", "400069"),
            MaximumUsers: 25,
            Administrator: new(RoleCodes.TenantAdmin, "Farah", "Naseem", "farah.naseem",
                "farah.naseem@globalrelieffoundation.test", "9820417356", "Executive Director"),
            Departments: [],
            Units: [],
            Staff: []),

        // ============ UNITY FOR CHANGE - INVITED ============================================
        new(
            Name: "Unity for Change",
            LegalName: "Unity for Change Society",
            Subdomain: "unityforchange",
            Status: TenantStatus.Invited,
            UsesConfiguredId: false,
            OrganisationType: "Community organisation",
            Description:
                "A community-led organisation working on girls' education, women's self-help "
                + "groups and civic participation across urban and peri-urban Pune.",
            WebsiteUrl: "https://www.unityforchange.in",
            RegistrationNumber: "MAH/1187/2016/Pune",
            TaxIdentificationNumber: "PNEU09876K",
            PanNumber: "AAAAU3842C",
            GstNumber: null,
            EstablishedOn: On(2016, 8, 1),
            Address: new("21, Prabhat Road", "Erandwane", "Pune", "Maharashtra", "411004"),
            MaximumUsers: 25,
            Administrator: new(RoleCodes.TenantAdmin, "Rahul", "Mukund", "rahul.mukund",
                "rahul.mukund@unityforchange.test", "9922087514",
                "Founder and Programme Director"),
            Departments: [],
            Units: [],
            Staff: [])
    ];

    /// <summary>
    /// A member of the public with a donor-portal login: no department, no branch, no employee
    /// number and no manager, because none of those mean anything for somebody who gives.
    /// </summary>
    private static SamplePerson Donor(string firstName, string lastName, string mobile)
    {
        var username = $"{firstName}.{lastName}".ToLowerInvariant();

        return new SamplePerson(
            RoleCodes.Donor, firstName, lastName, username, $"{username}@mail.test", mobile,
            Category: UserAccountCategory.DonorPortal,
            Engagement: EngagementType.External);
    }

    private static DateTimeOffset On(int year, int month, int day) =>
        new(year, month, day, 0, 0, 0, TimeSpan.Zero);
}
