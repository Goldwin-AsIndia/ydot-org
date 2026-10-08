namespace YDots.DON.Application.Common.Settings;

/// <summary>
/// Bound from the SeedSettings section of appsettings.json.
///
/// THERE IS NO ORGANISATION ID HERE ANY MORE, and its absence is the point. The demonstration
/// donors and leads used to be stamped with a configured <c>OrganisationId</c> that had to match
/// IAM's <c>SeedSettings:SampleOrganisationId</c>; where the two differed, those records sat
/// outside everybody's data scope and Donor List, Lead Work Queue and Donor 360 all opened empty
/// on a fresh database, with nothing anywhere to explain why. The data now covers two
/// Organisations, only one of which has a configured id at all, so each is found by its
/// SUBDOMAIN in IAM's own table at the moment of seeding. There is nothing left to keep in step.
///
/// The relationship owner on each row is likewise a real account of the Organisation rather than
/// a configured system user, which is what lets each fundraiser find their own leads and
/// follow-ups in the queue.
/// </summary>
public sealed class SeedSettings
{
    public const string SectionName = "SeedSettings";

    /// <summary>
    /// Write the demonstration donors, leads and follow-up tasks of the two activated sample
    /// Organisations - see <c>DemoDonorCatalogue</c> in the Infrastructure seed folder for what
    /// they are.
    ///
    /// OFF BY DEFAULT, because a donor is an Organisation's own record and these are invented.
    /// The Docker stack switches it on, since a demonstration stack with empty queues has nothing
    /// to demonstrate. It is safe to leave on: an Organisation that already holds the data is
    /// left exactly as it is, so the rows are written once and never put back.
    /// </summary>
    public bool CreateSampleData { get; set; }
}
