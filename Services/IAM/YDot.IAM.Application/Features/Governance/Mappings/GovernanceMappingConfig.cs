using System.Text;
using YDot.IAM.Application.Common.Abstractions.Security;
using YDot.IAM.Application.Common.Constants;
using YDot.IAM.Domain.Entities;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Application.Features.Governance.Mappings;

/// <summary>
/// Who is looking at an access request, and what they hold.
///
/// PASSED TO THE READ SIDE rather than looked up there, because the permitted actions on a row
/// depend on the caller's permissions as well as on who they are - and the read service has no
/// business reaching into the request for either.
/// </summary>
public sealed record AccessRequestViewer(
    Guid UserId,
    bool CanEdit,
    bool CanSubmit,
    bool CanDecide,
    bool CanWithdraw,
    bool IsOrganisationAdmin = false)
{
    /// <summary>
    /// Whether the caller sees every request in the Organisation, rather than only the ones they
    /// raised or that are for them.
    ///
    /// A DECIDER HAS TO, because the queue is where they decide. Anybody else - a member of staff
    /// who may only ask - has no business reading a colleague's justification for wanting a role.
    /// </summary>
    public bool SeesAll => CanDecide;

    /// <summary>
    /// Whether the caller may raise a request for somebody other than themselves. The same rule
    /// as <see cref="SeesAll"/>: asking on another person's behalf is an administrator's act.
    /// </summary>
    public bool MayRequestForOthers => CanDecide;

    /// <summary>The caller, with the four permissions the access request endpoints are gated on.</summary>
    public static AccessRequestViewer From(ICurrentUser currentUser)
    {
        ArgumentNullException.ThrowIfNull(currentUser);

        return new AccessRequestViewer(
            currentUser.UserId,
            CanEdit: currentUser.HasPermission(PermissionCodes.AccessRequestsCreate),
            CanSubmit: currentUser.HasPermission(PermissionCodes.AccessRequestsSubmit),
            CanDecide: currentUser.HasPermission(PermissionCodes.AccessRequestsApprove),
            CanWithdraw: currentUser.HasPermission(PermissionCodes.AccessRequestsWithdraw),
            IsOrganisationAdmin: IsOrganisationAdminOf(currentUser));
    }

    /// <summary>
    /// Whether the caller holds the Organisation Admin role, whom the organisation puts above the
    /// maker-and-checker rule ("there is no restriction for Tenant Admin").
    ///
    /// THE ROLE, NOT THE FLAG ALONE. <c>is_tenant_admin</c> marks only the administrator the
    /// Organisation was created with; a colleague given the role later carries its code in the
    /// token's roles instead, and is just as much the Organisation Admin.
    /// </summary>
    public static bool IsOrganisationAdminOf(ICurrentUser currentUser)
    {
        ArgumentNullException.ThrowIfNull(currentUser);

        return currentUser.IsTenantAdmin
               || currentUser.Roles.Contains(RoleCodes.TenantAdmin, StringComparer.Ordinal);
    }
}

/// <summary>
/// Shared presentation rules for the governance slice.
///
/// These live here rather than inside a handler because BOTH sides need them: the command
/// handler returns permitted actions after a change, and the read service returns them on
/// every list and detail row. Two copies would drift, and the drift would show up as a button
/// the screen offers and the API then refuses.
/// </summary>
public static class GovernanceMappingConfig
{
    /// <summary>
    /// What an access request allows, for the caller.
    ///
    /// THREE THINGS DECIDE IT, and all three are checked again by the handlers: the state, the
    /// caller's permissions, and who the caller is to the request. The person who raised it may
    /// edit, submit or withdraw it but must never decide it; the person it is for must not decide
    /// it either; everybody else decides it only if they hold the permission.
    ///
    /// EXCEPT THE ORGANISATION ADMIN, who decides any submitted request - one they raised, and one
    /// for their own access, included. The organisation's rule is that its administrator works
    /// without restriction, so the maker-and-checker exclusion binds everybody else.
    ///
    /// A request that was SENT BACK follows a draft's rules: its requester corrects it and submits
    /// it again under the same number.
    /// </summary>
    public static IReadOnlyList<string> PermittedActionsFor(AccessRequest request, AccessRequestViewer viewer)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(viewer);

        return PermittedActionsFor(
            request.Status, request.RequestedByUserId, request.RequestedForUserId, viewer);
    }

    /// <summary>The same rule for a projected row, which has the three facts but no entity.</summary>
    public static IReadOnlyList<string> PermittedActionsFor(
        AccessRequestStatus status, Guid requestedByUserId, Guid requestedForUserId, AccessRequestViewer viewer)
    {
        ArgumentNullException.ThrowIfNull(viewer);

        var actions = new List<string>(5) { "View" };
        var isOwnRequest = requestedByUserId == viewer.UserId;

        switch (status)
        {
            case AccessRequestStatus.Draft or AccessRequestStatus.Returned when isOwnRequest:
                if (viewer.CanEdit)
                {
                    actions.Add("Edit");
                }

                if (viewer.CanSubmit)
                {
                    actions.Add("Submit");
                }

                if (viewer.CanWithdraw)
                {
                    actions.Add("Withdraw");
                }

                break;

            // A submitted request: its requester may withdraw it, and whoever may decide it is
            // offered the decision - for the Organisation Admin that includes their own request
            // (see CanDecide), so both can appear on one row, Withdraw first.
            case AccessRequestStatus.Submitted:
                if (isOwnRequest && viewer.CanWithdraw)
                {
                    actions.Add("Withdraw");
                }

                if (CanDecide(status, requestedByUserId, requestedForUserId, viewer))
                {
                    actions.AddRange(["Approve", "Reject", "Return"]);
                }

                break;
        }

        return actions;
    }

    /// <summary>
    /// Whether the caller may approve, reject or send back a request.
    ///
    /// Maker and checker: the requester and the subject are both excluded, whatever they hold -
    /// unless they are the Organisation Admin, who is not restricted.
    /// </summary>
    public static bool CanDecide(
        AccessRequestStatus status, Guid requestedByUserId, Guid requestedForUserId, AccessRequestViewer viewer)
    {
        ArgumentNullException.ThrowIfNull(viewer);

        return status == AccessRequestStatus.Submitted
               && viewer.CanDecide
               && (viewer.IsOrganisationAdmin
                   || (requestedByUserId != viewer.UserId && requestedForUserId != viewer.UserId));
    }

    /// <summary>Whether the caller may withdraw a request: its requester, before it is decided.</summary>
    public static bool CanCancel(AccessRequestStatus status, Guid requestedByUserId, AccessRequestViewer viewer)
    {
        ArgumentNullException.ThrowIfNull(viewer);

        return viewer.CanWithdraw
               && requestedByUserId == viewer.UserId
               && status is AccessRequestStatus.Draft or AccessRequestStatus.Submitted or AccessRequestStatus.Returned;
    }

    /// <summary>
    /// Why the caller cannot decide a request that is waiting, in words for the queue. Null when
    /// they can, and for a request that is not waiting on anybody.
    ///
    /// SAID BY THE SERVER because only the server knows it. The screen used to guess from display
    /// names, which is wrong the day two colleagues share one.
    /// </summary>
    public static string? CannotDecideReason(
        AccessRequestStatus status, Guid requestedByUserId, Guid requestedForUserId, AccessRequestViewer viewer)
    {
        ArgumentNullException.ThrowIfNull(viewer);

        if (status != AccessRequestStatus.Submitted)
        {
            return null;
        }

        if (viewer.IsOrganisationAdmin && viewer.CanDecide)
        {
            return null;
        }

        if (requestedByUserId == viewer.UserId)
        {
            return "You raised this request, so somebody else has to decide it.";
        }

        if (requestedForUserId == viewer.UserId)
        {
            return "This request is for your own access, so somebody else has to decide it.";
        }

        return viewer.CanDecide ? null : "Deciding access requests is not part of your role.";
    }

    /// <summary>
    /// An audit action code in words: "iam.auth.sign-in.succeeded" reads "Sign-in succeeded",
    /// "iam.access-request.approved" reads "Access request approved".
    ///
    /// THE WHOLE CODE, NOT ITS LAST WORD. The trail printed only the final segment, so a sign-in,
    /// a role change and an export all read "succeeded", "assigned" or "exported" with nothing to
    /// say what had. The module prefix and the two grouping words ("auth", "security") are left
    /// out because they add nothing a reader needs.
    /// </summary>
    public static string DescribeAuditAction(string actionCode)
    {
        if (string.IsNullOrWhiteSpace(actionCode))
        {
            return string.Empty;
        }

        var segments = actionCode.Split('.', StringSplitOptions.RemoveEmptyEntries).ToList();

        if (segments.Count > 1 && AuditModulePrefixes.Contains(segments[0]))
        {
            segments.RemoveAt(0);
        }

        if (segments.Count > 1 && AuditGroupingWords.Contains(segments[0]))
        {
            segments.RemoveAt(0);
        }

        var words = string.Join(' ', segments).Replace('-', ' ');

        foreach (var (plain, written) in AuditWordForms)
        {
            words = System.Text.RegularExpressions.Regex.Replace(
                words, $@"\b{plain}\b", written, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        }

        return words.Length == 0 ? actionCode : char.ToUpperInvariant(words[0]) + words[1..];
    }

    private static readonly HashSet<string> AuditModulePrefixes = new(StringComparer.Ordinal)
    {
        "iam", "platform", "gm", "cam", "don", "pay"
    };

    private static readonly HashSet<string> AuditGroupingWords = new(StringComparer.Ordinal)
    {
        "auth", "security"
    };

    /// <summary>Words a plain hyphen-to-space pass would write wrongly.</summary>
    private static readonly (string Plain, string Written)[] AuditWordForms =
    [
        ("sign in", "sign-in"),
        ("sign out", "sign-out"),
        ("mfa", "MFA"),
        ("e mail", "e-mail"),
        ("sod", "SoD")
    ];

    /// <summary>How an audited action ended, in words.</summary>
    public static string DescribeAuditResult(AuditResult result) => result switch
    {
        AuditResult.Succeeded => "Succeeded",
        AuditResult.Denied => "Denied",
        AuditResult.Failed => "Failed",
        _ => Humanise(result.ToString())
    };

    /// <summary>
    /// What an outcome means. A denial is not a failure: it is a permission check doing its job,
    /// and the audit trail colours and counts the two apart for that reason.
    /// </summary>
    public static string ExplainAuditResult(AuditResult result) => result switch
    {
        AuditResult.Succeeded => "Completed as requested",
        AuditResult.Denied => "Refused by a permission check",
        AuditResult.Failed => "Stopped by an error",
        _ => string.Empty
    };

    /// <summary>
    /// A data scope type in words.
    ///
    /// ONE WORDING for the reference data, the access request queue, the access preview and the
    /// export, so a filter option and the row it finds read the same. The enum names alone do not
    /// say enough: "Assignment" and "Queue" mean nothing to somebody approving a request.
    /// </summary>
    public static string DescribeScopeType(DataScopeType scopeType) => scopeType switch
    {
        DataScopeType.Organisation => "Whole organisation",
        DataScopeType.Geography => "Geography",
        DataScopeType.Campaign => "Campaign",
        DataScopeType.Warehouse => "Warehouse",
        DataScopeType.Queue => "Work queue",
        DataScopeType.Assignment => "Assigned records only",
        DataScopeType.ExplicitRecord => "Named records",
        _ => Humanise(scopeType.ToString())
    };

    /// <summary>
    /// The kinds of access request a person may RAISE, which is what the Request type dropdown
    /// offers: a role, and nothing else, by the organisation's decision. A person asks to hold a
    /// role; what that role grants is decided on the Roles screen, not request by request.
    ///
    /// The other three kinds stay in the enum, and a request of one of them would still be shown
    /// and decided, because the type is a stored column. They can no longer be created or edited
    /// into - see CreateAccessRequestRequestValidator.
    /// </summary>
    public static IReadOnlyList<AccessRequestType> RequestableTypes { get; } =
    [
        AccessRequestType.RoleAssignment
    ];

    /// <summary>What an access review state allows.</summary>
    public static IReadOnlyList<string> PermittedActionsFor(AccessReview review, Guid callerId)
    {
        ArgumentNullException.ThrowIfNull(review);

        if (!review.IsOpen)
        {
            return ["View"];
        }

        // Only the assigned reviewer decides. Anybody else with the permission can still see
        // it and cancel it, which is what a supervisor needs.
        return review.ReviewerUserId == callerId
            ? ["View", "Decide", "Cancel"]
            : ["View", "Cancel"];
    }

    /// <summary>What an identifier-change request state allows.</summary>
    public static IReadOnlyList<string> PermittedActionsFor(LoginIdentifierChangeRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return request.Status switch
        {
            LoginIdentifierChangeStatus.Draft => ["View", "Submit", "Cancel"],
            LoginIdentifierChangeStatus.PendingVerification => ["View", "Verify", "Resend", "Cancel"],
            LoginIdentifierChangeStatus.PendingApproval => ["View", "Approve", "Reject", "Cancel"],
            LoginIdentifierChangeStatus.Approved => ["View", "Apply", "Cancel"],
            _ => ["View"]
        };
    }

    /// <summary>What a review campaign state allows.</summary>
    public static IReadOnlyList<string> PermittedActionsFor(AccessReviewCampaign campaign)
    {
        ArgumentNullException.ThrowIfNull(campaign);

        return campaign.Status switch
        {
            AccessReviewCampaignStatus.Draft => ["View", "Edit", "Start", "Cancel"],
            AccessReviewCampaignStatus.Active => ["View", "Close", "Cancel"],
            _ => ["View"]
        };
    }

    /// <summary>
    /// "PendingVerification" becomes "Pending verification".
    ///
    /// Done on the server so every screen shows the same wording, rather than each client
    /// inventing its own mapping from an enum name.
    /// </summary>
    public static string Humanise(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return value;
        }

        var builder = new StringBuilder(value.Length + 8);
        builder.Append(value[0]);

        for (var index = 1; index < value.Length; index++)
        {
            if (char.IsUpper(value[index]) && !char.IsUpper(value[index - 1]))
            {
                builder.Append(' ').Append(char.ToLowerInvariant(value[index]));
            }
            else
            {
                builder.Append(value[index]);
            }
        }

        return builder.ToString();
    }
}
