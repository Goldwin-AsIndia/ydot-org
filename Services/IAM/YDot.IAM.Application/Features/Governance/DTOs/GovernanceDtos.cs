using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.Governance.DTOs;

// =====================================================================================
// Access requests
// =====================================================================================

/// <summary>
/// Asking for access somebody does not currently have.
///
/// <c>BusinessJustification</c> is not decoration. It is the thing an auditor reads a year
/// later to understand why a permission was granted, so it is 10 to 1000 characters and
/// mandatory.
/// </summary>
public sealed record CreateAccessRequestRequest(
    Guid RequestedForUserId,
    AccessRequestType RequestType,
    string BusinessJustification,
    Guid? RoleId = null,
    string? PermissionCode = null,
    DataScopeType? ScopeType = null,
    string? ScopeValue = null,
    DateTimeOffset? AccessStartsAtUtc = null,

    /// <summary>Required for temporary access. Null means a permanent grant.</summary>
    DateTimeOffset? AccessEndsAtUtc = null,

    /// <summary>Submits straight away rather than leaving it as a draft.</summary>
    bool SubmitImmediately = true);

/// <summary>
/// Editing a draft, or a request that was sent back.
///
/// A field left null is left as it is. The two flags exist because null cannot also mean "remove":
/// an end date or a scope that was typed by mistake has to be removable.
/// </summary>
public sealed record UpdateAccessRequestRequest(
    long ExpectedVersion,
    string? BusinessJustification = null,
    Guid? RoleId = null,
    DateTimeOffset? AccessStartsAtUtc = null,
    DateTimeOffset? AccessEndsAtUtc = null,
    string? PermissionCode = null,
    DataScopeType? ScopeType = null,
    string? ScopeValue = null,

    /// <summary>Removes the end date, making the request one for permanent access.</summary>
    bool RemoveAccessEndDate = false);

/// <summary>Submitting a draft for a decision.</summary>
public sealed record SubmitAccessRequestRequest(long ExpectedVersion, string? Comment = null);

/// <summary>
/// Deciding a request.
///
/// The approver may not be the requester — checked in the handler, not only on the screen.
/// Approval writes the actual assignment and stamps it with this request id, so the grant can
/// always be traced back to the justification that earned it.
/// </summary>
public sealed record DecideAccessRequestRequest(
    bool Approved,
    long ExpectedVersion,
    string? Notes = null,

    /// <summary>Lets the approver grant less than was asked for.</summary>
    DateTimeOffset? AccessEndsAtUtc = null);

/// <summary>
/// Sending a request back for more information.
///
/// NOT A REJECTION, and the difference matters to the person on the other end. A rejection is a
/// decision — the answer is no. A return says the approver cannot answer yet, almost always
/// because the justification does not explain what the access is actually for. The request keeps
/// its number and its history and goes back to the requester to be improved.
/// </summary>
public sealed record ReturnAccessRequestRequest(string Reason, long ExpectedVersion);

/// <summary>Handing a review to somebody better placed to answer it.</summary>
public sealed record DelegateAccessReviewRequest(
    Guid ReviewerUserId,
    string Reason,
    long ExpectedVersion);

/// <summary>
/// Escalating a review the reviewer cannot answer.
///
/// Mechanically the same handover as a delegation; different in meaning, and recorded as such. A
/// delegation says "you are better placed to answer this". An escalation says "this access looks
/// wrong and removing it is above my authority", which is exactly the signal a governance report
/// should be able to count.
/// </summary>
public sealed record EscalateAccessReviewRequest(
    Guid EscalateToUserId,
    string Reason,
    long ExpectedVersion);

/// <summary>Withdrawing a request before it is decided.</summary>
public sealed record WithdrawAccessRequestRequest(string Reason, long ExpectedVersion);

// =====================================================================================
// Access reviews
// =====================================================================================

/// <summary>Raising a batch of reviews.</summary>
public sealed record CreateAccessReviewCampaignRequest(
    string Name,
    DateTimeOffset DueAtUtc,
    string? Code = null,
    string? Description = null,
    DateTimeOffset? StartsAtUtc = null,

    /// <summary>
    /// Treats anything still open at the due date as Revoke rather than Retain. Failing
    /// closed is the right default for a recertification: silence should not renew access.
    /// </summary>
    bool RevokeOnNoResponse = false,

    /// <summary>Limits the campaign to these roles. Empty reviews every assignment.</summary>
    IReadOnlyList<Guid>? RoleIds = null,

    /// <summary>Limits the campaign to these users. Empty reviews everybody.</summary>
    IReadOnlyList<Guid>? UserIds = null,

    /// <summary>Only the assignments that carry a sensitive permission.</summary>
    bool SensitiveOnly = false);

/// <summary>Raising a single review outside any campaign.</summary>
public sealed record CreateAccessReviewRequest(
    Guid SubjectUserId,
    Guid ReviewerUserId,
    DateTimeOffset ReviewDueAtUtc,
    Guid? UserRoleId = null,
    Guid? RoleId = null);

/// <summary>
/// Recording a decision. A reason is required for Modify and Revoke, because those are the
/// two that take something away and the person losing it deserves an explanation.
/// </summary>
public sealed record DecideAccessReviewRequest(
    AccessReviewDecision Decision,
    long ExpectedVersion,
    string? DecisionReason = null,

    /// <summary>
    /// Carries the decision out immediately. When false it is recorded and applied when the
    /// campaign closes, which is how a batch recertification usually runs.
    /// </summary>
    bool ApplyImmediately = true);

/// <summary>Cancelling a review or a campaign.</summary>
public sealed record CancelAccessReviewRequest(string Reason, long ExpectedVersion);

/// <summary>Closing a campaign and applying every outstanding decision.</summary>
public sealed record CloseAccessReviewCampaignRequest(long ExpectedVersion, string? Notes = null);

// =====================================================================================
// Responses
// =====================================================================================

/// <summary>One row of the access request queue.</summary>
public sealed record AccessRequestListItemResponse(
    Guid Id,
    string RequestNumber,
    Guid RequestedForUserId,
    string RequestedForName,
    string RequestedByName,
    AccessRequestType RequestType,
    string RequestTypeDisplay,
    string? RoleName,
    string? PermissionCode,
    AccessRequestStatus Status,
    string StatusDisplay,
    bool IsSensitive,
    DateTimeOffset? SubmittedAtUtc,
    DateTimeOffset AccessStartsAtUtc,
    DateTimeOffset? AccessEndsAtUtc,
    DateTimeOffset? DecidedAtUtc,
    string? DecidedByName,

    /// <summary>True when the current caller may decide this one, so the queue can highlight it.</summary>
    bool CanDecide,

    /// <summary>True only for the person who raised the request, while it is still undecided.</summary>
    bool CanCancel,

    long Version,

    /// <summary>
    /// What the access is narrowed to, when the request names a scope. ON THE ROW because the
    /// queue and the decision dialog both show it: without it the screen printed "Whole
    /// organisation" for every request, so an approver deciding a campaign-scoped request was
    /// shown a scope nobody had asked for.
    /// </summary>
    DataScopeType? ScopeType = null,
    string? ScopeValue = null,

    /// <summary>The scope type in the words the reference data uses for it.</summary>
    string? ScopeTypeDisplay = null,

    /// <summary>The permission's name, when the request is for a single permission.</summary>
    string? PermissionName = null,

    /// <summary>
    /// What THIS caller may do with THIS request: View, Edit, Submit, Withdraw, Approve, Reject,
    /// Return. Worked out from the state, the caller's permissions and the independence rule, so
    /// the queue draws its buttons from here and offers nothing the API would refuse.
    /// </summary>
    IReadOnlyList<string>? PermittedActions = null,

    /// <summary>Why the caller may not decide a request that is waiting. Null when they may.</summary>
    string? CannotDecideReason = null);

/// <summary>
/// The figures above the access request queue, for the same filter the queue is showing.
///
/// COUNTED BY THE SERVER, over every matching request. The screen used to count the rows it had
/// been given, which is a count of one page as soon as the queue is paged.
/// </summary>
public sealed record AccessRequestSummaryResponse(
    int Total,
    int Approved,

    /// <summary>Waiting on somebody: submitted for a decision, or sent back to the requester.</summary>
    int Pending,

    int Rejected,

    /// <summary>How many different people the matching requests are for.</summary>
    int UsersInvolved,

    /// <summary>The person with the most matching requests raised for them. Null when there are none.</summary>
    string? MostActiveUserName,

    int MostActiveUserRequestCount,

    /// <summary>Every status with its count, zero included, in the order the status filter lists them.</summary>
    IReadOnlyList<AccessRequestStatusCount> ByStatus);

/// <summary>One status and how many matching requests are in it.</summary>
public sealed record AccessRequestStatusCount(AccessRequestStatus Status, string StatusDisplay, int Count);

/// <summary>One row of a CSV export of the access request queue.</summary>
public sealed record AccessRequestExportRow(
    string RequestNumber,
    string RequestType,
    string RequestedFor,
    string RequestedBy,
    string? Role,
    string? Permission,
    string? ScopeType,
    string? ScopeValue,
    string Status,
    bool Sensitive,
    DateTimeOffset? SubmittedAtUtc,
    DateTimeOffset AccessStartsAtUtc,
    DateTimeOffset? AccessEndsAtUtc,
    DateTimeOffset? DecidedAtUtc,
    string? DecidedBy,
    string? DecisionNotes,
    string BusinessJustification);

/// <summary>A request with everything a decision needs.</summary>
public sealed record AccessRequestDetailResponse(
    Guid Id,
    string RequestNumber,
    Guid RequestedForUserId,
    string RequestedForName,
    string RequestedForEmail,
    Guid RequestedByUserId,
    string RequestedByName,
    AccessRequestType RequestType,
    string RequestTypeDisplay,
    Guid? RoleId,
    string? RoleName,
    string? PermissionCode,
    DataScopeType? ScopeType,
    string? ScopeValue,
    string BusinessJustification,
    DateTimeOffset AccessStartsAtUtc,
    DateTimeOffset? AccessEndsAtUtc,
    AccessRequestStatus Status,
    string StatusDisplay,
    bool IsSensitive,
    DateTimeOffset? SubmittedAtUtc,
    DateTimeOffset? DecidedAtUtc,
    Guid? DecidedByUserId,
    string? DecidedByName,
    string? DecisionNotes,
    DateTimeOffset? WithdrawnAtUtc,
    string? WithdrawalReason,
    Guid? GrantedUserRoleId,
    DateTimeOffset CreatedAtUtc,
    long Version,

    /// <summary>What the requested access would add, so the approver sees the consequence.</summary>
    IReadOnlyList<string> PermissionsGranted,

    IReadOnlyList<string> SegregationOfDutiesConflicts,
    bool CanDecide,
    IReadOnlyList<string> PermittedActions,

    /// <summary>The scope type in the words the reference data uses for it.</summary>
    string? ScopeTypeDisplay = null,

    /// <summary>The permission's name, when the request is for a single permission.</summary>
    string? PermissionName = null,

    /// <summary>What the approver asked for when sending the request back, and who and when.</summary>
    string? ReturnReason = null,
    DateTimeOffset? ReturnedAtUtc = null,
    string? ReturnedByName = null,

    /// <summary>How many times the request has been sent back.</summary>
    int ReturnCount = 0,

    /// <summary>When an undecided request lapses.</summary>
    DateTimeOffset? ExpiresAtUtc = null,

    /// <summary>True for the person who raised the request, while it is still undecided.</summary>
    bool CanCancel = false,

    /// <summary>Why the caller may not decide a request that is waiting. Null when they may.</summary>
    string? CannotDecideReason = null);

/// <summary>One row of the review queue.</summary>
public sealed record AccessReviewListItemResponse(
    Guid Id,
    string ReviewNumber,
    Guid? CampaignId,
    string? CampaignName,
    Guid SubjectUserId,
    string SubjectName,
    string ReviewerName,
    string? RoleName,
    AccessReviewStatus Status,
    string StatusDisplay,
    AccessReviewDecision? Decision,
    DateTimeOffset ReviewDueAtUtc,
    bool IsOverdue,
    DateTimeOffset? DecidedAtUtc,
    bool IsDecisionApplied,
    bool IsAssignedToMe,
    long Version);

/// <summary>A review with the snapshot of what is being recertified.</summary>
public sealed record AccessReviewDetailResponse(
    Guid Id,
    string ReviewNumber,
    Guid? CampaignId,
    string? CampaignName,
    Guid SubjectUserId,
    string SubjectName,
    string SubjectEmail,
    Guid ReviewerUserId,
    string ReviewerName,
    Guid? UserRoleId,
    Guid? RoleId,
    string? RoleName,
    DateTimeOffset ReviewDueAtUtc,
    AccessReviewDecision? Decision,
    string? DecisionReason,
    DateTimeOffset? DecidedAtUtc,
    AccessReviewStatus Status,
    string StatusDisplay,
    bool IsOverdue,
    bool IsDecisionApplied,
    DateTimeOffset? DecisionAppliedAtUtc,
    int ReminderCount,
    DateTimeOffset? LastRemindedAtUtc,
    long Version,

    /// <summary>
    /// What the person held when the review was raised. A snapshot rather than a live read,
    /// so a later change cannot quietly alter what the reviewer was actually asked about.
    /// </summary>
    IReadOnlyList<string> AccessSnapshot,

    IReadOnlyList<string> PermittedActions);

/// <summary>A campaign with its progress counts.</summary>
public sealed record AccessReviewCampaignResponse(
    Guid Id,
    string Code,
    string Name,
    string? Description,
    AccessReviewCampaignStatus Status,
    string StatusDisplay,
    DateTimeOffset StartsAtUtc,
    DateTimeOffset DueAtUtc,
    DateTimeOffset? ClosedAtUtc,
    string? ClosedByName,
    int TotalReviewCount,
    int CompletedReviewCount,
    int OverdueReviewCount,
    int PercentComplete,
    bool RevokeOnNoResponse,
    DateTimeOffset CreatedAtUtc,
    long Version,
    IReadOnlyList<string> PermittedActions);

/// <summary>IAM-USR-05 request state, shared with the Users slice.</summary>
public sealed record LoginIdentifierChangeResponse(
    Guid Id,
    Guid UserId,
    string UserDisplayName,
    bool IsEmailChange,
    string CurrentValue,
    string RequestedValue,
    LoginIdentifierChangeStatus Status,
    string StatusDisplay,
    DateTimeOffset RequestedAtUtc,
    string? RequestedByName,
    string? Reason,
    DateTimeOffset? VerifiedAtUtc,
    DateTimeOffset? PreviousOwnerNotifiedAtUtc,
    DateTimeOffset? ApprovedAtUtc,
    string? ApprovedByName,
    DateTimeOffset? RejectedAtUtc,
    string? RejectionReason,
    DateTimeOffset? AppliedAtUtc,
    DateTimeOffset? ExpiresAtUtc,
    bool RequiresApproval,
    long Version,
    IReadOnlyList<string> PermittedActions);
