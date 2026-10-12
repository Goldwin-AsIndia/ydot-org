using Microsoft.AspNetCore.Authorization;

namespace YDots.DON.Infrastructure.Authorization;

/// <summary>
/// The caller must carry a permission claim with this exact code.
/// Created on demand by <see cref="PermissionPolicyProvider"/>.
/// </summary>
public sealed class PermissionRequirement(string permissionCode) : IAuthorizationRequirement
{
    public string PermissionCode { get; } = permissionCode;
}

/// <summary>Data scope: the caller must carry an organisation claim before any query runs.</summary>
public sealed class SameOrganisationRequirement : IAuthorizationRequirement;
