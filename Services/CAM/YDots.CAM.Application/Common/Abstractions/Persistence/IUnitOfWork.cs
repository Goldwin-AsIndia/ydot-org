namespace YDots.CAM.Application.Common.Abstractions.Persistence;

/// <summary>
/// One commit per request. The DbContext implements it, so a handler can save without the
/// application layer ever naming EF Core.
/// </summary>
public interface IUnitOfWork
{
    /// <summary>
    /// Commits the tracked changes. Audit columns and Organisation ownership are stamped inside
    /// this call, so a handler never has to set them.
    /// </summary>
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Opens a transaction that holds a database lock named by <paramref name="key"/> until it is
    /// committed or disposed. Two requests asking for the same key run one after the other.
    ///
    /// FOR WORK THAT READS, DECIDES AND WRITES, where two requests deciding from the same read
    /// would both be wrong - numbering a code from how many rows exist is the case it exists for.
    /// Disposing without committing rolls everything back.
    /// </summary>
    Task<ISerialisedWork> BeginSerialisedAsync(string key, CancellationToken cancellationToken = default);
}

/// <summary>The transaction opened by <see cref="IUnitOfWork.BeginSerialisedAsync"/>.</summary>
public interface ISerialisedWork : IAsyncDisposable
{
    /// <summary>Commits the transaction, which also releases the lock.</summary>
    Task CommitAsync(CancellationToken cancellationToken = default);
}
