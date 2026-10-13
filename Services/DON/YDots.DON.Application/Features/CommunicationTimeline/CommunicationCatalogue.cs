using YDots.DON.Application.Common.Models;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.CommunicationTimeline;

/// <summary>
/// The Communication Timeline's vocabularies, with the words the screen shows.
///
/// SERVED, NOT TYPED INTO THE SCREEN. The timeline had its own outcome list - "Connected",
/// "Interested", "Meeting scheduled" - that matched nothing the server stores, so a logged outcome
/// was refused and the outcome filters and counts never matched a row. Value is what is stored;
/// label is what a person reads.
/// </summary>
public static class CommunicationCatalogue
{
    /// <summary>The channels a communication is logged on. The description is the timeline's lane heading.</summary>
    public static IReadOnlyList<LookupItem> InteractionTypes { get; } =
    [
        new("Call", "Call", "Calls"),
        new("Email", "Email", "Emails"),
        new("Sms", "SMS", "SMS"),
        new("WhatsApp", "WhatsApp", "WhatsApp"),
        new("Meeting", "Meeting", "Meetings"),
        new("Visit", "Visit", "Visits"),
        new("Note", "Internal note", "Notes")
    ];

    public const string ReachedGroup = "reached";
    public const string WarmGroup = "warm";
    public const string AwaitingGroup = "awaiting";
    public const string ClosedGroup = "closed";

    /// <summary>
    /// The four kinds of result the outcome picker lays the outcomes out in, and the tone each one
    /// is drawn in. Every outcome's description below names its group.
    /// </summary>
    public static IReadOnlyList<LookupItem> OutcomeGroups { get; } =
    [
        new(ReachedGroup, "Reached", "Contact was made"),
        new(WarmGroup, "Warm signals", "Moving towards a gift"),
        new(AwaitingGroup, "Awaiting", "Needs another touch"),
        new(ClosedGroup, "Closed", "Stop or correct")
    ];

    /// <summary>
    /// Every outcome a person may record, with the group it belongs to as its description.
    /// NotContacted is a state, never something logged.
    /// </summary>
    public static IReadOnlyList<LookupItem> Outcomes { get; } =
    [
        new(nameof(ContactOutcome.Reached), "Connected", ReachedGroup),
        new(nameof(ContactOutcome.NoAnswer), "No answer", AwaitingGroup),
        new(nameof(ContactOutcome.Interested), "Interested", WarmGroup),
        new(nameof(ContactOutcome.CallbackRequested), "Requested callback", AwaitingGroup),
        new(nameof(ContactOutcome.MeetingScheduled), "Meeting scheduled", ReachedGroup),
        new(nameof(ContactOutcome.MeetingCompleted), "Meeting completed", WarmGroup),
        new(nameof(ContactOutcome.InformationRequested), "Requested information", AwaitingGroup),
        new(nameof(ContactOutcome.DonationDiscussion), "Donation discussion", WarmGroup),
        new(nameof(ContactOutcome.NotInterested), "Not interested", ClosedGroup),
        new(nameof(ContactOutcome.WrongNumber), "Wrong contact", ClosedGroup),
        new(nameof(ContactOutcome.DoNotContact), "Do not contact", ClosedGroup)
    ];

    /// <summary>The group an outcome belongs to, or null for one nobody logs (NotContacted).</summary>
    public static string? OutcomeGroup(string outcome) =>
        Outcomes.FirstOrDefault(item => item.Value == outcome)?.Description;

    public static IReadOnlyList<LookupItem> Directions { get; } =
    [
        new(nameof(InteractionDirection.Outgoing), "Outgoing"),
        new(nameof(InteractionDirection.Incoming), "Incoming"),
        new(nameof(InteractionDirection.Internal), "Internal")
    ];

    public static IReadOnlyList<LookupItem> EngagementLevels { get; } =
        [.. Enum.GetValues<EngagementLevel>().Select(value => new LookupItem(value.ToString(), value.ToString()))];

    public static IReadOnlyList<LookupItem> Qualities { get; } =
        [.. Enum.GetValues<CommunicationQuality>().Select(value => new LookupItem(value.ToString(), value.ToString()))];

    /// <summary>The word for an outcome, as the timeline prints it.</summary>
    public static string OutcomeLabel(ContactOutcome outcome) =>
        Outcomes.FirstOrDefault(item => item.Value == outcome.ToString())?.Label
        ?? (outcome == ContactOutcome.NotContacted ? "Not contacted" : outcome.ToString());

    public static string TypeLabel(InteractionType type) =>
        InteractionTypes.FirstOrDefault(item => item.Value == type.ToString())?.Label ?? type.ToString();

    /// <summary>The consent channel a contact type travels over. Null for a meeting, visit or note.</summary>
    public static ConsentChannel? ChannelFor(InteractionType type) =>
        type switch
        {
            InteractionType.Call => ConsentChannel.PhoneCall,
            InteractionType.Email => ConsentChannel.Email,
            InteractionType.Sms => ConsentChannel.Sms,
            InteractionType.WhatsApp => ConsentChannel.WhatsApp,
            _ => null
        };

    /// <summary>
    /// Who started an exchange. Stored for entries logged on the timeline; for the older automatic
    /// ones it is read from the outcome, since a donor who called back started that exchange.
    /// </summary>
    /// <summary>
    /// How often there is contact: High, Moderate or Low frequency, from the average gap between
    /// conversations. Internal notes are not contact and do not count.
    /// </summary>
    public static string ContactRhythm(IReadOnlyList<DonorInteraction> interactions)
    {
        var contacts = interactions
            .Where(interaction => interaction.InteractionType != InteractionType.Note)
            .Select(interaction => interaction.OccurredAtUtc)
            .OrderBy(instant => instant)
            .ToList();

        if (contacts.Count < 2)
        {
            return "Low frequency";
        }

        var averageGapDays = (contacts[^1] - contacts[0]).TotalDays / (contacts.Count - 1);

        return averageGapDays switch
        {
            <= 3 => "High frequency",
            <= 7 => "Moderate frequency",
            _ => "Low frequency"
        };
    }

    /// <summary>
    /// Improving, Stable or Declining: the engagement recorded on the later half of the
    /// conversations against the earlier half. Only entries where somebody recorded a level count,
    /// so the automatic entries do not drag the reading towards a level nobody chose.
    /// </summary>
    public static string EngagementTrend(IReadOnlyList<DonorInteraction> interactions)
    {
        var levels = interactions
            .Where(interaction => interaction.EngagementLevel is not null)
            .OrderBy(interaction => interaction.OccurredAtUtc)
            .Select(interaction => (double)(int)interaction.EngagementLevel!.Value)
            .ToList();

        if (levels.Count < 2)
        {
            return "Stable";
        }

        var half = levels.Count / 2;
        var earlier = levels.Take(half).Average();
        var later = levels.Skip(half).Average();

        return (later - earlier) switch
        {
            > 0.3 => "Improving",
            < -0.3 => "Declining",
            _ => "Stable"
        };
    }

    public static InteractionDirection DirectionOf(DonorInteraction interaction) =>
        interaction.Direction
        ?? (interaction.InteractionType == InteractionType.Note
            ? InteractionDirection.Internal
            : interaction.Outcome == ContactOutcome.CallbackRequested
                ? InteractionDirection.Incoming
                : InteractionDirection.Outgoing);
}
