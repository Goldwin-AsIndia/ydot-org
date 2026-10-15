namespace YDot.PAY.Application.Common.Settings;

/// <summary>
/// How every amount in the platform is written: the digit grouping and whether a currency is
/// marked by its symbol or its code.
///
/// ONE SETTING FOR THE WHOLE PLATFORM, and the same section is bound by IAM, CAM, DON and PAY.
/// docker-compose sets it once (MONEY_NUMBER_GROUPING, MONEY_CURRENCY_MARKER) for all four, and
/// IAM hands it to the browser on <c>GET /api/v1/money-format</c>, so a receipt, a dashboard
/// tile and a donor's history can never group the same rupees two different ways.
///
/// What a currency's symbol is, where it sits and how many decimal places it has are NOT here:
/// they belong to the currency and live on the IAM currency master (Masters, Currency).
/// </summary>
public sealed class MoneyFormatSettings
{
    public const string SectionName = "MoneyFormat";

    /// <summary>Indian groups as 23,81,600; International as 2,381,600.</summary>
    public MoneyNumberGrouping NumberGrouping { get; set; } = MoneyNumberGrouping.Indian;

    /// <summary>Symbol writes ₹23,81,600; Code writes INR 23,81,600.</summary>
    public MoneyCurrencyMarker CurrencyMarker { get; set; } = MoneyCurrencyMarker.Symbol;
}

public enum MoneyNumberGrouping
{
    /// <summary>Thousands, then lakhs and crores: 1,23,45,678.</summary>
    Indian,

    /// <summary>Groups of three throughout: 12,345,678.</summary>
    International
}

public enum MoneyCurrencyMarker
{
    /// <summary>The currency master's symbol (₹), or the code where a currency has none.</summary>
    Symbol,

    /// <summary>The ISO code (INR).</summary>
    Code
}
