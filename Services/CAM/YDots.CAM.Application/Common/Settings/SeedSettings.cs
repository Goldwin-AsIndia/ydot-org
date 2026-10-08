namespace YDots.CAM.Application.Common.Settings;

/// <summary>
/// Whether the demonstration campaigns are written.
///
/// THERE IS NO ORGANISATION ID HERE ANY MORE, and its absence is the point. The demonstration
/// data used to be stamped with a configured <c>OrganisationId</c> that had to match IAM's
/// <c>SeedSettings:SampleOrganisationId</c> and DON's and PAY's copies of it, so one wrong value
/// in one service put its sample rows where no real user's token could reach them - present in
/// the database, returned by nothing. The data now covers two Organisations, only one of which
/// has a configured id at all, so each is found by its SUBDOMAIN in IAM's own table at the
/// moment of seeding. There is nothing left to keep in step.
///
/// The actor on each row is likewise a real account of the Organisation - the Campaign Executive
/// who created the campaign, the Campaign Manager who approved it - rather than a configured
/// system user, which is what lets each of them find their own work in the register.
/// </summary>
public sealed class SeedSettings
{
    public const string SectionName = "SeedSettings";

    /// <summary>
    /// Write the demonstration campaigns, readiness checklists and tracking assets of the two
    /// activated sample Organisations - see <c>DemoCampaignCatalogue</c> in the Infrastructure
    /// seed folder for what they are.
    ///
    /// OFF BY DEFAULT, because a campaign is an Organisation's own record and these are invented.
    /// The Docker stack switches it on, since a demonstration stack with empty registers has
    /// nothing to demonstrate. It is safe to leave on: an Organisation that already holds the
    /// data is left exactly as it is, so the rows are written once and never put back.
    /// </summary>
    public bool CreateSampleData { get; set; }
}
