using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Common.Abstractions.Persistence;

/// <summary>
/// The figures behind IAM's part of the landing page that no screen already answers.
///
/// THE PLATFORM METHODS READ EVERY ORGANISATION. They step outside the Organisation filter on
/// purpose - the Platform Admin's landing page is about the platform - and the handler calls them
/// only for a SuperAdmin session with no Organisation, the same condition the Organisation
/// directory itself is gated on.
/// </summary>
public interface IIdentityDashboardReadService
{
    /// <summary>
    /// The names people read for the role codes on a token - an Organisation's own role first,
    /// the platform's when the code is a platform role.
    /// </summary>
    Task<IReadOnlyList<string>> GetRoleNamesAsync(
        IReadOnlyCollection<string> roleCodes, Guid? tenantId, CancellationToken cancellationToken);

    /// <summary>Every Organisation with its people counted. Platform only.</summary>
    Task<IReadOnlyList<PlatformTenantRow>> GetTenantsAsync(CancellationToken cancellationToken);

    /// <summary>People across every Organisation. Platform only.</summary>
    Task<PlatformUserCounts> GetUserCountsAsync(CancellationToken cancellationToken);

    /// <summary>Active people per second-step method, each person counted once per method. Platform only.</summary>
    Task<IReadOnlyList<(MfaMethodType Method, int People)>> GetMfaUsageAsync(CancellationToken cancellationToken);

    /// <summary>Every sign-in attempt since <paramref name="fromUtc"/>, newest first, bounded. Platform only.</summary>
    Task<IReadOnlyList<PlatformSignIn>> GetSignInsAsync(
        DateTimeOffset fromUtc, int maximumRows, CancellationToken cancellationToken);
}

public sealed record PlatformTenantRow(
    Guid Id,
    string Code,
    string Name,
    string Subdomain,
    TenantStatus Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? UpdatedAtUtc,
    int ActivePeople,
    int People);

public sealed record PlatformUserCounts(
    int Active,
    int Invited,
    int Suspended,
    int LockedOut,

    /// <summary>Active people who have enrolled a second sign-in step.</summary>
    int MfaEnrolled);

public sealed record PlatformSignIn(
    DateTimeOffset AttemptedAtUtc,
    bool Succeeded,
    Guid? TenantId,
    Guid? UserId);
