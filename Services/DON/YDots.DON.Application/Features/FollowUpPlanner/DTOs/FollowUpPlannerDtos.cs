using YDots.DON.Application.Common.Models;

namespace YDots.DON.Application.Features.FollowUpPlanner.DTOs;

/// <summary>GET /api/v1/donors/follow-up-planner. Tasks plus every catalogue the form needs.</summary>
public sealed record FollowUpPlannerResponse(
    string ScreenId,
    string Route,
    PagedResponse<FollowUpResponse> FollowUps,
    IReadOnlyList<LookupItem> ChannelOptions,
    IReadOnlyList<LookupItem> PriorityOptions,
    IReadOnlyList<LookupItem> StatusOptions,
    IReadOnlyList<LookupItem> LanguageOptions,
    IReadOnlyList<LookupItem> OwnerOptions,
    string CurrentNoticeVersion,
    IReadOnlyList<string> PermittedActions,
    string ActiveFilterSummary,
    string ActiveScope,
    string State,
    FollowUpQueueSummaryResponse Summary,

    // ---- The Follow-up Execution form's own lists -----------------------------------------------
    IReadOnlyList<LookupItem> ExecutionStatusOptions,
    IReadOnlyList<LookupItem> CompletionReasonOptions,
    IReadOnlyList<LookupItem> DispositionOptions,

    /// <summary>How the contact was actually made - calls, messages, meetings and visits.</summary>
    IReadOnlyList<LookupItem> ContactChannelOptions);

/// <summary>
/// The Follow-up Queue's headline figures, counted over the caller's whole scope rather than the
/// page - so a tile reading "Overdue 7" means seven, whichever page is on screen.
///
/// "TODAY" IS THE ORGANISATION'S DAY, not the server's: a follow-up due at 01:00 IST is due today
/// in Chennai although it is still yesterday in UTC.
/// </summary>
public sealed record FollowUpQueueSummaryResponse(
    int Total,
    int Open,
    int DueToday,
    int Upcoming,
    int Overdue,
    int CompletedToday,
    int Escalated,
    int AssignedToMe,

    // ---- The queue's health panel ------------------------------------------------------------------
    //
    // The screen used to derive all three from the rows it had loaded - one page of them - and
    // from a status, "Pending", the API does not have, so the panel read 0% overdue and "Healthy"
    // whatever the queue held.
    int Completed,
    int Cancelled,

    /// <summary>Completed, of everything that was not cancelled. 0 when there is nothing.</summary>
    int CompletionRatePercent,

    /// <summary>Overdue, of what is still open. 0 when nothing is open.</summary>
    int OverduePercent,

    /// <summary>Healthy (under 5% of open work overdue), Warning (up to 15%) or Critical.</summary>
    string Health);

/// <summary>One line of a follow-up's history, newest first.</summary>
public sealed record FollowUpHistoryEntryResponse(
    DateTimeOffset OccurredAtUtc,
    string Action,
    string? Detail,
    string? ActorName);

/// <summary>One planned follow-up.</summary>
public sealed record FollowUpResponse(
    Guid Id,
    string FollowUpReference,
    Guid? DonorId,
    string? DonorReference,
    string? DonorDisplayName,
    Guid? LeadId,
    string? LeadReference,
    Guid RelationshipOwnerUserId,
    string? RelationshipOwnerName,
    string? Purpose,
    string PermittedChannel,
    string PreferredLanguage,
    DateTimeOffset? PreferredContactTimeUtc,
    string? NextAction,
    DateTimeOffset? DueAtUtc,
    string Priority,
    string? Notes,
    bool ConsentWarningAcknowledged,
    string? ConsentNoticeVersion,
    DateTimeOffset? ConsentAcknowledgedAtUtc,
    string Status,
    DateTimeOffset? CompletedAtUtc,
    string? CompletionOutcome,
    string? RescheduleReason,
    string? CancellationReason,
    DateTimeOffset CreatedAtUtc,
    long Version,
    bool IsNotesMasked,
    bool IsPreferredTimeMasked,
    ConsentWarningResponse ConsentWarning,
    IReadOnlyList<string> PermittedActions,

    // ---- Who the follow-up is about, and who it belongs to --------------------------------------
    //
    // TWO DIFFERENT PEOPLE, and the role flow insists on the difference: a follow-up is assigned to
    // somebody (RelationshipOwnerUserId above), while the lead or donor it is about has an owner of
    // its own. The owner sees the follow-up in their queue but may not execute it; only the
    // assignee can - which is what IsAssignedToMe and the per-row actions encode.
    string? LeadDisplayName,
    string? RecordDisplayName,
    Guid? RecordOwnerUserId,
    string? RecordOwnerName,
    string? CampaignName,
    string? ContactPhone,
    string? ContactEmail,
    bool IsContactMasked,
    bool IsAssignedToMe,
    bool IsOpen,
    bool IsOverdue,
    DateTimeOffset? EscalatedAtUtc,
    string? EscalationReason,
    IReadOnlyList<FollowUpHistoryEntryResponse> History,

    /// <summary>
    /// Where an open follow-up stands by the organisation's calendar day - Overdue, Due Today,
    /// Tomorrow, Upcoming or None - and, once it is completed or cancelled, Completed today or
    /// Closed. The queue's tiles count by these same days, so a tile and the rows under it agree.
    /// </summary>
    string DueState,

    // How the execution went, in the words the form offered them. Null until it is executed.
    string? ExecutionStatus,
    string? CompletionReason,
    string? Disposition);

/// <summary>
/// What the screen has to show before somebody schedules contact. Never pre-ticked: the person
/// scheduling has to read it and accept it, and the acceptance is stored with the notice version.
/// </summary>
public sealed record ConsentWarningResponse(
    bool HasWarning,
    string Level,
    string Message,
    IReadOnlyList<string> PermittedChannels,
    IReadOnlyList<string> ProhibitedChannels);

/// <summary>POST .../schedule-follow-up. The primary action.</summary>
public sealed class ScheduleFollowUpRequest
{
    public Guid? DonorId { get; set; }

    public Guid? LeadId { get; set; }

    public Guid? RelationshipOwnerUserId { get; set; }

    public string? RelationshipOwnerName { get; set; }

    /// <summary>10 to 2000 characters.</summary>
    public string Purpose { get; set; } = string.Empty;

    /// <summary>Must be a channel consent actually permits.</summary>
    public string PermittedChannel { get; set; } = string.Empty;

    public string? PreferredLanguage { get; set; }

    public DateTimeOffset? PreferredContactTimeUtc { get; set; }

    public string NextAction { get; set; } = string.Empty;

    public DateTimeOffset DueAtUtc { get; set; }

    public string? Priority { get; set; }

    public string? Notes { get; set; }

    /// <summary>Must be true when the consent warning says there is something to acknowledge.</summary>
    public bool ConsentWarningAcknowledged { get; set; }
}

/// <summary>POST .../{id}/assign. Hands the task to a different owner.</summary>
public sealed class AssignFollowUpRequest
{
    public Guid RelationshipOwnerUserId { get; set; }

    public string RelationshipOwnerName { get; set; } = string.Empty;

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string Reason { get; set; } = string.Empty;

    public long? ExpectedVersion { get; set; }
}

/// <summary>
/// POST .../{id}/mark-complete - Execute on the Follow-up Queue.
///
/// THE CONVERSATION TRAVELS WITH THE COMPLETION. Executing a follow-up IS contacting somebody, so
/// what happened is recorded on their Communication Timeline in the same act - for a lead's
/// follow-up as well as a donor's. It used to be recorded only for donors, and the execution
/// screen worked round that by posting to the lead's own Contact action, which only the lead's
/// owner may call - so a follow-up assigned to somebody who did not own the lead could not be
/// executed at all.
/// </summary>
public sealed class CompleteFollowUpRequest
{
    /// <summary>Required. 10 to 2000 characters. What was achieved - the timeline summary.</summary>
    public string CompletionOutcome { get; set; } = string.Empty;

    public DateTimeOffset? CompletedAtUtc { get; set; }

    public long? ExpectedVersion { get; set; }

    // ---- How it went - see FollowUpTask ---------------------------------------------------------
    //
    // Each is a value from the list the planner response offers; anything else is refused rather
    // than quietly dropped.

    public string? ExecutionStatus { get; set; }

    public string? CompletionReason { get; set; }

    public string? Disposition { get; set; }

    /// <summary>The recorded outcome, from the timeline's outcome list. Connected when omitted.</summary>
    public string? Outcome { get; set; }

    /// <summary>How the contact actually happened. The follow-up's planned channel when omitted.</summary>
    public string? InteractionType { get; set; }

    public string? Direction { get; set; }

    /// <summary>The team's own notes. Withheld from callers who may not see contact detail.</summary>
    public string? Notes { get; set; }

    public string? EngagementLevel { get; set; }

    public string? Quality { get; set; }

    public bool IsImportant { get; set; }

    public string? AttachmentName { get; set; }

    /// <summary>A new reading of the lead, for a caller who may score leads. Ignored for a donor.</summary>
    public string? Temperature { get; set; }

    public string? DonationPotential { get; set; }
}

/// <summary>
/// POST .../{id}/escalate. Hands the task to somebody more senior and records why. The task stays
/// open; it is marked escalated rather than moved to a status of its own.
/// </summary>
public sealed class EscalateFollowUpRequest
{
    public Guid EscalateToUserId { get; set; }

    public string EscalateToName { get; set; } = string.Empty;

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string Reason { get; set; } = string.Empty;

    public long? ExpectedVersion { get; set; }
}

/// <summary>POST .../{id}/reschedule.</summary>
public sealed class RescheduleFollowUpRequest
{
    public DateTimeOffset DueAtUtc { get; set; }

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string RescheduleReason { get; set; } = string.Empty;

    public string? Priority { get; set; }

    public long? ExpectedVersion { get; set; }
}
