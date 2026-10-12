using YDot.IAM.Application.Common.Settings;
using YDot.IAM.Application.Features.Organisations.DTOs;

namespace YDot.IAM.Application.Features.Organisations.Mappings;

/// <summary>
/// What an Organisation may set each of its security settings to.
///
/// AN ORGANISATION MAY TIGHTEN THE PLATFORM POLICY, NEVER LOOSEN IT, so one end of each range is
/// the platform value in <see cref="SecuritySettings"/> and the other is a sanity bound:
///
/// <code>
/// failed sign-ins before lockout   3 .. platform     fewer is stricter
/// lockout duration (minutes)       platform .. 1440  longer is stricter
/// minimum password length          platform .. 64    longer is stricter
/// password expiry (days)           0 .. 365          0 means passwords never expire
/// idle sign-out (minutes)          5 .. platform     shorter is stricter
/// </code>
///
/// ONE DEFINITION, THREE READERS: the request validator refuses a value outside it, the save
/// clamps to it (for a caller that skipped validation), and the detail response publishes it so
/// the settings form offers exactly these ranges.
/// </summary>
public static class OrganisationSecurityLimits
{
    public static OrganisationSecurityLimitsResponse From(SecuritySettings security)
    {
        ArgumentNullException.ThrowIfNull(security);

        return new OrganisationSecurityLimitsResponse(
            MaximumFailedAccessAttempts: Range(3, security.MaximumFailedAccessAttempts),
            LockoutDurationMinutes: Range(Math.Max(1, security.LockoutMinutes), 1440),
            PasswordMinimumLength: Range(
                Math.Max(8, security.PasswordMinimumLength), Math.Min(64, security.PasswordMaximumLength)),
            PasswordExpiryDays: Range(0, 365),
            SessionIdleTimeoutMinutes: Range(5, security.SessionIdleTimeoutMinutes));
    }

    /// <summary>Keeps a range valid when the platform value sits outside its sanity bound.</summary>
    private static SecuritySettingRangeResponse Range(int minimum, int maximum) =>
        new(minimum, Math.Max(minimum, maximum));

    /// <summary>A value pulled inside its range.</summary>
    public static int Clamp(this SecuritySettingRangeResponse range, int value)
    {
        ArgumentNullException.ThrowIfNull(range);

        return Math.Clamp(value, range.Minimum, range.Maximum);
    }
}
