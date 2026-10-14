using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Features.Dashboard.DTOs;
using YDots.DON.Application.Features.Dashboard.Queries;

namespace YDots.DON.Api.Controllers;

/// <summary>
/// DON's part of the landing page. Route: /api/v1/donors/dashboard.
///
/// NO PERMISSION ON THE ROUTE. Every role lands on the dashboard and the page asks all four
/// services at once; a Campaign Executive or a Donor holds no DON permission and must not draw a
/// 403 - with its access-denied audit row - for opening their own landing page. The handler
/// answers them with an empty section, and gates every figure inside by the permission of the
/// list it summarises, narrowed by the same data scope.
/// </summary>
[Route("api/v1/donors/dashboard")]
[Authorize]
public sealed class DashboardController : ApiControllerBase
{
    private readonly ILogger<DashboardController> _logger;

    public DashboardController(ILogger<DashboardController> logger)
    {
        _logger = logger;
    }

    /// <summary>The caller's donor, lead and follow-up figures, tiles and shortcuts.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<DashboardResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Get(
        [FromQuery] DashboardFilter filter,
        [FromServices] DonorDashboardQueryHandler handler,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Donor dashboard retrieval started.");

        var result = await handler.HandleAsync(new GetDonorDashboardQuery(filter), cancellationToken);

        if (result.IsSuccess)
        {
            _logger.LogInformation("Donor dashboard retrieved successfully.");
        }
        else
        {
            _logger.LogWarning("Donor dashboard retrieval failed.");
        }

        return FromResult(result);
    }

    /// <summary>
    /// The Executive dashboard's lead figures for a period and, optionally, one campaign. A period
    /// that ends before it starts, or runs past a year, is refused with 400.
    /// </summary>
    [HttpGet("outcomes")]
    [ProducesResponseType(typeof(ApiResponse<DashboardOutcomesResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetOutcomes(
        [FromQuery] DashboardOutcomesFilter filter,
        [FromServices] DonorOutcomesQueryHandler handler,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Donor outcomes retrieval started.");

        var result = await handler.HandleAsync(new GetDonorOutcomesQuery(filter), cancellationToken);

        if (result.IsFailure)
        {
            _logger.LogWarning("Donor outcomes were refused.");
        }

        return FromResult(result);
    }
}
