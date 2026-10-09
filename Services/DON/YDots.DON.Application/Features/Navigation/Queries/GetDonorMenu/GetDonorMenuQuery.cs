using YDots.DON.Application.Common.Abstractions.Persistence;
using Microsoft.Extensions.Logging;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Results;

namespace YDots.DON.Application.Features.Navigation.Queries.GetDonorMenu;

/// <summary>GET /api/v1/donors/menu. The role-aware menu for the Relationships group.</summary>
public sealed record GetDonorMenuQuery;

/// <summary>One menu item the caller is allowed to see.</summary>
public sealed record MenuItemResponse(string ScreenId, string Label, string Route, string ViewPermission);

/// <summary>
/// What the Angular sidebar renders for this section, plus the flags that decide whether a
/// sensitive field or a controlled export is offered at all.
/// </summary>
public sealed record DonorMenuResponse(
    string MenuGroup,
    IReadOnlyList<MenuItemResponse> Items,
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<string> VisibleSensitiveFields,
    bool CanSeeSensitiveContact,
    bool CanSeeConfidentialEvidence,
    bool CanExport,

    // What the caller owns and has been given - what decides whether My Leads, My Donor List and
    // the Follow-up Queue have anything in them.
    int OwnedLeadCount,
    int OwnedDonorCount,
    int AssignedFollowUpCount,

    /// <summary>True when the caller works the whole organisation rather than their own records.</summary>
    bool SeesAllRecords);

/// <summary>
/// Builds the role-based menu.
///
/// This is the extension point for role-driven navigation: the menu is derived from the
/// permission claims already inside the access token, so adding a screen means adding one row
/// to <see cref="MenuCatalogue"/> and one permission to the role in IAM. Nothing else changes,
/// and no menu table is needed.
///
/// The rule from UI section 2 still holds: hiding a menu entry is a convenience, never the
/// authorisation. Each route is rechecked by [HasPermission] when it is actually called.
/// </summary>
public sealed class GetDonorMenuQueryHandler(
    ICurrentUser currentUser,
    ILeadRepository leadRepository,
    IDonorRepository donorRepository,
    IFollowUpRepository followUpRepository,
    ILogger<GetDonorMenuQueryHandler> logger)
{
    public async Task<Result<DonorMenuResponse>> HandleAsync(
        GetDonorMenuQuery query,
        CancellationToken cancellationToken = default)
    {
        _ = query;

        logger.LogInformation("Getting donor navigation menu.");

        var permissions = currentUser.Permissions;

        // WHAT THE CALLER OWNS DECIDES TWO OF THE ENTRIES. The role flow: "if DonorCare is
        // assigned only follow-ups, not any leads or donors, then only the Follow-up Queue menu is
        // shown to them". My Leads with no leads and My Donor List with no donors are empty pages,
        // so they are withheld until there is something in them - for anybody, not only DonorCare.
        var ownedLeads = await leadRepository.CountOwnedAsync(currentUser.OrganisationId, currentUser.UserId, cancellationToken);
        var ownedDonors = await donorRepository.CountOwnedAsync(currentUser.OrganisationId, currentUser.UserId, cancellationToken);
        var assignedFollowUps = await followUpRepository.CountAssignedOpenAsync(currentUser.OrganisationId, currentUser.UserId, cancellationToken);

        var items = MenuCatalogue.VisibleFor(permissions)
            .Where(entry => entry.ScreenId switch
            {
                ScreenIds.MyLeads => ownedLeads > 0,
                ScreenIds.MyDonorList => ownedDonors > 0,
                _ => true
            })
            .Select(entry => new MenuItemResponse(entry.ScreenId, entry.Label, entry.Route, entry.ViewPermission))
            .ToList();

        var visibleSensitiveFields = MenuCatalogue.SensitiveFields
            .Where(pair => permissions.Contains(pair.Key))
            .Select(pair => pair.Value)
            .ToList();

        var response = new DonorMenuResponse(
            MenuCatalogue.MenuGroup,
            items,
            currentUser.Roles,
            [.. permissions.Where(code => code.StartsWith("don.", StringComparison.Ordinal)
                                          || string.Equals(code, PermissionCodes.DonView, StringComparison.Ordinal)).Order(StringComparer.Ordinal)],
            visibleSensitiveFields,
            currentUser.HasPermission(PermissionCodes.DonorsViewSensitiveContact),
            currentUser.HasPermission(PermissionCodes.DonorsViewConfidentialEvidence),
            currentUser.HasPermission(PermissionCodes.DonorsExport),
            ownedLeads,
            ownedDonors,
            assignedFollowUps,
            currentUser.Scope.IsOrganisationWide);

        logger.LogInformation("Donor navigation menu loaded successfully. MenuItemCount: {MenuItemCount}", items.Count);

        return Result.Success(response);
    }
}
