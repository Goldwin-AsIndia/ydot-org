using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Settings;
using YDots.CAM.Application.Features.WhatsApp.Commands;
using YDots.CAM.Application.Features.WhatsApp.DTOs;
using YDots.CAM.Infrastructure.Persistence;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>
/// The YDot.Integration worker's int_* tables, read over the shared database for the WhatsApp
/// screens.
///
/// READ-ONLY, WITH ONE EXCEPTION. The worker owns these tables and their migrations; CAM never
/// creates, alters or updates them. The one thing CAM writes is a new row in
/// int_worker_commands - a request ("retry this job", "send this broadcast") that the worker
/// picks up and carries out. CAM never calls CheckNumber.ai or WATI itself, so there is exactly
/// one place where money can be spent and one place that has to be restart-safe.
///
/// THE ROWS ARE NOT IN CampaignDbContext's MODEL. They are read with raw SQL on the context's
/// own connection (as <c>FinancialDirectory</c> and <c>PeopleDirectory</c> read PAY's and IAM's
/// tables), so CAM's migrations and model snapshot know nothing about them and
/// <c>dotnet ef</c> keeps working with a single DbContext.
///
/// EVERY ORGANISATION-OWNED TABLE IS FILTERED AT ITS SOURCE. The table sources below put
/// <c>tenant_id = current</c> inside the SQL itself, so no query built on them can reach
/// another organisation's rows, and nothing has to remember a Where clause.
///
/// WHEN THE WORKER HAS NEVER RUN against this database the tables do not exist. Reads then
/// answer "nothing yet" and the overview says the integration is not available, rather than the
/// screens failing with an error nobody can act on.
/// </summary>
public sealed partial class WhatsAppIntegrationStore(
    CampaignDbContext context,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    IDateTimeProvider clock,
    IOptions<WhatsAppIntegrationSettings> settings,
    ILogger<WhatsAppIntegrationStore> logger) : IWhatsAppIntegrationStore
{
    private const string UndefinedTable = "42P01";
    private const string UndefinedColumn = "42703";
    private const string UniqueViolation = "23505";

    /// <summary>The job statuses after which the worker will not pick a job up again by itself.</summary>
    private static readonly string[] FinishedJobStatuses = ["Completed", "CompletedWithErrors", "Failed", "Cancelled"];

    private Guid? TenantId => tenantContext.TenantId;

    // =====================================================================================
    // Table sources. Organisation-owned tables carry the organisation filter in the SQL.
    // =====================================================================================

    private IQueryable<InputFileRow> Files =>
        context.Database.SqlQuery<InputFileRow>($"SELECT * FROM int_input_files WHERE tenant_id = {TenantId}");

    private IQueryable<IntegrationJobRow> Jobs =>
        context.Database.SqlQuery<IntegrationJobRow>($"SELECT * FROM int_integration_jobs WHERE tenant_id = {TenantId}");

    private IQueryable<InputFileNumberRow> FileNumbers =>
        context.Database.SqlQuery<InputFileNumberRow>($"SELECT * FROM int_input_file_numbers WHERE tenant_id = {TenantId}");

    private IQueryable<CheckNumberTaskRow> Tasks =>
        context.Database.SqlQuery<CheckNumberTaskRow>($"SELECT * FROM int_checknumber_tasks WHERE tenant_id = {TenantId}");

    private IQueryable<JobEventRow> Events =>
        context.Database.SqlQuery<JobEventRow>($"SELECT * FROM int_job_events WHERE tenant_id = {TenantId}");

    private IQueryable<WatiJobRow> WatiJobs =>
        context.Database.SqlQuery<WatiJobRow>($"SELECT * FROM int_wati_jobs WHERE tenant_id = {TenantId}");

    private IQueryable<WatiMessageRow> WatiMessages =>
        context.Database.SqlQuery<WatiMessageRow>($"SELECT * FROM int_wati_messages WHERE tenant_id = {TenantId}");

    private IQueryable<WorkerCommandRow> Commands =>
        context.Database.SqlQuery<WorkerCommandRow>($"SELECT * FROM int_worker_commands WHERE tenant_id = {TenantId}");

    /// <summary>
    /// int_job_steps and int_checknumber_result_files carry no organisation column: they are only
    /// ever read for a job that was first found through <see cref="Jobs"/>, which is filtered.
    /// </summary>
    private IQueryable<JobStepRow> StepsOf(Guid jobId) =>
        context.Database.SqlQuery<JobStepRow>($"SELECT * FROM int_job_steps WHERE job_id = {jobId}");

    private IQueryable<CheckNumberResultFileRow> ResultFilesOf(Guid jobId) =>
        context.Database.SqlQuery<CheckNumberResultFileRow>($"SELECT * FROM int_checknumber_result_files WHERE job_id = {jobId}");

    /// <summary>
    /// NOT ORGANISATION-FILTERED, deliberately: the WATI account and the worker itself serve
    /// every organisation, so its templates and its heartbeat are the same for all of them.
    /// </summary>
    private IQueryable<WatiTemplateRow> Templates =>
        context.Database.SqlQuery<WatiTemplateRow>($"SELECT * FROM int_wati_templates");

    private IQueryable<WorkerInstanceRow> Workers =>
        context.Database.SqlQuery<WorkerInstanceRow>($"SELECT * FROM int_worker_instances");

    // =====================================================================================
    // Overview
    // =====================================================================================

    public Task<WhatsAppOverviewResponse> GetOverviewAsync(CancellationToken cancellationToken) =>
        ReadAsync(
            async () =>
            {
                var worker = await LatestWorkerAsync(cancellationToken);
                var tenantId = TenantId;

                var figures = await context.Database
                    .SqlQuery<StatisticsRow>($"""
                        SELECT
                            (SELECT count(DISTINCT n.phone_number_id)
                               FROM int_input_file_numbers n
                              WHERE n.tenant_id = {tenantId}
                                AND n.final_whatsapp_status IN ('Yes', 'No'))::int AS numbers_verified,
                            (SELECT count(DISTINCT n.phone_number_id)
                               FROM int_input_file_numbers n
                               JOIN int_phone_numbers p ON p.id = n.phone_number_id
                              WHERE n.tenant_id = {tenantId}
                                AND n.final_whatsapp_status = 'Yes'
                                AND p.whatsapp_status = 'Yes')::int AS on_whatsapp,
                            (SELECT count(*) FROM int_integration_jobs j
                              WHERE j.tenant_id = {tenantId})::int AS jobs_run,
                            (SELECT count(*) FROM int_integration_jobs j
                              WHERE j.tenant_id = {tenantId}
                                AND j.status NOT IN ('Completed', 'CompletedWithErrors', 'Failed', 'Cancelled'))::int AS jobs_running,
                            m.messages_sent, m.messages_delivered, m.messages_read, m.messages_failed
                        FROM (
                            SELECT
                                (count(*) FILTER (WHERE request_status = 'Accepted'))::int AS messages_sent,
                                (count(*) FILTER (WHERE status IN ('Delivered', 'Read', 'Replied')))::int AS messages_delivered,
                                (count(*) FILTER (WHERE status IN ('Read', 'Replied')))::int AS messages_read,
                                (count(*) FILTER (WHERE status = 'Failed'))::int AS messages_failed
                            FROM int_wati_messages
                            WHERE tenant_id = {tenantId}) m
                        """)
                    .SingleAsync(cancellationToken);

                var statistics = new WhatsAppStatistics(
                    figures.NumbersVerified,
                    figures.OnWhatsApp,
                    figures.JobsRun,
                    figures.JobsRunning,
                    figures.MessagesSent,
                    figures.MessagesDelivered,
                    figures.MessagesRead,
                    figures.MessagesFailed,
                    figures.MessagesDelivered > 0
                        ? (int)Math.Round(figures.MessagesRead * 100d / figures.MessagesDelivered)
                        : 0);

                return new WhatsAppOverviewResponse(
                    IntegrationAvailable: true,
                    WorkerStatusOf(worker),
                    ParseSettings(worker?.SettingsJson),
                    statistics);
            },
            new WhatsAppOverviewResponse(
                IntegrationAvailable: false,
                new WhatsAppWorkerStatus(false, null, null, null, null),
                NoSettings,
                new WhatsAppStatistics(0, 0, 0, 0, 0, 0, 0, 0, 0)));

    /// <summary>
    /// The instance that reported most recently. Several workers may run side by side; the screens
    /// only need to know that at least one is alive and what it is configured to do.
    /// </summary>
    private Task<WorkerInstanceRow?> LatestWorkerAsync(CancellationToken cancellationToken) =>
        Workers.OrderByDescending(worker => worker.LastHeartbeatAtUtc).FirstOrDefaultAsync(cancellationToken);

    private WhatsAppWorkerStatus WorkerStatusOf(WorkerInstanceRow? worker)
    {
        if (worker is null)
        {
            return new WhatsAppWorkerStatus(false, null, null, null, null);
        }

        // A worker that stopped cleanly says so; one that was killed simply stops reporting, and
        // is treated as offline once its last heartbeat is older than the configured allowance.
        var silentFor = clock.UtcNow - worker.LastHeartbeatAtUtc;
        var online = worker.StoppedAtUtc is null
                     && silentFor <= TimeSpan.FromSeconds(settings.Value.WorkerOfflineAfterSeconds);

        return new WhatsAppWorkerStatus(
            online, worker.InstanceName, worker.Version, worker.StartedAtUtc, worker.LastHeartbeatAtUtc);
    }

    // =====================================================================================
    // "Which of these were checked before?"
    // =====================================================================================

    /// <summary>
    /// THE SAME RULE THE WORKER APPLIES WHEN IT PARSES THE FILE, so the review screen and the job
    /// agree about what will be paid for: with the Global reuse scope any organisation's Yes/No
    /// answer is reused; with the Tenant scope only this organisation's own; and an answer older
    /// than ResultValidityDays (when that is set) is not reused at all.
    /// </summary>
    public Task<NumberLookupResponse> LookupAsync(
        IReadOnlyCollection<string> numbers, CancellationToken cancellationToken) =>
        ReadAsync(
            async () =>
            {
                var worker = await LatestWorkerAsync(cancellationToken);
                var workerSettings = ParseSettings(worker?.SettingsJson);

                if (numbers.Count == 0)
                {
                    return new NumberLookupResponse([], workerSettings.ReuseScope);
                }

                var wanted = numbers.ToArray();
                var tenantId = TenantId;
                DateTimeOffset? notBefore = workerSettings.ResultValidityDays > 0
                    ? clock.UtcNow.AddDays(-workerSettings.ResultValidityDays)
                    : null;

                var tenantOnly = string.Equals(workerSettings.ReuseScope, "Tenant", StringComparison.OrdinalIgnoreCase);

                var rows = tenantOnly
                    ? await context.Database
                        .SqlQuery<NumberAnswerRow>($"""
                            SELECT p.e164, a.whatsapp_status, a.checked_at_utc,
                                   EXISTS (SELECT 1 FROM int_input_file_numbers n
                                            WHERE n.tenant_id = {tenantId}
                                              AND n.phone_number_id = p.id
                                              AND n.final_whatsapp_status = 'Yes') AS shared_to_wati
                            FROM int_phone_numbers p
                            JOIN LATERAL (
                                SELECT r.whatsapp_status, r.checked_at_utc
                                FROM int_checknumber_results r
                                JOIN int_checknumber_tasks t ON t.id = r.checknumber_task_id AND NOT t.is_superseded
                                WHERE r.tenant_id = {tenantId}
                                  AND r.phone_number_id = p.id
                                  AND r.whatsapp_status IN ('Yes', 'No')
                                ORDER BY r.checked_at_utc DESC
                                LIMIT 1) a ON true
                            WHERE p.e164 = ANY({wanted})
                              AND ({notBefore}::timestamptz IS NULL OR a.checked_at_utc >= {notBefore}::timestamptz)
                            """)
                        .ToListAsync(cancellationToken)
                    : await context.Database
                        .SqlQuery<NumberAnswerRow>($"""
                            SELECT p.e164, p.whatsapp_status, p.whatsapp_checked_at_utc AS checked_at_utc,
                                   EXISTS (SELECT 1 FROM int_input_file_numbers n
                                            WHERE n.tenant_id = {tenantId}
                                              AND n.phone_number_id = p.id
                                              AND n.final_whatsapp_status = 'Yes') AS shared_to_wati
                            FROM int_phone_numbers p
                            WHERE p.e164 = ANY({wanted})
                              AND p.whatsapp_status IN ('Yes', 'No')
                              AND p.whatsapp_checked_at_utc IS NOT NULL
                              AND ({notBefore}::timestamptz IS NULL OR p.whatsapp_checked_at_utc >= {notBefore}::timestamptz)
                            """)
                        .ToListAsync(cancellationToken);

                var answers = rows
                    .Select(row => new NumberAnswer(
                        row.E164,
                        row.WhatsAppStatus == "Yes" ? "yes" : "no",
                        row.CheckedAtUtc,
                        row.SharedToWati))
                    .ToList();

                return new NumberLookupResponse(answers, workerSettings.ReuseScope);
            },
            new NumberLookupResponse([], NoSettings.ReuseScope));

    // =====================================================================================
    // Requests for the worker
    // =====================================================================================

    public async Task<CommandAcceptedResponse?> QueueCommandAsync(
        string commandType, string referencePrefix, object payload, CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.RequireTenantId();
        var payloadJson = JsonSerializer.Serialize(payload, PayloadJson);
        Guid? requestedBy = currentUser.UserId == Guid.Empty ? null : currentUser.UserId;
        var requestedByName = currentUser.DisplayName ?? currentUser.Username;

        // Two attempts: the reference is random, and its unique index is what guarantees two
        // requests can never share one. A collision is close to impossible, but "close to" is
        // not a reason to answer 500.
        for (var attempt = 1; ; attempt++)
        {
            var id = Guid.CreateVersion7();
            var now = clock.UtcNow;
            var reference = WhatsAppCommandHandler.NewReference(referencePrefix, now);

            try
            {
                await context.Database.ExecuteSqlInterpolatedAsync(
                    $"""
                     INSERT INTO int_worker_commands
                         (id, tenant_id, reference, command_type, status, payload_json,
                          requested_by_user_id, requested_by_name, requested_at_utc, attempts)
                     VALUES
                         ({id}, {tenantId}, {reference}, {commandType}, 'Pending', {payloadJson}::jsonb,
                          {requestedBy}, {requestedByName}, {now}, 0)
                     """,
                    cancellationToken);

                logger.LogInformation(
                    "WhatsApp request {Reference} ({CommandType}) left for the integration worker.",
                    reference, commandType);

                return new CommandAcceptedResponse(id, reference, "Pending");
            }
            catch (PostgresException exception) when (exception.SqlState == UniqueViolation && attempt == 1)
            {
                logger.LogWarning("WhatsApp request reference {Reference} was already taken; another is generated.", reference);
            }
            catch (PostgresException exception) when (exception.SqlState is UndefinedTable or UndefinedColumn)
            {
                LogUnavailable(exception, nameof(QueueCommandAsync));
                return null;
            }
        }
    }

    public Task<CommandStatusResponse?> GetCommandAsync(string reference, CancellationToken cancellationToken) =>
        ReadAsync<CommandStatusResponse?>(
            async () =>
            {
                var command = await Commands
                    .Where(row => row.Reference == reference)
                    .FirstOrDefaultAsync(cancellationToken);

                return command is null
                    ? null
                    : new CommandStatusResponse(
                        command.Id,
                        command.Reference,
                        command.CommandType,
                        command.Status,
                        command.ResultMessage,
                        command.ResultEntityId,
                        command.RequestedAtUtc,
                        command.ProcessedAtUtc);
            },
            null);

    // =====================================================================================
    // Helpers
    // =====================================================================================

    /// <summary>camelCase, as the worker's CommandPayloads contract reads it.</summary>
    private static readonly JsonSerializerOptions PayloadJson = new(JsonSerializerDefaults.Web);

    private static readonly WhatsAppSettingsView NoSettings = new(
        CheckNumberEnabled: false,
        CheckNumberConfigured: false,
        WatiEnabled: false,
        WatiConfigured: false,
        AutoSendWati: false,
        ManualBroadcastsAllowed: false,
        PricePerNumber: 0m,
        MinimumChargePerTask: 0m,
        Currency: "USD",
        MaxFileSizeMegabytes: 10,
        PollingIntervalSeconds: 0,
        MaxPollingAttempts: 0,
        ReuseScope: "Global",
        ResultValidityDays: 0,
        DefaultTemplateName: null,
        DefaultBroadcastName: null,
        MaxRecipientsPerJob: 0,
        AllowListActive: false,
        AllowListSize: 0,
        BatchSize: 0,
        MaxRecipientsPerSend: 0,
        MinimumNumbersPerTask: 1,
        BillableMinimumNumbers: 0,
        SendToUnverifiedNumbers: false,
        SkipAlreadyMessagedNumbers: true,
        DuplicateWindowDays: 0,
        RetryableFailureCodes: [],
        AllowListFingerprints: []);

    /// <summary>
    /// Runs a read, answering <paramref name="whenUnavailable"/> when the worker's tables are not
    /// there (it has never been started against this database) or do not match this read model
    /// (the worker is a different version).
    ///
    /// ONLY THOSE TWO STATES ARE SWALLOWED. A dropped connection or a timeout still fails the
    /// request: answering "no jobs" then would be a lie, where "the integration is not installed"
    /// is simply true.
    /// </summary>
    private async Task<T> ReadAsync<T>(
        Func<Task<T>> read,
        T whenUnavailable,
        [System.Runtime.CompilerServices.CallerMemberName] string? operation = null)
    {
        try
        {
            return await read();
        }
        catch (PostgresException exception) when (exception.SqlState is UndefinedTable or UndefinedColumn)
        {
            LogUnavailable(exception, operation);
            return whenUnavailable;
        }
    }

    private void LogUnavailable(PostgresException exception, string? operation)
    {
        if (exception.SqlState == UndefinedTable)
        {
            logger.LogWarning(
                "WhatsApp {Operation}: the integration worker's tables are not in this database yet ({Detail}). "
                + "Start YDot.Integration.Worker once against it to create them.",
                operation, exception.MessageText);
        }
        else
        {
            logger.LogError(
                "WhatsApp {Operation}: the integration worker's schema does not match what CAM reads ({Detail}). "
                + "CAM and YDot.Integration.Worker must be deployed at matching versions.",
                operation, exception.MessageText);
        }
    }

    /// <summary>
    /// The worker's effective, non-secret settings, exactly as it published them with its
    /// heartbeat. Read from there rather than from CAM's own configuration so the screens show
    /// what the worker will actually do - a price or a recipient cap copied into a second
    /// settings file is a figure that is wrong the first time somebody changes only one of them.
    /// </summary>
    private WhatsAppSettingsView ParseSettings(string? settingsJson)
    {
        if (string.IsNullOrWhiteSpace(settingsJson))
        {
            return NoSettings;
        }

        try
        {
            using var document = JsonDocument.Parse(settingsJson);
            var root = document.RootElement;
            var pipeline = Section(root, "pipeline");
            var checkNumber = Section(root, "checkNumber");
            var wati = Section(root, "wati");
            var worker = Section(root, "worker");

            var workerCap = Number(wati, "maxRecipientsPerJob");
            var price = Amount(checkNumber, "pricePerNumberUsd");
            var minimumCharge = Amount(checkNumber, "minimumChargePerTaskUsd");
            var billableMinimum = Number(checkNumber, "billableMinimumNumbers");

            return new WhatsAppSettingsView(
                CheckNumberEnabled: Flag(pipeline, "enableCheckNumber"),
                CheckNumberConfigured: Flag(checkNumber, "configured"),
                WatiEnabled: Flag(pipeline, "enableWati"),
                WatiConfigured: Flag(wati, "configured"),

                // An older worker may still publish true; it no longer means anything to the pages.
                AutoSendWati: false,
                ManualBroadcastsAllowed: Flag(pipeline, "allowManualWatiBroadcasts"),
                PricePerNumber: price,
                MinimumChargePerTask: minimumCharge,
                Currency: Text(checkNumber, "currency") ?? "USD",
                MaxFileSizeMegabytes: Number(worker, "maxFileSizeMegabytes", NoSettings.MaxFileSizeMegabytes),
                PollingIntervalSeconds: Number(checkNumber, "pollingIntervalSeconds"),
                MaxPollingAttempts: Number(checkNumber, "maxPollingAttempts"),
                ReuseScope: Text(checkNumber, "reuseScope") ?? "Global",
                ResultValidityDays: Number(checkNumber, "resultValidityDays"),
                DefaultTemplateName: Text(wati, "defaultTemplateName"),
                DefaultBroadcastName: Text(wati, "defaultBroadcastName"),
                MaxRecipientsPerJob: workerCap,
                AllowListActive: Flag(wati, "allowListActive"),
                AllowListSize: Number(wati, "allowListSize"),
                BatchSize: Number(wati, "batchSize"),
                MaxRecipientsPerSend: EffectiveCap(workerCap),
                MinimumNumbersPerTask: Math.Max(1, Number(checkNumber, "minimumNumbersPerTask", 1)),

                // Published by a current worker; worked out from the prices for an older one.
                BillableMinimumNumbers: billableMinimum > 0
                    ? billableMinimum
                    : price > 0 ? (int)Math.Ceiling(minimumCharge / price) : 0,
                SendToUnverifiedNumbers: Flag(wati, "sendToUnverifiedNumbers"),
                SkipAlreadyMessagedNumbers: wati is not { } section || !section.TryGetProperty("skipAlreadyMessagedNumbers", out _) || Flag(wati, "skipAlreadyMessagedNumbers"),
                DuplicateWindowDays: Number(wati, "duplicateWindowDays"),
                RetryableFailureCodes: Strings(wati, "retryableFailureCodes") is { Count: > 0 } codes ? codes : DefaultRetryableFailureCodes,

                // SHA-256 of each allow-listed number's digits: the review marks NOT_IN_ALLOWLIST without
                // the numbers being published. Never sent to the browser (JsonIgnore on the view).
                AllowListFingerprints: Strings(wati, "allowListSha256"));
        }
        catch (JsonException)
        {
            return NoSettings;
        }
    }

    /// <summary>
    /// The most numbers one send may carry: the worker's cap, never more than this server's own
    /// ceiling - and that ceiling alone when the worker sets no cap (0).
    /// </summary>
    private int EffectiveCap(int workerCap)
    {
        var ceiling = Math.Max(1, settings.Value.MaxRecipientsPerSend);
        return workerCap > 0 ? Math.Min(workerCap, ceiling) : ceiling;
    }

    /// <summary>The worker's retryable failure codes, for an older worker that does not publish them.</summary>
    private static readonly IReadOnlyList<string> DefaultRetryableFailureCodes =
        ["WATI_UNAUTHORIZED", "WATI_UNAVAILABLE", "WATI_DELIVERY_UNCERTAIN", "WATI_NOT_CONFIGURED", "WATI_REJECTED"];

    private static IReadOnlyList<string> Strings(JsonElement? section, string name) =>
        section is { } element
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
                .Select(item => item.GetString()!)
                .ToList()
            : [];

    private static JsonElement? Section(JsonElement root, string name) =>
        root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty(name, out var section)
        && section.ValueKind == JsonValueKind.Object
            ? section
            : null;

    private static bool Flag(JsonElement? section, string name) =>
        section is { } element
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.True;

    private static int Number(JsonElement? section, string name, int whenMissing = 0) =>
        section is { } element
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetInt32(out var number)
            ? number
            : whenMissing;

    private static decimal Amount(JsonElement? section, string name) =>
        section is { } element
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.Number
        && value.TryGetDecimal(out var amount)
            ? amount
            : 0m;

    private static string? Text(JsonElement? section, string name) =>
        section is { } element
        && element.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
        && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()
            : null;

    /// <summary>The worker stores Yes / No / Unknown; the screens read yes / no / unknown.</summary>
    private static string AnswerOf(string? whatsAppStatus) => whatsAppStatus switch
    {
        "Yes" => "yes",
        "No" => "no",
        _ => "unknown",
    };

    /// <summary>Escapes the LIKE wildcards in something a person typed, so "100%" finds "100%".</summary>
    private static string Contains(string search) =>
        "%" + search.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
}
