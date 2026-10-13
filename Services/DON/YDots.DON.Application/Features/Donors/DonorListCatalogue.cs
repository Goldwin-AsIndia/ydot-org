using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.Donors.DTOs;

namespace YDots.DON.Application.Features.Donors;

/// <summary>
/// The Donor List's vocabularies - what each filter offers, in reading order, with the sentence
/// the quick-look sheet prints for each value - and its "needs attention" shortcuts.
///
/// SERVED, NOT TYPED INTO THE SCREEN. The list kept five ordering arrays, three switch statements
/// of explanatory sentences and a hard-coded set of shortcut cards, and offered as filter values
/// only the words it happened to find on the rows it had loaded. The values here are the words
/// the rows themselves carry (see DonorReadService), so a filter can only offer what a row can be.
/// </summary>
public static class DonorListCatalogue
{
    /// <summary>How far back "gave recently" looks on the summary.</summary>
    public const int RecentWindowDays = 90;

    /// <summary>Donor statuses in lifecycle order.</summary>
    public static IReadOnlyList<LookupItem> StatusOptions { get; } =
    [
        new("Active", "Active", "Giving and contactable."),
        new("Prospect", "Prospect", "Known to the organisation, not yet giving."),
        new("Restricted", "Restricted", "Contact or processing is restricted."),
        new("Archived", "Archived", "No longer worked."),
        new("Merged", "Merged", "Folded into another donor record.")
    ];

    /// <summary>The donor's next open follow-up, by the organisation's calendar day.</summary>
    public static IReadOnlyList<LookupItem> FollowUpStateOptions { get; } =
    [
        new("Overdue", "Overdue", "A planned follow-up has passed its date."),
        new("Due Today", "Due Today", "A follow-up is planned for today."),
        new("Tomorrow", "Tomorrow", "A follow-up is planned for tomorrow."),
        new("Upcoming", "Upcoming", "A follow-up is planned for a later date."),
        new("None", "Nothing planned", "Nothing is planned at the moment.")
    ];

    /// <summary>The latest identity check, in the words the list and its export print.</summary>
    public static IReadOnlyList<LookupItem> VerificationOptions { get; } =
    [
        new("Verified", "Verified", "Identity has been checked and confirmed."),
        new("Pending", "Pending", "A code has been sent and is awaiting entry."),
        new("Under review", "Under review", "The check was escalated and is being reviewed."),
        new("Failed", "Failed", "The last check failed and needs another attempt."),
        new("Expired", "Expired", "The verification has lapsed and should be renewed."),
        new("Cancelled", "Cancelled", "The last check was cancelled before it finished."),
        new("Not checked", "Not checked", "Identity has not been checked yet.")
    ];

    /// <summary>The donor's overall consent position.</summary>
    public static IReadOnlyList<LookupItem> ConsentOptions { get; } =
    [
        new("Granted", "Granted", "Every recorded channel is permitted."),
        new("Partial", "Partial", "Some channels are permitted, others withdrawn."),
        new("Withdrawn", "Withdrawn", "Consent is withdrawn on every channel."),
        new("Not provided", "Not provided", "No consent has been recorded yet.")
    ];

    /// <summary>The "last gift" windows. The value goes back as <c>giftPeriod</c>.</summary>
    public static IReadOnlyList<LookupItem> GiftPeriodOptions { get; } =
    [
        new("all", "Any time"),
        new("30", "In the last 30 days", "Gave in the last 30 days"),
        new("90", "In the last 90 days", "Gave in the last 90 days"),
        new("365", "In the last 12 months", "Gave in the last 12 months"),
        new("never", "Not given yet", "Not given yet")
    ];

    /// <summary>
    /// The columns the list sorts by. The value goes back as <c>sort</c> with a direction -
    /// "lastGift desc" - and the description is the direction a first click starts in.
    /// </summary>
    public static IReadOnlyList<LookupItem> SortOptions { get; } =
    [
        new("lastGift", "Last gift", "desc"),
        new("lifetime", "Lifetime giving", "desc"),
        new("name", "Donor name", "asc"),
        new("campaign", "Campaign", "asc"),
        new("owner", "Owner", "asc")
    ];

    /// <summary>The order the list opens in.</summary>
    public const string DefaultSort = "lastGift desc";

    /// <summary>The "needs attention" shortcuts, each counted over the caller's whole scope.</summary>
    public static IReadOnlyList<QueueViewResponse> Attention(
        int followUpsOverdue,
        int followUpsDueToday,
        int identityNotVerified,
        int consentToReview,
        int withoutOwner) =>
    [
        new("overdue", "Follow-ups overdue", "Promised contact has slipped", followUpsOverdue),
        new("today", "Follow-ups due today", "Planned for today", followUpsDueToday),
        new("unverified", "Identity not verified", "Pending, failed, expired or unchecked", identityNotVerified),
        new("consent", "Consent to review", "A consent expired or was withdrawn", consentToReview),
        new("unowned", "Without an owner", "Nobody looks after them yet", withoutOwner)
    ];

    /// <summary>Whether a row belongs to an attention shortcut - the rule the count above uses.</summary>
    public static bool Needs(DonorListItemResponse row, string attention) =>
        attention.Trim().ToLowerInvariant() switch
        {
            "overdue" => row.FollowUpStatus == "Overdue",
            "today" => row.FollowUpStatus == "Due Today",
            "unverified" => row.VerificationStatus != "Verified",
            "consent" => row.ConsentReviewRequired,
            "unowned" => row.RelationshipOwnerUserId is null,
            _ => true
        };
}
