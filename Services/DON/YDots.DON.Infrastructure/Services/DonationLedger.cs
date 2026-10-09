using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using YDots.DON.Application.Common.Abstractions.Services;
using YDots.DON.Infrastructure.Persistence;

namespace YDots.DON.Infrastructure.Services;

/// <summary>
/// The donor's giving, read from <c>pay_donations</c>. See <see cref="IDonationLedger"/> for why.
///
/// THE STATUSES THAT COUNT. PAY records a gift as Recorded, then Settled; a partial refund leaves
/// it PartiallyRefunded. Those three are money the charity has, net of whatever was refunded. A
/// Refunded or ChargedBack gift is money that left again, and a Voided one never happened - none
/// of them adds to Received.
///
/// A FAILURE IS AN EMPTY ANSWER, NEVER AN ERROR. The donor screens are DON's; if the payments
/// tables cannot be read they still open, and say "never given" rather than refusing to load.
/// The warning in the log is what tells somebody the figure is missing rather than zero.
/// </summary>
public sealed class DonationLedger(
    DonDbContext context,
    ILogger<DonationLedger> logger) : IDonationLedger
{
    /// <summary>The statuses whose money the charity has. See the class comment.</summary>
    private const string CountedStatuses = "('Recorded', 'Settled', 'PartiallyRefunded')";

    public async Task<IReadOnlyDictionary<Guid, DonorGiving>> GetGivingAsync(
        Guid organisationId,
        IReadOnlyCollection<Guid> donorIds,
        CancellationToken cancellationToken = default)
    {
        if (organisationId == Guid.Empty || donorIds.Count == 0)
        {
            return new Dictionary<Guid, DonorGiving>();
        }

        // Totals and the latest counted gift in one pass: the window picks each donor's newest
        // counted gift, and the aggregates run over every row of theirs.
        const string Sql = $"""
            WITH gifts AS (
                SELECT d.donor_id, d.amount, d.refunded_amount, d.currency_code, d.status,
                       d.donated_at_utc, d.campaign_id, d.reconciliation_status,
                       ROW_NUMBER() OVER (
                           PARTITION BY d.donor_id
                           ORDER BY (d.status IN {CountedStatuses}) DESC, d.donated_at_utc DESC) AS recency
                FROM pay_donations d
                WHERE d.tenant_id = @organisation_id
                  AND d.donor_id = ANY(@donor_ids)
            ),
            totals AS (
                SELECT g.donor_id,
                       COALESCE(SUM(CASE WHEN g.status IN {CountedStatuses}
                                         THEN g.amount - g.refunded_amount ELSE 0 END), 0) AS received,
                       COALESCE(SUM(CASE WHEN g.status IN ('PartiallyRefunded', 'Refunded') THEN g.refunded_amount
                                         WHEN g.status = 'ChargedBack' THEN g.amount
                                         ELSE 0 END), 0) AS refunded,
                       COUNT(*) FILTER (WHERE g.status IN {CountedStatuses}) AS gifts,
                       MAX(CASE WHEN g.recency = 1 AND g.status IN {CountedStatuses} THEN g.amount END) AS last_amount,
                       MAX(CASE WHEN g.recency = 1 AND g.status IN {CountedStatuses} THEN g.donated_at_utc END) AS last_at,
                       MAX(CASE WHEN g.recency = 1 AND g.status IN {CountedStatuses} THEN g.campaign_id::text END) AS last_campaign_id,
                       MAX(CASE WHEN g.recency = 1 THEN g.currency_code END) AS currency,
                       MIN(g.donated_at_utc) FILTER (WHERE g.status IN {CountedStatuses}) AS first_at,
                       COALESCE(SUM(CASE WHEN g.status IN {CountedStatuses}
                                          AND g.reconciliation_status IN ('Matched', 'ManuallyResolved')
                                         THEN g.amount - g.refunded_amount ELSE 0 END), 0) AS reconciled
                FROM gifts g
                GROUP BY g.donor_id
            )
            SELECT t.donor_id, t.received, t.refunded, t.gifts, t.last_amount, t.last_at,
                   t.last_campaign_id::uuid, t.currency, t.first_at, c.name, t.reconciled
            FROM totals t
            LEFT JOIN cam_campaigns c ON c.id = t.last_campaign_id::uuid
            """;

        try
        {
            var rows = await SharedDatabaseReader.ReadAsync(
                context,
                Sql,
                command =>
                {
                    command.AddParameter("organisation_id", organisationId, NpgsqlDbType.Uuid);
                    command.AddParameter("donor_ids", donorIds.ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Uuid);
                },
                reader => new DonorGiving(
                    reader.GetGuid(0),
                    reader.GetDecimal(1),
                    reader.GetDecimal(2),
                    (int)reader.GetInt64(3),
                    reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                    reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
                    reader.IsDBNull(6) ? null : reader.GetGuid(6),
                    reader.IsDBNull(9) ? null : reader.GetString(9),
                    reader.IsDBNull(7) ? "INR" : reader.GetString(7).Trim(),
                    reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
                    reader.GetDecimal(10)),
                cancellationToken);

            return rows.ToDictionary(row => row.DonorId);
        }
        catch (Exception exception) when (exception is PostgresException or NpgsqlException or InvalidOperationException)
        {
            logger.LogWarning(
                exception,
                "Could not read giving from the payments ledger for organisation {OrganisationId}. "
                + "Donor giving figures will show as not given.",
                organisationId);

            return new Dictionary<Guid, DonorGiving>();
        }
    }

    public async Task<IReadOnlyList<DonationRecord>> GetDonationsAsync(
        Guid organisationId,
        Guid donorId,
        int maximumRows,
        CancellationToken cancellationToken = default)
    {
        if (organisationId == Guid.Empty || donorId == Guid.Empty)
        {
            return [];
        }

        const string Sql = """
            SELECT d.id, d.donation_reference, d.donated_at_utc, d.amount, d.refunded_amount,
                   d.currency_code, d.status, d.campaign_id, c.name
            FROM pay_donations d
            LEFT JOIN cam_campaigns c ON c.id = d.campaign_id
            WHERE d.tenant_id = @organisation_id
              AND d.donor_id = @donor_id
            ORDER BY d.donated_at_utc DESC
            LIMIT @maximum_rows
            """;

        try
        {
            return await SharedDatabaseReader.ReadAsync(
                context,
                Sql,
                command =>
                {
                    command.AddParameter("organisation_id", organisationId, NpgsqlDbType.Uuid);
                    command.AddParameter("donor_id", donorId, NpgsqlDbType.Uuid);
                    command.AddParameter("maximum_rows", Math.Clamp(maximumRows, 1, 500), NpgsqlDbType.Integer);
                },
                reader => new DonationRecord(
                    reader.GetGuid(0),
                    reader.GetString(1),
                    reader.GetFieldValue<DateTimeOffset>(2),
                    reader.GetDecimal(3),
                    reader.GetDecimal(4),
                    reader.GetString(5).Trim(),
                    reader.GetString(6),
                    reader.IsDBNull(7) ? null : reader.GetGuid(7),
                    reader.IsDBNull(8) ? null : reader.GetString(8)),
                cancellationToken);
        }
        catch (Exception exception) when (exception is PostgresException or NpgsqlException or InvalidOperationException)
        {
            logger.LogWarning(exception, "Could not read the gifts of donor {DonorId} from the payments ledger.", donorId);
            return [];
        }
    }

    public async Task<(int Donors, decimal Amount, string Currency)> GetPeriodGivingAsync(
        Guid organisationId,
        IReadOnlyCollection<Guid> donorIds,
        DateTimeOffset sinceUtc,
        CancellationToken cancellationToken = default)
    {
        if (organisationId == Guid.Empty || donorIds.Count == 0)
        {
            return (0, 0m, "INR");
        }

        const string Sql = $"""
            SELECT COUNT(DISTINCT d.donor_id),
                   COALESCE(SUM(d.amount - d.refunded_amount), 0),
                   MAX(d.currency_code)
            FROM pay_donations d
            WHERE d.tenant_id = @organisation_id
              AND d.donor_id = ANY(@donor_ids)
              AND d.donated_at_utc >= @since
              AND d.status IN {CountedStatuses}
            """;

        try
        {
            var rows = await SharedDatabaseReader.ReadAsync(
                context,
                Sql,
                command =>
                {
                    command.AddParameter("organisation_id", organisationId, NpgsqlDbType.Uuid);
                    command.AddParameter("donor_ids", donorIds.ToArray(), NpgsqlDbType.Array | NpgsqlDbType.Uuid);
                    command.AddParameter("since", sinceUtc, NpgsqlDbType.TimestampTz);
                },
                reader => (
                    (int)reader.GetInt64(0),
                    reader.GetDecimal(1),
                    reader.IsDBNull(2) ? "INR" : reader.GetString(2).Trim()),
                cancellationToken);

            return rows.Count == 0 ? (0, 0m, "INR") : rows[0];
        }
        catch (Exception exception) when (exception is PostgresException or NpgsqlException or InvalidOperationException)
        {
            logger.LogWarning(exception, "Could not read recent giving from the payments ledger for organisation {OrganisationId}.", organisationId);
            return (0, 0m, "INR");
        }
    }

    public async Task<IReadOnlyList<CampaignGiving>> GetCampaignGivingAsync(
        Guid organisationId,
        Guid donorId,
        CancellationToken cancellationToken = default)
    {
        if (organisationId == Guid.Empty || donorId == Guid.Empty)
        {
            return [];
        }

        const string Sql = $"""
            SELECT d.campaign_id, c.code, c.name,
                   SUM(d.amount - d.refunded_amount) AS amount,
                   COUNT(*) AS gifts,
                   MAX(d.donated_at_utc) AS last_at
            FROM pay_donations d
            LEFT JOIN cam_campaigns c ON c.id = d.campaign_id
            WHERE d.tenant_id = @organisation_id
              AND d.donor_id = @donor_id
              AND d.campaign_id IS NOT NULL
              AND d.status IN {CountedStatuses}
            GROUP BY d.campaign_id, c.code, c.name
            ORDER BY MAX(d.donated_at_utc) DESC
            """;

        try
        {
            return await SharedDatabaseReader.ReadAsync(
                context,
                Sql,
                command =>
                {
                    command.AddParameter("organisation_id", organisationId, NpgsqlDbType.Uuid);
                    command.AddParameter("donor_id", donorId, NpgsqlDbType.Uuid);
                },
                reader => new CampaignGiving(
                    reader.GetGuid(0),
                    reader.IsDBNull(1) ? null : reader.GetString(1),
                    reader.IsDBNull(2) ? null : reader.GetString(2),
                    reader.GetDecimal(3),
                    (int)reader.GetInt64(4),
                    reader.GetFieldValue<DateTimeOffset>(5)),
                cancellationToken);
        }
        catch (Exception exception) when (exception is PostgresException or NpgsqlException or InvalidOperationException)
        {
            logger.LogWarning(exception, "Could not read campaign giving of donor {DonorId} from the payments ledger.", donorId);
            return [];
        }
    }
}
