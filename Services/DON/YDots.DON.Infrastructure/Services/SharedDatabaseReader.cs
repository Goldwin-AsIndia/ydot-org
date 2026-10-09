using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using YDots.DON.Infrastructure.Persistence;

namespace YDots.DON.Infrastructure.Services;

/// <summary>
/// Runs one read-only SQL statement against a table another service owns, on the connection the
/// DbContext already has.
///
/// THE SEAM IS NARROW ON PURPOSE. All four services share one database, and DON reads three
/// things it does not own - IAM's people, CAM's campaigns and PAY's donations - rather than keeping
/// copies that drift. Every such read goes through here, parameterised and scoped by the caller,
/// so if one of those services ever moves to a database of its own the places to change are easy
/// to find.
///
/// THE CONNECTION IS LEFT AS IT WAS FOUND. If EF already had it open - mid-request, or inside a
/// transaction - it stays open; if this opened it, this closes it.
/// </summary>
internal static class SharedDatabaseReader
{
    public static async Task<List<T>> ReadAsync<T>(
        DonDbContext context,
        string sql,
        Action<DbCommand> addParameters,
        Func<DbDataReader, T> readRow,
        CancellationToken cancellationToken)
    {
        var rows = new List<T>();
        var connection = context.Database.GetDbConnection();
        var opened = connection.State != System.Data.ConnectionState.Open;

        try
        {
            if (opened)
            {
                await context.Database.OpenConnectionAsync(cancellationToken);
            }

            await using var command = connection.CreateCommand();
            command.CommandText = sql;

            if (context.Database.CurrentTransaction?.GetDbTransaction() is { } transaction)
            {
                command.Transaction = transaction;
            }

            addParameters(command);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                rows.Add(readRow(reader));
            }
        }
        finally
        {
            if (opened && connection.State == System.Data.ConnectionState.Open)
            {
                await context.Database.CloseConnectionAsync();
            }
        }

        return rows;
    }

    public static void AddParameter(this DbCommand command, string name, object? value, NpgsqlTypes.NpgsqlDbType type)
    {
        command.Parameters.Add(new Npgsql.NpgsqlParameter(name, type) { Value = value ?? DBNull.Value });
    }
}
