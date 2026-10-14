namespace YDot.PAY.Application.Common.Abstractions.Services;

/// <summary>
/// The organisation-scoped donor lookup, and the donor and account creation that follows a
/// successful payment.
///
/// SECTION 26 IS THE WHOLE REASON THIS INTERFACE EXISTS. The existing-donor check is
/// "OrganisationId AND NormalisedEmail", never e-mail alone: the same person may give to two
/// charities on this platform and be a known donor to one and a stranger to the other.
///
/// WHY IT IS AN ABSTRACTION RATHER THAN A DIRECT QUERY. Donors live in DON and user accounts
/// live in IAM; PAY owns neither. It reads the donor table it shares a database with and calls
/// IAM for the account, and keeping both behind one interface means the handlers express the
/// BUSINESS steps of section 15 - find donor, create donor, create account, send invite - rather
/// than the mechanics of where each record lives.
/// </summary>
public interface IDonorDirectory
{
    /// <summary>
    /// Section 26: is this e-mail already a donor for THIS Organisation?
    ///
    /// Returns null when no donor matches, which is section 14's "continue without signing in"
    /// branch. A match is section 13's "sign in first" branch.
    /// </summary>
    /// <summary>
    /// What USER ACCOUNT this e-mail has in this Organisation, if any.
    ///
    /// A DIFFERENT QUESTION FROM <see cref="FindByEmailAsync"/>, and the difference is the point.
    /// That one asks whether the address belongs to a DONOR RECORD; this asks whether it can sign
    /// in. The two come apart for everybody who works at the charity: a fundraiser, an approver or
    /// an administrator has a login and is not a donor, so the donor lookup answers "no" for them
    /// and the public form let them start a fresh anonymous donation under an address that already
    /// has an account behind it.
    ///
    /// WHAT IT IS FOR, TWICE OVER. Before payment, Section 3 of the flow document: "If the email
    /// matches an existing Donor the person is redirected to Login. After logging in, the donor is
    /// taken to the Payment page" - which has to fire for anybody who CAN sign in, and only for
    /// them: an invited account that was never activated has no password, so sending its owner to
    /// a sign-in form is a dead end. After payment, it decides between creating the login and
    /// inviting (none), sending the invitation again (invited) and leaving the account alone.
    ///
    /// IT IS NOT AN ORACLE. The answer never leaves the server as a bare yes for an address the
    /// caller chose at random: it is attached to an intent they have just created and reaches
    /// them only as "sign in to continue this donation", which is the same thing they would learn
    /// by trying to sign in.
    /// </summary>
    Task<DonorLogin> GetLoginAsync(
        Guid tenantId, string normalisedEmail, CancellationToken cancellationToken);

    Task<DonorMatch?> FindByEmailAsync(
        Guid tenantId, string normalisedEmail, CancellationToken cancellationToken);

    /// <summary>
    /// Section 15: creates the donor record from the intent after a successful payment.
    ///
    /// THE INTENT IS THE AUTHORITATIVE SOURCE for the donor's details, which the brief states
    /// explicitly - the donor typed them at the moment they gave, and nothing later is closer to
    /// the truth of who made that gift.
    /// </summary>
    Task<DonorMatch> CreateDonorAsync(
        CreateDonorFromIntentRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Section 17: creates the donor's user account and sends the activation invitation.
    ///
    /// NO PASSWORD IS SET HERE. The account is created in an invited state and the donor chooses
    /// their own password through the activation link - the brief is explicit that the system
    /// should not need to know a password at this point.
    /// </summary>
    Task<DonorAccountResult> CreateAccountAndInviteAsync(
        CreateDonorAccountRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Sends the activation invitation again to an account that was invited and never activated.
    ///
    /// A SECOND GIFT BEFORE ACTIVATION IS THE CASE. The first gift created the login and invited
    /// the donor; creating it again is refused as a duplicate address, so without this the second
    /// gift ended with no invitation at all and the donor - who may simply have lost the first
    /// e-mail - had no way in. Like account creation, a failure is reported, never thrown.
    /// </summary>
    Task<DonorAccountResult> ResendInvitationAsync(
        CreateDonorAccountRequest request, Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// Section 16 and 28: marks the originating lead converted and links it to the donor.
    ///
    /// The conversion point is a successful payment, NOT the lead owner marking it qualified -
    /// which is the rule the brief states twice.
    /// </summary>
    Task MarkLeadConvertedAsync(
        Guid tenantId, Guid leadId, Guid donorId, CancellationToken cancellationToken);

    /// <summary>
    /// Converts this Organisation's OPEN leads that carry the donor's e-mail, and returns their ids.
    ///
    /// FOR A GIFT THAT DID NOT COME THROUGH THE LEAD'S OWN LINK. A lead who opens the public form
    /// or scans a code carries no lead id, so the gift made a donor and left the lead in the work
    /// queue as though nothing had happened - the same person listed as a lead and as a donor. The
    /// e-mail is the only thing that ties the two together on that path.
    ///
    /// OPEN MEANS STILL BEING WORKED: not a draft, and not already converted, closed or
    /// suppressed. A lead somebody closed or suppressed is a decision this does not overturn.
    /// </summary>
    Task<IReadOnlyList<Guid>> ConvertOpenLeadsByEmailAsync(
        Guid tenantId, string normalisedEmail, Guid donorId, CancellationToken cancellationToken);
}

/// <summary>Whether an e-mail has a login in one Organisation, and in what state.</summary>
public enum DonorLoginState
{
    /// <summary>No account. A successful gift creates one and invites the donor.</summary>
    None = 0,

    /// <summary>Created and invited, never activated - it has no password yet.</summary>
    Invited = 1,

    /// <summary>Activated. The owner can sign in, so the public form sends them to sign in.</summary>
    Active = 2,

    /// <summary>Suspended, deactivated, expired or withdrawn - nothing to sign in to or invite.</summary>
    Unavailable = 3
}

/// <summary>The login an e-mail has in one Organisation. <c>UserId</c> is null for None.</summary>
public sealed record DonorLogin(Guid? UserId, DonorLoginState State)
{
    public static readonly DonorLogin NoAccount = new(null, DonorLoginState.None);

    /// <summary>True only for an account its owner can sign in to now.</summary>
    public bool CanSignIn => State == DonorLoginState.Active;
}

/// <summary>A donor found or created for one Organisation.</summary>
public sealed record DonorMatch(
    Guid DonorId,
    string DisplayName,
    string Email,
    /// <summary>The donor's IAM user account, where one exists. Null before activation.</summary>
    Guid? UserId,
    bool HasActiveAccount);

/// <summary>Everything needed to create a donor from an intent. Section 15.</summary>
public sealed record CreateDonorFromIntentRequest(
    Guid TenantId,
    Guid BusinessUnitId,
    string Name,
    string Email,
    string NormalisedEmail,
    string? Mobile,
    string? TaxIdentifier,
    string? AddressLine1,
    string? AddressLine2,
    Guid? CountryId,
    Guid? StateId,
    Guid? CityId,
    string? PostalCode,
    Guid? OriginatingLeadId);

/// <summary>Everything needed to create the donor's account and invite them. Section 17.</summary>
public sealed record CreateDonorAccountRequest(
    Guid TenantId,
    Guid DonorId,
    string Name,
    string Email,
    string? Mobile,
    /// <summary>Named on the invitation so the donor recognises what they are activating.</summary>
    string DonationReference);

/// <summary>The result of creating an account, including whether the invitation went out.</summary>
public sealed record DonorAccountResult(
    Guid? UserId,
    bool AccountCreated,
    bool InvitationSent,
    /// <summary>
    /// Why it did not happen, when it did not.
    ///
    /// A FAILURE HERE MUST NOT FAIL THE DONATION. The money is already taken; an invitation that
    /// could not be sent is a follow-up task, not a reason to reject a gift that succeeded.
    /// </summary>
    string? FailureReason);
