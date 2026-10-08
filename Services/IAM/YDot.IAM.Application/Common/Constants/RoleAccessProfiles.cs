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
/// TWO RULES, THEN A MODULE. The maker and checker sets below are the platform's long-standing
/// split, unchanged:
///
///   maker    everything except approvals.
///   checker  view, edit, approve, export - plus the operations that follow a decision.
///
/// The job-shaped roles are those two sets confined to one module:
///
///   Campaign Executive    maker            within CAM
///   Campaign Manager      maker + checker  within CAM
///   Fundraiser Executive  maker            within DON
///   Fundraising Manager   maker + checker  within DON
///
/// THE PIVOT IS <c>PermissionAction</c>, not the verb in the code. CAM, DON and PAY declare their
/// action in <see cref="ModulePermissionCatalogue"/>; IAM and GM codes have theirs derived by
/// <see cref="PermissionCodeConventions"/>. That distinction is load-bearing:
/// <c>cam.campaigns.close</c> is declared Approve ("approve a closure request") while
/// <c>don.lead-work-queue.close</c> is declared Operate ("finish with this lead"). A rule reading
/// the word "close" would put one of them in the wrong role.
/// </summary>
public static class RoleAccessProfiles
{
    /// <summary>
    /// Decisions whose code does not spell the word "approve", and which the derivation in
    /// <see cref="PermissionCodeConventions"/> therefore files as Operate.
    ///
    /// These are IAM codes only - CAM, DON and PAY declare their own action and need no help.
    /// Each one ends a request rather than progressing it, so it belongs to the checker and must
    /// be kept out of the maker.
    /// </summary>
    private static readonly IReadOnlyList<string> AdditionalApprovalCodes =
    [
        // Refusing an access request is half of deciding it; the "approve" half is already
        // classified. Leaving this one with the maker would let the raiser close their own request.
        PermissionCodes.AccessRequestsReject,

        // Certifying or revoking access in a review campaign. The verb is "decide", which is
        // exactly what it does.
        PermissionCodes.AccessReviewsDecide
    ];

    /// <summary>
    /// The operational verbs a checker keeps, because they are what HAPPENS to a record once the
    /// decision has been taken.
    ///
    /// AN ALLOW-LIST, NOT A BLOCK-LIST, and deliberately so. Operate is the catch-all bucket - it
    /// holds activate and it also holds delete-draft, archive, void and merge - so a rule naming
    /// what to exclude would hand the checker a new destructive verb the day somebody adds one. This
    /// names the few to keep, so anything new stays out until a person decides otherwise.
    ///
    /// NOTHING HERE CREATES OR DESTROYS. That is the test each entry has to pass.
    /// </summary>
    private static readonly IReadOnlyList<string> PostApprovalOperations =
    [
        // ---- IAM: acting on a person's access after reviewing it ----------------------------
        PermissionCodes.UsersSuspend,
        PermissionCodes.UsersReactivate,
        PermissionCodes.RolesActivate,
        PermissionCodes.RolesDeactivate,

        // ---- Global masters: publishing and withdrawing a reference row ----------------------
        PermissionCodes.GlobalMaster.CountriesActivate, PermissionCodes.GlobalMaster.CountriesDeactivate,
        PermissionCodes.GlobalMaster.StatesActivate, PermissionCodes.GlobalMaster.StatesDeactivate,
        PermissionCodes.GlobalMaster.CitiesActivate, PermissionCodes.GlobalMaster.CitiesDeactivate,
        PermissionCodes.GlobalMaster.CurrenciesActivate, PermissionCodes.GlobalMaster.CurrenciesDeactivate,
        PermissionCodes.GlobalMaster.TimeZonesActivate, PermissionCodes.GlobalMaster.TimeZonesDeactivate,

        // ---- CAM: running a campaign that has been approved ----------------------------------
        //
        // PAUSE AND RESUME ARE THE CHECKER'S, and per the Campaign Management workflow they are
        // the checker's ALONE - see the note beside them in CheckerOnlyOperations. Returning a
        // campaign to draft is the checker sending work back, which is the other half of refusing
        // it.
        //
        // ACTIVATE IS NOT ON THIS LIST ANY MORE. The workflow names Activate under Tenant Admin
        // and under nobody else - Approver's line reads "Approve, Pause, Resume, Approve Close" -
        // so it moved to AdministratorOnlyCodes, which takes it away from both working roles
        // rather than handing it to one of them.
        "cam.campaigns.pause",
        "cam.campaigns.resume",
        "cam.tracking-assets.activate",

        // DECIDING A DISABLE REQUEST. `cam.tracking-assets.request-disable` is the maker's half
        // and is a Submit, so it stays out of this role by the action filter alone.
        "cam.tracking-assets.deactivate",

        // FAILING A READINESS CHECK IS THE OTHER HALF OF PASSING IT, and leaving it out gave
        // the checker the strange shape of one who could sign a check off but not record that
        // it was not ready. Pass is declared Approve and reaches this role through the action
        // filter; fail is declared Operate, so it has to be named here or the pair comes apart.
        // It stays with the maker too - noticing that something is not ready is the maker's job
        // as much as the checker's.
        "cam.readiness.fail",

        // RESOLVING A BLOCKER IS HERE; RAISING ONE IS NOT.
        //
        // `cam.readiness.manage-blockers` used to be on this list, back when raising and clearing
        // a blocker were the same code. They are two codes now, and only the second belongs to a
        // checker: raising an obstacle is the maker saying something is not ready, and declaring
        // it cleared is what unblocks the pass. One person holding both can wave away their own
        // flag, which is the one thing the blocker exists to prevent.
        "cam.readiness.resolve-blockers",

        "cam.readiness.return-to-draft",

        // ---- DON: decisions on a match and on an identity ------------------------------------
        // Rejecting a duplicate candidate is a decision. MERGING one is not on this list and must
        // never be: a merge takes two donors' donations, receipts and consent history and joins
        // them irreversibly, which is a destructive act however sound the reasoning behind it.
        "don.duplicate-review.reject-candidate",
        "don.donor-identity-verification.escalate-review",

        // ---- PAY: confirming what actually happened to the money -----------------------------
        // Reconciling matches what the gateway reported against what the bank received, and
        // verifying re-asks the gateway about one payment. Both read and confirm; neither moves
        // money, and neither can destroy a record.
        "pay.donations.reconcile",
        "pay.payments.verify"
    ];

    /// <summary>
    /// Approval-classified codes that the MAKER holds anyway.
    ///
    /// ONE ENTRY, AND IT IS A DELIBERATE PRODUCT DECISION rather than a hole in the rule.
    /// <c>cam.readiness.pass</c> is classified Approve because signing a readiness check off is a
    /// declaration that the campaign is ready on that point - but on the campaign checklist the
    /// person who DID the work is the one who knows the work is done, and the gate that actually
    /// protects the campaign is <c>cam.campaigns.approve</c>, which decides the launch itself and
    /// which no maker holds. Requiring a checker to tick off each individual line item made the
    /// checklist a second approval queue in front of the real one.
    ///
    /// THE FOUR-EYES RULE IS UNAFFECTED. A campaign still cannot be approved by the person who
    /// submitted it, and every check on the list being passed does not launch anything.
    ///
    /// Nothing else belongs here. An entry on this list is a maker signing something off, so each
    /// one needs an answer to "what stops them approving their own work", and
    /// <c>cam.campaigns.approve</c> is that answer for this one.
    /// </summary>
    private static readonly IReadOnlyList<string> MakerApprovalExceptions =
    [
        "cam.readiness.pass"
    ];

    /// <summary>
    /// Operate codes the MAKER must not hold, despite Operate being the maker's bucket.
    ///
    /// THE MIRROR OF <see cref="PostApprovalOperations"/>, and needed for the same reason: Operate
    /// is a catch-all, so a handful of genuinely decision-shaped verbs land in it. Each of these
    /// ends something a maker created, which is exactly the act the split exists to send to
    /// somebody else.
    /// </summary>
    private static readonly IReadOnlyList<string> CheckerOnlyOperations =
    [
        // PAUSING AND RESUMING A LIVE CAMPAIGN. Both used to sit with the maker, on the reasoning
        // that stopping the spend this afternoon is the maker's job and neither one starts or ends
        // anything.
        //
        // THE CAMPAIGN MANAGEMENT WORKFLOW PUTS THEM WITH THE CHECKER, and its role lines are
        // explicit about it: Initiator is "create Campaign (Draft/Submitted), Request Close" and
        // Approver is "Approve, Pause, Resume, Approve Close". Pausing a live campaign stops
        // solicitation against a launch a second person signed off, so the workflow treats
        // reversing that decision as belonging to whoever took it.
        //
        // THE MAKER KEEPS REQUEST CLOSE, which is how they raise the problem they have noticed.
        // Both codes stay on PostApprovalOperations, so the checker goes on holding them.
        "cam.campaigns.pause",
        "cam.campaigns.resume",

        // TAKING A TRACKING ASSET LIVE. The workflow's asset line stops the maker at "Create Asset
        // -> Draft/Submit -> Request Disable", and activation is the step after approval - it is
        // where the tracking reference and the generated URL are actually minted, which is the
        // moment the asset starts attributing real money. A maker who could both submit an asset
        // and mint it has completed both halves of the asset's approval.
        //
        // IT STAYS WITH THE CHECKER, unlike the campaign verb above which went to the
        // administrator alone. The difference is that a campaign has an automatic route to Active
        // - CampaignActivationService takes a Scheduled campaign live on its start date with
        // nobody involved - and an asset has none. Withholding it from the checker as well would mean
        // no tracking asset could ever go live without an Organisation Administrator, and the
        // workflow lists Active under Tenant Admin's "All Access" rather than as theirs alone.
        "cam.tracking-assets.activate",

        // SENDING A READINESS CHECKLIST BACK TO DRAFT. The workflow's readiness lines give the
        // maker "Create checklist -> pass/Fail, Assign Blocker" and Request Approval; returning
        // the work is the other half of refusing it, and belongs with whoever the approval was
        // sent to. It stays on PostApprovalOperations, so the checker keeps it.
        "cam.readiness.return-to-draft",

        // TURNING A ROLE ON. Role creation runs draft -> submit -> activate for the same reason
        // campaigns do: a role is a grant of permissions, and the person who chose the permissions
        // must not be the person who makes them effective. INITIATOR held
        // `iam.roles.activate` through the same gap as the campaign verb above, so a role drafted
        // and submitted by a maker was activated by that same maker and the approval step in the
        // middle was decorative.
        PermissionCodes.RolesActivate,

        // DISABLING A LIVE TRACKING ASSET. It stops a printed QR code and a circulated short link
        // resolving, so the campaign stops being able to attribute anything that arrives through
        // them - not recoverable by reprinting. The maker asks with
        // `cam.tracking-assets.request-disable` and a checker decides.
        "cam.tracking-assets.deactivate",

        // CLEARING A BLOCKER. See the note on the pair in PostApprovalOperations: raising one and
        // waving it away must not be the same person's call.
        "cam.readiness.resolve-blockers"
    ];

    /// <summary>
    /// CAM codes the CHECKER does not hold, beyond what the action filter already excludes.
    ///
    /// A checker's business on a campaign is to approve it, refuse it, or read it. Editing the
    /// campaign, its tracking assets or its checklist is the maker's work, and a checker who
    /// edits the thing they are about to approve has approved their own change. Edit is admitted
    /// platform-wide by the action filter - these three are the campaign module's exceptions.
    /// </summary>
    private static readonly IReadOnlyList<string> CheckerExcludedCodes =
    [
        "cam.campaigns.edit",
        "cam.tracking-assets.edit",
        "cam.readiness.edit"
    ];

    /// <summary>
    /// Codes NEITHER system role holds, because they belong to an administrator and to nobody
    /// else.
    ///
    /// WHY A THIRD EXCLUSION LIST. The two above are each one-sided:
    /// <see cref="CheckerOnlyOperations"/> takes a code away from the maker and
    /// <see cref="CheckerExcludedCodes"/> takes one away from the checker. A code that belongs to
    /// neither would have to appear in both, which reads as two unrelated decisions and invites
    /// somebody to "tidy up" one half of it later.
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
        // The Campaign Management workflow lists Activate under Tenant Admin only. Initiator's
        // line is "create Campaign (Draft/Submitted), Request Close" and Approver's is "Approve,
        // Pause, Resume, Approve Close" - the contrast is deliberate, because the two names appear
        // in the same block and only one of them carries the verb.
        //
        // NOTHING IS STRANDED BY IT. Approving a campaign whose start date is still ahead leaves
        // it Scheduled, and CampaignActivationService takes a Scheduled campaign live on its start
        // date with no person involved at all. Manual activation is the exception - bringing a
        // launch forward, or starting a campaign approved on or after its own start date - and the
        // workflow puts that in the administrator's hands.
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
    /// Every code that represents an approval decision, however its verb is spelled.
    ///
    /// This is the set the maker is defined by NOT holding, so it is the one place to look when
    /// asking whether the maker-checker split is intact.
    /// </summary>
    public static IReadOnlyList<string> ApprovalCodes { get; } =
    [
        .. TenantAssignable
            .Where(item => item.Action == PermissionAction.Approve)
            .Select(item => item.Code),

        .. AdditionalApprovalCodes
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
    /// entry is removed from that role in every Organisation, once, on start-up.
    ///
    /// EMPTY SINCE THE ROLE CATALOGUE WAS RESET. Every entry here named INITIATOR or APPROVER,
    /// and the database was rebuilt from nothing when those two roles were replaced, so there is
    /// no existing grant left for any of them to withdraw.
    ///
    /// AN ENTRY HERE IS A DELIBERATE REMOVAL OF ACCESS SOMEBODY CURRENTLY HAS. Add one only when
    /// the role genuinely must not keep the right, and say why - as opposed to simply not
    /// granting a code to begin with, which needs nothing here.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyList<string>> WithdrawnGrants { get; } =
        new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);

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
    /// DONORCARE: nothing yet, deliberately.
    ///
    /// The role exists, is active and can be assigned, but which screens supporter care works in
    /// has not been decided - its menus are to be mapped later. An empty grant is the honest
    /// encoding of that: a member signs in to the dashboard and My Security, and every other
    /// screen stays closed until somebody chooses what this team should reach. Filling it in is
    /// a change to this list, and the start-up reconciliation carries it to every Organisation.
    /// </summary>
    public static IReadOnlyList<string> DonorCare { get; } = [];

    /// <summary>
    /// The maker: create, view, edit, submit, operate and export - and no approval of any kind.
    ///
    /// What INITIATOR used to hold across every module. Never granted whole any more: each
    /// Executive role takes the slice of it that belongs to its own module.
    /// </summary>
    private static IReadOnlyList<string> Maker { get; } =
    [
        .. TenantAssignable
            .Select(item => item.Code)
            .Where(code => !ApprovalCodes.Contains(code, StringComparer.Ordinal))
            .Concat(MakerApprovalExceptions)
            .Where(code => !CheckerOnlyOperations.Contains(code, StringComparer.Ordinal))
            .Where(code => !AdministratorOnlyCodes.Contains(code, StringComparer.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// The checker: view, edit, approve and export, plus <see cref="PostApprovalOperations"/> -
    /// and no creation and no deletion.
    ///
    /// Create is excluded by the action filter, since <c>Create</c> is not one of the four
    /// actions admitted. Deletion is excluded the same way: every destructive verb in the
    /// catalogue - delete, delete-draft, archive, void, cancel, withdraw, merge - is declared or
    /// derived as <c>Operate</c>, and Operate enters this set only by being named explicitly
    /// above.
    ///
    /// What APPROVER used to hold across every module. Each Manager role adds the slice of it
    /// that belongs to its own module to the maker's slice.
    /// </summary>
    private static IReadOnlyList<string> Checker { get; } =
    [
        .. TenantAssignable
            .Where(item => item.Action is PermissionAction.View
                                       or PermissionAction.Edit
                                       or PermissionAction.Approve
                                       or PermissionAction.Export)
            .Select(item => item.Code)
            .Concat(AdditionalApprovalCodes)
            .Concat(PostApprovalOperations)
            .Where(code => !CheckerExcludedCodes.Contains(code, StringComparer.Ordinal))
            .Where(code => !AdministratorOnlyCodes.Contains(code, StringComparer.Ordinal))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
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
    /// CAMPAIGN EXECUTIVE: the maker, inside CAM. Creates, edits and submits campaigns, tracking
    /// assets, readiness checks and budget plans, and requests a closure - and approves none of
    /// it. Everything raised here stops at the approval gate for a Campaign Manager.
    /// </summary>
    public static IReadOnlyList<string> CampaignExecutive { get; } =
    [
        .. Maker
            .Where(CampaignModule.Contains)
            .Concat(CampaignReadsFromPayments)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// CAMPAIGN MANAGER: maker and checker together, inside CAM.
    ///
    /// A Manager prepares campaigns as well as deciding them, which is how campaign teams work
    /// and how the Campaign Manager role worked before the catalogue was cut to INITIATOR and
    /// APPROVER. The four-eyes rule does not depend on keeping the two halves apart any more:
    /// CAM refuses an approval from whoever created or submitted the campaign, the asset or the
    /// budget version, so a Manager can decide an Executive's work and never their own.
    ///
    /// ACTIVATING A CAMPAIGN BY HAND STAYS WITH THE ORGANISATION ADMIN - it is in
    /// <see cref="AdministratorOnlyCodes"/>, and an approved campaign goes live on its start date
    /// without anybody pressing anything.
    /// </summary>
    public static IReadOnlyList<string> CampaignManager { get; } =
    [
        .. Maker
            .Concat(Checker)
            .Where(CampaignModule.Contains)
            .Concat(CampaignReadsFromPayments)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// FUNDRAISER EXECUTIVE: the maker, inside DON. Captures, qualifies, contacts, assigns and
    /// follows up leads and donors - and approves no donor record.
    /// </summary>
    public static IReadOnlyList<string> FundraiserExecutive { get; } =
    [
        .. Maker
            .Where(DonorModule.Contains)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];

    /// <summary>
    /// FUNDRAISING MANAGER: maker and checker together, inside DON - everything a Fundraiser
    /// Executive does, plus approving donor records and the decisions on duplicate candidates and
    /// escalated identity checks.
    /// </summary>
    public static IReadOnlyList<string> FundraisingManager { get; } =
    [
        .. Maker
            .Concat(Checker)
            .Where(DonorModule.Contains)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
    ];
}
