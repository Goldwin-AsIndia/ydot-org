using YDots.DON.Application.DTOs;
using YDots.DON.Domain.Services;
using YDots.DON.Application.Common.Constants;
using YDots.DON.Application.Common.Services;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Application.Features.Leads.DTOs;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;
using YDots.DON.Domain.ValueObjects;

namespace YDots.DON.Application.Features.Leads.Mappings;

/// <summary>Manual mapping for the lead capture and lead work queue slices.</summary>
public static class LeadMappingConfig
{
    public static Lead ToEntity(this CreateLeadRequest request, string leadReference, Guid organisationId) =>
        new()
        {
            OrganisationId = organisationId,
            LeadReference = leadReference,
            FirstName = request.FirstName.Trim(),
            LastName = request.LastName?.Trim(),
            DisplayName = NullIfBlank(request.DisplayName),
            MobileNumber = NormalisePhone(request.MobileNumber),
            AlternateMobileNumbers = JoinAlternateNumbers(request.AlternateMobileNumbers, request.MobileNumber),
            EmailAddress = NormaliseEmail(request.EmailAddress),
            PreferredLanguage = string.IsNullOrWhiteSpace(request.PreferredLanguage)
                ? SupportedLanguages.Default
                : request.PreferredLanguage.Trim(),
            City = request.City?.Trim(),
            GeographyCode = request.GeographyCode?.Trim(),
            Country = NullIfBlank(request.Country),
            AddressLine = NullIfBlank(request.AddressLine),
            CampaignId = request.CampaignId,
            Source = request.Source.Trim(),
            Notes = request.Notes?.Trim(),
            PreferredContactTimeUtc = request.PreferredContactTimeUtc,
            TeamCode = request.TeamCode?.Trim(),
            NextAction = request.NextAction?.Trim(),
            NextActionDueUtc = request.NextActionDueUtc,
            Status = LeadStatus.New,
            ConsentState = request.Consent?.CollectConsent == true ? ConsentState.Granted : ConsentState.NotProvided,
            ConsentEvidenceReference = request.Consent?.ConsentEvidenceReference?.Trim(),
            IsDraft = true
        };

    public static void ApplyUpdate(this UpdateLeadRequest request, Lead lead)
    {
        lead.FirstName = request.FirstName.Trim();
        lead.LastName = request.LastName?.Trim();
        lead.DisplayName = NullIfBlank(request.DisplayName);
        lead.MobileNumber = NormalisePhone(request.MobileNumber);
        lead.AlternateMobileNumbers = JoinAlternateNumbers(request.AlternateMobileNumbers, request.MobileNumber);
        lead.EmailAddress = NormaliseEmail(request.EmailAddress);
        lead.PreferredLanguage = string.IsNullOrWhiteSpace(request.PreferredLanguage)
            ? lead.PreferredLanguage
            : request.PreferredLanguage.Trim();
        lead.City = request.City?.Trim();
        lead.GeographyCode = request.GeographyCode?.Trim();
        lead.Country = NullIfBlank(request.Country);
        lead.AddressLine = NullIfBlank(request.AddressLine);
        lead.CampaignId = request.CampaignId;
        lead.Source = request.Source.Trim();
        lead.Notes = request.Notes?.Trim();
        lead.PreferredContactTimeUtc = request.PreferredContactTimeUtc;
        lead.NextAction = request.NextAction?.Trim();
        lead.NextActionDueUtc = request.NextActionDueUtc;

        if (request.Consent?.CollectConsent == true)
        {
            lead.ConsentState = ConsentState.Granted;
            lead.ConsentEvidenceReference = request.Consent.ConsentEvidenceReference?.Trim();
        }
    }

    /// <summary>
    /// One grid row.
    ///
    /// <paramref name="now"/> IS PASSED IN RATHER THAN READ FROM THE CLOCK because health decays
    /// with time: its recency component would otherwise be whatever it was when the record was
    /// last written, so a lead nobody has touched for a month would still show the score it had
    /// the day somebody last saved it. Taking the instant from the caller also keeps every row on
    /// one page scored against the same moment.
    ///
    /// THE CONTACT COLUMNS OBEY THE SAME MASK as the combined preview - <c>ContactMasking</c> is
    /// given <paramref name="canSeeContact"/> exactly as before. Splitting one masked string into
    /// three fields would be a data leak if the split forgot the mask, so neither branch here
    /// touches the raw value directly.
    /// </summary>
    public static LeadListItemResponse ToListItemResponse(
        this Lead lead,
        bool canSeeContact,
        DateTimeOffset now,
        DonorSettings settings,
        Func<string, bool>? hasPermission = null) =>
        new(
            lead.Id,
            lead.LeadReference,
            BuildContactPreview(lead, canSeeContact),
            BuildDisplayName(lead),
            ContactMasking.Phone(lead.MobileNumber, canSeeContact),
            ContactMasking.Email(lead.EmailAddress, canSeeContact),
            lead.Campaign?.Name,
            lead.OwnerUserId,
            lead.OwnerName,
            lead.Status.ToString(),
            lead.Source,
            lead.Temperature.ToString(),
            lead.DonationPotential.ToString(),
            LeadHealth.Calculate(lead, now),
            lead.NextAction,
            lead.NextActionDueUtc,
            lead.SlaState.ToString(),
            lead.LastContactOutcome.ToString(),
            lead.PreferredLanguage,
            lead.Status == LeadStatus.Converted || lead.ConvertedDonorId is not null,
            lead.ConvertedDonorId,
            lead.UpdatedAtUtc ?? lead.CreatedAtUtc,
            lead.Version,
            !canSeeContact,
            PermittedActionsFor(lead, hasPermission),
            lead.CampaignId,
            lead.CreatedAtUtc,
            IsWorked(lead)
                ? ReportingCalendar.DescribeDue(lead.NextActionDueUtc, ReportingCalendar.DateOf(now, settings), settings)
                : "None",
            LeadHealth.Band(LeadHealth.Calculate(lead, now)));

    /// <summary>
    /// Turns an SLA-state filter into the window of next-contact times it means right now.
    ///
    /// THE FILTER USED TO COMPARE A STORED COLUMN, and the stored value is only ever written when
    /// somebody saves the lead. A lead whose date passed overnight still said OnTrack in the
    /// table, so asking the queue or the board for "Overdue" left it out - while the row itself,
    /// which recalculates on read, showed it as overdue. The window is the same arithmetic as
    /// <see cref="CalculateSlaState"/>, so the filter and the badge cannot disagree.
    /// </summary>
    public static void ApplySlaWindow(LeadSearchFilter filter, DateTimeOffset now, DonorSettings settings)
    {
        if (filter.SlaState is not { } state)
        {
            return;
        }

        var dueSoon = now.AddHours(settings.SlaDueSoonHours);
        var breached = now.AddHours(-settings.SlaBreachHours);

        (filter.HasNextContact, filter.NextContactFromUtc, filter.NextContactBeforeUtc) = state switch
        {
            SlaState.NotApplicable => (false, null, null),
            SlaState.OnTrack => (true, dueSoon.AddTicks(1), null),
            SlaState.DueToday => (true, now, dueSoon.AddTicks(1)),
            SlaState.Overdue => (true, breached, now),
            SlaState.Breached => (true, null, breached),
            _ => ((bool?)null, (DateTimeOffset?)null, (DateTimeOffset?)null)
        };

        // Answered by the window above; the stored column is not consulted.
        filter.SlaState = null;
    }

    /// <summary>
    /// Still in the queue. A converted, closed or suppressed lead has no next contact to be late
    /// for, whatever date was left on the record when it stopped.
    /// </summary>
    public static bool IsWorked(Lead lead) =>
        lead.ConvertedDonorId is null
        && lead.Status is not (LeadStatus.Converted or LeadStatus.Closed or LeadStatus.Suppressed);

    public static LeadDetailResponse ToDetailResponse(
        this Lead lead,
        bool canSeeContact,
        bool canSeeEvidence,
        IReadOnlyList<Consent> consents,
        Func<string, bool>? hasPermission = null) =>
        new(
            lead.Id,
            lead.LeadReference,
            lead.FirstName,
            lead.LastName,
            ContactMasking.Phone(lead.MobileNumber, canSeeContact),
            ContactMasking.Email(lead.EmailAddress, canSeeContact),
            lead.PreferredLanguage,
            lead.City,
            lead.GeographyCode,
            lead.CampaignId,
            lead.Campaign?.Name,
            lead.Source,
            lead.ConsentState.ToString(),
            ContactMasking.Confidential(lead.ConsentEvidenceReference, canSeeEvidence),
            ContactMasking.Confidential(lead.Notes, canSeeEvidence),
            lead.PreferredContactTimeUtc,
            lead.DuplicateCandidateSummary,
            lead.Status.ToString(),
            lead.OwnerUserId,
            lead.OwnerName,
            lead.TeamCode,
            lead.NextAction,
            lead.NextActionDueUtc,
            lead.SlaState.ToString(),
            lead.LastContactOutcome.ToString(),
            lead.LastContactedAtUtc,
            lead.AcceptedAtUtc,
            lead.QualifiedAtUtc,
            lead.ConvertedDonorId,
            lead.ConvertedAtUtc,
            lead.ClosureReason,
            lead.IsDraft,
            lead.CreatedAtUtc,
            lead.CreatedByUserId,
            lead.UpdatedAtUtc,
            lead.UpdatedByUserId,
            lead.Version,
            !canSeeContact,
            !canSeeEvidence,
            [.. consents.Select(ToConsentSummary)],
            PermittedActionsFor(lead, hasPermission),
            BuildDisplayName(lead),
            [.. SplitAlternateNumbers(lead.AlternateMobileNumbers)
                .Select(number => ContactMasking.Phone(number, canSeeContact) ?? string.Empty)],
            lead.Country,
            ContactMasking.Confidential(lead.AddressLine, canSeeContact));

    public static LeadConsentSummaryResponse ToConsentSummary(Consent consent) =>
        new(
            consent.Id,
            consent.Channel.ToString(),
            consent.ConsentState.ToString(),
            consent.Status.ToString(),
            consent.NoticeVersion,
            consent.EffectiveAtUtc,
            consent.ExpiryAtUtc);

    public static LeadLookupResponse ToLookupResponse(this Lead lead) =>
        new(lead.Id, lead.LeadReference, BuildDisplayName(lead), lead.Status.ToString());

    /// <summary>
    /// Which queue actions the lead's current state allows. UI section 5.5: a state moves only
    /// through a named action, so the list here is the state machine the buttons follow.
    ///
    /// AND WHICH OF THEM THIS CALLER HOLDS, when <paramref name="hasPermission"/> is given. The
    /// list was the state machine alone, so a Fundraiser Executive's rows went on offering Close -
    /// a Fundraising Manager's act - and a Manager's rows Convert, which creates a donor and is the
    /// Executive's. The endpoints refused both; the row should not have offered them.
    /// </summary>
    public static IReadOnlyList<string> PermittedActionsFor(Lead lead, Func<string, bool>? hasPermission = null)
    {
        IReadOnlyList<string> byState = lead.Status switch
        {
            LeadStatus.New => ["Accept", "Assign", "Contact", "Close"],
            LeadStatus.Assigned => ["Contact", "Assign", "Qualify", "Close"],
            LeadStatus.Contacted => ["Qualify", "Contact", "Assign", "Close"],
            LeadStatus.Qualified => ["Convert", "Contact", "Assign", "Close"],
            LeadStatus.Nurture => ["Contact", "Assign", "Qualify", "Close"],
            LeadStatus.Converted => ["Open donor"],
            LeadStatus.Closed => ["View"],
            LeadStatus.Suppressed => ["View"],
            _ => ["View"]
        };

        return hasPermission is null
            ? byState
            : [.. byState.Where(action => IsHeld(action, hasPermission))];
    }

    /// <summary>The permission each queue action is enforced with, matching the controller.</summary>
    private static bool IsHeld(string action, Func<string, bool> hasPermission) => action switch
    {
        "Accept" => hasPermission(PermissionCodes.LeadWorkQueueAccept),
        "Assign" => hasPermission(PermissionCodes.LeadWorkQueueAssign),
        "Contact" => hasPermission(PermissionCodes.LeadWorkQueueContact),
        "Qualify" => hasPermission(PermissionCodes.LeadWorkQueueQualify),
        "Close" => hasPermission(PermissionCodes.LeadWorkQueueClose),
        "Convert" => hasPermission(PermissionCodes.DonorsCreate),
        _ => true
    };

    /// <summary>
    /// The SLA badge. Derived from the due date every time it is read rather than stored and
    /// left to go stale, because "overdue" changes without anybody touching the record.
    /// </summary>
    public static SlaState CalculateSlaState(DateTimeOffset? dueAtUtc, DateTimeOffset now, DonorSettings settings)
    {
        if (dueAtUtc is null)
        {
            return SlaState.NotApplicable;
        }

        var hoursRemaining = (dueAtUtc.Value - now).TotalHours;

        return hoursRemaining switch
        {
            _ when hoursRemaining < -settings.SlaBreachHours => SlaState.Breached,
            _ when hoursRemaining < 0 => SlaState.Overdue,
            _ when hoursRemaining <= settings.SlaDueSoonHours => SlaState.DueToday,
            _ => SlaState.OnTrack
        };
    }

    /// <summary>
    /// What a contact with the lead does to it: its last contact moves on, a new or assigned lead
    /// becomes Contacted, and "do not contact" suppresses it so nobody rings again next week.
    ///
    /// ONE RULE, used by every place that records a conversation - logging on the timeline and
    /// executing a follow-up - so the lead reads the same whichever door the conversation came in by.
    /// </summary>
    public static void RecordContact(
        this Lead lead,
        ContactOutcome outcome,
        DateTimeOffset occurredAtUtc,
        DateTimeOffset now,
        DonorSettings settings)
    {
        if (lead.LastContactedAtUtc is null || occurredAtUtc >= lead.LastContactedAtUtc)
        {
            lead.LastContactOutcome = outcome;
            lead.LastContactedAtUtc = occurredAtUtc;
        }

        if (lead.Status is LeadStatus.New or LeadStatus.Assigned)
        {
            lead.Status = LeadStatus.Contacted;
        }

        if (outcome == ContactOutcome.DoNotContact)
        {
            lead.Status = LeadStatus.Suppressed;
        }

        lead.SlaState = CalculateSlaState(lead.NextActionDueUtc, now, settings);
    }

    /// <summary>Open-work count to workload band, using the configured thresholds.</summary>
    public static WorkloadBand CalculateWorkloadBand(int openWorkCount, DonorSettings settings) =>
        openWorkCount switch
        {
            _ when openWorkCount <= settings.WorkloadLightThreshold => WorkloadBand.Light,
            _ when openWorkCount <= settings.WorkloadBalancedThreshold => WorkloadBand.Balanced,
            _ when openWorkCount <= settings.WorkloadHeavyThreshold => WorkloadBand.Heavy,
            _ => WorkloadBand.Overloaded
        };

    /// <summary>
    /// The name every list, drawer and export shows for a lead.
    ///
    /// THE CAPTURED DISPLAY NAME WINS when there is one: the capture form asks for it precisely
    /// because the way a person wants to be addressed is not always first name plus last name.
    /// Leads captured before the field was stored, and every bulk row, have none and read as
    /// they always did.
    /// </summary>
    public static string BuildDisplayName(Lead lead) =>
        !string.IsNullOrWhiteSpace(lead.DisplayName)
            ? lead.DisplayName.Trim()
            : string.Join(' ', new[] { lead.FirstName, lead.LastName }.Where(part => !string.IsNullOrWhiteSpace(part)));

    /// <summary>The other numbers as one stored value: normalised, without blanks, repeats or the primary.</summary>
    public static string? JoinAlternateNumbers(IEnumerable<string>? numbers, string? primary)
    {
        if (numbers is null)
        {
            return null;
        }

        var primaryNumber = NormalisePhone(primary);

        var kept = numbers
            .Select(NormalisePhone)
            .Where(number => !string.IsNullOrWhiteSpace(number) && number != primaryNumber)
            .Distinct()
            .ToList();

        return kept.Count == 0 ? null : string.Join(',', kept);
    }

    public static IReadOnlyList<string> SplitAlternateNumbers(string? stored) =>
        string.IsNullOrWhiteSpace(stored)
            ? []
            : stored.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// "Name and contact preview" for the grid. The name is internal, the contact detail is
    /// restricted, so the preview shows the name in full and the contact masked unless the
    /// caller holds don.donors.view-sensitive-contact.
    /// </summary>
    private static string BuildContactPreview(Lead lead, bool canSeeContact)
    {
        var name = BuildDisplayName(lead);
        var contact = !string.IsNullOrWhiteSpace(lead.MobileNumber)
            ? ContactMasking.Phone(lead.MobileNumber, canSeeContact)
            : ContactMasking.Email(lead.EmailAddress, canSeeContact);

        return string.IsNullOrWhiteSpace(contact) ? name : $"{name} · {contact}";
    }

    private static string? NormaliseEmail(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : EmailValue.TryParse(value)?.Value ?? value.Trim().ToLowerInvariant();

    private static string? NormalisePhone(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : PrimaryPhoneValue.TryParse(value)?.Value ?? value.Trim();
}
