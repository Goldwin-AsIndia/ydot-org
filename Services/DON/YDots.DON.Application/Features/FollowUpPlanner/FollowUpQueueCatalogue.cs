using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.FollowUpPlanner.DTOs;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.FollowUpPlanner;

/// <summary>
/// The Follow-up Queue's vocabularies and rules: the status word a row reads, the views a row
/// belongs to, the board column it sits in, and the words for each.
///
/// ONE RULE PER QUESTION, ON THE SERVER. The queue used to keep all of this in the browser - a
/// typed-in status list, nine views, five tiles, four board columns - and answered each question
/// its own way: the Escalated tile counted one rule and the Escalated tab filtered by another, and
/// the status word compared the execution LABEL ("Partially completed") with the enum NAME
/// ("PartiallyCompleted"), so every executed follow-up read "Completed" whatever the executor
/// chose. A row now carries the server's answers, and the counts are counts of those answers.
/// </summary>
public static class FollowUpQueueCatalogue
{
    // ---- Status words -----------------------------------------------------------------------------

    public const string Pending = "Pending";
    public const string Rescheduled = "Rescheduled";
    public const string Escalated = "Escalated";
    public const string Completed = "Completed";
    public const string PartiallyCompleted = "Partially completed";
    public const string NoResponse = "No response";
    public const string Cancelled = "Cancelled";

    /// <summary>
    /// What a row's status reads, in queue order. "Pending" is planned-or-assigned work; an
    /// executed follow-up reads what the executor recorded.
    /// </summary>
    public static IReadOnlyList<LookupItem> StatusOptions { get; } =
    [
        new(Pending, Pending, "Planned or assigned, still to be done."),
        new(Rescheduled, Rescheduled, "Moved to a new date, still to be done."),
        new(Escalated, Escalated, "Handed up for attention."),
        new(Completed, Completed, "Executed and completed."),
        new(PartiallyCompleted, PartiallyCompleted, "Executed; only part of it was done."),
        new(NoResponse, NoResponse, "Executed; the contact did not respond."),
        new(Cancelled, Cancelled, "Cancelled; no longer to be done.")
    ];

    /// <summary>The status word for a follow-up. See <see cref="StatusOptions"/>.</summary>
    public static string StatusOf(FollowUpTask task) =>
        task.Status switch
        {
            FollowUpStatus.Completed => task.ExecutionStatus switch
            {
                FollowUpExecutionStatus.PartiallyCompleted => PartiallyCompleted,
                FollowUpExecutionStatus.NoResponse => NoResponse,
                FollowUpExecutionStatus.Cancelled => Cancelled,
                _ => Completed
            },
            FollowUpStatus.Cancelled => Cancelled,
            _ when task.EscalatedAtUtc is not null => Escalated,
            FollowUpStatus.Rescheduled => Rescheduled,
            _ => Pending
        };

    // ---- Channels ---------------------------------------------------------------------------------

    /// <summary>The channels a follow-up can be planned on, in the words the queue prints.</summary>
    public static IReadOnlyList<LookupItem> ChannelOptions { get; } =
    [
        new(nameof(ConsentChannel.PhoneCall), "Call"),
        new(nameof(ConsentChannel.Email), "E-mail"),
        new(nameof(ConsentChannel.Sms), "SMS"),
        new(nameof(ConsentChannel.WhatsApp), "WhatsApp"),
        new(nameof(ConsentChannel.Post), "Post")
    ];

    public static string ChannelLabel(string channel) =>
        ChannelOptions.FirstOrDefault(option => option.Value == channel)?.Label ?? channel;

    // ---- Views ------------------------------------------------------------------------------------

    public const string MineView = "mine";
    public const string TodayView = "today";
    public const string OverdueView = "overdue";
    public const string UpcomingView = "upcoming";
    public const string CompletedTodayView = "completedToday";
    public const string HighPriorityView = "high";
    public const string AttentionView = "attention";
    public const string EscalatedView = "escalated";
    public const string CallsView = "calls";

    /// <summary>The views a row belongs to. Every count and every view filter uses this.</summary>
    public static IReadOnlyList<string> ViewsOf(FollowUpResponse row)
    {
        var views = new List<string>(4);

        if (row.IsAssignedToMe && row.IsOpen) views.Add(MineView);
        if (row.DueState == "Due Today") views.Add(TodayView);
        if (row.IsOverdue) views.Add(OverdueView);
        if (row.DueState is "Tomorrow" or "Upcoming") views.Add(UpcomingView);
        if (row.DueState == "Completed today") views.Add(CompletedTodayView);
        if (row.Priority is nameof(FollowUpPriority.High) or nameof(FollowUpPriority.Urgent)) views.Add(HighPriorityView);
        if (row.IsOpen && (row.EscalatedAtUtc is not null || row.IsOverdue || IsBlocked(row))) views.Add(AttentionView);
        if (IsEscalated(row)) views.Add(EscalatedView);
        if (row.PermittedChannel == nameof(ConsentChannel.PhoneCall)) views.Add(CallsView);

        return views;
    }

    /// <summary>
    /// Escalated with the Escalate action and still open, OR executed with "Escalated" as its
    /// status, completion reason or disposition. The tile used to count only the first kind.
    /// </summary>
    public static bool IsEscalated(FollowUpResponse row) =>
        (row.IsOpen && row.EscalatedAtUtc is not null)
        || Says(row.ExecutionStatus) || Says(row.CompletionReason) || Says(row.Disposition);

    /// <summary>A consent caution nobody has acknowledged: the contact may not go ahead as planned.</summary>
    public static bool IsBlocked(FollowUpResponse row) =>
        row.ConsentWarning.HasWarning && !row.ConsentWarningAcknowledged;

    private static bool Says(string? value) =>
        value?.Contains("escalat", StringComparison.OrdinalIgnoreCase) ?? false;

    /// <summary>The tabs above the queue, in order, grouped by what they narrow on.</summary>
    public static IReadOnlyList<FollowUpQueueViewResponse> Views(IReadOnlyCollection<FollowUpResponse> rows) =>
    [
        View(MineView, "My Follow-Ups", "Mine", "due", "Assigned to you and still to do", rows),
        View(TodayView, "Today's Follow-Ups", "Today", "due", "Due today", rows),
        View(OverdueView, "Overdue", "Overdue", "due", "Past their due date", rows),
        View(UpcomingView, "Upcoming", "Upcoming", "due", "Due tomorrow or later", rows),
        View(CompletedTodayView, "Completed Today", "Done today", "due", "Closed out today", rows),
        View(HighPriorityView, "High Priority", "High priority", "focus", "High or urgent", rows),
        View(AttentionView, "Needs Attention", "Needs attention", "focus", "Escalated, overdue or blocked by consent", rows),
        View(EscalatedView, "Escalated", "Escalated", "focus", "Escalated, or executed as escalated", rows),
        View(CallsView, "Calls", "Calls", "channel", "Planned as a phone call", rows)
    ];

    /// <summary>The five headline tiles. Each is also the view it names.</summary>
    public static IReadOnlyList<QueueViewResponse> Tiles(IReadOnlyCollection<FollowUpResponse> rows) =>
    [
        Tile(TodayView, "Due today", "Pending for today", rows),
        Tile(UpcomingView, "Upcoming", "Scheduled ahead", rows),
        Tile(OverdueView, "Overdue", "Past their due date", rows),
        Tile(CompletedTodayView, "Completed today", "Closed out today", rows),
        Tile(EscalatedView, "Escalated", "Need attention", rows)
    ];

    private static FollowUpQueueViewResponse View(
        string value, string label, string shortLabel, string group, string description,
        IReadOnlyCollection<FollowUpResponse> rows) =>
        new(value, label, shortLabel, group, description, rows.Count(row => row.QueueViews?.Contains(value) == true));

    private static QueueViewResponse Tile(string value, string label, string description, IReadOnlyCollection<FollowUpResponse> rows) =>
        new(value, label, description, rows.Count(row => row.QueueViews?.Contains(value) == true));

    // ---- Board ------------------------------------------------------------------------------------

    /// <summary>The board's columns, left to right.</summary>
    public static IReadOnlyList<LookupItem> BoardColumns { get; } =
    [
        new("dueToday", "Due Today"),
        new("upcoming", "Upcoming"),
        new("overdue", "Overdue"),
        new("completed", "Completed")
    ];

    /// <summary>
    /// The column a row sits in, or none: a cancelled follow-up, or an open one with no date, is
    /// on no column. "Completed" holds every executed outcome except a cancellation.
    /// </summary>
    public static string? BoardColumnOf(FollowUpResponse row, string queueStatus) =>
        row.DueState switch
        {
            "Due Today" => "dueToday",
            "Tomorrow" or "Upcoming" => "upcoming",
            _ when row.IsOverdue => "overdue",
            _ when queueStatus is Completed or PartiallyCompleted or NoResponse => "completed",
            _ => null
        };

    // ---- Orders -----------------------------------------------------------------------------------

    /// <summary>The orders the queue can be read in; the value goes back as <c>sort</c>.</summary>
    public static IReadOnlyList<LookupItem> SortOptions { get; } =
    [
        new("newest", "Latest first"),
        new("oldest", "Earliest first"),
        new("status", "By status")
    ];

    /// <summary>Open work first, then by how it closed - the "By status" order.</summary>
    public static int StatusRank(string queueStatus) =>
        queueStatus switch
        {
            Pending => 0,
            Rescheduled => 1,
            Escalated => 2,
            Completed => 3,
            PartiallyCompleted => 4,
            NoResponse => 5,
            Cancelled => 6,
            _ => 9
        };

    // ---- The pulse panel --------------------------------------------------------------------------

    /// <summary>
    /// Open follow-ups that are NOT overdue, by how many days remain until they are due. Overdue
    /// work has its own tile; a follow-up with no date has no age.
    /// </summary>
    public static IReadOnlyList<QueueViewResponse> AgeBuckets(IEnumerable<int> daysUntilDue)
    {
        var days = daysUntilDue.ToList();

        return
        [
            new("0-3", "0–3d", "Due within three days", days.Count(d => d is >= 0 and <= 3)),
            new("4-7", "4–7d", "Due in four to seven days", days.Count(d => d is >= 4 and <= 7)),
            new("8-15", "8–15d", "Due in eight to fifteen days", days.Count(d => d is >= 8 and <= 15)),
            new("15+", "15d+", "Due in more than fifteen days", days.Count(d => d > 15))
        ];
    }
}
