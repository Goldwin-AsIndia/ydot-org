using YDot.IAM.Application.Common.Models;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.DTOs;

/// <summary>Filter for the role catalogue grid.</summary>
public sealed class RoleSearchFilter : PaginationRequest
{
    public RoleStatus? Status { get; set; }

    public RoleType? RoleType { get; set; }

    public bool? IsSystemRole { get; set; }

    public bool? IsPrivileged { get; set; }

    /// <summary>Roles carrying this permission. Answers "who can approve payments?".</summary>
    public string? PermissionCode { get; set; }

    /// <summary>
    /// Roles with this owning function (the role's display tag), matched whole and ignoring case.
    /// The catalogue screen's Owning function filter and its export both send it.
    /// </summary>
    public string? DisplayTag { get; set; }
}
