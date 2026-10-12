using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Abstractions.Services;
using YDots.CAM.Application.Common.Settings;

namespace YDots.CAM.Infrastructure.Integration.WhatsApp;

/// <summary>
/// The YDot.Integration worker's data folder, as CAM sees it: CAM drops uploads into
/// <c>{DataRoot}/inbox</c> and reads back the files the worker wrote (the stored original, the
/// CheckNumber.ai archive, the completed output).
///
/// THE FOLDER IS THE HAND-OVER, deliberately. The worker's first requirement is to watch a
/// folder for number files, so a list a person uploads on the web page and a list an operator
/// copies onto the server take exactly the same path from here on - one intake, one duplicate
/// check, one set of logs.
///
/// EVERY WRITE IS "TEMPORARY NAME, THEN RENAME". A rename inside one folder is atomic, and the
/// worker ignores hidden and <c>.tmp</c> names, so it can never pick up half a file. The manifest
/// goes first: by the time the data file appears under its real name, the file that says whose
/// it is and which campaign it is for is already beside it.
///
/// SINGLETON, because it holds no per-request state - only the configured path.
/// </summary>
public sealed class WhatsAppInbox(
    IOptions<WhatsAppIntegrationSettings> settings,
    ILogger<WhatsAppInbox> logger) : IWhatsAppInbox
{
    private const string InboxFolder = "inbox";
    private const string ManifestSuffix = ".manifest.json";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(settings.Value.DataRoot);

    public async Task WriteUploadAsync(
        string uploadReference, string extension, byte[] content, string manifestJson, CancellationToken cancellationToken)
    {
        // The reference becomes a file name, so it is held to the alphabet CAM itself generates.
        // Nothing a person typed ever reaches a path here.
        if (uploadReference.Length == 0 || uploadReference.Any(c => !(char.IsAsciiLetterOrDigit(c) || c == '-')))
        {
            throw new ArgumentException("An upload reference may only hold letters, digits and hyphens.", nameof(uploadReference));
        }

        if (extension.Length < 2 || extension[0] != '.' || extension.Skip(1).Any(c => !char.IsAsciiLetterOrDigit(c)))
        {
            throw new ArgumentException("A file extension must look like '.csv'.", nameof(extension));
        }

        var inbox = Path.Combine(RequireRoot(), InboxFolder);
        Directory.CreateDirectory(inbox);

        var manifestPath = Path.Combine(inbox, uploadReference + ManifestSuffix);
        var dataPath = Path.Combine(inbox, uploadReference + extension.ToLowerInvariant());

        await WriteThenRenameAsync(manifestPath, Encoding.UTF8.GetBytes(manifestJson), cancellationToken);

        try
        {
            await WriteThenRenameAsync(dataPath, content, cancellationToken);
        }
        catch
        {
            // A manifest with no data file is harmless to the worker (it only looks at data
            // files), but there is no reason to leave it lying in the inbox.
            TryDelete(manifestPath);
            throw;
        }
    }

    public async Task<byte[]?> ReadFileAsync(string relativePath, CancellationToken cancellationToken)
    {
        if (!IsConfigured || string.IsNullOrWhiteSpace(relativePath))
        {
            return null;
        }

        var root = RequireRoot();
        var fullPath = Path.GetFullPath(Path.Combine(root, relativePath.Replace('\\', '/')));

        // THE PATH COMES FROM THE WORKER'S TABLES, not from the request, but it is still confined
        // to the data folder: a row that somehow named "../../etc/passwd" must read as "not there",
        // never as that file.
        var rootWithSeparator = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;

        if (!fullPath.StartsWith(rootWithSeparator, PathComparison))
        {
            logger.LogWarning("WhatsApp file {RelativePath} resolves outside the integration data folder and was not read.", relativePath);
            return null;
        }

        try
        {
            return File.Exists(fullPath) ? await File.ReadAllBytesAsync(fullPath, cancellationToken) : null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(exception, "WhatsApp file {RelativePath} could not be read from the integration data folder.", relativePath);
            return null;
        }
    }

    private static StringComparison PathComparison =>
        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    private string RequireRoot() =>
        IsConfigured
            ? Path.GetFullPath(settings.Value.DataRoot)
            : throw new InvalidOperationException(
                "WhatsAppIntegration:DataRoot is not configured, so the integration worker's folder cannot be reached.");

    private static async Task WriteThenRenameAsync(string path, byte[] content, CancellationToken cancellationToken)
    {
        var folder = Path.GetDirectoryName(path)!;

        // Hidden AND .tmp: the worker skips either, so both guards would have to fail together.
        var temporary = Path.Combine(folder, "." + Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N")[..8] + ".tmp");

        try
        {
            await using (var stream = new FileStream(
                             temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, useAsync: true))
            {
                await stream.WriteAsync(content, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }

            File.Move(temporary, path, overwrite: false);
        }
        catch
        {
            TryDelete(temporary);
            throw;
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Left behind at worst; the worker never reads hidden, temporary or manifest files.
        }
    }
}
