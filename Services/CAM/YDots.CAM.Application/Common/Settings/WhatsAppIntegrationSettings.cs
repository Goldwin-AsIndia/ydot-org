namespace YDots.CAM.Application.Common.Settings;

/// <summary>
/// The WhatsApp outreach screens (/app/whatsapp/check-number and /app/whatsapp/wati).
///
/// THE WORK IS DONE BY THE YDot.Integration WORKER, a separate service that owns the int_* tables
/// in this same database. CAM only:
///   - writes uploaded number files (plus a manifest) into the worker's inbox folder, DataRoot/inbox;
///   - reads the int_* tables to show jobs, results, templates, recipients and messages;
///   - inserts requests (retry, cancel, broadcast) into int_worker_commands for the worker to carry out.
///
/// DataRoot must be the SAME folder the worker uses as Worker:DataRoot - in Docker a shared volume
/// mounted into both containers (CAM: /var/ydot/integration, worker: /app/data).
/// </summary>
public sealed class WhatsAppIntegrationSettings
{
    public const string SectionName = "WhatsAppIntegration";

    /// <summary>Switches the WhatsApp endpoints off without removing them.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>The worker's data folder as seen from CAM. Blank = uploads are refused with a clear message.</summary>
    public string DataRoot { get; set; } = string.Empty;

    /// <summary>The largest file the upload accepts (the page says 10 MB).</summary>
    public int MaxUploadMegabytes { get; set; } = 10;

    /// <summary>The worker counts as offline when its last heartbeat is older than this.</summary>
    public int WorkerOfflineAfterSeconds { get; set; } = 120;

    /// <summary>Most numbers one "already checked?" lookup may ask about.</summary>
    public int MaxLookupNumbers { get; set; } = 50000;

    /// <summary>Most rows the recipient pool and message report return in one call.</summary>
    public int MaxListRows { get; set; } = 50000;
}
