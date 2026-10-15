using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Common.Settings;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Features.WhatsApp.Queries;

public sealed record GetWhatsAppOverviewQuery;

public sealed record LookupNumbersQuery(NumberLookupRequest Request);

public sealed record GetUploadStatusQuery(string UploadReference);

public sealed record SearchCheckJobsQuery(CheckJobSearchFilter Filter);

/// <param name="IdOrNumber">What the route carries: the job's id, or its number (INT-20261010-000001).</param>
public sealed record ResolveCheckJobQuery(string IdOrNumber);

public sealed record GetCheckJobQuery(Guid JobId);

public sealed record GetCheckJobResultsQuery(Guid JobId);

public sealed record GetCheckJobInvalidLinesQuery(Guid JobId);

/// <param name="Kind">original | submitted | results | raw | invalid | summary.</param>
public sealed record GetCheckJobFileQuery(Guid JobId, string Kind);

public sealed record GetWatiTemplatesQuery;

/// <summary>One page of the selection pool, with the options of its filters.</summary>
public sealed record SearchWatiRecipientsQuery(WatiRecipientFilter Filter);

/// <summary>"Select all that match", up to <paramref name="Limit"/> numbers (the room left under the per-send cap).</summary>
public sealed record GetMatchingWatiRecipientsQuery(WatiRecipientFilter Filter, int Limit);

/// <summary>What a send would do - who would be messaged, who skipped and why, each message as it would read. Nothing is queued.</summary>
public sealed record ReviewWatiSendQuery(SendBroadcastRequest Request);

public sealed record SearchWatiBroadcastsQuery(WatiBroadcastFilter Filter);

public sealed record GetWatiBroadcastQuery(Guid BroadcastId);

/// <summary>The send log as a CSV: every selected number of every matching send - or of one send.</summary>
public sealed record ExportWatiBroadcastsQuery(WatiBroadcastFilter Filter, Guid? BroadcastId);

public sealed record GetWatiMessagesQuery(WatiMessageFilter Filter);

public sealed record GetWorkerCommandQuery(string Reference);

/// <summary>The read side of the WhatsApp screens. Every answer is scoped to the caller's organisation by the store.</summary>
public sealed class WhatsAppQueryHandler(
    IWhatsAppIntegrationStore store,
    IWhatsAppInbox inbox,
    ICsvExportService csv,
    IAuditWriter audit,
    IUnitOfWork unitOfWork,
    IDateTimeProvider clock,
    IOptions<WhatsAppIntegrationSettings> settings,
    ILogger<WhatsAppQueryHandler> logger)
{
    public async Task<Result<WhatsAppOverviewResponse>> HandleAsync(GetWhatsAppOverviewQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.GetOverviewAsync(cancellationToken));

    public async Task<Result<NumberLookupResponse>> HandleAsync(LookupNumbersQuery query, CancellationToken cancellationToken)
    {
        var numbers = (query.Request.Numbers ?? [])
            .Where(n => !string.IsNullOrWhiteSpace(n))
            .Select(n => n.Trim())
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (numbers.Count > settings.Value.MaxLookupNumbers)
        {
            return Result.Failure<NumberLookupResponse>(Error.Validation(
                $"At most {settings.Value.MaxLookupNumbers:N0} numbers can be looked up at once; this file has {numbers.Count:N0}."));
        }

        return Result.Success(await store.LookupAsync(numbers, cancellationToken));
    }

    public async Task<Result<UploadStatusResponse>> HandleAsync(GetUploadStatusQuery query, CancellationToken cancellationToken)
    {
        var status = await store.GetUploadStatusAsync(query.UploadReference, cancellationToken);

        // Not registered yet: the file is still waiting in the inbox for the worker's next scan.
        return Result.Success(status ?? new UploadStatusResponse(query.UploadReference, "Queued", null, null,
            "Waiting for the integration worker to pick the file up."));
    }

    public async Task<Result<PagedResponse<CheckJobListItem>>> HandleAsync(SearchCheckJobsQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.SearchJobsAsync(query.Filter, cancellationToken));

    /// <summary>
    /// The job's page is addressed by its number - the thing people read out and paste into
    /// messages - while everything behind it is keyed by id. An unknown or foreign job is "not
    /// found" either way: the store only ever looks inside the caller's organisation.
    /// </summary>
    public async Task<Result<Guid>> HandleAsync(ResolveCheckJobQuery query, CancellationToken cancellationToken) =>
        !string.IsNullOrWhiteSpace(query.IdOrNumber)
        && await store.ResolveJobIdAsync(query.IdOrNumber, cancellationToken) is { } jobId
            ? Result.Success(jobId)
            : Result.Failure<Guid>(Error.NotFound("That check was not found."));

    public async Task<Result<CheckJobDetailResponse>> HandleAsync(GetCheckJobQuery query, CancellationToken cancellationToken) =>
        await store.GetJobAsync(query.JobId, cancellationToken) is { } job
            ? Result.Success(job)
            : Result.Failure<CheckJobDetailResponse>(Error.NotFound("That check was not found."));

    public async Task<Result<IReadOnlyList<CheckJobResultRow>>> HandleAsync(GetCheckJobResultsQuery query, CancellationToken cancellationToken) =>
        await store.GetJobResultsAsync(query.JobId, cancellationToken) is { } rows
            ? Result.Success(rows)
            : Result.Failure<IReadOnlyList<CheckJobResultRow>>(Error.NotFound("That check was not found."));

    public async Task<Result<IReadOnlyList<InvalidLineView>>> HandleAsync(GetCheckJobInvalidLinesQuery query, CancellationToken cancellationToken) =>
        await store.GetInvalidLinesAsync(query.JobId, cancellationToken) is { } rows
            ? Result.Success(rows)
            : Result.Failure<IReadOnlyList<InvalidLineView>>(Error.NotFound("That check was not found."));

    /// <summary>The download buttons of a job's page.</summary>
    public async Task<Result<DownloadFile>> HandleAsync(GetCheckJobFileQuery query, CancellationToken cancellationToken)
    {
        var files = await store.GetJobFilesAsync(query.JobId, cancellationToken);
        if (files is null)
        {
            return Result.Failure<DownloadFile>(Error.NotFound("That check was not found."));
        }

        var prefix = files.JobNumber;

        switch (query.Kind.ToLowerInvariant())
        {
            case "original":
                return await FromDataFolderAsync(files.OriginalPath, files.OriginalFileName, ContentTypeOf(files.FileKind), cancellationToken);

            case "raw":
                return await FromDataFolderAsync(files.ResultArchivePath, $"{prefix}-checknumber-result.zip", "application/zip", cancellationToken);

            case "summary":
                return await FromDataFolderAsync(files.SummaryJsonPath, $"{prefix}-summary.json", "application/json", cancellationToken);

            case "submitted":
            {
                var numbers = await store.GetSubmittedNumbersAsync(query.JobId, cancellationToken) ?? [];
                return Result.Success(new DownloadFile($"{prefix}-submitted-numbers.txt", "text/plain; charset=utf-8",
                    Encoding.UTF8.GetBytes(string.Join("\r\n", numbers))));
            }

            case "results":
            {
                // The worker's completed output when it exists (every line of the file, every decision);
                // otherwise the report as it stands, built from the tables.
                if (files.ResultsCsvPath is not null && await inbox.ReadFileAsync(files.ResultsCsvPath, cancellationToken) is { } csv)
                {
                    return Result.Success(new DownloadFile($"{prefix}-whatsapp-results.csv", "text/csv; charset=utf-8", csv));
                }

                var rows = await store.GetJobResultsAsync(query.JobId, cancellationToken) ?? [];
                var built = Csv(
                    ["Number", "Name", "Country", "WhatsApp enabled", "Note", "Status", "Sheet", "Line", "Written in file as", "Last send", "WATI status", "WATI skip reason"],
                    rows.Select(r => new[]
                    {
                        r.Number, r.ContactName ?? "", r.Country, r.WhatsApp, r.Note, r.Status, r.Sheet, r.Line.ToString(), r.Raw,
                        r.LastSendReference ?? "", r.WatiStatus ?? "", r.WatiSkipReason ?? "",
                    }));
                return Result.Success(new DownloadFile($"{prefix}-results.csv", "text/csv; charset=utf-8", built));
            }

            case "invalid":
            {
                var lines = await store.GetInvalidLinesAsync(query.JobId, cancellationToken) ?? [];
                var built = Csv(["Sheet", "Line", "Value", "Reason"], lines.Select(l => new[] { l.Sheet, l.Line.ToString(), l.Raw, l.Reason }));
                return Result.Success(new DownloadFile($"{prefix}-invalid-lines.csv", "text/csv; charset=utf-8", built));
            }

            default:
                return Result.Failure<DownloadFile>(Error.Validation(
                    $"'{query.Kind}' is not a download of a check. Use original, submitted, results, raw, invalid or summary."));
        }
    }

    public async Task<Result<IReadOnlyList<WatiTemplateView>>> HandleAsync(GetWatiTemplatesQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.GetTemplatesAsync(cancellationToken));

    public async Task<Result<WatiRecipientSearchResponse>> HandleAsync(SearchWatiRecipientsQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.SearchRecipientsAsync(query.Filter, cancellationToken));

    /// <summary>
    /// The numbers behind "select all that match" - never more than the per-send cap, so the page
    /// cannot assemble a selection the server would refuse.
    /// </summary>
    public async Task<Result<WatiMatchingRecipients>> HandleAsync(GetMatchingWatiRecipientsQuery query, CancellationToken cancellationToken)
    {
        var cap = (await store.GetOverviewAsync(cancellationToken)).Settings.MaxRecipientsPerSend;
        var limit = Math.Clamp(query.Limit, 0, Math.Max(0, cap));

        return Result.Success(await store.GetMatchingRecipientsAsync(query.Filter, limit, cancellationToken));
    }

    /// <summary>
    /// THE REVIEW BEFORE A SEND. Applies the worker's rules to the selection - is each number one of
    /// the organisation's checked numbers, is it still on WhatsApp, was this template already sent to
    /// it for this campaign, does the selection fit under the cap - and fills the template for every
    /// recipient, so the person sees exactly who will hear what before anything is queued.
    ///
    /// The worker applies the same rules again when the send arrives; the only one this cannot apply
    /// number by number is the worker's test allow-list, which is reported as on or off.
    /// </summary>
    public async Task<Result<SendReviewResponse>> HandleAsync(ReviewWatiSendQuery query, CancellationToken cancellationToken)
    {
        var request = query.Request;
        var overview = await store.GetOverviewAsync(cancellationToken);
        var worker = overview.Settings;
        var cap = worker.MaxRecipientsPerSend;
        var problems = new List<string>();

        if (!overview.IntegrationAvailable)
        {
            problems.Add("The integration worker has not been set up for this database yet, so nothing can be sent.");
        }
        else if (!worker.WatiEnabled || !worker.WatiConfigured || !worker.ManualBroadcastsAllowed)
        {
            problems.Add("WATI sending is switched off or not configured on the integration worker.");
        }

        var template = (await store.GetTemplatesAsync(cancellationToken))
            .FirstOrDefault(t => string.Equals(t.Name, request.TemplateName?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (template is null)
        {
            problems.Add("Choose a template that WATI has approved.");
        }

        if (string.IsNullOrWhiteSpace(request.BroadcastName) || request.BroadcastName.Trim().Length < 3)
        {
            problems.Add("Name the send (at least 3 characters) so it can be found in the send log.");
        }

        var values = new Dictionary<string, string>(request.Values ?? new Dictionary<string, string>(), StringComparer.OrdinalIgnoreCase);
        var bindings = WhatsAppSendRules.CleanBindings(request.Bindings);
        var selection = request.SelectedRecipients();

        // ---- The selection, as the worker will read it ----------------------------------------------
        var excluded = new List<SendReviewRecipient>();
        var wanted = new List<(string E164, Guid? SourceJobId)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var entry in selection)
        {
            var e164 = WhatsAppSendRules.ToE164(entry.Number);
            if (e164 is null)
            {
                excluded.Add(Excluded((entry.Number ?? string.Empty).Trim(), WhatsAppSendRules.InvalidNumber));
            }
            else if (!seen.Add(e164))
            {
                excluded.Add(Excluded(e164, WhatsAppSendRules.DuplicateInJob));
            }
            else
            {
                wanted.Add((e164, entry.SourceJobId));
            }
        }

        if (selection.Count == 0)
        {
            problems.Add("Select at least one number.");
        }
        else if (cap > 0 && selection.Count > cap)
        {
            problems.Add($"Select at most {cap:N0} numbers for one send; {selection.Count:N0} are selected.");
        }

        var numbers = wanted.Select(entry => entry.E164).ToList();
        var facts = await store.GetCheckedNumbersAsync(numbers, cancellationToken);
        var since = worker.DuplicateWindowDays > 0 ? clock.UtcNow.AddDays(-worker.DuplicateWindowDays) : (DateTimeOffset?)null;
        var alreadySent = template is not null && worker.SkipAlreadyMessagedNumbers
            ? await store.GetAlreadySentAsync(template.Name, request.CampaignId, numbers, since, cancellationToken)
            : new HashSet<string>();

        // ---- The worker's rules, in its order ---------------------------------------------------------
        var recipients = new List<SendReviewRecipient>();
        var workerCap = worker.MaxRecipientsPerJob;
        var queued = 0;
        var missingNames = 0;

        foreach (var (e164, sourceJobId) in wanted)
        {
            if (!facts.TryGetValue(e164, out var answers) || answers.Count == 0)
            {
                excluded.Add(Excluded(e164, WhatsAppSendRules.NotInPool));
                continue;
            }

            var source = answers.FirstOrDefault(a => a.JobId == sourceJobId && a.FirstSighting)
                         ?? answers.FirstOrDefault(a => a.JobId == sourceJobId)
                         ?? answers.FirstOrDefault(a => a.FinalStatus == "Yes" && a.FirstSighting)
                         ?? answers.FirstOrDefault(a => a.FinalStatus == "Yes")
                         ?? answers[0];
            var name = !string.IsNullOrWhiteSpace(source.ContactName)
                ? source.ContactName
                : answers.FirstOrDefault(a => !string.IsNullOrWhiteSpace(a.ContactName))?.ContactName;

            string? reason = source.RegistryStatus switch
            {
                "Yes" => null,
                "No" => WhatsAppSendRules.WhatsAppNotAvailable,
                _ => worker.SendToUnverifiedNumbers ? null : WhatsAppSendRules.WhatsAppUnverified,
            };

            // The test allow-list, compared by fingerprint (an older worker publishes none; the review then
            // only says the allow-list is on).
            if (reason is null && worker.AllowListActive && worker.AllowListFingerprints.Count > 0
                && !worker.AllowListFingerprints.Contains(WhatsAppSendRules.Fingerprint(e164)))
            {
                reason = WhatsAppSendRules.NotInAllowList;
            }

            if (reason is null && alreadySent.Contains(e164))
            {
                reason = WhatsAppSendRules.AlreadySent;
            }

            if (reason is null && workerCap > 0 && queued >= workerCap)
            {
                reason = WhatsAppSendRules.MaxRecipientsReached;
            }

            if (reason is null)
            {
                queued++;
            }

            if (string.IsNullOrWhiteSpace(name) && bindings.Any(binding => binding.Source == WhatsAppSendRules.ContactNameSource))
            {
                missingNames++;
            }

            var personal = WhatsAppSendRules.Personalise(values, bindings, name, e164);
            recipients.Add(new SendReviewRecipient(
                e164,
                name,
                source.JobId,
                source.JobNumber,
                reason is null ? "send" : "skip",
                reason,
                WhatsAppSendRules.ReasonText(reason),
                WhatsAppSendRules.Render(template?.Body, personal),
                personal));
        }

        // ---- What still stops the send ---------------------------------------------------------------
        if (template is not null)
        {
            var bound = bindings.Select(binding => binding.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var empty = template.Variables
                .Where(variable => !bound.Contains(variable) && string.IsNullOrWhiteSpace(values.GetValueOrDefault(variable)))
                .ToList();
            if (empty.Count > 0)
            {
                problems.Add($"Fill in {string.Join(", ", empty.Select(variable => "{{" + variable + "}}"))}.");
            }

            var fallbackMissing = bindings
                .Where(binding => binding.Source == WhatsAppSendRules.ContactNameSource && string.IsNullOrWhiteSpace(values.GetValueOrDefault(binding.Name)))
                .ToList();
            if (fallbackMissing.Count > 0 && missingNames > 0)
            {
                problems.Add($"{Wording.Count(missingNames, "selected number")} {Wording.Verb(missingNames, "has", "have")} no name in {(missingNames == 1 ? "its" : "their")} file: give "
                             + $"{string.Join(", ", fallbackMissing.Select(binding => "{{" + binding.Name + "}}"))} a value to use instead (for example \"Friend\").");
            }
        }

        if (selection.Count > 0 && queued == 0)
        {
            problems.Add("None of the selected numbers can be messaged with this template - see the reason beside each.");
        }

        var all = recipients.Concat(excluded).ToList();
        var byReason = all
            .Where(recipient => recipient.Reason is not null)
            .GroupBy(recipient => recipient.Reason!)
            .ToDictionary(group => group.Key, group => group.Count());

        return Result.Success(new SendReviewResponse(
            new SendReviewSummary(
                selection.Count,
                queued,
                recipients.Count(recipient => recipient.Outcome == "skip"),
                excluded.Count,
                byReason,
                cap,
                worker.AllowListActive,
                worker.AllowListSize,
                template?.Label,
                template?.HeaderFormat,
                template?.MediaVariable is { } media ? values.GetValueOrDefault(media) : null,
                problems),
            all));

        static SendReviewRecipient Excluded(string number, string reason) =>
            new(number, null, null, null, "exclude", reason, WhatsAppSendRules.ReasonText(reason), null, new Dictionary<string, string>());
    }

    public async Task<Result<WatiBroadcastSearchResponse>> HandleAsync(SearchWatiBroadcastsQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.SearchBroadcastsAsync(query.Filter, cancellationToken));

    public async Task<Result<WatiBroadcastDetail>> HandleAsync(GetWatiBroadcastQuery query, CancellationToken cancellationToken) =>
        await store.GetBroadcastAsync(query.BroadcastId, cancellationToken) is { } detail
            ? Result.Success(detail)
            : Result.Failure<WatiBroadcastDetail>(Error.NotFound("That send was not found."));

    /// <summary>
    /// THE AUDIT EXPORT: one row per selected number of every matching send (or of one send) - who
    /// sent it, from which group, with which template and values, which check verified the number,
    /// and what became of the message. Written to the audit trail with the file's reference, as
    /// every CAM export is.
    /// </summary>
    public async Task<Result<ExportFile>> HandleAsync(ExportWatiBroadcastsQuery query, CancellationToken cancellationToken)
    {
        string? reference = null;
        if (query.BroadcastId is { } broadcastId)
        {
            var detail = await store.GetBroadcastAsync(broadcastId, cancellationToken);
            if (detail is null)
            {
                return Result.Failure<ExportFile>(Error.NotFound("That send was not found."));
            }

            reference = detail.Broadcast.Reference;
        }

        var rows = await store.GetBroadcastExportRowsAsync(query.Filter, query.BroadcastId, settings.Value.MaxExportRows, cancellationToken);

        var file = csv.ToCsv(
            rows.Select(row => new
            {
                Send = row.SendReference,
                SendName = row.SendName,
                CreatedAtUtc = row.SentAtUtc,
                RequestedBy = row.RequestedBy ?? string.Empty,
                Template = row.TemplateName,
                TemplateLabel = row.TemplateLabel ?? string.Empty,
                RecipientGroup = row.RecipientGroup ?? string.Empty,
                Tags = row.Tags ?? string.Empty,
                Campaign = row.Campaign ?? string.Empty,
                Number = row.Number,
                ContactName = row.ContactName ?? string.Empty,
                SourceCheckJob = row.SourceJobNumber ?? string.Empty,
                CheckNumberTaskId = row.CheckNumberTaskId ?? string.Empty,
                Status = row.Status,
                ReasonCode = row.Reason ?? string.Empty,
                Reason = row.ReasonText ?? string.Empty,
                TemplateValues = row.Values ?? string.Empty,
                AcceptedByWatiAtUtc = row.AcceptedAtUtc,
                DeliveredAtUtc = row.DeliveredAtUtc,
                ReadAtUtc = row.ReadAtUtc,
                FailedAtUtc = row.FailedAtUtc,
                LocalMessageId = row.LocalMessageId ?? string.Empty,
            }),
            reference is null ? "whatsapp-send-log" : $"whatsapp-send-{reference}");

        await audit.WriteAsync(
            WhatsAppAuditActionCodes.SendLogExported,
            WhatsAppAuditActionCodes.BroadcastTarget,
            query.BroadcastId ?? Guid.Empty,
            reference is null
                ? $"WhatsApp send log exported: {Wording.Count(rows.Count, "row")} as {file.Reference}."
                : $"WhatsApp send {reference} exported: {Wording.Count(rows.Count, "row")} as {file.Reference}.",
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("WhatsApp send log export {Reference}: {Rows} rows.", file.Reference, rows.Count);

        return Result.Success(file);
    }

    public async Task<Result<IReadOnlyList<WatiMessageView>>> HandleAsync(GetWatiMessagesQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.GetMessagesAsync(query.Filter, settings.Value.MaxListRows, cancellationToken));

    public async Task<Result<CommandStatusResponse>> HandleAsync(GetWorkerCommandQuery query, CancellationToken cancellationToken) =>
        await store.GetCommandAsync(query.Reference, cancellationToken) is { } command
            ? Result.Success(command)
            : Result.Failure<CommandStatusResponse>(Error.NotFound("That request was not found."));

    private async Task<Result<DownloadFile>> FromDataFolderAsync(string? relativePath, string fileName, string contentType, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            return Result.Failure<DownloadFile>(Error.NotFound("That file does not exist for this check (yet)."));
        }

        if (!inbox.IsConfigured)
        {
            return Result.Failure<DownloadFile>(Error.Dependency(
                "Downloads are not available: WhatsAppIntegration:DataRoot is not configured on the server."));
        }

        var content = await inbox.ReadFileAsync(relativePath, cancellationToken);
        if (content is null)
        {
            logger.LogWarning("WhatsApp download {Path} is recorded but missing from the data folder.", relativePath);
            return Result.Failure<DownloadFile>(Error.NotFound("The file is recorded but no longer in the worker's data folder."));
        }

        return Result.Success(new DownloadFile(fileName, contentType, content));
    }

    private static string ContentTypeOf(string fileKind) => fileKind.ToLowerInvariant() switch
    {
        "csv" => "text/csv",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "text/plain",
    };

    /// <summary>A UTF-8 CSV with BOM (so Excel shows Indian names and the rupee sign correctly).</summary>
    private static byte[] Csv(IReadOnlyList<string> header, IEnumerable<IReadOnlyList<string>> rows)
    {
        var builder = new StringBuilder();
        builder.Append('﻿');
        builder.AppendLine(string.Join(',', header.Select(Cell)));
        foreach (var row in rows)
        {
            builder.AppendLine(string.Join(',', row.Select(Cell)));
        }

        return Encoding.UTF8.GetBytes(builder.ToString());
    }

    private static string Cell(string value)
    {
        // Guard against spreadsheet formula injection, as the upload page does.
        if (value.Length > 0 && "=+-@".Contains(value[0]) && !(value[0] == '+' && value.Skip(1).All(c => char.IsAsciiDigit(c) || c == ' ')))
        {
            value = "'" + value;
        }

        return value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;
    }
}
