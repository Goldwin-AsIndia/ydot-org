using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.Audit.DTOs;

/// <summary>
/// One audit row as the trail screen shows it.
///
/// <c>Metadata</c> is already redacted by the time it reaches here - the audit writer scrubs
/// anything resembling a password, token or secret before it is ever serialised. An audit
/// trail that leaks the thing it was auditing is a liability rather than a control.
///
/// <c>ActorScope</c> plus <c>TenantName</c> is what lets an Organisation see "somebody from
/// the platform did this to my data" without the row pretending the actor was one of their
/// own users.
/// </summary>
public sealed record AuditEventResponse(
    Guid Id,
    Guid? TenantId,
    string? TenantName,
    Guid BusinessUnitId,
    Guid? ActorUserId,
    string? ActorDisplayName,
    AccessScopeType ActorScope,
    string ActionCode,
    string ActionDisplay,
    string TargetType,
    Guid? TargetId,
    string? TargetDisplayName,
    AuditResult Result,
    string ResultDisplay,
    string? Reason,
    string CorrelationId,
    DateTimeOffset OccurredAtUtc,
    string? IpAddress,
    string? UserAgent,
    ClientType ClientType,
    Guid? SessionId,
    bool IsSensitive,
    string? RequestPath,

    /// <summary>Redacted detail. Null when the caller lacks the view-sensitive permission.</summary>
    string? Metadata,

    /// <summary>The kind of client in words: "Web browser", "Mobile app".</summary>
    string? ClientTypeDisplay = null,

    /// <summary>
    /// Who the actor was acting as, when that is worth saying: "Platform administrator" for a
    /// platform account working inside an Organisation, null for the Organisation's own people.
    /// </summary>
    string? ActorScopeDisplay = null,

    /// <summary>What the outcome means: "Refused by a permission check".</summary>
    string? ResultDescription = null);

/// <summary>
/// The figures, chart and heatmap above the audit trail, for the trail's own filter.
///
/// COUNTED BY THE SERVER OVER EVERY MATCHING EVENT. The screen used to work these out from the
/// first hundred rows it had fetched, so on any busy Organisation every card described "the last
/// hundred events" while reading as a total.
/// </summary>
public sealed record AuditSummaryResponse(
    int TotalCount,

    /// <summary>Every outcome, zero included, in the order the outcome filter lists them.</summary>
    IReadOnlyList<AuditOutcomeCount> Outcomes,

    /// <summary>Events that did not succeed: denied and failed together.</summary>
    int UnsuccessfulCount,

    int SucceededPercent,
    int UnsuccessfulPercent,

    /// <summary>Distinct people and services that acted, a system action counting as one.</summary>
    int DistinctActorCount,

    AuditActorActivity? MostActiveActor,

    AuditHeatmapResponse Heatmap,

    /// <summary>The busiest band of the day across the week, or null when nothing happened.</summary>
    string? BusiestTimeRange,

    /// <summary>The record types the matching events touch, with how many each.</summary>
    IReadOnlyList<AuditTargetTypeCount> TargetTypes,

    /// <summary>The time zone the heatmap was counted in.</summary>
    string TimeZone);

/// <summary>One outcome and how many matching events had it.</summary>
public sealed record AuditOutcomeCount(
    AuditResult Result,
    string Label,
    string Description,
    int Count,
    int Percent);

/// <summary>The busiest actor among the matching events.</summary>
public sealed record AuditActorActivity(
    Guid? ActorUserId,
    string DisplayName,
    int EventCount,
    int SharePercent);

/// <summary>Matching events by day of the week (columns) and band of the day (rows).</summary>
public sealed record AuditHeatmapResponse(
    IReadOnlyList<string> DayLabels,
    IReadOnlyList<AuditHeatmapBand> Bands,
    int MaxCount);

/// <summary>One band of the day: its axis label, its full range, and a count per day, Monday first.</summary>
public sealed record AuditHeatmapBand(string Label, string RangeLabel, IReadOnlyList<int> Counts);

/// <summary>One record type and how many matching events touch it.</summary>
public sealed record AuditTargetTypeCount(string TargetType, int Count);

/// <summary>
/// One row of a CSV export of the trail.
///
/// <c>SupportReference</c> is the correlation id's first eight characters, upper-case - the same
/// short reference the screen shows. The full id is a GUID, which nobody reading a spreadsheet can
/// use; the log is searched by prefix.
/// </summary>
public sealed record AuditExportRow(
    string OccurredAtUtc,
    string? Organisation,
    string? Actor,
    string ActorScope,
    string ActionCode,
    string TargetType,
    string? Target,
    string Result,
    string? Reason,
    string? IpAddress,
    string ClientType,
    string SupportReference)
{
    /// <summary>The short, quotable form of a correlation id: its first eight characters, upper-case.</summary>
    public static string ShortReference(string? correlationId)
    {
        var compact = new string((correlationId ?? string.Empty).Where(char.IsLetterOrDigit).ToArray());

        return compact.Length == 0 ? string.Empty : compact[..Math.Min(8, compact.Length)].ToUpperInvariant();
    }
}
