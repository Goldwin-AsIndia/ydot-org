using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDots.DON.Application.Common.Settings;

namespace YDots.DON.Infrastructure.Persistence.Seed;

/// <summary>
/// Seeds the demonstration donors and leads once the Organisations they belong to exist.
///
/// WHY THIS IS A BACKGROUND SERVICE AND NOT A LINE IN Program.cs. The demonstration data names
/// real Organisations and real relationship owners, all of which IAM creates on its own schedule
/// - and DON starts at the same moment IAM does. Seeding from start-up found no Organisation on
/// a fresh database and, because start-up seeding happens once, never looked again. This keeps
/// asking until IAM has finished, which on a first start is a matter of seconds.
///
/// IT WAITS TWICE, FOR TWO DIFFERENT THINGS. First for IAM, without which nothing can be written
/// at all. Then for PAY's demonstration donations, from which each donor's giving totals are
/// read - a shorter wait, and one that simply ends if PAY's sample data is switched off: the
/// donors and leads are complete without it, and a total nobody gave is not worth inventing.
///
/// IT STOPS. Once the data is in - or once it has waited ten minutes - the loop ends rather than
/// polling for the life of the process. A restart tries again from the top, and the seeder itself
/// does nothing where the data already exists.
///
/// A FAILURE HERE NEVER TAKES THE SERVICE DOWN. An unhandled exception in a BackgroundService
/// stops the host, and no demonstration donor is worth refusing to start the donors API over.
/// </summary>
public sealed class DemoDataSeedingService(
    IServiceScopeFactory scopeFactory,
    IOptions<SeedSettings> seedOptions,
    IOptions<DatabaseSettings> databaseOptions,
    ILogger<DemoDataSeedingService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan GiveUpAfter = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!databaseOptions.Value.SeedOnStartup || !seedOptions.Value.CreateSampleData)
        {
            return;
        }

        var startedAt = DateTimeOffset.UtcNow;
        var reported = DemoSeedOutcome.Disabled;

        while (!stoppingToken.IsCancellationRequested)
        {
            var outcome = DemoSeedOutcome.Waiting;

            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var seeder = scope.ServiceProvider.GetRequiredService<DemoDonorSeeder>();

                outcome = await seeder.SeedAsync(stoppingToken);

                if (outcome is DemoSeedOutcome.Completed or DemoSeedOutcome.Disabled)
                {
                    return;
                }

                // ONCE PER STATE, NOT EVERY TIME ROUND. Both waits are the ordinary condition of
                // a stack that is still starting, and both resolve themselves within seconds.
                if (outcome != reported)
                {
                    reported = outcome;

                    if (outcome == DemoSeedOutcome.AwaitingDonations)
                    {
                        logger.LogInformation(
                            "The demonstration donors and leads are seeded. Their giving totals "
                            + "are waiting for PAY to seed the demonstration donations.");
                    }
                    else
                    {
                        logger.LogInformation(
                            "The demonstration donors are waiting for IAM to create the sample "
                            + "Organisations and their people.");
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception, "The demonstration donors could not be seeded. It will be tried again.");
            }

            if (DateTimeOffset.UtcNow - startedAt > GiveUpAfter)
            {
                if (outcome == DemoSeedOutcome.AwaitingDonations)
                {
                    logger.LogInformation(
                        "No demonstration donations appeared within {Minutes} minutes, so the "
                        + "demonstration donors carry no giving totals. Switch PAY's sample "
                        + "donations on and restart this service to add them.",
                        GiveUpAfter.TotalMinutes);
                }
                else
                {
                    logger.LogWarning(
                        "The demonstration donors were not seeded: the sample Organisations or "
                        + "their people did not appear within {Minutes} minutes. Restart this "
                        + "service once IAM has seeded them.",
                        GiveUpAfter.TotalMinutes);
                }

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
