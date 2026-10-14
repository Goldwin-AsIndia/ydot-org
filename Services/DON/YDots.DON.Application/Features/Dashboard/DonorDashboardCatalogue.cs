using YDots.DON.Application.Common.Constants;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.Dashboard;

/// <summary>
/// The words, ranks and destinations of DON's part of the landing page.
///
/// TWO SETS OF SCREENS, CHOSEN BY SCOPE. The fundraising team works the Organisation's lists -
/// Lead Work Queue and All Donors - and DonorCare works My Leads and My Donors, which is how the
/// menu catalogue maps them. Both pairs answer the same permission, so the choice is made by
/// whose records the caller may read, not by role name.
///
/// A ROUTE IS SENT ONLY WITH THE PERMISSION ITS SCREEN'S GUARD ASKS FOR - see the note on the
/// contract. The Duplicate Review screen has no route in the client, so its row leads nowhere.
///
/// RANKS ARE SHARED WITH IAM, CAM AND PAY: lower wins a tile. DON's follow-ups and lead funnel
/// win their tiles outright; its intake curve, donor health, rankings and latest leads stand in
/// for the payment tiles only for a caller who cannot read donations.
/// </summary>
public static class DonorDashboardCatalogue
{
    public const string Module = "DON";

    /// <summary>The intake curve and the window figures cover a fortnight, like PAY's.</summary>
    public const int WindowDays = 14;

    /// <summary>Rows per pipeline stage. The tile shows four.</summary>
    public const int RowsPerStage = 4;

    /// <summary>A screen a DON tile leads to, and the permission its route guard asks for.</summary>
    public sealed record Screen(string Route, string Permission);

    public static readonly Screen LeadWorkQueueScreen =
        new("/app/fundraising/relationships/lead-work-queue", PermissionCodes.LeadWorkQueueView);

    /// <summary>One lead, by its id in <c>?leadId=</c>.</summary>
    public static readonly Screen MyLeadsScreen =
        new("/app/fundraising/relationships/my-leads", PermissionCodes.LeadWorkQueueView);

    public static readonly Screen DonorListScreen =
        new("/app/fundraising/relationships/donor-list", PermissionCodes.DonorsView);

    public static readonly Screen MyDonorsScreen =
        new("/app/fundraising/relationships/my-donor-list", PermissionCodes.DonorsView);

    /// <summary>One follow-up, by its id in <c>?followUpId=</c>.</summary>
    public static readonly Screen FollowUpQueueScreen =
        new("/app/fundraising/relationships/follow-up-queue", PermissionCodes.FollowUpPlannerView);

    public static readonly Screen FollowUpPlannerScreen =
        new("/app/fundraising/relationships/follow-up-planner", PermissionCodes.FollowUpPlannerSchedule);

    public static readonly Screen AssignmentBoardScreen =
        new("/app/fundraising/relationships/assignment-board", PermissionCodes.AssignmentBoardView);

    public static readonly Screen ConsentCentreScreen =
        new("/app/fundraising/relationships/consent-and-preference-centre", PermissionCodes.ConsentCentreView);

    public static readonly Screen IdentityVerificationScreen =
        new("/app/fundraising/relationships/donor-identity-verification", PermissionCodes.VerificationView);

    /// <summary>
    /// Capture Lead. The guard asks for the view code; the shortcut also needs the save code,
    /// because a capture form somebody cannot save is a dead end.
    /// </summary>
    public static readonly Screen LeadCaptureScreen =
        new("/app/fundraising/relationships/lead-capture", PermissionCodes.LeadCaptureView);

    /// <summary>Lower wins. See the note on the class.</summary>
    public static class Ranks
    {
        public const int OpenLeads = 40;
        public const int FollowUps = 60;
        public const int Donors = 70;
        public const int Ready = 75;

        public const int CounterDonors = 10;
        public const int CounterDueToday = 90;
        public const int CounterUnassigned = 92;
        public const int CounterConsents = 94;
        public const int CounterNotVerified = 96;

        /// <summary>The tiles DON owns outright: follow-ups and the lead funnel.</summary>
        public const int OwnPanel = 10;

        /// <summary>The tiles DON fills only for somebody PAY or CAM cannot serve.</summary>
        public const int StandInPanel = 20;

        public const int CaptureLead = 10;
    }

    /// <summary>The pipeline, in the order a lead moves through it.</summary>
    ///
    /// Each names the campaign stage whose colour it borrows - the page's styles colour those eight.
    public static IReadOnlyList<(LeadStatus Status, string Key, string Label, string Palette)> Stages { get; } =
    [
        (LeadStatus.New, "new", "New", "draft"),
        (LeadStatus.Assigned, "assigned", "Assigned", "submitted"),
        (LeadStatus.Contacted, "contacted", "Contacted", "approved"),
        (LeadStatus.Qualified, "qualified", "Qualified", "scheduled"),
        (LeadStatus.Nurture, "nurture", "Nurture", "paused"),
        (LeadStatus.Converted, "converted", "Converted", "active")
    ];

    /// <summary>The colour a lead's status reads in, on the four tones the page knows.</summary>
    public static string ToneOf(LeadStatus status) => status switch
    {
        LeadStatus.Converted or LeadStatus.Qualified => "ok",
        LeadStatus.New or LeadStatus.Assigned => "wait",
        LeadStatus.Contacted or LeadStatus.Nurture => "warn",
        LeadStatus.Closed or LeadStatus.Suppressed => "bad",
        _ => "mute"
    };

    /// <summary>How warm a lead is, as a glyph.</summary>
    public static string IconOf(LeadTemperature temperature) => temperature switch
    {
        LeadTemperature.Hot => "ri-fire-line",
        LeadTemperature.Warm => "ri-sun-line",
        _ => "ri-snowflake-line"
    };

    /// <summary>"High potential".</summary>
    public static string PotentialLabel(DonationPotential potential) => $"{potential} potential";

    /// <summary>The glyph for a lead source, by the words it was captured with.</summary>
    public static string SourceIcon(string source)
    {
        var words = source.Trim().ToLowerInvariant();

        return words switch
        {
            _ when words.Contains("whats") => "ri-whatsapp-line",
            _ when words.Contains("mail") => "ri-mail-send-line",
            _ when words.Contains("qr") || words.Contains("poster") => "ri-qr-code-line",
            _ when words.Contains("web") || words.Contains("site") => "ri-global-line",
            _ when words.Contains("social") || words.Contains("insta") || words.Contains("face") => "ri-share-circle-line",
            _ when words.Contains("event") || words.Contains("walk") => "ri-calendar-event-line",
            _ when words.Contains("phone") || words.Contains("call") => "ri-phone-line",
            _ when words.Contains("refer") => "ri-links-line",
            _ => "ri-user-heart-line"
        };
    }
}
