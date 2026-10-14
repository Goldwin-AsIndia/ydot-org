using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.Features.Dashboard.DTOs;
using YDots.DON.Application.Features.Donors.DTOs;
using YDots.DON.Application.Features.FollowUpPlanner;
using YDots.DON.Application.Features.LeadWorkQueue.DTOs;
using YDots.DON.Domain.Enums;
using static YDots.DON.Application.Features.Dashboard.DonorDashboardCatalogue;

namespace YDots.DON.Application.Features.Dashboard.Queries;

/// <summary>DON's part of the landing page, for whoever is asking.</summary>
public sealed record GetDonorDashboardQuery(DashboardFilter Filter);

/// <summary>
/// Donors, leads and follow-ups on the landing page.
///
/// ONE ENDPOINT, TWO WORKING VIEWS. The fundraising team - holding <c>don.records.view-all</c> -
/// sees the Organisation: the queue, its owners and its funnel. DonorCare sees the leads they own,
/// the donors they look after and their own follow-ups, worded as theirs ("My follow-ups"), with
/// their workload in place of the team's. The data scope decides, exactly as it does on My Leads
/// and My Donors.
///
/// DAYS ARE THE ORGANISATION'S. "Due today" and "overdue" use the reporting calendar the
/// Follow-up Queue and the Lead Work Queue use, so the dashboard's overdue figure is the queue's
/// Overdue tile - it used to be counted from fifty rows against the browser's clock.
///
/// THE FIGURES ARE THE LISTS' OWN. Lead lanes come from the lead queue's summary, follow-up counts
/// from the Follow-up Queue's, and donor figures from the Donor List's - the same queries, so a
/// number on the dashboard is the number on the screen it opens.
/// </summary>
public sealed class DonorDashboardQueryHandler(
    IDonorDashboardReadService dashboard,
    ILeadRepository leads,
    IFollowUpRepository followUps,
    IDonorReadService donors,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<DonorDashboardQueryHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    /// <summary>Rows the follow-up list and the latest-leads feed show.</summary>
    private const int ListRows = 6;

    /// <summary>The moment, the zone and the caller, worked out once per request.</summary>
    private sealed record View(
        TimeZoneInfo Zone,
        DateTimeOffset Now,
        DateOnly Today,
        bool Own,
        Screen Leads,
        Screen Donors);

    public async Task<Result<DashboardResponse>> HandleAsync(
        GetDonorDashboardQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        // The Organisation's reporting zone first - see the note on the class.
        var zone = DashboardFormat.ResolveZone(_settings.ReportingTimeZone, query.Filter.TimeZone);
        var now = clock.UtcNow;
        var scope = currentUser.Scope;

        var canLeads = Can(PermissionCodes.LeadWorkQueueView);
        var canDonors = Can(PermissionCodes.DonorsView);
        var canFollowUps = Can(PermissionCodes.FollowUpPlannerView);

        // No shortcut outside an Organisation: the Platform Admin passes every permission check,
        // and a capture form with no Organisation behind it saves nowhere.
        var actions = currentUser.OrganisationId != Guid.Empty
                      && Can(LeadCaptureScreen.Permission) && Can(PermissionCodes.LeadCaptureSave)
            ? new List<DashboardActionResponse>
            {
                new("don.capture-lead", Ranks.CaptureLead, "Capture lead", "ri-user-add-line", LeadCaptureScreen.Route, false)
            }
            : [];

        if (currentUser.OrganisationId == Guid.Empty || !(canLeads || canDonors || canFollowUps))
        {
            logger.LogInformation("Donor dashboard has nothing for this caller.");
            return Result.Success(new DashboardResponse(
                Module, now, zone.Id, null, [], [], [], actions, new DashboardPanelsResponse()));
        }

        var own = scope.IsOwnRecordsOnly;
        var view = new View(
            zone,
            now,
            DashboardFormat.LocalDate(now, zone),
            own,
            own ? MyLeadsScreen : LeadWorkQueueScreen,
            own ? MyDonorsScreen : DonorListScreen);

        logger.LogInformation("Donor dashboard requested. Own records only: {Own}.", own);

        var (todayStart, todayEnd) = ReportingCalendar.Today(now, _settings);
        var windowStart = DashboardFormat.StartOfDayUtc(view.Today.AddDays(-(WindowDays - 1)), zone);

        // ---- Leads ------------------------------------------------------------------------------
        LeadQueueSummaryResponse? leadSummary = null;
        IReadOnlyDictionary<LeadStatus, int> statusCounts = new Dictionary<LeadStatus, int>();
        var stageRows = new Dictionary<LeadStatus, IReadOnlyList<DashboardLeadRow>>();
        IReadOnlyList<DashboardLeadRow> latest = [];
        (IReadOnlyList<DateTimeOffset> Captured, IReadOnlyList<DateTimeOffset> Converted) moments = ([], []);
        IReadOnlyList<DashboardTally> byCampaign = [];
        IReadOnlyList<DashboardTally> bySource = [];
        IReadOnlyList<DashboardWorkloadRow> workload = [];

        if (canLeads)
        {
            leadSummary = await leads.GetQueueSummaryAsync(
                currentUser.OrganisationId, scope, null, now, todayStart, todayEnd, cancellationToken);
            statusCounts = await dashboard.GetLeadStatusCountsAsync(scope, cancellationToken);

            foreach (var stage in Stages)
            {
                stageRows[stage.Status] = await dashboard.GetLeadsAtStageAsync(scope, stage.Status, RowsPerStage, cancellationToken);
            }

            latest = await dashboard.GetLatestLeadsAsync(scope, ListRows, cancellationToken);
            moments = await dashboard.GetLeadMomentsAsync(scope, windowStart, cancellationToken);
            byCampaign = await dashboard.GetLeadsByCampaignAsync(scope, cancellationToken);
            bySource = await dashboard.GetLeadsBySourceAsync(scope, cancellationToken);

            if (!own)
            {
                workload = await dashboard.GetWorkloadAsync(scope, 4, cancellationToken);
            }
        }

        // ---- Follow-ups -------------------------------------------------------------------------
        FollowUpCounts? followUpCounts = null;
        IReadOnlyList<DashboardFollowUpRow> nextFollowUps = [];
        IReadOnlyList<DateTimeOffset> completed = [];

        if (canFollowUps)
        {
            followUpCounts = await followUps.GetSummaryAsync(scope, null, null, now, todayStart, todayEnd, cancellationToken);
            nextFollowUps = await dashboard.GetNextFollowUpsAsync(scope, ListRows, cancellationToken);
            completed = await dashboard.GetCompletedFollowUpsAsync(scope, windowStart, cancellationToken);
        }

        // ---- Donors -----------------------------------------------------------------------------
        var donorSummary = canDonors ? await donors.GetSummaryAsync(scope, null, cancellationToken) : null;

        var decisions = CanAny(PermissionCodes.DonorsApprove, PermissionCodes.DuplicateReviewMerge, PermissionCodes.VerificationCancel)
            ? await dashboard.GetCountsAsync(scope, cancellationToken)
            : null;

        // ---- The page ---------------------------------------------------------------------------
        var open = Stages.Where(stage => IsOpen(stage.Status)).Sum(stage => statusCounts.GetValueOrDefault(stage.Status));
        var captured = statusCounts.Values.Sum();
        var completedPoints = DailyPoints(completed, view);

        var response = new DashboardResponse(
            Module,
            now,
            zone.Id,
            own ? "Records assigned to you" : "Your whole organisation",
            Headlines(view, leadSummary, followUpCounts, donorSummary, completedPoints),
            Counters(view, leadSummary, followUpCounts, donorSummary),
            Attention(view, leadSummary, followUpCounts, donorSummary, decisions),
            actions,
            new DashboardPanelsResponse(
                Trend: Trend(view, canLeads, moments, completedPoints, followUpCounts),
                Health: donorSummary is null ? null : Health(view, donorSummary),
                Agenda: followUpCounts is null ? null : Agenda(view, followUpCounts, nextFollowUps),
                Pipeline: canLeads ? Pipeline(view, statusCounts, stageRows, open, captured) : null,
                Ranking: canLeads ? Campaigns(view, byCampaign, captured) : null,
                Leaders: Workload(view, leadSummary, open, followUpCounts, donorSummary, workload),
                Feed: canLeads ? Feed(view, latest, moments, statusCounts) : null,
                Sources: canLeads ? Sources(view, bySource, captured) : null,
                Funnel: canLeads && leadSummary is not null ? Funnel(view, statusCounts, leadSummary) : null));

        logger.LogInformation(
            "Donor dashboard completed. {Attention} attention item(s).", response.Attention.Count);

        return Result.Success(response);
    }

    // =========================================================================================
    // The rail, the counters and Needs Attention
    // =========================================================================================

    private List<DashboardHeadlineResponse> Headlines(
        View view,
        LeadQueueSummaryResponse? summary,
        FollowUpCounts? counts,
        DonorListSummaryResponse? donorSummary,
        IReadOnlyList<DashboardTrendPointResponse> completedPoints)
    {
        var headlines = new List<DashboardHeadlineResponse>();
        var leadsRoute = RouteOf(view.Leads);

        if (summary is not null)
        {
            // THE LEAD WORK QUEUE'S OWN TOTAL - every lead not yet converted - so the card and the
            // queue it opens print the same number, and the owner share below divides like for like.
            headlines.Add(new("don.leads", Ranks.OpenLeads, view.Own ? "My open leads" : "Open leads", "ri-user-heart-line", "brand",
                DashboardFormat.Count(summary.TotalLeads),
                summary.TotalLeads == 0
                    ? "No leads in the queue"
                    : $"{DashboardFormat.Count(summary.HotLeads)} ready to give · {DashboardFormat.Count(summary.ConvertedLeads)} won",
                DashboardFormat.Share(summary.AssignedLeads, summary.TotalLeads) ?? 0m,
                view.Own
                    ? $"{DashboardFormat.Count(summary.LeadsDueToday)} due today · {DashboardFormat.Count(summary.LeadsOverdue)} overdue"
                    : summary.TotalLeads > 0
                        ? $"{DashboardFormat.Count(summary.AssignedLeads)} of {DashboardFormat.Count(summary.TotalLeads)} have an owner"
                        : "Capture the first lead",
                leadsRoute,
                new DashboardSparkResponse("split", [summary.ConvertedLeads, summary.AssignedLeads, summary.UnassignedLeads])));
        }

        if (counts is not null)
        {
            headlines.Add(new("don.follow-ups", Ranks.FollowUps, view.Own ? "My follow-ups" : "Follow-ups", "ri-phone-line", "wait",
                DashboardFormat.Count(counts.Open),
                $"{DashboardFormat.Count(counts.DueToday)} due today · {DashboardFormat.Count(counts.Overdue)} overdue",
                DashboardFormat.Share(counts.Open - counts.Overdue, counts.Open) ?? 0m,
                counts.Overdue > 0
                    ? $"{DashboardFormat.Count(counts.Overdue)} past their due time"
                    : "Nothing overdue",
                RouteOf(FollowUpQueueScreen),
                new DashboardSparkResponse("bars", [.. completedPoints.Select(point => (decimal)point.Count)])));
        }

        if (donorSummary is not null)
        {
            headlines.Add(new("don.donors", Ranks.Donors, view.Own ? "My donors" : "Donors", "ri-heart-3-line", "ok",
                DashboardFormat.Count(donorSummary.DonorsOnRecord),
                donorSummary.DonorsOnRecord == 0
                    ? "No donors on record yet"
                    : $"{DashboardFormat.Count(donorSummary.Givers)} have given",
                DashboardFormat.Share(donorSummary.Givers, donorSummary.DonorsOnRecord) ?? 0m,
                donorSummary.DonorsOnRecord == 0
                    ? "Nothing to review"
                    : donorSummary.ConsentToReview > 0
                        ? $"{DashboardFormat.Counted(donorSummary.ConsentToReview, "consent", "consents")} to review"
                        : !view.Own && donorSummary.WithoutOwner > 0
                            ? $"{DashboardFormat.Count(donorSummary.WithoutOwner)} without an owner"
                            : "Every consent in order",
                RouteOf(view.Donors),
                null));
        }

        if (summary is not null)
        {
            headlines.Add(new("don.ready", Ranks.Ready, "Ready to give", "ri-fire-line", "warn",
                DashboardFormat.Count(summary.HotLeads),
                $"{DashboardFormat.Count(summary.HighDonationPotential)} high potential",
                DashboardFormat.Share(summary.HotLeads, summary.TotalLeads) ?? 0m,
                "Hot leads in the queue",
                leadsRoute,
                null));
        }

        return headlines;
    }

    private List<DashboardCounterResponse> Counters(
        View view, LeadQueueSummaryResponse? summary, FollowUpCounts? counts, DonorListSummaryResponse? donorSummary)
    {
        var counters = new List<DashboardCounterResponse>();

        if (donorSummary is not null)
        {
            counters.Add(new("don.donors", Ranks.CounterDonors, view.Own ? "My donors" : "Donors", "ri-heart-3-line",
                donorSummary.DonorsOnRecord, RouteOf(view.Donors)));
        }

        if (counts is not null)
        {
            counters.Add(new("don.due-today", Ranks.CounterDueToday, "Follow-ups due today", "ri-calendar-todo-line",
                counts.DueToday, RouteOf(FollowUpQueueScreen)));
        }

        if (summary is not null && !view.Own)
        {
            counters.Add(new("don.unassigned", Ranks.CounterUnassigned, "Leads without an owner", "ri-user-unfollow-line",
                summary.UnassignedLeads, RouteOf(AssignmentBoardScreen) ?? RouteOf(view.Leads)));
        }

        if (donorSummary is not null && Can(ConsentCentreScreen.Permission))
        {
            counters.Add(new("don.consents", Ranks.CounterConsents, "Consents to review", "ri-shield-check-line",
                donorSummary.ConsentToReview, RouteOf(ConsentCentreScreen)));
        }

        if (donorSummary is not null && Can(IdentityVerificationScreen.Permission))
        {
            counters.Add(new("don.not-verified", Ranks.CounterNotVerified, "Identity not verified", "ri-fingerprint-line",
                donorSummary.IdentityNotVerified, RouteOf(IdentityVerificationScreen)));
        }

        return counters;
    }

    private IReadOnlyList<DashboardAttentionItemResponse> Attention(
        View view,
        LeadQueueSummaryResponse? summary,
        FollowUpCounts? counts,
        DonorListSummaryResponse? donorSummary,
        DonorDashboardCounts? decisions)
    {
        var items = new List<DashboardAttentionItemResponse>();
        var queue = RouteOf(FollowUpQueueScreen);

        if (counts is not null && CanAny(PermissionCodes.FollowUpPlannerMarkComplete, PermissionCodes.FollowUpPlannerReschedule))
        {
            items.Add(new("don.overdue-follow-ups", 10, "Overdue follow-ups",
                "Past their due time", counts.Overdue, "ri-phone-line", queue));
            // Due today is the team's routine, not the Organisation Admin's exception - overdue is.
            if (!IsOrganisationAdmin)
            {
                items.Add(new("don.due-today", 12, "Follow-ups due today",
                    "Due before the day ends", counts.DueToday, "ri-calendar-todo-line", queue));
            }
        }

        if (summary is not null && !view.Own
            && CanAny(PermissionCodes.AssignmentBoardAssign, PermissionCodes.LeadWorkQueueAssign))
        {
            items.Add(new("don.unassigned", 20, "Leads without an owner",
                "Assign them so they are followed up", summary.UnassignedLeads, "ri-user-unfollow-line",
                RouteOf(AssignmentBoardScreen) ?? RouteOf(view.Leads)));
        }

        if (summary is not null && Can(PermissionCodes.LeadWorkQueueContact))
        {
            items.Add(new("don.leads-overdue", 25, "Leads overdue a contact",
                "Their next contact date has passed", summary.LeadsOverdue, "ri-time-line", RouteOf(view.Leads)));
        }

        if (decisions is not null && Can(PermissionCodes.DonorsApprove))
        {
            items.Add(new("don.donors-approval", 30, "Donor records awaiting approval",
                "Submitted and not yet approved", decisions.DonorsAwaitingApproval, "ri-user-follow-line",
                RouteOf(view.Donors)));
        }

        // No screen in the client works duplicates yet - the count is real, the link would not be.
        if (decisions is not null && Can(PermissionCodes.DuplicateReviewMerge))
        {
            items.Add(new("don.duplicates", 35, "Possible duplicates to review",
                "Decide whether to merge them", decisions.DuplicatesToReview, "ri-git-merge-line", null));
        }

        if (decisions is not null && Can(PermissionCodes.VerificationCancel))
        {
            items.Add(new("don.verifications", 40, "Identity checks escalated",
                "Waiting for a reviewer's decision", decisions.VerificationsEscalated, "ri-fingerprint-line",
                RouteOf(IdentityVerificationScreen)));
        }

        if (donorSummary is not null && Can(PermissionCodes.ConsentCentreGrant))
        {
            items.Add(new("don.consents", 45, "Consents to review",
                "Withdrawn or expired consent on a donor", donorSummary.ConsentToReview, "ri-shield-check-line",
                RouteOf(ConsentCentreScreen)));
        }

        return [.. items.Where(item => item.Count > 0)];
    }

    // =========================================================================================
    // The tiles DON owns
    // =========================================================================================

    private DashboardAgendaPanelResponse Agenda(
        View view, FollowUpCounts counts, IReadOnlyList<DashboardFollowUpRow> rows)
    {
        var queue = RouteOf(FollowUpQueueScreen);

        return new DashboardAgendaPanelResponse(
            Ranks.OwnPanel,
            view.Own ? "My follow-ups" : "Follow-ups",
            [
                .. rows.Select(row => new DashboardAgendaItemResponse(
                    row.Id.ToString(),
                    row.DueAtUtc,
                    row.RecordName ?? row.Reference,
                    row.NextAction ?? row.Purpose ?? FollowUpQueueCatalogue.ChannelLabel(row.Channel.ToString()),
                    row.DueAtUtc is { } due
                        ? DashboardFormat.DueLabel(DashboardFormat.LocalDate(due, view.Zone), view.Today)
                        : "No date",
                    row.DueAtUtc is { } dueAt && dueAt < view.Now,
                    queue,
                    queue is null ? null : new Dictionary<string, string> { ["followUpId"] = row.Id.ToString() }))
            ],
            [
                new("open follow-ups", counts.Open, "count", Route: queue),
                new("overdue", counts.Overdue, "count", IsAlert: counts.Overdue > 0, Route: queue)
            ],
            Link("Open Follow-ups", FollowUpQueueScreen),
            new DashboardEmptyStateResponse(
                "No follow-ups waiting",
                "Plan the next call or message to a donor or lead.",
                Link("Plan a follow-up", FollowUpPlannerScreen)));
    }

    private DashboardFunnelPanelResponse Funnel(
        View view, IReadOnlyDictionary<LeadStatus, int> statusCounts, LeadQueueSummaryResponse summary)
    {
        int Of(params LeadStatus[] statuses) => statuses.Sum(status => statusCounts.GetValueOrDefault(status));

        // A REAL FUNNEL: each step is a subset of the one above. The tile used to divide converted
        // leads by a total that left them out, so its conversion rate read high.
        var captured = statusCounts.Values.Sum();
        var contacted = Of(LeadStatus.Contacted, LeadStatus.Qualified, LeadStatus.Nurture, LeadStatus.Converted);
        var qualified = Of(LeadStatus.Qualified, LeadStatus.Converted);
        var converted = Of(LeadStatus.Converted);
        var leadsRoute = RouteOf(view.Leads);
        var board = RouteOf(AssignmentBoardScreen);

        DashboardFunnelAlertResponse alert = view.Own
            ? summary.LeadsOverdue > 0
                ? new($"{DashboardFormat.Counted(summary.LeadsOverdue, "lead", "leads")} overdue a contact", "Open my leads", leadsRoute, false)
                : new("Every lead contacted on time", "Open my leads", leadsRoute, true)
            : summary.UnassignedLeads > 0
                ? new($"{DashboardFormat.Count(summary.UnassignedLeads)} without an owner", "Assign now", board ?? leadsRoute, false)
                : new("Every lead has an owner", board is null ? "Open the queue" : "Open board", board ?? leadsRoute, true);

        return new DashboardFunnelPanelResponse(
            Ranks.OwnPanel,
            view.Own ? "My lead funnel" : "Lead funnel",
            DashboardFormat.ShareOf(converted, captured),
            "Lead conversion",
            $"{DashboardFormat.Count(converted)} of {DashboardFormat.Counted(captured, "lead", "leads")} became donors",
            [
                new("Captured", captured, captured > 0 ? 100m : 0m, "brand", leadsRoute),
                new("Contacted", contacted, DashboardFormat.ShareOf(contacted, captured), "wait", leadsRoute),
                new("Qualified", qualified, DashboardFormat.ShareOf(qualified, captured), "warn", leadsRoute),
                new("Converted", converted, DashboardFormat.ShareOf(converted, captured), "ok", leadsRoute)
            ],
            alert,
            Link("Queue", view.Leads));
    }

    // =========================================================================================
    // The tiles DON fills for somebody who cannot read donations
    // =========================================================================================

    private DashboardTrendPanelResponse? Trend(
        View view,
        bool canLeads,
        (IReadOnlyList<DateTimeOffset> Captured, IReadOnlyList<DateTimeOffset> Converted) moments,
        IReadOnlyList<DashboardTrendPointResponse> completedPoints,
        FollowUpCounts? counts)
    {
        // DonorCare does not capture leads; their curve is the follow-ups they got done.
        if (view.Own && counts is not null)
        {
            var done = completedPoints.Sum(point => point.Count);

            return new DashboardTrendPanelResponse(
                Ranks.StandInPanel,
                "Your follow-ups",
                $"Done in the last {WindowDays} days",
                "count",
                string.Empty,
                "follow-up done",
                "follow-ups done",
                completedPoints,
                done == 0
                    ? []
                    :
                    [
                        new("done", done, "count"),
                        new("due today", counts.DueToday, "count"),
                        new("overdue", counts.Overdue, "count", IsAlert: counts.Overdue > 0)
                    ],
                Link("Follow-ups", FollowUpQueueScreen),
                RouteOf(FollowUpQueueScreen),
                new DashboardEmptyStateResponse(
                    $"No follow-ups done in the last {WindowDays} days",
                    "Each completed follow-up adds to the curve.",
                    Link("Open Follow-ups", FollowUpQueueScreen)));
        }

        if (!canLeads)
        {
            return null;
        }

        var points = DailyPoints(moments.Captured, view);
        var capturedInWindow = moments.Captured.Count;

        return new DashboardTrendPanelResponse(
            Ranks.StandInPanel,
            "Lead intake",
            $"Last {WindowDays} days",
            "count",
            string.Empty,
            "lead",
            "leads",
            points,
            capturedInWindow == 0
                ? []
                :
                [
                    new("captured", capturedInWindow, "count"),
                    new("converted", moments.Converted.Count, "count"),
                    new("follow-ups done", completedPoints.Sum(point => point.Count), "count")
                ],
            Link("Leads", view.Leads),
            RouteOf(view.Leads),
            new DashboardEmptyStateResponse(
                $"No leads in the last {WindowDays} days",
                "The intake curve draws itself as leads are captured.",
                ActionLink("Capture lead")));
    }

    private DashboardHealthPanelResponse Health(View view, DonorListSummaryResponse summary)
    {
        int Status(DonorStatus status) => summary.StatusCounts.GetValueOrDefault(status.ToString());

        var donorsRoute = RouteOf(view.Donors);
        var total = summary.DonorsOnRecord;
        var active = DashboardFormat.Share(Status(DonorStatus.Active), total);

        return new DashboardHealthPanelResponse(
            Ranks.StandInPanel,
            view.Own ? "My donors" : "Donor health",
            Link("Donors", view.Donors),
            [
                new("active", "Active", Status(DonorStatus.Active), "ok", donorsRoute),
                new("prospect", "Prospect", Status(DonorStatus.Prospect), "wait", donorsRoute),
                new("restricted", "Restricted", Status(DonorStatus.Restricted), "warn", donorsRoute),
                new("archived", "Archived", Status(DonorStatus.Archived), "bad", donorsRoute)
            ],
            active,
            total == 0 ? "no donors yet" : "active",
            [
                new("consent", "Consent", "in order",
                    DashboardFormat.Share(total - summary.ConsentToReview, total), "ok", RouteOf(ConsentCentreScreen)),
                new("verified", "Verified", "identity confirmed",
                    DashboardFormat.Share(total - summary.IdentityNotVerified, total), "wait", RouteOf(IdentityVerificationScreen)),
                new("giving", "Giving", "have given",
                    DashboardFormat.Share(summary.Givers, total), "warn", donorsRoute)
            ]);
    }

    private DashboardPipelinePanelResponse Pipeline(
        View view,
        IReadOnlyDictionary<LeadStatus, int> statusCounts,
        IReadOnlyDictionary<LeadStatus, IReadOnlyList<DashboardLeadRow>> stageRows,
        int open,
        int captured)
    {
        // The stage the tile opens on: the first one still being worked that holds anybody.
        var opening = Stages
            .Where(stage => IsOpen(stage.Status) && statusCounts.GetValueOrDefault(stage.Status) > 0)
            .Select(stage => stage.Key)
            .FirstOrDefault() ?? Stages[0].Key;

        var closed = statusCounts.GetValueOrDefault(LeadStatus.Closed);
        var suppressed = statusCounts.GetValueOrDefault(LeadStatus.Suppressed);

        return new DashboardPipelinePanelResponse(
            Ranks.StandInPanel,
            view.Own ? "My leads" : "Leads",
            $"{DashboardFormat.Count(open)} open now",
            $"{DashboardFormat.Count(captured)} captured",
            opening,
            [
                .. Stages.Select(stage => new DashboardPipelineStageResponse(
                    stage.Key,
                    stage.Label,
                    statusCounts.GetValueOrDefault(stage.Status),
                    $"No {stage.Label.ToLowerInvariant()} leads",
                    [.. stageRows.GetValueOrDefault(stage.Status, []).Select(row => PipelineRow(view, row, stage.Label))],
                    stage.Palette))
            ],
            "Nothing is at this stage right now.",
            ActionLink("Capture lead"),
            Link(view.Own ? "Open my leads" : "Open the lead queue", view.Leads),
            closed + suppressed > 0
                ? $"{DashboardFormat.Count(closed)} closed · {DashboardFormat.Count(suppressed)} suppressed"
                : null);
    }

    private DashboardPipelineRowResponse PipelineRow(View view, DashboardLeadRow row, string stageLabel)
    {
        string when;
        var urgent = false;

        if (row.Status == LeadStatus.Converted)
        {
            when = "Became a donor";
        }
        else if (row.NextActionDueUtc is { } due)
        {
            var day = DashboardFormat.LocalDate(due, view.Zone);
            when = DashboardFormat.DueLabel(day, view.Today);
            urgent = day < view.Today;
        }
        else
        {
            when = "No contact planned";
        }

        var (route, query) = LeadLink(view, row.Id);

        return new DashboardPipelineRowResponse(
            row.Id.ToString(),
            row.Reference,
            row.Name,
            $"{stageLabel} · {row.CampaignName ?? "No campaign"}",
            $"{row.Reference} · {(string.IsNullOrWhiteSpace(row.Source) ? "Source not recorded" : row.Source.Trim())}",
            Warmth(row.Temperature),
            [
                new("ri-hashtag", row.Reference),
                new(IconOf(row.Temperature), $"{row.Temperature} lead"),
                new("ri-user-line", string.IsNullOrWhiteSpace(row.OwnerName) ? "No owner" : row.OwnerName.Trim()),
                new("ri-time-line", when, urgent)
            ],
            Potential(row.Potential),
            when,
            urgent,
            route,
            query);
    }

    private DashboardRankingPanelResponse Campaigns(View view, IReadOnlyList<DashboardTally> byCampaign, int captured)
    {
        var leadsRoute = RouteOf(view.Leads);

        return new DashboardRankingPanelResponse(
            Ranks.StandInPanel,
            "Leads by campaign",
            "Every lead captured",
            "count",
            string.Empty,

            // No count line: the figure on each tile is already the number of leads.
            string.Empty,
            string.Empty,
            [
                .. byCampaign.Take(5).Select(tally => new DashboardRankingItemResponse(
                    tally.Key, tally.Label, tally.Count, tally.Count, DashboardFormat.ShareOf(tally.Count, captured), leadsRoute))
            ],
            [],
            null,
            Link(view.Own ? "Open my leads" : "Open the lead queue", view.Leads),
            new DashboardEmptyStateResponse("No leads yet", "Campaigns appear here as leads are captured for them."));
    }

    private DashboardRankingPanelResponse? Workload(
        View view,
        LeadQueueSummaryResponse? summary,
        int open,
        FollowUpCounts? counts,
        DonorListSummaryResponse? donorSummary,
        IReadOnlyList<DashboardWorkloadRow> workload)
    {
        if (view.Own)
        {
            // THEIR OWN DESK, as four lines. A DonorCare agent has no team to rank.
            var lines = new List<(string Key, string Label, int Value, string? Route)>();

            if (summary is not null) lines.Add(("leads", "Open leads", open, RouteOf(view.Leads)));
            if (donorSummary is not null) lines.Add(("donors", "Donors you look after", donorSummary.DonorsOnRecord, RouteOf(view.Donors)));
            if (counts is not null)
            {
                lines.Add(("follow-ups", "Follow-ups open", counts.Open, RouteOf(FollowUpQueueScreen)));
                lines.Add(("overdue", "Follow-ups overdue", counts.Overdue, RouteOf(FollowUpQueueScreen)));
            }

            if (lines.Count == 0)
            {
                return null;
            }

            var largest = Math.Max(lines.Max(line => line.Value), 1);

            return new DashboardRankingPanelResponse(
                Ranks.StandInPanel,
                "Your workload",
                "What is assigned to you",
                "count",
                string.Empty,
                string.Empty,
                string.Empty,
                [.. lines.Select(line => new DashboardRankingItemResponse(
                    line.Key, line.Label, line.Value, line.Value, DashboardFormat.ShareOf(line.Value, largest), line.Route))],
                counts is null
                    ? []
                    :
                    [
                        new("due today", counts.DueToday, "count", Route: RouteOf(FollowUpQueueScreen)),
                        new("overdue", counts.Overdue, "count", IsAlert: counts.Overdue > 0, Route: RouteOf(FollowUpQueueScreen))
                    ],
                Link("Follow-ups", FollowUpQueueScreen),
                Link("Open my leads", view.Leads),
                new DashboardEmptyStateResponse("Nothing assigned to you yet", "Leads, donors and follow-ups appear here once they are yours."));
        }

        if (summary is null)
        {
            return null;
        }

        var board = AssignmentBoardScreen;
        var busiest = Math.Max(workload.Select(row => row.OpenLeads + row.OpenFollowUps).DefaultIfEmpty(0).Max(), 1);

        return new DashboardRankingPanelResponse(
            Ranks.StandInPanel,
            "Team workload",
            "Open leads and follow-ups per person",
            "count",
            string.Empty,
            "open lead",
            "open leads",
            [
                .. workload.Select(row => new DashboardRankingItemResponse(
                    row.OwnerUserId.ToString(),
                    row.OwnerName,
                    row.OpenLeads + row.OpenFollowUps,
                    row.OpenLeads,
                    DashboardFormat.ShareOf(row.OpenLeads + row.OpenFollowUps, busiest),
                    RouteOf(board) ?? RouteOf(view.Leads)))
            ],
            [
                new("leads without an owner", summary.UnassignedLeads, "count",
                    IsAlert: summary.UnassignedLeads > 0, Route: RouteOf(board) ?? RouteOf(view.Leads)),
                new("open follow-ups", counts?.Open ?? 0, "count", Route: RouteOf(FollowUpQueueScreen))
            ],
            Link("Board", board),
            Link("Open the assignment board", board) ?? Link("Open the lead queue", view.Leads),
            new DashboardEmptyStateResponse("Nobody holds open work", "Leads and follow-ups appear here once they are assigned."));
    }

    private DashboardFeedPanelResponse Feed(
        View view,
        IReadOnlyList<DashboardLeadRow> latest,
        (IReadOnlyList<DateTimeOffset> Captured, IReadOnlyList<DateTimeOffset> Converted) moments,
        IReadOnlyDictionary<LeadStatus, int> statusCounts)
    {
        var chips = new List<DashboardChipResponse>
        {
            new("converted", moments.Converted.Count, "ok", "ri-checkbox-circle-fill")
        };

        var waiting = statusCounts.GetValueOrDefault(LeadStatus.New);
        if (waiting > 0)
        {
            chips.Add(new("still new", waiting, "wait", "ri-time-line"));
        }

        return new DashboardFeedPanelResponse(
            Ranks.StandInPanel,
            view.Own ? "Your latest leads" : "Latest leads",
            "count",
            string.Empty,
            $"Captured in the last {WindowDays} days",
            moments.Captured.Count,
            chips,
            [
                .. latest.Select(row =>
                {
                    var (route, query) = LeadLink(view, row.Id);
                    return new DashboardFeedItemResponse(
                        row.Id.ToString(),
                        row.Name,
                        row.Reference,
                        row.CreatedAtUtc,
                        row.CampaignName ?? "No campaign",
                        row.Status.ToString(),
                        ToneOf(row.Status),
                        (int)row.Potential,
                        PotentialLabel(row.Potential),
                        IconOf(row.Temperature),
                        route,
                        query);
                })
            ],
            Link(view.Own ? "Open my leads" : "Open the lead queue", view.Leads),
            new DashboardEmptyStateResponse(
                "No leads yet",
                "Leads from every source are listed here, newest first.",
                ActionLink("Capture lead")));
    }

    private DashboardSharePanelResponse Sources(View view, IReadOnlyList<DashboardTally> bySource, int captured)
    {
        var leadsRoute = RouteOf(view.Leads);
        var known = bySource.Where(tally => !string.IsNullOrWhiteSpace(tally.Label)).ToList();
        var unknown = captured - known.Sum(tally => tally.Count);

        return new DashboardSharePanelResponse(
            Ranks.StandInPanel,
            "Lead sources",
            "count",
            string.Empty,
            "leads",
            DashboardFormat.ShareOf(captured - unknown, captured),
            "From a known source",
            "brings the most leads",
            [
                .. known.Take(4).Select(tally => new DashboardShareItemResponse(
                    tally.Key,
                    tally.Label,
                    DashboardFormat.ShareOf(tally.Count, captured),
                    tally.Count,
                    tally.Count,
                    SourceIcon(tally.Label),
                    leadsRoute))
            ],
            unknown > 0
                ? new DashboardShareItemResponse(
                    "unknown", "Source not recorded", DashboardFormat.ShareOf(unknown, captured),
                    unknown, unknown, "ri-question-line", leadsRoute)
                : null,
            "record it at capture",
            Link("Leads", view.Leads),
            new DashboardEmptyStateResponse(
                "No leads yet",
                "Lead sources appear here as leads are captured.",
                ActionLink("Capture lead")));
    }

    // =========================================================================================
    // Small rules
    // =========================================================================================

    private static bool IsOpen(LeadStatus status) =>
        status is LeadStatus.New or LeadStatus.Assigned or LeadStatus.Contacted or LeadStatus.Qualified or LeadStatus.Nurture;

    /// <summary>How warm a lead is, on the dial: cold a third, warm two thirds, hot full.</summary>
    private static decimal Warmth(LeadTemperature temperature) => temperature switch
    {
        LeadTemperature.Hot => 100m,
        LeadTemperature.Warm => 66m,
        _ => 33m
    };

    private static decimal Potential(DonationPotential potential) => potential switch
    {
        DonationPotential.High => 100m,
        DonationPotential.Medium => 66m,
        _ => 33m
    };

    /// <summary>
    /// One lead: My Leads opens it by id; the Lead Work Queue has no way to be opened on one
    /// lead, so a team member lands on the queue.
    /// </summary>
    private (string? Route, IReadOnlyDictionary<string, string>? Query) LeadLink(View view, Guid leadId) =>
        view.Own
            ? (RouteOf(MyLeadsScreen), Can(MyLeadsScreen.Permission) ? new Dictionary<string, string> { ["leadId"] = leadId.ToString() } : null)
            : (RouteOf(LeadWorkQueueScreen), null);

    private IReadOnlyList<DashboardTrendPointResponse> DailyPoints(IReadOnlyList<DateTimeOffset> moments, View view)
    {
        var firstDay = view.Today.AddDays(-(WindowDays - 1));
        var counts = moments
            .GroupBy(moment => DashboardFormat.LocalDate(moment, view.Zone))
            .ToDictionary(group => group.Key, group => group.Count());

        return
        [
            .. Enumerable.Range(0, WindowDays).Select(offset =>
            {
                var day = firstDay.AddDays(offset);
                var count = counts.GetValueOrDefault(day);
                return new DashboardTrendPointResponse(day, DashboardFormat.DayLabel(day), count, count, day == view.Today);
            })
        ];
    }

    /// <summary>Capture Lead as a link, for an empty state - only for somebody who may capture.</summary>
    private DashboardLinkResponse? ActionLink(string label) =>
        Can(LeadCaptureScreen.Permission) && Can(PermissionCodes.LeadCaptureSave)
            ? new DashboardLinkResponse(label, LeadCaptureScreen.Route)
            : null;

    /// <summary>
    /// The Organisation Admin: the flag the founding administrator carries, or the role anybody
    /// later given it holds - the flag alone misses the second kind.
    /// </summary>
    private bool IsOrganisationAdmin =>
        currentUser.IsTenantAdmin
        || currentUser.Roles.Contains(RoleCodes.TenantAdmin, StringComparer.OrdinalIgnoreCase);

    private bool Can(string permission) => currentUser.HasPermission(permission);

    private bool CanAny(params string[] permissions) => currentUser.HasAnyPermission(permissions);

    private string? RouteOf(Screen screen) => Can(screen.Permission) ? screen.Route : null;

    private DashboardLinkResponse? Link(string label, Screen screen) =>
        Can(screen.Permission) ? new DashboardLinkResponse(label, screen.Route) : null;
}
