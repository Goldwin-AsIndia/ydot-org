using Microsoft.EntityFrameworkCore;
using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Models;
using YDot.IAM.Application.DTOs;
using YDot.IAM.Application.Features.Audit.DTOs;
using YDot.IAM.Application.Features.Governance.Mappings;
using YDot.IAM.Application.Features.Users.DTOs;
using YDot.IAM.Application.Features.Users.Mappings;
using YDot.IAM.Domain.Enums;
using YDot.IAM.Infrastructure.Persistence;

namespace YDot.IAM.Infrastructure.Persistence.ReadServices;

/// <summary>
/// Read side for the audit trail.
///
/// <paramref name="canSeeSensitive"/> does two things, and the second is the important one:
/// it decides whether rows flagged sensitive appear AT ALL, and it decides whether the
/// redacted metadata is returned. Somebody with plain audit access sees that an action
/// happened; somebody with the sensitive permission sees what changed.
/// </summary>
public sealed class AuditReadService(IamDbContext context, ITenantContext tenantContext) : IAuditReadService
{
    /// <summary>
    /// Narrows a query to the Organisation the request is operating in.
    ///
    /// EVERY OTHER TABLE GETS THIS FROM A GLOBAL QUERY FILTER AND THIS ONE CANNOT.
    /// <c>AuditEvent</c> implements <c>IBusinessUnitOwned</c> rather than <c>ITenantOwned</c> -
    /// deliberately, because its TenantId is NULLABLE: a platform action and a failed sign-in
    /// whose host never resolved have no Organisation, and a non-nullable filter would have to
    /// invent one. <c>ApplyTenantQueryFilters</c> only attaches a filter to the two tenant
    /// interfaces, so the audit table had none - and the trail was therefore returning EVERY
    /// Organisation's events to any caller holding <c>iam.audit.view</c>.
    ///
    /// So the scoping is applied here, explicitly, on the three reads that serve a screen.
    ///
    /// NO TENANT MEANS NO NARROWING, and that is the platform case rather than a hole: a request
    /// on the platform host has no Organisation to be narrowed to, and the endpoints behind it
    /// are SuperAdmin-only. A Tenant session always has one.
    /// </summary>
    private IQueryable<Domain.Entities.AuditEvent> ScopedToTenant(
        IQueryable<Domain.Entities.AuditEvent> query) =>
        tenantContext.TenantId is { } tenantId
            ? query.Where(item => item.TenantId == tenantId)
            : query;

    /// <summary>
    /// The events a filter selects, under the caller's sensitivity rule.
    ///
    /// ONE PLACE for the list, the export and the summary, so the cards above the trail and the
    /// rows beneath them always describe the same events.
    /// </summary>
    private IQueryable<Domain.Entities.AuditEvent> Filtered(AuditEventSearchFilter filter, bool canSeeSensitive)
    {
        var query = ScopedToTenant(context.AuditEvents.AsNoTracking());

        // Sensitive rows are excluded entirely without the permission, rather than returned
        // with their detail stripped. A row that says "password reset by administrator" is
        // itself information.
        if (!canSeeSensitive)
        {
            query = query.Where(item => !item.IsSensitive);
        }

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var term = filter.Search.Trim().ToLowerInvariant();

            query = query.Where(item =>
                item.ActionCode.ToLower().Contains(term)
                || (item.ActorDisplayName != null && item.ActorDisplayName.ToLower().Contains(term))
                || (item.TargetDisplayName != null && item.TargetDisplayName.ToLower().Contains(term))
                || item.TargetType.ToLower().Contains(term));
        }

        if (filter.ActorUserId.HasValue)
        {
            query = query.Where(item => item.ActorUserId == filter.ActorUserId.Value);
        }

        if (!string.IsNullOrWhiteSpace(filter.ActionCode))
        {
            query = query.Where(item => item.ActionCode == filter.ActionCode);
        }

        if (!string.IsNullOrWhiteSpace(filter.TargetType))
        {
            query = query.Where(item => item.TargetType == filter.TargetType);
        }

        if (filter.TargetId.HasValue)
        {
            query = query.Where(item => item.TargetId == filter.TargetId.Value);
        }

        if (filter.Result.HasValue)
        {
            query = query.Where(item => item.Result == filter.Result.Value);
        }

        if (filter.IsSensitive.HasValue && canSeeSensitive)
        {
            query = query.Where(item => item.IsSensitive == filter.IsSensitive.Value);
        }

        // The correlation id is how one request is followed across every row it produced,
        // which is the first thing anybody reaches for when investigating.
        if (!string.IsNullOrWhiteSpace(filter.CorrelationId))
        {
            query = query.Where(item => item.CorrelationId == filter.CorrelationId);
        }

        if (filter.FromUtc.HasValue)
        {
            query = query.Where(item => item.OccurredAtUtc >= filter.FromUtc.Value);
        }

        if (filter.ToUtc.HasValue)
        {
            query = query.Where(item => item.OccurredAtUtc <= filter.ToUtc.Value);
        }

        return query;
    }

    public async Task<PagedResponse<AuditEventResponse>> SearchAsync(
        AuditEventSearchFilter filter, bool canSeeSensitive, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);

        var query = Filtered(filter, canSeeSensitive);

        var total = await query.CountAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(item => item.OccurredAtUtc)
            .Skip(filter.Skip)
            .Take(filter.PageSize)
            .Select(item => new
            {
                Event = item,
                TenantName = item.TenantId == null
                    ? null
                    : context.Tenants.IgnoreQueryFilters()
                        .Where(tenant => tenant.Id == item.TenantId)
                        .Select(tenant => tenant.Name).FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        var items = await WithNamesAsync(
            [.. rows.Select(row => ToResponse(row.Event, row.TenantName, canSeeSensitive))],
            cancellationToken);

        return new PagedResponse<AuditEventResponse>(items, total, filter.Page, filter.PageSize);
    }

    /// <summary>The heatmap's four bands of the day, six hours each, in the order they are drawn.</summary>
    private static readonly (string Label, string Range)[] HeatmapBands =
    [
        ("12 AM", "12 AM – 6 AM"),
        ("6 AM", "6 AM – 12 PM"),
        ("12 PM", "12 PM – 6 PM"),
        ("6 PM", "6 PM – 12 AM")
    ];

    private static readonly string[] HeatmapDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    public async Task<AuditSummaryResponse> GetSummaryAsync(
        AuditEventSearchFilter filter, bool canSeeSensitive, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);

        var query = Filtered(filter, canSeeSensitive);
        var zone = ResolveTimeZone(filter.TimeZone);

        // ---- Outcomes ------------------------------------------------------------------------
        var byResult = await query
            .GroupBy(item => item.Result)
            .Select(group => new { Result = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Result, item => item.Count, cancellationToken);

        var total = byResult.Values.Sum();

        static int Percent(int part, int whole) =>
            whole == 0 ? 0 : (int)Math.Round(part * 100d / whole, MidpointRounding.AwayFromZero);

        var outcomes = Enum.GetValues<AuditResult>()
            .Select(result => new AuditOutcomeCount(
                result,
                GovernanceMappingConfig.DescribeAuditResult(result),
                GovernanceMappingConfig.ExplainAuditResult(result),
                byResult.GetValueOrDefault(result),
                Percent(byResult.GetValueOrDefault(result), total)))
            .ToList();

        var succeeded = byResult.GetValueOrDefault(AuditResult.Succeeded);
        var succeededPercent = Percent(succeeded, total);

        // ---- Who acted ----------------------------------------------------------------------------
        // Grouped in the database by id and recorded name, then joined here: an actor is their id
        // when they have one, the recorded name when not, and "the system" when neither.
        var actorGroups = await query
            .GroupBy(item => new { item.ActorUserId, item.ActorDisplayName })
            .Select(group => new { group.Key.ActorUserId, group.Key.ActorDisplayName, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var actors = actorGroups
            .GroupBy(item => item.ActorUserId?.ToString() ?? item.ActorDisplayName ?? "system", StringComparer.Ordinal)
            .Select(group => new
            {
                group.First().ActorUserId,
                Name = group.Select(item => item.ActorDisplayName).FirstOrDefault(name => !string.IsNullOrWhiteSpace(name)),
                Count = group.Sum(item => item.Count)
            })
            .OrderByDescending(item => item.Count)
            .ThenBy(item => item.Name, StringComparer.Ordinal)
            .ToList();

        AuditActorActivity? mostActive = null;

        if (actors.Count > 0)
        {
            var top = actors[0];
            var name = top.Name;

            // A row written before the actor's name was recorded carries the id alone; the same
            // lookup the list uses puts the name back.
            if (string.IsNullOrWhiteSpace(name) && top.ActorUserId is { } actorId)
            {
                var names = await AuditRecordNames.ResolveAsync(context, [actorId], cancellationToken);
                name = names.GetValueOrDefault(actorId);
            }
            else if (!string.IsNullOrWhiteSpace(name))
            {
                var ids = AuditRecordNames.IdsIn([name]);
                if (ids.Count > 0)
                {
                    name = AuditRecordNames.Rewrite(name, await AuditRecordNames.ResolveAsync(context, ids, cancellationToken));
                }
            }

            mostActive = new AuditActorActivity(
                top.ActorUserId,
                string.IsNullOrWhiteSpace(name) ? "System" : name,
                top.Count,
                Percent(top.Count, total));
        }

        // ---- When: day of the week by band of the day, on the viewer's clock ---------------------
        //
        // COUNTED IN THE DATABASE, after converting each instant to the viewer's zone there, so
        // the grid is right for an Organisation of any size and a 9 AM sign-in in Delhi lands in
        // the morning band rather than the UTC one.
        var cells = await query
            .Select(item => TimeZoneInfo.ConvertTimeBySystemTimeZoneId(item.OccurredAtUtc.UtcDateTime, zone))
            .GroupBy(local => new { local.DayOfWeek, Band = local.Hour / 6 })
            .Select(group => new { group.Key.DayOfWeek, group.Key.Band, Count = group.Count() })
            .ToListAsync(cancellationToken);

        var grid = new int[HeatmapBands.Length, HeatmapDays.Length];

        foreach (var cell in cells)
        {
            var mondayFirst = ((int)cell.DayOfWeek + 6) % 7;
            var band = Math.Clamp(cell.Band, 0, HeatmapBands.Length - 1);
            grid[band, mondayFirst] += cell.Count;
        }

        var bands = HeatmapBands
            .Select((band, row) => new AuditHeatmapBand(
                band.Label,
                band.Range,
                [.. Enumerable.Range(0, HeatmapDays.Length).Select(day => grid[row, day])]))
            .ToList();

        var bandTotals = bands.Select(band => band.Counts.Sum()).ToList();
        var busiestBand = bandTotals.Count == 0 ? -1 : bandTotals.IndexOf(bandTotals.Max());

        // ---- What it touched ------------------------------------------------------------------------
        var targetTypes = await query
            .Where(item => item.TargetType != null && item.TargetType != "")
            .GroupBy(item => item.TargetType)
            .Select(group => new AuditTargetTypeCount(group.Key, group.Count()))
            .ToListAsync(cancellationToken);

        return new AuditSummaryResponse(
            total,
            outcomes,
            total - succeeded,
            succeededPercent,
            total == 0 ? 0 : 100 - succeededPercent,
            actors.Count,
            mostActive,
            new AuditHeatmapResponse(
                HeatmapDays,
                bands,
                bands.SelectMany(band => band.Counts).DefaultIfEmpty(0).Max()),
            busiestBand >= 0 && bandTotals[busiestBand] > 0 ? HeatmapBands[busiestBand].Range : null,
            [.. targetTypes.OrderBy(item => item.TargetType, StringComparer.Ordinal)],
            zone);
    }

    /// <summary>
    /// The zone to count the heatmap in: the viewer's, when it is a zone this server and the
    /// database both know, and UTC otherwise. A name is checked against the server's zone list
    /// before it goes anywhere near a query.
    /// </summary>
    private static string ResolveTimeZone(string? requested)
    {
        if (string.IsNullOrWhiteSpace(requested))
        {
            return "UTC";
        }

        var name = requested.Trim();

        if (name.Length > 64 || !TimeZoneInfo.TryFindSystemTimeZoneById(name, out _))
        {
            return "UTC";
        }

        // A Windows zone name is not one the database knows; translate it to IANA.
        if (!name.Contains('/', StringComparison.Ordinal) && !string.Equals(name, "UTC", StringComparison.Ordinal))
        {
            return TimeZoneInfo.TryConvertWindowsIdToIanaId(name, out var iana) ? iana : "UTC";
        }

        return name;
    }

    /// <summary>
    /// The rows with every id a person would read replaced by a name - inside the metadata and
    /// the reason, and in place of an actor or target whose name was not recorded.
    /// See <see cref="AuditRecordNames"/>.
    /// </summary>
    private async Task<List<AuditEventResponse>> WithNamesAsync(
        List<AuditEventResponse> items, CancellationToken cancellationToken)
    {
        var ids = AuditRecordNames.IdsIn(
            items.SelectMany(item => new[] { item.Metadata, item.Reason, item.TargetDisplayName, item.ActorDisplayName }));

        foreach (var item in items)
        {
            if (string.IsNullOrWhiteSpace(item.ActorDisplayName) && item.ActorUserId is { } actorId)
            {
                ids.Add(actorId);
            }

            if (string.IsNullOrWhiteSpace(item.TargetDisplayName) && item.TargetId is { } targetId)
            {
                ids.Add(targetId);
            }
        }

        if (ids.Count == 0)
        {
            return items;
        }

        var names = await AuditRecordNames.ResolveAsync(context, ids, cancellationToken);

        return
        [
            .. items.Select(item => item with
            {
                ActorDisplayName = string.IsNullOrWhiteSpace(item.ActorDisplayName)
                    ? item.ActorUserId is { } actorId && names.TryGetValue(actorId, out var actor) ? actor : item.ActorDisplayName
                    : AuditRecordNames.Rewrite(item.ActorDisplayName, names),
                TargetDisplayName = string.IsNullOrWhiteSpace(item.TargetDisplayName)
                    ? item.TargetId is { } targetId && names.TryGetValue(targetId, out var target) ? target : item.TargetDisplayName
                    : AuditRecordNames.Rewrite(item.TargetDisplayName, names),
                Reason = AuditRecordNames.Rewrite(item.Reason, names),
                Metadata = AuditRecordNames.Rewrite(item.Metadata, names),
            }),
        ];
    }

    public async Task<AuditEventResponse?> GetAsync(
        Guid id, bool canSeeSensitive, CancellationToken cancellationToken)
    {
        var auditEvent = await ScopedToTenant(context.AuditEvents.AsNoTracking())
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (auditEvent is null || (auditEvent.IsSensitive && !canSeeSensitive))
        {
            return null;
        }

        var tenantName = auditEvent.TenantId.HasValue
            ? await context.Tenants.IgnoreQueryFilters()
                .Where(tenant => tenant.Id == auditEvent.TenantId.Value)
                .Select(tenant => tenant.Name)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        return (await WithNamesAsync([ToResponse(auditEvent, tenantName, canSeeSensitive)], cancellationToken))[0];
    }

    /// <summary>
    /// The trail for one record, for the "history" panel on a detail screen.
    ///
    /// Sensitive rows are excluded here unconditionally: this panel appears on ordinary
    /// screens whose permission is about the record, not about the audit trail.
    /// </summary>
    public async Task<IReadOnlyList<AuditEventResponse>> GetForTargetAsync(
        string targetType, Guid targetId, int take, CancellationToken cancellationToken)
    {
        var rows = await ScopedToTenant(context.AuditEvents.AsNoTracking())
            .Where(item => item.TargetType == targetType && item.TargetId == targetId)
            .Where(item => !item.IsSensitive)
            .OrderByDescending(item => item.OccurredAtUtc)
            .Take(Math.Clamp(take, 1, 100))
            .ToListAsync(cancellationToken);

        return await WithNamesAsync(
            [.. rows.Select(row => ToResponse(row, null, canSeeSensitive: false))], cancellationToken);
    }

    /// <summary>
    /// The distinct record types in this Organisation's trail.
    ///
    /// Scoped to the caller's Organisation by ScopedToTenant, exactly like the search above, so
    /// this never reveals that another Organisation has records of a type yours does not. (It used
    /// to say a global query filter did that. There is no filter on this table - see the note on
    /// ScopedToTenant - which is why the scoping is written out.) DISTINCT on an indexed column over a table that is only ever appended to, ordered so
    /// the dropdown is stable between loads rather than reordering as new rows arrive.
    /// </summary>
    public async Task<IReadOnlyList<string>> GetTargetTypesAsync(CancellationToken cancellationToken) =>
        await ScopedToTenant(context.AuditEvents.AsNoTracking())
            .Where(item => item.TargetType != null && item.TargetType != "")
            .Select(item => item.TargetType)
            .Distinct()
            .OrderBy(targetType => targetType)
            .ToListAsync(cancellationToken);

    private static AuditEventResponse ToResponse(
        Domain.Entities.AuditEvent auditEvent, string? tenantName, bool canSeeSensitive) =>
        new(
            auditEvent.Id,
            auditEvent.TenantId,
            tenantName,
            auditEvent.BusinessUnitId,
            auditEvent.ActorUserId,
            auditEvent.ActorDisplayName,
            auditEvent.ActorScope,
            auditEvent.ActionCode,
            GovernanceMappingConfig.DescribeAuditAction(auditEvent.ActionCode),
            auditEvent.TargetType,
            auditEvent.TargetId,
            auditEvent.TargetDisplayName,
            auditEvent.Result,
            auditEvent.Result.ToString(),
            auditEvent.Reason,
            auditEvent.CorrelationId,
            auditEvent.OccurredAtUtc,
            auditEvent.IpAddress,
            auditEvent.UserAgent,
            auditEvent.ClientType,
            auditEvent.SessionId,
            auditEvent.IsSensitive,
            auditEvent.RequestPath,
            // The metadata is already redacted on the way in. Withholding it without the
            // permission is a second, coarser layer on top of that.
            canSeeSensitive ? auditEvent.Metadata : null,
            UserMappingConfig.DescribeClientType(auditEvent.ClientType),
            auditEvent.ActorScope == AccessScopeType.Global ? "Platform administrator" : null,
            GovernanceMappingConfig.ExplainAuditResult(auditEvent.Result));
}

/// <summary>Read side for bulk user administration jobs.</summary>
public sealed class BulkOperationReadService(IamDbContext context) : IBulkOperationReadService
{
    public async Task<PagedResponse<BulkOperationListItemResponse>> SearchAsync(
        PaginationRequest pagination, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pagination);

        var query = context.BulkOperations.AsNoTracking();

        var total = await query.CountAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(operation => operation.CreatedAtUtc)
            .Skip(pagination.Skip)
            .Take(pagination.PageSize)
            .Select(operation => new
            {
                Operation = operation,
                RequestedByName = context.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == operation.RequestedByUserId)
                    .Select(user => user.DisplayName).FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        var items = rows
            .Select(row => new BulkOperationListItemResponse(
                row.Operation.Id,
                row.Operation.OperationNumber,
                row.Operation.ActionType,
                GovernanceMappingConfig.Humanise(row.Operation.ActionType.ToString()),
                row.Operation.Status,
                GovernanceMappingConfig.Humanise(row.Operation.Status.ToString()),
                row.Operation.TotalItemCount,
                row.Operation.ProcessedItemCount,
                row.Operation.SucceededItemCount,
                row.Operation.FailedItemCount,
                row.Operation.PercentComplete,
                row.Operation.CreatedAtUtc,
                row.RequestedByName,
                row.Operation.CompletedAtUtc,
                row.Operation.Version))
            .ToList();

        return new PagedResponse<BulkOperationListItemResponse>(
            items, total, pagination.Page, pagination.PageSize);
    }

    public async Task<BulkOperationDetailResponse?> GetDetailAsync(
        Guid id, CancellationToken cancellationToken)
    {
        var operation = await context.BulkOperations
            .AsNoTracking()
            .Include(item => item.Items.OrderBy(row => row.RowNumber))
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (operation is null)
        {
            return null;
        }

        var requestedByName = await context.Users
            .IgnoreQueryFilters()
            .Where(user => user.Id == operation.RequestedByUserId)
            .Select(user => user.DisplayName)
            .FirstOrDefaultAsync(cancellationToken);

        var actions = operation.Status switch
        {
            Domain.Enums.BulkOperationStatus.Draft => new[] { "View", "Validate", "Cancel" },
            Domain.Enums.BulkOperationStatus.Validated => ["View", "Apply", "Cancel"],
            Domain.Enums.BulkOperationStatus.Queued => ["View", "Cancel"],
            Domain.Enums.BulkOperationStatus.Running => ["View"],
            _ => ["View", "Download"]
        };

        return new BulkOperationDetailResponse(
            operation.Id,
            operation.OperationNumber,
            operation.ActionType,
            GovernanceMappingConfig.Humanise(operation.ActionType.ToString()),
            operation.Status,
            GovernanceMappingConfig.Humanise(operation.Status.ToString()),
            operation.SourceFileName,
            operation.TotalItemCount,
            operation.ProcessedItemCount,
            operation.SucceededItemCount,
            operation.FailedItemCount,
            operation.SkippedItemCount,
            operation.PercentComplete,
            operation.ValidatedAtUtc,
            operation.StartedAtUtc,
            operation.CompletedAtUtc,
            operation.FailureSummary,
            operation.CreatedAtUtc,
            requestedByName,
            operation.Version,
            [
                .. operation.Items.Select(item => new BulkOperationItemResponse(
                    item.Id, item.RowNumber, item.UserId, item.SourceIdentifier,
                    item.IsValid, item.ValidationMessage, item.IsProcessed,
                    item.Succeeded, item.WasSkipped, item.ResultMessage))
            ],
            actions);
    }
}
