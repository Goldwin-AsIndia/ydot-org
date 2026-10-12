using YDot.IAM.Application.Common.Models;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.DTOs;

/// <summary>Filter for the audit trail.</summary>
public sealed class AuditEventSearchFilter : PaginationRequest
{
    public Guid? ActorUserId { get; set; }

    public string? ActionCode { get; set; }

    public string? TargetType { get; set; }

    public Guid? TargetId { get; set; }

    public AuditResult? Result { get; set; }

    /// <summary>Only rows flagged sensitive. Requires the separate view-sensitive permission.</summary>
    public bool? IsSensitive { get; set; }

    public string? CorrelationId { get; set; }

    public DateTimeOffset? FromUtc { get; set; }

    public DateTimeOffset? ToUtc { get; set; }

    /// <summary>
    /// The viewer's IANA time zone ("Asia/Kolkata"), used by the summary to place each event on
    /// the heatmap by the viewer's own clock. The search and the export ignore it. An unknown
    /// zone falls back to UTC.
    /// </summary>
    public string? TimeZone { get; set; }
}
