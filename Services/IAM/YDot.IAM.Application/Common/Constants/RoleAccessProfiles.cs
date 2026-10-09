using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Common.Constants;

/// <summary>
/// What each Organisation role holds, computed from the permission catalogue rather than typed
/// out as lists of strings.
///
/// WHY IT IS COMPUTED. The alternative is hundreds of hand-written codes across the roles, and a
/// typo in one of them is invisible: the seeder skips a code it cannot find in the catalogue, so a
/// mistyped grant does not fail - it silently does not exist, and the first anyone hears of it is
/// a 403 on a screen that should have worked. Deriving every set from the same catalogue the
/// permissions are seeded from makes that class of error impossible, and means a permission added
/// to CAM or DON next month lands in the right role by itself.
///
/// THE EXECUTIVE / MANAGER SPLIT. Each module's working roles divide its codes three ways:
///
///   Executive only   request, create, pass and fail - the person doing the work.
///   Manager only     approve, reject, disable, pause, resume and close - the person deciding it.
///   Both             everything else: viewing, exporting, and the day-to-day work that is
///                    neither a request nor a decision (assigning, communicating, follow-ups).
///
///   Campaign Executive    Executive half of CAM
///   Campaign Manager      Manager half of CAM
///   Fundraiser Executive  Executive half of DON
///   Fundraising Manager   Manager half of DON
///
/// IT USED TO BE "MANAGER = EXECUTIVE + APPROVALS". A Manager could create a campaign, submit it,
/// pass its readiness checks and then be refused the approval only by the record-level four-eyes
/// rule. The organisation asked for the two halves to belong to different people outright, so a
/// Manager no longer holds the maker's verbs and an Executive no longer holds the checker's.
/// The Organisation Admin holds both, by <c>GrantsAllTenantPermissions</c>.
///
/// THE PIVOT IS <c>PermissionAction</c>, not the verb in the code. CAM, DON and PAY declare their
/// action in <see cref="ModulePermissionCatalogue"/>: Create and Submit are the Executive's, Approve
/// is the Manager's, and the two lists below name the codes whose action alone does not say which
/// half they belong to. That distinction is load-bearing: <c>cam.campaigns.close</c> is declared
/// Approve ("approve a closure request") while <c>don.lead-work-queue.close</c> is declared Operate
/// and has to be named.
/// </summary>
public static class RoleAccessProfiles
{
    /// <summary>
    /// Codes only a module's EXECUTIVE holds, beyond those whose action is Create or Submit.
    ///
    /// EACH ONE IS PART OF PREPARING SOMETHING FOR A DECISION: editing or discarding a draft,
    /// raising an obstacle, and - on the readiness checklist - recording the verdicts the Manager
    /// then decides the launch on. A Manager holding any of them would be deciding on work they
    /// shaped themselves.
    /// </summary>
    private static readonly IReadOnlyList<string> ExecutiveOnlyCodes =
    [
        // ---- CAM: authoring a campaign, its assets, its checklist and its budget ----------
        "cam.campaigns.edit",
        "cam.campaigns.delete-draft",
        "cam.tracking-assets.edit",
        "cam.tracking-assets.delete-draft",
        "cam.readiness.edit",
        "cam.readiness.delete",

        // PASS AND FAIL ARE THE EXECUTIVE'S, both of them. Pass is declared Approve because it
        // signs a check off, but the decision a Manager takes is the launch itself
        // (`cam.campaigns.approve`), made on the verdicts the Executive recorded.
        "cam.readiness.pass",
        "cam.readiness.fail",

        // Raising a blocker is the maker saying "this is not ready yet"; clearing one is the
        // Manager's - see ManagerOnlyCodes.
        "cam.readiness.manage-blockers",
        "cam.budget-plans.revise",

        // ---- DON: capturing a lead, and discarding an unused draft ------------------------
        //
        // THE WHOLE CAPTURE SCREEN, view included. "Create Lead" is the Executive's, and a
        // capture form with no Submit on it is a dead end for a Manager who reaches it by URL.
        "don.lead-capture.view",
        "don.lead-capture.save",
        "don.lead-capture.deduplicate",
        "don.lead-capture.delete-draft",
        "don.donor-360.delete-draft"
    ];

    /// <summary>
    /// Codes only a module's MANAGER holds, beyond those whose action is Approve.
    ///
    /// Each one ends, stops or overrules something the Executive started: pausing and resuming a
    /// live campaign, taking a tracking asset live or down, sending a campaign back to draft,
    /// closing a lead, cancelling an identity check, and the decisions on donor duplicates.
    /// </summary>
    private static readonly IReadOnlyList<string> ManagerOnlyCodes =
    [
        // ---- CAM ------------------------------------------------------------------------------
        "cam.campaigns.pause",
        "cam.campaigns.resume",
        "cam.tracking-assets.activate",
        "cam.tracking-assets.deactivate",
        "cam.readiness.resolve-blockers",

        // REJECTING A LAUNCH. Returning a submitted campaign to draft is the other half of
        // approving it, so it sits with whoever holds `cam.campaigns.approve`.
        "cam.readiness.return-to-draft",

        // ---- DON ------------------------------------------------------------------------------
        "don.donors.cancel",
        "don.donors.archive",
        "don.lead-work-queue.close",
        "don.duplicate-review.merge",
        "don.duplicate-review.reject-candidate",
        "don.donor-identity-verification.cancel-verification"
    ];

    /// <summary>
    /// Codes NEITHER system role holds, because they belong to an administrator and to nobody
    /// else.
    ///
    /// WHY A THIRD LIST. The two above each take a code away from one working role. A code that
    /// belongs to neither would have to appear in both, which reads as two unrelated decisions
    /// and invites somebody to "tidy up" one half of it later.
    ///
    /// WHAT IS IN IT. The payment gateway configuration, whose codes decide which merchant
    /// account an Organisation's donations settle into. That is not a maker-checker question at
    /// all - splitting it would only mean two people instead of one could re-point where the
    /// money goes. It is an administrator's decision, so SUPER_ADMIN holds it by scope and
    /// TENANT_ADMIN by <c>GrantsAllTenantPermissions</c>, and the working roles hold none of it.
    ///
    /// Note this does NOT reach a database that has already run - see
    /// <see cref="WithdrawnGrants"/> for that. These codes are new, so no role has ever held one.
    /// </summary>
    private static readonly IReadOnlyList<string> AdministratorOnlyCodes =
    [
        // TAKING A CAMPAIGN LIVE BY HAND.
        //
        // The Campaign Management workflow lists Activate under Tenant Admin only. The Executive's
        // line is "create Campaign (Draft/Submitted), Request Close" and the Manager's is "Approve,
        // Pause, Resume, Close" - the contrast is deliberate, because the two names appear in the
        // same block and only one of them carries the verb.
        //
        // NOTHING IS STRANDED BY IT. Approving a campaign leaves it Scheduled, and a campaign set
        // to activate automatically goes live on its start date with no person involved at all.
        // Manual activation is the exception - bringing a launch forward, or starting a campaign
        // whose activation was set to manual - and the workflow puts that in the administrator's
        // hands.
        "cam.campaigns.activate",

        PermissionCodes.PaymentGatewaysView,
        PermissionCodes.PaymentGatewaysManage,
        PermissionCodes.PaymentGatewaysDelete,
        PermissionCodes.PaymentGatewaysTest
    ];

    /// <summary>
    /// Every Tenant-assignable code in the platform: IAM and GM from
    /// <see cref="PermissionCodes.AllTenant"/>, and CAM, DON and PAY from
    /// <see cref="ModulePermissionCatalogue"/>.
    ///
    /// Platform-only codes are excluded here and not merely unassigned - they belong to
    /// SUPER_ADMIN, whose authority comes from a flag rather than from grants, so a Tenant role
    /// holding one would be a row that grants nothing and confuses the access-preview screen.
    /// <c>cam.reference.manage</c> is the one non-IAM code this removes.
    /// </summary>
    public static IReadOnlyList<(string Code, PermissionAction Action)> TenantAssignable { get; } =
    [
        .. PermissionCodes.AllTenant
            .Select(code => (Code: code, Action: PermissionCodeConventions.DeriveAction(code))),

        .. ModulePermissionCatalogue.AllOtherModules
            .Where(seed => !seed.IsPlatformOnly)
            .Select(seed => (seed.Code, seed.Action))
    ];

    /// <summary>
    /// DONOR: their own giving, and nothing else.
    ///
    /// THE ONE WORKING PROFILE IN THIS FILE THAT IS LISTED RATHER THAN COMPUTED, and the reason is
    /// worth stating because the rest of the class argues hard for computing. The staff roles are
    /// computed because their boundary is a VERB and a MODULE - an Executive approves nothing, a
    /// Manager does, and each stays inside its own module - so a permission added tomorrow lands
    /// in the right role by itself.
    ///
    /// A DONOR'S BOUNDARY IS NOT A VERB. It is whose records they are, and no action name encodes
    /// that: <c>pay.donations.view</c> is a donor looking at their own gift and a fundraiser
    /// looking at everybody's, and the difference is enforced by the data scope rather than the
    /// code. So a computed profile would be wrong in the one direction that matters - every new
    /// PAY permission would land in DONOR automatically, and a role held by members of the public
    /// must never grow by default. Adding a capability here is a decision somebody makes on
    /// purpose.
    ///
    /// WHAT EACH ONE IS FOR:
    ///
    ///   PAY.View                  the Donations and Payments section itself, or the menu shows
    ///                             nothing and the account reads as broken.
    ///   pay.intents.view          their own donations, in progress and finished.
    ///   pay.intents.create        starting a donation, and continuing a pending one - which is
    ///                             the "Continue to pay" the flow document gives them.
    ///   pay.donations.view        the settled gift behind a successful payment.
    ///   pay.payments.view-events  the Payments and Receipts page.
    ///   pay.payments.verify       asking what happened to a payment they are unsure about,
    ///                             without telephoning somebody to ask the same question.
    ///   pay.payments.safe-retry   the "Retry" on a failed payment. Safe retry, specifically:
    ///                             it verifies before it re-attempts, so a donor pressing it on
    ///                             a payment that actually succeeded is not charged twice.
    ///   pay.receipts.view         their receipts.
    ///   pay.receipts.resend       sending their own receipt to themselves again.
    ///
    /// WHAT IS DELIBERATELY ABSENT: every Create, Edit, Approve and Export in IAM, CAM and DON;
    /// <c>pay.donations.view-sensitive-donor</c>, which unmasks OTHER donors; refunds and
    /// chargebacks, which are a decision about money that staff make; and every export, because
    /// an export is a bulk extract and a donor has one record.
    /// </summary>
    public static IReadOnlyList<string> Donor { get; } =
    [
        "PAY.View",
        "pay.donations.view",
        "pay.intents.create",
        "pay.intents.view",
        "pay.payments.safe-retry",
        "pay.payments.verify",
        "pay.payments.view-events",
        "pay.receipts.resend",
        "pay.receipts.view"
    ];

    /// <summary>
    /// DONORCARE: the leads, donors and follow-ups assigned to them, and nothing else.
    ///
    /// MAPPED FROM THE DONORS AND LEADS ROLE FLOW, which gives this role three screens - My Leads,
    /// My Donor List and its own Follow-up Queue - and names every action on them:
    ///
    ///   My Leads           Export Leads, Communicate, Schedule Follow-up
    ///   My Donor List      View Details (Donor 360), Schedule Follow-up, Communication Timeline,
    ///                      Export History
    ///   Donor 360 (Owner)  Create Donation Intent, and the five tabs
    ///   Follow-up Queue    Execute, View History, Cancel Follow-up, Reschedule Follow-up
    ///
    /// LISTED, NOT COMPUTED, for the same reason as <see cref="Donor"/>: the boundary is whose
    /// records they are, not a verb, so a computed profile would hand this team every new DON
    /// capability by default.
    ///
    /// WHAT KEEPS THEM TO THEIR OWN RECORDS is the absence of <c>don.records.view-all</c>. DON
    /// narrows every list, count, detail and write to the records assigned to a caller who lacks
    /// it, so the same endpoints the fundraising team uses answer this role with its own work.
    ///
    /// DELIBERATELY ABSENT: capturing and assigning leads, qualifying or closing them, approving
    /// anything, merging, identity verification, and reassigning follow-ups - the flow gives every
    /// one of those to the Fundraising Manager and Fundraiser Executive.
    /// </summary>
    public static IReadOnlyList<string> DonorCare { get; } =
    [
        "DON.View",

        // My Leads, and Communicate on them.
        "don.lead-work-queue.view",
        "don.lead-work-queue.contact",

        // My Donor List, Donor 360 and the Communication Timeline.
        "don.donors.view",
        "don.donor-360.view",
        "don.donor-360.follow-up",
        "don.donor-360.create-intent",
        "don.consent-and-preference-centre.view",

        // The person on the other end of a call they are about to make. Their scope is already
        // their own records, so this unmasks nothing beyond the people assigned to them.
        "don.donors.view-sensitive-contact",

        // Export Leads and Export History - of their own records, by the same scope.
        "don.donors.export",

        // Their Follow-up Queue: schedule, execute, reschedule and cancel what is assigned to them.
        "don.follow-up-planner.view",
        "don.follow-up-planner.schedule-follow-up",
        "don.follow-up-planner.mark-complete",
        "don.follow-up-planner.reschedule",
        "don.follow-up-planner.cancel-task"
    ];

    /// <summary>Every CAM code an Organisation role may hold.</summary>
    private static IReadOnlySet<string> CampaignModule { get; } =
        ModulePermissionCatalogue.Campaigns
            .Where(seed => !seed.IsPlatformOnly)
            .Select(seed => seed.Code)
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>Every DON code an Organisation role may hold.</summary>
    private static IReadOnlySet<string> DonorModule { get; } =
        ModulePermissionCatalogue.Donors
            .Where(seed => !seed.IsPlatformOnly)
            .Select(seed => seed.Code)
            .ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// The PAY codes the campaign screens read through, and the only thing outside CAM that a
    /// campaign role holds.
    ///
    /// Campaign Detail computes "raised to date", monthly revenue and donor counts from the
    /// donations attributed to the campaign, and that list is served by PAY's donation search.
    /// Without it the header figures fail to load for the very people who own the campaign.
    /// View only: donor contact stays masked, because <c>pay.donations.view-sensitive-donor</c>
    /// is not granted, and no PAY section appears in the sidebar because <c>PAY.View</c> is not
    /// either.
    /// </summary>
    private static IReadOnlyList<string> CampaignReadsFromPayments { get; } =
    [
        "pay.donations.view"
    ];

    /// <summary>
    /// Grants a system role USED TO HOLD and must no longer, per role code.
    ///
    /// WHY THIS LIST HAS TO EXIST. <c>ReconcileSystemRolePermissionsAsync</c> only ever ADDS the
    /// rows a definition is missing; it has never removed one, deliberately, because an
    /// Organisation administrator may have granted a system role something extra and a blanket
    /// "delete anything not in the profile" would silently undo their decision on every restart.
    ///
    /// The cost of that choice is that narrowing a role does not reach a database that has
    /// already run: the row is simply still there, and the role goes on holding a permission the
    /// profile says it does not have. So a narrowing has to be stated, and this is where. Each
    /// entry is removed from that role in every Organisation on start-up.
    ///
    /// THE EXECUTIVE / MANAGER SPLIT IS STATED HERE. Each working role must never hold the other
    /// half of its module, so the other half is listed against it: the Managers lose the
    /// Executive-only codes they held as "maker + checker", and the Fundraiser Executive loses the
    /// closing and cancelling verbs it held as the maker. The Campaign Executive held none of the
    /// Manager-only codes; its entry keeps it that way. Somebody who needs both halves is given
    /// the Organisation Admin role or a role the Organisation builds for itself - a built-in
    /// working role is kept to its half on every start.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyList<string>> WithdrawnGrants { get; } =
        new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
        {
            [RoleCodes.CampaignExecutive] = ManagerOnlyIn(CampaignModule),
            [RoleCodes.CampaignManager] = ExecutiveOnlyIn(CampaignModule),
            [RoleCodes.FundraiserExecutive] = ManagerOnlyIn(DonorModule),
            [RoleCodes.FundraisingManager] = ExecutiveOnlyIn(DonorModule)
        };


    /// <summary>Whether a code is the Executive's alone: Create or Submit, or named as such.</summary>
    private static bool IsExecutiveOnly(string code, PermissionAction action) =>
        ExecutiveOnlyCodes.Contains(code, StringComparer.Ordinal)
        || (action is PermissionAction.Create or PermissionAction.Submit
            && !ManagerOnlyCodes.Contains(code, StringComparer.Ordinal));

    /// <summary>Whether a code is the Manager's alone: Approve, or named as such.</summary>
    private static bool IsManagerOnly(string code, PermissionAction action) =>
        ManagerOnlyCodes.Contains(code, StringComparer.Ordinal)
        || (action == PermissionAction.Approve
            && !ExecutiveOnlyCodes.Contains(code, StringComparer.Ordinal));

    private static bool IsAdministratorOnly(string code) =>
        AdministratorOnlyCodes.Contains(code, StringComparer.Ordinal);

    /// <summary>The module's codes an Executive must not hold.</summary>
    private static IReadOnlyList<string> ManagerOnlyIn(IReadOnlySet<string> module) =>
    [
        .. TenantAssignable
            .Where(item => module.Contains(item.Code) && IsManagerOnly(item.Code, item.Action))
            .Select(item => item.Code)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>The module's codes a Manager must not hold.</summary>
    private static IReadOnlyList<string> ExecutiveOnlyIn(IReadOnlySet<string> module) =>
    [
        .. TenantAssignable
            .Where(item => module.Contains(item.Code) && IsExecutiveOnly(item.Code, item.Action))
            .Select(item => item.Code)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// The Executive half of a module: everything in it except the Manager's decisions and the
    /// administrator's own codes.
    /// </summary>
    private static IReadOnlyList<string> ExecutiveOf(IReadOnlySet<string> module) =>
    [
        .. TenantAssignable
            .Where(item => module.Contains(item.Code)
                           && !IsManagerOnly(item.Code, item.Action)
                           && !IsAdministratorOnly(item.Code))
            .Select(item => item.Code)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// The Manager half of a module: everything in it except the Executive's requests and
    /// verdicts and the administrator's own codes.
    /// </summary>
    private static IReadOnlyList<string> ManagerOf(IReadOnlySet<string> module) =>
    [
        .. TenantAssignable
            .Where(item => module.Contains(item.Code)
                           && !IsExecutiveOnly(item.Code, item.Action)
                           && !IsAdministratorOnly(item.Code))
            .Select(item => item.Code)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// CAMPAIGN EXECUTIVE: creates, edits and submits campaigns, tracking assets, readiness checks
    /// and budget plans, records Pass or Fail on each readiness check, and requests closures and
    /// disables - and approves, pauses, resumes and closes nothing.
    /// </summary>
    public static IReadOnlyList<string> CampaignExecutive { get; } =
    [
        .. ExecutiveOf(CampaignModule)
            .Concat(CampaignReadsFromPayments)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// CAMPAIGN MANAGER: approves or rejects a campaign's launch, pauses, resumes and closes it,
    /// and decides tracking assets, blockers and budgets - and creates, edits, submits, passes and
    /// fails nothing.
    ///
    /// ACTIVATING A CAMPAIGN BY HAND STAYS WITH THE ORGANISATION ADMIN - it is in
    /// <see cref="AdministratorOnlyCodes"/>, and an approved campaign set to activate automatically
    /// goes live on its start date without anybody pressing anything.
    /// </summary>
    public static IReadOnlyList<string> CampaignManager { get; } =
    [
        .. ManagerOf(CampaignModule)
            .Concat(CampaignReadsFromPayments)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// FUNDRAISER EXECUTIVE: captures and submits leads and donors, records donation intents, and
    /// works leads, donors and follow-ups - and approves, closes or cancels no record.
    /// </summary>
    public static IReadOnlyList<string> FundraiserExecutive { get; } = ExecutiveOf(DonorModule);

    /// <summary>
    /// FUNDRAISING MANAGER: approves donor records, closes leads, cancels identity checks and
    /// decides duplicates, and works leads, donors and follow-ups alongside the team - and creates
    /// no lead, donor or donation intent.
    /// </summary>
    public static IReadOnlyList<string> FundraisingManager { get; } = ManagerOf(DonorModule);
}
