using Microsoft.Extensions.Logging;
using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Abstractions.Services;
using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.DTOs;
using YDot.IAM.Application.Features.Audit.DTOs;
using YDot.IAM.Application.Features.Dashboard.DTOs;
using YDot.IAM.Application.Features.Governance.Mappings;
using YDot.IAM.Application.Features.Organisations.DTOs;
using YDot.IAM.Application.Features.Users.DTOs;
using YDot.IAM.Domain.Enums;
using static YDot.IAM.Application.Features.Dashboard.IdentityDashboardCatalogue;

namespace YDot.IAM.Application.Features.Dashboard.Queries;

/// <summary>IAM's part of the landing page, for whoever is asking.</summary>
public sealed record GetIdentityDashboardQuery(DashboardFilter Filter);

/// <summary>
/// Who is looking, what has happened, and - for the Platform Admin - the whole platform.
///
/// EVERY CALLER GETS THE GREETING AND A FEED. The greeting names their roles as the Organisation
/// calls them ("Organisation Admin", not TENANT_ADMIN). The feed is the Organisation's audit trail
/// for somebody who may read it, and their own recent actions for everybody else - the page used
/// to ask for the trail on every sign-in and draw a refusal, and an access-denied audit row, for
/// every role without it.
///
/// THE PLATFORM ADMIN OUTSIDE AN ORGANISATION GETS EVERY TILE FROM HERE. CAM, DON and PAY answer
/// a session with no Organisation with nothing, so the landing page is about Organisations,
/// people and sign-ins across the platform instead of a page of locked tiles.
/// </summary>
public sealed class IdentityDashboardQueryHandler(
    IIdentityDashboardReadService dashboard,
    IAuditReadService audit,
    IUserReadService users,
    IGovernanceReadService governance,
    IOrganisationReadService organisations,
    IBusinessUnitRepository businessUnits,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    ILogger<IdentityDashboardQueryHandler> logger)
{
    public async Task<Result<DashboardResponse>> HandleAsync(
        GetIdentityDashboardQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var zone = DashboardFormat.ResolveZone(query.Filter.TimeZone, null);
        var now = clock.UtcNow;
        var platform = currentUser.IsSuperAdmin && !tenantContext.HasTenant;

        var roleNames = await dashboard.GetRoleNamesAsync(currentUser.Roles, tenantContext.TenantId, cancellationToken);
        var viewer = new DashboardViewerResponse(
            currentUser.DisplayName ?? currentUser.Username ?? string.Empty,
            tenantContext.TenantName,
            roleNames,
            platform ? "All organisations" : null,
            platform);

        logger.LogInformation("Identity dashboard requested. Platform view: {Platform}.", platform);

        var response = platform
            ? await PlatformAsync(zone, now, viewer, cancellationToken)
            : await OrganisationAsync(zone, now, viewer, cancellationToken);

        logger.LogInformation(
            "Identity dashboard completed. {Attention} attention item(s).", response.Attention.Count);

        return Result.Success(response);
    }

    // =========================================================================================
    // Inside an Organisation
    // =========================================================================================

    private async Task<DashboardResponse> OrganisationAsync(
        TimeZoneInfo zone, DateTimeOffset now, DashboardViewerResponse viewer, CancellationToken cancellationToken)
    {
        var activity = await ActivityAsync(platform: false, cancellationToken);

        var headlines = new List<DashboardHeadlineResponse>();
        var counters = new List<DashboardCounterResponse>();
        var attention = new List<DashboardAttentionItemResponse>();
        var directory = RouteOf(UserDirectoryScreen);

        if (Can(PermissionCodes.UsersView))
        {
            var statistics = await users.GetStatisticsAsync(currentUser.Scope, cancellationToken);
            var protectedShare = DashboardFormat.Share(statistics.MfaEnabled, statistics.Total);

            headlines.Add(new("iam.people", Ranks.People, "People", "ri-team-line", "ok",
                DashboardFormat.Count(statistics.Active),
                $"{DashboardFormat.Count(statistics.Invited)} invited · {DashboardFormat.Count(statistics.Suspended)} suspended",
                protectedShare ?? 0m,
                protectedShare is { } share ? $"{share:0}% use two-step sign-in" : "No people yet",
                directory,
                null));

            counters.Add(new("iam.active-users", Ranks.CounterActiveUsers, "Active users", "ri-team-line", statistics.Active, directory));
            counters.Add(new("iam.invited", Ranks.CounterInvited, "Invited", "ri-mail-send-line", statistics.Invited, directory));

            if (Can(PermissionCodes.UsersUnlock))
            {
                attention.Add(new("iam.locked-out", 35, "Accounts locked out",
                    "Locked after failed sign-ins or by an administrator", statistics.LockedOut, "ri-lock-line", directory));
            }

            if (Can(PermissionCodes.UsersInvite))
            {
                attention.Add(new("iam.invited", 55, "Invitations not yet accepted",
                    "Resend any that have not arrived", statistics.Invited, "ri-mail-send-line", directory));
            }

            if (Can(PermissionCodes.UsersEdit))
            {
                attention.Add(new("iam.access-ending", 60, "Access ending within 30 days",
                    "Extend it or let it lapse", statistics.AccessExpiringSoon, "ri-calendar-close-line", directory));
            }
        }

        if (Can(PermissionCodes.AccessRequestsView))
        {
            var requestViewer = AccessRequestViewer.From(currentUser);
            var requests = RouteOf(AccessRequestsScreen);

            // A decider is counted the queue waiting on them; anybody else, their own requests still
            // in flight - the two filters the Access Requests screen itself offers.
            if (requestViewer.CanDecide)
            {
                var waiting = await governance.GetRequestSummaryAsync(
                    new AccessRequestSearchFilter { AwaitingMyDecision = true }, requestViewer, cancellationToken);

                counters.Add(new("iam.access-requests", Ranks.CounterAccessRequests, "Access requests",
                    "ri-shield-user-line", waiting.Total, requests));

                attention.Add(new("iam.access-requests", 15, "Access requests awaiting a decision",
                    "Submitted and not yet decided", waiting.Total, "ri-shield-user-line", requests));
            }
            else
            {
                var mine = await governance.GetRequestSummaryAsync(
                    new AccessRequestSearchFilter { RaisedByMe = true }, requestViewer, cancellationToken);

                counters.Add(new("iam.my-requests", Ranks.CounterAccessRequests, "Your open requests",
                    "ri-shield-user-line", mine.Pending, requests));
            }
        }

        return new DashboardResponse(
            Module,
            now,
            zone.Id,
            null,
            headlines,
            counters,
            [.. attention.Where(item => item.Count > 0)],
            [],
            new DashboardPanelsResponse(Activity: activity),
            viewer);
    }

    /// <summary>
    /// The feed: the trail for an auditor, the caller's own actions for everybody else. Inside an
    /// Organisation the audit read narrows to it; outside one it is the platform's.
    /// </summary>
    private async Task<DashboardActivityPanelResponse> ActivityAsync(bool platform, CancellationToken cancellationToken)
    {
        var canAudit = Can(PermissionCodes.AuditView);
        IReadOnlyList<AuditEventResponse> events;

        if (canAudit)
        {
            events = (await audit.SearchAsync(
                new AuditEventSearchFilter { Page = 1, PageSize = ActivityRows },
                Can(PermissionCodes.AuditViewSensitive),
                cancellationToken)).Items;
        }
        else
        {
            // THEIR OWN TRAIL IS TWO SETS: what they did, and what was done to their account. A
            // sign-in is written with the person as its target and no actor, so reading the actor
            // alone left every sign-in out of "Your recent activity".
            var acted = await audit.SearchAsync(
                new AuditEventSearchFilter { Page = 1, PageSize = ActivityRows, ActorUserId = currentUser.UserId },
                false,
                cancellationToken);
            var concerning = await audit.SearchAsync(
                new AuditEventSearchFilter { Page = 1, PageSize = ActivityRows, TargetId = currentUser.UserId },
                false,
                cancellationToken);

            events =
            [
                .. acted.Items.Concat(concerning.Items)
                    .DistinctBy(item => item.Id)
                    .OrderByDescending(item => item.OccurredAtUtc)
                    .Take(ActivityRows)
            ];
        }

        var items = events.Select(ToActivityItem).ToList();

        var trail = platform ? PlatformAuditScreen : AuditTrailScreen;
        var itemRoute = canAudit ? RouteOf(trail) : MySecurityScreen.Route;

        return new DashboardActivityPanelResponse(
            Ranks.Activity,
            platform ? "Platform activity" : canAudit ? "Recent activity" : "Your recent activity",
            platform ? "Every organisation" : canAudit ? "Your organisation" : "What you did lately",
            items,
            [
                new("events", items.Count, "count"),
                new("people", items.Select(item => item.Actor).Distinct(StringComparer.OrdinalIgnoreCase).Count(), "count"),
                new("failed", items.Count(item => item.IsFailure), "count", IsAlert: items.Any(item => item.IsFailure))
            ],
            itemRoute,
            canAudit
                ? Link(platform ? "Open the platform audit" : "Open the full audit trail", trail)
                : new DashboardLinkResponse("Open My Security", MySecurityScreen.Route),
            canAudit
                ? new DashboardEmptyStateResponse(
                    "No activity yet",
                    "Sign-ins, approvals and changes appear here as they happen.",
                    Link("Open audit trail", trail))
                : new DashboardEmptyStateResponse(
                    "Nothing yet",
                    "Your sign-ins and changes appear here as they happen.",
                    new DashboardLinkResponse("Open My Security", MySecurityScreen.Route)));
    }

    private static DashboardActivityItemResponse ToActivityItem(AuditEventResponse item)
    {
        var (kindKey, kindLabel) = KindOf(item.ActionCode);

        return new DashboardActivityItemResponse(
            item.Id.ToString(),
            string.IsNullOrWhiteSpace(item.ActorDisplayName) ? "System" : item.ActorDisplayName,
            string.IsNullOrWhiteSpace(item.ActionDisplay) ? item.ActionCode : item.ActionDisplay,
            kindKey,
            kindLabel,
            IconOf(item.ActionCode),
            item.TargetDisplayName ?? item.TargetType,
            item.OccurredAtUtc,
            item.Result != AuditResult.Succeeded);
    }

    // =========================================================================================
    // The Platform Admin, outside every Organisation
    // =========================================================================================

    private async Task<DashboardResponse> PlatformAsync(
        TimeZoneInfo zone, DateTimeOffset now, DashboardViewerResponse viewer, CancellationToken cancellationToken)
    {
        var today = DashboardFormat.LocalDate(now, zone);
        var firstDay = today.AddDays(-(WindowDays - 1));

        var tenants = await dashboard.GetTenantsAsync(cancellationToken);
        var people = await dashboard.GetUserCountsAsync(cancellationToken);
        var mfa = await dashboard.GetMfaUsageAsync(cancellationToken);
        var signIns = await dashboard.GetSignInsAsync(
            DashboardFormat.StartOfDayUtc(firstDay, zone), MaximumSignIns, cancellationToken);
        var activity = await ActivityAsync(platform: true, cancellationToken);

        // The approval queue's own list, so the dashboard's "awaiting review" is the queue's.
        var businessUnit = await businessUnits.GetDefaultAsync(cancellationToken);
        IReadOnlyList<OrganisationListItemResponse> awaiting = businessUnit is null || !Can(ApprovalQueueScreen.Permission!)
            ? []
            : await organisations.GetAwaitingReviewAsync(businessUnit.Id, cancellationToken);

        int Count(params TenantStatus[] statuses) => tenants.Count(tenant => statuses.Contains(tenant.Status));

        var total = tenants.Count;
        var active = Count(TenantStatus.Active);
        var suspended = Count(TenantStatus.Suspended);
        var rejected = Count(TenantStatus.Rejected);
        var archived = Count(TenantStatus.Archived);
        var onboarding = Count(TenantStatus.Invited, TenantStatus.InvitationAccepted, TenantStatus.ProfileIncomplete);
        var inReview = Count(TenantStatus.Submitted, TenantStatus.UnderReview, TenantStatus.Resubmitted);
        var approved = Count(TenantStatus.Approved);

        var succeeded = signIns.Where(attempt => attempt.Succeeded).ToList();
        var failed = signIns.Count - succeeded.Count;
        var signedInShare = DashboardFormat.Share(succeeded.Count, signIns.Count);
        var protectedShare = DashboardFormat.Share(people.MfaEnrolled, people.Active);
        var failedToday = signIns.Count(attempt => !attempt.Succeeded && DashboardFormat.LocalDate(attempt.AttemptedAtUtc, zone) == today);

        var points = Enumerable.Range(0, WindowDays)
            .Select(offset => firstDay.AddDays(offset))
            .Select(day =>
            {
                var count = succeeded.Count(attempt => DashboardFormat.LocalDate(attempt.AttemptedAtUtc, zone) == day);
                return new DashboardTrendPointResponse(day, DashboardFormat.DayLabel(day), count, count, day == today);
            })
            .ToList();

        var directory = RouteOf(OrganisationDirectoryScreen);
        var queue = RouteOf(ApprovalQueueScreen);
        var trail = RouteOf(PlatformAuditScreen);
        var stageCounts = OrganisationStages.Select(stage => (decimal)Count(stage.Statuses)).ToList();
        var oldestWaiting = awaiting
            .Select(organisation => organisation.UpdatedAtUtc ?? organisation.CreatedAtUtc)
            .DefaultIfEmpty(now)
            .Min();

        var headlines = new List<DashboardHeadlineResponse>
        {
            new("iam.organisations", 10, "Organisations live", "ri-building-2-line", "ok",
                DashboardFormat.Count(active),
                total == 0 ? "No organisations yet" : $"out of {DashboardFormat.Count(total)} on the platform",
                DashboardFormat.Share(active, total) ?? 0m,
                $"{DashboardFormat.Count(onboarding)} onboarding · {DashboardFormat.Count(suspended)} suspended",
                directory,
                new DashboardSparkResponse("stages", stageCounts,
                    OrganisationStages.ToList().FindIndex(stage => stage.Key == "active"))),

            new("iam.awaiting-review", 20, "Awaiting review", "ri-file-search-line", "wait",
                DashboardFormat.Count(awaiting.Count),
                awaiting.Count == 0
                    ? "Nothing to decide"
                    : $"oldest waiting {Math.Max(0, today.DayNumber - DashboardFormat.LocalDate(oldestWaiting, zone).DayNumber)}d",
                DashboardFormat.Share(awaiting.Count, total) ?? 0m,
                "Registrations to decide",
                queue,
                null),

            new("iam.people", 30, "People on the platform", "ri-team-line", "warn",
                DashboardFormat.Count(people.Active),
                $"{DashboardFormat.Count(people.Invited)} invited · {DashboardFormat.Count(people.Suspended)} suspended",
                protectedShare ?? 0m,
                protectedShare is { } share ? $"{share:0}% use two-step sign-in" : "No people yet",
                null,
                null),

            new("iam.sign-ins", 40, "Sign-ins", "ri-login-circle-line", "brand",
                DashboardFormat.Count(succeeded.Count),
                $"{DashboardFormat.Count(failed)} failed in the last {WindowDays} days",
                signedInShare ?? 0m,
                signedInShare is { } signedIn ? $"{signedIn:0}% of attempts succeeded" : "No sign-ins yet",
                trail,
                new DashboardSparkResponse("bars", [.. points.Select(point => (decimal)point.Count)]))
        };

        var counters = new List<DashboardCounterResponse>
        {
            new("iam.org-active", 10, "Active", "ri-building-2-line", active, directory),
            new("iam.org-review", 20, "In review", "ri-file-search-line", inReview, queue ?? directory),
            new("iam.org-onboarding", 30, "Onboarding", "ri-rocket-line", onboarding, directory),
            new("iam.org-approved", 40, "Approved", "ri-checkbox-circle-line", approved, directory),
            new("iam.org-suspended", 50, "Suspended", "ri-pause-circle-line", suspended, directory),
            new("iam.org-archived", 60, "Archived", "ri-archive-line", archived, directory),
            new("iam.people-active", 70, "People active", "ri-team-line", people.Active, null)
        };

        var attention = new List<DashboardAttentionItemResponse>
        {
            new("iam.awaiting-review", 10, "Registrations awaiting review",
                "Submitted and not yet decided", awaiting.Count, "ri-file-search-line", queue),
            new("iam.failed-sign-ins", 20, "Failed sign-ins today",
                "Look for repeated attempts on one account", failedToday, "ri-alarm-warning-line", trail),
            new("iam.locked-out", 30, "Accounts locked out",
                "Across every organisation", people.LockedOut, "ri-lock-line", null)
        };

        var tenantNames = tenants.ToDictionary(tenant => tenant.Id, tenant => tenant.Name);
        var create = Link("Create organisation", CreateOrganisationScreen);

        var panels = new DashboardPanelsResponse(
            Trend: new DashboardTrendPanelResponse(
                Ranks.Platform,
                "Sign-ins",
                $"Last {WindowDays} days",
                "count",
                string.Empty,
                "sign-in",
                "sign-ins",
                points,
                signIns.Count == 0
                    ? []
                    :
                    [
                        new("signed in", succeeded.Count, "count"),
                        new("failed", failed, "count", IsAlert: failed > 0),
                        new("people", succeeded.Select(attempt => attempt.UserId).Distinct().Count(), "count")
                    ],
                Link("Platform audit", PlatformAuditScreen),
                trail,
                new DashboardEmptyStateResponse(
                    $"No sign-ins in the last {WindowDays} days",
                    "The curve draws itself as people sign in.")),

            Health: new DashboardHealthPanelResponse(
                Ranks.Platform,
                "Organisation health",
                Link("Directory", OrganisationDirectoryScreen),
                [
                    new("active", "Active", active, "ok", directory),
                    new("starting", "Getting started", onboarding + inReview + approved, "wait", directory),
                    new("suspended", "Suspended", suspended, "warn", directory),
                    new("closed", "Archived or rejected", archived + rejected, "bad", directory)
                ],
                DashboardFormat.Share(active, total),
                total == 0 ? "no organisations yet" : "live",
                [
                    new("live", "Live", "organisations active", DashboardFormat.Share(active, total), "ok", directory),
                    new("protected", "Protected", "people with two-step sign-in", protectedShare, "wait", null),
                    new("signed-in", "Signed in", "attempts that succeeded", signedInShare, "warn", trail)
                ]),

            Activity: activity,

            Agenda: new DashboardAgendaPanelResponse(
                Ranks.Platform,
                "Registrations to review",
                [
                    .. awaiting
                        .OrderBy(organisation => organisation.UpdatedAtUtc ?? organisation.CreatedAtUtc)
                        .Take(6)
                        .Select(organisation =>
                        {
                            var since = organisation.UpdatedAtUtc ?? organisation.CreatedAtUtc;
                            var days = Math.Max(0, today.DayNumber - DashboardFormat.LocalDate(since, zone).DayNumber);
                            return new DashboardAgendaItemResponse(
                                organisation.Id.ToString(),
                                since,
                                organisation.Name,
                                $"{organisation.StatusDisplay} · {organisation.Subdomain}",
                                days == 0 ? "Today" : $"Waiting {days}d",
                                days >= 3,
                                queue);
                        })
                ],
                [
                    new("awaiting review", awaiting.Count, "count", Route: queue),
                    new("onboarding", onboarding, "count", Route: directory)
                ],
                Link("Open the approval queue", ApprovalQueueScreen),
                new DashboardEmptyStateResponse(
                    "Nothing to review",
                    "Registrations appear here as organisations submit them.",
                    create)),

            Pipeline: new DashboardPipelinePanelResponse(
                Ranks.Platform,
                "Organisations",
                $"{DashboardFormat.Count(active)} live now",
                $"{DashboardFormat.Count(total)} in total",
                "active",
                [
                    .. OrganisationStages.Select(stage => new DashboardPipelineStageResponse(
                        stage.Key,
                        stage.Label,
                        Count(stage.Statuses),
                        $"No organisations {stage.Label.ToLowerInvariant()}",
                        [
                            .. tenants
                                .Where(tenant => stage.Statuses.Contains(tenant.Status))
                                .OrderByDescending(tenant => tenant.CreatedAtUtc)
                                .Take(4)
                                .Select(tenant =>
                                {
                                    var joined = $"Joined {DashboardFormat.DayLabel(DashboardFormat.LocalDate(tenant.CreatedAtUtc, zone))}";
                                    var activeShare = DashboardFormat.Share(tenant.ActivePeople, tenant.People);
                                    return new DashboardPipelineRowResponse(
                                        tenant.Id.ToString(),
                                        tenant.Code,
                                        tenant.Name,
                                        $"{stage.Label} · {tenant.Subdomain}",
                                        $"{tenant.Code} · {tenant.Subdomain}",
                                        activeShare,
                                        [
                                            new DashboardMetaResponse("ri-hashtag", tenant.Code),
                                            new DashboardMetaResponse("ri-team-line", DashboardFormat.Counted(tenant.People, "person", "people")),
                                            new DashboardMetaResponse("ri-time-line", joined)
                                        ],
                                        activeShare ?? 0m,
                                        joined,
                                        false,
                                        directory);
                                })
                        ],
                        stage.Palette))
                ],
                "Nothing is at this stage right now.",
                create,
                Link("Open the organisation directory", OrganisationDirectoryScreen),
                rejected > 0 ? $"{DashboardFormat.Count(rejected)} rejected" : null),

            Ranking: new DashboardRankingPanelResponse(
                Ranks.Platform,
                "Largest organisations",
                "By active people",
                "count",
                string.Empty,

                // No count line: the figure on each tile is already the number of people.
                string.Empty,
                string.Empty,
                [
                    .. tenants
                        .Where(tenant => tenant.ActivePeople > 0)
                        .OrderByDescending(tenant => tenant.ActivePeople)
                        .ThenBy(tenant => tenant.Name, StringComparer.OrdinalIgnoreCase)
                        .Take(5)
                        .Select(tenant => new DashboardRankingItemResponse(
                            tenant.Id.ToString(),
                            tenant.Name,
                            tenant.ActivePeople,
                            tenant.ActivePeople,
                            DashboardFormat.ShareOf(tenant.ActivePeople, people.Active),
                            directory))
                ],
                [],
                null,
                Link("Open the organisation directory", OrganisationDirectoryScreen),
                new DashboardEmptyStateResponse("No ranking yet", "Organisations appear here as their people become active.")),

            Leaders: Busiest(signIns, tenantNames, succeeded.Count, failed, trail),

            Feed: new DashboardFeedPanelResponse(
                Ranks.Platform,
                "Newest organisations",
                "count",
                string.Empty,
                "Joined in the last 30 days",
                tenants.Count(tenant => tenant.CreatedAtUtc >= now.AddDays(-30)),
                [
                    new DashboardChipResponse("live", active, "ok", "ri-checkbox-circle-fill"),
                    .. awaiting.Count > 0
                        ? new[] { new DashboardChipResponse("awaiting review", awaiting.Count, "wait", "ri-time-line") }
                        : []
                ],
                [
                    .. tenants
                        .OrderByDescending(tenant => tenant.CreatedAtUtc)
                        .Take(6)
                        .Select(tenant => new DashboardFeedItemResponse(
                            tenant.Id.ToString(),
                            tenant.Name,
                            tenant.Code,
                            tenant.CreatedAtUtc,
                            tenant.Subdomain,
                            IdentityDashboardCatalogue.Describe(tenant.Status),
                            ToneOf(tenant.Status),
                            tenant.People,
                            DashboardFormat.Counted(tenant.People, "person", "people"),
                            "ri-building-2-line",
                            directory))
                ],
                Link("Open the organisation directory", OrganisationDirectoryScreen),
                new DashboardEmptyStateResponse(
                    "No organisations yet",
                    "Organisations are listed here as they join.",
                    create)),

            Sources: new DashboardSharePanelResponse(
                Ranks.Platform,
                "Sign-in protection",
                "count",
                string.Empty,
                "people",
                DashboardFormat.ShareOf(people.MfaEnrolled, people.Active),
                "Use two-step sign-in",
                "is the most used",
                [
                    .. mfa.Take(4).Select(entry => new DashboardShareItemResponse(
                        entry.Method.ToString(),
                        IdentityDashboardCatalogue.Describe(entry.Method),
                        DashboardFormat.ShareOf(entry.People, people.Active),
                        entry.People,
                        entry.People,
                        IdentityDashboardCatalogue.IconOf(entry.Method),
                        null))
                ],
                people.Active - people.MfaEnrolled > 0
                    ? new DashboardShareItemResponse(
                        "none",
                        "Password only",
                        DashboardFormat.ShareOf(people.Active - people.MfaEnrolled, people.Active),
                        people.Active - people.MfaEnrolled,
                        people.Active - people.MfaEnrolled,
                        "ri-lock-unlock-line",
                        null)
                    : null,
                "no second step yet",
                null,
                new DashboardEmptyStateResponse(
                    "Nobody uses a second step yet",
                    "Two-step sign-in methods appear here as people enrol.")),

            Funnel: new DashboardFunnelPanelResponse(
                Ranks.Platform,
                "Onboarding",
                DashboardFormat.ShareOf(active, total),
                "Organisations live",
                $"{DashboardFormat.Count(active)} of {DashboardFormat.Counted(total, "registered organisation", "registered organisations")} are live",
                Funnel(tenants, total, directory),
                awaiting.Count > 0
                    ? new DashboardFunnelAlertResponse(
                        $"{DashboardFormat.Count(awaiting.Count)} awaiting review", "Review now", queue, false)
                    : new DashboardFunnelAlertResponse("Nothing waiting for review", "Open the directory", directory, true),
                Link("Directory", OrganisationDirectoryScreen)));

        return new DashboardResponse(
            Module,
            now,
            zone.Id,
            "All organisations",
            headlines,
            counters,
            [.. attention.Where(item => item.Count > 0)],
            Can(CreateOrganisationScreen.Permission!)
                ? [new("iam.create-organisation", 10, "Create organisation", "ri-building-2-line", CreateOrganisationScreen.Route, true)]
                : [],
            panels,
            viewer);
    }

    /// <summary>
    /// The funnel an Organisation moves through: registered, submitted for review, approved, live.
    /// Each step counts the Organisations that got at least that far, so it can only narrow.
    /// </summary>
    private static IReadOnlyList<DashboardFunnelStepResponse> Funnel(
        IReadOnlyList<PlatformTenantRow> tenants, int total, string? directory)
    {
        var submitted = tenants.Count(tenant => tenant.Status is not (TenantStatus.Invited
            or TenantStatus.InvitationAccepted or TenantStatus.ProfileIncomplete));
        var approved = tenants.Count(tenant => tenant.Status is TenantStatus.Approved or TenantStatus.Active
            or TenantStatus.Suspended or TenantStatus.Archived);
        var live = tenants.Count(tenant => tenant.Status == TenantStatus.Active);

        return
        [
            new("Registered", total, total > 0 ? 100m : 0m, "brand", directory),
            new("Submitted", submitted, DashboardFormat.ShareOf(submitted, total), "wait", directory),
            new("Approved", approved, DashboardFormat.ShareOf(approved, total), "warn", directory),
            new("Live", live, DashboardFormat.ShareOf(live, total), "ok", directory)
        ];
    }

    /// <summary>The Organisations whose people signed in most over the fortnight.</summary>
    private DashboardRankingPanelResponse Busiest(
        IReadOnlyList<PlatformSignIn> signIns,
        IReadOnlyDictionary<Guid, string> tenantNames,
        int succeeded,
        int failed,
        string? trail)
    {
        var busiest = signIns
            .Where(attempt => attempt.Succeeded && attempt.TenantId is not null && tenantNames.ContainsKey(attempt.TenantId.Value))
            .GroupBy(attempt => attempt.TenantId!.Value)
            .Select(group => new
            {
                group.Key,
                SignIns = group.Count(),
                People = group.Select(attempt => attempt.UserId).Distinct().Count()
            })
            .OrderByDescending(entry => entry.SignIns)
            .Take(4)
            .ToList();

        var top = Math.Max(busiest.Select(entry => entry.SignIns).DefaultIfEmpty(0).Max(), 1);

        return new DashboardRankingPanelResponse(
            Ranks.Platform,
            "Most active organisations",
            $"Sign-ins, last {WindowDays} days",
            "count",
            string.Empty,
            "person",
            "people",
            [
                .. busiest.Select(entry => new DashboardRankingItemResponse(
                    entry.Key.ToString(),
                    tenantNames[entry.Key],
                    entry.SignIns,
                    entry.People,
                    DashboardFormat.ShareOf(entry.SignIns, top),
                    RouteOf(OrganisationDirectoryScreen)))
            ],
            [
                new("sign-ins", succeeded, "count", Route: trail),
                new("failed", failed, "count", IsAlert: failed > 0, Route: trail)
            ],
            Link($"{WindowDays} days", PlatformAuditScreen),
            Link("Open the platform audit", PlatformAuditScreen),
            new DashboardEmptyStateResponse("No sign-ins yet", "Organisations appear here as their people sign in."));
    }

    // =========================================================================================
    // Small rules
    // =========================================================================================

    private bool Can(string permission) => currentUser.HasPermission(permission);

    private string? RouteOf(Screen screen) =>
        screen.Permission is null || Can(screen.Permission) ? screen.Route : null;

    private DashboardLinkResponse? Link(string label, Screen screen) =>
        RouteOf(screen) is { } route ? new DashboardLinkResponse(label, route) : null;
}
