namespace YDot.IAM.Application.Common.Constants;

/// <summary>
/// The role codes the seeder creates. Tenant roles are created once per Organisation, so the
/// same code exists in every Organisation as a genuinely separate row.
///
/// EIGHT ROLES, SHAPED AROUND THE TEAMS AN NGO ACTUALLY HAS:
///
///   SUPER_ADMIN           Platform Admin        the platform, across every Organisation
///   TENANT_ADMIN          Organisation Admin    everything, inside one Organisation
///   CAMPAIGN_EXECUTIVE    Campaign Executive    prepares and requests campaigns
///   CAMPAIGN_MANAGER      Campaign Manager      decides campaigns
///   FUNDRAISER_EXECUTIVE  Fundraiser Executive  captures and works donors and leads
///   FUNDRAISING_MANAGER   Fundraising Manager   decides donors and leads, and works them
///   DONOR                 Donor                 not staff: their OWN giving, and nothing else
///   DONOR_CARE            DonorCare             supporter care: their own leads, donors and follow-ups
///
/// THE WORKING ROLES ARE COMPUTED FROM ACTIONS - see <see cref="RoleAccessProfiles"/> - and each
/// is confined to its own module: an Executive holds the requests (create, submit, pass, fail), a
/// Manager holds the decisions (approve, reject, pause, resume, close).
///
/// ROLES COMBINE AS A UNION, WITH NO CONFLICT BETWEEN THEM. A person given both the Executive and
/// the Manager role of a module holds both halves, and may raise a request and approve that same
/// request: CAM and DON test the permission, never who created or submitted the record. The
/// Organisation Admin holds everything regardless.
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
    /// The campaign decision-maker: approving, rejecting, pausing, resuming and closing campaigns
    /// and deciding tracking assets and budgets. Holds none of the Executive's requests; somebody
    /// who also holds Campaign Executive can request and decide alike.
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
    /// The supporter-care team: My Leads, My Donor List and the Follow-up Queue, holding only the
    /// records assigned to the person. See RoleAccessProfiles.DonorCare.
    /// </summary>
    public const string DonorCare = "DONOR_CARE";

    /// <summary>Every role the seeder creates inside a new Organisation.</summary>
    public static readonly IReadOnlyList<string> TenantRoles =
    [
        TenantAdmin, CampaignExecutive, CampaignManager, FundraiserExecutive, FundraisingManager,
        Donor, DonorCare
    ];
}
