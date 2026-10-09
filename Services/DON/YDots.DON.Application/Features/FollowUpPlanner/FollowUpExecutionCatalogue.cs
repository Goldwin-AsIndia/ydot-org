using YDots.DON.Application.Common.Models;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.FollowUpPlanner;

/// <summary>
/// The choices the Follow-up Execution form offers, and the words it offers them in.
///
/// THE FORM USED TO CARRY ITS OWN LISTS - typed into the screen, with no counterpart here - so it
/// asked for a status, a reason and a disposition that the completion request then had no field
/// for. The values are the enum names; the labels are what a person reads.
/// </summary>
public static class FollowUpExecutionCatalogue
{
    public static IReadOnlyList<LookupItem> ExecutionStatuses { get; } =
    [
        new(nameof(FollowUpExecutionStatus.Completed), "Completed"),
        new(nameof(FollowUpExecutionStatus.PartiallyCompleted), "Partially completed"),
        new(nameof(FollowUpExecutionStatus.NoResponse), "No response"),
        new(nameof(FollowUpExecutionStatus.Cancelled), "Cancelled")
    ];

    public static IReadOnlyList<LookupItem> CompletionReasons { get; } =
    [
        new(nameof(FollowUpCompletionReason.SuccessfullyCompleted), "Successfully completed"),
        new(nameof(FollowUpCompletionReason.PartiallyCompleted), "Partially completed"),
        new(nameof(FollowUpCompletionReason.ContactUnavailable), "Contact unavailable"),
        new(nameof(FollowUpCompletionReason.CancelledByContact), "Cancelled by the contact"),
        new(nameof(FollowUpCompletionReason.WrongContact), "Wrong contact"),
        new(nameof(FollowUpCompletionReason.Escalated), "Escalated"),
        new(nameof(FollowUpCompletionReason.Converted), "Converted"),
        new(nameof(FollowUpCompletionReason.NoResponse), "No response")
    ];

    public static IReadOnlyList<LookupItem> Dispositions { get; } =
    [
        new(nameof(FollowUpDisposition.Interested), "Interested"),
        new(nameof(FollowUpDisposition.NurtureLater), "Nurture later"),
        new(nameof(FollowUpDisposition.NotInterested), "Not interested"),
        new(nameof(FollowUpDisposition.WrongContact), "Wrong contact"),
        new(nameof(FollowUpDisposition.Converted), "Converted"),
        new(nameof(FollowUpDisposition.Escalated), "Escalated"),
        new(nameof(FollowUpDisposition.Dormant), "Dormant")
    ];

    /// <summary>
    /// How a contact can actually be made when a follow-up is executed: every interaction type but
    /// the internal note. A follow-up planned as a phone call may end up as a meeting.
    /// </summary>
    public static IReadOnlyList<LookupItem> ContactChannels { get; } =
    [
        .. CommunicationTimeline.CommunicationCatalogue.InteractionTypes
            .Where(type => type.Value != nameof(InteractionType.Note))
    ];

    public static string? Label(IReadOnlyList<LookupItem> options, string? value) =>
        value is null ? null : options.FirstOrDefault(option => option.Value == value)?.Label ?? value;
}
