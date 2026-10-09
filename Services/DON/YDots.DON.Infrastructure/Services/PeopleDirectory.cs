using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Infrastructure.Persistence;

namespace YDots.DON.Infrastructure.Services;

/// <summary>
/// The Organisation's people, read from the identity tables over the shared database.
///
/// WHY THIS EXISTS. DON has no user table - IAM owns those - so the owner selector was built from
/// the names already recorded on leads and assignments. That works once work is flowing and fails
/// completely before it is: a brand-new Organisation has no leads, so it has no owner names, so
/// the Assignment Board offers NOBODY TO ASSIGN TO, so no lead can be given an owner, so there is
/// still no owner name tomorrow. The list could only ever contain people who were already on it.
///
/// READ-ONLY, WITHOUT EXCEPTION. DON never creates, renames or deactivates a user. If identity
/// ever moves to a database of its own, this one class is what changes.
///
/// NOTHING HERE THROWS. If the identity tables cannot be reached the selector falls back to the
/// names already known from leads, which is exactly what it showed before this existed.
/// </summary>
public sealed class PeopleDirectory(
    DonDbContext context,
    ILogger<PeopleDirectory> logger) : IPeopleDirectory
{
    /// <summary>
    /// Who may be given a lead, a donor or a follow-up.
    ///
    /// ACTIVE STAFF WHO CAN WORK THEM. It used to be every active account in the Organisation, so
    /// the owner pickers offered all twelve donor-portal logins beside the fundraisers - a lead
    /// could be "assigned" to a member of the public who could never open it - and a Campaign
    /// Executive who cannot see a lead was offered as one's owner too. An account qualifies when
    /// it is an Employee and one of its live roles either grants everything (Organisation Admin)
    /// or carries the lead queue or the follow-up queue - which is the Fundraising Manager, the
    /// Fundraiser Executive and DonorCare.
    ///
    /// Somebody suspended, deactivated or withdrawn never appears: handing them work would mean
    /// the lead sits with a person who cannot sign in to act on it, and nobody would notice until
    /// the donor did.
    /// </summary>
    public async Task<IReadOnlyList<(Guid UserId, string Name)>> GetAssignableAsync(
        Guid organisationId, CancellationToken cancellationToken)
    {
        if (organisationId == Guid.Empty)
        {
            return [];
        }

        const string Sql = """
            SELECT DISTINCT u.id, u.display_name
            FROM iam_users u
            JOIN iam_user_roles ur
              ON ur.user_id = u.id
             AND ur.status = 'Active'
             AND ur.revoked_at_utc IS NULL
             AND ur.effective_from_utc <= now()
             AND (ur.effective_to_utc IS NULL OR ur.effective_to_utc > now())
            JOIN iam_roles r
              ON r.id = ur.role_id
             AND r.status = 'Active'
            WHERE u.tenant_id = @organisation_id
              AND u.status = 'Active'
              AND u.account_category = 'Employee'
              AND (r.grants_all_tenant_permissions
                   OR EXISTS (
                       SELECT 1
                       FROM iam_role_permissions rp
                       WHERE rp.role_id = r.id
                         AND rp.is_denied = false
                         AND rp.permission_code IN ('don.lead-work-queue.view', 'don.follow-up-planner.view')
                         AND (rp.expires_at_utc IS NULL OR rp.expires_at_utc > now())))
            ORDER BY u.display_name
            """;

        try
        {
            return await SharedDatabaseReader.ReadAsync(
                context,
                Sql,
                command => command.AddParameter("organisation_id", organisationId, NpgsqlDbType.Uuid),
                reader => (reader.GetGuid(0), reader.GetString(1)),
                cancellationToken);
        }
        catch (Exception exception) when (exception is PostgresException
                                              or NpgsqlException
                                              or InvalidOperationException)
        {
            logger.LogWarning(
                exception,
                "Could not read the people list for organisation {OrganisationId}. "
                + "The owner selector will show only the owners already known from leads.",
                organisationId);

            return [];
        }
    }

    /// <summary>
    /// Display names for the given ids, inside this Organisation.
    ///
    /// Used where DON recorded only an id - the actor on an audit row - so a history can say who
    /// did something rather than which Guid did it. The platform root acts in every Organisation
    /// without belonging to one, so accounts with no Organisation are matched as well.
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, string>> GetNamesAsync(
        Guid organisationId,
        IReadOnlyCollection<Guid> userIds,
        CancellationToken cancellationToken)
    {
        var ids = userIds.Where(id => id != Guid.Empty).Distinct().ToArray();

        if (ids.Length == 0)
        {
            return new Dictionary<Guid, string>();
        }

        const string Sql = """
            SELECT u.id, u.display_name
            FROM iam_users u
            WHERE u.id = ANY(@user_ids)
              AND (u.tenant_id = @organisation_id OR u.tenant_id IS NULL)
            """;

        try
        {
            var rows = await SharedDatabaseReader.ReadAsync(
                context,
                Sql,
                command =>
                {
                    command.AddParameter("organisation_id", organisationId, NpgsqlDbType.Uuid);
                    command.AddParameter("user_ids", ids, NpgsqlDbType.Array | NpgsqlDbType.Uuid);
                },
                reader => (Id: reader.GetGuid(0), Name: reader.GetString(1)),
                cancellationToken);

            return rows.ToDictionary(row => row.Id, row => row.Name);
        }
        catch (Exception exception) when (exception is PostgresException
                                              or NpgsqlException
                                              or InvalidOperationException)
        {
            logger.LogWarning(exception, "Could not read people's names for organisation {OrganisationId}.", organisationId);
            return new Dictionary<Guid, string>();
        }
    }
}
