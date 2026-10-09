using YDots.DON.Application.Common.Models;
using YDots.DON.Application.DTOs;
using YDots.DON.Domain.Entities;

namespace YDots.DON.Application.Common.Abstractions.Persistence;

/// <summary>Follow-up tasks behind DON-UI-08 and the Follow-ups panel on Donor 360.</summary>
public interface IFollowUpRepository
{
    Task<PagedResponse<FollowUpTask>> SearchAsync(
        FollowUpSearchFilter filter,
        AccessScope scope,
        CancellationToken cancellationToken = default);

    Task<FollowUpTask?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<FollowUpTask>> GetOpenForDonorAsync(Guid donorId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<FollowUpTask>> GetOpenForLeadAsync(Guid leadId, CancellationToken cancellationToken = default);

    Task<int> GetMaxReferenceSequenceAsync(int year, CancellationToken cancellationToken = default);

    /// <summary>A donor's follow-ups in every state, open ones first, newest first after that.</summary>
    Task<IReadOnlyList<FollowUpTask>> GetForDonorAsync(Guid donorId, int maximumRows, CancellationToken cancellationToken = default);

    /// <summary>
    /// Whether the user has an open follow-up on this lead or donor. A follow-up assignee who does
    /// not own the record still has to see who they are about to contact, and what was said
    /// before - the role flow assigns follow-ups on unassigned leads to people who do not own them.
    /// </summary>
    Task<bool> HasOpenAssignedAsync(Guid userId, Guid? leadId, Guid? donorId, CancellationToken cancellationToken = default);

    /// <summary>
    /// How many donors' NEXT open follow-up falls inside the window - the board's "due today" for
    /// its Donors view. A donor with an earlier, overdue follow-up is not counted: their next one
    /// is the overdue one.
    /// </summary>
    Task<int> CountDonorsDueAsync(
        Guid organisationId,
        DateTimeOffset dueFromUtc,
        DateTimeOffset dueBeforeUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Open follow-ups assigned to the user.</summary>
    Task<int> CountAssignedOpenAsync(Guid organisationId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Each donor's next open follow-up, for a page of donors at once.</summary>
    Task<IReadOnlyDictionary<Guid, FollowUpTask>> GetNextOpenForDonorsAsync(
        IReadOnlyCollection<Guid> donorIds,
        CancellationToken cancellationToken = default);

    /// <summary>How many follow-ups a lead or donor has, and how many of them were completed.</summary>
    Task<(int Total, int Completed)> GetCountsAsync(Guid? leadId, Guid? donorId, CancellationToken cancellationToken = default);

    /// <summary>The audit rows written against these follow-ups, newest first. Feeds View History.</summary>
    Task<IReadOnlyList<DonorAuditEvent>> GetHistoryAsync(IReadOnlyCollection<Guid> followUpIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// The Follow-up Queue's headline figures over the caller's whole scope - see
    /// FollowUpQueueSummaryResponse. <paramref name="todayStartUtc"/> and
    /// <paramref name="todayEndUtc"/> bound the organisation's calendar day.
    /// </summary>
    Task<FollowUpCounts> GetSummaryAsync(
        AccessScope scope,
        Guid? leadId,
        Guid? donorId,
        DateTimeOffset now,
        DateTimeOffset todayStartUtc,
        DateTimeOffset todayEndUtc,
        CancellationToken cancellationToken = default);

    void Add(FollowUpTask task);
}

/// <summary>The Follow-up Queue's headline counts. See IFollowUpRepository.GetSummaryAsync.</summary>
public sealed record FollowUpCounts(
    int Total,
    int Open,
    int DueToday,
    int Upcoming,
    int Overdue,
    int CompletedToday,
    int Escalated,
    int AssignedToMe,
    int Completed,
    int Cancelled);
