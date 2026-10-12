using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Features.Campaigns.DTOs;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Common.Abstractions.Services;

/// <summary>Paths (relative to the worker's data folder) of a job's files.</summary>
public sealed record WhatsAppJobFiles(
    string JobNumber,
    string OriginalFileName,
    string FileKind,
    string? OriginalPath,
    string? ResultArchivePath,
    string? ResultsCsvPath,
    string? SummaryJsonPath);

/// <summary>
/// Reads the YDot.Integration worker's int_* tables for the WhatsApp screens, and leaves requests
/// for the worker in int_worker_commands. Every read is limited to the caller's organisation.
///
/// The worker OWNS these tables (its own migrations); CAM never creates, alters or migrates them.
/// When the worker has never run against this database, reads return empty results and the
/// overview reports IntegrationAvailable = false instead of failing.
/// </summary>
public interface IWhatsAppIntegrationStore
{
    Task<WhatsAppOverviewResponse> GetOverviewAsync(CancellationToken cancellationToken);

    /// <summary>Saved Yes/No answers for these E.164 numbers (worker's reuse rule: Global or Tenant).</summary>
    Task<NumberLookupResponse> LookupAsync(IReadOnlyCollection<string> numbers, CancellationToken cancellationToken);

    /// <summary>An earlier job for the same content and campaign in this organisation, if any.</summary>
    Task<(Guid JobId, string JobNumber)?> FindProcessedDuplicateAsync(string sha256, Guid? campaignId, CancellationToken cancellationToken);

    /// <summary>Null while the worker has not picked the upload up yet.</summary>
    Task<UploadStatusResponse?> GetUploadStatusAsync(string uploadReference, CancellationToken cancellationToken);

    Task<PagedResponse<CheckJobListItem>> SearchJobsAsync(CheckJobSearchFilter filter, CancellationToken cancellationToken);

    /// <summary>
    /// Turns what a route carries - the job's id or its number (INT-20261010-000001) - into the id,
    /// or null when no such job exists in this organisation.
    /// </summary>
    Task<Guid?> ResolveJobIdAsync(string idOrNumber, CancellationToken cancellationToken);

    Task<CheckJobDetailResponse?> GetJobAsync(Guid jobId, CancellationToken cancellationToken);

    Task<IReadOnlyList<CheckJobResultRow>?> GetJobResultsAsync(Guid jobId, CancellationToken cancellationToken);

    Task<IReadOnlyList<InvalidLineView>?> GetInvalidLinesAsync(Guid jobId, CancellationToken cancellationToken);

    Task<IReadOnlyList<string>?> GetSubmittedNumbersAsync(Guid jobId, CancellationToken cancellationToken);

    Task<WhatsAppJobFiles?> GetJobFilesAsync(Guid jobId, CancellationToken cancellationToken);

    Task<IReadOnlyList<WatiTemplateView>> GetTemplatesAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<WatiRecipientView>> GetRecipientsAsync(int maximum, CancellationToken cancellationToken);

    Task<IReadOnlyList<WatiBroadcastView>> GetBroadcastsAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<WatiMessageView>> GetMessagesAsync(WatiMessageFilter filter, int maximum, CancellationToken cancellationToken);

    /// <summary>
    /// Inserts a Pending row into int_worker_commands. <paramref name="commandType"/> is the worker's
    /// WorkerCommandType name (RetryJob, CancelJob, SendWatiBroadcast, SyncWatiTemplates).
    /// Null when the worker has never been installed against this database, so there is nobody
    /// to carry the request out.
    /// </summary>
    Task<CommandAcceptedResponse?> QueueCommandAsync(
        string commandType, string referencePrefix, object payload, CancellationToken cancellationToken);

    Task<CommandStatusResponse?> GetCommandAsync(string reference, CancellationToken cancellationToken);

    /// <summary>The job's status name, or null when it does not exist in this organisation.</summary>
    Task<string?> GetJobStatusAsync(Guid jobId, CancellationToken cancellationToken);

    /// <summary>
    /// WhatsApp outreach for one campaign, shaped as campaign history rows, newest first - merged
    /// into the campaign's Recent Activity.
    /// </summary>
    Task<IReadOnlyList<CampaignHistoryResponse>> GetCampaignActivityAsync(
        Guid campaignId, int maximum, CancellationToken cancellationToken);
}
