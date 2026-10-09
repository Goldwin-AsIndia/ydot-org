using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Features.CommunicationTimeline.Commands;
using YDots.DON.Application.Features.CommunicationTimeline.DTOs;
using YDots.DON.Application.Features.CommunicationTimeline.Queries;
using YDots.DON.Infrastructure.Authorization;

namespace YDots.DON.Api.Controllers;

/// <summary>
/// The Communication Timeline - a lead's or a donor's conversation history.
///
/// FOUR SCREENS POINT HERE, and the workflow document names all four: Communicate on the Lead
/// Work Queue and on My Leads, Open Timeline in the lead preview, and View History on the
/// Follow-Up Queue's action menu. Donor 360's communication history is the same page again.
///
/// IT IS ALSO WHERE A COMMUNICATION IS LOGGED, for a lead or a donor - the role flow's "log a
/// communication manually from the Communication Timeline". Recording used to be possible only
/// through the lead queue's Contact command, so a donor's timeline could not be written at all and
/// most of what the log form collected was dropped. The lead queue's Contact still works; both
/// apply the same consent rule and both update the lead the same way.
/// </summary>
[Route("api/v1/donors/communication-timeline")]
[Authorize]
public sealed class CommunicationTimelineController : ApiControllerBase
{
    private readonly ILogger<CommunicationTimelineController> _logger;

    public CommunicationTimelineController(ILogger<CommunicationTimelineController> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// GET the timeline for a lead, for a donor, or for a lead and the donor it became.
    ///
    /// BOTH IDS ARE ACCEPTED AND EITHER MAY BE OMITTED. The queue screens hold a lead id and
    /// Donor 360 holds a donor id; the handler resolves whichever it is given to both, so a
    /// converted lead's earlier conversations stay on screen after conversion - which is what
    /// the document means by "the converted donor retains the existing owner and Communication
    /// Timeline history".
    /// </summary>
    [HttpGet]
    [HasPermission(PermissionCodes.LeadWorkQueueView)]
    [ProducesResponseType(typeof(ApiResponse<CommunicationTimelineResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetTimeline(
        [FromQuery] Guid? leadId,
        [FromQuery] Guid? donorId,
        [FromServices] CommunicationTimelineQueryHandler handler,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Communication timeline retrieval started.");

        var result = await handler.HandleAsync(
            new GetCommunicationTimelineQuery(leadId, donorId), cancellationToken);

        if (result.IsSuccess)
        {
            _logger.LogInformation("Communication timeline retrieval completed successfully.");
        }
        else
        {
            _logger.LogWarning("Communication timeline retrieval failed.");
        }

        return FromResult(result);
    }

    /// <summary>
    /// POST log a communication against a lead or a donor: type, direction, when, outcome,
    /// summary, internal notes, engagement, quality, the Important flag and the attachment name.
    /// Outgoing contact on a withdrawn channel is refused.
    /// </summary>
    /// <summary>GET the timeline as a CSV. The export permission applies, and the export is logged.</summary>
    [HttpGet("export")]
    [HasPermission(PermissionCodes.DonorsExport)]
    [ProducesResponseType(typeof(FileResult), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Export(
        [FromQuery] Guid? leadId,
        [FromQuery] Guid? donorId,
        [FromServices] CommunicationTimelineQueryHandler handler,
        CancellationToken cancellationToken)
    {
        var result = await handler.HandleAsync(
            new ExportCommunicationTimelineQuery(leadId, donorId), cancellationToken);

        if (!result.IsSuccess)
        {
            _logger.LogWarning("Communication timeline export failed.");
        }

        return FileFromResult(result);
    }

    [HttpPost]
    [HasPermission(PermissionCodes.LeadWorkQueueContact)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Log(
        [FromBody] LogCommunicationRequest request,
        [FromServices] CommunicationCommandHandler handler,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Communication logging started.");

        var result = await handler.HandleAsync(new LogCommunicationCommand(request), cancellationToken);

        if (!result.IsSuccess)
        {
            _logger.LogWarning("Communication logging failed.");
        }

        return FromResult(result, "The communication was recorded.");
    }

    /// <summary>PUT correct a logged communication. The person who logged it, or the wider team.</summary>
    [HttpPut("{id:guid}")]
    [HasPermission(PermissionCodes.LeadWorkQueueContact)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status409Conflict)]
    public async Task<IActionResult> Update(
        Guid id,
        [FromBody] UpdateCommunicationRequest request,
        [FromServices] CommunicationCommandHandler handler,
        CancellationToken cancellationToken)
    {
        var result = await handler.HandleAsync(new UpdateCommunicationCommand(id, request), cancellationToken);

        if (!result.IsSuccess)
        {
            _logger.LogWarning("Communication update failed for {InteractionId}.", id);
        }

        return FromResult(result, "The communication was updated.");
    }

    /// <summary>POST flag a communication as important, or clear the flag - for the whole team.</summary>
    [HttpPost("{id:guid}/important")]
    [HasPermission(PermissionCodes.LeadWorkQueueContact)]
    [ProducesResponseType(typeof(ApiResponse<Guid>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Flag(
        Guid id,
        [FromBody] FlagCommunicationRequest request,
        [FromServices] CommunicationCommandHandler handler,
        CancellationToken cancellationToken)
    {
        var result = await handler.HandleAsync(new FlagCommunicationCommand(id, request), cancellationToken);

        return FromResult(result, request.IsImportant ? "Marked important." : "Important flag cleared.");
    }
}