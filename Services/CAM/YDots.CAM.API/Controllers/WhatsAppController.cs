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
/// TWO PERMISSIONS OF THEIR OWN (see <see cref="PermissionCodes.WhatsAppView"/>): reading needs
/// <c>cam.whatsapp.view</c>, and anything that can cost money or change something - an upload, a
/// send, a retry, a recipient group - needs <c>cam.whatsapp.operate</c>. Only the Organisation
/// Admin holds them unless they grant them.
///
/// THE WORKFLOW (since 15 October 2026): an upload VALIDATES numbers in bulk (CheckNumber.ai bills
/// a check of 500 numbers as much as a check of two); the validated numbers wait in a pool; a
/// person filters it, picks the ten or fifty to message (and may keep them as a tagged group),
/// fills a template, reviews what will happen and sends; the send log then traces every message
/// back to the check that verified its number. Nothing is ever messaged because a file arrived.
/// </summary>
[Route("api/v1/whatsapp")]
[Authorize(Policy = PolicyNames.TenantContextRequired)]
public sealed class WhatsAppController(
    WhatsAppQueryHandler queries,
    WhatsAppCommandHandler commands,
    WhatsAppGroupQueryHandler groupQueries,
    WhatsAppGroupCommandHandler groupCommands,
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
                form.ForceRecheck),
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

    // ---- 1. The selection pool --------------------------------------------------------------

    /// <summary>
    /// The validated WhatsApp numbers a send can be picked from - one page, filtered and searched
    /// on the server (check, country, group, tag, messaging history), with the options and counts
    /// of every filter.
    /// </summary>
    [HttpGet("wati/recipients")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<WatiRecipientSearchResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SearchRecipientsAsync(
        [FromQuery] WatiRecipientFilter filter, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new SearchWatiRecipientsQuery(filter), cancellationToken));

    /// <summary>"Select all that match": the matching numbers up to <paramref name="limit"/>, never more than one send may hold.</summary>
    [HttpGet("wati/recipients/matching")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<WatiMatchingRecipients>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetMatchingRecipientsAsync(
        [FromQuery] WatiRecipientFilter filter, [FromQuery] int limit, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetMatchingWatiRecipientsQuery(filter, limit), cancellationToken));

    // ---- 2. Recipient groups -------------------------------------------------------------------

    /// <summary>The organisation's recipient groups, with their tags, campaign and live member figures.</summary>
    [HttpGet("wati/groups")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<IReadOnlyList<WhatsAppGroupView>>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetGroupsAsync(CancellationToken cancellationToken) =>
        FromResult(await groupQueries.HandleAsync(new GetWhatsAppGroupsQuery(), cancellationToken));

    /// <summary>One group with its members: each number, the check it was picked from, and whether it is still on WhatsApp.</summary>
    [HttpGet("wati/groups/{groupId:guid}")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<WhatsAppGroupDetail>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetGroupAsync(Guid groupId, CancellationToken cancellationToken) =>
        FromResult(await groupQueries.HandleAsync(new GetWhatsAppGroupQuery(groupId), cancellationToken));

    /// <summary>Keeps a selection as a named, tagged group. Only the organisation's WhatsApp-verified numbers are kept.</summary>
    [HttpPost("wati/groups")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<WhatsAppGroupChangeResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> CreateGroupAsync(
        [FromBody] CreateWhatsAppGroupRequest request, CancellationToken cancellationToken)
    {
        var result = await groupCommands.HandleAsync(new CreateWhatsAppGroupCommand(request), cancellationToken);
        return FromResult(result, result.IsSuccess ? result.Value!.Message : null);
    }

    /// <summary>Renames a group, or changes its description, campaign or tags.</summary>
    [HttpPut("wati/groups/{groupId:guid}")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<WhatsAppGroupChangeResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> UpdateGroupAsync(
        Guid groupId, [FromBody] UpdateWhatsAppGroupRequest request, CancellationToken cancellationToken)
    {
        var result = await groupCommands.HandleAsync(new UpdateWhatsAppGroupCommand(groupId, request), cancellationToken);
        return FromResult(result, result.IsSuccess ? result.Value!.Message : null);
    }

    /// <summary>Adds numbers (usually the current selection) to a group.</summary>
    [HttpPost("wati/groups/{groupId:guid}/members")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<WhatsAppGroupChangeResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> AddGroupMembersAsync(
        Guid groupId, [FromBody] AddWhatsAppGroupMembersRequest request, CancellationToken cancellationToken)
    {
        var result = await groupCommands.HandleAsync(new AddWhatsAppGroupMembersCommand(groupId, request), cancellationToken);
        return FromResult(result, result.IsSuccess ? result.Value!.Message : null);
    }

    /// <summary>Removes numbers from a group. A POST because the numbers travel in the body.</summary>
    [HttpPost("wati/groups/{groupId:guid}/members/remove")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<WhatsAppGroupChangeResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> RemoveGroupMembersAsync(
        Guid groupId, [FromBody] RemoveWhatsAppGroupMembersRequest request, CancellationToken cancellationToken)
    {
        var result = await groupCommands.HandleAsync(new RemoveWhatsAppGroupMembersCommand(groupId, request), cancellationToken);
        return FromResult(result, result.IsSuccess ? result.Value!.Message : null);
    }

    /// <summary>Deletes a group. The sends made from it keep its name in the send log.</summary>
    [HttpDelete("wati/groups/{groupId:guid}")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<WhatsAppGroupChangeResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteGroupAsync(Guid groupId, CancellationToken cancellationToken)
    {
        var result = await groupCommands.HandleAsync(new DeleteWhatsAppGroupCommand(groupId), cancellationToken);
        return FromResult(result, result.IsSuccess ? result.Value!.Message : null);
    }

    // ---- 3 and 4. Review, then send ---------------------------------------------------------------

    /// <summary>
    /// What a send would do, number by number - who will be messaged, who skipped and why, each
    /// message as it will read - and what still stops it. NOTHING IS QUEUED: a POST only because
    /// the selection travels in the body.
    /// </summary>
    [HttpPost("wati/broadcasts/review")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<SendReviewResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> ReviewSendAsync(
        [FromBody] ReviewSendRequest request, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new ReviewWatiSendQuery(request.ToSendRequest()), cancellationToken));

    /// <summary>
    /// Queues a send of the SELECTED numbers for the worker - refused when the selection is larger
    /// than one send may be. The worker applies its own safeguards before a single message leaves
    /// (the allow-list, the cap per send, "already sent this template") and records the reason for
    /// every number it leaves out.
    /// </summary>
    [HttpPost("wati/broadcasts")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<CommandAcceptedResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> SendBroadcastAsync(
        [FromBody] SendBroadcastRequest request, CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "WhatsApp send {BroadcastName} ({TemplateName}) requested for {Recipients} selected number(s).",
            request.BroadcastName, request.TemplateName, request.SelectedRecipients().Count);

        return FromResult(
            await commands.HandleAsync(new SendWatiBroadcastCommand(request), cancellationToken),
            "The send is with the integration worker.");
    }

    // ---- 5. The send log ------------------------------------------------------------------------------

    /// <summary>The send log: one page of sends with their selection, group, tags and outcome, and the options of its filters.</summary>
    [HttpGet("wati/broadcasts")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<WatiBroadcastSearchResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> SearchBroadcastsAsync(
        [FromQuery] WatiBroadcastFilter filter, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new SearchWatiBroadcastsQuery(filter), cancellationToken));

    /// <summary>
    /// The send log as a CSV: one row per selected number of every matching send - template,
    /// values, group, the check that verified the number, its CheckNumber.ai task, and the outcome.
    /// Recorded in the audit trail with the file's reference.
    /// </summary>
    [HttpGet("wati/broadcasts/export")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    public async Task<IActionResult> ExportBroadcastsAsync(
        [FromQuery] WatiBroadcastFilter filter, CancellationToken cancellationToken) =>
        FileFromResult(await queries.HandleAsync(new ExportWatiBroadcastsQuery(filter, null), cancellationToken));

    /// <summary>One send in full: what was chosen, how the template was filled, and what became of every number.</summary>
    [HttpGet("wati/broadcasts/{broadcastId:guid}")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(ApiResponse<WatiBroadcastDetail>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetBroadcastAsync(Guid broadcastId, CancellationToken cancellationToken) =>
        FromResult(await queries.HandleAsync(new GetWatiBroadcastQuery(broadcastId), cancellationToken));

    /// <summary>One send as a CSV, every selected number on its own row.</summary>
    [HttpGet("wati/broadcasts/{broadcastId:guid}/export")]
    [HasPermission(PermissionCodes.WhatsAppView)]
    [ProducesResponseType(typeof(FileContentResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ExportBroadcastAsync(Guid broadcastId, CancellationToken cancellationToken) =>
        FileFromResult(await queries.HandleAsync(new ExportWatiBroadcastsQuery(new WatiBroadcastFilter(), broadcastId), cancellationToken));

    /// <summary>Puts a send's messages that failed for a reason a retry can fix back in the queue. Nobody new is added.</summary>
    [HttpPost("wati/broadcasts/{broadcastId:guid}/retry")]
    [HasPermission(PermissionCodes.WhatsAppOperate)]
    [ProducesResponseType(typeof(ApiResponse<CommandAcceptedResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> RetryBroadcastAsync(Guid broadcastId, CancellationToken cancellationToken) =>
        FromResult(
            await commands.HandleAsync(new RetryWatiBroadcastCommand(broadcastId), cancellationToken),
            "The integration worker will send the failed messages again.");

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

    // runWati, watiTemplateName, watiBroadcastName and watiParameters were retired on 15 October
    // 2026 with the automatic message that followed a check: an upload only validates numbers. A
    // client that still sends them is not refused - unknown form fields are simply not bound.
}

/// <summary>Why a job is being stopped. Optional; kept in the audit trail.</summary>
public sealed record CancelCheckJobRequest(string? Reason);
