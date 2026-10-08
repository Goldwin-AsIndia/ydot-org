using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Settings;
using YDots.DON.Domain.Entities;
using YDots.DON.Domain.Enums;
using static YDots.DON.Infrastructure.Persistence.Seed.DemoDonorCatalogue;

namespace YDots.DON.Infrastructure.Persistence.Seed;

/// <summary>What one attempt at seeding the demonstration donors and leads came to.</summary>
public enum DemoSeedOutcome
{
    /// <summary><c>SeedSettings:CreateSampleData</c> is off. Nothing was looked at.</summary>
    Disabled,

    /// <summary>IAM has not created an Organisation or its people yet. Try again shortly.</summary>
    Waiting,

    /// <summary>
    /// The donors and leads are in, and their giving totals are not: PAY has not seeded the
    /// demonstration donations those totals are read from. Try again shortly.
    /// </summary>
    AwaitingDonations,

    /// <summary>Every Organisation in the catalogue holds its demonstration data.</summary>
    Completed
}

/// <summary>
/// Writes <see cref="DemoDonorCatalogue"/> into the two activated sample Organisations: donors
/// with their contacts, consent, tags, identity checks, pledges and documents; leads with their
/// assignment history and conversations; and the follow-up tasks owed to both.
///
/// IT WAITS FOR IAM. Every row names a real Organisation and a real relationship owner, and IAM
/// generates all of those ids after this service has already started. Where they are not there
/// yet this reports <see cref="DemoSeedOutcome.Waiting"/>, and <see cref="DemoDataSeedingService"/>
/// asks again.
///
/// THE GIVING TOTALS ARE READ FROM PAY, NOT INVENTED HERE. A donor's lifetime giving on the Donor
/// List and on Donor 360 comes from a projection table this module owns and the donations module
/// feeds; seeding figures into it by hand would let them disagree with the donations a donor can
/// open on Payments and Receipts. <see cref="ProjectGivingAsync"/> therefore adds up the
/// demonstration donations PAY has actually written, and waits for them where they are not there
/// yet - which is the second, shorter wait this seeder reports.
///
/// ONCE PER ORGANISATION, AND ALL OF IT OR NONE. An Organisation that already holds any
/// demonstration donor is left exactly as it is, so a record somebody approved, merged or
/// archived during a demonstration is never put back; and one Organisation's set is one save.
///
/// THE ROWS ARE WRITTEN AS BUILT. <see cref="SaveAsBuiltAsync"/> goes round the context's audit
/// stamp, which would otherwise set every CreatedAtUtc to this minute and flatten months of
/// history into one.
/// </summary>
public sealed class DemoDonorSeeder(
    DonDbContext context,
    IOptions<SeedSettings> seedOptions,
    IOptions<DonorSettings> donorOptions,
    ILogger<DemoDonorSeeder> logger)
{
    /// <summary>The offset every time of day below is chosen in: the Organisations work in IST.</summary>
    private static readonly TimeSpan IndiaOffset = TimeSpan.FromMinutes(330);

    private const string Currency = "INR";

    private readonly SeedSettings _seed = seedOptions.Value;
    private readonly DonorSettings _settings = donorOptions.Value;

    public async Task<DemoSeedOutcome> SeedAsync(CancellationToken cancellationToken = default)
    {
        if (!_seed.CreateSampleData)
        {
            return DemoSeedOutcome.Disabled;
        }

        var waiting = false;
        var awaitingDonations = false;

        foreach (var organisation in Organisations)
        {
            var organisationId = await ReadOrganisationIdAsync(organisation.Subdomain, cancellationToken);

            if (organisationId is null
                || !await SeedOrganisationAsync(organisation, organisationId.Value, cancellationToken))
            {
                waiting = true;
                continue;
            }

            awaitingDonations |= !await ProjectGivingAsync(organisation, organisationId.Value, cancellationToken);
        }

        return waiting ? DemoSeedOutcome.Waiting
            : awaitingDonations ? DemoSeedOutcome.AwaitingDonations
            : DemoSeedOutcome.Completed;
    }

    // =============================================================================================
    // Donors, leads and follow-ups
    // =============================================================================================

    /// <summary>False means "not yet": one of the Organisation's people is not there.</summary>
    private async Task<bool> SeedOrganisationAsync(
        DemoOrganisation organisation, Guid organisationId, CancellationToken cancellationToken)
    {
        var donorIds = DonorIds(organisation);

        var alreadySeeded = await context.Donors
            .IgnoreQueryFilters()
            .AnyAsync(donor => donor.OrganisationId == organisationId && donorIds.Contains(donor.Id),
                cancellationToken);

        if (alreadySeeded)
        {
            return true;
        }

        var people = await ReadPeopleAsync(organisationId, cancellationToken);
        var missingPeople = RequiredUsernames(organisation).Where(name => !people.ContainsKey(name)).ToList();

        if (missingPeople.Count > 0)
        {
            logger.LogDebug(
                "The demonstration donors for {Subdomain} are waiting for {Count} account(s) IAM "
                + "has not created yet: {Usernames}.",
                organisation.Subdomain, missingPeople.Count, string.Join(", ", missingPeople));

            return false;
        }

        var now = DateTimeOffset.UtcNow;

        var batch = new Batch(
            organisation,
            organisationId,
            people,
            now,
            await CampaignIdsAsync(organisation, organisationId, now, cancellationToken),
            await NextInOrganisationAsync(
                context.Donors.IgnoreQueryFilters()
                    .Where(donor => donor.OrganisationId == organisationId)
                    .Select(donor => donor.DonorNumber),
                _settings.DonorNumberPrefix, now.Year, first: 1, cancellationToken),
            await NextInOrganisationAsync(
                context.Leads.IgnoreQueryFilters()
                    .Where(lead => lead.OrganisationId == organisationId)
                    .Select(lead => lead.LeadReference),
                _settings.LeadReferencePrefix, now.Year, first: 1, cancellationToken),
            await NextInOrganisationAsync(
                context.FollowUpTasks.IgnoreQueryFilters().Select(task => task.FollowUpReference),
                _settings.FollowUpReferencePrefix, now.Year, organisation.ReferenceBase, cancellationToken),
            await NextInOrganisationAsync(
                context.DonorIdentityVerifications.IgnoreQueryFilters()
                    .Select(verification => verification.VerificationReference),
                _settings.VerificationReferencePrefix, now.Year, organisation.ReferenceBase, cancellationToken),
            await NextInOrganisationAsync(
                context.DonorPromises.IgnoreQueryFilters().Select(promise => promise.Reference),
                "PRM", now.Year, organisation.ReferenceBase, cancellationToken),
            await NextInOrganisationAsync(
                context.DonorMergeCases.IgnoreQueryFilters().Select(mergeCase => mergeCase.ReviewReference),
                _settings.MergeCaseReferencePrefix, now.Year, organisation.ReferenceBase, cancellationToken));

        var donors = AddDonors(batch);
        var leads = AddLeads(batch, donors);

        AddStewardship(batch, donors);
        AddPromises(batch, donors);
        AddDocuments(batch, donors);
        AddDuplicateReview(batch, donors);

        await SaveAsBuiltAsync(cancellationToken);

        logger.LogInformation(
            "Seeded the demonstration data for {Subdomain}: {DonorCount} donor(s), {LeadCount} "
            + "lead(s) across {StatusCount} pipeline stages and {FollowUpCount} follow-up task(s).",
            organisation.Subdomain,
            donors.Count,
            leads.Count,
            leads.Values.Select(lead => lead.Status).Distinct().Count(),
            batch.FollowUps.Issued);

        return true;
    }

    private Dictionary<string, Donor> AddDonors(Batch batch)
    {
        var donors = new Dictionary<string, Donor>(StringComparer.OrdinalIgnoreCase);
        var manager = batch.People[batch.Organisation.Manager];

        foreach (var seed in batch.Organisation.Donors)
        {
            var owner = seed.Owner is null ? null : batch.People[seed.Owner];
            var createdAt = Moment(batch.Now, seed.Joined, seed.IdKey + "|created");

            var donor = new Donor
            {
                Id = DemoIds.Of("donor", batch.Organisation.Subdomain, seed.IdKey),
                OrganisationId = batch.OrganisationId,
                DonorNumber = batch.DonorNumbers.Next(),
                DonorType = seed.Type,
                FirstName = seed.First,
                LastName = seed.Last,
                OrganisationName = seed.Organisation,
                PrimaryEmail = seed.Email,
                PrimaryPhone = ToE164(seed.Mobile),
                PreferredLanguage = seed.Language,
                Status = seed.Status,
                ApprovalState = seed.Approval,
                DoNotContact = seed.DoNotContact,
                RelationshipOwnerUserId = owner?.Id,
                RelationshipOwnerName = owner?.Name,
                SourceLeadId = seed.FromLead is null
                    ? null
                    : DemoIds.Of("lead", batch.Organisation.Subdomain, seed.FromLead),
                NormalizedBusinessKey = BusinessKey(seed),
                Notes = seed.Notes,
                CancellationReason = seed.Approval == ApprovalState.Cancelled ? seed.Reason : null,
                ArchiveReason = seed.Status == DonorStatus.Archived ? seed.Reason : null,
                CreatedAtUtc = createdAt,

                // A donor a completed donation created was created by nobody signed in, which is
                // what the payments module records for one.
                CreatedByUserId = seed.CreatedByGift ? Guid.Empty : (owner ?? manager).Id,
                Version = 1
            };

            // Submitted the same day and decided the next, by the Fundraising Manager - who is
            // never the owner of a record they approve unless it is their own, and those were
            // approved by the Organisation Admin.
            if (seed.Approval != ApprovalState.NotSubmitted)
            {
                donor.SubmittedAtUtc = seed.CreatedByGift ? createdAt : createdAt.AddHours(2);
                donor.UpdatedAtUtc = donor.SubmittedAtUtc;
                donor.UpdatedByUserId = donor.CreatedByUserId;
                donor.Version++;
            }

            if (seed.Approval is ApprovalState.Approved or ApprovalState.Rejected or ApprovalState.Cancelled)
            {
                var approver = seed.Owner == batch.Organisation.Manager
                    ? batch.People[batch.Organisation.Administrator]
                    : manager;

                var decidedAt = seed.CreatedByGift
                    ? createdAt
                    : Moment(batch.Now, Math.Max(0, seed.Joined - 1), seed.IdKey + "|decided");

                if (seed.Approval == ApprovalState.Approved)
                {
                    donor.ApprovedAtUtc = decidedAt;
                    donor.ApprovedByUserId = seed.CreatedByGift ? null : approver.Id;
                }

                donor.UpdatedAtUtc = decidedAt;
                donor.UpdatedByUserId = seed.CreatedByGift ? Guid.Empty : approver.Id;
                donor.Version++;
            }

            // Restricted, archived and merged records were last touched when that happened.
            if (seed.Status is DonorStatus.Restricted or DonorStatus.Archived or DonorStatus.Merged)
            {
                donor.UpdatedAtUtc = Moment(batch.Now, Math.Min(12, Math.Max(1, seed.Joined / 2)), seed.IdKey + "|closed");
                donor.UpdatedByUserId = manager.Id;
                donor.Version++;
            }

            donors[seed.IdKey] = donor;
            context.Donors.Add(donor);

            AddContacts(batch, seed, donor);
            AddTags(batch, seed, donor);
            AddConsents(batch, seed, donor, owner ?? manager);
            AddVerification(batch, seed, donor, owner ?? manager);
            AddConversations(batch, seed, donor, owner);
        }

        foreach (var seed in batch.Organisation.Donors.Where(item => item.MergedInto is not null))
        {
            donors[seed.IdKey].MergedIntoDonorId = donors[seed.MergedInto!].Id;
        }

        return donors;
    }

    private void AddContacts(Batch batch, DemoDonor seed, Donor donor)
    {
        if (seed.Address is not null)
        {
            context.DonorContacts.Add(new DonorContact
            {
                Id = DemoIds.Of("donor-contact", batch.Organisation.Subdomain, seed.IdKey + "|address"),
                DonorId = donor.Id,
                Name = seed.Type == DonorType.Organisation ? "Registered office" : "Postal address",
                Description = "For posted receipts and the annual report.",
                Status = DonorContactStatus.Active,
                Channel = ContactChannel.PostalAddress,
                Value = seed.Address,
                IsPrimary = false,
                IsVerified = false,
                CreatedAtUtc = donor.CreatedAtUtc,
                CreatedByUserId = donor.CreatedByUserId,
                Version = 1
            });
        }

        if (donor.PrimaryPhone is not null && Marks(seed).Any(mark => mark is ('W', '+')))
        {
            context.DonorContacts.Add(new DonorContact
            {
                Id = DemoIds.Of("donor-contact", batch.Organisation.Subdomain, seed.IdKey + "|whatsapp"),
                DonorId = donor.Id,
                Name = "WhatsApp number",
                Description = "The donor's preferred number for updates on WhatsApp.",
                Status = DonorContactStatus.Active,
                Channel = ContactChannel.WhatsApp,
                Value = donor.PrimaryPhone,
                IsPrimary = false,
                IsVerified = true,
                VerifiedAtUtc = donor.CreatedAtUtc.AddDays(1),
                CreatedAtUtc = donor.CreatedAtUtc,
                CreatedByUserId = donor.CreatedByUserId,
                Version = 1
            });
        }
    }

    private void AddTags(Batch batch, DemoDonor seed, Donor donor)
    {
        foreach (var code in seed.Tags ?? [])
        {
            var (name, description) = Tags[code];

            context.DonorTags.Add(new DonorTag
            {
                Id = DemoIds.Of("donor-tag", batch.Organisation.Subdomain, $"{seed.IdKey}|{code}"),
                DonorId = donor.Id,
                Code = code,
                Name = name,
                Description = description,
                Status = DonorTagStatus.Active,
                CreatedAtUtc = donor.CreatedAtUtc,
                CreatedByUserId = donor.CreatedByUserId,
                Version = 1
            });
        }
    }

    /// <summary>
    /// The donor's consent records, one per channel they were asked about.
    ///
    /// A CORRECTION IS TWO ROWS, NOT AN EDIT. Consent is append-only in the product: the earlier
    /// record is marked Superseded and points at the one that replaced it, which is what the
    /// <c>s</c> mark seeds - so the consent centre has a history to show rather than only a
    /// present state.
    /// </summary>
    private void AddConsents(Batch batch, DemoDonor seed, Donor donor, Person capturedBy)
    {
        var recognised = (seed.Tags ?? []).Any(tag => tag is "MAJOR_GIVER" or "CORPORATE");

        foreach (var (letter, mark) in Marks(seed))
        {
            var channel = ChannelOf(letter);
            var key = $"{seed.IdKey}|{channel}";
            var effectiveAt = donor.CreatedAtUtc.AddMinutes(30);

            Consent Row(string salt, ConsentStatus status, ConsentState state, string evidence) =>
                new()
                {
                    Id = DemoIds.Of("consent", batch.Organisation.Subdomain, key + salt),
                    DonorId = donor.Id,
                    OrganisationId = batch.OrganisationId,
                    Name = $"{Label(channel)} consent - {donor.DonorNumber}",
                    Status = status,
                    Purpose = "Fundraising updates, impact reports and appeal communication.",
                    Channel = channel,
                    ConsentState = state,
                    NoticeVersion = _settings.CurrentNoticeVersion,
                    EvidenceSource = evidence,
                    EvidenceReference = $"EVD-{donor.DonorNumber}-{letter}",
                    EffectiveAtUtc = effectiveAt,
                    PublicRecognitionPreference = recognised,
                    CapturedByUserId = capturedBy.Id,
                    CapturedByName = capturedBy.Name,
                    CreatedAtUtc = effectiveAt,
                    CreatedByUserId = capturedBy.Id,
                    Version = 1
                };

            switch (mark)
            {
                case '+':
                    context.Consents.Add(Row(string.Empty, ConsentStatus.Active, ConsentState.Granted, Evidence(channel)));
                    break;

                case '?':
                    context.Consents.Add(Row(string.Empty, ConsentStatus.Active, ConsentState.Pending, Evidence(channel)));
                    break;

                case '-':
                    var withdrawn = Row(string.Empty, ConsentStatus.Withdrawn, ConsentState.Withdrawn, Evidence(channel));
                    withdrawn.WithdrawnAtUtc = Moment(batch.Now, Math.Min(10, Math.Max(1, seed.Joined - 2)), key + "|withdrawn");
                    withdrawn.WithdrawalReason = $"The donor asked not to be contacted by {Label(channel).ToLowerInvariant()}.";
                    withdrawn.UpdatedAtUtc = withdrawn.WithdrawnAtUtc;
                    withdrawn.UpdatedByUserId = capturedBy.Id;
                    withdrawn.Version = 2;
                    context.Consents.Add(withdrawn);
                    break;

                case 'x':
                    var expired = Row(string.Empty, ConsentStatus.Expired, ConsentState.Granted, Evidence(channel));
                    expired.ExpiryAtUtc = Moment(batch.Now, Math.Min(20, Math.Max(1, seed.Joined - 2)), key + "|expired");
                    context.Consents.Add(expired);
                    break;

                case 's':
                    var replacement = Row("|corrected", ConsentStatus.Active, ConsentState.Granted, "Signed paper consent form");
                    replacement.EffectiveAtUtc = Moment(batch.Now, Math.Max(1, seed.Joined / 2), key + "|corrected");
                    replacement.CreatedAtUtc = replacement.EffectiveAtUtc;
                    replacement.CorrectionReason =
                        "Replaced the consent taken by telephone with the signed form the donor returned.";

                    var original = Row(string.Empty, ConsentStatus.Superseded, ConsentState.Granted, "Telephone call, recorded");
                    original.SupersededByConsentId = replacement.Id;
                    original.UpdatedAtUtc = replacement.EffectiveAtUtc;
                    original.UpdatedByUserId = capturedBy.Id;
                    original.Version = 2;

                    context.Consents.Add(original);
                    context.Consents.Add(replacement);
                    break;
            }
        }
    }

    /// <summary>
    /// One identity check, in the state the catalogue names.
    ///
    /// NO CHALLENGE CODE IS STORED, hashed or otherwise. The product keeps only a hash of the
    /// code it sent, and there was no code here to hash - a seeded hash would be a value nothing
    /// could ever match.
    /// </summary>
    private void AddVerification(Batch batch, DemoDonor seed, Donor donor, Person reviewer)
    {
        if (seed.Verified is not { } check)
        {
            return;
        }

        var sentAt = check.Status == VerificationStatus.ChallengeSent
            ? batch.Now.AddMinutes(-2)
            : Moment(batch.Now, check.DaysAgo, seed.IdKey + "|verification");

        var validFor = TimeSpan.FromMinutes(_settings.VerificationCodeValidMinutes);
        var started = check.Status != VerificationStatus.NotStarted;

        var verification = new DonorIdentityVerification
        {
            Id = DemoIds.Of("verification", batch.Organisation.Subdomain, seed.IdKey),
            OrganisationId = batch.OrganisationId,
            VerificationReference = batch.Verifications.Next(),
            DonorId = donor.Id,
            VerificationPurpose = seed.Type == DonorType.Organisation
                ? "Confirm the signatory's authority before the partnership agreement is recorded."
                : "Confirm the donor's identity before contact details and the 80G receipt are changed.",
            VerificationChannel = check.Channel,
            MaskedDestination = check.Channel == VerificationChannel.Email
                ? MaskEmail(donor.PrimaryEmail)
                : MaskPhone(donor.PrimaryPhone),
            Status = check.Status,
            AttemptCount = check.Status switch
            {
                VerificationStatus.Verified => 1 + (donor.DonorNumber[^1] % 2),
                VerificationStatus.Failed => _settings.VerificationMaxAttempts,
                VerificationStatus.Escalated => 3,
                _ => 0
            },
            IdentityConfidence = check.Status switch
            {
                VerificationStatus.Verified => IdentityConfidence.High,
                VerificationStatus.Failed or VerificationStatus.Escalated => IdentityConfidence.Low,
                _ => IdentityConfidence.Unknown
            },
            ReviewerUserId = started ? reviewer.Id : null,
            ReviewerName = started ? reviewer.Name : null,
            SentAtUtc = started ? sentAt : null,
            ExpiryAtUtc = started ? sentAt.Add(validFor) : null,
            VerifiedAtUtc = check.Status == VerificationStatus.Verified ? sentAt.AddMinutes(3) : null,
            EscalationReason = check.Status == VerificationStatus.Escalated
                ? "The code was entered incorrectly three times and the donor could not be reached "
                  + "on the registered number; escalated for a manual check."
                : null,
            CancellationReason = check.Status == VerificationStatus.Cancelled
                ? "Started in error: the donor's details did not need to change."
                : null,
            EvidenceReference = check.Channel == VerificationChannel.PhoneCall
                ? $"CALL-{donor.DonorNumber}"
                : null,
            CreatedAtUtc = started ? sentAt : Moment(batch.Now, check.DaysAgo, seed.IdKey + "|verification"),
            CreatedByUserId = reviewer.Id,
            Version = 1
        };

        if (check.Status is not (VerificationStatus.NotStarted or VerificationStatus.ChallengeSent))
        {
            verification.UpdatedAtUtc = sentAt.AddMinutes(check.Status == VerificationStatus.Expired ? 10 : 4);
            verification.UpdatedByUserId = reviewer.Id;
            verification.Version = 2;
        }

        context.DonorIdentityVerifications.Add(verification);
    }

    /// <summary>
    /// The conversations an established donor has already had, so Donor 360 and the
    /// communication timeline open on a relationship rather than on a blank.
    /// </summary>
    private void AddConversations(Batch batch, DemoDonor seed, Donor donor, Person? owner)
    {
        if (owner is null || seed.Status != DonorStatus.Active || seed.Joined <= 10)
        {
            return;
        }

        var marks = Marks(seed).ToList();

        if (seed.Type == DonorType.Organisation)
        {
            AddConversation(batch, donor.Id, null, seed.IdKey + "|review", owner,
                "Partnership review meeting",
                "Reviewed the year's programme report and the reporting calendar with the CSR team.",
                InteractionType.Meeting, null, ContactOutcome.Reached,
                Moment(batch.Now, Math.Min(35, seed.Joined - 2), seed.IdKey + "|review"));

            return;
        }

        AddConversation(batch, donor.Id, null, seed.IdKey + "|welcome", owner,
            "Welcome call",
            "Thanked the donor for their first gift and confirmed how they would like to hear from us.",
            InteractionType.Call, ConsentChannel.PhoneCall, ContactOutcome.Reached,
            Moment(batch.Now, seed.Joined - 1, seed.IdKey + "|welcome"));

        if (marks.Any(mark => mark is ('E', '+') or ('E', 's')))
        {
            AddConversation(batch, donor.Id, null, seed.IdKey + "|impact", owner,
                "Impact update e-mail",
                "Sent the quarterly impact update with a summary of the donor's receipts.",
                InteractionType.Email, ConsentChannel.Email, ContactOutcome.Reached,
                Moment(batch.Now, Math.Min(18, seed.Joined - 3), seed.IdKey + "|impact"));
        }

        if (marks.Any(mark => mark is ('W', '+')))
        {
            AddConversation(batch, donor.Id, null, seed.IdKey + "|greeting", owner,
                "WhatsApp update",
                "Shared a short video from the programme the donor supports.",
                InteractionType.WhatsApp, ConsentChannel.WhatsApp, ContactOutcome.Reached,
                Moment(batch.Now, Math.Min(6, seed.Joined - 4), seed.IdKey + "|greeting"));
        }
    }

    private void AddConversation(
        Batch batch, Guid? donorId, Guid? leadId, string key, Person by, string name,
        string description, InteractionType type, ConsentChannel? channel, ContactOutcome outcome,
        DateTimeOffset at) =>
        context.DonorInteractions.Add(new DonorInteraction
        {
            Id = DemoIds.Of("interaction", batch.Organisation.Subdomain, key),
            DonorId = donorId,
            LeadId = leadId,
            OrganisationId = batch.OrganisationId,
            Name = name,
            Description = description,
            Status = DonorInteractionStatus.Completed,
            InteractionType = type,
            Channel = channel,
            OccurredAtUtc = at,
            Outcome = outcome,
            PerformedByUserId = by.Id,
            PerformedByName = by.Name,
            CreatedAtUtc = at,
            CreatedByUserId = by.Id,
            Version = 1
        });

    /// <summary>
    /// The leads, and everything a lead row implies: its assignment history, the conversation
    /// behind its last contact, its consent, and the follow-up tasks either side of today.
    /// </summary>
    private Dictionary<string, Lead> AddLeads(Batch batch, IReadOnlyDictionary<string, Donor> donors)
    {
        var leads = new Dictionary<string, Lead>(StringComparer.OrdinalIgnoreCase);
        var manager = batch.People[batch.Organisation.Manager];
        var position = 0;

        foreach (var seed in batch.Organisation.Leads)
        {
            position++;

            var owner = seed.Owner is null ? null : batch.People[seed.Owner];
            var capturedAt = Moment(batch.Now, seed.Captured, seed.IdKey + "|captured");
            var contactedAt = seed.Contacted is { } contacted
                ? Moment(batch.Now, contacted, seed.IdKey + "|contacted")
                : (DateTimeOffset?)null;
            var dueAt = seed.Due is { } due ? Due(batch.Now, due) : (DateTimeOffset?)null;
            var converted = seed.ConvertedTo is null ? null : donors[seed.ConvertedTo];
            var settled = seed.Status is LeadStatus.Converted or LeadStatus.Closed or LeadStatus.Suppressed;

            var lead = new Lead
            {
                Id = DemoIds.Of("lead", batch.Organisation.Subdomain, seed.IdKey),
                OrganisationId = batch.OrganisationId,
                LeadReference = batch.LeadReferences.Next(),
                FirstName = seed.First,
                LastName = seed.Last,
                MobileNumber = ToE164(seed.Mobile),
                EmailAddress = seed.Email,
                PreferredLanguage = seed.Language,
                City = seed.City,
                CampaignId = batch.CampaignIds[seed.Campaign],
                Source = seed.Source,
                ConsentState = seed.Consent,
                ConsentEvidenceReference = seed.Consent == ConsentState.Granted
                    ? $"OPTIN-{position:0000}"
                    : null,
                Notes = seed.Notes,
                Status = seed.Status,
                Temperature = seed.Temperature,
                DonationPotential = seed.Potential,
                OwnerUserId = owner?.Id,
                OwnerName = owner?.Name,
                TeamCode = seed.Owner is null ? null : batch.Organisation.Teams.GetValueOrDefault(seed.Owner),
                NextAction = settled ? null : seed.NextAction,
                NextActionDueUtc = settled ? null : dueAt,

                // The product recalculates this on every read; the stored value is what the
                // queue's SLA filter matches on, so it is written the way the product writes it.
                SlaState = settled ? SlaState.NotApplicable : Sla(dueAt, batch.Now),

                LastContactOutcome = seed.LastOutcome,
                LastContactedAtUtc = contactedAt,
                AcceptedAtUtc = owner is null ? null : capturedAt.AddHours(3),
                QualifiedAtUtc = seed.Status is LeadStatus.Qualified or LeadStatus.Converted ? contactedAt : null,
                ConvertedDonorId = converted?.Id,
                ConvertedAtUtc = converted?.CreatedAtUtc,
                ClosureReason = seed.Closure,
                IsDraft = false,
                CreatedAtUtc = capturedAt,

                // Captured by its owner where it has one; the unassigned pool came in through
                // forms and imports the Fundraising Manager brought into the queue.
                CreatedByUserId = (owner ?? manager).Id,
                Version = 1
            };

            if (converted?.CreatedAtUtc is { } convertedAt && convertedAt < (contactedAt ?? capturedAt))
            {
                // A conversion cannot precede the conversation that led to it.
                lead.ConvertedAtUtc = (contactedAt ?? capturedAt).AddHours(1);
            }

            var touchedAt = lead.ConvertedAtUtc ?? contactedAt ?? lead.AcceptedAtUtc;

            if (touchedAt is not null)
            {
                lead.UpdatedAtUtc = touchedAt;
                lead.UpdatedByUserId = (owner ?? manager).Id;
                lead.Version++;
            }

            leads[seed.IdKey] = lead;
            context.Leads.Add(lead);

            if (owner is null)
            {
                continue;
            }

            AddAssignments(batch, seed, lead, owner, manager, position);
            AddLeadConsent(batch, seed, lead, converted, owner);

            if (contactedAt is not null)
            {
                AddLeadConversation(batch, seed, lead, owner, contactedAt.Value);
            }

            AddLeadFollowUps(batch, seed, lead, converted, owner, contactedAt, dueAt);
        }

        return leads;
    }

    /// <summary>
    /// Who the lead has belonged to. Append-only in the product, so a lead that changed hands
    /// carries both rows and the Assignment Board's history has something to inspect.
    /// </summary>
    private void AddAssignments(
        Batch batch, DemoLead seed, Lead lead, Person owner, Person manager, int position)
    {
        var assignedAt = lead.AcceptedAtUtc!.Value;
        var previous = seed.PreviousOwner is null ? null : batch.People[seed.PreviousOwner];

        LeadAssignment Row(string salt, Person? from, Person to, string reason, DateTimeOffset at, bool bulk) =>
            new()
            {
                Id = DemoIds.Of("lead-assignment", batch.Organisation.Subdomain, seed.IdKey + salt),
                OrganisationId = batch.OrganisationId,
                LeadId = lead.Id,
                PreviousOwnerUserId = from?.Id,
                PreviousOwnerName = from?.Name,
                NewOwnerUserId = to.Id,
                NewOwnerName = to.Name,
                AssignmentReason = reason,
                EffectiveAtUtc = at,
                AssignedByUserId = manager.Id,
                IsBulkRoute = bulk,
                CreatedAtUtc = at,
                CreatedByUserId = manager.Id,
                Version = 1
            };

        var team = batch.Organisation.Teams.GetValueOrDefault(seed.Owner!, "fundraising");

        if (previous is null)
        {
            // Every fourth lead arrived in a bulk route, which is how a morning's web enquiries
            // are normally handed out.
            var bulk = position % 4 == 0;

            context.LeadAssignments.Add(Row(string.Empty, null, owner,
                bulk
                    ? $"Routed in bulk to the {team} team by region and language."
                    : $"Assigned to the {team} team: the lead's city and language match this owner.",
                assignedAt, bulk));

            return;
        }

        context.LeadAssignments.Add(Row("|first", null, previous,
            "Assigned from the unassigned queue in the morning allocation.", assignedAt, false));

        context.LeadAssignments.Add(Row(string.Empty, previous, owner,
            $"Reassigned to the {team} team: the lead asked to be contacted by somebody in their own city.",
            assignedAt.AddHours(20), false));
    }

    /// <summary>
    /// The consent the lead gave at capture. Where the lead became a donor the SAME row carries
    /// the donor's id as well, because conversion moves consent across rather than copying it.
    /// </summary>
    private void AddLeadConsent(Batch batch, DemoLead seed, Lead lead, Donor? converted, Person owner)
    {
        if (seed.Consent == ConsentState.NotProvided)
        {
            return;
        }

        var withdrawn = seed.Consent == ConsentState.Withdrawn;

        context.Consents.Add(new Consent
        {
            Id = DemoIds.Of("consent", batch.Organisation.Subdomain, seed.IdKey + "|lead"),
            LeadId = lead.Id,
            DonorId = converted?.Id,
            OrganisationId = batch.OrganisationId,
            Name = $"{Label(seed.Medium)} consent - {lead.LeadReference}",
            Status = withdrawn ? ConsentStatus.Withdrawn : ConsentStatus.Active,
            Purpose = "Contact about the campaign the lead enquired about.",
            Channel = seed.Medium,
            ConsentState = seed.Consent,
            NoticeVersion = _settings.CurrentNoticeVersion,
            EvidenceSource = seed.Source,
            EvidenceReference = lead.ConsentEvidenceReference,
            EffectiveAtUtc = lead.CreatedAtUtc,
            WithdrawnAtUtc = withdrawn ? lead.LastContactedAtUtc ?? lead.CreatedAtUtc : null,
            WithdrawalReason = withdrawn ? "The lead asked not to be contacted again." : null,
            CapturedByUserId = owner.Id,
            CapturedByName = owner.Name,
            CreatedAtUtc = lead.CreatedAtUtc,
            CreatedByUserId = owner.Id,
            Version = withdrawn ? 2 : 1
        });
    }

    private void AddLeadConversation(Batch batch, DemoLead seed, Lead lead, Person owner, DateTimeOffset at)
    {
        var type = seed.Medium switch
        {
            ConsentChannel.Email => InteractionType.Email,
            ConsentChannel.Sms => InteractionType.Sms,
            ConsentChannel.WhatsApp => InteractionType.WhatsApp,
            ConsentChannel.Post => InteractionType.Note,
            _ => InteractionType.Call
        };

        var campaign = batch.Organisation.Campaigns.First(item => item.Code == seed.Campaign).Name;

        var (name, description) = seed.LastOutcome switch
        {
            ContactOutcome.Reached =>
                ("Introduction conversation",
                    $"Spoke about {campaign}. The lead is interested and asked for the details in writing."),
            ContactOutcome.NoAnswer =>
                ("Contact attempt - no answer",
                    "Rang twice during the day with no answer; a message was left."),
            ContactOutcome.CallbackRequested =>
                ("Contact - asked to be called back",
                    "The lead was busy and asked to be contacted again at a better time."),
            ContactOutcome.NotInterested =>
                ("Contact - not interested",
                    "The lead does not wish to give at present and asked for no further appeals on this campaign."),
            ContactOutcome.WrongNumber =>
                ("Contact attempt - wrong number",
                    "The number belongs to somebody else, who does not know the lead."),
            ContactOutcome.DoNotContact =>
                ("Contact - asked not to be contacted",
                    "The lead asked for their details to be removed from all appeals."),
            _ => ("Contact attempt", "Tried to reach the lead.")
        };

        AddConversation(batch, null, lead.Id, seed.IdKey + "|contact", owner, name, description,
            type, seed.Medium, seed.LastOutcome, at);
    }

    /// <summary>
    /// The follow-up tasks a lead implies: the one that was done, and the one that is owed.
    ///
    /// THE OPEN TASK IS THE LEAD'S OWN NEXT ACTION, on the same medium and the same due date, so
    /// a row on the Lead Work Queue and the matching row on its owner's Follow-up Queue are
    /// visibly the same piece of work.
    /// </summary>
    private void AddLeadFollowUps(
        Batch batch, DemoLead seed, Lead lead, Donor? converted, Person owner,
        DateTimeOffset? contactedAt, DateTimeOffset? dueAt)
    {
        FollowUpTask NewTask(string salt, string purpose, string? nextAction, DateTimeOffset? due,
            FollowUpStatus status, DateTimeOffset createdAt) =>
            new()
            {
                Id = DemoIds.Of("follow-up", batch.Organisation.Subdomain, seed.IdKey + salt),
                OrganisationId = batch.OrganisationId,
                FollowUpReference = batch.FollowUps.Next(),
                LeadId = lead.Id,
                DonorId = converted?.Id,
                RelationshipOwnerUserId = owner.Id,
                RelationshipOwnerName = owner.Name,
                Purpose = purpose,
                PermittedChannel = seed.Medium,
                PreferredLanguage = seed.Language,
                NextAction = nextAction,
                DueAtUtc = due,
                Priority = PriorityOf(seed, due, batch.Now),
                Status = status,

                // Acknowledged where consent was not on record, which is the one case the
                // planner stops and asks about before it lets a task be scheduled.
                ConsentWarningAcknowledged = seed.Consent != ConsentState.Granted,
                ConsentNoticeVersion = seed.Consent != ConsentState.Granted ? _settings.CurrentNoticeVersion : null,
                ConsentAcknowledgedAtUtc = seed.Consent != ConsentState.Granted ? createdAt : null,

                CreatedAtUtc = createdAt,
                CreatedByUserId = owner.Id,
                Version = 1
            };

        if (contactedAt is { } contacted)
        {
            var done = NewTask("|done", "Make first contact with the lead after capture.",
                "Make first contact", contacted.AddHours(-2), FollowUpStatus.Completed,
                lead.AcceptedAtUtc ?? lead.CreatedAtUtc);

            done.CompletedAtUtc = contacted;
            done.CompletionOutcome = seed.LastOutcome switch
            {
                ContactOutcome.Reached => "Spoke to the lead; they are interested and want the details in writing.",
                ContactOutcome.NoAnswer => "No answer after two attempts; a message was left.",
                ContactOutcome.CallbackRequested => "The lead asked to be contacted again at a better time.",
                ContactOutcome.NotInterested => "The lead is not interested at present.",
                ContactOutcome.WrongNumber => "The number belongs to somebody else.",
                ContactOutcome.DoNotContact => "The lead asked not to be contacted again.",
                _ => "Contact attempted."
            };
            done.UpdatedAtUtc = contacted;
            done.UpdatedByUserId = owner.Id;
            done.Version = 2;

            context.FollowUpTasks.Add(done);
        }

        if (seed.Status is LeadStatus.Closed or LeadStatus.Suppressed)
        {
            var cancelled = NewTask("|cancelled", "Follow up on the lead's enquiry.",
                "Follow up", null, FollowUpStatus.Cancelled, contactedAt ?? lead.CreatedAtUtc);

            cancelled.CancellationReason = seed.Status == LeadStatus.Suppressed
                ? "The lead asked not to be contacted, so no further follow-up is planned."
                : "The lead was closed, so no further follow-up is planned.";
            cancelled.UpdatedAtUtc = (contactedAt ?? lead.CreatedAtUtc).AddMinutes(20);
            cancelled.UpdatedByUserId = owner.Id;
            cancelled.Version = 2;

            context.FollowUpTasks.Add(cancelled);

            return;
        }

        if (seed.Status == LeadStatus.Converted)
        {
            var agreed = NewTask("|agreed", "Agree the gift and send the payment link.",
                "Send the payment link", lead.ConvertedAtUtc, FollowUpStatus.Completed,
                contactedAt ?? lead.CreatedAtUtc);

            agreed.CompletedAtUtc = lead.ConvertedAtUtc;
            agreed.CompletionOutcome = "The gift was agreed and the lead became a donor.";
            agreed.UpdatedAtUtc = lead.ConvertedAtUtc;
            agreed.UpdatedByUserId = owner.Id;
            agreed.Version = 2;

            context.FollowUpTasks.Add(agreed);

            return;
        }

        if (seed.NextAction is null)
        {
            return;
        }

        var purpose = seed.Status switch
        {
            LeadStatus.Assigned => "Introduce the organisation and the campaign the lead enquired about.",
            LeadStatus.Contacted => "Follow up on the conversation and answer the lead's open questions.",
            LeadStatus.Qualified => "Agree the gift and send the payment details.",
            LeadStatus.Nurture => "Keep in touch until the lead is ready to give.",
            _ => "Follow up on the lead's enquiry."
        };

        // A spread of the three open states, so the queue's status filter has each to show.
        var open = NewTask("|next", purpose, seed.NextAction, dueAt,
            (batch.FollowUps.Issued % 5) switch
            {
                0 or 1 => FollowUpStatus.Planned,
                2 or 3 => FollowUpStatus.Assigned,
                _ => FollowUpStatus.Rescheduled
            },
            contactedAt ?? lead.AcceptedAtUtc ?? lead.CreatedAtUtc);

        if (open.Status == FollowUpStatus.Rescheduled)
        {
            open.RescheduleReason = "The lead asked to be contacted at a later time.";
            open.UpdatedAtUtc = open.CreatedAtUtc.AddHours(4);
            open.UpdatedByUserId = owner.Id;
            open.Version = 2;
        }

        context.FollowUpTasks.Add(open);
    }

    /// <summary>The follow-ups owed to donors: thank-you calls, bounced receipts, renewals.</summary>
    private void AddStewardship(Batch batch, IReadOnlyDictionary<string, Donor> donors)
    {
        foreach (var (seed, index) in batch.Organisation.Stewardship.Select((value, index) => (value, index)))
        {
            var donor = donors[seed.Donor];
            var owner = batch.People[seed.Owner];
            var dueAt = Due(batch.Now, seed.Due);
            var finished = seed.Status is FollowUpStatus.Completed or FollowUpStatus.Cancelled;
            var createdAt = Moment(batch.Now, finished ? 12 : 3, $"{seed.Donor}|stewardship|{index}");

            var task = new FollowUpTask
            {
                Id = DemoIds.Of("follow-up", batch.Organisation.Subdomain, $"{seed.Donor}|stewardship|{index}"),
                OrganisationId = batch.OrganisationId,
                FollowUpReference = batch.FollowUps.Next(),
                DonorId = donor.Id,
                RelationshipOwnerUserId = owner.Id,
                RelationshipOwnerName = owner.Name,
                Purpose = seed.Purpose,
                PermittedChannel = seed.Medium,
                PreferredLanguage = donor.PreferredLanguage,
                NextAction = seed.NextAction,
                DueAtUtc = dueAt,
                Priority = seed.Priority,
                Status = seed.Status,
                CreatedAtUtc = createdAt,
                CreatedByUserId = owner.Id,
                Version = 1
            };

            switch (seed.Status)
            {
                case FollowUpStatus.Completed:
                    task.CompletedAtUtc = dueAt;
                    task.CompletionOutcome = seed.Outcome;
                    break;

                case FollowUpStatus.Cancelled:
                    task.CancellationReason = seed.Outcome;
                    break;

                case FollowUpStatus.Rescheduled:
                    task.RescheduleReason = "The donor's office asked for a few more days.";
                    break;
            }

            if (seed.Status is not (FollowUpStatus.Planned or FollowUpStatus.Assigned))
            {
                task.UpdatedAtUtc = finished ? dueAt : createdAt.AddHours(5);
                task.UpdatedByUserId = owner.Id;
                task.Version = 2;
            }

            context.FollowUpTasks.Add(task);
        }
    }

    /// <summary>
    /// The pledges, and the two totals this module can honestly state from them: what has been
    /// pledged, and how much of it is still outstanding. What has been RECEIVED is PAY's to say.
    /// </summary>
    private void AddPromises(Batch batch, IReadOnlyDictionary<string, Donor> donors)
    {
        foreach (var seed in batch.Organisation.Promises)
        {
            var donor = donors[seed.Donor];
            var promisedAt = Moment(batch.Now, seed.Promised, seed.Donor + "|promise");

            context.DonorPromises.Add(new DonorPromise
            {
                Id = DemoIds.Of("promise", batch.Organisation.Subdomain, seed.Donor),
                OrganisationId = batch.OrganisationId,
                DonorId = donor.Id,
                Reference = batch.Promises.Next(),
                Amount = seed.Amount,
                Currency = Currency,
                PromisedAtUtc = promisedAt,
                DueAtUtc = Due(batch.Now, seed.Due),
                Status = seed.Status,
                CampaignId = batch.CampaignIds[seed.Campaign],
                Notes = seed.Notes,
                CreatedAtUtc = promisedAt,
                CreatedByUserId = donor.RelationshipOwnerUserId ?? donor.CreatedByUserId,
                Version = 1
            });

            if (seed.Status is PromiseStatus.Lapsed or PromiseStatus.Cancelled)
            {
                continue;
            }

            AddSummary(batch, donor.Id, DonationStage.Pledged, seed.Amount, 1, promisedAt);

            if (seed.Outstanding > 0m)
            {
                AddSummary(batch, donor.Id, DonationStage.Outstanding, seed.Outstanding, 1, promisedAt);
            }
        }
    }

    private void AddSummary(
        Batch batch, Guid donorId, DonationStage stage, decimal amount, int count, DateTimeOffset asAt) =>
        context.DonorDonationSummaries.Add(new DonorDonationSummary
        {
            Id = DemoIds.Of("donation-summary", batch.Organisation.Subdomain, $"{donorId}|{stage}"),
            OrganisationId = batch.OrganisationId,
            DonorId = donorId,
            Stage = stage,
            Currency = Currency,
            TotalAmount = amount,
            TransactionCount = count,
            AsAtUtc = asAt,
            RefreshedAtUtc = batch.Now,
            CreatedAtUtc = batch.Now,
            CreatedByUserId = Guid.Empty,
            Version = 1
        });

    private void AddDocuments(Batch batch, IReadOnlyDictionary<string, Donor> donors)
    {
        foreach (var seed in batch.Organisation.Documents)
        {
            var donor = donors[seed.Donor];

            context.DonorDocuments.Add(new DonorDocument
            {
                Id = DemoIds.Of("document", batch.Organisation.Subdomain, $"{seed.Donor}|{seed.Kind}"),
                OrganisationId = batch.OrganisationId,
                DonorId = donor.Id,
                Reference = $"DOC-{seed.Kind}-{donor.DonorNumber}",
                Name = seed.Name,
                Description = seed.Description,
                Classification = seed.Classification,
                ContentType = "application/pdf",
                SizeInBytes = seed.SizeInBytes,
                ScanStatus = "Clean",
                CreatedAtUtc = donor.CreatedAtUtc.AddDays(1),
                CreatedByUserId = donor.RelationshipOwnerUserId ?? donor.CreatedByUserId,
                Version = 1
            });
        }
    }

    /// <summary>The duplicate review that explains why one donor record reads Merged.</summary>
    private void AddDuplicateReview(Batch batch, IReadOnlyDictionary<string, Donor> donors)
    {
        var seed = batch.Organisation.Duplicate;
        var survivor = donors[seed.Survivor];
        var duplicate = donors[seed.Duplicate];
        var manager = batch.People[batch.Organisation.Manager];
        var decidedAt = duplicate.UpdatedAtUtc ?? batch.Now.AddDays(-10);

        context.DonorMergeCases.Add(new DonorMergeCase
        {
            Id = DemoIds.Of("merge-case", batch.Organisation.Subdomain, seed.Duplicate),
            OrganisationId = batch.OrganisationId,
            ReviewReference = batch.MergeCases.Next(),
            Name = seed.Name,
            Description = "Raised when a telephone enquiry created a second record for an existing donor.",
            Status = DonorMergeCaseStatus.Merged,
            CandidateADonorId = survivor.Id,
            CandidateBDonorId = duplicate.Id,
            ContactComparison = "A: e-mail and mobile on record. B: mobile only.",
            IdentityConfidence = IdentityConfidence.High,
            MatchingEvidence = seed.Evidence,
            ConflictingFields = seed.ConflictingFields,
            DonationHistoryImpact = "Record B holds no donations, so the giving history is unchanged.",
            ConsentImpact = "Record B holds no consent records; record A's consent stands.",
            Decision = MergeDecision.Merge,
            DecisionReason = seed.Reason,
            SurvivingDonorId = survivor.Id,
            MergePreview = $"{survivor.DisplayName} keeps donor number {survivor.DonorNumber}; "
                           + $"{duplicate.DonorNumber} is retired and points at it.",
            DecidedByUserId = manager.Id,
            DecidedByName = manager.Name,
            DecidedAtUtc = decidedAt,
            CreatedAtUtc = decidedAt.AddDays(-2),
            CreatedByUserId = survivor.RelationshipOwnerUserId ?? manager.Id,
            UpdatedAtUtc = decidedAt,
            UpdatedByUserId = manager.Id,
            Version = 2
        });
    }

    // =============================================================================================
    // Giving totals, read from the donations PAY has seeded
    // =============================================================================================

    /// <summary>
    /// Adds up each demonstration donor's donations and writes the Received and Reconciled totals
    /// the Donor List and Donor 360 read. False means PAY has written none yet.
    ///
    /// RECONCILED IS LESS THAN RECEIVED WHEREVER A GIFT HAS NOT CLEARED, and that gap is the whole
    /// reason the stage exists: received is what the gateway reported, reconciled is what the bank
    /// confirmed.
    ///
    /// A DONOR A GIFT CREATED IS MOVED TO THE MOMENT OF THAT GIFT, with the lead it converted, so
    /// the record, the lead and the donation tell one story to the minute.
    /// </summary>
    private async Task<bool> ProjectGivingAsync(
        DemoOrganisation organisation, Guid organisationId, CancellationToken cancellationToken)
    {
        var donorIds = DonorIds(organisation);

        var alreadyProjected = await context.DonorDonationSummaries
            .IgnoreQueryFilters()
            .AnyAsync(summary => summary.OrganisationId == organisationId
                                 && summary.Stage == DonationStage.Received
                                 && donorIds.Contains(summary.DonorId),
                cancellationToken);

        if (alreadyProjected)
        {
            return true;
        }

        var giving = await QueryAsync(
            """
            SELECT donor_id,
                   COUNT(*),
                   SUM(amount),
                   MIN(donated_at_utc),
                   MAX(donated_at_utc),
                   COUNT(*) FILTER (WHERE reconciliation_status IN ('Matched', 'ManuallyResolved')),
                   COALESCE(SUM(amount) FILTER (WHERE reconciliation_status IN ('Matched', 'ManuallyResolved')), 0)
            FROM pay_donations
            WHERE tenant_id = @value
              AND donor_id IS NOT NULL
              AND status IN ('Recorded', 'Settled', 'PartiallyRefunded')
            GROUP BY donor_id
            """,
            organisationId,
            reader => new Giving(
                reader.GetGuid(0),
                (int)reader.GetInt64(1),
                reader.GetDecimal(2),
                reader.GetFieldValue<DateTimeOffset>(3),
                reader.GetFieldValue<DateTimeOffset>(4),
                (int)reader.GetInt64(5),
                reader.GetDecimal(6)),
            cancellationToken);

        var present = await context.Donors
            .IgnoreQueryFilters()
            .Where(donor => donor.OrganisationId == organisationId && donorIds.Contains(donor.Id))
            .Select(donor => donor.Id)
            .ToListAsync(cancellationToken);

        giving = [.. giving.Where(row => present.Contains(row.DonorId))];

        if (giving.Count == 0)
        {
            return false;
        }

        var now = DateTimeOffset.UtcNow;
        var batch = new Batch(organisation, organisationId, new Dictionary<string, Person>(), now,
            new Dictionary<string, Guid>(), Sequence.None, Sequence.None, Sequence.None,
            Sequence.None, Sequence.None, Sequence.None);

        foreach (var row in giving)
        {
            AddSummary(batch, row.DonorId, DonationStage.Received, row.Total, row.Count, row.Last);

            if (row.ReconciledCount > 0)
            {
                AddSummary(batch, row.DonorId, DonationStage.Reconciled, row.ReconciledTotal,
                    row.ReconciledCount, row.Last);
            }
        }

        await SaveAsBuiltAsync(cancellationToken);

        var createdByGift = organisation.Donors
            .Where(donor => donor.CreatedByGift)
            .Select(donor => DemoIds.Of("donor", organisation.Subdomain, donor.IdKey))
            .ToHashSet();

        foreach (var row in giving.Where(row => createdByGift.Contains(row.DonorId)))
        {
            await context.Donors
                .IgnoreQueryFilters()
                .Where(donor => donor.Id == row.DonorId)
                .ExecuteUpdateAsync(
                    update => update
                        .SetProperty(donor => donor.CreatedAtUtc, row.First)
                        .SetProperty(donor => donor.SubmittedAtUtc, row.First)
                        .SetProperty(donor => donor.ApprovedAtUtc, row.First)
                        .SetProperty(donor => donor.UpdatedAtUtc, row.First),
                    cancellationToken);

            await context.Leads
                .IgnoreQueryFilters()
                .Where(lead => lead.OrganisationId == organisationId && lead.ConvertedDonorId == row.DonorId)
                .ExecuteUpdateAsync(
                    update => update
                        .SetProperty(lead => lead.ConvertedAtUtc, row.First)
                        .SetProperty(lead => lead.UpdatedAtUtc, row.First),
                    cancellationToken);
        }

        logger.LogInformation(
            "Projected the giving totals of {Count} demonstration donor(s) in {Subdomain} from "
            + "their donations.",
            giving.Count, organisation.Subdomain);

        return true;
    }

    // =============================================================================================
    // Small things
    // =============================================================================================

    private sealed record Person(Guid Id, string Name);

    private sealed record Giving(
        Guid DonorId, int Count, decimal Total, DateTimeOffset First, DateTimeOffset Last,
        int ReconciledCount, decimal ReconciledTotal);

    /// <summary>Everything one Organisation's rows are built from.</summary>
    private sealed record Batch(
        DemoOrganisation Organisation,
        Guid OrganisationId,
        IReadOnlyDictionary<string, Person> People,
        DateTimeOffset Now,
        IReadOnlyDictionary<string, Guid> CampaignIds,
        Sequence DonorNumbers,
        Sequence LeadReferences,
        Sequence FollowUps,
        Sequence Verifications,
        Sequence Promises,
        Sequence MergeCases);

    /// <summary>A running reference number in the product's own shape: FUP-2026-000512.</summary>
    private sealed class Sequence(string prefix, int year, int next)
    {
        public static Sequence None => new(string.Empty, 0, 0);

        private int _next = next;

        /// <summary>How many references have been handed out.</summary>
        public int Issued { get; private set; }

        public string Next()
        {
            Issued++;

            return $"{prefix}-{year:0000}-{_next++:000000}";
        }
    }

    /// <summary>
    /// Where a reference series should start: after the highest number already used, and never
    /// before <paramref name="first"/>.
    ///
    /// THE NUMBERS ALREADY THERE ARE RESPECTED, so data seeded into an Organisation that has
    /// begun to be used continues its series rather than colliding with it.
    /// </summary>
    private static async Task<Sequence> NextInOrganisationAsync(
        IQueryable<string> references, string prefix, int year, int first,
        CancellationToken cancellationToken)
    {
        var stem = $"{prefix}-{year:0000}-";

        var used = await references
            .Where(reference => reference.StartsWith(stem))
            .ToListAsync(cancellationToken);

        var highest = used
            .Select(reference => int.TryParse(reference[stem.Length..], out var parsed) ? parsed : 0)
            .DefaultIfEmpty(0)
            .Max();

        return new Sequence(prefix, year, Math.Max(first, highest + 1));
    }

    private static List<Guid> DonorIds(DemoOrganisation organisation) =>
        [.. organisation.Donors.Select(donor => DemoIds.Of("donor", organisation.Subdomain, donor.IdKey))];

    private static IEnumerable<string> RequiredUsernames(DemoOrganisation organisation) =>
        organisation.Donors.Select(donor => donor.Owner)
            .Concat(organisation.Leads.SelectMany(lead => new[] { lead.Owner, lead.PreviousOwner }))
            .Concat(organisation.Stewardship.Select(task => task.Owner))
            .Append(organisation.Administrator)
            .Append(organisation.Manager)
            .Where(name => name is not null)
            .Select(name => name!)
            .Distinct(StringComparer.OrdinalIgnoreCase);

    /// <summary>The consent marks on a donor row, as (channel letter, state) pairs.</summary>
    private static IEnumerable<(char Channel, char State)> Marks(DemoDonor seed) =>
        seed.Consents
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(token => token.Length == 2)
            .Select(token => (token[0], token[1]));

    private static ConsentChannel ChannelOf(char letter) =>
        letter switch
        {
            'S' => ConsentChannel.Sms,
            'W' => ConsentChannel.WhatsApp,
            'P' => ConsentChannel.PhoneCall,
            'O' => ConsentChannel.Post,
            _ => ConsentChannel.Email
        };

    private static string Label(ConsentChannel channel) =>
        channel switch
        {
            ConsentChannel.Email => "E-mail",
            ConsentChannel.Sms => "SMS",
            ConsentChannel.WhatsApp => "WhatsApp",
            ConsentChannel.PhoneCall => "Telephone",
            _ => "Post"
        };

    private static string Evidence(ConsentChannel channel) =>
        channel switch
        {
            ConsentChannel.WhatsApp => "WhatsApp opt-in message",
            ConsentChannel.PhoneCall => "Telephone call, recorded",
            ConsentChannel.Post => "Signed paper consent form",
            _ => "Online donation form"
        };

    /// <summary>The key DON's own create path would have written for this donor.</summary>
    private static string BusinessKey(DemoDonor seed)
    {
        if (seed.Email is not null)
        {
            return "email:" + seed.Email.ToLowerInvariant();
        }

        if (seed.Mobile is not null)
        {
            return "phone:" + ToE164(seed.Mobile);
        }

        return "name:" + (seed.Organisation ?? seed.Key ?? "anonymous donor").ToLowerInvariant();
    }

    private static string? ToE164(string? subscriberNumber) =>
        string.IsNullOrWhiteSpace(subscriberNumber) ? null : "+91" + subscriberNumber.Trim();

    private static string? MaskPhone(string? phone) =>
        phone is null || phone.Length < 7 ? phone : $"{phone[..3]}******{phone[^4..]}";

    private static string? MaskEmail(string? email)
    {
        if (email is null)
        {
            return null;
        }

        var at = email.IndexOf('@');

        return at <= 0 ? "***" : string.Concat(email.AsSpan(0, Math.Min(2, at)), "***", email.AsSpan(at));
    }

    /// <summary>Urgent where a hot lead is already overdue; otherwise by how warm the lead is.</summary>
    private static FollowUpPriority PriorityOf(DemoLead seed, DateTimeOffset? dueAt, DateTimeOffset now)
    {
        var overdue = dueAt is not null && dueAt < now;

        return seed.Temperature switch
        {
            LeadTemperature.Hot when overdue => FollowUpPriority.Urgent,
            LeadTemperature.Hot => FollowUpPriority.High,
            LeadTemperature.Warm when seed.Potential == DonationPotential.High => FollowUpPriority.High,
            LeadTemperature.Cold when seed.Potential == DonationPotential.Low => FollowUpPriority.Low,
            _ => FollowUpPriority.Normal
        };
    }

    /// <summary>The SLA badge, by the same rule the product applies on every read.</summary>
    private SlaState Sla(DateTimeOffset? dueAt, DateTimeOffset now)
    {
        if (dueAt is null)
        {
            return SlaState.NotApplicable;
        }

        var hoursRemaining = (dueAt.Value - now).TotalHours;

        return hoursRemaining < -_settings.SlaBreachHours ? SlaState.Breached
            : hoursRemaining < 0 ? SlaState.Overdue
            : hoursRemaining <= _settings.SlaDueSoonHours ? SlaState.DueToday
            : SlaState.OnTrack;
    }

    // =============================================================================================
    // Time
    // =============================================================================================

    /// <summary>
    /// A moment in working hours, <paramref name="daysAgo"/> days before now. The time of day
    /// comes from the salt, so the same event lands on the same minute whenever it is seeded, and
    /// it is never in the future.
    /// </summary>
    private static DateTimeOffset Moment(DateTimeOffset now, int daysAgo, string salt)
    {
        var day = now.ToOffset(IndiaOffset).Date.AddDays(-daysAgo);
        var minutes = (9 * 60) + 30 + (StableHash(salt) % ((8 * 60) + 30));
        var moment = new DateTimeOffset(day, IndiaOffset).AddMinutes(minutes).ToUniversalTime();

        return moment < now ? moment : now.AddMinutes(-5);
    }

    /// <summary>
    /// When a piece of work falls due: <paramref name="days"/> from now, negative for overdue.
    /// Zero means later today, pinned an hour ahead so the badge reads Due Today.
    /// </summary>
    private static DateTimeOffset Due(DateTimeOffset now, double days) =>
        days == 0 ? now.AddHours(1) : now.AddDays(days);

    /// <summary>A hash that is the same in every process, unlike <c>string.GetHashCode</c>.</summary>
    private static int StableHash(string value)
    {
        unchecked
        {
            var hash = 17;

            foreach (var character in value)
            {
                hash = (hash * 31) + character;
            }

            return hash & int.MaxValue;
        }
    }

    // =============================================================================================
    // Saving, and reading what other modules own
    // =============================================================================================

    /// <summary>
    /// Saves the tracked rows exactly as they were built.
    ///
    /// THIS OVERLOAD IS CHOSEN ON PURPOSE. <see cref="DonDbContext"/> stamps CreatedAtUtc,
    /// CreatedByUserId and Version in its override of <c>SaveChangesAsync(CancellationToken)</c>,
    /// which is right for a request and wrong here: it would overwrite every backdated creation
    /// time with this minute. The two-argument overload is the one that override itself ends up
    /// calling, so going to it directly performs the same save without the stamp. Every row above
    /// therefore sets its own Organisation, creator, creation time and version.
    /// </summary>
    private Task<int> SaveAsBuiltAsync(CancellationToken cancellationToken) =>
        context.SaveChangesAsync(acceptAllChangesOnSuccess: true, cancellationToken);

    /// <summary>
    /// DON's own copy of each campaign the leads and pledges name, keyed by CAM's id for it.
    ///
    /// THE SAME ID CAM USES, which is what <c>CampaignProjection</c> writes when it mirrors a
    /// campaign on demand - so whichever of the two gets there first, the other finds the row
    /// already present and the foreign key on a lead means one campaign, not two.
    /// </summary>
    private async Task<IReadOnlyDictionary<string, Guid>> CampaignIdsAsync(
        DemoOrganisation organisation, Guid organisationId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var existing = await context.Campaigns
            .IgnoreQueryFilters()
            .Where(campaign => campaign.OrganisationId == organisationId)
            .Select(campaign => new { campaign.Id, campaign.Code })
            .ToListAsync(cancellationToken);

        var today = DateOnly.FromDateTime(now.ToOffset(IndiaOffset).Date);
        var ids = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);

        foreach (var seed in organisation.Campaigns)
        {
            var id = DemoIds.Of("campaign", organisation.Subdomain, seed.Code);

            var held = existing.FirstOrDefault(campaign =>
                campaign.Id == id || string.Equals(campaign.Code, seed.Code, StringComparison.OrdinalIgnoreCase));

            if (held is not null)
            {
                ids[seed.Code] = held.Id;
                continue;
            }

            context.Campaigns.Add(new Campaign
            {
                Id = id,
                OrganisationId = organisationId,
                Code = seed.Code,
                Name = seed.Name,
                Status = seed.Open ? CampaignStatus.Active : CampaignStatus.Closed,
                StartsAtUtc = AtMidnightUtc(today.AddDays(seed.StartsIn)),
                EndsAtUtc = AtMidnightUtc(today.AddDays(seed.EndsIn)),
                CreatedAtUtc = now,
                CreatedByUserId = Guid.Empty,
                Version = 1
            });

            ids[seed.Code] = id;
        }

        return ids;
    }

    private static DateTimeOffset AtMidnightUtc(DateOnly date) =>
        new(date.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    /// <summary>
    /// The Organisation behind a subdomain, once IAM has created and activated it. By subdomain
    /// because that is the one name for an Organisation that is the same in every database.
    /// </summary>
    private async Task<Guid?> ReadOrganisationIdAsync(string subdomain, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT id FROM iam_tenants WHERE subdomain = @value AND status = 'Active' LIMIT 1",
            subdomain,
            reader => reader.GetGuid(0),
            cancellationToken);

        return rows.Count == 0 ? null : rows[0];
    }

    private async Task<IReadOnlyDictionary<string, Person>> ReadPeopleAsync(
        Guid organisationId, CancellationToken cancellationToken)
    {
        var rows = await QueryAsync(
            "SELECT user_name, id, display_name FROM iam_users WHERE tenant_id = @value AND status = 'Active'",
            organisationId,
            reader => (Username: reader.GetString(0), Person: new Person(reader.GetGuid(1), reader.GetString(2))),
            cancellationToken);

        return rows.ToDictionary(row => row.Username, row => row.Person, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Runs one read against a table another module owns.
    ///
    /// NOTHING HERE THROWS. Before IAM or PAY has created its schema the table does not exist at
    /// all, which is an ordinary state on a first start and not a fault - so a failed read is an
    /// empty answer, and the caller reports that it is still waiting.
    /// </summary>
    private async Task<List<TRow>> QueryAsync<TRow>(
        string sql, object value, Func<System.Data.Common.DbDataReader, TRow> map,
        CancellationToken cancellationToken)
    {
        var rows = new List<TRow>();
        var connection = context.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;

        try
        {
            if (opened)
            {
                await context.Database.OpenConnectionAsync(cancellationToken);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = sql;

            var parameter = command.CreateParameter();
            parameter.ParameterName = "value";
            parameter.Value = value;
            command.Parameters.Add(parameter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(map(reader));
            }
        }
        catch (Exception exception) when (exception is System.Data.Common.DbException or InvalidOperationException)
        {
            logger.LogDebug(
                exception,
                "A table the demonstration donors depend on could not be read yet. Expected "
                + "before the module that owns it has created its schema; the seed is retried.");

            return [];
        }
        finally
        {
            if (opened && connection.State == System.Data.ConnectionState.Open)
            {
                await context.Database.CloseConnectionAsync();
            }
        }

        return rows;
    }
}
