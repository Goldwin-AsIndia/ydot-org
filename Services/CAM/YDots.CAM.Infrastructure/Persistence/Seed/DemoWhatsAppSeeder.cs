using System.Data.Common;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Settings;
using static YDots.CAM.Infrastructure.Persistence.Seed.DemoWhatsAppCatalogue;

namespace YDots.CAM.Infrastructure.Persistence.Seed;

/// <summary>
/// Writes the demonstration history of the WhatsApp screens into the integration worker's tables.
/// <see cref="DemoWhatsAppCatalogue"/> says what happened; this writes it the way the worker would
/// have - the same statuses, step codes, event codes and skip reasons, so the screens read a seeded
/// job exactly as they read a real one.
///
/// THE TABLES ARE THE WORKER'S, NOT CAM'S. CAM already reads them with plain SQL on its own
/// connection (see the WhatsApp integration store), and this writes them the same way: nothing
/// here is part of CAM's model, and the worker's schema is not migrated or changed. It waits until
/// the worker has created its tables; until then there is nothing to write into.
///
/// ONCE PER ORGANISATION. An Organisation that already holds its first seeded job is left alone,
/// and every id starts <c>5eed</c>, so the seeded rows are always told apart from real work.
///
/// THE WORKER'S REFERENCE SEQUENCES ARE MOVED PAST WHAT IS SEEDED. Job and broadcast numbers run per
/// day (INT-20261003-000002); a seeded number for today that the worker did not know about would be
/// the number it hands its next real job.
///
/// FILES. Where the shared data folder is configured the uploaded file, the results and the summary
/// are written into it as well, so the job's downloads work. Where it cannot be written the rows
/// are still seeded, without the summary.
/// </summary>
public sealed class DemoWhatsAppSeeder(
    CampaignDbContext context,
    IOptions<SeedSettings> seedOptions,
    IOptions<WhatsAppIntegrationSettings> whatsAppOptions,
    ILogger<DemoWhatsAppSeeder> logger)
{
    private static readonly TimeSpan IndiaOffset = TimeSpan.FromMinutes(330);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>CheckNumber.ai's price, as the worker's configuration states it.</summary>
    private const decimal PricePerNumberUsd = 0.00009m;

    private const decimal MinimumChargeUsd = 0.045m;

    private const string WorkerInstance = "docker-1";

    private const string Lowercase = "abcdefghijklmnopqrstuvwxyz0123456789";

    private const string Uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private const string Hex = "0123456789abcdef";

    /// <summary>Lines the worker refuses, with the reason it gives - the same sentences it writes.</summary>
    private static readonly (string Raw, string Reason)[] InvalidLines =
    [
        ("022 2654 1234", "Indian mobile numbers start with 6, 7, 8 or 9"),
        ("98450 123", "Too short (8 digits) and no country code"),
        ("+91 98450 12345 6", "Indian number needs 10 digits after +91 (found 11)"),
        ("080-41237650", "Indian mobile numbers start with 6, 7, 8 or 9"),
        ("12345", "Too short (5 digits) and no country code"),
        ("044 2815 3307", "Indian mobile numbers start with 6, 7, 8 or 9")
    ];

    private static readonly string[] Replies =
    [
        "Thank you - I will give this week.",
        "Please send me the 80G receipt details.",
        "Happy to help. Is there a monthly option?",
        "Can I give by UPI?",
        "Lovely to hear about the children. Count me in.",
        "Please call me after 6 pm."
    ];

    public async Task<DemoSeedOutcome> SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!seedOptions.Value.CreateSampleData || !whatsAppOptions.Value.Enabled)
        {
            return DemoSeedOutcome.Disabled;
        }

        if (!await WorkerTablesExistAsync(cancellationToken))
        {
            return DemoSeedOutcome.Waiting;
        }

        var waiting = false;

        foreach (var organisation in Organisations)
        {
            waiting |= !await SeedOrganisationAsync(organisation, cancellationToken);
        }

        return waiting ? DemoSeedOutcome.Waiting : DemoSeedOutcome.Completed;
    }

    // =============================================================================================
    // One Organisation
    // =============================================================================================

    /// <summary>False means "not yet": the Organisation, its administrator or its campaigns are not there.</summary>
    private async Task<bool> SeedOrganisationAsync(DemoOrganisation organisation, CancellationToken cancellationToken)
    {
        var subdomain = organisation.Subdomain;

        if (await ScalarAsync("SELECT 1 FROM int_integration_jobs WHERE id = @value",
                JobId(subdomain, organisation.Jobs[0].FileName), cancellationToken) is not null)
        {
            return true;
        }

        var tenant = await ReadTenantAsync(subdomain, cancellationToken);
        var administrator = tenant is null
            ? null
            : await ReadPersonAsync(tenant.Id, organisation.Administrator, cancellationToken);

        var campaignNames = DemoCampaignCatalogue.Organisations
            .Single(item => item.Subdomain == subdomain)
            .Campaigns
            .ToDictionary(campaign => campaign.Code, campaign => campaign.Name, StringComparer.OrdinalIgnoreCase);

        var campaignIds = campaignNames.Keys.ToDictionary(
            code => code, code => DemoIds.Of("campaign", subdomain, code), StringComparer.OrdinalIgnoreCase);

        var idList = campaignIds.Values.ToList();
        var campaignsWritten = await context.Campaigns
            .IgnoreQueryFilters()
            .AnyAsync(campaign => idList.Contains(campaign.Id), cancellationToken);

        if (tenant is null || administrator is null || !campaignsWritten)
        {
            return false;
        }

        var now = DateTimeOffset.UtcNow;
        var batch = new Batch(organisation, tenant, administrator, now, campaignIds, campaignNames,
            await ReadSequencesAsync(cancellationToken), ResolveDataRoot());

        // IN THE ORDER IT HAPPENED, jobs and broadcasts together: a broadcast can only reach numbers
        // checked before it, a later job skips numbers messaged earlier, and the day's references are
        // handed out in sequence.
        var timeline = organisation.Jobs
            .Select((job, index) => (At: Resolve(job.At, now), Index: index, Job: job, Broadcast: (DemoBroadcast?)null))
            .Concat(organisation.Broadcasts
                .Select((broadcast, index) => (At: Resolve(broadcast.At, now), Index: index, Job: (DemoCheckJob?)null, Broadcast: (DemoBroadcast?)broadcast)))
            .OrderBy(item => item.At)
            .ToList();

        foreach (var item in timeline)
        {
            if (item.Job is not null)
            {
                AddJob(batch, item.Job, item.Index + 1, item.At);
            }
            else
            {
                AddBroadcast(batch, item.Broadcast!, item.Index, item.At);
            }
        }

        await WriteAsync(batch, cancellationToken);

        logger.LogInformation(
            "Seeded the demonstration WhatsApp history for {Subdomain}: {JobCount} check job(s), "
            + "{BroadcastCount} broadcast(s), {NumberCount} number(s) and {MessageCount} message(s).",
            subdomain, organisation.Jobs.Count, organisation.Broadcasts.Count, batch.Phones.Count, batch.MessageCount);

        return true;
    }

    // =============================================================================================
    // A check job
    // =============================================================================================

    private void AddJob(Batch batch, DemoCheckJob job, int position, DateTimeOffset at)
    {
        var subdomain = batch.Organisation.Subdomain;
        var jobId = JobId(subdomain, job.FileName);
        var fileId = DemoIds.Of("whatsapp-file", subdomain, job.FileName);
        var period = at.UtcDateTime.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        var jobNumber = batch.NextReference("INT", period);
        var kind = Path.GetExtension(job.FileName).ToLowerInvariant() switch
        {
            ".csv" => "Csv",
            ".xlsx" => "Xlsx",
            _ => "Txt"
        };
        var sheet = kind == "Csv" ? "CSV file" : "Text file";
        var firstLine = kind == "Csv" ? 2 : 1;
        var completed = job.Outcome is JobOutcome.Completed or JobOutcome.CompletedWithErrors;
        var campaignId = job.Campaign is null ? (Guid?)null : batch.CampaignIds[job.Campaign];
        var events = new List<(DateTimeOffset At, string Step, string Level, string Code, string Message, object? Data, Guid? WatiJobId)>();

        // ---- The numbers in the file -----------------------------------------------------------
        var unique = new List<Phone>();
        var reusedCount = 0;

        if (completed)
        {
            var reusedYes = Math.Min(job.Yes, job.Reused);
            var reusedNo = Math.Min(job.No, job.Reused - reusedYes);

            var reused = batch.Pool.Where(phone => phone.Status == "Yes" && phone.CheckedAt < at).Take(reusedYes)
                .Concat(batch.Pool.Where(phone => phone.Status == "No" && phone.CheckedAt < at).Take(reusedNo))
                .ToList();

            reusedCount = reused.Count;
            var freshYes = job.Yes - reused.Count(phone => phone.Status == "Yes");
            var freshNo = job.No - reused.Count(phone => phone.Status == "No");

            // Mixed the same way every time the data is seeded, so the file reads like a real list.
            var statuses = Enumerable.Repeat("Yes", freshYes)
                .Concat(Enumerable.Repeat("No", freshNo))
                .Concat(Enumerable.Repeat("Unknown", job.Unknown))
                .Select((status, index) => (status, key: StableHash($"{subdomain}|{job.FileName}|{index}|{status}")))
                .OrderBy(item => item.key)
                .Select(item => item.status)
                .ToList();

            var newNumbers = statuses.Select((status, index) => batch.NewPhone(position, index + 1, status, at)).ToList();

            unique = [.. reused.Concat(newNumbers)
                .Select((phone, index) => (phone, key: StableHash($"{job.FileName}|order|{phone.E164}")))
                .OrderBy(item => item.key)
                .Select(item => item.phone)];
        }

        var lines = new List<Line>();
        var lineNumber = firstLine;

        foreach (var (phone, index) in unique.Select((phone, index) => (phone, index)))
        {
            var isReused = phone.CheckedAt < at;
            lines.Add(new Line(lineNumber++, RawOf(phone, index), isReused ? "AlreadyChecked" : "Fresh", phone, null));

            // A duplicate line now and then, a few rows after the first.
            if (index % 5 == 2 && lines.Count(line => line.Classification == "Duplicate") < job.Duplicates)
            {
                lines.Add(new Line(lineNumber++, RawOf(phone, index + 1), "Duplicate", phone, null));
            }
        }

        while (lines.Count(line => line.Classification == "Duplicate") < job.Duplicates && unique.Count > 0)
        {
            var phone = unique[lines.Count % unique.Count];
            lines.Add(new Line(lineNumber++, RawOf(phone, 7), "Duplicate", phone, null));
        }

        for (var invalid = 0; invalid < job.Invalid; invalid++)
        {
            var (raw, reason) = InvalidLines[(position + invalid) % InvalidLines.Length];
            lines.Add(new Line(lineNumber++, raw, "Invalid", null, reason));
        }

        // ---- The file ------------------------------------------------------------------------------
        var content = FileContent(job, kind, lines, position, batch.Organisation.NumberSeries);
        var sha = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
        var storedPath = $"files/{at:yyyy}/{at:MM}/{fileId}/{job.FileName}";
        var receivedAt = at.AddSeconds(-6);
        var uploadReference = $"UPL-{at.ToOffset(IndiaOffset):yyyyMMdd}-{Token(Uppercase, 6, subdomain, job.FileName, "upload")}";
        var fileWritten = batch.WriteFile(storedPath, content, logger);

        batch.Add("int_input_files",
            ("id", fileId),
            ("tenant_id", batch.Tenant.Id),
            ("tenant_code", subdomain),
            ("tenant_name", batch.Tenant.Name),
            ("upload_reference", uploadReference),
            ("source", "WebUpload"),
            ("status", "Registered"),
            ("original_file_name", job.FileName),
            ("file_kind", kind),
            ("file_size_bytes", (long)content.Length),
            ("content_sha256", sha),
            ("dedupe_key", $"{batch.Tenant.Id:N}:{sha}:none"),
            ("duplicate_of_input_file_id", null),
            ("stored_file_path", storedPath),
            ("manifest_json", JsonSerializer.Serialize(new
            {
                wati = job.SendWati ? new { templateName = AutomaticTemplate, broadcastName = AutomaticTemplate } : null,
                sha256 = sha,
                options = new { runWati = job.SendWati, forceRecheck = false, allowDuplicateFile = false },
                tenantId = batch.Tenant.Id,
                campaignId,
                fileName = job.FileName,
                uploadReference,
                uploadedBy = batch.Administrator.Name
            }, Json)),
            ("campaign_id", campaignId),
            ("campaign_code", job.Campaign),
            ("campaign_name", job.Campaign is null ? null : batch.CampaignNames[job.Campaign]),
            ("uploaded_by_user_id", batch.Administrator.Id),
            ("uploaded_by_name", batch.Administrator.Name),
            ("sheet_count", 1),
            ("rejection_reason", null),
            ("received_at_utc", receivedAt),
            ("registered_at_utc", at.AddSeconds(-2)));

        events.Add((receivedAt.AddSeconds(1), "REGISTER_FILE", "Information", "FILE_DETECTED",
            $"Detected {uploadReference}{Path.GetExtension(job.FileName)} ({content.Length:N0} bytes) in the inbox; claimed by {WorkerInstance}.",
            new { source = "WebUpload" }, null));
        events.Add((at.AddSeconds(-2), "REGISTER_FILE", "Information", "FILE_REGISTERED",
            $"Registered {job.FileName} ({content.Length:N0} bytes, WebUpload) for {batch.Tenant.Name} as job {jobNumber}.",
            new { runWati = job.SendWati, forceRecheck = false, contentSha256 = sha }, null));
        events.Add((at, "REGISTER_FILE", "Information", "JOB_CREATED",
            $"Job {jobNumber} queued (CheckNumber.ai on, WATI {(job.SendWati ? "on" : "off")}).", null, null));

        // ---- What the worker did with it -------------------------------------------------------------
        var clock = at.AddSeconds(3);
        var steps = new List<(string Code, string Status, int Attempt, DateTimeOffset Started, long Duration, string Message, string? ErrorCode, string? Error, object? Details)>();
        var fresh = unique.Where(phone => phone.CheckedAt >= at).ToList();
        var yes = unique.Count(phone => phone.Status == "Yes");
        var no = unique.Count(phone => phone.Status == "No");
        var unknown = unique.Count(phone => phone.Status == "Unknown");
        var duplicates = lines.Count(line => line.Classification == "Duplicate");
        var invalidLines = lines.Count(line => line.Classification == "Invalid");
        Guid? taskId = null;
        string? providerTaskId = null;
        decimal? cost = null;
        string status = job.Outcome.ToString();
        string currentStep = "GENERATE_OUTPUT";
        string? errorCode = null;
        string? errorMessage = null;
        WatiOutcome? wati = null;

        void Step(string code, string stepStatus, long milliseconds, string message,
            string? stepErrorCode = null, string? stepError = null, object? details = null, int attempt = 1)
        {
            steps.Add((code, stepStatus, attempt, clock, milliseconds, message, stepErrorCode, stepError, details));
            clock = clock.AddMilliseconds(milliseconds + 150);
        }

        void Event(string step, string level, string code, string message, object? data = null, Guid? watiJobId = null) =>
            events.Add((clock, step, level, code, message, data, watiJobId));

        switch (job.Outcome)
        {
            case JobOutcome.Cancelled:
                clock = at.AddMinutes(2);
                status = "Cancelled";
                currentStep = "PARSE_FILE";
                errorCode = "CANCELLED_BY_USER";
                errorMessage = $"Cancelled by {batch.Administrator.Name} while the job was still queued; no number was read or checked.";
                Event("COMPLETE_JOB", "Warning", "JOB_CANCELLED", $"Job {jobNumber} cancelled by {batch.Administrator.Name}.");
                break;

            case JobOutcome.Failed when job.Failure == JobFailure.FileUnreadable:
                status = "Failed";
                currentStep = "PARSE_FILE";
                errorCode = "FILE_UNREADABLE";
                errorMessage = $"{job.FileName} could not be opened as an Excel workbook. Save it again as .xlsx or .csv and upload it again.";
                Step("PARSE_FILE", "Failed", 410, "The file could not be read.", errorCode, errorMessage);
                Event("PARSE_FILE", "Error", "JOB_FAILED", $"Job {jobNumber} failed: {errorMessage}", new { errorCode });
                break;

            case JobOutcome.Failed:
                status = "Failed";
                currentStep = "PARSE_FILE";
                errorCode = "NO_VALID_NUMBERS";
                errorMessage = $"None of the {invalidLines} line(s) held a mobile number that could be checked, so nothing was sent to CheckNumber.ai.";
                Step("PARSE_FILE", "Failed", 640,
                    $"{lines.Count} row(s) read from 1 sheet(s): 0 distinct number(s), {invalidLines} invalid line(s).",
                    errorCode, errorMessage, new { totalRows = lines.Count, invalidLines, numbersFound = 0 });
                Event("PARSE_FILE", "Error", "JOB_FAILED", $"Job {jobNumber} failed: {errorMessage}", new { errorCode });
                break;

            default:
            {
                var parseMessage = $"{lines.Count} row(s) read from 1 sheet(s): {unique.Count} distinct number(s), "
                                   + $"{fresh.Count} to check, {reusedCount} answered from earlier checks, "
                                   + $"{duplicates} duplicate(s), {invalidLines} invalid line(s).";

                Step("PARSE_FILE", "Succeeded", 900 + (lines.Count * 3), parseMessage, details: new
                {
                    fresh = fresh.Count,
                    reused = reusedCount,
                    sheets = new[] { new { name = sheet, rows = lines.Count, found = lines.Count - invalidLines, unique = unique.Count, invalid = invalidLines, duplicates } },
                    totalRows = lines.Count,
                    invalidLines,
                    numbersFound = lines.Count - invalidLines,
                    uniqueNumbers = unique.Count,
                    duplicateNumbers = duplicates
                });
                Event("PARSE_FILE", "Information", "PARSE_COMPLETED", parseMessage);

                if (reusedCount > 0)
                {
                    Event("PARSE_FILE", "Information", "NUMBERS_REUSED",
                        $"{reusedCount} number(s) answered from earlier checks; they are not sent to CheckNumber.ai and not charged.");
                }

                if (fresh.Count > 0)
                {
                    taskId = DemoIds.Of("whatsapp-task", batch.Organisation.Subdomain, job.FileName);
                    providerTaskId = Token(Lowercase, 20, batch.Organisation.Subdomain, job.FileName, "task");
                    cost = Math.Max(MinimumChargeUsd, decimal.Round(fresh.Count * PricePerNumberUsd, 6));

                    var created = clock;
                    Step("CHECKNUMBER_CREATE_TASK", "Succeeded", 2_400,
                        $"Created CheckNumber.ai task {providerTaskId} for {fresh.Count} number(s), status pending, estimated cost {cost:0.000000} USD.",
                        details: new { total = fresh.Count, taskId = providerTaskId, currency = "USD", submitted = fresh.Count, estimatedAmount = cost });
                    Event("CHECKNUMBER_CREATE_TASK", "Information", "TASK_CREATED",
                        $"Created CheckNumber.ai task {providerTaskId} for {fresh.Count} number(s), status pending, estimated cost {cost:0.000000} USD.",
                        new { taskId = providerTaskId, sequence = 1 });

                    clock = clock.AddSeconds(62);
                    var exported = clock;
                    Event("CHECKNUMBER_POLL", "Information", "TASK_EXPORTED",
                        $"CheckNumber.ai task {providerTaskId} is exported: {fresh.Count} checked, 0 failed, cost {cost:0.000000} USD.",
                        new { polls = 2, total = fresh.Count, taskId = providerTaskId, failure = 0, success = fresh.Count });

                    var zipBytes = 1_200 + (fresh.Count * 36);
                    Step("CHECKNUMBER_DOWNLOAD", "Succeeded", 480,
                        $"Downloaded the result of task {providerTaskId}: {zipBytes:N0} bytes (HTTP 200).",
                        details: new { sizeBytes = zipBytes, httpStatusCode = 200 });
                    Event("CHECKNUMBER_DOWNLOAD", "Information", "RESULT_DOWNLOADED",
                        $"Downloaded the result of task {providerTaskId}: {zipBytes:N0} bytes (HTTP 200).");
                    Step("CHECKNUMBER_EXTRACT", "Succeeded", 190,
                        $"Extracted 4 file(s) from the result of task {providerTaskId}: activated.txt, unregistered.txt, all.csv, result.xlsx.");
                    Event("CHECKNUMBER_EXTRACT", "Information", "RESULT_EXTRACTED",
                        $"Extracted 4 file(s) from the result of task {providerTaskId}.");

                    var freshYes = fresh.Count(phone => phone.Status == "Yes");
                    var freshNo = fresh.Count(phone => phone.Status == "No");
                    var freshUnknown = fresh.Count(phone => phone.Status == "Unknown");
                    var processed = $"Task {providerTaskId}: {freshYes} on WhatsApp, {freshNo} not on WhatsApp, {freshUnknown} unverified "
                                    + $"({fresh.Count - freshUnknown} row(s) read from all.csv, 0 rewritten, {freshUnknown} missing, 0 unmatched).";
                    Step("CHECKNUMBER_PROCESS_RESULTS", "Succeeded", 700 + (fresh.Count * 4), processed,
                        details: new { no = freshNo, yes = freshYes, source = "all.csv", missing = freshUnknown, unknown = freshUnknown, rewritten = 0, unmatchedRows = 0 });
                    Event("CHECKNUMBER_PROCESS_RESULTS", "Information", "RESULTS_PROCESSED", processed);

                    batch.AddTask(taskId.Value, providerTaskId, jobId, fresh, cost.Value, created, exported, clock, zipBytes);
                }
                else
                {
                    const string skipped = "Every number was answered from an earlier check; nothing was sent to CheckNumber.ai.";

                    foreach (var code in new[] { "CHECKNUMBER_CREATE_TASK", "CHECKNUMBER_DOWNLOAD", "CHECKNUMBER_EXTRACT", "CHECKNUMBER_PROCESS_RESULTS" })
                    {
                        Step(code, "Skipped", 0, skipped);
                    }

                    Event("CHECKNUMBER_CREATE_TASK", "Information", "CHECKNUMBER_SKIPPED", skipped);
                }

                var identified = $"{yes} number(s) on WhatsApp, {no} not on WhatsApp, {unknown} unverified.";
                Step("IDENTIFY_VERIFIED", "Succeeded", 1_100, identified, details: new { no, yes, unknown });
                Event("IDENTIFY_VERIFIED", "Information", "VERIFIED_NUMBERS_IDENTIFIED", identified, new { no, yes, unknown });

                if (job.SendWati)
                {
                    wati = AddAutomaticWati(batch, job, jobId, jobNumber, period, taskId, providerTaskId, campaignId, unique, clock);
                    Step("WATI_PREPARE", "Succeeded", 2_900,
                        $"WATI job {wati.Reference}: {wati.Queued} to send, {wati.Skipped} skipped.",
                        details: new { reference = wati.Reference, queuedCount = wati.Queued, skippedCount = wati.Skipped, templateName = AutomaticTemplate, broadcastName = AutomaticTemplate });
                    Event("WATI_PREPARE", "Information", "WATI_JOB_CREATED",
                        $"WATI job {wati.Reference} created: template {AutomaticTemplate}, broadcast {AutomaticTemplate}, {wati.Queued} to send, {wati.Skipped} skipped.",
                        new { reference = wati.Reference, notInPool = 0 }, wati.Id);

                    if (wati.Queued > 0)
                    {
                        clock = clock.AddSeconds(4);
                        Event("WATI_SEND_BATCH", wati.Failed > 0 ? "Warning" : "Information", "WATI_BATCH_SENT",
                            $"{jobNumber}: WATI batch 1 of {wati.Reference} ({AutomaticTemplate}) - {wati.Accepted} accepted, {wati.Failed} rejected (HTTP 200).",
                            new { batchNumber = 1, acceptedCount = wati.Accepted, rejectedCount = wati.Failed, httpStatusCode = 200 }, wati.Id);
                    }

                    Event("WATI_SEND_BATCH", "Information", "WATI_JOB_COMPLETED",
                        $"{jobNumber}: WATI job {wati.Reference} {wati.Status} - {wati.Accepted} accepted, {wati.Failed} failed, {wati.Skipped} skipped.",
                        null, wati.Id);
                }
                else
                {
                    Step("WATI_PREPARE", "Skipped", 0, "WhatsApp messages were not requested for this file.");
                }

                // Partly failed sending is what "Completed with errors" means for a check job.
                status = wati is { Failed: > 0 } ? "CompletedWithErrors" : "Completed";

                var outputFolder = $"output/{jobNumber}";
                var outputWritten = batch.WriteFile($"{outputFolder}/whatsapp-results.csv", ResultsCsv(unique), logger)
                                    & batch.WriteFile($"{outputFolder}/summary.json", Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
                                    {
                                        jobNumber,
                                        fileName = job.FileName,
                                        organisation = batch.Tenant.Name,
                                        campaign = job.Campaign,
                                        totalRows = lines.Count,
                                        uniqueNumbers = unique.Count,
                                        fresh = fresh.Count,
                                        reused = reusedCount,
                                        duplicates,
                                        invalidLines,
                                        whatsAppYes = yes,
                                        whatsAppNo = no,
                                        whatsAppUnknown = unknown,
                                        wati = wati is null ? null : new { wati.Reference, wati.Accepted, wati.Failed, wati.Skipped },
                                        cost,
                                        currency = "USD"
                                    }, Json)), logger);

                Step("GENERATE_OUTPUT", "Succeeded", 560, outputWritten
                        ? $"Output written to {outputFolder}."
                        : "Results recorded; no output files were written.",
                    details: outputWritten ? new { resultsCsvPath = $"{outputFolder}/whatsapp-results.csv", summaryJsonPath = $"{outputFolder}/summary.json" } : null);
                Event("GENERATE_OUTPUT", "Information", "OUTPUT_WRITTEN",
                    outputWritten ? $"Completed output written: {outputFolder}/whatsapp-results.csv, {outputFolder}/summary.json." : "Completed output recorded.");

                var outcome = $"{(fresh.Count > 0 ? $"{fresh.Count} numbers processed by CheckNumber.ai" : "No numbers sent to CheckNumber.ai")}"
                              + (reusedCount > 0 ? $" · {reusedCount} answered from earlier checks" : string.Empty)
                              + $" · {yes} on WhatsApp · {unknown} could not be verified"
                              + (wati is null
                                  ? string.Empty
                                  : $" · {wati.Accepted} WhatsApp message{(wati.Accepted == 1 ? string.Empty : "s")} sent, {wati.Skipped} skipped"
                                    + (wati.Failed > 0 ? $", {wati.Failed} failed" : string.Empty));

                Event("COMPLETE_JOB", "Information", "JOB_COMPLETED", $"Job {jobNumber} completed: {outcome}");

                batch.Jobs[jobId] = (outcome, outputWritten ? outputFolder : null);
                break;
            }
        }

        var finishedAt = clock;
        var (outcomeMessage, folder) = batch.Jobs.GetValueOrDefault(jobId);

        batch.Add("int_integration_jobs",
            ("id", jobId),
            ("job_number", jobNumber),
            ("tenant_id", batch.Tenant.Id),
            ("input_file_id", fileId),
            ("campaign_id", campaignId),
            ("status", status),
            ("current_step", currentStep),
            ("run_checknumber", true),
            ("run_wati", job.SendWati),
            ("force_recheck", false),
            ("wati_template_name", job.SendWati ? AutomaticTemplate : null),
            ("wati_broadcast_name", job.SendWati ? AutomaticTemplate : null),
            ("wati_parameters_json", null),
            ("total_rows", job.Outcome == JobOutcome.Cancelled ? 0 : lines.Count),
            ("numbers_found", lines.Count - invalidLines),
            ("unique_numbers", unique.Count),
            ("fresh_numbers", fresh.Count),
            ("reused_numbers", reusedCount),
            ("duplicate_numbers", duplicates),
            ("invalid_lines", invalidLines),
            ("checked_numbers", fresh.Count),
            ("whatsapp_yes", yes),
            ("whatsapp_no", no),
            ("whatsapp_unknown", unknown),
            ("wati_eligible", wati?.Queued ?? 0),
            ("wati_sent", wati?.Accepted ?? 0),
            ("wati_failed", wati?.Failed ?? 0),
            ("wati_skipped", wati?.Skipped ?? 0),
            ("estimated_cost", cost),
            ("actual_cost", cost),
            ("cost_currency", cost is null ? null : "USD"),
            ("outcome_message", outcomeMessage ?? errorMessage),
            ("error_code", errorCode),
            ("error_message", errorMessage),
            ("processing_attempts", 1),
            ("consecutive_failures", job.Outcome == JobOutcome.Failed ? 1 : 0),
            ("locked_by", null),
            ("locked_until_utc", null),
            ("next_attempt_at_utc", null),
            ("cancel_requested", job.Outcome == JobOutcome.Cancelled),
            ("created_by_user_id", batch.Administrator.Id),
            ("created_by_name", batch.Administrator.Name),
            ("created_at_utc", at),
            ("started_at_utc", job.Outcome == JobOutcome.Cancelled ? null : at.AddSeconds(3)),
            ("completed_at_utc", finishedAt),
            ("updated_at_utc", finishedAt),
            ("working_directory", folder),
            ("results_csv_path", folder is null ? null : $"{folder}/whatsapp-results.csv"),
            ("summary_json_path", folder is null ? null : $"{folder}/summary.json"));

        // ---- The lines, as read --------------------------------------------------------------------
        if (job.Outcome != JobOutcome.Cancelled)
        {
            var firstLineOf = new Dictionary<string, Guid>();

            foreach (var (line, index) in lines.Select((line, index) => (line, index)))
            {
                var lineId = DemoIds.Of("whatsapp-line", batch.Organisation.Subdomain, $"{job.FileName}|{line.Number}");
                var phone = line.Phone;
                var isFresh = line.Classification == "Fresh";
                var isReused = line.Classification == "AlreadyChecked";

                if (phone is not null && line.Classification != "Duplicate")
                {
                    firstLineOf[phone.E164] = lineId;
                }

                batch.Add("int_input_file_numbers",
                    ("id", lineId),
                    ("tenant_id", batch.Tenant.Id),
                    ("input_file_id", fileId),
                    ("job_id", jobId),
                    ("sequence", index + 1),
                    ("sheet_name", sheet),
                    ("line_number", line.Number),
                    ("raw_value", line.Raw),
                    ("normalized_number", phone?.E164),
                    ("phone_number_id", phone?.Id),
                    ("country_code", phone is null ? null : "91"),
                    ("country_iso", phone is null ? null : "IN"),
                    ("country_name", phone is null ? null : "India"),
                    ("classification", line.Classification),
                    ("duplicate_of_id", line.Classification == "Duplicate" && phone is not null ? firstLineOf.GetValueOrDefault(phone.E164) : null),
                    ("invalid_reason", line.InvalidReason),
                    ("reused_whatsapp_status", isReused ? phone!.Status : null),
                    ("reused_checked_at_utc", isReused ? phone!.CheckedAt : null),
                    ("reused_from_result_id", isReused ? phone!.ResultId : null),
                    ("checknumber_task_id", isFresh ? taskId : null),
                    ("final_whatsapp_status", phone?.Status),
                    ("check_result_id", isFresh ? phone!.ResultId : null),
                    ("result_note", phone is null
                        ? null
                        : isReused
                            ? $"Answered from the check of {phone.CheckedAt.ToOffset(IndiaOffset):d MMM yyyy} - not charged"
                            : NoteOf(phone.Status)),
                    ("created_at_utc", at.AddSeconds(4)));
            }
        }

        foreach (var step in steps)
        {
            batch.Add("int_job_steps",
                ("id", DemoIds.Of("whatsapp-step", batch.Organisation.Subdomain, $"{job.FileName}|{step.Code}")),
                ("job_id", jobId),
                ("step_code", step.Code),
                ("status", step.Status),
                ("attempt", step.Attempt),
                ("started_at_utc", step.Started),
                ("completed_at_utc", step.Started.AddMilliseconds(step.Duration)),
                ("duration_ms", step.Duration),
                ("message", step.Message),
                ("error_code", step.ErrorCode),
                ("error_message", step.Error),
                ("details_json", step.Details is null ? null : JsonSerializer.Serialize(step.Details, Json)),
                ("worker_instance", WorkerInstance));
        }

        foreach (var (entry, index) in events.Select((entry, index) => (entry, index)))
        {
            batch.Add("int_job_events",
                ("id", DemoIds.Of("whatsapp-event", batch.Organisation.Subdomain, $"{job.FileName}|{index}")),
                ("tenant_id", batch.Tenant.Id),
                ("input_file_id", fileId),
                ("job_id", jobId),
                ("wati_job_id", entry.WatiJobId),
                ("step_code", entry.Step),
                ("level", entry.Level),
                ("event_code", entry.Code),
                ("message", entry.Message),
                ("data_json", entry.Data is null ? null : JsonSerializer.Serialize(entry.Data, Json)),
                ("worker_instance", WorkerInstance),
                ("occurred_at_utc", entry.At));
        }

        if (!fileWritten)
        {
            logger.LogDebug("The original of {File} was not written; its Original download will not be available.", job.FileName);
        }
    }

    /// <summary>
    /// The WATI job a check started on its own: every number in the file is a recipient, and only
    /// the ones on WhatsApp - and not already messaged - are sent anything.
    /// </summary>
    private WatiOutcome AddAutomaticWati(
        Batch batch, DemoCheckJob job, Guid jobId, string jobNumber, string period, Guid? taskId,
        string? providerTaskId, Guid? campaignId, IReadOnlyList<Phone> recipients, DateTimeOffset at)
    {
        var subdomain = batch.Organisation.Subdomain;
        var id = DemoIds.Of("whatsapp-wati-job", subdomain, job.FileName);
        var reference = batch.NextReference("WAT", period);
        var pattern = (batch.Now - at).TotalDays >= 2 ? "RDRYDRRD" : "DSRPDS";
        var plans = new List<(Phone Phone, char Letter, string? SkipReason)>();
        var eligible = recipients.Where(phone => phone.Status == "Yes" && phone.MessagedAt is null).ToList();
        var failing = eligible.TakeLast(job.WatiFailed).ToHashSet();
        var sent = 0;

        foreach (var phone in recipients)
        {
            var plan = phone.Status switch
            {
                "No" => (phone, 'K', (string?)"WHATSAPP_NOT_AVAILABLE"),
                "Unknown" => (phone, 'K', "WHATSAPP_UNVERIFIED"),
                _ when phone.MessagedAt is not null => (phone, 'A', "ALREADY_SENT"),
                _ when failing.Contains(phone) => (phone, 'X', null),
                _ => (phone, pattern[sent++ % pattern.Length], null)
            };

            plans.Add(plan);
        }

        return AddWatiJob(batch, id, reference, "Automatic", jobId, taskId, providerTaskId, campaignId,
            AutomaticTemplate, AutomaticTemplate, at, plans, cancelled: false, templateMissing: false);
    }

    // =============================================================================================
    // A broadcast from the WhatsApp Messages screen
    // =============================================================================================

    private void AddBroadcast(Batch batch, DemoBroadcast broadcast, int index, DateTimeOffset at)
    {
        var subdomain = batch.Organisation.Subdomain;
        var id = DemoIds.Of("whatsapp-broadcast", subdomain, broadcast.Name);
        var period = at.UtcDateTime.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        var reference = batch.NextReference("WAT", period);

        // Recipients are numbers already found on WhatsApp: fresh ones first, rotated so that two
        // broadcasts do not always reach the same people, and a messaged one wherever the line asks
        // for an "already sent" skip.
        var verified = batch.Pool.Where(phone => phone.Status == "Yes" && phone.CheckedAt < at).ToList();
        var unmessaged = verified.Where(phone => phone.MessagedAt is null || phone.MessagedAt > at).ToList();
        var messaged = verified.Where(phone => phone.MessagedAt is not null && phone.MessagedAt < at).ToList();
        var rotation = unmessaged.Count == 0 ? 0 : (index * 5) % unmessaged.Count;
        var queue = new Queue<Phone>(unmessaged.Skip(rotation).Concat(unmessaged.Take(rotation)));
        var plans = new List<(Phone Phone, char Letter, string? SkipReason)>();
        var used = new HashSet<string>();

        foreach (var letter in broadcast.Messages)
        {
            Phone? phone;

            if (letter == 'A')
            {
                phone = messaged.FirstOrDefault(candidate => used.Add(candidate.E164));
            }
            else
            {
                phone = null;

                while (queue.Count > 0 && phone is null)
                {
                    var candidate = queue.Dequeue();
                    phone = used.Add(candidate.E164) ? candidate : null;
                }
            }

            if (phone is null)
            {
                continue;
            }

            plans.Add((phone, letter, letter switch
            {
                'A' => "ALREADY_SENT",
                'C' => "CANCELLED",
                _ => null
            }));
        }

        AddWatiJob(batch, id, reference, "Manual", null, null, null,
            broadcast.Campaign is null ? null : batch.CampaignIds[broadcast.Campaign],
            broadcast.Template, broadcast.Name, at, plans,
            cancelled: broadcast.Outcome == BroadcastOutcome.Cancelled,
            templateMissing: broadcast.Outcome == BroadcastOutcome.Failed);
    }

    // =============================================================================================
    // The WATI job, its batch, its messages
    // =============================================================================================

    private WatiOutcome AddWatiJob(
        Batch batch, Guid id, string reference, string source, Guid? integrationJobId, Guid? taskId,
        string? providerTaskId, Guid? campaignId, string template, string broadcastName, DateTimeOffset at,
        IReadOnlyList<(Phone Phone, char Letter, string? SkipReason)> plans, bool cancelled, bool templateMissing)
    {
        var subdomain = batch.Organisation.Subdomain;
        var parameters = JsonSerializer.Serialize(new[] { new { name = "image_url", value = TemplateImage } }, Json);
        var batchId = DemoIds.Of("whatsapp-batch", subdomain, reference);
        var started = at.AddSeconds(2);
        var finished = at.AddSeconds(4);
        var label = TemplateLabels.GetValueOrDefault(template);
        var accepted = plans.Count(plan => "PSDRYF".Contains(plan.Letter));
        var rejected = plans.Count(plan => plan.Letter == 'X');
        var failed = rejected + plans.Count(plan => plan.Letter == 'F');
        var skipped = plans.Count(plan => plan.Letter is 'A' or 'C' or 'K');
        var sentToWati = accepted + rejected;

        var status = templateMissing ? "Failed"
            : cancelled ? "Cancelled"
            : failed > 0 ? "CompletedWithErrors"
            : "Completed";

        var (errorCode, errorMessage) = status switch
        {
            "Failed" => ("WATI_TEMPLATE_MISSING",
                $"WATI has no approved template named {template}, so the broadcast was refused and nothing was sent."),
            "Cancelled" => ("CANCELLED_BY_USER",
                $"Cancelled by {batch.Administrator.Name} after the first batch; the remaining recipients were not sent anything."),
            _ => ((string?)null, (string?)null)
        };

        batch.Add("int_wati_jobs",
            ("id", id),
            ("reference", reference),
            ("tenant_id", batch.Tenant.Id),
            ("source", source),
            ("integration_job_id", integrationJobId),
            ("command_id", null),
            ("campaign_id", campaignId),
            ("status", status),
            ("template_name", template),
            ("template_label", label),
            ("broadcast_name", broadcastName),
            ("parameters_json", parameters),
            ("rendered_preview", label is null
                ? $"{template} with an image header ({TemplateImage})."
                : $"{label} with an image header ({TemplateImage}). The approved wording is kept in WATI."),
            ("channel_number", ChannelNumber),
            ("batch_size", 100),
            ("total_recipients", plans.Count),
            ("queued_count", 0),
            ("accepted_count", accepted),
            ("failed_count", failed),
            ("skipped_count", skipped),
            ("error_code", errorCode),
            ("error_message", errorMessage),
            ("requested_by_user_id", batch.Administrator.Id),
            ("requested_by_name", batch.Administrator.Name),
            ("locked_by", null),
            ("locked_until_utc", null),
            ("next_attempt_at_utc", null),
            ("processing_attempts", 1),
            ("created_at_utc", at),
            ("started_at_utc", started),
            ("completed_at_utc", finished),
            ("updated_at_utc", finished));

        if (sentToWati > 0)
        {
            batch.Add("int_wati_batches",
                ("id", batchId),
                ("tenant_id", batch.Tenant.Id),
                ("wati_job_id", id),
                ("batch_number", 1),
                ("status", templateMissing ? "Failed" : rejected > 0 ? "PartiallyAccepted" : "Sent"),
                ("recipient_count", sentToWati),
                ("accepted_count", accepted),
                ("rejected_count", rejected),
                ("attempt_count", 1),
                ("http_status_code", templateMissing ? 400 : 200),
                ("request_payload_json", JsonSerializer.Serialize(new { template_name = template, broadcast_name = broadcastName, receivers = sentToWati }, Json)),
                ("response_body", templateMissing
                    ? "{\"result\":false,\"info\":\"Template not found\"}"
                    : $"{{\"result\":true,\"error\":null,\"templateName\":\"{template}\",\"receivers\":{sentToWati}}}"),
                ("error_message", templateMissing ? errorMessage : null),
                ("created_at_utc", started),
                ("started_at_utc", started),
                ("completed_at_utc", started.AddMilliseconds(740)),
                ("duration_ms", 740L));
        }

        foreach (var (plan, position) in plans.Select((plan, position) => (plan, position)))
        {
            AddMessage(batch, id, batchId, integrationJobId, taskId, providerTaskId, campaignId, template,
                broadcastName, parameters, plan, position, started, sentToWati > 0, templateMissing);
        }

        if (source == "Manual")
        {
            var eventTime = at;

            void Event(string step, string level, string code, string message) =>
                batch.Add("int_job_events",
                    ("id", DemoIds.Of("whatsapp-event", subdomain, $"{reference}|{code}")),
                    ("tenant_id", batch.Tenant.Id),
                    ("input_file_id", null),
                    ("job_id", null),
                    ("wati_job_id", id),
                    ("step_code", step),
                    ("level", level),
                    ("event_code", code),
                    ("message", message),
                    ("data_json", null),
                    ("worker_instance", WorkerInstance),
                    ("occurred_at_utc", eventTime = eventTime.AddSeconds(1)));

            Event("WATI_PREPARE", "Information", "WATI_JOB_CREATED",
                $"WATI job {reference} created: template {template}, broadcast {broadcastName}, {sentToWati + plans.Count(plan => plan.Letter == 'C')} to send, {plans.Count(plan => plan.Letter is 'A' or 'K')} skipped.");

            if (templateMissing)
            {
                Event("WATI_SEND_BATCH", "Error", "WATI_BATCH_FAILED",
                    $"WATI batch 1 of {reference} refused (HTTP 400): {errorMessage}");
            }
            else if (sentToWati > 0)
            {
                Event("WATI_SEND_BATCH", rejected > 0 ? "Warning" : "Information", "WATI_BATCH_SENT",
                    $"WATI batch 1 of {reference} ({template}) - {accepted} accepted, {rejected} rejected (HTTP 200).");
            }

            Event("WATI_SEND_BATCH", status is "Completed" ? "Information" : "Warning", "WATI_JOB_COMPLETED",
                $"WATI job {reference} {status} - {accepted} accepted, {failed} failed, {skipped} skipped.");
        }

        return new WatiOutcome(id, reference, status, sentToWati, accepted, failed, skipped);
    }

    private void AddMessage(
        Batch batch, Guid watiJobId, Guid batchId, Guid? integrationJobId, Guid? taskId, string? providerTaskId,
        Guid? campaignId, string template, string broadcastName, string parameters,
        (Phone Phone, char Letter, string? SkipReason) plan, int position, DateTimeOffset started,
        bool batchSent, bool templateMissing)
    {
        var subdomain = batch.Organisation.Subdomain;
        var phone = plan.Phone;
        var id = DemoIds.Of("whatsapp-message", subdomain, $"{watiJobId}|{phone.E164}");
        var localId = "ydot-" + id.ToString("N");
        var isSkip = plan.Letter is 'A' or 'C' or 'K';
        var isAccepted = "PSDRYF".Contains(plan.Letter);
        var sentAt = Clamp(batch, started.AddSeconds(5 + position));
        var deliveredAt = Clamp(batch, sentAt.AddMinutes(1 + (StableHash(localId) % 25)));
        var readAt = Clamp(batch, deliveredAt.AddMinutes(8 + (StableHash(localId + "r") % 300)));
        var repliedAt = Clamp(batch, readAt.AddMinutes(2 + (StableHash(localId + "y") % 40)));
        var failedAt = Clamp(batch, sentAt.AddMinutes(3));

        var status = plan.Letter switch
        {
            'P' => "Pending",
            'S' => "Sent",
            'D' => "Delivered",
            'R' => "Read",
            'Y' => "Replied",
            'F' or 'X' => "Failed",
            _ => "Skipped"
        };

        var (failedCode, failedReason, error) = plan.Letter switch
        {
            'F' => ("131026", "Message undeliverable: the recipient's phone could not be reached.", (string?)null),
            'X' when templateMissing => ("WATI_TEMPLATE_MISSING", "WATI has no approved template with this name.",
                "WATI refused the broadcast: template not found."),
            'X' => ("WATI_INVALID_NUMBER", "WATI did not accept this number.", "WATI did not accept this number."),
            _ => ((string?)null, (string?)null, (string?)null)
        };

        batch.MessageCount++;

        if (isAccepted && phone.MessagedAt is null)
        {
            phone.MessagedAt = sentAt;
        }

        batch.Add("int_wati_messages",
            ("id", id),
            ("tenant_id", batch.Tenant.Id),
            ("wati_job_id", watiJobId),
            ("wati_batch_id", isSkip || !batchSent ? null : batchId),
            ("integration_job_id", integrationJobId),
            ("checknumber_task_id", integrationJobId is null ? null : taskId),
            ("checknumber_provider_task_id", integrationJobId is null ? null : providerTaskId),
            ("phone_number_id", phone.Id),
            ("campaign_id", campaignId),
            ("whatsapp_number", phone.Digits),
            ("whatsapp_check", phone.Status),
            ("template_name", template),
            ("broadcast_name", broadcastName),
            ("parameters_json", parameters),
            ("status", status),
            ("skip_reason", plan.SkipReason),
            ("request_status", isSkip ? "NotSent" : plan.Letter == 'X' ? "Rejected" : "Accepted"),
            ("http_status_code", isSkip ? null : templateMissing ? 400 : 200),
            ("wati_response_json", isAccepted
                ? JsonSerializer.Serialize(new { waId = phone.Digits, errors = Array.Empty<string>(), target = phone.Digits, localMessageId = localId }, Json)
                : null),
            ("is_valid_whatsapp_number", isSkip ? null : isAccepted),
            ("local_message_id", localId),
            ("wati_message_id", isAccepted ? Token(Hex, 24, subdomain, localId, "wati") : null),
            ("whatsapp_message_id", null),
            ("conversation_id", null),
            ("delivery_status_raw", plan.Letter switch
            {
                'S' => "SENT",
                'D' => "DELIVERED",
                'R' => "READ",
                'Y' => "REPLIED",
                'F' => "FAILED",
                _ => null
            }),
            ("failed_code", failedCode),
            ("failed_reason", failedReason),
            ("reply_text", plan.Letter == 'Y' ? Replies[StableHash(localId) % Replies.Length] : null),
            ("retry_count", 0),
            ("error_message", error),
            ("queued_at_utc", started.AddSeconds(-1)),
            ("started_at_utc", isSkip ? null : started),
            ("completed_at_utc", started.AddSeconds(1)),
            ("duration_ms", isSkip ? null : 740L),
            ("sent_at_utc", plan.Letter is 'S' or 'D' or 'R' or 'Y' or 'F' ? sentAt : null),
            ("delivered_at_utc", plan.Letter is 'D' or 'R' or 'Y' ? deliveredAt : null),
            ("read_at_utc", plan.Letter is 'R' or 'Y' ? readAt : null),
            ("replied_at_utc", plan.Letter == 'Y' ? repliedAt : null),
            ("failed_at_utc", plan.Letter is 'F' or 'X' ? failedAt : null),
            ("status_times_observed", plan.Letter is 'S' or 'D' or 'R' or 'Y' or 'F'),
            ("status_check_count", plan.Letter is 'S' or 'D' or 'R' or 'Y' or 'F' ? 3 : 0),
            ("last_status_check_at_utc", plan.Letter is 'S' or 'D' or 'R' or 'Y' or 'F' ? Clamp(batch, readAt.AddMinutes(5)) : null),

            // NEVER FOLLOWED UP: the worker asks WATI about a message only when this is set.
            ("next_status_check_at_utc", null),
            ("updated_at_utc", Clamp(batch, repliedAt.AddMinutes(1))));
    }

    // =============================================================================================
    // Writing
    // =============================================================================================

    /// <summary>All of one Organisation's rows in one transaction, then the reference sequences moved on.</summary>
    private async Task WriteAsync(Batch batch, CancellationToken cancellationToken)
    {
        var connection = context.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;

        if (opened)
        {
            await context.Database.OpenConnectionAsync(cancellationToken);
        }

        try
        {
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

            foreach (var phone in batch.Phones)
            {
                await ExecuteAsync(connection, transaction, "int_phone_numbers",
                [
                    ("id", phone.Id),
                    ("e164", phone.E164),
                    ("digits", phone.Digits),
                    ("country_code", "91"),
                    ("region_code", "IN"),
                    ("country_iso", "IN"),
                    ("country_name", "India"),
                    ("whatsapp_status", phone.Status),
                    ("whatsapp_checked_at_utc", phone.Status == "Unknown" ? null : phone.CheckedAt),
                    ("last_check_result_id", null),
                    ("last_checked_tenant_id", batch.Tenant.Id),
                    ("check_count", 1),
                    ("first_seen_at_utc", phone.FirstSeenAt),
                    ("updated_at_utc", phone.CheckedAt)
                ], " ON CONFLICT (e164) DO NOTHING", cancellationToken);
            }

            // Parents before children, in the order the worker's foreign keys need.
            string[] order =
            [
                "int_input_files", "int_integration_jobs", "int_checknumber_tasks", "int_checknumber_results",
                "int_checknumber_result_files", "int_input_file_numbers", "int_job_steps", "int_wati_jobs",
                "int_wati_batches", "int_wati_messages", "int_job_events"
            ];

            foreach (var table in order)
            {
                foreach (var row in batch.Rows.Where(row => row.Table == table))
                {
                    await ExecuteAsync(connection, transaction, table, row.Values, string.Empty, cancellationToken);
                }
            }

            foreach (var ((name, period), last) in batch.Sequences.Where(pair => batch.UsedSequences.Contains(pair.Key)))
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText =
                    """
                    INSERT INTO int_job_sequences (name, period, last_value, updated_at_utc)
                    VALUES (@name, @period, @last, now())
                    ON CONFLICT (name, period)
                    DO UPDATE SET last_value = GREATEST(int_job_sequences.last_value, EXCLUDED.last_value),
                                  updated_at_utc = now()
                    """;
                AddParameter(command, "name", name);
                AddParameter(command, "period", period);
                AddParameter(command, "last", (long)last);
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
        }
        finally
        {
            if (opened)
            {
                await context.Database.CloseConnectionAsync();
            }
        }
    }

    private static async Task ExecuteAsync(
        DbConnection connection, DbTransaction transaction, string table,
        IReadOnlyList<(string Column, object? Value)> values, string suffix, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;

        var names = new StringBuilder();
        var placeholders = new StringBuilder();

        for (var index = 0; index < values.Count; index++)
        {
            var (column, value) = values[index];

            if (index > 0)
            {
                names.Append(", ");
                placeholders.Append(", ");
            }

            names.Append(column);
            placeholders.Append("@p").Append(index);

            // Every *_json column of the worker's is jsonb.
            if (column.EndsWith("_json", StringComparison.Ordinal))
            {
                placeholders.Append("::jsonb");
            }

            AddParameter(command, "p" + index, value);
        }

        command.CommandText = $"INSERT INTO {table} ({names}) VALUES ({placeholders}){suffix}";
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void AddParameter(DbCommand command, string name, object? value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value ?? DBNull.Value;
        command.Parameters.Add(parameter);
    }

    // =============================================================================================
    // Small things
    // =============================================================================================

    private static Guid JobId(string subdomain, string fileName) => DemoIds.Of("whatsapp-job", subdomain, fileName);

    /// <summary>Raw values as people type them: some with +91, some spaced, some run together.</summary>
    private static string RawOf(Phone phone, int index)
    {
        var national = phone.Digits[2..];

        return (index % 3) switch
        {
            0 => national,
            1 => $"+91 {national[..5]} {national[5..]}",
            _ => $"{national[..5]} {national[5..]}"
        };
    }

    private static string NoteOf(string status) => status switch
    {
        "Yes" => "Registered on WhatsApp",
        "No" => "Not registered on WhatsApp",
        _ => "CheckNumber.ai's result had no row for this number, so it is left unverified."
    };

    private static byte[] FileContent(DemoCheckJob job, string kind, IReadOnlyList<Line> lines, int position, char series)
    {
        if (kind == "Xlsx")
        {
            // Not a workbook - which is the whole point of this file: it is the one that could not be read.
            return Encoding.ASCII.GetBytes("PK\u0003\u0004 truncated upload - the workbook was saved while still open\n");
        }

        var rows = new List<string>();

        if (kind == "Csv")
        {
            rows.Add("Mobile");
        }

        if (job.Outcome == JobOutcome.Cancelled)
        {
            // Never read: the numbers are what the file held when it was cancelled.
            for (var number = 1; number <= job.Unknown; number++)
            {
                rows.Add($"5{series}{position:00}{number:000000}");
            }
        }
        else
        {
            rows.AddRange(lines.Select(line => line.Raw.Contains(',') ? $"\"{line.Raw}\"" : line.Raw));
        }

        return Encoding.UTF8.GetBytes(string.Join("\n", rows) + "\n");
    }

    private static byte[] ResultsCsv(IReadOnlyList<Phone> phones)
    {
        var rows = new List<string> { "number,whatsapp,checked_at" };
        rows.AddRange(phones.Select(phone =>
            $"{phone.E164},{phone.Status},{phone.CheckedAt.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)}"));

        return Encoding.UTF8.GetBytes(string.Join("\n", rows) + "\n");
    }

    /// <summary>
    /// Turns "the sixth of last month at 6.20 pm" into a moment, the way PAY's seeder does. A point
    /// part-way through this month is taken from the part that has already gone, kept an hour short
    /// of now so the job's own minutes - and the messages after it - are in the past too.
    /// </summary>
    private static DateTimeOffset Resolve(DemoWhen when, DateTimeOffset now)
    {
        var local = now.ToOffset(IndiaOffset);
        var monthStart = new DateTimeOffset(local.Year, local.Month, 1, 0, 0, 0, IndiaOffset);

        if (when.InLastMonth)
        {
            return monthStart.AddMonths(-1)
                .AddDays(when.Value - 1)
                .AddHours(when.Hour)
                .AddMinutes(when.Minute)
                .ToUniversalTime();
        }

        var latest = now.AddHours(-1);
        var elapsed = latest - monthStart;

        if (elapsed <= TimeSpan.Zero)
        {
            return latest.ToUniversalTime();
        }

        var moment = monthStart + TimeSpan.FromSeconds(Math.Floor(elapsed.TotalSeconds * when.Value));

        // Office hours where that is still in the past.
        if (moment.Hour is < 9 or > 19)
        {
            var morning = new DateTimeOffset(moment.Year, moment.Month, moment.Day, 10, moment.Minute, 0, IndiaOffset);

            if (morning < latest)
            {
                moment = morning;
            }
        }

        return moment.ToUniversalTime();
    }

    private static DateTimeOffset Clamp(Batch batch, DateTimeOffset moment)
    {
        var limit = batch.Now.AddMinutes(-2);

        return moment < limit ? moment : limit;
    }

    private static string Token(string alphabet, int length, string organisation, string key, string salt)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{organisation}|{key}|{salt}"));
        var characters = new char[length];

        for (var index = 0; index < length; index++)
        {
            characters[index] = alphabet[hash[index % hash.Length] % alphabet.Length];
        }

        return new string(characters);
    }

    /// <summary>The same in every process, unlike <c>string.GetHashCode</c>.</summary>
    private static int StableHash(string value)
    {
        unchecked
        {
            var hash = 17;

            foreach (var character in value)
            {
                hash = (hash * 31) + character;
            }

            return hash & int.MaxValue;
        }
    }

    private string? ResolveDataRoot()
    {
        var root = whatsAppOptions.Value.DataRoot;

        return string.IsNullOrWhiteSpace(root) ? null : Path.GetFullPath(root);
    }

    // =============================================================================================
    // What is read from other modules' tables
    // =============================================================================================

    private async Task<bool> WorkerTablesExistAsync(CancellationToken cancellationToken) =>
        await ScalarAsync(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = @value",
            "int_job_sequences", cancellationToken) is not null;

    private async Task<TenantRow?> ReadTenantAsync(string subdomain, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT id, name FROM iam_tenants WHERE subdomain = @value AND status = 'Active' LIMIT 1",
            subdomain,
            reader => new TenantRow(reader.GetGuid(0), reader.GetString(1)),
            cancellationToken);

        return rows.FirstOrDefault();
    }

    private async Task<PersonRow?> ReadPersonAsync(Guid tenantId, string username, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT user_name, id, display_name FROM iam_users WHERE tenant_id = @value AND status = 'Active'",
            tenantId,
            reader => (Username: reader.GetString(0), Person: new PersonRow(reader.GetGuid(1), reader.GetString(2))),
            cancellationToken);

        return rows.FirstOrDefault(row => string.Equals(row.Username, username, StringComparison.OrdinalIgnoreCase)).Person;
    }

    private async Task<Dictionary<(string Name, string Period), int>> ReadSequencesAsync(CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT name, period, last_value FROM int_job_sequences WHERE last_value >= @value",
            0L,
            reader => (Name: reader.GetString(0), Period: reader.GetString(1), Last: reader.GetInt64(2)),
            cancellationToken);

        return rows.ToDictionary(row => (row.Name, row.Period), row => (int)row.Last);
    }

    private async Task<object?> ScalarAsync(string sql, object value, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(sql, value, reader => reader.GetValue(0), cancellationToken);

        return rows.FirstOrDefault();
    }

    /// <summary>One read of a table another module owns. A table that is not there yet is an empty answer.</summary>
    private async Task<List<TRow>> QueryAsync<TRow>(
        string sql, object value, Func<DbDataReader, TRow> map, CancellationToken cancellationToken)
    {
        var rows = new List<TRow>();
        var connection = context.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;

        try
        {
            if (opened)
            {
                await context.Database.OpenConnectionAsync(cancellationToken);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            AddParameter(command, "value", value);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(map(reader));
            }
        }
        catch (Exception exception) when (exception is DbException or InvalidOperationException)
        {
            logger.LogDebug(exception, "A table the demonstration WhatsApp history depends on could not be read yet.");

            return [];
        }
        finally
        {
            if (opened && connection.State == System.Data.ConnectionState.Open)
            {
                await context.Database.CloseConnectionAsync();
            }
        }

        return rows;
    }

    // =============================================================================================
    // The shapes the rows are built from
    // =============================================================================================

    private sealed record TenantRow(Guid Id, string Name);

    private sealed record PersonRow(Guid Id, string Name);

    private sealed record Line(int Number, string Raw, string Classification, Phone? Phone, string? InvalidReason);

    private sealed record WatiOutcome(
        Guid Id, string Reference, string Status, int Queued, int Accepted, int Failed, int Skipped);

    /// <summary>One number, as the worker's platform-wide number record holds it.</summary>
    private sealed class Phone(
        Guid id, string e164, string status, DateTimeOffset firstSeenAt, DateTimeOffset checkedAt, Guid resultId)
    {
        public Guid Id { get; } = id;

        public string E164 { get; } = e164;

        public string Digits => E164.TrimStart('+');

        public string Status { get; } = status;

        /// <summary>When the file that first held it was read.</summary>
        public DateTimeOffset FirstSeenAt { get; } = firstSeenAt;

        public DateTimeOffset CheckedAt { get; } = checkedAt;

        public Guid ResultId { get; } = resultId;

        /// <summary>When a message to it was first accepted by WATI.</summary>
        public DateTimeOffset? MessagedAt { get; set; }
    }

    /// <summary>Everything one Organisation's rows are built from, and the rows themselves.</summary>
    private sealed class Batch(
        DemoOrganisation organisation,
        TenantRow tenant,
        PersonRow administrator,
        DateTimeOffset now,
        IReadOnlyDictionary<string, Guid> campaignIds,
        IReadOnlyDictionary<string, string> campaignNames,
        Dictionary<(string Name, string Period), int> sequences,
        string? dataRoot)
    {
        public DemoOrganisation Organisation { get; } = organisation;

        public TenantRow Tenant { get; } = tenant;

        public PersonRow Administrator { get; } = administrator;

        public DateTimeOffset Now { get; } = now;

        public IReadOnlyDictionary<string, Guid> CampaignIds { get; } = campaignIds;

        public IReadOnlyDictionary<string, string> CampaignNames { get; } = campaignNames;

        public Dictionary<(string Name, string Period), int> Sequences { get; } = sequences;

        public HashSet<(string Name, string Period)> UsedSequences { get; } = [];

        public List<(string Table, IReadOnlyList<(string Column, object? Value)> Values)> Rows { get; } = [];

        /// <summary>Every number checked so far, oldest first - what later jobs reuse and broadcasts reach.</summary>
        public List<Phone> Pool { get; } = [];

        public List<Phone> Phones { get; } = [];

        /// <summary>Each completed job's outcome sentence and output folder.</summary>
        public Dictionary<Guid, (string? Outcome, string? Folder)> Jobs { get; } = [];

        public int MessageCount { get; set; }

        public void Add(string table, params (string Column, object? Value)[] values) => Rows.Add((table, values));

        public string NextReference(string name, string period)
        {
            var next = Sequences.GetValueOrDefault((name, period)) + 1;
            Sequences[(name, period)] = next;
            UsedSequences.Add((name, period));

            return $"{name}-{period}-{next:D6}";
        }

        /// <summary>A number seen for the first time, checked as part of the job at <paramref name="at"/>.</summary>
        public Phone NewPhone(int job, int sequence, string status, DateTimeOffset at)
        {
            var e164 = $"+915{Organisation.NumberSeries}{job:00}{sequence:000000}";
            var phone = new Phone(
                DemoIds.Of("whatsapp-number", "platform", e164),
                e164,
                status,
                at.AddSeconds(4),
                at.AddSeconds(70),
                DemoIds.Of("whatsapp-result", Organisation.Subdomain, e164));

            Phones.Add(phone);
            Pool.Add(phone);

            return phone;
        }

        public void AddTask(
            Guid taskId, string providerTaskId, Guid jobId, IReadOnlyList<Phone> fresh, decimal cost,
            DateTimeOffset created, DateTimeOffset exported, DateTimeOffset processed, int zipBytes)
        {
            Add("int_checknumber_tasks",
                ("id", taskId),
                ("tenant_id", Tenant.Id),
                ("job_id", jobId),
                ("sequence", 1),
                ("is_superseded", false),
                ("provider_task_id", providerTaskId),
                ("task_type", "ws"),
                ("state", "Processed"),
                ("provider_status", "exported"),
                ("submitted_count", fresh.Count),
                ("country_code", null),
                ("total", fresh.Count),
                ("success", fresh.Count),
                ("failure", 0),
                ("cached_count", fresh.Count / 3),
                ("estimated_amount", cost),
                ("actual_amount", cost),
                ("currency", "USD"),
                ("result_url", null),
                ("provider_message", null),
                ("submitted_numbers_path", null),
                ("poll_count", 2),
                ("last_polled_at_utc", exported),
                ("next_poll_at_utc", null),
                ("create_requested_at_utc", created),
                ("provider_created_at_utc", created.AddSeconds(2)),
                ("provider_updated_at_utc", exported),
                ("exported_at_utc", exported),
                ("completed_at_utc", processed),
                ("error_code", null),
                ("error_message", null),
                ("created_at_utc", created),
                ("updated_at_utc", processed));

            Add("int_checknumber_result_files",
                ("id", DemoIds.Of("whatsapp-result-file", Organisation.Subdomain, providerTaskId)),
                ("checknumber_task_id", taskId),
                ("job_id", jobId),
                ("provider_task_id", providerTaskId),
                ("result_url", null),
                ("download_status", "Succeeded"),
                ("download_attempts", 1),
                ("http_status_code", 200),
                ("file_size_bytes", (long)zipBytes),
                ("file_sha256", Token(Hex, 64, Organisation.Subdomain, providerTaskId, "zip")),
                ("local_zip_path", null),
                ("download_started_at_utc", exported.AddSeconds(1)),
                ("download_completed_at_utc", exported.AddSeconds(2)),
                ("download_duration_ms", 480L),
                ("download_error", null),
                ("extraction_status", "Succeeded"),
                ("extracted_path", null),
                ("extracted_file_count", 4),
                ("extracted_entries_json", null),
                ("extracted_at_utc", exported.AddSeconds(3)),
                ("extraction_error", null),
                ("result_source", "all.csv"),
                ("parsed_row_count", fresh.Count(phone => phone.Status != "Unknown")),
                ("matched_count", fresh.Count(phone => phone.Status != "Unknown")),
                ("rewritten_count", 0),
                ("missing_count", fresh.Count(phone => phone.Status == "Unknown")),
                ("unmatched_row_count", 0),
                ("created_at_utc", exported.AddSeconds(1)),
                ("updated_at_utc", exported.AddSeconds(3)));

            foreach (var phone in fresh)
            {
                Add("int_checknumber_results",
                    ("id", phone.ResultId),
                    ("tenant_id", Tenant.Id),
                    ("checknumber_task_id", taskId),
                    ("job_id", jobId),
                    ("phone_number_id", phone.Id),
                    ("submitted_number", phone.Digits),
                    ("returned_number", phone.Status == "Unknown" ? null : phone.Digits),
                    ("activated_raw", phone.Status switch { "Yes" => "yes", "No" => "no", _ => null }),
                    ("whatsapp_status", phone.Status),
                    ("validation_status", phone.Status == "Unknown" ? "Missing" : "Checked"),
                    ("note", phone.Status == "Unknown" ? NoteOf("Unknown") : null),
                    ("checked_at_utc", phone.CheckedAt));
            }
        }

        /// <summary>Writes a file into the shared data folder. False where there is no folder or it cannot be written.</summary>
        public bool WriteFile(string relativePath, byte[] content, ILogger logger)
        {
            if (dataRoot is null)
            {
                return false;
            }

            try
            {
                var path = Path.GetFullPath(Path.Combine(dataRoot, relativePath));

                if (!path.StartsWith(dataRoot, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                File.WriteAllBytes(path, content);

                return true;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning(exception, "The demonstration WhatsApp file {Path} could not be written.", relativePath);

                return false;
            }
        }
    }
}
