using YDot.PAY.Application.Common.Formatting;

namespace YDot.PAY.Application.Common.Models;

/// <summary>
/// An amount as the client receives it.
///
/// IT CARRIES A PRE-FORMATTED <see cref="Display"/> STRING alongside the raw figure, for the
/// places that show the server's words as they are (dashboard feeds, timelines). It is written by
/// <see cref="MoneyText"/>, the same rule a receipt uses: the platform's grouping (23,81,600 when
/// Indian) and marker, and the currency master's symbol and decimal places. Screens that format
/// for themselves use <see cref="Amount"/> and <see cref="CurrencyCode"/> with the browser's copy
/// of that rule, so either way the figure reads the same.
/// </summary>
public sealed record MoneyResponse(decimal Amount, string CurrencyCode, string Display)
{
    /// <summary>An amount with its display text, decimals shown only where it has them.</summary>
    public static MoneyResponse Plain(decimal amount, string currencyCode) =>
        new(amount, currencyCode, MoneyText.Format(amount, currencyCode));
}
