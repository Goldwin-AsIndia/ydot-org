using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Domain.Enums;

namespace YDots.CAM.Application.Features.Dashboard;

/// <summary>
/// The words, ranks and destinations of CAM's part of the landing page.
///
/// A ROUTE IS SENT ONLY WITH THE PERMISSION ITS SCREEN'S GUARD ASKS FOR - see the note on the
/// contract. The readiness checklist and the lifecycle actions both work on one campaign, so a
/// row about them opens that campaign (Campaign Detail holds pause, resume and close) rather
/// than a list the person then has to search.
///
/// RANKS ARE SHARED WITH IAM, DON AND PAY: lower wins a tile, and the rail shows the four lowest.
/// CAM's pipeline outranks everything for the Campaigns tile; its calendar and asset funnel stand
/// in for DON's follow-ups and lead funnel only when the caller cannot read those.
/// </summary>
public static class CampaignDashboardCatalogue
{
    public const string Module = "CAM";

    /// <summary>How far ahead the calendar looks.</summary>
    public const int CalendarDays = 14;

    /// <summary>Rows per pipeline stage. The tile shows four.</summary>
    public const int RowsPerStage = 4;

    /// <summary>A screen a campaign tile leads to, and the permission its route guard asks for.</summary>
    public sealed record Screen(string Route, string Permission);

    public static readonly Screen Register =
        new("/app/fundraising/campaigns/campaign-register", PermissionCodes.CampaignsView);

    public static readonly Screen Wizard =
        new("/app/fundraising/campaigns/campaign-wizard", PermissionCodes.CampaignsCreate);

    /// <summary>One campaign, by its code in <c>?ref=</c>.</summary>
    public static readonly Screen Detail =
        new("/app/fundraising/campaigns/campaign-detail", PermissionCodes.CampaignsView);

    public static readonly Screen AssetManager =
        new("/app/fundraising/campaigns/tracking-asset-manager", PermissionCodes.TrackingAssetsView);

    /// <summary>One campaign's checklist, by its code in <c>?ref=</c>.</summary>
    public static readonly Screen Readiness =
        new("/app/fundraising/campaigns/campaign-readiness-checklist", PermissionCodes.ReadinessView);

    /// <summary>Lower wins. See the note on the class.</summary>
    public static class Ranks
    {
        public const int Live = 30;
        public const int Pipeline = 50;
        public const int AssetsLive = 55;
        public const int Traced = 56;

        public const int CounterAssetsLive = 80;
        public const int CounterChecksOpen = 82;
        public const int CounterEndingSoon = 84;
        public const int CounterClosures = 86;

        public const int PipelinePanel = 10;
        public const int SourcesPanel = 10;
        public const int CalendarPanel = 20;
        public const int AssetFunnelPanel = 20;

        /// <summary>Below PAY's Donation health, which a campaign role normally receives too.</summary>
        public const int HealthPanel = 20;

        public const int NewCampaign = 20;
    }

    /// <summary>The stages of the pipeline, in lifecycle order. Cancelled is a foot note.</summary>
    public static IReadOnlyList<(CampaignStatus Status, string Key, string Label)> Stages { get; } =
    [
        (CampaignStatus.Draft, "draft", "Draft"),
        (CampaignStatus.Submitted, "submitted", "Submitted"),
        (CampaignStatus.Approved, "approved", "Approved"),
        (CampaignStatus.Scheduled, "scheduled", "Scheduled"),
        (CampaignStatus.Active, "active", "Active"),
        (CampaignStatus.Paused, "paused", "Paused"),
        (CampaignStatus.Closing, "closing", "Closing"),
        (CampaignStatus.Closed, "closed", "Closed")
    ];

    /// <summary>The glyph for a tracking asset's channel, by the channel's code.</summary>
    public static string ChannelIcon(string code) => code.Trim().ToUpperInvariant() switch
    {
        "MESSAGING" or "WHATSAPP" => "ri-whatsapp-line",
        "EMAIL" => "ri-mail-send-line",
        "OFFLINE" or "QR_POSTER" or "PRINT" => "ri-qr-code-line",
        "WEBSITE" => "ri-global-line",
        "SOCIAL" => "ri-share-circle-line",
        "SEARCH" => "ri-search-line",
        "REFERRAL" => "ri-links-line",
        "PARTNER" => "ri-team-line",
        "DIRECT" => "ri-cursor-line",
        _ => "ri-radar-line"
    };
}
