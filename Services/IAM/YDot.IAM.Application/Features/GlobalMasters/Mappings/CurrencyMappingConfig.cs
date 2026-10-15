using System.Globalization;
using YDot.IAM.Application.Common.Formatting;
using YDot.IAM.Application.Features.GlobalMasters.DTOs;
using YDot.IAM.Domain.Entities;
using YDot.IAM.Domain.Enums;
using YDot.IAM.Domain.ValueObjects;

namespace YDot.IAM.Application.Features.GlobalMasters.Mappings;

/// <summary>Manual mapping for the Currencies slice.</summary>
public static class CurrencyMappingConfig
{
    /// <summary>
    /// The amount used to demonstrate a currency's formatting on screen - past a lakh, so the
    /// grouping the platform uses (12,34,567.50 or 1,234,567.50) is visible in the sample.
    /// </summary>
    private const decimal SampleValue = 1234567.5m;

    /// <summary>Builds a new Currency. The code is parsed rather than trimmed, so INR is INR everywhere.</summary>
    public static Currency ToEntity(this CreateCurrencyRequest request, Guid? tenantId, Guid businessUnitId)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new Currency
        {
            TenantId = tenantId,
            BusinessUnitId = businessUnitId,
            Code = CurrencyCodeValue.Parse(request.CurrencyCode).Value,
            Name = request.CurrencyName.Trim(),
            NumericCode = request.NumericCode,
            CurrencyType = request.CurrencyType,
            Symbol = Clean(request.Symbol),
            SymbolPosition = request.SymbolPosition,
            DisplayFormat = Clean(request.DisplayFormat),
            DecimalPlaces = request.DecimalPlaces,
            MinorUnitName = Clean(request.MinorUnitName),
            RoundingMode = request.RoundingMode,
            RoundingStep = request.RoundingStep,
            Status = request.Status,
            SortOrder = request.SortOrder,
            Notes = Clean(request.Notes)
        };
    }

    /// <summary>Applies an update in place. Null means "leave it alone".</summary>
    public static void ApplyTo(this UpdateCurrencyRequest request, Currency currency)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(currency);

        if (!string.IsNullOrWhiteSpace(request.CurrencyName))
        {
            currency.Name = request.CurrencyName.Trim();
        }

        if (request.NumericCode.HasValue)
        {
            currency.NumericCode = request.NumericCode;
        }

        if (request.CurrencyType.HasValue)
        {
            currency.CurrencyType = request.CurrencyType.Value;
        }

        if (request.Symbol is not null)
        {
            currency.Symbol = Clean(request.Symbol);
        }

        if (request.SymbolPosition.HasValue)
        {
            currency.SymbolPosition = request.SymbolPosition.Value;
        }

        if (request.DisplayFormat is not null)
        {
            currency.DisplayFormat = Clean(request.DisplayFormat);
        }

        if (request.DecimalPlaces.HasValue)
        {
            currency.DecimalPlaces = request.DecimalPlaces.Value;
        }

        if (request.MinorUnitName is not null)
        {
            currency.MinorUnitName = Clean(request.MinorUnitName);
        }

        if (request.RoundingMode.HasValue)
        {
            currency.RoundingMode = request.RoundingMode.Value;
        }

        // Checked before the value, so clearing wins over an accidental carry-over.
        if (request.ClearRoundingStep)
        {
            currency.RoundingStep = null;
        }
        else if (request.RoundingStep.HasValue)
        {
            currency.RoundingStep = request.RoundingStep;
        }

        if (request.SortOrder.HasValue)
        {
            currency.SortOrder = request.SortOrder.Value;
        }

        if (request.Notes is not null)
        {
            currency.Notes = Clean(request.Notes);
        }
    }

    /// <summary>One row of the grid.</summary>
    public static CurrencyListItemResponse ToListItemResponse(this Currency currency)
    {
        ArgumentNullException.ThrowIfNull(currency);

        return new CurrencyListItemResponse(
            currency.Id,
            currency.TenantId,
            currency.Code,
            currency.Name,
            currency.NumericCode,
            currency.CurrencyType,
            currency.Symbol,
            currency.SymbolPosition,
            currency.DecimalPlaces,
            FormatSample(currency),
            currency.Status,
            GlobalMasterMappingConfig.DescribeStatus(currency.Status),
            GlobalMasterMappingConfig.IsActiveFlag(currency.Status),
            currency.IsPlatformRow,
            currency.SortOrder,
            currency.UpdatedAtUtc,
            currency.Version);
    }

    /// <summary>The detail panel.</summary>
    public static CurrencyDetailResponse ToDetailResponse(
        this Currency currency, int countryUsageCount, bool isSuperAdmin)
    {
        ArgumentNullException.ThrowIfNull(currency);

        return new CurrencyDetailResponse(
            currency.Id,
            currency.TenantId,
            currency.BusinessUnitId,
            currency.Code,
            currency.Name,
            currency.NumericCode,
            currency.CurrencyType,
            currency.Symbol,
            currency.SymbolPosition,
            currency.DisplayFormat,
            currency.DecimalPlaces,
            currency.MinorUnitName,
            currency.RoundingMode,
            currency.RoundingStep,
            currency.IsZeroDecimal,
            FormatSample(currency),
            currency.Status,
            GlobalMasterMappingConfig.DescribeStatus(currency.Status),
            GlobalMasterMappingConfig.IsActiveFlag(currency.Status),
            currency.IsPlatformRow,
            currency.SortOrder,
            currency.Notes,
            countryUsageCount,
            currency.CreatedAtUtc,
            currency.CreatedByUserId,
            currency.UpdatedAtUtc,
            currency.UpdatedByUserId,
            currency.Version,
            GlobalMasterMappingConfig.PermittedActionsFor(currency, isSuperAdmin, countryUsageCount));
    }

    /// <summary>One option in a currency picker.</summary>
    public static MasterLookupResponse ToLookupResponse(this Currency currency)
    {
        ArgumentNullException.ThrowIfNull(currency);

        return new MasterLookupResponse(
            currency.Id,
            currency.Code,
            $"{currency.Code} - {currency.Name}",
            currency.Status,
            currency.IsPlatformRow,
            currency.SortOrder);
    }

    /// <summary>One line of the CSV export.</summary>
    public static CurrencyExportRow ToExportRow(this Currency currency)
    {
        ArgumentNullException.ThrowIfNull(currency);

        return new CurrencyExportRow(
            currency.Code,
            currency.Name,
            currency.NumericCode?.ToString(CultureInfo.InvariantCulture),
            currency.CurrencyType.ToString(),
            currency.Symbol,
            currency.SymbolPosition.ToString(),
            currency.DecimalPlaces.ToString(CultureInfo.InvariantCulture),
            currency.MinorUnitName,
            currency.RoundingMode.ToString(),
            currency.RoundingStep?.ToString(CultureInfo.InvariantCulture),
            currency.Status.ToString(),
            GlobalMasterMappingConfig.DescribeScope(currency.IsPlatformRow),
            currency.SortOrder.ToString(CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// A worked example of the currency's formatting, so the screen shows the EFFECT of the
    /// settings rather than making an operator infer it from four separate fields.
    ///
    /// Written by <see cref="MoneyText"/> under THIS row's symbol, position and decimal places -
    /// the rule every screen, receipt and dashboard applies - with the platform's grouping and
    /// marker. A preview built any other way would show the operator something the application
    /// never renders.
    /// </summary>
    public static string FormatSample(Currency currency)
    {
        ArgumentNullException.ThrowIfNull(currency);

        var rule = new CurrencyDisplayRule(
            currency.Code,
            currency.Symbol,
            currency.SymbolPosition == SymbolPosition.Suffix,
            currency.DecimalPlaces);

        return MoneyText.Format(Round(SampleValue, currency), rule, MoneyStyle.Exact);
    }

    /// <summary>
    /// Applies the currency's own rounding rule to an amount.
    ///
    /// The step is applied BEFORE the decimal places, because a step of 0.05 on a two-place
    /// currency has to snap to the nearest 5 paisa and then render two places - doing it the
    /// other way round rounds the snap away again.
    /// </summary>
    private static decimal Round(decimal amount, Currency currency)
    {
        var places = Math.Clamp(currency.DecimalPlaces, 0, 8);

        var midpoint = currency.RoundingMode == RoundingMode.Bankers
            ? MidpointRounding.ToEven
            : MidpointRounding.AwayFromZero;

        if (currency.RoundingStep is > 0)
        {
            var steps = amount / currency.RoundingStep.Value;

            // HalfDown has no framework equivalent, so it is expressed as "round the negated
            // value away from zero, then negate back" - which is precisely what rounding
            // towards zero at the midpoint means.
            var snapped = currency.RoundingMode == RoundingMode.HalfDown
                ? -Math.Round(-steps, 0, MidpointRounding.AwayFromZero)
                : Math.Round(steps, 0, midpoint);

            amount = snapped * currency.RoundingStep.Value;
        }

        return currency.RoundingMode == RoundingMode.HalfDown
            ? -Math.Round(-amount, places, MidpointRounding.AwayFromZero)
            : Math.Round(amount, places, midpoint);
    }

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
