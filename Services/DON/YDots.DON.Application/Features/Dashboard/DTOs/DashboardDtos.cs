namespace YDots.DON.Application.Features.Dashboard.DTOs;

// =============================================================================================
// THE DASHBOARD CONTRACT.
//
// THE SAME SHAPE IS SERVED BY IAM, CAM, DON AND PAY, each from its own GET .../dashboard, and the
// landing page merges the four. Every record here is copied verbatim into the other three
// services - change one and change all four, or the page reads a field one of them never sends.
//
// EACH SERVICE ANSWERS FOR ITS OWN DATA AND NOTHING ELSE, and only with what the caller may see:
// a section the caller's permissions do not reach is simply absent, never a 403. That is what
// lets every role land on the same page - an Organisation Admin, a Campaign Executive, a
// DonorCare agent and a Donor all call the same four endpoints and get four different pages.
//
// WHO FILLS A TILE IS DECIDED BY RANK. Each panel and each headline card carries a rank; the page
// takes the lowest-ranked panel any service returned for a tile, and the four lowest-ranked
// headline cards for the rail. So the Organisation Admin's Giving curve comes from PAY (rank 10)
// while a Fundraiser, who cannot read donations, gets DON's lead intake (rank 20) in the same
// place - the page never asks which role it is looking at.
//
// THE PAGE HOLDS NO FIGURE, LABEL OR LINK OF ITS OWN. Titles, captions, empty states and routes
// all travel with the data, because they change with the role as much as the numbers do, and a
// route is only sent when the caller may open the screen it leads to.
// =============================================================================================

/// <summary>Everything one service contributes to the landing page.</summary>
public sealed record DashboardResponse(
    /// <summary>"IAM", "CAM", "DON" or "PAY" - which service answered.</summary>
    string Module,

    DateTimeOffset GeneratedAtUtc,

    /// <summary>The IANA zone the day buckets and "today" were worked out in.</summary>
    string TimeZone,

    /// <summary>
    /// How much of the Organisation the figures cover - "Your whole organisation", "Records
    /// assigned to you", "Your own giving". Null when the service contributed nothing.
    /// </summary>
    string? ScopeLabel,

    IReadOnlyList<DashboardHeadlineResponse> Headlines,
    IReadOnlyList<DashboardCounterResponse> Counters,
    IReadOnlyList<DashboardAttentionItemResponse> Attention,
    IReadOnlyList<DashboardActionResponse> Actions,
    DashboardPanelsResponse Panels,

    /// <summary>Who is looking - IAM fills it, the other three leave it null.</summary>
    DashboardViewerResponse? Viewer = null);

/// <summary>The signed-in person as the page greets them.</summary>
public sealed record DashboardViewerResponse(
    string DisplayName,
    string? OrganisationName,
    IReadOnlyList<string> RoleNames,
    string? ScopeLabel,
    bool IsPlatform);

/// <summary>A way into a screen, with its words.</summary>
public sealed record DashboardLinkResponse(
    string Label,
    string Route,
    IReadOnlyDictionary<string, string>? QueryParams = null);

/// <summary>What a tile says when it has nothing to show.</summary>
public sealed record DashboardEmptyStateResponse(
    string Title,
    string Hint,
    DashboardLinkResponse? Action = null);

/// <summary>
/// A small chart inside a headline card.
///
/// <c>Kind</c> is "line" (an amount per day), "bars" (a count per day), "stages" (one bar per
/// stage, <c>HighlightIndex</c> marking the live one) or "split" (three segments).
/// </summary>
public sealed record DashboardSparkResponse(
    string Kind,
    IReadOnlyList<decimal> Values,
    int? HighlightIndex = null);

/// <summary>One card of the status rail across the top of the page.</summary>
public sealed record DashboardHeadlineResponse(
    string Key,
    int Rank,
    string Label,
    string Icon,

    /// <summary>"ok", "wait", "warn" or "brand" - the card's colour.</summary>
    string Tone,

    /// <summary>The figure, already formatted ("12,500.00 INR", "1,286").</summary>
    string Display,

    string Caption,

    /// <summary>The meter under the figure, 0 to 100.</summary>
    decimal MeterPercent,

    string Foot,
    string? Route,
    DashboardSparkResponse? Spark);

/// <summary>One counter of the pulse strip.</summary>
public sealed record DashboardCounterResponse(
    string Key,
    int Rank,
    string Label,
    string Icon,
    int Value,
    string? Route);

/// <summary>
/// One row of Needs Attention.
///
/// SENT ONLY TO SOMEBODY WHO CAN ACT ON IT. A count of receipts waiting to be issued is work for
/// the person who may issue them and noise for everybody else.
/// </summary>
public sealed record DashboardAttentionItemResponse(
    string Key,
    int Rank,
    string Label,
    string Hint,
    int Count,
    string Icon,
    string? Route,
    IReadOnlyDictionary<string, string>? QueryParams = null);

/// <summary>A shortcut in the command bar - only the ones the caller may use.</summary>
public sealed record DashboardActionResponse(
    string Key,
    int Rank,
    string Label,
    string Icon,
    string Route,
    bool IsPrimary,
    IReadOnlyDictionary<string, string>? QueryParams = null);

/// <summary>
/// A labelled figure inside a tile.
///
/// <c>Unit</c> is "money", "count" or "percent"; money is formatted by the page in the panel's
/// currency, so the compact form ("₹4.2L") follows the viewer's locale.
/// </summary>
public sealed record DashboardStatResponse(
    string Label,
    decimal Value,
    string Unit,
    string? Note = null,
    bool IsAlert = false,
    string? Route = null);

/// <summary>A small coloured tag - "4 settled", "2 in progress".</summary>
public sealed record DashboardChipResponse(
    string Label,
    int Value,
    string Tone,
    string Icon);

/// <summary>The tiles below the rail. Any of them may be absent.</summary>
public sealed record DashboardPanelsResponse(
    DashboardTrendPanelResponse? Trend = null,
    DashboardHealthPanelResponse? Health = null,
    DashboardActivityPanelResponse? Activity = null,
    DashboardAgendaPanelResponse? Agenda = null,
    DashboardPipelinePanelResponse? Pipeline = null,
    DashboardRankingPanelResponse? Ranking = null,
    DashboardRankingPanelResponse? Leaders = null,
    DashboardFeedPanelResponse? Feed = null,
    DashboardSharePanelResponse? Sources = null,
    DashboardFunnelPanelResponse? Funnel = null);

// ---- The large curve ----------------------------------------------------------------------

public sealed record DashboardTrendPointResponse(
    DateOnly Date,
    string Label,
    decimal Value,
    int Count,
    bool IsToday);

public sealed record DashboardTrendPanelResponse(
    int Rank,
    string Title,
    string Caption,
    string Unit,
    string CurrencyCode,

    /// <summary>What one point counts - "gift" / "gifts", "lead" / "leads".</summary>
    string CountSingular,
    string CountPlural,

    IReadOnlyList<DashboardTrendPointResponse> Points,
    IReadOnlyList<DashboardStatResponse> Stats,
    DashboardLinkResponse? Link,

    /// <summary>Where a click on a point goes.</summary>
    string? PointRoute,

    DashboardEmptyStateResponse Empty);

// ---- The breakdown donut and its three rings ----------------------------------------------

public sealed record DashboardSliceResponse(
    string Key,
    string Label,
    int Count,
    string Tone,
    string? Route);

public sealed record DashboardRingResponse(
    string Key,
    string Label,
    string Caption,

    /// <summary>Null when there is nothing to take a share of yet.</summary>
    decimal? Percent,

    string Tone,
    string? Route);

public sealed record DashboardHealthPanelResponse(
    int Rank,
    string Title,
    DashboardLinkResponse? Link,
    IReadOnlyList<DashboardSliceResponse> Slices,
    decimal? CentrePercent,
    string CentreCaption,
    IReadOnlyList<DashboardRingResponse> Rings);

// ---- The activity feed --------------------------------------------------------------------

public sealed record DashboardActivityItemResponse(
    string Id,
    string Actor,
    string Action,
    string KindKey,
    string KindLabel,
    string Icon,
    string? Target,
    DateTimeOffset OccurredAtUtc,
    bool IsFailure);

public sealed record DashboardActivityPanelResponse(
    int Rank,
    string Title,
    string? Caption,
    IReadOnlyList<DashboardActivityItemResponse> Items,
    IReadOnlyList<DashboardStatResponse> Stats,
    string? ItemRoute,
    DashboardLinkResponse? Link,
    DashboardEmptyStateResponse Empty);

// ---- The dated list -----------------------------------------------------------------------

public sealed record DashboardAgendaItemResponse(
    string Id,
    DateTimeOffset? AtUtc,
    string Title,
    string? Subtitle,

    /// <summary>"Overdue 2d", "Today", "In 3d" - worked out in the viewer's zone.</summary>
    string WhenLabel,

    bool IsLate,
    string? Route,
    IReadOnlyDictionary<string, string>? QueryParams = null);

public sealed record DashboardAgendaPanelResponse(
    int Rank,
    string Title,
    IReadOnlyList<DashboardAgendaItemResponse> Items,
    IReadOnlyList<DashboardStatResponse> Figures,
    DashboardLinkResponse? Link,
    DashboardEmptyStateResponse Empty);

// ---- The stage pipeline -------------------------------------------------------------------

/// <summary>
/// One fact under a pipeline row. When <c>Amount</c> is set the page prints it in compact money
/// form ahead of <c>Text</c> ("₹5L goal").
/// </summary>
public sealed record DashboardMetaResponse(
    string Icon,
    string Text,
    bool IsUrgent = false,
    decimal? Amount = null,
    string? CurrencyCode = null);

public sealed record DashboardPipelineRowResponse(
    string Id,
    string Code,
    string Name,
    string Kicker,
    string Detail,

    /// <summary>The dial on the leading row, 0 to 100; null draws a dash.</summary>
    decimal? DialPercent,

    IReadOnlyList<DashboardMetaResponse> Meta,

    /// <summary>The thin track on the following rows, 0 to 100.</summary>
    decimal ProgressPercent,

    string WhenLabel,
    bool IsUrgent,
    string? Route,
    IReadOnlyDictionary<string, string>? QueryParams = null);

public sealed record DashboardPipelineStageResponse(
    string Key,
    string Label,
    int Count,
    string EmptyTitle,

    /// <summary>The first few at this stage - the tile shows four.</summary>
    IReadOnlyList<DashboardPipelineRowResponse> Rows,

    /// <summary>
    /// The colour slot the stage is drawn in - one of the campaign lifecycle's eight (draft,
    /// submitted, approved, scheduled, active, paused, closing, closed), which the page's styles
    /// already colour. Null means the stage's own key is one of them.
    /// </summary>
    string? Palette = null);

public sealed record DashboardPipelinePanelResponse(
    int Rank,
    string Title,
    string? LiveLabel,
    string? TotalLabel,
    string DefaultStage,
    IReadOnlyList<DashboardPipelineStageResponse> Stages,
    string EmptyHint,
    DashboardLinkResponse? CreateAction,
    DashboardLinkResponse? Link,
    string? FootNote);

// ---- A ranked list ------------------------------------------------------------------------

public sealed record DashboardRankingItemResponse(
    string Key,
    string Label,
    decimal Value,
    int Count,

    /// <summary>This row's share of the whole, 0 to 100.</summary>
    decimal Share,

    string? Route,
    IReadOnlyDictionary<string, string>? QueryParams = null);

public sealed record DashboardRankingPanelResponse(
    int Rank,
    string Title,
    string? Caption,
    string Unit,
    string CurrencyCode,
    string CountSingular,
    string CountPlural,
    IReadOnlyList<DashboardRankingItemResponse> Items,
    IReadOnlyList<DashboardStatResponse> Figures,
    DashboardLinkResponse? HeaderLink,
    DashboardLinkResponse? Link,
    DashboardEmptyStateResponse Empty);

// ---- The newest-first feed ----------------------------------------------------------------

public sealed record DashboardFeedItemResponse(
    string Id,
    string Title,
    string Reference,
    DateTimeOffset AtUtc,
    string Tag,
    string StatusLabel,

    /// <summary>"ok", "wait", "warn", "bad" or "mute".</summary>
    string Tone,

    decimal? Value,
    string? ValueDisplay,
    string Icon,
    string? Route,
    IReadOnlyDictionary<string, string>? QueryParams = null);

public sealed record DashboardFeedPanelResponse(
    int Rank,
    string Title,
    string Unit,
    string CurrencyCode,
    string Eyebrow,
    decimal TotalValue,
    IReadOnlyList<DashboardChipResponse> Chips,
    IReadOnlyList<DashboardFeedItemResponse> Items,
    DashboardLinkResponse? Link,
    DashboardEmptyStateResponse Empty);

// ---- Shares of a whole --------------------------------------------------------------------

public sealed record DashboardShareItemResponse(
    string Key,
    string Label,

    /// <summary>Share of the WHOLE, the untraced part included - never renormalised.</summary>
    decimal Share,

    int Count,
    decimal Value,
    string Icon,
    string? Route);

public sealed record DashboardSharePanelResponse(
    int Rank,
    string Title,
    string Unit,
    string CurrencyCode,
    string CountPlural,
    decimal HeadlinePercent,
    string HeadlineLabel,

    /// <summary>The words after the leading item's name - "leads the way".</summary>
    string LeaderNote,

    IReadOnlyList<DashboardShareItemResponse> Items,

    /// <summary>The part no item accounts for ("Not traced"), when there is one.</summary>
    DashboardShareItemResponse? Rest,

    string? RestHint,
    DashboardLinkResponse? HeaderLink,
    DashboardEmptyStateResponse Empty);

// ---- A narrowing funnel -------------------------------------------------------------------

public sealed record DashboardFunnelStepResponse(
    string Label,
    int Count,

    /// <summary>Share of the first step, 0 to 100.</summary>
    decimal Percent,

    /// <summary>"brand", "wait", "warn" or "ok".</summary>
    string Tone,

    string? Route);

public sealed record DashboardFunnelAlertResponse(
    string Label,
    string ActionLabel,
    string? Route,
    bool IsOk);

public sealed record DashboardFunnelPanelResponse(
    int Rank,
    string Title,
    decimal HeadlinePercent,
    string HeadlineLabel,
    string HeadlineCaption,
    IReadOnlyList<DashboardFunnelStepResponse> Steps,
    DashboardFunnelAlertResponse? Alert,
    DashboardLinkResponse? HeaderLink);

/// <summary>The query string of every dashboard endpoint.</summary>
public sealed class DashboardFilter
{
    /// <summary>
    /// The viewer's IANA zone, so "today" and each day of the curve are the viewer's days. An
    /// unknown name falls back to the deployment's display zone rather than failing the page.
    /// </summary>
    public string? TimeZone { get; set; }
}
