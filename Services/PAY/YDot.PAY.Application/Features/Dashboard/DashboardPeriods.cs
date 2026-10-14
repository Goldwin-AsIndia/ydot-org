using YDot.PAY.Application.Features.Dashboard.DTOs;

namespace YDot.PAY.Application.Features.Dashboard;

/// <summary>
/// How every outcomes endpoint reads the period it is asked about.
///
/// COPIED INTO CAM, DON AND PAY, like the contract, so the three modules count the same days: a
/// period PAY reads as 1-30 September must not be 1-29 September to DON.
/// </summary>
public static class DashboardPeriods
{
    /// <summary>The period when none is asked for: the last thirty days, today included.</summary>
    public const int DefaultDays = 30;

    /// <summary>A year and a day. Past that the curve has more points than the chart has pixels.</summary>
    public const int MaximumDays = 366;

    public const string Previous = "previous";
    public const string LastYear = "last-year";
    public const string None = "none";

    /// <summary>The period and the one it is compared with, both inclusive.</summary>
    public sealed record Period(
        DateOnly From,
        DateOnly To,
        DateOnly? CompareFrom,
        DateOnly? CompareTo,
        string Comparison)
    {
        public int Days => To.DayNumber - From.DayNumber + 1;

        /// <summary>The first day either period touches.</summary>
        public DateOnly Earliest => CompareFrom is { } compare && compare < From ? compare : From;

        /// <summary>The last day either period touches.</summary>
        public DateOnly Latest => CompareTo is { } compare && compare > To ? compare : To;
    }

    /// <summary>
    /// The period the filter asks for, or the reason it cannot be read. An end before the start is
    /// refused rather than swapped: a figure for a period somebody did not mean is worse than none.
    /// </summary>
    public static (Period? Period, string? Error) Resolve(DashboardOutcomesFilter filter, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(filter);

        var to = filter.ToDate ?? today;
        var from = filter.FromDate ?? to.AddDays(-(DefaultDays - 1));

        if (from > to)
        {
            return (null, "The period ends before it starts.");
        }

        var days = to.DayNumber - from.DayNumber + 1;

        if (days > MaximumDays)
        {
            return (null, $"Choose a period of {MaximumDays} days or fewer.");
        }

        return (filter.Comparison ?? Previous).Trim().ToLowerInvariant() switch
        {
            None => (new Period(from, to, null, null, None), null),
            LastYear => (new Period(from, to, from.AddYears(-1), to.AddYears(-1), LastYear), null),
            _ => (new Period(from, to, from.AddDays(-days), from.AddDays(-1), Previous), null)
        };
    }

    /// <summary>The comparisons on offer, worded for the period they would compare.</summary>
    public static IReadOnlyList<DashboardPeriodResponse> Comparisons(Period period) =>
    [
        new(Previous, $"Previous {period.Days} {(period.Days == 1 ? "day" : "days")}"),
        new(LastYear, "Same period last year"),
        new(None, "No comparison")
    ];

    /// <summary>"Asia/Kolkata · UTC+05:30".</summary>
    public static string ZoneLabel(TimeZoneInfo zone, DateTimeOffset now)
    {
        var offset = zone.GetUtcOffset(now);
        return $"{zone.Id} · UTC{(offset < TimeSpan.Zero ? "-" : "+")}{offset.Duration():hh\\:mm}";
    }

    /// <summary>Whether a day falls inside a period, both ends included.</summary>
    public static bool Within(DateOnly day, DateOnly? from, DateOnly? to) =>
        from is { } start && to is { } end && day >= start && day <= end;
}
