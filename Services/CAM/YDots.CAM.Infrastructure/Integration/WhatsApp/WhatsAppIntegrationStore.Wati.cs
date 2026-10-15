using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YDots.CAM.Application.Features.WhatsApp;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>The Wati side: templates and the delivery report. The pool is in .Selection, the send log in .Sends.</summary>
public sealed partial class WhatsAppIntegrationStore
{
    // =====================================================================================
    // Templates
    // =====================================================================================

    /// <summary>
    /// The templates the worker will accept: those WATI reports as approved, plus any declared in
    /// the worker's own settings (offered while WATI cannot be reached) - each with what the
    /// preview needs to look like the real message: its header, footer and buttons.
    /// </summary>
    public Task<IReadOnlyList<WatiTemplateView>> GetTemplatesAsync(CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<WatiTemplateView>>(
            async () =>
            {
                var rows = await Templates
                    .Where(template => template.IsActive)
                    .OrderBy(template => template.DisplayLabel)
                    .ThenBy(template => template.ElementName)
                    .ToListAsync(cancellationToken);

                return rows.Select(ToTemplateView).ToList();
            },
            []);

    private static WatiTemplateView ToTemplateView(WatiTemplateRow row)
    {
        var parameters = ParametersOf(row.ParametersJson);
        var variables = parameters.Select(parameter => parameter.Key).ToList();

        // A placeholder used in the body or header that WATI did not list as a parameter still has
        // to be filled, so it is offered too.
        var header = HeaderOf(row.HeaderJson);
        foreach (var name in WhatsAppSendRules.PlaceholderNames(row.Body).Concat(WhatsAppSendRules.PlaceholderNames(header.Text)))
        {
            if (!variables.Contains(name, StringComparer.OrdinalIgnoreCase))
            {
                variables.Add(name);
            }
        }

        var mediaVariable = MediaVariableOf(header, variables);
        var format = header.Format ?? (mediaVariable is not null ? "IMAGE" : null);

        return new WatiTemplateView(
            row.ElementName,
            string.IsNullOrWhiteSpace(row.DisplayLabel) ? row.ElementName : row.DisplayLabel,
            CategoryOf(row.Category),
            row.Body,
            variables,
            parameters.ToDictionary(parameter => parameter.Key, parameter => parameter.Value, StringComparer.OrdinalIgnoreCase),
            row.Source,
            row.Status,
            row.Language,
            row.LastSyncedAtUtc,
            format,
            format == "TEXT" ? header.Text : null,
            format is "IMAGE" or "VIDEO" or "DOCUMENT" ? mediaVariable : null,
            string.IsNullOrWhiteSpace(row.Footer) ? null : row.Footer.Trim(),
            ButtonLabelsOf(row.ButtonsJson));
    }

    /// <summary>
    /// What WATI said about a template's header. WATI's JSON is not consistent across accounts
    /// and versions ("typeString": "image", "format": "IMAGE", "type": "image"...), so this reads
    /// the few spellings seen and leaves the rest alone rather than guessing.
    /// </summary>
    private static (string? Format, string? Text, string? Link) HeaderOf(string? headerJson)
    {
        if (string.IsNullOrWhiteSpace(headerJson))
        {
            return (null, null, null);
        }

        try
        {
            using var document = JsonDocument.Parse(headerJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return (null, null, null);
            }

            var kind = (JsonText(root, "typeString") ?? JsonText(root, "format") ?? JsonText(root, "type") ?? JsonText(root, "mediaType"))?
                .Trim().ToUpperInvariant();

            var format = kind switch
            {
                "TEXT" => "TEXT",
                "IMAGE" => "IMAGE",
                "VIDEO" => "VIDEO",
                "DOCUMENT" or "FILE" or "PDF" => "DOCUMENT",
                _ => null,
            };

            return (format, JsonText(root, "text") ?? JsonText(root, "headerOriginal"), JsonText(root, "link") ?? JsonText(root, "mediaUrl"));
        }
        catch (JsonException)
        {
            return (null, null, null);
        }
    }

    /// <summary>
    /// The parameter that carries a media header's picture: a placeholder in the header itself, or
    /// else the parameter whose name says so (image_url, media_url, ...).
    /// </summary>
    private static string? MediaVariableOf((string? Format, string? Text, string? Link) header, IReadOnlyList<string> variables)
    {
        var inHeader = WhatsAppSendRules.PlaceholderNames(header.Text).Concat(WhatsAppSendRules.PlaceholderNames(header.Link)).FirstOrDefault();
        if (inHeader is not null && header.Format != "TEXT")
        {
            return inHeader;
        }

        if (header.Format == "TEXT")
        {
            return null;
        }

        string[] words = header.Format is "VIDEO" ? ["video", "media", "url"] : header.Format is "DOCUMENT" ? ["document", "file", "pdf", "media", "url"] : ["image", "photo", "picture", "media"];
        return variables.FirstOrDefault(variable => words.Any(word => variable.Contains(word, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>The text of each button ("Donate Now"), wherever WATI put it in the button object.</summary>
    private static IReadOnlyList<string> ButtonLabelsOf(string? buttonsJson)
    {
        if (string.IsNullOrWhiteSpace(buttonsJson))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(buttonsJson);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var labels = new List<string>();
            foreach (var button in document.RootElement.EnumerateArray())
            {
                var label = JsonText(button, "text") ?? JsonText(button, "buttonText") ?? JsonText(button, "title")
                            ?? (button.ValueKind == JsonValueKind.Object && button.TryGetProperty("parameter", out var parameter)
                                ? JsonText(parameter, "text") ?? JsonText(parameter, "title")
                                : null);

                if (!string.IsNullOrWhiteSpace(label))
                {
                    labels.Add(label.Trim());
                }
            }

            return labels;
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static string? JsonText(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        foreach (var property in element.EnumerateObject())
        {
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)
                && property.Value.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(property.Value.GetString()))
            {
                return property.Value.GetString();
            }
        }

        return null;
    }

    // =====================================================================================
    // The delivery report
    // =====================================================================================

    /// <summary>
    /// The delivery report, newest first.
    ///
    /// SKIPPED RECIPIENTS ARE LEFT OUT UNLESS ASKED FOR. The skip reasons are on the send's own
    /// entry in the send log; a delivery report is about messages that went out.
    /// </summary>
    public Task<IReadOnlyList<WatiMessageView>> GetMessagesAsync(
        WatiMessageFilter filter, int maximum, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<WatiMessageView>>(
            async () =>
            {
                var tenantId = TenantId;

                var query = context.Database.SqlQuery<MessageReportRow>($"""
                    SELECT m.id, m.wati_job_id, m.campaign_id, m.whatsapp_number, m.whatsapp_check,
                           m.template_name, m.broadcast_name, m.parameters_json, m.status, m.skip_reason,
                           m.local_message_id, m.failed_code, m.failed_reason, m.reply_text,
                           m.queued_at_utc, m.sent_at_utc, m.delivered_at_utc, m.read_at_utc,
                           m.replied_at_utc, m.status_times_observed,
                           m.contact_name, m.source_job_number, m.checknumber_provider_task_id,
                           p.country_iso, p.country_name,
                           w.template_label, w.rendered_preview,
                           COALESCE(w.template_body, t.body) AS template_body
                    FROM int_wati_messages m
                    JOIN int_wati_jobs w ON w.id = m.wati_job_id
                    LEFT JOIN int_phone_numbers p ON p.id = m.phone_number_id
                    LEFT JOIN int_wati_templates t ON t.element_name = m.template_name
                    WHERE m.tenant_id = {tenantId}
                    """);

                if (!filter.IncludeSkipped)
                {
                    query = query.Where(message => message.Status != "Skipped");
                }

                if (filter.BroadcastId is { } broadcastId)
                {
                    query = query.Where(message => message.WatiJobId == broadcastId);
                }

                if (!string.IsNullOrWhiteSpace(filter.TemplateName))
                {
                    var templateName = filter.TemplateName.Trim();
                    query = query.Where(message => message.TemplateName == templateName);
                }

                if (filter.CampaignId is { } campaignId)
                {
                    query = query.Where(message => message.CampaignId == campaignId);
                }

                var rows = await query
                    .OrderByDescending(message => message.QueuedAtUtc)
                    .ThenBy(message => message.WhatsAppNumber)
                    .Take(Math.Max(1, maximum))
                    .ToListAsync(cancellationToken);

                return rows.Select(ToMessageView).ToList();
            },
            []);

    private static WatiMessageView ToMessageView(MessageReportRow row)
    {
        var values = ParametersOf(row.ParametersJson)
            .ToDictionary(parameter => parameter.Key, parameter => parameter.Value, StringComparer.OrdinalIgnoreCase);

        return new WatiMessageView(
            row.Id,
            PlusNumber(row.WhatsAppNumber),
            row.CountryIso ?? string.Empty,
            row.CountryName ?? string.Empty,
            AnswerOf(row.WhatsAppCheck),
            string.IsNullOrWhiteSpace(row.TemplateLabel) ? row.TemplateName : row.TemplateLabel,
            row.TemplateName,
            row.WatiJobId,
            row.BroadcastName,
            MessageStatusOf(row.Status),
            values,

            // EACH MESSAGE AS ITS RECIPIENT READ IT: the body kept with the send, filled with this
            // message's own values (a {{name}} differs per recipient). Older sends without a kept
            // body show the send's preview.
            WhatsAppSendRules.Render(row.TemplateBody, values) ?? row.RenderedPreview,
            row.QueuedAtUtc,
            row.SentAtUtc,
            row.DeliveredAtUtc,
            row.ReadAtUtc,
            row.RepliedAtUtc,
            row.FailedCode,
            row.FailedReason,
            row.ReplyText,
            row.SkipReason,
            row.StatusTimesObserved,
            row.LocalMessageId,
            row.CampaignId,
            row.ContactName,
            row.SourceJobNumber,
            row.CheckNumberProviderTaskId);
    }

    /// <summary>WATI stores digits ("919500873627"); the screens show "+919500873627".</summary>
    private static string PlusNumber(string digits) => digits.StartsWith('+') ? digits : "+" + digits;

    /// <summary>
    /// The report's six statuses from the worker's nine. Queued, Sending and Pending are all "not
    /// with WhatsApp yet" to the person reading the report.
    /// </summary>
    private static string MessageStatusOf(string status) => status switch
    {
        "Sent" => "SENT",
        "Delivered" => "DELIVERED",
        "Read" => "READ",
        "Replied" => "REPLIED",
        "Failed" => "FAILED",
        "Skipped" => "SKIPPED",
        _ => "PENDING",
    };

    /// <summary>WATI says MARKETING / UTILITY / AUTHENTICATION; the page shows "Marketing".</summary>
    private static string CategoryOf(string? category) =>
        string.IsNullOrWhiteSpace(category)
            ? "Utility"
            : CultureInfo.InvariantCulture.TextInfo.ToTitleCase(category.Trim().ToLowerInvariant());

    /// <summary>
    /// A parameters_json column - [{"name": "image_url", "value": "https://..."}] - as ordered
    /// name/value pairs. A name that appears twice keeps its last value, as the worker's own merge
    /// does.
    /// </summary>
    private static IReadOnlyList<KeyValuePair<string, string>> ParametersOf(string? parametersJson)
    {
        if (string.IsNullOrWhiteSpace(parametersJson))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(parametersJson);

            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            var parameters = new List<KeyValuePair<string, string>>();
            var positions = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (var element in document.RootElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.Object
                    || !element.TryGetProperty("name", out var nameElement)
                    || nameElement.ValueKind != JsonValueKind.String
                    || string.IsNullOrWhiteSpace(nameElement.GetString()))
                {
                    continue;
                }

                var name = nameElement.GetString()!.Trim();
                var value = element.TryGetProperty("value", out var valueElement) && valueElement.ValueKind == JsonValueKind.String
                    ? valueElement.GetString() ?? string.Empty
                    : string.Empty;

                var pair = new KeyValuePair<string, string>(name, value);

                if (positions.TryGetValue(name, out var position))
                {
                    parameters[position] = pair;
                }
                else
                {
                    positions[name] = parameters.Count;
                    parameters.Add(pair);
                }
            }

            return parameters;
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>A jsonb array of strings (tags), or an empty list.</summary>
    private static IReadOnlyList<string> StringsOf(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.Array
                ? document.RootElement.EnumerateArray()
                    .Where(item => item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
                    .Select(item => item.GetString()!)
                    .ToList()
                : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    /// <summary>The parameter bindings of a send ([{"name","source"}]) as name -> source.</summary>
    private static IReadOnlyDictionary<string, string> BindingsOf(string? json)
    {
        var bindings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(json))
        {
            return bindings;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return bindings;
            }

            foreach (var element in document.RootElement.EnumerateArray())
            {
                var name = JsonText(element, "name");
                var source = JsonText(element, "source");
                if (name is not null && source is not null)
                {
                    bindings[name] = source;
                }
            }
        }
        catch (JsonException)
        {
            // An unreadable value reads as no bindings.
        }

        return bindings;
    }

    /// <summary>The excluded selection of a send ([{"number","reason","detail"}]).</summary>
    private static IReadOnlyList<(string Number, string Reason, string? Detail)> ExcludedOf(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            return document.RootElement.EnumerateArray()
                .Select(element => (Number: JsonText(element, "number") ?? string.Empty, Reason: JsonText(element, "reason") ?? string.Empty, Detail: JsonText(element, "detail")))
                .Where(entry => entry.Number.Length > 0)
                .ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
