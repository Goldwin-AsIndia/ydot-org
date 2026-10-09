using YDots.DON.Application.Common.Settings;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.Features.Donor360.DTOs;
using YDots.DON.Application.Features.Donors.Mappings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.Donor360.Queries.GetDonor360;

/// <summary>SCR-DON-003 GET. Unified identity, donations, communications, consent, tasks and history.</summary>
public sealed record GetDonor360Query(Guid DonorId);

/// <summary>
/// Assembles the thirteen read-only panels of Donor 360.
///
/// Every panel is loaded through the repository that owns it, and each one applies its own
/// visibility rule: contact details need don.donors.view-sensitive-contact, documents and
/// evidence need don.donors.view-confidential-evidence. UI section 4.3.1: "Every tab and
/// sensitive field has separate permission and scope enforcement."
/// </summary>
public sealed class Donor360QueryHandler(
    IDonorRepository donorRepository,
    IDonor360Repository donor360Repository,
    IConsentRepository consentRepository,
    IFollowUpRepository followUpRepository,
    IDonorMergeCaseRepository mergeCaseRepository,
    IDonationLedger ledger,
    IPeopleDirectory people,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<DonorSettings> donorSettings,
    ILogger<Donor360QueryHandler> logger)
{
    private readonly DonorSettings _settings = donorSettings.Value;

    private const int HistoryRowLimit = 50;

    public async Task<Result<Donor360Response>> HandleAsync(
        GetDonor360Query query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Get Donor 360 started for DonorId {DonorId}.", query.DonorId);

        var donor = await donorRepository.GetWithChildrenAsync(query.DonorId, cancellationToken);

        if (donor is null || donor.OrganisationId != currentUser.OrganisationId)
        {
            logger.LogWarning("Get Donor 360 failed for DonorId {DonorId} because the donor was not found inside the current organisation scope.", query.DonorId);
            return Result.Failure<Donor360Response>(Error.DonorNotFound());
        }

        if (currentUser.Scope.IsOwnRecordsOnly && donor.RelationshipOwnerUserId != currentUser.UserId)
        {
            logger.LogWarning("Get Donor 360 failed for DonorId {DonorId} because the donor is outside the current user's ownership scope.", query.DonorId);
            return Result.Failure<Donor360Response>(Error.DonorNotFound());
        }

        var canSeeContact = currentUser.CanSeeContact();
        var canSeeEvidence = currentUser.CanSeeEvidence();
        var now = clock.UtcNow;

        logger.LogInformation("Loading Donor 360 panels for DonorId {DonorId}. ContactVisibility {CanSeeContact}, EvidenceVisibility {CanSeeEvidence}.", donor.Id, canSeeContact, canSeeEvidence);

        var contacts = await donorRepository.GetContactsAsync(donor.Id, cancellationToken);
        var tags = await donorRepository.GetTagsAsync(donor.Id, cancellationToken);
        var interactions = await donorRepository.GetInteractionsAsync(donor.Id, HistoryRowLimit, cancellationToken);
        var activity = await donorRepository.GetActivityHistoryAsync(donor.Id, HistoryRowLimit, cancellationToken);
        var consents = await consentRepository.GetCurrentForDonorAsync(donor.Id, cancellationToken);
        // EVERY FOLLOW-UP, not only the open ones: the tab has Open, Overdue and Closed views, and
        // the Closed view was empty by construction.
        var followUps = await followUpRepository.GetForDonorAsync(donor.Id, HistoryRowLimit, cancellationToken);
        var mergeCases = await mergeCaseRepository.GetForDonorAsync(donor.Id, cancellationToken);
        var promises = await donor360Repository.GetPromisesAsync(donor.Id, cancellationToken);
        var documents = await donor360Repository.GetDocumentsAsync(donor.Id, canSeeEvidence, cancellationToken);
        var campaignHistory = await donor360Repository.GetCampaignHistoryAsync(donor.Id, cancellationToken);

        // GIVING IS THE PAYMENTS MODULE'S. See IDonationLedger: the projection this used to read
        // was written only by the demonstration seeder, so a real gift never appeared here.
        var giving = (await ledger.GetGivingAsync(donor.OrganisationId, [donor.Id], cancellationToken))
            .GetValueOrDefault(donor.Id);
        var gifts = await ledger.GetDonationsAsync(donor.OrganisationId, donor.Id, HistoryRowLimit, cancellationToken);
        var campaignGiving = await ledger.GetCampaignGivingAsync(donor.OrganisationId, donor.Id, cancellationToken);
        var totals = BuildDonationTotals(giving, promises, now);

        var actorNames = await people.GetNamesAsync(
            donor.OrganisationId,
            [.. activity.Where(entry => entry.ActorUserId is not null).Select(entry => entry.ActorUserId!.Value)],
            cancellationToken);

        logger.LogInformation("Donor 360 panel data loaded successfully for DonorId {DonorId}. Contacts {ContactCount}, Tags {TagCount}, Interactions {InteractionCount}, Activity {ActivityCount}, Consents {ConsentCount}, FollowUps {FollowUpCount}, MergeCases {MergeCaseCount}, Gifts {GiftCount}, Promises {PromiseCount}, Documents {DocumentCount}, CampaignHistory {CampaignHistoryCount}.", donor.Id, contacts.Count, tags.Count, interactions.Count, activity.Count, consents.Count, followUps.Count, mergeCases.Count, gifts.Count, promises.Count, documents.Count, campaignHistory.Count);

        var response = new Donor360Response(
            ScreenIds.Donor360,
            ScreenRoutes.Donor360,
            donor.DonorNumber,
            donor.ToDetailResponse(canSeeContact, DonorMappingConfig.PermittedActionsFor(donor, currentUser.HasPermission)),
            BuildIdentitySummary(donor, contacts, tags, canSeeContact),
            donor.RelationshipOwnerUserId is null
                ? null
                : new RelationshipOwnerResponse(donor.RelationshipOwnerUserId.Value, donor.RelationshipOwnerName),
            BuildConsentStatus(consents),
            [.. consents.Select(BuildPreference)],
            totals,
            BuildCampaignHistory(campaignHistory, campaignGiving),
            [.. interactions.Select(BuildConversation)],
            [.. followUps.Select(task =>
            {
                var isOpen = task.Status is FollowUpStatus.Planned or FollowUpStatus.Assigned or FollowUpStatus.Rescheduled;

                return new Donor360FollowUpResponse(
                    task.Id, task.FollowUpReference, task.NextAction, task.DueAtUtc,
                    task.Priority.ToString(), task.Status.ToString(), task.RelationshipOwnerName,
                    isOpen,

                    // Due before today, by the organisation's calendar - as the queue reads it.
                    isOpen && task.DueAtUtc is not null && task.DueAtUtc < ReportingCalendar.Today(now, _settings).StartUtc,
                    task.RelationshipOwnerUserId == currentUser.UserId,
                    task.PermittedChannel.ToString(),
                    task.Purpose,
                    task.CompletedAtUtc,
                    task.CompletionOutcome,
                    isOpen
                    && (task.RelationshipOwnerUserId == currentUser.UserId || currentUser.IsTenantAdmin)
                    && currentUser.HasPermission(PermissionCodes.FollowUpPlannerMarkComplete));
            })],
            [.. promises.Select(promise => new PromiseResponse(
                promise.Id, promise.Reference, promise.Amount, promise.Currency,
                promise.PromisedAtUtc, promise.DueAtUtc, promise.Status.ToString(), promise.Campaign?.Name))],
            [.. documents.Select(document => new DocumentResponse(
                document.Id, document.Reference, document.Name, document.Description,
                document.Classification.ToString(), document.ScanStatus, document.CreatedAtUtc, document.ExpiresAtUtc))],
            [.. mergeCases.Select(mergeCase => new DuplicateLinkResponse(
                mergeCase.Id, mergeCase.ReviewReference, mergeCase.Status.ToString(),
                mergeCase.IdentityConfidence.ToString(), mergeCase.Decision?.ToString(),
                $"{ScreenRoutes.DuplicateReview}?reviewId={mergeCase.Id}"))],
            [.. activity.Select(entry => new ActivityHistoryResponse(
                entry.Id, entry.ActionCode, entry.TargetType, entry.Result.ToString(),
                entry.Reason, entry.CreatedAtUtc, entry.CorrelationId,
                entry.ActorUserId is Guid actor && actorNames.TryGetValue(actor, out var actorName)
                    ? actorName
                    : entry.ActorUserId is null ? "System" : null))],
            BuildPermittedActions(donor),
            BuildMaskedFieldList(canSeeContact, canSeeEvidence),
            DescribeScope(),
            ScreenState.Initial,
            [.. gifts.Select(gift => new DonationResponse(
                gift.Id, gift.Reference, gift.DonatedAtUtc, gift.Amount, gift.RefundedAmount,
                gift.Currency, gift.Status, gift.CampaignName))]);

        // Opening a 360 view with the unmasking permission is a sensitive view in its own right.
        if (canSeeContact || canSeeEvidence)
        {
            logger.LogInformation("Sensitive Donor 360 view detected for DonorId {DonorId}. ContactVisibility {CanSeeContact}, EvidenceVisibility {CanSeeEvidence}.", donor.Id, canSeeContact, canSeeEvidence);

            await auditWriter.WriteAsync(
                new AuditEntry(AuditActionCodes.DonorSensitiveViewed, nameof(Donor), donor.Id, AuditResult.Succeeded,
                    $"{donor.DonorNumber} opened on Donor 360 with elevated visibility."),
                cancellationToken);

            await unitOfWork.SaveChangesAsync(cancellationToken);

            logger.LogInformation("Sensitive Donor 360 view audit recorded successfully for DonorId {DonorId}.", donor.Id);
        }

        logger.LogInformation("Get Donor 360 completed successfully for DonorId {DonorId}.", donor.Id);

        return Result.Success(response);
    }

    private static IdentityAndContactSummaryResponse BuildIdentitySummary(
        Donor donor,
        IReadOnlyList<DonorContact> contacts,
        IReadOnlyList<DonorTag> tags,
        bool canSeeContact) =>
        new(
            donor.DisplayName,
            donor.DonorType.ToString(),
            ContactMasking.Email(donor.PrimaryEmail, canSeeContact),
            ContactMasking.Phone(donor.PrimaryPhone, canSeeContact),
            donor.PreferredLanguage,
            donor.DoNotContact,
            [.. contacts.Select(contact => new DonorContactResponse(
                contact.Id,
                contact.Name,
                contact.Description,
                contact.Channel.ToString(),
                MaskContactValue(contact, canSeeContact),
                contact.IsPrimary,
                contact.IsVerified,
                contact.Status.ToString(),
                !canSeeContact))],
            [.. tags.Select(tag => new DonorTagResponse(tag.Id, tag.Code, tag.Name, tag.Description, tag.Status.ToString()))],
            !canSeeContact);

    private static string MaskContactValue(DonorContact contact, bool canSeeContact) =>
        contact.Channel switch
        {
            ContactChannel.Email => ContactMasking.Email(contact.Value, canSeeContact) ?? string.Empty,
            ContactChannel.PostalAddress => canSeeContact ? contact.Value : "Address hidden",
            _ => ContactMasking.Phone(contact.Value, canSeeContact) ?? string.Empty
        };

    /// <summary>
    /// The overall consent badge. "Withdrawn" wins over "Granted" whenever any channel has been
    /// refused, because the safe reading of a mixed picture is the restrictive one.
    /// </summary>
    private static ConsentStatusResponse BuildConsentStatus(IReadOnlyList<Consent> consents)
    {
        var granted = consents.Count(consent => consent.ConsentState == ConsentState.Granted);
        var withdrawn = consents.Count(consent => consent.ConsentState == ConsentState.Withdrawn);

        var overall = consents.Count == 0
            ? "Not recorded"
            : withdrawn > 0 && granted == 0 ? "Withdrawn"
            : withdrawn > 0 ? "Partial"
            : "Granted";

        return new ConsentStatusResponse(
            overall,
            granted,
            withdrawn,
            consents.Count == 0 ? null : consents.Max(consent => consent.EffectiveAtUtc),
            consents.OrderByDescending(consent => consent.EffectiveAtUtc).FirstOrDefault()?.NoticeVersion);
    }

    private static CommunicationPreferenceResponse BuildPreference(Consent consent) =>
        new(
            consent.Channel.ToString(),
            consent.ConsentState.ToString(),
            consent.Status.ToString(),
            consent.EffectiveAtUtc,
            consent.ExpiryAtUtc,
            consent.PublicRecognitionPreference);

    /// <summary>
    /// "Donation totals by stage", in the order money moves.
    ///
    /// PLEDGED is what the donor promised and has not yet been settled - open and part-fulfilled
    /// pledges recorded here. RECEIVED, RECONCILED and REFUNDED are the payments module's, read
    /// live: received is net of refunds, reconciled is the part finance has matched to the bank.
    /// A stage with nothing in it is left out rather than shown as a zero line.
    /// </summary>
    private static IReadOnlyList<DonationTotalResponse> BuildDonationTotals(
        DonorGiving? giving,
        IReadOnlyList<DonorPromise> promises,
        DateTimeOffset now)
    {
        const string Live = "Live from payments";
        var totals = new List<DonationTotalResponse>();
        var currency = giving?.Currency ?? promises.FirstOrDefault()?.Currency ?? "INR";

        var pledged = promises
            .Where(promise => promise.Status is PromiseStatus.Open or PromiseStatus.PartiallyFulfilled)
            .ToList();

        if (pledged.Count > 0)
        {
            totals.Add(new DonationTotalResponse(
                DonationStage.Pledged.ToString(), pledged[0].Currency, pledged.Sum(promise => promise.Amount),
                pledged.Count, pledged.Max(promise => promise.PromisedAtUtc), now, "Recorded on this record"));
        }

        if (giving is not null && giving.GiftCount > 0)
        {
            var asAt = giving.LastGiftAtUtc ?? now;

            totals.Add(new DonationTotalResponse(
                DonationStage.Received.ToString(), currency, giving.Received, giving.GiftCount, asAt, now, Live));

            if (giving.Reconciled > 0)
            {
                totals.Add(new DonationTotalResponse(
                    DonationStage.Reconciled.ToString(), currency, giving.Reconciled, giving.GiftCount, asAt, now, Live));
            }
        }

        if (giving is not null && giving.Refunded > 0)
        {
            totals.Add(new DonationTotalResponse(
                DonationStage.Refunded.ToString(), currency, giving.Refunded, 0, giving.LastGiftAtUtc ?? now, now, Live));
        }

        return totals;
    }

    /// <summary>
    /// The campaigns this donor is connected to: the one their lead came from, and every one they
    /// gave to, with what they gave. Most recent first.
    /// </summary>
    private static IReadOnlyList<CampaignHistoryResponse> BuildCampaignHistory(
        IReadOnlyList<(Campaign Campaign, string LeadReference, DateTimeOffset? ConvertedAtUtc)> fromLeads,
        IReadOnlyList<CampaignGiving> fromGifts)
    {
        var rows = new Dictionary<Guid, CampaignHistoryResponse>();

        foreach (var gift in fromGifts)
        {
            rows[gift.CampaignId] = new CampaignHistoryResponse(
                gift.CampaignId, gift.CampaignCode ?? string.Empty, gift.CampaignName ?? "Campaign",
                string.Empty, null, gift.Amount, gift.GiftCount, gift.LastGiftAtUtc);
        }

        foreach (var (campaign, leadReference, convertedAtUtc) in fromLeads)
        {
            rows[campaign.Id] = rows.TryGetValue(campaign.Id, out var given)
                ? given with { LeadReference = leadReference, ConvertedAtUtc = convertedAtUtc }
                : new CampaignHistoryResponse(
                    campaign.Id, campaign.Code, campaign.Name, leadReference, convertedAtUtc, 0m, 0, null);
        }

        return [.. rows.Values.OrderByDescending(row => row.LastGiftAtUtc ?? row.ConvertedAtUtc ?? DateTimeOffset.MinValue)];
    }

    private static ConversationResponse BuildConversation(DonorInteraction interaction) =>
        new(
            interaction.Id,
            interaction.Name,
            interaction.Description,
            interaction.InteractionType.ToString(),
            interaction.Channel?.ToString(),
            interaction.OccurredAtUtc,
            interaction.Outcome.ToString(),
            interaction.PerformedByName,
            interaction.Status.ToString());

    private IReadOnlyList<string> BuildPermittedActions(Donor donor)
    {
        var actions = new List<string> { "View" };

        if (currentUser.HasPermission(PermissionCodes.Donor360Correct)
            && donor.Status is not (DonorStatus.Archived or DonorStatus.Merged))
        {
            actions.Add("Correct");
        }

        if (currentUser.HasPermission(PermissionCodes.Donor360FollowUp))
        {
            actions.Add("Follow up");
        }

        if (currentUser.HasPermission(PermissionCodes.Donor360CreateIntent))
        {
            actions.Add("Create intent");
        }

        if (currentUser.HasPermission(PermissionCodes.Donor360DeleteDraft)
            && donor.Status == DonorStatus.Prospect
            && donor.ApprovalState == ApprovalState.NotSubmitted)
        {
            actions.Add("Delete unused draft");
        }

        // Export History - the donor's gifts, pledges, follow-ups, conversations and consent.
        if (currentUser.HasPermission(PermissionCodes.DonorsExport))
        {
            actions.Add("Export history");
        }

        // Logging a conversation from the Communication Timeline.
        if (currentUser.HasPermission(PermissionCodes.LeadWorkQueueContact)
            && donor.Status is not (DonorStatus.Archived or DonorStatus.Merged))
        {
            actions.Add("Communicate");
        }

        return actions;
    }

    /// <summary>
    /// Tells the UI which panels are showing masked values, so it can explain the state instead
    /// of quietly showing stars and leaving the person wondering.
    /// </summary>
    private static IReadOnlyList<string> BuildMaskedFieldList(bool canSeeContact, bool canSeeEvidence)
    {
        var masked = new List<string>();

        if (!canSeeContact)
        {
            masked.Add("Identity and contact summary");
        }

        if (!canSeeEvidence)
        {
            masked.Add("Documents");
        }

        return masked;
    }

    private string DescribeScope() =>
        currentUser.Scope.IsOwnRecordsOnly ? "Records assigned to you" : "Your whole organisation";
}