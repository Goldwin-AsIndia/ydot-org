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
using YDots.DON.Application.Features.AssignmentBoard.DTOs;
using YDots.DON.Application.Features.Leads.DTOs;
using YDots.DON.Application.Features.Leads.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.AssignmentBoard.Commands.RouteLeads;

/// <summary>SCR-DON-006 Assign. Gives an unowned lead an owner.</summary>
public sealed record AssignFromBoardCommand(AssignmentRequest Request);

/// <summary>SCR-DON-006 Reassign. Moves an owned lead to somebody else.</summary>
public sealed record ReassignFromBoardCommand(AssignmentRequest Request);

/// <summary>SCR-DON-006 Bulk route. Moves many leads at once, reporting each one separately.</summary>
public sealed record BulkRouteCommand(BulkRouteRequest Request);

/// <summary>
/// The assignment board write side.
///
/// Assign and Reassign look almost identical, and that is on purpose: they differ only in
/// whether the lead already had an owner. Keeping them apart lets the permission model treat
/// "give somebody work" and "take work away from somebody" as two separate rights.
/// </summary>
public sealed class AssignmentBoardCommandHandler(
    ILeadRepository leadRepository,
    IDonorRepository donorRepository,
    IPeopleDirectory people,
    IConsentRepository consentRepository,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<AssignmentBoardCommandHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<Result<LeadDetailResponse>> HandleAsync(
        AssignFromBoardCommand command,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Lead assignment from board started for LeadId {LeadId}.", command.Request.LeadId);

        if (IsDonor(command.Request.RecordType))
        {
            return await ApplyDonorAssignmentAsync(command.Request, expectOwned: false, cancellationToken);
        }

        var result = await ApplyAssignmentAsync(command.Request, expectOwned: false, AuditActionCodes.AssignmentAssigned, cancellationToken);

        if (result.IsSuccess)
        {
            logger.LogInformation("Lead assignment from board completed successfully for LeadId {LeadId}.", command.Request.LeadId);
        }
        else
        {
            logger.LogWarning("Lead assignment from board failed for LeadId {LeadId}.", command.Request.LeadId);
        }

        return result;
    }

    public async Task<Result<LeadDetailResponse>> HandleAsync(
        ReassignFromBoardCommand command,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Lead reassignment from board started for LeadId {LeadId}.", command.Request.LeadId);

        if (IsDonor(command.Request.RecordType))
        {
            return await ApplyDonorAssignmentAsync(command.Request, expectOwned: true, cancellationToken);
        }

        var result = await ApplyAssignmentAsync(command.Request, expectOwned: true, AuditActionCodes.AssignmentReassigned, cancellationToken);

        if (result.IsSuccess)
        {
            logger.LogInformation("Lead reassignment from board completed successfully for LeadId {LeadId}.", command.Request.LeadId);
        }
        else
        {
            logger.LogWarning("Lead reassignment from board failed for LeadId {LeadId}.", command.Request.LeadId);
        }

        return result;
    }

    public async Task<Result<BulkRouteResultResponse>> HandleAsync(
        BulkRouteCommand command,
        CancellationToken cancellationToken = default)
    {
        var request = command.Request;
        var requestedIds = request.LeadIds.Distinct().ToList();

        logger.LogInformation("Bulk lead routing started for {RequestedLeadCount} lead(s).", requestedIds.Count);

        if (requestedIds.Count == 0)
        {
            logger.LogWarning("Bulk lead routing failed because no leads were selected.");

            return Result.Failure<BulkRouteResultResponse>(Error.Validation(
                "Select at least one lead before routing.",
                [new ValidationError(nameof(request.LeadIds), "Select at least one row.")]));
        }

        if (requestedIds.Count > _settings.BulkRouteMaximumItems)
        {
            logger.LogWarning("Bulk lead routing failed because the requested lead count {RequestedLeadCount} exceeds the maximum allowed count {MaximumLeadCount}.", requestedIds.Count, _settings.BulkRouteMaximumItems);

            return Result.Failure<BulkRouteResultResponse>(Error.Validation(
                $"A bulk route may cover at most {_settings.BulkRouteMaximumItems} leads. Narrow the selection and try again.",
                [new ValidationError(nameof(request.LeadIds), $"Select no more than {_settings.BulkRouteMaximumItems} rows.")]));
        }

        var ownerError = await CheckOwnerAsync(request.NewOwnerUserId, cancellationToken);
        if (ownerError is not null)
        {
            return Result.Failure<BulkRouteResultResponse>(ownerError);
        }

        if (IsDonor(request.RecordType))
        {
            return await BulkRouteDonorsAsync(request, requestedIds, cancellationToken);
        }

        var leads = await leadRepository.GetByIdsAsync(requestedIds, cancellationToken);
        var effective = request.EffectiveAtUtc ?? clock.UtcNow;
        var items = new List<BulkRouteItemResponse>(requestedIds.Count);
        var routed = 0;

        foreach (var leadId in requestedIds)
        {
            var lead = leads.FirstOrDefault(candidate => candidate.Id == leadId);

            // Every skip is reported with its own reason. Silent skipping is exactly what
            // UI section 6.2 forbids for a bulk action.
            if (lead is null || lead.OrganisationId != currentUser.OrganisationId)
            {
                logger.LogWarning("Lead {LeadId} was skipped during bulk routing because it was not found inside the current scope.");

                items.Add(new BulkRouteItemResponse(leadId, null, false, "Not found inside your scope."));
                continue;
            }

            if (lead.Status is LeadStatus.Converted or LeadStatus.Closed or LeadStatus.Suppressed)
            {
                logger.LogWarning("Lead {LeadId} was skipped during bulk routing because its current state {LeadStatus} cannot be routed.", leadId, lead.Status);

                items.Add(new BulkRouteItemResponse(leadId, lead.LeadReference, false,
                    $"State {lead.Status} cannot be routed."));
                continue;
            }

            if (lead.OwnerUserId == request.NewOwnerUserId)
            {
                logger.LogWarning("Lead {LeadId} was skipped during bulk routing because it is already owned by the selected user.", leadId);

                items.Add(new BulkRouteItemResponse(leadId, lead.LeadReference, false,
                    "Already owned by the selected person."));
                continue;
            }

            ApplyOwnerChange(lead, request.NewOwnerUserId, request.NewOwnerName, request.TeamCode,
                request.AssignmentReason, effective, isBulkRoute: true);

            routed++;
            items.Add(new BulkRouteItemResponse(leadId, lead.LeadReference, true, "Routed."));
        }

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.AssignmentBulkRouted, nameof(Lead), null, AuditResult.Succeeded,
                $"{routed} of {requestedIds.Count} lead(s) routed to {request.NewOwnerName}. {request.AssignmentReason.Trim()}"),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        var skipped = requestedIds.Count - routed;

        logger.LogInformation("Bulk lead routing completed. Requested: {RequestedLeadCount}, routed: {RoutedLeadCount}, skipped: {SkippedLeadCount}.", requestedIds.Count, routed, skipped);

        return Result.Success(new BulkRouteResultResponse(
            requestedIds.Count,
            routed,
            skipped,
            items,
            skipped == 0
                ? $"All {routed} lead(s) were routed to {request.NewOwnerName}."
                : $"{routed} lead(s) routed, {skipped} skipped. Review the per-record outcome below.",
            skipped == 0 ? ScreenState.Success : ScreenState.Validation));
    }

    private async Task<Result<LeadDetailResponse>> ApplyAssignmentAsync(
        AssignmentRequest request,
        bool expectOwned,
        string auditActionCode,
        CancellationToken cancellationToken)
    {
        var lead = await leadRepository.GetByIdAsync(request.LeadId, cancellationToken);

        if (lead is null || lead.OrganisationId != currentUser.OrganisationId)
        {
            logger.LogWarning("Lead assignment failed for LeadId {LeadId} because the lead was not found inside the current scope.", request.LeadId);

            return Result.Failure<LeadDetailResponse>(Error.NotFound("That lead was not found inside your scope."));
        }

        if (request.ExpectedVersion is > 0 && request.ExpectedVersion != lead.Version)
        {
            logger.LogWarning("Lead assignment failed for LeadId {LeadId} because of a concurrency conflict.", request.LeadId);

            return Result.Failure<LeadDetailResponse>(Error.Concurrency());
        }

        if (lead.Status is LeadStatus.Converted or LeadStatus.Closed or LeadStatus.Suppressed)
        {
            logger.LogWarning("Lead assignment failed for LeadId {LeadId} because its current state {LeadStatus} cannot be routed.", request.LeadId, lead.Status);

            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition(
                $"A lead in state {lead.Status} can no longer be routed."));
        }

        if (expectOwned && lead.OwnerUserId is null)
        {
            logger.LogWarning("Lead reassignment failed for LeadId {LeadId} because the lead has no existing owner.", request.LeadId);

            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition(
                "This lead has no owner yet. Use Assign rather than Reassign."));
        }

        if (!expectOwned && lead.OwnerUserId is not null)
        {
            logger.LogWarning("Lead assignment failed for LeadId {LeadId} because the lead already has an owner.", request.LeadId);

            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition(
                "This lead already has an owner. Use Reassign rather than Assign."));
        }

        if (lead.OwnerUserId == request.NewOwnerUserId)
        {
            logger.LogWarning("Lead assignment failed for LeadId {LeadId} because the selected user already owns the lead.", request.LeadId);

            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition(
                "That person already owns this lead."));
        }

        var ownerError = await CheckOwnerAsync(request.NewOwnerUserId, cancellationToken);
        if (ownerError is not null)
        {
            return Result.Failure<LeadDetailResponse>(ownerError);
        }

        var effective = request.EffectiveAtUtc ?? clock.UtcNow;

        ApplyOwnerChange(lead, request.NewOwnerUserId, request.NewOwnerName, request.TeamCode,
            request.AssignmentReason, effective, isBulkRoute: false);

        await auditWriter.WriteAsync(
            new AuditEntry(auditActionCode, nameof(Lead), lead.Id, AuditResult.Succeeded,
                request.AssignmentReason.Trim()),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        var consents = await consentRepository.GetForLeadAsync(lead.Id, cancellationToken);

        return Result.Success(lead.ToDetailResponse(
            currentUser.CanSeeContact(), currentUser.CanSeeEvidence(), consents, currentUser.HasPermission));
    }

    private static bool IsDonor(string? recordType) =>
        string.Equals(recordType, "Donor", StringComparison.OrdinalIgnoreCase)
        || string.Equals(recordType, "Donors", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The new owner must be somebody who works donors and leads.
    ///
    /// THE PICKER USED TO OFFER EVERY ACTIVE ACCOUNT, donor-portal logins included, and the server
    /// accepted whatever id arrived - so a lead could be handed to a member of the public who could
    /// never open it. If the directory cannot be read the check stands aside rather than blocking
    /// all routing.
    /// </summary>
    private async Task<Error?> CheckOwnerAsync(Guid newOwnerUserId, CancellationToken cancellationToken)
    {
        var assignable = await people.GetAssignableAsync(currentUser.OrganisationId, cancellationToken);

        return assignable.Count == 0 || assignable.Any(person => person.UserId == newOwnerUserId)
            ? null
            : Error.Validation(
                "Choose somebody who works donors and leads. That person cannot be given this work.",
                [new ValidationError("newOwnerUserId", "Choose an owner from the list.")]);
    }

    /// <summary>
    /// Gives a donor an owner, or moves them to another - the role flow's "the Tenant Admin can
    /// subsequently assign the donor to an owner through the Assignment Board".
    ///
    /// THE DONOR'S FOLLOW-UPS DO NOT MOVE WITH IT. The flow keeps the person who owns a
    /// relationship and the person a follow-up is assigned to apart, so re-routing the donor
    /// leaves every planned follow-up with whoever it was given to.
    /// </summary>
    private async Task<Result<LeadDetailResponse>> ApplyDonorAssignmentAsync(
        AssignmentRequest request,
        bool expectOwned,
        CancellationToken cancellationToken)
    {
        var donor = await donorRepository.GetByIdAsync(request.LeadId, cancellationToken);

        if (donor is null || donor.OrganisationId != currentUser.OrganisationId)
        {
            return Result.Failure<LeadDetailResponse>(Error.DonorNotFound());
        }

        if (request.ExpectedVersion is > 0 && request.ExpectedVersion != donor.Version)
        {
            return Result.Failure<LeadDetailResponse>(Error.Concurrency());
        }

        if (donor.Status is DonorStatus.Archived or DonorStatus.Merged)
        {
            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition(
                $"A donor in state {donor.Status} can no longer be routed."));
        }

        if (expectOwned && donor.RelationshipOwnerUserId is null)
        {
            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition(
                "This donor has no owner yet. Use Assign rather than Reassign."));
        }

        if (!expectOwned && donor.RelationshipOwnerUserId is not null)
        {
            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition(
                "This donor already has an owner. Use Reassign rather than Assign."));
        }

        if (donor.RelationshipOwnerUserId == request.NewOwnerUserId)
        {
            return Result.Failure<LeadDetailResponse>(Error.InvalidTransition("That person already owns this donor."));
        }

        var ownerError = await CheckOwnerAsync(request.NewOwnerUserId, cancellationToken);
        if (ownerError is not null)
        {
            return Result.Failure<LeadDetailResponse>(ownerError);
        }

        ApplyDonorOwnerChange(donor, request.NewOwnerUserId, request.NewOwnerName, request.AssignmentReason,
            request.EffectiveAtUtc ?? clock.UtcNow, isBulkRoute: false);

        await auditWriter.WriteAsync(
            new AuditEntry(expectOwned ? AuditActionCodes.DonorOwnerReassigned : AuditActionCodes.DonorOwnerAssigned,
                nameof(Donor), donor.Id, AuditResult.Succeeded,
                $"{donor.DonorNumber} given to {request.NewOwnerName.Trim()}. {request.AssignmentReason.Trim()}"),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        // THE BOARD READS NOTHING FROM THIS BUT SUCCESS - it reloads. A lead-shaped body is
        // returned only so the two kinds of assignment share one response type.
        return Result.Success<LeadDetailResponse>(null!);
    }

    private async Task<Result<BulkRouteResultResponse>> BulkRouteDonorsAsync(
        BulkRouteRequest request,
        IReadOnlyList<Guid> requestedIds,
        CancellationToken cancellationToken)
    {
        var donors = await donorRepository.GetByIdsAsync([.. requestedIds], cancellationToken);
        var effective = request.EffectiveAtUtc ?? clock.UtcNow;
        var items = new List<BulkRouteItemResponse>(requestedIds.Count);
        var routed = 0;

        foreach (var donorId in requestedIds)
        {
            var donor = donors.FirstOrDefault(candidate => candidate.Id == donorId);

            if (donor is null || donor.OrganisationId != currentUser.OrganisationId)
            {
                items.Add(new BulkRouteItemResponse(donorId, null, false, "Not found inside your scope."));
                continue;
            }

            if (donor.Status is DonorStatus.Archived or DonorStatus.Merged)
            {
                items.Add(new BulkRouteItemResponse(donorId, donor.DonorNumber, false, $"State {donor.Status} cannot be routed."));
                continue;
            }

            if (donor.RelationshipOwnerUserId == request.NewOwnerUserId)
            {
                items.Add(new BulkRouteItemResponse(donorId, donor.DonorNumber, false, "Already owned by the selected person."));
                continue;
            }

            ApplyDonorOwnerChange(donor, request.NewOwnerUserId, request.NewOwnerName, request.AssignmentReason, effective, isBulkRoute: true);
            routed++;
            items.Add(new BulkRouteItemResponse(donorId, donor.DonorNumber, true, "Routed."));
        }

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.DonorOwnersBulkRouted, nameof(Donor), null, AuditResult.Succeeded,
                $"{routed} of {requestedIds.Count} donor(s) routed to {request.NewOwnerName}. {request.AssignmentReason.Trim()}"),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        var skipped = requestedIds.Count - routed;

        return Result.Success(new BulkRouteResultResponse(
            requestedIds.Count,
            routed,
            skipped,
            items,
            skipped == 0
                ? $"All {routed} donor(s) were routed to {request.NewOwnerName}."
                : $"{routed} donor(s) routed, {skipped} skipped. Review the per-record outcome below.",
            skipped == 0 ? ScreenState.Success : ScreenState.Validation));
    }

    private void ApplyDonorOwnerChange(
        Donor donor,
        Guid newOwnerUserId,
        string newOwnerName,
        string reason,
        DateTimeOffset effectiveAtUtc,
        bool isBulkRoute)
    {
        donorRepository.AddOwnerChange(new DonorOwnerChange
        {
            OrganisationId = donor.OrganisationId,
            DonorId = donor.Id,
            PreviousOwnerUserId = donor.RelationshipOwnerUserId,
            PreviousOwnerName = donor.RelationshipOwnerName,
            NewOwnerUserId = newOwnerUserId,
            NewOwnerName = newOwnerName.Trim(),
            Reason = reason.Trim(),
            EffectiveAtUtc = effectiveAtUtc,
            AssignedByUserId = currentUser.UserId,
            IsBulkRoute = isBulkRoute
        });

        donor.RelationshipOwnerUserId = newOwnerUserId;
        donor.RelationshipOwnerName = newOwnerName.Trim();
    }

    /// <summary>
    /// Moves ownership and writes the history row. Both single and bulk routing go through
    /// here so an ownership change can never happen without leaving a trail.
    /// </summary>
    private void ApplyOwnerChange(
        Lead lead,
        Guid newOwnerUserId,
        string newOwnerName,
        string? teamCode,
        string reason,
        DateTimeOffset effectiveAtUtc,
        bool isBulkRoute)
    {
        var previousOwnerId = lead.OwnerUserId;
        var previousOwnerName = lead.OwnerName;

        lead.OwnerUserId = newOwnerUserId;
        lead.OwnerName = newOwnerName.Trim();
        lead.TeamCode = string.IsNullOrWhiteSpace(teamCode) ? lead.TeamCode : teamCode.Trim();
        lead.SlaState = LeadMappingConfig.CalculateSlaState(lead.NextActionDueUtc, clock.UtcNow, _settings);

        if (lead.Status == LeadStatus.New)
        {
            lead.Status = LeadStatus.Assigned;
        }

        leadRepository.AddAssignment(new LeadAssignment
        {
            OrganisationId = lead.OrganisationId,
            LeadId = lead.Id,
            PreviousOwnerUserId = previousOwnerId,
            PreviousOwnerName = previousOwnerName,
            NewOwnerUserId = newOwnerUserId,
            NewOwnerName = newOwnerName.Trim(),
            AssignmentReason = reason.Trim(),
            EffectiveAtUtc = effectiveAtUtc,
            AssignedByUserId = currentUser.UserId,
            IsBulkRoute = isBulkRoute
        });
    }
}

public sealed class AssignmentRequestValidator : AbstractValidator<AssignmentRequest>
{
    public AssignmentRequestValidator()
    {
        RuleFor(request => request.LeadId).NotEmpty().WithMessage("Enter Lead reference.");
        RuleFor(request => request.NewOwnerUserId).NotEmpty().WithMessage("Enter New owner.");

        RuleFor(request => request.NewOwnerName)
            .NotEmpty().WithMessage("Enter New owner.")
            .MaximumLength(200).WithMessage("Use no more than 200 characters.");

        RuleFor(request => request.AssignmentReason)
            .NotEmpty().WithMessage("Enter Assignment reason.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.");
    }
}

public sealed class BulkRouteRequestValidator : AbstractValidator<BulkRouteRequest>
{
    public BulkRouteRequestValidator()
    {
        RuleFor(request => request.LeadIds).NotEmpty().WithMessage("Select at least one lead.");
        RuleFor(request => request.NewOwnerUserId).NotEmpty().WithMessage("Enter New owner.");

        RuleFor(request => request.NewOwnerName)
            .NotEmpty().WithMessage("Enter New owner.")
            .MaximumLength(200).WithMessage("Use no more than 200 characters.");

        RuleFor(request => request.AssignmentReason)
            .NotEmpty().WithMessage("Enter Assignment reason.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.");
    }
}