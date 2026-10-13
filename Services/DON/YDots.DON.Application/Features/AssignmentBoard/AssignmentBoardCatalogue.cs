using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.AssignmentBoard;

/// <summary>
/// The Assignment Board's record types, ownership views and SLA words.
///
/// SERVED, NOT TYPED INTO THE SCREEN. The board kept "All leads / Unassigned only / Assigned only"
/// and "Leads / Donors" in the browser and translated them into query fields itself, and its SLA
/// filter showed the enum names ("NotApplicable", "OnTrack") split on their capitals.
/// </summary>
public static class AssignmentBoardCatalogue
{
    public const string AllView = "all";
    public const string LeadsRecordType = "Leads";
    public const string DonorsRecordType = "Donors";

    public static IReadOnlyList<LookupItem> RecordTypeOptions { get; } =
    [
        new(LeadsRecordType, "Leads", "Leads to give an owner to, or to move between owners."),
        new(DonorsRecordType, "Donors", "Donors to give a relationship owner to, or to move between owners.")
    ];

    public static bool IsDonors(string? recordType) =>
        string.Equals(recordType, DonorsRecordType, StringComparison.OrdinalIgnoreCase)
        || string.Equals(recordType, "Donor", StringComparison.OrdinalIgnoreCase);

    /// <summary>The ownership views, counted over everything the board routes for the caller.</summary>
    public static IReadOnlyList<QueueViewResponse> Views(bool donors, int unassigned, int assigned) =>
    [
        new(AllView, "All records", donors ? "Every donor" : "Every lead waiting to be worked", unassigned + assigned),
        new("unassigned", "Unassigned", donors ? "Donors with no relationship owner" : "Leads waiting for an owner", unassigned),
        new("assigned", "Assigned", donors ? "Donors with a relationship owner" : "Leads with a fundraiser", assigned)
    ];

    /// <summary>The ownership a view stands for: false = no owner, true = has one, null = every record.</summary>
    public static bool? OwnershipOf(string? view) =>
        view?.Trim().ToLowerInvariant() switch
        {
            "unassigned" => false,
            "assigned" => true,
            _ => null
        };

    /// <summary>The SLA states, worded for the screen. The windows come from the organisation's settings.</summary>
    public static IReadOnlyList<LookupItem> SlaStateOptions(DonorSettings settings) =>
    [
        new(nameof(SlaState.OnTrack), "On track", $"Next contact is more than {settings.SlaDueSoonHours} hours away."),
        new(nameof(SlaState.DueToday), "Due today", $"Next contact is due within {settings.SlaDueSoonHours} hours."),
        new(nameof(SlaState.Overdue), "Overdue", $"Next contact has passed, by less than {settings.SlaBreachHours} hours."),
        new(nameof(SlaState.Breached), "Breached", $"Next contact passed more than {settings.SlaBreachHours} hours ago."),
        new(nameof(SlaState.NotApplicable), "No next contact", "Nothing is planned, so no SLA runs.")
    ];

    public static string SlaLabel(SlaState state, DonorSettings settings) =>
        SlaStateOptions(settings).FirstOrDefault(option => option.Value == state.ToString())?.Label ?? state.ToString();

    /// <summary>The workload bands, with the open-work thresholds behind each one.</summary>
    public static IReadOnlyList<LookupItem> WorkloadBandOptions(DonorSettings settings) =>
    [
        new(nameof(WorkloadBand.Light), "Light", $"Up to {settings.WorkloadLightThreshold} open items."),
        new(nameof(WorkloadBand.Balanced), "Balanced", $"Up to {settings.WorkloadBalancedThreshold} open items."),
        new(nameof(WorkloadBand.Heavy), "Heavy", $"Up to {settings.WorkloadHeavyThreshold} open items."),
        new(nameof(WorkloadBand.Overloaded), "Overloaded", $"More than {settings.WorkloadHeavyThreshold} open items.")
    ];

    /// <summary>"Assigned", "Reassigned" or "Bulk routed" - the event an ownership change records.</summary>
    public static string EventLabel(Guid? previousOwnerUserId, bool isBulkRoute) =>
        isBulkRoute ? "Bulk routed" : previousOwnerUserId is null ? "Assigned" : "Reassigned";
}
