using System.Globalization;
using YDots.DON.Application.Common.Settings;

namespace YDots.DON.Application.Common.Formatting;

/// <summary>
/// How much the exact figure matters where an amount is shown, which decides its decimals.
/// The browser uses the same four names (Shared/formatting/money-format.ts).
/// </summary>
public enum MoneyStyle
{
    /// <summary>Decimals only when the amount has them: ₹5,000 and ₹5,000.50. The default.</summary>
    Standard,

    /// <summary>Always the currency's decimal places: ₹5,000.00. Receipts, refunds, settlement.</summary>
    Exact,

    /// <summary>Rounded to whole units: ₹5,001. Dashboard tiles and headline figures.</summary>
    Whole,

    /// <summary>Short scale: ₹23.8L, ₹1.2Cr (₹2.4M with International grouping). Captions.</summary>
    Compact
}

/// <summary>How one currency is written, as the IAM currency master records it.</summary>
public sealed record CurrencyDisplayRule(string Code, string? Symbol, bool SymbolAfter, int DecimalPlaces);

/// <summary>
/// Writes an amount the way the platform's money format says to.
///
/// COPIED INTO IAM, CAM, DON AND PAY, like <c>DashboardFormat</c>, and mirrored by the browser's
/// money-format.ts. A figure PAY puts on a receipt and the same figure the screen shows must read
/// identically, and the only way to promise that is one rule written out in each place it runs.
///
/// IT HOLDS A PROCESS-WIDE SNAPSHOT rather than taking the settings as a parameter, because the
/// callers are the static mappers that turn every donation, receipt and refund into a response.
/// Threading a formatter through all of them would change forty signatures to carry a value that
/// is the same for the whole process - the same reason .NET keeps a default culture. The settings
/// are installed once at start-up and the currency rules are refreshed from <c>gm_currencies</c>
/// by a background reader; until it first succeeds, the built-in rules below (the seeded master)
/// apply.
///
/// NO CULTURE DATA IS USED. Lakh grouping is expressed as group sizes {3, 2}, so the output does
/// not depend on which ICU build the container happens to ship.
/// </summary>
public static class MoneyText
{
    private sealed record Snapshot(
        MoneyFormatSettings Settings,
        NumberFormatInfo Numbers,
        IReadOnlyDictionary<string, CurrencyDisplayRule> Currencies);

    private static readonly (decimal Size, string Suffix)[] IndianUnits =
        [(10_000_000m, "Cr"), (100_000m, "L"), (1_000m, "K")];

    private static readonly (decimal Size, string Suffix)[] InternationalUnits =
        [(1_000_000_000m, "B"), (1_000_000m, "M"), (1_000m, "K")];

    private static Snapshot current = Build(new MoneyFormatSettings(), BuiltInCurrencies());

    /// <summary>The settings in force.</summary>
    public static MoneyFormatSettings Settings => Volatile.Read(ref current).Settings;

    /// <summary>Installs the platform's money format. Called once at start-up.</summary>
    public static void UseSettings(MoneyFormatSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        var copy = new MoneyFormatSettings
        {
            NumberGrouping = settings.NumberGrouping,
            CurrencyMarker = settings.CurrencyMarker
        };

        Swap(snapshot => Build(copy, snapshot.Currencies.Values));
    }

    /// <summary>
    /// Installs the currency master's rules. A code the master does not hold keeps its built-in
    /// rule, so a donation in a currency deleted from the master still shows its symbol.
    /// </summary>
    public static void UseCurrencies(IEnumerable<CurrencyDisplayRule> rules)
    {
        ArgumentNullException.ThrowIfNull(rules);

        var merged = BuiltInCurrencies().ToDictionary(rule => rule.Code, StringComparer.OrdinalIgnoreCase);

        foreach (var rule in rules)
        {
            if (!string.IsNullOrWhiteSpace(rule.Code))
            {
                merged[rule.Code.Trim().ToUpperInvariant()] = rule with { Code = rule.Code.Trim().ToUpperInvariant() };
            }
        }

        Swap(snapshot => Build(snapshot.Settings, merged.Values));
    }

    /// <summary>The rule for a currency; an unknown code is marked by its code with two places.</summary>
    public static CurrencyDisplayRule RuleFor(string? currencyCode)
    {
        var code = (currencyCode ?? string.Empty).Trim().ToUpperInvariant();

        return Volatile.Read(ref current).Currencies.TryGetValue(code, out var rule)
            ? rule
            : new CurrencyDisplayRule(code, null, false, 2);
    }

    /// <summary>
    /// "₹23,81,600", "₹1,250.50", "₹23.8L" - an amount in its currency.
    /// </summary>
    /// <param name="marker">
    /// False where the currency is already named beside the figure - a column headed
    /// "Amount (₹)" - so the symbol appears only where it is needed.
    /// </param>
    public static string Format(
        decimal amount, string? currencyCode, MoneyStyle style = MoneyStyle.Standard, bool marker = true) =>
        Format(amount, RuleFor(currencyCode), style, marker);

    /// <summary>An amount under an explicit rule - a currency master row being previewed.</summary>
    public static string Format(decimal amount, CurrencyDisplayRule rule, MoneyStyle style, bool marker = true)
    {
        ArgumentNullException.ThrowIfNull(rule);

        var snapshot = Volatile.Read(ref current);
        var places = Math.Clamp(rule.DecimalPlaces, 0, 8);
        var magnitude = Math.Abs(amount);

        var (number, isZero) = style switch
        {
            MoneyStyle.Exact => Fixed(magnitude, places, snapshot),
            MoneyStyle.Whole => Fixed(magnitude, 0, snapshot),
            MoneyStyle.Compact => Compact(magnitude, snapshot),
            _ => WhenNeeded(magnitude, places, snapshot)
        };

        var sign = amount < 0m && !isZero ? "-" : string.Empty;

        if (!marker || string.IsNullOrEmpty(rule.Code))
        {
            return sign + number;
        }

        if (snapshot.Settings.CurrencyMarker == MoneyCurrencyMarker.Symbol && !string.IsNullOrWhiteSpace(rule.Symbol))
        {
            var symbol = rule.Symbol.Trim();

            if (rule.SymbolAfter)
            {
                return $"{sign}{number} {symbol}";
            }

            // "CHF 500" but "₹500" and "S$500": a symbol that ends in a letter would otherwise run
            // into the digits.
            var gap = symbol.Length > 1 && char.IsLetter(symbol[^1]) ? " " : string.Empty;
            return $"{sign}{symbol}{gap}{number}";
        }

        return rule.SymbolAfter ? $"{sign}{number} {rule.Code}" : $"{sign}{rule.Code} {number}";
    }

    /// <summary>"₹" or "INR" - the mark for a heading such as "Amount (₹)".</summary>
    public static string Marker(string? currencyCode)
    {
        var rule = RuleFor(currencyCode);

        return Settings.CurrencyMarker == MoneyCurrencyMarker.Symbol && !string.IsNullOrWhiteSpace(rule.Symbol)
            ? rule.Symbol.Trim()
            : rule.Code;
    }

    /// <summary>"1,25,000" - a count grouped the same way as the amounts beside it.</summary>
    public static string Number(long value) =>
        value.ToString("N0", Volatile.Read(ref current).Numbers);

    private static (string Number, bool IsZero) Fixed(decimal magnitude, int places, Snapshot snapshot)
    {
        var rounded = Math.Round(magnitude, places, MidpointRounding.AwayFromZero);
        return (rounded.ToString("N" + places.ToString(CultureInfo.InvariantCulture), snapshot.Numbers), rounded == 0m);
    }

    private static (string Number, bool IsZero) WhenNeeded(decimal magnitude, int places, Snapshot snapshot)
    {
        var rounded = Math.Round(magnitude, places, MidpointRounding.AwayFromZero);
        var hasFraction = rounded != decimal.Truncate(rounded);

        return Fixed(rounded, hasFraction ? places : 0, snapshot);
    }

    /// <summary>
    /// One decimal at most, and the unit chosen AFTER rounding, so 99,950 reads "1L" rather than
    /// "100K" - a figure that has already reached the next unit is written in it.
    /// </summary>
    private static (string Number, bool IsZero) Compact(decimal magnitude, Snapshot snapshot)
    {
        if (magnitude >= 1_000m)
        {
            var units = snapshot.Settings.NumberGrouping == MoneyNumberGrouping.Indian ? IndianUnits : InternationalUnits;

            foreach (var (size, suffix) in units)
            {
                var scaled = Math.Round(magnitude / size, 1, MidpointRounding.AwayFromZero);

                if (scaled >= 1m)
                {
                    var format = scaled == decimal.Truncate(scaled) ? "N0" : "N1";
                    return (scaled.ToString(format, snapshot.Numbers) + suffix, false);
                }
            }
        }

        return Fixed(magnitude, 0, snapshot);
    }

    private static void Swap(Func<Snapshot, Snapshot> change)
    {
        Snapshot before, after;

        do
        {
            before = Volatile.Read(ref current);
            after = change(before);
        }
        while (!ReferenceEquals(Interlocked.CompareExchange(ref current, after, before), before));
    }

    private static Snapshot Build(MoneyFormatSettings settings, IEnumerable<CurrencyDisplayRule> currencies)
    {
        var numbers = new NumberFormatInfo
        {
            NumberGroupSeparator = ",",
            NumberDecimalSeparator = ".",
            NegativeSign = "-",
            NumberGroupSizes = settings.NumberGrouping == MoneyNumberGrouping.Indian ? [3, 2] : [3]
        };

        return new Snapshot(
            settings,
            NumberFormatInfo.ReadOnly(numbers),
            currencies.ToDictionary(rule => rule.Code, StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>The seeded currency master, used until the master itself has been read.</summary>
    private static IEnumerable<CurrencyDisplayRule> BuiltInCurrencies() =>
    [
        new("INR", "₹", false, 2),
        new("USD", "$", false, 2),
        new("SGD", "S$", false, 2),
        new("AED", "د.إ", false, 2),
        new("GBP", "£", false, 2),
        new("EUR", "€", false, 2),
        new("CAD", "C$", false, 2),
        new("AUD", "A$", false, 2),
        new("JPY", "¥", false, 0),
        new("CNY", "¥", false, 2),
        new("ZAR", "R", false, 2),
        new("CHF", "CHF", false, 2)
    ];
}
