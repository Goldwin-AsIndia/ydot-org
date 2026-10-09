using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Common.Settings;
using YDots.CAM.Application.Features.CampaignReadiness.DTOs;
using YDots.CAM.Application.Features.CampaignReadiness.Mappings;
using YDots.CAM.Domain.Entities;

namespace YDots.CAM.Infrastructure.Persistence.ReadServices;

/// <summary>
/// Read side for the campaign readiness checklist.
///
/// THE CHECKLIST IS READ AS A WHOLE AND IS NOT PAGED. The question it answers is "can this
/// campaign launch?", and half a checklist cannot answer it - a page-two required check that
/// has not passed would be invisible to a screen showing a green tick.
///
/// THE PEOPLE ARE RESOLVED ONCE FOR THE WHOLE SCREEN. A checklist names three sets of users -
/// the campaign's owners, each check's owner, and each blocker's owner - and they overlap
/// heavily. One directory call for the union of the three is what keeps a page that shows a
/// dozen names from issuing a dozen queries.
/// </summary>
public sealed class CampaignReadinessReadService(
    CampaignDbContext context,
    IPeopleDirectory people,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IDateTimeProvider clock,
    IOptions<CampaignSettings> campaignOptions) : ICampaignReadinessReadService
{
    public async Task<CampaignReadinessResponse?> GetForCampaignAsync(
        Guid campaignId, AccessScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        // The campaign is resolved through the Organisation filter FIRST. That is what makes a
        // readiness request for another Organisation's campaign answer "not found" rather than
        // "an empty checklist", which would read as "nothing to do" on the screen.
        var campaign = await ApplyScope(context.Campaigns.AsNoTracking(), scope)
            .Include(entity => entity.Owners)
            .FirstOrDefaultAsync(entity => entity.Id == campaignId, cancellationToken);

        if (campaign is null)
        {
            return null;
        }

        var checks = await context.CampaignReadinessChecks
            .AsNoTracking()
            .Include(check => check.Blockers)
            .Where(check => check.CampaignId == campaignId)
            .OrderBy(check => check.Category)
            .ThenBy(check => check.CheckName)
            .ToListAsync(cancellationToken);

        // The lifecycle rows behind the checklist's overall decision - who requested the launch,
        // and who approved or rejected it.
        var lifecycle = await context.CampaignLifecycleActions
            .AsNoTracking()
            .Where(action => action.CampaignId == campaignId)
            .Where(action => action.ActionType == Domain.Enums.CampaignLifecycleActionType.Submit
                             || action.ActionType == Domain.Enums.CampaignLifecycleActionType.Approve
                             || action.ActionType == Domain.Enums.CampaignLifecycleActionType.ReturnToDraft)
            .ToListAsync(cancellationToken);

        var resolved = await ResolvePeopleAsync(
            [
                .. campaign.Owners.Select(owner => owner.OwnerId),
                .. checks.Where(check => check.OwnerUserId.HasValue).Select(check => check.OwnerUserId!.Value),
                .. checks.SelectMany(check => check.Blockers).Select(blocker => blocker.OwnerUserId),
                .. lifecycle.Where(action => action.RequestedByUserId.HasValue).Select(action => action.RequestedByUserId!.Value),
                .. campaign.SubmittedByUserId.HasValue ? new[] { campaign.SubmittedByUserId.Value } : [],
                .. campaign.ApprovedByUserId.HasValue ? new[] { campaign.ApprovedByUserId.Value } : []
            ],
            cancellationToken);

        var verdictHolders = await VerdictHoldersAsync(checks, cancellationToken);

        // The approve endpoint's own rule: something on the list, every required check passed, no
        // open blocker - unless the Organisation has switched the gate off.
        var checklistAllowsLaunch = campaignOptions.Value.AllowLaunchWithOutstandingChecks
            || (checks.Count > 0
                && !checks.Any(check => check.BlocksLaunch || check.HasOpenBlockers));

        return ReadinessMappingConfig.ToReadinessResponse(
            campaign,
            checks,
            clock.TodayUtc,
            ReadinessMappingConfig.CampaignActionsFor(
                campaign, currentUser.UserId, currentUser.HasPermission,
                currentUser.IsTenantAdmin, checklistAllowsLaunch),
            resolved,
            ReadinessMappingConfig.DecisionFor(campaign, lifecycle, resolved),
            check => ReadinessMappingConfig.PermittedActionsFor(
                check, currentUser.HasPermission, currentUser.UserId, currentUser.IsTenantAdmin,
                check.OwnerUserId is not Guid owner || verdictHolders.Contains(owner)));
    }

    public async Task<ReadinessCheckDetailResponse?> GetCheckAsync(
        Guid checkId, AccessScope scope, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(scope);

        var check = await context.CampaignReadinessChecks
            .AsNoTracking()
            .Include(entity => entity.Blockers)
            .FirstOrDefaultAsync(entity => entity.Id == checkId, cancellationToken);

        if (check is null)
        {
            return null;
        }

        // The check itself is Organisation-filtered, but a caller scoped to their OWN records
        // must also be on the campaign - otherwise somebody scoped to their own work could read
        // the checklist of a colleague's campaign in the same Organisation.
        if (scope.IsOwnRecordsOnly)
        {
            var isOwn = await ApplyScope(context.Campaigns.AsNoTracking(), scope)
                .AnyAsync(campaign => campaign.Id == check.CampaignId, cancellationToken);

            if (!isOwn)
            {
                return null;
            }
        }

        var resolved = await ResolvePeopleAsync(
            [
                .. check.OwnerUserId.HasValue ? new[] { check.OwnerUserId.Value } : [],
                .. check.Blockers.Select(blocker => blocker.OwnerUserId)
            ],
            cancellationToken);

        var verdictHolders = await VerdictHoldersAsync([check], cancellationToken);

        return check.ToDetailResponse(
            clock.TodayUtc,
            ReadinessMappingConfig.PermittedActionsFor(
                check, currentUser.HasPermission, currentUser.UserId, currentUser.IsTenantAdmin,
                check.OwnerUserId is not Guid owner || verdictHolders.Contains(owner)),
            resolved);
    }

    /// <summary>
    /// The people a readiness check may be assigned to: whoever can record its verdict - the
    /// Campaign Executives and the Organisation Admin.
    /// </summary>
    public async Task<IReadOnlyList<ReadinessPersonResponse>> GetAssignableOwnersAsync(
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant)
        {
            return [];
        }

        var holders = await people.GetPeopleHoldingPermissionAsync(
            tenantContext.RequireTenantId(), PermissionCodes.ReadinessPass, null, cancellationToken);

        return [.. holders.Select(person => new ReadinessPersonResponse(person.UserId, person.UserCode, person.DisplayName))];
    }

    /// <summary>Which of the checks' assignees can still record a verdict.</summary>
    private async Task<IReadOnlySet<Guid>> VerdictHoldersAsync(
        IReadOnlyCollection<CampaignReadinessCheck> checks, CancellationToken cancellationToken)
    {
        var owners = checks
            .Where(check => check.OwnerUserId.HasValue)
            .Select(check => check.OwnerUserId!.Value)
            .Distinct()
            .ToArray();

        if (owners.Length == 0 || !tenantContext.HasTenant)
        {
            return new HashSet<Guid>();
        }

        var holders = await people.GetPeopleHoldingPermissionAsync(
            tenantContext.RequireTenantId(), PermissionCodes.ReadinessPass, owners, cancellationToken);

        return holders.Select(person => person.UserId).ToHashSet();
    }

    public async Task<IReadOnlyList<ReadinessReminderResponse>> GetRemindersForUserAsync(
        Guid userId, int daysAhead, CancellationToken cancellationToken)
    {
        var today = clock.TodayUtc;
        var last = today.AddDays(daysAhead);

        var rows = await context.CampaignReadinessChecks
            .AsNoTracking()
            .Where(check => check.OwnerUserId == userId
                && check.RequiredForLaunch
                && check.Status != Domain.Enums.ReadinessCheckStatus.Passed
                && check.Campaign.StartDate >= today
                && check.Campaign.StartDate <= last
                && (check.Campaign.Status == Domain.Enums.CampaignStatus.Draft
                    || check.Campaign.Status == Domain.Enums.CampaignStatus.Submitted
                    || check.Campaign.Status == Domain.Enums.CampaignStatus.Approved
                    || check.Campaign.Status == Domain.Enums.CampaignStatus.Scheduled))
            .OrderBy(check => check.Campaign.StartDate)
            .Select(check => new
            {
                check.Id,
                check.CheckName,
                check.CampaignId,
                check.Campaign.Code,
                CampaignName = check.Campaign.Name,
                check.Campaign.StartDate
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(row => new ReadinessReminderResponse(
                row.Id, row.CheckName, row.CampaignId, row.Code, row.CampaignName,
                row.StartDate, row.StartDate.DayNumber - today.DayNumber))
        ];
    }

    /// <summary>
    /// Names for every user id the screen is about to show, in one call.
    ///
    /// The empty ids are dropped before asking: an unassigned check carries Guid.Empty, and
    /// sending it to the directory would be asking identity about a user that cannot exist.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, PersonSummary>> ResolvePeopleAsync(
        IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken)
    {
        var wanted = userIds.Where(id => id != Guid.Empty).Distinct().ToArray();

        if (wanted.Length == 0 || !tenantContext.HasTenant)
        {
            return new Dictionary<Guid, PersonSummary>();
        }

        return await people.GetPeopleAsync(
            tenantContext.RequireTenantId(), wanted, cancellationToken);
    }

    private static IQueryable<Campaign> ApplyScope(IQueryable<Campaign> query, AccessScope scope) =>
        scope.IsOwnRecordsOnly
            ? query.Where(campaign =>
                campaign.CreatedByUserId == scope.UserId
                || campaign.Owners.Any(owner => owner.OwnerId == scope.UserId))
            : query;
}
