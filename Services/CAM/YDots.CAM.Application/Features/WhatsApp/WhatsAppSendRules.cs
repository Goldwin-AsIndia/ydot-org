using System.Text.RegularExpressions;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Features.WhatsApp;

/// <summary>
/// The rules of a send that the web application needs BEFORE the worker sees it: how a selected
/// number is written, how a template is filled for one recipient, and what each of the worker's
/// skip and failure codes means in words.
///
/// THE WORKER STAYS THE AUTHORITY. These mirror its WatiJobFactory / WatiRecipientPlanner /
/// WatiTemplateRenderer so the review screen shows what the worker will do; the worker applies
/// its own copy again when it creates the send, so a disagreement can only make the review wrong,
/// never let a message through that the worker's rules stop.
/// </summary>
public static partial class WhatsAppSendRules
{
    /// <summary>The recipient fields a template parameter can be bound to (the worker's ParameterSources).</summary>
    public const string ContactNameSource = "contactName";

    /// <summary>
    /// The worker's fingerprint of a number on its test allow-list (WorkerHeartbeat): SHA-256 of the
    /// number's digits, lower-case hex.
    /// </summary>
    public static string Fingerprint(string number) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(new string(number.Where(char.IsAsciiDigit).ToArray())))).ToLowerInvariant();

    public const string PhoneNumberSource = "phoneNumber";

    public static readonly IReadOnlyList<string> BindingSources = [ContactNameSource, PhoneNumberSource];

    // The worker's codes (SkipReasons / ErrorCodes). Stable: they are stored on the rows.
    public const string WhatsAppNotAvailable = "WHATSAPP_NOT_AVAILABLE";
    public const string WhatsAppUnverified = "WHATSAPP_UNVERIFIED";
    public const string NotInAllowList = "NOT_IN_ALLOWLIST";
    public const string MaxRecipientsReached = "MAX_RECIPIENTS_REACHED";
    public const string AlreadySent = "ALREADY_SENT";
    public const string DuplicateInJob = "DUPLICATE_IN_JOB";
    public const string NotInPool = "NOT_IN_POOL";
    public const string InvalidNumber = "INVALID_NUMBER";

    /// <summary>The message statuses that mean WATI accepted a message (the worker's "already sent" test).</summary>
    public static readonly IReadOnlyList<string> AcceptedStatuses = ["Pending", "Sent", "Delivered", "Read", "Replied"];

    /// <summary>
    /// A selected number in E.164 ("+919500873627"), or null when it is not one. The pool hands out
    /// E.164 already; this accepts the same few spellings the worker does for a typed number.
    /// </summary>
    public static string? ToE164(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var text = raw.Trim();
        var digits = new string(text.Where(char.IsAsciiDigit).ToArray());

        if (text.StartsWith('+'))
        {
            return digits.Length is >= 8 and <= 15 ? "+" + digits : null;
        }

        // Ten digits starting 6-9 are an Indian mobile written without its country code.
        if (digits.Length == 10 && digits[0] is >= '6' and <= '9')
        {
            return "+91" + digits;
        }

        if (digits.Length == 11 && digits[0] == '0' && digits[1] is >= '6' and <= '9')
        {
            return "+91" + digits[1..];
        }

        return digits.Length is >= 11 and <= 15 ? "+" + digits : null;
    }

    /// <summary>A template body with its {{placeholders}} filled; a placeholder without a value stays visible.</summary>
    public static string? Render(string? body, IReadOnlyDictionary<string, string> values)
    {
        if (string.IsNullOrEmpty(body))
        {
            return body;
        }

        return Placeholder().Replace(body, match =>
            values.TryGetValue(match.Groups[1].Value, out var value) && !string.IsNullOrWhiteSpace(value)
                ? value
                : match.Value);
    }

    /// <summary>The placeholder names a text uses, in order of first appearance.</summary>
    public static IReadOnlyList<string> PlaceholderNames(string? text) =>
        string.IsNullOrEmpty(text)
            ? []
            : Placeholder().Matches(text).Select(m => m.Groups[1].Value).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>
    /// One recipient's values: the send's values, with each bound parameter replaced by the
    /// recipient's own - the contact name, or the number. A recipient the source has nothing for
    /// keeps the send's value (the fallback the person typed).
    /// </summary>
    public static IReadOnlyDictionary<string, string> Personalise(
        IReadOnlyDictionary<string, string> values,
        IReadOnlyList<ParameterBindingRequest> bindings,
        string? contactName,
        string e164)
    {
        var result = new Dictionary<string, string>(values, StringComparer.OrdinalIgnoreCase);

        foreach (var binding in bindings)
        {
            var value = binding.Source switch
            {
                ContactNameSource => contactName,
                PhoneNumberSource => e164,
                _ => null,
            };

            if (!string.IsNullOrWhiteSpace(value))
            {
                result[binding.Name.Trim()] = value.Trim();
            }
            else if (!result.ContainsKey(binding.Name.Trim()))
            {
                result[binding.Name.Trim()] = string.Empty;
            }
        }

        return result;
    }

    /// <summary>The bindings that name a parameter and a known source, the last one winning per parameter.</summary>
    public static IReadOnlyList<ParameterBindingRequest> CleanBindings(IReadOnlyList<ParameterBindingRequest>? bindings) =>
        (bindings ?? [])
            .Where(binding => !string.IsNullOrWhiteSpace(binding.Name) && BindingSources.Contains(binding.Source))
            .GroupBy(binding => binding.Name.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(group => new ParameterBindingRequest(group.Key, group.Last().Source))
            .ToList();

    /// <summary>Tags as they are stored: trimmed, no repeats (ignoring case), at most ten of forty characters.</summary>
    public static List<string> CleanTags(IEnumerable<string>? tags) =>
        (tags ?? [])
            .Select(tag => (tag ?? string.Empty).Trim())
            .Where(tag => tag.Length > 0)
            .Select(tag => tag.Length > 40 ? tag[..40].TrimEnd() : tag)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .ToList();

    /// <summary>What a skip, exclusion or failure code means, for the review, the send log and the exports.</summary>
    public static string? ReasonText(string? code) => code switch
    {
        null or "" => null,
        WhatsAppNotAvailable => "The newest check says this number is not on WhatsApp.",
        WhatsAppUnverified => "CheckNumber.ai could not verify this number.",
        NotInAllowList => "The worker's test allow-list is on and this number is not on it.",
        MaxRecipientsReached => "The send reached the most numbers one send may message.",
        AlreadySent => "This template was already sent to this number for the same campaign.",
        DuplicateInJob => "Selected more than once; it is messaged once.",
        NotInPool => "Not a number any check of this organisation has answered.",
        InvalidNumber => "Not a phone number with its country code.",
        "CANCELLED" => "The send was stopped before this message went out.",
        "WATI_UNAUTHORIZED" => "WATI refused the API token; it must be renewed in the worker, then the send retried.",
        "WATI_UNAVAILABLE" => "WATI could not be reached; retrying the send can deliver it.",
        "WATI_DELIVERY_UNCERTAIN" => "WATI did not confirm the message and has no record of it; retrying the send can deliver it.",
        "WATI_NOT_CONFIGURED" => "WATI is not configured in the worker.",
        "WATI_REJECTED" => "WATI refused the request.",
        "WATI_INVALID_NUMBER" => "WATI did not accept this number.",
        "WATI_MESSAGE_FAILED" => "WhatsApp did not deliver the message.",
        "WATI_TEMPLATE_MISSING" => "WATI has no approved template with this name.",
        _ => null,
    };

    [GeneratedRegex(@"\{\{\s*([\w.\-]+)\s*\}\}")]
    private static partial Regex Placeholder();
}
