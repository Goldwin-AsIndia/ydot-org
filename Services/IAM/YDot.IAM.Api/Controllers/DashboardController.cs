using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.Features.Dashboard.DTOs;
using YDot.IAM.Application.Features.Dashboard.Queries;
using YDot.IAM.Infrastructure.Authorization;

namespace YDot.IAM.Api.Controllers;

/// <summary>
/// IAM's part of the landing page: the greeting, the activity feed, the people and access figures
/// - and, for the Platform Admin outside an Organisation, the whole page.
///
/// NO PERMISSION ON THE ROUTE. Every signed-in person lands on the dashboard, and each of them may
/// at least see who they are and what they did lately; the handler decides everything beyond
/// that from the permissions of the screens each figure summarises.
/// </summary>
[Route("api/v1/dashboard")]
[Authorize]
// An Organisation still being set up lands its administrator on the dashboard like any other.
[AllowedWhileOnboarding]
public sealed class DashboardController(
    IdentityDashboardQueryHandler handler,
    ILogger<DashboardController> logger) : ApiControllerBase
{
    /// <summary>The caller's identity figures, tiles and shortcuts, by their permissions.</summary>
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<DashboardResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAsync(
        [FromQuery] DashboardFilter filter, CancellationToken cancellationToken)
    {
        logger.LogInformation("Getting the identity dashboard.");

        var result = await handler.HandleAsync(new GetIdentityDashboardQuery(filter), cancellationToken);

        if (result.IsFailure)
        {
            logger.LogWarning("Identity dashboard failed.");
        }

        return FromResult(result);
    }
}
