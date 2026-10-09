using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.Features.CommunicationTimeline.DTOs;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.CommunicationTimeline.Commands;

/// <summary>Log a communication against a lead or a donor.</summary>
public sealed record LogCommunicationCommand(LogCommunicationRequest Request);

/// <summary>Correct a logged communication.</summary>
public sealed record UpdateCommunicationCommand(Guid InteractionId, UpdateCommunicationRequest Request);

/// <summary>Flag a communication as important, or clear the flag.</summary>
public sealed record FlagCommunicationCommand(Guid InteractionId, FlagCommunicationRequest Request);

/// <summary>
/// The Communication Timeline's write side.
///
/// WHAT IT REPLACES. The timeline's log form wrote to an array in the browser and then posted a
/// fraction of what was typed to the lead contact endpoint - the channel, a mis-matched outcome and
/// the notes - so a donor's timeline could not be written at all, a meeting or a visit was
/// recorded as an e-mail and checked against e-mail consent, the date and time typed were replaced
/// by "now", and the direction, engagement, quality, attachment and Important flag were lost on the
/// next load. Every one of them is stored now.
///
/// THE CONSENT GATE STILL HOLDS, and only where it means something: an OUTGOING call, e-mail, SMS
/// or WhatsApp on a channel the person withdrew is refused, as is any outgoing contact with a donor
/// marked Do not contact. Recording that they rang in, or a note the team wrote for itself, is not
/// contact the charity made.
/// </summary>
public sealed class CommunicationCommandHandler(
    ILeadRepository leadRepository,
    IDonorRepository donorRepository,
    IConsentRepository consentRepository,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<CommunicationCommandHandler> logger)
{
    /// <summary>A clock a few minutes fast is not a communication from the future.</summary>
    private static readonly TimeSpan FutureTolerance = TimeSpan.FromMinutes(5);

    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<Guid>> HandleAsync(
        LogCommunicationCommand command,
        CancellationToken cancellationToken = default)
    {
        var request = command.Request;

        logger.LogInformation("Communication logging started.");

        if (request.LeadId is null && request.DonorId is null)
        {
            return Result.Failure<Guid>(Error.Validation(
                "Name the lead or the donor this communication was with.",
                [new ValidationError(nameof(request.LeadId), "Give a lead id or a donor id.")]));
        }

        Lead? lead = null;
        Donor? donor = null;

        if (request.DonorId is Guid donorId)
        {
            donor = await donorRepository.GetByIdAsync(donorId, cancellationToken);

            if (donor is null || donor.OrganisationId != currentUser.OrganisationId)
            {
                return Result.Failure<Guid>(Error.DonorNotFound());
            }
        }

        if (request.LeadId is Guid leadId)
        {
            lead = await leadRepository.GetByIdAsync(leadId, cancellationToken);

            if (lead is null || lead.OrganisationId != currentUser.OrganisationId)
            {
                return Result.Failure<Guid>(Error.NotFound("That lead was not found inside your scope."));
            }

            // A CONVERTED LEAD'S CONVERSATIONS NOW BELONG TO ITS DONOR, so they appear on the
            // donor's 360 view as well as on the merged timeline.
            if (donor is null && lead.ConvertedDonorId is Guid convertedId)
            {
                donor = await donorRepository.GetByIdAsync(convertedId, cancellationToken);
            }
        }

        // "FUNDRAISING MANAGER / ASSIGNED OWNER CAN LOG A COMMUNICATION" - the role flow. A caller
        // limited to their own records logs only against the people they own.
        if (currentUser.Scope.IsOwnRecordsOnly
            && !(donor is not null ? donor.RelationshipOwnerUserId == currentUser.UserId : lead!.OwnerUserId == currentUser.UserId))
        {
            return Result.Failure<Guid>(Error.NotFound("That record was not found inside your scope."));
        }

        if (donor is not null && donor.Status is DonorStatus.Archived or DonorStatus.Merged)
        {
            return Result.Failure<Guid>(Error.InvalidTransition($"A donor in state {donor.Status} takes no new communications."));
        }

        if (donor is null && lead!.Status is LeadStatus.Closed or LeadStatus.Suppressed)
        {
            return Result.Failure<Guid>(Error.InvalidTransition($"A lead in state {lead.Status} takes no new communications."));
        }

        var parsed = Parse(
            request.InteractionType, request.Direction, request.Outcome, request.EngagementLevel, request.Quality,
            request.OccurredAtUtc, request.Summary, request.Notes, request.AttachmentName);

        if (parsed.Error is not null)
        {
            return Result.Failure<Guid>(parsed.Error);
        }

        var details = parsed.Value!;

        var consentError = await CheckConsentAsync(details, lead, donor, cancellationToken);
        if (consentError is not null)
        {
            return Result.Failure<Guid>(consentError);
        }

        var interaction = new DonorInteraction
        {
            OrganisationId = currentUser.OrganisationId,
            LeadId = lead?.Id,
            DonorId = donor?.Id,
            Status = DonorInteractionStatus.Completed,
            PerformedByUserId = currentUser.UserId,
            PerformedByName = currentUser.DisplayName
        };

        Apply(interaction, details, request.IsImportant);
        donorRepository.AddInteraction(interaction);

        if (lead is not null && donor is null)
        {
            ApplyToLead(lead, details);
        }

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.CommunicationLogged, donor is not null ? nameof(Donor) : nameof(Lead),
                donor?.Id ?? lead!.Id, AuditResult.Succeeded,
                $"{details.Direction} {CommunicationCatalogue.TypeLabel(details.Type).ToLowerInvariant()} logged: "
                + CommunicationCatalogue.OutcomeLabel(details.Outcome) + "."),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Communication {InteractionId} logged successfully.", interaction.Id);

        return Result.Success(interaction.Id);
    }

    public async Task<Result<Guid>> HandleAsync(
        UpdateCommunicationCommand command,
        CancellationToken cancellationToken = default)
    {
        var request = command.Request;

        var loaded = await LoadEditableAsync(command.InteractionId, cancellationToken);
        if (loaded.Error is not null)
        {
            return Result.Failure<Guid>(loaded.Error);
        }

        var interaction = loaded.Interaction!;

        if (request.ExpectedVersion is > 0 && request.ExpectedVersion != interaction.Version)
        {
            return Result.Failure<Guid>(Error.Concurrency());
        }

        // An automatic entry - a completed follow-up, a qualification - is a record of something
        // the system did, and is not corrected by hand.
        if (interaction.Direction is null)
        {
            return Result.Failure<Guid>(Error.InvalidTransition(
                "This entry was written automatically and cannot be edited. Log a new communication instead."));
        }

        if (interaction.PerformedByUserId != currentUser.UserId && !currentUser.Scope.IsOrganisationWide)
        {
            return Result.Failure<Guid>(Error.Forbidden("Only the person who logged this communication can edit it."));
        }

        var parsed = Parse(
            interaction.InteractionType.ToString(), request.Direction, request.Outcome, request.EngagementLevel,
            request.Quality, request.OccurredAtUtc, request.Summary, request.Notes, request.AttachmentName);

        if (parsed.Error is not null)
        {
            return Result.Failure<Guid>(parsed.Error);
        }

        Apply(interaction, parsed.Value!, request.IsImportant);

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.CommunicationEdited, nameof(DonorInteraction), interaction.Id,
                AuditResult.Succeeded, "Logged communication corrected."),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Success(interaction.Id);
    }

    public async Task<Result<Guid>> HandleAsync(
        FlagCommunicationCommand command,
        CancellationToken cancellationToken = default)
    {
        var loaded = await LoadEditableAsync(command.InteractionId, cancellationToken);
        if (loaded.Error is not null)
        {
            return Result.Failure<Guid>(loaded.Error);
        }

        var interaction = loaded.Interaction!;

        if (interaction.IsImportant != command.Request.IsImportant)
        {
            // SHARED WITH THE TEAM. The flag used to live in one browser, so a colleague opening the
            // same timeline saw nothing marked.
            interaction.IsImportant = command.Request.IsImportant;

            await auditWriter.WriteAsync(
                new AuditEntry(AuditActionCodes.CommunicationFlagged, nameof(DonorInteraction), interaction.Id,
                    AuditResult.Succeeded, command.Request.IsImportant ? "Marked important." : "Important flag cleared."),
                cancellationToken);

            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result.Success(interaction.Id);
    }

    /// <summary>One logged exchange, validated and typed.</summary>
    internal sealed record CommunicationDetails(
        InteractionType Type,
        InteractionDirection Direction,
        ContactOutcome Outcome,
        EngagementLevel? Engagement,
        CommunicationQuality? Quality,
        DateTimeOffset OccurredAtUtc,
        string Summary,
        string? Notes,
        string? AttachmentName);

    private (CommunicationDetails? Value, Error? Error) Parse(
        string type,
        string direction,
        string outcome,
        string? engagement,
        string? quality,
        DateTimeOffset occurredAtUtc,
        string summary,
        string? notes,
        string? attachmentName)
    {
        static Error Invalid(string field, string message) =>
            Error.Validation(message, [new ValidationError(field, message)]);

        if (!Enum.TryParse<InteractionType>(type, ignoreCase: true, out var parsedType))
        {
            return (null, Invalid("interactionType", "Choose a communication type from the list."));
        }

        if (!Enum.TryParse<InteractionDirection>(direction, ignoreCase: true, out var parsedDirection))
        {
            return (null, Invalid("direction", "Choose Outgoing, Incoming or Internal."));
        }

        if (!Enum.TryParse<ContactOutcome>(outcome, ignoreCase: true, out var parsedOutcome)
            || parsedOutcome == ContactOutcome.NotContacted)
        {
            return (null, Invalid("outcome", "Choose an outcome from the list."));
        }

        EngagementLevel? parsedEngagement = null;
        if (!string.IsNullOrWhiteSpace(engagement))
        {
            if (!Enum.TryParse<EngagementLevel>(engagement, ignoreCase: true, out var level))
            {
                return (null, Invalid("engagementLevel", "Choose Low, Medium or High."));
            }

            parsedEngagement = level;
        }

        CommunicationQuality? parsedQuality = null;
        if (!string.IsNullOrWhiteSpace(quality))
        {
            if (!Enum.TryParse<CommunicationQuality>(quality, ignoreCase: true, out var grade))
            {
                return (null, Invalid("quality", "Choose Poor, Average, Good or Excellent."));
            }

            parsedQuality = grade;
        }

        if (occurredAtUtc == default)
        {
            return (null, Invalid("occurredAtUtc", "Enter when the communication happened."));
        }

        if (occurredAtUtc > clock.UtcNow + FutureTolerance)
        {
            return (null, Invalid("occurredAtUtc", "A communication cannot be logged in the future."));
        }

        var trimmedSummary = summary?.Trim() ?? string.Empty;
        if (trimmedSummary.Length is < 10 or > 2000)
        {
            return (null, Invalid("summary", "Enter a summary of 10 to 2,000 characters."));
        }

        var trimmedNotes = string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();
        if (trimmedNotes is { Length: > 3000 })
        {
            return (null, Invalid("notes", "Keep internal notes to 3,000 characters."));
        }

        var trimmedAttachment = string.IsNullOrWhiteSpace(attachmentName) ? null : attachmentName.Trim();
        if (trimmedAttachment is { Length: > 260 })
        {
            trimmedAttachment = trimmedAttachment[..260];
        }

        // A note the team wrote is internal by nature, whatever direction was picked.
        if (parsedType == InteractionType.Note)
        {
            parsedDirection = InteractionDirection.Internal;
        }

        return (new CommunicationDetails(
            parsedType, parsedDirection, parsedOutcome, parsedEngagement, parsedQuality,
            occurredAtUtc, trimmedSummary, trimmedNotes, trimmedAttachment), null);
    }

    private static void Apply(DonorInteraction interaction, CommunicationDetails details, bool isImportant)
    {
        var title = $"{CommunicationCatalogue.TypeLabel(details.Type)} - {CommunicationCatalogue.OutcomeLabel(details.Outcome)}";

        interaction.Name = title.Length > 160 ? title[..160] : title;
        interaction.Description = details.Summary;
        interaction.InternalNotes = details.Notes;
        interaction.InteractionType = details.Type;
        interaction.Channel = CommunicationCatalogue.ChannelFor(details.Type);
        interaction.Direction = details.Direction;
        interaction.Outcome = details.Outcome;
        interaction.EngagementLevel = details.Engagement;
        interaction.Quality = details.Quality;
        interaction.OccurredAtUtc = details.OccurredAtUtc;
        interaction.IsImportant = isImportant;
        interaction.AttachmentName = details.AttachmentName;
    }

    /// <summary>
    /// What a contact does to the lead: its last contact moves on, a new or assigned lead becomes
    /// Contacted, and "do not contact" suppresses it so nobody rings again next week. A note the
    /// team wrote for itself moves nothing - nobody outside was contacted.
    /// </summary>
    private void ApplyToLead(Lead lead, CommunicationDetails details)
    {
        if (details.Direction != InteractionDirection.Internal)
        {
            lead.RecordContact(details.Outcome, details.OccurredAtUtc, clock.UtcNow, _settings);
        }
    }

    /// <summary>
    /// The consent gate for outgoing contact. See the class comment.
    /// </summary>
    private async Task<Error?> CheckConsentAsync(
        CommunicationDetails details,
        Lead? lead,
        Donor? donor,
        CancellationToken cancellationToken)
    {
        var channel = CommunicationCatalogue.ChannelFor(details.Type);

        if (details.Direction != InteractionDirection.Outgoing || channel is null)
        {
            return null;
        }

        if (donor is { DoNotContact: true })
        {
            return Error.InvalidTransition("This donor is marked Do not contact, so outgoing contact cannot be recorded.");
        }

        var consents = donor is not null
            ? await consentRepository.GetCurrentForDonorAsync(donor.Id, cancellationToken)
            : await consentRepository.GetForLeadAsync(lead!.Id, cancellationToken);

        var permission = consents.FirstOrDefault(consent => consent.Channel == channel);

        return permission is { ConsentState: ConsentState.Withdrawn }
            ? Error.InvalidTransition($"This person has not permitted contact by {channel}. Choose a permitted channel.")
            : null;
    }

    private async Task<(DonorInteraction? Interaction, Error? Error)> LoadEditableAsync(
        Guid interactionId,
        CancellationToken cancellationToken)
    {
        var interaction = await donorRepository.GetInteractionAsync(interactionId, cancellationToken);

        if (interaction is null || interaction.OrganisationId != currentUser.OrganisationId)
        {
            return (null, Error.NotFound("That communication was not found inside your scope."));
        }

        if (currentUser.Scope.IsOwnRecordsOnly)
        {
            var owned = interaction.DonorId is Guid donorId
                ? (await donorRepository.GetByIdAsync(donorId, cancellationToken))?.RelationshipOwnerUserId == currentUser.UserId
                : interaction.LeadId is Guid leadId
                  && (await leadRepository.GetByIdAsync(leadId, cancellationToken))?.OwnerUserId == currentUser.UserId;

            if (!owned)
            {
                return (null, Error.NotFound("That communication was not found inside your scope."));
            }
        }

        return (interaction, null);
    }
}
