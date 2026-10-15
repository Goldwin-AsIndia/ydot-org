using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.Features.MoneyFormat;

namespace YDot.IAM.Api.Controllers;

/// <summary>
/// How amounts are written, for the browser.
///
/// One setting (MoneyFormat in configuration) decides the grouping - 23,81,600 or 2,381,600 -
/// and whether a currency is marked by its symbol or its code; the currency master decides each
/// currency's symbol, its position and its decimal places. CAM, DON and PAY read the same two
/// sources for the text they write, and the client reads them here.
///
/// ANONYMOUS: the public donation form and the payment result page show amounts before anybody
/// signs in, and nothing here is private.
/// </summary>
[Route("api/v1/money-format")]
[AllowAnonymous]
public sealed class MoneyFormatController(
    MoneyFormatQueryHandler queries,
    ILogger<MoneyFormatController> logger) : ApiControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(ApiResponse<MoneyFormatResponse>), StatusCodes.Status200OK)]
    public async Task<IActionResult> GetAsync(CancellationToken cancellationToken)
    {
        var result = await queries.HandleAsync(new GetMoneyFormatQuery(), cancellationToken);

        if (result.IsFailure)
            logger.LogWarning("Money format could not be read.");

        return FromResult(result);
    }
}
