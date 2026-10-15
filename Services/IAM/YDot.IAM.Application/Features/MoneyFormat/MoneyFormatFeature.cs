using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.Common.Settings;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.MoneyFormat;

/// <summary>How the browser should write amounts.</summary>
public sealed record GetMoneyFormatQuery;

/// <summary>One currency's writing rule, from the currency master.</summary>
public sealed record CurrencyFormatResponse(
    string Code,
    string? Symbol,
    SymbolPosition SymbolPosition,
    int DecimalPlaces);

/// <summary>
/// The platform's money format and the currency master's rules, in one small payload.
///
/// The browser applies them with money-format.ts, the same rule IAM, CAM, DON and PAY apply with
/// MoneyText - so the screen and a receipt group, mark and round an amount identically.
/// </summary>
public sealed record MoneyFormatResponse(
    MoneyNumberGrouping NumberGrouping,
    MoneyCurrencyMarker CurrencyMarker,
    IReadOnlyList<CurrencyFormatResponse> Currencies);

/// <summary>
/// Serves <see cref="MoneyFormatResponse"/>.
///
/// ANONYMOUS, because the donation form and the payment result page show amounts to people who
/// have not signed in. Nothing in it is private: a digit grouping and the platform currency
/// rows. Only the platform rows are sent (tenant_id IS NULL), the same rows CAM, DON and PAY read,
/// so an Organisation's own additions to the master cannot make the screen disagree with a
/// receipt.
/// </summary>
public sealed class MoneyFormatQueryHandler(
    IGlobalMasterReadService masters,
    IOptions<MoneyFormatSettings> options,
    ILogger<MoneyFormatQueryHandler> logger)
{
    public async Task<Result<MoneyFormatResponse>> HandleAsync(
        GetMoneyFormatQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var settings = options.Value;
        var currencies = await masters.ListCurrencyFormatsAsync(cancellationToken);

        logger.LogDebug(
            "Money format served: {Grouping} grouping, {Marker} marker, {Count} currencies.",
            settings.NumberGrouping, settings.CurrencyMarker, currencies.Count);

        return Result.Success(new MoneyFormatResponse(settings.NumberGrouping, settings.CurrencyMarker, currencies));
    }
}
