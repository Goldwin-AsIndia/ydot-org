using YDots.DON.Application.Common.Settings;

namespace YDots.DON.Application.Common.Services;

/// <summary>
/// The organisation's calendar day, as UTC instants.
///
/// ONE DEFINITION OF "TODAY" FOR THE WHOLE MODULE. The Donor List's follow-up badges, the
/// Follow-up Queue's tiles and My Leads' cards all ask the same question, and answering it in UTC
/// in one place and in local time in another is how a follow-up ends up "overdue" on one screen and
/// "due today" on the next.
/// </summary>
public static class ReportingCalendar
{
    /// <summary>The start of the reporting day containing <paramref name="now"/>, and the start of the next.</summary>
    public static (DateTimeOffset StartUtc, DateTimeOffset EndUtc) Today(DateTimeOffset now, DonorSettings settings)
    {
        var zone = Resolve(settings.ReportingTimeZone);
        var local = TimeZoneInfo.ConvertTime(now, zone);
        var startLocal = new DateTimeOffset(local.Date, local.Offset);

        return (startLocal.ToUniversalTime(), startLocal.AddDays(1).ToUniversalTime());
    }

    /// <summary>The reporting-day date of an instant, for "due today" / "tomorrow" comparisons.</summary>
    public static DateOnly DateOf(DateTimeOffset instant, DonorSettings settings) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, Resolve(settings.ReportingTimeZone)).Date);

    /// <summary>
    /// Overdue / Due Today / Tomorrow / Upcoming / None for a due instant, by the organisation's
    /// calendar day.
    ///
    /// ONE VOCABULARY FOR THE DONOR LIST AND THE LEAD QUEUE, and the same day boundaries as the
    /// summary cards above them - so a card that says "2 due today" has two rows under it that say
    /// so. The SLA badge is a different question (hours until a breach) and stays where it is.
    /// </summary>
    public static string DescribeDue(DateTimeOffset? dueAtUtc, DateOnly today, DonorSettings settings)
    {
        if (dueAtUtc is null)
        {
            return "None";
        }

        var due = DateOf(dueAtUtc.Value, settings);

        if (due < today) return "Overdue";
        if (due == today) return "Due Today";
        if (due == today.AddDays(1)) return "Tomorrow";
        return "Upcoming";
    }

    private static TimeZoneInfo Resolve(string? id)
    {
        if (!string.IsNullOrWhiteSpace(id))
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        return TimeZoneInfo.Utc;
    }
}
