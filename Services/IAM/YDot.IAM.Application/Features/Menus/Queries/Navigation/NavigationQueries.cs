using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Abstractions.Services;
using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Application.Common.Models;
using Microsoft.Extensions.Logging;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.Common.Services;
using YDot.IAM.Application.Features.Menus.DTOs;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.Menus.Queries.Navigation;

/// <summary>The navigation the signed-in caller should render.</summary>
public sealed record GetNavigationQuery;

/// <summary>The whole catalogue as a tree, for the configuration screens.</summary>
public sealed record GetMenuCatalogueQuery(bool IncludePlatformNodes = false);

/// <summary>
/// The catalogue as the AUTHORING screen needs it.
///
/// <see cref="GetMenuCatalogueQuery"/> answers with <c>MenuNode</c>, which is what the sidebar
/// renders: a label, a route, an icon. That is deliberately not enough to edit with - it carries
/// no version to save against, no status, no description, no parent id and none of the
/// mandatory / platform-only / enabled-by-default flags. Editing through it would mean guessing
/// at half the record, so authoring gets its own read.
/// </summary>
public sealed record GetMenuDefinitionsQuery(bool IncludeRetired = false);

/// <summary>
/// The permission codes a catalogue node may be gated on, for the authoring picker.
///
/// WHY THIS IS NOT <c>GET /permissions</c>. That endpoint is gated on
/// <c>iam.permissions.view</c>, which is a TENANT permission - and a SuperAdmin standing at
/// platform level holds no tenant permissions at all, because there is no Organisation whose
/// permissions they would be viewing. So the one person who authors the catalogue was the one
/// person the picker could not load for, and it silently rendered empty. Same data, gated on
/// the permission the authoring screen actually requires.
/// </summary>
public sealed record GetMenuPermissionCodesQuery;

/// <summary>The Organisation menu configuration screen.</summary>
public sealed record GetTenantMenuConfigurationQuery;

/// <summary>The menu-mapping screen for one role.</summary>
public sealed record GetRoleMenuMappingQuery(Guid RoleId);

/// <summary>
/// Menu Configuration as a spreadsheet: the Organisation's menu, or - with a role - what that
/// role is shown.
///
/// THE SAME SEARCH AS THE SCREEN. <c>Search</c> is the text in the screen's search box and
/// matches the same five fields, keeping the headings above a match, so the file holds the rows
/// that were on screen when Export was pressed.
/// </summary>
public sealed record ExportMenuConfigurationQuery(Guid? RoleId = null, string? Search = null);

/// <summary>
/// The read side of the navigation.
///
/// <see cref="GetNavigationQuery"/> is called once by the client shell after sign-in and again
/// after every Organisation switch. Everything it returns has already been through the six
/// filters in <c>IMenuBuilderService</c>, so the client renders what it is given and has no
/// authorisation decision of its own to make.
/// </summary>
public sealed class NavigationQueryHandler(
    IMenuBuilderService menuBuilder,
    IMenuRepository menus,
    IRoleRepository roles,
    IPermissionRepository permissions,
    ITenantRepository tenants,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IExportService exports,
    ITokenHasher tokenHasher,
    IAuditService audit,
    IUnitOfWork unitOfWork,
    ILogger<NavigationQueryHandler> logger)
{
    public async Task<Result<NavigationResponse>> HandleAsync(
        GetNavigationQuery query, CancellationToken cancellationToken)
    {
        logger.LogInformation("Retrieving navigation for current user.");

        var menu = await menuBuilder.BuildForCurrentUserAsync(cancellationToken);

        // The landing route is read OFF the tree just built rather than built again. This used
        // to call ResolveLandingRouteAsync, which assembles the whole tree a second time, so
        // the one request every screen makes first did all of its work twice.
        var landing = menuBuilder.ResolveLandingRoute(menu);

        return Result.Success(new NavigationResponse(
            menu,
            landing,
            tenantContext.TenantId,
            tenantContext.TenantName,
            tenantContext.Scope,
            tenantContext.IsTenantMode,
            currentUser.IsSuperAdmin));
    }

    /// <summary>
    /// Every permission code, for the catalogue authoring picker.
    ///
    /// Codes and names only. The permission catalogue is global rather than Organisation-owned,
    /// so there is nothing here that belongs to one customer.
    /// </summary>
    public async Task<Result<IReadOnlyList<MenuPermissionOptionResponse>>> HandleAsync(
        GetMenuPermissionCodesQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        logger.LogInformation("Retrieving menu permission codes.");

        // INSIDE AN ORGANISATION, ONLY WHAT SOMEBODY THERE CAN HOLD. The picker offered all
        // twenty platform codes to an Organisation building its own menu, and choosing one saved
        // an item that nobody in the Organisation - its administrator included - could ever be
        // shown. Retired codes went the same way. The platform catalogue screen, which runs with
        // no Organisation selected, still gets the full list: a platform node may be guarded by
        // a platform permission.
        var all = tenantContext.HasTenant
            ? await permissions.GetTenantAssignableAsync(cancellationToken)
            : await permissions.GetAllAsync(cancellationToken);

        logger.LogInformation("Menu permission codes retrieved. Count: {Count}.", all.Count);

        return Result.Success<IReadOnlyList<MenuPermissionOptionResponse>>(
        [
            .. all
                .OrderBy(permission => permission.Code, StringComparer.Ordinal)
                .Select(permission => new MenuPermissionOptionResponse(
                    permission.Code, permission.Name, permission.ModuleCode))
        ]);
    }

    /// <summary>
    /// Every catalogue node, in full, as a tree.
    ///
    /// Gated by the platform manage permission on the endpoint. Retired nodes are excluded by
    /// default and available on request, because the only reason to look at one is to bring it
    /// back.
    /// </summary>
    public async Task<Result<IReadOnlyList<MenuDefinitionResponse>>> HandleAsync(
        GetMenuDefinitionsQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        logger.LogInformation("Retrieving menu definitions. IncludeRetired: {IncludeRetired}.", query.IncludeRetired);

        var all = await menus.GetCatalogueAsync(cancellationToken);

        // SCOPED TO WHAT THIS CALLER OWNS OR SHARES. This list used to be behind the platform
        // permission, where "everything" and "everything the caller may see" were the same set.
        // It is now readable by an Organisation administrator building their own menu, and
        // another Organisation's nodes are not theirs to read - the names and routes on them are
        // that charity's business.
        //
        // A caller with no Organisation is a platform administrator and sees the catalogue alone;
        // the Organisation branch adds that Organisation's own nodes to it.
        var catalogue = all
            .Where(node => node.OwnerTenantId == null
                           || node.OwnerTenantId == tenantContext.TenantId)
            .ToList();

        var nodes = query.IncludeRetired
            ? catalogue
            : catalogue.Where(node => node.Status != MenuStatus.Retired).ToList();

        var namesById = catalogue.ToDictionary(node => node.Id, node => node.Name);

        logger.LogInformation("Menu definitions retrieved. Count: {Count}.", nodes.Count);

        return Result.Success<IReadOnlyList<MenuDefinitionResponse>>(
            BuildDefinitionTree(nodes, namesById, parentId: null));
    }

    public async Task<Result<IReadOnlyList<MenuNode>>> HandleAsync(
        GetMenuCatalogueQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        logger.LogInformation("Retrieving menu catalogue. IncludePlatformNodes: {IncludePlatformNodes}.", query.IncludePlatformNodes);

        // Platform nodes are only ever included for a root user, whatever the flag asks for.
        var includePlatform = query.IncludePlatformNodes && currentUser.IsSuperAdmin;

        var tree = await menuBuilder.BuildCatalogueAsync(
            tenantContext.TenantId, includePlatform, cancellationToken);

        logger.LogInformation("Menu catalogue retrieved. Count: {Count}.", tree.Count);

        return Result.Success(tree);
    }

    /// <summary>
    /// The Organisation configuration screen: every catalogue node with this Organisation
    /// decision beside it, so an administrator sees what they have AND what they could have.
    /// </summary>
    public async Task<Result<TenantMenuConfigurationResponse>> HandleAsync(
        GetTenantMenuConfigurationQuery query, CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            logger.LogWarning("Tenant menu configuration retrieval requires a tenant context.");
            return Result.Failure<TenantMenuConfigurationResponse>(Error.TenantSelectionRequired());
        }

        var tenantId = tenantContext.RequireTenantId();
        logger.LogInformation("Retrieving tenant menu configuration. TenantId: {TenantId}.", tenantId);

        var tenant = await tenants.GetByIdAsync(tenantId, cancellationToken);
        if (tenant is null)
        {
            logger.LogWarning("Tenant not found while retrieving menu configuration. TenantId: {TenantId}.", tenantId);
            return Result.Failure<TenantMenuConfigurationResponse>(Error.TenantNotFound());
        }

        var catalogue = await menus.GetCatalogueAsync(cancellationToken);
        var tenantMenus = await menus.GetTenantMenusAsync(tenantId, cancellationToken);
        var overridesById = tenantMenus.ToDictionary(item => item.MenuDefinitionId);

        // The platform branch is not an Organisation decision, so it is excluded entirely
        // rather than shown disabled.
        var configurable = catalogue
            .Where(node => !node.IsPlatformOnly && node.Status != MenuStatus.Retired)

            // THE PLATFORM'S NODES AND THIS ORGANISATION'S OWN, AND NOTHING ELSE. The catalogue
            // read is deliberately unscoped - it is one query for a tree that is mostly shared -
            // so this is the line that keeps another Organisation's own menu items out. Without
            // it the configuration screen listed every node every charity had ever added, names
            // and routes included, and offered switches that could never affect anything.
            .Where(node => node.OwnerTenantId == null || node.OwnerTenantId == tenantId)
            .ToList();

        logger.LogInformation("Tenant menu configuration retrieved. TenantId: {TenantId}, ConfigurableCount: {Count}.", tenantId, configurable.Count);

        return Result.Success(new TenantMenuConfigurationResponse(
            tenantId,
            tenant.Name,
            BuildConfigurationTree(configurable, overridesById, parentId: null)));
    }

    /// <summary>
    /// The role mapping screen.
    ///
    /// <c>IsPermitted</c> is what makes this screen honest: a node whose permission the role
    /// does not hold is shown with the checkbox disabled, because ticking it would achieve
    /// nothing — the endpoint behind the screen would still answer 403.
    ///
    /// <c>IsEnabledForOrganisation</c> is the other half of that honesty, and it was missing.
    /// A node this Organisation has switched off on the OTHER tab of the same screen is
    /// removed from everybody's navigation before role mapping is consulted, so mapping it saved
    /// perfectly and still showed nobody anything — which, from the administrator seat, is
    /// indistinguishable from the save having been thrown away. The flag travels with the node
    /// so the screen can say which of the two levers is the one to pull.
    /// </summary>
    public async Task<Result<RoleMenuMappingResponse>> HandleAsync(
        GetRoleMenuMappingQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        logger.LogInformation("Retrieving role menu mapping. RoleId: {RoleId}.", query.RoleId);

        var role = await roles.GetWithPermissionsAsync(query.RoleId, cancellationToken);
        if (role is null)
        {
            logger.LogWarning("Role not found while retrieving menu mapping. RoleId: {RoleId}.", query.RoleId);
            return Result.Failure<RoleMenuMappingResponse>(Error.NotFound("That role was not found."));
        }

        // A PLATFORM ROLE BELONGS TO NO ORGANISATION, so no Organisation may shape its
        // navigation. The role query filter deliberately lets a null-Tenant role through —
        // that is what keeps SuperAdmin loadable from inside an Organisation — which meant
        // this endpoint answered for SUPER_ADMIN to any TenantAdmin who typed its id. The
        // lookup feeding the dropdown already excludes platform roles; this is the same rule,
        // applied where it is actually enforceable.
        if (role.IsPlatformRole)
        {
            logger.LogWarning("Role menu mapping retrieval rejected for a platform role. RoleId: {RoleId}.", query.RoleId);
            return Result.Failure<RoleMenuMappingResponse>(Error.Forbidden(
                "A platform role's navigation is not an organisation's to configure."));
        }

        // THE ROLE'S OWN ORGANISATION DECIDES THE SET, not the caller's. A role belongs to one
        // Organisation, and the nodes that can be mapped to it are the platform's plus that
        // Organisation's - never a third party's, whose node the role could never render.
        var catalogue = (await menus.GetCatalogueAsync(cancellationToken))
            .Where(node => node.OwnerTenantId == null || node.OwnerTenantId == role.TenantId)
            .ToList();

        var roleMenus = await menus.GetRoleMenusAsync(role.Id, cancellationToken);
        var mappingsById = roleMenus.ToDictionary(mapping => mapping.MenuDefinitionId);

        // What the Organisation that owns this role has switched on. Read from the role's own
        // Organisation rather than the caller's, so the answer matches what the people holding
        // the role will actually be shown.
        var tenantMenus = role.TenantId.HasValue
            ? await menus.GetTenantMenusAsync(role.TenantId.Value, cancellationToken)
            : [];

        var overridesById = tenantMenus.ToDictionary(item => item.MenuDefinitionId);

        var held = role.GrantsAllTenantPermissions
            ? null
            : role.RolePermissions
                .Where(grant => !grant.IsDenied)
                .Select(grant => grant.PermissionCode)
                .ToHashSet(StringComparer.Ordinal);

        var configurable = catalogue
            .Where(node => !node.IsPlatformOnly && node.Status != MenuStatus.Retired)
            .ToList();

        var landingMenuId = roleMenus
            .Where(mapping => mapping.IsLandingPage)
            .Select(mapping => (Guid?)mapping.MenuDefinitionId)
            .FirstOrDefault();

        logger.LogInformation("Role menu mapping retrieved. RoleId: {RoleId}, ConfigurableCount: {Count}.", role.Id, configurable.Count);

        return Result.Success(new RoleMenuMappingResponse(
            role.Id,
            role.Name ?? role.Code,
            landingMenuId,
            BuildMappingTree(configurable, mappingsById, overridesById, held, parentId: null)));
    }

    /// <summary>
    /// Menu Configuration as a CSV file.
    ///
    /// BUILT FROM THE SCREEN'S OWN TWO READS, not from a third query of its own. The rows are the
    /// configuration tree the "This organisation" view draws, and with a role, the mapping that
    /// "Role visibility" draws for it - so the file and the screen cannot disagree about a name,
    /// an order or a switch.
    ///
    /// "SHOWN TO ROLE" IS THE ANSWER THE SIDEBAR WILL GIVE, not the state of one switch. A node a
    /// role is mapped to still stays out of its members' sidebar when the role lacks the
    /// permission, when the Organisation has switched it off, when the heading above it is hidden,
    /// or when it is a heading left with nothing under it. Those are the rules MenuBuilderService
    /// applies, and the column applies them too.
    ///
    /// AUDITED, like every export: a file leaves the audit trail's sight the moment it is saved.
    /// </summary>
    public async Task<Result<ExportFile>> HandleAsync(
        ExportMenuConfigurationQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        logger.LogInformation("Exporting menu configuration. RoleId: {RoleId}.", query.RoleId);

        var configuration = await HandleAsync(new GetTenantMenuConfigurationQuery(), cancellationToken);
        if (configuration.IsFailure)
        {
            return Result.Failure<ExportFile>(configuration.Error!);
        }

        var organisation = configuration.Value!;
        var term = query.Search?.Trim() ?? string.Empty;
        var reference = tokenHasher.GenerateReference("EXP");

        // Depth-first, in the order the screen and the sidebar list them, each node with the
        // names of the headings above it.
        var walk = new List<(TenantMenuNodeResponse Node, string Path)>();

        void Walk(IReadOnlyList<TenantMenuNodeResponse> nodes, string? parentPath)
        {
            foreach (var node in nodes)
            {
                if (!MatchesSearch(node, term))
                {
                    continue;
                }

                var path = parentPath is null ? node.ResolvedName : $"{parentPath} > {node.ResolvedName}";
                walk.Add((node, path));
                Walk(node.Children, path);
            }
        }

        Walk(organisation.Nodes, null);

        ExportFile file;
        int rowCount;
        string? roleName = null;

        if (query.RoleId is { } roleId)
        {
            var mapping = await HandleAsync(new GetRoleMenuMappingQuery(roleId), cancellationToken);
            if (mapping.IsFailure)
            {
                return Result.Failure<ExportFile>(mapping.Error!);
            }

            var roleMapping = mapping.Value!;
            roleName = roleMapping.RoleName;

            var byId = new Dictionary<Guid, RoleMenuNodeResponse>();
            var shown = new HashSet<Guid>();

            void Index(IReadOnlyList<RoleMenuNodeResponse> nodes)
            {
                foreach (var node in nodes)
                {
                    byId[node.MenuDefinitionId] = node;
                    Index(node.Children);
                }
            }

            // A node is shown when its own three conditions hold and its parent is shown; a
            // heading also needs something under it shown. Children are decided first so the
            // heading can ask.
            bool Decide(RoleMenuNodeResponse node, bool parentShown)
            {
                var own = parentShown && node.IsVisible && node.IsPermitted && node.IsEnabledForOrganisation;
                var anyChild = false;

                foreach (var child in node.Children)
                {
                    anyChild |= Decide(child, own);
                }

                var result = own && (!string.IsNullOrWhiteSpace(node.Route) || anyChild);
                if (result)
                {
                    shown.Add(node.MenuDefinitionId);
                }

                return result;
            }

            Index(roleMapping.Nodes);
            foreach (var root in roleMapping.Nodes)
            {
                Decide(root, parentShown: true);
            }

            var rows = walk
                .Where(entry => byId.ContainsKey(entry.Node.MenuDefinitionId))
                .Select(entry =>
                {
                    var node = byId[entry.Node.MenuDefinitionId];
                    return new RoleMenuExportRow(
                        roleMapping.RoleName,
                        LevelLabel(entry.Node.Level),
                        entry.Path,
                        entry.Node.Code,
                        entry.Node.ResolvedName,
                        entry.Node.Route,
                        entry.Node.RequiredPermissionCode,
                        node.IsVisible,
                        node.IsPermitted,
                        node.IsEnabledForOrganisation,
                        shown.Contains(node.MenuDefinitionId),
                        roleMapping.LandingMenuId == node.MenuDefinitionId);
                })
                .ToList();

            file = exports.ToCsv(rows, "menu-visibility", reference);
            rowCount = rows.Count;
        }
        else
        {
            var rows = walk
                .Select(entry => new MenuConfigurationExportRow(
                    LevelLabel(entry.Node.Level),
                    entry.Path,
                    entry.Node.Code,
                    entry.Node.ResolvedName,
                    entry.Node.CatalogueName,
                    entry.Node.ModuleCode,
                    entry.Node.Route,
                    entry.Node.RequiredPermissionCode,
                    entry.Node.IsEnabled || entry.Node.IsMandatory,
                    entry.Node.IsMandatory,
                    entry.Node.IsOrganisationOwned,
                    !string.IsNullOrWhiteSpace(entry.Node.DisplayNameOverride),
                    !string.IsNullOrWhiteSpace(entry.Node.IconOverride),
                    entry.Node.ResolvedIcon,
                    entry.Node.ResolvedOrder))
                .ToList();

            file = exports.ToCsv(rows, "menu-configuration", reference);
            rowCount = rows.Count;
        }

        await audit.WriteAsync(
            AuditActionCodes.MenuExported, "Tenant", organisation.TenantId, organisation.TenantName,
            new { RowCount = rowCount, Reference = reference, query.RoleId, Role = roleName, query.Search },
            cancellationToken: cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Menu configuration export completed. RowCount: {RowCount}, Reference: {Reference}.", rowCount, reference);

        return Result.Success(file);
    }

    /// <summary>
    /// The screen's search: name, product name, code, route or permission, keeping a heading when
    /// anything under it matches.
    /// </summary>
    private static bool MatchesSearch(TenantMenuNodeResponse node, string term)
    {
        if (term.Length == 0)
        {
            return true;
        }

        string?[] fields = [node.ResolvedName, node.CatalogueName, node.Code, node.Route, node.RequiredPermissionCode];

        return fields.Any(field => field?.Contains(term, StringComparison.OrdinalIgnoreCase) == true)
               || node.Children.Any(child => MatchesSearch(child, term));
    }

    /// <summary>The level in the words <c>/reference-data/enums</c> serves for it.</summary>
    private static string LevelLabel(MenuLevel level) => level switch
    {
        MenuLevel.Menu => "Menu",
        MenuLevel.SubMenu => "Sub menu",
        MenuLevel.ChildSubMenu => "Child sub menu",
        _ => level.ToString()
    };

    private static List<MenuDefinitionResponse> BuildDefinitionTree(
        IReadOnlyList<Domain.Entities.MenuDefinition> nodes,
        IReadOnlyDictionary<Guid, string> namesById,
        Guid? parentId)
    {
        var result = new List<MenuDefinitionResponse>();

        foreach (var node in nodes.Where(item => item.ParentMenuId == parentId))
        {
            result.Add(new MenuDefinitionResponse(
                node.Id,
                node.Code,
                node.Name,
                node.Description,
                node.ParentMenuId,
                node.ParentMenuId is { } id && namesById.TryGetValue(id, out var name) ? name : null,
                node.Level,
                node.ModuleCode,
                node.Route,
                node.Icon,
                node.RequiredPermissionCode,
                node.DisplayOrder,
                node.Status,
                node.IsPlatformOnly,
                node.IsEnabledByDefault,
                node.IsMandatory,
                node.OpensInNewTab,
                node.BadgeKey,
                node.Version,
                node.OwnerTenantId,
                node.IsSystemDefined,
                BuildDefinitionTree(nodes, namesById, node.Id)));
        }

        return [.. result.OrderBy(node => node.DisplayOrder).ThenBy(node => node.Name, StringComparer.Ordinal)];
    }

    private static List<TenantMenuNodeResponse> BuildConfigurationTree(
        IReadOnlyList<Domain.Entities.MenuDefinition> nodes,
        IReadOnlyDictionary<Guid, Domain.Entities.TenantMenu> overridesById,
        Guid? parentId)
    {
        var result = new List<TenantMenuNodeResponse>();

        foreach (var node in nodes.Where(item => item.ParentMenuId == parentId))
        {
            overridesById.TryGetValue(node.Id, out var tenantMenu);

            var children = BuildConfigurationTree(nodes, overridesById, node.Id);

            result.Add(new TenantMenuNodeResponse(
                node.Id,
                node.Code,
                node.Name,
                string.IsNullOrWhiteSpace(tenantMenu?.DisplayNameOverride)
                    ? node.Name
                    : tenantMenu.DisplayNameOverride,
                node.Level,
                node.ModuleCode,
                node.Route,
                string.IsNullOrWhiteSpace(tenantMenu?.IconOverride) ? node.Icon : tenantMenu.IconOverride,
                node.RequiredPermissionCode,
                tenantMenu?.DisplayOrderOverride ?? node.DisplayOrder,
                // No row means "inherit the catalogue default", which is how a node shipped
                // after this Organisation was created still appears for them.
                tenantMenu?.IsEnabled ?? node.IsEnabledByDefault,
                node.IsMandatory,
                tenantMenu?.DisplayNameOverride,
                tenantMenu?.IconOverride,
                tenantMenu?.DisplayOrderOverride,
                node.OwnerTenantId is not null,
                node.Version,
                node.ParentMenuId,
                children));
        }

        return [.. result.OrderBy(node => node.ResolvedOrder).ThenBy(node => node.CatalogueName, StringComparer.Ordinal)];
    }

    private static List<RoleMenuNodeResponse> BuildMappingTree(
        IReadOnlyList<Domain.Entities.MenuDefinition> nodes,
        IReadOnlyDictionary<Guid, Domain.Entities.RoleMenu> mappingsById,
        IReadOnlyDictionary<Guid, Domain.Entities.TenantMenu> overridesById,
        IReadOnlySet<string>? heldPermissions,
        Guid? parentId)
    {
        var result = new List<(Domain.Entities.MenuDefinition Definition, RoleMenuNodeResponse Node)>();

        foreach (var node in nodes.Where(item => item.ParentMenuId == parentId))
        {
            mappingsById.TryGetValue(node.Id, out var mapping);

            var permitted = heldPermissions is null
                            || string.IsNullOrWhiteSpace(node.RequiredPermissionCode)
                            || heldPermissions.Contains(node.RequiredPermissionCode);

            // The same rule the navigation build applies: no row means "inherit the catalogue
            // default", and a mandatory node is on whatever the row says.
            var enabledForOrganisation = node.IsMandatory
                                         || (overridesById.TryGetValue(node.Id, out var tenantMenu)
                                             ? tenantMenu.IsVisible
                                             : node.IsEnabledByDefault);

            result.Add((node, new RoleMenuNodeResponse(
                node.Id,
                node.Code,
                node.Name,
                node.Level,
                node.ModuleCode,
                node.Route,
                node.RequiredPermissionCode,
                // No mapping row means visible: requiring an explicit row per role per node
                // would make a newly shipped screen invisible to everybody until somebody
                // remembered to map it.
                mapping?.IsVisible ?? true,
                permitted,
                mapping?.IsLandingPage ?? false,
                enabledForOrganisation,
                BuildMappingTree(nodes, mappingsById, overridesById, heldPermissions, node.Id))));
        }

        // THE SAME ORDER AS THE OTHER TAB, AND AS THE SIDEBAR. This sorted by name alone, so
        // the two tabs of one screen listed one menu in two different orders and neither
        // matched the navigation they describe. Display order first, name only to break a tie.
        return
        [
            .. result
                .OrderBy(entry => overridesById.TryGetValue(entry.Definition.Id, out var item)
                    ? item.ResolvedOrder
                    : entry.Definition.DisplayOrder)
                .ThenBy(entry => entry.Node.Name, StringComparer.Ordinal)
                .Select(entry => entry.Node)
        ];
    }
}

/// <summary>
/// One row of the "This organisation" export. The property names are the column headings
/// (humanised), so they read as the screen labels them.
/// </summary>
public sealed record MenuConfigurationExportRow(
    string Level,
    string Path,
    string Code,
    string Name,
    string ProductName,
    string Module,
    string? Route,
    string? RequiredPermission,
    bool InUse,
    bool AlwaysOn,
    bool AddedByOrganisation,
    bool Renamed,
    bool IconChanged,
    string? Icon,
    int Position);

/// <summary>One row of the "Role visibility" export, for one role.</summary>
public sealed record RoleMenuExportRow(
    string Role,
    string Level,
    string Path,
    string Code,
    string Name,
    string? Route,
    string? RequiredPermission,
    bool MappedToRole,
    bool RoleHoldsPermission,
    bool OnForOrganisation,
    bool ShownToRole,
    bool LandingPage);
