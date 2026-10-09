using YDots.DON.Application.Common.Models;

namespace YDots.DON.Application.Common.Constants;

/// <summary>
/// The approved language catalogue behind every "Preferred language" selector. The property
/// contract says PreferredLanguage must be a supported language code, so the list lives in one
/// place and the validator checks against it rather than accepting free text.
/// </summary>
public static class SupportedLanguages
{
    public const string Default = "en-IN";

    public static readonly IReadOnlyList<LookupItem> All =
    [
        new("en-IN", "English (India)"),
        new("ta-IN", "Tamil"),
        new("hi-IN", "Hindi"),
        new("te-IN", "Telugu"),
        new("kn-IN", "Kannada"),
        new("ml-IN", "Malayalam"),
        new("mr-IN", "Marathi"),
        new("bn-IN", "Bengali"),
        new("gu-IN", "Gujarati"),
        new("pa-IN", "Punjabi")
    ];

    public static bool IsSupported(string? code) =>
        !string.IsNullOrWhiteSpace(code)
        && All.Any(item => string.Equals(item.Value, code.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// The code for a language somebody typed: "ta-IN", "Tamil", or "English" for English (India).
    /// Null when it is none of them.
    ///
    /// FOR SPREADSHEETS. A form posts the code because it offered the list; a person filling in a
    /// column writes the word. Both have to end up as the same stored value, or a lead uploaded
    /// as "Tamil" and one captured as "ta-IN" are two languages to every filter and report.
    /// </summary>
    public static string? Resolve(string? codeOrName)
    {
        if (string.IsNullOrWhiteSpace(codeOrName))
        {
            return null;
        }

        var typed = codeOrName.Trim();

        return All.FirstOrDefault(item =>
                string.Equals(item.Value, typed, StringComparison.OrdinalIgnoreCase)
                || string.Equals(item.Label, typed, StringComparison.OrdinalIgnoreCase)
                || string.Equals(item.Label.Split(' ')[0], typed, StringComparison.OrdinalIgnoreCase))
            ?.Value;
    }
}
