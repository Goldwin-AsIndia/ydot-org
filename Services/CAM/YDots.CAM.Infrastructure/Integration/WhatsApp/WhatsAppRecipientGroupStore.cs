using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Features.WhatsApp.DTOs;
using YDots.CAM.Domain.Entities;
using YDots.CAM.Infrastructure.Persistence;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>
/// The organisation's WhatsApp recipient groups.
///
/// THE GROUPS ARE CAM'S, THE FACTS ABOUT THEIR NUMBERS ARE THE WORKER'S. Group rows go through
/// EF with the organisation filter like every other CAM table; whether a member is still on
/// WhatsApp, when it was last messaged and how often the group was sent to are read from the
/// int_* tables in raw SQL that names the organisation itself. When the worker has never run here
/// those figures are simply zero - the groups themselves still list.
/// </summary>
public sealed class WhatsAppRecipientGroupStore(
    CampaignDbContext context,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    ILogger<WhatsAppRecipientGroupStore> logger) : IWhatsAppRecipientGroupStore
{
    private const string UndefinedTable = "42P01";
    private const string UndefinedColumn = "42703";

    public async Task<IReadOnlyList<WhatsAppGroupView>> ListAsync(CancellationToken cancellationToken)
    {
        var groups = await context.WhatsAppRecipientGroups
            .AsNoTracking()
            .OrderByDescending(group => group.UpdatedAtUtc ?? group.CreatedAtUtc)
            .Select(group => new
            {
                Group = group,
                MemberCount = group.Members.Count,
            })
            .ToListAsync(cancellationToken);

        if (groups.Count == 0)
        {
            return [];
        }

        var ids = groups.Select(entry => entry.Group.Id).ToArray();
        var reachable = (await MemberStatesAsync(ids, cancellationToken))
            .Where(state => state.Reachable)
            .GroupBy(state => state.GroupId)
            .ToDictionary(group => group.Key, group => group.Count());
        var sends = await SendsAsync(ids, cancellationToken);
        var campaignNames = await CampaignNamesAsync(groups.Select(entry => entry.Group.CampaignId), cancellationToken);

        return groups
            .Select(entry => ToView(entry.Group, entry.MemberCount, reachable.GetValueOrDefault(entry.Group.Id), sends.GetValueOrDefault(entry.Group.Id), campaignNames))
            .ToList();
    }

    public async Task<WhatsAppGroupDetail?> GetAsync(Guid groupId, CancellationToken cancellationToken)
    {
        var group = await context.WhatsAppRecipientGroups
            .AsNoTracking()
            .Include(entry => entry.Members)
            .FirstOrDefaultAsync(entry => entry.Id == groupId, cancellationToken);

        if (group is null)
        {
            return null;
        }

        var states = (await MemberStatesAsync([groupId], cancellationToken)).ToDictionary(state => state.PhoneE164, StringComparer.Ordinal);
        var sends = await SendsAsync([groupId], cancellationToken);
        var campaignNames = await CampaignNamesAsync([group.CampaignId], cancellationToken);

        var members = group.Members
            .OrderBy(member => member.ContactName ?? "￿", StringComparer.OrdinalIgnoreCase)
            .ThenBy(member => member.PhoneE164, StringComparer.Ordinal)
            .Select(member =>
            {
                var state = states.GetValueOrDefault(member.PhoneE164);
                return new WhatsAppGroupMemberView(
                    member.PhoneE164,
                    member.ContactName,
                    member.SourceJobId,
                    member.SourceJobNumber,
                    member.AddedAtUtc,
                    member.AddedByName,
                    state?.Reachable ?? false,
                    state?.LastMessagedAtUtc);
            })
            .ToList();

        return new WhatsAppGroupDetail(
            ToView(group, members.Count, members.Count(member => member.Reachable), sends.GetValueOrDefault(groupId), campaignNames),
            members);
    }

    public Task<WhatsAppRecipientGroup?> FindForChangeAsync(Guid groupId, CancellationToken cancellationToken) =>
        context.WhatsAppRecipientGroups
            .Include(group => group.Members)
            .FirstOrDefaultAsync(group => group.Id == groupId, cancellationToken);

    public async Task<bool> NameTakenAsync(string name, Guid? exceptGroupId, CancellationToken cancellationToken)
    {
        var wanted = name.Trim().ToLower();

        return await context.WhatsAppRecipientGroups
            .AnyAsync(group => group.Name.ToLower() == wanted && (exceptGroupId == null || group.Id != exceptGroupId), cancellationToken);
    }

    public void Add(WhatsAppRecipientGroup group) => context.WhatsAppRecipientGroups.Add(group);

    public void Remove(WhatsAppRecipientGroup group) => context.WhatsAppRecipientGroups.Remove(group);

    // =====================================================================================
    // Live figures from the worker's tables
    // =====================================================================================

    /// <summary>Each member of these groups: still on WhatsApp for this organisation, and when it was last messaged.</summary>
    private async Task<IReadOnlyList<GroupMemberStateRow>> MemberStatesAsync(Guid[] groupIds, CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;

        try
        {
            return await context.Database
                .SqlQuery<GroupMemberStateRow>($"""
                    SELECT gm.group_id, gm.phone_e164,
                           EXISTS (SELECT 1
                                   FROM int_input_file_numbers n
                                   JOIN int_phone_numbers p ON p.id = n.phone_number_id
                                   WHERE n.tenant_id = {tenantId}
                                     AND n.normalized_number = gm.phone_e164
                                     AND n.final_whatsapp_status = 'Yes'
                                     AND p.whatsapp_status = 'Yes') AS reachable,
                           (SELECT max(COALESCE(m.sent_at_utc, m.completed_at_utc))
                            FROM int_wati_messages m
                            JOIN int_phone_numbers p ON p.id = m.phone_number_id
                            WHERE m.tenant_id = {tenantId}
                              AND p.e164 = gm.phone_e164
                              AND m.request_status = 'Accepted') AS last_messaged_at_utc
                    FROM cam_whatsapp_recipient_group_members gm
                    WHERE gm.tenant_id = {tenantId}
                      AND gm.group_id = ANY({groupIds})
                    """)
                .ToListAsync(cancellationToken);
        }
        catch (PostgresException exception) when (exception.SqlState is UndefinedTable or UndefinedColumn)
        {
            logger.LogWarning("WhatsApp groups: the integration worker's tables cannot be read ({Detail}); member figures are shown as zero.", exception.MessageText);
            return [];
        }
    }

    /// <summary>How often each group was sent to (its sends in int_wati_jobs), and when last.</summary>
    private async Task<IReadOnlyDictionary<Guid, GroupSendRow>> SendsAsync(Guid[] groupIds, CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;

        try
        {
            var rows = await context.Database
                .SqlQuery<GroupSendRow>($"""
                    SELECT w.recipient_group_id AS group_id, count(*)::int AS sends, max(w.created_at_utc) AS last_sent_at_utc
                    FROM int_wati_jobs w
                    WHERE w.tenant_id = {tenantId}
                      AND w.recipient_group_id = ANY({groupIds})
                    GROUP BY w.recipient_group_id
                    """)
                .ToListAsync(cancellationToken);

            return rows.ToDictionary(row => row.GroupId);
        }
        catch (PostgresException exception) when (exception.SqlState is UndefinedTable or UndefinedColumn)
        {
            logger.LogWarning("WhatsApp groups: the integration worker's send log cannot be read ({Detail}).", exception.MessageText);
            return new Dictionary<Guid, GroupSendRow>();
        }
    }

    private async Task<IReadOnlyDictionary<Guid, string>> CampaignNamesAsync(IEnumerable<Guid?> campaignIds, CancellationToken cancellationToken)
    {
        var ids = campaignIds.Where(id => id != null).Select(id => id!.Value).Distinct().ToArray();

        return ids.Length == 0
            ? new Dictionary<Guid, string>()
            : await context.Campaigns
                .Where(campaign => ids.Contains(campaign.Id))
                .Select(campaign => new { campaign.Id, campaign.Name })
                .ToDictionaryAsync(campaign => campaign.Id, campaign => campaign.Name, cancellationToken);
    }

    private WhatsAppGroupView ToView(
        WhatsAppRecipientGroup group, int memberCount, int reachableCount, GroupSendRow? sends, IReadOnlyDictionary<Guid, string> campaignNames)
    {
        // A group is read with cam.whatsapp.view; sending from it or changing it spends or changes
        // something, so those actions are offered only with cam.whatsapp.operate.
        var actions = currentUser.HasPermission(PermissionCodes.WhatsAppOperate)
            ? (IReadOnlyList<string>)(reachableCount > 0 ? ["use", "edit", "delete"] : ["edit", "delete"])
            : [];

        return new WhatsAppGroupView(
            group.Id,
            group.Name,
            group.Description,
            group.CampaignId,
            group.CampaignId is { } campaignId ? campaignNames.GetValueOrDefault(campaignId) : null,
            group.Tags,
            memberCount,
            reachableCount,
            sends?.Sends ?? 0,
            sends?.LastSentAtUtc,
            group.CreatedAtUtc,
            group.CreatedByName,
            group.UpdatedAtUtc,
            group.UpdatedByName,
            group.Version,
            actions);
    }
}
