using Microsoft.EntityFrameworkCore;
using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Services;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Infrastructure.Persistence.ReadServices;

/// <summary>
/// IAM's landing-page figures, counted in the database.
///
/// THE PLATFORM READS IGNORE THE ORGANISATION FILTER, which is the reason this class exists apart
/// from the screens' read services: the Platform Admin's landing page counts every Organisation.
/// The handler is what makes that safe - it calls them only for a SuperAdmin session with no
/// Organisation. People are counted the way the Users screen counts them: platform accounts,
/// which belong to no Organisation, are left out.
/// </summary>
public sealed class IdentityDashboardReadService(
    IamDbContext context,
    IDateTimeProvider clock) : IIdentityDashboardReadService
{
    public async Task<IReadOnlyList<string>> GetRoleNamesAsync(
        IReadOnlyCollection<string> roleCodes, Guid? tenantId, CancellationToken cancellationToken)
    {
        if (roleCodes.Count == 0)
        {
            return [];
        }

        var codes = roleCodes.Select(code => code.Trim().ToUpperInvariant()).Distinct().ToList();

        var roles = await context.Roles
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(role => codes.Contains(role.NormalizedCode)
                           && (role.TenantId == tenantId || role.TenantId == null))
            .Select(role => new { role.NormalizedCode, role.Name, role.TenantId, role.Priority })
            .ToListAsync(cancellationToken);

        // The Organisation's own copy of a role wins over a platform one of the same code, and the
        // highest-priority role is named first - the order the rest of the product labels people by.
        return
        [
            .. roles
                .GroupBy(role => role.NormalizedCode)
                .Select(group => group.OrderByDescending(role => role.TenantId != null).First())
                .OrderByDescending(role => role.Priority)
                .Select(role => role.Name ?? role.NormalizedCode)
                .Where(name => !string.IsNullOrWhiteSpace(name))
        ];
    }

    public async Task<IReadOnlyList<PlatformTenantRow>> GetTenantsAsync(CancellationToken cancellationToken)
    {
        var tenants = await context.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Select(tenant => new
            {
                tenant.Id,
                tenant.Code,
                tenant.Name,
                tenant.Subdomain,
                tenant.Status,
                tenant.CreatedAtUtc,
                tenant.UpdatedAtUtc
            })
            .ToListAsync(cancellationToken);

        var people = await context.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId != null
                           && user.Status != UserStatus.Withdrawn
                           && user.Status != UserStatus.Draft)
            .GroupBy(user => user.TenantId)
            .Select(group => new
            {
                TenantId = group.Key,
                Active = group.Count(user => user.Status == UserStatus.Active),
                All = group.Count()
            })
            .ToListAsync(cancellationToken);

        var byTenant = people.ToDictionary(row => row.TenantId!.Value);

        return
        [
            .. tenants.Select(tenant => new PlatformTenantRow(
                tenant.Id,
                tenant.Code,
                tenant.Name,
                tenant.Subdomain,
                tenant.Status,
                tenant.CreatedAtUtc,
                tenant.UpdatedAtUtc,
                byTenant.TryGetValue(tenant.Id, out var counted) ? counted.Active : 0,
                byTenant.TryGetValue(tenant.Id, out var all) ? all.All : 0))
        ];
    }

    public async Task<PlatformUserCounts> GetUserCountsAsync(CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;

        var users = context.Users
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(user => user.TenantId != null);

        var counts = await users
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Active = group.Count(user => user.Status == UserStatus.Active),
                Invited = group.Count(user => user.Status == UserStatus.Invited),
                Suspended = group.Count(user => user.Status == UserStatus.Suspended),
                LockedOut = group.Count(user => user.IsLockedOutByAdministrator
                                                || (user.LockoutEnd != null && user.LockoutEnd > now)),
                MfaEnrolled = group.Count(user => user.Status == UserStatus.Active && user.TwoFactorEnabled)
            })
            .FirstOrDefaultAsync(cancellationToken);

        return counts is null
            ? new PlatformUserCounts(0, 0, 0, 0, 0)
            : new PlatformUserCounts(counts.Active, counts.Invited, counts.Suspended, counts.LockedOut, counts.MfaEnrolled);
    }

    public async Task<IReadOnlyList<(MfaMethodType Method, int People)>> GetMfaUsageAsync(
        CancellationToken cancellationToken)
    {
        var rows = await context.MfaMethods
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(method => method.Status == MfaMethodStatus.Active
                             && method.User != null
                             && method.User.TenantId != null
                             && method.User.Status == UserStatus.Active)
            .Select(method => new { method.MethodType, method.UserId })
            .Distinct()
            .GroupBy(method => method.MethodType)
            .Select(group => new { Method = group.Key, People = group.Count() })
            .ToListAsync(cancellationToken);

        return [.. rows.OrderByDescending(row => row.People).Select(row => (row.Method, row.People))];
    }

    public async Task<IReadOnlyList<PlatformSignIn>> GetSignInsAsync(
        DateTimeOffset fromUtc, int maximumRows, CancellationToken cancellationToken) =>
        await context.SignInAttempts
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(attempt => attempt.AttemptedAtUtc >= fromUtc)
            .OrderByDescending(attempt => attempt.AttemptedAtUtc)
            .Take(maximumRows)
            .Select(attempt => new PlatformSignIn(
                attempt.AttemptedAtUtc,
                attempt.Succeeded,
                attempt.TenantId,
                attempt.UserId))
            .ToListAsync(cancellationToken);
}
