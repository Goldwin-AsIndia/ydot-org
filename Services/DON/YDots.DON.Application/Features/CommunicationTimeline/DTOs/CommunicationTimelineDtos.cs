using YDots.DON.Application.Common.Models;

namespace YDots.DON.Application.Features.CommunicationTimeline.DTOs;

/// <summary>
/// One line of the timeline: something that was said to, or heard from, this person.
///
/// IT COVERS BOTH SIDES OF THE CONVERSION. The Donors and Leads document is explicit that a
/// converted donor "retains the existing owner and Communication Timeline history", so the
/// timeline is keyed by the LEAD as well as the donor - an interaction recorded while the record
/// was still a lead must still appear after it becomes a donor, or the history the document
/// promises to preserve disappears at exactly the moment it becomes most useful.
/// </summary>
public sealed record CommunicationTimelineEntryResponse(
    Guid Id,
    string InteractionType,
    string? Channel,
    string Direction,
    DateTimeOffset OccurredAtUtc,
    string Outcome,
    string Summary,

    /// <summary>
    /// The longer note, MASKED unless the caller holds don.donors.view-sensitive-contact.
    ///
    /// A call note routinely contains what a donor said about their circumstances, which is the
    /// most sensitive thing on this screen and the least obviously so.
    /// </summary>
    string? Notes,

    string? PerformedByName,
    bool IsNotesMasked,

    // ---- What the person logging it recorded --------------------------------------------------
    //
    // Null on entries written before these were stored, and on the automatic entries a completed
    // follow-up or a qualification writes - the screen shows them as not recorded rather than as
    // a guessed "Medium".
    string? EngagementLevel,
    string? Quality,
    bool IsImportant,
    string? AttachmentName,
    Guid PerformedByUserId,

    /// <summary>The person who logged it, or somebody who works the whole organisation, may edit it.</summary>
    bool CanEdit,
    long Version);

/// <summary>
/// The Communication Timeline for one lead or donor.
///
/// PROFILE AND HISTORY IN ONE CALL, because the screen shows them side by side and two calls
/// would let the header and the timeline disagree about who is being looked at.
/// </summary>
public sealed record CommunicationTimelineResponse(
    string ScreenId,
    string Route,

    /// <summary>The lead this timeline belongs to, when it is a lead's.</summary>
    Guid? LeadId,
    string? LeadReference,

    /// <summary>The donor it belongs to, once the lead has converted.</summary>
    Guid? DonorId,
    string? DonorReference,

    string DisplayName,

    /// <summary>Masked on the same rule as everywhere else in the module.</summary>
    string? MobileNumber,
    string? EmailAddress,

    string? CampaignName,
    string? Source,
    string PreferredLanguage,
    string? OwnerName,
    string Status,
    string Temperature,
    string DonationPotential,
    int HealthScore,

    IReadOnlyList<CommunicationTimelineEntryResponse> Entries,

    /// <summary>Cold/Warm/Hot and Low/Medium/High, for the two update dialogs.</summary>
    IReadOnlyList<LookupItem> TemperatureOptions,
    IReadOnlyList<LookupItem> DonationPotentialOptions,
    IReadOnlyList<LookupItem> InteractionTypeOptions,
    IReadOnlyList<LookupItem> OutcomeOptions,

    IReadOnlyList<string> PermittedActions,
    bool IsContactMasked,
    string ActiveScope,
    string State,

    // ---- The follow-up picture beside the timeline -----------------------------------------------
    //
    // THE SCREEN USED TO WORK THESE OUT FROM ITS OWN ROWS, which never carried a follow-up, so
    // "Next follow-up" always read "None scheduled" and the completion rate was always 0%.
    bool IsLead,
    Guid? CampaignId,
    DateTimeOffset? LastContactedAtUtc,
    string? NextFollowUpReference,
    DateTimeOffset? NextFollowUpDueUtc,
    string? NextFollowUpPurpose,
    string? NextFollowUpAssignedTo,
    int FollowUpCount,
    int FollowUpCompletedCount,
    IReadOnlyList<LookupItem> DirectionOptions,
    IReadOnlyList<LookupItem> EngagementOptions,
    IReadOnlyList<LookupItem> QualityOptions,

    // ---- The readings beside the timeline ---------------------------------------------------------
    //
    // THE SCREEN USED TO WORK ALL OF THESE OUT ITSELF, from the entries it had loaded and with
    // every entry's engagement assumed to be "Medium" - so the health figure on this screen
    // disagreed with the same lead's health in the queue, and the trends described nothing.
    // Blank for a donor who was never a lead: nobody has scored them.
    string HealthBand,
    IReadOnlyList<string> HealthReasons,
    string ContactRhythm,
    string EngagementTrend,
    int InterestedCount);

/// <summary>
/// POST /api/v1/donors/communication-timeline - log a communication manually.
///
/// FOR A LEAD OR A DONOR, which is what the role flow asks: "Fundraising Manager / Assigned Owner
/// can also log a communication manually from the Communication Timeline", and the timeline is a
/// lead's or a donor's. Recording used to be possible against a lead only.
/// </summary>
public sealed class LogCommunicationRequest
{
    public Guid? LeadId { get; set; }

    public Guid? DonorId { get; set; }

    /// <summary>Call, Email, Sms, WhatsApp, Meeting, Visit or Note.</summary>
    public string InteractionType { get; set; } = string.Empty;

    /// <summary>Outgoing, Incoming or Internal.</summary>
    public string Direction { get; set; } = "Outgoing";

    /// <summary>When it happened. Not in the future.</summary>
    public DateTimeOffset OccurredAtUtc { get; set; }

    public string Outcome { get; set; } = string.Empty;

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string Summary { get; set; } = string.Empty;

    /// <summary>Up to 3000 characters. Withheld from callers who may not see contact detail.</summary>
    public string? Notes { get; set; }

    public string? EngagementLevel { get; set; }

    public string? Quality { get; set; }

    public bool IsImportant { get; set; }

    public string? AttachmentName { get; set; }
}

/// <summary>PUT /api/v1/donors/communication-timeline/{id} - correct a logged communication.</summary>
public sealed class UpdateCommunicationRequest
{
    public string Direction { get; set; } = "Outgoing";

    public DateTimeOffset OccurredAtUtc { get; set; }

    public string Outcome { get; set; } = string.Empty;

    public string Summary { get; set; } = string.Empty;

    public string? Notes { get; set; }

    public string? EngagementLevel { get; set; }

    public string? Quality { get; set; }

    public bool IsImportant { get; set; }

    public string? AttachmentName { get; set; }

    public long? ExpectedVersion { get; set; }
}

/// <summary>POST /api/v1/donors/communication-timeline/{id}/important - flag or clear.</summary>
public sealed class FlagCommunicationRequest
{
    public bool IsImportant { get; set; }
}
