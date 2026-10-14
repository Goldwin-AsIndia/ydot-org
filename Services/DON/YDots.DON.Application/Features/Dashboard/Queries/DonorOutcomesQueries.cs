using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.Features.Dashboard.DTOs;
using static YDots.DON.Application.Features.Dashboard.DonorDashboardCatalogue;

namespace YDots.DON.Application.Features.Dashboard.Queries;

/// <summary>DON's outcome figures for a period and scope - the Executive dashboard.</summary>
public sealed record GetDonorOutcomesQuery(DashboardOutcomesFilter Filter);

/// <summary>
/// How many leads became donors in the period.
///
/// IT REPLACES "ACKNOWLEDGED DISTRIBUTIONS", which this platform has no service for and which the
/// page showed as "2,914" to everybody. A lead converting is the outcome the fundraising team
/// works towards, and it can be narrowed to the campaign the lead was captured for.
///
/// THE DAYS ARE THE ORGANISATION'S, as everywhere in DON - see the note on the dashboard handler.
/// </summary>
public sealed class DonorOutcomesQueryHandler(
    IDonorDashboardReadService dashboard,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<DonorOutcomesQueryHandler> logger)
{
    public async Task<Result<DashboardOutcomesResponse>> HandleAsync(
        GetDonorOutcomesQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        var zone = DashboardFormat.ResolveZone(donorSettings.Value.ReportingTimeZone, query.Filter.TimeZone);
        var now = clock.UtcNow;
        var (period, error) = DashboardPeriods.Resolve(query.Filter, DashboardFormat.LocalDate(now, zone));

        if (period is null)
        {
            logger.LogInformation("Donor outcomes refused: {Reason}", error);
            return Result.Failure<DashboardOutcomesResponse>(Error.Validation(error!));
        }

        if (currentUser.OrganisationId == Guid.Empty || !currentUser.HasPermission(PermissionCodes.LeadWorkQueueView))
        {
            logger.LogInformation("Donor outcomes have nothing for this caller.");
            return Result.Success(Response(period, now, zone, []));
        }

        logger.LogInformation("Donor outcomes requested for {From} to {To}.", period.From, period.To);

        var scope = currentUser.Scope;

        Task<int> ConvertedAsync(DateOnly from, DateOnly to) =>
            dashboard.CountConvertedAsync(
                scope,
                DashboardFormat.StartOfDayUtc(from, zone),
                DashboardFormat.StartOfDayUtc(to.AddDays(1), zone),
                query.Filter.CampaignId,
                cancellationToken);

        var converted = await ConvertedAsync(period.From, period.To);
        int? compared = period.CompareFrom is { } compareFrom && period.CompareTo is { } compareTo
            ? await ConvertedAsync(compareFrom, compareTo)
            : null;

        var leads = scope.IsOwnRecordsOnly ? MyLeadsScreen : LeadWorkQueueScreen;

        var metrics = new List<DashboardOutcomeMetricResponse>
        {
            new("leads-converted", 50, "Leads converted",
                converted, "count", string.Empty,
                "Leads that became donors in the period",
                "Leads whose conversion to a donor was recorded on a day of the period - for the chosen campaign, the leads captured for it. Draft leads are left out.",
                compared,
                currentUser.HasPermission(leads.Permission)
                    ? new DashboardLinkResponse(scope.IsOwnRecordsOnly ? "Open my leads" : "Open the lead queue", leads.Route)
                    : null)
        };

        return Result.Success(Response(period, now, zone, metrics));
    }

    private static DashboardOutcomesResponse Response(
        DashboardPeriods.Period period,
        DateTimeOffset now,
        TimeZoneInfo zone,
        IReadOnlyList<DashboardOutcomeMetricResponse> metrics) =>
        new(Module, now, zone.Id, DashboardPeriods.ZoneLabel(zone, now),
            period.From, period.To, period.CompareFrom, period.CompareTo,
            metrics, null, [], [], DashboardPeriods.Comparisons(period));
}
