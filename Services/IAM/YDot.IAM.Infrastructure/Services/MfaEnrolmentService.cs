using YDot.IAM.Application.Common.Abstractions.Persistence;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Abstractions.Services;
using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Application.Common.Results;
using YDot.IAM.Application.Common.Services;
using YDot.IAM.Application.Features.Authentication.DTOs;
using YDot.IAM.Domain.Entities;
using YDot.IAM.Domain.Enums;
using YDot.IAM.Domain.ValueObjects;

namespace YDot.IAM.Infrastructure.Services;

/// <summary>
/// Enrolling a second factor, for both places it happens.
///
/// See <see cref="IMfaEnrolmentService"/> for why this is a service rather than living inside
/// one feature handler. In short: the security page and the activation screen identify the
/// person completely differently, and then do exactly the same thing.
///
/// NOTHING HERE COMMITS. Every method stages its changes and leaves saving to the caller, so an
/// enrolment lands in the same transaction as whatever the calling flow is doing — which on the
/// activation path means the factor and the activated account are written together or not at all.
/// </summary>
public sealed class MfaEnrolmentService(
    ISecurityRepository security,
    ITotpService totp,
    IMfaChallengeService challenges,
    IAuditService audit,
    IDateTimeProvider clock) : IMfaEnrolmentService
{
    public async Task<Result<MfaEnrolmentResponse>> BeginAsync(
        User user,
        Tenant? tenant,
        BusinessUnit businessUnit,
        MfaMethodType methodType,
        string? label,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        ArgumentNullException.ThrowIfNull(businessUnit);

        string? sharedSecret = null;
        string? provisioningUri = null;
        string? maskedDestination;

        switch (methodType)
        {
            case MfaMethodType.AuthenticatorApp:
            {
                sharedSecret = totp.GenerateSecret();

                // The issuer carries the Organisation name, so somebody administering three
                // Organisations does not end up with three identical entries called YDot and no
                // way to tell which code belongs to which.
                var issuer = tenant is null
                    ? businessUnit.Name
                    : $"{businessUnit.Name} - {tenant.Name}";

                provisioningUri = totp.BuildProvisioningUri(
                    sharedSecret, user.Email ?? user.UserName ?? user.Code, issuer);

                maskedDestination = "Authenticator app";
                break;
            }

            case MfaMethodType.Email:
            {
                if (string.IsNullOrWhiteSpace(user.Email))
                {
                    return Result.Failure<MfaEnrolmentResponse>(
                        Error.Validation("This account has no e-mail address to send codes to.",
                            [new ValidationError("Email", "Add an e-mail address first.")]));
                }

                maskedDestination = EmailValue.TryParse(user.Email)?.Masked();
                break;
            }

            case MfaMethodType.SecurityKey:
            default:
                return Result.Failure<MfaEnrolmentResponse>(
                    Error.Validation("Security keys are not available yet.",
                        [new ValidationError("MethodType", "Choose an authenticator app or e-mail.")]));
        }

        var method = new MfaMethod
        {
            TenantId = user.TenantId ?? Guid.Empty,
            BusinessUnitId = user.BusinessUnitId,
            UserId = user.Id,
            MethodType = methodType,
            Label = label?.Trim(),
            MaskedDestination = maskedDestination,
            SecretHash = sharedSecret,

            // Pending until proved. A method that has never produced a working code is not a
            // factor, it is a way to lock yourself out.
            Status = MfaMethodStatus.Pending,
            IsPrimary = false
        };

        await security.AddMfaMethodAsync(method, cancellationToken);

        // Stored on the user as well, because the sign-in path reads it without loading the
        // method rows. Encrypted at rest by the DbContext value converter.
        if (methodType == MfaMethodType.AuthenticatorApp)
        {
            user.AuthenticatorSecret = sharedSecret;
        }

        await audit.WriteAnonymousAsync(
            AuditActionCodes.MfaEnrolled, nameof(MfaMethod), method.Id,
            user.BusinessUnitId, user.TenantId,
            AuditResult.Succeeded, user.DisplayName,
            new { MethodType = methodType, Status = "Pending" },
            cancellationToken);

        // A delivered factor gets a code straight away, so the person can confirm without a
        // second click. An authenticator has nothing to send — the device makes the code.
        //
        // THE OUTCOME IS READ. It used to be discarded, so a code that was never sent still
        // answered "We have sent a code" and left somebody watching an empty inbox. Failing here
        // also means the caller saves nothing: no half-made method is left behind.
        if (methodType == MfaMethodType.Email)
        {
            var issued = await challenges.IssueAsync(
                user, tenant, businessUnit, MfaChallengePurpose.Enrolment, method.Id, cancellationToken);

            if (issued.IsFailure)
            {
                return Result.Failure<MfaEnrolmentResponse>(issued.Error!);
            }

            if (!issued.Value!.CodeWasSent)
            {
                return Result.Failure<MfaEnrolmentResponse>(Error.Dependency(
                    $"We could not e-mail a code to {maskedDestination ?? "your address"} just now. "
                    + "Wait a minute and try again, or choose the authenticator app."));
            }
        }

        return Result.Success(new MfaEnrolmentResponse(
            method.Id,
            method.MethodType,

            // Returned ONCE. Never readable again through any endpoint.
            sharedSecret,
            provisioningUri,
            maskedDestination,
            methodType == MfaMethodType.AuthenticatorApp
                ? "Scan the QR code with your authenticator app, then enter a code to confirm."
                : "We have sent a code. Enter it to confirm."));
    }

    public async Task<Result<MfaMethod>> ConfirmAsync(
        User user,
        Guid methodId,
        string code,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);

        var now = clock.UtcNow;
        var method = await security.GetMfaMethodAsync(methodId, cancellationToken);

        // Checked against the user the CALLER resolved, so one person can never confirm
        // somebody else's enrolment by passing a different id.
        if (method is null || method.UserId != user.Id)
        {
            return Result.Failure<MfaMethod>(Error.NotFound("That verification method was not found."));
        }

        if (method.Status == MfaMethodStatus.Revoked)
        {
            return Result.Failure<MfaMethod>(
                Error.InvalidTransition("That verification method has been removed."));
        }

        // Null when the code is right; otherwise the reason, with the real attempts remaining.
        var failure = method.MethodType == MfaMethodType.AuthenticatorApp
            ? !string.IsNullOrWhiteSpace(method.SecretHash) && totp.VerifyCode(method.SecretHash, code)
                ? null
                : Error.MfaCodeIncorrect()
            : (await challenges.VerifyOutstandingCodeAsync(
                user.Id, MfaChallengePurpose.Enrolment, method.Id, code, cancellationToken)).Error;

        if (failure is not null)
        {
            await audit.WriteAnonymousAsync(
                AuditActionCodes.MfaFailed, nameof(MfaMethod), method.Id,
                user.BusinessUnitId, user.TenantId,
                AuditResult.Denied, user.DisplayName,
                new { Context = "Enrolment" },
                cancellationToken);

            return Result.Failure<MfaMethod>(failure);
        }

        method.Status = MfaMethodStatus.Active;
        method.VerifiedAtUtc = now;

        // The first working method becomes primary, so sign-in always has something to
        // challenge without the person having to nominate one.
        var existing = await security.GetMfaMethodsAsync(user.Id, cancellationToken);
        if (!existing.Any(item => item.IsPrimary && item.Id != method.Id && item.IsUsable))
        {
            method.IsPrimary = true;
        }

        user.MfaEnabled = true;
        user.MfaEnrolledAtUtc ??= now;

        // A change to the second factor changes what a token should assert, so every token
        // issued before now stops being accepted and a fresh one is minted on the next request.
        user.SecurityStamp = Guid.NewGuid().ToString("N");

        await audit.WriteAnonymousAsync(
            AuditActionCodes.MfaVerified, nameof(MfaMethod), method.Id,
            user.BusinessUnitId, user.TenantId,
            AuditResult.Succeeded, user.DisplayName,
            new { method.MethodType, Confirmed = true },
            cancellationToken);

        return Result.Success(method);
    }
}
