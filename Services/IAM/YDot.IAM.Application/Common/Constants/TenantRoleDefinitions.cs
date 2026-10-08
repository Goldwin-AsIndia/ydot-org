namespace YDot.IAM.Application.Common.Constants;

/// <summary>
/// The roles the seeder creates inside every Organisation, what each one holds, and which part of
/// the navigation each one is mapped to.
///
/// SEVEN ROLES, SHAPED AROUND THE TEAMS AN NGO ACTUALLY HAS:
///
///   TENANT_ADMIN          Organisation Admin    everything, inside one Organisation
///   CAMPAIGN_EXECUTIVE    Campaign Executive    the campaign maker
///   CAMPAIGN_MANAGER      Campaign Manager      the campaign maker and checker
///   FUNDRAISER_EXECUTIVE  Fundraiser Executive  the donor and lead maker
///   FUNDRAISING_MANAGER   Fundraising Manager   the donor and lead maker and checker
///   DONOR                 Donor                 a member of the public, their own giving only
///   DONOR_CARE            DonorCare             supporter care, screens to be mapped later
///
/// WHAT REPLACED INITIATOR AND APPROVER. Those two were authority without a department: a maker
/// across every module and a checker across every module. The working roles above keep exactly
/// the same maker and checker rules - <see cref="RoleAccessProfiles"/> still computes them from
/// the permission actions - and confine each to the module its team works in.
///
/// THE PLATFORM ROLE, SUPER_ADMIN ("Platform Admin"), IS NOT HERE. It is a platform role with a
/// null TenantId, seeded once by <c>SeedPlatformRoleAsync</c>, and it is never copied into an
/// Organisation.
/// </summary>
public static class TenantRoleDefinitions
{
    /// <summary>
    /// One role, as the seeder needs it.
    ///
    /// <paramref name="GrantsAll"/> is the alternative to enumerating grants: a role carrying it
    /// holds every Tenant permission that exists, now and in future, with no RolePermission rows
    /// at all. It is how TENANT_ADMIN avoids needing re-mapping in every customer database each
    /// time a module ships a permission.
    ///
    /// <paramref name="MenuScope"/> is the part of the sidebar the role is MAPPED to: each code
    /// named, everything beneath it and the headings above it. Null maps the whole Organisation
    /// catalogue; an empty list maps nothing beyond the mandatory nodes - the dashboard and My
    /// Security - which every role keeps. It is what the seeder writes into the Menu
    /// Configuration grid, and like every row there it can only ever hide a screen: a node inside
    /// the scope still needs the permission its screen requires.
    /// </summary>
    public sealed record RoleDefinition(
        string Code,
        string Name,
        string Description,
        int Priority,
        IReadOnlyList<string> PermissionCodes,
        bool GrantsAll = false,
        bool IsDefault = false,
        bool IsPrivileged = false,
        IReadOnlyList<string>? MenuScope = null);

    /// <summary>The Campaigns branch: Campaign Register and Create Campaign.</summary>
    private const string CampaignMenus = "FR_CAMPAIGNS";

    /// <summary>The Donors and Leads branch: Lead Work Queue, Follow-up Queue and Donor List.</summary>
    private const string DonorAndLeadMenus = "FR_RELATIONSHIPS";

    /// <summary>
    /// The Donations and Payments branch: Public Donation Initiation and Payments and Receipts.
    /// </summary>
    private const string DonationAndPaymentMenus = "MN_DONATIONS";

    public static readonly IReadOnlyList<RoleDefinition> All =
    [
        // ============ ORGANISATION ADMIN ====================================================
        //
        // Full control of one Organisation and nothing outside it. The scoping is not a property
        // of this role at all - it comes from TenantId on the row and the Organisation filter on
        // every query - which is why "full control" here is safe to express as GrantsAll, and why
        // its menu scope is the whole catalogue.
        new(
            RoleCodes.TenantAdmin,
            "Organisation Admin",
            "Full control of this organisation: users, roles, menus, settings and every module. "
            + "Scoped to this organisation and never beyond it.",
            Priority: 100,
            PermissionCodes: [],
            GrantsAll: true,
            IsPrivileged: true),

        // ============ CAMPAIGN MANAGER ======================================================
        //
        // PRIVILEGED, because it approves: the flag drives the enhanced audit rows and the
        // access-review campaigns, and the ability to decide is the thing worth reviewing.
        new(
            RoleCodes.CampaignManager,
            "Campaign Manager",
            "Owns the organisation's campaigns: plans and prepares them, approves, pauses, resumes "
            + "and closes them, and decides tracking assets, readiness and budgets. Never approves "
            + "a campaign they created or submitted.",
            Priority: 80,
            PermissionCodes: RoleAccessProfiles.CampaignManager,
            IsPrivileged: true,
            MenuScope: [CampaignMenus]),

        // ============ FUNDRAISING MANAGER ===================================================
        new(
            RoleCodes.FundraisingManager,
            "Fundraising Manager",
            "Leads the fundraising team: works donors and leads, routes and reassigns leads, and "
            + "approves donor records, duplicate decisions and escalated identity checks.",
            Priority: 80,
            PermissionCodes: RoleAccessProfiles.FundraisingManager,
            IsPrivileged: true,
            MenuScope: [DonorAndLeadMenus]),

        // ============ CAMPAIGN EXECUTIVE ====================================================
        //
        // THE DEFAULT ROLE. A staff account created with no role falls back to it, and it is the
        // safest working choice: it can prepare campaigns, it approves nothing, and it reaches no
        // donor's contact details. The donor portal never lands here - CreateUserCommand gives a
        // donor account DONOR by its category.
        new(
            RoleCodes.CampaignExecutive,
            "Campaign Executive",
            "Prepares campaigns: creates and edits them, sets up tracking assets, readiness checks "
            + "and budgets, and submits them for approval. Approves nothing.",
            Priority: 60,
            PermissionCodes: RoleAccessProfiles.CampaignExecutive,
            IsDefault: true,
            MenuScope: [CampaignMenus]),

        // ============ FUNDRAISER EXECUTIVE ==================================================
        new(
            RoleCodes.FundraiserExecutive,
            "Fundraiser Executive",
            "Works donors and leads: captures and qualifies leads, contacts supporters, records "
            + "consent and follow-ups, and keeps donor records up to date. Approves nothing.",
            Priority: 60,
            PermissionCodes: RoleAccessProfiles.FundraiserExecutive,
            MenuScope: [DonorAndLeadMenus]),

        // ============ DONORCARE =============================================================
        //
        // CREATED NOW, MAPPED LATER. The role exists so people can be assigned to it today; which
        // screens supporter care works in is a decision still to be made, so it holds no
        // permission and maps no menu beyond the mandatory two.
        new(
            RoleCodes.DonorCare,
            "DonorCare",
            "Supporter care: answers donor queries, receipt requests and preference changes. "
            + "Screens for this role are to be mapped.",
            Priority: 40,
            PermissionCodes: RoleAccessProfiles.DonorCare,
            MenuScope: []),

        // ============ DONOR =================================================================
        //
        // The person who gives, once they have an account. Not staff, and not a reduced member
        // of staff either - see RoleCodes.Donor for why it is not on the authority ladder.
        //
        // NOT THE DEFAULT ROLE, and it must never become one: the default is what an account
        // created with no roles falls back to, and a staff account that quietly became a donor
        // would lose every screen it needs. CreateUserCommand picks this one from the account
        // CATEGORY instead, which is the fact that actually distinguishes the two.
        //
        // NOT PRIVILEGED. A donor can reach one person's records - their own - so reviewing them
        // quarterly would bury the reviews that matter under a list of every donor who has given.
        //
        // LOWEST PRIORITY, so a donor who is also a member of staff - a volunteer who gives, an
        // employee who gives - is labelled and sorted by the staff role they hold.
        new(
            RoleCodes.Donor,
            "Donor",
            "Views and pays their own donations and views their own receipts. Sees no other "
            + "donor's records and no staff screens.",
            Priority: 10,
            PermissionCodes: RoleAccessProfiles.Donor,
            MenuScope: [DonationAndPaymentMenus])
    ];
}
