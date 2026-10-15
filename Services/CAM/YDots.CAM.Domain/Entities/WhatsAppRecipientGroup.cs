using YDots.CAM.Domain.Common;

namespace YDots.CAM.Domain.Entities;

/// <summary>
/// A named, tagged set of WhatsApp numbers an organisation keeps for its sends - "Chennai repeat
/// donors", "Diwali 2026 - schools" (table <c>cam_whatsapp_recipient_groups</c>).
///
/// WHY IT EXISTS. CheckNumber.ai is paid per check with a minimum of 500 numbers, so lists are
/// validated in bulk; a WhatsApp send, though, is meant for ten or fifty people. A person picks
/// those on the WhatsApp Messages page and can keep the pick as a group, label it with tags and
/// tie it to a campaign, so the same people can be messaged again - or another campaign's people
/// chosen - without picking them one by one.
///
/// THE NUMBERS ARE NOT COPIED INTO A SECOND REGISTRY. A member is a number plus the check it was
/// picked from; whether it is still on WhatsApp is read from the integration worker's tables when
/// the group is shown or sent, so a group never sends on a stale answer.
/// </summary>
public sealed class WhatsAppRecipientGroup : TenantEntity
{
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>The campaign the group is for, when it is for one. A send from the group defaults to it.</summary>
    public Guid? CampaignId { get; set; }

    /// <summary>Labels such as "diwali" or "chennai" (PostgreSQL text[]). A number "has" the tags of every group it is in.</summary>
    public List<string> Tags { get; set; } = [];

    /// <summary>Who created it, as their name read when they did - CAM never joins to IAM's user table.</summary>
    public string? CreatedByName { get; set; }

    public string? UpdatedByName { get; set; }

    public List<WhatsAppRecipientGroupMember> Members { get; set; } = [];
}
