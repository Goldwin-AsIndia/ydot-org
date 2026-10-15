using YDots.CAM.Application.Features.WhatsApp.DTOs;
using YDots.CAM.Domain.Entities;

namespace YDots.CAM.Application.Common.Abstractions.Services;

/// <summary>
/// The organisation's WhatsApp recipient groups (cam_whatsapp_recipient_groups and their members).
///
/// The rows are CAM's own; what a member's number is worth today - still on WhatsApp, when it was
/// last messaged, how often the group was sent to - is read from the integration worker's tables
/// in the same query, so the list never shows a stale picture.
/// </summary>
public interface IWhatsAppRecipientGroupStore
{
    /// <summary>Every group of the organisation, newest change first, with live member figures.</summary>
    Task<IReadOnlyList<WhatsAppGroupView>> ListAsync(CancellationToken cancellationToken);

    /// <summary>One group with its members, or null when it is not this organisation's.</summary>
    Task<WhatsAppGroupDetail?> GetAsync(Guid groupId, CancellationToken cancellationToken);

    /// <summary>The group with its members, tracked for a change; null when it is not this organisation's.</summary>
    Task<WhatsAppRecipientGroup?> FindForChangeAsync(Guid groupId, CancellationToken cancellationToken);

    /// <summary>True when another group of the organisation already has this name (ignoring case).</summary>
    Task<bool> NameTakenAsync(string name, Guid? exceptGroupId, CancellationToken cancellationToken);

    void Add(WhatsAppRecipientGroup group);

    void Remove(WhatsAppRecipientGroup group);
}
