using FluentValidation;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Features.WhatsApp.Validators;

/// <summary>The Wati page's send form, checked before anything reaches the worker.</summary>
public sealed class SendBroadcastRequestValidator : AbstractValidator<SendBroadcastRequest>
{
    public SendBroadcastRequestValidator()
    {
        RuleFor(r => r.TemplateName)
            .NotEmpty().WithMessage("Choose a template.")
            .MaximumLength(200);

        RuleFor(r => r.BroadcastName)
            .NotEmpty().WithMessage("Give this broadcast a name so you can find it in the report.")
            .MinimumLength(3).WithMessage("Use at least 3 characters.")
            .MaximumLength(200);

        RuleFor(r => r.Recipients)
            .NotEmpty().WithMessage("Choose at least one recipient.")
            .Must(r => r.Count <= 50000).WithMessage("At most 50,000 recipients can be sent to at once.");

        RuleForEach(r => r.Recipients)
            .Matches(@"^\+?[0-9]{8,15}$").WithMessage("'{PropertyValue}' is not a phone number with its country code.");

        RuleFor(r => r.Values)
            .Must(values => values is null || values.All(v => !string.IsNullOrWhiteSpace(v.Key) && v.Key.Length <= 100 && (v.Value ?? string.Empty).Length <= 2000))
            .WithMessage("Every template value needs a name (up to 100 characters) and at most 2,000 characters of text.");
    }
}

/// <summary>The upload review's "which of these were checked before?" call.</summary>
public sealed class NumberLookupRequestValidator : AbstractValidator<NumberLookupRequest>
{
    public NumberLookupRequestValidator()
    {
        RuleFor(r => r.Numbers).NotNull().WithMessage("Send the numbers to look up.");
    }
}
