using System.Globalization;
using Microsoft.Extensions.Logging;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Application.Common.Abstractions.Security;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.Common.Results;
using YDots.DON.Application.Common.Services;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.Features.Donors.Queries.ExportDonorHistory;

/// <summary>GET /api/v1/donors/{id}/history/export - one donor's history as CSV.</summary>
public sealed record ExportDonorHistoryQuery(Guid DonorId);

/// <summary>
/// Export History - the My Donor List grid action in the role flow.
///
/// ONE FILE, EVERY STRAND OF THE RELATIONSHIP, in date order: the gifts the payments module
/// recorded, the pledges taken, the follow-ups planned and worked, the conversations logged and the
/// consent decisions. A "Section" column says which is which, so the file sorts and filters in a
/// spreadsheet without five tabs.
///
/// SCOPED AND MASKED LIKE THE SCREEN. A caller limited to their own records exports only a donor
/// whose relationship they own; conversation notes and consent evidence stay withheld from a
/// caller who may not see them; and the export itself is an audited event.
/// </summary>
public sealed class ExportDonorHistoryHandler(
    IDonorRepository donorRepository,
    IDonor360Repository donor360Repository,
    IFollowUpRepository followUpRepository,
    IConsentRepository consentRepository,
    IInteractionTimelineReader timelineReader,
    ILeadRepository leadRepository,
    IDonationLedger ledger,
    IExportService exportService,
    IAuditWriter auditWriter,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    ILogger<ExportDonorHistoryHandler> logger)
{
    private const int RowLimit = 500;

    public async Task<Result<ExportFile>> HandleAsync(
        ExportDonorHistoryQuery query,
        CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Donor history export started for DonorId {DonorId}.", query.DonorId);

        var donor = await donorRepository.GetByIdAsync(query.DonorId, cancellationToken);

        if (donor is null
            || donor.OrganisationId != currentUser.OrganisationId
            || (currentUser.Scope.IsOwnRecordsOnly && donor.RelationshipOwnerUserId != currentUser.UserId))
        {
            logger.LogWarning("Donor history export refused for DonorId {DonorId}: not inside the caller's scope.", query.DonorId);
            return Result.Failure<ExportFile>(Error.DonorNotFound());
        }

        var canSeeContact = currentUser.CanSeeContact();
        var canSeeEvidence = currentUser.CanSeeEvidence();
        var invariant = CultureInfo.InvariantCulture;
        var lines = new List<(DateTimeOffset At, IReadOnlyList<string> Row)>();

        foreach (var gift in await ledger.GetDonationsAsync(donor.OrganisationId, donor.Id, RowLimit, cancellationToken))
        {
            lines.Add((gift.DonatedAtUtc,
            [
                "Gift", gift.DonatedAtUtc.ToString("u"), gift.Reference,
                gift.CampaignName ?? "No campaign recorded",
                (gift.Amount - gift.RefundedAmount).ToString("0.00", invariant), gift.Currency, gift.Status, string.Empty
            ]));
        }

        foreach (var promise in await donor360Repository.GetPromisesAsync(donor.Id, cancellationToken))
        {
            lines.Add((promise.PromisedAtUtc,
            [
                "Pledge", promise.PromisedAtUtc.ToString("u"), promise.Reference,
                promise.Campaign?.Name ?? (promise.DueAtUtc is null ? "Pledge" : $"Due {promise.DueAtUtc:yyyy-MM-dd}"),
                promise.Amount.ToString("0.00", invariant), promise.Currency, promise.Status.ToString(), string.Empty
            ]));
        }

        foreach (var task in await followUpRepository.GetForDonorAsync(donor.Id, RowLimit, cancellationToken))
        {
            var at = task.CompletedAtUtc ?? task.DueAtUtc ?? task.CreatedAtUtc;
            lines.Add((at,
            [
                "Follow-up", at.ToString("u"), task.FollowUpReference,
                $"{task.PermittedChannel}: {task.NextAction ?? task.Purpose}"
                    + (task.CompletionOutcome is null ? string.Empty : $" - {task.CompletionOutcome}"),
                string.Empty, string.Empty, task.Status.ToString(), task.RelationshipOwnerName ?? string.Empty
            ]));
        }

        // The conversations from before the conversion too: they are part of this relationship.
        var sourceLead = await leadRepository.GetConvertedFromAsync(donor.Id, cancellationToken);

        foreach (var interaction in await timelineReader.GetTimelineAsync(sourceLead?.Id, donor.Id, RowLimit, cancellationToken))
        {
            var detail = interaction.Direction is null
                ? interaction.Name
                : interaction.Description ?? interaction.Name;

            lines.Add((interaction.OccurredAtUtc,
            [
                "Communication", interaction.OccurredAtUtc.ToString("u"),
                interaction.InteractionType.ToString(),
                canSeeContact ? detail : $"{interaction.InteractionType} - details withheld for your role",
                string.Empty, string.Empty, interaction.Outcome.ToString(), interaction.PerformedByName ?? string.Empty
            ]));
        }

        foreach (var consent in await consentRepository.GetHistoryAsync(donor.Id, cancellationToken))
        {
            lines.Add((consent.EffectiveAtUtc,
            [
                "Consent", consent.EffectiveAtUtc.ToString("u"), consent.Channel.ToString(),
                canSeeEvidence ? $"{consent.Purpose} ({consent.EvidenceSource})" : consent.Purpose,
                string.Empty, string.Empty, consent.ConsentState.ToString(), string.Empty
            ]));
        }

        var rows = lines
            .OrderByDescending(line => line.At)
            .Select(line => line.Row)
            .ToList();

        var file = exportService.CreateCsv(
            $"ydot-donor-history-{donor.DonorNumber}",
            ["Section", "Date (UTC)", "Reference", "Detail", "Amount", "Currency", "Status", "By"],
            rows);

        await auditWriter.WriteAsync(
            new AuditEntry(AuditActionCodes.DonorHistoryExported, nameof(Donor), donor.Id, AuditResult.Succeeded,
                $"History of {donor.DonorNumber} exported: {rows.Count} row(s). Reference {file.Reference}."),
            cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Donor history export completed for DonorId {DonorId} with {RowCount} row(s).", donor.Id, rows.Count);

        return Result.Success(file);
    }
}
