using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Features.WhatsApp.Commands;
using YDots.CAM.Application.Features.WhatsApp.DTOs;
using YDots.CAM.Application.Features.WhatsApp.Queries;
using YDots.CAM.Infrastructure.Authorization;

namespace YDots.CAM.API.Controllers;

/// <summary>
/// WhatsApp outreach: the CheckNumber screen (/app/whatsapp/check-number) and the Wati screen
/// (/app/whatsapp/wati).
///
/// THIS CONTROLLER NEVER CALLS CheckNumber.ai OR WATI. The YDot.Integration worker does that. An
/// upload becomes a file in the worker's inbox; "retry", "stop" and "send this broadcast" become
/// rows in int_worker_commands; and everything shown is read from the worker's int_* tables. So
/// there is one place where money is spent, one place that must survive a restart, and the web
/// request returns in milliseconds however long CheckNumber.ai takes.
///
/// WHY IT LIVES IN CAM. The messages exist to bring donors to a campaign's donation link, an
/// upload can name the campaign it is for, and the campaign's Recent Activity shows what was
/// checked and sent. A separate service would have needed its own host, its own image and its
/// own route through the gateway to say the same thing.
///
/// TWO PERMISSIONS, BOTH ALIASES OF CAMPAIGN ONES (see <see cref="PermissionCodes.WhatsAppView"/>):
/// reading needs what viewing campaigns needs, and anything that can cost money - an upload, a
/// broadcast, a retry - needs what creating a campaign needs.
/// </summary>
[Route("api/v1/whatsapp")]
[Authorize(Policy = PolicyNames.TenantContextRequired)]
public sealed class WhatsAppController(
    WhatsAppQueryHandler queries,
    WhatsAppCommandHandler commands,
    ILogger<WhatsAppController> logger) : ApiControllerBase
{
    /// <summary>
    /// A hard ceiling on the upload request, well above the configured file limit
    /// (WhatsAppIntegration:MaxUploadMegabytes, 10 by default), which the handler enforces with a
    /// message a person can act on. This one only stops a runaway body being buffered at all.
    /// </summary>
    private const long UploadRequestCeilingBytes = 64L * 1024 * 1024;

    // =====================================================================================
    // Overview
    // =====================================================================================

    /// <summary>The hero figures, the worker's status and its effective settings.</summary>
    [HttpGet("overview")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<WhatsAppOverviewResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetOverviewAsync(CancellationToken cancellationToken)
    {
        logger.LogDebug("Getting the WhatsApp overview.");

        return FromResult(await queries.HandleAsync(new GetWhatsAppOverviewQuery(), cancellationToken));
    }

    // =====================================================================================
    // CheckNumber: upload
    // =====================================================================================

    /// <summary>
    /// Which of these numbers already have a saved answer - the upload review asks before anything
    /// is submitted, so a number that was checked before is never paid for twice.
    ///
    /// A POST THAT CHANGES NOTHING: the list can run to tens of thousands of numbers, which does
    /// not fit in a query string.
    /// </summary>
    [HttpPost("numbers/lookup")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<NumberLookupResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> LookupNumbersAsync(
        [FromBody] NumberLookupRequest request, CancellationToken cancellationToken)
    {
        logger.LogDebug("Looking up {Count} numbers for saved WhatsApp answers.", request.Numbers?.Count ?? 0);

        return FromResult(await queries.HandleAsync(new LookupNumbersQuery(request), cancellationToken));
    }

    /// <summary>
    /// Hands a number file to the integration worker.
    ///
    /// THE ANSWER IS A REFERENCE, NOT A JOB. The worker creates the job when it picks the file up
    /// a few seconds later; the page polls <c>uploads/{reference}</c> until it has one. Sending the
    /// same file twice answers "Duplicate" with the job that already holds the results, unless
    /// "check them again anyway" was ticked.
    /// </summary>
    [HttpPost("check-jobs")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(UploadRequestCeilingBytes)]
    [RequestFormLimits(MultipartBodyLengthLimit = UploadRequestCeilingBytes)]
    [ProducesResponseType(typeof(ApiResponse<CheckJobUploadResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> UploadAsync(
        [FromForm] UploadCheckFileForm form, CancellationToken cancellationToken)
    {
        if (form.File is null)
        {
            return FromResult(Result.Failure<CheckJobUploadResponse>(
                Error.Validation("Choose a .txt, .csv, .xls or .xlsx file to upload.")));
        }

        IReadOnlyDictionary<string, string>? watiParameters = null;

        if (!string.IsNullOrWhiteSpace(form.WatiParameters))
        {
            try
            {
                watiParameters = JsonSerializer.Deserialize<Dictionary<string, string>>(form.WatiParameters);
            }
            catch (JsonException)
            {
                return FromResult(Result.Failure<CheckJobUploadResponse>(Error.Validation(
                    "watiParameters must be a JSON object of text values, for example {\"image_url\": \"https://example.org/picture.jpg\"}.")));
            }
        }

        logger.LogInformation(
            "WhatsApp list upload received: {FileName}, {Bytes} bytes, campaign {CampaignId}.",
            form.File.FileName, form.File.Length, form.CampaignId);

        await using var buffer = new MemoryStream(capacity: (int)Math.Min(form.File.Length, int.MaxValue));
        await form.File.CopyToAsync(buffer, cancellationToken);

        var result = await commands.HandleAsync(
            new UploadCheckFileCommand(
                form.File.FileName,
                buffer.ToArray(),
                form.CampaignId,
                form.ForceRecheck,
                form.RunWati,
                form.WatiTemplateName,
                form.WatiBroadcastName,
                watiParameters),
            cancellationToken);

        if (result.IsFailure)
        {
            logger.LogWarning("WhatsApp list upload refused: {Reason}", result.Error!.Message);
        }

        return FromResult(result, result.IsSuccess ? result.Value!.Message : null);
    }

    /// <summary>Where an upload stands: still in the inbox, registered as a job, a duplicate, or rejected.</summary>
    [HttpGet("uploads/{reference}")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<UploadStatusResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetUploadStatusAsync(string reference, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetUploadStatusQuery(reference), cancellationToken));

    // =====================================================================================
    // CheckNumber: jobs
    // =====================================================================================

    /// <summary>The jobs list, newest first.</summary>
    [HttpGet("check-jobs")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<PagedResponse<CheckJobListItem>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SearchJobsAsync(
        [FromQuery] CheckJobSearchFilter filter, CancellationToken cancellationToken)
    {
        logger.LogDebug("Searching WhatsApp check jobs.");

        return FromResult(await queries.HandleAsync(new SearchCheckJobsQuery(filter), cancellationToken));
    }

    /// <summary>
    /// One job: its header, CheckNumber.ai tasks, timeline, events and what WATI did afterwards.
    /// <paramref name="job"/> is the job's number (INT-20261010-000001) or its id.
    /// </summary>
    [HttpGet("check-jobs/{job}")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<CheckJobDetailResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetJobAsync(string job, CancellationToken cancellationToken)
    {
        var jobId = await queries.HandleAsync(new ResolveCheckJobQuery(job), cancellationToken);

        return jobId.IsFailure
            ? FromResult(Result.Failure<CheckJobDetailResponse>(jobId.Error!))
            : FromResult(await queries.HandleAsync(new GetCheckJobQuery(jobId.Value), cancellationToken));
    }

    /// <summary>The job's report: every distinct number that has an answer, in file order.</summary>
    [HttpGet("check-jobs/{job}/results")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<CheckJobResultRow>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetJobResultsAsync(string job, CancellationToken cancellationToken)
    {
        var jobId = await queries.HandleAsync(new ResolveCheckJobQuery(job), cancellationToken);

        return jobId.IsFailure
            ? FromResult(Result.Failure<IReadOnlyList<CheckJobResultRow>>(jobId.Error!))
            : FromResult(await queries.HandleAsync(new GetCheckJobResultsQuery(jobId.Value), cancellationToken));
    }

    /// <summary>The lines of the file that held no usable number, and why.</summary>
    [HttpGet("check-jobs/{job}/invalid-lines")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<InvalidLineView>>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetJobInvalidLinesAsync(string job, CancellationToken cancellationToken)
    {
        var jobId = await queries.HandleAsync(new ResolveCheckJobQuery(job), cancellationToken);

        return jobId.IsFailure
            ? FromResult(Result.Failure<IReadOnlyList<InvalidLineView>>(jobId.Error!))
            : FromResult(await queries.HandleAsync(new GetCheckJobInvalidLinesQuery(jobId.Value), cancellationToken));
    }

    /// <summary>
    /// A job's downloads. <paramref name="kind"/> is one of: original (the uploaded file),
    /// submitted (the numbers sent to CheckNumber.ai), results (the completed output), raw (the
    /// archive CheckNumber.ai returned), invalid (the rejected lines) or summary (summary.json).
    /// </summary>
    [HttpGet("check-jobs/{job}/files/{kind}")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DownloadJobFileAsync(string job, string kind, CancellationToken cancellationToken)
    {
        var jobId = await queries.HandleAsync(new ResolveCheckJobQuery(job), cancellationToken);

        if (jobId.IsFailure)
        {
            return FileFromResult(Result.Failure<ExportFile>(jobId.Error!));
        }

        var file = await queries.HandleAsync(new GetCheckJobFileQuery(jobId.Value, kind), cancellationToken);

        if (file.IsFailure)
        {
            logger.LogWarning("WhatsApp download {Kind} of job {Job} refused: {Reason}", kind, job, file.Error!.Message);

            return FileFromResult(Result.Failure<ExportFile>(file.Error!));
        }

        // The job number travels in the X-Export-Reference header, as the audit reference does for
        // CAM's other downloads, so a file found on a desktop later can be traced to its job.
        return FileFromResult(Result.Success(new ExportFile(
            file.Value!.Content, file.Value.ContentType, file.Value.FileName, job)));
    }

    /// <summary>
    /// Asks the worker to pick a job up where it stopped. Nothing that already succeeded is done
    /// (or paid for) again: a finished CheckNumber.ai task is not re-submitted, and only messages
    /// that failed for a reason a retry can fix go back to the queue.
    /// </summary>
    [HttpPost("check-jobs/{job}/retry")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<CommandAcceptedResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> RetryJobAsync(string job, CancellationToken cancellationToken)
    {
        var jobId = await queries.HandleAsync(new ResolveCheckJobQuery(job), cancellationToken);

        if (jobId.IsFailure)
        {
            return FromResult(Result.Failure<CommandAcceptedResponse>(jobId.Error!));
        }

        logger.LogInformation("Retry requested for WhatsApp check {Job}.", job);

        return FromResult(
            await commands.HandleAsync(new RetryCheckJobCommand(jobId.Value), cancellationToken),
            "The integration worker will pick this check up again.");
    }

    /// <summary>Asks the worker to stop a job at its next safe point. Answers already received are kept.</summary>
    [HttpPost("check-jobs/{job}/cancel")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<CommandAcceptedResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CancelJobAsync(
        string job, [FromBody] CancelCheckJobRequest? request, CancellationToken cancellationToken)
    {
        var jobId = await queries.HandleAsync(new ResolveCheckJobQuery(job), cancellationToken);

        if (jobId.IsFailure)
        {
            return FromResult(Result.Failure<CommandAcceptedResponse>(jobId.Error!));
        }

        logger.LogInformation("Stop requested for WhatsApp check {Job}.", job);

        return FromResult(
            await commands.HandleAsync(new CancelCheckJobCommand(jobId.Value, request?.Reason), cancellationToken),
            "The integration worker will stop this check at the next safe point.");
    }

    // =====================================================================================
    // Wati
    // =====================================================================================

    /// <summary>The templates that can be sent: approved in WATI, or declared in the worker's settings.</summary>
    [HttpGet("wati/templates")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WatiTemplateView>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetTemplatesAsync(CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetWatiTemplatesQuery(), cancellationToken));

    /// <summary>Asks the worker to read the template list from WATI again.</summary>
    [HttpPost("wati/templates/refresh")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<CommandAcceptedResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> RefreshTemplatesAsync(CancellationToken cancellationToken) =>
        FromResult(
            await commands.HandleAsync(new RefreshWatiTemplatesCommand(), cancellationToken),
            "The integration worker will refresh the template list from WATI.");

    /// <summary>The organisation's numbers that are on WhatsApp - who a broadcast can be sent to.</summary>
    [HttpGet("wati/recipients")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WatiRecipientView>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetRecipientsAsync(CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetWatiRecipientsQuery(), cancellationToken));

    /// <summary>Every broadcast: those sent from the Wati page and those that followed a check automatically.</summary>
    [HttpGet("wati/broadcasts")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WatiBroadcastView>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetBroadcastsAsync(CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetWatiBroadcastsQuery(), cancellationToken));

    /// <summary>
    /// Queues a broadcast for the worker. The worker applies its own safeguards before a single
    /// message leaves - the allow-list, the cap on recipients per job, "already sent this
    /// template" - and records the reason for every recipient it leaves out.
    /// </summary>
    [HttpPost("wati/broadcasts")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<CommandAcceptedResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SendBroadcastAsync(
        [FromBody] SendBroadcastRequest request, CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "WhatsApp broadcast {BroadcastName} ({TemplateName}) requested for {Recipients} recipient(s).",
            request.BroadcastName, request.TemplateName, request.Recipients.Count);

        return FromResult(
            await commands.HandleAsync(new SendWatiBroadcastCommand(request), cancellationToken),
            "The broadcast is with the integration worker.");
    }

    /// <summary>The delivery report, newest first.</summary>
    [HttpGet("wati/messages")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WatiMessageView>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetMessagesAsync(
        [FromQuery] WatiMessageFilter filter, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetWatiMessagesQuery(filter), cancellationToken));

    // =====================================================================================
    // Requests left for the worker
    // =====================================================================================

    /// <summary>
    /// Where a request (retry, stop, broadcast, template refresh) stands: Pending, Processing,
    /// Completed, Rejected - with the worker's reason - or Failed.
    /// </summary>
    [HttpGet("commands/{reference}")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<CommandStatusResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetCommandAsync(string reference, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetWorkerCommandQuery(reference), cancellationToken));
}

/// <summary>
/// The upload form (multipart/form-data).
///
/// A CLASS RATHER THAN SEPARATE PARAMETERS so the file and its options bind together and the
/// OpenAPI document shows one form. The file is the only required part.
/// </summary>
public sealed class UploadCheckFileForm
{
    /// <summary>The number list: .txt, .csv, .xls or .xlsx.</summary>
    public IFormFile? File { get; set; }

    /// <summary>The campaign this list is for, when there is one. It links the job - and the messages - to the campaign.</summary>
    public Guid? CampaignId { get; set; }

    /// <summary>"Check them again anyway": pay to check numbers that already have a saved answer.</summary>
    public bool ForceRecheck { get; set; }

    /// <summary>False = check only. Leave it out to follow the worker's Pipeline settings.</summary>
    public bool? RunWati { get; set; }

    /// <summary>A WATI template for this upload's automatic message; leave it out for the worker's default.</summary>
    public string? WatiTemplateName { get; set; }

    /// <summary>A WATI broadcast name for this upload; leave it out for the worker's default.</summary>
    public string? WatiBroadcastName { get; set; }

    /// <summary>Template values for this upload, as a JSON object - for example {"image_url": "https://..."}.</summary>
    public string? WatiParameters { get; set; }
}

/// <summary>Why a job is being stopped. Optional; kept in the audit trail.</summary>
public sealed record CancelCheckJobRequest(string? Reason);
