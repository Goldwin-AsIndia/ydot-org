using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using YDot.PAY.Application.Common.Abstractions.Services;
using YDot.PAY.Infrastructure.Persistence;

namespace YDot.PAY.Infrastructure.Services;

/// <summary>
/// Country, state and city masters read from the identity module's gm_* tables for the anonymous
/// donation form. A failed read answers with an empty list rather than an error, so the page still
/// loads; the status is text ('Active'), so it is compared case-insensitively.
/// </summary>
public sealed class PublicGeoDirectory(PaymentDbContext context, ILogger<PublicGeoDirectory> logger)
    : IPublicGeoDirectory
{
    private const string CountriesSql = """
        SELECT id, code, name FROM gm_countries
        WHERE lower(status) = 'active' AND (tenant_id IS NULL OR tenant_id = @tenant_id)
        ORDER BY sort_order, name LIMIT 500
        """;

    private const string StatesSql = """
        SELECT id, code, name FROM gm_state_provinces
        WHERE lower(status) = 'active' AND country_id = @parent_id
          AND (tenant_id IS NULL OR tenant_id = @tenant_id)
        ORDER BY sort_order, name LIMIT 500
        """;

    private const string CitiesSql = """
        SELECT id, code, name FROM gm_cities
        WHERE lower(status) = 'active' AND state_province_id = @parent_id
          AND (tenant_id IS NULL OR tenant_id = @tenant_id)
        ORDER BY sort_order, name LIMIT 1000
        """;

    private const string CurrenciesSql = """
        SELECT id, code, name FROM gm_currencies
        WHERE lower(status) = 'active' AND (tenant_id IS NULL OR tenant_id = @tenant_id)
        ORDER BY sort_order, code LIMIT 500
        """;

    public Task<IReadOnlyList<PublicGeoOption>> GetCurrenciesAsync(Guid tenantId, CancellationToken cancellationToken) =>
        QueryAsync(CurrenciesSql, tenantId, null, cancellationToken);

    public Task<IReadOnlyList<PublicGeoOption>> GetCountriesAsync(Guid tenantId, CancellationToken cancellationToken) =>
        QueryAsync(CountriesSql, tenantId, null, cancellationToken);

    public Task<IReadOnlyList<PublicGeoOption>> GetStatesAsync(Guid tenantId, Guid countryId, CancellationToken cancellationToken) =>
        QueryAsync(StatesSql, tenantId, countryId, cancellationToken);

    public Task<IReadOnlyList<PublicGeoOption>> GetCitiesAsync(Guid tenantId, Guid stateId, CancellationToken cancellationToken) =>
        QueryAsync(CitiesSql, tenantId, stateId, cancellationToken);

    private async Task<IReadOnlyList<PublicGeoOption>> QueryAsync(
        string sql, Guid tenantId, Guid? parentId, CancellationToken cancellationToken)
    {
        try
        {
            var connection = (NpgsqlConnection)context.Database.GetDbConnection();

            if (connection.State != ConnectionState.Open)
            {
                await connection.OpenAsync(cancellationToken);
            }

            await using var command = new NpgsqlCommand(sql, connection);

            command.Parameters.Add(new NpgsqlParameter("tenant_id", NpgsqlDbType.Uuid) { Value = tenantId });

            if (parentId.HasValue)
            {
                command.Parameters.Add(new NpgsqlParameter("parent_id", NpgsqlDbType.Uuid) { Value = parentId.Value });
            }

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            var rows = new List<PublicGeoOption>();

            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(new PublicGeoOption(
                    reader.GetGuid(0),
                    reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                    reader.GetString(2)));
            }

            return rows;
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "The public address masters could not be read.");

            return [];
        }
    }
}
