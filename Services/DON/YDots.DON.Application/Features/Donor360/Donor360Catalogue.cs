using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.Donor360.DTOs;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.Donor360;

/// <summary>
/// Donor 360's words for what it lists: the follow-up views, pledge statuses and gift statuses.
///
/// SERVED, NOT TYPED INTO THE SCREEN. The Follow-ups tab kept "All / Open / Overdue / Closed" and
/// counted them in the browser, pledges read "PartiallyFulfilled", and the consent rows' channels
/// came from a map in the page that called a call "Phone call" where every other screen says "Call".
/// </summary>
public static class Donor360Catalogue
{
    public const string OpenView = "open";
    public const string OverdueView = "overdue";
    public const string ClosedView = "closed";

    /// <summary>The Follow-ups tab's views, counted with the same rule each row's <c>View</c> carries.</summary>
    public static IReadOnlyList<QueueViewResponse> FollowUpViews(IReadOnlyList<Donor360FollowUpResponse> followUps) =>
    [
        new("all", "All", "Every follow-up for this donor", followUps.Count),
        new(OpenView, "Open", "Planned and not yet due", followUps.Count(followUp => followUp.View == OpenView)),
        new(OverdueView, "Overdue", "Open and past its date", followUps.Count(followUp => followUp.View == OverdueView)),
        new(ClosedView, "Closed", "Completed or cancelled", followUps.Count(followUp => followUp.View == ClosedView))
    ];

    public static string FollowUpView(bool isOpen, bool isOverdue) =>
        isOverdue ? OverdueView : isOpen ? OpenView : ClosedView;

    public static IReadOnlyList<LookupItem> PromiseStatusOptions { get; } =
    [
        new(nameof(PromiseStatus.Open), "Open"),
        new(nameof(PromiseStatus.PartiallyFulfilled), "Partly fulfilled"),
        new(nameof(PromiseStatus.Fulfilled), "Fulfilled"),
        new(nameof(PromiseStatus.Lapsed), "Lapsed"),
        new(nameof(PromiseStatus.Cancelled), "Cancelled")
    ];

    public static string PromiseStatusLabel(PromiseStatus status) =>
        PromiseStatusOptions.First(option => option.Value == status.ToString()).Label;

    /// <summary>
    /// A gift's status as the payments module names it ("PartiallyRefunded"), in words. The
    /// values are PAY's, so they are worded here rather than listed.
    /// </summary>
    public static string GiftStatusLabel(string status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            return string.Empty;
        }

        var words = System.Text.RegularExpressions.Regex.Replace(status.Trim(), "(?<=[a-z])(?=[A-Z])", " ");
        return words.Length <= 1 ? words : words[0] + words[1..].ToLowerInvariant();
    }
}
