namespace YDots.CAM.Application.Common.Models;

/// <summary>
/// The narrowing a read service applies WITHIN one Organisation.
///
/// IT IS NOT THE ORGANISATION BOUNDARY, and confusing the two would be a serious mistake. The
/// boundary is enforced underneath by the DbContext query filter and cannot be widened from
/// here; this decides how much of the caller own Organisation they see - their own campaigns,
/// their team, or all of it.
/// </summary>
public sealed record AccessScope(Guid TenantId, Guid UserId, IReadOnlyList<string> DataScopes)
{
    /// <summary>The scope of a request with no authenticated user. Sees nothing.</summary>
    public static readonly AccessScope Empty = new(Guid.Empty, Guid.Empty, []);

    /// <summary>
    /// True when the caller is limited to records they own.
    ///
    /// Driven by a data_scope claim rather than by a role, so an Organisation can grant the
    /// same role a different reach without a new role.
    ///
    /// READ IN THE FORMAT IAM ISSUES: one claim per scope, "{ScopeType}:{ScopeValue}" - a user
    /// created with "What they are assigned" carries "Assignment:{their id}". This used to test
    /// for the literal "own", which IAM has never issued, so that user still saw every campaign
    /// here while DON narrowed them correctly. The rule is now DON's: no scope, or an
    /// Organisation scope, is the whole Organisation; anything else narrows to the caller's own
    /// records, failing closed for a scope type this service has no finer filter for.
    /// </summary>
    public bool IsOwnRecordsOnly =>
        DataScopes.Count > 0 && !DataScopes.Any(IsOrganisationScope);

    private static bool IsOrganisationScope(string claim) =>
        claim.Split(':', 2)[0].Trim().Equals("Organisation", StringComparison.OrdinalIgnoreCase);
}
