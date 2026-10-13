using System.Globalization;
using System.Net;
using System.Text;
using YDot.IAM.Domain.Entities;
using YDot.IAM.Domain.Enums;

namespace YDot.IAM.Infrastructure.Services.Email;

/// <summary>One rendered message, ready to send.</summary>
public sealed record EmailMessage(string To, string Subject, string HtmlBody, string TextBody);

/// <summary>
/// Builds the outbound messages.
///
/// EVERY VALUE THAT COMES FROM DATA IS HTML-ENCODED. An Organisation name, a person name and
/// a rejection reason are all user-supplied, and dropping them raw into an HTML body is a
/// stored-XSS vector against whoever opens the mail in a web client. <see cref="Encode"/> is
/// applied to every substitution rather than the ones that look risky.
///
/// EVERY MESSAGE HAS A PLAIN-TEXT ALTERNATIVE. Not decoration: many corporate mail clients
/// strip HTML entirely, and an invitation that arrives as a blank message is an invitation
/// that never arrives.
///
/// THE BRANDING IS THE ORGANISATION'S, not the platform's. Somebody invited to Hope Foundation
/// should receive a message that says Hope Foundation, because one that says NGoPlanet reads
/// like phishing and gets deleted. Every subject names the Organisation for the same reason.
///
/// THE LOOK IS THE APPLICATION'S. The shell uses the application's default theme colour, its
/// font (Outfit, with system fallbacks for clients that load no web fonts) and its rounded card,
/// so a message reads as coming from the screen the person signs in to. Styles are inline and
/// the layout is tables, because that is all most mail clients honour.
/// </summary>
public sealed class EmailTemplateRenderer
{
    // ---- The application's palette (UI: theme-palette.ts DEFAULT_THEME_COLOR and styles.css) ----
    private const string Primary = "#315746";
    private const string PrimarySoft = "#eef3f0";
    private const string PrimaryBorder = "#d5e2da";
    private const string Ink = "#26263f";
    private const string Muted = "#5f6577";
    private const string Faint = "#8a8aa6";
    private const string Danger = "#b42318";
    private const string FontStack = "'Outfit','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    public EmailMessage Invitation(
        User user, Tenant? tenant, BusinessUnit businessUnit, string activationUrl,
        DateTimeOffset expiresAtUtc, string? personalMessage)
    {
        var days = Math.Max(1, (int)Math.Ceiling((expiresAtUtc - DateTimeOffset.UtcNow).TotalDays));
        var validity = Plural(days, "day");

        var subject = tenant is null
            ? $"Activate your account on the {businessUnit.Name} platform"
            : $"Activate your account in {tenant.Name} Organisation";

        var intro = tenant is null
            ? $"You have been invited to the <strong>{Encode(businessUnit.Name)}</strong> platform."
            : $"You have been invited to join <strong>{Encode(tenant.Name)}</strong> on {Encode(businessUnit.Name)}.";

        var body = new StringBuilder()
            .Append(Heading("Activate your account"))
            .Append(Paragraph($"Hello {Encode(user.FirstName)},"))
            .Append(Paragraph(intro));

        if (!string.IsNullOrWhiteSpace(personalMessage))
        {
            body.Append(Quote(Encode(personalMessage), Primary));
        }

        body.Append(Paragraph("Select the button below to set your password and activate your account."))
            .Append(Button(activationUrl, "Activate my account"))
            .Append(Note($"This link expires in {validity}. If you were not expecting this invitation, "
                         + "you can safely ignore this e-mail."));

        var text = new StringBuilder()
            .AppendLine($"Hello {user.FirstName},")
            .AppendLine()
            .AppendLine(tenant is null
                ? $"You have been invited to the {businessUnit.Name} platform."
                : $"You have been invited to join {tenant.Name} on {businessUnit.Name}.")
            .AppendLine();

        if (!string.IsNullOrWhiteSpace(personalMessage))
        {
            text.AppendLine(personalMessage).AppendLine();
        }

        text.AppendLine("Set your password and activate your account here:")
            .AppendLine(activationUrl)
            .AppendLine()
            .AppendLine($"This link expires in {validity}. If you were not expecting this invitation, "
                        + "you can safely ignore this e-mail.");

        return Build(
            user.Email!, subject, "Set your password and activate your account.",
            body.ToString(), text.ToString(), tenant, businessUnit);
    }

    public EmailMessage PasswordReset(
        User user, Tenant? tenant, BusinessUnit businessUnit, string resetUrl, DateTimeOffset expiresAtUtc)
    {
        var organisation = OrganisationName(tenant, businessUnit);
        var minutes = Math.Max(1, (int)Math.Ceiling((expiresAtUtc - DateTimeOffset.UtcNow).TotalMinutes));
        var validity = Plural(minutes, "minute");

        var body = Heading("Reset your password")
                   + Paragraph($"Hello {Encode(user.FirstName)},")
                   + Paragraph($"We received a request to reset the password for your account in "
                               + $"<strong>{Encode(organisation)}</strong>. Select the button below to choose a new one.")
                   + Button(resetUrl, "Reset my password")
                   + Note($"This link expires in {validity} and can be used only once. If you did not "
                          + "request this, you can ignore this e-mail; your password has not been changed.");

        var text = $"Hello {user.FirstName},\n\n"
                   + $"We received a request to reset the password for your account in {organisation}.\n\n"
                   + $"Choose a new password here:\n{resetUrl}\n\n"
                   + $"This link expires in {validity} and can be used only once.\n"
                   + "If you did not request this, you can ignore this e-mail; your password has not been changed.";

        return Build(
            user.Email!, $"Reset your password for {organisation}", "Choose a new password for your account.",
            body, text, tenant, businessUnit);
    }

    /// <summary>
    /// Confirmation that a password changed.
    ///
    /// Sent even though the person just did it, because the case that matters is the one where
    /// they did NOT. This is often the first warning somebody gets that their account was
    /// taken over.
    /// </summary>
    public EmailMessage PasswordChanged(
        User user, Tenant? tenant, BusinessUnit businessUnit, string? ipAddress)
    {
        var organisation = OrganisationName(tenant, businessUnit);
        var whenText = FormatUtc(DateTimeOffset.UtcNow);
        var from = string.IsNullOrWhiteSpace(ipAddress) ? string.Empty : $" from the IP address {Encode(ipAddress)}";

        var body = Heading("Your password has been changed")
                   + Paragraph($"Hello {Encode(user.FirstName)},")
                   + Paragraph($"The password for your account in <strong>{Encode(organisation)}</strong> was "
                               + $"changed on {Encode(whenText)}{from}.")
                   + Alert("If you did not make this change, reset your password immediately and inform your administrator.");

        var text = $"Hello {user.FirstName},\n\n"
                   + $"The password for your account in {organisation} was changed on {whenText}"
                   + (string.IsNullOrWhiteSpace(ipAddress) ? string.Empty : $" from the IP address {ipAddress}") + ".\n\n"
                   + "If you did not make this change, reset your password immediately and inform your administrator.";

        return Build(
            user.Email!, $"Your password for {organisation} has been changed",
            "Your password was just changed.", body, text, tenant, businessUnit);
    }

    /// <summary>
    /// A one-time code. The sentence above the code says what it is for, because a code that
    /// arrives with no reason is exactly what a person should be suspicious of.
    /// </summary>
    public EmailMessage MfaCode(
        User user, Tenant? tenant, BusinessUnit businessUnit, string code, DateTimeOffset expiresAtUtc,
        MfaChallengePurpose purpose)
    {
        var organisation = OrganisationName(tenant, businessUnit);
        var minutes = Math.Max(1, (int)Math.Ceiling((expiresAtUtc - DateTimeOffset.UtcNow).TotalMinutes));
        var validity = Plural(minutes, "minute");

        var reason = purpose switch
        {
            MfaChallengePurpose.SignIn => $"Use this code to finish signing in to {organisation}.",
            MfaChallengePurpose.Enrolment => "Use this code to confirm e-mail as your two-step verification method.",
            MfaChallengePurpose.Reauthentication => "Use this code to confirm it is you before you continue.",
            MfaChallengePurpose.LoginIdentifierChange => "Use this code to confirm the change to your sign-in details.",
            MfaChallengePurpose.PasswordRecovery => "Use this code to continue resetting your password.",
            _ => "Use this code to continue."
        };

        var body = Heading("Your verification code")
                   + Paragraph($"Hello {Encode(user.FirstName)},")
                   + Paragraph(Encode(reason))
                   + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px 0;\"><tr>"
                   + $"<td style=\"background:{PrimarySoft};border:1px dashed {Primary};border-radius:12px;"
                   + $"padding:14px 28px;font-size:32px;font-weight:700;letter-spacing:8px;color:{Primary};"
                   + $"font-family:Consolas,'Courier New',monospace;\">{Encode(code)}</td></tr></table>"
                   + Note($"The code expires in {validity}. Never share it with anyone; nobody from "
                          + $"{Encode(organisation)} or our support team will ever ask you for it.");

        var text = $"Hello {user.FirstName},\n\n"
                   + $"{reason}\n\n"
                   + $"Your verification code is: {code}\n\n"
                   + $"The code expires in {validity}.\n"
                   + $"Never share it with anyone; nobody from {organisation} or our support team will ever ask you for it.";

        return Build(
            user.Email!, $"{code} is your verification code for {organisation}", reason,
            body, text, tenant, businessUnit);
    }

    public EmailMessage EmailConfirmation(
        User user, Tenant? tenant, BusinessUnit businessUnit, string confirmUrl, string targetEmail)
    {
        var body = Heading("Confirm your e-mail address")
                   + Paragraph($"Hello {Encode(user.FirstName)},")
                   + Paragraph($"Please confirm that <strong>{Encode(targetEmail)}</strong> belongs to you.")
                   + Button(confirmUrl, "Confirm this address")
                   + Note("If you did not request this, you can ignore this e-mail.");

        var text = $"Hello {user.FirstName},\n\n"
                   + $"Please confirm that {targetEmail} belongs to you:\n{confirmUrl}\n\n"
                   + "If you did not request this, you can ignore this e-mail.";

        return Build(
            targetEmail, "Confirm your e-mail address", "Confirm that this e-mail address belongs to you.",
            body, text, tenant, businessUnit);
    }

    /// <summary>
    /// Warns the OLD address that somebody is trying to change the sign-in identifier.
    ///
    /// The whole point of the message: it goes to the address being replaced, so the real
    /// owner finds out before the change lands rather than after.
    /// </summary>
    public EmailMessage LoginIdentifierChangeNotice(
        User user, Tenant? tenant, BusinessUnit businessUnit, string previousValue, string requestedValue)
    {
        var organisation = OrganisationName(tenant, businessUnit);

        var body = Heading("A change to your sign-in details was requested")
                   + Paragraph($"Hello {Encode(user.FirstName)},")
                   + Paragraph($"A request was made to change the sign-in details of your account in "
                               + $"<strong>{Encode(organisation)}</strong> from <strong>{Encode(previousValue)}</strong> "
                               + $"to <strong>{Encode(requestedValue)}</strong>.")
                   + Alert("If you did not make this request, contact your administrator immediately.");

        var text = $"Hello {user.FirstName},\n\n"
                   + $"A request was made to change the sign-in details of your account in {organisation} "
                   + $"from {previousValue} to {requestedValue}.\n\n"
                   + "If you did not make this request, contact your administrator immediately.";

        return Build(
            previousValue, $"A change to your sign-in details for {organisation} was requested",
            "Someone asked to change the sign-in details of your account.", body, text, tenant, businessUnit);
    }

    public EmailMessage AccountLocked(
        User user, Tenant? tenant, BusinessUnit businessUnit, DateTimeOffset lockoutEndUtc, string? ipAddress)
    {
        var organisation = OrganisationName(tenant, businessUnit);
        var minutes = Math.Max(1, (int)Math.Ceiling((lockoutEndUtc - DateTimeOffset.UtcNow).TotalMinutes));
        var duration = Plural(minutes, "minute");
        var from = string.IsNullOrWhiteSpace(ipAddress) ? string.Empty : $" from the IP address {Encode(ipAddress)}";

        var body = Heading("Your account is temporarily locked")
                   + Paragraph($"Hello {Encode(user.FirstName)},")
                   + Paragraph($"Your account in <strong>{Encode(organisation)}</strong> has been locked for "
                               + $"{duration} after too many unsuccessful sign-in attempts{from}.")
                   + Paragraph("You can wait for the lock to expire, or reset your password, which also unlocks your account.")
                   + Alert("If you did not make these attempts, reset your password and inform your administrator.");

        var text = $"Hello {user.FirstName},\n\n"
                   + $"Your account in {organisation} has been locked for {duration} after too many unsuccessful sign-in attempts"
                   + (string.IsNullOrWhiteSpace(ipAddress) ? string.Empty : $" from the IP address {ipAddress}") + ".\n\n"
                   + "You can wait for the lock to expire, or reset your password, which also unlocks your account.\n\n"
                   + "If you did not make these attempts, reset your password and inform your administrator.";

        return Build(
            user.Email!, $"Your account in {organisation} is temporarily locked",
            $"Your account is locked for {duration}.", body, text, tenant, businessUnit);
    }

    public EmailMessage Welcome(User user, Tenant? tenant, BusinessUnit businessUnit, string signInUrl)
    {
        var organisation = OrganisationName(tenant, businessUnit);

        var body = Heading($"Welcome to {Encode(organisation)}")
                   + Paragraph($"Hello {Encode(user.FirstName)},")
                   + Paragraph($"Your account in <strong>{Encode(organisation)}</strong> is now active.")
                   + Button(signInUrl, "Sign in")
                   + Note("Bookmark this address; it is where you will sign in from now on.");

        var text = $"Hello {user.FirstName},\n\n"
                   + $"Your account in {organisation} is now active.\n\n"
                   + $"Sign in here:\n{signInUrl}\n\n"
                   + "Bookmark this address; it is where you will sign in from now on.";

        return Build(
            user.Email!, $"Welcome to {organisation}", "Your account is now active.",
            body, text, tenant, businessUnit);
    }

    public EmailMessage OrganisationSubmitted(Tenant tenant, BusinessUnit businessUnit, User recipient)
    {
        var body = Heading("Your details have been submitted")
                   + Paragraph($"Hello {Encode(recipient.FirstName)},")
                   + Paragraph($"We have received the details of <strong>{Encode(tenant.Name)}</strong>, and they "
                               + "are now awaiting review.")
                   + Paragraph("We will e-mail you once a decision has been made. No action is needed from you "
                               + "in the meantime.");

        var text = $"Hello {recipient.FirstName},\n\n"
                   + $"We have received the details of {tenant.Name}, and they are now awaiting review.\n\n"
                   + "We will e-mail you once a decision has been made. No action is needed from you in the meantime.";

        return Build(
            recipient.Email!, $"{tenant.Name} has been submitted for approval",
            "Your organisation's details are awaiting review.", body, text, tenant, businessUnit);
    }

    public EmailMessage OrganisationApproved(
        Tenant tenant, BusinessUnit businessUnit, User recipient, string organisationUrl)
    {
        var body = Heading($"{Encode(tenant.Name)} has been approved")
                   + Paragraph($"Hello {Encode(recipient.FirstName)},")
                   + Paragraph($"<strong>{Encode(tenant.Name)}</strong> has been approved and is now active.")
                   + Paragraph("You can now sign in and start adding your team.")
                   + Button(organisationUrl, $"Go to {Encode(tenant.Name)}");

        var text = $"Hello {recipient.FirstName},\n\n"
                   + $"{tenant.Name} has been approved and is now active.\n\n"
                   + "You can now sign in and start adding your team:\n"
                   + organisationUrl;

        return Build(
            recipient.Email!, $"{tenant.Name} has been approved",
            "Your organisation is now active.", body, text, tenant, businessUnit);
    }

    /// <summary>
    /// The rejection.
    ///
    /// The reason is the whole message. A refusal the recipient cannot act on is a dead end,
    /// which is why the reason is mandatory upstream and rendered prominently here.
    /// </summary>
    public EmailMessage OrganisationRejected(
        Tenant tenant, BusinessUnit businessUnit, User recipient, string reason, string resubmitUrl)
    {
        var body = Heading("More information is needed")
                   + Paragraph($"Hello {Encode(recipient.FirstName)},")
                   + Paragraph($"The details submitted for <strong>{Encode(tenant.Name)}</strong> could not be "
                               + "approved yet.")
                   + Paragraph("<strong>What needs to change:</strong>")
                   + Quote(Encode(reason), Danger)
                   + Paragraph("Please update the details and submit them again.")
                   + Button(resubmitUrl, "Update the details");

        var text = $"Hello {recipient.FirstName},\n\n"
                   + $"The details submitted for {tenant.Name} could not be approved yet.\n\n"
                   + $"What needs to change:\n{reason}\n\n"
                   + $"Please update the details and submit them again:\n{resubmitUrl}";

        return Build(
            recipient.Email!, $"More information is needed for {tenant.Name}",
            "Your organisation's details need a change before approval.", body, text, tenant, businessUnit);
    }

    public EmailMessage OrganisationSuspended(
        Tenant tenant, BusinessUnit businessUnit, User recipient, string reason)
    {
        var body = Heading($"{Encode(tenant.Name)} has been suspended")
                   + Paragraph($"Hello {Encode(recipient.FirstName)},")
                   + Paragraph($"<strong>{Encode(tenant.Name)}</strong> has been suspended. Users cannot sign in "
                               + "while the suspension is in place.")
                   + Paragraph("<strong>Reason:</strong>")
                   + Quote(Encode(reason), Danger)
                   + Paragraph("Please contact support to discuss this.");

        var text = $"Hello {recipient.FirstName},\n\n"
                   + $"{tenant.Name} has been suspended. Users cannot sign in while the suspension is in place.\n\n"
                   + $"Reason:\n{reason}\n\n"
                   + "Please contact support to discuss this.";

        return Build(
            recipient.Email!, $"{tenant.Name} has been suspended",
            "Users cannot sign in while the suspension is in place.", body, text, tenant, businessUnit);
    }

    public EmailMessage OrganisationAwaitingReview(
        Tenant tenant, BusinessUnit businessUnit, string reviewerEmail, string reviewUrl)
    {
        var body = Heading("An organisation is awaiting review")
                   + Paragraph("Hello,")
                   + Paragraph($"<strong>{Encode(tenant.Name)}</strong> ({Encode(tenant.Code)}) has submitted its "
                               + "details and is awaiting your review.")
                   + Button(reviewUrl, "Review this organisation");

        var text = "Hello,\n\n"
                   + $"{tenant.Name} ({tenant.Code}) has submitted its details and is awaiting your review.\n\n"
                   + $"Review it here:\n{reviewUrl}";

        return Build(
            reviewerEmail, $"{tenant.Name} is awaiting your review",
            "A new organisation has submitted its details.", body, text, null, businessUnit);
    }

    public EmailMessage AccessRequestAwaitingDecision(
        User approver, User subject, Tenant? tenant, BusinessUnit businessUnit,
        string requestNumber, string reviewUrl)
    {
        var body = Heading("An access request is awaiting your decision")
                   + Paragraph($"Hello {Encode(approver.FirstName)},")
                   + Paragraph($"Access request <strong>{Encode(requestNumber)}</strong> for "
                               + $"<strong>{Encode(subject.DisplayName)}</strong> is awaiting your decision.")
                   + Button(reviewUrl, "Review this request");

        var text = $"Hello {approver.FirstName},\n\n"
                   + $"Access request {requestNumber} for {subject.DisplayName} is awaiting your decision.\n\n"
                   + $"Review it here:\n{reviewUrl}";

        return Build(
            approver.Email!, $"Access request {requestNumber} is awaiting your decision",
            $"{subject.DisplayName} has requested access.", body, text, tenant, businessUnit);
    }

    public EmailMessage AccessRequestDecided(
        User requester, Tenant? tenant, BusinessUnit businessUnit,
        string requestNumber, bool approved, string? reason)
    {
        var outcome = approved ? "approved" : "rejected";

        var body = new StringBuilder()
            .Append(Heading($"Your access request has been {outcome}"))
            .Append(Paragraph($"Hello {Encode(requester.FirstName)},"))
            .Append(Paragraph($"Your access request <strong>{Encode(requestNumber)}</strong> has been "
                              + $"<strong>{outcome}</strong>."));

        if (!string.IsNullOrWhiteSpace(reason))
        {
            body.Append(Paragraph("<strong>Comment from the reviewer:</strong>"))
                .Append(Quote(Encode(reason), approved ? Primary : Danger));
        }

        var text = $"Hello {requester.FirstName},\n\n"
                   + $"Your access request {requestNumber} has been {outcome}."
                   + (string.IsNullOrWhiteSpace(reason) ? string.Empty : $"\n\nComment from the reviewer:\n{reason}");

        return Build(
            requester.Email!, $"Your access request {requestNumber} has been {outcome}",
            $"Access request {requestNumber}: {outcome}.", body.ToString(), text, tenant, businessUnit);
    }

    public EmailMessage AccessReviewReminder(
        User reviewer, Tenant? tenant, BusinessUnit businessUnit,
        string reviewNumber, DateTimeOffset dueAtUtc, string reviewUrl)
    {
        var due = dueAtUtc.ToString("d MMMM yyyy", CultureInfo.InvariantCulture);

        var body = Heading("An access review is due")
                   + Paragraph($"Hello {Encode(reviewer.FirstName)},")
                   + Paragraph($"Access review <strong>{Encode(reviewNumber)}</strong> is due on "
                               + $"<strong>{Encode(due)}</strong>.")
                   + Button(reviewUrl, "Complete this review");

        var text = $"Hello {reviewer.FirstName},\n\n"
                   + $"Access review {reviewNumber} is due on {due}.\n\n"
                   + $"Complete it here:\n{reviewUrl}";

        return Build(
            reviewer.Email!, $"Reminder: access review {reviewNumber} is due on {due}",
            $"Access review {reviewNumber} is due on {due}.", body, text, tenant, businessUnit);
    }

    // =============================================================================================
    // The shell and its parts
    // =============================================================================================

    /// <summary>
    /// Wraps a body in the shared shell, branded for the Organisation.
    ///
    /// <paramref name="preheader"/> is the line an inbox shows beside the subject. It is hidden in
    /// the message itself; without it most clients preview the first words of the footer instead.
    /// </summary>
    private static EmailMessage Build(
        string to, string subject, string preheader, string bodyHtml, string bodyText,
        Tenant? tenant, BusinessUnit businessUnit)
    {
        var brand = OrganisationName(tenant, businessUnit);
        var support = businessUnit.SupportEmail ?? businessUnit.ContactEmail;
        var sentBy = tenant is null
            ? $"Sent by {Encode(businessUnit.Name)}."
            : $"Sent by {Encode(brand)} through {Encode(businessUnit.Name)}.";

        var html = new StringBuilder()
            .Append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">")
            .Append("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">")
            .Append($"<title>{Encode(subject)}</title>")
            .Append("<link href=\"https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap\" rel=\"stylesheet\">")
            .Append("</head>")
            .Append($"<body style=\"margin:0;padding:0;background:{PrimarySoft};font-family:{FontStack};\">")
            .Append("<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;\">")
            .Append(Encode(preheader))
            .Append("</div>")
            .Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
                    + $"style=\"background:{PrimarySoft};\"><tr><td align=\"center\" style=\"padding:32px 12px;\">")
            .Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
                    + $"style=\"max-width:580px;background:#ffffff;border:1px solid {PrimaryBorder};border-radius:16px;"
                    + "overflow:hidden;\">")

            // A band in the theme colour, then the Organisation's name: the same order the
            // application's own header uses.
            .Append($"<tr><td style=\"height:6px;line-height:6px;font-size:0;background:{Primary};\">&nbsp;</td></tr>")
            .Append($"<tr><td style=\"padding:24px 32px 16px;border-bottom:1px solid {PrimarySoft};\">")
            .Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr>")
            .Append($"<td style=\"width:40px;height:40px;border-radius:50%;background:{Primary};color:#ffffff;"
                    + $"font-family:{FontStack};font-size:16px;font-weight:700;text-align:center;vertical-align:middle;\">"
                    + $"{Encode(Initials(brand))}</td>")
            .Append($"<td style=\"padding-left:12px;font-family:{FontStack};\">"
                    + $"<div style=\"font-size:18px;font-weight:700;color:{Primary};line-height:1.2;\">{Encode(brand)}</div>"
                    + $"<div style=\"font-size:12px;color:{Faint};line-height:1.4;\">{Encode(businessUnit.Name)}</div></td>")
            .Append("</tr></table></td></tr>")

            .Append($"<tr><td style=\"padding:24px 32px 8px;color:{Ink};font-family:{FontStack};font-size:15px;"
                    + $"line-height:1.6;\">{bodyHtml}</td></tr>")

            .Append($"<tr><td style=\"padding:16px 32px 24px;border-top:1px solid {PrimarySoft};color:{Faint};"
                    + $"font-family:{FontStack};font-size:12px;line-height:1.6;\">")
            .Append(sentBy)
            .Append(string.IsNullOrWhiteSpace(support)
                ? string.Empty
                : $" Need help? Contact <a href=\"mailto:{Encode(support)}\" "
                  + $"style=\"color:{Primary};text-decoration:underline;\">{Encode(support)}</a>.")
            .Append("<br>This is an automated message. Please do not reply to it.")
            .Append("</td></tr></table></td></tr></table></body></html>");

        var text = new StringBuilder()
            .AppendLine(brand)
            .AppendLine(new string('-', Math.Min(brand.Length, 60)))
            .AppendLine()
            .AppendLine(bodyText)
            .AppendLine()
            .AppendLine(tenant is null
                ? $"Sent by {businessUnit.Name}."
                : $"Sent by {brand} through {businessUnit.Name}.");

        if (!string.IsNullOrWhiteSpace(support))
        {
            text.AppendLine($"Need help? Contact {support}.");
        }

        text.AppendLine("This is an automated message. Please do not reply to it.");

        return new EmailMessage(to, subject, html.ToString(), text.ToString());
    }

    /// <summary>The message's title, in the theme colour. The value must already be encoded.</summary>
    private static string Heading(string encodedText) =>
        $"<h1 style=\"margin:0 0 16px;font-family:{FontStack};font-size:22px;line-height:1.3;font-weight:700;"
        + $"color:{Primary};\">{encodedText}</h1>";

    /// <summary>A paragraph. The value must already be encoded.</summary>
    private static string Paragraph(string encodedHtml) =>
        $"<p style=\"margin:0 0 16px;\">{encodedHtml}</p>";

    /// <summary>The small print under an action. The value must already be encoded.</summary>
    private static string Note(string encodedHtml) =>
        $"<p style=\"margin:0 0 16px;color:{Muted};font-size:13px;\">{encodedHtml}</p>";

    /// <summary>A warning the reader must not miss. The value must already be encoded.</summary>
    private static string Alert(string encodedHtml) =>
        $"<p style=\"margin:0 0 16px;padding:12px 16px;background:#fef3f2;border:1px solid #fecdca;"
        + $"border-radius:10px;color:{Danger};font-weight:600;\">{encodedHtml}</p>";

    /// <summary>Quoted free text - a reason or a personal note. The value must already be encoded.</summary>
    private static string Quote(string encodedHtml, string colour) =>
        $"<blockquote style=\"margin:0 0 16px;padding:10px 16px;border-left:4px solid {colour};"
        + $"background:{PrimarySoft};border-radius:0 10px 10px 0;color:{Muted};\">{encodedHtml}</blockquote>";

    /// <summary>The one action of a message. The label must already be encoded.</summary>
    private static string Button(string url, string encodedLabel) =>
        "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px 0;\"><tr>"
        + $"<td style=\"border-radius:10px;background:{Primary};\">"
        + $"<a href=\"{Encode(url)}\" style=\"display:inline-block;padding:13px 28px;font-family:{FontStack};"
        + "font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;\">"
        + $"{encodedLabel}</a></td></tr></table>"
        + $"<p style=\"margin:0 0 16px;color:{Faint};font-size:12px;word-break:break-all;\">"
        + $"If the button does not work, copy this link into your browser:<br>"
        + $"<a href=\"{Encode(url)}\" style=\"color:{Primary};\">{Encode(url)}</a></p>";

    private static string OrganisationName(Tenant? tenant, BusinessUnit businessUnit) =>
        tenant?.Name ?? businessUnit.Name;

    /// <summary>"1 minute", "5 minutes" - never "5 minute(s)".</summary>
    private static string Plural(int count, string unit) =>
        count == 1 ? $"1 {unit}" : $"{count} {unit}s";

    private static string FormatUtc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("dddd d MMMM yyyy 'at' HH:mm 'UTC'", CultureInfo.InvariantCulture);

    /// <summary>Up to two letters for the badge in the header.</summary>
    private static string Initials(string name)
    {
        var words = name.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(word => char.IsLetterOrDigit(word[0]))
            .ToArray();

        return words.Length switch
        {
            0 => "?",
            1 => words[0][..1].ToUpperInvariant(),
            _ => string.Concat(words[0][..1], words[^1][..1]).ToUpperInvariant()
        };
    }

    /// <summary>
    /// HTML-encodes a value. Applied to EVERY substitution, including ones that look safe -
    /// an Organisation name is user-supplied and a reason is free text.
    /// </summary>
    private static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);
}
