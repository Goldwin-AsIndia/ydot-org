using System.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Infrastructure.Persistence;

namespace YDots.CAM.Infrastructure.Services;

/// <summary>
/// Users, read from the identity tables over the shared database.
///
/// READ-ONLY, WITHOUT EXCEPTION, and scoped to one organisation on every call. CAM never writes a
/// user and never reads one belonging to another tenant. The whole surface is a single existence
/// query, which is what makes a seam across a shared database defensible here.
///
/// THIS ONE DOES THROW, unlike <see cref="FinancialDirectory"/>, and the difference is deliberate.
/// A missing income figure is cosmetic, so that class swallows its errors and shows a blank. This
/// class answers "does this owner exist", and a validator that cannot reach identity must not
/// quietly decide the answer is yes - that would let through exactly the record it is there to
/// stop. Failing loudly is the safe direction for a check whose whole job is to refuse.
/// </summary>
public sealed class PeopleDirectory(
    CampaignDbContext context,
    ILogger<PeopleDirectory> logger) : IPeopleDirectory
{
    public async Task<IReadOnlySet<Guid>> GetExistingUserIdsAsync(
        Guid tenantId,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(userIds);

        var found = new HashSet<Guid>();

        if (tenantId == Guid.Empty || userIds.Count == 0)
        {
            return found;
        }

        // TENANT FILTERED IN THE QUERY, not afterwards. An owner id from another organisation must
        // read as "does not exist" here, so that a campaign can never be pointed at a stranger.
        //
        // Invited users are accepted. Somebody who has been invited but has not yet accepted is a
        // real person the organisation has named, and refusing to let them own a campaign would
        // stop an administrator setting the work up before the person's first sign-in.
        const string Sql = """
            SELECT id
            FROM iam_users
            WHERE tenant_id = @tenantId
              AND id = ANY(@ids)
            """;

        try
        {
            await using var command = await CreateCommandAsync(Sql, cancellationToken);

            command.Parameters.Add(new NpgsqlParameter("tenantId", NpgsqlDbType.Uuid)
            {
                Value = tenantId
            });

            command.Parameters.Add(new NpgsqlParameter("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
            {
                Value = userIds.Distinct().ToArray()
            });

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                found.Add(reader.GetGuid(0));
            }
        }
        catch (NpgsqlException exception)
        {
            logger.LogError(
                exception,
                "Could not resolve owner ids against the identity tables for organisation {TenantId}.",
                tenantId);

            throw;
        }

        return found;
    }

    /// <summary>
    /// The name and staff code behind a set of user ids.
    ///
    /// THIS ONE SWALLOWS ITS ERRORS, unlike the existence check above, and the asymmetry is the
    /// same one <see cref="FinancialDirectory"/> draws. A name is decoration: a register that
    /// cannot reach identity should print the campaigns with their owner column blank, not fail
    /// to load. The existence check is a refusal, and a refusal that cannot run must not
    /// silently pass.
    ///
    /// AN ID THAT RESOLVES TO NOTHING IS ABSENT FROM THE RESULT rather than present with a null
    /// name - the caller can then tell "no such user" from "a user with no display name", and
    /// only the first is worth showing differently.
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, PersonSummary>> GetPeopleAsync(
        Guid tenantId,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(userIds);

        var people = new Dictionary<Guid, PersonSummary>();

        if (tenantId == Guid.Empty || userIds.Count == 0)
        {
            return people;
        }

        // TENANT FILTERED IN THE QUERY, for the same reason the existence check is: a name is
        // still information, and resolving one across the organisation boundary would confirm
        // that a stranger's id belongs to somebody.
        //
        // display_name falls back to the first and last name because it is set from them at
        // creation and can be blank on a row imported another way - an owner column reading
        // "Arun Kumar" is what the screen is for, and one reading nothing is the bug being fixed.
        const string Sql = """
            SELECT id,
                   code,
                   NULLIF(TRIM(COALESCE(NULLIF(TRIM(display_name), ''),
                                        CONCAT_WS(' ', first_name, last_name))), '') AS name
            FROM iam_users
            WHERE tenant_id = @tenantId
              AND id = ANY(@ids)
            """;

        try
        {
            await using var command = await CreateCommandAsync(Sql, cancellationToken);

            command.Parameters.Add(new NpgsqlParameter("tenantId", NpgsqlDbType.Uuid)
            {
                Value = tenantId
            });

            command.Parameters.Add(new NpgsqlParameter("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
            {
                Value = userIds.Distinct().ToArray()
            });

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                var id = reader.GetGuid(0);

                people[id] = new PersonSummary(
                    id,
                    reader.IsDBNull(1) ? null : reader.GetString(1).Trim(),
                    reader.IsDBNull(2) ? null : reader.GetString(2));
            }
        }
        catch (NpgsqlException exception)
        {
            logger.LogError(
                exception,
                "Could not resolve display names for organisation {TenantId}. "
                + "The affected rows will display without one.",
                tenantId);
        }

        return people;
    }

    public async Task<IReadOnlyList<PersonSummary>> GetPeopleHoldingPermissionAsync(
        Guid tenantId,
        string permissionCode,
        IReadOnlyCollection<Guid>? amongUserIds,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(permissionCode);

        var people = new List<PersonSummary>();

        if (tenantId == Guid.Empty || amongUserIds is { Count: 0 })
        {
            return people;
        }

        // THROUGH AN ACTIVE ROLE, the same way IAM puts the claim on a token: an active user, an
        // active, unrevoked assignment inside its effective window, an active role - and either
        // the role grants everything (the Organisation Admin) or it holds the code and does not
        // deny it.
        const string Sql = """
            SELECT DISTINCT u.id,
                   u.code,
                   NULLIF(TRIM(COALESCE(NULLIF(TRIM(u.display_name), ''),
                                        CONCAT_WS(' ', u.first_name, u.last_name))), '') AS name
            FROM iam_users u
            JOIN iam_user_roles ur ON ur.user_id = u.id
            JOIN iam_roles r ON r.id = ur.role_id
            WHERE u.tenant_id = @tenantId
              AND u.status = 'Active'
              AND ur.status = 'Active'
              AND ur.revoked_at_utc IS NULL
              AND (ur.effective_from_utc IS NULL OR ur.effective_from_utc <= now())
              AND (ur.effective_to_utc IS NULL OR ur.effective_to_utc > now())
              AND r.status = 'Active'
              AND (@all OR u.id = ANY(@ids))
              AND (r.grants_all_tenant_permissions
                   OR EXISTS (SELECT 1
                              FROM iam_role_permissions rp
                              WHERE rp.role_id = r.id
                                AND rp.permission_code = @code
                                AND NOT rp.is_denied
                                AND (rp.expires_at_utc IS NULL OR rp.expires_at_utc > now())))
            ORDER BY name
            """;

        try
        {
            await using var command = await CreateCommandAsync(Sql, cancellationToken);

            command.Parameters.Add(new NpgsqlParameter("tenantId", NpgsqlDbType.Uuid) { Value = tenantId });
            command.Parameters.Add(new NpgsqlParameter("code", NpgsqlDbType.Varchar) { Value = permissionCode });
            command.Parameters.Add(new NpgsqlParameter("all", NpgsqlDbType.Boolean) { Value = amongUserIds is null });
            command.Parameters.Add(new NpgsqlParameter("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid)
            {
                Value = (amongUserIds ?? []).Distinct().ToArray()
            });

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                people.Add(new PersonSummary(
                    reader.GetGuid(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1).Trim(),
                    reader.IsDBNull(2) ? null : reader.GetString(2)));
            }
        }
        catch (NpgsqlException exception)
        {
            logger.LogError(
                exception,
                "Could not resolve the holders of {PermissionCode} for organisation {TenantId}.",
                permissionCode, tenantId);

            throw;
        }

        return people;
    }

    /// <summary>
    /// A command on the DbContext's own connection, inside its transaction when there is one, so
    /// this check sees writes the same request has already made.
    /// </summary>
    private async Task<NpgsqlCommand> CreateCommandAsync(string sql, CancellationToken cancellationToken)
    {
        var connection = (NpgsqlConnection)context.Database.GetDbConnection();

        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken);
        }

        var command = new NpgsqlCommand(sql, connection);

        if (context.Database.CurrentTransaction?.GetDbTransaction() is NpgsqlTransaction transaction)
        {
            command.Transaction = transaction;
        }

        return command;
    }
}
