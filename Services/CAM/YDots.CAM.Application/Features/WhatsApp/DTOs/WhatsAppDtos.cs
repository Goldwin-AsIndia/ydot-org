namespace YDots.CAM.Application.Features.WhatsApp.DTOs;

// =================================================================================================
// What the /app/whatsapp/check-number and /app/whatsapp/wati screens receive. Every figure comes
// from the YDot.Integration worker's int_* tables; nothing here is invented or simulated.
// =================================================================================================

// ---- Overview (hero figures, settings, worker status) ------------------------------------------

/// <summary>Everything the two screens need before they show anything else.</summary>
/// <param name="IntegrationAvailable">False when the worker has never run against this database (no int_* tables).</param>
public sealed record WhatsAppOverviewResponse(
    bool IntegrationAvailable,
    WhatsAppWorkerStatus Worker,
    WhatsAppSettingsView Settings,
    WhatsAppStatistics Statistics);

/// <summary>The newest worker heartbeat.</summary>
public sealed record WhatsAppWorkerStatus(
    bool Online,
    string? InstanceName,
    string? Version,
    DateTimeOffset? StartedAtUtc,
    DateTimeOffset? LastHeartbeatAtUtc);

/// <summary>The worker's effective, non-secret settings, as it published them in its heartbeat.</summary>
public sealed record WhatsAppSettingsView(
    bool CheckNumberEnabled,
    bool CheckNumberConfigured,
    bool WatiEnabled,
    bool WatiConfigured,
    bool AutoSendWati,
    bool ManualBroadcastsAllowed,
    decimal PricePerNumber,
    decimal MinimumChargePerTask,
    string Currency,
    int MaxFileSizeMegabytes,
    int PollingIntervalSeconds,
    int MaxPollingAttempts,
    string ReuseScope,
    int ResultValidityDays,
    string? DefaultTemplateName,
    string? DefaultBroadcastName,
    int MaxRecipientsPerJob,
    bool AllowListActive,
    int AllowListSize,
    int BatchSize);

/// <summary>The organisation's figures.</summary>
/// <param name="NumbersVerified">Distinct numbers this organisation has an answer for.</param>
/// <param name="OnWhatsApp">Of those, on WhatsApp - the numbers "ready in Wati".</param>
/// <param name="MessagesSent">Messages WATI accepted. One it refused (a bad token, an invalid number) was not sent.</param>
public sealed record WhatsAppStatistics(
    int NumbersVerified,
    int OnWhatsApp,
    int JobsRun,
    int JobsRunning,
    int MessagesSent,
    int MessagesDelivered,
    int MessagesRead,
    int MessagesFailed,
    int ReadRatePercent);

// ---- Upload review: which numbers already have an answer --------------------------------------

public sealed record NumberLookupRequest(IReadOnlyList<string> Numbers);

/// <param name="WhatsApp">"yes" or "no" - only definitive answers are reused.</param>
/// <param name="SharedToWati">True when the number is on WhatsApp and in this organisation's Wati pool.</param>
public sealed record NumberAnswer(string Number, string WhatsApp, DateTimeOffset CheckedAtUtc, bool SharedToWati);

public sealed record NumberLookupResponse(IReadOnlyList<NumberAnswer> Answers, string ReuseScope);

// ---- Upload ------------------------------------------------------------------------------------------

/// <param name="Status">Queued (the worker will pick it up within seconds) or Duplicate (already processed).</param>
public sealed record CheckJobUploadResponse(
    string Status,
    string? UploadReference,
    Guid? DuplicateOfJobId,
    string? DuplicateOfJobNumber,
    string Message);

/// <param name="Status">Queued (not picked up yet), Registered (job exists), Duplicate or Rejected.</param>
public sealed record UploadStatusResponse(
    string UploadReference,
    string Status,
    Guid? JobId,
    string? JobNumber,
    string? Reason);

// ---- Jobs ------------------------------------------------------------------------------------------------

/// <summary>One row of the jobs list (and the header of a job's page).</summary>
/// <param name="DisplayStatus">queued | running | completed | failed | cancelled - the page's own vocabulary.</param>
/// <param name="Submitted">Numbers sent to CheckNumber.ai (fresh numbers).</param>
/// <param name="Total">Distinct numbers in the file (fresh + answered from saved results).</param>
/// <param name="Processed">Fresh numbers CheckNumber.ai has finished.</param>
/// <param name="Saved">Numbers answered from an earlier check - not paid for.</param>
/// <param name="Outcome">Success | Failed | Cancelled | Pending.</param>
/// <param name="HasErrors">The check finished but something after it did not (for example WATI refused the messages).</param>
/// <param name="CanRetry">The worker would accept "retry" for this job now.</param>
/// <param name="CanCancel">The worker would accept "stop" for this job now.</param>
/// <param name="CancelRequested">A stop was requested; the worker stops at the next safe point.</param>
public sealed record CheckJobListItem(
    Guid Id,
    string JobNumber,
    string FileName,
    long FileSizeBytes,
    string FileKind,
    int SheetCount,
    string Status,
    string DisplayStatus,
    string? CurrentStep,
    string? TaskId,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? StartedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    int TotalRows,
    int Submitted,
    int Total,
    int Processed,
    int Yes,
    int No,
    int Unknown,
    int Saved,
    int Duplicates,
    int Invalid,
    decimal? EstimatedCost,
    decimal? ActualCost,
    string? Currency,
    string Outcome,
    string? Reason,
    string? ErrorCode,
    int SharedToWati,
    int WatiSent,
    int WatiFailed,
    int WatiSkipped,
    bool RunCheckNumber,
    bool RunWati,
    Guid? CampaignId,
    string? CampaignName,
    string? UploadedByName,
    string Source,
    string? UploadReference,
    bool HasErrors,
    bool CanRetry,
    bool CanCancel,
    bool CancelRequested);

/// <summary>A job's page: header, CheckNumber.ai tasks, timeline, events and the WATI outcome.</summary>
public sealed record CheckJobDetailResponse(
    CheckJobListItem Job,
    IReadOnlyList<CheckNumberTaskView> Tasks,
    IReadOnlyList<JobTimelineEntry> Timeline,
    IReadOnlyList<JobEventView> Events,
    WatiJobSummary? Wati,
    JobDownloads Downloads);

public sealed record CheckNumberTaskView(
    string? TaskId,
    int Sequence,
    string State,
    string? ProviderStatus,
    bool IsSuperseded,
    int Submitted,
    int? Total,
    int? Success,
    int? Failure,
    int? CachedCount,
    decimal? EstimatedAmount,
    decimal? ActualAmount,
    string? Currency,
    int PollCount,
    DateTimeOffset? CreatedAtUtc,
    DateTimeOffset? LastPolledAtUtc,
    DateTimeOffset? NextPollAtUtc,
    DateTimeOffset? ExportedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    string? ErrorCode,
    string? ErrorMessage,
    CheckNumberResultFileView? ResultFile);

public sealed record CheckNumberResultFileView(
    string DownloadStatus,
    int? HttpStatusCode,
    long? FileSizeBytes,
    long? DownloadDurationMs,
    DateTimeOffset? DownloadCompletedAtUtc,
    string ExtractionStatus,
    int? ExtractedFileCount,
    string? ResultSource,
    int? MatchedCount,
    int? RewrittenCount,
    int? MissingCount,
    string? Error);

/// <summary>One step execution (int_job_steps).</summary>
public sealed record JobTimelineEntry(
    string StepCode,
    string Label,
    string Status,
    int Attempt,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    long? DurationMs,
    string? Message,
    string? ErrorMessage);

/// <summary>One event (int_job_events).</summary>
public sealed record JobEventView(string EventCode, string Level, string Message, DateTimeOffset OccurredAtUtc);

/// <summary>The WATI job that followed a check.</summary>
public sealed record WatiJobSummary(
    Guid Id,
    string Reference,
    string Status,
    string TemplateName,
    string? TemplateLabel,
    string BroadcastName,
    int TotalRecipients,
    int Accepted,
    int Failed,
    int Skipped,
    IReadOnlyDictionary<string, int> SkippedByReason,
    string? ErrorCode,
    string? ErrorMessage,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? CompletedAtUtc);

/// <summary>Which downloads a job offers right now.</summary>
public sealed record JobDownloads(bool Original, bool Submitted, bool Results, bool Raw, bool Invalid, bool Summary);

/// <summary>One distinct number of a job, as the report table shows it.</summary>
/// <param name="WhatsApp">yes | no | unknown.</param>
/// <param name="Status">checked | unverified | saved (answered from an earlier check).</param>
public sealed record CheckJobResultRow(
    string Number,
    string Iso,
    string Country,
    string WhatsApp,
    string Note,
    string Status,
    string Sheet,
    int Line,
    string Raw,
    string? WatiStatus,
    string? WatiSkipReason);

/// <summary>A line of the file with no usable number.</summary>
public sealed record InvalidLineView(string Sheet, int Line, string Raw, string Reason);

/// <summary>A file to download.</summary>
public sealed record DownloadFile(string FileName, string ContentType, byte[] Content);

// ---- Wati -------------------------------------------------------------------------------------------------

/// <summary>A template the Wati page can send.</summary>
/// <param name="Variables">The parameter names, in order.</param>
/// <param name="Defaults">Pre-filled values by parameter name.</param>
/// <param name="Source">Wati (copied from WATI) or Configuration (declared in the worker settings).</param>
public sealed record WatiTemplateView(
    string Name,
    string Label,
    string Category,
    string? Body,
    IReadOnlyList<string> Variables,
    IReadOnlyDictionary<string, string> Defaults,
    string Source,
    string? Status,
    string? Language,
    DateTimeOffset? LastSyncedAtUtc);

/// <summary>One number in the "ready in Wati" pool.</summary>
public sealed record WatiRecipientView(
    string Number,
    string Iso,
    string Country,
    DateTimeOffset CheckedAtUtc,
    Guid JobId,
    string JobNumber,
    string FileName,
    DateTimeOffset? LastMessagedAtUtc,
    string? LastTemplateName);

/// <summary>One WATI job, shown as a "broadcast".</summary>
public sealed record WatiBroadcastView(
    Guid Id,
    string Reference,
    string Name,
    string TemplateName,
    string TemplateLabel,
    string Status,
    string Source,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? CompletedAtUtc,
    int Recipients,
    int Accepted,
    int Failed,
    int Skipped,
    Guid? CampaignId,
    Guid? IntegrationJobId,
    string? JobNumber,
    string? RequestedByName,
    string? ErrorMessage);

/// <summary>One message of the delivery report.</summary>
/// <param name="Status">PENDING | SENT | DELIVERED | READ | REPLIED | FAILED | SKIPPED.</param>
/// <param name="TimesObserved">True when sent/delivered/read times are when the worker observed the change.</param>
public sealed record WatiMessageView(
    Guid Id,
    string Number,
    string Iso,
    string Country,
    string WhatsAppCheck,
    string TemplateLabel,
    string TemplateName,
    Guid BroadcastId,
    string BroadcastName,
    string Status,
    IReadOnlyDictionary<string, string> Values,
    string? RenderedText,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? SentAtUtc,
    DateTimeOffset? DeliveredAtUtc,
    DateTimeOffset? ReadAtUtc,
    DateTimeOffset? RepliedAtUtc,
    string? FailedCode,
    string? FailedReason,
    string? ReplyText,
    string? SkipReason,
    bool TimesObserved,
    string LocalMessageId,
    Guid? CampaignId);

/// <summary>A broadcast requested from the Wati page.</summary>
public sealed record SendBroadcastRequest(
    string TemplateName,
    string? TemplateLabel,
    string BroadcastName,
    IReadOnlyDictionary<string, string>? Values,
    IReadOnlyList<string> Recipients,
    Guid? CampaignId);

/// <summary>A request handed to the worker.</summary>
public sealed record CommandAcceptedResponse(Guid CommandId, string Reference, string Status);

/// <summary>Where a request to the worker stands.</summary>
public sealed record CommandStatusResponse(
    Guid CommandId,
    string Reference,
    string Type,
    string Status,
    string? ResultMessage,
    Guid? ResultEntityId,
    DateTimeOffset RequestedAtUtc,
    DateTimeOffset? ProcessedAtUtc);

/// <summary>Filters for the jobs list.</summary>
public sealed class CheckJobSearchFilter
{
    public int Page { get; set; } = 1;

    public int PageSize { get; set; } = 100;

    /// <summary>queued | running | completed | failed | cancelled.</summary>
    public string? Status { get; set; }

    /// <summary>Job number, file name or CheckNumber.ai task id.</summary>
    public string? Search { get; set; }

    public Guid? CampaignId { get; set; }
}

/// <summary>Filters for the delivery report.</summary>
public sealed class WatiMessageFilter
{
    public Guid? BroadcastId { get; set; }

    public string? TemplateName { get; set; }

    public Guid? CampaignId { get; set; }

    public bool IncludeSkipped { get; set; }
}
