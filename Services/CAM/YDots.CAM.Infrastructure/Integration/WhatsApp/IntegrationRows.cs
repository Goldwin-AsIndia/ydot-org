using System.ComponentModel.DataAnnotations.Schema;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

// =================================================================================================
// CAM's READ MODEL of the YDot.Integration worker's int_* tables.
//
// The worker owns these tables and their migrations (history table __ef_migrations_history_int);
// these classes only describe the columns CAM reads, so they must follow the worker's schema.
// Enum columns are read as text (the worker stores enum NAMES), so CAM does not have to share the
// worker's enum types.
// =================================================================================================

/// <summary>int_input_files.</summary>
public sealed class InputFileRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("upload_reference")]
    public string? UploadReference { get; set; }

    [Column("source")]
    public string Source { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("original_file_name")]
    public string OriginalFileName { get; set; } = string.Empty;

    [Column("file_kind")]
    public string FileKind { get; set; } = string.Empty;

    [Column("file_size_bytes")]
    public long FileSizeBytes { get; set; }

    [Column("content_sha256")]
    public string ContentSha256 { get; set; } = string.Empty;

    [Column("dedupe_key")]
    public string? DedupeKey { get; set; }

    [Column("duplicate_of_input_file_id")]
    public Guid? DuplicateOfInputFileId { get; set; }

    [Column("stored_file_path")]
    public string StoredFilePath { get; set; } = string.Empty;

    [Column("campaign_id")]
    public Guid? CampaignId { get; set; }

    [Column("campaign_code")]
    public string? CampaignCode { get; set; }

    [Column("campaign_name")]
    public string? CampaignName { get; set; }

    [Column("uploaded_by_user_id")]
    public Guid? UploadedByUserId { get; set; }

    [Column("uploaded_by_name")]
    public string? UploadedByName { get; set; }

    [Column("sheet_count")]
    public int SheetCount { get; set; }

    [Column("rejection_reason")]
    public string? RejectionReason { get; set; }

    [Column("received_at_utc")]
    public DateTimeOffset ReceivedAtUtc { get; set; }

    [Column("registered_at_utc")]
    public DateTimeOffset? RegisteredAtUtc { get; set; }
}

/// <summary>int_integration_jobs.</summary>
public sealed class IntegrationJobRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("job_number")]
    public string JobNumber { get; set; } = string.Empty;

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("input_file_id")]
    public Guid InputFileId { get; set; }

    [Column("campaign_id")]
    public Guid? CampaignId { get; set; }

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("current_step")]
    public string? CurrentStep { get; set; }

    [Column("run_checknumber")]
    public bool RunCheckNumber { get; set; }

    [Column("run_wati")]
    public bool RunWati { get; set; }

    [Column("force_recheck")]
    public bool ForceRecheck { get; set; }

    [Column("total_rows")]
    public int TotalRows { get; set; }

    [Column("numbers_found")]
    public int NumbersFound { get; set; }

    [Column("unique_numbers")]
    public int UniqueNumbers { get; set; }

    [Column("fresh_numbers")]
    public int FreshNumbers { get; set; }

    [Column("reused_numbers")]
    public int ReusedNumbers { get; set; }

    [Column("duplicate_numbers")]
    public int DuplicateNumbers { get; set; }

    [Column("invalid_lines")]
    public int InvalidLines { get; set; }

    [Column("checked_numbers")]
    public int CheckedNumbers { get; set; }

    [Column("whatsapp_yes")]
    public int WhatsAppYes { get; set; }

    [Column("whatsapp_no")]
    public int WhatsAppNo { get; set; }

    [Column("whatsapp_unknown")]
    public int WhatsAppUnknown { get; set; }

    [Column("wati_eligible")]
    public int WatiEligible { get; set; }

    [Column("wati_sent")]
    public int WatiSent { get; set; }

    [Column("wati_failed")]
    public int WatiFailed { get; set; }

    [Column("wati_skipped")]
    public int WatiSkipped { get; set; }

    [Column("estimated_cost")]
    public decimal? EstimatedCost { get; set; }

    [Column("actual_cost")]
    public decimal? ActualCost { get; set; }

    [Column("cost_currency")]
    public string? CostCurrency { get; set; }

    [Column("outcome_message")]
    public string? OutcomeMessage { get; set; }

    [Column("error_code")]
    public string? ErrorCode { get; set; }

    [Column("error_message")]
    public string? ErrorMessage { get; set; }

    [Column("created_by_user_id")]
    public Guid? CreatedByUserId { get; set; }

    [Column("created_by_name")]
    public string? CreatedByName { get; set; }

    [Column("created_at_utc")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    [Column("started_at_utc")]
    public DateTimeOffset? StartedAtUtc { get; set; }

    [Column("completed_at_utc")]
    public DateTimeOffset? CompletedAtUtc { get; set; }

    [Column("updated_at_utc")]
    public DateTimeOffset UpdatedAtUtc { get; set; }

    [Column("results_csv_path")]
    public string? ResultsCsvPath { get; set; }

    [Column("summary_json_path")]
    public string? SummaryJsonPath { get; set; }

    [Column("cancel_requested")]
    public bool CancelRequested { get; set; }

    [Column("next_attempt_at_utc")]
    public DateTimeOffset? NextAttemptAtUtc { get; set; }

    [Column("processing_attempts")]
    public int ProcessingAttempts { get; set; }
}

/// <summary>int_input_file_numbers.</summary>
public sealed class InputFileNumberRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("input_file_id")]
    public Guid InputFileId { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("sequence")]
    public int Sequence { get; set; }

    [Column("sheet_name")]
    public string SheetName { get; set; } = string.Empty;

    [Column("line_number")]
    public int LineNumber { get; set; }

    [Column("raw_value")]
    public string RawValue { get; set; } = string.Empty;

    [Column("normalized_number")]
    public string? NormalizedNumber { get; set; }

    /// <summary>Added by the worker's SelectionDrivenWatiSends migration (15 Oct 2026).</summary>
    [Column("contact_name")]
    public string? ContactName { get; set; }

    [Column("phone_number_id")]
    public Guid? PhoneNumberId { get; set; }

    [Column("country_iso")]
    public string? CountryIso { get; set; }

    [Column("country_name")]
    public string? CountryName { get; set; }

    [Column("classification")]
    public string Classification { get; set; } = string.Empty;

    [Column("invalid_reason")]
    public string? InvalidReason { get; set; }

    [Column("reused_whatsapp_status")]
    public string? ReusedWhatsAppStatus { get; set; }

    [Column("reused_checked_at_utc")]
    public DateTimeOffset? ReusedCheckedAtUtc { get; set; }

    [Column("checknumber_task_id")]
    public Guid? CheckNumberTaskId { get; set; }

    [Column("final_whatsapp_status")]
    public string? FinalWhatsAppStatus { get; set; }

    [Column("result_note")]
    public string? ResultNote { get; set; }

    [Column("created_at_utc")]
    public DateTimeOffset CreatedAtUtc { get; set; }
}

/// <summary>int_phone_numbers (global registry, no organisation column).</summary>
public sealed class PhoneNumberRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("e164")]
    public string E164 { get; set; } = string.Empty;

    [Column("digits")]
    public string Digits { get; set; } = string.Empty;

    [Column("country_iso")]
    public string? CountryIso { get; set; }

    [Column("country_name")]
    public string? CountryName { get; set; }

    [Column("whatsapp_status")]
    public string WhatsAppStatus { get; set; } = string.Empty;

    [Column("whatsapp_checked_at_utc")]
    public DateTimeOffset? WhatsAppCheckedAtUtc { get; set; }
}

/// <summary>int_checknumber_tasks.</summary>
public sealed class CheckNumberTaskRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("sequence")]
    public int Sequence { get; set; }

    [Column("is_superseded")]
    public bool IsSuperseded { get; set; }

    [Column("provider_task_id")]
    public string? ProviderTaskId { get; set; }

    [Column("state")]
    public string State { get; set; } = string.Empty;

    [Column("provider_status")]
    public string? ProviderStatus { get; set; }

    [Column("submitted_count")]
    public int SubmittedCount { get; set; }

    [Column("total")]
    public int? Total { get; set; }

    [Column("success")]
    public int? Success { get; set; }

    [Column("failure")]
    public int? Failure { get; set; }

    [Column("cached_count")]
    public int? CachedCount { get; set; }

    [Column("estimated_amount")]
    public decimal? EstimatedAmount { get; set; }

    [Column("actual_amount")]
    public decimal? ActualAmount { get; set; }

    [Column("currency")]
    public string? Currency { get; set; }

    [Column("poll_count")]
    public int PollCount { get; set; }

    [Column("last_polled_at_utc")]
    public DateTimeOffset? LastPolledAtUtc { get; set; }

    [Column("next_poll_at_utc")]
    public DateTimeOffset? NextPollAtUtc { get; set; }

    [Column("provider_created_at_utc")]
    public DateTimeOffset? ProviderCreatedAtUtc { get; set; }

    [Column("exported_at_utc")]
    public DateTimeOffset? ExportedAtUtc { get; set; }

    [Column("completed_at_utc")]
    public DateTimeOffset? CompletedAtUtc { get; set; }

    [Column("error_code")]
    public string? ErrorCode { get; set; }

    [Column("error_message")]
    public string? ErrorMessage { get; set; }

    [Column("created_at_utc")]
    public DateTimeOffset CreatedAtUtc { get; set; }
}

/// <summary>int_checknumber_result_files.</summary>
public sealed class CheckNumberResultFileRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("checknumber_task_id")]
    public Guid CheckNumberTaskId { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("download_status")]
    public string DownloadStatus { get; set; } = string.Empty;

    [Column("http_status_code")]
    public int? HttpStatusCode { get; set; }

    [Column("file_size_bytes")]
    public long? FileSizeBytes { get; set; }

    [Column("local_zip_path")]
    public string? LocalZipPath { get; set; }

    [Column("download_completed_at_utc")]
    public DateTimeOffset? DownloadCompletedAtUtc { get; set; }

    [Column("download_duration_ms")]
    public long? DownloadDurationMs { get; set; }

    [Column("download_error")]
    public string? DownloadError { get; set; }

    [Column("extraction_status")]
    public string ExtractionStatus { get; set; } = string.Empty;

    [Column("extracted_file_count")]
    public int? ExtractedFileCount { get; set; }

    [Column("extraction_error")]
    public string? ExtractionError { get; set; }

    [Column("result_source")]
    public string? ResultSource { get; set; }

    [Column("matched_count")]
    public int? MatchedCount { get; set; }

    [Column("rewritten_count")]
    public int? RewrittenCount { get; set; }

    [Column("missing_count")]
    public int? MissingCount { get; set; }
}

/// <summary>int_checknumber_results.</summary>
public sealed class CheckNumberResultRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("checknumber_task_id")]
    public Guid CheckNumberTaskId { get; set; }

    [Column("phone_number_id")]
    public Guid PhoneNumberId { get; set; }

    [Column("whatsapp_status")]
    public string WhatsAppStatus { get; set; } = string.Empty;

    [Column("checked_at_utc")]
    public DateTimeOffset CheckedAtUtc { get; set; }
}

/// <summary>int_job_steps.</summary>
public sealed class JobStepRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("step_code")]
    public string StepCode { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("attempt")]
    public int Attempt { get; set; }

    [Column("started_at_utc")]
    public DateTimeOffset StartedAtUtc { get; set; }

    [Column("completed_at_utc")]
    public DateTimeOffset? CompletedAtUtc { get; set; }

    [Column("duration_ms")]
    public long? DurationMs { get; set; }

    [Column("message")]
    public string? Message { get; set; }

    [Column("error_message")]
    public string? ErrorMessage { get; set; }
}

/// <summary>int_job_events.</summary>
public sealed class JobEventRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("tenant_id")]
    public Guid? TenantId { get; set; }

    [Column("job_id")]
    public Guid? JobId { get; set; }

    [Column("wati_job_id")]
    public Guid? WatiJobId { get; set; }

    [Column("level")]
    public string Level { get; set; } = string.Empty;

    [Column("event_code")]
    public string EventCode { get; set; } = string.Empty;

    [Column("message")]
    public string Message { get; set; } = string.Empty;

    [Column("occurred_at_utc")]
    public DateTimeOffset OccurredAtUtc { get; set; }

    [Column("step_code")]
    public string? StepCode { get; set; }
}

/// <summary>int_wati_jobs.</summary>
public sealed class WatiJobRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("reference")]
    public string Reference { get; set; } = string.Empty;

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("source")]
    public string Source { get; set; } = string.Empty;

    [Column("integration_job_id")]
    public Guid? IntegrationJobId { get; set; }

    [Column("campaign_id")]
    public Guid? CampaignId { get; set; }

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("template_name")]
    public string TemplateName { get; set; } = string.Empty;

    [Column("template_label")]
    public string? TemplateLabel { get; set; }

    [Column("broadcast_name")]
    public string BroadcastName { get; set; } = string.Empty;

    [Column("parameters_json")]
    public string ParametersJson { get; set; } = "[]";

    [Column("rendered_preview")]
    public string? RenderedPreview { get; set; }

    // ---- Added by the worker's SelectionDrivenWatiSends migration (15 Oct 2026) ----

    [Column("template_body")]
    public string? TemplateBody { get; set; }

    [Column("parameter_bindings_json")]
    public string? ParameterBindingsJson { get; set; }

    [Column("requested_count")]
    public int RequestedCount { get; set; }

    [Column("excluded_json")]
    public string? ExcludedJson { get; set; }

    [Column("recipient_group_id")]
    public Guid? RecipientGroupId { get; set; }

    [Column("recipient_group_name")]
    public string? RecipientGroupName { get; set; }

    [Column("tags_json")]
    public string? TagsJson { get; set; }

    // ----

    [Column("total_recipients")]
    public int TotalRecipients { get; set; }

    [Column("queued_count")]
    public int QueuedCount { get; set; }

    [Column("accepted_count")]
    public int AcceptedCount { get; set; }

    [Column("failed_count")]
    public int FailedCount { get; set; }

    [Column("skipped_count")]
    public int SkippedCount { get; set; }

    [Column("error_code")]
    public string? ErrorCode { get; set; }

    [Column("error_message")]
    public string? ErrorMessage { get; set; }

    [Column("requested_by_user_id")]
    public Guid? RequestedByUserId { get; set; }

    [Column("requested_by_name")]
    public string? RequestedByName { get; set; }

    [Column("created_at_utc")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    [Column("completed_at_utc")]
    public DateTimeOffset? CompletedAtUtc { get; set; }

    [Column("started_at_utc")]
    public DateTimeOffset? StartedAtUtc { get; set; }
}

/// <summary>int_wati_messages.</summary>
public sealed class WatiMessageRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("wati_job_id")]
    public Guid WatiJobId { get; set; }

    [Column("integration_job_id")]
    public Guid? IntegrationJobId { get; set; }

    [Column("checknumber_provider_task_id")]
    public string? CheckNumberProviderTaskId { get; set; }

    // ---- Added by the worker's SelectionDrivenWatiSends migration (15 Oct 2026) ----

    [Column("source_job_id")]
    public Guid? SourceJobId { get; set; }

    [Column("source_job_number")]
    public string? SourceJobNumber { get; set; }

    [Column("contact_name")]
    public string? ContactName { get; set; }

    // ----

    [Column("phone_number_id")]
    public Guid PhoneNumberId { get; set; }

    [Column("campaign_id")]
    public Guid? CampaignId { get; set; }

    [Column("whatsapp_number")]
    public string WhatsAppNumber { get; set; } = string.Empty;

    [Column("whatsapp_check")]
    public string WhatsAppCheck { get; set; } = string.Empty;

    [Column("template_name")]
    public string TemplateName { get; set; } = string.Empty;

    [Column("broadcast_name")]
    public string BroadcastName { get; set; } = string.Empty;

    [Column("parameters_json")]
    public string ParametersJson { get; set; } = "[]";

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("skip_reason")]
    public string? SkipReason { get; set; }

    [Column("local_message_id")]
    public string LocalMessageId { get; set; } = string.Empty;

    [Column("failed_code")]
    public string? FailedCode { get; set; }

    [Column("failed_reason")]
    public string? FailedReason { get; set; }

    [Column("reply_text")]
    public string? ReplyText { get; set; }

    [Column("error_message")]
    public string? ErrorMessage { get; set; }

    [Column("queued_at_utc")]
    public DateTimeOffset QueuedAtUtc { get; set; }

    [Column("completed_at_utc")]
    public DateTimeOffset? CompletedAtUtc { get; set; }

    [Column("sent_at_utc")]
    public DateTimeOffset? SentAtUtc { get; set; }

    [Column("delivered_at_utc")]
    public DateTimeOffset? DeliveredAtUtc { get; set; }

    [Column("read_at_utc")]
    public DateTimeOffset? ReadAtUtc { get; set; }

    [Column("replied_at_utc")]
    public DateTimeOffset? RepliedAtUtc { get; set; }

    [Column("failed_at_utc")]
    public DateTimeOffset? FailedAtUtc { get; set; }

    [Column("status_times_observed")]
    public bool StatusTimesObserved { get; set; }

    [Column("request_status")]
    public string RequestStatus { get; set; } = string.Empty;

    [Column("http_status_code")]
    public int? HttpStatusCode { get; set; }

    [Column("retry_count")]
    public int RetryCount { get; set; }
}

/// <summary>int_wati_templates (shared by every organisation of the WATI account).</summary>
public sealed class WatiTemplateRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("element_name")]
    public string ElementName { get; set; } = string.Empty;

    [Column("display_label")]
    public string DisplayLabel { get; set; } = string.Empty;

    [Column("category")]
    public string? Category { get; set; }

    [Column("status")]
    public string? Status { get; set; }

    [Column("language")]
    public string? Language { get; set; }

    [Column("body")]
    public string? Body { get; set; }

    [Column("header_json")]
    public string? HeaderJson { get; set; }

    [Column("footer")]
    public string? Footer { get; set; }

    [Column("buttons_json")]
    public string? ButtonsJson { get; set; }

    [Column("parameters_json")]
    public string ParametersJson { get; set; } = "[]";

    [Column("source")]
    public string Source { get; set; } = string.Empty;

    [Column("is_active")]
    public bool IsActive { get; set; }

    [Column("last_synced_at_utc")]
    public DateTimeOffset? LastSyncedAtUtc { get; set; }
}

/// <summary>int_worker_instances.</summary>
public sealed class WorkerInstanceRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("instance_name")]
    public string InstanceName { get; set; } = string.Empty;

    [Column("version")]
    public string Version { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("settings_json")]
    public string? SettingsJson { get; set; }

    [Column("started_at_utc")]
    public DateTimeOffset StartedAtUtc { get; set; }

    [Column("last_heartbeat_at_utc")]
    public DateTimeOffset LastHeartbeatAtUtc { get; set; }

    [Column("host_name")]
    public string HostName { get; set; } = string.Empty;

    [Column("environment_name")]
    public string EnvironmentName { get; set; } = string.Empty;

    [Column("stopped_at_utc")]
    public DateTimeOffset? StoppedAtUtc { get; set; }
}

/// <summary>int_worker_commands - the one int_* table CAM writes to (inserts only).</summary>
public sealed class WorkerCommandRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("tenant_id")]
    public Guid TenantId { get; set; }

    [Column("reference")]
    public string Reference { get; set; } = string.Empty;

    [Column("command_type")]
    public string CommandType { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("payload_json")]
    public string PayloadJson { get; set; } = "{}";

    [Column("result_message")]
    public string? ResultMessage { get; set; }

    [Column("result_entity_id")]
    public Guid? ResultEntityId { get; set; }

    [Column("requested_by_user_id")]
    public Guid? RequestedByUserId { get; set; }

    [Column("requested_by_name")]
    public string? RequestedByName { get; set; }

    [Column("requested_at_utc")]
    public DateTimeOffset RequestedAtUtc { get; set; }

    [Column("processed_at_utc")]
    public DateTimeOffset? ProcessedAtUtc { get; set; }

    [Column("attempts")]
    public int Attempts { get; set; }
}
