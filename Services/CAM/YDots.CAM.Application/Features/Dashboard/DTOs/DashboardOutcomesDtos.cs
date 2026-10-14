namespace YDots.CAM.Application.Features.Dashboard.DTOs;

// =============================================================================================
// THE EXECUTIVE DASHBOARD'S CONTRACT - outcome figures over a chosen period and scope.
//
// SERVED BY CAM, DON AND PAY from GET .../dashboard/outcomes, copied verbatim into each, and
// merged on the page by rank like the landing page's contract. Each module answers only for its
// own figures, only with what the caller may read, and only for the period and campaign asked
// about - the landing page answers for a fixed fortnight and has no filter.
// =============================================================================================

/// <summary>The query string of every outcomes endpoint.</summary>
public sealed class DashboardOutcomesFilter
{
    /// <summary>First day of the period, in the caller's zone. Absent: the default period.</summary>
    public DateOnly? FromDate { get; set; }

    /// <summary>Last day of the period, inclusive.</summary>
    public DateOnly? ToDate { get; set; }

    /// <summary>One campaign, or the whole Organisation when absent.</summary>
    public Guid? CampaignId { get; set; }

    /// <summary>"previous", "last-year" or "none". Absent: the previous period.</summary>
    public string? Comparison { get; set; }

    /// <summary>The viewer's IANA zone - see <c>DashboardFilter.TimeZone</c>.</summary>
    public string? TimeZone { get; set; }
}

/// <summary>One module's outcome figures for the period asked about.</summary>
public sealed record DashboardOutcomesResponse(
    string Module,
    DateTimeOffset GeneratedAtUtc,
    string TimeZone,

    /// <summary>"Asia/Kolkata · UTC+05:30".</summary>
    string TimeZoneLabel,

    DateOnly FromDate,
    DateOnly ToDate,

    /// <summary>The period the comparison figures cover; null with no comparison.</summary>
    DateOnly? ComparisonFromDate,
    DateOnly? ComparisonToDate,

    IReadOnlyList<DashboardOutcomeMetricResponse> Metrics,

    /// <summary>The day-by-day curve - PAY's money and gift counts; null from the other modules.</summary>
    DashboardOutcomeSeriesResponse? Series,

    /// <summary>The campaigns the period can be narrowed to - CAM's; empty from the others.</summary>
    IReadOnlyList<DashboardScopeOptionResponse> ScopeOptions,

    /// <summary>Ready-made periods - this month, this financial year, and so on.</summary>
    IReadOnlyList<DashboardPeriodResponse> Presets,

    /// <summary>The comparisons on offer, the one applied first.</summary>
    IReadOnlyList<DashboardPeriodResponse> Comparisons);

public sealed record DashboardOutcomeMetricResponse(
    string Key,
    int Rank,
    string Label,
    decimal Value,

    /// <summary>"money", "count" or "percent".</summary>
    string Unit,

    string CurrencyCode,

    /// <summary>What the figure counts, in a line.</summary>
    string Qualifier,

    /// <summary>Exactly how it is worked out - shown behind the ⓘ.</summary>
    string Definition,

    /// <summary>The same figure over the comparison period; null with no comparison.</summary>
    decimal? ComparisonValue,

    DashboardLinkResponse? Drill);

public sealed record DashboardOutcomeSeriesResponse(
    string PrimaryLabel,
    string PrimaryUnit,
    string SecondaryLabel,
    string SecondaryUnit,
    string CurrencyCode,
    IReadOnlyList<DashboardOutcomePointResponse> Points);

public sealed record DashboardOutcomePointResponse(
    DateOnly Date,
    string Label,
    decimal Primary,
    decimal Secondary,

    /// <summary>The same day of the comparison period, when there is one.</summary>
    decimal? ComparisonPrimary,
    decimal? ComparisonSecondary);

/// <summary>A campaign the period can be narrowed to.</summary>
public sealed record DashboardScopeOptionResponse(
    Guid CampaignId,
    string Reference,
    string Name,
    string Context);

/// <summary>A named period - a preset range or a comparison.</summary>
public sealed record DashboardPeriodResponse(
    string Key,
    string Label,
    DateOnly? FromDate = null,
    DateOnly? ToDate = null);
