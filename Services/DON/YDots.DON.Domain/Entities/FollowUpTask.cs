using YDots.DON.Domain.Common;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Domain.Entities;

/// <summary>
/// A planned next action (table don_follow_up_tasks). The record behind DON-UI-08 and behind
/// the Follow-ups panel on Donor 360. A task can hang off a donor, a lead, or both.
/// </summary>
public class FollowUpTask : AuditEntity, IOrganisationOwned
{
    public Guid OrganisationId { get; set; }

    /// <summary>Stable reference, for example FUP-2026-000512.</summary>
    public string FollowUpReference { get; set; } = string.Empty;

    public Guid? DonorId { get; set; }

    public Donor? Donor { get; set; }

    public Guid? LeadId { get; set; }

    public Lead? Lead { get; set; }

    public Guid RelationshipOwnerUserId { get; set; }

    public string? RelationshipOwnerName { get; set; }

    /// <summary>10 to 2000 characters.</summary>
    public string? Purpose { get; set; }

    /// <summary>The channel consent actually permits. Validated against the donor's consent rows.</summary>
    public ConsentChannel PermittedChannel { get; set; } = ConsentChannel.PhoneCall;

    public string PreferredLanguage { get; set; } = "en-IN";

    /// <summary>Restricted: masked in list, export and support views.</summary>
    public DateTimeOffset? PreferredContactTimeUtc { get; set; }

    public string? NextAction { get; set; }

    public DateTimeOffset? DueAtUtc { get; set; }

    public FollowUpPriority Priority { get; set; } = FollowUpPriority.Normal;

    /// <summary>Confidential note. 10 to 2000 characters when supplied.</summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Never pre-selected. Records that the person scheduling the task saw and accepted the
    /// consent warning, together with the notice version and the time.
    /// </summary>
    public bool ConsentWarningAcknowledged { get; set; }

    public string? ConsentNoticeVersion { get; set; }

    public DateTimeOffset? ConsentAcknowledgedAtUtc { get; set; }

    public FollowUpStatus Status { get; set; } = FollowUpStatus.Planned;

    public DateTimeOffset? CompletedAtUtc { get; set; }

    public string? CompletionOutcome { get; set; }

    // ---- How the execution went -----------------------------------------------------------------
    //
    // THE EXECUTION FORM HAS ALWAYS ASKED FOR THESE THREE, as required fields, and there was
    // nowhere to put the answers - they were collected and dropped. They are the executor's own
    // classification of the contact and sit beside the free-text outcome, not instead of it.
    // Null on a follow-up completed before they were stored, or completed in bulk from the queue.

    public FollowUpExecutionStatus? ExecutionStatus { get; set; }

    public FollowUpCompletionReason? CompletionReason { get; set; }

    public FollowUpDisposition? Disposition { get; set; }

    public string? RescheduleReason { get; set; }

    public string? CancellationReason { get; set; }

    // ---- Escalation -----------------------------------------------------------------------------
    //
    // AN ESCALATED FOLLOW-UP IS STILL OPEN. Escalating hands the task to somebody more senior and
    // records why; it does not finish it. Kept as its own columns rather than a status so the
    // Follow-up Queue can show "escalated" alongside Planned, Assigned or Rescheduled - the task's
    // place in its own lifecycle is unchanged by who it was escalated to.

    /// <summary>When the task was last escalated. Null when it never was.</summary>
    public DateTimeOffset? EscalatedAtUtc { get; set; }

    /// <summary>Why. Required by the escalate action, 10 to 2000 characters.</summary>
    public string? EscalationReason { get; set; }

    public Guid? EscalatedByUserId { get; set; }
}
