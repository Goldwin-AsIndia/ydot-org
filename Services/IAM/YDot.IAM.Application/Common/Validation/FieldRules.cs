using System.Text.RegularExpressions;
using FluentValidation;

namespace YDot.IAM.Application.Common.Validation;

/// <summary>
/// Format rules shared by the request validators, written once so the screens and the API agree.
///
/// The screens run the same rules before a request is sent (see the UI's
/// <c>Shared/validation/field-rules.ts</c>); these are the ones the server enforces whatever the
/// client did. Each helper adds a rule that applies only to a value that was actually sent, so an
/// optional field stays optional and "required" is stated separately where it applies.
/// </summary>
public static partial class FieldRules
{
    /// <summary>A person's name: letters (any script), spaces, dot, hyphen and apostrophe.</summary>
    public static IRuleBuilderOptions<T, string?> PersonName<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || PersonNamePattern().IsMatch(value.Trim()))
            .WithMessage("{PropertyName} can contain letters, spaces, dot, hyphen and apostrophe only.");

    /// <summary>The text must contain at least one letter, so "123" or "---" is not a name.</summary>
    public static IRuleBuilderOptions<T, string?> ContainsLetter<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || value.Any(char.IsLetter))
            .WithMessage("{PropertyName} must contain letters, not only numbers or symbols.");

    /// <summary>Letters and single spaces only (menu names).</summary>
    public static IRuleBuilderOptions<T, string?> LettersAndSpaces<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || LettersAndSpacesPattern().IsMatch(value.Trim()))
            .WithMessage("{PropertyName} can contain letters and spaces only.");

    /// <summary>Letters and digits only (usernames).</summary>
    public static IRuleBuilderOptions<T, string?> LettersAndDigits<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || LettersAndDigitsPattern().IsMatch(value.Trim()))
            .WithMessage("{PropertyName} can contain only letters and numbers.");

    /// <summary>Employee / volunteer number: letters, digits and hyphen.</summary>
    public static IRuleBuilderOptions<T, string?> EmployeeNumber<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || EmployeeNumberPattern().IsMatch(value.Trim()))
            .WithMessage("{PropertyName} can contain letters, digits and hyphen only.");

    /// <summary>Capital letters, digits and underscore; hyphen too when <paramref name="allowHyphen"/>.</summary>
    public static IRuleBuilderOptions<T, string?> UpperCode<T>(this IRuleBuilder<T, string?> rule, bool allowHyphen = false) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value)
                           || (allowHyphen ? UpperCodeHyphenPattern() : UpperCodePattern()).IsMatch(value.Trim()))
            .WithMessage(allowHyphen
                ? "Use capital letters, digits, underscore and hyphen only."
                : "Use capital letters, digits and underscore only.");

    /// <summary>An in-app route: starts with /app/ and has no spaces.</summary>
    public static IRuleBuilderOptions<T, string?> AppRoute<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || AppRoutePattern().IsMatch(value.Trim()))
            .WithMessage("The route must start with /app/ and contain no spaces.");

    /// <summary>An absolute https:// URL.</summary>
    public static IRuleBuilderOptions<T, string?> HttpsUrl<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value)
                           || (Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
                               && uri.Scheme == Uri.UriSchemeHttps
                               && !value.Any(char.IsWhiteSpace)))
            .WithMessage("{PropertyName} must be a full web address starting with https://");

    /// <summary>Letters, digits, underscore and hyphen (merchant identifiers).</summary>
    public static IRuleBuilderOptions<T, string?> Identifier<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || IdentifierPattern().IsMatch(value.Trim()))
            .WithMessage("{PropertyName} can contain letters, digits, underscore and hyphen only.");

    /// <summary>Letters, digits, spaces, dot, hyphen and underscore, with at least one letter.</summary>
    public static IRuleBuilderOptions<T, string?> DisplayLabel<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value)
                           || (value.Any(char.IsLetter) && DisplayLabelPattern().IsMatch(value.Trim())))
            .WithMessage("{PropertyName} must contain letters and can use only letters, digits, spaces, dot, hyphen and underscore.");

    /// <summary>A free phone number: digits with an optional leading +, 7 to 15 digits.</summary>
    public static IRuleBuilderOptions<T, string?> PhoneNumber<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(value => string.IsNullOrWhiteSpace(value) || IsPhone(value))
            .WithMessage("{PropertyName} can contain digits only (and an optional leading +), 7 to 15 digits.");

    /// <summary>Postal code: six digits for India, otherwise 3 to 20 letters, digits, spaces or hyphens.</summary>
    public static bool IsValidPostalCode(string? postalCode, string? country)
    {
        if (string.IsNullOrWhiteSpace(postalCode))
        {
            return true;
        }

        var text = postalCode.Trim();
        var india = country is not null
                    && (country.Trim().Equals("India", StringComparison.OrdinalIgnoreCase)
                        || country.Trim().Equals("IN", StringComparison.OrdinalIgnoreCase)
                        || country.Trim().Equals("IND", StringComparison.OrdinalIgnoreCase));

        return india ? IndianPinPattern().IsMatch(text) : GenericPostalPattern().IsMatch(text);
    }

    private static bool IsPhone(string value)
    {
        var text = value.Trim();
        if (!PhonePattern().IsMatch(text))
        {
            return false;
        }

        var digits = text.Count(char.IsDigit);
        return text.StartsWith("+91", StringComparison.Ordinal) ? digits == 12 : digits is >= 7 and <= 15;
    }

    [GeneratedRegex(@"^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$")]
    private static partial Regex PersonNamePattern();

    [GeneratedRegex(@"^[\p{L}\p{M}]+( [\p{L}\p{M}]+)*$")]
    private static partial Regex LettersAndSpacesPattern();

    [GeneratedRegex("^[A-Za-z0-9]+$")]
    private static partial Regex LettersAndDigitsPattern();

    [GeneratedRegex("^[A-Za-z0-9-]+$")]
    private static partial Regex EmployeeNumberPattern();

    [GeneratedRegex("^[A-Z0-9_]+$")]
    private static partial Regex UpperCodePattern();

    [GeneratedRegex("^[A-Z0-9_-]+$")]
    private static partial Regex UpperCodeHyphenPattern();

    [GeneratedRegex(@"^/app/[A-Za-z0-9_\-./:]+$")]
    private static partial Regex AppRoutePattern();

    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex IdentifierPattern();

    [GeneratedRegex(@"^[\p{L}\p{N} ._-]+$")]
    private static partial Regex DisplayLabelPattern();

    [GeneratedRegex(@"^\+?[\d\s()-]+$")]
    private static partial Regex PhonePattern();

    [GeneratedRegex(@"^\d{6}$")]
    private static partial Regex IndianPinPattern();

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9 -]{1,18}[A-Za-z0-9]$")]
    private static partial Regex GenericPostalPattern();
}
