using YDots.DON.Application.Common.Models;
using YDots.DON.Application.DTOs;
using YDots.DON.Application.Features.LeadWorkQueue.DTOs;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.LeadWorkQueue;

/// <summary>
/// The Lead Work Queue's and My Leads' views, orders and follow-up states, with the words the
/// screens show.
///
/// SERVED, NOT TYPED INTO THE SCREENS. Both screens kept their own lists - seven lanes and five
/// orders on the queue, six figures and four saved filters on My Leads - and translated each one
/// into query-string fields in the browser, so what a lane meant was decided twice and the count
/// on it and the rows under it could drift apart. A view is now a value the server both counts
/// and filters by.
/// </summary>
public static class LeadQueueCatalogue
{
    public const string AllView = "all";

    /// <summary>The orders the queue can be read in. "due" is the work-queue order and the default.</summary>
    public static IReadOnlyList<LookupItem> SortOptions { get; } =
    [
        new("due", "Next contact due"),
        new("newest", "Newest first"),
        new("oldest", "Oldest first"),
        new("name-asc", "Name A to Z"),
        new("name-desc", "Name Z to A")
    ];

    /// <summary>Where a lead's next contact stands - the values the follow-up-state filter takes.</summary>
    public static IReadOnlyList<LookupItem> FollowUpStateOptions { get; } =
    [
        new("Overdue", "Overdue", "The planned contact date has passed."),
        new("DueToday", "Due today", "A contact is planned for today."),
        new("Upcoming", "Upcoming", "A contact is planned for a later day."),
        new("None", "Not planned", "Nothing is planned.")
    ];

    /// <summary>
    /// The views for the caller's screen, each counted over the whole scope. My Leads is the
    /// caller's own leads, so it shows the six figures a fundraiser works from; the queue shows
    /// the lanes a manager routes from.
    /// </summary>
    public static IReadOnlyList<QueueViewResponse> Views(LeadQueueSummaryResponse summary, bool onlyMine) =>
        onlyMine
            ?
            [
                new(AllView, "Assigned", "In your assignment", summary.TotalLeads),
                new("hot", "Hot", "High priority", summary.HotLeads),
                new("warm", "Warm", "Building interest", summary.WarmLeads),
                new("cold", "Cold", "Needs warming up", summary.ColdLeads),
                new("due-today", "Due today", "Next contact planned for today", summary.LeadsDueToday),
                new("overdue", "Overdue", "Next contact date has passed", summary.LeadsOverdue)
            ]
            :
            [
                new(AllView, "All leads", "Every lead in scope", summary.TotalLeads),
                new("unassigned", "Unassigned", "Waiting for an owner", summary.UnassignedLeads),
                new("assigned", "Assigned", "With a fundraiser", summary.AssignedLeads),
                new("hot", "Hot", "Ready to talk", summary.HotLeads),
                new("high-potential", "High potential", "Largest likely gifts", summary.HighDonationPotential),
                new("recent", "Recently added", $"Captured in the last {LeadSearchFilter.RecentlyAddedDays} days", summary.RecentlyAddedLeads),
                new("converted", "Converted", "Donation recorded", summary.ConvertedLeads)
            ];

    /// <summary>
    /// Turns a view into the filter fields it stands for, and answers the view that is in effect.
    ///
    /// AN EXPLICIT CHOICE SUPERSEDES THE VIEW. Asking for the Hot lane and then choosing "Cold" in
    /// the filter panel is a request for cold leads; the lane no longer describes the rows, so the
    /// view falls back to "all" and the screen is told so (LeadWorkQueueResponse.ActiveView). A
    /// choice that agrees with the view (Hot and Hot) leaves it in place.
    /// </summary>
    public static string ApplyView(LeadSearchFilter filter)
    {
        var view = filter.View?.Trim().ToLowerInvariant();

        bool Applies<T>(T? current, T wanted) where T : struct =>
            current is null || EqualityComparer<T>.Default.Equals(current.Value, wanted);

        bool Set(bool applies, Action apply)
        {
            if (applies) apply();
            return applies;
        }

        var applied = view switch
        {
            "unassigned" => Set(Applies(filter.AssignmentState, LeadAssignmentState.Unassigned), () => filter.AssignmentState = LeadAssignmentState.Unassigned),
            "assigned" => Set(Applies(filter.AssignmentState, LeadAssignmentState.Assigned), () => filter.AssignmentState = LeadAssignmentState.Assigned),
            "hot" => Set(Applies(filter.Temperature, LeadTemperature.Hot), () => filter.Temperature = LeadTemperature.Hot),
            "warm" => Set(Applies(filter.Temperature, LeadTemperature.Warm), () => filter.Temperature = LeadTemperature.Warm),
            "cold" => Set(Applies(filter.Temperature, LeadTemperature.Cold), () => filter.Temperature = LeadTemperature.Cold),
            "high-potential" => Set(Applies(filter.DonationPotential, DonationPotential.High), () => filter.DonationPotential = DonationPotential.High),
            "recent" => Set(Applies(filter.RecentlyAdded, true), () => filter.RecentlyAdded = true),
            "converted" => Set(Applies(filter.IsConverted, true), () => filter.IsConverted = true),
            "due-today" => Set(string.IsNullOrWhiteSpace(filter.FollowUpState) || IsState(filter.FollowUpState, "DueToday"), () => filter.FollowUpState = "DueToday"),
            "overdue" => Set(string.IsNullOrWhiteSpace(filter.FollowUpState) || IsState(filter.FollowUpState, "Overdue"), () => filter.FollowUpState = "Overdue"),
            _ => false
        };

        filter.View = applied ? view : AllView;
        return filter.View;
    }

    private static bool IsState(string value, string state) =>
        string.Equals(value.Trim().Replace(" ", string.Empty), state, StringComparison.OrdinalIgnoreCase);
}
