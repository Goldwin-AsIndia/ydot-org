namespace YDots.CAM.Application.Common.Constants;

/// <summary>
/// The cam_audit_events action codes for WhatsApp outreach requested through CAM.
///
/// When the request names a campaign the row's target IS the campaign, so it appears in that
/// campaign's Recent Activity (the screen turns WHATSAPP_LIST_UPLOADED into "Whatsapp list
/// uploaded" and draws it with the WhatsApp icon). What the worker then did - check completed,
/// messages sent - is added to the same Recent Activity from the int_* tables.
/// </summary>
public static class WhatsAppAuditActionCodes
{
    public const string ListUploaded = "WHATSAPP_LIST_UPLOADED";

    public const string BroadcastRequested = "WHATSAPP_BROADCAST_REQUESTED";

    public const string JobRetryRequested = "WHATSAPP_CHECK_RETRY_REQUESTED";

    public const string JobCancelRequested = "WHATSAPP_CHECK_CANCEL_REQUESTED";

    public const string TemplatesRefreshRequested = "WHATSAPP_TEMPLATES_REFRESH_REQUESTED";

    // ---- Derived from the worker's tables for Recent Activity (never written to cam_audit_events) ----

    public const string CheckCompleted = "WHATSAPP_NUMBER_CHECK_COMPLETED";

    public const string CheckFailed = "WHATSAPP_NUMBER_CHECK_FAILED";

    public const string MessagesSent = "WHATSAPP_MESSAGES_SENT";

    public const string MessagesFailed = "WHATSAPP_MESSAGES_FAILED";

    /// <summary>Target types used when no campaign is named.</summary>
    public const string UploadTarget = "WhatsAppUpload";

    public const string JobTarget = "WhatsAppCheck";

    public const string BroadcastTarget = "WhatsAppBroadcast";
}
