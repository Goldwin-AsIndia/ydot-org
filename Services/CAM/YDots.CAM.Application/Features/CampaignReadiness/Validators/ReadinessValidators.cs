using FluentValidation;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Features.CampaignReadiness.DTOs;

namespace YDots.CAM.Application.Features.CampaignReadiness.Validators;

/// <summary>Validator for adding a readiness check.</summary>
public sealed class CreateReadinessCheckRequestValidator : AbstractValidator<CreateReadinessCheckRequest>
{
    /// <summary>The refusal for a due date before today, shared with the edit path.</summary>
    internal const string PastDueDateMessage = "The due date cannot be in the past.";

    public CreateReadinessCheckRequestValidator(IDateTimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(clock);

        RuleFor(request => request.CheckName)
            .NotEmpty().WithMessage("Name the check.")
            .MaximumLength(200);

        // A NEW CHECK CANNOT FALL DUE YESTERDAY. It would be overdue from the moment it was
        // created, with nothing anybody could have done to finish it in time. Today is allowed.
        RuleFor(request => request.DueDate)
            .Must(due => due is null || due.Value >= clock.TodayUtc)
            .WithMessage(PastDueDateMessage);

        RuleFor(request => request.Category).IsInEnum();

        // A check with no success criteria cannot be judged: whoever picks it up has no way to
        // know what passing would look like.
        RuleFor(request => request.SuccessCriteria)
            .NotEmpty().WithMessage("Describe what has to be true for this check to pass.")
            .MaximumLength(1000);

        RuleFor(request => request.Description).MaximumLength(1000);
        RuleFor(request => request.Notes).MaximumLength(2000);
    }
}

/// <summary>Validator for editing a readiness check.</summary>
public sealed class UpdateReadinessCheckRequestValidator : AbstractValidator<UpdateReadinessCheckRequest>
{
    public UpdateReadinessCheckRequestValidator()
    {
        RuleFor(request => request.ExpectedVersion)
            .GreaterThan(0).WithMessage("The record version is missing. Reload the page and try again.");

        RuleFor(request => request.CheckName)
            .NotEmpty().WithMessage("Name the check.")
            .MaximumLength(200);

        RuleFor(request => request.Category).IsInEnum();

        RuleFor(request => request.SuccessCriteria)
            .NotEmpty().WithMessage("Describe what has to be true for this check to pass.")
            .MaximumLength(1000);

        RuleFor(request => request.Description).MaximumLength(1000);
        RuleFor(request => request.Notes).MaximumLength(2000);
    }
}

/// <summary>Validator for passing or failing a check.</summary>
public sealed class ReadinessVerdictRequestValidator : AbstractValidator<ReadinessVerdictRequest>
{
    public ReadinessVerdictRequestValidator()
    {
        RuleFor(request => request.ExpectedVersion)
            .GreaterThan(0).WithMessage("The record version is missing. Reload the page and try again.");

        RuleFor(request => request.Notes).MaximumLength(2000);
    }
}

/// <summary>Validator for raising a blocker.</summary>
public sealed class AssignReadinessBlockerRequestValidator
    : AbstractValidator<AssignReadinessBlockerRequest>
{
    public AssignReadinessBlockerRequestValidator()
    {
        RuleFor(request => request.ExpectedVersion)
            .GreaterThan(0).WithMessage("The record version is missing. Reload the page and try again.");

        // A blocker with no owner is a complaint rather than a task: nobody has been asked to
        // clear it, so nobody will.
        RuleFor(request => request.OwnerUserId)
            .NotEmpty().WithMessage("Assign the blocker to somebody.");

        RuleFor(request => request.BlockerNote)
            .NotEmpty().WithMessage("Describe what is blocking this check.")
            .MaximumLength(2000);
    }
}

/// <summary>Validator for clearing a blocker.</summary>
public sealed class ResolveReadinessBlockerRequestValidator
    : AbstractValidator<ResolveReadinessBlockerRequest>
{
    public ResolveReadinessBlockerRequestValidator()
    {
        RuleFor(request => request.ResolutionNote).MaximumLength(2000);
    }
}

/// <summary>Validator for returning a campaign to Draft.</summary>
public sealed class ReturnCampaignToDraftRequestValidator
    : AbstractValidator<ReturnCampaignToDraftRequest>
{
    public ReturnCampaignToDraftRequestValidator()
    {
        RuleFor(request => request.ExpectedVersion)
            .GreaterThan(0).WithMessage("The record version is missing. Reload the page and try again.");

        // Mandatory, unlike most reasons in this module: whoever submitted the campaign is
        // about to find it back in their queue and will want to know why.
        RuleFor(request => request.Reason)
            .NotEmpty().WithMessage("Explain why the campaign is going back to Draft.")
            .MaximumLength(2000);
    }
}
