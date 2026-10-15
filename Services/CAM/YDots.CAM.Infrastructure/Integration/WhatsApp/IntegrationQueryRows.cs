using System.ComponentModel.DataAnnotations.Schema;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

// =================================================================================================
// The shapes of the hand-written queries in WhatsAppIntegrationStore - one class per result set,
// each property named after the column the SQL returns.
// =================================================================================================

/// <summary>The organisation's figures, counted in one round trip.</summary>
public sealed class StatisticsRow
{
    [Column("numbers_verified")]
    public int NumbersVerified { get; set; }

    [Column("on_whatsapp")]
    public int OnWhatsApp { get; set; }

    [Column("jobs_run")]
    public int JobsRun { get; set; }

    [Column("jobs_running")]
    public int JobsRunning { get; set; }

    [Column("messages_sent")]
    public int MessagesSent { get; set; }

    [Column("messages_delivered")]
    public int MessagesDelivered { get; set; }

    [Column("messages_read")]
    public int MessagesRead { get; set; }

    [Column("messages_failed")]
    public int MessagesFailed { get; set; }
}

/// <summary>A saved Yes/No answer for one number of an upload under review.</summary>
public sealed class NumberAnswerRow
{
    [Column("e164")]
    public string E164 { get; set; } = string.Empty;

    [Column("whatsapp_status")]
    public string WhatsAppStatus { get; set; } = string.Empty;

    [Column("checked_at_utc")]
    public DateTimeOffset CheckedAtUtc { get; set; }

    [Column("shared_to_wati")]
    public bool SharedToWati { get; set; }
}

/// <summary>One number of the organisation's "ready in Wati" pool.</summary>
public sealed class RecipientRow
{
    [Column("e164")]
    public string E164 { get; set; } = string.Empty;

    [Column("country_iso")]
    public string? CountryIso { get; set; }

    [Column("country_name")]
    public string? CountryName { get; set; }

    [Column("checked_at_utc")]
    public DateTimeOffset CheckedAtUtc { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("job_number")]
    public string JobNumber { get; set; } = string.Empty;

    [Column("original_file_name")]
    public string OriginalFileName { get; set; } = string.Empty;

    [Column("last_messaged_at_utc")]
    public DateTimeOffset? LastMessagedAtUtc { get; set; }

    [Column("last_template_name")]
    public string? LastTemplateName { get; set; }
}

/// <summary>One message of the delivery report, with its number's country and its job's template.</summary>
public sealed class MessageReportRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("wati_job_id")]
    public Guid WatiJobId { get; set; }

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

    [Column("queued_at_utc")]
    public DateTimeOffset QueuedAtUtc { get; set; }

    [Column("sent_at_utc")]
    public DateTimeOffset? SentAtUtc { get; set; }

    [Column("delivered_at_utc")]
    public DateTimeOffset? DeliveredAtUtc { get; set; }

    [Column("read_at_utc")]
    public DateTimeOffset? ReadAtUtc { get; set; }

    [Column("replied_at_utc")]
    public DateTimeOffset? RepliedAtUtc { get; set; }

    [Column("status_times_observed")]
    public bool StatusTimesObserved { get; set; }

    [Column("country_iso")]
    public string? CountryIso { get; set; }

    [Column("country_name")]
    public string? CountryName { get; set; }

    [Column("template_label")]
    public string? TemplateLabel { get; set; }

    [Column("rendered_preview")]
    public string? RenderedPreview { get; set; }

    /// <summary>The template body saved with the send, else the template's current body (older sends).</summary>
    [Column("template_body")]
    public string? TemplateBody { get; set; }

    [Column("contact_name")]
    public string? ContactName { get; set; }

    [Column("source_job_number")]
    public string? SourceJobNumber { get; set; }

    [Column("checknumber_provider_task_id")]
    public string? CheckNumberProviderTaskId { get; set; }
}

/// <summary>One number of the selection pool, with what the organisation's sends did with it.</summary>
public sealed class PoolRow
{
    [Column("phone_number_id")]
    public Guid PhoneNumberId { get; set; }

    [Column("e164")]
    public string E164 { get; set; } = string.Empty;

    [Column("country_iso")]
    public string? CountryIso { get; set; }

    [Column("country_name")]
    public string? CountryName { get; set; }

    [Column("checked_at_utc")]
    public DateTimeOffset CheckedAtUtc { get; set; }

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("job_number")]
    public string JobNumber { get; set; } = string.Empty;

    [Column("original_file_name")]
    public string OriginalFileName { get; set; } = string.Empty;

    [Column("contact_name")]
    public string? ContactName { get; set; }

    [Column("last_messaged_at_utc")]
    public DateTimeOffset? LastMessagedAtUtc { get; set; }

    [Column("last_template_name")]
    public string? LastTemplateName { get; set; }

    [Column("messages_sent")]
    public int MessagesSent { get; set; }
}

/// <summary>A check and how many of the pool's numbers it found on WhatsApp.</summary>
public sealed class JobFacetRow
{
    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("job_number")]
    public string JobNumber { get; set; } = string.Empty;

    [Column("original_file_name")]
    public string OriginalFileName { get; set; } = string.Empty;

    [Column("created_at_utc")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    [Column("count")]
    public int Count { get; set; }
}

/// <summary>A labelled count: a country, a group, a tag, a status or a template.</summary>
public sealed class FacetRow
{
    [Column("value")]
    public string Value { get; set; } = string.Empty;

    [Column("label")]
    public string Label { get; set; } = string.Empty;

    [Column("count")]
    public int Count { get; set; }
}

/// <summary>A number, alone - for "which of these numbers ..." questions.</summary>
public sealed class E164Row
{
    [Column("e164")]
    public string E164 { get; set; } = string.Empty;
}

/// <summary>One check's answer for one number, for the review and the groups.</summary>
public sealed class CheckedNumberRow
{
    [Column("e164")]
    public string E164 { get; set; } = string.Empty;

    [Column("job_id")]
    public Guid JobId { get; set; }

    [Column("job_number")]
    public string JobNumber { get; set; } = string.Empty;

    [Column("final_whatsapp_status")]
    public string FinalWhatsAppStatus { get; set; } = string.Empty;

    [Column("registry_status")]
    public string RegistryStatus { get; set; } = string.Empty;

    [Column("contact_name")]
    public string? ContactName { get; set; }

    [Column("created_at_utc")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    [Column("classification")]
    public string Classification { get; set; } = string.Empty;
}

/// <summary>One group member's number, with what the worker's tables say about it today.</summary>
public sealed class GroupMemberStateRow
{
    [Column("group_id")]
    public Guid GroupId { get; set; }

    [Column("phone_e164")]
    public string PhoneE164 { get; set; } = string.Empty;

    [Column("reachable")]
    public bool Reachable { get; set; }

    [Column("last_messaged_at_utc")]
    public DateTimeOffset? LastMessagedAtUtc { get; set; }
}

/// <summary>How often a group was sent to, and when last.</summary>
public sealed class GroupSendRow
{
    [Column("group_id")]
    public Guid GroupId { get; set; }

    [Column("sends")]
    public int Sends { get; set; }

    [Column("last_sent_at_utc")]
    public DateTimeOffset? LastSentAtUtc { get; set; }
}

/// <summary>A send and how many of its messages came from one check.</summary>
public sealed class CheckSendRow
{
    [Column("id")]
    public Guid Id { get; set; }

    [Column("reference")]
    public string Reference { get; set; } = string.Empty;

    [Column("broadcast_name")]
    public string BroadcastName { get; set; } = string.Empty;

    [Column("template_name")]
    public string TemplateName { get; set; } = string.Empty;

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("created_at_utc")]
    public DateTimeOffset CreatedAtUtc { get; set; }

    [Column("requested_by_name")]
    public string? RequestedByName { get; set; }

    [Column("from_this_check")]
    public int FromThisCheck { get; set; }

    [Column("accepted_from_this_check")]
    public int AcceptedFromThisCheck { get; set; }
}

/// <summary>One distinct number of a job, with its place in the file and what WATI did with it.</summary>
public sealed class JobResultRow
{
    [Column("normalized_number")]
    public string? NormalizedNumber { get; set; }

    [Column("country_iso")]
    public string? CountryIso { get; set; }

    [Column("country_name")]
    public string? CountryName { get; set; }

    [Column("classification")]
    public string Classification { get; set; } = string.Empty;

    [Column("final_whatsapp_status")]
    public string? FinalWhatsAppStatus { get; set; }

    [Column("result_note")]
    public string? ResultNote { get; set; }

    [Column("sheet_name")]
    public string SheetName { get; set; } = string.Empty;

    [Column("line_number")]
    public int LineNumber { get; set; }

    [Column("raw_value")]
    public string RawValue { get; set; } = string.Empty;

    [Column("sequence")]
    public int Sequence { get; set; }

    [Column("wati_status")]
    public string? WatiStatus { get; set; }

    [Column("wati_skip_reason")]
    public string? WatiSkipReason { get; set; }

    [Column("contact_name")]
    public string? ContactName { get; set; }

    [Column("send_reference")]
    public string? SendReference { get; set; }
}

/// <summary>One message of a send, with its number and its check, for the send's detail and the exports.</summary>
public sealed class SendMessageRow
{
    [Column("wati_job_id")]
    public Guid WatiJobId { get; set; }

    [Column("whatsapp_number")]
    public string WhatsAppNumber { get; set; } = string.Empty;

    [Column("contact_name")]
    public string? ContactName { get; set; }

    [Column("status")]
    public string Status { get; set; } = string.Empty;

    [Column("skip_reason")]
    public string? SkipReason { get; set; }

    [Column("failed_code")]
    public string? FailedCode { get; set; }

    [Column("failed_reason")]
    public string? FailedReason { get; set; }

    [Column("source_job_id")]
    public Guid? SourceJobId { get; set; }

    [Column("source_job_number")]
    public string? SourceJobNumber { get; set; }

    [Column("checknumber_provider_task_id")]
    public string? CheckNumberProviderTaskId { get; set; }

    [Column("parameters_json")]
    public string ParametersJson { get; set; } = "[]";

    [Column("local_message_id")]
    public string LocalMessageId { get; set; } = string.Empty;

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

    [Column("failed_at_utc")]
    public DateTimeOffset? FailedAtUtc { get; set; }

    [Column("request_status")]
    public string RequestStatus { get; set; } = string.Empty;
}
