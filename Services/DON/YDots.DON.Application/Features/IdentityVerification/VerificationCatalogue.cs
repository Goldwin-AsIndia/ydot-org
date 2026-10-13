using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Features.FollowUpPlanner;
using YDots.DON.Application.Features.IdentityVerification.DTOs;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.IdentityVerification;

/// <summary>
/// Identity verification's words: channels, statuses, confidence, and the trail of a donor's
/// verification attempts.
///
/// SERVED, NOT TYPED INTO THE SCREEN. The options went out as enum names, and the screen
/// compared the status with its own words - "Challenge sent" against the "ChallengeSent" the
/// server sends - so the code box never opened and Verify code always refused. It also built the
/// trail itself from four timestamps, with the cancellation dated by when the attempt was created.
/// </summary>
public static class VerificationCatalogue
{
    public const string AllView = "all";
    public const string CurrentView = "current";

    public static IReadOnlyList<LookupItem> ChannelOptions { get; } =
    [
        .. Enum.GetValues<VerificationChannel>()
            .Select(channel => new LookupItem(channel.ToString(), FollowUpQueueCatalogue.ChannelLabel(channel.ToString())))
    ];

    public static IReadOnlyList<LookupItem> StatusOptions { get; } =
    [
        new(nameof(VerificationStatus.NotStarted), "Not started", "No code has been sent yet."),
        new(nameof(VerificationStatus.ChallengeSent), "Challenge sent", "Set when a code is sent; waiting for the donor to read it back."),
        new(nameof(VerificationStatus.Verified), "Verified", "Reached only by the donor giving the right code."),
        new(nameof(VerificationStatus.Failed), "Failed", "Set when the attempts are used up."),
        new(nameof(VerificationStatus.Escalated), "Escalated", "Handed to a reviewer."),
        new(nameof(VerificationStatus.Cancelled), "Cancelled", "Stopped; no further codes are accepted."),
        new(nameof(VerificationStatus.Expired), "Expired", "The code ran out of time before it was used.")
    ];

    public static IReadOnlyList<LookupItem> ConfidenceOptions { get; } =
    [
        new(nameof(IdentityConfidence.High), "High"),
        new(nameof(IdentityConfidence.Medium), "Medium"),
        new(nameof(IdentityConfidence.Low), "Low"),
        new(nameof(IdentityConfidence.Unknown), "Not assessed")
    ];

    public static string Label(IReadOnlyList<LookupItem> options, string value) =>
        options.FirstOrDefault(option => option.Value == value)?.Label ?? value;

    public static string ViewOf(string? view) =>
        string.Equals(view?.Trim(), CurrentView, StringComparison.OrdinalIgnoreCase) ? CurrentView : AllView;

    /// <summary>
    /// What happened on each attempt, newest attempt first. Escalation and cancellation are dated
    /// from the audit entry the command wrote, and from the record's last change where there is none.
    /// </summary>
    public static IReadOnlyList<VerificationTrailEntryResponse> Trail(
        IReadOnlyList<DonorIdentityVerification> attempts,
        IReadOnlyDictionary<(Guid Target, string Action), DateTimeOffset> audited,
        IReadOnlyDictionary<Guid, string> names,
        int maximumAttempts)
    {
        var entries = new List<VerificationTrailEntryResponse>();

        foreach (var attempt in attempts)
        {
            var steps = new List<VerificationTrailEntryResponse>();
            var channel = Label(ChannelOptions, attempt.VerificationChannel.ToString());
            DateTimeOffset? At(string action) =>
                audited.TryGetValue((attempt.Id, action), out var at) ? at : attempt.UpdatedAtUtc;

            steps.Add(new(attempt.VerificationReference, "Verification started",
                attempt.VerificationPurpose ?? "Identity check", attempt.CreatedAtUtc, names.GetValueOrDefault(attempt.CreatedByUserId)));

            if (attempt.SentAtUtc is not null)
            {
                steps.Add(new(attempt.VerificationReference, "Challenge sent",
                    $"{channel} to {attempt.MaskedDestination ?? "the donor"}", attempt.SentAtUtc, null));
            }

            if (attempt.VerifiedAtUtc is not null)
            {
                steps.Add(new(attempt.VerificationReference, "Verified",
                    $"Identity confidence {Label(ConfidenceOptions, attempt.IdentityConfidence.ToString())}", attempt.VerifiedAtUtc, null));
            }

            if (attempt.Status == VerificationStatus.Failed)
            {
                steps.Add(new(attempt.VerificationReference, "Attempts used up",
                    $"{attempt.AttemptCount} of {maximumAttempts} attempts", attempt.UpdatedAtUtc, null));
            }

            if (attempt.Status == VerificationStatus.Expired)
            {
                steps.Add(new(attempt.VerificationReference, "Code expired",
                    "The code was not used in time", attempt.ExpiryAtUtc ?? attempt.UpdatedAtUtc, null));
            }

            if (!string.IsNullOrWhiteSpace(attempt.EscalationReason))
            {
                steps.Add(new(attempt.VerificationReference, "Escalated for review",
                    attempt.EscalationReason!, At(AuditActionCodes.VerificationEscalated), attempt.ReviewerName));
            }

            if (!string.IsNullOrWhiteSpace(attempt.CancellationReason))
            {
                steps.Add(new(attempt.VerificationReference, "Cancelled",
                    attempt.CancellationReason!, At(AuditActionCodes.VerificationCancelled), null));
            }

            entries.AddRange(steps.OrderByDescending(step => step.AtUtc ?? DateTimeOffset.MinValue));
        }

        return entries;
    }

    public static IReadOnlyList<QueueViewResponse> TrailViews(
        IReadOnlyList<VerificationTrailEntryResponse> trail,
        string? currentReference) =>
    [
        new(AllView, "All attempts", "Every verification this donor has had", trail.Count),
        new(CurrentView, "Current attempt", "The most recent verification only",
            trail.Count(entry => entry.VerificationReference == currentReference))
    ];
}
