import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CampaignApiService } from '../../../../Service/campaign-api.service';
import { JobFileKind } from '../../../../Service/whatsapp-api.service';
import { FileProblem, MAX_FILE_BYTES, formatBytes } from '../file-extract';
import { WaPagerComponent } from '../wa-pager/wa-pager';
import { WaOption, WaSelectComponent } from '../wa-select/wa-select';
import { WhatsAppStore } from '../whatsapp-store.service';
import { CheckJob, JobStatus, JobTimelineStep, ResultRow, UploadAnalysis, WaResult } from '../whatsapp.models';
import { count, duration, localDateTime, localDateTimeFull, money, timeZoneLabel, unitPrice } from '../wa-format';

type View = 'new' | 'jobs' | 'job';
type ReviewTab = 'fresh' | 'known' | 'duplicates' | 'invalid';
type ReportTab = 'all' | 'valid' | 'invalid' | 'unverified' | 'saved';
type JobFilter = 'all' | JobStatus;

const REPORT_LABEL: Record<WaResult, string> = { yes: 'Yes', no: 'No', unknown: 'Unknown' };
const RESULT_LABEL: Record<WaResult, string> = { yes: 'Valid', no: 'Invalid', unknown: 'Unverified' };

/** The "no campaign" choice of the campaign picker. */
const NO_CAMPAIGN = 'none';

/**
 * CheckNumber: upload a list, see what it holds, check which numbers are on WhatsApp, read the report.
 *
 * One component, three views picked by the route: the new-check flow (upload -> review -> live check), the job
 * history, and one job's report. The upload under review and the running job live in `WhatsAppStore`, so
 * moving between views never loses either.
 *
 * THE CHECK ITSELF RUNS ON THE SERVER. Starting one uploads the file to the Campaign service, which hands
 * it to the YDot.Integration worker; this screen then follows the job the worker creates. Leaving the page -
 * or closing the browser - does not stop it.
 */
@Component({
  selector: 'app-check-number',
  imports: [RouterLink, WaPagerComponent, WaSelectComponent, NgTemplateOutlet],
  templateUrl: './check-number.html',
  styleUrls: ['../wa-shared.css', './check-number.css'],
})
export class CheckNumberComponent {
  protected readonly store = inject(WhatsAppStore);
  private readonly campaigns = inject(CampaignApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly maxMb = MAX_FILE_BYTES / (1024 * 1024);
  protected readonly zone = timeZoneLabel();
  protected readonly bytes = formatBytes;
  protected readonly n = count;
  protected readonly dt = localDateTime;
  protected readonly dtFull = localDateTimeFull;
  protected readonly resultLabel = RESULT_LABEL;
  protected readonly enabledLabel = REPORT_LABEL;

  /** Costs are shown in the currency CheckNumber.ai charges in, as the worker reports it. */
  protected readonly currency = computed(() => this.store.overview()?.currency ?? 'USD');
  protected readonly money = (value: number): string => money(value, this.currency());

  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  protected readonly view = signal<View>((this.route.snapshot.data['view'] as View) ?? 'new');
  protected readonly jobId = computed(() => this.params().get('jobId'));
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  /** True when the person has just arrived from a finished check. */
  protected readonly justFinished = computed(() => this.query().get('done') === '1');

  // ------------------------------------------------------------------ hero
  protected readonly verified = computed(() => this.store.overview()?.numbersVerified ?? 0);
  protected readonly onWhatsApp = computed(() => this.store.overview()?.onWhatsApp ?? 0);
  protected readonly jobsRun = computed(() => this.store.overview()?.jobsRun ?? this.store.jobs().length);

  /** What the foot of the jobs list says about the service doing the work. */
  protected readonly workerLine = computed(() => {
    const overview = this.store.overview();
    if (!overview) return '';
    if (!overview.available) return 'The integration worker has not been set up for this database yet, so checks cannot run.';
    if (!overview.workerOnline) {
      return overview.workerLastSeen
        ? `The integration worker is not running (last seen ${localDateTime(overview.workerLastSeen)}). Uploads are kept and checked when it is back.`
        : 'The integration worker is not running. Uploads are kept and checked when it starts.';
    }
    return `Checks are run by the integration worker · ${unitPrice(overview.pricePerNumber, overview.currency)} per number, at least ${money(overview.minimumCharge, overview.currency)} per check.`;
  });

  /**
   * What a check costs, said under the estimate.
   *
   * THIS LINE USED TO READ "Numbers that can't be verified are not charged", which is not how
   * CheckNumber.ai bills: it charges for every number submitted, verified or not, with a floor per
   * check. The only numbers that cost nothing are the ones answered from saved results.
   */
  protected readonly chargeNote = computed(() => {
    const overview = this.store.overview();
    if (!overview || overview.pricePerNumber <= 0) return 'Numbers answered from saved results are not charged.';
    return `CheckNumber.ai charges ${unitPrice(overview.pricePerNumber, overview.currency)} for every number submitted, at least ${money(overview.minimumCharge, overview.currency)} per check. Saved results are free.`;
  });

  // ------------------------------------------------------------------ upload
  protected readonly reading = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly recheck = signal(false);
  /** True while the file is on its way to the server. */
  protected readonly starting = signal(false);
  /** Something worth telling the person that is not a failure (for example "this file was already checked"). */
  protected readonly notice = signal<string | null>(null);
  /** Why the last action on a job (retry, stop, download) did not work. */
  protected readonly actionProblem = signal<string | null>(null);

  /** The campaign this list is for; it links the check - and the messages that follow - to that campaign. */
  protected readonly campaignId = signal<string>(NO_CAMPAIGN);
  protected readonly campaignOptions = signal<WaOption[]>([{ value: NO_CAMPAIGN, label: 'No campaign' }]);

  protected readonly draft = this.store.draft;
  /** True once the person has pressed Next on the upload step; a file alone never moves the stepper on. */
  protected readonly reviewing = signal(false);
  /** The check that has just ended on this screen; it stays on step 3 until the person presses Next. */
  protected readonly finishedId = signal<string | null>(null);
  /** True once the person has pressed Next on the live step, which opens the report step. */
  protected readonly reported = signal(false);
  protected readonly step = computed<1 | 2 | 3 | 4>(() => {
    if (this.store.activeJob()) return 3;
    if (this.finishedId()) return this.reported() ? 4 : 3;
    return this.draft() && this.reviewing() ? 2 : 1;
  });

  protected readonly reviewTab = signal<ReviewTab>('fresh');
  protected readonly reviewPage = signal(1);
  protected readonly reviewSize = signal(25);

  protected readonly toCheck = computed(() => {
    const d = this.draft();
    if (!d) return 0;
    return d.fresh.length + (this.recheck() ? d.alreadyChecked.length : 0);
  });
  protected readonly estimate = computed(() => this.store.estimate(this.toCheck()));

  /**
   * How many numbers CheckNumber.ai's minimum charge pays for (500, as the worker publishes it): a check of
   * fewer costs the same, so the review says so - large lists are what make a check worth its price.
   */
  protected readonly billableMinimum = computed(() => this.store.overview()?.billableMinimumNumbers ?? 0);
  /** The worker's own floor (CheckNumber:MinimumNumbersPerTask): a check with fewer new numbers is refused. */
  protected readonly minimumNumbers = computed(() => this.store.overview()?.minimumNumbersPerTask ?? 1);
  protected readonly belowMinimum = computed(() => this.toCheck() > 0 && this.minimumNumbers() > 1 && this.toCheck() < this.minimumNumbers());
  protected readonly belowBillable = computed(() => this.toCheck() > 0 && this.billableMinimum() > 0 && this.toCheck() < this.billableMinimum());

  protected readonly knownYes = computed(() => this.draft()?.alreadyChecked.filter((k) => k.result === 'yes').length ?? 0);
  protected readonly knownNo = computed(() => (this.draft()?.alreadyChecked.length ?? 0) - this.knownYes());

  protected readonly reviewRows = computed(() => {
    const d = this.draft();
    if (!d) return [];
    switch (this.reviewTab()) {
      case 'fresh': return d.fresh;
      case 'known': return d.alreadyChecked;
      case 'duplicates': return d.duplicates;
      default: return d.invalid;
    }
  });
  protected readonly reviewSlice = computed(() => {
    const size = this.reviewSize();
    const start = (this.reviewPage() - 1) * size;
    return this.reviewRows().slice(start, start + size);
  });

  // ------------------------------------------------------------------ live check
  protected readonly active = this.store.activeJob;
  /** The running job, or the one that just ended and is waiting for Next. */
  protected readonly current = computed(() => this.store.activeJob() ?? this.store.job(this.finishedId()));
  protected readonly running = computed(() => !!this.store.activeJob());
  protected readonly percent = computed(() => {
    const job = this.current();
    if (!job) return 0;
    if (job.submitted === 0) return this.running() ? 0 : 100;
    return Math.min(100, Math.floor((job.processed / job.submitted) * 100));
  });
  protected readonly ringOffset = computed(() => 2 * Math.PI * 54 * (1 - this.percent() / 100));
  /** Answers received in this run, leaving out the saved results that were in the job from the start. */
  protected readonly live = computed(() => {
    const job = this.current();
    if (!job) return { yes: 0, no: 0 };
    const saved = this.store.runSaved();
    return { yes: Math.max(0, job.yes - saved.yes), no: Math.max(0, job.no - saved.no) };
  });
  protected readonly remaining = computed(() => {
    const job = this.current();
    return job ? Math.max(0, job.submitted - job.processed) : 0;
  });
  protected readonly elapsed = computed(() => Math.max(0, this.store.now() - this.store.runStartedAt()));
  protected readonly speed = computed(() => {
    const job = this.current();
    const seconds = this.elapsed() / 1000;
    return job && seconds > 0.5 ? Math.round(job.processed / seconds) : 0;
  });
  protected readonly eta = computed(() => {
    const rate = this.speed();
    return rate > 0 ? (this.remaining() / rate) * 1000 : 0;
  });
  protected readonly duration = duration;

  // ------------------------------------------------------------------ jobs list
  protected readonly jobFilter = signal<JobFilter>('all');
  protected readonly jobQuery = signal('');
  protected readonly jobPage = signal(1);
  protected readonly jobSize = signal(25);

  protected readonly jobCounts = computed(() => {
    const out: Record<JobFilter, number> = { all: 0, queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const j of this.store.jobs()) {
      out.all++;
      out[j.status]++;
    }
    return out;
  });
  protected readonly jobRows = computed(() => {
    const filter = this.jobFilter();
    const q = this.jobQuery().trim().toLowerCase();
    return this.store.jobs().filter(
      (j) => (filter === 'all' || j.status === filter) && (!q || j.id.toLowerCase().includes(q) || j.fileName.toLowerCase().includes(q) || j.taskId.toLowerCase().includes(q)),
    );
  });
  protected readonly jobSlice = computed(() => {
    const size = this.jobSize();
    const start = (this.jobPage() - 1) * size;
    return this.jobRows().slice(start, start + size);
  });

  // ------------------------------------------------------------------ job report
  protected readonly job = computed(() => this.store.job(this.view() === 'new' ? this.finishedId() : this.jobId()));
  protected readonly reportTab = signal<ReportTab>('all');
  protected readonly reportQuery = signal('');
  protected readonly reportPage = signal(1);
  protected readonly reportSize = signal(25);
  protected readonly copied = signal(false);
  /** True while the job named in the address bar is being fetched, so "not here" is not shown too early. */
  protected readonly opening = signal(false);

  protected readonly reportCounts = computed(() => {
    const job = this.job();
    const out: Record<ReportTab, number> = { all: 0, valid: 0, invalid: 0, unverified: 0, saved: 0 };
    if (!job) return out;
    for (const r of job.results) {
      out.all++;
      if (r.whatsapp === 'yes') out.valid++;
      else if (r.whatsapp === 'no') out.invalid++;
      else out.unverified++;
      if (r.status === 'saved') out.saved++;
    }
    return out;
  });
  protected readonly reportRows = computed(() => {
    const job = this.job();
    if (!job) return [];
    const tab = this.reportTab();
    // Numbers are matched without their spaces and dashes; names, countries and notes as typed.
    const text = this.reportQuery().trim().toLowerCase();
    const digits = text.replace(/[\s-]/g, '');
    return job.results.filter((r) => {
      if (tab === 'valid' && r.whatsapp !== 'yes') return false;
      if (tab === 'invalid' && r.whatsapp !== 'no') return false;
      if (tab === 'unverified' && r.whatsapp !== 'unknown') return false;
      if (tab === 'saved' && r.status !== 'saved') return false;
      return !text || r.number.includes(digits) || r.country.toLowerCase().includes(text) || r.note.toLowerCase().includes(text)
        || (r.contactName ?? '').toLowerCase().includes(text);
    });
  });
  protected readonly reportSlice = computed(() => {
    const size = this.reportSize();
    const start = (this.reportPage() - 1) * size;
    return this.reportRows().slice(start, start + size);
  });
  /** Share of the job in each answer, for the split bar. */
  protected readonly split = computed(() => {
    const job = this.job();
    const total = job ? Math.max(1, job.yes + job.no + job.unknown) : 1;
    return {
      yes: job ? (job.yes / total) * 100 : 0,
      no: job ? (job.no / total) * 100 : 0,
      unknown: job ? (job.unknown / total) * 100 : 0,
    };
  });
  /**
   * The job's timeline: the worker's own step log once it has been read, and before that the three
   * moments the list already knows (created, finished or still waiting).
   */
  protected readonly timeline = computed<JobTimelineStep[]>(() => {
    const job = this.job();
    if (!job) return [];
    if (job.timeline.length > 0) return job.timeline;

    const steps: JobTimelineStep[] = [{ label: 'File received', at: job.createdAt, state: 'done' }];
    if (job.status === 'failed') {
      steps.push({ label: 'Failed', at: job.finishedAt, state: 'bad' });
    } else if (job.status === 'cancelled') {
      steps.push({ label: 'Stopped', at: job.finishedAt, state: 'bad' });
    } else if (job.status === 'completed') {
      steps.push({ label: job.sharedToWati > 0 ? `${count(job.sharedToWati)} valid numbers ready to pick for a message` : 'No number on WhatsApp', at: job.finishedAt, state: 'done' });
    } else {
      steps.push({ label: 'Waiting for results', at: null, state: 'wait' });
    }
    return steps;
  });

  /** The number being "looked up" on the live view: its digits scramble, then settle into the real answer. */
  protected readonly scan = signal<{ text: string; result: WaResult | null }>({ text: '+91 ··········', result: null });
  private scanTarget = '';
  private scanAnswer: WaResult = 'unknown';
  private scanResolved = 0;

  private watching: string | null = this.store.activeJobId();

  constructor() {
    // The "verifying" line settles on the newest real answer once the result file has been read. While
    // a check is still running there is no answer yet, so it shows the placeholder and "Looking up...".
    effect(() => {
      const latest = this.store.feed()[0];
      untracked(() => {
        if (!latest) {
          this.scanTarget = '';
          this.scan.set({ text: '+91 ··········', result: null });
        } else if (latest.number !== this.scanTarget) {
          this.scanTarget = latest.number;
          this.scanAnswer = latest.whatsapp;
          this.scanResolved = 1;
        }
      });
    });
    const scanTimer = setInterval(() => this.tickScan(), 45);
    this.destroyRef.onDestroy(() => clearInterval(scanTimer));

    // Reset the paging whenever the thing being paged changes.
    effect(() => { this.reviewTab(); this.recheck(); untracked(() => this.reviewPage.set(1)); });
    effect(() => { this.jobFilter(); this.jobQuery(); untracked(() => this.jobPage.set(1)); });
    effect(() => { this.reportTab(); this.reportQuery(); this.jobId(); untracked(() => this.reportPage.set(1)); });

    // When the job being watched finishes, stay on the live step until the person presses Next.
    // (A stand-in for an upload that was refused has been removed by then; there is nothing to show.)
    effect(() => {
      const id = this.store.activeJobId();
      untracked(() => {
        if (this.watching && !id && this.view() === 'new' && this.store.job(this.watching)) {
          this.finishedId.set(this.watching);
        }
        this.watching = id;
      });
    });

    // Opening a job's page reads that job - its timeline, its report and its downloads - from the server.
    effect(() => {
      const id = this.jobId();
      const view = this.view();
      untracked(() => {
        this.actionProblem.set(null);
        if (view === 'job' && id) {
          this.opening.set(true);
          void this.store.openJob(id).finally(() => this.opening.set(false));
        }
      });
    });

    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((d) => {
      const view = (d['view'] as View) ?? 'new';
      this.view.set(view);
      if (view !== 'new') {
        this.finishedId.set(null);
        this.reported.set(false);
      }
      // The list is read again each time it is opened: a check may have finished meanwhile.
      if (view === 'jobs') {
        void this.store.refresh();
      }
    });

    // The campaigns a list can be uploaded for. Without them the picker simply offers "No campaign".
    this.campaigns.lookupCampaigns().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => this.campaignOptions.set([
        { value: NO_CAMPAIGN, label: 'No campaign', hint: 'Not linked to a campaign' },
        ...list.map((c) => ({ value: c.id, label: c.name, hint: c.code })),
      ]),
      error: () => undefined,
    });
  }

  private tickScan(): void {
    const target = this.scanTarget;
    if (!target || this.running()) {
      return;
    }
    if (this.scanResolved >= target.length && this.scan().result !== null) {
      return;
    }
    this.scanResolved = Math.min(target.length, this.scanResolved + 3);
    let text = '';
    for (let i = 0; i < target.length; i++) {
      text += i < this.scanResolved ? target[i] : String(Math.floor(Math.random() * 10));
    }
    this.scan.set({ text, result: this.scanResolved >= target.length ? this.scanAnswer : null });
  }

  // ================================================================== upload actions

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.take(file);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.take(file);
  }

  protected onDrag(event: DragEvent, over: boolean): void {
    event.preventDefault();
    this.dragging.set(over);
  }

  private async take(file: File): Promise<void> {
    this.problem.set(null);
    this.notice.set(null);
    this.reading.set(file.name);
    try {
      // A short pause so the reading state is seen even for tiny files, rather than flashing.
      const [analysis] = await Promise.all([this.store.analyse(file), new Promise((r) => setTimeout(r, 700))]);
      this.reviewTab.set(analysis.fresh.length === 0 && analysis.alreadyChecked.length > 0 ? 'known' : 'fresh');
      this.recheck.set(false);
      this.store.setDraft(analysis);
    } catch (error) {
      this.problem.set(error instanceof FileProblem ? error.message : 'This file could not be read. Try another one.');
    } finally {
      this.reading.set(null);
    }
  }

  protected next(): void {
    if (this.draft()) this.reviewing.set(true);
  }

  /** Step 3 -> 4: open the report of the check that just ended. */
  protected showReport(): void {
    if (this.finishedId()) this.reported.set(true);
  }

  /** Step 4 -> jobs list; a job's detail is opened from there. */
  protected done(): void {
    this.finishedId.set(null);
    this.reported.set(false);
    this.notice.set(null);
    void this.router.navigate(['/app/whatsapp/check-number/jobs']);
  }

  protected discard(): void {
    this.reviewing.set(false);
    this.store.setDraft(null);
    this.problem.set(null);
    this.recheck.set(false);
    this.campaignId.set(NO_CAMPAIGN);
  }

  /** The file held at least one valid number. */
  protected hasNumbers(d: UploadAnalysis): boolean {
    return d.fresh.length > 0 || d.alreadyChecked.length > 0;
  }

  /** The check can start: there is something to check or report, and the worker's floor is met. */
  protected canStart(d: UploadAnalysis): boolean {
    return this.hasNumbers(d) && !this.belowMinimum();
  }

  /** A send made from this check, opened in the send log. */
  protected openSend(id: string): void {
    void this.router.navigate(['/app/whatsapp/wati/send-log'], { queryParams: { send: id } });
  }

  /** Uploads the reviewed file. The check then runs on the server, whether or not this page stays open. */
  protected async start(): Promise<void> {
    const d = this.draft();
    if (!d || !this.canStart(d) || this.starting()) return;

    this.problem.set(null);
    this.notice.set(null);
    this.reported.set(false);
    this.finishedId.set(null);
    this.starting.set(true);

    const campaign = this.campaignId() === NO_CAMPAIGN ? null : this.campaignId();
    try {
      const outcome = await this.store.startJob(d, this.recheck(), campaign);
      this.reviewing.set(false);
      this.campaignId.set(NO_CAMPAIGN);
      if (outcome.duplicate) {
        // The file was processed before: its job already holds the answers.
        this.notice.set(outcome.notice);
        this.finishedId.set(outcome.jobId);
      }
    } catch (error) {
      // The upload was refused; the review stays open so the person can change the file and try again.
      this.reviewing.set(true);
      this.problem.set(error instanceof Error ? error.message : 'The file could not be uploaded. Please try again.');
    } finally {
      this.starting.set(false);
    }
  }

  protected async stop(): Promise<void> {
    const id = this.store.activeJobId();
    if (!id) return;
    this.actionProblem.set(null);
    try {
      await this.store.cancel(id);
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'The check could not be stopped.');
    }
  }

  protected setReviewTab(tab: ReviewTab): void {
    this.reviewTab.set(tab);
  }

  protected kindGlyph(kind: string): string {
    return kind === 'xls' || kind === 'xlsx' ? 'ph-file-xls' : kind === 'csv' ? 'ph-file-csv' : 'ph-file-text';
  }

  // ================================================================== jobs / report actions

  protected openJob(job: CheckJob): void {
    void this.router.navigate(['/app/whatsapp/check-number/jobs', job.id]);
  }

  protected async resume(job: CheckJob): Promise<void> {
    this.actionProblem.set(null);
    try {
      await this.store.resume(job.id);
      if (this.store.activeJobId() === job.id) {
        void this.router.navigate(['/app/whatsapp/check-number']);
      }
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'The check could not be retried.');
    }
  }

  protected statusLabel(status: JobStatus): string {
    return { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }[status];
  }

  protected async copyTask(taskId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(taskId);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      this.copied.set(false);
    }
  }

  protected jobCount(key: string): number {
    return this.jobCounts()[key as JobFilter];
  }

  protected reportCount(key: string): number {
    return this.reportCounts()[key as ReportTab];
  }

  protected progressOf(job: CheckJob): number {
    return job.submitted > 0 ? Math.min(100, Math.floor((job.processed / job.submitted) * 100)) : 100;
  }

  protected rowResult(row: ResultRow): string {
    return RESULT_LABEL[row.whatsapp];
  }

  // ---- downloads

  /** Every download comes from the server: the stored original, the worker's output, CheckNumber.ai's own archive. */
  protected async download(job: CheckJob, kind: JobFileKind): Promise<void> {
    this.actionProblem.set(null);
    try {
      await this.store.download(job, kind);
    } catch (error) {
      this.actionProblem.set(error instanceof Error ? error.message : 'That file could not be downloaded.');
    }
  }
}
