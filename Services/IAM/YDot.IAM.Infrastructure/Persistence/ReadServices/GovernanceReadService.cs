using Microsoft.EntityFrameworkCore;
using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Services;
using YDot.IAM.Application.Common.Models;
using YDot.IAM.Application.DTOs;
using YDot.IAM.Application.Features.Audit.DTOs;
using YDot.IAM.Application.Features.Governance.DTOs;
using YDot.IAM.Application.Features.Governance.Mappings;
using YDot.IAM.Application.Features.Users.DTOs;
using YDot.IAM.Domain.Enums;
using YDot.IAM.Infrastructure.Persistence;

namespace YDot.IAM.Infrastructure.Persistence.ReadServices;

/// <summary>Read side for access requests, reviews and identifier changes.</summary>
public sealed class GovernanceReadService(
    IamDbContext context,
    IDateTimeProvider clock) : IGovernanceReadService
{
    /// <summary>
    /// The requests a filter selects.
    ///
    /// ONE PLACE, used by the queue, the figures above it and the export, so the three can never
    /// describe different sets of requests.
    /// </summary>
    private IQueryable<Domain.Entities.AccessRequest> Filtered(
        AccessRequestSearchFilter filter, Guid currentUserId)
    {
        var query = context.AccessRequests.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var term = filter.Search.Trim().ToLowerInvariant();

            // Everything a row shows that somebody would type: the reference, either person, and
            // what is being asked for. It matched the reference and the subject only, so searching
            // for a role or for the colleague who raised the request found nothing.
            query = query.Where(request =>
                request.RequestNumber.ToLower().Contains(term)
                || request.BusinessJustification.ToLower().Contains(term)
                || request.RequestedForUser!.DisplayName.ToLower().Contains(term)
                || (request.Role != null && (request.Role.Name ?? request.Role.Code).ToLower().Contains(term))
                || (request.PermissionCode != null && request.PermissionCode.ToLower().Contains(term))
                || context.Users.IgnoreQueryFilters().Any(user =>
                    user.Id == request.RequestedByUserId && user.DisplayName.ToLower().Contains(term)));
        }

        if (filter.Status.HasValue)
        {
            query = query.Where(request => request.Status == filter.Status.Value);
        }

        if (filter.RequestType.HasValue)
        {
            query = query.Where(request => request.RequestType == filter.RequestType.Value);
        }

        if (filter.RequestedForUserId.HasValue)
        {
            query = query.Where(request => request.RequestedForUserId == filter.RequestedForUserId.Value);
        }

        if (filter.RequestedByUserId.HasValue)
        {
            query = query.Where(request => request.RequestedByUserId == filter.RequestedByUserId.Value);
        }

        if (filter.RoleId.HasValue)
        {
            query = query.Where(request => request.RoleId == filter.RoleId.Value);
        }

        if (filter.IsSensitive.HasValue)
        {
            query = query.Where(request => request.IsSensitive == filter.IsSensitive.Value);
        }

        // "Waiting on me" excludes the caller own requests, because maker and checker have to
        // be different people and offering somebody their own request to approve is noise.
        if (filter.AwaitingMyDecision == true)
        {
            query = query.Where(request =>
                request.Status == AccessRequestStatus.Submitted
                && request.RequestedByUserId != currentUserId
                && request.RequestedForUserId != currentUserId);
        }

        if (filter.RaisedByMe == true)
        {
            query = query.Where(request => request.RequestedByUserId == currentUserId);
        }

        if (filter.SubmittedFromUtc.HasValue)
        {
            query = query.Where(request => request.SubmittedAtUtc >= filter.SubmittedFromUtc.Value);
        }

        if (filter.SubmittedToUtc.HasValue)
        {
            query = query.Where(request => request.SubmittedAtUtc <= filter.SubmittedToUtc.Value);
        }

        return query;
    }

    public async Task<PagedResponse<AccessRequestListItemResponse>> SearchRequestsAsync(
        AccessRequestSearchFilter filter, AccessRequestViewer viewer, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        ArgumentNullException.ThrowIfNull(viewer);

        var query = Filtered(filter, viewer.UserId);

        var total = await query.CountAsync(cancellationToken);

        var rows = await query
            .OrderByDescending(request => request.SubmittedAtUtc ?? request.CreatedAtUtc)
            // The number breaks a tie, so two requests raised in the same instant keep their
            // order from one page to the next.
            .ThenByDescending(request => request.RequestNumber)
            .Skip(filter.Skip)
            .Take(filter.PageSize)
            .Select(request => new
            {
                request.Id,
                request.RequestNumber,
                request.RequestedForUserId,
                RequestedForName = request.RequestedForUser!.DisplayName,
                RequestedByName = context.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == request.RequestedByUserId)
                    .Select(user => user.DisplayName).FirstOrDefault(),
                request.RequestType,
                RoleName = request.Role != null ? request.Role.Name ?? request.Role.Code : null,
                request.PermissionCode,
                PermissionName = request.PermissionCode == null
                    ? null
                    : context.Permissions
                        .Where(permission => permission.Code == request.PermissionCode)
                        .Select(permission => permission.Name).FirstOrDefault(),
                request.Status,
                request.IsSensitive,
                request.SubmittedAtUtc,
                request.AccessStartsAtUtc,
                request.AccessEndsAtUtc,
                request.DecidedAtUtc,
                DecidedByName = request.DecidedByUserId == null
                    ? null
                    : context.Users.IgnoreQueryFilters()
                        .Where(user => user.Id == request.DecidedByUserId)
                        .Select(user => user.DisplayName).FirstOrDefault(),
                request.RequestedByUserId,
                request.Version,
                request.ScopeType,
                request.ScopeValue
            })
            .ToListAsync(cancellationToken);

        var items = rows
            .Select(row => new AccessRequestListItemResponse(
                row.Id,
                row.RequestNumber,
                row.RequestedForUserId,
                row.RequestedForName,
                row.RequestedByName ?? string.Empty,
                row.RequestType,
                SplitPascalCase(row.RequestType.ToString()),
                row.RoleName,
                row.PermissionCode,
                row.Status,
                SplitPascalCase(row.Status.ToString()),
                row.IsSensitive,
                row.SubmittedAtUtc,
                row.AccessStartsAtUtc,
                row.AccessEndsAtUtc,
                row.DecidedAtUtc,
                row.DecidedByName,
                // The independence rule and the caller's permission together, so the queue
                // offers a decision only where the API would accept one.
                CanDecide: GovernanceMappingConfig.CanDecide(
                    row.Status, row.RequestedByUserId, row.RequestedForUserId, viewer),
                // Only the person who raised it, and only while nothing has been decided.
                CanCancel: GovernanceMappingConfig.CanCancel(row.Status, row.RequestedByUserId, viewer),
                row.Version,
                ScopeType: row.ScopeType,
                ScopeValue: row.ScopeValue,
                ScopeTypeDisplay: row.ScopeType.HasValue
                    ? GovernanceMappingConfig.DescribeScopeType(row.ScopeType.Value)
                    : null,
                PermissionName: row.PermissionName,
                PermittedActions: GovernanceMappingConfig.PermittedActionsFor(
                    row.Status, row.RequestedByUserId, row.RequestedForUserId, viewer),
                CannotDecideReason: GovernanceMappingConfig.CannotDecideReason(
                    row.Status, row.RequestedByUserId, row.RequestedForUserId, viewer)))
            .ToList();

        return new PagedResponse<AccessRequestListItemResponse>(items, total, filter.Page, filter.PageSize);
    }

    public async Task<AccessRequestSummaryResponse> GetRequestSummaryAsync(
        AccessRequestSearchFilter filter, AccessRequestViewer viewer, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        ArgumentNullException.ThrowIfNull(viewer);

        var query = Filtered(filter, viewer.UserId);

        var counts = await query
            .GroupBy(request => request.Status)
            .Select(group => new { Status = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Status, item => item.Count, cancellationToken);

        // One row per person the matching requests are for, busiest first. Bounded by the number
        // of people in the Organisation, and both figures the cards need come from it.
        var perPerson = await query
            .GroupBy(request => request.RequestedForUserId)
            .Select(group => new { UserId = group.Key, Count = group.Count() })
            .OrderByDescending(item => item.Count)
            .ThenBy(item => item.UserId)
            .ToListAsync(cancellationToken);

        var busiest = perPerson.Count > 0 ? perPerson[0] : null;

        var busiestName = busiest is null
            ? null
            : await context.Users.IgnoreQueryFilters()
                .Where(user => user.Id == busiest.UserId)
                .Select(user => user.DisplayName)
                .FirstOrDefaultAsync(cancellationToken);

        int Count(AccessRequestStatus status) => counts.GetValueOrDefault(status);

        return new AccessRequestSummaryResponse(
            Total: counts.Values.Sum(),
            Approved: Count(AccessRequestStatus.Approved),
            // Waiting on somebody: on an approver, or on the requester to correct it.
            Pending: Count(AccessRequestStatus.Submitted) + Count(AccessRequestStatus.Returned),
            Rejected: Count(AccessRequestStatus.Rejected),
            UsersInvolved: perPerson.Count,
            MostActiveUserName: busiestName,
            MostActiveUserRequestCount: busiest?.Count ?? 0,
            ByStatus:
            [
                .. Enum.GetValues<AccessRequestStatus>().Select(status => new AccessRequestStatusCount(
                    status, SplitPascalCase(status.ToString()), Count(status)))
            ]);
    }

    public async Task<IReadOnlyList<AccessRequestExportRow>> GetRequestExportRowsAsync(
        AccessRequestSearchFilter filter, AccessRequestViewer viewer, int maximumRows,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);
        ArgumentNullException.ThrowIfNull(viewer);

        var rows = await Filtered(filter, viewer.UserId)
            .OrderByDescending(request => request.SubmittedAtUtc ?? request.CreatedAtUtc)
            .ThenByDescending(request => request.RequestNumber)
            .Take(Math.Max(1, maximumRows))
            .Select(request => new
            {
                request.RequestNumber,
                request.RequestType,
                RequestedForName = request.RequestedForUser!.DisplayName,
                RequestedByName = context.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == request.RequestedByUserId)
                    .Select(user => user.DisplayName).FirstOrDefault(),
                RoleName = request.Role != null ? request.Role.Name ?? request.Role.Code : null,
                request.PermissionCode,
                request.ScopeType,
                request.ScopeValue,
                request.Status,
                request.IsSensitive,
                request.SubmittedAtUtc,
                request.AccessStartsAtUtc,
                request.AccessEndsAtUtc,
                request.DecidedAtUtc,
                DecidedByName = request.DecidedByUserId == null
                    ? null
                    : context.Users.IgnoreQueryFilters()
                        .Where(user => user.Id == request.DecidedByUserId)
                        .Select(user => user.DisplayName).FirstOrDefault(),
                request.DecisionNotes,
                request.BusinessJustification
            })
            .ToListAsync(cancellationToken);

        // The queue's own words, so the file and the screen it came from describe a request the
        // same way.
        return
        [
            .. rows.Select(row => new AccessRequestExportRow(
                row.RequestNumber,
                SplitPascalCase(row.RequestType.ToString()),
                row.RequestedForName,
                row.RequestedByName ?? string.Empty,
                row.RoleName,
                row.PermissionCode,
                row.ScopeType.HasValue ? GovernanceMappingConfig.DescribeScopeType(row.ScopeType.Value) : null,
                row.ScopeValue,
                SplitPascalCase(row.Status.ToString()),
                row.IsSensitive,
                row.SubmittedAtUtc,
                row.AccessStartsAtUtc,
                row.AccessEndsAtUtc,
                row.DecidedAtUtc,
                row.DecidedByName,
                row.DecisionNotes,
                row.BusinessJustification))
        ];
    }

    public async Task<AccessRequestDetailResponse?> GetRequestAsync(
        Guid id, AccessRequestViewer viewer, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(viewer);

        var request = await context.AccessRequests
            .AsNoTracking()
            .Include(item => item.RequestedForUser)
            .Include(item => item.Role)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (request?.RequestedForUser is null)
        {
            return null;
        }

        // The three people a request can name besides its subject, in one read.
        var personIds = new Guid?[] { request.RequestedByUserId, request.DecidedByUserId, request.ReturnedByUserId }
            .Where(personId => personId.HasValue)
            .Select(personId => personId!.Value)
            .Distinct()
            .ToList();

        var names = await context.Users
            .IgnoreQueryFilters()
            .Where(user => personIds.Contains(user.Id))
            .Select(user => new { user.Id, user.DisplayName })
            .ToDictionaryAsync(item => item.Id, item => item.DisplayName, cancellationToken);

        string? NameOf(Guid? personId) =>
            personId.HasValue && names.TryGetValue(personId.Value, out var name) ? name : null;

        // What the requested access would actually add, so the approver sees the consequence
        // rather than only the role name.
        var permissionsGranted = request.RoleId.HasValue
            ? await context.RolePermissions
                .AsNoTracking()
                .Where(grant => grant.RoleId == request.RoleId.Value && !grant.IsDenied)
                .Select(grant => grant.PermissionCode)
                .OrderBy(code => code)
                .ToListAsync(cancellationToken)
            : string.IsNullOrWhiteSpace(request.PermissionCode)
                ? []
                : [request.PermissionCode];

        var permissionName = string.IsNullOrWhiteSpace(request.PermissionCode)
            ? null
            : await context.Permissions
                .AsNoTracking()
                .Where(permission => permission.Code == request.PermissionCode)
                .Select(permission => permission.Name)
                .FirstOrDefaultAsync(cancellationToken);

        return new AccessRequestDetailResponse(
            request.Id,
            request.RequestNumber,
            request.RequestedForUserId,
            request.RequestedForUser.DisplayName,
            request.RequestedForUser.Email ?? string.Empty,
            request.RequestedByUserId,
            NameOf(request.RequestedByUserId) ?? string.Empty,
            request.RequestType,
            SplitPascalCase(request.RequestType.ToString()),
            request.RoleId,
            request.Role?.Name ?? request.Role?.Code,
            request.PermissionCode,
            request.ScopeType,
            request.ScopeValue,
            request.BusinessJustification,
            request.AccessStartsAtUtc,
            request.AccessEndsAtUtc,
            request.Status,
            SplitPascalCase(request.Status.ToString()),
            request.IsSensitive,
            request.SubmittedAtUtc,
            request.DecidedAtUtc,
            request.DecidedByUserId,
            NameOf(request.DecidedByUserId),
            request.DecisionNotes,
            request.WithdrawnAtUtc,
            request.WithdrawalReason,
            request.GrantedUserRoleId,
            request.CreatedAtUtc,
            request.Version,
            permissionsGranted,
            // Filled in by the query handler, which has the access service this layer does not.
            SegregationOfDutiesConflicts: [],
            // FOR THIS CALLER. It answered "is it submitted?" for everybody, so the person who
            // raised a request was told they could decide it - and was refused when they tried.
            CanDecide: GovernanceMappingConfig.CanDecide(
                request.Status, request.RequestedByUserId, request.RequestedForUserId, viewer),
            GovernanceMappingConfig.PermittedActionsFor(request, viewer),
            ScopeTypeDisplay: request.ScopeType.HasValue
                ? GovernanceMappingConfig.DescribeScopeType(request.ScopeType.Value)
                : null,
            PermissionName: permissionName,
            ReturnReason: request.ReturnReason,
            ReturnedAtUtc: request.ReturnedAtUtc,
            ReturnedByName: NameOf(request.ReturnedByUserId),
            ReturnCount: request.ReturnCount,
            ExpiresAtUtc: request.ExpiresAtUtc,
            CanCancel: GovernanceMappingConfig.CanCancel(request.Status, request.RequestedByUserId, viewer),
            CannotDecideReason: GovernanceMappingConfig.CannotDecideReason(
                request.Status, request.RequestedByUserId, request.RequestedForUserId, viewer));
    }

    public async Task<PagedResponse<AccessReviewListItemResponse>> SearchReviewsAsync(
        AccessReviewSearchFilter filter, Guid currentUserId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);

        var now = clock.UtcNow;
        var query = context.AccessReviews.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var term = filter.Search.Trim().ToLowerInvariant();

            query = query.Where(review =>
                review.ReviewNumber.ToLower().Contains(term)
                || review.SubjectUser!.DisplayName.ToLower().Contains(term));
        }

        if (filter.Status.HasValue)
        {
            query = query.Where(review => review.Status == filter.Status.Value);
        }

        if (filter.Decision.HasValue)
        {
            query = query.Where(review => review.Decision == filter.Decision.Value);
        }

        if (filter.CampaignId.HasValue)
        {
            query = query.Where(review => review.CampaignId == filter.CampaignId.Value);
        }

        if (filter.SubjectUserId.HasValue)
        {
            query = query.Where(review => review.SubjectUserId == filter.SubjectUserId.Value);
        }

        if (filter.ReviewerUserId.HasValue)
        {
            query = query.Where(review => review.ReviewerUserId == filter.ReviewerUserId.Value);
        }

        if (filter.AssignedToMe == true)
        {
            query = query.Where(review => review.ReviewerUserId == currentUserId);
        }

        if (filter.IsOverdue == true)
        {
            query = query.Where(review =>
                review.ReviewDueAtUtc < now
                && (review.Status == AccessReviewStatus.Open
                    || review.Status == AccessReviewStatus.InProgress
                    || review.Status == AccessReviewStatus.Overdue));
        }

        if (filter.DueFromUtc.HasValue)
        {
            query = query.Where(review => review.ReviewDueAtUtc >= filter.DueFromUtc.Value);
        }

        if (filter.DueToUtc.HasValue)
        {
            query = query.Where(review => review.ReviewDueAtUtc <= filter.DueToUtc.Value);
        }

        var total = await query.CountAsync(cancellationToken);

        var rows = await query
            .OrderBy(review => review.ReviewDueAtUtc)
            .Skip(filter.Skip)
            .Take(filter.PageSize)
            .Select(review => new
            {
                review.Id,
                review.ReviewNumber,
                review.CampaignId,
                CampaignName = review.Campaign != null ? review.Campaign.Name : null,
                review.SubjectUserId,
                SubjectName = review.SubjectUser!.DisplayName,
                ReviewerName = context.Users.IgnoreQueryFilters()
                    .Where(user => user.Id == review.ReviewerUserId)
                    .Select(user => user.DisplayName).FirstOrDefault(),
                RoleName = review.Role != null ? review.Role.Name ?? review.Role.Code : null,
                review.Status,
                review.Decision,
                review.ReviewDueAtUtc,
                review.DecidedAtUtc,
                review.IsDecisionApplied,
                review.ReviewerUserId,
                review.Version
            })
            .ToListAsync(cancellationToken);

        var items = rows
            .Select(row => new AccessReviewListItemResponse(
                row.Id,
                row.ReviewNumber,
                row.CampaignId,
                row.CampaignName,
                row.SubjectUserId,
                row.SubjectName,
                row.ReviewerName ?? string.Empty,
                row.RoleName,
                row.Status,
                SplitPascalCase(row.Status.ToString()),
                row.Decision,
                row.ReviewDueAtUtc,
                row.ReviewDueAtUtc < now
                    && row.Status is AccessReviewStatus.Open or AccessReviewStatus.InProgress
                        or AccessReviewStatus.Overdue,
                row.DecidedAtUtc,
                row.IsDecisionApplied,
                row.ReviewerUserId == currentUserId,
                row.Version))
            .ToList();

        return new PagedResponse<AccessReviewListItemResponse>(items, total, filter.Page, filter.PageSize);
    }

    public async Task<AccessReviewDetailResponse?> GetReviewAsync(Guid id, CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;

        var review = await context.AccessReviews
            .AsNoTracking()
            .Include(item => item.SubjectUser)
            .Include(item => item.Role)
            .Include(item => item.Campaign)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (review?.SubjectUser is null)
        {
            return null;
        }

        var reviewerName = await context.Users
            .IgnoreQueryFilters()
            .Where(user => user.Id == review.ReviewerUserId)
            .Select(user => user.DisplayName)
            .FirstOrDefaultAsync(cancellationToken);

        // The snapshot taken when the review was raised, so a later change cannot alter what
        // the reviewer was actually asked about.
        var snapshot = string.IsNullOrWhiteSpace(review.AccessSnapshot)
            ? []
            : review.AccessSnapshot.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var isOverdue = review.IsOverdue(now);

        return new AccessReviewDetailResponse(
            review.Id,
            review.ReviewNumber,
            review.CampaignId,
            review.Campaign?.Name,
            review.SubjectUserId,
            review.SubjectUser.DisplayName,
            review.SubjectUser.Email ?? string.Empty,
            review.ReviewerUserId,
            reviewerName ?? string.Empty,
            review.UserRoleId,
            review.RoleId,
            review.Role?.Name ?? review.Role?.Code,
            review.ReviewDueAtUtc,
            review.Decision,
            review.DecisionReason,
            review.DecidedAtUtc,
            review.Status,
            SplitPascalCase(review.Status.ToString()),
            isOverdue,
            review.IsDecisionApplied,
            review.DecisionAppliedAtUtc,
            review.ReminderCount,
            review.LastRemindedAtUtc,
            review.Version,
            snapshot,
            review.IsOpen ? ["View", "Decide", "Cancel"] : ["View"]);
    }

    public async Task<IReadOnlyList<AccessReviewCampaignResponse>> GetCampaignsAsync(
        CancellationToken cancellationToken)
    {
        var campaigns = await context.AccessReviewCampaigns
            .AsNoTracking()
            .OrderByDescending(campaign => campaign.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var names = await context.Users
            .IgnoreQueryFilters()
            .Where(user => campaigns.Select(item => item.ClosedByUserId).Contains(user.Id))
            .Select(user => new { user.Id, user.DisplayName })
            .ToDictionaryAsync(item => item.Id, item => item.DisplayName, cancellationToken);

        return [.. campaigns.Select(campaign => ToCampaignResponse(campaign, names))];
    }

    public async Task<AccessReviewCampaignResponse?> GetCampaignAsync(
        Guid id, CancellationToken cancellationToken)
    {
        var campaign = await context.AccessReviewCampaigns
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (campaign is null)
        {
            return null;
        }

        var closedByName = campaign.ClosedByUserId.HasValue
            ? await context.Users.IgnoreQueryFilters()
                .Where(user => user.Id == campaign.ClosedByUserId.Value)
                .Select(user => user.DisplayName)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        return ToCampaignResponse(
            campaign,
            closedByName is null
                ? new Dictionary<Guid, string>()
                : new Dictionary<Guid, string> { [campaign.ClosedByUserId!.Value] = closedByName });
    }

    public async Task<LoginIdentifierChangeResponse?> GetIdentifierChangeAsync(
        Guid id, CancellationToken cancellationToken)
    {
        var request = await context.LoginIdentifierChangeRequests
            .AsNoTracking()
            .Include(item => item.User)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        return request is null ? null : await ToIdentifierChangeResponseAsync(request, cancellationToken);
    }

    public async Task<IReadOnlyList<LoginIdentifierChangeResponse>> GetIdentifierChangesForUserAsync(
        Guid userId, CancellationToken cancellationToken)
    {
        var requests = await context.LoginIdentifierChangeRequests
            .AsNoTracking()
            .Include(item => item.User)
            .Where(item => item.UserId == userId)
            .OrderByDescending(item => item.RequestedAtUtc)
            .ToListAsync(cancellationToken);

        var results = new List<LoginIdentifierChangeResponse>(requests.Count);

        foreach (var request in requests)
        {
            results.Add(await ToIdentifierChangeResponseAsync(request, cancellationToken));
        }

        return results;
    }

    private async Task<LoginIdentifierChangeResponse> ToIdentifierChangeResponseAsync(
        Domain.Entities.LoginIdentifierChangeRequest request, CancellationToken cancellationToken)
    {
        var requestedByName = await context.Users
            .IgnoreQueryFilters()
            .Where(user => user.Id == request.RequestedByUserId)
            .Select(user => user.DisplayName)
            .FirstOrDefaultAsync(cancellationToken);

        var approvedByName = request.ApprovedByUserId.HasValue
            ? await context.Users.IgnoreQueryFilters()
                .Where(user => user.Id == request.ApprovedByUserId.Value)
                .Select(user => user.DisplayName)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        var actions = request.Status switch
        {
            LoginIdentifierChangeStatus.PendingVerification => new[] { "View", "Verify", "Cancel" },
            LoginIdentifierChangeStatus.PendingApproval => ["View", "Approve", "Reject", "Cancel"],
            LoginIdentifierChangeStatus.Approved => ["View", "Apply", "Cancel"],
            _ => ["View"]
        };

        return new LoginIdentifierChangeResponse(
            request.Id,
            request.UserId,
            request.User?.DisplayName ?? string.Empty,
            request.IsEmailChange,
            request.CurrentValue,
            request.RequestedValue,
            request.Status,
            SplitPascalCase(request.Status.ToString()),
            request.RequestedAtUtc,
            requestedByName,
            request.Reason,
            request.VerifiedAtUtc,
            request.PreviousOwnerNotifiedAtUtc,
            request.ApprovedAtUtc,
            approvedByName,
            request.RejectedAtUtc,
            request.RejectionReason,
            request.AppliedAtUtc,
            request.ExpiresAtUtc,
            request.RequiresApproval,
            request.Version,
            actions);
    }

    private static AccessReviewCampaignResponse ToCampaignResponse(
        Domain.Entities.AccessReviewCampaign campaign, IReadOnlyDictionary<Guid, string> names) =>
        new(
            campaign.Id,
            campaign.Code,
            campaign.Name,
            campaign.Description,
            campaign.Status,
            SplitPascalCase(campaign.Status.ToString()),
            campaign.StartsAtUtc,
            campaign.DueAtUtc,
            campaign.ClosedAtUtc,
            campaign.ClosedByUserId.HasValue ? names.GetValueOrDefault(campaign.ClosedByUserId.Value) : null,
            campaign.TotalReviewCount,
            campaign.CompletedReviewCount,
            campaign.OverdueReviewCount,
            campaign.PercentComplete,
            campaign.RevokeOnNoResponse,
            campaign.CreatedAtUtc,
            campaign.Version,
            campaign.Status == AccessReviewCampaignStatus.Active
                ? ["View", "Close", "Cancel"]
                : ["View"]);

    /// <summary>"PendingVerification" becomes "Pending verification".</summary>
    private static string SplitPascalCase(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return value;
        }

        var builder = new System.Text.StringBuilder(value.Length + 8);
        builder.Append(value[0]);

        for (var index = 1; index < value.Length; index++)
        {
            if (char.IsUpper(value[index]))
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
