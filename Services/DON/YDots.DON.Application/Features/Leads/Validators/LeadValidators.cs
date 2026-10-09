using FluentValidation;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Features.Leads.DTOs;
using YDots.DON.Domain.Enums;
using YDots.DON.Domain.ValueObjects;

namespace YDots.DON.Application.Features.Leads.Validators;

/// <summary>
/// SCR-DON-002 field contract turned into rules. "Conditional" in the specification means the
/// field is required only when something else is true, which is exactly what the .When() calls
/// below express.
/// </summary>
public sealed class CreateLeadRequestValidator : AbstractValidator<CreateLeadRequest>
{
    public CreateLeadRequestValidator()
    {
        RuleFor(request => request.FirstName)
            .NotEmpty().WithMessage("Enter First name or known name.")
            .Length(2, 100).WithMessage("Use between 2 and 100 characters.");

        RuleFor(request => request.LastName)
            .MaximumLength(100).WithMessage("Use no more than 100 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.LastName));

        RuleFor(request => request.MobileNumber)
            .Must(PrimaryPhoneValue.IsValid)
            .WithMessage("Review Mobile number. Use the international format, for example +919876543210.")
            .When(request => !string.IsNullOrWhiteSpace(request.MobileNumber));

        RuleFor(request => request.EmailAddress)
            .Must(EmailValue.IsValid)
            .WithMessage("Review Email address. The value does not meet the stated format.")
            .When(request => !string.IsNullOrWhiteSpace(request.EmailAddress));

        // A lead nobody can reach is not a lead, so one of the two contact fields is required.
        RuleFor(request => request.MobileNumber)
            .NotEmpty()
            .WithMessage("Enter Mobile number or Email address. A lead needs at least one way of being reached.")
            .When(request => string.IsNullOrWhiteSpace(request.EmailAddress));

        RuleFor(request => request.PreferredLanguage)
            .Must(SupportedLanguages.IsSupported)
            .WithMessage("Review Preferred language. Choose a value from the approved catalogue.")
            .When(request => !string.IsNullOrWhiteSpace(request.PreferredLanguage));

        RuleFor(request => request.City)
            .MaximumLength(150).WithMessage("Use no more than 150 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.City));

        RuleFor(request => request.DisplayName)
            .MaximumLength(150).WithMessage("Use no more than 150 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.DisplayName));

        RuleFor(request => request.Country)
            .MaximumLength(100).WithMessage("Use no more than 100 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.Country));

        RuleFor(request => request.AddressLine)
            .MaximumLength(250).WithMessage("Use no more than 250 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.AddressLine));

        // The other numbers obey the primary's rule: the same E.164 check, so a number that could
        // not be the primary cannot slip in as an alternate either.
        RuleFor(request => request.AlternateMobileNumbers)
            .Must(numbers => numbers is null || numbers.Count <= LeadContactLimits.MaximumAlternateNumbers)
            .WithMessage($"Add no more than {LeadContactLimits.MaximumAlternateNumbers} other numbers.")
            .Must(numbers => numbers is null
                             || numbers.All(number => string.IsNullOrWhiteSpace(number) || PrimaryPhoneValue.IsValid(number)))
            .WithMessage("Review the other mobile numbers. Use the international format, for example +919876543210.");

        RuleFor(request => request.CampaignId)
            .NotEmpty().WithMessage("Enter Campaign.");

        RuleFor(request => request.Source)
            .NotEmpty().WithMessage("Enter Source.")
            .Length(2, 200).WithMessage("Use between 2 and 200 characters.");

        RuleFor(request => request.Notes)
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.Notes));

        RuleFor(request => request.Consent!)
            .SetValidator(new LeadConsentRequestValidator())
            .When(request => request.Consent is not null);
    }
}

public sealed class UpdateLeadRequestValidator : AbstractValidator<UpdateLeadRequest>
{
    public UpdateLeadRequestValidator()
    {
        RuleFor(request => request.FirstName)
            .NotEmpty().WithMessage("Enter First name or known name.")
            .Length(2, 100).WithMessage("Use between 2 and 100 characters.");

        RuleFor(request => request.LastName)
            .MaximumLength(100).WithMessage("Use no more than 100 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.LastName));

        RuleFor(request => request.MobileNumber)
            .Must(PrimaryPhoneValue.IsValid)
            .WithMessage("Review Mobile number. Use the international format, for example +919876543210.")
            .When(request => !string.IsNullOrWhiteSpace(request.MobileNumber));

        RuleFor(request => request.EmailAddress)
            .Must(EmailValue.IsValid)
            .WithMessage("Review Email address. The value does not meet the stated format.")
            .When(request => !string.IsNullOrWhiteSpace(request.EmailAddress));

        RuleFor(request => request.MobileNumber)
            .NotEmpty()
            .WithMessage("Enter Mobile number or Email address. A lead needs at least one way of being reached.")
            .When(request => string.IsNullOrWhiteSpace(request.EmailAddress));

        RuleFor(request => request.PreferredLanguage)
            .Must(SupportedLanguages.IsSupported)
            .WithMessage("Review Preferred language. Choose a value from the approved catalogue.")
            .When(request => !string.IsNullOrWhiteSpace(request.PreferredLanguage));

        RuleFor(request => request.CampaignId)
            .NotEmpty().WithMessage("Enter Campaign.");

        RuleFor(request => request.Source)
            .NotEmpty().WithMessage("Enter Source.")
            .Length(2, 200).WithMessage("Use between 2 and 200 characters.");

        RuleFor(request => request.Notes)
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.Notes));

        RuleFor(request => request.ExpectedVersion)
            .GreaterThan(0)
            .WithMessage("The record version is required. Reload the record if it is missing.");

        RuleFor(request => request.DisplayName)
            .MaximumLength(150).WithMessage("Use no more than 150 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.DisplayName));

        RuleFor(request => request.Country)
            .MaximumLength(100).WithMessage("Use no more than 100 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.Country));

        RuleFor(request => request.AddressLine)
            .MaximumLength(250).WithMessage("Use no more than 250 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.AddressLine));

        // The other numbers obey the primary's rule: the same E.164 check, so a number that could
        // not be the primary cannot slip in as an alternate either.
        RuleFor(request => request.AlternateMobileNumbers)
            .Must(numbers => numbers is null || numbers.Count <= LeadContactLimits.MaximumAlternateNumbers)
            .WithMessage($"Add no more than {LeadContactLimits.MaximumAlternateNumbers} other numbers.")
            .Must(numbers => numbers is null
                             || numbers.All(number => string.IsNullOrWhiteSpace(number) || PrimaryPhoneValue.IsValid(number)))
            .WithMessage("Review the other mobile numbers. Use the international format, for example +919876543210.");

        RuleFor(request => request.Consent!)
            .SetValidator(new LeadConsentRequestValidator())
            .When(request => request.Consent is not null);
    }
}

/// <summary>
/// The embedded consent block. Nothing below the toggle is required until the toggle is on,
/// and once it is on the evidence and the purpose become mandatory — a consent row with no
/// stated purpose and no evidence would not survive an audit.
/// </summary>
public sealed class LeadConsentRequestValidator : AbstractValidator<LeadConsentRequest>
{
    public LeadConsentRequestValidator()
    {
        RuleFor(request => request.Purpose)
            .NotEmpty().WithMessage("Enter Purpose.")
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.")
            .When(request => request.CollectConsent);

        RuleFor(request => request.ConsentSource)
            .NotEmpty().WithMessage("Enter Consent source.")
            .MaximumLength(200).WithMessage("Use no more than 200 characters.")
            .When(request => request.CollectConsent);

        RuleFor(request => request.ConsentNotes)
            .MaximumLength(2000).WithMessage("Use no more than 2,000 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.ConsentNotes));

        RuleFor(request => request.ConsentEvidenceReference)
            .MaximumLength(300).WithMessage("Use no more than 300 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.ConsentEvidenceReference));

        // At least one channel has to be chosen, otherwise the toggle records nothing at all.
        //
        // ANCHORED ON A REAL PROPERTY, and the reason is what the client does with `field`.
        // Every error row is keyed by its `field` straight into a control map (`apiFieldErrors`
        // in api-response.model.ts), so the path has to be one a control actually answers to.
        // This rule was `RuleFor(request => request)` with `.WithName("Consent state")`, which
        // produced the path `consent.consent state` - a name with a space in it, matching no
        // control on any form. The message was dropped on the floor, and the screen showed a
        // form that refused to save with nothing marked wrong on it, which is the worst way for
        // a validation rule to fail: the person cannot even see what to correct.
        //
        // `EmailConsent` is the first checkbox of the channel group, so the message now lands
        // on that group where the choice is actually made, and it arrives as `consent.emailConsent`.
        // NO `WithName` HERE, deliberately: this filter serialises `failure.PropertyName`, which
        // WithName overwrites, so any display name with a space in it lands back in the same
        // unbindable state. The human wording belongs in the message, which is where it is.
        //
        // "DO NOT CONTACT" NEEDS NO TICK. It refuses every channel at once, which is a complete
        // answer by itself; demanding a ticked channel beside it asked the person to name a
        // channel they had just been told must not be used.
        RuleFor(request => request.EmailConsent)
            .Must((request, _) => request.EmailConsent || request.SmsConsent
                                  || request.WhatsAppConsent || request.PhoneCallConsent)
            .WithMessage("Choose at least one channel, or turn Collect consent off.")
            .When(request => request.CollectConsent && !request.DoNotContact);

        RuleFor(request => request.ConsentState)
            .Must(state => Enum.TryParse<ConsentState>(state, ignoreCase: true, out _))
            .WithMessage("Review Consent state. Choose a value from the list.")
            .When(request => request.CollectConsent && !string.IsNullOrWhiteSpace(request.ConsentState));

        RuleFor(request => request.ExpiryAtUtc)
            .Must((request, expiry) => expiry > request.ConsentDateUtc)
            .WithMessage("Review Expiry time. It has to be later than the effective time.")
            .When(request => request.CollectConsent && request.ExpiryAtUtc is not null && request.ConsentDateUtc is not null);

        RuleFor(request => request.ContactRestrictions)
            .MaximumLength(250).WithMessage("Use no more than 250 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.ContactRestrictions));

        RuleFor(request => request.CorrectionReason)
            .Length(10, 2000).WithMessage("Use between 10 and 2,000 characters.")
            .When(request => !string.IsNullOrWhiteSpace(request.CorrectionReason));
    }
}

/// <summary>How many numbers a lead may carry beside the primary. One place, so the rule and the message agree.</summary>
public static class LeadContactLimits
{
    public const int MaximumAlternateNumbers = 4;
}
