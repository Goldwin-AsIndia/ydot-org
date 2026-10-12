using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>The Wati side: templates, the "ready in Wati" pool, broadcasts and the delivery report.</summary>
public sealed partial class WhatsAppIntegrationStore
{
    // =====================================================================================
    // Templates
    // =====================================================================================

    /// <summary>
    /// The templates the worker will accept: those WATI reports as approved, plus any declared in
    /// the worker's own settings (offered while WATI cannot be reached).
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

                return rows
                    .Select(row =>
                    {
                        var parameters = ParametersOf(row.ParametersJson);

                        return new WatiTemplateView(
                            row.ElementName,
                            string.IsNullOrWhiteSpace(row.DisplayLabel) ? row.ElementName : row.DisplayLabel,
                            CategoryOf(row.Category),
                            row.Body,
                            parameters.Select(parameter => parameter.Key).ToList(),
                            parameters.ToDictionary(parameter => parameter.Key, parameter => parameter.Value),
                            row.Source,
                            row.Status,
                            row.Language,
                            row.LastSyncedAtUtc);
                    })
                    .ToList();
            },
            []);

    // =====================================================================================
    // Recipients
    // =====================================================================================

    /// <summary>
    /// The numbers this organisation can message: those it has had checked (or answered from a
    /// saved result) whose CURRENT answer is Yes, each with the newest check that included it.
    ///
    /// "CURRENT" MATTERS. A number that was on WhatsApp last month and is reported as not
    /// registered by a later check leaves the pool, because the registry holds the latest answer.
    /// Messaging on a stale Yes is exactly the wasted WATI spend this whole pipeline exists to
    /// avoid.
    /// </summary>
    public Task<IReadOnlyList<WatiRecipientView>> GetRecipientsAsync(int maximum, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<WatiRecipientView>>(
            async () =>
            {
                var tenantId = TenantId;

                var rows = await context.Database
                    .SqlQuery<RecipientRow>($"""
                        SELECT pool.e164, pool.country_iso, pool.country_name, pool.checked_at_utc,
                               pool.job_id, pool.job_number, pool.original_file_name,
                               last.messaged_at_utc AS last_messaged_at_utc,
                               last.template_name AS last_template_name
                        FROM (
                            SELECT DISTINCT ON (n.phone_number_id)
                                   n.phone_number_id, p.e164, p.country_iso, p.country_name,
                                   COALESCE(p.whatsapp_checked_at_utc, n.created_at_utc) AS checked_at_utc,
                                   j.id AS job_id, j.job_number, f.original_file_name
                            FROM int_input_file_numbers n
                            JOIN int_phone_numbers p ON p.id = n.phone_number_id
                            JOIN int_integration_jobs j ON j.id = n.job_id
                            JOIN int_input_files f ON f.id = j.input_file_id
                            WHERE n.tenant_id = {tenantId}
                              AND n.final_whatsapp_status = 'Yes'
                              AND p.whatsapp_status = 'Yes'
                            ORDER BY n.phone_number_id, n.created_at_utc DESC) pool
                        LEFT JOIN LATERAL (
                            SELECT COALESCE(m.sent_at_utc, m.completed_at_utc, m.queued_at_utc) AS messaged_at_utc,
                                   m.template_name
                            FROM int_wati_messages m
                            WHERE m.tenant_id = {tenantId}
                              AND m.phone_number_id = pool.phone_number_id
                              AND m.request_status = 'Accepted'
                            ORDER BY m.queued_at_utc DESC
                            LIMIT 1) last ON true
                        """)
                    .OrderByDescending(row => row.CheckedAtUtc)
                    .ThenBy(row => row.E164)
                    .Take(Math.Max(1, maximum))
                    .ToListAsync(cancellationToken);

                return rows
                    .Select(row => new WatiRecipientView(
                        row.E164,
                        row.CountryIso ?? string.Empty,
                        row.CountryName ?? string.Empty,
                        row.CheckedAtUtc,
                        row.JobId,
                        row.JobNumber,
                        row.OriginalFileName,
                        row.LastMessagedAtUtc,
                        row.LastTemplateName))
                    .ToList();
            },
            []);

    // =====================================================================================
    // Broadcasts and the delivery report
    // =====================================================================================

    /// <summary>
    /// Every WATI job of the organisation - those a person sent from the Wati page and those the
    /// worker started by itself after a check - newest first.
    /// </summary>
    public Task<IReadOnlyList<WatiBroadcastView>> GetBroadcastsAsync(CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<WatiBroadcastView>>(
            async () =>
            {
                var rows = await WatiJobs
                    .OrderByDescending(job => job.CreatedAtUtc)
                    .Take(MaximumPageSize)
                    .ToListAsync(cancellationToken);

                var jobIds = rows
                    .Where(row => row.IntegrationJobId != null)
                    .Select(row => row.IntegrationJobId!.Value)
                    .Distinct()
                    .ToArray();

                var jobNumbers = jobIds.Length == 0
                    ? new Dictionary<Guid, string>()
                    : await Jobs
                        .Where(job => jobIds.Contains(job.Id))
                        .Select(job => new { job.Id, job.JobNumber })
                        .ToDictionaryAsync(job => job.Id, job => job.JobNumber, cancellationToken);

                return rows
                    .Select(row => new WatiBroadcastView(
                        row.Id,
                        row.Reference,
                        row.BroadcastName,
                        row.TemplateName,
                        string.IsNullOrWhiteSpace(row.TemplateLabel) ? row.TemplateName : row.TemplateLabel,
                        row.Status,
                        row.Source,
                        row.CreatedAtUtc,
                        row.CompletedAtUtc,

                        // "Recipients" is who the message was meant for and attempted: the skipped
                        // (not on WhatsApp, outside the allow-list, over the cap) are reported
                        // separately, so the figure matches the rows of the delivery report.
                        Recipients: row.TotalRecipients - row.SkippedCount,
                        row.AcceptedCount,
                        row.FailedCount,
                        row.SkippedCount,
                        row.CampaignId,
                        row.IntegrationJobId,
                        row.IntegrationJobId is { } jobId ? jobNumbers.GetValueOrDefault(jobId) : null,
                        row.RequestedByName,
                        row.ErrorMessage))
                    .ToList();
            },
            []);

    /// <summary>
    /// The delivery report, newest first.
    ///
    /// SKIPPED RECIPIENTS ARE LEFT OUT UNLESS ASKED FOR. A check of 550 numbers produces 549
    /// "skipped" rows and one real message; a delivery report that opened on the 549 would bury
    /// the one thing it is for. The skip reasons are counted on the job's own page.
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
                           p.country_iso, p.country_name,
                           w.template_label, w.rendered_preview
                    FROM int_wati_messages m
                    JOIN int_wati_jobs w ON w.id = m.wati_job_id
                    LEFT JOIN int_phone_numbers p ON p.id = m.phone_number_id
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
            .ToDictionary(parameter => parameter.Key, parameter => parameter.Value);

        return new WatiMessageView(
            row.Id,
            row.WhatsAppNumber.StartsWith('+') ? row.WhatsAppNumber : "+" + row.WhatsAppNumber,
            row.CountryIso ?? string.Empty,
            row.CountryName ?? string.Empty,
            AnswerOf(row.WhatsAppCheck),
            string.IsNullOrWhiteSpace(row.TemplateLabel) ? row.TemplateName : row.TemplateLabel,
            row.TemplateName,
            row.WatiJobId,
            row.BroadcastName,
            MessageStatusOf(row.Status),
            values,
            row.RenderedPreview,
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
            row.CampaignId);
    }

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
}
