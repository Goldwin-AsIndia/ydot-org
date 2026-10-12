namespace YDot.PAY.Application.Common.Abstractions.Services;

/// <summary>One country, state or city as the public donation form's address pickers show it.</summary>
public sealed record PublicGeoOption(Guid Id, string Code, string Name);

/// <summary>
/// The active country, state and city masters, for the anonymous donation form's address block.
///
/// READ-ONLY, OVER THE SHARED DATABASE, like <see cref="ICampaignDirectory"/>. The identity
/// module's own lookups need a signed-in caller, and a donor who scanned a QR code has no account,
/// so the address pickers came back empty for exactly the person the form is built for. Only the
/// platform's rows and the request's own organisation's rows are returned, never another's.
/// </summary>
public interface IPublicGeoDirectory
{
    Task<IReadOnlyList<PublicGeoOption>> GetCountriesAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PublicGeoOption>> GetStatesAsync(Guid tenantId, Guid countryId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PublicGeoOption>> GetCurrenciesAsync(Guid tenantId, CancellationToken cancellationToken);

    Task<IReadOnlyList<PublicGeoOption>> GetCitiesAsync(Guid tenantId, Guid stateId, CancellationToken cancellationToken);
}
