using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Abstractions.Services;
using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.Common.Settings;
using YDot.IAM.Application.Features.Users.DTOs;
using YDot.IAM.Application.Features.Users.Mappings;
using YDot.IAM.Domain.Entities;
using YDot.IAM.Domain.Enums;
using YDot.IAM.Domain.ValueObjects;

namespace YDot.IAM.Application.Features.Users.Commands.CreateUser;

/// <summary>IAM-USR-01. Creates a user in the caller Organisation and invites them.</summary>
public sealed record CreateUserCommand(CreateUserRequest Request);

/// <summary>Live availability check for the create form.</summary>
public sealed record CheckUserIdentityQuery(CheckUserIdentityRequest Request);

/// <summary>Re-sends an outstanding invitation with a fresh token.</summary>
public sealed record ResendUserInvitationCommand(Guid UserId, string? Message);

/// <summary>Withdraws an outstanding invitation.</summary>
public sealed record RevokeUserInvitationCommand(Guid UserId, string Reason);

/// <summary>
/// User creation.
///
/// THE UNIQUENESS RULE IS THE INTERESTING PART. E-mail and username are checked against THIS
/// Organisation only. The same address existing in another Organisation is not a conflict —
/// it is the documented behaviour from section 6 of the brief, and two such users are
/// genuinely separate people with separate passwords and separate roles.
///
/// A NEW USER HAS NO PASSWORD. The account is created with a null hash and status Invited, so
/// it genuinely cannot be signed into rather than relying on a status check that somebody
/// might one day forget. The invitation is what turns it into a usable account.
/// </summary>
public sealed class CreateUserCommandHandler(
    IUserRepository users,
    IRoleRepository roles,
    ITenantRepository tenants,
    IBusinessUnitRepository businessUnits,
    IInvitationRepository invitations,
    IGovernanceRepository governance,
    IPasswordHasher passwordHasher,
    ITokenHasher tokenHasher,
    INotificationService notifications,
    IAuditService audit,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IUnitOfWork unitOfWork,
    IOptions<SecuritySettings> securityOptions,
    IOptions<EmailSettings> emailOptions,
    IOptions<ClientAppSettings> clientOptions,
    ILogger<CreateUserCommandHandler> logger)
{
    /// <summary>
    /// Whether an e-mail address or username is free INSIDE THIS ORGANISATION.
    ///
    /// The scoping is the whole point. john@example.com may exist in three Organisations at
    /// once, and none of those is a clash; what must never happen is two of them inside one.
    /// The repository lookups below are Organisation-scoped by the query filter, so the answer
    /// is about the caller's Organisation and no other.
    ///
    /// IT NEVER SAYS WHO HOLDS A TAKEN VALUE. That would turn the create form into a directory
    /// lookup for anybody who can reach it.
    /// </summary>
    public async Task<Result<CheckUserIdentityResponse>> HandleAsync(
        CheckUserIdentityQuery query, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);

        logger.LogInformation("Checking user identity availability.");

        var request = query.Request;
        var email = request.Email?.Trim();
        var username = request.Username?.Trim();

        if (string.IsNullOrWhiteSpace(email) && string.IsNullOrWhiteSpace(username))
        {
            logger.LogInformation("User identity availability check completed with no identity values supplied.");
            return Result.Success(new CheckUserIdentityResponse(
                IsAvailable: true, EmailAvailable: true, UsernameAvailable: true,
                Message: "Enter an e-mail address or a username to check.",
                Suggestions: []));
        }

        var emailAvailable = true;
        var usernameAvailable = true;

        if (!string.IsNullOrWhiteSpace(email))
        {
            var parsed = EmailValue.TryParse(email);

            if (parsed is null)
            {
                logger.LogWarning("User identity availability check rejected an invalid email value.");
                return Result.Success(new CheckUserIdentityResponse(
                    IsAvailable: false, EmailAvailable: false, UsernameAvailable: true,
                    Message: "That is not a valid e-mail address.",
                    Suggestions: []));
            }

            emailAvailable = !await users.EmailExistsAsync(
                parsed.Value.ToUpperInvariant(), tenantContext.TenantId, request.ExcludeUserId, cancellationToken);
        }

        if (!string.IsNullOrWhiteSpace(username))
        {
            var parsed = UsernameValue.TryParse(username);

            if (parsed is null)
            {
                logger.LogWarning("User identity availability check rejected an invalid username value.");
                return Result.Success(new CheckUserIdentityResponse(
                    IsAvailable: false, EmailAvailable: emailAvailable, UsernameAvailable: false,
                    Message: "A username may use letters, digits, dots, hyphens and underscores.",
                    Suggestions: []));
            }

            usernameAvailable = !await users.UsernameExistsAsync(
                parsed.Value.ToUpperInvariant(), tenantContext.TenantId, request.ExcludeUserId, cancellationToken);
        }

        // Suggestions only for a taken USERNAME. Suggesting variations of somebody's e-mail
        // address would be both useless and slightly alarming.
        var suggestions = usernameAvailable || string.IsNullOrWhiteSpace(username)
            ? []
            : await BuildUsernameSuggestionsAsync(username, cancellationToken);

        var available = emailAvailable && usernameAvailable;

        logger.LogInformation("User identity availability check completed. EmailAvailable {EmailAvailable}, UsernameAvailable {UsernameAvailable}.", emailAvailable, usernameAvailable);

        return Result.Success(new CheckUserIdentityResponse(
            available,
            emailAvailable,
            usernameAvailable,
            available
                ? "That is available."
                : !emailAvailable && !usernameAvailable
                    ? "Both the e-mail address and the username are already in use in this organisation."
                    : !emailAvailable
                        ? "Somebody in this organisation already uses that e-mail address."
                        : "That username is already in use in this organisation.",
            suggestions));
    }

    /// <summary>
    /// Up to three free variations on a taken username.
    ///
    /// Each candidate is checked rather than merely generated, so the form never offers one that
    /// is itself taken - which is a worse experience than offering nothing at all.
    /// </summary>
    private async Task<IReadOnlyList<string>> BuildUsernameSuggestionsAsync(
        string username, CancellationToken cancellationToken)
    {
        var stem = username.Trim().ToLowerInvariant();
        var found = new List<string>(3);

        for (var suffix = 1; suffix <= 20 && found.Count < 3; suffix++)
        {
            var candidate = $"{stem}{suffix}";
            var parsed = UsernameValue.TryParse(candidate);

            if (parsed is null)
            {
                continue;
            }

            var taken = await users.UsernameExistsAsync(
                parsed.Value.ToUpperInvariant(), tenantContext.TenantId, null, cancellationToken);

            if (!taken)
            {
                found.Add(candidate);
            }
        }

        return found;
    }

    private readonly SecuritySettings _security = securityOptions.Value;
    private readonly EmailSettings _email = emailOptions.Value;
    private readonly ClientAppSettings _client = clientOptions.Value;

    public async Task<Result<CreateUserResponse>> HandleAsync(
        CreateUserCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Creating user.");

        var request = command.Request;
        var now = clock.UtcNow;

        // The Organisation comes from the request context, never from the body.
        if (!tenantContext.HasTenant)
        {
            logger.LogWarning("User creation failed because tenant selection is required.");
            return Result.Failure<CreateUserResponse>(Error.TenantSelectionRequired());
        }

        var tenantId = tenantContext.RequireTenantId();
        var tenant = await tenants.GetByIdAsync(tenantId, cancellationToken);
        if (tenant is null)
        {
            logger.LogWarning("User creation failed because TenantId {TenantId} was not found.", tenantId);
            return Result.Failure<CreateUserResponse>(Error.TenantNotFound());
        }

        var businessUnit = await businessUnits.GetByIdAsync(tenant.BusinessUnitId, cancellationToken);
        if (businessUnit is null)
        {
            logger.LogError("User creation failed because the platform business unit is not configured. TenantId {TenantId}.", tenantId);
            return Result.Failure<CreateUserResponse>(Error.Dependency("The platform is not configured."));
        }

        // ---- Licence ceiling -------------------------------------------------------------
        if (tenant.MaximumUsers.HasValue)
        {
            var existing = await users.CountActiveAsync(tenantId, cancellationToken);
            if (existing >= tenant.MaximumUsers.Value)
            {
                logger.LogWarning("User creation rejected because the tenant user limit has been reached. TenantId {TenantId}, CurrentUsers {CurrentUsers}, MaximumUsers {MaximumUsers}.", tenantId, existing, tenant.MaximumUsers.Value);
                return Result.Failure<CreateUserResponse>(Error.UserLimitReached());
            }
        }

        // ---- Identity, scoped to this Organisation ------------------------------------------
        var email = EmailValue.TryParse(request.Email);
        if (email is null)
        {
            logger.LogWarning("User creation failed because the supplied email is invalid.");
            return Result.Failure<CreateUserResponse>(
                Error.Validation("Enter a valid e-mail address.",
                    [new ValidationError(nameof(request.Email), "That e-mail address is not valid.")]));
        }

        if (await users.EmailExistsAsync(email.Value.ToUpperInvariant(), tenantId, null, cancellationToken))
        {
            logger.LogWarning("User creation rejected because the email already exists in TenantId {TenantId}.", tenantId);
            return Result.Failure<CreateUserResponse>(
                Error.Duplicate("Somebody in this organisation already uses that e-mail address."));
        }

        var usernameCandidate = string.IsNullOrWhiteSpace(request.Username)
            ? email.LocalPart
            : request.Username;

        var username = UsernameValue.TryParse(usernameCandidate);
        if (username is null)
        {
            logger.LogWarning("User creation failed because the username is invalid. TenantId {TenantId}.", tenantId);
            return Result.Failure<CreateUserResponse>(
                Error.Validation("That username is not valid.",
                    [new ValidationError(nameof(request.Username),
                        "Use 3 to 64 letters, digits, dots, hyphens or underscores.")]));
        }

        // A collision on the derived username is resolved rather than reported: the person
        // did not choose it, so refusing the whole create would be baffling.
        var finalUsername = username.Value;
        if (string.IsNullOrWhiteSpace(request.Username))
        {
            var suffix = 1;
            while (await users.UsernameExistsAsync(
                       finalUsername.ToUpperInvariant(), tenantId, null, cancellationToken))
            {
                finalUsername = $"{username.Value}{suffix++}";
                if (suffix > 999)
                {
                    break;
                }
            }
        }
        else if (await users.UsernameExistsAsync(finalUsername.ToUpperInvariant(), tenantId, null, cancellationToken))
        {
            logger.LogWarning("User creation rejected because the username already exists in TenantId {TenantId}.", tenantId);
            return Result.Failure<CreateUserResponse>(
                Error.Duplicate("Somebody in this organisation already uses that username."));
        }

        // ---- Referential checks --------------------------------------------------------------
        //
        // The query filter means a department in another Organisation simply is not found,
        // which is the correct answer and also the safe one.
        if (request.ManagerUserId.HasValue)
        {
            var manager = await users.GetByIdAsync(request.ManagerUserId.Value, cancellationToken);
            if (manager is null)
            {
                logger.LogWarning("User creation failed because the requested manager was not found in TenantId {TenantId}.", tenantId);
                return Result.Failure<CreateUserResponse>(
                    Error.Validation("That manager was not found in this organisation.",
                        [new ValidationError(nameof(request.ManagerUserId), "Choose a manager from this organisation.")]));
            }
        }

        // ---- Data scopes, checked before anything is staged ------------------------------------
        //
        // Every scope type but two names a record - a campaign, a warehouse, a queue - and a scope
        // naming nothing would narrow the person to nothing at all. ORGANISATION ("everything")
        // and ASSIGNMENT ("only what is assigned to them") are the exceptions: neither has a
        // record to name, which is why the create form can offer them without a value picker.
        var unnamedScope = (request.DataScopes ?? []).FirstOrDefault(scope =>
            string.IsNullOrWhiteSpace(scope.ScopeValue)
            && scope.ScopeType is not (DataScopeType.Organisation or DataScopeType.Assignment));

        if (unnamedScope is not null)
        {
            logger.LogWarning("User creation failed because a data scope of type {ScopeType} named no value. TenantId {TenantId}.", unnamedScope.ScopeType, tenantId);
            return Result.Failure<CreateUserResponse>(
                Error.Validation("Say which record that data scope covers.",
                    [new ValidationError(nameof(request.DataScopes), "A scope of this type needs a value.")]));
        }

        // ---- The user ---------------------------------------------------------------------------
        var displayName = string.IsNullOrWhiteSpace(request.DisplayName)
            ? $"{request.FirstName.Trim()} {request.LastName.Trim()}".Trim()
            : request.DisplayName.Trim();

        var user = new User
        {
            TenantId = tenantId,
            BusinessUnitId = businessUnit.Id,
            Code = await users.NextUserCodeAsync(tenantId, cancellationToken),
            EmployeeNumber = request.EmployeeNumber?.Trim(),
            FirstName = request.FirstName.Trim(),
            MiddleName = request.MiddleName?.Trim(),
            LastName = request.LastName.Trim(),
            DisplayName = displayName,
            Title = Optional(request.Title),
            PreferredName = Optional(request.PreferredName),
            WorkLocation = Optional(request.WorkLocation),
            // Null inherits the Organisation's defaults, which is what an unanswered locale
            // question should mean.
            PreferredCulture = Optional(request.PreferredCulture),
            TimeZone = Optional(request.TimeZone),
            Email = email.Value,
            NormalizedEmail = email.Value.ToUpperInvariant(),
            UserName = finalUsername,
            NormalizedUserName = finalUsername.ToUpperInvariant(),
            EmailConfirmed = false,
            MobileCountryCode = request.MobileCountryCode?.Trim(),
            MobileNumber = request.MobileNumber?.Trim(),
            EngagementType = request.EngagementType,
            DepartmentId = request.DepartmentId,
            OrganisationUnitId = request.OrganisationUnitId,
            Designation = request.Designation?.Trim(),
            ManagerUserId = request.ManagerUserId,
            // Draft when no invitation is being sent, so a staged import does not look like a
            // pile of people who were invited and never replied.
            Status = request.SendInvitation ? UserStatus.Invited : UserStatus.Draft,
            AccessStartsAtUtc = request.AccessStartsAtUtc ?? now,
            AccessEndsAtUtc = request.AccessEndsAtUtc,
            MfaRequirement = request.MfaRequirement,
            JoinedOn = request.JoinedOn,
            CredentialSetupMethod = request.CredentialSetupMethod,
            PrivilegeLevel = PrivilegeLevel.Standard,
            LockoutEnabled = true,
            IsSuperAdmin = false,
            IsTenantAdmin = false
        };

        user.PhoneNumber = user.ToE164();

        // An administrator-set temporary password. Usable immediately, and must be changed at
        // first sign-in.
        string? temporaryPassword = null;
        if (request.CredentialSetupMethod == CredentialSetupMethod.TemporaryPassword)
        {
            temporaryPassword = passwordHasher.GenerateTemporaryPassword();
            user.PasswordHash = passwordHasher.Hash(temporaryPassword);
            user.MustChangePassword = true;
            user.Status = UserStatus.Active;
        }

        await users.AddAsync(user, cancellationToken);

        // ---- Roles ------------------------------------------------------------------------------
        //
        // THE ADMINISTRATOR'S OWN WORDS, when they gave any. The create form has always required
        // a business justification and every assignment was stamped with the same generic
        // sentence instead - so an access review asking "why does this person hold this role?"
        // found nothing but boilerplate.
        var justification = Optional(request.Justification);

        var assigned = await AssignRolesAsync(
            user, tenant, request.RoleIds, request.RoleCodes, justification, now, cancellationToken);
        if (assigned.IsFailure)
        {
            logger.LogWarning("User creation failed during role assignment. UserId {UserId}, TenantId {TenantId}.", user.Id, tenantId);
            return Result.Failure<CreateUserResponse>(assigned.Error!);
        }

        // The role the invitation names: the first one asked for, by id or by code. Null when
        // none was named and the Organisation default was given instead.
        var initialRoleId = assigned.Value!.FirstOrDefault()?.Id;

        // ---- Narrowing scopes ---------------------------------------------------------------------
        foreach (var scope in request.DataScopes ?? [])
        {
            // The two value-less types are filled in here: an assignment scope is about the
            // person themselves (whose id only exists now), an organisation scope is about the
            // Organisation. Anything else was checked above and carries its own value.
            var scopeValue = !string.IsNullOrWhiteSpace(scope.ScopeValue)
                ? scope.ScopeValue.Trim()
                : scope.ScopeType == DataScopeType.Organisation
                    ? tenantId.ToString()
                    : user.Id.ToString();

            await governance.AddDataScopeAsync(new UserDataScope
            {
                TenantId = tenantId,
                BusinessUnitId = businessUnit.Id,
                UserId = user.Id,
                ScopeType = scope.ScopeType,
                ScopeValue = scopeValue,
                // The two value-less types name no record, so their value is an id nobody can
                // read; without a label the profile showed "Data scope: 6f0751e3-…".
                DisplayLabel = Optional(scope.DisplayLabel) ?? scope.ScopeType switch
                {
                    DataScopeType.Organisation => "Whole organisation",
                    DataScopeType.Assignment => "Assigned records only",
                    _ => null
                },
                GrantedAtUtc = now,
                GrantedByUserId = currentUser.UserId,
                EffectiveFromUtc = now,
                EffectiveToUtc = scope.EffectiveToUtc
            }, cancellationToken);
        }

        // ---- Invitation -------------------------------------------------------------------------------
        UserInvitation? invitation = null;
        string? plaintextToken = null;

        if (request.SendInvitation && request.CredentialSetupMethod == CredentialSetupMethod.InvitationLink)
        {
            plaintextToken = tokenHasher.GenerateToken();
            var primaryDomain = await tenants.GetPrimaryDomainAsync(tenantId, cancellationToken);

            invitation = new UserInvitation
            {
                TenantId = tenantId,
                BusinessUnitId = businessUnit.Id,
                UserId = user.Id,
                Email = email.Value,
                NormalizedEmail = email.Value.ToUpperInvariant(),
                InvitationType = InvitationType.TenantUser,
                InitialRoleId = initialRoleId,
                TokenHash = tokenHasher.Hash(plaintextToken),
                Reference = tokenHasher.GenerateReference("INV"),
                ExpiresAtUtc = now.AddDays(_security.InvitationExpiryDays),
                Status = InvitationStatus.Pending,
                InvitedByUserId = currentUser.UserId,
                InvitedAtUtc = now,
                InvitationHostName = primaryDomain?.HostName ?? $"{tenant.Subdomain}.{businessUnit.RootDomain}",
                Message = request.InvitationMessage,
                LastSentAtUtc = now
            };

            await invitations.AddAsync(invitation, cancellationToken);
        }

        await audit.WriteAsync(
            AuditActionCodes.UserCreated, nameof(User), user.Id, user.DisplayName,
            new
            {
                user.Code,
                Email = email.Value,
                RoleCount = (request.RoleIds?.Count ?? 0) + (request.RoleCodes?.Count ?? 0),
                DataScopeCount = request.DataScopes?.Count ?? 0,
                request.SendInvitation
            },
            justification,
            cancellationToken);

        if (invitation is not null)
        {
            logger.LogInformation("Invitation created for user. UserId {UserId}, InvitationId {InvitationId}.", user.Id, invitation.Id);
            await audit.WriteAsync(
                AuditActionCodes.UserInvited, nameof(UserInvitation), invitation.Id,
                user.DisplayName, new { invitation.Reference },
                cancellationToken: cancellationToken);
        }

        await unitOfWork.SaveChangesAsync(cancellationToken);

        // Sent after the commit. A mail relay failure must not undo a user who has already
        // been created; the invitation can simply be re-sent.
        string? activationUrl = null;
        var delivered = false;
        if (invitation is not null && plaintextToken is not null)
        {
            logger.LogInformation("Sending user invitation after user creation commit. UserId {UserId}, InvitationId {InvitationId}.", user.Id, invitation.Id);
            activationUrl = BuildActivationUrl(invitation.InvitationHostName!, plaintextToken);

            delivered = await notifications.SendInvitationAsync(
                user, invitation, tenant, businessUnit, activationUrl, cancellationToken);
        }

        logger.LogInformation("User created successfully. UserId {UserId}, TenantId {TenantId}, Status {Status}, InvitationCreated {InvitationCreated}, InvitationDelivered {InvitationDelivered}.", user.Id, tenantId, user.Status, invitation is not null, delivered);

        // INVITATION SENT MEANS THE RELAY ACCEPTED IT. It used to be "an invitation row exists",
        // so a relay that refused the login still produced "has been e-mailed an invitation
        // link" on the screen while the person waited for nothing. The row exists either way and
        // the directory's Send invitation re-sends it.
        return Result.Success(new CreateUserResponse(
            user.Id,
            user.Code,
            user.DisplayName,
            user.Email!,
            user.Status,
            delivered,
            invitation?.ExpiresAtUtc,
            _email.Enabled ? null : activationUrl,
            user.Version,
            InvitationCreated: invitation is not null,
            DeliveryMessage: DescribeDelivery(invitation is not null, delivered)));
    }

    public async Task<Result<CreateUserResponse>> HandleAsync(
        ResendUserInvitationCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Resending user invitation. UserId {UserId}.", command.UserId);

        var now = clock.UtcNow;

        var user = await users.GetByIdAsync(command.UserId, cancellationToken);
        if (user is null)
        {
            logger.LogWarning("User invitation resend failed because UserId {UserId} was not found.", command.UserId);
            return Result.Failure<CreateUserResponse>(Error.UserNotFound());
        }

        // WITHDRAWN IS INVITED AGAIN HERE. CanTransitionTo allows Withdrawn to Invited and the
        // record offers "Invite" for it, but this handler - the only one that sends an
        // invitation to an existing account - took Invited and Draft alone. So a withdrawn
        // draft or invitation could never be brought back, and because the address and the
        // username stay reserved for as long as the row exists, the person could not be
        // created again either.
        var previousStatus = user.Status;

        if (previousStatus is not (UserStatus.Invited or UserStatus.Draft or UserStatus.Withdrawn))
        {
            logger.LogWarning("User invitation resend rejected because UserId {UserId} has status {Status}.", command.UserId, user.Status);
            return Result.Failure<CreateUserResponse>(Error.InvalidTransition(
                previousStatus == UserStatus.Active
                    ? "That account is already active. There is nothing to resend."
                    : $"An account that is {UserMappingConfig.DescribeStatus(previousStatus).ToLowerInvariant()} cannot be sent an invitation."));
        }

        var tenant = user.TenantId.HasValue
            ? await tenants.GetByIdAsync(user.TenantId.Value, cancellationToken)
            : null;

        var businessUnit = await businessUnits.GetByIdAsync(user.BusinessUnitId, cancellationToken);
        if (businessUnit is null || tenant is null)
        {
            logger.LogError("User invitation resend failed because tenant or business unit configuration is unavailable. UserId {UserId}.", command.UserId);
            return Result.Failure<CreateUserResponse>(Error.Dependency("The platform is not configured."));
        }

        var invitation = await invitations.GetPendingForUserAsync(user.Id, cancellationToken);
        var plaintextToken = tokenHasher.GenerateToken();
        var primaryDomain = await tenants.GetPrimaryDomainAsync(tenant.Id, cancellationToken);
        var hostName = primaryDomain?.HostName ?? $"{tenant.Subdomain}.{businessUnit.RootDomain}";

        if (invitation is null)
        {
            // The account was created without one, or the previous invitation was revoked.
            invitation = new UserInvitation
            {
                TenantId = tenant.Id,
                BusinessUnitId = businessUnit.Id,
                UserId = user.Id,
                Email = user.Email!,
                NormalizedEmail = user.NormalizedEmail!,
                InvitationType = InvitationType.TenantUser,
                TokenHash = tokenHasher.Hash(plaintextToken),
                Reference = tokenHasher.GenerateReference("INV"),
                ExpiresAtUtc = now.AddDays(_security.InvitationExpiryDays),
                Status = InvitationStatus.Pending,
                InvitedByUserId = currentUser.UserId,
                InvitedAtUtc = now,
                InvitationHostName = hostName,
                Message = command.Message,
                LastSentAtUtc = now
            };

            await invitations.AddAsync(invitation, cancellationToken);
        }
        else
        {
            // A fresh token. The old one stops working, so an invitation forwarded to the
            // wrong person months ago is not still live alongside the new one.
            invitation.TokenHash = tokenHasher.Hash(plaintextToken);
            invitation.ExpiresAtUtc = now.AddDays(_security.InvitationExpiryDays);
            invitation.Status = InvitationStatus.Resent;
            invitation.ResendCount += 1;
            invitation.LastSentAtUtc = now;
            invitation.InvitationHostName = hostName;
            invitation.Message = command.Message ?? invitation.Message;
        }

        user.Status = UserStatus.Invited;

        if (previousStatus == UserStatus.Withdrawn)
        {
            // Withdrawing stamped the day they left. They have not left any more.
            user.ExitedOn = null;
        }

        await audit.WriteAsync(
            AuditActionCodes.UserInvitationResent, nameof(UserInvitation), invitation.Id,
            user.DisplayName, new { invitation.ResendCount, PreviousStatus = previousStatus.ToString() },
            cancellationToken: cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        var activationUrl = BuildActivationUrl(hostName, plaintextToken);

        var delivered = await notifications.SendInvitationAsync(
            user, invitation, tenant, businessUnit, activationUrl, cancellationToken);

        logger.LogInformation("User invitation resent. UserId {UserId}, InvitationId {InvitationId}, ResendCount {ResendCount}, Delivered {Delivered}.", user.Id, invitation.Id, invitation.ResendCount, delivered);

        return Result.Success(new CreateUserResponse(
            user.Id, user.Code, user.DisplayName, user.Email!, user.Status,
            InvitationSent: delivered, invitation.ExpiresAtUtc,
            _email.Enabled ? null : activationUrl, user.Version,
            InvitationCreated: true,
            DeliveryMessage: DescribeDelivery(invitationCreated: true, delivered)));
    }

    /// <summary>
    /// Withdraws an outstanding invitation. The token stops working immediately, which is the
    /// remedy when one was sent to the wrong address.
    /// </summary>
    public async Task<Result<DTOs.CreateUserResponse>> HandleAsync(
        RevokeUserInvitationCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        logger.LogInformation("Revoking user invitation. UserId {UserId}.", command.UserId);

        var user = await users.GetByIdAsync(command.UserId, cancellationToken);
        if (user is null)
        {
            logger.LogWarning("User invitation revocation failed because UserId {UserId} was not found.", command.UserId);
            return Result.Failure<CreateUserResponse>(Error.UserNotFound());
        }

        var invitation = await invitations.GetPendingForUserAsync(user.Id, cancellationToken);
        if (invitation is null)
        {
            logger.LogWarning("User invitation revocation failed because no outstanding invitation exists. UserId {UserId}.", command.UserId);
            return Result.Failure<CreateUserResponse>(
                Error.NotFound("There is no outstanding invitation for that user."));
        }

        var now = clock.UtcNow;
        invitation.Status = InvitationStatus.Revoked;
        invitation.RevokedAtUtc = now;
        invitation.RevokedByUserId = currentUser.UserId;
        invitation.RevocationReason = command.Reason;

        // The token hash is scrambled as well as the status changed, so a leaked link is
        // dead even if some future code path forgets to check the status.
        invitation.TokenHash = tokenHasher.Hash(tokenHasher.GenerateToken());

        user.Status = UserStatus.Draft;

        await audit.WriteAsync(
            AuditActionCodes.UserInvitationRevoked, nameof(UserInvitation), invitation.Id,
            user.DisplayName, new { command.Reason }, command.Reason, cancellationToken);

        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("User invitation revoked successfully. UserId {UserId}, InvitationId {InvitationId}.", user.Id, invitation.Id);

        return Result.Success(new CreateUserResponse(
            user.Id, user.Code, user.DisplayName, user.Email!, user.Status,
            InvitationSent: false, null, null, user.Version,
            InvitationCreated: false,
            DeliveryMessage: "The invitation was withdrawn. Its link no longer works."));
    }

    /// <summary>
    /// Grants the requested roles, or the Organisation default when none was named.
    ///
    /// Refuses a combination that breaks a blocking segregation-of-duties rule, at the point
    /// somebody tries to create it rather than at the next audit.
    /// </summary>
    /// <summary>
    /// Gives the new account its roles: the ones named, by id or by code, or the Organisation
    /// default when none was named.
    ///
    /// THE ROLE IS WHAT SAYS WHAT KIND OF ACCOUNT THIS IS. There used to be a separate account
    /// category, and the only thing it ever decided was this fallback: a "DonorPortal" account
    /// with no roles got DONOR rather than the staff default. A donor account is now simply one
    /// created with the DONOR role - PAY names it by code, because it cannot know the role's id
    /// in each Organisation - so the category had nothing left to do and was removed.
    ///
    /// Returns the roles granted, first (primary) first.
    /// </summary>
    private async Task<Result<IReadOnlyList<Role>>> AssignRolesAsync(
        User user,
        Tenant tenant,
        IReadOnlyList<Guid>? roleIds,
        IReadOnlyList<string>? roleCodes,
        string? justification,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var requested = new List<Role>();

        if (roleIds is { Count: > 0 })
        {
            var byId = await roles.GetManyAsync(roleIds, cancellationToken);

            if (byId.Count != roleIds.Count)
            {
                logger.LogWarning("User role assignment failed because one or more requested roles were not found. UserId {UserId}, RequestedRoleCount {RequestedRoleCount}, FoundRoleCount {FoundRoleCount}.", user.Id, roleIds.Count, byId.Count);
                return Result.Failure<IReadOnlyList<Role>>(Error.Validation(
                    "One or more of those roles was not found in this organisation.",
                    [new ValidationError("RoleIds", "Choose roles from this organisation.")]));
            }

            // In the order asked for, so the first one named is the primary role.
            requested.AddRange(roleIds.Select(id => byId.First(role => role.Id == id)));
        }

        foreach (var code in (roleCodes ?? []).Where(code => !string.IsNullOrWhiteSpace(code)))
        {
            var role = await roles.GetByCodeAsync(code.Trim(), tenant.Id, cancellationToken);

            // A NAMED ROLE THAT IS MISSING REFUSES THE CREATE. Falling through to the default
            // role instead is how a donor account once ended up holding staff rights.
            if (role is null)
            {
                logger.LogWarning("User role assignment failed because role code {RoleCode} does not exist in Organisation {TenantId}. UserId {UserId}.", code, tenant.Id, user.Id);
                return Result.Failure<IReadOnlyList<Role>>(Error.Validation(
                    $"The role {code.Trim()} does not exist in this organisation.",
                    [new ValidationError("RoleCodes", "Choose roles from this organisation.")]));
            }

            if (requested.All(existing => existing.Id != role.Id))
            {
                requested.Add(role);
            }
        }

        var named = requested.Count > 0;

        // Fall back to the Organisation default, so a new user is not created able to sign in
        // and see nothing - which reads as a broken account rather than a missing role. Only when
        // NO role was named: a caller that named one gets that one or a refusal, never a guess.
        if (requested.Count == 0)
        {
            var fallback = await roles.GetDefaultRoleAsync(tenant.Id, cancellationToken);

            if (fallback is not null)
            {
                requested.Add(fallback);
            }
        }

        if (requested.Count == 0)
        {
            return Result.Success<IReadOnlyList<Role>>([]);
        }

        var conflicts = await roles.GetIncompatibilitiesAsync(
            [.. requested.Select(role => role.Id)], cancellationToken);

        var blocking = conflicts
            .Where(rule => rule.IsBlocking && rule.IsActive)
            .Where(rule => requested.Any(role => role.Id == rule.RoleId)
                           && requested.Any(role => role.Id == rule.ConflictingRoleId))
            .ToList();

        if (blocking.Count > 0)
        {
            logger.LogWarning("User role assignment rejected due to segregation-of-duties rules. UserId {UserId}, ConflictCount {ConflictCount}.", user.Id, blocking.Count);
            return Result.Failure<IReadOnlyList<Role>>(Error.SegregationOfDuties(
                "Those roles cannot be held together: " +
                string.Join("; ", blocking.Select(rule => rule.Reason))));
        }

        var isFirst = true;
        foreach (var role in requested)
        {
            await roles.AddUserRoleAsync(new UserRole
            {
                TenantId = user.TenantId,
                BusinessUnitId = user.BusinessUnitId,
                UserId = user.Id,
                RoleId = role.Id,
                Status = UserRoleAssignmentStatus.Active,
                IsPrimary = isFirst,
                AssignedAtUtc = now,
                AssignedByUserId = currentUser.UserId,
                EffectiveFromUtc = now,
                Justification = justification ?? "Assigned when the user was created."
            }, cancellationToken);

            isFirst = false;
        }

        logger.LogInformation("User roles assigned successfully. UserId {UserId}, RoleCount {RoleCount}.", user.Id, requested.Count);

        // The roles that were NAMED, for the invitation; the default is not "what they were
        // invited as".
        return Result.Success<IReadOnlyList<Role>>(named ? requested : []);
    }

    /// <summary>One sentence on what happened to the invitation e-mail, for the screen to show.</summary>
    private string DescribeDelivery(bool invitationCreated, bool delivered) =>
        !invitationCreated ? "No invitation was sent. The account stays a draft until one is."
        : delivered ? "The invitation e-mail was accepted by the mail relay."
        : !_email.Enabled ? "E-mail is switched off on this server, so the invitation was not sent."
        : "The mail relay refused the e-mail, which usually means its login or sender address needs attention.";

    /// <summary>A trimmed value, or null when nothing but whitespace was sent.</summary>
    private static string? Optional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private string BuildActivationUrl(string hostName, string token)
    {
        // Same localhost shortcut as CreateOrganisationCommand had, and the same fault: an
        // invited user was sent to the platform host, where their Organisation does not resolve.
        return _client.TenantUrl(hostName, _client.InvitationPath, token);
    }
}
