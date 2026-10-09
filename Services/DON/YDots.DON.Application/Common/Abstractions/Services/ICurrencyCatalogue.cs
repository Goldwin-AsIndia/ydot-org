using YDots.DON.Application.Common.Models;

namespace YDots.DON.Application.Common.Abstractions.Services;

/// <summary>
/// The currencies a donation intent may be recorded in, from the global currency master.
///
/// THE DONOR 360 PLEDGE FORM USED TO CARRY ITS OWN LIST - six ISO codes typed into the component -
/// so a currency the platform had switched on was missing and one it had switched off was still
/// offered. Value is the ISO code; label is the code and the name; description is the symbol.
/// </summary>
public interface ICurrencyCatalogue
{
    Task<IReadOnlyList<LookupItem>> GetActiveAsync(Guid organisationId, CancellationToken cancellationToken = default);
}
