using Microsoft.EntityFrameworkCore;
using YDots.DON.Application.Common.Abstractions.Persistence;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Infrastructure.Persistence.Repositories;

/// <summary>EF Core implementation of the Donor write side.</summary>
public sealed class DonorRepository(DonDbContext context) : IDonorRepository
{
    public Task<Donor?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        context.Donors.FirstOrDefaultAsync(donor => donor.Id == id, cancellationToken);

    public async Task AddAsync(Donor aggregate, CancellationToken cancellationToken)
    {
        await context.Donors.AddAsync(aggregate, cancellationToken);
    }

    public Task<bool> ExistsByBusinessKeyAsync(string normalizedKey, Guid? excludingId, CancellationToken cancellationToken) =>
        context.Donors.AnyAsync(
            donor => donor.NormalizedBusinessKey == normalizedKey
                     && donor.Status != DonorStatus.Merged
                     && (excludingId == null || donor.Id != excludingId),
            cancellationToken);

    public Task<Donor?> GetWithChildrenAsync(Guid id, CancellationToken cancellationToken = default) =>
        context.Donors
            .Include(donor => donor.Contacts)
            .Include(donor => donor.Tags)
            .Include(donor => donor.Consents)
            .Include(donor => donor.Interactions)
            .FirstOrDefaultAsync(donor => donor.Id == id, cancellationToken);

    public Task<bool> DonorNumberExistsAsync(string donorNumber, CancellationToken cancellationToken = default) =>
        context.Donors.AnyAsync(donor => donor.DonorNumber == donorNumber, cancellationToken);

    public async Task<int> GetMaxNumberSequenceAsync(int year, CancellationToken cancellationToken = default)
    {
        // The reference is DON-2026-000184, so the running number is the last six characters.
        // Only this year's rows are scanned, which keeps the scan small as the table grows.
        var prefix = $"DON-{year:0000}-";

        var numbers = await context.Donors
            .Where(donor => donor.DonorNumber.StartsWith(prefix))
            .Select(donor => donor.DonorNumber)
            .ToListAsync(cancellationToken);

        return numbers.Count == 0
            ? 0
            : numbers
                .Select(number => int.TryParse(number[prefix.Length..], out var parsed) ? parsed : 0)
                .DefaultIfEmpty(0)
                .Max();
    }

    public async Task<IReadOnlyList<Donor>> FindDuplicateCandidatesAsync(
        Guid organisationId,
        string? email,
        string? phone,
        string? displayName,
        Guid? excludingId,
        CancellationToken cancellationToken = default)
    {
        var normalisedEmail = email?.Trim().ToLowerInvariant();
        var normalisedPhone = phone?.Trim();
        var normalisedName = displayName?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(normalisedEmail)
            && string.IsNullOrWhiteSpace(normalisedPhone)
            && string.IsNullOrWhiteSpace(normalisedName))
        {
            return [];
        }

        var query = context.Donors
            .Where(donor => donor.OrganisationId == organisationId
                            && donor.Status != DonorStatus.Merged
                            && (excludingId == null || donor.Id != excludingId));

        query = query.Where(donor =>
            (normalisedEmail != null && donor.PrimaryEmail != null && donor.PrimaryEmail.ToLower() == normalisedEmail)
            || (normalisedPhone != null && donor.PrimaryPhone == normalisedPhone)
            || (normalisedName != null
                && ((donor.FirstName + " " + donor.LastName).Trim().ToLower() == normalisedName
                    || (donor.OrganisationName != null && donor.OrganisationName.ToLower() == normalisedName))));

        return await query.Take(20).ToListAsync(cancellationToken);
    }

    public void Remove(Donor donor) => context.Donors.Remove(donor);

    public void AddContact(DonorContact contact) => context.DonorContacts.Add(contact);

    public void RemoveContact(DonorContact contact) => context.DonorContacts.Remove(contact);

    public void AddTag(DonorTag tag) => context.DonorTags.Add(tag);

    public void RemoveTag(DonorTag tag) => context.DonorTags.Remove(tag);

    public void AddInteraction(DonorInteraction interaction) => context.DonorInteractions.Add(interaction);

    public async Task<(IReadOnlyList<Donor> Items, int TotalCount)> SearchForAssignmentAsync(
        string? search,
        bool? hasOwner,
        Guid? ownerUserId,
        int skip,
        int take,
        Guid organisationId,
        CancellationToken cancellationToken = default)
    {
        var donors = context.Donors.Where(donor =>
            donor.OrganisationId == organisationId
            && donor.Status != DonorStatus.Archived
            && donor.Status != DonorStatus.Merged);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();

            donors = donors.Where(donor =>
                donor.DonorNumber.ToLower().Contains(term)
                || (donor.FirstName != null && donor.FirstName.ToLower().Contains(term))
                || (donor.LastName != null && donor.LastName.ToLower().Contains(term))
                || (donor.OrganisationName != null && donor.OrganisationName.ToLower().Contains(term)));
        }

        if (hasOwner is not null)
        {
            donors = hasOwner.Value
                ? donors.Where(donor => donor.RelationshipOwnerUserId != null)
                : donors.Where(donor => donor.RelationshipOwnerUserId == null);
        }

        if (ownerUserId is not null)
        {
            donors = donors.Where(donor => donor.RelationshipOwnerUserId == ownerUserId);
        }

        var total = await donors.CountAsync(cancellationToken);

        // Unowned first - those are the donors waiting for somebody - then the newest.
        var items = await donors
            .OrderBy(donor => donor.RelationshipOwnerUserId != null)
            .ThenByDescending(donor => donor.CreatedAtUtc)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);

        return (items, total);
    }

    public async Task<IReadOnlyList<Donor>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default) =>
        await context.Donors.Where(donor => ids.Contains(donor.Id)).ToListAsync(cancellationToken);

    public async Task<(int Unassigned, int Assigned)> GetAssignmentCountsAsync(
        Guid organisationId,
        CancellationToken cancellationToken = default)
    {
        var counts = await context.Donors
            .Where(donor => donor.OrganisationId == organisationId
                            && donor.Status != DonorStatus.Archived
                            && donor.Status != DonorStatus.Merged)
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Unassigned = group.Count(donor => donor.RelationshipOwnerUserId == null),
                Assigned = group.Count(donor => donor.RelationshipOwnerUserId != null)
            })
            .FirstOrDefaultAsync(cancellationToken);

        return counts is null ? (0, 0) : (counts.Unassigned, counts.Assigned);
    }

    public async Task<IReadOnlyDictionary<Guid, int>> GetOwnedDonorCountsAsync(
        Guid organisationId,
        CancellationToken cancellationToken = default) =>
        (await context.Donors
            .Where(donor => donor.OrganisationId == organisationId
                            && donor.RelationshipOwnerUserId != null
                            && donor.Status != DonorStatus.Archived
                            && donor.Status != DonorStatus.Merged)
            .GroupBy(donor => donor.RelationshipOwnerUserId!.Value)
            .Select(group => new { OwnerUserId = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken))
        .ToDictionary(entry => entry.OwnerUserId, entry => entry.Count);

    public void AddOwnerChange(DonorOwnerChange change) => context.DonorOwnerChanges.Add(change);

    public Task<int> CountOwnedAsync(Guid organisationId, Guid userId, CancellationToken cancellationToken = default) =>
        context.Donors.CountAsync(
            donor => donor.OrganisationId == organisationId
                     && donor.RelationshipOwnerUserId == userId
                     && donor.Status != DonorStatus.Merged,
            cancellationToken);

    public async Task<IReadOnlyList<DonorOwnerChange>> GetOwnerChangesAsync(
        Guid donorId,
        CancellationToken cancellationToken = default) =>
        await context.DonorOwnerChanges
            .Where(change => change.DonorId == donorId)
            .OrderByDescending(change => change.EffectiveAtUtc)
            .ToListAsync(cancellationToken);

    public Task<DonorInteraction?> GetInteractionAsync(Guid id, CancellationToken cancellationToken = default) =>
        context.DonorInteractions.FirstOrDefaultAsync(interaction => interaction.Id == id, cancellationToken);

    public async Task<IReadOnlyList<DonorContact>> GetContactsAsync(Guid donorId, CancellationToken cancellationToken = default) =>
        await context.DonorContacts
            .Where(contact => contact.DonorId == donorId)
            .OrderByDescending(contact => contact.IsPrimary)
            .ThenBy(contact => contact.Name)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<DonorTag>> GetTagsAsync(Guid donorId, CancellationToken cancellationToken = default) =>
        await context.DonorTags
            .Where(tag => tag.DonorId == donorId)
            .OrderBy(tag => tag.Code)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<DonorInteraction>> GetInteractionsAsync(
        Guid donorId,
        int maximumRows,
        CancellationToken cancellationToken = default) =>
        await context.DonorInteractions
            .Where(interaction => interaction.DonorId == donorId)
            .OrderByDescending(interaction => interaction.OccurredAtUtc)
            .Take(maximumRows)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<DonorAuditEvent>> GetActivityHistoryAsync(
        Guid donorId,
        int maximumRows,
        CancellationToken cancellationToken = default) =>
        await context.AuditEvents
            .Where(entry => entry.TargetId == donorId)
            .OrderByDescending(entry => entry.CreatedAtUtc)
            .Take(maximumRows)
            .ToListAsync(cancellationToken);
}
