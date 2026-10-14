using System.Globalization;

namespace YDot.PAY.Application.Features.Dashboard;

/// <summary>
/// How every dashboard endpoint words its days, counts and shares.
///
/// COPIED INTO IAM, CAM, DON AND PAY, like the contract, so "Overdue 2d" and "13 Oct" read the same
/// whichever service sent them. The page shows the four side by side; two spellings of the same
/// date would be the first thing anybody noticed.
/// </summary>
public static class DashboardFormat
{
    private static readonly CultureInfo Words = CultureInfo.GetCultureInfo("en-GB");

    /// <summary>
    /// The viewer's zone, else <paramref name="fallbackZoneId"/>, else UTC. A name the server does
    /// not know degrades the day boundaries rather than failing the page.
    /// </summary>
    public static TimeZoneInfo ResolveZone(string? requested, string? fallbackZoneId)
    {
        foreach (var candidate in new[] { requested, fallbackZoneId })
        {
            if (string.IsNullOrWhiteSpace(candidate))
            {
                continue;
            }

            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(candidate.Trim());
            }
            catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
            {
                // Try the next one.
            }
        }

        return TimeZoneInfo.Utc;
    }

    /// <summary>The calendar day a moment falls on, in <paramref name="zone"/>.</summary>
    public static DateOnly LocalDate(DateTimeOffset moment, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(moment, zone).DateTime);

    /// <summary>The instant <paramref name="day"/> begins in <paramref name="zone"/>.</summary>
    public static DateTimeOffset StartOfDayUtc(DateOnly day, TimeZoneInfo zone)
    {
        var local = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        return new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }

    /// <summary>"13 Oct".</summary>
    public static string DayLabel(DateOnly day) => day.ToString("d MMM", Words);

    /// <summary>"Oct 26".</summary>
    public static string MonthLabel(DateOnly month) => month.ToString("MMM yy", Words);

    /// <summary>"1,286".</summary>
    public static string Count(long value) => value.ToString("N0", CultureInfo.InvariantCulture);

    /// <summary>"1 gift", "3 gifts".</summary>
    public static string Counted(long value, string singular, string plural) =>
        $"{Count(value)} {(value == 1 ? singular : plural)}";

    /// <summary>A whole-number share, or null when there is nothing to take a share of.</summary>
    public static decimal? Share(decimal part, decimal whole) =>
        whole > 0m ? Math.Round(part * 100m / whole, MidpointRounding.AwayFromZero) : null;

    /// <summary>A share to one decimal place, zero when there is no whole.</summary>
    public static decimal ShareOf(decimal part, decimal whole) =>
        whole > 0m ? Math.Round(part * 100m / whole, 1, MidpointRounding.AwayFromZero) : 0m;

    /// <summary>"Overdue 2d", "Today", "Tomorrow", "In 3d" - for something due on a day.</summary>
    public static string DueLabel(DateOnly due, DateOnly today)
    {
        var days = due.DayNumber - today.DayNumber;

        return days switch
        {
            < 0 => $"Overdue {-days}d",
            0 => "Today",
            1 => "Tomorrow",
            _ => $"In {days}d"
        };
    }

    /// <summary>"Starts in 3d", "Starts today" - for something that has not begun.</summary>
    public static string StartsLabel(DateOnly start, DateOnly today)
    {
        var days = start.DayNumber - today.DayNumber;
        return days > 0 ? $"Starts in {days}d" : "Starts today";
    }

    /// <summary>"12d left", "Ends today", "3d overdue" - for something running to an end date.</summary>
    public static string EndsLabel(DateOnly end, DateOnly today)
    {
        var days = end.DayNumber - today.DayNumber;

        return days switch
        {
            < 0 => $"{-days}d overdue",
            0 => "Ends today",
            _ => $"{days}d left"
        };
    }

    /// <summary>"Ended 3 Oct".</summary>
    public static string EndedLabel(DateOnly end) => $"Ended {DayLabel(end)}";
}
