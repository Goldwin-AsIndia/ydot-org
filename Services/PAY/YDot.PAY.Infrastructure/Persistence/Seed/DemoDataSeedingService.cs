using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using YDot.PAY.Application.Common.Settings;

namespace YDot.PAY.Infrastructure.Persistence.Seed;

/// <summary>
/// Seeds the demonstration donations once the Organisations they belong to exist.
///
/// WHY THIS IS A BACKGROUND SERVICE AND NOT A LINE IN Program.cs. The demonstration donations
/// belong to Organisations IAM creates on its own schedule - and PAY starts at the same moment
/// IAM does. Seeding from start-up would find no Organisation on a fresh database and, because
/// start-up seeding happens once, never look again. This keeps asking until IAM has finished,
/// which on a first start is a matter of seconds.
///
/// SEPARATE FROM <see cref="GatewayAccountSeedingService"/>, which they used to ride along with.
/// That loop ends the moment gateway seeding is switched off or has no usable key, and a stack
/// with no payment gateway is exactly where somebody still wants a populated Payments and
/// Receipts page to look at.
///
/// IT STOPS. Once the data is in - or once it has waited ten minutes for an IAM that is plainly
/// not coming - the loop ends rather than polling for the life of the process. A restart tries
/// again from the top, and the seeder itself does nothing where the data already exists.
///
/// A FAILURE HERE NEVER TAKES THE SERVICE DOWN. An unhandled exception in a BackgroundService
/// stops the host, and no demonstration donation is worth refusing to start the payments API
/// over.
/// </summary>
public sealed class DemoDataSeedingService(
    IServiceScopeFactory scopeFactory,
    IOptions<PaymentSettings> paymentOptions,
    ILogger<DemoDataSeedingService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan GiveUpAfter = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!paymentOptions.Value.SeedSampleDonations)
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
                var seeder = scope.ServiceProvider.GetRequiredService<DemoDonationSeeder>();

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
                        "The demonstration donations are waiting for IAM to create the sample "
                        + "Organisations.");
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogWarning(
                    exception, "The demonstration donations could not be seeded. It will be tried again.");
            }

            if (DateTimeOffset.UtcNow - startedAt > GiveUpAfter)
            {
                logger.LogWarning(
                    "The demonstration donations were not seeded: the sample Organisations did not "
                    + "appear within {Minutes} minutes. Restart this service once IAM has seeded "
                    + "them.",
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
