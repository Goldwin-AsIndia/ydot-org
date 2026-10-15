using YDots.CAM.Application.Common.Models;
using YDots.CAM.Application.Features.Campaigns.DTOs;
using YDots.CAM.Application.Features.WhatsApp.DTOs;

namespace YDots.CAM.Application.Common.Abstractions.Services;

/// <summary>One check's answer for one number, as the review and the groups need it.</summary>
/// <param name="FinalStatus">What that check settled on: Yes, No or Unknown.</param>
/// <param name="RegistryStatus">The NEWEST answer for the number, from whichever check gave it - the one a send acts on.</param>
/// <param name="FirstSighting">False for a repeat of the number further down the same file.</param>
public sealed record CheckedNumberFacts(
    string E164,
    Guid JobId,
    string JobNumber,
    string FinalStatus,
    string RegistryStatus,
    string? ContactName,
    DateTimeOffset CreatedAtUtc,
    bool FirstSighting);

/// <summary>One audit row of the send exports: a selected number of a send and what became of it.</summary>
public sealed record WatiBroadcastExportRow(
    string SendReference,
    string SendName,
    DateTimeOffset SentAtUtc,
    string? RequestedBy,
    string TemplateName,
    string? TemplateLabel,
    string? RecipientGroup,
    string? Tags,
    string? Campaign,
    string Number,
    string? ContactName,
    string? SourceJobNumber,
    string? CheckNumberTaskId,
    string Status,
    string? Reason,
    string? ReasonText,
    string? Values,
    DateTimeOffset? AcceptedAtUtc,
    DateTimeOffset? DeliveredAtUtc,
    DateTimeOffset? ReadAtUtc,
    DateTimeOffset? FailedAtUtc,
    string? LocalMessageId);

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

    /// <summary>
    /// THE SELECTION POOL: this organisation's numbers that a check found on WhatsApp and the newest
    /// answer still has there - one page, filtered and searched on the server, with the options
    /// every filter offers.
    /// </summary>
    Task<WatiRecipientSearchResponse> SearchRecipientsAsync(WatiRecipientFilter filter, CancellationToken cancellationToken);

    /// <summary>"Select all that match": up to <paramref name="limit"/> matching numbers, each with the check it is offered from.</summary>
    Task<WatiMatchingRecipients> GetMatchingRecipientsAsync(WatiRecipientFilter filter, int limit, CancellationToken cancellationToken);

    /// <summary>
    /// Everything this organisation's checks said about each of these E.164 numbers - one entry per
    /// check that answered it, newest first. A number no check answered is absent.
    /// </summary>
    Task<IReadOnlyDictionary<string, IReadOnlyList<CheckedNumberFacts>>> GetCheckedNumbersAsync(
        IReadOnlyCollection<string> numbers, CancellationToken cancellationToken);

    /// <summary>
    /// Of these numbers, the ones this template was already sent to for this campaign (WATI accepted
    /// it) - the worker's ALREADY_SENT rule. <paramref name="since"/> limits how far back it looks.
    /// </summary>
    Task<IReadOnlySet<string>> GetAlreadySentAsync(
        string templateName, Guid? campaignId, IReadOnlyCollection<string> numbers, DateTimeOffset? since, CancellationToken cancellationToken);

    /// <summary>The send log: one page of WATI jobs with their selection, group, tags and outcome.</summary>
    Task<WatiBroadcastSearchResponse> SearchBroadcastsAsync(WatiBroadcastFilter filter, CancellationToken cancellationToken);

    /// <summary>One send in full - its selection, template, values and every number's outcome - or null when it is not this organisation's.</summary>
    Task<WatiBroadcastDetail?> GetBroadcastAsync(Guid broadcastId, CancellationToken cancellationToken);

    /// <summary>
    /// The audit rows behind the exports: one per selected number of every matching send (or of
    /// <paramref name="broadcastId"/> alone), excluded numbers included.
    /// </summary>
    Task<IReadOnlyList<WatiBroadcastExportRow>> GetBroadcastExportRowsAsync(
        WatiBroadcastFilter filter, Guid? broadcastId, int maximum, CancellationToken cancellationToken);

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
