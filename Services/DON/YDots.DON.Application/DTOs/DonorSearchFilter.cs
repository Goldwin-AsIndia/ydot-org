using YDots.DON.Application.Common.Models;
using YDots.DON.Domain.Enums;

namespace YDots.DON.Application.DTOs;

/// <summary>Query string of GET /api/v1/donors. Bound straight from [FromQuery].</summary>
public sealed class DonorSearchFilter : PaginationRequest
{
    /// <summary>Free text over donor number, name, organisation name, e-mail and phone.</summary>
    public string? Search { get; set; }

    public DonorType? DonorType { get; set; }

    public DonorStatus? Status { get; set; }

    public ApprovalState? ApprovalState { get; set; }

    public string? PreferredLanguage { get; set; }

    public bool? DoNotContact { get; set; }

    public Guid? RelationshipOwnerUserId { get; set; }

    /// <summary>
    /// My Donor List: only the donors whose relationship the caller owns. Resolved from the token,
    /// so the browser cannot ask for somebody else's list by sending an id.
    /// </summary>
    public bool? OnlyMine { get; set; }

    /// <summary>Filter by an attached tag code, for example MAJOR_GIVER.</summary>
    public string? TagCode { get; set; }

    public DateTimeOffset? UpdatedAfterUtc { get; set; }

    public DateTimeOffset? UpdatedBeforeUtc { get; set; }

    // ---- The Donor List's own filters ---------------------------------------------------------------
    //
    // THESE ARE FACTS FROM OTHER TABLES - the campaign of the latest gift, the next follow-up, the
    // latest identity check, the consent position, the last gift's date - worked out per row by the
    // read service. They used to be applied in the browser, over every page it had downloaded; the
    // server applies them now, so the page, the count above it and the export all agree.
    // The values are the words the row carries; DonorListCatalogue serves them.

    /// <summary>The campaign the list shows for the donor, matched exactly.</summary>
    public string? Campaign { get; set; }

    /// <summary>Overdue / Due Today / Tomorrow / Upcoming / None.</summary>
    public string? FollowUpState { get; set; }

    /// <summary>Verified / Pending / Under review / Failed / Expired / Cancelled / Not checked.</summary>
    public string? Verification { get; set; }

    /// <summary>Granted / Partial / Withdrawn / Not provided.</summary>
    public string? Consent { get; set; }

    /// <summary>A "needs attention" shortcut: overdue, today, unverified, consent or unowned.</summary>
    public string? Attention { get; set; }

    /// <summary>When the last gift was: 30, 90 or 365 (days), or never.</summary>
    public string? GiftPeriod { get; set; }

    /// <summary>
    /// Only these donors, as a comma-separated list of ids - "export selected". Still inside the
    /// caller's scope: naming a donor does not grant sight of it.
    /// </summary>
    public string? DonorIds { get; set; }

    /// <summary>The ids in <see cref="DonorIds"/>, ignoring anything that is not one.</summary>
    public IReadOnlyList<Guid> ParseDonorIds() =>
        string.IsNullOrWhiteSpace(DonorIds)
            ? []
            : [.. DonorIds
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
                .Where(id => id != Guid.Empty)
                .Distinct()];
}
