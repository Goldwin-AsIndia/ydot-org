namespace YDot.IAM.Application.Common.Constants;

/// <summary>
/// The honorifics the user forms offer for <c>User.Title</c>.
///
/// A LIST AND NOT AN ENUM, for the same reason as <see cref="OrganisationTypes"/>: the column is
/// free text (20 characters, the person-name rule) and already holds these exact words.
///
/// SERVED FROM HERE so the create form and the edit dialogs offer the same choices. The list was
/// a literal array in the create form and a free-text box everywhere else, so "Dr" and "Dr." went
/// into the same column. Every entry passes the person-name rule the validator applies.
/// </summary>
public static class PersonTitles
{
    public static readonly IReadOnlyList<string> All = ["Mr", "Ms", "Mrs", "Mx", "Dr", "Prof"];
}
