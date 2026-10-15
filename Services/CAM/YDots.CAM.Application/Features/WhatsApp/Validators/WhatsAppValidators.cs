using FluentValidation;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Features.WhatsApp.Validators;

/// <summary>Shared limits of the WhatsApp forms.</summary>
internal static class WhatsAppLimits
{
    /// <summary>
    /// The most numbers one request may carry at all. The real limit of a send is lower - the
    /// worker's cap per send, which the handler applies with a sentence naming it; this only stops
    /// an absurd body before anything is looked up.
    /// </summary>
    public const int MaxNumbersPerRequest = 5000;
}

/// <summary>The Wati page's send form, checked before anything reaches the worker.</summary>
public sealed class SendBroadcastRequestValidator : AbstractValidator<SendBroadcastRequest>
{
    public SendBroadcastRequestValidator()
    {
        RuleFor(r => r.TemplateName)
            .NotEmpty().WithMessage("Choose a template.")
            .MaximumLength(200);

        RuleFor(r => r.BroadcastName)
            .NotEmpty().WithMessage("Give this send a name so you can find it in the send log.")
            .MinimumLength(3).WithMessage("Use at least 3 characters.")
            .MaximumLength(200);

        RuleFor(r => r.SelectedRecipients())
            .NotEmpty().WithMessage("Select at least one number.")
            .Must(selection => selection.Count <= WhatsAppLimits.MaxNumbersPerRequest)
            .WithMessage($"At most {WhatsAppLimits.MaxNumbersPerRequest:N0} numbers can be sent in one request.")
            .OverridePropertyName("selection");

        // A selected value that is not a phone number is not refused here: the worker records it
        // as left out (INVALID_NUMBER), exactly as the review shows it, so the send log holds
        // everything the person selected. Only an empty or absurd entry is a broken request.
        RuleForEach(r => r.SelectedRecipients())
            .Must(entry => entry is not null && !string.IsNullOrWhiteSpace(entry.Number) && entry.Number.Trim().Length <= 40)
            .WithMessage("Every selected entry must hold a phone number.")
            .OverridePropertyName("selection");

        RuleFor(r => r.Values)
            .Must(values => values is null || values.All(v => !string.IsNullOrWhiteSpace(v.Key) && v.Key.Length <= 100 && (v.Value ?? string.Empty).Length <= 2000))
            .WithMessage("Every template value needs a name (up to 100 characters) and at most 2,000 characters of text.");

        RuleFor(r => r.Bindings)
            .Must(bindings => bindings is null || bindings.All(b => !string.IsNullOrWhiteSpace(b.Name) && WhatsAppSendRules.BindingSources.Contains(b.Source)))
            .WithMessage($"A template value can be filled from the recipient's {string.Join(" or ", WhatsAppSendRules.BindingSources)} only.");

        RuleFor(r => r.Tags)
            .Must(tags => tags is null || (tags.Count <= 10 && tags.All(tag => (tag ?? string.Empty).Trim().Length <= 40)))
            .WithMessage("Use at most 10 tags of up to 40 characters each.");
    }
}

/// <summary>The review only guards against an absurd request; everything else it reports in its answer.</summary>
public sealed class ReviewSendRequestValidator : AbstractValidator<ReviewSendRequest>
{
    public ReviewSendRequestValidator()
    {
        RuleFor(r => r.Selection)
            .Must(selection => selection is null || selection.Count <= WhatsAppLimits.MaxNumbersPerRequest)
            .WithMessage($"At most {WhatsAppLimits.MaxNumbersPerRequest:N0} numbers can be reviewed at once.");
    }
}

/// <summary>A new recipient group.</summary>
public sealed class CreateWhatsAppGroupRequestValidator : AbstractValidator<CreateWhatsAppGroupRequest>
{
    public CreateWhatsAppGroupRequestValidator()
    {
        RuleFor(r => r.Name)
            .NotEmpty().WithMessage("Give the group a name.")
            .MinimumLength(3).WithMessage("Use at least 3 characters.")
            .MaximumLength(120);

        RuleFor(r => r.Description).MaximumLength(500);

        RuleFor(r => r.Tags)
            .Must(tags => tags is null || (tags.Count <= 10 && tags.All(tag => (tag ?? string.Empty).Trim().Length <= 40)))
            .WithMessage("Use at most 10 tags of up to 40 characters each.");

        RuleFor(r => r.Members)
            .Must(members => members is null || members.Count <= WhatsAppLimits.MaxNumbersPerRequest)
            .WithMessage($"At most {WhatsAppLimits.MaxNumbersPerRequest:N0} numbers can be added at once.");
    }
}

/// <summary>A group's name, description, campaign and tags.</summary>
public sealed class UpdateWhatsAppGroupRequestValidator : AbstractValidator<UpdateWhatsAppGroupRequest>
{
    public UpdateWhatsAppGroupRequestValidator()
    {
        RuleFor(r => r.Name)
            .NotEmpty().WithMessage("Give the group a name.")
            .MinimumLength(3).WithMessage("Use at least 3 characters.")
            .MaximumLength(120);

        RuleFor(r => r.Description).MaximumLength(500);

        RuleFor(r => r.Tags)
            .Must(tags => tags is null || (tags.Count <= 10 && tags.All(tag => (tag ?? string.Empty).Trim().Length <= 40)))
            .WithMessage("Use at most 10 tags of up to 40 characters each.");

        RuleFor(r => r.ExpectedVersion).GreaterThan(0).WithMessage("Open the group again before saving it.");
    }
}

public sealed class AddWhatsAppGroupMembersRequestValidator : AbstractValidator<AddWhatsAppGroupMembersRequest>
{
    public AddWhatsAppGroupMembersRequestValidator()
    {
        RuleFor(r => r.Members)
            .NotEmpty().WithMessage("Select at least one number to add.")
            .Must(members => members.Count <= WhatsAppLimits.MaxNumbersPerRequest)
            .WithMessage($"At most {WhatsAppLimits.MaxNumbersPerRequest:N0} numbers can be added at once.");
    }
}

public sealed class RemoveWhatsAppGroupMembersRequestValidator : AbstractValidator<RemoveWhatsAppGroupMembersRequest>
{
    public RemoveWhatsAppGroupMembersRequestValidator()
    {
        RuleFor(r => r.Numbers)
            .NotEmpty().WithMessage("Select at least one number to remove.")
            .Must(numbers => numbers.Count <= WhatsAppLimits.MaxNumbersPerRequest)
            .WithMessage($"At most {WhatsAppLimits.MaxNumbersPerRequest:N0} numbers can be removed at once.");
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
