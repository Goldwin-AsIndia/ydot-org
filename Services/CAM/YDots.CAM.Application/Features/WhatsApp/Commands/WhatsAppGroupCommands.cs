using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Common.Settings;
using YDots.CAM.Application.Features.WhatsApp.DTOs;
using YDots.CAM.Domain.Entities;

namespace YDots.CAM.Application.Features.WhatsApp.Commands;

public sealed record CreateWhatsAppGroupCommand(CreateWhatsAppGroupRequest Request);

public sealed record UpdateWhatsAppGroupCommand(Guid GroupId, UpdateWhatsAppGroupRequest Request);

public sealed record AddWhatsAppGroupMembersCommand(Guid GroupId, AddWhatsAppGroupMembersRequest Request);

public sealed record RemoveWhatsAppGroupMembersCommand(Guid GroupId, RemoveWhatsAppGroupMembersRequest Request);

public sealed record DeleteWhatsAppGroupCommand(Guid GroupId);

/// <summary>
/// Recipient groups: keeping a pick of validated numbers under a name, with tags and a campaign,
/// so it can be sent to - or picked from - again.
///
/// A GROUP HOLDS ONLY NUMBERS A SEND COULD REACH. A member must be one of this organisation's
/// WhatsApp-verified numbers when it is added (anything else is counted and left out), and it
/// keeps the check it was picked from, so a send from the group still traces every message to its
/// CheckNumber.ai job. Whether it is STILL on WhatsApp is read again whenever the group is shown or
/// sent - a group never sends on a stale answer.
/// </summary>
public sealed class WhatsAppGroupCommandHandler(
    IWhatsAppRecipientGroupStore groups,
    IWhatsAppIntegrationStore store,
    ICampaignRepository campaigns,
    IAuditWriter audit,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<WhatsAppIntegrationSettings> settings,
    ILogger<WhatsAppGroupCommandHandler> logger)
{
    public async Task<Result<WhatsAppGroupChangeResponse>> HandleAsync(CreateWhatsAppGroupCommand command, CancellationToken cancellationToken)
    {
        var request = command.Request;
        var name = request.Name.Trim();

        if (await groups.NameTakenAsync(name, null, cancellationToken))
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.Duplicate($"A group called \"{name}\" already exists. Choose another name, or add these numbers to it."));
        }

        if (request.CampaignId is { } campaignId && await campaigns.GetByIdAsync(campaignId, cancellationToken) is null)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.NotFound("That campaign was not found."));
        }

        var group = new WhatsAppRecipientGroup
        {
            Name = name,
            Description = Blank(request.Description),
            CampaignId = request.CampaignId,
            Tags = WhatsAppSendRules.CleanTags(request.Tags),
            CreatedByName = PersonName(),
        };

        var resolved = await ResolveMembersAsync(request.Members ?? [], cancellationToken);
        if (resolved.Members.Count > settings.Value.MaxGroupMembers)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.Validation(
                $"A group can hold at most {settings.Value.MaxGroupMembers:N0} numbers; this one would hold {resolved.Members.Count:N0}."));
        }

        foreach (var member in resolved.Members)
        {
            group.Members.Add(NewMember(group, member));
        }

        groups.Add(group);
        await audit.WriteAsync(
            WhatsAppAuditActionCodes.GroupCreated,
            group.CampaignId is null ? WhatsAppAuditActionCodes.GroupTarget : "Campaign",
            group.CampaignId ?? group.Id,
            $"WhatsApp recipient group \"{group.Name}\" created with {Wording.Count(group.Members.Count, "number")}"
            + (group.Tags.Count == 0 ? "." : $", tags {string.Join(", ", group.Tags)}."),
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("WhatsApp recipient group {GroupId} \"{Name}\" created with {Count} members.", group.Id, group.Name, group.Members.Count);

        return Result.Success(new WhatsAppGroupChangeResponse(
            group.Id, group.Members.Count, 0, resolved.NotInPool, 0, group.Members.Count,
            $"\"{group.Name}\" saved with {Wording.Count(group.Members.Count, "number")}." + NotInPoolNote(resolved.NotInPool)));
    }

    public async Task<Result<WhatsAppGroupChangeResponse>> HandleAsync(UpdateWhatsAppGroupCommand command, CancellationToken cancellationToken)
    {
        var request = command.Request;
        var group = await groups.FindForChangeAsync(command.GroupId, cancellationToken);
        if (group is null)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.NotFound("That group was not found."));
        }

        if (group.Version != request.ExpectedVersion)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.Concurrency(
                "Somebody changed this group after you opened it. Open it again to see their change, then make yours."));
        }

        var name = request.Name.Trim();
        if (await groups.NameTakenAsync(name, group.Id, cancellationToken))
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.Duplicate($"Another group is already called \"{name}\"."));
        }

        if (request.CampaignId is { } campaignId && campaignId != group.CampaignId && await campaigns.GetByIdAsync(campaignId, cancellationToken) is null)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.NotFound("That campaign was not found."));
        }

        var changes = new List<string>();
        if (!string.Equals(group.Name, name, StringComparison.Ordinal))
        {
            changes.Add($"renamed from \"{group.Name}\"");
            group.Name = name;
        }

        if (group.Description != Blank(request.Description))
        {
            changes.Add("description changed");
            group.Description = Blank(request.Description);
        }

        if (group.CampaignId != request.CampaignId)
        {
            changes.Add(request.CampaignId is null ? "no longer tied to a campaign" : "campaign changed");
            group.CampaignId = request.CampaignId;
        }

        var tags = WhatsAppSendRules.CleanTags(request.Tags);
        if (!tags.SequenceEqual(group.Tags, StringComparer.Ordinal))
        {
            changes.Add(tags.Count == 0 ? "tags removed" : $"tags {string.Join(", ", tags)}");
            group.Tags = tags;
        }

        if (changes.Count == 0)
        {
            return Result.Success(new WhatsAppGroupChangeResponse(group.Id, 0, 0, 0, 0, group.Members.Count, "Nothing was changed."));
        }

        group.UpdatedByName = PersonName();
        await audit.WriteAsync(WhatsAppAuditActionCodes.GroupUpdated, WhatsAppAuditActionCodes.GroupTarget, group.Id,
            $"WhatsApp recipient group \"{group.Name}\": {string.Join("; ", changes)}.", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Success(new WhatsAppGroupChangeResponse(group.Id, 0, 0, 0, 0, group.Members.Count, $"\"{group.Name}\" saved."));
    }

    public async Task<Result<WhatsAppGroupChangeResponse>> HandleAsync(AddWhatsAppGroupMembersCommand command, CancellationToken cancellationToken)
    {
        var group = await groups.FindForChangeAsync(command.GroupId, cancellationToken);
        if (group is null)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.NotFound("That group was not found."));
        }

        var resolved = await ResolveMembersAsync(command.Request.Members, cancellationToken);
        var existing = group.Members.Select(member => member.PhoneE164).ToHashSet(StringComparer.Ordinal);
        var fresh = resolved.Members.Where(member => !existing.Contains(member.E164)).ToList();
        var already = resolved.Members.Count - fresh.Count;

        if (existing.Count + fresh.Count > settings.Value.MaxGroupMembers)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.Validation(
                $"A group can hold at most {settings.Value.MaxGroupMembers:N0} numbers; \"{group.Name}\" would hold {existing.Count + fresh.Count:N0}."));
        }

        foreach (var member in fresh)
        {
            group.Members.Add(NewMember(group, member));
        }

        if (fresh.Count > 0)
        {
            group.UpdatedByName = PersonName();

            // A change of membership is a change of the group: its "last changed" moves and its
            // version too, so an open edit form notices.
            group.UpdatedAtUtc = clock.UtcNow;
            await audit.WriteAsync(WhatsAppAuditActionCodes.GroupMembersAdded, WhatsAppAuditActionCodes.GroupTarget, group.Id,
                $"{Wording.Count(fresh.Count, "number")} added to WhatsApp recipient group \"{group.Name}\".", cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        var message = fresh.Count == 0
            ? $"No new number was added to \"{group.Name}\"."
            : $"{Wording.Count(fresh.Count, "number")} added to \"{group.Name}\".";
        if (already > 0)
        {
            message += $" {Wording.Count(already, "number")} {Wording.Verb(already, "was", "were")} already in it.";
        }

        return Result.Success(new WhatsAppGroupChangeResponse(
            group.Id, fresh.Count, already, resolved.NotInPool, 0, group.Members.Count, message + NotInPoolNote(resolved.NotInPool)));
    }

    public async Task<Result<WhatsAppGroupChangeResponse>> HandleAsync(RemoveWhatsAppGroupMembersCommand command, CancellationToken cancellationToken)
    {
        var group = await groups.FindForChangeAsync(command.GroupId, cancellationToken);
        if (group is null)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.NotFound("That group was not found."));
        }

        var wanted = command.Request.Numbers
            .Select(WhatsAppSendRules.ToE164)
            .Where(number => number is not null)
            .ToHashSet(StringComparer.Ordinal);
        var leaving = group.Members.Where(member => wanted.Contains(member.PhoneE164)).ToList();

        foreach (var member in leaving)
        {
            group.Members.Remove(member);
        }

        if (leaving.Count > 0)
        {
            group.UpdatedByName = PersonName();
            group.UpdatedAtUtc = clock.UtcNow;
            await audit.WriteAsync(WhatsAppAuditActionCodes.GroupMembersRemoved, WhatsAppAuditActionCodes.GroupTarget, group.Id,
                $"{Wording.Count(leaving.Count, "number")} removed from WhatsApp recipient group \"{group.Name}\".", cancellationToken);
            await unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result.Success(new WhatsAppGroupChangeResponse(
            group.Id, 0, 0, 0, leaving.Count, group.Members.Count,
            leaving.Count == 0 ? "None of those numbers is in the group." : $"{Wording.Count(leaving.Count, "number")} removed from \"{group.Name}\"."));
    }

    public async Task<Result<WhatsAppGroupChangeResponse>> HandleAsync(DeleteWhatsAppGroupCommand command, CancellationToken cancellationToken)
    {
        var group = await groups.FindForChangeAsync(command.GroupId, cancellationToken);
        if (group is null)
        {
            return Result.Failure<WhatsAppGroupChangeResponse>(Error.NotFound("That group was not found."));
        }

        var members = group.Members.Count;
        groups.Remove(group);

        // The sends made from it keep the group's id and name (int_wati_jobs), so the send log still
        // says where those selections came from.
        await audit.WriteAsync(WhatsAppAuditActionCodes.GroupDeleted, WhatsAppAuditActionCodes.GroupTarget, group.Id,
            $"WhatsApp recipient group \"{group.Name}\" ({Wording.Count(members, "number")}) deleted.", cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Success(new WhatsAppGroupChangeResponse(group.Id, 0, 0, 0, members, 0, $"\"{group.Name}\" deleted."));
    }

    // =====================================================================================
    // Helpers
    // =====================================================================================

    private sealed record ResolvedMember(string E164, Guid? SourceJobId, string? SourceJobNumber, string? ContactName);

    /// <summary>
    /// The requested numbers that are this organisation's WhatsApp numbers now, each with the
    /// check it is kept from (the one it was picked from when that check verified it, otherwise the
    /// newest that did) and the newest name the organisation's files gave for it.
    /// </summary>
    private async Task<(IReadOnlyList<ResolvedMember> Members, int NotInPool)> ResolveMembersAsync(
        IReadOnlyList<SelectedRecipientRequest> requested, CancellationToken cancellationToken)
    {
        var wanted = new List<(string E164, Guid? SourceJobId)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var invalid = 0;

        foreach (var entry in requested)
        {
            var e164 = WhatsAppSendRules.ToE164(entry.Number);
            if (e164 is null)
            {
                invalid++;
            }
            else if (seen.Add(e164))
            {
                wanted.Add((e164, entry.SourceJobId));
            }
        }

        var facts = await store.GetCheckedNumbersAsync(wanted.Select(entry => entry.E164).ToList(), cancellationToken);
        var members = new List<ResolvedMember>();

        foreach (var (e164, sourceJobId) in wanted)
        {
            var answers = facts.GetValueOrDefault(e164) ?? [];
            var yes = answers.Where(answer => answer.FinalStatus == "Yes" && answer.RegistryStatus == "Yes").ToList();
            if (yes.Count == 0)
            {
                continue;
            }

            var source = yes.FirstOrDefault(answer => answer.JobId == sourceJobId && answer.FirstSighting)
                         ?? yes.FirstOrDefault(answer => answer.JobId == sourceJobId)
                         ?? yes.FirstOrDefault(answer => answer.FirstSighting)
                         ?? yes[0];
            var name = !string.IsNullOrWhiteSpace(source.ContactName)
                ? source.ContactName
                : answers.FirstOrDefault(answer => !string.IsNullOrWhiteSpace(answer.ContactName))?.ContactName;

            members.Add(new ResolvedMember(e164, source.JobId, source.JobNumber, name));
        }

        return (members, invalid + wanted.Count - members.Count);
    }

    private WhatsAppRecipientGroupMember NewMember(WhatsAppRecipientGroup group, ResolvedMember member) => new()
    {
        GroupId = group.Id,
        PhoneE164 = member.E164,
        SourceJobId = member.SourceJobId,
        SourceJobNumber = member.SourceJobNumber,
        ContactName = member.ContactName is { Length: > 120 } longName ? longName[..120] : member.ContactName,
        AddedAtUtc = clock.UtcNow,
        AddedByUserId = currentUser.UserId == Guid.Empty ? null : currentUser.UserId,
        AddedByName = PersonName(),
    };

    private string? PersonName() => currentUser.DisplayName ?? currentUser.Username;

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string NotInPoolNote(int notInPool) =>
        notInPool == 0
            ? string.Empty
            : $" {Wording.Count(notInPool, "number")} {Wording.Verb(notInPool, "was", "were")} left out: not one of this organisation's WhatsApp-verified numbers.";
}
