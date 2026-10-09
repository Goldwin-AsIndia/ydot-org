using YDots.DON.Domain.Common;

namespace YDots.DON.Domain.Entities;

/// <summary>
/// One change of a donor's relationship owner (table don_donor_owner_changes). Append only - the
/// donor twin of <see cref="LeadAssignment"/>.
///
/// WHY DONORS NEED THEIR OWN TRAIL. The role flow has a donor who gave without ever being a lead
/// arrive with no owner, and the Organisation Admin give them one on the Assignment Board. Who was
/// given the relationship, by whom, when and why is the same question a lead's history answers,
/// and an audit line with the reason alone could not say who the previous owner had been.
/// </summary>
public class DonorOwnerChange : AuditEntity, IOrganisationOwned
{
    public Guid OrganisationId { get; set; }

    public Guid DonorId { get; set; }

    public Donor? Donor { get; set; }

    public Guid? PreviousOwnerUserId { get; set; }

    public string? PreviousOwnerName { get; set; }

    public Guid NewOwnerUserId { get; set; }

    public string NewOwnerName { get; set; } = string.Empty;

    /// <summary>Required. 10 to 2000 characters.</summary>
    public string Reason { get; set; } = string.Empty;

    public DateTimeOffset EffectiveAtUtc { get; set; }

    public Guid AssignedByUserId { get; set; }

    /// <summary>True when the change came from the Bulk route action rather than a single Assign.</summary>
    public bool IsBulkRoute { get; set; }
}
