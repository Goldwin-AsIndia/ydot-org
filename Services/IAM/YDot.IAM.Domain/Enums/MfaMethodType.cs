namespace YDot.IAM.Domain.Enums;

/// <summary>
/// Section 3.6: AuthenticatorApp|Email|SecurityKey.
///
/// Text message (Sms = 1) was removed on 2026-10-11: there was never a gateway to send one, and
/// the code went out by e-mail instead. The column stores the name, not the number, and no row held
/// "Sms"; the remaining values keep their numbers so nothing that saw them before shifts.
/// </summary>
public enum MfaMethodType
{
    AuthenticatorApp = 0,
    Email = 2,
    SecurityKey = 3
}
