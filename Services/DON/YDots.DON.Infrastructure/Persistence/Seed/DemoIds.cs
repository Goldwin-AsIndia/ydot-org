using System.Security.Cryptography;
using System.Text;

namespace YDots.DON.Infrastructure.Persistence.Seed;

/// <summary>
/// The ids and tracking references of the demonstration data, derived from what a row IS rather
/// than typed out.
///
/// WHY DERIVED. CAM, DON and PAY each seed their own half of one story - a campaign here, the
/// lead captured against it in DON, the donation it attracted in PAY - and none of the three can
/// read another's catalogue: they are separate assemblies that share a database and nothing
/// else. A donation therefore has to know its campaign's id without asking CAM for it. Deriving
/// the id from the campaign's Organisation and code gives all three the same answer, with no
/// table of GUIDs copied between services to drift apart.
///
/// THIS FILE EXISTS THREE TIMES, once per service, and the three copies must stay identical in
/// everything but their namespace:
///
///   Services/CAM/YDots.CAM.Infrastructure/Persistence/Seed/DemoIds.cs
///   Services/DON/YDots.DON.Infrastructure/Persistence/Seed/DemoIds.cs
///   Services/PAY/YDot.PAY.Infrastructure/Persistence/Seed/DemoIds.cs
///
/// Change the derivation in one and a donation points at a campaign that does not exist.
///
/// THE KEYS, which are the other half of the contract:
///
///   campaign        the campaign code                     SF-EDU-2026
///   tracking-asset  the asset code                        SF-EDU-2026-QR-001
///   donor           the donor's primary e-mail address    harish.gopal@mail.test
///   lead            its e-mail address, or its mobile     thomas.mathew@mail.test
///
/// EVERY DEMONSTRATION ID STARTS 5eed, so a seeded row is recognisable on sight in any table and
/// the whole set can be found - or cleared - with <c>WHERE id::text LIKE '5eed%'</c>. A real row
/// has a random id and cannot be mistaken for one more than once in sixty-five thousand.
/// </summary>
internal static class DemoIds
{
    /// <summary>The first four hex digits of every demonstration id.</summary>
    public const string Prefix = "5eed";

    /// <summary>No 0, O, 1, I or L - the alphabet CAM mints real tracking references from.</summary>
    private const string ReferenceAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    private const int ReferenceLength = 12;

    /// <summary>
    /// The id of one demonstration row.
    ///
    /// <paramref name="organisation"/> is the Organisation's subdomain, which is the one name for
    /// it that is the same in every database - its id is generated, and differs.
    /// </summary>
    public static Guid Of(string kind, string organisation, string key)
    {
        var hex = Convert.ToHexString(Hash(kind, organisation, key), 0, 14).ToLowerInvariant();

        return Guid.Parse(Prefix + hex);
    }

    /// <summary>
    /// The tracking reference of one demonstration asset - what its QR code and link carry, and
    /// what a donation made through it quotes back.
    /// </summary>
    public static string TrackingReference(string organisation, string assetCode)
    {
        var hash = Hash("tracking-reference", organisation, assetCode);
        var characters = new char[ReferenceLength];

        for (var index = 0; index < ReferenceLength; index++)
        {
            characters[index] = ReferenceAlphabet[hash[index] % ReferenceAlphabet.Length];
        }

        return new string(characters);
    }

    private static byte[] Hash(string kind, string organisation, string key) =>
        SHA256.HashData(Encoding.UTF8.GetBytes(
            $"{kind}|{organisation}|{key}".ToLowerInvariant()));
}
