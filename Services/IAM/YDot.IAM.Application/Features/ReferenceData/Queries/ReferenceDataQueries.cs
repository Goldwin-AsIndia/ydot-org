using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Application.Common.Models;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.Features.Governance.Mappings;
using YDot.IAM.Application.Features.Roles.Mappings;
using YDot.IAM.Application.Features.Users.Mappings;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.ReferenceData.Queries;

/// <summary>Everything the create and edit screens need to render their dropdowns, in one call.</summary>
public sealed record GetReferenceDataQuery;

/// <summary>The enum values the client needs, so it never hard-codes a list that can drift.</summary>
public sealed record GetEnumOptionsQuery;

/// <summary>
/// The reference data a screen needs before it can be drawn.
///
/// RETURNED AS ONE PAYLOAD, DELIBERATELY. A user-create form needs roles, departments, units
/// and managers. Four endpoints would mean four round trips before the form is usable, and
/// four chances for one of them to fail and leave the screen half-populated.
///
/// EVERYTHING IS ALREADY ORGANISATION-SCOPED by the query filter, so a department from another
/// Organisation cannot appear in the list - and therefore cannot be selected.
/// </summary>
public sealed class ReferenceDataQueryHandler(
    ILookupRepository lookups,
    ITenantRepository tenantRepository,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
{
    public async Task<Result<ReferenceDataResponse>> HandleAsync(
        GetReferenceDataQuery query, CancellationToken cancellationToken)
    {
        // FETCHED ONE AFTER ANOTHER, NOT IN PARALLEL. These six reads share one DbContext, and
        // EF Core permits exactly one operation on a context at a time - starting them together
        // throws "a second operation was started on this context instance" rather than running
        // them concurrently. Nor was there anything to win: one context means one connection,
        // so the database would have serialised them regardless.
        var roles = await lookups.GetRolesAsync(cancellationToken);
        var departments = await lookups.GetDepartmentsAsync(cancellationToken);
        var units = await lookups.GetOrganisationUnitsAsync(cancellationToken);
        var managers = await lookups.GetManagersAsync(cancellationToken);
        var permissions = await lookups.GetPermissionsAsync(cancellationToken);
        var tenants = await lookups.GetSelectableTenantsAsync(cancellationToken);

        // What an "Inherited" two-step requirement resolves to in this Organisation, so the
        // create form can say so instead of offering a word that means nothing on its own.
        var organisation = tenantContext.HasTenant
            ? await tenantRepository.GetByIdAsync(tenantContext.RequireTenantId(), cancellationToken)
            : null;

        return Result.Success(new ReferenceDataResponse(
            roles,
            departments,
            units,
            managers,
            permissions,
            // Empty for a Tenant user. The switcher is not part of their interface.
            tenants,
            BuildEnumOptions(),
            tenantContext.TenantId,
            tenantContext.TenantName,
            currentUser.IsSuperAdmin,
            currentUser.IsTenantAdmin,
            organisation?.DefaultMfaRequirement ?? MfaRequirement.Optional));
    }

    public Task<Result<EnumOptionsResponse>> HandleAsync(
        GetEnumOptionsQuery query, CancellationToken cancellationToken) =>
        Task.FromResult(Result.Success(BuildEnumOptions()));

    /// <summary>
    /// The enum values, served from the server.
    ///
    /// The client could hard-code these, and then they would drift the first time a value is
    /// added. Serving them means one source of truth and a dropdown that is never stale.
    /// </summary>
    private static EnumOptionsResponse BuildEnumOptions() => new(
        Describe<UserStatus>(),
        Describe<EngagementType>(),
        Describe<MfaRequirement>(),
        // The security pages' own words, from the one place they are kept.
        Describe<MfaMethodType>(UserMappingConfig.DescribeMfaMethod),
        // Labelled as the role records label them (StatusDisplay, RoleTypeDisplay), so a filter
        // option and the row it finds read the same - "Organisation", not "Tenant".
        Describe<RoleStatus>(RoleMappingConfig.DescribeStatus),
        Describe<RoleType>(RoleMappingConfig.DescribeRoleType),
        Describe<PermissionAction>(),
        // As the access request queue, the access preview and the exports print them.
        Describe<DataScopeType>(GovernanceMappingConfig.DescribeScopeType),
        Describe<TenantStatus>(),
        Describe<TenantDocumentType>(),
        Describe<AccessRequestType>(),
        Describe<AccessRequestStatus>(),
        Describe<AccessReviewStatus>(),
        Describe<AccessReviewDecision>(),
        Describe<BulkActionType>(),
        Describe<ClientType>(UserMappingConfig.DescribeClientType),
        Describe<PrivilegeLevel>(),
        Describe<RecordStatus>(),
        Describe<MenuLevel>(),
        Describe<MenuStatus>(),
        // Each outcome with a line saying what it means, which the audit trail's filter shows
        // beneath the name: a denial is the system working, a failure is something breaking.
        Describe<AuditResult>(GovernanceMappingConfig.DescribeAuditResult, GovernanceMappingConfig.ExplainAuditResult),
        // Labels, not enum names: the column stores the label itself. See OrganisationTypes.
        [.. OrganisationTypes.All.Select((label, index) => new EnumOption(label, label, index))],
        // Same: the title column stores the word itself. See PersonTitles.
        [.. PersonTitles.All.Select((label, index) => new EnumOption(label, label, index))]);

    /// <summary>Turns an enum into name/label pairs, with the label humanised for display.</summary>
    private static IReadOnlyList<EnumOption> Describe<TEnum>() where TEnum : struct, Enum =>
        Describe<TEnum>(value => Humanise(value.ToString()!));

    /// <summary>The same, with labels from the slice that owns the enum's wording.</summary>
    private static IReadOnlyList<EnumOption> Describe<TEnum>(
        Func<TEnum, string> label, Func<TEnum, string?>? description = null) where TEnum : struct, Enum =>
    [
        .. Enum.GetValues<TEnum>()
            .Select(value => new EnumOption(
                value.ToString(),
                label(value),
                Convert.ToInt32(value, System.Globalization.CultureInfo.InvariantCulture),
                description?.Invoke(value)))
    ];

    /// <summary>"ProfileIncomplete" becomes "Profile incomplete".</summary>
    private static string Humanise(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return value;
        }

        var builder = new System.Text.StringBuilder(value.Length + 8);
        builder.Append(value[0]);

        for (var index = 1; index < value.Length; index++)
        {
            if (char.IsUpper(value[index]) && !char.IsUpper(value[index - 1]))
            {
                builder.Append(' ').Append(char.ToLowerInvariant(value[index]));
            }
            else
            {
                builder.Append(value[index]);
            }
        }

        return builder.ToString();
    }
}

/// <summary>Everything a create or edit screen needs, in one payload.</summary>
public sealed record ReferenceDataResponse(
    IReadOnlyList<LookupItem> Roles,
    IReadOnlyList<LookupItem> Departments,
    IReadOnlyList<LookupItem> OrganisationUnits,
    IReadOnlyList<LookupItem> Managers,
    IReadOnlyList<LookupItem> Permissions,
    IReadOnlyList<LookupItem> SelectableOrganisations,
    EnumOptionsResponse Enums,
    Guid? CurrentTenantId,
    string? CurrentTenantName,
    bool IsSuperAdmin,
    bool IsTenantAdmin,

    /// <summary>
    /// The Organisation's default two-step requirement - what a user whose own requirement is
    /// "Inherited" actually gets. Optional when no Organisation is selected.
    /// </summary>
    MfaRequirement OrganisationMfaRequirement);

/// <summary>One selectable enum value.</summary>
public sealed record EnumOption(
    string Value,
    string Label,
    int Ordinal,

    /// <summary>A line saying what the value means, where one helps. Null for most enums.</summary>
    string? Description = null);

/// <summary>Every enum the client renders as a dropdown.</summary>
public sealed record EnumOptionsResponse(
    IReadOnlyList<EnumOption> UserStatuses,
    IReadOnlyList<EnumOption> EngagementTypes,
    IReadOnlyList<EnumOption> MfaRequirements,
    IReadOnlyList<EnumOption> MfaMethodTypes,
    IReadOnlyList<EnumOption> RoleStatuses,
    IReadOnlyList<EnumOption> RoleTypes,
    IReadOnlyList<EnumOption> PermissionActions,
    IReadOnlyList<EnumOption> DataScopeTypes,
    IReadOnlyList<EnumOption> OrganisationStatuses,
    IReadOnlyList<EnumOption> DocumentTypes,
    IReadOnlyList<EnumOption> AccessRequestTypes,
    IReadOnlyList<EnumOption> AccessRequestStatuses,
    IReadOnlyList<EnumOption> AccessReviewStatuses,
    IReadOnlyList<EnumOption> AccessReviewDecisions,
    IReadOnlyList<EnumOption> BulkActionTypes,
    IReadOnlyList<EnumOption> ClientTypes,
    IReadOnlyList<EnumOption> PrivilegeLevels,

    /// <summary>Department and organisation-unit status.</summary>
    IReadOnlyList<EnumOption> RecordStatuses,

    /// <summary>The three depths of the navigation catalogue.</summary>
    IReadOnlyList<EnumOption> MenuLevels,

    IReadOnlyList<EnumOption> MenuStatuses,

    /// <summary>How an audited action ended, for the audit trail's outcome filter.</summary>
    IReadOnlyList<EnumOption> AuditResults,

    /// <summary>The organisation types on offer. Value and label are the same stored text.</summary>
    IReadOnlyList<EnumOption> OrganisationTypes,

    /// <summary>Honorifics for a person's title. Value and label are the same stored text.</summary>
    IReadOnlyList<EnumOption> PersonTitles);
