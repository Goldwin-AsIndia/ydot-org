using YDots.CAM.Domain.Common;

namespace YDots.CAM.Domain.Entities;

/// <summary>
/// One number in a recipient group (table <c>cam_whatsapp_recipient_group_members</c>).
///
/// It keeps the CHECK THE NUMBER WAS PICKED FROM (<see cref="SourceJobId"/>), so a send from the
/// group still records, message by message, which CheckNumber.ai job verified each number. The
/// link is soft - the check job lives in the integration worker's int_* tables, which CAM does not
/// own and must not hold a foreign key into.
///
/// Created and removed with its group and never edited, so it carries no audit columns of its own
/// beyond who added it and when.
/// </summary>
public sealed class WhatsAppRecipientGroupMember : BaseEntity, ITenantOwned
{
    public Guid TenantId { get; set; }

    public Guid BusinessUnitId { get; set; }

    public Guid GroupId { get; set; }

    public WhatsAppRecipientGroup? Group { get; set; }

    /// <summary>The number in E.164: "+919500873627".</summary>
    public string PhoneE164 { get; set; } = string.Empty;

    /// <summary>The check job (int_integration_jobs.id) the number was picked from.</summary>
    public Guid? SourceJobId { get; set; }

    /// <summary>That job's number (INT-yyyyMMdd-NNNNNN), kept so the group reads without the worker's tables.</summary>
    public string? SourceJobNumber { get; set; }

    /// <summary>The name the source file gave beside the number, when it gave one.</summary>
    public string? ContactName { get; set; }

    public DateTimeOffset AddedAtUtc { get; set; }

    public Guid? AddedByUserId { get; set; }

    public string? AddedByName { get; set; }
}
