using FluentValidation;
using YDot.IAM.Application.Common.Validation;
using YDot.IAM.Application.Features.Organisations.DTOs;
using YDot.IAM.Domain.ValueObjects;

namespace YDot.IAM.Application.Features.Organisations.Validators;

/// <summary>
/// Shape checks for departments and organisation units. The limits are the column sizes in
/// <c>AuthorizationConfigurations</c>: name 200, code 50, description 1000, kind 80, address
/// lines 250, city / state / country 120, postal code 20, e-mail 320, phone 30.
/// </summary>
public sealed class CreateDepartmentRequestValidator : AbstractValidator<CreateDepartmentRequest>
{
    public CreateDepartmentRequestValidator()
    {
        RuleFor(request => request.Name)
            .NotEmpty().WithMessage("Enter a department name.")
            .MinimumLength(2)
            .MaximumLength(200)
            .ContainsLetter();

        RuleFor(request => request.Code)
            .NotEmpty().WithMessage("Enter a department code.")
            .MaximumLength(50)
            .UpperCode();

        RuleFor(request => request.Description).MaximumLength(1000);
    }
}

public sealed class UpdateDepartmentRequestValidator : AbstractValidator<UpdateDepartmentRequest>
{
    public UpdateDepartmentRequestValidator()
    {
        RuleFor(request => request.ExpectedVersion).GreaterThan(0);

        RuleFor(request => request.Name)
            .MinimumLength(2).MaximumLength(200).ContainsLetter()
            .When(request => !string.IsNullOrWhiteSpace(request.Name));

        RuleFor(request => request.Code)
            .MaximumLength(50).UpperCode()
            .When(request => !string.IsNullOrWhiteSpace(request.Code));

        RuleFor(request => request.Description).MaximumLength(1000);
    }
}

public sealed class CreateOrganisationUnitRequestValidator : AbstractValidator<CreateOrganisationUnitRequest>
{
    public CreateOrganisationUnitRequestValidator()
    {
        RuleFor(request => request.Name)
            .NotEmpty().WithMessage("Enter an office name.")
            .MinimumLength(2)
            .MaximumLength(200)
            .ContainsLetter();

        RuleFor(request => request.Code)
            .NotEmpty().WithMessage("Enter an office code.")
            .MaximumLength(50)
            .UpperCode(allowHyphen: true);

        RuleFor(request => request.Description).MaximumLength(1000);
        RuleFor(request => request.UnitType).MaximumLength(80);
        RuleFor(request => request.AddressLine1).MaximumLength(250);
        RuleFor(request => request.AddressLine2).MaximumLength(250);
        RuleFor(request => request.City).MaximumLength(120);
        RuleFor(request => request.State).MaximumLength(120);
        RuleFor(request => request.Country).MaximumLength(120);
        RuleFor(request => request.TimeZone).MaximumLength(80);

        RuleFor(request => request.PostalCode)
            .Must((request, value) => FieldRules.IsValidPostalCode(value, request.Country))
            .WithMessage(request => PostalMessage(request.Country));

        RuleFor(request => request.ContactEmail)
            .MaximumLength(320)
            .Must(value => EmailValue.TryParse(value) is not null)
            .When(request => !string.IsNullOrWhiteSpace(request.ContactEmail))
            .WithMessage("That e-mail address is not valid.");

        RuleFor(request => request.ContactPhone).MaximumLength(30).PhoneNumber();
    }

    internal static string PostalMessage(string? country) =>
        string.Equals(country?.Trim(), "India", StringComparison.OrdinalIgnoreCase)
            ? "The postal code must be exactly 6 digits for India."
            : "The postal code can contain letters, digits, spaces and hyphens only (3 to 20 characters).";
}

public sealed class UpdateOrganisationUnitRequestValidator : AbstractValidator<UpdateOrganisationUnitRequest>
{
    public UpdateOrganisationUnitRequestValidator()
    {
        RuleFor(request => request.ExpectedVersion).GreaterThan(0);

        RuleFor(request => request.Name)
            .MinimumLength(2).MaximumLength(200).ContainsLetter()
            .When(request => !string.IsNullOrWhiteSpace(request.Name));

        RuleFor(request => request.Code)
            .MaximumLength(50).UpperCode(allowHyphen: true)
            .When(request => !string.IsNullOrWhiteSpace(request.Code));

        RuleFor(request => request.Description).MaximumLength(1000);
        RuleFor(request => request.UnitType).MaximumLength(80);
        RuleFor(request => request.AddressLine1).MaximumLength(250);
        RuleFor(request => request.AddressLine2).MaximumLength(250);
        RuleFor(request => request.City).MaximumLength(120);
        RuleFor(request => request.State).MaximumLength(120);
        RuleFor(request => request.Country).MaximumLength(120);
        RuleFor(request => request.TimeZone).MaximumLength(80);

        RuleFor(request => request.PostalCode)
            .Must((request, value) => FieldRules.IsValidPostalCode(value, request.Country))
            .WithMessage(request => CreateOrganisationUnitRequestValidator.PostalMessage(request.Country));

        RuleFor(request => request.ContactEmail)
            .MaximumLength(320)
            .Must(value => EmailValue.TryParse(value) is not null)
            .When(request => !string.IsNullOrWhiteSpace(request.ContactEmail))
            .WithMessage("That e-mail address is not valid.");

        RuleFor(request => request.ContactPhone).MaximumLength(30).PhoneNumber();
    }
}
