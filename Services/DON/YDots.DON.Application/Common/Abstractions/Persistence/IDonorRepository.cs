using YDots.DON.Domain.Entities;

namespace YDots.DON.Application.Common.Abstractions.Persistence;

/// <summary>
/// Write side of the Donor aggregate. The first three methods are the section 6 contract, word
/// for word; the rest is what the lifecycle commands and the Donor 360 screen need.
/// </summary>
public interface IDonorRepository
{
    // ---- Section 6 contract ------------------------------------------------------------------

    /// <summary>Load the tracked aggregate by identifier.</summary>
    Task<Donor?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Stage a new aggregate.</summary>
    Task AddAsync(Donor aggregate, CancellationToken cancellationToken);

    /// <summary>Duplicate and uniqueness check on the normalised natural key.</summary>
    Task<bool> ExistsByBusinessKeyAsync(string normalizedKey, Guid? excludingId, CancellationToken cancellationToken);

    // ---- Supporting operations -----------------------------------------------------------------

    /// <summary>Load the aggregate together with its contacts, consents, interactions and tags.</summary>
    Task<Donor?> GetWithChildrenAsync(Guid id, CancellationToken cancellationToken = default);

    Task<bool> DonorNumberExistsAsync(string donorNumber, CancellationToken cancellationToken = default);

    /// <summary>Highest sequence used for a year, so the next donor number continues the run.</summary>
    Task<int> GetMaxNumberSequenceAsync(int year, CancellationToken cancellationToken = default);

    /// <summary>Candidate matches on e-mail, phone or name. Used by the duplicate check.</summary>
    Task<IReadOnlyList<Donor>> FindDuplicateCandidatesAsync(
        Guid organisationId,
        string? email,
        string? phone,
        string? displayName,
        Guid? excludingId,
        CancellationToken cancellationToken = default);

    void Remove(Donor donor);

    void AddContact(DonorContact contact);

    void RemoveContact(DonorContact contact);

    void AddTag(DonorTag tag);

    void RemoveTag(DonorTag tag);

    void AddInteraction(DonorInteraction interaction);

    /// <summary>
    /// The donors the Assignment Board routes: in the caller's scope, filtered by whether they
    /// have an owner and by whose they are. Archived and merged donors are not routed.
    /// </summary>
    Task<(IReadOnlyList<Donor> Items, int TotalCount)> SearchForAssignmentAsync(
        string? search,
        bool? hasOwner,
        Guid? ownerUserId,
        int skip,
        int take,
        Guid organisationId,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Donor>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default);

    /// <summary>The board's strip for donors: how many it routes have no owner, and how many have one.</summary>
    Task<(int Unassigned, int Assigned)> GetAssignmentCountsAsync(Guid organisationId, CancellationToken cancellationToken = default);

    /// <summary>How many active donor relationships each person owns - the board's donor workload.</summary>
    Task<IReadOnlyDictionary<Guid, int>> GetOwnedDonorCountsAsync(Guid organisationId, CancellationToken cancellationToken = default);

    void AddOwnerChange(DonorOwnerChange change);

    /// <summary>Donors whose relationship the user owns, merged ones aside.</summary>
    Task<int> CountOwnedAsync(Guid organisationId, Guid userId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DonorOwnerChange>> GetOwnerChangesAsync(Guid donorId, CancellationToken cancellationToken = default);

    /// <summary>One logged interaction, tracked, for the timeline's edit and flag actions.</summary>
    Task<DonorInteraction?> GetInteractionAsync(Guid id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DonorContact>> GetContactsAsync(Guid donorId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DonorTag>> GetTagsAsync(Guid donorId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DonorInteraction>> GetInteractionsAsync(Guid donorId, int maximumRows, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DonorAuditEvent>> GetActivityHistoryAsync(Guid donorId, int maximumRows, CancellationToken cancellationToken = default);
}
