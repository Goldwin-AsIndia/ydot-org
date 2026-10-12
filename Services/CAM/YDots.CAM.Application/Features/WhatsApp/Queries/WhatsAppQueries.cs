using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Abstractions.Services;
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

public sealed record GetWatiRecipientsQuery;

public sealed record GetWatiBroadcastsQuery;

public sealed record GetWatiMessagesQuery(WatiMessageFilter Filter);

public sealed record GetWorkerCommandQuery(string Reference);

/// <summary>The read side of the WhatsApp screens. Every answer is scoped to the caller's organisation by the store.</summary>
public sealed class WhatsAppQueryHandler(
    IWhatsAppIntegrationStore store,
    IWhatsAppInbox inbox,
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
                    ["Number", "Country", "WhatsApp enabled", "Note", "Status", "Sheet", "Line", "Written in file as", "WATI status", "WATI skip reason"],
                    rows.Select(r => new[] { r.Number, r.Country, r.WhatsApp, r.Note, r.Status, r.Sheet, r.Line.ToString(), r.Raw, r.WatiStatus ?? "", r.WatiSkipReason ?? "" }));
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

    public async Task<Result<IReadOnlyList<WatiRecipientView>>> HandleAsync(GetWatiRecipientsQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.GetRecipientsAsync(settings.Value.MaxListRows, cancellationToken));

    public async Task<Result<IReadOnlyList<WatiBroadcastView>>> HandleAsync(GetWatiBroadcastsQuery query, CancellationToken cancellationToken) =>
        Result.Success(await store.GetBroadcastsAsync(cancellationToken));

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
