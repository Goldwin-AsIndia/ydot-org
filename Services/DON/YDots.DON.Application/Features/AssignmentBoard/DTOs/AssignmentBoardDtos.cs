using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.Leads.DTOs;

namespace YDots.DON.Application.Features.AssignmentBoard.DTOs;

/// <summary>
/// GET /api/v1/donors/assignment-board. Balance ownership by team, language, workload and SLA.
/// The board is two lists side by side: the leads waiting to be routed, and the owners who
/// could take them with their current load.
/// </summary>
public sealed record AssignmentBoardResponse(
    string ScreenId,
    string Route,
    PagedResponse<AssignmentBoardRowResponse> Rows,
    IReadOnlyList<OwnerWorkloadResponse> Owners,
    IReadOnlyList<LookupItem> CampaignOptions,
    IReadOnlyList<LookupItem> TeamOptions,
    IReadOnlyList<LookupItem> LanguageOptions,
    IReadOnlyList<LookupItem> WorkloadBandOptions,
    IReadOnlyList<LookupItem> SlaStateOptions,
    IReadOnlyList<string> PermittedActions,
    string ActiveFilterSummary,
    string ActiveScope,
    int BulkRouteMaximumItems,
    string State,

    // ---- The strip above the board --------------------------------------------------------------
    //
    // Over everything the board routes for this caller, whatever view or page is on screen. The
    // screen used to count these from the ten rows it was showing, so a board of sixty leads read
    // "4 unassigned" on page one and "2 unassigned" on page two.
    int UnassignedCount = 0,
    int AssignedCount = 0,

    /// <summary>Next contact due inside the SLA's due-soon window - what the Due today view lists.</summary>
    int DueTodayCount = 0,

    // ---- Served so the screen types none of it ------------------------------------------------

    /// <summary>All records / Unassigned / Assigned, counted over the whole board. Sent back as <c>view</c>.</summary>
    IReadOnlyList<QueueViewResponse>? Views = null,

    /// <summary>The view the rows answer: the one asked for, or "all" when an explicit ownership choice superseded it.</summary>
    string ActiveView = "all",

    /// <summary>Leads / Donors - the board's two record types, sent back as <c>recordType</c>.</summary>
    IReadOnlyList<LookupItem>? RecordTypeOptions = null,

    /// <summary>The organisation's clock, "Asia/Kolkata · UTC+05:30". Scheduled changes are read on it.</summary>
    string? TimeZoneLabel = null,

    /// <summary>The organisation's offset from UTC now, in minutes, for reading a scheduled time typed on its clock.</summary>
    int UtcOffsetMinutes = 0);

/// <summary>One routable lead, with the owner the board suggests for it.</summary>
public sealed record AssignmentBoardRowResponse(
    Guid LeadId,
    string LeadReference,
    string LeadPreview,
    string? CampaignName,
    Guid? CurrentOwnerUserId,
    string? CurrentOwnerName,
    Guid? SuggestedOwnerUserId,
    string? SuggestedOwnerName,
    string? SuggestionRationale,
    int CurrentOwnerOpenWorkCount,
    string? NextAction,
    DateTimeOffset? NextActionDueUtc,
    string SlaState,
    string PreferredLanguage,
    string? TeamCode,
    string Status,
    long Version,

    /// <summary>
    /// Lead or Donor. On a Donor row the Lead* fields carry the donor - its id, its donor number
    /// and its name - so the board draws both kinds with one row shape.
    /// </summary>
    string RecordType = "Lead",

    /// <summary>The lead's or donor's name alone, without the reference the preview starts with.</summary>
    string? DisplayName = null,

    /// <summary>The SLA state as the screen words it ("On track", "No next contact").</summary>
    string? SlaStateLabel = null,

    /// <summary>The preferred language's name ("Tamil"); <see cref="PreferredLanguage"/> stays the code.</summary>
    string? PreferredLanguageLabel = null);

/// <summary>One candidate owner and how loaded they currently are.</summary>
public sealed record OwnerWorkloadResponse(
    Guid UserId,
    string Name,
    string? TeamCode,
    int OpenWorkCount,
    string WorkloadBand);

/// <summary>POST .../assign and .../reassign. Same body: both are an ownership change.</summary>
public sealed class AssignmentRequest
{
    /// <summary>
    /// Lead (the default) or Donor. With Donor, <see cref="LeadId"/> carries the donor id - the
    /// request shape stays the one the board already sends.
    /// </summary>
    public string? RecordType { get; set; }

    public Guid LeadId { get; set; }

    public Guid NewOwnerUserId { get; set; }

    public string NewOwnerName { get; set; } = string.Empty;

    public string? TeamCode { get; set; }

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string AssignmentReason { get; set; } = string.Empty;

    public DateTimeOffset? EffectiveAtUtc { get; set; }

    public long? ExpectedVersion { get; set; }
}

/// <summary>
/// POST .../bulk-route. UI section 6.2: "Partial processing is explicit per record; no silent
/// skipping", which is why the response reports each lead separately.
/// </summary>
public sealed class BulkRouteRequest
{
    /// <summary>Lead (the default) or Donor. With Donor, the ids are donor ids.</summary>
    public string? RecordType { get; set; }

    public IList<Guid> LeadIds { get; set; } = [];

    public Guid NewOwnerUserId { get; set; }

    public string NewOwnerName { get; set; } = string.Empty;

    public string? TeamCode { get; set; }

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string AssignmentReason { get; set; } = string.Empty;

    public DateTimeOffset? EffectiveAtUtc { get; set; }
}

/// <summary>The outcome of a bulk route: eligible count, ineligible count and one row each.</summary>
public sealed record BulkRouteResultResponse(
    int RequestedCount,
    int RoutedCount,
    int SkippedCount,
    IReadOnlyList<BulkRouteItemResponse> Items,
    string Message,
    string State);

/// <summary>What happened to one lead in a bulk route.</summary>
public sealed record BulkRouteItemResponse(
    Guid LeadId,
    string? LeadReference,
    bool Routed,
    string Outcome);

/// <summary>GET .../{leadId}/history. The append-only ownership trail behind "Inspect history".</summary>
public sealed record AssignmentHistoryResponse(
    Guid LeadId,
    string LeadReference,
    IReadOnlyList<AssignmentHistoryItemResponse> Items);

/// <summary>One ownership change.</summary>
public sealed record AssignmentHistoryItemResponse(
    Guid Id,
    Guid? PreviousOwnerUserId,
    string? PreviousOwnerName,
    Guid NewOwnerUserId,
    string NewOwnerName,
    string AssignmentReason,
    DateTimeOffset EffectiveAtUtc,
    Guid AssignedByUserId,
    bool IsBulkRoute,

    /// <summary>Who made the change, by name from the organisation's people.</summary>
    string? AssignedByName = null,

    /// <summary>Assigned / Reassigned / Bulk routed.</summary>
    string EventLabel = "");

/// <summary>The lead detail panel the board opens beside a row.</summary>
public sealed record AssignmentBoardLeadResponse(LeadDetailResponse Lead, AssignmentHistoryResponse History);
