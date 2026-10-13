using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Common.Constants;

/// <summary>
/// The global navigation catalogue, seeded into <c>MenuDefinition</c> on first run.
///
/// WHY IT IS CODE RATHER THAN DATA. These rows describe what the deployed software actually
/// contains, and the routes have to match the Angular router or the sidebar produces dead
/// links. Keeping the list beside the permission codes means a new screen is added in one
/// place and the seeder reconciles it on the next start, rather than needing a hand-written
/// migration per screen.
///
/// THE ROUTES ARE REAL. Every <c>Route</c> below corresponds to a path in the client
/// <c>app.routes.ts</c>. A node with a null route is a grouping header that expands but does
/// not navigate.
///
/// PLATFORM NODES ARE MARKED. Anything with <c>IsPlatformOnly</c> is only ever returned to
/// SuperAdmin, however a Tenant configures its roles.
/// </summary>
/// THE SIDEBAR, TOP TO BOTTOM. Eight main menus, in the order the work runs - the people who
/// give, the campaigns they give to, the money, talking to them, and then the organisation's own
/// administration:
///
///   10  Dashboard
///   20  Donors &amp; Leads       Lead Work Queue, My Leads, All Donors, My Donors, Follow-ups
///   30  Campaigns            All Campaigns, Tracking Asset Manager
///   40  Donations            New Donation, Payments &amp; Receipts
///   50  Communications       WhatsApp Messages, Number Verification
///   60  Organisation         Profile, Departments, Branches &amp; Units, Settings
///   70  Users &amp; Access       Users, Roles &amp; Permissions, Menu Configuration, Access Requests, Audit Trail
///   80  Master Data          Countries, States, Cities, Currencies, Time Zones
///
/// Platform (15) is the Platform Admin's own branch and never shares a sidebar with the
/// Organisation menus between Dashboard and Master Data; the three dormant branches - Workspace,
/// Finance and Supply - sort after everything live.
///
/// TWO LEVELS, NOT THREE. Donors &amp; Leads, Campaigns and Donations used to sit one level down,
/// under the "Fundraising" and "Money" headings, so every working screen was three clicks deep.
/// Each is now a main menu of its own and the two headings are gone from the catalogue (the
/// start-up reconciliation retires them). THE CODES DID NOT CHANGE - FR_RELATIONSHIPS,
/// FR_CAMPAIGNS, MN_DONATIONS and every screen beneath them keep theirs - so every role's menu
/// scope, mapping row and Organisation override still names the same node.
///
/// WHAT IS SWITCHED OFF, AND WHY. Finance and Supply carry <c>IsEnabledByDefault: false</c>:
/// no FIN or INV service exists, so every screen behind them would open on nothing. So do the
/// three Communications screens that are not WhatsApp, for the same reason. Three Workspace
/// screens are off for a sharper reason - they call no endpoint at all and render invented
/// names, which is the last thing that should appear in a demonstration. Turning a node back on
/// is a one-word edit here, or a TenantMenu override per Organisation.
public static class MenuCatalogue
{
    /// <summary>One row of the catalogue, flattened. <c>ParentCode</c> builds the tree.</summary>
    public sealed record MenuSeed(
        string Code,
        string Name,
        string? ParentCode,
        MenuLevel Level,
        string ModuleCode,
        string? Route,
        string? Icon,
        string? RequiredPermissionCode,
        int DisplayOrder,
        bool IsPlatformOnly = false,
        bool IsEnabledByDefault = true,
        bool IsMandatory = false);

    // ---- Top-level menu codes, referenced as parents below --------------------------------
    //
    // Four of them read oddly as main-menu codes - FR_RELATIONSHIPS, FR_CAMPAIGNS, MN_DONATIONS,
    // MN_FINANCE - because they were sub-menus once. They keep the old codes on purpose: see the
    // note on the class.
    public const string Dashboard = "DASHBOARD";
    public const string Platform = "PLATFORM";
    public const string DonorsAndLeads = "FR_RELATIONSHIPS";
    public const string Campaigns = "FR_CAMPAIGNS";
    public const string Donations = "MN_DONATIONS";
    public const string Communications = "COMMUNICATIONS";
    public const string Organisation = "ORGANISATION";
    public const string Administration = "ADMINISTRATION";
    public const string Masters = "MASTERS";
    public const string Workspace = "WORKSPACE";
    public const string Finance = "MN_FINANCE";
    public const string Supply = "SUPPLY";

    /// <summary>
    /// The whole catalogue. Order within the list does not matter; <c>DisplayOrder</c> and
    /// <c>ParentCode</c> decide the shape.
    /// </summary>
    public static readonly IReadOnlyList<MenuSeed> All =
    [
        // ============ Dashboard =============================================================
        new(Dashboard, "Dashboard", null, MenuLevel.Menu, "CORE",
            "/app/dashboard", "grid", null, 10, IsMandatory: true),

        // ============ Platform: SuperAdmin only ==============================================
        // This whole branch is invisible to every Tenant user, which is what keeps
        // Organisation administration out of a TenantAdmin sidebar.
        //
        // 15, STRAIGHT UNDER THE DASHBOARD. Outside an Organisation the Platform Admin sees three
        // menus - Dashboard, Platform, Master Data - and platform work is what they came for.
        new(Platform, "Platform", null, MenuLevel.Menu, "PLATFORM",
            null, "globe", PermissionCodes.Platform.TenantsView, 15, IsPlatformOnly: true),

        new("PLATFORM_ORGANISATIONS", "Organisations", Platform, MenuLevel.SubMenu, "PLATFORM",
            "/app/administration/organisation/directory", "building",
            PermissionCodes.Platform.TenantsView, 10, IsPlatformOnly: true),

        new("PLATFORM_ORG_CREATE", "Create Organisation", "PLATFORM_ORGANISATIONS",
            MenuLevel.ChildSubMenu, "PLATFORM",
            "/app/administration/organisation/setup-wizard", "plus-circle",
            PermissionCodes.Platform.TenantsCreate, 10, IsPlatformOnly: true),

        new("PLATFORM_ORG_APPROVALS", "Approval Queue", "PLATFORM_ORGANISATIONS",
            MenuLevel.ChildSubMenu, "PLATFORM",
            "/app/administration/organisation/registration-verification", "check-circle",
            PermissionCodes.Platform.TenantsReview, 20, IsPlatformOnly: true),

        new("PLATFORM_BUSINESS_UNIT", "Business Unit", Platform, MenuLevel.SubMenu, "PLATFORM",
            "/app/platform/business-unit", "briefcase",
            PermissionCodes.Platform.BusinessUnitsView, 20, IsPlatformOnly: true),

        new("PLATFORM_PERMISSION_CATALOGUE", "Permission Catalogue", Platform, MenuLevel.SubMenu,
            "PLATFORM", "/app/platform/permission-catalogue", "key",
            PermissionCodes.Platform.PermissionCatalogueManage, 30, IsPlatformOnly: true),

        new("PLATFORM_MENU_CATALOGUE", "Menu Catalogue", Platform, MenuLevel.SubMenu, "PLATFORM",
            "/app/platform/menu-catalogue", "list", PermissionCodes.Platform.MenuCatalogueManage,
            40, IsPlatformOnly: true),

        new("PLATFORM_AUDIT", "Platform Audit", Platform, MenuLevel.SubMenu, "PLATFORM",
            "/app/platform/audit", "shield", PermissionCodes.Platform.PlatformAuditView,
            50, IsPlatformOnly: true),

        // ============ Users & Access (IAM) ========================================================
        //
        // ONE MAIN MENU, FIVE SCREENS, NO GROUPS. This branch used to be "Administration" holding
        // two groups - Access and Identity (User Directory, Roles and Permissions, Menu
        // Configuration) and Access Governance (Access Requests, Audit Trail). Access Requests and
        // Audit Trail were moved into Access and Identity by request, which left Administration
        // wrapping a single group, so the group became the main menu and its screens hang straight
        // off it - the shape Organisation and Master Data already have. The order follows the work:
        // the people, the roles they hold, what each role sees, asking for more, and the record.
        // It was then renamed "Users & Access", and its first screen "Users", to say what is in it.
        //
        // THE CODE STAYS ADMINISTRATION, so every Organisation's existing mapping row and override
        // on the heading carries over; only its name, icon and position changed. ADMIN_ACCESS and
        // ADMIN_GOVERNANCE, the two groups, are no longer in the catalogue and the start-up
        // reconciliation retires them.
        //
        // THE HEADING CARRIES NO PERMISSION, and that is deliberate. A grouping header should
        // never be stricter than its most permissive child: every child names its own permission
        // and filter 8 removes the heading entirely when none of them survives. It matters here
        // more than anywhere - the working roles reach exactly one screen of this branch, Access
        // Requests, and a heading asking for iam.users.view (as the old Access and Identity group
        // did) would hide it from every one of them.
        new(Administration, "Users & Access", null, MenuLevel.Menu, "IAM",
            null, "users", null, 70),

        // FIVE ADMINISTRATION SCREENS HAVE COME OFF THE SIDEBAR, by request: Invite or Create
        // User, User Profile and Access, Access Preview, My Security and the Configuration branch
        // (Payment Gateways). The test is the one the Fundraising nodes below use - "is there
        // already a way in" - and each of the five has one:
        //
        //   Invite or Create User    Users, the Invite button
        //   User Profile and Access  Users (a row), and Profile in the top-bar menu
        //   Access Preview           User Profile and Access, the Access preview button
        //   My Security              My Security in the top-bar menu, which every role keeps
        //   Payment Gateways         Organisation > Settings, the Payment gateways button
        //
        // WITHDRAWN, NOT DELETED. The routes, the screens, their permissions and the API behind
        // them are untouched; the start-up reconciliation retires each definition and drops the
        // row from every Organisation that already holds it. Restoring one is restoring its line:
        // Each restored line sits straight under the main menu now that the groups are gone, and
        // takes a DisplayOrder that does not collide with the five below:
        //   new("ADMIN_CREATE_USER", "Invite or Create User", Administration, MenuLevel.SubMenu, "IAM",
        //       "/app/administration/access/create-user", "user-plus", PermissionCodes.UsersCreate, 15),
        //   new("ADMIN_USER_PROFILE", "User Profile and Access", Administration, MenuLevel.SubMenu, "IAM",
        //       "/app/administration/access/user-profile-and-access", "user", PermissionCodes.UsersView, 16),
        //   new("ADMIN_ACCESS_PREVIEW", "Access Preview", Administration, MenuLevel.SubMenu, "IAM",
        //       "/app/administration/access/access-preview", "eye", PermissionCodes.PermissionsView, 45),
        //   new("ADMIN_CONFIGURATION", "Configuration", Administration, MenuLevel.SubMenu, "IAM",
        //       null, "settings", PermissionCodes.PaymentGatewaysView, 60),
        //   new("ADMIN_PAYMENT_GATEWAYS", "Payment Gateways", "ADMIN_CONFIGURATION", MenuLevel.ChildSubMenu, "IAM",
        //       "/app/configuration/payment/gateways", "credit-card", PermissionCodes.PaymentGatewaysView, 10),
        //   new("ADMIN_MY_SECURITY", "My Security", Administration, MenuLevel.SubMenu, "IAM",
        //       "/app/administration/access/my-security", "lock", null, 70, IsMandatory: true),

        new("ADMIN_USER_DIRECTORY", "Users", Administration, MenuLevel.SubMenu, "IAM",
            "/app/administration/access/user-directory", "list",
            PermissionCodes.UsersView, 10),

        new("ADMIN_ROLE_CATALOGUE", "Roles & Permissions", Administration, MenuLevel.SubMenu, "IAM",
            "/app/administration/access/role-and-permission-catalogue", "shield",
            PermissionCodes.RolesView, 20),

        new("ADMIN_MENU_MAPPING", "Menu Configuration", Administration, MenuLevel.SubMenu, "IAM",
            "/app/administration/access/menu-configuration", "sliders",
            PermissionCodes.MenusView, 30),

        // BULK USER ADMINISTRATION IS DELIBERATELY ABSENT FROM THIS CATALOGUE.
        //
        // The screen, its route and its API are intact; what was withdrawn is the navigation
        // entry, because arriving through it could only ever fail. The page takes its selection
        // from router state handed over by the Users screen's "Bulk Actions" button - there is
        // no user picker on the page itself - so opening it from a menu produced the whole form
        // with nobody selected, and the operator learned that only after choosing an action and
        // writing a justification.
        //
        // THE DIRECTORY IS THE ONLY HONEST ENTRY POINT: tick people, then act on them. That
        // ordering is the feature, not an inconvenience - a bulk action is defined by an explicit
        // list somebody has looked at.
        //
        // RESTORING IT IS ONE ENTRY. Add the node back with code ADMIN_BULK_USERS and the seeder
        // un-retires the row it already has, mappings and Organisation overrides intact.

        // Every working staff role is mapped to this one screen of the branch - see
        // TenantRoleDefinitions.AccessRequestMenus.
        new("ADMIN_ACCESS_REQUESTS", "Access Requests", Administration, MenuLevel.SubMenu, "IAM",
            "/app/administration/access/access-request-and-approval", "inbox",
            PermissionCodes.AccessRequestsView, 40),

        // ACCESS REVIEWS IS DELIBERATELY ABSENT FROM THIS CATALOGUE.
        //
        // The screen, its route and its API are all intact - recertification still works and
        // /app/administration/access/access-review-campaign still serves it. What was withdrawn is
        // the navigation entry, because a quarterly recertification is not something anybody
        // browses to between other work: the campaign is raised, the reviewers are told, and they
        // arrive by link. A permanent sidebar item for it sat beside two screens people use daily
        // and read as clutter.
        //
        // RESTORING IT IS ONE ENTRY. Add the node back with code ADMIN_ACCESS_REVIEWS and the
        // seeder un-retires the row it already has, mappings and Organisation overrides intact -
        // see the note on the retirement pass in IamDbSeeder.SeedMenuDefinitionsAsync. Its parent
        // is now Administration, as for every screen in this branch.
        new("ADMIN_AUDIT", "Audit Trail", Administration, MenuLevel.SubMenu, "IAM",
            "/app/administration/audit", "file-text", PermissionCodes.AuditView, 50),

        // ============ Organisation (the Tenant own profile) =======================================
        //
        // THE SCREENS DROP THE WORD "ORGANISATION". It is already the heading they sit under, so
        // "Organisation > Organisation Profile" said it twice.
        new(Organisation, "Organisation", null, MenuLevel.Menu, "IAM",
            null, "home", PermissionCodes.OrganisationView, 60),

        new("ORG_PROFILE", "Profile", Organisation, MenuLevel.SubMenu, "IAM",
            "/app/administration/organisation/details", "info",
            PermissionCodes.OrganisationView, 10),

        new("ORG_DEPARTMENTS", "Departments", Organisation, MenuLevel.SubMenu, "IAM",
            "/app/administration/organisation/departments", "git-branch",
            PermissionCodes.OrganisationManageDepartments, 20),

        new("ORG_UNITS", "Branches & Units", Organisation, MenuLevel.SubMenu, "IAM",
            "/app/administration/organisation/units", "map-pin",
            PermissionCodes.OrganisationManageUnits, 30),

        new("ORG_SETTINGS", "Settings", Organisation, MenuLevel.SubMenu, "IAM",
            "/app/administration/organisation/settings", "sliders",
            PermissionCodes.OrganisationManageSettings, 40),

        // ============ Workspace ======================================================================
        //
        // DORMANT: every screen under it is switched off, so filter 8 drops the heading from every
        // sidebar. It sorts after the live menus so that switching one on does not land it in the
        // middle of the working order.
        new(Workspace, "Workspace", null, MenuLevel.Menu, "UX", null, "layout", null, 90),

        new("WS_MY_WORKSPACE", "My Workspace", Workspace, MenuLevel.SubMenu, "UX",
            "/app/workspace/my-workspace", "home", null, 10, IsEnabledByDefault: false),

        new("WS_EXECUTIVE_DASHBOARD", "Executive Dashboard", Workspace, MenuLevel.SubMenu, "UX",
            "/app/workspace/executive-dashboard", "trending-up", null, 20, IsEnabledByDefault: false),

        // SWITCHED OFF, for the same reason as its three siblings above. The component injects
        // no service of any kind - it renders invented records held in component state - and it
        // additionally carried NO permission, so it was the one screen in the whole catalogue
        // that appeared in EVERY sidebar: Standard User, Volunteer and Donor Portal User
        // included. Fabricated data behind an ungated menu item is the worst combination in the
        // build, and it was the only thing keeping the Workspace branch alive.
        //
        // Turning it back on is this one word, once the screen talks to a real search endpoint.
        new("WS_GLOBAL_SEARCH", "Global Search", Workspace, MenuLevel.SubMenu, "UX",
            "/app/workspace/global-search", "search", null, 30, IsEnabledByDefault: false),

        new("WS_NOTIFICATIONS", "Notification Centre", Workspace, MenuLevel.SubMenu, "UX",
            "/app/workspace/notification-centre", "bell", null, 40, IsEnabledByDefault: false),

        // ============ Donors & Leads and Campaigns (DON, CAM) ==========================================
        //
        // Owned by the CAM and DON services. Listed here because IAM is the only service that
        // knows the caller's full permission set and therefore the only one that can build a
        // menu spanning every module.
        //
        // TWO MAIN MENUS, NO "FUNDRAISING" HEADING. Both used to be sub-menus of a Fundraising
        // heading that carried no permission and opened nothing - a click on the way to every
        // fundraising screen. The heading has gone from the catalogue (the start-up reconciliation
        // retires the FUNDRAISING row) and each branch is now a main menu, Donors & Leads first:
        // the people come before the campaigns that are put to them.
        //
        // EVERY NODE NOW NAMES A PERMISSION. They all carried null, which meant the whole
        // Fundraising branch appeared in every sidebar - including a Volunteer's and a Donor
        // Portal user's - and then answered 403 on the click, because the endpoints behind them
        // do check. A menu that offers a screen the caller cannot open is worse than no menu.
        //
        // A PARENT NAMES THE SECTION CODE, a child names the code its own screen needs. That
        // way losing one screen collapses one row rather than hiding the branch that holds the
        // others.
        new(Campaigns, "Campaigns", null, MenuLevel.Menu, "CAM",
            null, "flag", "cam.campaigns.view", 30),

        // THE CAMPAIGNS MENU IS WHAT THE SIDEBAR DRAWS, AND THE SIDEBAR NO LONGER REWRITES IT.
        //
        // The browser used to take this branch and change it on the way to the screen: it renamed
        // the register "Campaign Overview", dropped Create Campaign and added a Tracking Asset
        // Manager link of its own. So the menu an administrator saw in Menu Configuration was not
        // the menu anybody was shown - a label override there was overwritten, and the tracking
        // link could be neither hidden, renamed nor mapped to a role, because IAM had never heard
        // of it. The three decisions now live here, and the sidebar draws what it is given.
        //
        // "All Campaigns" since the register became a main menu's first screen: it is every campaign
        // in the Organisation, and the word says so where "Overview" did not.
        new("FR_CAMPAIGN_REGISTER", "All Campaigns", Campaigns, MenuLevel.SubMenu, "CAM",
            "/app/fundraising/campaigns/campaign-register", "list", "cam.campaigns.view", 10),

        // Every tracking asset in the Organisation, filterable by campaign. Guarded by its own
        // view code, so a role that reads campaigns and not their assets is not offered it.
        new("FR_TRACKING_ASSETS", "Tracking Asset Manager", Campaigns, MenuLevel.SubMenu, "CAM",
            "/app/fundraising/campaigns/tracking-asset-manager", "clipboard", "cam.tracking-assets.view", 20),

        // CREATE CAMPAIGN AND THE READINESS CHECKLIST HAVE NO SIDEBAR ROW.
        //
        // THE TEST IS "IS THERE ALREADY A WAY IN", not "is the screen wanted". The wizard opens
        // from the Create button on All Campaigns, shown to whoever holds
        // `cam.campaigns.create`; the readiness checklist is about ONE campaign and opens from
        // that campaign's row action ("Readiness"), carrying ?ref.
        //
        // WITHDRAWN, NOT DELETED. The routes, the screens, their permissions and the CAM
        // endpoints behind them are untouched, and the start-up reconciliation retires each
        // definition and drops the row from every Organisation that already holds it - so this
        // reaches databases that have already run, not only fresh ones. Restoring one is
        // restoring its line.

        // THESE TWO ARE NOW ENABLED, and each guards on its OWN permission.
        //
        // They were disabled because they had no service behind them - the screens read seeded
        // arrays, so putting them in a sidebar would have offered people figures that came from a
        // bundle. Both now have a CAM slice, its own tables and its own permissions, so the reason
        // for hiding them has gone.
        //
        // THE GUARD CHANGED FROM cam.campaigns.view, which was the wrong permission twice over: it
        // let anybody who could see a campaign open its budgets, and it meant a finance officer with
        // no campaign permissions could not reach the budget screen at all.
        // ATTRIBUTION EXPLORER AND BUDGET AND TARGETS ARE NOT OFFERED YET.
        //
        // Withdrawn rather than deleted: the screens, their permissions and the CAM endpoints
        // behind them all still exist and still work. Only the way in is gone, so bringing them
        // back is restoring these two lines and nothing else.
        //
        // They are not merely disabled by default, because a disabled node can still be switched
        // on per Organisation from Menu Mapping - and an operator switching on a screen that is
        // not ready is exactly what this is meant to prevent. The reconciliation on start-up
        // removes the rows from every Organisation that already holds them.

        // "heart" rather than the "users" it had as a sub-menu: Users & Access is a main menu too and
        // draws "users", and two main menus with one icon read as one in the folded rail.
        new(DonorsAndLeads, "Donors & Leads", null, MenuLevel.Menu, "DON",
            null, "heart", PermissionCodes.SectionDon, 20),

        // THE ORDER IS THE ROLE FLOW'S. Its fundraising team works Lead Work Queue, All Donors and
        // Follow-ups; DonorCare works My Leads, My Donors and Follow-ups. Each "My" list sits
        // after its organisation-wide twin, so both role menus read in the flow's order and an
        // administrator holding all five sees each pair together.
        new("FR_LEAD_QUEUE", "Lead Work Queue", DonorsAndLeads, MenuLevel.SubMenu, "DON",
            "/app/fundraising/relationships/lead-work-queue", "inbox", "don.lead-work-queue.view", 10),

        // MY LEADS IS BACK IN THE SIDEBAR, as DonorCare's first menu. It is the Lead Work Queue
        // narrowed to the leads assigned to the caller, so it carries the same view code; DON
        // withholds it from a sidebar whose holder has no leads at all, which is how a DonorCare
        // member given only follow-ups sees Follow-ups alone.
        new("FR_MY_LEADS", "My Leads", DonorsAndLeads, MenuLevel.SubMenu, "DON",
            "/app/fundraising/relationships/my-leads", "user", "don.lead-work-queue.view", 20),

        // FOLLOW-UPS (the Follow-up Queue) BELONGS IN THE SIDEBAR, and it is the exception to the rule the four
        // withdrawn screens below follow.
        //
        // THAT RULE IS "IS THERE ALREADY A WAY IN", and the reason behind it is that a screen
        // about ONE record says nothing when it is reached cold. This one is not about one
        // record: it is a person's own list of the follow-up calls and e-mails they owe, which is
        // exactly the kind of thing somebody opens first thing in the morning without having
        // clicked a donor to get there - the same shape as Lead Work Queue above it.
        //
        // It was reachable only from My Leads, Follow-up Planner and Follow-up Execution, all of
        // which are places you arrive at AFTER choosing a record, so the queue could only be found
        // by somebody who had already stopped needing it.
        //
        // Last in the menu: the follow-ups owed on the leads and donors listed above it.
        new("FR_FOLLOW_UP_QUEUE", "Follow-ups", DonorsAndLeads, MenuLevel.SubMenu, "DON",
            "/app/fundraising/relationships/follow-up-queue", "clock", "don.follow-up-planner.view", 50),

        // LEAD CAPTURE HAS COME OFF THE SIDEBAR, on the same test as the four screens below: the
        // way in already exists. Lead Work Queue carries a "Create Lead" button on both its
        // populated and its empty state, and that is the context the form belongs in - a capture
        // form reached cold is one whose result nobody is waiting for.
        //
        // WITHDRAWN, NOT DELETED. The route, the screen, `don.lead-capture.view` and the DON
        // endpoints are untouched; the start-up reconciliation retires the definition and drops
        // the row from every Organisation that already holds it. Restoring it is restoring the
        // one line.

        // DONOR 360 HAS NO MENU ENTRY, DELIBERATELY. It is not a screen anybody navigates to
        // cold - it is what opens when a donor is clicked in All Donors, and it needs a
        // donor id to show anything at all. Offering it in the sidebar gave people a link to a
        // Donor 360 with no donor in it.
        //
        // WITHDRAWN, NOT DELETED. The route, the screen, its permissions and the DON endpoints
        // behind them are all untouched and still work; only the sidebar row is gone. The
        // start-up reconciliation retires the definition and removes the row from every
        // Organisation that already holds it, so this reaches existing databases rather than
        // only fresh ones. Restoring it is restoring this one line.

        // The donor register: everyone who has given. "All Donors" beside "My Donors" says which of
        // the two lists is which, where "Donor List" and "My Donor List" made a person read both.
        new("FR_DONOR_LIST", "All Donors", DonorsAndLeads, MenuLevel.SubMenu, "DON",
            "/app/fundraising/relationships/donor-list", "list", "don.donors.view", 30),

        // DonorCare's second menu: the donors whose relationship they own. Withheld by DON the
        // same way as My Leads when the holder owns no donor.
        new("FR_MY_DONORS", "My Donors", DonorsAndLeads, MenuLevel.SubMenu, "DON",
            "/app/fundraising/relationships/my-donor-list", "heart", "don.donors.view", 40),

        // FOUR RELATIONSHIP SCREENS HAVE COME OFF THE SIDEBAR: Consent Centre, Assignment Board,
        // Follow-up Planner and Identity Verification.
        //
        // THE TEST WAS "IS THERE ALREADY A WAY IN", not "is the screen wanted". Each of the four
        // is opened from the record it is about, which is the only context in which it says
        // anything - a consent centre with no donor in it, or an assignment board reached cold
        // rather than from the lead being assigned, is a screen a person has to re-establish
        // their place in. The four have these ways in:
        //
        //   Consent Centre         Donor 360, All Donors, Identity Verification
        //   Assignment Board       Lead Work Queue (assign, and reassign)
        //   Follow-up Planner      Donor 360
        //   Identity Verification  Donor 360
        //
        // WHAT REMAINS IS THE SET YOU ARRIVE AT COLD: the two lead screens, the donor register,
        // and Duplicate Review.
        //
        // DUPLICATE REVIEW IS WITHDRAWN as well, by request: the screen and its route were removed from the
        // UI, so the sidebar entry went with it. Restoring it means restoring the screen and this line:
        //   new("FR_DUPLICATE_REVIEW", "Duplicate Review", DonorsAndLeads, MenuLevel.SubMenu, "DON",
        //       "/app/fundraising/relationships/duplicate-review", "copy", "don.duplicate-review.view", 60),

        // ============ Donations and Finance (PAY, FIN) ===================================================
        //
        // THE "MONEY" HEADING IS GONE. It held two branches: Donations and Payments, live, and
        // Finance, switched off - so in every sidebar it was one more click on the way to the
        // donation screens. Donations is a main menu now, and so is Finance, still dormant. The
        // start-up reconciliation retires the MONEY row.
        //
        // FINANCE IS A MAIN MENU THAT NOBODY SEES. No FIN service exists, so it stays off by
        // default and sorts after the live menus (100); switching it on per Organisation from
        // Menu Configuration still works exactly as before.
        new(Finance, "Finance", null, MenuLevel.Menu, "FIN", null, "book", null, 100, IsEnabledByDefault: false),

        // THESE TWO CARRIED NO PERMISSION, so the Finance branch appeared in every sidebar -
        // a Volunteer's included - and every item in it led to a screen they could not use. The
        // note below on the PAY nodes explains why that is worse than hiding them.
        //
        // Both are guarded on PAY's reconciliation permission, which is what the work on these
        // screens actually amounts to: matching what the gateway reported against what the bank
        // received. Finance has no service of its own, so borrowing PAY's permission is honest -
        // inventing a `fin.*` code that nothing enforces would not be.
        new("MN_FINANCE_WORKBENCH", "Finance Workbench", Finance, MenuLevel.SubMenu, "FIN",
            "/app/money/finance/finance-workbench", "layout", "pay.donations.reconcile", 10, IsEnabledByDefault: false),

        new("MN_RECONCILIATION", "Reconciliation", Finance, MenuLevel.SubMenu, "FIN",
            "/app/money/finance/reconciliation-workspace", "refresh-cw", "pay.donations.reconcile", 20, IsEnabledByDefault: false),

        // Recording a gift with no gateway to corroborate it. It lives under Finance because
        // that is who does it, but the permission is PAY's - the module that owns the donation
        // it creates.
        new("MN_OFFLINE_DONATION", "Offline Donation Entry", Finance, MenuLevel.SubMenu, "FIN",
            "/app/money/finance/offline-donation-entry", "edit",
            "pay.donations.record-offline", 30, IsEnabledByDefault: false),

        // ---- Donations (PAY) ---------------------------------------------------------------
        //
        // A MAIN MENU NOW, and renamed with its first screen. "Donations and Payments" under
        // "Money" said money three times; "Donations" with New Donation and Payments & Receipts
        // under it says what each one does. The code is unchanged - see the note on the class.
        //
        // FOUR CHILDREN ONCE, AND THE DONATION FLOW DOCUMENT NAMES ALL FOUR - in this order, with
        // these words. Public Donation Initiation, Payment Queue, Support & Retry, Receipt
        // Register. Two remain (see Payments & Receipts below), and nothing else belongs here.
        //
        // RECEIPT CORRECTION IS NOT ONE OF THEM ANY MORE. It was seeded here pointing at
        // /app/donations/receipt-correction on the strength of the document's subtitle - "donor
        // form -> payment -> receipt -> correction" - but the guide has no section for the screen
        // and its Quick Reference Summary names four. The Angular route is gone, so leaving the
        // node would put an item in the sidebar that resolves to page-not-found, which is the one
        // failure the note below is about. Dropping the code here retires the row on the next
        // start for every Organisation that already has it, overrides and role mappings intact.
        //
        // CORRECTING A RECEIPT IS STILL SOMETHING THE SERVER DOES. `pay.receipts.correct` and
        // POST /receipts/{id}/correct stay exactly as they are - a receipt-domain operation does
        // not need a menu node to exist.
        //
        // WHAT WAS HERE BEFORE AND IS NOT ANY MORE. Donation Register, Donation Intents, Refunds
        // and Chargebacks and Payment Gateway were all seeded as child nodes pointing at
        // /app/donations/donation-register, /app/donations/donation-intent-detail,
        // /app/donations/refund-and-chargeback-case and /app/donations/gateway-configuration -
        // four routes the Angular router no longer declares. A seeded node whose route does not
        // resolve is worse than a missing one: the item renders, someone clicks it, and the
        // application shows page-not-found for a screen the sidebar promised. The seeder retires
        // a code the catalogue drops rather than deleting it, so removing them here withdraws
        // them from every existing Organisation on the next start without taking any override or
        // role mapping with them.
        //
        // ALSO NOTE WHAT WAS MISSING. Public Donation Initiation - the entry form, the first
        // screen in the document's flow and the only one a donor ever sees - had no menu node at
        // all, so no amount of permission would put it in a sidebar.
        //
        // EVERY NODE CARRIES ITS PERMISSION. They were all null once, which meant the whole Money
        // branch appeared in every sidebar and every item in it led to a screen that answered
        // 403. A menu that shows somebody a page they cannot open is worse than one that hides
        // it: they raise a ticket about a broken screen rather than asking for access.
        new(Donations, "Donations", null, MenuLevel.Menu, "PAY",
            null, "dollar-sign", "PAY.View", 40),

        // STEP 1 OF THE FLOW. The same component the donor reaches anonymously through the QR
        // code; inside the panel it renders the internal reference view the document shows in
        // Fig 2. The permission is CREATE rather than VIEW because the only thing this screen
        // does is start a donation - which, on the role matrix, is TENANT_ADMIN and DONOR.
        //
        // "New Donation", because that is what the screen makes. "Public Donation Initiation" was
        // the flow document's name for the step, and read to the people using it as jargon.
        new("MN_PUBLIC_DONATION", "New Donation", Donations, MenuLevel.SubMenu, "PAY",
            "/app/donations/public-donation-initiation", "heart", "pay.intents.create", 10),

        // STEP 3, AND THE ONLY REMAINING ONE. Payments and Receipts: every payment event with
        // both its payment status and its receipt status, on one page.
        //
        // THREE MENU ENTRIES BECAME ONE, and the two that went are the point of the change.
        // "Support & Retry" (/app/donations/payment-support-and-safe-retry) and "Receipt
        // Register" (/app/donations/receipt-register) were separate screens and separate
        // entries; both have been folded into this page, where retry and continue-to-payment are
        // offered from a row's detail panel and the receipt sits beside the payment that
        // produced it. Their components have been deleted from the client.
        //
        // LEAVING THE ENTRIES BEHIND WOULD HAVE BEEN WORSE THAN USELESS. This catalogue is what
        // the sidebar is built from, so every administrator holding pay.payments.safe-retry or
        // pay.receipts.view would still have been shown two menu items that route to nothing -
        // an application that looks broken to precisely the people who would report it.
        new("MN_PAYMENT_QUEUE", "Payments & Receipts", Donations, MenuLevel.SubMenu, "PAY",
            "/app/donations/payment-event-queue", "inbox", "pay.payments.view-events", 20),

        // ============ Communications =========================================================================
        //
        // SWITCHED ON, BECAUSE IT HAS TWO WORKING SCREENS NOW: the WhatsApp pair, served by CAM
        // through the integration worker. The heading carries no permission - the rule the other
        // headings follow - and each screen names its own; filter 8 drops the heading for anybody
        // who can open neither.
        //
        // THE SIDEBAR USED TO ADD THESE TWO ITSELF, as "CheckNumber" and "Wati" straight under the
        // Dashboard, because IAM had no node for them. So no administrator could hide, rename,
        // reorder or map them to a role, and they appeared wherever the browser decided. They are
        // catalogue nodes now and the browser adds nothing.
        //
        // NAMED FOR THE JOB, NOT THE SUPPLIER. WATI and CheckNumber.ai are the services behind the
        // screens; a person sending messages or checking numbers should not need to know them.
        new(Communications, "Communications", null, MenuLevel.Menu, "COM", null, "message-circle", null, 50),

        // Broadcasting to verified numbers through WATI. `cam.campaigns.view` is what the CAM
        // WhatsApp API asks of a reader (WhatsAppView); sending asks `cam.campaigns.create`, which
        // the screen checks for itself.
        new("CM_WHATSAPP_MESSAGES", "WhatsApp Messages", Communications, MenuLevel.SubMenu, "COM",
            "/app/whatsapp/wati", "send", "cam.campaigns.view", 10),

        // Checking an uploaded list of numbers against WhatsApp through CheckNumber.ai, before any
        // message is sent to them.
        new("CM_NUMBER_VERIFICATION", "Number Verification", Communications, MenuLevel.SubMenu, "COM",
            "/app/whatsapp/check-number", "shield", "cam.campaigns.view", 20),

        // STILL OFF: no COM service exists, so these three would open on nothing. They sort after
        // the two live screens so that switching one on does not push WhatsApp down the menu.
        new("CM_INBOX", "Unified Inbox", Communications, MenuLevel.SubMenu, "COM",
            "/app/communications/unified-inbox", "inbox", null, 30, IsEnabledByDefault: false),

        new("CM_TEMPLATES", "Template Catalogue", Communications, MenuLevel.SubMenu, "COM",
            "/app/communications/template-catalogue", "file", null, 40, IsEnabledByDefault: false),

        new("CM_COMPOSER", "Outbound Composer", Communications, MenuLevel.SubMenu, "COM",
            "/app/communications/outbound-message-composer", "send", null, 50, IsEnabledByDefault: false),

        // ============ Supply =================================================================================
        new(Supply, "Supply", null, MenuLevel.Menu, "INV", null, "package", null, 110, IsEnabledByDefault: false),

        new("SP_INVENTORY_OVERVIEW", "Inventory Overview", Supply, MenuLevel.SubMenu, "INV",
            "/app/supply/inventory/inventory-overview", "grid", null, 10, IsEnabledByDefault: false),

        new("SP_BATCH_LEDGER", "Batch Ledger", Supply, MenuLevel.SubMenu, "INV",
            "/app/supply/inventory/batch-ledger", "book", null, 20, IsEnabledByDefault: false),

        new("SP_STOCK_MOVEMENT", "Stock Movement", Supply, MenuLevel.SubMenu, "INV",
            "/app/supply/inventory/stock-movement-form", "truck", null, 30, IsEnabledByDefault: false),

        // ============ Master Data ==============================================================================
        //
        // The global master catalogue, served by IAM since GlobalMaster was merged into it.
        // "Master Data" rather than "Masters", and each screen named for the list it holds -
        // Countries, not Country - as the other list screens in the sidebar are. The codes keep
        // the old MASTERS / MS_* names.
        // EVERY NODE NOW NAMES A PERMISSION. They used to carry null, which meant the whole
        // branch appeared in every sidebar including a Volunteer's - and then answered 403 on
        // the click, because the endpoints behind them do check. A menu that offers a screen
        // the caller cannot open is worse than no menu at all.
        //
        // ONLY THE ORGANISATION ADMIN AND THE PLATFORM ADMIN SEE THIS BRANCH, by rule. The
        // permission gate is what enforces it: the gm.* codes are Organisation-Admin-only
        // (PermissionCodes.OrganisationAdminOnly), so no other role can hold GM.View and the
        // menu builder drops the whole branch for everybody else.
        new(Masters, "Master Data", null, MenuLevel.Menu, "GM",
            null, "database", PermissionCodes.GlobalMaster.Section, 80),

        new("MS_COUNTRY", "Countries", Masters, MenuLevel.SubMenu, "GM",
            "/app/masters/country", "flag", PermissionCodes.GlobalMaster.CountriesView, 10),

        new("MS_STATE", "States", Masters, MenuLevel.SubMenu, "GM",
            "/app/masters/state", "map", PermissionCodes.GlobalMaster.StatesView, 20),

        new("MS_CITY", "Cities", Masters, MenuLevel.SubMenu, "GM",
            "/app/masters/city", "map-pin", PermissionCodes.GlobalMaster.CitiesView, 30),

        new("MS_CURRENCY", "Currencies", Masters, MenuLevel.SubMenu, "GM",
            "/app/masters/currency", "dollar-sign", PermissionCodes.GlobalMaster.CurrenciesView, 40),

        new("MS_TIMEZONE", "Time Zones", Masters, MenuLevel.SubMenu, "GM",
            "/app/masters/timezone", "clock", PermissionCodes.GlobalMaster.TimeZonesView, 50)
    ];

    /// <summary>The nodes only SuperAdmin ever sees.</summary>
    public static IEnumerable<MenuSeed> PlatformNodes => All.Where(node => node.IsPlatformOnly);

    /// <summary>The nodes a new Organisation gets switched on automatically.</summary>
    public static IEnumerable<MenuSeed> TenantDefaultNodes =>
        All.Where(node => !node.IsPlatformOnly && node.IsEnabledByDefault);
}
