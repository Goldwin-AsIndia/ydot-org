using Microsoft.EntityFrameworkCore;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Features.WhatsApp;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>
/// The selection pool: the organisation's validated WhatsApp numbers, which a person filters and
/// picks from before a send.
///
/// WHAT IS IN IT. A number one of the organisation's checks found on WhatsApp (final answer Yes)
/// whose NEWEST answer - from whichever organisation's check gave it - is still Yes. A number a
/// later check found is no longer on WhatsApp leaves the pool by itself, so nobody picks a dead
/// number and nobody pays WATI for one.
///
/// FILTERED ON THE SERVER, A PAGE AT A TIME. A pool runs to thousands of numbers; the page asks for
/// one page and the options of every filter, and "select all that match" asks for the matching
/// numbers up to the room left under the per-send cap.
/// </summary>
public sealed partial class WhatsAppIntegrationStore
{
    private const int MaximumPoolPageSize = 200;

    private static readonly IReadOnlyList<(string Value, string Label)> HistoryOptions =
    [
        ("any", "Any history"),
        ("never", "Never messaged"),
        ("messaged", "Messaged before"),
    ];

    /// <summary>
    /// The pool as a composable query: one row per number, offered from <paramref name="jobId"/> when
    /// given (only that check's Yes numbers), otherwise from the newest check that verified it.
    ///
    /// THE NAME is the one the offering check's file gave, else the newest any of the organisation's
    /// files gave; LAST MESSAGED and MESSAGES SENT count only messages WATI accepted.
    /// </summary>
    private IQueryable<PoolRow> Pool(Guid? jobId)
    {
        var tenantId = TenantId;

        return context.Database.SqlQuery<PoolRow>($"""
            SELECT pool.phone_number_id, pool.e164, pool.country_iso, pool.country_name, pool.checked_at_utc,
                   pool.job_id, pool.job_number, pool.original_file_name,
                   COALESCE(pool.contact_name, named.contact_name) AS contact_name,
                   last.messaged_at_utc AS last_messaged_at_utc,
                   last.template_name AS last_template_name,
                   COALESCE(sent.messages_sent, 0) AS messages_sent
            FROM (
                SELECT DISTINCT ON (n.phone_number_id)
                       n.phone_number_id, p.e164, p.country_iso, p.country_name,
                       COALESCE(p.whatsapp_checked_at_utc, n.created_at_utc) AS checked_at_utc,
                       j.id AS job_id, j.job_number, f.original_file_name, n.contact_name
                FROM int_input_file_numbers n
                JOIN int_phone_numbers p ON p.id = n.phone_number_id
                JOIN int_integration_jobs j ON j.id = n.job_id
                JOIN int_input_files f ON f.id = j.input_file_id
                WHERE n.tenant_id = {tenantId}
                  AND n.final_whatsapp_status = 'Yes'
                  AND p.whatsapp_status = 'Yes'
                  AND ({jobId}::uuid IS NULL OR n.job_id = {jobId}::uuid)
                ORDER BY n.phone_number_id, (n.classification = 'Duplicate'), n.created_at_utc DESC) pool
            LEFT JOIN LATERAL (
                SELECT x.contact_name
                FROM int_input_file_numbers x
                WHERE x.tenant_id = {tenantId}
                  AND x.phone_number_id = pool.phone_number_id
                  AND x.contact_name IS NOT NULL
                ORDER BY x.created_at_utc DESC
                LIMIT 1) named ON true
            LEFT JOIN LATERAL (
                SELECT COALESCE(m.sent_at_utc, m.completed_at_utc, m.queued_at_utc) AS messaged_at_utc, m.template_name
                FROM int_wati_messages m
                WHERE m.tenant_id = {tenantId}
                  AND m.phone_number_id = pool.phone_number_id
                  AND m.request_status = 'Accepted'
                ORDER BY m.queued_at_utc DESC
                LIMIT 1) last ON true
            LEFT JOIN LATERAL (
                SELECT count(*)::int AS messages_sent
                FROM int_wati_messages m
                WHERE m.tenant_id = {tenantId}
                  AND m.phone_number_id = pool.phone_number_id
                  AND m.request_status = 'Accepted') sent ON true
            """);
    }

    /// <summary>The pool with the person's filters applied (everything but the paging).</summary>
    private IQueryable<PoolRow> FilteredPool(WatiRecipientFilter filter)
    {
        var query = Pool(filter.JobId);

        if (!string.IsNullOrWhiteSpace(filter.Search))
        {
            var text = Contains(filter.Search);

            // "98765 43210" and "98765-43210" find +919876543210: a number is searched without its spacing.
            var digits = new string(filter.Search.Where(char.IsAsciiDigit).ToArray());
            var number = digits.Length >= 3 ? "%" + digits + "%" : null;

            query = query.Where(row =>
                (number != null && EF.Functions.Like(row.E164, number))
                || EF.Functions.ILike(row.ContactName ?? string.Empty, text, "\\")
                || EF.Functions.ILike(row.CountryName ?? string.Empty, text, "\\")
                || EF.Functions.ILike(row.JobNumber, text, "\\")
                || EF.Functions.ILike(row.OriginalFileName, text, "\\"));
        }

        if (!string.IsNullOrWhiteSpace(filter.Country))
        {
            var country = filter.Country.Trim().ToUpperInvariant();
            query = query.Where(row => row.CountryIso == country);
        }

        if (filter.GroupId is { } groupId)
        {
            var members = context.WhatsAppRecipientGroupMembers;
            query = query.Where(row => members.Any(member => member.GroupId == groupId && member.PhoneE164 == row.E164));
        }

        if (!string.IsNullOrWhiteSpace(filter.Tag))
        {
            var tag = filter.Tag.Trim();
            var members = context.WhatsAppRecipientGroupMembers;
            query = query.Where(row => members.Any(member => member.PhoneE164 == row.E164 && member.Group!.Tags.Contains(tag)));
        }

        query = filter.History?.Trim().ToLowerInvariant() switch
        {
            "never" => query.Where(row => row.MessagesSent == 0),
            "messaged" => query.Where(row => row.MessagesSent > 0),
            _ => query,
        };

        return query;
    }

    public Task<WatiRecipientSearchResponse> SearchRecipientsAsync(WatiRecipientFilter filter, CancellationToken cancellationToken)
    {
        var page = Math.Max(1, filter.Page);
        var pageSize = Math.Clamp(filter.PageSize, 1, MaximumPoolPageSize);

        return ReadAsync(
            async () =>
            {
                var query = FilteredPool(filter);
                var total = await query.CountAsync(cancellationToken);

                var rows = await query
                    .OrderByDescending(row => row.CheckedAtUtc)
                    .ThenBy(row => row.E164)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .ToListAsync(cancellationToken);

                var numbers = rows.Select(row => row.E164).ToList();
                var groupsByNumber = numbers.Count == 0
                    ? new Dictionary<string, List<string>>()
                    : (await context.WhatsAppRecipientGroupMembers
                            .Where(member => numbers.Contains(member.PhoneE164))
                            .Select(member => new { member.PhoneE164, member.Group!.Name })
                            .ToListAsync(cancellationToken))
                        .GroupBy(entry => entry.PhoneE164)
                        .ToDictionary(group => group.Key, group => group.Select(entry => entry.Name).OrderBy(name => name).ToList());

                var items = rows
                    .Select(row => new WatiRecipientView(
                        row.E164,
                        row.CountryIso ?? string.Empty,
                        row.CountryName ?? string.Empty,
                        row.ContactName,
                        row.CheckedAtUtc,
                        row.JobId,
                        row.JobNumber,
                        row.OriginalFileName,
                        row.LastMessagedAtUtc,
                        row.LastTemplateName,
                        row.MessagesSent,
                        groupsByNumber.TryGetValue(row.E164, out var groups) ? groups : []))
                    .ToList();

                return new WatiRecipientSearchResponse(
                    new PagedResponse<WatiRecipientView>(items, total, page, pageSize),
                    await PoolFacetsAsync(cancellationToken));
            },
            new WatiRecipientSearchResponse(
                PagedResponse<WatiRecipientView>.Empty(page, pageSize),
                new WatiRecipientFacets(0, [], [], [], [], HistoryOptions.Select(option => new WatiOptionFacet(option.Value, option.Label, 0)).ToList())));
    }

    public Task<WatiMatchingRecipients> GetMatchingRecipientsAsync(WatiRecipientFilter filter, int limit, CancellationToken cancellationToken)
    {
        var take = Math.Max(0, limit);

        return ReadAsync(
            async () =>
            {
                var query = FilteredPool(filter);
                var total = await query.CountAsync(cancellationToken);

                var rows = take == 0
                    ? []
                    : await query
                        .OrderByDescending(row => row.CheckedAtUtc)
                        .ThenBy(row => row.E164)
                        .Take(take)
                        .Select(row => new { row.E164, row.JobId, row.JobNumber, row.ContactName })
                        .ToListAsync(cancellationToken);

                return new WatiMatchingRecipients(
                    rows.Select(row => new WatiSelectableRecipient(row.E164, row.JobId, row.JobNumber, row.ContactName)).ToList(),
                    total,
                    take);
            },
            new WatiMatchingRecipients([], 0, take));
    }

    /// <summary>
    /// The options of every pool filter, each with its count - over the WHOLE pool, so an option
    /// never vanishes because another filter is set. Groups and tags are CAM's own tables, joined in
    /// the same SQL; that SQL names the organisation itself, because raw SQL bypasses the EF filter.
    /// </summary>
    private async Task<WatiRecipientFacets> PoolFacetsAsync(CancellationToken cancellationToken)
    {
        var tenantId = TenantId;

        var jobs = await context.Database
            .SqlQuery<JobFacetRow>($"""
                SELECT j.id AS job_id, j.job_number, f.original_file_name, j.created_at_utc,
                       count(DISTINCT n.phone_number_id)::int AS count
                FROM int_input_file_numbers n
                JOIN int_phone_numbers p ON p.id = n.phone_number_id
                JOIN int_integration_jobs j ON j.id = n.job_id
                JOIN int_input_files f ON f.id = j.input_file_id
                WHERE n.tenant_id = {tenantId}
                  AND n.final_whatsapp_status = 'Yes'
                  AND p.whatsapp_status = 'Yes'
                GROUP BY j.id, j.job_number, f.original_file_name, j.created_at_utc
                """)
            .OrderByDescending(row => row.CreatedAtUtc)
            .Take(MaximumPageSize)
            .ToListAsync(cancellationToken);

        var countries = await context.Database
            .SqlQuery<FacetRow>($"""
                SELECT COALESCE(pool.country_iso, '') AS value, COALESCE(pool.country_name, 'Unknown') AS label, count(*)::int AS count
                FROM (SELECT DISTINCT p.id, p.country_iso, p.country_name
                      FROM int_input_file_numbers n
                      JOIN int_phone_numbers p ON p.id = n.phone_number_id
                      WHERE n.tenant_id = {tenantId}
                        AND n.final_whatsapp_status = 'Yes'
                        AND p.whatsapp_status = 'Yes') pool
                GROUP BY 1, 2
                """)
            .OrderByDescending(row => row.Count)
            .ThenBy(row => row.Label)
            .ToListAsync(cancellationToken);

        var groups = await context.Database
            .SqlQuery<FacetRow>($"""
                SELECT g.id::text AS value, g.name AS label, count(pool.e164)::int AS count
                FROM cam_whatsapp_recipient_groups g
                LEFT JOIN cam_whatsapp_recipient_group_members gm ON gm.group_id = g.id
                LEFT JOIN (SELECT DISTINCT p.e164
                           FROM int_input_file_numbers n
                           JOIN int_phone_numbers p ON p.id = n.phone_number_id
                           WHERE n.tenant_id = {tenantId}
                             AND n.final_whatsapp_status = 'Yes'
                             AND p.whatsapp_status = 'Yes') pool ON pool.e164 = gm.phone_e164
                WHERE g.tenant_id = {tenantId}
                GROUP BY g.id, g.name
                """)
            .OrderBy(row => row.Label)
            .ToListAsync(cancellationToken);

        var tags = await context.Database
            .SqlQuery<FacetRow>($"""
                SELECT t.tag AS value, t.tag AS label, count(DISTINCT pool.e164)::int AS count
                FROM cam_whatsapp_recipient_groups g
                CROSS JOIN LATERAL unnest(g.tags) AS t(tag)
                LEFT JOIN cam_whatsapp_recipient_group_members gm ON gm.group_id = g.id
                LEFT JOIN (SELECT DISTINCT p.e164
                           FROM int_input_file_numbers n
                           JOIN int_phone_numbers p ON p.id = n.phone_number_id
                           WHERE n.tenant_id = {tenantId}
                             AND n.final_whatsapp_status = 'Yes'
                             AND p.whatsapp_status = 'Yes') pool ON pool.e164 = gm.phone_e164
                WHERE g.tenant_id = {tenantId}
                GROUP BY t.tag
                """)
            .OrderBy(row => row.Label)
            .ToListAsync(cancellationToken);

        var poolSize = countries.Sum(row => row.Count);
        var messaged = await context.Database
            .SqlQuery<FacetRow>($"""
                SELECT 'messaged' AS value, 'Messaged before' AS label, count(DISTINCT p.id)::int AS count
                FROM int_input_file_numbers n
                JOIN int_phone_numbers p ON p.id = n.phone_number_id
                WHERE n.tenant_id = {tenantId}
                  AND n.final_whatsapp_status = 'Yes'
                  AND p.whatsapp_status = 'Yes'
                  AND EXISTS (SELECT 1 FROM int_wati_messages m
                              WHERE m.tenant_id = {tenantId}
                                AND m.phone_number_id = p.id
                                AND m.request_status = 'Accepted')
                """)
            .Select(row => row.Count)
            .FirstOrDefaultAsync(cancellationToken);

        return new WatiRecipientFacets(
            poolSize,
            jobs.Select(row => new WatiJobFacet(row.JobId, row.JobNumber, row.OriginalFileName, row.Count, row.CreatedAtUtc)).ToList(),
            countries.Select(row => new WatiCountryFacet(row.Value, row.Label, row.Count)).ToList(),
            groups.Where(row => Guid.TryParse(row.Value, out _)).Select(row => new WatiGroupFacet(Guid.Parse(row.Value), row.Label, row.Count)).ToList(),
            tags.Select(row => new WatiTagFacet(row.Value, row.Count)).ToList(),
            HistoryOptions.Select(option => new WatiOptionFacet(
                option.Value,
                option.Label,
                option.Value switch { "never" => poolSize - messaged, "messaged" => messaged, _ => poolSize })).ToList());
    }

    // =====================================================================================
    // What the organisation's checks said about given numbers (review, groups)
    // =====================================================================================

    public Task<IReadOnlyDictionary<string, IReadOnlyList<CheckedNumberFacts>>> GetCheckedNumbersAsync(
        IReadOnlyCollection<string> numbers, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlyDictionary<string, IReadOnlyList<CheckedNumberFacts>>>(
            async () =>
            {
                if (numbers.Count == 0)
                {
                    return new Dictionary<string, IReadOnlyList<CheckedNumberFacts>>();
                }

                var tenantId = TenantId;
                var wanted = numbers.Distinct(StringComparer.Ordinal).ToArray();

                var rows = await context.Database
                    .SqlQuery<CheckedNumberRow>($"""
                        SELECT n.normalized_number AS e164, n.job_id, j.job_number, n.final_whatsapp_status,
                               p.whatsapp_status AS registry_status, n.contact_name, n.created_at_utc, n.classification
                        FROM int_input_file_numbers n
                        JOIN int_phone_numbers p ON p.id = n.phone_number_id
                        JOIN int_integration_jobs j ON j.id = n.job_id
                        WHERE n.tenant_id = {tenantId}
                          AND n.normalized_number = ANY({wanted})
                          AND n.final_whatsapp_status IS NOT NULL
                        """)
                    .ToListAsync(cancellationToken);

                return rows
                    .GroupBy(row => row.E164, StringComparer.Ordinal)
                    .ToDictionary(
                        group => group.Key,
                        group => (IReadOnlyList<CheckedNumberFacts>)group
                            .OrderByDescending(row => row.CreatedAtUtc)
                            .Select(row => new CheckedNumberFacts(
                                row.E164, row.JobId, row.JobNumber, row.FinalWhatsAppStatus, row.RegistryStatus,
                                row.ContactName, row.CreatedAtUtc, row.Classification != "Duplicate"))
                            .ToList(),
                        StringComparer.Ordinal);
            },
            new Dictionary<string, IReadOnlyList<CheckedNumberFacts>>());

    public Task<IReadOnlySet<string>> GetAlreadySentAsync(
        string templateName, Guid? campaignId, IReadOnlyCollection<string> numbers, DateTimeOffset? since, CancellationToken cancellationToken) =>
        ReadAsync<IReadOnlySet<string>>(
            async () =>
            {
                if (numbers.Count == 0 || string.IsNullOrWhiteSpace(templateName))
                {
                    return new HashSet<string>();
                }

                var tenantId = TenantId;
                var wanted = numbers.Distinct(StringComparer.Ordinal).ToArray();
                var accepted = WhatsAppSendRules.AcceptedStatuses.ToArray();

                // The worker's own rule: same organisation, same template, same campaign (or both
                // without one), a message WATI accepted - within the look-back window when one is set.
                var rows = await context.Database
                    .SqlQuery<E164Row>($"""
                        SELECT DISTINCT p.e164
                        FROM int_wati_messages m
                        JOIN int_phone_numbers p ON p.id = m.phone_number_id
                        WHERE m.tenant_id = {tenantId}
                          AND m.template_name = {templateName}
                          AND m.campaign_id IS NOT DISTINCT FROM {campaignId}::uuid
                          AND p.e164 = ANY({wanted})
                          AND m.status = ANY({accepted})
                          AND ({since}::timestamptz IS NULL OR m.completed_at_utc >= {since}::timestamptz)
                        """)
                    .ToListAsync(cancellationToken);

                return rows.Select(row => row.E164).ToHashSet(StringComparer.Ordinal);
            },
            new HashSet<string>());
}
