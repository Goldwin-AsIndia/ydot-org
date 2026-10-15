using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using YDots.DON.Application.Common.Formatting;
using YDots.DON.Infrastructure.Persistence;

namespace YDots.DON.Infrastructure.Services;

/// <summary>
/// Keeps <see cref="MoneyText"/> in step with IAM's currency master, so the symbol, its position
/// and the decimal places this service writes are the ones an administrator set on Masters,
/// Currency - not a copy compiled into the service.
///
/// COPIED INTO IAM, CAM, DON AND PAY with <see cref="MoneyText"/>. Read over the shared database
/// and only the platform rows (tenant_id IS NULL): an amount reads the same whichever
/// Organisation is looking at it. Retired currencies are read too, because a donation taken in
/// one still has to show its symbol.
///
/// IN THE BACKGROUND, NOT AT START-UP. On a first <c>docker compose up</c> the services start
/// before IAM has created <c>gm_currencies</c>; until the first read succeeds the built-in rules
/// (the seeded master) apply, so nothing waits on IAM.
/// </summary>
public sealed class CurrencyRuleRefresher(
    IServiceScopeFactory scopeFactory,
    ILogger<CurrencyRuleRefresher> logger) : BackgroundService
{
    private static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(30);

    /// <summary>A symbol edited on the master shows here within this long.</summary>
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(5);

    private const string Sql = """
        SELECT code, symbol, symbol_position, decimal_places
        FROM gm_currencies
        WHERE tenant_id IS NULL
        """;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var warned = false;

        while (!stoppingToken.IsCancellationRequested)
        {
            var delay = RefreshInterval;

            try
            {
                var rules = await ReadAsync(stoppingToken);
                MoneyText.UseCurrencies(rules);
                logger.LogDebug("Currency display rules refreshed: {Count} currencies.", rules.Count);
            }
            catch (Exception exception) when (exception is NpgsqlException or InvalidOperationException)
            {
                delay = RetryInterval;

                if (!warned)
                {
                    warned = true;
                    logger.LogWarning(
                        "The currency master could not be read yet ({Reason}). Amounts use the built-in "
                        + "currency rules until it can be.",
                        exception.Message);
                }
            }

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task<List<CurrencyDisplayRule>> ReadAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<DonDbContext>();
        var connection = (NpgsqlConnection)context.Database.GetDbConnection();

        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken);
        }

        await using var command = new NpgsqlCommand(Sql, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var rules = new List<CurrencyDisplayRule>();

        while (await reader.ReadAsync(cancellationToken))
        {
            rules.Add(new CurrencyDisplayRule(
                reader.GetString(0).Trim(),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                string.Equals(reader.GetString(2), "Suffix", StringComparison.OrdinalIgnoreCase),
                reader.GetInt32(3)));
        }

        return rules;
    }
}
