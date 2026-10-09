using YDots.DON.Domain.Common;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Domain.Entities;

/// <summary>
/// Owned entity (table don_donor_interactions). One conversation, note or visit.
/// Feeds the Conversations and Activity history panels on Donor 360.
/// </summary>
public class DonorInteraction : AuditEntity, IOrganisationOwned
{
    // ---- Section 3.4 property contract ---------------------------------------------------

    /// <summary>2 to 160 characters, for example "Introduction call".</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Maximum 2000 characters.</summary>
    public string? Description { get; set; }

    public DonorInteractionStatus Status { get; set; } = DonorInteractionStatus.Active;

    // ---- Operational columns ---------------------------------------------------------------

    public Guid? DonorId { get; set; }

    public Donor? Donor { get; set; }

    public Guid? LeadId { get; set; }

    public Guid OrganisationId { get; set; }

    public InteractionType InteractionType { get; set; } = InteractionType.Note;

    public ConsentChannel? Channel { get; set; }

    public DateTimeOffset OccurredAtUtc { get; set; }

    public ContactOutcome Outcome { get; set; } = ContactOutcome.NotContacted;

    public Guid PerformedByUserId { get; set; }

    public string? PerformedByName { get; set; }

    // ---- What the person logging it recorded about the exchange ----------------------------------
    //
    // STORED BECAUSE THE COMMUNICATION TIMELINE COLLECTS THEM. The log form has always asked for
    // the direction, the engagement level, the quality, an "important" flag and an attachment, and
    // none of them had a column - so they were typed, shown once in the browser, and gone on the
    // next load, and every entry came back as "Medium" engagement whatever was recorded.

    /// <summary>Who started the exchange. Null on rows written before it was recorded.</summary>
    public InteractionDirection? Direction { get; set; }

    public EngagementLevel? EngagementLevel { get; set; }

    public CommunicationQuality? Quality { get; set; }

    /// <summary>Flagged as one to come back to. Shared with the whole team, not per browser.</summary>
    public bool IsImportant { get; set; }

    /// <summary>The file name the person attached. The file itself is not stored here.</summary>
    public string? AttachmentName { get; set; }

    /// <summary>
    /// The team's own notes on the exchange, kept apart from the summary. Withheld from a caller
    /// who may not see donor contact detail, exactly as call notes always were: what a donor said
    /// about their circumstances is more revealing than the number beside it.
    /// </summary>
    public string? InternalNotes { get; set; }
}
