using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Application.Common.Models;
using YDots.DON.Infrastructure.Persistence;

namespace YDots.DON.Infrastructure.Services;

/// <summary>
/// Active currencies from the global master (gm_currencies), platform-wide rows plus any the
/// Organisation added. See <see cref="ICurrencyCatalogue"/>. An unreadable master answers with an
/// empty list, and the form keeps its current value rather than offering a guess.
/// </summary>
public sealed class CurrencyCatalogue(
    DonDbContext context,
    ILogger<CurrencyCatalogue> logger) : ICurrencyCatalogue
{
    public async Task<IReadOnlyList<LookupItem>> GetActiveAsync(
        Guid organisationId,
        CancellationToken cancellationToken = default)
    {
        const string Sql = """
            SELECT TRIM(c.code), c.name, c.symbol
            FROM gm_currencies c
            WHERE c.status = 'Active'
              AND (c.tenant_id IS NULL OR c.tenant_id = @organisation_id)
            ORDER BY c.sort_order, c.code
            """;

        try
        {
            return await SharedDatabaseReader.ReadAsync(
                context,
                Sql,
                command => command.AddParameter("organisation_id", organisationId, NpgsqlDbType.Uuid),
                reader => new LookupItem(
                    reader.GetString(0),
                    $"{reader.GetString(0)} - {reader.GetString(1)}",
                    reader.IsDBNull(2) ? null : reader.GetString(2)),
                cancellationToken);
        }
        catch (Exception exception) when (exception is PostgresException or NpgsqlException or InvalidOperationException)
        {
            logger.LogWarning(exception, "Could not read the currency master for organisation {OrganisationId}.", organisationId);
            return [];
        }
    }
}
