using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Features.Campaigns.DTOs;
using YDots.CAM.Application.Features.WhatsApp.DTOs;
using YDots.CAM.Domain.Enums;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>The CheckNumber side: uploads, jobs, a job's report and its files.</summary>
public sealed partial class WhatsAppIntegrationStore
{
    /// <summary>A jobs list is a screen, not an export: one page never carries more than this.</summary>
    private const int MaximumPageSize = 500;

    private const int MaximumJobEvents = 500;

    private const int MaximumCampaignActivity = 500;

    /// <summary>What each step of the worker's pipeline is called on a job's timeline.</summary>
    private static readonly IReadOnlyDictionary<string, string> StepLabels = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["REGISTER_FILE"] = "File received",
        ["PARSE_FILE"] = "File read and numbers extracted",
        ["CHECKNUMBER_CREATE_TASK"] = "Submitted to CheckNumber.ai",
        ["CHECKNUMBER_POLL"] = "Waiting for CheckNumber.ai",
        ["CHECKNUMBER_DOWNLOAD"] = "Result file downloaded",
        ["CHECKNUMBER_EXTRACT"] = "Result file extracted",
        ["CHECKNUMBER_PROCESS_RESULTS"] = "Results read",
        ["IDENTIFY_VERIFIED"] = "WhatsApp numbers identified",
        ["WATI_PREPARE"] = "WATI recipients decided",
        ["WATI_SEND_BATCH"] = "WATI batch sent",
        ["WATI_AWAIT"] = "Waiting for WATI",
        ["WATI_STATUS_SYNC"] = "WATI delivery status read",
        ["GENERATE_OUTPUT"] = "Completed output written",
        ["COMPLETE_JOB"] = "Job completed",
    };

    // =====================================================================================
    // Uploads
    // =====================================================================================

    /// <summary>
    /// THE WORKER'S OWN DUPLICATE KEY, rebuilt here: organisation, content hash and campaign. The
    /// worker enforces it with a unique index, so this is only the early, friendly answer - the
    /// person is told before the file is even written to the inbox.
    /// </summary>
    public Task<(Guid JobId, string JobNumber)?> FindProcessedDuplicateAsync(
        string sha256, Guid? campaignId, CancellationToken cancellationToken) =>
        ReadAsync<(Guid JobId, string JobNumber)?>(
            async () =>
            {
                if (TenantId is not { } tenantId)
                {
                    return null;
                }

                var dedupeKey = $"{tenantId:N}:{sha256}:{campaignId?.ToString("N") ?? "none"}";

                var fileId = await Files
                    .Where(file => file.DedupeKey == dedupeKey && file.Status == "Registered")
                    .Select(file => (Guid?)file.Id)
                    .FirstOrDefaultAsync(cancellationToken);

                if (fileId is null)
                {
                    return null;
                }

                var job = await Jobs
                    .Where(row => row.InputFileId == fileId.Value)
                    .Select(row => new { row.Id, row.JobNumber })
                    .FirstOrDefaultAsync(cancellationToken);

                return job is null ? null : (job.Id, job.JobNumber);
            },
            null);

    public Task<UploadStatusResponse?> GetUploadStatusAsync(string uploadReference, CancellationToken cancellationToken) =>
        ReadAsync<UploadStatusResponse?>(
            async () =>
            {
                var file = await Files
                    .Where(row => row.UploadReference == uploadReference)
                    .FirstOrDefaultAsync(cancellationToken);

                if (file is null)
                {
                    return null;
                }

                // A duplicate has no job of its own: the page is sent to the job that already holds
                // the answers, which is the whole point of refusing to pay for the file twice.
                var ownerFileId = file.Status == "Duplicate" ? file.DuplicateOfInputFileId : file.Id;

                var job = ownerFileId is { } id
                    ? await Jobs
                        .Where(row => row.InputFileId == id)
                        .Select(row => new { row.Id, row.JobNumber })
                        .FirstOrDefaultAsync(cancellationToken)
                    : null;

                return new UploadStatusResponse(
                    uploadReference, file.Status, job?.Id, job?.JobNumber, file.RejectionReason);
            },
            null);

    // =====================================================================================
    // Jobs
    // =====================================================================================

    public Task<PagedResponse<CheckJobListItem>> SearchJobsAsync(
        CheckJobSearchFilter filter, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, filter.Page);
        var pageSize = Math.Clamp(filter.PageSize, 1, MaximumPageSize);

        return ReadAsync(
            async () =>
            {
                var query = Jobs;

                if (StatusesFor(filter.Status) is { } statuses)
                {
                    query = query.Where(job => statuses.Contains(job.Status));
                }

                if (filter.CampaignId is { } campaignId)
                {
                    query = query.Where(job => job.CampaignId == campaignId);
                }

                if (!string.IsNullOrWhiteSpace(filter.Search))
                {
                    var pattern = Contains(filter.Search);
                    var files = Files;
                    var tasks = Tasks;

                    query = query.Where(job =>
                        EF.Functions.ILike(job.JobNumber, pattern, "\\")
                        || files.Any(file => file.Id == job.InputFileId
                                             && EF.Functions.ILike(file.OriginalFileName, pattern, "\\"))
                        || tasks.Any(task => task.JobId == job.Id
                                             && task.ProviderTaskId != null
                                             && EF.Functions.ILike(task.ProviderTaskId, pattern, "\\")));
                }

                var total = await query.CountAsync(cancellationToken);

                var rows = await query
                    .OrderByDescending(job => job.CreatedAtUtc)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .ToListAsync(cancellationToken);

                var items = await ToListItemsAsync(rows, cancellationToken);

                return new PagedResponse<CheckJobListItem>(items, total, page, pageSize);
            },
            PagedResponse<CheckJobListItem>.Empty(page, pageSize));
    }

    public Task<Guid?> ResolveJobIdAsync(string idOrNumber, CancellationToken cancellationToken) =>
        ReadAsync<Guid?>(
            async () =>
            {
                var wanted = idOrNumber.Trim();

                return Guid.TryParse(wanted, out var id)
                    ? await Jobs.Where(job => job.Id == id).Select(job => (Guid?)job.Id).FirstOrDefaultAsync(cancellationToken)
                    : await Jobs.Where(job => job.JobNumber == wanted).Select(job => (Guid?)job.Id).FirstOrDefaultAsync(cancellationToken);
            },
            null);

    public Task<string?> GetJobStatusAsync(Guid jobId, CancellationToken cancellationToken) =>
        ReadAsync<string?>(
            () => Jobs.Where(job => job.Id == jobId).Select(job => (string?)job.Status).FirstOrDefaultAsync(cancellationToken),
            null);

    public Task<CheckJobDetailResponse?> GetJobAsync(Guid jobId, CancellationToken cancellationToken) =>
        ReadAsync<CheckJobDetailResponse?>(
            async () =>
            {
                var job = await Jobs.Where(row => row.Id == jobId).FirstOrDefaultAsync(cancellationToken);

                if (job is null)
                {
                    return null;
                }

                var header = (await ToListItemsAsync([job], cancellationToken))[0];

                var tasks = await Tasks
                    .Where(task => task.JobId == jobId)
                    .OrderBy(task => task.Sequence)
                    .ThenBy(task => task.CreatedAtUtc)
                    .ToListAsync(cancellationToken);

                var resultFiles = await ResultFilesOf(jobId).ToListAsync(cancellationToken);

                var steps = await StepsOf(jobId)
                    .OrderBy(step => step.StartedAtUtc)
                    .ToListAsync(cancellationToken);

                var watiJob = await WatiJobs
                    .Where(row => row.IntegrationJobId == jobId)
                    .OrderByDescending(row => row.CreatedAtUtc)
                    .FirstOrDefaultAsync(cancellationToken);

                var watiJobId = watiJob?.Id;

                // The job's own events, plus those of the WATI job it started - the worker files the
                // sending of a batch under the WATI job, and the page should tell the whole story.
                var events = await Events
                    .Where(row => row.JobId == jobId || (watiJobId != null && row.WatiJobId == watiJobId))
                    .OrderByDescending(row => row.OccurredAtUtc)
                    .Take(MaximumJobEvents)
                    .ToListAsync(cancellationToken);

                WatiJobSummary? wati = null;

                if (watiJob is not null)
                {
                    var skipped = await WatiMessages
                        .Where(message => message.WatiJobId == watiJob.Id && message.Status == "Skipped")
                        .GroupBy(message => message.SkipReason)
                        .Select(group => new { Reason = group.Key, Count = group.Count() })
                        .ToListAsync(cancellationToken);

                    wati = new WatiJobSummary(
                        watiJob.Id,
                        watiJob.Reference,
                        watiJob.Status,
                        watiJob.TemplateName,
                        watiJob.TemplateLabel,
                        watiJob.BroadcastName,
                        watiJob.TotalRecipients,
                        watiJob.AcceptedCount,
                        watiJob.FailedCount,
                        watiJob.SkippedCount,
                        skipped.ToDictionary(entry => entry.Reason ?? "UNSPECIFIED", entry => entry.Count),
                        watiJob.ErrorCode,
                        watiJob.ErrorMessage,
                        watiJob.CreatedAtUtc,
                        watiJob.CompletedAtUtc);
                }

                var filesByTask = resultFiles.ToDictionary(file => file.CheckNumberTaskId);
                var dataFolder = !string.IsNullOrWhiteSpace(settings.Value.DataRoot);

                return new CheckJobDetailResponse(
                    header,
                    tasks.Select(task => ToTaskView(task, filesByTask.GetValueOrDefault(task.Id))).ToList(),
                    steps.Select(step => new JobTimelineEntry(
                        step.StepCode,
                        StepLabels.GetValueOrDefault(step.StepCode, step.StepCode),
                        step.Status,
                        step.Attempt,
                        step.StartedAtUtc,
                        step.CompletedAtUtc,
                        step.DurationMs,
                        step.Message,
                        step.ErrorMessage)).ToList(),
                    events
                        .OrderBy(row => row.OccurredAtUtc)
                        .Select(row => new JobEventView(row.EventCode, row.Level, row.Message, row.OccurredAtUtc))
                        .ToList(),
                    wati,
                    new JobDownloads(
                        Original: dataFolder,
                        Submitted: job.FreshNumbers > 0,
                        Results: job.WhatsAppYes + job.WhatsAppNo + job.WhatsAppUnknown > 0,
                        Raw: dataFolder && resultFiles.Any(file => !string.IsNullOrWhiteSpace(file.LocalZipPath)),
                        Invalid: job.InvalidLines > 0,
                        Summary: dataFolder && !string.IsNullOrWhiteSpace(job.SummaryJsonPath)));
            },
            null);

    /// <summary>
    /// The report: every distinct number of the job that has an answer, in file order, with what
    /// WATI then did with it.
    ///
    /// A NUMBER WITHOUT AN ANSWER YET IS LEFT OUT rather than shown as "unknown". While a check is
    /// running the report is simply empty; "unknown" is reserved for the numbers CheckNumber.ai
    /// could not verify, which is a different thing and is charged differently.
    /// </summary>
    public Task<IReadOnlyList<CheckJobResultRow>?> GetJobResultsAsync(Guid jobId, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<CheckJobResultRow>?>(
            async () =>
            {
                if (!await Jobs.AnyAsync(job => job.Id == jobId, cancellationToken))
                {
                    return null;
                }

                var tenantId = TenantId;

                var rows = await context.Database
                    .SqlQuery<JobResultRow>($"""
                        SELECT n.normalized_number, n.country_iso, n.country_name, n.classification,
                               n.final_whatsapp_status, n.result_note, n.sheet_name, n.line_number,
                               n.raw_value, n.sequence,
                               m.status AS wati_status, m.skip_reason AS wati_skip_reason
                        FROM int_input_file_numbers n
                        LEFT JOIN int_wati_messages m
                               ON m.phone_number_id = n.phone_number_id
                              AND m.wati_job_id = (SELECT w.id
                                                     FROM int_wati_jobs w
                                                    WHERE w.tenant_id = {tenantId}
                                                      AND w.integration_job_id = {jobId}
                                                    ORDER BY w.created_at_utc DESC
                                                    LIMIT 1)
                        WHERE n.tenant_id = {tenantId}
                          AND n.job_id = {jobId}
                          AND n.classification IN ('Fresh', 'AlreadyChecked')
                          AND n.final_whatsapp_status IS NOT NULL
                        """)
                    .OrderBy(row => row.Sequence)
                    .Take(settings.Value.MaxListRows)
                    .ToListAsync(cancellationToken);

                return rows
                    .Select(row =>
                    {
                        var answer = AnswerOf(row.FinalWhatsAppStatus);
                        var saved = row.Classification == "AlreadyChecked";

                        return new CheckJobResultRow(
                            row.NormalizedNumber ?? string.Empty,
                            row.CountryIso ?? string.Empty,
                            row.CountryName ?? string.Empty,
                            answer,
                            row.ResultNote ?? DefaultNote(answer, saved),
                            saved ? "saved" : answer == "unknown" ? "unverified" : "checked",
                            row.SheetName,
                            row.LineNumber,
                            row.RawValue,
                            row.WatiStatus,
                            row.WatiSkipReason);
                    })
                    .ToList();
            },
            null);

    public Task<IReadOnlyList<InvalidLineView>?> GetInvalidLinesAsync(Guid jobId, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<InvalidLineView>?>(
            async () =>
            {
                if (!await Jobs.AnyAsync(job => job.Id == jobId, cancellationToken))
                {
                    return null;
                }

                var rows = await FileNumbers
                    .Where(number => number.JobId == jobId && number.Classification == "Invalid")
                    .OrderBy(number => number.Sequence)
                    .Take(settings.Value.MaxListRows)
                    .Select(number => new { number.SheetName, number.LineNumber, number.RawValue, number.InvalidReason })
                    .ToListAsync(cancellationToken);

                return rows
                    .Select(row => new InvalidLineView(
                        row.SheetName, row.LineNumber, row.RawValue, row.InvalidReason ?? "No usable phone number"))
                    .ToList();
            },
            null);

    /// <summary>The numbers that were sent to CheckNumber.ai, in file order - the ones that were paid for.</summary>
    public Task<IReadOnlyList<string>?> GetSubmittedNumbersAsync(Guid jobId, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyList<string>?>(
            async () =>
            {
                if (!await Jobs.AnyAsync(job => job.Id == jobId, cancellationToken))
                {
                    return null;
                }

                var numbers = await FileNumbers
                    .Where(number => number.JobId == jobId
                                     && number.Classification == "Fresh"
                                     && number.NormalizedNumber != null)
                    .OrderBy(number => number.Sequence)
                    .Select(number => number.NormalizedNumber!)
                    .ToListAsync(cancellationToken);

                return numbers;
            },
            null);

    public Task<WhatsAppJobFiles?> GetJobFilesAsync(Guid jobId, CancellationToken cancellationToken) =>
        ReadAsync<WhatsAppJobFiles?>(
            async () =>
            {
                var job = await Jobs.Where(row => row.Id == jobId).FirstOrDefaultAsync(cancellationToken);

                if (job is null)
                {
                    return null;
                }

                var file = await Files.Where(row => row.Id == job.InputFileId).FirstOrDefaultAsync(cancellationToken);

                // One archive per CheckNumber.ai task. A job normally has exactly one; when the
                // worker is configured to split a file by country, the first is offered here and
                // the rest stay in the job's folder.
                var archive = await ResultFilesOf(jobId)
                    .Where(result => result.LocalZipPath != null)
                    .OrderBy(result => result.LocalZipPath)
                    .Select(result => result.LocalZipPath)
                    .FirstOrDefaultAsync(cancellationToken);

                return new WhatsAppJobFiles(
                    job.JobNumber,
                    file?.OriginalFileName ?? job.JobNumber,
                    file?.FileKind ?? "Txt",
                    file?.StoredFilePath,
                    archive,
                    job.ResultsCsvPath,
                    job.SummaryJsonPath);
            },
            null);

    // =====================================================================================
    // Campaign "Recent Activity"
    // =====================================================================================

    /// <summary>
    /// What the worker did for one campaign, shaped as history rows.
    ///
    /// THESE ROWS ARE DERIVED, NOT STORED. The audit trail records what a PERSON asked CAM to do
    /// (a list was uploaded, a broadcast was requested); what the worker then achieved - the check
    /// finished, the messages went out - is a fact of the worker's own tables. Reading it from
    /// there, rather than having the worker write into cam_audit_events, keeps one writer per
    /// table and means the activity can never disagree with the job it describes.
    ///
    /// NOTHING HERE THROWS. Recent Activity is one panel of the campaign page; if the worker's
    /// tables cannot be read, the panel shows the campaign's own history and nothing else.
    /// </summary>
    public async Task<IReadOnlyList<CampaignHistoryResponse>> GetCampaignActivityAsync(
        Guid campaignId, int maximum, CancellationToken cancellationToken)
    {
        var take = Math.Clamp(maximum, 1, MaximumCampaignActivity);

        try
        {
            return await ReadAsync<IReadOnlyList<CampaignHistoryResponse>>(
                async () =>
                {
                    var jobs = await Jobs
                        .Where(job => job.CampaignId == campaignId && FinishedJobStatuses.Contains(job.Status))
                        .OrderByDescending(job => job.CompletedAtUtc)
                        .Take(take)
                        .ToListAsync(cancellationToken);

                    var fileIds = jobs.Select(job => job.InputFileId).Distinct().ToArray();

                    var fileNames = fileIds.Length == 0
                        ? new Dictionary<Guid, string>()
                        : await Files
                            .Where(file => fileIds.Contains(file.Id))
                            .Select(file => new { file.Id, file.OriginalFileName })
                            .ToDictionaryAsync(file => file.Id, file => file.OriginalFileName, cancellationToken);

                    var broadcasts = await WatiJobs
                        .Where(job => job.CampaignId == campaignId && job.CompletedAtUtc != null)
                        .OrderByDescending(job => job.CompletedAtUtc)
                        .Take(take)
                        .ToListAsync(cancellationToken);

                    var activity = new List<CampaignHistoryResponse>(jobs.Count + broadcasts.Count);

                    foreach (var job in jobs)
                    {
                        var succeeded = job.Status is "Completed" or "CompletedWithErrors";
                        var fileName = fileNames.GetValueOrDefault(job.InputFileId, job.JobNumber);
                        var detail = succeeded
                            ? job.OutcomeMessage ?? job.ErrorMessage
                            : job.ErrorMessage ?? job.OutcomeMessage;

                        activity.Add(new CampaignHistoryResponse(
                            job.Id,
                            succeeded ? WhatsAppAuditActionCodes.CheckCompleted : WhatsAppAuditActionCodes.CheckFailed,
                            job.CreatedByUserId,
                            "Campaign",
                            campaignId,
                            succeeded ? AuditResult.Succeeded : AuditResult.Failed,
                            $"{fileName} ({job.JobNumber}): {detail ?? job.Status}",
                            job.CompletedAtUtc ?? job.UpdatedAtUtc));
                    }

                    foreach (var broadcast in broadcasts)
                    {
                        // A job where every recipient was skipped sent nothing and failed nothing;
                        // it is already explained on the check that produced it.
                        if (broadcast.AcceptedCount == 0 && broadcast.FailedCount == 0)
                        {
                            continue;
                        }

                        var sent = broadcast.AcceptedCount > 0;
                        var figures = $"{broadcast.AcceptedCount:N0} sent, {broadcast.FailedCount:N0} failed, {broadcast.SkippedCount:N0} skipped";

                        activity.Add(new CampaignHistoryResponse(
                            broadcast.Id,
                            sent ? WhatsAppAuditActionCodes.MessagesSent : WhatsAppAuditActionCodes.MessagesFailed,
                            broadcast.RequestedByUserId,
                            "Campaign",
                            campaignId,
                            sent ? AuditResult.Succeeded : AuditResult.Failed,
                            $"\"{broadcast.BroadcastName}\" · template {broadcast.TemplateName} ({broadcast.Reference}): {figures}"
                            + (sent || string.IsNullOrWhiteSpace(broadcast.ErrorMessage) ? "." : $". {broadcast.ErrorMessage}"),
                            broadcast.CompletedAtUtc ?? broadcast.CreatedAtUtc));
                    }

                    return activity
                        .OrderByDescending(entry => entry.OccurredAtUtc)
                        .Take(take)
                        .ToList();
                },
                []);
        }
        catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException or TimeoutException)
        {
            logger.LogError(
                exception,
                "Could not read the WhatsApp activity of campaign {CampaignId}. Its Recent Activity is shown without it.",
                campaignId);

            return [];
        }
    }

    // =====================================================================================
    // Shaping
    // =====================================================================================

    /// <summary>
    /// Turns job rows into what the list and the header show.
    ///
    /// THREE QUERIES FOR THE WHOLE PAGE - the jobs (already read), their files and their
    /// CheckNumber.ai tasks - rather than two more per row.
    /// </summary>
    private async Task<IReadOnlyList<CheckJobListItem>> ToListItemsAsync(
        IReadOnlyList<IntegrationJobRow> jobs, CancellationToken cancellationToken)
    {
        if (jobs.Count == 0)
        {
            return [];
        }

        var jobIds = jobs.Select(job => job.Id).ToArray();
        var fileIds = jobs.Select(job => job.InputFileId).Distinct().ToArray();

        var files = await Files
            .Where(file => fileIds.Contains(file.Id))
            .ToDictionaryAsync(file => file.Id, cancellationToken);

        var tasks = (await Tasks
                .Where(task => jobIds.Contains(task.JobId) && !task.IsSuperseded)
                .ToListAsync(cancellationToken))
            .ToLookup(task => task.JobId);

        return jobs.Select(job => ToListItem(job, files.GetValueOrDefault(job.InputFileId), tasks[job.Id].ToList())).ToList();
    }

    private static CheckJobListItem ToListItem(
        IntegrationJobRow job, InputFileRow? file, IReadOnlyList<CheckNumberTaskRow> tasks)
    {
        var finished = FinishedJobStatuses.Contains(job.Status);
        var completed = job.Status is "Completed" or "CompletedWithErrors";

        // "Processed" is what CheckNumber.ai has finished of the numbers it was sent. Until the
        // result file has been read that is the provider's own progress counter from the last
        // poll; afterwards it is the number of answers actually stored.
        var reported = tasks.Sum(task => (task.Success ?? 0) + (task.Failure ?? 0));
        var processed = job.CheckedNumbers > 0 ? job.CheckedNumbers : Math.Min(job.FreshNumbers, reported);

        var taskId = tasks
            .OrderBy(task => task.Sequence)
            .Select(task => task.ProviderTaskId)
            .FirstOrDefault(id => !string.IsNullOrWhiteSpace(id));

        return new CheckJobListItem(
            job.Id,
            job.JobNumber,
            file?.OriginalFileName ?? job.JobNumber,
            file?.FileSizeBytes ?? 0,
            (file?.FileKind ?? "txt").ToLowerInvariant(),
            file?.SheetCount ?? 0,
            job.Status,
            DisplayStatusOf(job.Status),
            job.CurrentStep,
            taskId,
            job.CreatedAtUtc,
            job.StartedAtUtc,
            job.CompletedAtUtc,
            job.TotalRows,
            Submitted: job.FreshNumbers,
            Total: job.UniqueNumbers,
            Processed: processed,
            Yes: job.WhatsAppYes,
            No: job.WhatsAppNo,
            Unknown: job.WhatsAppUnknown,
            Saved: job.ReusedNumbers,
            Duplicates: job.DuplicateNumbers,
            Invalid: job.InvalidLines,
            job.EstimatedCost,
            job.ActualCost,
            job.CostCurrency,
            Outcome: job.Status switch
            {
                "Completed" or "CompletedWithErrors" => "Success",
                "Failed" => "Failed",
                "Cancelled" => "Cancelled",
                _ => "Pending",
            },
            Reason: ReasonOf(job, tasks),
            job.ErrorCode,
            SharedToWati: completed ? job.WhatsAppYes : 0,
            job.WatiSent,
            job.WatiFailed,
            job.WatiSkipped,
            job.RunCheckNumber,
            job.RunWati,
            job.CampaignId,
            file?.CampaignName,
            job.CreatedByName ?? file?.UploadedByName,
            file?.Source ?? "FolderDrop",
            file?.UploadReference,
            HasErrors: job.Status == "CompletedWithErrors",

            // The worker's own rules (JobStatusRules): a job that did not finish cleanly can be
            // picked up where it stopped; one that has not finished can be stopped.
            CanRetry: job.Status is "Failed" or "Cancelled" or "CompletedWithErrors",
            CanCancel: !finished && !job.CancelRequested,
            job.CancelRequested);
    }

    /// <summary>The sentence under "Why it succeeded / failed / Status".</summary>
    private static string? ReasonOf(IntegrationJobRow job, IReadOnlyList<CheckNumberTaskRow> tasks)
    {
        if (FinishedJobStatuses.Contains(job.Status))
        {
            return job.Status == "Failed"
                ? job.ErrorMessage ?? job.OutcomeMessage
                : job.OutcomeMessage ?? job.ErrorMessage;
        }

        if (job.CancelRequested)
        {
            return "Stopping at the next safe point. Numbers already answered are kept.";
        }

        var stage = job.Status switch
        {
            "Queued" => "Waiting for the integration worker to start this check",
            "Parsing" => "Reading the file and extracting the numbers",
            "CheckingNumbers" => PollingReason(tasks),
            "Verifying" => "Reading the answers from CheckNumber.ai",
            "SendingWati" => "Sending the WhatsApp template through WATI",
            "GeneratingOutput" => "Writing the completed output",
            _ => job.Status,
        };

        // A temporary problem the worker is retrying by itself: say so, so a slow job is explained.
        return string.IsNullOrWhiteSpace(job.ErrorMessage) ? stage : $"{stage} · last attempt: {job.ErrorMessage}";
    }

    private static string PollingReason(IReadOnlyList<CheckNumberTaskRow> tasks)
    {
        var polls = tasks.Sum(task => task.PollCount);

        return polls > 0
            ? $"Waiting for CheckNumber.ai to return results · checked {polls} time{(polls == 1 ? string.Empty : "s")} so far"
            : "Waiting for CheckNumber.ai to return results";
    }

    private static CheckNumberTaskView ToTaskView(CheckNumberTaskRow task, CheckNumberResultFileRow? file) =>
        new(
            task.ProviderTaskId,
            task.Sequence,
            task.State,
            task.ProviderStatus,
            task.IsSuperseded,
            task.SubmittedCount,
            task.Total,
            task.Success,
            task.Failure,
            task.CachedCount,
            task.EstimatedAmount,
            task.ActualAmount,
            task.Currency,
            task.PollCount,
            task.ProviderCreatedAtUtc ?? task.CreatedAtUtc,
            task.LastPolledAtUtc,
            task.NextPollAtUtc,
            task.ExportedAtUtc,
            task.CompletedAtUtc,
            task.ErrorCode,
            task.ErrorMessage,
            file is null
                ? null
                : new CheckNumberResultFileView(
                    file.DownloadStatus,
                    file.HttpStatusCode,
                    file.FileSizeBytes,
                    file.DownloadDurationMs,
                    file.DownloadCompletedAtUtc,
                    file.ExtractionStatus,
                    file.ExtractedFileCount,
                    file.ResultSource,
                    file.MatchedCount,
                    file.RewrittenCount,
                    file.MissingCount,
                    file.DownloadError ?? file.ExtractionError));

    /// <summary>The five words the jobs screen filters by, from the worker's ten statuses.</summary>
    private static string DisplayStatusOf(string status) => status switch
    {
        "Queued" => "queued",
        "Completed" or "CompletedWithErrors" => "completed",
        "Failed" => "failed",
        "Cancelled" => "cancelled",
        _ => "running",
    };

    /// <summary>The worker statuses behind one of the screen's filter words; null for "all".</summary>
    private static string[]? StatusesFor(string? displayStatus) => displayStatus?.Trim().ToLowerInvariant() switch
    {
        "queued" => ["Queued"],
        "running" => ["Parsing", "CheckingNumbers", "Verifying", "SendingWati", "GeneratingOutput"],
        "completed" => ["Completed", "CompletedWithErrors"],
        "failed" => ["Failed"],
        "cancelled" => ["Cancelled"],
        _ => null,
    };

    private static string DefaultNote(string answer, bool saved) => (answer, saved) switch
    {
        ("yes", true) => "Answered from an earlier check - not charged",
        ("no", true) => "Answered from an earlier check - not registered on WhatsApp",
        ("yes", false) => "Active WhatsApp account",
        ("no", false) => "Not registered on WhatsApp",
        _ => "CheckNumber.ai could not verify this number",
    };
}
