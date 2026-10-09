using FluentValidation;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.DTOs;
using YDots.DON.Application.Features.FollowUpPlanner.DTOs;
using YDots.DON.Application.Features.FollowUpPlanner.Mappings;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.FollowUpPlanner.Commands.PlanFollowUp;

/// <summary>DON-UI-08 Schedule follow-up. The primary action.</summary>
public sealed record ScheduleFollowUpCommand(ScheduleFollowUpRequest Request);

/// <summary>DON-UI-08 Assign.</summary>
public sealed record AssignFollowUpCommand(Guid FollowUpId, AssignFollowUpRequest Request);

/// <summary>DON-UI-08 Mark complete.</summary>
public sealed record CompleteFollowUpCommand(Guid FollowUpId, CompleteFollowUpRequest Request);

/// <summary>DON-UI-08 Reschedule.</summary>
public sealed record RescheduleFollowUpCommand(Guid FollowUpId, RescheduleFollowUpRequest Request);

/// <summary>DON-UI-08 Cancel task. Danger action: named reason required.</summary>
public sealed record CancelFollowUpCommand(Guid FollowUpId, ReasonRequest Request);

/// <summary>Follow-up Queue Escalate: hand the task to somebody more senior, with a reason.</summary>
public sealed record EscalateFollowUpCommand(Guid FollowUpId, EscalateFollowUpRequest Request);

/// <summary>
/// The follow-up planner write side.
///
/// "Plan a respectful, consent-aware next action" is the purpose of this screen, and the word
/// that matters is consent-aware: scheduling is refused outright when the chosen channel is not
/// permitted, rather than warned about and allowed through.
/// </summary>
public sealed class FollowUpCommandHandler(
    IFollowUpRepository followUpRepository,
    IConsentRepository consentRepository,
    IDonorRepository donorRepository,
    ILeadRepository leadRepository,
    IReferenceNumberGenerator referenceNumbers,
    IPeopleDirectory people,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<FollowUpCommandHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<FollowUpResponse>> HandleAsync(
        ScheduleFollowUpCommand command,
        CancellationToken cancellationToken = default)
    {
        var request = command.Request;

        logger.LogInformation("Follow-up scheduling started for organisation {OrganisationId}.", currentUser.OrganisationId);

        if (request.DonorId is null && request.LeadId is null)
        {
            logger.LogWarning("Follow-up scheduling failed because neither donor nor lead was provided for organisation {OrganisationId}.", currentUser.OrganisationId);

            return Result.Failure<FollowUpResponse>(Error.Validation(
                "Enter Donor or lead reference.",
                [new ValidationError(nameof(request.DonorId), "Choose a donor or a lead.")]));
        }

        if (!Enum.TryParse<ConsentChannel>(request.PermittedChannel, ignoreCase: true, out var channel))
        {
            logger.LogWarning("Follow-up scheduling failed because an invalid permitted channel was supplied for organisation {OrganisationId}.", currentUser.OrganisationId);

            return Result.Failure<FollowUpResponse>(Error.Validation(
                "Review Permitted channel. Choose a value from the approved catalogue.",
                [new ValidationError(nameof(request.PermittedChannel), "Choose a channel from the list.")]));
        }

        Donor? donor = null;
        Lead? lead = null;

        if (request.DonorId is not null)
        {
            donor = await donorRepository.GetByIdAsync(request.DonorId.Value, cancellationToken);

            if (donor is null || donor.OrganisationId != currentUser.OrganisationId)
            {
                logger.LogWarning("Follow-up scheduling failed because donor {DonorId} was not found inside the current organisation scope.", request.DonorId.Value);

                return Result.Failure<FollowUpResponse>(Error.DonorNotFound());
            }
        }

        if (request.LeadId is not null)
        {
            lead = await leadRepository.GetByIdAsync(request.LeadId.Value, cancellationToken);

            if (lead is null || lead.OrganisationId != currentUser.OrganisationId)
            {
                logger.LogWarning("Follow-up scheduling failed because lead {LeadId} was not found inside the current organisation scope.", request.LeadId.Value);

                return Result.Failure<FollowUpResponse>(Error.NotFound("That lead was not found inside your scope."));
            }
        }

        // A CALLER LIMITED TO THEIR OWN RECORDS SCHEDULES ONLY ON THEM. DonorCare schedules
        // follow-ups from My Leads and My Donor List; the same request naming somebody else's lead
        // must not be a way round the scope those lists already apply.
        if (currentUser.Scope.IsOwnRecordsOnly
            && ((donor is not null && donor.RelationshipOwnerUserId != currentUser.UserId)
                || (donor is null && lead is not null && lead.OwnerUserId != currentUser.UserId)))
        {
            logger.LogWarning("Follow-up scheduling refused because the record is outside the current user's own records.");

            return Result.Failure<FollowUpResponse>(Error.NotFound("That record was not found inside your scope."));
        }

        var assigneeError = await CheckAssigneeAsync(request.RelationshipOwnerUserId, cancellationToken);
        if (assigneeError is not null)
        {
            return Result.Failure<FollowUpResponse>(assigneeError);
        }

        var consents = donor is not null
            ? await consentRepository.GetCurrentForDonorAsync(donor.Id, cancellationToken)
            : await consentRepository.GetForLeadAsync(lead!.Id, cancellationToken);

        var warning = FollowUpMappingConfig.BuildConsentWarning(donor, consents);

        if (string.Equals(warning.Level, "Blocking", StringComparison.Ordinal))
        {
            logger.LogWarning("Follow-up scheduling blocked by consent restrictions for organisation {OrganisationId}.", currentUser.OrganisationId);

            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(warning.Message));
        }

        if (warning.ProhibitedChannels.Contains(channel.ToString(), StringComparer.Ordinal))
        {
            logger.LogWarning("Follow-up scheduling blocked because the selected channel is prohibited for the target record.");

            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(
                $"Contact by {channel} has been withdrawn for this record. Choose a permitted channel."));
        }

        if (warning.HasWarning && !request.ConsentWarningAcknowledged)
        {
            logger.LogWarning("Follow-up scheduling failed because the consent warning was not acknowledged.");

            return Result.Failure<FollowUpResponse>(Error.Validation(
                warning.Message + " Acknowledge the consent warning before scheduling.",
                [new ValidationError(nameof(request.ConsentWarningAcknowledged), "Read and accept the consent warning.")]));
        }

        var now = clock.UtcNow;

        if (request.DueAtUtc < now)
        {
            logger.LogWarning("Follow-up scheduling failed because the due date is in the past.");

            return Result.Failure<FollowUpResponse>(Error.Validation(
                "Review Due date and time. It cannot be in the past.",
                [new ValidationError(nameof(request.DueAtUtc), "Choose a future date and time.")]));
        }

        var priority = Enum.TryParse<FollowUpPriority>(request.Priority, ignoreCase: true, out var parsedPriority)
            ? parsedPriority
            : FollowUpPriority.Normal;

        var task = new FollowUpTask
        {
            OrganisationId = currentUser.OrganisationId,
            FollowUpReference = await referenceNumbers.NextFollowUpReferenceAsync(cancellationToken),
            DonorId = donor?.Id,
            LeadId = lead?.Id,
            RelationshipOwnerUserId = request.RelationshipOwnerUserId
                                      ?? donor?.RelationshipOwnerUserId
                                      ?? lead?.OwnerUserId
                                      ?? currentUser.UserId,
            RelationshipOwnerName = request.RelationshipOwnerName?.Trim()
                                    ?? donor?.RelationshipOwnerName
                                    ?? lead?.OwnerName
                                    ?? currentUser.DisplayName,
            Purpose = request.Purpose.Trim(),
            PermittedChannel = channel,
            PreferredLanguage = string.IsNullOrWhiteSpace(request.PreferredLanguage)
                ? donor?.PreferredLanguage ?? lead?.PreferredLanguage ?? SupportedLanguages.Default
                : request.PreferredLanguage.Trim(),
            PreferredContactTimeUtc = request.PreferredContactTimeUtc ?? lead?.PreferredContactTimeUtc,
            NextAction = request.NextAction.Trim(),
            DueAtUtc = request.DueAtUtc,
            Priority = priority,
            Notes = request.Notes?.Trim(),
            ConsentWarningAcknowledged = request.ConsentWarningAcknowledged,
            ConsentNoticeVersion = request.ConsentWarningAcknowledged ? _settings.CurrentNoticeVersion : null,
            ConsentAcknowledgedAtUtc = request.ConsentWarningAcknowledged ? now : null,
            Status = FollowUpStatus.Planned
        };

        followUpRepository.Add(task);

        task.Donor = donor;
        task.Lead = lead;

        // The lead's "next contact" is the follow-up that is next due. Selecting an assignee here
        // does NOT change who owns the lead - the role flow keeps the two apart - so only the next
        // action moves, never the owner.
        await SyncLeadNextActionAsync(task, cancellationToken);

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.FollowUpScheduled, nameof(FollowUpTask), task.Id, AuditResult.Succeeded,
                $"{task.FollowUpReference} scheduled by {channel} for {task.DueAtUtc:u}, assigned to {task.RelationshipOwnerName}."),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Follow-up {FollowUpId} scheduled successfully for organisation {OrganisationId}.", task.Id, currentUser.OrganisationId);

        return Result.Success(task.ToResponse(FollowUpViewer.For(currentUser, now, _settings), warning));
    }

    public async Task<Result<FollowUpResponse>> HandleAsync(
        AssignFollowUpCommand command,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Follow-up assignment started for follow-up {FollowUpId}.", command.FollowUpId);

        var loaded = await LoadAsync(command.FollowUpId, command.Request.ExpectedVersion, cancellationToken);
        if (loaded.Error is not null)
        {
            logger.LogWarning("Follow-up assignment failed for follow-up {FollowUpId}.", command.FollowUpId);
            return Result.Failure<FollowUpResponse>(loaded.Error);
        }

        var task = loaded.Task!;

        if (task.Status is FollowUpStatus.Completed or FollowUpStatus.Cancelled)
        {
            logger.LogWarning("Follow-up assignment rejected for follow-up {FollowUpId} because it is already in terminal state {Status}.", command.FollowUpId, task.Status);

            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(
                $"A follow-up in state {task.Status} can no longer be assigned."));
        }

        var assigneeError = await CheckAssigneeAsync(command.Request.RelationshipOwnerUserId, cancellationToken);
        if (assigneeError is not null)
        {
            return Result.Failure<FollowUpResponse>(assigneeError);
        }

        task.RelationshipOwnerUserId = command.Request.RelationshipOwnerUserId;
        task.RelationshipOwnerName = command.Request.RelationshipOwnerName.Trim();
        task.Status = FollowUpStatus.Assigned;

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.FollowUpAssigned, nameof(FollowUpTask), task.Id, AuditResult.Succeeded,
                command.Request.Reason.Trim()),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Follow-up {FollowUpId} assigned successfully.", command.FollowUpId);

        return await BuildResponseAsync(task, cancellationToken);
    }

    public async Task<Result<FollowUpResponse>> HandleAsync(
        CompleteFollowUpCommand command,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Follow-up completion started for follow-up {FollowUpId}.", command.FollowUpId);

        var loaded = await LoadAsync(command.FollowUpId, command.Request.ExpectedVersion, cancellationToken);
        if (loaded.Error is not null)
        {
            logger.LogWarning("Follow-up completion failed for follow-up {FollowUpId}.", command.FollowUpId);
            return Result.Failure<FollowUpResponse>(loaded.Error);
        }

        var task = loaded.Task!;

        if (task.Status is FollowUpStatus.Completed or FollowUpStatus.Cancelled)
        {
            logger.LogWarning("Follow-up completion rejected for follow-up {FollowUpId} because it is already in terminal state {Status}.", command.FollowUpId, task.Status);

            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(
                $"A follow-up in state {task.Status} cannot be completed again."));
        }

        var notAssignee = RefuseUnlessAssignee(task, "execute");
        if (notAssignee is not null)
        {
            return Result.Failure<FollowUpResponse>(notAssignee);
        }

        var request = command.Request;
        var completedAt = request.CompletedAtUtc ?? clock.UtcNow;

        if (completedAt > clock.UtcNow.AddMinutes(5))
        {
            return Result.Failure<FollowUpResponse>(Error.Validation(
                "A follow-up cannot be completed in the future.",
                [new ValidationError(nameof(request.CompletedAtUtc), "Choose when the contact actually happened.")]));
        }

        // WHAT HAPPENED, typed. Each part defaults to what the follow-up planned, so an older
        // caller that sends only the completion text still records a sensible entry.
        var type = Enum.TryParse<InteractionType>(request.InteractionType, ignoreCase: true, out var parsedType)
            ? parsedType
            : MapChannelToInteraction(task.PermittedChannel);
        var direction = Enum.TryParse<InteractionDirection>(request.Direction, ignoreCase: true, out var parsedDirection)
            ? parsedDirection
            : type == InteractionType.Note ? InteractionDirection.Internal : InteractionDirection.Outgoing;
        var outcome = Enum.TryParse<ContactOutcome>(request.Outcome, ignoreCase: true, out var parsedOutcome)
                      && parsedOutcome != ContactOutcome.NotContacted
            ? parsedOutcome
            : ContactOutcome.Reached;
        EngagementLevel? engagement = Enum.TryParse<EngagementLevel>(request.EngagementLevel, ignoreCase: true, out var parsedEngagement)
            ? parsedEngagement
            : null;
        CommunicationQuality? quality = Enum.TryParse<CommunicationQuality>(request.Quality, ignoreCase: true, out var parsedQuality)
            ? parsedQuality
            : null;

        // HOW IT WENT, when the execution form says. A value that is not on the list is refused:
        // dropping it silently is exactly how these three came to be collected and never stored.
        FollowUpExecutionStatus? executionStatus = null;
        FollowUpCompletionReason? completionReason = null;
        FollowUpDisposition? disposition = null;

        if (!string.IsNullOrWhiteSpace(request.ExecutionStatus))
        {
            if (!Enum.TryParse<FollowUpExecutionStatus>(request.ExecutionStatus, ignoreCase: true, out var parsedStatus))
            {
                return Result.Failure<FollowUpResponse>(Error.Validation(
                    "Review Execution status. Choose a value from the list.",
                    [new ValidationError(nameof(request.ExecutionStatus), "Choose a value from the list.")]));
            }

            executionStatus = parsedStatus;
        }

        if (!string.IsNullOrWhiteSpace(request.CompletionReason))
        {
            if (!Enum.TryParse<FollowUpCompletionReason>(request.CompletionReason, ignoreCase: true, out var parsedReason))
            {
                return Result.Failure<FollowUpResponse>(Error.Validation(
                    "Review Completion reason. Choose a value from the list.",
                    [new ValidationError(nameof(request.CompletionReason), "Choose a value from the list.")]));
            }

            completionReason = parsedReason;
        }

        if (!string.IsNullOrWhiteSpace(request.Disposition))
        {
            if (!Enum.TryParse<FollowUpDisposition>(request.Disposition, ignoreCase: true, out var parsedDisposition))
            {
                return Result.Failure<FollowUpResponse>(Error.Validation(
                    "Review Disposition. Choose a value from the list.",
                    [new ValidationError(nameof(request.Disposition), "Choose a value from the list.")]));
            }

            disposition = parsedDisposition;
        }

        var lead = task.Lead ?? (task.LeadId is Guid taskLeadId ? await leadRepository.GetByIdAsync(taskLeadId, cancellationToken) : null);

        // A NEW READING OF THE LEAD, for somebody who may score leads. Refused rather than ignored
        // for anybody else, so a screen that offered it by mistake hears about it.
        var rescoring = !string.IsNullOrWhiteSpace(request.Temperature) || !string.IsNullOrWhiteSpace(request.DonationPotential);

        if (rescoring && task.DonorId is null && lead is not null)
        {
            if (!currentUser.HasPermission(PermissionCodes.LeadWorkQueueQualify))
            {
                return Result.Failure<FollowUpResponse>(Error.Forbidden(
                    "You may complete this follow-up, but not change the lead's temperature or donation potential."));
            }

            if (Enum.TryParse<LeadTemperature>(request.Temperature, ignoreCase: true, out var temperature))
            {
                lead.Temperature = temperature;
            }

            if (Enum.TryParse<DonationPotential>(request.DonationPotential, ignoreCase: true, out var potential))
            {
                lead.DonationPotential = potential;
            }
        }

        task.Status = FollowUpStatus.Completed;
        task.CompletedAtUtc = completedAt;
        task.CompletionOutcome = request.CompletionOutcome.Trim();
        task.ExecutionStatus = executionStatus;
        task.CompletionReason = completionReason;
        task.Disposition = disposition;

        await SyncLeadNextActionAsync(task, cancellationToken);

        // EXECUTING A FOLLOW-UP IS A CONVERSATION, so it joins the Communication Timeline - for a
        // lead's follow-up as well as a donor's. It used to be recorded for donors only.
        var title = $"Follow-up {task.FollowUpReference} - {type}";

        donorRepository.AddInteraction(new DonorInteraction
        {
            DonorId = task.DonorId,
            LeadId = task.LeadId,
            OrganisationId = task.OrganisationId,
            Name = title.Length > 160 ? title[..160] : title,
            Description = request.CompletionOutcome.Trim(),
            InternalNotes = string.IsNullOrWhiteSpace(request.Notes) ? null : request.Notes.Trim(),
            Status = DonorInteractionStatus.Completed,
            InteractionType = type,
            Channel = type switch
            {
                InteractionType.Call => ConsentChannel.PhoneCall,
                InteractionType.Email => ConsentChannel.Email,
                InteractionType.Sms => ConsentChannel.Sms,
                InteractionType.WhatsApp => ConsentChannel.WhatsApp,
                _ => null
            },
            Direction = direction,
            OccurredAtUtc = completedAt,
            Outcome = outcome,
            EngagementLevel = engagement,
            Quality = quality,
            IsImportant = request.IsImportant,
            AttachmentName = string.IsNullOrWhiteSpace(request.AttachmentName) ? null : request.AttachmentName.Trim(),
            PerformedByUserId = currentUser.UserId,
            PerformedByName = currentUser.DisplayName
        });

        // The lead moves on the same way a contact logged anywhere else moves it.
        if (task.DonorId is null && lead is not null && direction != InteractionDirection.Internal)
        {
            lead.RecordContact(outcome, completedAt, clock.UtcNow, _settings);
        }

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.FollowUpCompleted, nameof(FollowUpTask), task.Id, AuditResult.Succeeded,
                command.Request.CompletionOutcome.Trim()),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Follow-up {FollowUpId} completed successfully.", command.FollowUpId);

        return await BuildResponseAsync(task, cancellationToken);
    }

    public async Task<Result<FollowUpResponse>> HandleAsync(
        RescheduleFollowUpCommand command,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Follow-up rescheduling started for follow-up {FollowUpId}.", command.FollowUpId);

        var loaded = await LoadAsync(command.FollowUpId, command.Request.ExpectedVersion, cancellationToken);
        if (loaded.Error is not null)
        {
            logger.LogWarning("Follow-up rescheduling failed for follow-up {FollowUpId}.", command.FollowUpId);
            return Result.Failure<FollowUpResponse>(loaded.Error);
        }

        var task = loaded.Task!;

        if (task.Status is FollowUpStatus.Completed or FollowUpStatus.Cancelled)
        {
            logger.LogWarning("Follow-up rescheduling rejected for follow-up {FollowUpId} because it is already in terminal state {Status}.", command.FollowUpId, task.Status);

            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(
                $"A follow-up in state {task.Status} can no longer be rescheduled."));
        }

        var notAssignee = RefuseUnlessAssignee(task, "reschedule");
        if (notAssignee is not null)
        {
            return Result.Failure<FollowUpResponse>(notAssignee);
        }

        if (command.Request.DueAtUtc < clock.UtcNow)
        {
            logger.LogWarning("Follow-up rescheduling failed for follow-up {FollowUpId} because the new due date is in the past.", command.FollowUpId);

            return Result.Failure<FollowUpResponse>(Error.Validation(
                "Review Due date and time. It cannot be in the past.",
                [new ValidationError(nameof(command.Request.DueAtUtc), "Choose a future date and time.")]));
        }

        task.DueAtUtc = command.Request.DueAtUtc;
        task.RescheduleReason = command.Request.RescheduleReason.Trim();
        task.Status = FollowUpStatus.Rescheduled;

        if (Enum.TryParse<FollowUpPriority>(command.Request.Priority, ignoreCase: true, out var priority))
        {
            task.Priority = priority;
        }

        await SyncLeadNextActionAsync(task, cancellationToken);

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.FollowUpRescheduled, nameof(FollowUpTask), task.Id, AuditResult.Succeeded,
                command.Request.RescheduleReason.Trim()),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Follow-up {FollowUpId} rescheduled successfully.", command.FollowUpId);

        return await BuildResponseAsync(task, cancellationToken);
    }

    public async Task<Result<FollowUpResponse>> HandleAsync(
        CancelFollowUpCommand command,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Follow-up cancellation started for follow-up {FollowUpId}.", command.FollowUpId);

        var loaded = await LoadAsync(command.FollowUpId, command.Request.ExpectedVersion, cancellationToken);
        if (loaded.Error is not null)
        {
            logger.LogWarning("Follow-up cancellation failed for follow-up {FollowUpId}.", command.FollowUpId);
            return Result.Failure<FollowUpResponse>(loaded.Error);
        }

        var task = loaded.Task!;

        if (task.Status is FollowUpStatus.Completed or FollowUpStatus.Cancelled)
        {
            logger.LogWarning("Follow-up cancellation rejected for follow-up {FollowUpId} because it is already in terminal state {Status}.", command.FollowUpId, task.Status);

            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(
                $"A follow-up in state {task.Status} cannot be cancelled."));
        }

        var notAssignee = RefuseUnlessAssignee(task, "cancel");
        if (notAssignee is not null)
        {
            return Result.Failure<FollowUpResponse>(notAssignee);
        }

        task.Status = FollowUpStatus.Cancelled;
        task.CancellationReason = command.Request.Reason.Trim();

        await SyncLeadNextActionAsync(task, cancellationToken);

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.FollowUpCancelled, nameof(FollowUpTask), task.Id, AuditResult.Succeeded,
                command.Request.Reason.Trim()),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Follow-up {FollowUpId} cancelled successfully.", command.FollowUpId);

        return await BuildResponseAsync(task, cancellationToken);
    }

    public async Task<Result<FollowUpResponse>> HandleAsync(
        EscalateFollowUpCommand command,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Follow-up escalation started for follow-up {FollowUpId}.", command.FollowUpId);

        var loaded = await LoadAsync(command.FollowUpId, command.Request.ExpectedVersion, cancellationToken);
        if (loaded.Error is not null)
        {
            logger.LogWarning("Follow-up escalation failed for follow-up {FollowUpId}.", command.FollowUpId);
            return Result.Failure<FollowUpResponse>(loaded.Error);
        }

        var task = loaded.Task!;

        if (task.Status is FollowUpStatus.Completed or FollowUpStatus.Cancelled)
        {
            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(
                $"A follow-up in state {task.Status} can no longer be escalated."));
        }

        if (task.RelationshipOwnerUserId == command.Request.EscalateToUserId)
        {
            return Result.Failure<FollowUpResponse>(Error.InvalidTransition(
                "This follow-up is already with that person. Choose somebody else to escalate to."));
        }

        var assigneeError = await CheckAssigneeAsync(command.Request.EscalateToUserId, cancellationToken);
        if (assigneeError is not null)
        {
            return Result.Failure<FollowUpResponse>(assigneeError);
        }

        var previous = task.RelationshipOwnerName;

        task.RelationshipOwnerUserId = command.Request.EscalateToUserId;
        task.RelationshipOwnerName = command.Request.EscalateToName.Trim();
        task.Status = FollowUpStatus.Assigned;
        task.EscalatedAtUtc = clock.UtcNow;
        task.EscalationReason = command.Request.Reason.Trim();
        task.EscalatedByUserId = currentUser.UserId;

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.FollowUpEscalated, nameof(FollowUpTask), task.Id, AuditResult.Succeeded,
                $"Escalated from {previous} to {task.RelationshipOwnerName}: {task.EscalationReason}"),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Follow-up {FollowUpId} escalated successfully.", command.FollowUpId);

        return await BuildResponseAsync(task, cancellationToken);
    }

    /// <summary>
    /// Refuses an act on a follow-up somebody else was given.
    ///
    /// THE ROLE FLOW IS EXPLICIT: Execute is "available only to the user this follow-up is assigned
    /// to". The owner of the lead may see a colleague's follow-up on it; only the assignee may
    /// complete, move or cancel it. A manager who wants it done differently reassigns it first.
    /// </summary>
    private Error? RefuseUnlessAssignee(FollowUpTask task, string verb)
    {
        // The Organisation Admin may act on any follow-up in its Organisation.
        if (task.RelationshipOwnerUserId == currentUser.UserId || currentUser.IsTenantAdmin)
        {
            return null;
        }

        logger.LogWarning("Follow-up {FollowUpId} {Verb} refused because it is assigned to somebody else.", task.Id, verb);

        return Error.Forbidden(
            $"Only {task.RelationshipOwnerName ?? "the person it is assigned to"} can {verb} this follow-up. "
            + "Reassign it first if it should be somebody else's.");
    }

    /// <summary>
    /// The person a follow-up is being given to must be somebody who works follow-ups.
    ///
    /// WITHOUT THIS a follow-up could be assigned to a donor-portal account or to a Campaign
    /// Executive - it would sit in a queue nobody able to act on it ever opens. If the directory
    /// cannot be read the check stands aside rather than blocking every schedule.
    /// </summary>
    private async Task<Error?> CheckAssigneeAsync(Guid? userId, CancellationToken cancellationToken)
    {
        if (userId is null)
        {
            return null;
        }

        var assignable = await people.GetAssignableAsync(currentUser.OrganisationId, cancellationToken);

        if (assignable.Count == 0 || assignable.Any(person => person.UserId == userId))
        {
            return null;
        }

        return Error.Validation(
            "Choose somebody who works donors and leads. That person cannot be given follow-ups.",
            [new ValidationError("relationshipOwnerUserId", "Choose an owner from the list.")]);
    }

    /// <summary>
    /// Points the lead's next action at the follow-up that is next due.
    ///
    /// THE LEAD WORK QUEUE ORDERS AND COLOURS BY IT. Its "Next contact" column, its SLA badge and
    /// its overdue-first ordering all read the lead's NextActionDueUtc, and nothing moved it when a
    /// follow-up was planned - so a lead with a call booked for tomorrow still read "Not planned",
    /// and one whose call was cancelled still read as due. A closed, converted or suppressed lead
    /// has finished its journey and is left alone.
    ///
    /// THE CHANGED TASK IS TAKEN FROM MEMORY. It is not saved yet, so the query below sees its old
    /// state - or, for a new one, does not see it at all.
    /// </summary>
    private async Task SyncLeadNextActionAsync(FollowUpTask changed, CancellationToken cancellationToken)
    {
        if (changed.LeadId is null)
        {
            return;
        }

        var lead = changed.Lead ?? await leadRepository.GetByIdAsync(changed.LeadId.Value, cancellationToken);

        if (lead is null || lead.Status is LeadStatus.Closed or LeadStatus.Converted or LeadStatus.Suppressed)
        {
            return;
        }

        var next = (await followUpRepository.GetOpenForLeadAsync(lead.Id, cancellationToken))
            .Where(task => task.Id != changed.Id)
            .Append(changed)
            .Where(task => FollowUpMappingConfig.IsOpen(task.Status) && task.DueAtUtc is not null)
            .OrderBy(task => task.DueAtUtc)
            .FirstOrDefault();

        var action = next?.NextAction ?? next?.Purpose;

        lead.NextAction = action is { Length: > 300 } ? action[..300] : action;
        lead.NextActionDueUtc = next?.DueAtUtc;
        lead.SlaState = LeadMappingConfig.CalculateSlaState(lead.NextActionDueUtc, clock.UtcNow, _settings);
    }

    private static InteractionType MapChannelToInteraction(ConsentChannel channel) =>
        channel switch
        {
            ConsentChannel.Email => InteractionType.Email,
            ConsentChannel.Sms => InteractionType.Sms,
            ConsentChannel.WhatsApp => InteractionType.WhatsApp,
            ConsentChannel.PhoneCall => InteractionType.Call,
            _ => InteractionType.Note
        };

    private async Task<Result<FollowUpResponse>> BuildResponseAsync(FollowUpTask task, CancellationToken cancellationToken)
    {
        Donor? donor = null;
        IReadOnlyList<Consent> consents = [];

        if (task.DonorId is not null)
        {
            donor = await donorRepository.GetByIdAsync(task.DonorId.Value, cancellationToken);
            consents = await consentRepository.GetCurrentForDonorAsync(task.DonorId.Value, cancellationToken);
        }
        else if (task.LeadId is not null)
        {
            consents = await consentRepository.GetForLeadAsync(task.LeadId.Value, cancellationToken);
        }

        var warning = FollowUpMappingConfig.BuildConsentWarning(donor, consents);

        return Result.Success(task.ToResponse(FollowUpViewer.For(currentUser, clock.UtcNow, _settings), warning));
    }

    private async Task<(FollowUpTask? Task, Error? Error)> LoadAsync(
        Guid followUpId,
        long? expectedVersion,
        CancellationToken cancellationToken)
    {
        var task = await followUpRepository.GetByIdAsync(followUpId, cancellationToken);

        if (task is null || task.OrganisationId != currentUser.OrganisationId)
        {
            logger.LogWarning("Follow-up {FollowUpId} was not found inside the current organisation scope.", followUpId);
            return (null, Error.NotFound("That follow-up was not found inside your scope."));
        }

        if (currentUser.Scope.IsOwnRecordsOnly
            && task.RelationshipOwnerUserId != currentUser.UserId
            && task.Lead?.OwnerUserId != currentUser.UserId
            && task.Donor?.RelationshipOwnerUserId != currentUser.UserId)
        {
            logger.LogWarning("Follow-up {FollowUpId} was rejected because it is outside the current user's record scope.", followUpId);
            return (null, Error.NotFound("That follow-up was not found inside your scope."));
        }

        if (expectedVersion is > 0 && expectedVersion != task.Version)
        {
            logger.LogWarning("Follow-up {FollowUpId} concurrency check failed. Expected version {ExpectedVersion}, actual version {ActualVersion}.", followUpId, expectedVersion, task.Version);
            return (null, Error.Concurrency());
        }

        return (task, null);
    }
}

public sealed class ScheduleFollowUpRequestValidator : AbstractValidator<ScheduleFollowUpRequest>
{
    public ScheduleFollowUpRequestValidator()
    {
        RuleFor(request => request.Purpose)
            .NotEmpty().WithMessage("Enter Purpose.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.");

        RuleFor(request => request.PermittedChannel)
            .NotEmpty().WithMessage("Enter Permitted channel.");

        RuleFor(request => request.NextAction)
            .NotEmpty().WithMessage("Enter Next action.")
            .MaximumLength(300).WithMessage("Use no more than 300 characters.");

        RuleFor(request => request.DueAtUtc)
            .NotEmpty().WithMessage("Enter Due date and time.");

        RuleFor(request => request.PreferredLanguage)
            .Must(SupportedLanguages.IsSupported)
            .WithMessage("Review Preferred language. Choose a value from the approved catalogue.")
            .When(request => !string.IsNullOrWhiteSpace(request.PreferredLanguage));

        RuleFor(request => request.Notes)
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.Notes));
    }
}

public sealed class AssignFollowUpRequestValidator : AbstractValidator<AssignFollowUpRequest>
{
    public AssignFollowUpRequestValidator()
    {
        RuleFor(request => request.RelationshipOwnerUserId).NotEmpty().WithMessage("Enter Relationship owner.");

        RuleFor(request => request.RelationshipOwnerName)
            .NotEmpty().WithMessage("Enter Relationship owner.")
            .MaximumLength(200).WithMessage("Use no more than 200 characters.");

        RuleFor(request => request.Reason)
            .NotEmpty().WithMessage("Enter Reason.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.");
    }
}

public sealed class CompleteFollowUpRequestValidator : AbstractValidator<CompleteFollowUpRequest>
{
    public CompleteFollowUpRequestValidator()
    {
        RuleFor(request => request.CompletionOutcome)
            .NotEmpty().WithMessage("Enter Outcome.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.");
    }
}

public sealed class RescheduleFollowUpRequestValidator : AbstractValidator<RescheduleFollowUpRequest>
{
    public RescheduleFollowUpRequestValidator()
    {
        RuleFor(request => request.DueAtUtc).NotEmpty().WithMessage("Enter Due date and time.");

        RuleFor(request => request.RescheduleReason)
            .NotEmpty().WithMessage("Enter Reschedule reason.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.");
    }
}

public sealed class EscalateFollowUpRequestValidator : AbstractValidator<EscalateFollowUpRequest>
{
    public EscalateFollowUpRequestValidator()
    {
        RuleFor(request => request.EscalateToUserId).NotEmpty().WithMessage("Choose who to escalate to.");

        RuleFor(request => request.EscalateToName)
            .NotEmpty().WithMessage("Choose who to escalate to.")
            .MaximumLength(200).WithMessage("Use no more than 200 characters.");

        RuleFor(request => request.Reason)
            .NotEmpty().WithMessage("Enter Reason.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.");
    }
}
