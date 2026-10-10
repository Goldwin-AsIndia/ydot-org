using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Abstractions.Persistence.Seed;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Settings;
using YDots.CAM.Domain.Entities;
using YDots.CAM.Domain.Enums;
using static YDots.CAM.Infrastructure.Persistence.Seed.DemoCampaignCatalogue;

namespace YDots.CAM.Infrastructure.Persistence.Seed;

/// <summary>What one attempt at seeding the demonstration campaigns came to.</summary>
public enum DemoSeedOutcome
{
    /// <summary><c>SeedSettings:CreateSampleData</c> is off. Nothing was looked at.</summary>
    Disabled,

    /// <summary>IAM has not created an Organisation or its people yet. Try again shortly.</summary>
    Waiting,

    /// <summary>Every Organisation in the catalogue holds its demonstration data.</summary>
    Completed
}

/// <summary>
/// Writes <see cref="DemoCampaignCatalogue"/> into the two activated sample Organisations:
/// campaigns with their owners, channels, readiness checklists, blockers, lifecycle history and
/// audit trail, and the tracking assets that hang off them.
///
/// IT WAITS FOR IAM, AND THAT IS WHY IT IS NOT PART OF START-UP SEEDING. Every row here names a
/// real Organisation and real people - a Campaign Executive who created it, a Campaign Manager
/// who approved it - and IAM generates all of those ids. CAM starts at the same moment IAM does,
/// so on a fresh database none of them exist yet when start-up seeding runs. This reports
/// <see cref="DemoSeedOutcome.Waiting"/> instead of guessing, and
/// <see cref="DemoDataSeedingService"/> asks again until the rows are there.
///
/// ONCE PER ORGANISATION, AND ALL OF IT OR NONE. An Organisation that already holds any
/// demonstration campaign is left exactly as it is, so a campaign somebody edited, launched or
/// deleted during a demonstration is never put back; and the whole set for one Organisation is
/// one save, so a failure half-way cannot leave campaigns without their checklists.
///
/// THE ROWS ARE WRITTEN AS BUILT. <see cref="SaveAsBuiltAsync"/> goes round the context's audit
/// stamp, which would otherwise set every CreatedAtUtc to this minute - and a campaign register
/// in which a year of history was all created "just now" is not a demonstration of anything.
/// </summary>
public sealed class DemoCampaignSeeder(
    CampaignDbContext context,
    IOptions<SeedSettings> seedOptions,
    IOptions<CampaignSettings> campaignOptions,
    IOptions<ClientAppSettings> clientOptions,
    ITrackingReferenceGenerator references,
    ILogger<DemoCampaignSeeder> logger)
{
    /// <summary>
    /// India and the Indian Rupee, from IAM's global master catalogue. Seed constants there, and
    /// the campaign columns that hold them are plain Guids rather than foreign keys.
    /// </summary>
    private static readonly Guid IndiaCountryId = Guid.Parse("11111111-1111-1111-1111-111111111001");

    private static readonly Guid InrCurrencyId = Guid.Parse("55555555-5555-5555-5555-555555555001");

    /// <summary>The offset every time of day below is chosen in: the Organisations work in IST.</summary>
    private static readonly TimeSpan IndiaOffset = TimeSpan.FromMinutes(330);

    private const string OfflineChannelCode = "OFFLINE";

    private readonly SeedSettings _seed = seedOptions.Value;

    public async Task<DemoSeedOutcome> SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_seed.CreateSampleData)
        {
            return DemoSeedOutcome.Disabled;
        }

        var reference = await ReadReferenceDataAsync(cancellationToken);
        var waiting = false;

        foreach (var organisation in Organisations)
        {
            waiting |= !await SeedOrganisationAsync(organisation, reference, cancellationToken);
        }

        return waiting ? DemoSeedOutcome.Waiting : DemoSeedOutcome.Completed;
    }

    /// <summary>
    /// One Organisation's campaigns and tracking assets. False means "not yet": the Organisation,
    /// one of its people or a reference row is not there, and the caller should ask again.
    /// </summary>
    private async Task<bool> SeedOrganisationAsync(
        DemoOrganisation organisation, ReferenceData reference, CancellationToken cancellationToken)
    {
        var tenant = await ReadTenantAsync(organisation.Subdomain, cancellationToken);

        if (tenant is null)
        {
            return false;
        }

        var campaignIds = organisation.Campaigns
            .Select(campaign => DemoIds.Of("campaign", organisation.Subdomain, campaign.Code))
            .ToList();

        var existing = await context.Campaigns
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(campaign => campaign.TenantId == tenant.Id)
            .Select(campaign => new { campaign.Id, campaign.Code })
            .ToListAsync(cancellationToken);

        if (existing.Any(campaign => campaignIds.Contains(campaign.Id)))
        {
            // Seeded already. Still worth one look: a seed that ran before the geography master
            // existed wrote its campaigns with no state or city - see RepairGeographyAsync.
            await RepairAssetTypesAsync(campaignIds, tenant.Id, cancellationToken);

            return await RepairGeographyAsync(organisation, tenant.Id, cancellationToken);
        }

        var people = await ReadPeopleAsync(tenant.Id, cancellationToken);
        var missingPeople = RequiredUsernames(organisation).Where(name => !people.ContainsKey(name)).ToList();

        if (missingPeople.Count > 0)
        {
            logger.LogDebug(
                "The demonstration campaigns for {Subdomain} are waiting for {Count} account(s) "
                + "IAM has not created yet: {Usernames}.",
                organisation.Subdomain, missingPeople.Count, string.Join(", ", missingPeople));

            return false;
        }

        var missingReference = organisation.Campaigns.SelectMany(campaign => campaign.Channels)
            .Concat(organisation.Assets.Select(asset => asset.Channel))
            .Where(code => !reference.Channels.ContainsKey(code))
            .Concat(organisation.Assets.Select(asset => asset.Source)
                .Where(code => !reference.Sources.ContainsKey(code)))
            .Concat(organisation.Assets.Select(asset => asset.Medium)
                .Where(code => !reference.Mediums.ContainsKey(code)))
            .Distinct()
            .ToList();

        if (missingReference.Count > 0)
        {
            logger.LogDebug(
                "The demonstration campaigns for {Subdomain} are waiting for reference rows that "
                + "are not seeded yet: {Codes}.",
                organisation.Subdomain, string.Join(", ", missingReference));

            return false;
        }

        var places = await ReadPlacesAsync(cancellationToken);

        // THE GEOGRAPHY MASTER IS WAITED FOR LIKE EVERYTHING ELSE FROM IAM. On a fresh stack IAM
        // seeds its states and cities a few seconds after the Organisations this method waits
        // for, and a seed that ran in that gap wrote every campaign - and every offline QR code's
        // places - with a country and a ZIP code but no state and no city. Once per Organisation
        // meant it never looked again.
        var missingCities = organisation.Campaigns
            .Select(campaign => campaign.City)
            .Where(city => !places.ContainsKey(city))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (missingCities.Count > 0)
        {
            logger.LogDebug(
                "The demonstration campaigns for {Subdomain} are waiting for the geography master "
                + "to hold: {Cities}.",
                organisation.Subdomain, string.Join(", ", missingCities));

            return false;
        }

        var now = DateTimeOffset.UtcNow;
        var destination = ResolveDestination(organisation);

        // A CODE SOMEBODY HAS ALREADY USED IS LEFT TO THEM. The register is unique on
        // (Organisation, code), so a demonstration campaign whose code a real one took first
        // would fail the whole save - and theirs is the one that matters.
        var takenCodes = existing.Select(campaign => campaign.Code).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var written = new Dictionary<string, Campaign>(StringComparer.OrdinalIgnoreCase);

        foreach (var seed in organisation.Campaigns)
        {
            if (takenCodes.Contains(seed.Code))
            {
                logger.LogWarning(
                    "Demonstration campaign {Code} was skipped in {Subdomain}: the code is already in use.",
                    seed.Code, organisation.Subdomain);

                continue;
            }

            var campaign = BuildCampaign(organisation, seed, tenant, people, reference, places, now);

            written[seed.Code] = campaign;
            await context.Campaigns.AddAsync(campaign, cancellationToken);

            await context.AuditEvents.AddRangeAsync(
                BuildAuditTrail(organisation, seed, campaign, people, now), cancellationToken);
        }

        var assetCount = 0;

        foreach (var (seed, code, position) in NumberAssets(organisation.Assets))
        {
            if (!written.TryGetValue(seed.Campaign, out var campaign))
            {
                continue;
            }

            var campaignSeed = organisation.Campaigns.First(item => item.Code == seed.Campaign);

            await context.TrackingAssets.AddAsync(
                BuildAsset(organisation, seed, code, position, campaign, campaignSeed, people,
                    reference, destination, now),
                cancellationToken);

            assetCount++;
        }

        await SaveAsBuiltAsync(cancellationToken);

        logger.LogInformation(
            "Seeded the demonstration data for {Subdomain}: {CampaignCount} campaign(s) across "
            + "{StatusCount} statuses, {CheckCount} readiness check(s) and {AssetCount} tracking asset(s).",
            organisation.Subdomain,
            written.Count,
            written.Values.Select(campaign => campaign.Status).Distinct().Count(),
            written.Values.Sum(campaign => campaign.ReadinessChecks.Count),
            assetCount);

        return true;
    }

    /// <summary>
    /// Turns the demonstration assets a first seed wrote as Short Links or UTM Links into Landing
    /// Pages. Those two types are no longer offered (see CampaignSettings.OfferedTrackingAssetTypes),
    /// so the register listed types nobody could create. Only the seeded campaigns' assets are touched.
    /// </summary>
    private async Task RepairAssetTypesAsync(
        IReadOnlyList<Guid> campaignIds, Guid tenantId, CancellationToken cancellationToken)
    {
        var legacy = await context.TrackingAssets
            .IgnoreQueryFilters()
            .Where(asset => asset.TenantId == tenantId
                            && campaignIds.Contains(asset.CampaignId)
                            && (asset.AssetType == TrackingAssetType.ShortLink
                                || asset.AssetType == TrackingAssetType.UTMLink))
            .ToListAsync(cancellationToken);

        if (legacy.Count == 0)
        {
            return;
        }

        foreach (var asset in legacy)
        {
            asset.AssetType = TrackingAssetType.LandingPage;
        }

        await context.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Changed {Count} demonstration tracking asset(s) from Short Link / UTM Link to Landing Page.",
            legacy.Count);
    }

    /// <summary>
    /// Gives the demonstration campaigns the state and city the catalogue names for them, and
    /// their offline QR codes' places the campaign's - where a seed that ran too early left them
    /// empty. False means the geography master cannot be read yet and the caller should ask again.
    ///
    /// WHAT WENT WRONG. A seed that ran in the seconds before IAM had written its states and
    /// cities found none, and wrote every campaign with a country and a ZIP code only. Editing one
    /// then demanded a State and City that were not there, and every place on the Tracking Asset
    /// Manager read "From campaign" over an empty box, so no place could be reported by location.
    ///
    /// ONLY WHAT IS STILL EMPTY IS FILLED. A campaign somebody has since given a location keeps
    /// it, and so does a place with one of its own. The ordinary save is used, so each repaired
    /// row's version moves on and a screen holding the empty copy is told it changed.
    /// </summary>
    private async Task<bool> RepairGeographyAsync(
        DemoOrganisation organisation, Guid tenantId, CancellationToken cancellationToken)
    {
        var cityByCampaign = organisation.Campaigns.ToDictionary(
            campaign => DemoIds.Of("campaign", organisation.Subdomain, campaign.Code),
            campaign => campaign.City);

        var campaignIds = cityByCampaign.Keys.ToList();

        var unlocatedCampaigns = await context.Campaigns
            .IgnoreQueryFilters()
            .Where(campaign => campaign.TenantId == tenantId
                               && campaignIds.Contains(campaign.Id)
                               && (campaign.StateId == null || campaign.CityId == null))
            .ToListAsync(cancellationToken);

        var unlocatedPlaces = await context.TrackingAssetPlaces
            .IgnoreQueryFilters()
            .Where(place => (place.CityId == null || place.StateId == null)
                            && campaignIds.Contains(place.TrackingAsset.CampaignId))
            .Select(place => new { Place = place, place.TrackingAsset.CampaignId })
            .ToListAsync(cancellationToken);

        if (unlocatedCampaigns.Count == 0 && unlocatedPlaces.Count == 0)
        {
            return true;
        }

        var places = await ReadPlacesAsync(cancellationToken);

        if (places.Count == 0)
        {
            return false;
        }

        foreach (var campaign in unlocatedCampaigns)
        {
            if (places.TryGetValue(cityByCampaign[campaign.Id], out var place))
            {
                campaign.StateId ??= place.StateId;
                campaign.CityId ??= place.CityId;
            }
        }

        // The campaigns' locations as they now stand - repaired above or already set - which is
        // what a place takes when it has none of its own.
        var located = await context.Campaigns
            .IgnoreQueryFilters()
            .Where(campaign => campaignIds.Contains(campaign.Id))
            .ToDictionaryAsync(campaign => campaign.Id, cancellationToken);

        foreach (var row in unlocatedPlaces)
        {
            if (located.TryGetValue(row.CampaignId, out var campaign))
            {
                row.Place.CityId ??= campaign.CityId;
                row.Place.StateId ??= campaign.StateId;
            }
        }

        await context.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Gave {CampaignCount} demonstration campaign(s) and {PlaceCount} tracking asset place(s) "
            + "in {Subdomain} the state and city the seed had left empty.",
            unlocatedCampaigns.Count, unlocatedPlaces.Count, organisation.Subdomain);

        return true;
    }

    // =============================================================================================
    // Campaigns
    // =============================================================================================

    private static Campaign BuildCampaign(
        DemoOrganisation organisation,
        DemoCampaign seed,
        TenantRow tenant,
        IReadOnlyDictionary<string, Guid> people,
        ReferenceData reference,
        IReadOnlyDictionary<string, PlaceRow> places,
        DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.ToOffset(IndiaOffset).Date);
        var timeline = seed.Timeline;
        var creator = people[seed.Creator];
        var approver = people[seed.Approver];
        var createdAt = Moment(now, timeline.Created, seed.Code + "|created");
        var place = places.GetValueOrDefault(seed.City);

        var campaign = new Campaign
        {
            Id = DemoIds.Of("campaign", organisation.Subdomain, seed.Code),
            TenantId = tenant.Id,
            BusinessUnitId = tenant.BusinessUnitId,
            Code = seed.Code,
            Name = seed.Name,
            Purpose = seed.Purpose,
            FundOrProgramme = seed.Fund,
            StartDate = today.AddDays(seed.StartsIn),
            EndDate = today.AddDays(seed.EndsIn),
            TargetAmount = seed.Target,
            BudgetAmount = seed.Budget,
            CampaignAmount = seed.Ask,
            CurrencyId = InrCurrencyId,
            CountryId = IndiaCountryId,
            StateId = place?.StateId,
            CityId = place?.CityId,
            ZipCode = seed.Zip,
            LifecycleActivation = seed.Activation,
            DaysBeforeStart = 7,
            ReminderTime = new TimeOnly(9, 30),
            PublicDescription = seed.PublicDescription,
            TermsAndNotice = organisation.TermsAndNotice,
            Status = seed.Status,
            CreatedAtUtc = createdAt,
            CreatedByUserId = creator,
            Version = 1
        };

        // The same moments the lifecycle rows below record, so the campaign and its history agree
        // to the minute about when it was submitted and approved.
        if (timeline.Submitted is { } submitted)
        {
            campaign.SubmittedByUserId = creator;
            campaign.SubmittedAtUtc = Moment(
                now, submitted, $"{seed.Code}|{CampaignLifecycleActionType.Submit}");
        }

        if (timeline.Approved is { } approved)
        {
            campaign.ApprovedByUserId = approver;
            campaign.ApprovedAtUtc = Moment(
                now, approved, $"{seed.Code}|{CampaignLifecycleActionType.Approve}");
        }

        foreach (var (username, index) in seed.Owners.Select((value, index) => (value, index)))
        {
            campaign.Owners.Add(new CampaignOwner
            {
                Id = DemoIds.Of("campaign-owner", organisation.Subdomain, $"{seed.Code}|{username}"),
                CampaignId = campaign.Id,
                OwnerId = people[username],
                IsPrimary = index == 0,
                CreatedAtUtc = createdAt,
                CreatedByUserId = creator,
                Version = 1
            });
        }

        foreach (var channel in seed.Channels)
        {
            campaign.Channels.Add(new CampaignChannel
            {
                Id = DemoIds.Of("campaign-channel", organisation.Subdomain, $"{seed.Code}|{channel}"),
                CampaignId = campaign.Id,
                ChannelId = reference.Channels[channel]
            });
        }

        AddReadinessChecks(organisation, seed, campaign, people, now);
        AddLifecycle(organisation, seed, campaign, people, now);

        return campaign;
    }

    /// <summary>
    /// The twelve-line checklist, in the state the campaign's <c>Readiness</c> string describes.
    ///
    /// A BLOCKER IS RAISED BY THE APPROVER AND CLEARED BY THE CHECK'S OWNER, which is the shape a
    /// real one has: the Campaign Manager spots what is standing in the way, and the person who
    /// owns that line of the checklist deals with it.
    /// </summary>
    private static void AddReadinessChecks(
        DemoOrganisation organisation,
        DemoCampaign seed,
        Campaign campaign,
        IReadOnlyDictionary<string, Guid> people,
        DateTimeOffset now)
    {
        var timeline = seed.Timeline;
        var creator = people[seed.Creator];
        var approver = people[seed.Approver];

        // The day a verdict was recorded: while the campaign was being reviewed for approval.
        var reviewedDaysAgo = timeline.Approved ?? timeline.Submitted ?? timeline.Created;

        foreach (var (check, index) in Checklist.Select((value, index) => (value, index)))
        {
            var mark = index < seed.Readiness.Length ? seed.Readiness[index] : ReadinessMark.Pending;

            // THE ASSIGNEE RECORDS THE VERDICT, so every check goes to somebody who can pass or fail
            // it: the executive who built the campaign, the digital executive for tracking, and the
            // Organisation Admin for the payment set-up only an administrator can see. The Campaign
            // Manager owns none - it decides the launch on these verdicts rather than recording them.
            var owner = check.Category switch
            {
                ReadinessCheckCategory.Tracking => people[organisation.DigitalExecutive],
                ReadinessCheckCategory.Payment => people[organisation.Administrator],
                _ => creator
            };

            var key = $"{seed.Code}|{check.Name}";
            var decidedAt = Moment(now, reviewedDaysAgo, key + "|verdict");

            var row = new CampaignReadinessCheck
            {
                Id = DemoIds.Of("readiness-check", organisation.Subdomain, key),
                TenantId = campaign.TenantId,
                BusinessUnitId = campaign.BusinessUnitId,
                CampaignId = campaign.Id,
                CheckName = check.Name,
                Description = check.Description,
                Category = check.Category,
                SuccessCriteria = check.Criteria,
                RequiredForLaunch = check.Required,
                OwnerUserId = owner,

                // Three days before the start date: late enough to be real, early enough to fix.
                DueDate = campaign.StartDate.AddDays(-3),

                Status = mark switch
                {
                    ReadinessMark.Passed or ReadinessMark.Recovered => ReadinessCheckStatus.Passed,
                    ReadinessMark.Failed or ReadinessMark.Blocked => ReadinessCheckStatus.Failed,
                    _ => ReadinessCheckStatus.Pending
                },

                Notes = mark switch
                {
                    ReadinessMark.Passed or ReadinessMark.Recovered => check.PassedNote,
                    ReadinessMark.Failed or ReadinessMark.Blocked => check.FailedNote,
                    _ => null
                },

                CreatedAtUtc = campaign.CreatedAtUtc,
                CreatedByUserId = campaign.CreatedByUserId,
                Version = 1
            };

            if (mark != ReadinessMark.Pending)
            {
                row.UpdatedAtUtc = decidedAt;
                row.UpdatedByUserId = owner;
                row.Version = 2;
            }

            if (mark is ReadinessMark.Blocked or ReadinessMark.Recovered)
            {
                var resolved = mark == ReadinessMark.Recovered;

                // Raised the day before the verdict, and cleared on the day of it.
                var raisedAt = Moment(now, reviewedDaysAgo + (resolved ? 1 : 0), key + "|blocker");

                row.Blockers.Add(new CampaignReadinessBlocker
                {
                    Id = DemoIds.Of("readiness-blocker", organisation.Subdomain, key),
                    TenantId = campaign.TenantId,
                    BusinessUnitId = campaign.BusinessUnitId,
                    CampaignReadinessCheckId = row.Id,
                    OwnerUserId = owner,
                    BlockerNote = check.BlockerNote,
                    IsResolved = resolved,
                    ResolvedByUserId = resolved ? approver : null,
                    ResolvedAtUtc = resolved ? decidedAt : null,
                    ResolutionNote = resolved ? check.ResolutionNote : null,
                    CreatedAtUtc = raisedAt,
                    CreatedByUserId = creator,
                    UpdatedAtUtc = resolved ? decidedAt : null,
                    UpdatedByUserId = resolved ? approver : null,
                    Version = resolved ? 2 : 1
                });
            }

            campaign.ReadinessChecks.Add(row);
        }
    }

    /// <summary>
    /// The lifecycle rows behind the campaign's present status, one per step it has taken.
    ///
    /// THE PEOPLE FOLLOW THE PRODUCT'S OWN RULES. The executive who created the campaign submits
    /// it and asks to close it; the Campaign Manager approves, pauses, resumes and approves the
    /// close; and a manually activated campaign is started by the Organisation Admin. An
    /// automatically activated campaign is started by the system user, exactly as the activation
    /// sweep records it.
    /// </summary>
    private static void AddLifecycle(
        DemoOrganisation organisation,
        DemoCampaign seed,
        Campaign campaign,
        IReadOnlyDictionary<string, Guid> people,
        DateTimeOffset now)
    {
        var timeline = seed.Timeline;
        var creator = people[seed.Creator];
        var approver = people[seed.Approver];
        var administrator = people[organisation.Administrator];

        void Add(
            CampaignLifecycleActionType type,
            int daysAgo,
            Guid requestedBy,
            CampaignLifecycleActionStatus status = CampaignLifecycleActionStatus.Completed,
            DemoReason? reason = null,
            Guid? approvedBy = null,
            int? approvedDaysAgo = null)
        {
            var at = Moment(now, daysAgo, $"{seed.Code}|{type}");

            campaign.LifecycleActions.Add(new CampaignLifecycleAction
            {
                Id = DemoIds.Of("lifecycle-action", organisation.Subdomain, $"{seed.Code}|{type}"),
                CampaignId = campaign.Id,
                ActionType = type,
                ActionStatus = status,
                EffectiveAtUtc = at,
                ReasonCategory = reason?.Category,
                DetailedReason = reason?.Detail,
                CommunicationImpact = reason?.Impact,
                ClosureSummary = reason?.Summary,
                RequestedByUserId = requestedBy,
                ApprovedByUserId = approvedBy,

                // An approval is its own decision, taken there and then; a close is approved
                // later, by somebody else.
                ApprovedAtUtc = approvedBy is null
                    ? null
                    : approvedDaysAgo is { } decided
                        ? Moment(now, decided, $"{seed.Code}|{type}|approved")
                        : at,
                CreatedAtUtc = at,
                CreatedByUserId = requestedBy,
                Version = 1
            });

            // The campaign was last touched by its latest step.
            if (campaign.UpdatedAtUtc is null || at > campaign.UpdatedAtUtc)
            {
                campaign.UpdatedAtUtc = at;
                campaign.UpdatedByUserId = requestedBy;
            }

            campaign.Version++;
        }

        if (timeline.Submitted is { } submitted)
        {
            Add(CampaignLifecycleActionType.Submit, submitted, creator);
        }

        if (timeline.Approved is { } approved)
        {
            Add(CampaignLifecycleActionType.Approve, approved, approver,
                approvedBy: approver);
        }

        if (timeline.Activated is { } activated)
        {
            if (seed.Activation == LifecycleActivation.Auto)
            {
                Add(CampaignLifecycleActionType.Activate, activated, SystemUsers.SystemUserId,
                    reason: new DemoReason(
                        "SCHEDULED", "Activated automatically on the campaign's start date."));
            }
            else
            {
                Add(CampaignLifecycleActionType.Activate, activated, administrator,
                    reason: new DemoReason(
                        "Launch", "Readiness checklist complete; launched on the start date."));
            }
        }

        if (timeline.Paused is { } paused)
        {
            Add(CampaignLifecycleActionType.Pause, paused, approver, reason: seed.Pause);
        }

        if (timeline.Resumed is { } resumed)
        {
            Add(CampaignLifecycleActionType.Resume, resumed, approver,
                reason: new DemoReason(
                    "Issue resolved", "The cause of the pause was cleared and solicitation resumed."));
        }

        if (timeline.CloseRequested is { } closeRequested)
        {
            if (timeline.Closed is { } closed)
            {
                Add(CampaignLifecycleActionType.RequestClose, closeRequested, creator,
                    reason: seed.Close, approvedBy: approver, approvedDaysAgo: closed);

                var closedAt = Moment(now, closed, $"{seed.Code}|{CampaignLifecycleActionType.RequestClose}|approved");

                campaign.UpdatedAtUtc = closedAt;
                campaign.UpdatedByUserId = approver;
                campaign.Version++;
            }
            else
            {
                Add(CampaignLifecycleActionType.RequestClose, closeRequested, creator,
                    CampaignLifecycleActionStatus.Pending, seed.Close);
            }
        }

        if (timeline.Cancelled is { } cancelled)
        {
            Add(CampaignLifecycleActionType.CancelDraft, cancelled, creator, reason: seed.Close);
        }
    }

    /// <summary>
    /// The audit rows the campaign's History tab reads: who did what to it, and when.
    ///
    /// DERIVED FROM THE SAME TIMELINE AS THE LIFECYCLE ROWS, so the two can never tell different
    /// stories about one campaign.
    /// </summary>
    private static IEnumerable<CampaignAuditEvent> BuildAuditTrail(
        DemoOrganisation organisation,
        DemoCampaign seed,
        Campaign campaign,
        IReadOnlyDictionary<string, Guid> people,
        DateTimeOffset now)
    {
        var timeline = seed.Timeline;
        var creator = people[seed.Creator];
        var approver = people[seed.Approver];
        var administrator = people[organisation.Administrator];

        CampaignAuditEvent Row(string action, int daysAgo, Guid actor, string salt, string? reason) =>
            new()
            {
                Id = DemoIds.Of("audit-event", organisation.Subdomain, $"{seed.Code}|{action}"),
                TenantId = campaign.TenantId,
                BusinessUnitId = campaign.BusinessUnitId == Guid.Empty ? null : campaign.BusinessUnitId,
                ActorUserId = actor,
                ActionCode = action,
                TargetType = nameof(Campaign),
                TargetId = campaign.Id,
                Result = AuditResult.Succeeded,
                Reason = reason,
                CorrelationId = "demonstration-seed",
                OccurredAtUtc = Moment(now, daysAgo, $"{seed.Code}|{salt}")
            };

        yield return Row(AuditActionCodes.CampaignCreated, timeline.Created, creator, "created", null);

        if (timeline.Submitted is { } submitted)
        {
            yield return Row(AuditActionCodes.CampaignSubmitted, submitted, creator,
                CampaignLifecycleActionType.Submit.ToString(), null);
        }

        if (timeline.Approved is { } approved)
        {
            yield return Row(AuditActionCodes.CampaignApproved, approved, approver,
                CampaignLifecycleActionType.Approve.ToString(), null);
        }

        if (timeline.Activated is { } activated)
        {
            yield return seed.Activation == LifecycleActivation.Auto
                ? Row(AuditActionCodes.CampaignAutoActivated, activated, SystemUsers.SystemUserId,
                    CampaignLifecycleActionType.Activate.ToString(),
                    $"Start date {campaign.StartDate:yyyy-MM-dd} reached.")
                : Row(AuditActionCodes.CampaignActivated, activated, approver,
                    CampaignLifecycleActionType.Activate.ToString(), "Launch");
        }

        if (timeline.Paused is { } paused)
        {
            yield return Row(AuditActionCodes.CampaignPaused, paused, approver,
                CampaignLifecycleActionType.Pause.ToString(), seed.Pause?.Detail);
        }

        if (timeline.Resumed is { } resumed)
        {
            yield return Row(AuditActionCodes.CampaignResumed, resumed, approver,
                CampaignLifecycleActionType.Resume.ToString(),
                "The cause of the pause was cleared and solicitation resumed.");
        }

        if (timeline.CloseRequested is { } closeRequested)
        {
            yield return Row(AuditActionCodes.CampaignCloseRequested, closeRequested, approver,
                CampaignLifecycleActionType.RequestClose.ToString(), seed.Close?.Detail);
        }

        if (timeline.Closed is { } closed)
        {
            yield return Row(AuditActionCodes.CampaignCloseApproved, closed, administrator,
                $"{CampaignLifecycleActionType.RequestClose}|approved", seed.Close?.Detail);
        }
    }

    // =============================================================================================
    // Tracking assets
    // =============================================================================================

    /// <summary>
    /// Gives each asset the code the product would have minted for it: the campaign's code, the
    /// asset type and a running number across the campaign's assets - CAMP01-QR-003.
    /// </summary>
    private static IEnumerable<(DemoAsset Seed, string Code, int Position)> NumberAssets(
        IReadOnlyList<DemoAsset> assets)
    {
        var counters = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (var asset in assets)
        {
            var position = counters.GetValueOrDefault(asset.Campaign) + 1;
            counters[asset.Campaign] = position;

            var prefix = asset.Type switch
            {
                TrackingAssetType.QRCode => "QR",
                TrackingAssetType.ShortLink => "SL",
                TrackingAssetType.UTMLink => "UTM",
                TrackingAssetType.LandingPage => "LP",
                _ => "TA"
            };

            yield return (asset, $"{asset.Campaign}-{prefix}-{position:000}", position);
        }
    }

    /// <summary>
    /// One tracking asset, in the state its status describes.
    ///
    /// THE TRACKING REFERENCE AND THE URL EXIST ONLY ON AN ASSET THAT HAS BEEN LIVE. Both are
    /// minted at activation, so a Draft, Submitted or Approved row carries neither - and one that
    /// has since been taken down keeps both, because donations already made through it still
    /// quote the reference.
    ///
    /// THE WINDOW IS THE CAMPAIGN'S OWN. An asset on a campaign that has ended is therefore
    /// outside its window whatever its status says, which is the distinction <c>IsLiveAt</c>
    /// draws and the manager's "live now" filter shows.
    /// </summary>
    private TrackingAsset BuildAsset(
        DemoOrganisation organisation,
        DemoAsset seed,
        string code,
        int position,
        Campaign campaign,
        DemoCampaign campaignSeed,
        IReadOnlyDictionary<string, Guid> people,
        ReferenceData reference,
        string destination,
        DateTimeOffset now)
    {
        var timeline = campaignSeed.Timeline;
        var creator = people[seed.Creator];
        var approver = people[campaignSeed.Approver];

        var hasBeenLive = seed.Status is TrackingAssetStatus.Active
            or TrackingAssetStatus.DisableRequested
            or TrackingAssetStatus.Inactive;

        // An asset that went live was prepared just after the campaign was approved; one still
        // working its way to approval was started in the last few days.
        var createdDaysAgo = seed.Status switch
        {
            TrackingAssetStatus.Draft => 2,
            TrackingAssetStatus.Submitted => 4,
            TrackingAssetStatus.Approved => 6,
            _ => Math.Max(3, (timeline.Approved ?? timeline.Created) - 1 - (position % 5 * 3))
        };

        createdDaysAgo = Math.Min(createdDaysAgo, Math.Max(1, timeline.Created - 1));

        var createdAt = Moment(now, createdDaysAgo, code + "|created");

        var asset = new TrackingAsset
        {
            Id = DemoIds.Of("tracking-asset", organisation.Subdomain, code),
            TenantId = campaign.TenantId,
            BusinessUnitId = campaign.BusinessUnitId,
            CampaignId = campaign.Id,
            Code = code,
            AssetType = seed.Type,
            ChannelId = reference.Channels[seed.Channel],
            SourceId = reference.Sources[seed.Source],
            MediumId = reference.Mediums[seed.Medium],
            Destination = destination,
            ContentTag = seed.ContentTag,
            Status = seed.Status,
            ActiveFrom = new DateTimeOffset(campaign.StartDate.ToDateTime(TimeOnly.MinValue), IndiaOffset)
                .ToUniversalTime(),
            ActiveTo = new DateTimeOffset(campaign.EndDate.ToDateTime(new TimeOnly(23, 59, 59)), IndiaOffset)
                .ToUniversalTime(),
            UsageCount = seed.Usage,
            TotalReceived = 0m,
            CreatedAtUtc = createdAt,
            CreatedByUserId = creator,
            Version = 1
        };

        if (seed.Status != TrackingAssetStatus.Draft)
        {
            asset.SubmittedByUserId = creator;
            asset.SubmittedAtUtc = Moment(now, createdDaysAgo - 1, code + "|submitted");
            asset.UpdatedAtUtc = asset.SubmittedAtUtc;
            asset.UpdatedByUserId = creator;
            asset.Version++;
        }

        if (seed.Status is not (TrackingAssetStatus.Draft or TrackingAssetStatus.Submitted))
        {
            asset.ApprovedByUserId = approver;
            asset.ApprovedAtUtc = Moment(now, createdDaysAgo - 2, code + "|approved");
            asset.UpdatedAtUtc = asset.ApprovedAtUtc;
            asset.UpdatedByUserId = approver;
            asset.Version++;
        }

        if (hasBeenLive)
        {
            asset.TrackingReference = DemoIds.TrackingReference(organisation.Subdomain, code);

            asset.GeneratedUrl = references.BuildUrl(
                asset,
                reference.SourceCodes[asset.SourceId],
                reference.MediumCodes[asset.MediumId],
                campaign.Code);

            asset.Version++;
        }

        if (seed.Status is TrackingAssetStatus.DisableRequested or TrackingAssetStatus.Inactive)
        {
            // Taken down when the campaign stopped, or a couple of days ago where it is still
            // running and this one asset was withdrawn on its own.
            var withdrawnDaysAgo = Math.Min(
                timeline.Closed ?? timeline.Paused ?? timeline.CloseRequested ?? 2,
                Math.Max(1, createdDaysAgo - 3));

            var requestedBy = seed.Status == TrackingAssetStatus.DisableRequested ? creator : approver;

            asset.UpdatedAtUtc = Moment(now, withdrawnDaysAgo, code + "|withdrawn");
            asset.UpdatedByUserId = requestedBy;
            asset.Version++;
        }

        // PLACES ON AN OFFLINE QR CODE AND NOTHING ELSE. The product refuses both directions - an
        // offline QR code with no place, and a place on anything else - so a seeded row that
        // ignored the rule would be a record the product itself would not accept.
        var takesPlaces = seed.Type == TrackingAssetType.QRCode
                          && string.Equals(seed.Channel, OfflineChannelCode, StringComparison.OrdinalIgnoreCase);

        if (takesPlaces)
        {
            foreach (var placeName in seed.Places ?? [])
            {
                asset.Places.Add(new TrackingAssetPlace
                {
                    Id = DemoIds.Of("tracking-asset-place", organisation.Subdomain, $"{code}|{placeName}"),
                    TrackingAssetId = asset.Id,
                    PlaceName = placeName,

                    // From the campaign, which is what the Generate form does for a placement
                    // whose city and state are left to it.
                    CityId = campaign.CityId,
                    StateId = campaign.StateId,

                    Destination = destination,
                    CreatedAtUtc = createdAt,
                    CreatedByUserId = creator,
                    Version = 1
                });
            }
        }

        return asset;
    }

    /// <summary>
    /// Where the demonstration QR codes and links send a donor: this environment's own donation
    /// form.
    ///
    /// THE CONFIGURED TRACKING HOST FIRST, because that is what a short link or QR code resolves
    /// through in the product, and it is what makes a seeded QR code scannable in the environment
    /// it was seeded into. The client's own address is the fallback, and a reserved <c>.test</c>
    /// host the last resort - never a real charity's website, which a demonstration link must not
    /// send anybody to.
    /// </summary>
    private string ResolveDestination(DemoOrganisation organisation)
    {
        var tracking = campaignOptions.Value.TrackingBaseUrl;

        if (IsHttpUrl(tracking))
        {
            return tracking;
        }

        var client = clientOptions.Value.BaseUrl;

        return IsHttpUrl(client)
            ? client.TrimEnd('/') + "/auth/donor-form"
            : $"https://give.{organisation.Subdomain}.test/donate";
    }

    private static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);

    // =============================================================================================
    // Time
    // =============================================================================================

    /// <summary>
    /// A moment in working hours, <paramref name="daysAgo"/> days before now.
    ///
    /// THE TIME OF DAY COMES FROM THE SALT, so two events on the same day do not share a
    /// timestamp and the same event lands on the same minute every time the data is seeded. It
    /// is never in the future: an event "today" is pulled back to a few minutes ago.
    /// </summary>
    private static DateTimeOffset Moment(DateTimeOffset now, int daysAgo, string salt)
    {
        var day = now.ToOffset(IndiaOffset).Date.AddDays(-daysAgo);

        // 09:30 to 18:00 Indian Standard Time.
        var minutes = (9 * 60) + 30 + (StableHash(salt) % ((8 * 60) + 30));
        var moment = new DateTimeOffset(day, IndiaOffset).AddMinutes(minutes).ToUniversalTime();

        return moment < now ? moment : now.AddMinutes(-5);
    }

    /// <summary>
    /// A hash that is the same in every process. <c>string.GetHashCode</c> is randomised per run,
    /// which would move every seeded timestamp each time the service restarted.
    /// </summary>
    private static int StableHash(string value)
    {
        unchecked
        {
            var hash = 17;

            foreach (var character in value)
            {
                hash = (hash * 31) + character;
            }

            return hash & int.MaxValue;
        }
    }

    // =============================================================================================
    // Saving
    // =============================================================================================

    /// <summary>
    /// Saves the tracked rows exactly as they were built.
    ///
    /// THIS OVERLOAD IS CHOSEN ON PURPOSE. <see cref="CampaignDbContext"/> stamps CreatedAtUtc,
    /// CreatedByUserId and Version in its override of <c>SaveChangesAsync(CancellationToken)</c>,
    /// which is right for a request and wrong here: it would overwrite every backdated creation
    /// time with this minute. The two-argument overload is the one that override itself ends up
    /// calling, so going to it directly performs the same save without the stamp. Every row above
    /// therefore sets its own Organisation, creator, creation time and version.
    /// </summary>
    private Task<int> SaveAsBuiltAsync(CancellationToken cancellationToken) =>
        context.SaveChangesAsync(acceptAllChangesOnSuccess: true, cancellationToken);

    // =============================================================================================
    // What is read from other modules' tables in the shared database
    // =============================================================================================

    private sealed record TenantRow(Guid Id, Guid BusinessUnitId);

    private sealed record PlaceRow(Guid CityId, Guid StateId);

    private sealed record ReferenceData(
        IReadOnlyDictionary<string, Guid> Channels,
        IReadOnlyDictionary<string, Guid> Sources,
        IReadOnlyDictionary<string, Guid> Mediums,
        IReadOnlyDictionary<Guid, string> SourceCodes,
        IReadOnlyDictionary<Guid, string> MediumCodes);

    private static IEnumerable<string> RequiredUsernames(DemoOrganisation organisation) =>
        organisation.Campaigns
            .SelectMany(campaign => campaign.Owners.Append(campaign.Creator).Append(campaign.Approver))
            .Concat(organisation.Assets.Select(asset => asset.Creator))
            .Append(organisation.Administrator)
            .Append(organisation.DigitalExecutive)
            .Distinct(StringComparer.OrdinalIgnoreCase);

    private async Task<ReferenceData> ReadReferenceDataAsync(CancellationToken cancellationToken)
    {
        var channels = await context.Channels.AsNoTracking()
            .ToDictionaryAsync(row => row.Code, row => row.Id, StringComparer.OrdinalIgnoreCase, cancellationToken);

        var sources = await context.Sources.AsNoTracking()
            .ToDictionaryAsync(row => row.Code, row => row.Id, StringComparer.OrdinalIgnoreCase, cancellationToken);

        var mediums = await context.Mediums.AsNoTracking()
            .ToDictionaryAsync(row => row.Code, row => row.Id, StringComparer.OrdinalIgnoreCase, cancellationToken);

        return new ReferenceData(
            channels,
            sources,
            mediums,
            sources.ToDictionary(pair => pair.Value, pair => pair.Key),
            mediums.ToDictionary(pair => pair.Value, pair => pair.Key));
    }

    /// <summary>
    /// The Organisation behind a subdomain, once IAM has created and activated it.
    ///
    /// BY SUBDOMAIN, because that is the one name for an Organisation that is the same in every
    /// database. Only Smile Foundation's id is configured; HelpAge India's is generated.
    /// </summary>
    private async Task<TenantRow?> ReadTenantAsync(string subdomain, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT id, business_unit_id FROM iam_tenants WHERE subdomain = @value AND status = 'Active' LIMIT 1",
            subdomain,
            reader => new TenantRow(reader.GetGuid(0), reader.GetGuid(1)),
            cancellationToken);

        return rows.FirstOrDefault();
    }

    private async Task<IReadOnlyDictionary<string, Guid>> ReadPeopleAsync(
        Guid tenantId, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT user_name, id FROM iam_users WHERE tenant_id = @value AND status = 'Active'",
            tenantId,
            reader => (Username: reader.GetString(0), Id: reader.GetGuid(1)),
            cancellationToken);

        return rows.ToDictionary(row => row.Username, row => row.Id, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>The Indian cities of the global master, by name, each with its state.</summary>
    private async Task<IReadOnlyDictionary<string, PlaceRow>> ReadPlacesAsync(
        CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            """
            SELECT city.name, city.id, city.state_province_id
            FROM gm_cities AS city
            INNER JOIN gm_state_provinces AS state ON state.id = city.state_province_id
            WHERE state.country_id = @value
            """,
            IndiaCountryId,
            reader => (Name: reader.GetString(0), Place: new PlaceRow(reader.GetGuid(1), reader.GetGuid(2))),
            cancellationToken);

        return rows
            .GroupBy(row => row.Name, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.First().Place, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Runs one read against a table another module owns.
    ///
    /// NOTHING HERE THROWS. Before IAM has created its schema the table does not exist at all,
    /// and that is an ordinary state on a first start, not a fault - so a failed read is an empty
    /// answer, and the caller reports that it is still waiting.
    /// </summary>
    private async Task<List<TRow>> QueryAsync<TRow>(
        string sql, object value, Func<System.Data.Common.DbDataReader, TRow> map,
        CancellationToken cancellationToken)
    {
        var rows = new List<TRow>();
        var connection = context.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;

        try
        {
            if (opened)
            {
                await context.Database.OpenConnectionAsync(cancellationToken);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = sql;

            var parameter = command.CreateParameter();
            parameter.ParameterName = "value";
            parameter.Value = value;
            command.Parameters.Add(parameter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(map(reader));
            }
        }
        catch (Exception exception) when (exception is System.Data.Common.DbException or InvalidOperationException)
        {
            logger.LogDebug(
                exception,
                "A table the demonstration campaigns depend on could not be read yet. Expected "
                + "before IAM has created its schema; the seed is retried.");

            return [];
        }
        finally
        {
            if (opened && connection.State == System.Data.ConnectionState.Open)
            {
                await context.Database.CloseConnectionAsync();
            }
        }

        return rows;
    }
}
