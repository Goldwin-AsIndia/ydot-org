namespace YDots.CAM.Application.Common.Abstractions.Services;

/// <summary>
/// The YDot.Integration worker's shared data folder, as CAM sees it (WhatsAppIntegration:DataRoot).
///
/// An upload becomes two files in {DataRoot}/inbox: {reference}.manifest.json first, then
/// {reference}.{ext}. Each is written to a hidden temporary name and renamed into place, so the
/// worker - which ignores hidden and temporary names - can never read either half-written, and
/// always finds the manifest already there when the data file appears.
/// </summary>
public interface IWhatsAppInbox
{
    /// <summary>False when DataRoot is not configured (uploads are refused with a clear message).</summary>
    bool IsConfigured { get; }

    Task WriteUploadAsync(string uploadReference, string extension, byte[] content, string manifestJson, CancellationToken cancellationToken);

    /// <summary>Reads a file the worker wrote, by its path relative to the data folder; null when it is not there.</summary>
    Task<byte[]?> ReadFileAsync(string relativePath, CancellationToken cancellationToken);
}
