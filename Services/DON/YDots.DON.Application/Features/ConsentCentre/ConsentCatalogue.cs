using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.FollowUpPlanner;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.ConsentCentre;

/// <summary>
/// The Consent Centre's words: channels, states, statuses, the recognition preference and the
/// views over a donor's consent trail.
///
/// SERVED, NOT TYPED INTO THE SCREEN. The options went out as enum names ("PhoneCall", "Sms",
/// "NotProvided"), the screen printed "Recognised / Anonymous" from a boolean itself, and its
/// "Active only / Withdrawn only" views were string tests in the browser - "Active only" kept a
/// superseded row whose state still read Granted.
/// </summary>
public static class ConsentCatalogue
{
    public const string AllView = "all";

    /// <summary>The same channel words the follow-up screens use, in the catalogue's own order.</summary>
    public static IReadOnlyList<LookupItem> ChannelOptions { get; } =
    [
        .. Enum.GetValues<ConsentChannel>()
            .Select(channel => new LookupItem(channel.ToString(), FollowUpQueueCatalogue.ChannelLabel(channel.ToString())))
    ];

    public static IReadOnlyList<LookupItem> StateOptions { get; } =
    [
        new(nameof(ConsentState.Granted), "Granted", "The donor agreed to be contacted on this channel."),
        new(nameof(ConsentState.Pending), "Pending", "Asked for, not yet confirmed."),
        new(nameof(ConsentState.Withdrawn), "Withdrawn", "The donor withdrew; no contact on this channel."),
        new(nameof(ConsentState.NotProvided), "Not provided", "Nothing recorded for this channel.")
    ];

    public static IReadOnlyList<LookupItem> StatusOptions { get; } =
    [
        new(nameof(ConsentStatus.Active), "Active", "The record in force now."),
        new(nameof(ConsentStatus.Expired), "Expired", "Its expiry time has passed."),
        new(nameof(ConsentStatus.Withdrawn), "Withdrawn", "Ended by a withdrawal."),
        new(nameof(ConsentStatus.Superseded), "Superseded", "Replaced by a correction; kept in the trail.")
    ];

    /// <summary>The public-recognition preference - "true" may be named in public acknowledgements.</summary>
    public static IReadOnlyList<LookupItem> RecognitionOptions { get; } =
    [
        new("false", "Anonymous", "Never named in public acknowledgements."),
        new("true", "Recognised", "May be named in public acknowledgements.")
    ];

    /// <summary>The views over one donor's trail, each counted with the rule <see cref="Matches"/> filters by.</summary>
    public static IReadOnlyList<QueueViewResponse> TrailViews(IReadOnlyList<Consent> trail) =>
    [
        new(AllView, "All consents", "Every record, including corrected and withdrawn ones", trail.Count),
        new("active", "Active only", "The records in force now", trail.Count(consent => Matches(consent, "active"))),
        new("withdrawn", "Withdrawn only", "Records ended by a withdrawal", trail.Count(consent => Matches(consent, "withdrawn")))
    ];

    /// <summary>The view in effect: one of <see cref="TrailViews"/>, or "all".</summary>
    public static string ViewOf(string? view) =>
        view?.Trim().ToLowerInvariant() is "active" or "withdrawn" ? view.Trim().ToLowerInvariant() : AllView;

    public static bool Matches(Consent consent, string view) =>
        view switch
        {
            "active" => consent.Status == ConsentStatus.Active,
            "withdrawn" => consent.ConsentState == ConsentState.Withdrawn || consent.Status == ConsentStatus.Withdrawn,
            _ => true
        };
}
