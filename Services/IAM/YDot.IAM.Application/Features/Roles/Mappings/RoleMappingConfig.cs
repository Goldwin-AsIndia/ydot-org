using YDot.IAM.Application.Features.Roles.DTOs;
using YDot.IAM.Domain.Entities;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.Roles.Mappings;

/// <summary>Manual mapping for the Roles slice.</summary>
public static class RoleMappingConfig
{
    public static RoleListItemResponse ToListItemResponse(
        this Role role, int permissionCount, int memberCount) =>
        new(
            role.Id,
            role.Code,
            // Name is nullable on IdentityRole. It is always populated in practice, but the
            // Code is the honest fallback rather than an empty string in the UI.
            role.Name ?? role.Code,
            role.Description,
            role.RoleType,
            DescribeRoleType(role.RoleType),
            role.Status,
            DescribeStatus(role.Status),
            role.IsSystemRole,
            role.IsDefaultRole,
            role.IsPrivileged,
            role.GrantsAllTenantPermissions,
            role.Priority,
            role.DisplayTag,
            permissionCount,
            memberCount,
            role.UpdatedAtUtc,
            role.Version);

    /// <param name="memberCount">People holding the role now - the figure the screen prints.</param>
    /// <param name="assignmentCount">
    /// Every assignment the role has ever had, revoked and expired ones included - what decides
    /// whether it may still be deleted. See <see cref="PermittedActionsFor"/>.
    /// </param>
    public static RoleDetailResponse ToDetailResponse(
        this Role role,
        IReadOnlyList<RolePermissionResponse> permissions,
        IReadOnlyList<RoleClaimResponse> claims,
        IReadOnlyList<RoleIncompatibilityResponse> incompatibilities,
        IReadOnlyList<Guid> visibleMenuIds,
        int memberCount,
        int assignmentCount) =>
        new(
            role.Id,
            role.TenantId,
            role.BusinessUnitId,
            role.Code,
            role.Name ?? role.Code,
            role.Description,
            role.RoleType,
            DescribeRoleType(role.RoleType),
            role.Status,
            DescribeStatus(role.Status),
            role.IsSystemRole,
            role.IsDefaultRole,
            role.IsPrivileged,
            role.GrantsAllTenantPermissions,
            role.Priority,
            role.DisplayTag,
            memberCount,
            role.CreatedAtUtc,
            role.CreatedByUserId,
            role.UpdatedAtUtc,
            role.UpdatedByUserId,
            role.Version,
            permissions,
            claims,
            incompatibilities,
            visibleMenuIds,
            PermittedActionsFor(role, assignmentCount));

    public static RoleLookupResponse ToLookupResponse(this Role role, int permissionCount) =>
        new(role.Id, role.Code, role.Name ?? role.Code, role.Status, role.IsPrivileged, role.IsDefaultRole, permissionCount);

    public static RolePermissionResponse ToPermissionResponse(this RolePermission rolePermission) =>
        new(
            rolePermission.Id,
            rolePermission.PermissionId,
            rolePermission.PermissionCode,
            rolePermission.Permission?.Name ?? rolePermission.PermissionCode,
            rolePermission.Permission?.ModuleCode ?? string.Empty,
            rolePermission.Permission?.GroupCode,
            rolePermission.Permission?.Action ?? PermissionAction.View,
            rolePermission.Permission?.IsSensitive ?? false,
            rolePermission.IsDenied,
            rolePermission.GrantedAtUtc,
            rolePermission.ExpiresAtUtc,
            DescribeModule(rolePermission.Permission?.ModuleCode ?? string.Empty));

    public static PermissionListItemResponse ToListItemResponse(this Permission permission) =>
        new(
            permission.Id,
            permission.Code,
            permission.Name,
            permission.Description,
            permission.ModuleCode,
            permission.GroupCode,
            permission.Action,
            permission.IsSensitive,
            permission.IsPlatformOnly,
            permission.Status,
            permission.DisplayOrder);

    /// <summary>
    /// What the role STATE allows. Permission is checked separately on each endpoint.
    ///
    /// THE ROLE SCREEN DRAWS EXACTLY THIS. It used to keep a second copy of these rules - "not
    /// for a built-in role", "only a draft can be deleted" - that disagreed with this one in both
    /// directions. The rules live here, and the handlers refuse the same things.
    ///
    /// A BUILT-IN ROLE is never deactivated or deleted: seed data, the invitation flow and PAY's
    /// donor sign-up assign these roles by code, so switching one off would strip everybody who
    /// relies on it. It can still be edited (but not renamed - see UpdateRoleCommand), and what
    /// it grants can still be changed.
    ///
    /// DELETE needs a role nobody has EVER held. A revoked or expired assignment still points at
    /// the role - the history has to stay explicable, and the database refuses the delete.
    /// </summary>
    /// <param name="assignmentCount">Every assignment the role has had, in any state.</param>
    public static IReadOnlyList<string> PermittedActionsFor(Role role, int assignmentCount)
    {
        ArgumentNullException.ThrowIfNull(role);

        var actions = new List<string> { "View", "ViewMembers" };

        if (role.Status != RoleStatus.Inactive)
        {
            actions.Add("Edit");
        }

        // The blanket-grant role has no editable permission list: the flag is the grant.
        if (!role.GrantsAllTenantPermissions)
        {
            actions.Add("AssignPermissions");
        }

        actions.Add("AssignUsers");
        actions.Add("MapMenus");

        if (role.Status == RoleStatus.Active)
        {
            // Built-in roles stay on - the administrator role above all, or an Organisation
            // could lock itself out with one click.
            if (!role.IsSystemRole)
            {
                actions.Add("Deactivate");
            }
        }
        else
        {
            actions.Add("Activate");
        }

        if (!role.IsSystemRole && assignmentCount == 0)
        {
            actions.Add("Delete");
        }

        return actions;
    }

    public static string DescribeStatus(RoleStatus status) => status switch
    {
        RoleStatus.Draft => "Draft",
        RoleStatus.Active => "Active",
        RoleStatus.Inactive => "Inactive",
        _ => status.ToString()
    };

    /// <summary>
    /// The role type in the screens' words. "Tenant" is the code's name for what every screen
    /// calls an Organisation, so a tenant role reads as an Organisation role.
    /// </summary>
    public static string DescribeRoleType(RoleType roleType) => roleType switch
    {
        RoleType.Tenant => "Organisation",
        RoleType.Platform => "Platform",
        RoleType.Template => "Template",
        _ => roleType.ToString()
    };

    /// <summary>Readable module names for the permission matrix headings.</summary>
    public static string DescribeModule(string moduleCode) => moduleCode switch
    {
        "IAM" => "Identity and Access",
        "PLATFORM" => "Platform",
        "DON" => "Donors and Leads",
        "CAM" => "Campaigns",
        "FIN" => "Finance",
        "PAY" => "Donations and Payments",
        "COM" => "Communications",
        "INV" => "Inventory",
        "GM" => "Global Masters",
        "CORE" => "Core",
        "UX" => "Workspace",
        _ => moduleCode
    };

    /// <summary>Readable group names, so the matrix reads as English rather than as codes.</summary>
    public static string DescribeGroup(string? groupCode) => groupCode switch
    {
        null or "" => "General",
        "Section" => "Section access",
        "Users" => "Users",
        "Roles" => "Roles",
        "Permissions" => "Permissions",
        "Menus" => "Navigation",
        "UserSecurity" => "User security",
        "AccessRequests" => "Access requests",
        "AccessReviews" => "Access reviews",
        "Audit" => "Audit",
        "Organisation" => "Organisation",
        "Donors" => "Donors",
        "LeadWorkQueue" => "Lead work queue",
        "LeadCapture" => "Lead capture",
        "Donor360" => "Donor 360",
        "DuplicateReview" => "Duplicate review",
        "Consent" => "Consent",
        "AssignmentBoard" => "Assignment board",
        "Verification" => "Identity verification",
        "FollowUp" => "Follow-ups",
        "Campaigns" => "Campaigns",
        "Masters" => "Master data",
        _ => groupCode
    };
}
