using YDots.DON.Application.Common.Models;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.DTOs;

/// <summary>
/// Query string of the lead work queue and the assignment board. Every field here is one of
/// the "Context and filters" controls listed for SCR-DON-001 and SCR-DON-006.
/// </summary>
public sealed class LeadSearchFilter : PaginationRequest
{
    /// <summary>"Lead name or contact" search box. Matches reference, name, e-mail and phone.</summary>
    public string? Search { get; set; }

    public Guid? CampaignId { get; set; }

    public Guid? OwnerUserId { get; set; }

    public LeadStatus? Status { get; set; }

    public SlaState? SlaState { get; set; }

    /// <summary>Cold / Warm / Hot. Drives the temperature column filter on the queue.</summary>
    public LeadTemperature? Temperature { get; set; }

    /// <summary>Low / Medium / High. Drives the donation-potential column filter.</summary>
    public DonationPotential? DonationPotential { get; set; }

    public string? PreferredLanguage { get; set; }

    public string? TeamCode { get; set; }

    /// <summary>
    /// Where the lead came from, matched exactly. The queue's Lead source filter used to narrow
    /// only the rows already on the page; a server filter narrows the set.
    /// </summary>
    public string? Source { get; set; }

    public WorkloadBand? WorkloadBand { get; set; }

    public ContactOutcome? LastContactOutcome { get; set; }

    public DateTimeOffset? DueBeforeUtc { get; set; }

    public DateTimeOffset? DueAfterUtc { get; set; }

    /// <summary>True returns only records the caller owns, whatever their data scope allows.</summary>
    public bool? OnlyMine { get; set; }

    /// <summary>
    /// Unassigned / Assigned, for the Lead Queue's own tabs.
    ///
    /// IT IS NOT THE SAME QUESTION AS <see cref="OwnerUserId"/>, which asks "whose?". This asks
    /// "anybody's?", and no owner id can express it: a null OwnerUserId on the filter means "do
    /// not filter by owner" rather than "has no owner". The Lead Queue's Unassigned tab is the
    /// entry point to the Assignment Board, so without this the tab could only be built by
    /// pulling every lead into the browser and counting there - which is what it used to do.
    /// </summary>
    public LeadAssignmentState? AssignmentState { get; set; }

    /// <summary>
    /// The Converted Leads tab.
    ///
    /// A CONVERTED LEAD IS STILL A LEAD ROW. The document says a converted lead leaves the Lead
    /// Work Queue and joins the Donor List, so the default queue hides them and this is how the
    /// tab asks for them back.
    /// </summary>
    public bool? IsConverted { get; set; }

    /// <summary>
    /// Newest first, for the Recently Added tab.
    ///
    /// The default ordering is by SLA - overdue first, then due soonest - which is right for a
    /// work queue and wrong for "what came in today".
    /// </summary>
    public bool? NewestFirst { get; set; }

    /// <summary>Include drafts that Save has not yet promoted. Off by default.</summary>
    public bool IncludeDrafts { get; set; }

    /// <summary>
    /// Only these leads, as a comma-separated list of ids - "Export selected". Still inside the
    /// caller's scope: naming a lead does not grant sight of it.
    /// </summary>
    public string? LeadIds { get; set; }

    /// <summary>How many days back "recently added" reaches - the lane and its count share it.</summary>
    public const int RecentlyAddedDays = 7;

    /// <summary>
    /// The Recently Added lane: leads captured in the last <see cref="RecentlyAddedDays"/> days.
    /// The lane used to be an ordering of every lead, under a count of the last week's.
    /// </summary>
    public bool? RecentlyAdded { get; set; }

    /// <summary>Resolved by the handler from <see cref="RecentlyAdded"/>; not a query parameter anybody sends.</summary>
    public DateTimeOffset? CreatedAfterUtc { get; set; }

    /// <summary>
    /// Where the next contact stands by the organisation's calendar day - Overdue, DueToday,
    /// Upcoming or None. The same reading the row's FollowUpState gives, so a file exported under
    /// the "Overdue" filter holds the rows that say Overdue.
    /// </summary>
    public string? FollowUpState { get; set; }

    // Resolved by the handler from FollowUpState against the organisation's day; a browser has no
    // business choosing where that day starts. NextContactBeforeUtc is exclusive.
    public DateTimeOffset? NextContactFromUtc { get; set; }

    public DateTimeOffset? NextContactBeforeUtc { get; set; }

    /// <summary>False asks for the leads with nothing planned (or no longer worked).</summary>
    public bool? HasNextContact { get; set; }

    /// <summary>The ids in <see cref="LeadIds"/>, ignoring anything that is not one.</summary>
    public IReadOnlyList<Guid> ParseLeadIds() =>
        string.IsNullOrWhiteSpace(LeadIds)
            ? []
            : [.. LeadIds
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
                .Where(id => id != Guid.Empty)
                .Distinct()];
}
