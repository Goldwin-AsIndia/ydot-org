namespace YDots.CAM.Infrastructure.Persistence.Seed;

/// <summary>
/// The demonstration history of the WhatsApp screens - Number Verification (CheckNumber.ai) and
/// WhatsApp Messages (WATI) - for the two activated sample Organisations.
///
/// DATA, KEPT APART FROM THE SEEDER'S LOGIC. <see cref="DemoWhatsAppSeeder"/> turns each line into
/// the rows the integration worker itself writes for a job: the uploaded file, its numbers, the
/// CheckNumber.ai task and its answers, the step timeline and events, and - where the job sent
/// messages - the WATI job, its batch and one message per number.
///
/// ONLY FINISHED WORK IS SEEDED: Completed, Completed with errors, Failed and Cancelled. A job or
/// broadcast left Queued, or in any running state, is work the worker picks up - it would call
/// CheckNumber.ai, which charges per task, and WATI, which sends real messages. The screens'
/// Queued and Running filters therefore stay empty until somebody uploads a file.
///
/// THE NUMBERS ARE UNREACHABLE ON PURPOSE. Every seeded number is an Indian number beginning with
/// 5, which no Indian mobile number does - the worker refuses such a line on upload ("Indian mobile
/// numbers start with 6, 7, 8 or 9"). The worker keeps one platform-wide record per number and
/// answers later checks from it, so a seeded answer for a real number would be given to the next
/// person who uploaded that number. A number that can never be uploaded can never be answered
/// wrongly - and no seeded message can ever have reached anybody.
///
/// NO SEEDED MESSAGE IS FOLLOWED UP. The worker asks WATI for the status of a message only when its
/// next status check is set; the seed leaves it empty, so nothing seeded is ever sent to WATI.
///
/// THE PEOPLE AND CAMPAIGNS ARE CAM'S OWN: a job names a campaign by its code, and the Organisation
/// Admin - the only role given the WhatsApp screens - uploads every file. Dates are relative to the
/// day the data is seeded: a day of last month, or a point part-way through this one.
/// </summary>
internal static class DemoWhatsAppCatalogue
{
    internal enum JobOutcome
    {
        Completed,

        /// <summary>The check finished; some of the messages it sent failed.</summary>
        CompletedWithErrors,

        Failed,

        Cancelled
    }

    /// <summary>
    /// Why a Failed job failed - always while its file was being read.
    ///
    /// NEVER LATER, BECAUSE OF RETRY. The screens offer Retry on a failed, cancelled or partly
    /// failed job, and the worker resumes from the numbers it has already read: a job that failed
    /// at CheckNumber.ai would create a new, charged task the moment somebody pressed it. A job
    /// that failed reading its file has no numbers to resume from, so a retry reads the file again,
    /// finds nothing it may check, and fails the same way without calling anybody. The cancelled
    /// job is cancelled while still queued for the same reason.
    /// </summary>
    internal enum JobFailure
    {
        None,

        /// <summary>Every line of the file was refused - wrong column, landlines, short numbers.</summary>
        NoValidNumbers,

        /// <summary>The file could not be opened as the type its name claims.</summary>
        FileUnreadable
    }

    internal enum BroadcastOutcome
    {
        Completed,
        CompletedWithErrors,

        /// <summary>WATI refused the whole broadcast.</summary>
        Failed,

        Cancelled
    }

    /// <summary>A day of last month at a time of day (IST), or a fraction of this month so far.</summary>
    internal readonly record struct DemoWhen(bool InLastMonth, double Value, int Hour = 0, int Minute = 0);

    internal sealed record DemoOrganisation(
        string Subdomain,
        string Administrator,

        /// <summary>The second digit of every seeded number: +91 5{series}...</summary>
        char NumberSeries,
        IReadOnlyList<DemoCheckJob> Jobs,
        IReadOnlyList<DemoBroadcast> Broadcasts);

    /// <summary>
    /// One uploaded file and the check job behind it. For a Cancelled job <paramref name="Unknown"/>
    /// is the number of lines in the file, none of which was read before the job was cancelled.
    ///
    /// <paramref name="Yes"/>, <paramref name="No"/> and <paramref name="Unknown"/> are the answers
    /// for the file's distinct numbers; <paramref name="Reused"/> of them were answered from an
    /// earlier job's check rather than sent to CheckNumber.ai. <paramref name="Duplicates"/> and
    /// <paramref name="Invalid"/> are extra lines. Where <paramref name="SendWati"/> is set the job
    /// messaged its WhatsApp numbers, and the last <paramref name="WatiFailed"/> of them failed.
    /// </summary>
    internal sealed record DemoCheckJob(
        string FileName,
        string? Campaign,
        DemoWhen At,
        JobOutcome Outcome,
        int Yes,
        int No,
        int Unknown,
        int Reused = 0,
        int Duplicates = 0,
        int Invalid = 0,
        bool SendWati = false,
        int WatiFailed = 0,
        JobFailure Failure = JobFailure.None);

    /// <summary>
    /// A broadcast sent from the WhatsApp Messages screen to numbers verified earlier.
    ///
    /// <paramref name="Messages"/> is one letter per recipient: <c>P</c> pending, <c>S</c> sent,
    /// <c>D</c> delivered, <c>R</c> read, <c>Y</c> replied, <c>F</c> accepted and then failed,
    /// <c>X</c> refused by WATI, <c>A</c> skipped as already messaged, <c>C</c> skipped because
    /// the broadcast was cancelled.
    /// </summary>
    internal sealed record DemoBroadcast(
        string Name,
        string? Campaign,
        string Template,
        DemoWhen At,
        BroadcastOutcome Outcome,
        string Messages);

    /// <summary>A WATI template the broadcasts use: its name in WATI and the label the screens show.</summary>
    internal static readonly IReadOnlyDictionary<string, string> TemplateLabels = new Dictionary<string, string>
    {
        ["l4l_001"] = "L4L campaign appeal (image)",
        ["donation_request_image"] = "Donation request (image)"
    };

    /// <summary>The template the worker sends automatically after a check (Wati:DefaultTemplateName).</summary>
    internal const string AutomaticTemplate = "l4l_001";

    /// <summary>The template's image header, as the worker's configuration fills it.</summary>
    internal const string TemplateImage = "https://stg.peoplesplanet.in/images/blind_stick_cam1.jpg";

    /// <summary>The WATI channel number this environment sends from.</summary>
    internal const string ChannelNumber = "919597304379";

    private static DemoWhen LastMonth(int day, int hour, int minute) => new(true, day, hour, minute);

    private static DemoWhen ThisMonth(double fraction) => new(false, fraction);

    private const JobOutcome Completed = JobOutcome.Completed;
    private const JobOutcome WithErrors = JobOutcome.CompletedWithErrors;
    private const JobOutcome Failed = JobOutcome.Failed;
    private const JobOutcome Cancelled = JobOutcome.Cancelled;
    private const string Appeal = "donation_request_image";
    private const string Automatic = AutomaticTemplate;

    internal static readonly IReadOnlyList<DemoOrganisation> Organisations =
    [
        // ============ SMILE FOUNDATION ============================================================
        new(
            Subdomain: "smilefoundation",
            Administrator: "anjali.prakash",
            NumberSeries: '5',
            Jobs:
            [
                new("teachers-day-stall-signups.csv", "SF-EDU-2026", LastMonth(6, 18, 20), Completed,
                    Yes: 14, No: 6, Unknown: 2, Duplicates: 2, SendWati: true),
                new("september-newsletter-subscribers.csv", "SF-EDU-2026", LastMonth(9, 11, 5), Completed,
                    Yes: 18, No: 9, Unknown: 3, Invalid: 2),
                new("health-camp-registrations-dharavi.txt", "SF-HEALTH-2026", LastMonth(12, 16, 40), Completed,
                    Yes: 11, No: 8, Unknown: 1, Duplicates: 2, SendWati: true),
                new("nutrition-parents-group.txt", "SF-NUTRITION-2026", LastMonth(15, 10, 15), WithErrors,
                    Yes: 9, No: 5, Unknown: 4, Invalid: 3, SendWati: true, WatiFailed: 2),
                new("csr-employee-volunteers.csv", null, LastMonth(18, 14, 50), Completed,
                    Yes: 16, No: 4, Unknown: 2),
                new("flood-relief-callers.csv", "SF-FLOOD-2026", LastMonth(21, 12, 30), Failed,
                    Yes: 0, No: 0, Unknown: 0, Invalid: 12, Failure: JobFailure.NoValidNumbers),
                new("monsoon-camp-follow-ups.txt", "SF-MONSOON-2026", LastMonth(25, 17, 10), Completed,
                    Yes: 6, No: 3, Unknown: 1, Reused: 9, SendWati: true),
                new("livelihood-exhibition-visitors.txt", "SF-LIVELIHOOD-2026", ThisMonth(0.08), Cancelled,
                    Yes: 0, No: 0, Unknown: 9),
                new("educate-a-child-donor-referrals.csv", "SF-EDU-2026", ThisMonth(0.20), Completed,
                    Yes: 20, No: 7, Unknown: 3, Reused: 5, Duplicates: 1, SendWati: true),
                new("mobile-clinic-enquiries.csv", "SF-HEALTH-2026", ThisMonth(0.40), WithErrors,
                    Yes: 12, No: 6, Unknown: 2, SendWati: true, WatiFailed: 1),
                new("diwali-early-supporters.csv", "SF-DIWALI-2026", ThisMonth(0.60), Completed,
                    Yes: 15, No: 5, Unknown: 2, Invalid: 1),
                new("winter-drive-volunteers.xlsx", "SF-WINTER-2026", ThisMonth(0.80), Failed,
                    Yes: 0, No: 0, Unknown: 0, Failure: JobFailure.FileUnreadable),
                new("stem-alumni-contacts.csv", "SF-STEM-2026", ThisMonth(0.92), Completed,
                    Yes: 8, No: 4, Unknown: 1)
            ],
            Broadcasts:
            [
                new("Teachers' Day thank-you", "SF-EDU-2026", Appeal, LastMonth(8, 10, 0),
                    BroadcastOutcome.Completed, "RRYDRRDR"),
                new("Clinic day reminder", "SF-HEALTH-2026", Appeal, LastMonth(14, 9, 30),
                    BroadcastOutcome.Completed, "DRRDYRA"),
                new("Nutrition term update", "SF-NUTRITION-2026", Appeal, LastMonth(20, 17, 45),
                    BroadcastOutcome.CompletedWithErrors, "RDFRXDR"),
                new("Flood relief report", "SF-FLOOD-2026", Appeal, LastMonth(27, 11, 15),
                    BroadcastOutcome.Completed, "RRRDYRD"),
                new("Educate a Child - October appeal", "SF-EDU-2026", Appeal, ThisMonth(0.30),
                    BroadcastOutcome.Completed, "DRSRDPYDR"),
                new("Mobile clinic appeal", "SF-HEALTH-2026", "mobile_clinic_appeal", ThisMonth(0.50),
                    BroadcastOutcome.Failed, "XXXXX"),
                new("Diwali preview", "SF-DIWALI-2026", Appeal, ThisMonth(0.70),
                    BroadcastOutcome.Cancelled, "DDCCCC")
            ]),

        // ============ HELPAGE INDIA ===============================================================
        new(
            Subdomain: "helpageindia",
            Administrator: "arvind.murali",
            NumberSeries: '6',
            Jobs:
            [
                new("older-persons-day-pledges.csv", "HAI-ELDERCARE-2026", LastMonth(5, 17, 50), Completed,
                    Yes: 15, No: 6, Unknown: 2, Duplicates: 1, SendWati: true),
                new("september-supporter-list.csv", "HAI-ELDERCARE-2026", LastMonth(8, 11, 20), Completed,
                    Yes: 19, No: 8, Unknown: 3, Invalid: 2),
                new("eye-camp-registrations-egmore.txt", "HAI-SIGHT-2026", LastMonth(11, 15, 35), Completed,
                    Yes: 12, No: 7, Unknown: 1, Duplicates: 2, SendWati: true),
                new("mobile-unit-beneficiary-families.txt", "HAI-MOBILECARE-2026", LastMonth(14, 10, 40), WithErrors,
                    Yes: 10, No: 5, Unknown: 3, Invalid: 2, SendWati: true, WatiFailed: 2),
                new("corporate-volunteers.csv", null, LastMonth(17, 13, 25), Completed,
                    Yes: 14, No: 5, Unknown: 2),
                new("heatwave-helpline-callers.csv", "HAI-HEATWAVE-2026", LastMonth(20, 12, 10), Failed,
                    Yes: 0, No: 0, Unknown: 0, Invalid: 11, Failure: JobFailure.NoValidNumbers),
                new("physiotherapy-patient-families.txt", "HAI-PHYSIO-2026", LastMonth(24, 16, 55), Completed,
                    Yes: 7, No: 2, Unknown: 1, Reused: 9, SendWati: true),
                new("senior-tech-fair-visitors.txt", "HAI-DIGITAL-2026", ThisMonth(0.07), Cancelled,
                    Yes: 0, No: 0, Unknown: 8),
                new("eldercare-donor-referrals.csv", "HAI-ELDERCARE-2026", ThisMonth(0.22), Completed,
                    Yes: 21, No: 6, Unknown: 2, Reused: 6, Duplicates: 1, SendWati: true),
                new("cataract-surgery-enquiries.csv", "HAI-SIGHT-2026", ThisMonth(0.42), WithErrors,
                    Yes: 11, No: 6, Unknown: 2, SendWati: true, WatiFailed: 1),
                new("winter-relief-early-supporters.csv", "HAI-WINTER-2026", ThisMonth(0.62), Completed,
                    Yes: 14, No: 6, Unknown: 1, Invalid: 1),
                new("day-care-centre-volunteers.xlsx", "HAI-DAYCARE-2026", ThisMonth(0.81), Failed,
                    Yes: 0, No: 0, Unknown: 0, Failure: JobFailure.FileUnreadable),
                new("helpline-supporter-contacts.csv", "HAI-HELPLINE-2026", ThisMonth(0.93), Completed,
                    Yes: 9, No: 3, Unknown: 1)
            ],
            Broadcasts:
            [
                new("Older Persons' Day thank-you", "HAI-ELDERCARE-2026", Appeal, LastMonth(7, 10, 15),
                    BroadcastOutcome.Completed, "RRDYRRDR"),
                new("Eye camp reminder", "HAI-SIGHT-2026", Appeal, LastMonth(13, 9, 45),
                    BroadcastOutcome.Completed, "DRRDYRA"),
                new("Doorstep care update", "HAI-MOBILECARE-2026", Appeal, LastMonth(19, 18, 0),
                    BroadcastOutcome.CompletedWithErrors, "RDFRXDR"),
                new("Heatwave relief report", "HAI-HEATWAVE-2026", Appeal, LastMonth(26, 11, 30),
                    BroadcastOutcome.Completed, "RRRDYRD"),
                new("Care for the Elderly - October appeal", "HAI-ELDERCARE-2026", Appeal, ThisMonth(0.32),
                    BroadcastOutcome.Completed, "DRSRDPYDR"),
                new("Restore Sight appeal", "HAI-SIGHT-2026", "restore_sight_appeal", ThisMonth(0.52),
                    BroadcastOutcome.Failed, "XXXXX"),
                new("Winter relief preview", "HAI-WINTER-2026", Appeal, ThisMonth(0.72),
                    BroadcastOutcome.Cancelled, "DDCCCC")
            ])
    ];
}
