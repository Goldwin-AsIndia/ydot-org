using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.Features.CommunicationTimeline.DTOs;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;
using YDots.DON.Domain.Services;

namespace YDots.DON.Application.Features.CommunicationTimeline.Queries;

/// <summary>
/// The Communication Timeline for a lead, or for the donor it became.
///
/// EXACTLY ONE OF THE TWO IDS IS GIVEN. The screen is reached from the Lead Work Queue ("opens
/// the selected lead's Communication Timeline"), from My Leads, from the Follow-Up Queue's View
/// History, and from Donor 360 - the first three hold a lead id and the last a donor id.
/// </summary>
public sealed record GetCommunicationTimelineQuery(Guid? LeadId, Guid? DonorId);

/// <summary>
/// The same timeline as a CSV. Needs the export permission; what it holds is exactly what the
/// caller could already read on screen, notes masked the same way.
/// </summary>
public sealed record ExportCommunicationTimelineQuery(Guid? LeadId, Guid? DonorId);

/// <summary>
/// The read side of the Communication Timeline.
///
/// WHY IT READS BY BOTH IDS. The document's conversion rule is that a lead which becomes a donor
/// "retains the existing owner and Communication Timeline history". Interactions recorded before
/// the conversion carry the LEAD id; those recorded after carry the DONOR id. Reading only one
/// would drop half the history at the moment the record matters most, so the handler resolves
/// whichever id it was given to BOTH and merges.
/// </summary>
public sealed class CommunicationTimelineQueryHandler(
    ILeadRepository leadRepository,
    IDonorRepository donorRepository,
    IFollowUpRepository followUpRepository,
    IInteractionTimelineReader timelineReader,
    IDonationLedger ledger,
    IExportService exportService,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings)
{
    private const int MaximumEntries = 200;

    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<CommunicationTimelineResponse>> HandleAsync(
        GetCommunicationTimelineQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        if (query.LeadId is null && query.DonorId is null)
        {
            return Result.Failure<CommunicationTimelineResponse>(Error.Validation(
                "Name the lead or the donor whose timeline you want.",
                [new ValidationError("leadId", "Give a lead id or a donor id.")]));
        }

        Lead? lead = null;
        Donor? donor = null;

        if (query.LeadId is Guid leadId)
        {
            lead = await leadRepository.GetByIdAsync(leadId, cancellationToken);

            if (lead is null || lead.OrganisationId != currentUser.OrganisationId)
            {
                return NotFound();
            }

            // A CONVERTED LEAD CARRIES ITS DONOR. Following it is what keeps the post-conversion
            // half of the history on screen.
            if (lead.ConvertedDonorId is Guid convertedDonorId)
            {
                donor = await donorRepository.GetByIdAsync(convertedDonorId, cancellationToken);
            }
        }

        if (query.DonorId is Guid donorId)
        {
            donor = await donorRepository.GetByIdAsync(donorId, cancellationToken);

            if (donor is null || donor.OrganisationId != currentUser.OrganisationId)
            {
                return NotFound();
            }

            // And the other direction: a donor that came from a lead keeps the lead's earlier
            // conversations, which is the half the document explicitly promises to preserve.
            lead ??= await leadRepository.GetConvertedFromAsync(donor.Id, cancellationToken);
        }

        if (lead is null && donor is null)
        {
            return NotFound();
        }

        // OWN-RECORDS SCOPE, CHECKED ON WHOEVER OWNS THE PERSON NOW. It used to be checked on the
        // lead alone, so a caller limited to their own records who arrived with a DONOR id - a
        // donor with no lead behind it - read that donor's conversations unchecked. A donor's
        // owner is the relationship owner; a lead that has not converted is owned by its owner.
        //
        // THE ASSIGNEE OF AN OPEN FOLLOW-UP ON THE RECORD IS LET IN TOO. The role flow assigns a
        // follow-up on an unassigned lead to somebody who does not own it, and they cannot execute
        // it blind - they need the history of who they are about to call.
        if (currentUser.Scope.IsOwnRecordsOnly
            && !IsOwnedByCaller(lead, donor)
            && !await followUpRepository.HasOpenAssignedAsync(currentUser.UserId, lead?.Id, donor?.Id, cancellationToken))
        {
            return NotFound();
        }

        var interactions = await timelineReader.GetTimelineAsync(
            lead?.Id, donor?.Id, MaximumEntries, cancellationToken);

        var canSeeContact = currentUser.CanSeeContact();
        var canEditAny = currentUser.Scope.IsOrganisationWide;
        var now = clock.UtcNow;

        var entries = interactions
            .Select(interaction => BuildEntry(interaction, canSeeContact, canEditAny || interaction.PerformedByUserId == currentUser.UserId))
            .ToList();

        // The follow-up picture: the next open one across the lead and the donor it became, and
        // how many have ever been planned and completed.
        var openFollowUps = new List<FollowUpTask>();

        if (lead is not null)
        {
            openFollowUps.AddRange(await followUpRepository.GetOpenForLeadAsync(lead.Id, cancellationToken));
        }

        if (donor is not null)
        {
            openFollowUps.AddRange(await followUpRepository.GetOpenForDonorAsync(donor.Id, cancellationToken));
        }

        var next = openFollowUps
            .Where(task => task.DueAtUtc is not null)
            .DistinctBy(task => task.Id)
            .OrderBy(task => task.DueAtUtc)
            .FirstOrDefault();

        var (followUpCount, followUpCompleted) = await followUpRepository.GetCountsAsync(lead?.Id, donor?.Id, cancellationToken);

        // A donor with no lead behind it is credited to the campaign of their latest gift.
        string? campaignName = lead?.Campaign?.Name;
        Guid? campaignId = lead?.CampaignId;

        if (campaignName is null && donor is not null)
        {
            var giving = (await ledger.GetGivingAsync(donor.OrganisationId, [donor.Id], cancellationToken)).GetValueOrDefault(donor.Id);
            campaignName = giving?.LastCampaignName;
            campaignId = giving?.LastCampaignId;
        }

        var lastContacted = interactions
            .Where(interaction => interaction.InteractionType != InteractionType.Note)
            .Select(interaction => (DateTimeOffset?)interaction.OccurredAtUtc)
            .DefaultIfEmpty(lead?.LastContactedAtUtc)
            .Max();

        // A converted lead is a donor now: the timeline is the donor's, scored only while a lead.
        var isLead = lead is not null && donor is null;

        var healthScore = lead is null ? 0 : LeadHealth.Calculate(lead, now);

        return Result.Success(new CommunicationTimelineResponse(
            ScreenIds.CommunicationTimeline,
            ScreenRoutes.CommunicationTimeline,
            lead?.Id,
            lead?.LeadReference,
            donor?.Id,
            donor?.DonorNumber,
            donor?.DisplayName ?? BuildLeadName(lead!),
            ContactMasking.Phone(donor?.PrimaryPhone ?? lead?.MobileNumber, canSeeContact),
            ContactMasking.Email(donor?.PrimaryEmail ?? lead?.EmailAddress, canSeeContact),
            campaignName,
            lead?.Source,
            donor?.PreferredLanguage ?? lead?.PreferredLanguage ?? SupportedLanguages.Default,
            donor is not null ? donor.RelationshipOwnerName : lead?.OwnerName,
            donor?.Status.ToString() ?? lead?.Status.ToString() ?? string.Empty,

            // THE LEAD'S OWN READING, OR NOTHING. A donor with no lead behind it used to be shown
            // as "Warm" and "Medium" - two values nobody recorded.
            lead?.Temperature.ToString() ?? string.Empty,
            lead?.DonationPotential.ToString() ?? string.Empty,
            healthScore,
            entries,
            ToLookup<LeadTemperature>(),
            ToLookup<DonationPotential>(),
            CommunicationCatalogue.InteractionTypes,
            CommunicationCatalogue.Outcomes,
            BuildPermittedActions(isLead, lead, donor),
            !canSeeContact,
            DescribeScope(),
            entries.Count == 0 ? ScreenState.Empty : ScreenState.Initial,
            isLead,
            campaignId,
            lastContacted,
            next?.FollowUpReference,
            next?.DueAtUtc,
            next?.NextAction ?? next?.Purpose,
            next?.RelationshipOwnerName,
            followUpCount,
            followUpCompleted,
            CommunicationCatalogue.Directions,
            CommunicationCatalogue.EngagementLevels,
            CommunicationCatalogue.Qualities,
            lead is null ? string.Empty : LeadHealth.Band(healthScore),
            lead is null ? [] : LeadHealth.Explain(lead, now),
            CommunicationCatalogue.ContactRhythm(interactions),
            CommunicationCatalogue.EngagementTrend(interactions),
            interactions.Count(interaction => interaction.Outcome == ContactOutcome.Interested)));
    }

    /// <summary>
    /// The timeline as a file.
    ///
    /// BUILT FROM THE SAME ANSWER THE SCREEN GETS, so the scope check, the follow-up assignee's
    /// access and the masking of notes are not a second copy of those rules that could drift. The
    /// screen used to write this file itself, in the browser - no permission asked, and no record
    /// that somebody had taken a copy of a donor's conversations.
    /// </summary>
    public async Task<Result<ExportFile>> HandleAsync(
        ExportCommunicationTimelineQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);

        var timeline = await HandleAsync(
            new GetCommunicationTimelineQuery(query.LeadId, query.DonorId), cancellationToken);

        if (!timeline.IsSuccess)
        {
            return Result.Failure<ExportFile>(timeline.Error!);
        }

        var response = timeline.Value!;
        var label = (IReadOnlyList<LookupItem> options, string? value) =>
            options.FirstOrDefault(option => option.Value == value)?.Label ?? value ?? string.Empty;

        var rows = response.Entries
            .Select(entry => (IReadOnlyList<string>)
            [
                ReportingCalendar.DateOf(entry.OccurredAtUtc, _settings).ToString("yyyy-MM-dd"),
                entry.OccurredAtUtc.ToString("u"),
                label(response.InteractionTypeOptions, entry.InteractionType),
                entry.Direction,
                label(response.OutcomeOptions, entry.Outcome),
                entry.EngagementLevel ?? string.Empty,
                entry.Quality ?? string.Empty,
                entry.IsImportant ? "Yes" : "No",
                entry.PerformedByName ?? string.Empty,
                entry.Summary,
                entry.IsNotesMasked ? "Withheld" : entry.Notes ?? string.Empty,
                entry.AttachmentName ?? string.Empty
            ])
            .ToList();

        var reference = response.DonorReference ?? response.LeadReference ?? "record";

        var file = exportService.CreateCsv(
            $"ydot-timeline-{reference}",
            ["Date", "Recorded at (UTC)", "Type", "Direction", "Outcome", "Engagement", "Quality",
             "Important", "Recorded by", "Summary", "Internal notes", "Attachment"],
            rows);

        await auditWriter.WriteAsync(
            new AuditEntry(
                AuditActionCodes.CommunicationsExported,
                response.DonorId is not null ? nameof(Donor) : nameof(Lead),
                response.DonorId ?? response.LeadId,
                AuditResult.Succeeded,
                $"{rows.Count} communication(s) of {reference} exported. Reference {file.Reference}."),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Success(file);
    }

    private bool IsOwnedByCaller(Lead? lead, Donor? donor) =>
        donor is not null
            ? donor.RelationshipOwnerUserId == currentUser.UserId
            : lead!.OwnerUserId == currentUser.UserId;

    private static CommunicationTimelineEntryResponse BuildEntry(
        DonorInteraction interaction, bool canSeeContact, bool canEdit)
    {
        // ENTRIES LOGGED ON THE TIMELINE keep the summary in Description and the team's notes in
        // InternalNotes; the older automatic entries keep a title in Name and their notes in
        // Description. Direction is what tells the two apart - only logged entries store one.
        var logged = interaction.Direction is not null;
        var summary = logged ? interaction.Description ?? interaction.Name : interaction.Name;
        var notes = logged ? interaction.InternalNotes : interaction.Description;

        return new(
            interaction.Id,
            interaction.InteractionType.ToString(),
            interaction.Channel?.ToString(),
            CommunicationCatalogue.DirectionOf(interaction).ToString(),
            interaction.OccurredAtUtc,
            interaction.Outcome.ToString(),
            summary,

            // THE NOTE IS THE SENSITIVE PART. A call note routinely records what a donor said
            // about their circumstances - more revealing than the phone number beside it.
            canSeeContact ? notes : null,

            interaction.PerformedByName,
            !canSeeContact && !string.IsNullOrWhiteSpace(notes),
            interaction.EngagementLevel?.ToString(),
            interaction.Quality?.ToString(),
            interaction.IsImportant,
            interaction.AttachmentName,
            interaction.PerformedByUserId,
            canEdit && logged,
            interaction.Version);
    }

    private static string BuildLeadName(Lead lead) => LeadMappingConfig.BuildDisplayName(lead);

    private static Result<CommunicationTimelineResponse> NotFound() =>
        Result.Failure<CommunicationTimelineResponse>(
            Error.NotFound("That record was not found inside your scope."));

    /// <summary>
    /// What the caller may do on this screen.
    ///
    /// VERB LABELS, NOT PERMISSION CODES, because that is the vocabulary every other screen in
    /// this module already answers in - the lead work queue returns "Contact" and "Assign", the
    /// assignment board "Reassign". Returning raw codes here would have made this the only screen
    /// whose buttons the browser had to match differently.
    /// </summary>
    private IReadOnlyList<string> BuildPermittedActions(bool isLead, Lead? lead, Donor? donor)
    {
        var actions = new List<string>();

        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueView))
        {
            actions.Add("View");
        }

        // Logging a conversation, for a lead or a donor alike. A closed lead or an archived donor
        // has finished its journey and takes no new entries.
        var open = donor is not null
            ? donor.Status is not (DonorStatus.Archived or DonorStatus.Merged)
            : lead!.Status is not (LeadStatus.Closed or LeadStatus.Suppressed);

        if (open && currentUser.HasPermission(PermissionCodes.LeadWorkQueueContact))
        {
            actions.Add("Contact");
        }

        // Temperature and donation potential belong to a lead.
        if (isLead && open && currentUser.HasPermission(PermissionCodes.LeadWorkQueueQualify))
        {
            actions.Add("Score");
        }

        if (currentUser.HasPermission(PermissionCodes.FollowUpPlannerSchedule))
        {
            actions.Add("Schedule follow-up");
        }

        // The lead's own donation link - how a lead becomes a donor in the role flow.
        if (isLead && open)
        {
            actions.Add("Share donation link");
        }

        return actions;
    }

    private string DescribeScope() =>
        currentUser.Scope.IsOwnRecordsOnly ? "Your own records" : "Your organisation";

    private static IReadOnlyList<LookupItem> ToLookup<TEnum>() where TEnum : struct, Enum =>
        [.. Enum.GetValues<TEnum>().Select(value => new LookupItem(value.ToString(), value.ToString()))];
}
