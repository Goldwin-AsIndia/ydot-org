namespace YDots.DON.Application.Common.Abstractions.Services;

/// <summary>
/// The Organisation's people, as the Donors module needs them.
///
/// DON has no user table - IAM owns those - so this is read-only, and it answers two questions:
/// who may be given work in this module, and what to call the person behind a user id recorded
/// on an audit row.
/// </summary>
public interface IPeopleDirectory
{
    /// <summary>
    /// Who may own a lead or a donor, or be given a follow-up.
    ///
    /// Active staff accounts whose role lets them work leads or follow-ups. A donor-portal account
    /// is never offered: handing a lead to a member of the public is not an assignment anybody
    /// meant to make, and their sign-in could never open the screen to act on it.
    /// </summary>
    Task<IReadOnlyList<(Guid UserId, string Name)>> GetAssignableAsync(
        Guid organisationId,
        CancellationToken cancellationToken);

    /// <summary>Display names for the ids given. Unknown ids are simply absent.</summary>
    Task<IReadOnlyDictionary<Guid, string>> GetNamesAsync(
        Guid organisationId,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken);
}
