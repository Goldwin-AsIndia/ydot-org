using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YDot.PAY.Application.Common.Constants;
using YDot.PAY.Application.Common.Results;
using YDot.PAY.Application.Features.Dashboard.DTOs;
using YDot.PAY.Application.Features.Dashboard.Queries;

namespace YDot.PAY.Api.Controllers;

/// <summary>
/// PAY's part of the landing page.
///
/// NO PERMISSION ON THE ROUTE, deliberately. Every role lands on the dashboard, and the page asks
/// all four services at once; a 403 here for a Campaign Executive or a DonorCare agent would be
/// both wrong - they have done nothing they should not - and noisy, since each refusal is an
/// access-denied audit row. The handler decides what the caller may see and answers with an empty
/// section when it is nothing. Each figure inside is still gated by the permission of the
/// register it comes from, and narrowed by the same data scope.
/// </summary>
[ApiController]
[Authorize(Policy = PolicyNames.ActiveUserOnly)]
[Route("api/v1/dashboard")]
[Produces("application/json")]
public sealed class DashboardController(
    PaymentDashboardQueryHandler queries,
    PaymentOutcomesQueryHandler outcomes,
    ILogger<DashboardController> logger) : ApiControllerBase
{
    /// <summary>The caller's payment figures, tiles and shortcuts, by their permissions.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<DashboardResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAsync(
        [FromQuery] DashboardFilter filter, CancellationToken cancellationToken)
    {
        logger.LogInformation("Getting the payment dashboard.");

        var result = await queries.HandleAsync(new GetPaymentDashboardQuery(filter), cancellationToken);

        logger.LogInformation("Payment dashboard request completed.");

        return FromResult(result);
    }

    /// <summary>
    /// The Executive dashboard's payment figures for a period and, optionally, one campaign - with
    /// the comparison period and the day-by-day curve. A period that ends before it starts, or runs
    /// past a year, is refused with 400.
    /// </summary>
    [HttpGet("outcomes")]
    [ProducesResponseType(typeof(ApiResponse<DashboardOutcomesResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> GetOutcomesAsync(
        [FromQuery] DashboardOutcomesFilter filter, CancellationToken cancellationToken)
    {
        logger.LogInformation("Getting the payment outcomes.");

        var result = await outcomes.HandleAsync(new GetPaymentOutcomesQuery(filter), cancellationToken);

        logger.LogInformation("Payment outcomes request completed.");

        return FromResult(result);
    }
}
