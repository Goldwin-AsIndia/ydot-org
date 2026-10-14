using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Features.Dashboard.DTOs;
using YDots.CAM.Application.Features.Dashboard.Queries;

namespace YDots.CAM.API.Controllers;

/// <summary>
/// CAM's part of the landing page.
///
/// NO PERMISSION AND NO ORGANISATION REQUIRED ON THE ROUTE, unlike every other campaign route.
/// Every role lands on the dashboard and the page asks all four services at once: the Platform
/// Admin outside an Organisation, a Fundraiser and a Donor would each draw a 403 here - and an
/// access-denied audit row with it - for doing nothing wrong. The handler answers them with an
/// empty section instead, and gates every figure inside by the permission of the screen it
/// summarises.
/// </summary>
[Route("api/v1/dashboard")]
[Authorize]
public sealed class DashboardController(
    CampaignDashboardQueryHandler queries,
    CampaignOutcomesQueryHandler outcomes,
    ILogger<DashboardController> logger) : ApiControllerBase
{
    /// <summary>The caller's campaign figures, tiles and shortcuts, by their permissions.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<DashboardResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAsync(
        [FromQuery] DashboardFilter filter, CancellationToken cancellationToken)
    {
        logger.LogDebug("Getting the campaign dashboard.");

        var result = await queries.HandleAsync(new GetCampaignDashboardQuery(filter), cancellationToken);

        if (result.IsFailure)
        {
            logger.LogWarning("Campaign dashboard failed.");
        }

        return FromResult(result);
    }

    /// <summary>
    /// The Executive dashboard's campaign figures for a period, and the campaigns it can be
    /// narrowed to. A period that ends before it starts, or runs past a year, is refused with 400.
    /// </summary>
    [HttpGet("outcomes")]
    [ProducesResponseType(typeof(ApiResponse<DashboardOutcomesResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetOutcomesAsync(
        [FromQuery] DashboardOutcomesFilter filter, CancellationToken cancellationToken)
    {
        logger.LogDebug("Getting the campaign outcomes.");

        var result = await outcomes.HandleAsync(new GetCampaignOutcomesQuery(filter), cancellationToken);

        if (result.IsFailure)
        {
            logger.LogWarning("Campaign outcomes were refused.");
        }

        return FromResult(result);
    }
}
