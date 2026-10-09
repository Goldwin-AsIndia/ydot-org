using YDots.DON.Application.Common.Models;

namespace YDots.DON.Application.Common.Constants;

/// <summary>
/// Where a lead can be said to have come from on the capture form.
///
/// ONE LIST, HERE. The form used to type its own seven options, so the names a person could pick
/// and the name the bulk import stamps on a row that states no source were two lists in two
/// codebases that agreed only by coincidence. The form now asks for this one.
///
/// IT IS A LIST TO CHOOSE FROM, NOT A RULE ON THE COLUMN. A lead's source is free text - an
/// import carries whatever the spreadsheet says, and the public donation form writes its own - so
/// nothing here rejects a value that is not on the list. The Lead Work Queue's source filter is
/// built from the sources the organisation's leads actually carry, not from this.
/// </summary>
public static class LeadSources
{
    /// <summary>What a bulk row is recorded as when it names no source of its own.</summary>
    public const string BulkUpload = "Bulk Upload";

    public static readonly IReadOnlyList<LookupItem> All =
    [
        new("Website", "Website"),
        new("Campaign", "Campaign"),
        new("Event", "Event"),
        new("Referral", "Referral"),
        new(BulkUpload, "Bulk upload"),
        new("Walk-In", "Walk-in"),
        new("Partner NGO", "Partner NGO")
    ];
}
