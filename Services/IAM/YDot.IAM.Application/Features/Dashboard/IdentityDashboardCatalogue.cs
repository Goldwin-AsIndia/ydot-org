using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.Dashboard;

/// <summary>
/// The words, ranks and destinations of IAM's part of the landing page.
///
/// TWO AUDIENCES. Inside an Organisation, IAM contributes who is looking, what they did lately
/// (or what the Organisation did, for an auditor), the people and access figures, and the access
/// decisions waiting. Outside one, for the Platform Admin, it is the whole page: the Organisation,
/// CAM, DON and PAY services have nothing to say to a session with no Organisation, so every tile
/// is filled from the platform's own records.
///
/// A ROUTE IS SENT ONLY WITH THE PERMISSION ITS SCREEN'S GUARD ASKS FOR - see the note on the
/// contract. My Security asks for none: every signed-in person may open their own.
/// </summary>
public static class IdentityDashboardCatalogue
{
    public const string Module = "IAM";

    /// <summary>Rows in the activity feed.</summary>
    public const int ActivityRows = 7;

    /// <summary>The platform's sign-in curve, like the other curves, covers a fortnight.</summary>
    public const int WindowDays = 14;

    /// <summary>The most sign-in attempts read for the curve.</summary>
    public const int MaximumSignIns = 200_000;

    /// <summary>A screen an identity tile leads to, and the permission its guard asks for.</summary>
    public sealed record Screen(string Route, string? Permission);

    public static readonly Screen UserDirectoryScreen =
        new("/app/administration/access/user-directory", PermissionCodes.UsersView);

    public static readonly Screen AccessRequestsScreen =
        new("/app/administration/access/access-request-and-approval", PermissionCodes.AccessRequestsView);

    public static readonly Screen AuditTrailScreen =
        new("/app/administration/audit", PermissionCodes.AuditView);

    public static readonly Screen MySecurityScreen =
        new("/app/administration/access/my-security", null);

    public static readonly Screen OrganisationDirectoryScreen =
        new("/app/administration/organisation/directory", PermissionCodes.Platform.TenantsView);

    public static readonly Screen ApprovalQueueScreen =
        new("/app/administration/organisation/registration-verification", PermissionCodes.Platform.TenantsReview);

    public static readonly Screen CreateOrganisationScreen =
        new("/app/administration/organisation/setup-wizard", PermissionCodes.Platform.TenantsCreate);

    public static readonly Screen PlatformAuditScreen =
        new("/app/platform/audit", PermissionCodes.Platform.PlatformAuditView);

    /// <summary>Lower wins - shared with CAM, DON and PAY; see the note on the contract.</summary>
    public static class Ranks
    {
        /// <summary>Behind every module's own card, so it shows only where nothing else does.</summary>
        public const int People = 80;

        public const int CounterActiveUsers = 30;
        public const int CounterInvited = 40;
        public const int CounterAccessRequests = 50;

        /// <summary>The activity feed has no rival - IAM keeps the trail.</summary>
        public const int Activity = 10;

        /// <summary>The Platform Admin's tiles. Nothing else answers outside an Organisation.</summary>
        public const int Platform = 90;
    }

    /// <summary>The Organisation statuses as the platform's stages, in the order an Organisation moves.</summary>
    ///
    /// Each names the campaign stage whose colour it borrows - the page's styles colour those eight.
    public static IReadOnlyList<(string Key, string Label, TenantStatus[] Statuses, string Palette)> OrganisationStages { get; } =
    [
        ("onboarding", "Onboarding", [TenantStatus.Invited, TenantStatus.InvitationAccepted, TenantStatus.ProfileIncomplete], "draft"),
        ("review", "In review", [TenantStatus.Submitted, TenantStatus.UnderReview, TenantStatus.Resubmitted], "submitted"),
        ("approved", "Approved", [TenantStatus.Approved], "approved"),
        ("active", "Active", [TenantStatus.Active], "active"),
        ("suspended", "Suspended", [TenantStatus.Suspended], "paused"),
        ("archived", "Archived", [TenantStatus.Archived], "closed")
    ];

    /// <summary>"Under review" - an Organisation's status as people read it.</summary>
    public static string Describe(TenantStatus status) => status switch
    {
        TenantStatus.InvitationAccepted => "Invitation accepted",
        TenantStatus.ProfileIncomplete => "Profile incomplete",
        TenantStatus.UnderReview => "Under review",
        _ => status.ToString()
    };

    public static string ToneOf(TenantStatus status) => status switch
    {
        TenantStatus.Active => "ok",
        TenantStatus.Approved or TenantStatus.Submitted or TenantStatus.UnderReview or TenantStatus.Resubmitted => "wait",
        TenantStatus.Suspended => "warn",
        TenantStatus.Rejected or TenantStatus.Archived => "bad",
        _ => "mute"
    };

    public static string Describe(MfaMethodType method) => method switch
    {
        MfaMethodType.AuthenticatorApp => "Authenticator app",
        MfaMethodType.Email => "E-mail code",
        MfaMethodType.SecurityKey => "Security key",
        _ => method.ToString()
    };

    public static string IconOf(MfaMethodType method) => method switch
    {
        MfaMethodType.AuthenticatorApp => "ri-smartphone-line",
        MfaMethodType.Email => "ri-mail-lock-line",
        MfaMethodType.SecurityKey => "ri-key-2-line",
        _ => "ri-shield-keyhole-line"
    };

    /// <summary>
    /// What family an audit event belongs to, from its action code. The page colours six keys -
    /// sec, access, money, camp, lead and gen - and IAM's trail only ever needs sec, access and
    /// gen. It used to guess the family in the browser from the wording of the action.
    /// </summary>
    public static (string Key, string Label) KindOf(string actionCode)
    {
        var code = actionCode.Trim().ToLowerInvariant();

        if (code.StartsWith("iam.auth.", StringComparison.Ordinal) || code.StartsWith("iam.my-security.", StringComparison.Ordinal))
        {
            return ("sec", "Security");
        }

        if (code.StartsWith("iam.users.", StringComparison.Ordinal) || code.StartsWith("iam.user-security.", StringComparison.Ordinal))
        {
            return ("access", "People");
        }

        if (code.StartsWith("iam.access-", StringComparison.Ordinal)
            || code.StartsWith("iam.roles.", StringComparison.Ordinal)
            || code.StartsWith("iam.permissions.", StringComparison.Ordinal)
            || code.StartsWith("iam.menus.", StringComparison.Ordinal))
        {
            return ("access", "Access");
        }

        if (code.StartsWith("platform.", StringComparison.Ordinal))
        {
            return ("gen", "Platform");
        }

        return code.StartsWith("iam.organisation", StringComparison.Ordinal)
            ? ("gen", "Organisation")
            : ("gen", "System");
    }

    /// <summary>The glyph for an audit event, from the verb in its action code.</summary>
    public static string IconOf(string actionCode)
    {
        var code = actionCode.Trim().ToLowerInvariant();

        return code switch
        {
            _ when code.Contains("sign-in") || code.Contains("reauthenticated") => "ri-login-circle-line",
            _ when code.Contains("sign-out") => "ri-logout-circle-line",
            _ when code.Contains("mfa") || code.Contains("password") => "ri-shield-keyhole-line",
            _ when code.Contains("approve") => "ri-checkbox-circle-line",
            _ when code.Contains("reject") || code.Contains("denied") || code.Contains("fail") => "ri-close-circle-line",
            _ when code.Contains("export") => "ri-download-2-line",
            _ when code.Contains("role") || code.Contains("permission") || code.Contains("access") => "ri-user-settings-line",
            _ when code.Contains("create") || code.Contains("invite") || code.Contains("add") => "ri-add-circle-line",
            _ => "ri-flashlight-line"
        };
    }
}
