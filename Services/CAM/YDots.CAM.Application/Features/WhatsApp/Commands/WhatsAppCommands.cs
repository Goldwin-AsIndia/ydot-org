using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Abstractions.Persistence;
using YDots.CAM.Application.Common.Abstractions.Security;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Constants;
using YDots.CAM.Application.Common.Results;
using YDots.CAM.Application.Common.Settings;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Features.WhatsApp.Commands;

/// <summary>A number file from the upload page.</summary>
/// <param name="ForceRecheck">"Check them again anyway": ignore saved answers (and allow the same file again).</param>
/// <param name="RunWati">False = check only, do not message automatically. Null = the worker's setting.</param>
/// <param name="WatiTemplateName">A template for THIS upload's automatic message; blank = the worker's default.</param>
/// <param name="WatiBroadcastName">A broadcast name for this upload; blank = the worker's default.</param>
/// <param name="WatiParameters">Template values for this upload (for example image_url); null = the worker's defaults.</param>
public sealed record UploadCheckFileCommand(
    string FileName,
    byte[] Content,
    Guid? CampaignId,
    bool ForceRecheck,
    bool? RunWati,
    string? WatiTemplateName = null,
    string? WatiBroadcastName = null,
    IReadOnlyDictionary<string, string>? WatiParameters = null);

public sealed record RetryCheckJobCommand(Guid JobId);

public sealed record CancelCheckJobCommand(Guid JobId, string? Reason);

public sealed record SendWatiBroadcastCommand(SendBroadcastRequest Request);

public sealed record RefreshWatiTemplatesCommand;

/// <summary>
/// The write side of the WhatsApp screens. CAM never processes numbers or calls CheckNumber.ai /
/// WATI itself: it hands files to the worker's inbox and requests to int_worker_commands, and
/// records who asked in the campaign audit trail.
/// </summary>
public sealed class WhatsAppCommandHandler(
    IWhatsAppIntegrationStore store,
    IWhatsAppInbox inbox,
    ICampaignRepository campaigns,
    IAuditWriter audit,
    IUnitOfWork unitOfWork,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IDateTimeProvider clock,
    IOptions<WhatsAppIntegrationSettings> settings,
    ILogger<WhatsAppCommandHandler> logger)
{
    private const string WorkerNotInstalled =
        "The integration worker has not been set up for this database yet, so there is nothing to carry the request out. "
        + "Start YDot.Integration.Worker once and try again.";

    private static readonly HashSet<string> AcceptedExtensions = new(StringComparer.OrdinalIgnoreCase) { ".txt", ".csv", ".xls", ".xlsx" };

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ============================================================================ upload

    public async Task<Result<CheckJobUploadResponse>> HandleAsync(UploadCheckFileCommand command, CancellationToken cancellationToken)
    {
        if (!settings.Value.Enabled)
        {
            return Result.Failure<CheckJobUploadResponse>(Error.Dependency("WhatsApp checks are switched off on this server."));
        }

        if (!inbox.IsConfigured)
        {
            return Result.Failure<CheckJobUploadResponse>(Error.Dependency(
                "Uploads cannot be accepted: WhatsAppIntegration:DataRoot (the integration worker's folder) is not configured on the server."));
        }

        var fileName = Path.GetFileName(command.FileName ?? string.Empty).Trim();
        var extension = Path.GetExtension(fileName).ToLowerInvariant();

        if (!AcceptedExtensions.Contains(extension))
        {
            return Result.Failure<CheckJobUploadResponse>(Error.Validation($"'{fileName}' is not a .txt, .csv, .xls or .xlsx file."));
        }

        if (command.Content.Length == 0)
        {
            return Result.Failure<CheckJobUploadResponse>(Error.Validation($"'{fileName}' is empty."));
        }

        var maxBytes = settings.Value.MaxUploadMegabytes * 1024L * 1024L;
        if (command.Content.Length > maxBytes)
        {
            return Result.Failure<CheckJobUploadResponse>(Error.Validation(
                $"'{fileName}' is {command.Content.Length / 1024d / 1024d:F1} MB; the limit is {settings.Value.MaxUploadMegabytes} MB."));
        }

        // A file left in the inbox of a worker that does not exist would simply sit there, and the
        // page would wait for a check that never starts. A worker that is merely stopped is a
        // different matter: the file is kept and picked up when it is back, and the person is told.
        var overview = await store.GetOverviewAsync(cancellationToken);
        if (!overview.IntegrationAvailable)
        {
            return Result.Failure<CheckJobUploadResponse>(Error.Dependency(WorkerNotInstalled));
        }

        // A campaign named on the upload must be one of this organisation's (the repository is
        // organisation-filtered, so another organisation's id simply is not found).
        string? campaignCode = null;
        string? campaignName = null;
        if (command.CampaignId is { } campaignId)
        {
            var campaign = await campaigns.GetByIdAsync(campaignId, cancellationToken);
            if (campaign is null)
            {
                return Result.Failure<CheckJobUploadResponse>(Error.NotFound("That campaign was not found."));
            }

            campaignCode = campaign.Code;
            campaignName = campaign.Name;
        }

        var sha256 = Convert.ToHexStringLower(SHA256.HashData(command.Content));

        // Fast feedback for the common mistake; the worker enforces the same rule with a unique index.
        if (!command.ForceRecheck && await store.FindProcessedDuplicateAsync(sha256, command.CampaignId, cancellationToken) is { } duplicate)
        {
            return Result.Success(new CheckJobUploadResponse(
                "Duplicate",
                null,
                duplicate.JobId,
                duplicate.JobNumber,
                $"This exact file was already processed{(campaignName is null ? string.Empty : $" for {campaignName}")} as {duplicate.JobNumber}. "
                + "Its saved results are shown instead of paying for the same check again. Tick \"Check them again anyway\" to run it once more."));
        }

        var now = clock.UtcNow;
        var reference = NewReference("UPL", now);

        var watiParameters = command.WatiParameters?
            .Where(pair => !string.IsNullOrWhiteSpace(pair.Key))
            .Select(pair => new { name = pair.Key.Trim(), value = pair.Value ?? string.Empty })
            .ToList();

        var hasWatiSettings = !string.IsNullOrWhiteSpace(command.WatiTemplateName)
                              || !string.IsNullOrWhiteSpace(command.WatiBroadcastName)
                              || watiParameters is { Count: > 0 };

        // THIS IS THE CONTRACT WITH THE WORKER (its UploadManifest). Property names are camelCase
        // on the wire; add to it freely, never rename.
        var manifest = new
        {
            schemaVersion = 1,
            uploadReference = reference,
            tenantId = tenantContext.RequireTenantId(),
            tenantCode = tenantContext.TenantCode,
            tenantName = tenantContext.TenantName,
            campaignId = command.CampaignId,
            campaignCode,
            campaignName,
            uploadedByUserId = currentUser.UserId == Guid.Empty ? (Guid?)null : currentUser.UserId,
            uploadedByName = currentUser.DisplayName ?? currentUser.Username,
            originalFileName = fileName,
            fileSizeBytes = (long)command.Content.Length,
            sha256,
            uploadedAtUtc = now,
            options = new
            {
                forceRecheck = command.ForceRecheck,
                runWati = command.RunWati,
                allowDuplicateFile = command.ForceRecheck,
            },
            wati = hasWatiSettings
                ? new
                {
                    templateName = string.IsNullOrWhiteSpace(command.WatiTemplateName) ? null : command.WatiTemplateName.Trim(),
                    broadcastName = string.IsNullOrWhiteSpace(command.WatiBroadcastName) ? null : command.WatiBroadcastName.Trim(),
                    parameters = watiParameters,
                }
                : null,
        };

        await inbox.WriteUploadAsync(reference, extension, command.Content, JsonSerializer.Serialize(manifest, Json), cancellationToken);

        await audit.WriteAsync(
            WhatsAppAuditActionCodes.ListUploaded,
            command.CampaignId is null ? WhatsAppAuditActionCodes.UploadTarget : "Campaign",
            command.CampaignId ?? DeterministicId(reference),
            $"{fileName} ({command.Content.Length:N0} bytes) uploaded for a WhatsApp check as {reference}"
            + (command.ForceRecheck ? " - every number checked again." : "."),
            cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);

        logger.LogInformation("WhatsApp list {FileName} ({Bytes} bytes) queued for the integration worker as {Reference}.",
            fileName, command.Content.Length, reference);

        return Result.Success(new CheckJobUploadResponse("Queued", reference, null, null,
            overview.Worker.Online
                ? "The file is with the integration worker; the check starts within a few seconds."
                : "The file is saved, but the integration worker is not running right now. The check starts as soon as it is back."));
    }

    // ============================================================================ retry / cancel

    public async Task<Result<CommandAcceptedResponse>> HandleAsync(RetryCheckJobCommand command, CancellationToken cancellationToken)
    {
        var status = await store.GetJobStatusAsync(command.JobId, cancellationToken);
        if (status is null)
        {
            return Result.Failure<CommandAcceptedResponse>(Error.NotFound("That check was not found."));
        }

        // The worker's own rule (JobStatusRules.CanRetry), repeated here only so the person gets
        // the answer at once instead of a request the worker then turns down.
        if (status is not ("Failed" or "Cancelled" or "CompletedWithErrors"))
        {
            return Result.Failure<CommandAcceptedResponse>(Error.InvalidTransition(
                $"Only a check that failed, was stopped or finished with errors can be retried; this one is {status}."));
        }

        var accepted = await store.QueueCommandAsync("RetryJob", "CMD", new { jobId = command.JobId }, cancellationToken);
        if (accepted is null)
        {
            return Result.Failure<CommandAcceptedResponse>(Error.Dependency(WorkerNotInstalled));
        }

        await AuditAsync(WhatsAppAuditActionCodes.JobRetryRequested, WhatsAppAuditActionCodes.JobTarget, command.JobId,
            $"Retry requested ({accepted.Reference}).", cancellationToken);
        return Result.Success(accepted);
    }

    public async Task<Result<CommandAcceptedResponse>> HandleAsync(CancelCheckJobCommand command, CancellationToken cancellationToken)
    {
        var status = await store.GetJobStatusAsync(command.JobId, cancellationToken);
        if (status is null)
        {
            return Result.Failure<CommandAcceptedResponse>(Error.NotFound("That check was not found."));
        }

        if (status is "Completed" or "CompletedWithErrors" or "Failed" or "Cancelled")
        {
            return Result.Failure<CommandAcceptedResponse>(Error.InvalidTransition($"This check has already finished ({status})."));
        }

        var accepted = await store.QueueCommandAsync("CancelJob", "CMD", new { jobId = command.JobId, reason = command.Reason }, cancellationToken);
        if (accepted is null)
        {
            return Result.Failure<CommandAcceptedResponse>(Error.Dependency(WorkerNotInstalled));
        }

        await AuditAsync(WhatsAppAuditActionCodes.JobCancelRequested, WhatsAppAuditActionCodes.JobTarget, command.JobId,
            string.IsNullOrWhiteSpace(command.Reason) ? $"Stop requested ({accepted.Reference})." : $"Stop requested ({accepted.Reference}): {command.Reason}",
            cancellationToken);
        return Result.Success(accepted);
    }

    // ============================================================================ broadcast

    public async Task<Result<CommandAcceptedResponse>> HandleAsync(SendWatiBroadcastCommand command, CancellationToken cancellationToken)
    {
        var request = command.Request;

        if (request.CampaignId is { } campaignId && await campaigns.GetByIdAsync(campaignId, cancellationToken) is null)
        {
            return Result.Failure<CommandAcceptedResponse>(Error.NotFound("That campaign was not found."));
        }

        // THIS IS THE CONTRACT WITH THE WORKER (its SendWatiBroadcastPayload).
        var payload = new
        {
            templateName = request.TemplateName.Trim(),
            templateLabel = request.TemplateLabel,
            broadcastName = request.BroadcastName.Trim(),
            parameters = (request.Values ?? new Dictionary<string, string>())
                .Select(pair => new { name = pair.Key, value = pair.Value ?? string.Empty })
                .ToList(),
            recipients = request.Recipients.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).Distinct().ToList(),
            campaignId = request.CampaignId,
        };

        var accepted = await store.QueueCommandAsync("SendWatiBroadcast", "BRD", payload, cancellationToken);
        if (accepted is null)
        {
            return Result.Failure<CommandAcceptedResponse>(Error.Dependency(WorkerNotInstalled));
        }

        await AuditAsync(
            WhatsAppAuditActionCodes.BroadcastRequested,
            request.CampaignId is null ? WhatsAppAuditActionCodes.BroadcastTarget : "Campaign",
            request.CampaignId ?? accepted.CommandId,
            $"WhatsApp broadcast \"{payload.broadcastName}\" ({payload.templateName}) requested for {Wording.Count(payload.recipients.Count, "recipient")} as {accepted.Reference}.",
            cancellationToken);

        return Result.Success(accepted);
    }

    public async Task<Result<CommandAcceptedResponse>> HandleAsync(RefreshWatiTemplatesCommand command, CancellationToken cancellationToken)
    {
        var accepted = await store.QueueCommandAsync("SyncWatiTemplates", "CMD", new { }, cancellationToken);
        if (accepted is null)
        {
            return Result.Failure<CommandAcceptedResponse>(Error.Dependency(WorkerNotInstalled));
        }

        await AuditAsync(WhatsAppAuditActionCodes.TemplatesRefreshRequested, WhatsAppAuditActionCodes.BroadcastTarget, accepted.CommandId,
            "WATI template list refresh requested.", cancellationToken);
        return Result.Success(accepted);
    }

    // ============================================================================ helpers

    private async Task AuditAsync(string action, string targetType, Guid targetId, string reason, CancellationToken cancellationToken)
    {
        await audit.WriteAsync(action, targetType, targetId, reason, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
    }

    /// <summary>"UPL-20261010-7K2M9Q": prefix, UTC date, six characters that are never confused when read aloud.</summary>
    public static string NewReference(string prefix, DateTimeOffset now)
    {
        const string alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
        Span<char> suffix = stackalloc char[6];
        for (var i = 0; i < suffix.Length; i++)
        {
            suffix[i] = alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
        }

        return $"{prefix}-{now:yyyyMMdd}-{new string(suffix)}";
    }

    /// <summary>A stable Guid for a reference, used as the audit target when no campaign was named.</summary>
    private static Guid DeterministicId(string value) =>
        new(MD5.HashData(Encoding.UTF8.GetBytes(value)));
}
