using Microsoft.EntityFrameworkCore;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Features.WhatsApp;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>
/// The send log - the audit trail of WhatsApp messaging: which numbers a person chose, from which
/// checks, with which template and values, and what became of every one of them.
/// </summary>
public sealed partial class WhatsAppIntegrationStore
{
    private static readonly IReadOnlyList<(string Value, string Label)> SendStatusOptions =
    [
        ("queued", "Queued"),
        ("sending", "Sending"),
        ("completed", "Completed"),
        ("failed", "With failures"),
        ("cancelled", "Cancelled"),
    ];

    /// <summary>The worker statuses behind one of the send log's status words; null for "all".</summary>
    private static string[]? SendStatusesFor(string? status) => status?.Trim().ToLowerInvariant() switch
    {
        "queued" => ["Queued"],
        "sending" => ["Sending"],
        "completed" => ["Completed"],
        "failed" => ["Failed", "CompletedWithErrors"],
        "cancelled" => ["Cancelled"],
        _ => null,
    };

    private static string SendStatusWordOf(string status) => status switch
    {
        "Queued" => "queued",
        "Sending" => "sending",
        "Completed" => "completed",
        "Failed" or "CompletedWithErrors" => "failed",
        "Cancelled" => "cancelled",
        _ => "queued",
    };

    private IQueryable<WatiJobRow> FilteredBroadcasts(WatiBroadcastFilter filter)
    {
        var query = WatiJobs;

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var pattern = Contains(filter.Search);
            query = query.Where(job =>
                EF.Functions.ILike(job.Reference, pattern, "\\")
                || EF.Functions.ILike(job.BroadcastName, pattern, "\\")
                || EF.Functions.ILike(job.TemplateName, pattern, "\\")
                || EF.Functions.ILike(job.TemplateLabel ?? string.Empty, pattern, "\\")
                || EF.Functions.ILike(job.RecipientGroupName ?? string.Empty, pattern, "\\"));
        }

        if (SendStatusesFor(filter.Status) is { } statuses)
        {
            query = query.Where(job => statuses.Contains(job.Status));
        }

        if (!string.IsNullOrWhiteSpace(filter.TemplateName))
        {
            var template = filter.TemplateName.Trim();
            query = query.Where(job => job.TemplateName == template);
        }

        if (filter.GroupId is { } groupId)
        {
            query = query.Where(job => job.RecipientGroupId == groupId);
        }

        if (filter.CampaignId is { } campaignId)
        {
            query = query.Where(job => job.CampaignId == campaignId);
        }

        if (filter.JobId is { } jobId)
        {
            var messages = WatiMessages;
            query = query.Where(job => messages.Any(message => message.WatiJobId == job.Id && message.SourceJobId == jobId));
        }

        if (filter.From is { } from)
        {
            var start = new DateTimeOffset(from.UtcDateTime.Date, TimeSpan.Zero);
            query = query.Where(job => job.CreatedAtUtc >= start);
        }

        if (filter.To is { } to)
        {
            var end = new DateTimeOffset(to.UtcDateTime.Date, TimeSpan.Zero).AddDays(1);
            query = query.Where(job => job.CreatedAtUtc < end);
        }

        return query;
    }

    public Task<WatiBroadcastSearchResponse> SearchBroadcastsAsync(WatiBroadcastFilter filter, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, filter.Page);
        var pageSize = Math.Clamp(filter.PageSize, 1, MaximumPageSize);

        return ReadAsync(
            async () =>
            {
                var query = FilteredBroadcasts(filter);
                var total = await query.CountAsync(cancellationToken);

                var rows = await query
                    .OrderByDescending(job => job.CreatedAtUtc)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .ToListAsync(cancellationToken);

                var items = await ToBroadcastViewsAsync(rows, cancellationToken);

                // The filter options, over every send of the organisation.
                var all = await WatiJobs
                    .Select(job => new { job.Status, job.TemplateName, job.TemplateLabel, job.RecipientGroupId, job.RecipientGroupName })
                    .ToListAsync(cancellationToken);

                var facets = new WatiBroadcastFacets(
                    SendStatusOptions
                        .Select(option => new WatiOptionFacet(option.Value, option.Label, all.Count(job => SendStatusWordOf(job.Status) == option.Value)))
                        .ToList(),
                    all.GroupBy(job => job.TemplateName)
                        .Select(group => new WatiOptionFacet(
                            group.Key,
                            group.Select(job => job.TemplateLabel).FirstOrDefault(label => !string.IsNullOrWhiteSpace(label)) ?? group.Key,
                            group.Count()))
                        .OrderBy(option => option.Label)
                        .ToList(),
                    all.Where(job => job.RecipientGroupId != null)
                        .GroupBy(job => job.RecipientGroupId!.Value)
                        .Select(group => new WatiOptionFacet(
                            group.Key.ToString(),
                            group.Select(job => job.RecipientGroupName).FirstOrDefault(name => !string.IsNullOrWhiteSpace(name)) ?? "Group",
                            group.Count()))
                        .OrderBy(option => option.Label)
                        .ToList());

                return new WatiBroadcastSearchResponse(new PagedResponse<WatiBroadcastView>(items, total, page, pageSize), facets);
            },
            new WatiBroadcastSearchResponse(PagedResponse<WatiBroadcastView>.Empty(page, pageSize), new WatiBroadcastFacets([], [], [])));
    }

    /// <summary>
    /// Shapes a page of WATI jobs: four queries for the page - campaigns, source checks, retryable
    /// failures, and the older automatic sends' check numbers - rather than four per row.
    /// </summary>
    private async Task<IReadOnlyList<WatiBroadcastView>> ToBroadcastViewsAsync(IReadOnlyList<WatiJobRow> rows, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
        {
            return [];
        }

        var ids = rows.Select(row => row.Id).ToArray();
        var retryableCodes = ParseSettings((await LatestWorkerAsync(cancellationToken))?.SettingsJson).RetryableFailureCodes.ToArray();
        var canOperate = currentUser.HasPermission(PermissionCodes.WhatsAppOperate);

        var campaignIds = rows.Where(row => row.CampaignId != null).Select(row => row.CampaignId!.Value).Distinct().ToArray();
        var campaignNames = campaignIds.Length == 0
            ? new Dictionary<Guid, string>()
            : await context.Campaigns
                .Where(campaign => campaignIds.Contains(campaign.Id))
                .Select(campaign => new { campaign.Id, campaign.Name })
                .ToDictionaryAsync(campaign => campaign.Id, campaign => campaign.Name, cancellationToken);

        var sourceJobs = (await WatiMessages
                .Where(message => ids.Contains(message.WatiJobId) && message.SourceJobNumber != null)
                .Select(message => new { message.WatiJobId, message.SourceJobNumber })
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToLookup(entry => entry.WatiJobId, entry => entry.SourceJobNumber!);

        var retryable = retryableCodes.Length == 0
            ? new Dictionary<Guid, int>()
            : await WatiMessages
                .Where(message => ids.Contains(message.WatiJobId)
                                  && message.Status == "Failed"
                                  && message.FailedCode != null
                                  && retryableCodes.Contains(message.FailedCode))
                .GroupBy(message => message.WatiJobId)
                .Select(group => new { group.Key, Count = group.Count() })
                .ToDictionaryAsync(entry => entry.Key, entry => entry.Count, cancellationToken);

        var jobIds = rows.Where(row => row.IntegrationJobId != null).Select(row => row.IntegrationJobId!.Value).Distinct().ToArray();
        var jobNumbers = jobIds.Length == 0
            ? new Dictionary<Guid, string>()
            : await Jobs
                .Where(job => jobIds.Contains(job.Id))
                .Select(job => new { job.Id, job.JobNumber })
                .ToDictionaryAsync(job => job.Id, job => job.JobNumber, cancellationToken);

        return rows.Select(row =>
            {
                var retryableFailures = retryable.GetValueOrDefault(row.Id);
                var actions = new List<string> { "export" };

                // RETRY ONLY WHERE THE WORKER WOULD ACT ON IT: a person's send, finished, with
                // failures a retry can fix - and a caller allowed to spend money.
                if (canOperate && row.Source == "Manual" && row.Status is "Failed" or "CompletedWithErrors" && retryableFailures > 0)
                {
                    actions.Add("retry");
                }

                return new WatiBroadcastView(
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
                    // (not on WhatsApp, outside the allow-list, over the cap) are counted apart, so
                    // the figure matches the rows of the delivery report.
                    Recipients: row.TotalRecipients - row.SkippedCount,
                    row.AcceptedCount,
                    row.FailedCount,
                    row.SkippedCount,
                    row.CampaignId,
                    row.IntegrationJobId,
                    row.IntegrationJobId is { } jobId ? jobNumbers.GetValueOrDefault(jobId) : null,
                    row.RequestedByName,
                    row.ErrorMessage,
                    RequestedCount: Math.Max(row.RequestedCount, row.TotalRecipients),
                    ExcludedCount: ExcludedOf(row.ExcludedJson).Count,
                    row.CampaignId is { } campaignId ? campaignNames.GetValueOrDefault(campaignId) : null,
                    row.RecipientGroupId,
                    row.RecipientGroupName,
                    StringsOf(row.TagsJson),
                    sourceJobs[row.Id].OrderBy(number => number, StringComparer.Ordinal).ToList(),
                    retryableFailures,
                    actions);
            })
            .ToList();
    }

    public Task<WatiBroadcastDetail?> GetBroadcastAsync(Guid broadcastId, CancellationToken cancellationToken) =>
        ReadAsync<WatiBroadcastDetail?>(
            async () =>
            {
                var row = await WatiJobs.Where(job => job.Id == broadcastId).FirstOrDefaultAsync(cancellationToken);
                if (row is null)
                {
                    return null;
                }

                var view = (await ToBroadcastViewsAsync([row], cancellationToken))[0];
                var body = row.TemplateBody
                           ?? await Templates.Where(template => template.ElementName == row.TemplateName).Select(template => template.Body).FirstOrDefaultAsync(cancellationToken);

                var messages = await SendMessagesOf([broadcastId], int.MaxValue, cancellationToken);
                var recipients = messages
                    .Select(message =>
                    {
                        var values = ParametersOf(message.ParametersJson).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase);
                        var reason = message.SkipReason ?? message.FailedCode;

                        return new WatiBroadcastRecipientView(
                            PlusNumber(message.WhatsAppNumber),
                            message.ContactName,
                            MessageStatusOf(message.Status),
                            reason,
                            WhatsAppSendRules.ReasonText(reason) ?? message.FailedReason,
                            message.SourceJobId,
                            message.SourceJobNumber,
                            message.CheckNumberProviderTaskId,
                            message.SentAtUtc ?? (message.RequestStatus == "Accepted" ? message.CompletedAtUtc : null),
                            message.DeliveredAtUtc,
                            message.ReadAtUtc,
                            message.FailedAtUtc,
                            WhatsAppSendRules.Render(body, values) ?? row.RenderedPreview,
                            message.Status == "Skipped" ? null : message.LocalMessageId);
                    })
                    .Concat(ExcludedOf(row.ExcludedJson).Select(excluded => new WatiBroadcastRecipientView(
                        excluded.Number,
                        null,
                        "EXCLUDED",
                        excluded.Reason,
                        WhatsAppSendRules.ReasonText(excluded.Reason) ?? excluded.Detail,
                        null, null, null, null, null, null, null, null, null)))
                    .ToList();

                var events = await Events
                    .Where(entry => entry.WatiJobId == broadcastId)
                    .OrderBy(entry => entry.OccurredAtUtc)
                    .Take(MaximumJobEvents)
                    .ToListAsync(cancellationToken);

                return new WatiBroadcastDetail(
                    view,
                    ParametersOf(row.ParametersJson).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.OrdinalIgnoreCase),
                    BindingsOf(row.ParameterBindingsJson),
                    body,
                    row.RenderedPreview,
                    recipients,
                    events.Select(entry => new JobEventView(entry.EventCode, entry.Level, entry.Message, entry.OccurredAtUtc)).ToList());
            },
            null);

    public Task<IReadOnlyList<WatiBroadcastExportRow>> GetBroadcastExportRowsAsync(
        WatiBroadcastFilter filter, Guid? broadcastId, int maximum, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<WatiBroadcastExportRow>>(
            async () =>
            {
                var sends = await (broadcastId is { } id ? WatiJobs.Where(job => job.Id == id) : FilteredBroadcasts(filter))
                    .OrderByDescending(job => job.CreatedAtUtc)
                    .Take(MaximumPageSize * 10)
                    .ToListAsync(cancellationToken);

                if (sends.Count == 0)
                {
                    return [];
                }

                var views = (await ToBroadcastViewsAsync(sends, cancellationToken)).ToDictionary(view => view.Id);
                var messages = (await SendMessagesOf(sends.Select(send => send.Id).ToArray(), maximum, cancellationToken))
                    .ToLookup(message => message.WatiJobId);

                var rows = new List<WatiBroadcastExportRow>();

                foreach (var send in sends)
                {
                    var view = views[send.Id];
                    var tags = view.Tags.Count == 0 ? null : string.Join("; ", view.Tags);

                    foreach (var message in messages[send.Id])
                    {
                        var reason = message.SkipReason ?? message.FailedCode;
                        rows.Add(new WatiBroadcastExportRow(
                            send.Reference, send.BroadcastName, send.CreatedAtUtc, send.RequestedByName,
                            send.TemplateName, view.TemplateLabel, send.RecipientGroupName, tags, view.CampaignName,
                            PlusNumber(message.WhatsAppNumber), message.ContactName, message.SourceJobNumber, message.CheckNumberProviderTaskId,
                            MessageStatusOf(message.Status), reason, WhatsAppSendRules.ReasonText(reason) ?? message.FailedReason,
                            string.Join("; ", ParametersOf(message.ParametersJson).Select(pair => $"{pair.Key}={pair.Value}")),
                            message.RequestStatus == "Accepted" ? message.CompletedAtUtc : null,
                            message.DeliveredAtUtc, message.ReadAtUtc, message.FailedAtUtc,
                            message.Status == "Skipped" ? null : message.LocalMessageId));
                    }

                    foreach (var excluded in ExcludedOf(send.ExcludedJson))
                    {
                        rows.Add(new WatiBroadcastExportRow(
                            send.Reference, send.BroadcastName, send.CreatedAtUtc, send.RequestedByName,
                            send.TemplateName, view.TemplateLabel, send.RecipientGroupName, tags, view.CampaignName,
                            excluded.Number, null, null, null, "EXCLUDED", excluded.Reason,
                            WhatsAppSendRules.ReasonText(excluded.Reason) ?? excluded.Detail,
                            null, null, null, null, null, null));
                    }

                    if (rows.Count >= maximum)
                    {
                        break;
                    }
                }

                return rows.Take(maximum).ToList();
            },
            []);

    /// <summary>The message rows of some sends, in the order they were queued.</summary>
    private async Task<IReadOnlyList<SendMessageRow>> SendMessagesOf(Guid[] watiJobIds, int maximum, CancellationToken cancellationToken)
    {
        var tenantId = TenantId;

        return await context.Database
            .SqlQuery<SendMessageRow>($"""
                SELECT m.wati_job_id, m.whatsapp_number, m.contact_name, m.status, m.skip_reason, m.failed_code,
                       m.failed_reason, m.source_job_id, m.source_job_number, m.checknumber_provider_task_id,
                       m.parameters_json, m.local_message_id, m.queued_at_utc, m.completed_at_utc, m.sent_at_utc,
                       m.delivered_at_utc, m.read_at_utc, m.failed_at_utc, m.request_status
                FROM int_wati_messages m
                WHERE m.tenant_id = {tenantId}
                  AND m.wati_job_id = ANY({watiJobIds})
                """)
            .OrderBy(message => message.QueuedAtUtc)
            .ThenBy(message => message.WhatsAppNumber)
            .Take(Math.Max(1, maximum))
            .ToListAsync(cancellationToken);
    }
}
