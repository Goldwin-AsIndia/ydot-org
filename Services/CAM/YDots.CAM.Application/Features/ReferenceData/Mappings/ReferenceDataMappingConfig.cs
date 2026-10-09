using YDots.CAM.Application.Features.ReferenceData.DTOs;
using YDots.CAM.Domain.Common.Enums;
using YDots.CAM.Domain.Entities;

namespace YDots.CAM.Application.Features.ReferenceData.Mappings;

/// <summary>
/// Manual mapping for the reference tables.
///
/// The three near-identical mapping profiles this replaces - one per table - each had a single
/// method turning a row into a differently named record with the same fields.
/// </summary>
public static class ReferenceDataMappingConfig
{
    public static ReferenceItemResponse ToResponse(this Channel channel)
    {
        ArgumentNullException.ThrowIfNull(channel);

        return new ReferenceItemResponse(
            channel.Id, channel.Code, channel.Name, channel.Description,
            channel.Status, channel.IsSelectable, channel.SortOrder);
    }

    public static ReferenceItemResponse ToResponse(this Source source)
    {
        ArgumentNullException.ThrowIfNull(source);

        return new ReferenceItemResponse(
            source.Id, source.Code, source.Name, source.Description,
            source.Status, source.IsSelectable, source.SortOrder);
    }

    public static ReferenceItemResponse ToResponse(this Medium medium)
    {
        ArgumentNullException.ThrowIfNull(medium);

        return new ReferenceItemResponse(
            medium.Id, medium.Code, medium.Name, medium.Description,
            medium.Status, medium.IsSelectable, medium.SortOrder);
    }

    /// <summary>Turns an enum into the value/label pairs a dropdown binds to.</summary>
    /// <summary>
    /// The tracking asset types as the screens name them, limited to the ones on offer.
    ///
    /// NAMED EXPLICITLY rather than humanised: these four labels are the words the Tracking Asset
    /// Manager prints on every row, and "QR Code" is not something a rule about capital letters
    /// arrives at.
    /// </summary>
    public static IReadOnlyList<EnumOptionResponse> DescribeTrackingAssetTypes(IReadOnlyCollection<string> offered) =>
    [
        .. Enum.GetValues<Domain.Enums.TrackingAssetType>()
            .Where(type => offered.Count == 0
                           || offered.Contains(type.ToString(), StringComparer.OrdinalIgnoreCase))
            .Select(type => new EnumOptionResponse(
                type.ToString(),
                type switch
                {
                    Domain.Enums.TrackingAssetType.QRCode => "QR Code",
                    Domain.Enums.TrackingAssetType.ShortLink => "Short Link",
                    Domain.Enums.TrackingAssetType.UTMLink => "UTM Link",
                    Domain.Enums.TrackingAssetType.LandingPage => "Landing Page",
                    _ => Humanise(type.ToString())
                },
                (int)type))
    ];

    /// <summary>
    /// The tracking asset statuses in lifecycle order, in the words the screens use: an asset
    /// somebody has asked to take down is "Submitted for disable", and one taken down is "Disabled".
    /// </summary>
    public static IReadOnlyList<EnumOptionResponse> DescribeTrackingAssetStatuses() =>
    [
        new(nameof(Domain.Enums.TrackingAssetStatus.Draft), "Draft", 1),
        new(nameof(Domain.Enums.TrackingAssetStatus.Submitted), "Submitted", 2),
        new(nameof(Domain.Enums.TrackingAssetStatus.Approved), "Approved", 3),
        new(nameof(Domain.Enums.TrackingAssetStatus.Active), "Active", 4),
        new(nameof(Domain.Enums.TrackingAssetStatus.DisableRequested), "Submitted for disable", 5),
        new(nameof(Domain.Enums.TrackingAssetStatus.Inactive), "Disabled", 6)
    ];

    public static IReadOnlyList<EnumOptionResponse> Describe<TEnum>() where TEnum : struct, Enum =>
    [
        .. Enum.GetValues<TEnum>()
            .Select(value => new EnumOptionResponse(
                value.ToString(),
                Humanise(value.ToString()),
                Convert.ToInt32(value, System.Globalization.CultureInfo.InvariantCulture)))
    ];

    /// <summary>"RequestClose" becomes "Request close".</summary>
    /// <summary>
    /// An enum name as a label: "DisableRequested" -> "Disable requested", "QRCode" -> "QR code".
    ///
    /// A RUN OF CAPITALS IS ONE WORD. Splitting before every capital turned the two acronyms in
    /// the tracking asset types into "Q r code" and "U t m link", which is what every screen that
    /// reads its option labels from here would have shown.
    /// </summary>
    private static string Humanise(string value)
    {
        var words = new List<string>();
        var start = 0;

        for (var index = 1; index < value.Length; index++)
        {
            var startsWord =
                char.IsUpper(value[index])
                && (char.IsLower(value[index - 1])
                    || (index + 1 < value.Length && char.IsLower(value[index + 1])));

            if (startsWord)
            {
                words.Add(value[start..index]);
                start = index;
            }
        }

        words.Add(value[start..]);

        var label = string.Join(
            ' ',
            words.Select((word, index) =>
                word.Length > 1 && word.All(char.IsUpper)
                    ? word
                    : index == 0
                        ? char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant()
                        : word.ToLowerInvariant()));

        return label;
    }
}
