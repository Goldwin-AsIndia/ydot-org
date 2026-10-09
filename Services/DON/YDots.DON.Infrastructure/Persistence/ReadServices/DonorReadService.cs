using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.DTOs;
using YDots.DON.Application.Features.Donors.DTOs;
using YDots.DON.Application.Features.Donors.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Infrastructure.Persistence.ReadServices;

/// <summary>
/// EF Core implementation of the Donor read side.
///
/// Every query here starts from <see cref="ApplyScope"/>. That is deliberate: it is a single
/// place where the organisation boundary and the own-records restriction are applied, and it
/// runs before any filter the caller supplied, so no combination of query-string values can
/// widen what they see.
/// </summary>
public sealed class DonorReadService(
    DonDbContext context,
    ICurrentUser currentUser,
    IDonationLedger ledger,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings) : IDonorReadService
{
    /// <summary>How far back "gave recently" looks on the Donor List.</summary>
    private const int RecentWindowDays = 90;

    private static readonly FollowUpStatus[] OpenFollowUpStatuses =
        [FollowUpStatus.Planned, FollowUpStatus.Assigned, FollowUpStatus.Rescheduled];

    private readonly DonorSettings _settings = donorSettings.Value;

    public async Task<DonorListSummaryResponse> GetSummaryAsync(
        AccessScope scope,
        Guid? ownerUserId,
        CancellationToken cancellationToken)
    {
        var donors = ApplyScope(context.Donors.AsNoTracking(), scope);

        if (ownerUserId is not null)
        {
            donors = donors.Where(donor => donor.RelationshipOwnerUserId == ownerUserId);
        }

        var basics = await donors
            .Select(donor => new { donor.Id, donor.Status, donor.RelationshipOwnerUserId })
            .ToListAsync(cancellationToken);

        var ids = basics.Select(donor => donor.Id).ToList();
        var now = clock.UtcNow;
        var today = ReportingCalendar.DateOf(now, _settings);

        var giving = await ledger.GetGivingAsync(scope.OrganisationId, ids, cancellationToken);
        var recent = await ledger.GetPeriodGivingAsync(scope.OrganisationId, ids, now.AddDays(-RecentWindowDays), cancellationToken);

        // EACH DONOR COUNTED ONCE PER LINE, by their next open follow-up - the same reading the
        // Follow-up column of the list itself shows.
        var nextDue = (await context.FollowUpTasks
                .AsNoTracking()
                .Where(task => task.DonorId != null
                               && ids.Contains(task.DonorId.Value)
                               && OpenFollowUpStatuses.Contains(task.Status)
                               && task.DueAtUtc != null)
                .Select(task => new { DonorId = task.DonorId!.Value, DueAtUtc = task.DueAtUtc!.Value })
                .ToListAsync(cancellationToken))
            .GroupBy(task => task.DonorId)
            .Select(group => ReportingCalendar.DateOf(group.Min(task => task.DueAtUtc), _settings))
            .ToList();

        // The latest check per donor decides; grouped after loading, because "the newest row of
        // each group" is not something every provider translates.
        var verified = (await context.DonorIdentityVerifications
                .AsNoTracking()
                .Where(verification => ids.Contains(verification.DonorId))
                .Select(verification => new { verification.DonorId, verification.Status, verification.CreatedAtUtc })
                .ToListAsync(cancellationToken))
            .GroupBy(verification => verification.DonorId)
            .Select(group => new
            {
                DonorId = group.Key,
                Latest = group.OrderByDescending(verification => verification.CreatedAtUtc).First().Status
            })
            .ToList();

        var consentReview = await context.Consents
            .AsNoTracking()
            .Where(consent => consent.DonorId != null
                              && ids.Contains(consent.DonorId.Value)
                              && (consent.ConsentState == ConsentState.Withdrawn
                                  || (consent.ExpiryAtUtc != null && consent.ExpiryAtUtc <= now)))
            .Select(consent => consent.DonorId)
            .Distinct()
            .CountAsync(cancellationToken);

        var givers = giving.Values.Count(entry => entry.Received > 0);
        var lifetime = giving.Values.Sum(entry => entry.Received);
        var currency = giving.Values
            .GroupBy(entry => entry.Currency)
            .OrderByDescending(group => group.Count())
            .Select(group => group.Key)
            .FirstOrDefault() ?? recent.Currency;

        return new DonorListSummaryResponse(
            basics.Count,
            basics
                .GroupBy(donor => donor.Status.ToString())
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal),
            lifetime,
            currency,
            givers,
            givers == 0 ? 0m : Math.Round(lifetime / givers, 2),
            recent.Donors,
            recent.Amount,
            RecentWindowDays,
            basics.Count - givers,
            nextDue.Count(date => date < today),
            nextDue.Count(date => date == today),
            basics.Count - verified.Count(entry => entry.Latest == VerificationStatus.Verified),
            consentReview,
            basics.Count(donor => donor.RelationshipOwnerUserId == null),
            scope.IsOwnRecordsOnly ? "Donors assigned to you" : "Your whole organisation",
            now);
    }

    public async Task<PagedResponse<DonorListItemResponse>> SearchAsync(
        DonorSearchFilter query,
        AccessScope scope,
        CancellationToken cancellationToken)
    {
        var donors = BuildQuery(query, scope);

        var total = await donors.CountAsync(cancellationToken);

        var items = await donors
            .OrderByDescending(donor => donor.UpdatedAtUtc ?? donor.CreatedAtUtc)
            .ThenBy(donor => donor.DonorNumber)
            .Skip(query.Skip)
            .Take(query.PageSize)
            .ToListAsync(cancellationToken);

        var rows = await BuildRowsAsync(items, cancellationToken);

        return new PagedResponse<DonorListItemResponse>(rows, total, query.Page, query.PageSize);
    }

    public async Task<DonorDetailResponse?> GetDetailAsync(
        Guid id,
        AccessScope scope,
        CancellationToken cancellationToken)
    {
        var donor = await ApplyScope(context.Donors.AsNoTracking(), scope)
            .FirstOrDefaultAsync(candidate => candidate.Id == id, cancellationToken);

        return donor?.ToDetailResponse(
            currentUser.CanSeeContact(),
            DonorMappingConfig.PermittedActionsFor(donor, currentUser.HasPermission));
    }

    public async Task<IReadOnlyList<DonorLookupResponse>> LookupAsync(
        string? search,
        int maximumRows,
        AccessScope scope,
        CancellationToken cancellationToken)
    {
        var donors = ApplyScope(context.Donors.AsNoTracking(), scope);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();

            donors = donors.Where(donor =>
                donor.DonorNumber.ToLower().Contains(term)
                || (donor.FirstName != null && donor.FirstName.ToLower().Contains(term))
                || (donor.LastName != null && donor.LastName.ToLower().Contains(term))
                || (donor.OrganisationName != null && donor.OrganisationName.ToLower().Contains(term)));
        }

        var items = await donors
            .OrderBy(donor => donor.DonorNumber)
            .Take(maximumRows)
            .ToListAsync(cancellationToken);

        return [.. items.Select(donor => donor.ToLookupResponse())];
    }

    public async Task<IReadOnlyList<DonorListItemResponse>> ExportRowsAsync(
        DonorSearchFilter query,
        int maximumRows,
        AccessScope scope,
        CancellationToken cancellationToken)
    {
        var items = await BuildQuery(query, scope)
            .OrderByDescending(donor => donor.UpdatedAtUtc ?? donor.CreatedAtUtc)
            .Take(maximumRows)
            .ToListAsync(cancellationToken);

        return await BuildRowsAsync(items, cancellationToken);
    }

    private IQueryable<Donor> BuildQuery(DonorSearchFilter query, AccessScope scope)
    {
        var donors = ApplyScope(context.Donors.AsNoTracking(), scope);

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var term = query.Search.Trim().ToLowerInvariant();

            donors = donors.Where(donor =>
                donor.DonorNumber.ToLower().Contains(term)
                || (donor.FirstName != null && donor.FirstName.ToLower().Contains(term))
                || (donor.LastName != null && donor.LastName.ToLower().Contains(term))
                || (donor.OrganisationName != null && donor.OrganisationName.ToLower().Contains(term))
                || (donor.PrimaryEmail != null && donor.PrimaryEmail.ToLower().Contains(term))
                || (donor.PrimaryPhone != null && donor.PrimaryPhone.Contains(term)));
        }

        if (query.DonorType is not null)
        {
            donors = donors.Where(donor => donor.DonorType == query.DonorType);
        }

        if (query.Status is not null)
        {
            donors = donors.Where(donor => donor.Status == query.Status);
        }

        if (query.ApprovalState is not null)
        {
            donors = donors.Where(donor => donor.ApprovalState == query.ApprovalState);
        }

        if (!string.IsNullOrWhiteSpace(query.PreferredLanguage))
        {
            donors = donors.Where(donor => donor.PreferredLanguage == query.PreferredLanguage);
        }

        if (query.DoNotContact is not null)
        {
            donors = donors.Where(donor => donor.DoNotContact == query.DoNotContact);
        }

        if (query.OnlyMine == true)
        {
            query.RelationshipOwnerUserId = currentUser.UserId;
        }

        if (query.RelationshipOwnerUserId is not null)
        {
            donors = donors.Where(donor => donor.RelationshipOwnerUserId == query.RelationshipOwnerUserId);
        }

        if (!string.IsNullOrWhiteSpace(query.TagCode))
        {
            var tagCode = query.TagCode.Trim().ToUpperInvariant();
            donors = donors.Where(donor => donor.Tags.Any(tag => tag.Code == tagCode));
        }

        if (query.UpdatedAfterUtc is not null)
        {
            donors = donors.Where(donor => (donor.UpdatedAtUtc ?? donor.CreatedAtUtc) >= query.UpdatedAfterUtc);
        }

        if (query.UpdatedBeforeUtc is not null)
        {
            donors = donors.Where(donor => (donor.UpdatedAtUtc ?? donor.CreatedAtUtc) <= query.UpdatedBeforeUtc);
        }

        return donors;
    }

    /// <summary>
    /// The scope gate. Organisation always; then, for a caller who carries only narrowing
    /// scopes, the records they own or the exact records their token named. Nothing in this
    /// class queries Donors without going through here.
    /// </summary>
    private static IQueryable<Donor> ApplyScope(IQueryable<Donor> donors, AccessScope scope)
    {
        donors = donors.Where(donor => donor.OrganisationId == scope.OrganisationId);

        if (scope.IsOrganisationWide)
        {
            return donors;
        }

        // An explicit-record scope names the exact rows, so it replaces the ownership test.
        var explicitRecordIds = scope.ExplicitRecordIds;

        return explicitRecordIds.Count > 0
            ? donors.Where(donor => explicitRecordIds.Contains(donor.Id))
            : donors.Where(donor => donor.RelationshipOwnerUserId == scope.UserId);
    }

    /// <summary>
    /// Fills a page of grid rows with the facts that live in other tables.
    ///
    /// FOUR QUERIES FOR THE WHOLE PAGE, NOT FOUR PER ROW. Giving totals, the next follow-up, the
    /// consent state and the identity verification each live in their own table; fetching them
    /// row by row would be forty queries for a ten-row page. Each is fetched once for every donor
    /// on the page and then matched in memory.
    /// </summary>
    private async Task<List<DonorListItemResponse>> BuildRowsAsync(
        List<Donor> donors,
        CancellationToken cancellationToken)
    {
        var canSeeContact = currentUser.CanSeeContact();

        if (donors.Count == 0)
        {
            return [];
        }

        var donorIds = donors.Select(donor => donor.Id).ToList();

        // GIVING IS READ FROM THE PAYMENTS MODULE, net of refunds. It used to come from
        // don_donor_donation_summaries, which only the demonstration seeder ever wrote: a real gift
        // never reached it, so a real donor showed "never given". The same table also held one
        // Received row per donor, so "last gift" printed the LIFETIME total - a donor who gave
        // 6,000 last week after two earlier gifts showed a last gift of 14,000.
        var giving = await ledger.GetGivingAsync(currentUser.OrganisationId, donorIds, cancellationToken);

        // THE CAMPAIGN COLUMN WAS ALWAYS EMPTY - the row was built with campaignName: null. It is
        // the campaign of the donor's latest gift, or failing that the campaign of the lead that
        // brought them in.
        var acquisitionCampaigns = await context.Leads
            .AsNoTracking()
            .Where(lead => lead.ConvertedDonorId != null && donorIds.Contains(lead.ConvertedDonorId.Value))
            .Select(lead => new { DonorId = lead.ConvertedDonorId!.Value, CampaignName = lead.Campaign != null ? lead.Campaign.Name : null })
            .ToListAsync(cancellationToken);

        var followUps = await context.FollowUpTasks
            .AsNoTracking()
            .Where(task => task.DonorId != null
                && donorIds.Contains(task.DonorId.Value)
                && (task.Status == FollowUpStatus.Planned
                    || task.Status == FollowUpStatus.Assigned
                    || task.Status == FollowUpStatus.Rescheduled))
            .ToListAsync(cancellationToken);

        var consents = await context.Consents
            .AsNoTracking()
            .Where(consent => consent.DonorId != null && donorIds.Contains(consent.DonorId.Value))
            .ToListAsync(cancellationToken);

        var verifications = await context.DonorIdentityVerifications
            .AsNoTracking()
            .Where(verification => donorIds.Contains(verification.DonorId))
            .ToListAsync(cancellationToken);

        var now = clock.UtcNow;
        var today = ReportingCalendar.DateOf(now, _settings);

        return donors
            .Select(donor =>
            {
                giving.TryGetValue(donor.Id, out var given);

                var campaign = given?.LastCampaignName
                               ?? acquisitionCampaigns.FirstOrDefault(entry => entry.DonorId == donor.Id)?.CampaignName;

                var nextFollowUp = followUps
                    .Where(task => task.DonorId == donor.Id && task.DueAtUtc != null)
                    .OrderBy(task => task.DueAtUtc)
                    .FirstOrDefault();

                var verification = verifications
                    .Where(candidate => candidate.DonorId == donor.Id)
                    .OrderByDescending(candidate => candidate.CreatedAtUtc)
                    .FirstOrDefault();

                var donorConsents = consents.Where(consent => consent.DonorId == donor.Id).ToList();

                return donor.ToListItemResponse(
                    canSeeContact,
                    campaignName: campaign,
                    lastDonationAmount: given?.LastGiftAmount,
                    lastDonationAtUtc: given?.LastGiftAtUtc,
                    lifetimeGiving: given?.Received ?? 0m,
                    currency: given?.Currency ?? "INR",
                    followUpStatus: DescribeFollowUp(nextFollowUp?.DueAtUtc, today),

                    // "NOT CHECKED" WHEN NOBODY EVER STARTED A CHECK. It used to read "Pending",
                    // which says a check is under way when none exists.
                    verificationStatus: DescribeVerification(verification?.Status),
                    consentStatus: DescribeConsent(donorConsents),
                    giftCount: given?.GiftCount ?? 0,
                    nextFollowUpDueUtc: nextFollowUp?.DueAtUtc,

                    // SOMETHING FOR A PERSON TO LOOK AT: a consent that has expired, or one that
                    // was withdrawn. Both mean the permitted channels have changed.
                    consentReviewRequired: donorConsents.Any(consent =>
                        consent.ConsentState == ConsentState.Withdrawn
                        || (consent.ExpiryAtUtc != null && consent.ExpiryAtUtc <= now)));
            })
            .ToList();
    }

    /// <summary>
    /// Overdue / Due Today / Tomorrow / Upcoming / None, recomputed on read in the organisation's
    /// calendar.
    ///
    /// NEVER STORED, because overdue happens as time passes rather than because somebody saved
    /// the record - a stored value would be wrong for most of any given day.
    ///
    /// UPCOMING IS NEW. A follow-up booked for next week used to read "None", which the list
    /// explains as "nothing is planned" - the opposite of the truth.
    /// </summary>
    private string DescribeFollowUp(DateTimeOffset? dueAtUtc, DateOnly today) =>
        ReportingCalendar.DescribeDue(dueAtUtc, today, _settings);

    /// <summary>
    /// The latest identity check, in the words the Donor List and its export print.
    ///
    /// THE ENUM NAMES WERE GOING OUT RAW - "ChallengeSent", "NotStarted", "Escalated" - so the
    /// list read "ID challengesent" and its Pending filter, which is what the screen calls a code
    /// that has been sent and not yet entered, matched nobody. A check that was opened and never
    /// begun is the same thing to a reader as no check at all.
    /// </summary>
    private static string DescribeVerification(VerificationStatus? status) =>
        status switch
        {
            VerificationStatus.Verified => "Verified",
            VerificationStatus.ChallengeSent => "Pending",
            VerificationStatus.Escalated => "Under review",
            VerificationStatus.Failed => "Failed",
            VerificationStatus.Expired => "Expired",
            VerificationStatus.Cancelled => "Cancelled",
            _ => "Not checked"
        };

    /// <summary>
    /// The donor's overall consent position.
    ///
    /// PARTIAL IS THE INTERESTING ONE. A donor who has granted e-mail and withdrawn SMS is
    /// neither fully contactable nor fully off-limits, and collapsing that to "Granted" is how
    /// somebody ends up texting a person who asked them not to.
    /// </summary>
    private static string DescribeConsent(IReadOnlyCollection<Consent> consents)
    {
        if (consents.Count == 0)
        {
            return "Not provided";
        }

        var granted = consents.Count(consent => consent.ConsentState == ConsentState.Granted);

        if (granted == 0) return "Withdrawn";
        return granted == consents.Count ? "Granted" : "Partial";
    }
}
