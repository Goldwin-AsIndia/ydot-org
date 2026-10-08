using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.CAM.Application.Common.Settings;

namespace YDots.CAM.Infrastructure.Persistence.Seed;

/// <summary>
/// Seeds the demonstration campaigns once the Organisations they belong to exist.
///
/// WHY THIS IS A BACKGROUND SERVICE AND NOT A LINE IN Program.cs. The demonstration data names
/// real Organisations and real people, all of which IAM creates on its own schedule - and CAM
/// starts at the same moment IAM does. Seeding from start-up would find no Organisation on a
/// fresh database and, because start-up seeding happens once, never look again. This keeps
/// asking until IAM has finished, which on a first start is a matter of seconds.
///
/// IT STOPS. Once the data is in - or once it has waited ten minutes for an IAM that is plainly
/// not coming - the loop ends rather than polling for the life of the process. A restart tries
/// again from the top, and the seeder itself does nothing where the data already exists.
///
/// A FAILURE HERE NEVER TAKES THE SERVICE DOWN. An unhandled exception in a BackgroundService
/// stops the host, and no demonstration campaign is worth refusing to start the campaigns API
/// over.
/// </summary>
public sealed class DemoDataSeedingService(
    IServiceScopeFactory scopeFactory,
    IOptions<SeedSettings> seedOptions,
    ILogger<DemoDataSeedingService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan GiveUpAfter = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!seedOptions.Value.CreateSampleData)
        {
            return;
        }

        var startedAt = DateTimeOffset.UtcNow;
        var reportedWaiting = false;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var seeder = scope.ServiceProvider.GetRequiredService<DemoCampaignSeeder>();

                if (await seeder.SeedAsync(stoppingToken) != DemoSeedOutcome.Waiting)
                {
                    return;
                }

                // ONCE, NOT EVERY TIME ROUND. This is the ordinary state of a stack that is
                // still starting, and it resolves itself within seconds.
                if (!reportedWaiting)
                {
                    reportedWaiting = true;

                    logger.LogInformation(
                        "The demonstration campaigns are waiting for IAM to create the sample "
                        + "Organisations and their people.");
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception, "The demonstration campaigns could not be seeded. It will be tried again.");
            }

            if (DateTimeOffset.UtcNow - startedAt > GiveUpAfter)
            {
                logger.LogWarning(
                    "The demonstration campaigns were not seeded: the sample Organisations or their "
                    + "people did not appear within {Minutes} minutes. Restart this service once "
                    + "IAM has seeded them.",
                    GiveUpAfter.TotalMinutes);

                return;
            }

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }
}
