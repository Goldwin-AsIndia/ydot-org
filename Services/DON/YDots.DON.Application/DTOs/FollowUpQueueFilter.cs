namespace YDots.DON.Application.DTOs;

/// <summary>
/// Query string of GET /api/v1/donors/follow-up-planner/queue and its export. Every field is one
/// of the Follow-up Queue's controls; the values are the ones the queue response serves
/// (FollowUpQueueCatalogue), and the server applies each one with the same rule it counts by.
/// </summary>
public sealed class FollowUpQueueFilter
{
    /// <summary>One donor's follow-ups (from Donor 360). Wins over <see cref="LeadId"/>.</summary>
    public Guid? DonorId { get; set; }

    /// <summary>One lead's follow-ups (from a lead queue).</summary>
    public Guid? LeadId { get; set; }

    /// <summary>Reference, the person's name, the purpose or the phone number as the row shows it.</summary>
    public string? Search { get; set; }

    /// <summary>A tab or tile: mine, today, overdue, upcoming, completedToday, high, attention, escalated, calls.</summary>
    public string? View { get; set; }

    /// <summary>Status words, comma-separated - Pending, Completed, "Partially completed" and so on.</summary>
    public string? Statuses { get; set; }

    /// <summary>Channel values, comma-separated - PhoneCall, Email, Sms, WhatsApp, Post.</summary>
    public string? Channels { get; set; }

    /// <summary>Priority values, comma-separated - Low, Normal, High, Urgent.</summary>
    public string? Priorities { get; set; }

    /// <summary>Who the follow-up is assigned to.</summary>
    public Guid? AssignedToUserId { get; set; }

    /// <summary>The campaign the row shows, matched exactly.</summary>
    public string? Campaign { get; set; }

    /// <summary>Due on or after this organisation day.</summary>
    public DateOnly? DueFrom { get; set; }

    /// <summary>Due on or before this organisation day.</summary>
    public DateOnly? DueTo { get; set; }

    /// <summary>Due on exactly this organisation day - the date rail's selection.</summary>
    public DateOnly? DueOn { get; set; }

    /// <summary>newest (the default), oldest or status - see FollowUpQueueCatalogue.SortOptions.</summary>
    public string? Sort { get; set; }

    /// <summary>Only these follow-ups, comma-separated ids - "export selected". Still inside the scope.</summary>
    public string? FollowUpIds { get; set; }

    /// <summary>The comma-separated values of one of the list fields above, trimmed, empty ones dropped.</summary>
    public static IReadOnlyList<string> Split(string? values) =>
        string.IsNullOrWhiteSpace(values)
            ? []
            : [.. values.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)];

    /// <summary>The ids in <see cref="FollowUpIds"/>, ignoring anything that is not one.</summary>
    public IReadOnlyList<Guid> ParseFollowUpIds() =>
        [.. Split(FollowUpIds)
            .Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .Distinct()];
}
