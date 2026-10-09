using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.Features.FollowUpPlanner.DTOs;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.FollowUpPlanner.Mappings;

/// <summary>
/// Who is looking at a follow-up, and what they may do to one.
///
/// THE ACTIONS ON A ROW DEPEND ON THE ROW AS WELL AS THE PERSON. The role flow says Execute is
/// "available only to the user this follow-up is assigned to", so two rows on the same screen can
/// offer one person different buttons - which is why this travels into the mapping rather than
/// being a screen-level list.
/// </summary>
public sealed record FollowUpViewer(
    Guid UserId,
    bool CanSeeContact,
    bool CanSeeEvidence,
    bool CanMarkComplete,
    bool CanReschedule,
    bool CanCancel,
    bool CanAssign,
    DateTimeOffset Now,

    // The organisation's day, so a row's "overdue" is the same day-by-day reading the queue's
    // summary counts by. See FollowUpMappingConfig.ToResponse.
    DateTimeOffset TodayStartUtc,
    DonorSettings Settings,

    // The Organisation Admin acts on any follow-up, as if it were the assignee.
    bool IsTenantAdmin = false)
{
    public static FollowUpViewer For(ICurrentUser user, DateTimeOffset now, DonorSettings settings) =>
        new(
            user.UserId,
            user.CanSeeContact(),
            user.CanSeeEvidence(),
            user.HasPermission(PermissionCodes.FollowUpPlannerMarkComplete),
            user.HasPermission(PermissionCodes.FollowUpPlannerReschedule),
            user.HasPermission(PermissionCodes.FollowUpPlannerCancelTask),
            user.HasPermission(PermissionCodes.FollowUpPlannerAssign),
            now,
            ReportingCalendar.Today(now, settings).StartUtc,
            settings,
            user.IsTenantAdmin);
}

/// <summary>Manual mapping for DON-UI-08.</summary>
public static class FollowUpMappingConfig
{
    /// <summary>The states a follow-up still needs doing in.</summary>
    public static bool IsOpen(FollowUpStatus status) =>
        status is FollowUpStatus.Planned or FollowUpStatus.Assigned or FollowUpStatus.Rescheduled;

    public static FollowUpResponse ToResponse(
        this FollowUpTask task,
        FollowUpViewer viewer,
        ConsentWarningResponse consentWarning,
        IReadOnlyList<FollowUpHistoryEntryResponse>? history = null,
        string? donorCampaignName = null)
    {
        var isOpen = IsOpen(task.Status);
        var leadName = task.Lead is null ? null : LeadMappingConfig.BuildDisplayName(task.Lead);

        // THE PERSON THE FOLLOW-UP IS ABOUT, AND THEIR OWNER. A donor first: a follow-up raised on a
        // converted lead's donor is about the donor now.
        var recordName = task.Donor?.DisplayName ?? leadName;
        var recordOwnerId = task.Donor is not null ? task.Donor.RelationshipOwnerUserId : task.Lead?.OwnerUserId;
        var recordOwnerName = task.Donor is not null ? task.Donor.RelationshipOwnerName : task.Lead?.OwnerName;
        var phone = task.Donor?.PrimaryPhone ?? task.Lead?.MobileNumber;
        var email = task.Donor?.PrimaryEmail ?? task.Lead?.EmailAddress;

        return new(
            task.Id,
            task.FollowUpReference,
            task.DonorId,
            task.Donor?.DonorNumber,
            task.Donor?.DisplayName,
            task.LeadId,
            task.Lead?.LeadReference,
            task.RelationshipOwnerUserId,
            task.RelationshipOwnerName,
            task.Purpose,
            task.PermittedChannel.ToString(),
            task.PreferredLanguage,
            viewer.CanSeeContact ? task.PreferredContactTimeUtc : null,
            task.NextAction,
            task.DueAtUtc,
            task.Priority.ToString(),
            ContactMasking.Confidential(task.Notes, viewer.CanSeeEvidence),
            task.ConsentWarningAcknowledged,
            task.ConsentNoticeVersion,
            task.ConsentAcknowledgedAtUtc,
            task.Status.ToString(),
            task.CompletedAtUtc,
            task.CompletionOutcome,
            task.RescheduleReason,
            task.CancellationReason,
            task.CreatedAtUtc,
            task.Version,
            !viewer.CanSeeEvidence,
            !viewer.CanSeeContact,
            consentWarning,
            PermittedActionsFor(task, viewer),
            leadName,
            recordName,
            recordOwnerId,
            recordOwnerName,
            task.Lead?.Campaign?.Name ?? donorCampaignName,
            ContactMasking.Phone(phone, viewer.CanSeeContact),
            ContactMasking.Email(email, viewer.CanSeeContact),
            !viewer.CanSeeContact,
            task.RelationshipOwnerUserId == viewer.UserId,
            isOpen,

            // OVERDUE IS "DUE BEFORE TODAY", BY THE ORGANISATION'S CALENDAR - the same line the
            // queue's summary draws. It used to be "due before this instant", so a call booked for
            // nine this morning was Overdue on its row by ten and Due today in the tile above it,
            // and the two counts could never be made to agree.
            isOpen && task.DueAtUtc is not null && task.DueAtUtc < viewer.TodayStartUtc,
            task.EscalatedAtUtc,
            task.EscalationReason,
            history ?? [],
            isOpen
                ? ReportingCalendar.DescribeDue(
                    task.DueAtUtc, ReportingCalendar.DateOf(viewer.Now, viewer.Settings), viewer.Settings)
                : task.Status == FollowUpStatus.Completed
                  && task.CompletedAtUtc >= viewer.TodayStartUtc
                  && task.CompletedAtUtc < viewer.TodayStartUtc.AddDays(1)
                    ? "Completed today"
                    : "Closed",
            FollowUpExecutionCatalogue.Label(FollowUpExecutionCatalogue.ExecutionStatuses, task.ExecutionStatus?.ToString()),
            FollowUpExecutionCatalogue.Label(FollowUpExecutionCatalogue.CompletionReasons, task.CompletionReason?.ToString()),
            FollowUpExecutionCatalogue.Label(FollowUpExecutionCatalogue.Dispositions, task.Disposition?.ToString()));
    }

    /// <summary>
    /// What THIS viewer may do to THIS follow-up.
    ///
    /// VIEW AND VIEW HISTORY FOR EVERYBODY WHO CAN SEE IT - including the owner of the lead or
    /// donor a colleague's follow-up is about, who per the role flow sees it in their queue but may
    /// not execute it.
    ///
    /// EXECUTE, RESCHEDULE AND CANCEL ONLY FOR THE ASSIGNEE. The flow names Execute as "available
    /// only to the user this follow-up is assigned to", and moving or cancelling somebody else's
    /// promised call is the same kind of act. The handlers refuse it too; this only decides which
    /// buttons are drawn.
    ///
    /// REASSIGN AND ESCALATE FOR WHOEVER MAY ASSIGN follow-ups - the fundraising team - because
    /// routing work is a manager's act rather than the assignee's.
    /// </summary>
    public static IReadOnlyList<string> PermittedActionsFor(FollowUpTask task, FollowUpViewer viewer)
    {
        var actions = new List<string> { "View", "View history" };

        if (!IsOpen(task.Status))
        {
            return actions;
        }

        // The Organisation Admin is treated as the assignee: it has no restriction in its own
        // Organisation, and the handlers let it act on any follow-up too.
        var assignedToViewer = task.RelationshipOwnerUserId == viewer.UserId || viewer.IsTenantAdmin;

        if (assignedToViewer && viewer.CanMarkComplete)
        {
            actions.Add("Execute");
        }

        if (assignedToViewer && viewer.CanReschedule)
        {
            actions.Add("Reschedule");
        }

        if (assignedToViewer && viewer.CanCancel)
        {
            actions.Add("Cancel");
        }

        if (viewer.CanAssign)
        {
            actions.Add("Reassign");
            actions.Add("Escalate");
        }

        return actions;
    }

    /// <summary>
    /// Turns the donor's consent rows into the warning the planner has to display.
    ///
    /// The warning is built from what consent actually says rather than from a stored flag, so
    /// a withdrawal recorded five minutes ago is reflected the next time the screen is opened.
    /// A "do not contact" donor produces a Blocking warning: no channel is permitted at all.
    /// </summary>
    public static ConsentWarningResponse BuildConsentWarning(
        Donor? donor,
        IReadOnlyList<Consent> consents)
    {
        var everyChannel = Enum.GetValues<ConsentChannel>();

        if (donor is not null && donor.DoNotContact)
        {
            return new ConsentWarningResponse(
                true,
                "Blocking",
                "This donor is marked Do not contact. No follow-up may be scheduled on any channel.",
                [],
                [.. everyChannel.Select(channel => channel.ToString())]);
        }

        var granted = consents
            .Where(consent => consent.Status == ConsentStatus.Active && consent.ConsentState == ConsentState.Granted)
            .Select(consent => consent.Channel)
            .Distinct()
            .ToList();

        var refused = consents
            .Where(consent => consent.ConsentState == ConsentState.Withdrawn)
            .Select(consent => consent.Channel)
            .Distinct()
            .Where(channel => !granted.Contains(channel))
            .ToList();

        // Nothing recorded at all is its own case: it is not a refusal, but it is not a
        // permission either, and the planner has to say so rather than assume.
        if (consents.Count == 0)
        {
            return new ConsentWarningResponse(
                true,
                "Caution",
                "No consent has been recorded for this record. Confirm permission before scheduling contact.",
                [],
                []);
        }

        var prohibited = refused.Select(channel => channel.ToString()).ToList();

        return granted.Count == 0
            ? new ConsentWarningResponse(
                true,
                "Blocking",
                "Every recorded channel has been withdrawn. No follow-up may be scheduled.",
                [],
                prohibited)
            : new ConsentWarningResponse(
                prohibited.Count > 0,
                prohibited.Count > 0 ? "Caution" : "None",
                prohibited.Count > 0
                    ? $"Contact is not permitted by {string.Join(", ", prohibited)}. Use a permitted channel."
                    : "Every recorded channel permits contact.",
                [.. granted.Select(channel => channel.ToString())],
                prohibited);
    }
}
