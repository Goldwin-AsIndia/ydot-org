using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.Donors.DTOs;

namespace YDots.DON.Application.Features.Donor360.DTOs;

/// <summary>
/// SCR-DON-003 GET. One payload per panel in the field contract, so the screen makes a single
/// call and every tab already has its content.
/// </summary>
public sealed record Donor360Response(
    string ScreenId,
    string Route,
    string DonorReference,
    DonorDetailResponse Donor,
    IdentityAndContactSummaryResponse IdentityAndContactSummary,
    RelationshipOwnerResponse? RelationshipOwner,
    ConsentStatusResponse ConsentStatus,
    IReadOnlyList<CommunicationPreferenceResponse> CommunicationPreferences,
    IReadOnlyList<DonationTotalResponse> DonationTotalsByStage,
    IReadOnlyList<CampaignHistoryResponse> CampaignHistory,
    IReadOnlyList<ConversationResponse> Conversations,
    IReadOnlyList<Donor360FollowUpResponse> FollowUps,
    IReadOnlyList<PromiseResponse> Promises,
    IReadOnlyList<DocumentResponse> Documents,
    IReadOnlyList<DuplicateLinkResponse> DuplicateLinks,
    IReadOnlyList<ActivityHistoryResponse> ActivityHistory,
    IReadOnlyList<string> PermittedActions,
    IReadOnlyList<string> MaskedFields,
    string ActiveScope,
    string State,

    /// <summary>
    /// Every gift, newest first, as the payments module recorded it. The Donations tab used to
    /// show stage totals only, so a donor's actual gifts were nowhere on the 360 view.
    /// </summary>
    IReadOnlyList<DonationResponse> Donations,

    /// <summary>All / Open / Overdue / Closed for the Follow-ups tab, counted with each row's <c>View</c>.</summary>
    IReadOnlyList<QueueViewResponse>? FollowUpViews = null,

    /// <summary>The pledge form's quick amounts, from the organisation's settings.</summary>
    IReadOnlyList<decimal>? PledgeAmountPresets = null);

/// <summary>One gift on the Donations tab.</summary>
public sealed record DonationResponse(
    Guid Id,
    string Reference,
    DateTimeOffset DonatedAtUtc,
    decimal Amount,
    decimal RefundedAmount,
    string Currency,
    string Status,
    string? CampaignName,

    /// <summary>The status in words ("Partially refunded"); <see cref="Status"/> stays PAY's value.</summary>
    string? StatusLabel = null);

/// <summary>"Identity and contact summary". Restricted: masked unless separately permitted.</summary>
public sealed record IdentityAndContactSummaryResponse(
    string DisplayName,
    string DonorType,
    string? PrimaryEmail,
    string? PrimaryPhone,
    string PreferredLanguage,
    bool DoNotContact,
    IReadOnlyList<DonorContactResponse> AdditionalContacts,
    IReadOnlyList<DonorTagResponse> Tags,
    bool IsMasked);

/// <summary>One additional contact row.</summary>
public sealed record DonorContactResponse(
    Guid Id,
    string Name,
    string? Description,
    string Channel,
    string Value,
    bool IsPrimary,
    bool IsVerified,
    string Status,
    bool IsMasked);

/// <summary>One tag attached to the donor.</summary>
public sealed record DonorTagResponse(Guid Id, string Code, string Name, string? Description, string Status);

/// <summary>Who owns the relationship today.</summary>
public sealed record RelationshipOwnerResponse(Guid UserId, string? Name);

/// <summary>The badge at the top of the consent panel.</summary>
public sealed record ConsentStatusResponse(
    string OverallState,
    int GrantedChannelCount,
    int WithdrawnChannelCount,
    DateTimeOffset? LastRecordedAtUtc,
    string? NoticeVersion);

/// <summary>One channel and what the donor said about it.</summary>
public sealed record CommunicationPreferenceResponse(
    string Channel,
    string ConsentState,
    string Status,
    DateTimeOffset? EffectiveAtUtc,
    DateTimeOffset? ExpiryAtUtc,
    bool PublicRecognitionPreference,

    /// <summary>The channel and the consent state as every Donors screen words them ("Call", "Not provided").</summary>
    string? ChannelLabel = null,
    string? ConsentStateLabel = null,

    /// <summary>The consent record in force for the channel, or null when nothing has been recorded.</summary>
    Guid? ConsentId = null,

    /// <summary>That record's version, which a withdrawal must send back.</summary>
    long? Version = null,

    /// <summary>
    /// What this caller may do to the channel's consent from Donor 360: "Grant" and/or "Withdraw",
    /// decided from the consent state and the Consent Centre's grant and withdraw permissions.
    ///
    /// THE UPDATE HAPPENS HERE NOW. Donor 360 used to offer only a Manage button that opened the
    /// Consent Centre on another page.
    /// </summary>
    IReadOnlyList<string>? PermittedActions = null);

/// <summary>
/// One row of "Donation totals by stage". Carries its own cut-off and freshness because the
/// numbers are owned by another section.
/// </summary>
public sealed record DonationTotalResponse(
    string Stage,
    string Currency,
    decimal TotalAmount,
    int TransactionCount,
    DateTimeOffset AsAtUtc,
    DateTimeOffset RefreshedAtUtc,
    string SourceFreshness);

/// <summary>One campaign the donor arrived through.</summary>
public sealed record CampaignHistoryResponse(
    Guid CampaignId,
    string CampaignCode,
    string CampaignName,
    string LeadReference,
    DateTimeOffset? ConvertedAtUtc,

    // ---- What the donor gave to the campaign -----------------------------------------------------
    //
    // THE ROW USED TO CARRY NO MONEY, and the screen printed 0 against every campaign. A campaign
    // appears here because the donor's lead came from it, because they gave to it, or both.
    decimal Amount,
    int GiftCount,
    DateTimeOffset? LastGiftAtUtc);

/// <summary>One conversation from the interaction log.</summary>
public sealed record ConversationResponse(
    Guid Id,
    string Name,
    string? Description,
    string InteractionType,
    string? Channel,
    DateTimeOffset OccurredAtUtc,
    string Outcome,
    string? PerformedByName,
    string Status,

    /// <summary>How it happened in words - the channel ("Call"), or the interaction type when it had none.</summary>
    string? ChannelLabel = null);

/// <summary>One open follow-up, shown on the 360 view rather than only on the planner.</summary>
public sealed record Donor360FollowUpResponse(
    Guid Id,
    string FollowUpReference,
    string? NextAction,
    DateTimeOffset? DueAtUtc,
    string Priority,
    string Status,
    string? RelationshipOwnerName,

    // ---- What the Follow-ups tab needs to tell open from overdue from closed ----------------------
    //
    // "OVERDUE" IS NOT A STATUS - the server's statuses are Planned, Assigned, Rescheduled,
    // Completed and Cancelled - so the tab's Overdue view counted a status that never arrived and
    // always read 0. It is a fact about an open task's due date, computed here.
    bool IsOpen,
    bool IsOverdue,
    bool IsAssignedToMe,
    string Channel,
    string? Purpose,
    DateTimeOffset? CompletedAtUtc,
    string? CompletionOutcome,

    // Whether THIS caller may execute it: the assignee, or the Organisation Admin, while it is
    // open and the caller may complete follow-ups. The tab draws Execute from this.
    bool CanExecute,

    /// <summary>open / overdue / closed - the Follow-ups tab view this row belongs to.</summary>
    string View = "",

    /// <summary>"Overdue" for an open follow-up past its date, otherwise the Follow-up Queue's status word.</summary>
    string StatusLabel = "",

    /// <summary>The channel in the Follow-up Queue's words ("Call", "SMS").</summary>
    string ChannelLabel = "");

/// <summary>One pledge.</summary>
public sealed record PromiseResponse(
    Guid Id,
    string Reference,
    decimal Amount,
    string Currency,
    DateTimeOffset PromisedAtUtc,
    DateTimeOffset? DueAtUtc,
    string Status,
    string? CampaignName,

    /// <summary>The status in words ("Partly fulfilled").</summary>
    string? StatusLabel = null);

/// <summary>One linked document. Confidential rows never reach an unpermitted caller.</summary>
public sealed record DocumentResponse(
    Guid Id,
    string Reference,
    string Name,
    string? Description,
    string Classification,
    string? ScanStatus,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? ExpiresAtUtc);

/// <summary>One duplicate review that mentions this donor.</summary>
public sealed record DuplicateLinkResponse(
    Guid MergeCaseId,
    string ReviewReference,
    string Status,
    string IdentityConfidence,
    string? Decision,
    string ComparisonRoute);

/// <summary>One row of the audit-relevant chronology.</summary>
public sealed record ActivityHistoryResponse(
    Guid Id,
    string ActionCode,
    string TargetType,
    string Result,
    string? Reason,
    DateTimeOffset OccurredAtUtc,
    string CorrelationId,

    /// <summary>Who did it. The panel used to print the record type in the "by" column.</summary>
    string? ActorName);

/// <summary>SCR-DON-003 Create intent body. Records a stated giving intention as a promise.</summary>
public sealed class CreateIntentRequest
{
    public decimal Amount { get; set; }

    public string Currency { get; set; } = "INR";

    public DateTimeOffset? DueAtUtc { get; set; }

    public Guid? CampaignId { get; set; }

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string Notes { get; set; } = string.Empty;
}
