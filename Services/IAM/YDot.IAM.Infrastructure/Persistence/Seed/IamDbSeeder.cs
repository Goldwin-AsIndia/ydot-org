using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Application.Common.Settings;
using YDot.IAM.Domain.Entities;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Infrastructure.Persistence.Seed;

/// <summary>
/// Initialises a fresh database, and reconciles an existing one.
///
/// IT IS IDEMPOTENT, WHICH IS THE WHOLE DESIGN. Every step asks "does this already exist?"
/// before inserting, so the seeder runs on every start without duplicating anything. That is
/// what lets a newly added permission or menu node appear simply by deploying, with no
/// hand-written migration and no manual step somebody forgets.
///
/// THE ORDER MATTERS, because each step depends on the one before:
///
/// <code>
/// 1. BusinessUnit          the root everything hangs off
/// 2. Permissions           the global catalogue, from code
/// 3. Menu definitions      the global navigation, from code
/// 4. Platform role         SUPER_ADMIN ("Platform Admin"), TenantId null
/// 5. Platform admins       the configured root account, then the named administrators
/// 6. Sample Organisations  two Active, two Invited - see SampleOrganisationCatalogue
/// 7. Their structure       departments and branches, Active Organisations only
/// 8. Their people          administrator, staff and donors
/// </code>
///
/// IT WRITES THROUGH THE DbContext WITH FILTERS BYPASSED. There is no request and therefore
/// no ambient Organisation, so every insert names its Organisation explicitly.
/// </summary>
public sealed class IamDbSeeder(
    IamDbContext context,
    IPasswordHasher passwordHasher,
    ITokenHasher tokenHasher,
    IOptions<SeedSettings> seedOptions,
    IOptions<SecuritySettings> securityOptions,
    ILogger<IamDbSeeder> logger)
{
    private readonly SeedSettings _seed = seedOptions.Value;
    private readonly SecuritySettings _security = securityOptions.Value;

    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_seed.Enabled)
        {
            logger.LogInformation("Seeding is disabled.");
            return;
        }

        var businessUnit = await SeedBusinessUnitAsync(cancellationToken);

        if (_seed.SeedCatalogues)
        {
            await SeedPermissionsAsync(cancellationToken);
            await SeedMenuDefinitionsAsync(cancellationToken);
        }

        // Saved here so the catalogue rows have ids before anything references them.
        await context.SaveChangesAsync(cancellationToken);

        var platformRole = await SeedPlatformRoleAsync(businessUnit, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        var rootAdministrator = await SeedSuperAdminAsync(businessUnit, platformRole, cancellationToken);
        await SeedPlatformAdministratorsAsync(businessUnit, platformRole, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        if (_seed.SeedSampleTenants)
        {
            foreach (var sample in SampleOrganisationCatalogue.Organisations)
            {
                var tenant = await SeedSampleTenantAsync(
                    businessUnit, sample, rootAdministrator, cancellationToken);

                await context.SaveChangesAsync(cancellationToken);

                // EVERY START, NOT ONLY THE FIRST, and each step saved before the next. The two
                // passes below add only what is missing, so an Organisation that already exists
                // picks up a department or a person added to the catalogue since it was created.
                //
                // THE SAVE BETWEEN THEM IS LOAD-BEARING. The people pass looks the Organisation's
                // roles, departments and branches up from the DATABASE; run against rows that
                // existed only in the change tracker, those lookups came back empty on a fresh
                // database and every account was skipped as "role not found" - which is exactly
                // how the demonstration logins once went missing on the one database that matters
                // most, the one a colleague starts from nothing.
                //
                // Departments and branches belong to Active Organisations only: an invited one
                // has not onboarded, and its administrator sets them up after approval.
                if (sample.IsActive)
                {
                    await SeedOrganisationStructureAsync(tenant, sample, cancellationToken);
                    await context.SaveChangesAsync(cancellationToken);
                }

                await SeedOrganisationPeopleAsync(tenant, sample, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
            }
        }

        // AFTER the Organisations exist, because it reconciles what they hold.
        if (_seed.SeedCatalogues)
        {
            await ReconcileTenantMenusAsync(cancellationToken);

            // MISSING ROLES FIRST, then their grants. The permission reconcile below only fills
            // rows into roles that already exist, so a role ADDED to the blueprint after an
            // Organisation was created reached nobody: the Organisation simply never had it, and
            // every permission that lived only in that role belonged to no role at all on that
            // database. Creating them here first means the grant pass that follows sees them.
            await ReconcileTenantRolesAsync(cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            await ReconcileSystemRolePermissionsAsync(cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            // AFTER THE ROLES EXIST, because a conflict names two of them by id. See the note on
            // RoleConflicts for why the catalogue currently records none.
            await ReconcileRoleIncompatibilitiesAsync(cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            // AFTER the grants, because what a role may SEE is computed from what it may DO.
            await ReconcileRoleMenusAsync(cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            // LAST, because it reads the roles the three passes above have finished settling.
            await RetireUnknownSystemRolesAsync(cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
        }

        logger.LogInformation("Seeding complete.");
    }

    /// <summary>The root platform entity: www.ngoplanet.com.</summary>
    private async Task<BusinessUnit> SeedBusinessUnitAsync(CancellationToken cancellationToken)
    {
        var code = _seed.BusinessUnitCode.ToUpperInvariant();

        var existing = await context.BusinessUnits
            .FirstOrDefaultAsync(unit => unit.Code == code, cancellationToken);

        if (existing is not null)
        {
            return existing;
        }

        var businessUnit = new BusinessUnit
        {
            Code = code,
            Name = _seed.BusinessUnitName,
            LegalName = _seed.BusinessUnitName,
            RootDomain = _seed.RootDomain.ToLowerInvariant(),
            Status = BusinessUnitStatus.Active,
            ContactEmail = _seed.SuperAdminEmail,
            SupportEmail = _seed.SuperAdminEmail,
            TimeZone = "Asia/Kolkata",
            DefaultCurrency = "INR",
            DefaultCulture = "en-IN",
            Description = "Root business unit for the YDot platform.",
            CreatedAtUtc = DateTimeOffset.UtcNow,
            CreatedByUserId = Guid.Empty
        };

        await context.BusinessUnits.AddAsync(businessUnit, cancellationToken);

        logger.LogInformation(
            "Seeded business unit {Code} on {RootDomain}.", businessUnit.Code, businessUnit.RootDomain);

        return businessUnit;
    }

    /// <summary>
    /// The global permission catalogue, reconciled from code.
    ///
    /// Every code from <c>PermissionCodes</c> and <c>ModulePermissionCatalogue</c> is checked
    /// and inserted if missing. That is how a permission added in a later release reaches an
    /// existing database — deploy, restart, and it is there.
    /// </summary>
    private async Task SeedPermissionsAsync(CancellationToken cancellationToken)
    {
        var existing = await context.Permissions
            .Select(permission => permission.Code)
            .ToListAsync(cancellationToken);

        var known = existing.ToHashSet(StringComparer.Ordinal);
        var added = 0;
        var order = 0;

        // ---- IAM Tenant codes ------------------------------------------------------------
        foreach (var code in PermissionCodes.AllTenant)
        {
            order += 10;

            if (known.Contains(code))
            {
                continue;
            }

            await context.Permissions.AddAsync(BuildPermission(code, order, isPlatformOnly: false), cancellationToken);
            added++;
        }

        // ---- Platform codes. Marked IsPlatformOnly, which is what keeps them off Tenant roles.
        foreach (var code in PermissionCodes.Platform.All)
        {
            order += 10;

            if (known.Contains(code))
            {
                continue;
            }

            await context.Permissions.AddAsync(BuildPermission(code, order, isPlatformOnly: true), cancellationToken);
            added++;
        }

        // ---- The other services codes ---------------------------------------------------------
        //
        // Seeded here because IAM is the only service that can put a claim into a token, so a
        // code that does not exist here is a code the Donors service can never receive.
        foreach (var seed in ModulePermissionCatalogue.AllOtherModules)
        {
            order += 10;

            if (known.Contains(seed.Code))
            {
                continue;
            }

            await context.Permissions.AddAsync(new Permission
            {
                Code = seed.Code,
                Name = seed.Name,
                Description = seed.Description,
                ModuleCode = seed.ModuleCode,
                GroupCode = seed.GroupCode,
                Action = seed.Action,
                IsSensitive = seed.IsSensitive,
                IsPlatformOnly = seed.IsPlatformOnly,
                Status = PermissionStatus.Active,
                DisplayOrder = order,
                CreatedAtUtc = DateTimeOffset.UtcNow,
                CreatedByUserId = Guid.Empty
            }, cancellationToken);

            added++;
        }

        if (added > 0)
        {
            logger.LogInformation("Seeded {Count} permission(s).", added);
        }
    }

    /// <summary>
    /// Turns a dotted code into a catalogue row.
    ///
    /// The module, group, action and name are all derived from the code itself, so adding a
    /// permission means adding one string to <c>PermissionCodes</c> and nothing else.
    /// </summary>
    private static Permission BuildPermission(string code, int displayOrder, bool isPlatformOnly)
    {
        // THE DERIVATION MOVED OUT OF HERE, into PermissionCodeConventions, and it had to.
        // RoleAccessProfiles decides whether the maker or the checker holds a code by asking what
        // action it is, and while this method was the only place that knew, the profile had to
        // guess - so a code this method filed as Approve could land in the maker role, which is
        // the one outcome the split exists to prevent. One derivation, two callers, no drift.
        return new Permission
        {
            Code = code,
            Name = PermissionCodeConventions.DeriveName(code),
            Description = null,
            ModuleCode = PermissionCodeConventions.DeriveModule(code),
            GroupCode = PermissionCodeConventions.DeriveGroup(code),
            Action = PermissionCodeConventions.DeriveAction(code),
            IsSensitive = PermissionCodes.IsSensitive(code),
            IsPlatformOnly = isPlatformOnly,
            Status = PermissionStatus.Active,
            DisplayOrder = displayOrder,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            CreatedByUserId = Guid.Empty
        };
    }


    /// <summary>The global navigation catalogue, reconciled from <c>MenuCatalogue</c>.</summary>
    private async Task SeedMenuDefinitionsAsync(CancellationToken cancellationToken)
    {
        // PLATFORM ROWS ONLY. An Organisation may now add nodes of its own, and those are no part
        // of this reconciliation: their codes are unique only within their Organisation, so
        // keying the whole table by Code would let one charity's "REPORTS" shadow the catalogue
        // seed of the same name - and the retire pass below would then file away every node no
        // code file has ever heard of, which is all of them.
        var existing = await context.MenuDefinitions
            .Where(menu => menu.OwnerTenantId == null)
            .ToDictionaryAsync(menu => menu.Code, StringComparer.Ordinal, cancellationToken);

        var added = 0;
        var updated = 0;

        // TWO PASSES, because a child cannot resolve its parent id until the parent exists.
        // Ordered by level so parents are always created first.
        foreach (var seed in MenuCatalogue.All.OrderBy(node => node.Level))
        {
            Guid? parentId = null;

            if (!string.IsNullOrWhiteSpace(seed.ParentCode))
            {
                if (!existing.TryGetValue(seed.ParentCode, out var parent))
                {
                    logger.LogWarning(
                        "Menu node {Code} names parent {ParentCode}, which does not exist. Skipped.",
                        seed.Code, seed.ParentCode);

                    continue;
                }

                parentId = parent.Id;
            }

            // RECONCILE, DO NOT SKIP. This used to `continue` the moment a code was already
            // present, which made the catalogue write-once: renaming a screen, correcting a
            // route, tightening a permission or switching a branch off reached a fresh database
            // and no other. Every deployment that had ever started kept the original list
            // forever, and nothing failed loudly enough to notice.
            //
            // Status is deliberately NOT reconciled. The catalogue describes what the software
            // contains; whether an operator has hidden or retired a node is their decision and
            // is not code's to overwrite.
            if (existing.TryGetValue(seed.Code, out var current))
            {
                var changed =
                    current.Name != seed.Name
                    || current.ParentMenuId != parentId
                    || current.Level != seed.Level
                    || current.ModuleCode != seed.ModuleCode
                    || current.Route != seed.Route
                    || current.Icon != seed.Icon
                    || current.RequiredPermissionCode != seed.RequiredPermissionCode
                    || current.DisplayOrder != seed.DisplayOrder
                    || current.IsPlatformOnly != seed.IsPlatformOnly
                    || current.IsEnabledByDefault != seed.IsEnabledByDefault
                    || current.IsMandatory != seed.IsMandatory;

                if (changed)
                {
                    current.Name = seed.Name;
                    current.ParentMenuId = parentId;
                    current.Level = seed.Level;
                    current.ModuleCode = seed.ModuleCode;
                    current.Route = seed.Route;
                    current.Icon = seed.Icon;
                    current.RequiredPermissionCode = seed.RequiredPermissionCode;
                    current.DisplayOrder = seed.DisplayOrder;
                    current.IsPlatformOnly = seed.IsPlatformOnly;
                    current.IsEnabledByDefault = seed.IsEnabledByDefault;
                    current.IsMandatory = seed.IsMandatory;

                    updated++;
                }

                continue;
            }

            var definition = new MenuDefinition
            {
                Code = seed.Code,
                Name = seed.Name,
                ParentMenuId = parentId,
                Level = seed.Level,
                ModuleCode = seed.ModuleCode,
                Route = seed.Route,
                Icon = seed.Icon,
                RequiredPermissionCode = seed.RequiredPermissionCode,
                DisplayOrder = seed.DisplayOrder,
                Status = MenuStatus.Active,
                IsPlatformOnly = seed.IsPlatformOnly,
                IsEnabledByDefault = seed.IsEnabledByDefault,
                IsMandatory = seed.IsMandatory,

                // WRITTEN BY THE PLATFORM, and both of these say so. The retire pass below acts
                // only on rows carrying IsSystemDefined, so an administrator's own menu is never
                // filed away by a deploy.
                OwnerTenantId = null,
                IsSystemDefined = true,

                CreatedAtUtc = DateTimeOffset.UtcNow,
                CreatedByUserId = Guid.Empty
            };

            await context.MenuDefinitions.AddAsync(definition, cancellationToken);

            // Added to the lookup immediately so the next node in this same pass can use it
            // as a parent without a round trip.
            existing[seed.Code] = definition;
            added++;
        }

        // ---- Nodes the catalogue no longer contains ------------------------------------------
        //
        // RETIRED, NOT DELETED. Removing a screen from the catalogue has to reach a database that
        // already has it, or withdrawing a screen only ever works on a deployment that has never
        // run - the same write-once gap as the update path above, one level up. A definition that
        // is simply deleted would take an Organisation's own overrides and any role mapping with
        // it, so the row stays and is marked Retired; the menu builder already drops those, and
        // restoring the catalogue entry brings it back exactly as it was.
        var known = MenuCatalogue.All.Select(seed => seed.Code).ToHashSet(StringComparer.Ordinal);
        var retired = 0;

        // ONLY ROWS THE SEEDER WROTE. `existing` is already limited to platform rows, and
        // IsSystemDefined narrows it again to the ones this catalogue actually produced - so a
        // node a platform administrator created by hand through the API survives a restart too.
        // Retiring it would have been the same silent data loss as retiring an Organisation's.
        foreach (var orphan in existing.Values.Where(menu =>
                     menu.IsSystemDefined
                     && !known.Contains(menu.Code)
                     && menu.Status != MenuStatus.Retired))
        {
            orphan.Status = MenuStatus.Retired;
            retired++;
        }

        if (added > 0 || updated > 0 || retired > 0)
        {
            logger.LogInformation(
                "Menu catalogue reconciled: {Added} added, {Updated} updated, {Retired} retired.",
                added, updated, retired);
        }
    }

    /// <summary>
    /// Brings every Organisation's SYSTEM-GENERATED navigation back into line with the catalogue.
    ///
    /// An Organisation does not read the catalogue directly. At creation it is given a
    /// <c>TenantMenu</c> row per enabled node, and that row is what the sidebar is built from —
    /// which is the whole point, because it is the thing an administrator can then override per
    /// Organisation.
    ///
    /// The consequence is that changing the catalogue alone changes nothing for anybody who
    /// already exists. Switching a branch off reached new Organisations only; every existing one
    /// kept an explicit row saying "enabled", and that row wins. The same gap in reverse meant a
    /// newly added screen never appeared for an Organisation created before it.
    ///
    /// ONLY SYSTEM-GENERATED ROWS ARE TOUCHED. The moment an administrator changes a node for
    /// their Organisation, <c>IsSystemGenerated</c> is cleared and this leaves it alone for good
    /// — their decision outranks the default, which is what an override is for.
    /// </summary>
    /// <summary>
    /// Brings each seeded role's permission rows back in line with its definition in code.
    ///
    /// WITHOUT THIS, A PERMISSION ADDED TO A ROLE ONLY EVER REACHES A DATABASE THAT HAS NEVER
    /// BEEN SEEDED. Roles are created inside <c>SeedSampleTenantAsync</c>, which returns at its
    /// first line when the Organisation already exists - so on every upgraded database the roles
    /// keep whatever grant they were first created with, no matter what the definitions now say.
    /// <c>SeedPermissionsAsync</c> already reconciles the catalogue for exactly this reason; the
    /// grants needed the same treatment and did not have it.
    ///
    /// IT ONLY ADDS. A row that is present and no longer in the definition is left alone, because
    /// this cannot tell a stale grant apart from one an administrator added on purpose, and
    /// silently revoking the second to tidy up the first is the worse mistake by a distance.
    ///
    /// AND IT DOES NOT ADD BACK WHAT AN ADMINISTRATOR REMOVED. A code they took out of a system
    /// role is recorded on the role (<c>WithheldPermissionCodes</c>) and skipped here, so their
    /// decision survives a restart the same way an extra grant always has.
    ///
    /// SYSTEM ROLES ONLY - <c>IsSystemRole</c>, which is set only by this seeder. A role somebody
    /// created in the Role Catalogue is theirs and is never touched. A blanket-grant role is
    /// skipped too: the flag is the grant, and rows would add nothing.
    /// </summary>
    /// <summary>
    /// Creates any blueprint role an existing Organisation does not have.
    ///
    /// WHY IT IS NEEDED. Roles are copied into an Organisation when it is created, and that copy
    /// is a one-off. Adding a role to <see cref="TenantRoleDefinitions"/> afterwards therefore
    /// reached new Organisations only - so DATA_STEWARD and DONOR_CARE, and the eighteen donor
    /// permissions that live in them, would have existed on a fresh database and nowhere else.
    ///
    /// IT ONLY EVER ADDS. An Organisation that has renamed, re-scoped or deactivated its copy of
    /// a role keeps its own version untouched: the match is on the code, and a role already
    /// present is left exactly as the Organisation left it.
    /// </summary>
    private async Task ReconcileTenantRolesAsync(CancellationToken cancellationToken)
    {
        var tenants = await context.Tenants
            .IgnoreQueryFilters()
            .Select(tenant => new { tenant.Id, tenant.BusinessUnitId, tenant.Code })
            .ToListAsync(cancellationToken);

        if (tenants.Count == 0)
        {
            return;
        }

        var existing = (await context.Roles
                .IgnoreQueryFilters()
                .Where(role => role.TenantId != null)
                .Select(role => new { TenantId = role.TenantId!.Value, role.NormalizedCode })
                .ToListAsync(cancellationToken))
            .GroupBy(role => role.TenantId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(item => item.NormalizedCode).ToHashSet(StringComparer.Ordinal));

        var now = DateTimeOffset.UtcNow;
        var added = 0;

        foreach (var tenant in tenants)
        {
            var held = existing.TryGetValue(tenant.Id, out var codes)
                ? codes
                : new HashSet<string>(StringComparer.Ordinal);

            foreach (var definition in TenantRoleDefinitions.All)
            {
                if (held.Contains(definition.Code))
                {
                    continue;
                }

                await context.Roles.AddAsync(new Role
                {
                    TenantId = tenant.Id,
                    BusinessUnitId = tenant.BusinessUnitId,
                    Code = definition.Code,
                    NormalizedCode = definition.Code,
                    Name = definition.Name,
                    NormalizedName = definition.Name.ToUpperInvariant(),
                    Description = definition.Description,
                    RoleType = RoleType.Tenant,
                    Status = RoleStatus.Active,
                    IsSystemRole = true,
                    IsDefaultRole = definition.IsDefault,
                    GrantsAllTenantPermissions = definition.GrantsAll,
                    IsPrivileged = definition.IsPrivileged,
                    Priority = definition.Priority,
                    CreatedAtUtc = now,
                    CreatedByUserId = Guid.Empty
                }, cancellationToken);

                held.Add(definition.Code);
                added++;
            }
        }

        if (added > 0)
        {
            logger.LogInformation(
                "Reconciled Organisation roles: {Added} missing role(s) created across {TenantCount} Organisation(s).",
                added, tenants.Count);
        }
    }

    /// <summary>
    /// The segregation-of-duties rules every Organisation gets.
    ///
    /// NONE AT PRESENT, and that follows from the role catalogue rather than being an oversight.
    /// The one rule this list held - nobody holds INITIATOR and APPROVER at once - existed because
    /// those two were the maker and the checker for EVERY module, so one person holding both could
    /// decide their own work anywhere. The Managers that replaced APPROVER are maker and checker
    /// by design, and the four-eyes rule moved onto the record: CAM refuses an approval from
    /// whoever created or submitted the campaign, the asset or the budget version. A blocking rule
    /// between an Executive and their Manager would refuse a combination the Manager already
    /// holds on its own.
    ///
    /// THE MECHANISM STAYS. <c>CheckSegregationOfDutiesAsync</c> runs on every path that grants a
    /// role, and the only way to record a rule through the product is the Create Draft Role
    /// dialog, which names conflicts for a role being CREATED - so a rule between two built-in
    /// roles can only ever come from here. Rules added are BLOCKING, and do not unpick what an
    /// account already holds: removing somebody's access on a start-up pass, with no operator
    /// involved and no record of the decision, would be far worse than leaving a known
    /// combination in place for somebody to resolve.
    /// </summary>
    private static readonly (string RoleCode, string ConflictingRoleCode, string Reason)[]
        RoleConflicts = [];

    /// <summary>
    /// Records the conflicts above in every Organisation that has both roles.
    ///
    /// STORED ONCE PER PAIR, not twice. The rule is symmetric and the check asks whether BOTH
    /// role ids appear in the person's combined set, so a mirrored row would add nothing and
    /// report every conflict twice to whoever hit it.
    /// </summary>
    private async Task ReconcileRoleIncompatibilitiesAsync(CancellationToken cancellationToken)
    {
        var tenants = await context.Tenants
            .IgnoreQueryFilters()
            .Select(tenant => new { tenant.Id, tenant.BusinessUnitId, tenant.Code })
            .ToListAsync(cancellationToken);

        if (tenants.Count == 0)
        {
            return;
        }

        var roles = await context.Roles
            .IgnoreQueryFilters()
            .Where(role => role.TenantId != null)
            .Select(role => new { TenantId = role.TenantId!.Value, role.Id, role.Code })
            .ToListAsync(cancellationToken);

        var rolesByTenant = roles
            .GroupBy(role => role.TenantId)
            .ToDictionary(
                group => group.Key,
                group => group.ToDictionary(
                    role => role.Code, role => role.Id, StringComparer.Ordinal));

        // Every pair already recorded, in both directions, so an administrator who added the
        // rule by hand - or added it the other way round - is recognised rather than duplicated.
        var present = (await context.RoleIncompatibilities
                .IgnoreQueryFilters()
                .Select(rule => new { rule.TenantId, rule.RoleId, rule.ConflictingRoleId })
                .ToListAsync(cancellationToken))
            .SelectMany(rule => new[]
            {
                (rule.TenantId, First: rule.RoleId, Second: rule.ConflictingRoleId),
                (rule.TenantId, First: rule.ConflictingRoleId, Second: rule.RoleId)
            })
            .ToHashSet();

        var now = DateTimeOffset.UtcNow;
        var added = 0;

        foreach (var tenant in tenants)
        {
            if (!rolesByTenant.TryGetValue(tenant.Id, out var tenantRoles))
            {
                continue;
            }

            foreach (var conflict in RoleConflicts)
            {
                if (!tenantRoles.TryGetValue(conflict.RoleCode, out var roleId)
                    || !tenantRoles.TryGetValue(conflict.ConflictingRoleCode, out var conflictingRoleId))
                {
                    continue;
                }

                if (present.Contains((tenant.Id, roleId, conflictingRoleId)))
                {
                    continue;
                }

                await context.RoleIncompatibilities.AddAsync(new RoleIncompatibility
                {
                    TenantId = tenant.Id,
                    BusinessUnitId = tenant.BusinessUnitId,
                    RoleId = roleId,
                    ConflictingRoleId = conflictingRoleId,
                    Reason = conflict.Reason,
                    IsBlocking = true,
                    IsActive = true,
                    CreatedAtUtc = now,
                    CreatedByUserId = Guid.Empty,
                    Version = 1
                }, cancellationToken);

                present.Add((tenant.Id, roleId, conflictingRoleId));
                present.Add((tenant.Id, conflictingRoleId, roleId));
                added++;
            }
        }

        if (added > 0)
        {
            logger.LogInformation(
                "Recorded {Added} segregation-of-duties rule(s) across {TenantCount} Organisation(s).",
                added, tenants.Count);
        }
    }

    private async Task ReconcileSystemRolePermissionsAsync(CancellationToken cancellationToken)
    {
        var definitions = TenantRoleDefinitions.All
            .Where(definition => !definition.GrantsAll)
            .ToDictionary(definition => definition.Code, StringComparer.Ordinal);

        if (definitions.Count == 0)
        {
            return;
        }

        var permissions = await context.Permissions
            .Where(permission => permission.Status == PermissionStatus.Active && !permission.IsPlatformOnly)
            .ToDictionaryAsync(permission => permission.Code, StringComparer.Ordinal, cancellationToken);

        var roles = await context.Roles
            .IgnoreQueryFilters()
            .Where(role => role.TenantId != null && role.IsSystemRole && !role.GrantsAllTenantPermissions)
            .ToListAsync(cancellationToken);

        if (roles.Count == 0)
        {
            return;
        }

        var roleIds = roles.Select(role => role.Id).ToList();

        // One query for every role's rows rather than one per role: this runs on every start.
        var held = (await context.RolePermissions
                .IgnoreQueryFilters()
                .Where(grant => roleIds.Contains(grant.RoleId))
                .Select(grant => new { grant.RoleId, grant.PermissionCode })
                .ToListAsync(cancellationToken))
            .GroupBy(grant => grant.RoleId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(item => item.PermissionCode).ToHashSet(StringComparer.Ordinal));

        var now = DateTimeOffset.UtcNow;
        var added = 0;

        foreach (var role in roles)
        {
            if (!definitions.TryGetValue(role.NormalizedCode, out var definition))
            {
                continue;
            }

            var current = held.TryGetValue(role.Id, out var codes)
                ? codes
                : new HashSet<string>(StringComparer.Ordinal);

            foreach (var permissionCode in definition.PermissionCodes)
            {
                // WITHHELD MEANS AN ADMINISTRATOR TOOK IT OUT. Without this test the pass could
                // not tell a code that is missing because it is new from one that is missing
                // because somebody removed it, and handed the second back on the next restart.
                if (current.Contains(permissionCode)
                    || role.WithheldPermissionCodes.Contains(permissionCode, StringComparer.Ordinal)
                    || !permissions.TryGetValue(permissionCode, out var permission))
                {
                    continue;
                }

                await context.RolePermissions.AddAsync(new RolePermission
                {
                    // Non-null by the `role.TenantId != null` filter on the query above.
                    TenantId = role.TenantId!.Value,
                    BusinessUnitId = role.BusinessUnitId,
                    RoleId = role.Id,
                    PermissionId = permission.Id,
                    PermissionCode = permission.Code,
                    GrantedAtUtc = now,
                    GrantedByUserId = Guid.Empty,
                    CreatedAtUtc = now,
                    CreatedByUserId = Guid.Empty
                }, cancellationToken);

                current.Add(permissionCode);
                added++;
            }
        }

        var removed = await WithdrawSupersededGrantsAsync(roles, cancellationToken);

        if (added > 0 || removed > 0)
        {
            logger.LogInformation(
                "Reconciled system role grants: {Added} permission row(s) added, {Removed} withdrawn, "
                + "across {RoleCount} role(s).",
                added, removed, roles.Count);
        }
    }

    /// <summary>
    /// Removes the grants a system role used to hold and must no longer.
    ///
    /// NARROWING A ROLE DOES NOT REACH AN EXISTING DATABASE ON ITS OWN. The reconciliation above
    /// only adds what a definition is missing - on purpose, so that an administrator's extra
    /// grant to a system role survives a restart - which means a permission removed from a
    /// profile stays in the table, and the role goes on holding it. Every narrowing is therefore
    /// stated explicitly in <see cref="RoleAccessProfiles.WithdrawnGrants"/> and applied here.
    ///
    /// IT IS NOT A DIFF AGAINST THE PROFILE, and must not become one: "delete every row the
    /// profile does not list" would undo an administrator's deliberate customisation silently, on
    /// every start-up, for every Organisation.
    /// </summary>
    private async Task<int> WithdrawSupersededGrantsAsync(
        IReadOnlyCollection<Role> roles, CancellationToken cancellationToken)
    {
        if (RoleAccessProfiles.WithdrawnGrants.Count == 0)
        {
            return 0;
        }

        var removed = 0;

        foreach (var role in roles)
        {
            if (!RoleAccessProfiles.WithdrawnGrants.TryGetValue(role.NormalizedCode, out var codes)
                || codes.Count == 0)
            {
                continue;
            }

            var doomed = await context.RolePermissions
                .IgnoreQueryFilters()
                .Where(grant => grant.RoleId == role.Id && codes.Contains(grant.PermissionCode))
                .ToListAsync(cancellationToken);

            if (doomed.Count == 0)
            {
                continue;
            }

            context.RolePermissions.RemoveRange(doomed);
            removed += doomed.Count;

            logger.LogInformation(
                "Withdrew {Count} superseded grant(s) from role {RoleCode}: {Codes}.",
                doomed.Count, role.NormalizedCode,
                string.Join(", ", doomed.Select(grant => grant.PermissionCode)));
        }

        return removed;
    }

    /// <summary>
    /// Writes the role-to-menu mapping rows the "Menu Mapping" screen edits.
    ///
    /// WHY THIS EXISTS AT ALL, given that permissions already decide what a sidebar shows. Two
    /// reasons, and the second is the important one.
    ///
    /// The first is that the mapping screen opened empty. RoleMenu has always been optional -
    /// "no rows means no restriction" - so nothing had ever written any, and an administrator who
    /// opened Menu Mapping to see which role reached which screen was shown a blank grid and left
    /// to infer the answer from the permission catalogue. The mapping was real but invisible.
    ///
    /// The second is that a blank grid is dangerous to edit. Tick one box in an empty grid and
    /// the save writes exactly one row - and every other node for that role now has a row saying
    /// nothing while one says yes, which reads to a person as "only this one is mapped". Seeding
    /// the full grid means an administrator changes a decision that is already written down
    /// rather than creating the first one by accident.
    ///
    /// WHAT IT WRITES IS THE ROLE'S MENU SCOPE, filtered by what the role may do. A node is
    /// visible when it lies inside the scope <see cref="TenantRoleDefinitions"/> gives the role -
    /// the named branch, everything beneath it and the headings above it, plus the mandatory
    /// dashboard and My Security - AND the role holds the permission its screen requires. That
    /// is what keeps a Campaign Executive's sidebar to Campaigns although the role also reads
    /// donations, and what gives DonorCare its own three Donors and Leads menus and no others.
    ///
    /// IT CANNOT GRANT ANYTHING, and that is what makes it safe to write in bulk. RoleMenu is a
    /// subtractive filter by construction - see the note on the entity - so the worst a wrong row
    /// here can do is hide a screen.
    ///
    /// AN ADMINISTRATOR'S ROWS ARE LEFT ALONE. An administrator who has hidden Payments from a
    /// role meant it, and a reconcile that stamped over that on the next restart would be a bug
    /// wearing the clothes of a feature. Menu Configuration stamps every row it saves with the
    /// administrator's id, so those rows are recognisable and never touched.
    ///
    /// THE SEEDER'S OWN ROWS FOLLOW THE DEFINITION. A row whose MappedByUserId is still
    /// Guid.Empty was written by this method and has never been decided by a person, so it is
    /// brought back in line whenever a role's scope or grants change. Without this a scope change
    /// reached only nodes added after it - DonorCare, mapped to nothing when it was created, kept
    /// "not part of this role's menu mapping" on Follow-up Queue for ever after its menus were
    /// mapped.
    /// </summary>
    private async Task ReconcileRoleMenusAsync(CancellationToken cancellationToken)
    {
        // The nodes an Organisation can map: everything the platform branch does not own, and
        // nothing retired. Disabled-by-default nodes are excluded for the same reason
        // ReconcileTenantMenusAsync excludes them - an Organisation does not hold them, so a row
        // mapping a role to one would describe a screen that is not there.
        var mappable = await context.MenuDefinitions
            .Where(menu => !menu.IsPlatformOnly
                           && menu.IsEnabledByDefault
                           && menu.Status != MenuStatus.Retired)
            .Select(menu => new MappableMenu(
                menu.Id, menu.Code, menu.ParentMenuId, menu.RequiredPermissionCode,
                menu.IsMandatory, menu.OwnerTenantId))
            .ToListAsync(cancellationToken);

        if (mappable.Count == 0)
        {
            return;
        }

        var roles = await context.Roles
            .IgnoreQueryFilters()
            .Where(role => role.TenantId != null && role.IsSystemRole)
            .Select(role => new
            {
                role.Id,
                TenantId = role.TenantId!.Value,
                role.BusinessUnitId,
                role.NormalizedCode,
                role.GrantsAllTenantPermissions
            })
            .ToListAsync(cancellationToken);

        if (roles.Count == 0)
        {
            return;
        }

        var roleIds = roles.Select(role => role.Id).ToList();

        // What each role may actually do. One query rather than one per role: this runs on every
        // start, and there is a row here for every role in every Organisation.
        var grants = (await context.RolePermissions
                .IgnoreQueryFilters()
                .Where(grant => roleIds.Contains(grant.RoleId) && !grant.IsDenied)
                .Select(grant => new { grant.RoleId, grant.PermissionCode })
                .ToListAsync(cancellationToken))
            .GroupBy(grant => grant.RoleId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(item => item.PermissionCode).ToHashSet(StringComparer.Ordinal));

        // TRACKED, because the seeder's own rows may be corrected below.
        var mapped = (await context.RoleMenus
                .IgnoreQueryFilters()
                .Where(mapping => roleIds.Contains(mapping.RoleId))
                .ToListAsync(cancellationToken))
            .GroupBy(mapping => mapping.RoleId)
            .ToDictionary(
                group => group.Key,
                group => group
                    .GroupBy(mapping => mapping.MenuDefinitionId)
                    .ToDictionary(rows => rows.Key, rows => rows.First()));

        // Each role's scope, resolved to node ids once per role CODE rather than once per role:
        // every Organisation shares the catalogue, so CAMPAIGN_EXECUTIVE's scope is the same set
        // in all of them. Null means the whole catalogue.
        var scopes = TenantRoleDefinitions.All.ToDictionary(
            definition => definition.Code,
            definition => ResolveMenuScope(definition.MenuScope, mappable),
            StringComparer.Ordinal);

        var now = DateTimeOffset.UtcNow;
        var added = 0;
        var corrected = 0;

        foreach (var role in roles)
        {
            var held = grants.TryGetValue(role.Id, out var codes)
                ? codes
                : new HashSet<string>(StringComparer.Ordinal);

            var already = mapped.TryGetValue(role.Id, out var existing)
                ? existing
                : [];

            // A system role the blueprint no longer defines is mapped by permission alone. It is
            // deactivated by RetireUnknownSystemRolesAsync anyway; this only keeps its grid honest.
            var scope = scopes.GetValueOrDefault(role.NormalizedCode);

            foreach (var node in mappable)
            {
                var isMapped = scope is null || scope.Contains(node.Id);

                // TENANT_ADMIN holds everything by flag and owns no RolePermission rows at all,
                // so asking `held` about it would answer no to every node and hide the entire
                // sidebar from the one role that is supposed to see all of it.
                var isPermitted = role.GrantsAllTenantPermissions
                                  || string.IsNullOrWhiteSpace(node.RequiredPermissionCode)
                                  || held.Contains(node.RequiredPermissionCode);

                var isVisible = isMapped && isPermitted;
                var notes = DescribeSeededMapping(isMapped, isPermitted);

                if (already.TryGetValue(node.Id, out var row))
                {
                    // Only a row nobody has decided about. See the method comment.
                    if (row.MappedByUserId == Guid.Empty && (row.IsVisible != isVisible || row.Notes != notes))
                    {
                        row.IsVisible = isVisible;
                        row.IsLandingPage = isVisible && node.Code == MenuCatalogue.Dashboard;
                        row.Notes = notes;
                        row.MappedAtUtc = now;
                        corrected++;
                    }

                    continue;
                }

                await context.RoleMenus.AddAsync(new RoleMenu
                {
                    TenantId = role.TenantId,
                    BusinessUnitId = role.BusinessUnitId,
                    RoleId = role.Id,
                    MenuDefinitionId = node.Id,
                    IsVisible = isVisible,

                    // Everybody lands on the dashboard. It is the one node with no permission on
                    // it that every role holds, so it is the only choice that cannot land
                    // somebody on a screen they are then refused.
                    IsLandingPage = node.Code == MenuCatalogue.Dashboard,

                    MappedAtUtc = now,
                    MappedByUserId = Guid.Empty,
                    Notes = notes,
                    CreatedAtUtc = now,
                    CreatedByUserId = Guid.Empty
                }, cancellationToken);

                added++;
            }
        }

        if (added > 0 || corrected > 0)
        {
            logger.LogInformation(
                "Reconciled role menu mapping: {Added} row(s) added and {Corrected} seeded row(s) "
                + "brought in line across {RoleCount} role(s) and {NodeCount} navigable node(s).",
                added, corrected, roles.Count, mappable.Count);
        }
    }

    /// <summary>Why a seeded mapping row says what it says, as the Menu Configuration grid shows it.</summary>
    private static string DescribeSeededMapping(bool isMapped, bool isPermitted) =>
        (isMapped, isPermitted) switch
        {
            (false, _) => "Seeded: not part of this role's menu mapping.",
            (true, true) => "Seeded: mapped to this role, which holds the permission "
                            + "this screen requires.",
            (true, false) => "Seeded: mapped to this role, but it does not hold the "
                             + "permission this screen requires."
        };

    /// <summary>One node of the navigation as the menu mapping needs it.</summary>
    private sealed record MappableMenu(
        Guid Id, string Code, Guid? ParentMenuId, string? RequiredPermissionCode, bool IsMandatory,
        Guid? OwnerTenantId);

    /// <summary>
    /// The node ids a menu scope covers: each named node, everything beneath it and every heading
    /// above it - plus the mandatory nodes and their headings, which every role keeps.
    ///
    /// THE HEADINGS ABOVE ARE INCLUDED because a child whose parent is hidden is never reached by
    /// the menu builder, so mapping Campaigns without Fundraising would map nothing at all.
    ///
    /// ONLY PLATFORM ROWS ARE MATCHED BY CODE. An Organisation's own nodes have codes that are
    /// unique only inside that Organisation, so a scope naming a code means the catalogue's node
    /// of that name and never somebody's look-alike.
    /// </summary>
    private static HashSet<Guid>? ResolveMenuScope(
        IReadOnlyList<string>? scopeCodes, IReadOnlyList<MappableMenu> nodes)
    {
        if (scopeCodes is null)
        {
            return null;
        }

        var byId = nodes.ToDictionary(node => node.Id);
        var children = nodes
            .Where(node => node.ParentMenuId.HasValue)
            .ToLookup(node => node.ParentMenuId!.Value);

        var roots = nodes.Where(node => node.OwnerTenantId is null
                                        && (node.IsMandatory
                                            || scopeCodes.Contains(node.Code, StringComparer.Ordinal)));

        var covered = new HashSet<Guid>();

        foreach (var root in roots)
        {
            // Downwards: the node and everything beneath it.
            var pending = new Stack<MappableMenu>([root]);

            while (pending.TryPop(out var node))
            {
                if (covered.Add(node.Id))
                {
                    foreach (var child in children[node.Id])
                    {
                        pending.Push(child);
                    }
                }
            }

            // Upwards: the headings that have to be visible for the node to be reached at all.
            var parentId = root.ParentMenuId;

            while (parentId.HasValue && byId.TryGetValue(parentId.Value, out var parent))
            {
                covered.Add(parent.Id);
                parentId = parent.ParentMenuId;
            }
        }

        return covered;
    }

    /// <summary>
    /// Deactivates system roles an Organisation still holds that the blueprint no longer defines.
    ///
    /// THIS IS AN UPGRADE PATH AND NOTHING ELSE. A database seeded before the role catalogue was
    /// cut from fourteen roles to three still carries the other eleven - Campaign Manager, Finance
    /// Officer, Data Steward and the rest - and each of them still grants what it always granted.
    /// Leaving them would make the deliverable false on every database except a brand new one:
    /// the Roles screen would list fourteen roles and the seeder would insist there were three.
    ///
    /// IT DEACTIVATES AND DOES NOT DELETE, deliberately. A role may still be assigned to somebody,
    /// and deleting it would strip a person's access with no record of what they used to hold and
    /// no way to put it back if the removal was a mistake. Inactive is reversible, it is visible
    /// on the Roles screen, and the audit trail keeps the assignment - so an administrator can see
    /// what happened and decide where those people should go.
    ///
    /// IT ONLY TOUCHES SYSTEM ROLES. A role an Organisation built for itself is theirs, is not in
    /// the blueprint by definition, and must never be swept up by a reconcile that was aiming at
    /// the platform's own leftovers.
    /// </summary>
    private async Task RetireUnknownSystemRolesAsync(CancellationToken cancellationToken)
    {
        var known = TenantRoleDefinitions.All
            .Select(definition => definition.Code)
            .ToHashSet(StringComparer.Ordinal);

        var stale = await context.Roles
            .IgnoreQueryFilters()
            .Where(role => role.TenantId != null
                           && role.IsSystemRole
                           && role.Status == RoleStatus.Active
                           && !known.Contains(role.NormalizedCode))
            .ToListAsync(cancellationToken);

        if (stale.Count == 0)
        {
            return;
        }

        foreach (var role in stale)
        {
            role.Status = RoleStatus.Inactive;
            role.UpdatedAtUtc = DateTimeOffset.UtcNow;
            role.UpdatedByUserId = Guid.Empty;
        }

        logger.LogWarning(
            "Deactivated {Count} system role(s) no longer in the catalogue: {Codes}. Anyone still "
            + "assigned to one keeps the assignment but loses its grants; reassign them to one of "
            + "the current roles.",
            stale.Count,
            string.Join(", ", stale.Select(role => role.NormalizedCode).Distinct(StringComparer.Ordinal)));
    }

    private async Task ReconcileTenantMenusAsync(CancellationToken cancellationToken)
    {
        var definitions = await context.MenuDefinitions.ToListAsync(cancellationToken);

        // What an Organisation should hold: everything enabled by default that is not the
        // platform-only branch.
        var shouldHold = definitions
            .Where(definition => !definition.IsPlatformOnly
                                 && definition.IsEnabledByDefault
                                 && definition.Status != MenuStatus.Retired)
            .Select(definition => definition.Id)
            .ToHashSet();

        var tenants = await context.Tenants
            .IgnoreQueryFilters()
            .Select(tenant => new { tenant.Id, tenant.BusinessUnitId })
            .ToListAsync(cancellationToken);

        var existing = await context.TenantMenus
            .IgnoreQueryFilters()
            .ToListAsync(cancellationToken);

        var byTenant = existing
            .GroupBy(menu => menu.TenantId)
            .ToDictionary(group => group.Key, group => group.ToList());

        var removed = 0;
        var restored = 0;

        foreach (var tenant in tenants)
        {
            if (!byTenant.TryGetValue(tenant.Id, out var held))
            {
                // Never provisioned — leave it to whatever creates it, rather than inventing a
                // navigation for an Organisation that may not be ready for one.
                continue;
            }

            foreach (var menu in held.Where(menu => menu.IsSystemGenerated
                                                    && !shouldHold.Contains(menu.MenuDefinitionId)))
            {
                context.TenantMenus.Remove(menu);
                removed++;
            }

            var codesHeld = held.Select(menu => menu.MenuDefinitionId).ToHashSet();

            foreach (var definitionId in shouldHold.Where(id => !codesHeld.Contains(id)))
            {
                await context.TenantMenus.AddAsync(new TenantMenu
                {
                    TenantId = tenant.Id,
                    BusinessUnitId = tenant.BusinessUnitId,
                    MenuDefinitionId = definitionId,
                    IsEnabled = true,
                    Status = MenuStatus.Active,
                    IsSystemGenerated = true,
                    CreatedAtUtc = DateTimeOffset.UtcNow,
                    CreatedByUserId = Guid.Empty
                }, cancellationToken);

                restored++;
            }
        }

        if (removed > 0 || restored > 0)
        {
            logger.LogInformation(
                "Organisation navigation reconciled across {Tenants} Organisation(s): "
                + "{Removed} row(s) removed, {Restored} row(s) added.",
                tenants.Count, removed, restored);
        }
    }

    /// <summary>
    /// The platform role, shown as "Platform Admin": TenantId null, held only by platform
    /// administrators.
    ///
    /// It carries no permission rows. Platform authority comes from the <c>IsSuperAdmin</c>
    /// flag and the Global scope claim, not from an enumerated list that would go stale the
    /// moment a permission is added. The same flag is what puts the whole Platform branch, the
    /// dashboard and the global masters in its holders' sidebar, which is why the role has no
    /// menu mapping rows: RoleMenu belongs to an Organisation, and this role belongs to none.
    /// </summary>
    private async Task<Role> SeedPlatformRoleAsync(BusinessUnit businessUnit, CancellationToken cancellationToken)
    {
        var existing = await context.Roles
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                role => role.TenantId == null && role.NormalizedCode == RoleCodes.SuperAdmin,
                cancellationToken);

        if (existing is not null)
        {
            return existing;
        }

        var role = new Role
        {
            TenantId = null,
            BusinessUnitId = businessUnit.Id,
            Code = RoleCodes.SuperAdmin,
            NormalizedCode = RoleCodes.SuperAdmin,
            Name = "Platform Admin",
            NormalizedName = "PLATFORM ADMIN",
            Description = "Runs the platform: creates, reviews and approves organisations, and "
                          + "maintains the business unit, the permission and menu catalogues, the "
                          + "global masters and the platform audit. Unrestricted across every "
                          + "organisation.",
            RoleType = RoleType.Platform,
            Status = RoleStatus.Active,
            IsSystemRole = true,
            IsPrivileged = true,
            GrantsAllTenantPermissions = true,
            Priority = 1000,
            CreatedAtUtc = DateTimeOffset.UtcNow,
            CreatedByUserId = Guid.Empty
        };

        await context.Roles.AddAsync(role, cancellationToken);

        logger.LogInformation("Seeded the platform role.");

        return role;
    }

    /// <summary>
    /// The global root user, returned so the Organisations seeded after it can name who
    /// reviewed and approved them.
    ///
    /// <c>TenantId</c> is NULL and stays null forever — that is the invariant the whole
    /// tenancy model rests on, and there is a check constraint enforcing it. They are not a
    /// member of any Organisation; they select one to operate in.
    /// </summary>
    private async Task<User> SeedSuperAdminAsync(
        BusinessUnit businessUnit, Role platformRole, CancellationToken cancellationToken)
    {
        var normalisedEmail = _seed.SuperAdminEmail.Trim().ToUpperInvariant();

        var existing = await context.Users
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                user => user.TenantId == null && user.NormalizedEmail == normalisedEmail,
                cancellationToken);

        if (existing is not null)
        {
            return existing;
        }

        var now = DateTimeOffset.UtcNow;

        // THE CONFIGURED ADDRESS CHANGED ON A DATABASE THAT ALREADY HAS ITS ROOT ACCOUNT. The
        // lookup above is by address, so it answered "not there" and a SECOND root was inserted
        // beside the first - same code, same username - because no unique index covers a row
        // whose TenantId is null. Two accounts then answered to "superadmin" and which one a
        // sign-in reached was down to row order. The root account is the platform's own identity
        // and there is exactly one of it, so a new address is a change to that account.
        //
        // ONLY THE ADDRESS MOVES. The password, the stamp and every session are left as they
        // are: a configuration value changing is not a reason to sign the administrator out.
        var root = await context.Users
            .IgnoreQueryFilters()
            .Where(user => user.TenantId == null && user.IsSystemAccount && user.IsSuperAdmin)
            .OrderBy(user => user.CreatedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);

        if (root is not null)
        {
            var previous = root.Email;

            root.Email = _seed.SuperAdminEmail.Trim().ToLowerInvariant();
            root.NormalizedEmail = normalisedEmail;
            root.UpdatedAtUtc = now;
            root.UpdatedByUserId = Guid.Empty;

            logger.LogWarning(
                "SeedSettings:SuperAdminEmail no longer matches the root account, so its address was "
                + "changed from {PreviousEmail} to {Email}. Nothing else about the account was touched.",
                previous, root.Email);

            return root;
        }

        var superAdmin = new User
        {
            TenantId = null,
            BusinessUnitId = businessUnit.Id,
            Code = "SUPERADMIN",
            FirstName = _seed.SuperAdminFirstName,
            LastName = _seed.SuperAdminLastName,
            DisplayName = $"{_seed.SuperAdminFirstName} {_seed.SuperAdminLastName}".Trim(),
            Email = _seed.SuperAdminEmail.Trim().ToLowerInvariant(),
            NormalizedEmail = normalisedEmail,
            UserName = _seed.SuperAdminUsername.Trim().ToLowerInvariant(),
            NormalizedUserName = _seed.SuperAdminUsername.Trim().ToUpperInvariant(),
            EmailConfirmed = true,
            EmailConfirmedAtUtc = now,
            Status = UserStatus.Active,
            AccountCategory = UserAccountCategory.Employee,
            PrivilegeLevel = PrivilegeLevel.SuperAdmin,
            IsSuperAdmin = true,
            IsTenantAdmin = false,
            IsSystemAccount = true,
            MfaRequirement = MfaRequirement.Optional,
            AccessStartsAtUtc = now,
            LockoutEnabled = true,
            CredentialSetupMethod = CredentialSetupMethod.AdministratorSet,
            CreatedAtUtc = now,
            CreatedByUserId = Guid.Empty
        };

        // A password only when one was configured. With none, the account exists but cannot be
        // signed into until a reset link is used - which is the correct production default.
        if (!string.IsNullOrWhiteSpace(_seed.SuperAdminPassword))
        {
            superAdmin.PasswordHash = passwordHasher.Hash(_seed.SuperAdminPassword);
            superAdmin.PasswordChangedAtUtc = now;

            logger.LogWarning(
                "The SuperAdmin account was seeded WITH a configured password. "
                + "Clear SeedSettings:SuperAdminPassword outside development.");
        }
        else
        {
            logger.LogInformation(
                "The SuperAdmin account was seeded with no password. "
                + "Use forgot-password on the platform host to set one.");
        }

        await context.Users.AddAsync(superAdmin, cancellationToken);

        await context.UserRoles.AddAsync(new UserRole
        {
            TenantId = null,
            BusinessUnitId = businessUnit.Id,
            UserId = superAdmin.Id,
            RoleId = platformRole.Id,
            Status = UserRoleAssignmentStatus.Active,
            IsPrimary = true,
            AssignedAtUtc = now,
            AssignedByUserId = Guid.Empty,
            EffectiveFromUtc = now,
            Justification = "Platform root account.",
            CreatedAtUtc = now,
            CreatedByUserId = Guid.Empty
        }, cancellationToken);

        logger.LogInformation("Seeded the SuperAdmin account {Email}.", superAdmin.Email);

        return superAdmin;
    }

    /// <summary>
    /// The named platform administrators from <see cref="SampleOrganisationCatalogue"/>.
    ///
    /// PEOPLE, NOT SYSTEM ACCOUNTS. The root account above is the platform's own identity; these
    /// hold the same role so the platform side of a demonstration has a named person on it, the
    /// way an operations team would. They share the configured SuperAdmin password, and are
    /// created without one when it is unset - exactly like the root.
    ///
    /// SAMPLE DATA, so it follows the sample-Organisation switch. Idempotent by address.
    /// </summary>
    private async Task SeedPlatformAdministratorsAsync(
        BusinessUnit businessUnit, Role platformRole, CancellationToken cancellationToken)
    {
        if (!_seed.SeedSampleTenants)
        {
            return;
        }

        var present = (await context.Users
                .IgnoreQueryFilters()
                .Where(user => user.TenantId == null)
                .Select(user => user.NormalizedEmail!)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var now = DateTimeOffset.UtcNow;
        var seeded = 0;

        foreach (var (person, index) in SampleOrganisationCatalogue.PlatformAdministrators
                     .Select((person, index) => (person, index)))
        {
            if (present.Contains(person.Email.Trim().ToUpperInvariant()))
            {
                continue;
            }

            var administrator = BuildUser(person, null, businessUnit.Id, $"PLT-{index + 1:D3}", now);

            Activate(administrator, HashOrNull(_seed.SuperAdminPassword), now);
            administrator.PrivilegeLevel = PrivilegeLevel.SuperAdmin;
            administrator.IsSuperAdmin = true;
            administrator.MfaRequirement = MfaRequirement.Optional;

            await context.Users.AddAsync(administrator, cancellationToken);
            await context.UserRoles.AddAsync(
                BuildAssignment(null, businessUnit.Id, administrator.Id, platformRole.Id, now,
                    "Named platform administrator."),
                cancellationToken);

            seeded++;
        }

        if (seeded > 0)
        {
            logger.LogInformation("Seeded {Count} named platform administrator(s).", seeded);
        }
    }

    /// <summary>
    /// One sample Organisation, complete with its host, profile, lifecycle history, roles and
    /// default navigation. Returns the Organisation, whether it was created now or already there.
    ///
    /// ITS PEOPLE ARE NOT CREATED HERE. They need the roles, departments and branches to have
    /// been SAVED first - see the note in <see cref="SeedAsync"/> - so they are a later pass.
    ///
    /// THE PROFILE IS COMPLETE IN BOTH STATES. An Active Organisation could not have been
    /// approved without one; an Invited one carries what the platform knew when it sent the
    /// invitation, so its administrator finds the profile pre-filled when they accept and only
    /// has to check it and submit.
    /// </summary>
    private async Task<Tenant> SeedSampleTenantAsync(
        BusinessUnit businessUnit,
        SampleOrganisationCatalogue.SampleOrganisation sample,
        User rootAdministrator,
        CancellationToken cancellationToken)
    {
        var existing = await context.Tenants
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(
                tenant => tenant.BusinessUnitId == businessUnit.Id && tenant.Subdomain == sample.Subdomain,
                cancellationToken);

        if (existing is not null)
        {
            return existing;
        }

        var now = DateTimeOffset.UtcNow;

        var count = await context.Tenants
            .IgnoreQueryFilters()
            .CountAsync(tenant => tenant.BusinessUnitId == businessUnit.Id, cancellationToken);

        var code = $"TEN{count + 1:D3}";
        var contact = sample.Administrator;

        var tenant = new Tenant
        {
            // FROM CONFIGURATION for the one sample that takes it, generated for the rest. See
            // the note on SeedSettings.SampleOrganisationId: CAM, DON and PAY stamp their optional
            // demonstration data with the matching value.
            Id = sample.UsesConfiguredId ? _seed.SampleOrganisationId : Guid.NewGuid(),
            BusinessUnitId = businessUnit.Id,
            Code = code,
            Name = sample.Name,
            LegalName = sample.LegalName,
            Subdomain = sample.Subdomain,
            Status = sample.Status,

            OrganisationType = sample.OrganisationType,
            Description = sample.Description,
            WebsiteUrl = sample.WebsiteUrl,
            RegistrationNumber = sample.RegistrationNumber,
            TaxIdentificationNumber = sample.TaxIdentificationNumber,
            PanNumber = sample.PanNumber,
            GstNumber = sample.GstNumber,
            EstablishedOn = sample.EstablishedOn,

            // The primary contact is the administrator, which is how CreateOrganisationCommand
            // records it: the person the platform invited is the person it deals with.
            ContactPersonName = contact.DisplayName,
            ContactEmail = contact.Email.Trim().ToLowerInvariant(),
            ContactPhoneCountryCode = "+91",
            ContactPhone = contact.Mobile,

            AddressLine1 = sample.Address.Line1,
            AddressLine2 = sample.Address.Line2,
            City = sample.Address.City,
            State = sample.Address.State,
            Country = sample.Address.Country,
            PostalCode = sample.Address.PostalCode,

            TimeZone = businessUnit.TimeZone,
            DefaultCurrency = businessUnit.DefaultCurrency,
            DefaultCulture = businessUnit.DefaultCulture,
            DefaultMfaRequirement = MfaRequirement.Optional,
            MaximumFailedAccessAttempts = _security.MaximumFailedAccessAttempts,
            LockoutDurationMinutes = _security.LockoutMinutes,
            PasswordMinimumLength = _security.PasswordMinimumLength,
            SessionIdleTimeoutMinutes = _security.SessionIdleTimeoutMinutes,
            MaximumUsers = sample.MaximumUsers,

            InvitedAtUtc = now,
            CreatedAtUtc = now,
            CreatedByUserId = Guid.Empty
        };

        // An Active Organisation walked the whole ladder, so it carries every step's stamp and
        // the platform administrator who decided it.
        if (sample.IsActive)
        {
            tenant.InvitationAcceptedAtUtc = now;
            tenant.SubmittedAtUtc = now;
            tenant.ReviewStartedAtUtc = now;
            tenant.ReviewedByUserId = rootAdministrator.Id;
            tenant.ApprovedAtUtc = now;
            tenant.ApprovedByUserId = rootAdministrator.Id;
            tenant.ActivatedAtUtc = now;
        }

        await context.Tenants.AddAsync(tenant, cancellationToken);

        // ---- The host that reaches it -------------------------------------------------------
        await context.TenantDomains.AddAsync(new TenantDomain
        {
            BusinessUnitId = businessUnit.Id,
            TenantId = tenant.Id,
            HostName = $"{sample.Subdomain}.{businessUnit.RootDomain}",
            DomainType = TenantDomainType.Subdomain,
            IsPrimary = true,
            // Verified on creation: the platform already controls the apex domain.
            IsVerified = true,
            VerifiedAtUtc = now,
            VerifiedByUserId = rootAdministrator.Id,
            IsActive = true,
            CreatedAtUtc = now,
            CreatedByUserId = Guid.Empty
        }, cancellationToken);

        // ---- The lifecycle ladder -------------------------------------------------------------
        //
        // ONE ROW PER STEP, in order, so the history panel tells the story the status claims.
        // The steps are a second apart rather than simultaneous, which keeps them in sequence on
        // a screen that sorts by time.
        //
        // The administrator's own steps carry their name but no user id: their account is created
        // in the people pass, after this Organisation has been saved.
        (TenantStatus? From, TenantStatus To, bool ByPlatform, string Notes)[] ladder = sample.IsActive
            ?
            [
                (null, TenantStatus.Invited, true,
                    $"Organisation created and administrator {contact.Email} invited."),
                (TenantStatus.Invited, TenantStatus.InvitationAccepted, false,
                    "Invitation accepted and administrator account activated."),
                (TenantStatus.InvitationAccepted, TenantStatus.Submitted, false,
                    "Registration profile and documents submitted for review."),
                (TenantStatus.Submitted, TenantStatus.Approved, true,
                    "Registration verified and approved."),
                (TenantStatus.Approved, TenantStatus.Active, true,
                    "Organisation activated.")
            ]
            :
            [
                (null, TenantStatus.Invited, true,
                    $"Organisation created and administrator {contact.Email} invited.")
            ];

        foreach (var (step, index) in ladder.Select((step, index) => (step, index)))
        {
            await context.TenantStatusHistory.AddAsync(new TenantStatusHistory
            {
                BusinessUnitId = businessUnit.Id,
                TenantId = tenant.Id,
                FromStatus = step.From,
                ToStatus = step.To,
                OccurredAtUtc = now.AddSeconds(index - ladder.Length + 1),
                ActorUserId = step.ByPlatform ? rootAdministrator.Id : null,
                ActorDisplayName = step.ByPlatform ? rootAdministrator.DisplayName : contact.DisplayName,
                Notes = step.Notes,
                CreatedAtUtc = now,
                CreatedByUserId = Guid.Empty
            }, cancellationToken);
        }

        // ---- Its own roles -----------------------------------------------------------------------
        var permissions = await context.Permissions
            .Where(permission => permission.Status == PermissionStatus.Active && !permission.IsPlatformOnly)
            .ToDictionaryAsync(permission => permission.Code, StringComparer.Ordinal, cancellationToken);

        foreach (var definition in TenantRoleDefinitions.All)
        {
            var role = new Role
            {
                TenantId = tenant.Id,
                BusinessUnitId = businessUnit.Id,
                Code = definition.Code,
                NormalizedCode = definition.Code,
                Name = definition.Name,
                NormalizedName = definition.Name.ToUpperInvariant(),
                Description = definition.Description,
                RoleType = RoleType.Tenant,
                Status = RoleStatus.Active,
                IsSystemRole = true,
                IsDefaultRole = definition.IsDefault,
                GrantsAllTenantPermissions = definition.GrantsAll,
                IsPrivileged = definition.IsPrivileged,
                Priority = definition.Priority,
                CreatedAtUtc = now,
                CreatedByUserId = Guid.Empty
            };

            await context.Roles.AddAsync(role, cancellationToken);

            // A blanket-grant role needs no rows: the flag is the grant.
            if (definition.GrantsAll)
            {
                continue;
            }

            foreach (var permissionCode in definition.PermissionCodes)
            {
                if (!permissions.TryGetValue(permissionCode, out var permission))
                {
                    continue;
                }

                await context.RolePermissions.AddAsync(new RolePermission
                {
                    TenantId = tenant.Id,
                    BusinessUnitId = businessUnit.Id,
                    RoleId = role.Id,
                    PermissionId = permission.Id,
                    PermissionCode = permission.Code,
                    GrantedAtUtc = now,
                    GrantedByUserId = Guid.Empty,
                    CreatedAtUtc = now,
                    CreatedByUserId = Guid.Empty
                }, cancellationToken);
            }
        }

        // ---- Its default navigation ---------------------------------------------------------------
        var menuDefinitions = await context.MenuDefinitions
            .Where(menu => !menu.IsPlatformOnly && menu.IsEnabledByDefault)
            .ToListAsync(cancellationToken);

        foreach (var definition in menuDefinitions)
        {
            await context.TenantMenus.AddAsync(new TenantMenu
            {
                TenantId = tenant.Id,
                BusinessUnitId = businessUnit.Id,
                MenuDefinitionId = definition.Id,
                IsEnabled = true,
                Status = MenuStatus.Active,
                IsSystemGenerated = true,
                CreatedAtUtc = now,
                CreatedByUserId = Guid.Empty
            }, cancellationToken);
        }

        logger.LogInformation(
            "Seeded organisation {Code} ({Name}) on {Host}, {Status}.",
            code, sample.Name, $"{sample.Subdomain}.{businessUnit.RootDomain}", sample.Status);

        return tenant;
    }

    /// <summary>
    /// The Organisation's departments and branches.
    ///
    /// These two lists are the entire content of the Department and Organisation Unit dropdowns
    /// on Create User and User Profile. Nothing else fills them - there is no fallback list in
    /// the client - so with the tables empty those two fields render as a select with one blank
    /// option, and the screen looks broken in a way no error message accounts for.
    ///
    /// IDEMPOTENT BY CODE, not by "does the Organisation exist". Each row is added only if no
    /// row with that code is already present in the Organisation, so this runs harmlessly on
    /// every start and adds only what a database is actually missing. Anything an administrator
    /// has since renamed, re-parented or archived is left exactly as they left it.
    /// </summary>
    private async Task SeedOrganisationStructureAsync(
        Tenant tenant,
        SampleOrganisationCatalogue.SampleOrganisation sample,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;

        var departmentCodes = (await context.Departments
                .IgnoreQueryFilters()
                .Where(department => department.TenantId == tenant.Id)
                .Select(department => department.Code)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var departmentsAdded = 0;

        foreach (var definition in sample.Departments.Where(item => !departmentCodes.Contains(item.Code)))
        {
            await context.Departments.AddAsync(new Department
            {
                TenantId = tenant.Id,
                BusinessUnitId = tenant.BusinessUnitId,
                Code = definition.Code,
                Name = definition.Name,
                Description = definition.Description,
                Status = RecordStatus.Active,
                DisplayOrder = definition.Order,
                CreatedAtUtc = now,
                CreatedByUserId = Guid.Empty
            }, cancellationToken);

            departmentsAdded++;
        }

        var unitCodes = (await context.OrganisationUnits
                .IgnoreQueryFilters()
                .Where(unit => unit.TenantId == tenant.Id)
                .Select(unit => unit.Code)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var unitsAdded = 0;

        foreach (var definition in sample.Units.Where(item => !unitCodes.Contains(item.Code)))
        {
            await context.OrganisationUnits.AddAsync(new OrganisationUnit
            {
                TenantId = tenant.Id,
                BusinessUnitId = tenant.BusinessUnitId,
                Code = definition.Code,
                Name = definition.Name,
                UnitType = definition.UnitType,
                AddressLine1 = definition.Address.Line1,
                AddressLine2 = definition.Address.Line2,
                City = definition.Address.City,
                State = definition.Address.State,
                Country = definition.Address.Country,
                PostalCode = definition.Address.PostalCode,
                ContactEmail = definition.ContactEmail,
                TimeZone = tenant.TimeZone,
                Status = RecordStatus.Active,
                DisplayOrder = definition.Order,
                CreatedAtUtc = now,
                CreatedByUserId = Guid.Empty
            }, cancellationToken);

            unitsAdded++;
        }

        if (departmentsAdded > 0 || unitsAdded > 0)
        {
            logger.LogInformation(
                "Reconciled the structure of {Code}: {DepartmentCount} department(s) and "
                + "{UnitCount} unit(s) added.",
                tenant.Code, departmentsAdded, unitsAdded);
        }
    }

    /// <summary>
    /// The Organisation's people: its administrator, and - for an Active Organisation - its
    /// staff and its donors.
    ///
    /// THE ADMINISTRATOR MIRRORS WHAT CreateOrganisationCommand DOES. In an Active Organisation
    /// they have accepted their invitation long ago, so the account is Active with the demo
    /// password. In an Invited one they have not: the account has NO password and cannot be
    /// signed into at all, and a PENDING invitation is written whose plaintext token appears in
    /// the start-up log - which is what makes the activation link walkable without a mail relay.
    ///
    /// EVERYBODY ELSE IS ACTIVE WITH THE SHARED DEMO PASSWORD, because the point of them is to be
    /// signed into. They need <c>SeedSettings:RoleAccountPassword</c>: leave it unset, as anything
    /// that is not a demonstration should, and only the administrators are created.
    ///
    /// IDEMPOTENT BY USERNAME. Whoever is already in the Organisation is left exactly as they
    /// are - including a password, a role or a department somebody has since changed.
    /// </summary>
    private async Task SeedOrganisationPeopleAsync(
        Tenant tenant,
        SampleOrganisationCatalogue.SampleOrganisation sample,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;

        var roles = await context.Roles
            .IgnoreQueryFilters()
            .Where(role => role.TenantId == tenant.Id)
            .ToDictionaryAsync(role => role.Code, StringComparer.Ordinal, cancellationToken);

        var departments = await context.Departments
            .IgnoreQueryFilters()
            .Where(department => department.TenantId == tenant.Id)
            .ToDictionaryAsync(department => department.Code, StringComparer.OrdinalIgnoreCase, cancellationToken);

        var units = await context.OrganisationUnits
            .IgnoreQueryFilters()
            .Where(unit => unit.TenantId == tenant.Id)
            .ToDictionaryAsync(unit => unit.Code, StringComparer.OrdinalIgnoreCase, cancellationToken);

        // Everybody already here, by username - the people just created are added as they go, so
        // a manager named further down the list resolves to the account made above it.
        var people = await context.Users
            .IgnoreQueryFilters()
            .Where(user => user.TenantId == tenant.Id)
            .ToDictionaryAsync(user => user.UserName!, StringComparer.OrdinalIgnoreCase, cancellationToken);

        var userCount = people.Count;

        var created = new List<(User User, SampleOrganisationCatalogue.SamplePerson Person)>();

        // ---- The administrator ------------------------------------------------------------------
        if (!people.ContainsKey(sample.Administrator.Username))
        {
            var administrator = BuildUser(
                sample.Administrator, tenant.Id, tenant.BusinessUnitId, $"USR-{++userCount:D5}", now);

            administrator.PrivilegeLevel = PrivilegeLevel.TenantAdmin;
            administrator.IsTenantAdmin = true;
            PlaceInStructure(administrator, sample.Administrator, departments, units);

            if (sample.IsActive)
            {
                // THE DEMO PASSWORD, falling back to the SuperAdmin one when only that is
                // configured - which is what the activated sample's administrator used to be
                // given, so an environment that sets only IAM_SUPERADMIN_PASSWORD still gets an
                // Organisation somebody can sign into.
                Activate(
                    administrator,
                    HashOrNull(_seed.RoleAccountPassword) ?? HashOrNull(_seed.SuperAdminPassword),
                    now);

                tenant.SubmittedByUserId ??= administrator.Id;
            }
            else
            {
                // Genuinely Invited: no password, so the invitation link is the only way in.
                administrator.Status = UserStatus.Invited;
                administrator.EmailConfirmed = false;
                administrator.CredentialSetupMethod = CredentialSetupMethod.InvitationLink;
            }

            await AddPersonAsync(administrator, sample.Administrator, roles, tenant, now,
                "First administrator of the organisation.", cancellationToken);

            if (!sample.IsActive && roles.TryGetValue(RoleCodes.TenantAdmin, out var tenantAdminRole))
            {
                await AddAdministratorInvitationAsync(
                    tenant, administrator, tenantAdminRole, now, cancellationToken);
            }

            people[administrator.UserName!] = administrator;
            created.Add((administrator, sample.Administrator));
        }

        // ---- Staff and donors, Active Organisations only ------------------------------------------
        if (sample.IsActive && sample.Staff.Count > 0)
        {
            if (string.IsNullOrWhiteSpace(_seed.RoleAccountPassword))
            {
                logger.LogInformation(
                    "No role-account password configured, so the demonstration accounts in {Code} "
                    + "were skipped.", tenant.Code);
            }
            else
            {
                foreach (var person in sample.Staff.Where(person => !people.ContainsKey(person.Username)))
                {
                    if (!roles.ContainsKey(person.RoleCode))
                    {
                        logger.LogWarning(
                            "Role {RoleCode} does not exist in {Tenant}, so {Username} was skipped.",
                            person.RoleCode, tenant.Code, person.Username);

                        continue;
                    }

                    var user = BuildUser(person, tenant.Id, tenant.BusinessUnitId, $"USR-{++userCount:D5}", now);

                    // Hashed per account, so no two rows share a salt even though the demo
                    // accounts share a password.
                    Activate(user, HashOrNull(_seed.RoleAccountPassword), now);
                    PlaceInStructure(user, person, departments, units);

                    await AddPersonAsync(user, person, roles, tenant, now,
                        "Demonstration account for this role.", cancellationToken);

                    people[user.UserName!] = user;
                    created.Add((user, person));
                }
            }
        }

        // ---- Reporting lines and department heads, now that everybody exists --------------------
        //
        // ONLY FOR THE PEOPLE CREATED IN THIS PASS, and a department head only where none is set,
        // so an administrator's own reorganisation is never undone on a restart.
        foreach (var (user, person) in created)
        {
            if (person.ManagerUsername is not null
                && people.TryGetValue(person.ManagerUsername, out var manager)
                && manager.Id != user.Id)
            {
                user.ManagerUserId = manager.Id;
            }
        }

        foreach (var definition in sample.Departments.Where(item => item.HeadUsername is not null))
        {
            if (departments.TryGetValue(definition.Code, out var department)
                && department.HeadUserId is null
                && people.TryGetValue(definition.HeadUsername!, out var head))
            {
                department.HeadUserId = head.Id;
            }
        }

        if (created.Count > 0)
        {
            logger.LogInformation(
                "Seeded {Count} account(s) in {Code} ({Name}).", created.Count, tenant.Code, tenant.Name);
        }
    }

    /// <summary>Adds a person and their one role, which is their primary.</summary>
    private async Task AddPersonAsync(
        User user,
        SampleOrganisationCatalogue.SamplePerson person,
        IReadOnlyDictionary<string, Role> roles,
        Tenant tenant,
        DateTimeOffset now,
        string justification,
        CancellationToken cancellationToken)
    {
        await context.Users.AddAsync(user, cancellationToken);

        if (roles.TryGetValue(person.RoleCode, out var role))
        {
            await context.UserRoles.AddAsync(
                BuildAssignment(tenant.Id, tenant.BusinessUnitId, user.Id, role.Id, now, justification),
                cancellationToken);
        }
    }

    /// <summary>
    /// The outstanding invitation an Invited Organisation's administrator holds - the same row
    /// CreateOrganisationCommand writes when the platform creates an Organisation.
    /// </summary>
    private async Task AddAdministratorInvitationAsync(
        Tenant tenant, User administrator, Role tenantAdminRole, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var plaintext = tokenHasher.GenerateToken();
        var hostName = await context.TenantDomains
            .IgnoreQueryFilters()
            .Where(domain => domain.TenantId == tenant.Id && domain.IsPrimary)
            .Select(domain => domain.HostName)
            .FirstOrDefaultAsync(cancellationToken);

        await context.UserInvitations.AddAsync(new UserInvitation
        {
            TenantId = tenant.Id,
            BusinessUnitId = tenant.BusinessUnitId,
            UserId = administrator.Id,
            Email = administrator.Email!,
            NormalizedEmail = administrator.NormalizedEmail!,
            InvitationType = InvitationType.TenantAdmin,
            InitialRoleId = tenantAdminRole.Id,
            TokenHash = tokenHasher.Hash(plaintext),
            Reference = tokenHasher.GenerateReference("INV"),
            ExpiresAtUtc = now.AddDays(_security.InvitationExpiryDays),
            Status = InvitationStatus.Pending,
            InvitedByUserId = Guid.Empty,
            InvitedAtUtc = now,
            InvitationHostName = hostName,
            Message = $"Welcome to the platform. Accept this invitation to activate {tenant.Name} "
                      + "and complete its registration for approval.",
            LastSentAtUtc = now,
            CreatedAtUtc = now,
            CreatedByUserId = Guid.Empty
        }, cancellationToken);

        // Logged so the flow can be walked without a mail relay. The token exists only in this
        // log line and in the hash - it is not recoverable afterwards.
        logger.LogInformation(
            "Seeded organisation {Code} ({Name}) with a PENDING invitation for {Email} on {Host}. "
            + "Activation token: {Token}",
            tenant.Code, tenant.Name, administrator.Email, hostName, plaintext);
    }

    /// <summary>
    /// A person's account with everything the catalogue says about them, in the Invited-and-
    /// passwordless state CreateUserCommand starts from. <see cref="Activate"/> moves it on.
    /// </summary>
    private static User BuildUser(
        SampleOrganisationCatalogue.SamplePerson person, Guid? tenantId, Guid businessUnitId,
        string code, DateTimeOffset now)
    {
        var email = person.Email.Trim().ToLowerInvariant();
        var username = person.Username.Trim().ToLowerInvariant();

        var user = new User
        {
            TenantId = tenantId,
            BusinessUnitId = businessUnitId,
            Code = code,
            EmployeeNumber = person.EmployeeNumber,
            FirstName = person.FirstName,
            LastName = person.LastName,
            DisplayName = person.DisplayName,
            Email = email,
            NormalizedEmail = email.ToUpperInvariant(),
            UserName = username,
            NormalizedUserName = username.ToUpperInvariant(),
            MobileCountryCode = "+91",
            MobileNumber = person.Mobile,
            Designation = person.Designation,
            AccountCategory = person.Category,
            EngagementType = person.Engagement,
            JoinedOn = person.JoinedOn,
            PreferredCulture = "en-IN",
            TimeZone = "Asia/Kolkata",
            Status = UserStatus.Invited,
            PrivilegeLevel = PrivilegeLevel.Standard,
            MfaRequirement = MfaRequirement.Inherited,
            AccessStartsAtUtc = now,
            LockoutEnabled = true,
            CredentialSetupMethod = CredentialSetupMethod.InvitationLink,
            CreatedAtUtc = now,
            CreatedByUserId = Guid.Empty
        };

        user.PhoneNumber = user.ToE164();

        return user;
    }

    /// <summary>
    /// Ready to sign into: Active, address confirmed, and the password the platform set for it.
    /// A null hash leaves it Active with no password, which a reset link resolves.
    /// </summary>
    private static void Activate(User user, string? passwordHash, DateTimeOffset now)
    {
        user.Status = UserStatus.Active;
        user.EmailConfirmed = true;
        user.EmailConfirmedAtUtc = now;
        user.PasswordHash = passwordHash;
        user.PasswordChangedAtUtc = passwordHash is null ? null : now;
        user.CredentialSetupMethod = CredentialSetupMethod.AdministratorSet;
    }

    private static void PlaceInStructure(
        User user,
        SampleOrganisationCatalogue.SamplePerson person,
        IReadOnlyDictionary<string, Department> departments,
        IReadOnlyDictionary<string, OrganisationUnit> units)
    {
        if (person.DepartmentCode is not null && departments.TryGetValue(person.DepartmentCode, out var department))
        {
            user.DepartmentId = department.Id;
        }

        if (person.UnitCode is not null && units.TryGetValue(person.UnitCode, out var unit))
        {
            user.OrganisationUnitId = unit.Id;
        }
    }

    private static UserRole BuildAssignment(
        Guid? tenantId, Guid businessUnitId, Guid userId, Guid roleId, DateTimeOffset now,
        string justification) =>
        new()
        {
            TenantId = tenantId,
            BusinessUnitId = businessUnitId,
            UserId = userId,
            RoleId = roleId,
            Status = UserRoleAssignmentStatus.Active,
            IsPrimary = true,
            AssignedAtUtc = now,
            AssignedByUserId = Guid.Empty,
            EffectiveFromUtc = now,
            Justification = justification,
            CreatedAtUtc = now,
            CreatedByUserId = Guid.Empty
        };

    private string? HashOrNull(string? password) =>
        string.IsNullOrWhiteSpace(password) ? null : passwordHasher.Hash(password);
}
