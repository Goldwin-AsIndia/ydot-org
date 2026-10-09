using YDots.DON.Application.Features.LeadWorkQueue.DTOs;
using YDots.DON.Application.Common.Models;
using YDots.DON.Application.DTOs;
using YDots.DON.Domain.Entities;

namespace YDots.DON.Application.Common.Abstractions.Persistence;

/// <summary>Leads behind SCR-DON-001, SCR-DON-002 and SCR-DON-006.</summary>
public interface ILeadRepository
{
    Task<PagedResponse<Lead>> SearchAsync(LeadSearchFilter filter, AccessScope scope, CancellationToken cancellationToken = default);

    Task<Lead?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>
    /// The lead a donor was converted from, if any.
    ///
    /// THE REVERSE OF <c>Lead.ConvertedDonorId</c>. The Communication Timeline needs it so that
    /// arriving with a donor id still shows the conversations recorded before the conversion -
    /// which is the history the workflow document says a converted donor retains.
    /// </summary>
    Task<Lead?> GetConvertedFromAsync(Guid donorId, CancellationToken cancellationToken = default);

    Task<Lead?> GetWithAssignmentsAsync(Guid id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<Lead>> GetByIdsAsync(IReadOnlyCollection<Guid> ids, CancellationToken cancellationToken = default);

    Task<int> GetMaxReferenceSequenceAsync(int year, CancellationToken cancellationToken = default);

    /// <summary>Safe duplicate candidates for the lead capture screen: same e-mail, phone or name.</summary>
    Task<IReadOnlyList<Lead>> FindDuplicateCandidatesAsync(
        Guid organisationId,
        string? email,
        string? mobileNumber,
        string? firstName,
        string? lastName,
        Guid? excludingId,
        CancellationToken cancellationToken = default);

    /// <summary>Open work per owner, used to build the workload band on the assignment board.</summary>
    Task<IReadOnlyDictionary<Guid, int>> GetOpenWorkCountsByOwnerAsync(Guid organisationId, CancellationToken cancellationToken = default);

    /// <summary>Owners who already appear on a lead, so the board can offer them without calling IAM.</summary>
    Task<IReadOnlyList<(Guid UserId, string Name, string? TeamCode)>> GetKnownOwnersAsync(Guid organisationId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Everybody who has owned a lead here, including people who no longer can - for the queue
    /// Owner FILTER, where a lead left with a former colleague must still be findable. Assignment
    /// pickers use <see cref="GetKnownOwnersAsync"/>, which offers only people who can take work.
    /// </summary>
    Task<IReadOnlyList<(Guid UserId, string Name, string? TeamCode)>> GetOwnerFilterOptionsAsync(Guid organisationId, CancellationToken cancellationToken = default);

    Task<IReadOnlyDictionary<string, int>> GetStatusCountsAsync(Guid organisationId, AccessScope scope, Guid? ownerUserId = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// The six summary cards on the lead work queue, counted across the caller's whole scope.
    ///
    /// ONE ROUND TRIP, NOT SIX. Every card is a count over the same filtered set, so they are
    /// aggregated in a single query rather than by asking the database the same question six
    /// times with a different WHERE clause.
    /// </summary>
    Task<LeadQueueSummaryResponse> GetQueueSummaryAsync(
        Guid organisationId,
        AccessScope scope,
        Guid? ownerUserId,
        DateTimeOffset now,
        DateTimeOffset todayStartUtc,
        DateTimeOffset todayEndUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The Assignment Board's strip: leads in the queue with no owner, with one, and with a next
    /// contact falling inside the window given (the SLA's "due soon").
    /// </summary>
    Task<(int Unassigned, int Assigned, int DueSoon)> GetAssignmentCountsAsync(
        Guid organisationId,
        AccessScope scope,
        DateTimeOffset dueFromUtc,
        DateTimeOffset dueBeforeUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Leads the user owns that are still in the queue (not drafts, not converted).</summary>
    Task<int> CountOwnedAsync(Guid organisationId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Every lead source in scope, for the Lead source filter.</summary>
    Task<IReadOnlyList<string>> GetSourcesAsync(Guid organisationId, AccessScope scope, CancellationToken cancellationToken = default);

    /// <summary>The leads a filter matches, unpaged, up to a ceiling - for the CSV export.</summary>
    Task<IReadOnlyList<Lead>> ExportAsync(LeadSearchFilter filter, AccessScope scope, int maximumRows, CancellationToken cancellationToken = default);

    void Add(Lead lead);

    void Remove(Lead lead);

    void AddAssignment(LeadAssignment assignment);

    Task<IReadOnlyList<LeadAssignment>> GetAssignmentHistoryAsync(Guid leadId, CancellationToken cancellationToken = default);
}
