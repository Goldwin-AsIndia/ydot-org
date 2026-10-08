namespace YDot.IAM.Application.Common.Constants;

/// <summary>
/// The role codes the seeder creates. Tenant roles are created once per Organisation, so the
/// same code exists in every Organisation as a genuinely separate row.
///
/// EIGHT ROLES, SHAPED AROUND THE TEAMS AN NGO ACTUALLY HAS:
///
///   SUPER_ADMIN           Platform Admin        the platform, across every Organisation
///   TENANT_ADMIN          Organisation Admin    everything, inside one Organisation
///   CAMPAIGN_EXECUTIVE    Campaign Executive    prepares campaigns - and approves none of them
///   CAMPAIGN_MANAGER      Campaign Manager      prepares AND decides campaigns
///   FUNDRAISER_EXECUTIVE  Fundraiser Executive  works donors and leads - and approves nothing
///   FUNDRAISING_MANAGER   Fundraising Manager   works AND decides donors and leads
///   DONOR                 Donor                 not staff: their OWN giving, and nothing else
///   DONOR_CARE            DonorCare             supporter care; its screens are mapped later
///
/// THE MAKER-CHECKER RULES DID NOT GO AWAY WITH INITIATOR AND APPROVER. The working roles are
/// still computed from the same action rules - see <see cref="RoleAccessProfiles"/> - only now
/// each is confined to its own module. An Executive is the maker for that module; a Manager is
/// maker and checker together, and the four-eyes rule is enforced on the RECORD instead: CAM
/// refuses to let anybody approve a campaign they created or submitted, whatever roles they hold.
///
/// DONOR IS NOT ON THE STAFF LADDER AT ALL. The staff roles differ by how much AUTHORITY they
/// carry over the Organisation's records; DONOR differs by WHOSE records it can reach, and the
/// answer is only its own. A donor scoped to their own giving is a member of the public with a
/// login.
/// </summary>
public static class RoleCodes
{
    /// <summary>
    /// The platform root role, shown as "Platform Admin". Exists once, with TenantId null, and
    /// only platform administrators hold it. It is never copied into an Organisation.
    /// </summary>
    public const string SuperAdmin = "SUPER_ADMIN";

    /// <summary>
    /// The administrator of one Organisation, shown as "Organisation Admin". Seeded into every
    /// Tenant with GrantsAllTenantPermissions set, so a new module does not require every
    /// customer to re-map their administrator.
    /// </summary>
    public const string TenantAdmin = "TENANT_ADMIN";

    /// <summary>
    /// The campaign maker: creates, edits and submits campaigns, tracking assets, readiness
    /// checks and budget plans, and requests closure. Approves nothing - everything raised here
    /// waits for a Campaign Manager or the Organisation Admin.
    /// </summary>
    public const string CampaignExecutive = "CAMPAIGN_EXECUTIVE";

    /// <summary>
    /// The campaign owner: everything a Campaign Executive does, plus approving, pausing,
    /// resuming and closing campaigns and deciding tracking assets and budgets. Never on a record
    /// they created or submitted - CAM refuses that on the record itself.
    /// </summary>
    public const string CampaignManager = "CAMPAIGN_MANAGER";

    /// <summary>
    /// The donor and lead maker: captures, qualifies, contacts and follows up leads and donors.
    /// Approves nothing.
    /// </summary>
    public const string FundraiserExecutive = "FUNDRAISER_EXECUTIVE";

    /// <summary>
    /// The fundraising team lead: everything a Fundraiser Executive does, plus approving donor
    /// records and the decisions on duplicates and identity verification.
    /// </summary>
    public const string FundraisingManager = "FUNDRAISING_MANAGER";

    /// <summary>
    /// The person who gives. Not staff, and the distinction is the point of the role.
    ///
    /// WHY IT HAD TO EXIST. A donation by a lead or a stranger converts them to a Donor and
    /// creates them an account, and that account must not fall through to the Organisation's
    /// DEFAULT role - which is a staff role. CreateUserCommand picks this one from the account
    /// CATEGORY instead, which is the fact that actually distinguishes a donor from staff.
    ///
    /// WHAT IT HOLDS: view and pay their own donations, view and re-send their own receipts, and
    /// nothing else. It is defined by an explicit list rather than computed from the permission
    /// actions, because its boundary is not a verb - see <see cref="RoleAccessProfiles.Donor"/>.
    ///
    /// THE PERMISSIONS ARE HALF THE ANSWER. They say WHICH screens; the donor data scope in PAY
    /// says WHOSE rows, and without it this role would show one donor every other donor's giving.
    /// </summary>
    public const string Donor = "DONOR";

    /// <summary>
    /// The supporter-care team. Created, active and assignable, with NO screens yet: its menus
    /// and the permissions behind them are to be mapped later, so a member signs in to the
    /// dashboard and My Security and nothing else until that decision is made.
    /// </summary>
    public const string DonorCare = "DONOR_CARE";

    /// <summary>Every role the seeder creates inside a new Organisation.</summary>
    public static readonly IReadOnlyList<string> TenantRoles =
    [
        TenantAdmin, CampaignExecutive, CampaignManager, FundraiserExecutive, FundraisingManager,
        Donor, DonorCare
    ];
}
