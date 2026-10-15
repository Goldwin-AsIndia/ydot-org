namespace YDots.DON.Application.Common.Abstractions.Services;

/// <summary>
/// Produces the stable business references: DON-2026-000184, LED-2026-000317 and friends.
///
/// UI section 5.3: "Generate once and display consistently in header, confirmation, history and
/// support context. Never create a replacement reference because a dependency retry failed."
/// </summary>
public interface IReferenceNumberGenerator
{
    Task<string> NextDonorNumberAsync(CancellationToken cancellationToken = default);

    Task<string> NextLeadReferenceAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// <paramref name="count"/> consecutive lead references, for leads saved together.
    ///
    /// ASKING <see cref="NextLeadReferenceAsync"/> ONCE PER LEAD BEFORE ANY IS SAVED hands every
    /// one of them the same number - it reads the highest reference already stored - so a bulk
    /// upload of two or more new leads failed on the unique index and saved none.
    /// </summary>
    Task<IReadOnlyList<string>> NextLeadReferencesAsync(int count, CancellationToken cancellationToken = default);

    Task<string> NextMergeCaseReferenceAsync(CancellationToken cancellationToken = default);

    Task<string> NextVerificationReferenceAsync(CancellationToken cancellationToken = default);

    Task<string> NextFollowUpReferenceAsync(CancellationToken cancellationToken = default);
}
