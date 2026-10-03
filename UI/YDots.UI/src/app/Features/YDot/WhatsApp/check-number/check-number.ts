import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FileProblem, MAX_FILE_BYTES, formatBytes } from '../file-extract';
import { WaPagerComponent } from '../wa-pager/wa-pager';
import { COST_PER_CHECK, WhatsAppStore } from '../whatsapp-store.service';
import { CheckJob, JobStatus, ResultRow, UploadAnalysis, WaResult } from '../whatsapp.models';
import { count, duration, localDateTime, localDateTimeFull, rupees, saveFile, timeZoneLabel, toCsv } from '../wa-format';

type View = 'new' | 'jobs' | 'job';
type ReviewTab = 'fresh' | 'known' | 'duplicates' | 'invalid';
type ReportTab = 'all' | 'valid' | 'invalid' | 'unverified' | 'saved';
type JobFilter = 'all' | JobStatus;

const REPORT_LABEL: Record<WaResult, string> = { yes: 'Yes', no: 'No', unknown: 'Unknown' };
const RESULT_LABEL: Record<WaResult, string> = { yes: 'Valid', no: 'Invalid', unknown: 'Unverified' };

/**
 * CheckNumber: upload a list, see what it holds, check which numbers are on WhatsApp, read the report.
 *
 * One component, three views picked by the route: the new-check flow (upload -> review -> live check), the job
 * history, and one job's report. The upload under review and the running job live in `WhatsAppStore`, so
 * moving between views never loses either.
 */
@Component({
  selector: 'app-check-number',
  imports: [RouterLink, WaPagerComponent],
  templateUrl: './check-number.html',
  styleUrls: ['../wa-shared.css', './check-number.css'],
})
export class CheckNumberComponent {
  protected readonly store = inject(WhatsAppStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly maxMb = MAX_FILE_BYTES / (1024 * 1024);
  protected readonly costPer = COST_PER_CHECK;
  protected readonly zone = timeZoneLabel();
  protected readonly bytes = formatBytes;
  protected readonly n = count;
  protected readonly money = rupees;
  protected readonly dt = localDateTime;
  protected readonly dtFull = localDateTimeFull;
  protected readonly resultLabel = RESULT_LABEL;
  protected readonly enabledLabel = REPORT_LABEL;

  private readonly params = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  protected readonly view = signal<View>((this.route.snapshot.data['view'] as View) ?? 'new');
  protected readonly jobId = computed(() => this.params().get('jobId'));
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  /** True when the person has just arrived from a finished check. */
  protected readonly justFinished = computed(() => this.query().get('done') === '1');

  // ------------------------------------------------------------------ upload
  protected readonly reading = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly recheck = signal(false);

  protected readonly verified = computed(() => Object.keys(this.store.registry()).length);

  protected readonly draft = this.store.draft;
  protected readonly step = computed<1 | 2 | 3>(() => {
    if (this.store.activeJob()) return 3;
    return this.draft() ? 2 : 1;
  });

  protected readonly reviewTab = signal<ReviewTab>('fresh');
  protected readonly reviewPage = signal(1);
  protected readonly reviewSize = signal(50);

  protected readonly toCheck = computed(() => {
    const d = this.draft();
    if (!d) return 0;
    return d.fresh.length + (this.recheck() ? d.alreadyChecked.length : 0);
  });
  protected readonly estimate = computed(() => Math.round(this.toCheck() * COST_PER_CHECK * 100) / 100);

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
  protected readonly percent = computed(() => {
    const job = this.active();
    return job && job.submitted > 0 ? Math.min(100, Math.floor((job.processed / job.submitted) * 100)) : 0;
  });
  protected readonly ringOffset = computed(() => 2 * Math.PI * 54 * (1 - this.percent() / 100));
  /** Answers received in this run, leaving out the saved results that were in the job from the start. */
  protected readonly live = computed(() => {
    const job = this.active();
    if (!job) return { yes: 0, no: 0 };
    let savedYes = 0;
    let savedNo = 0;
    for (let i = 0; i < job.saved; i++) {
      if (job.results[i].whatsapp === 'yes') savedYes++;
      else savedNo++;
    }
    return { yes: job.yes - savedYes, no: job.no - savedNo };
  });
  protected readonly remaining = computed(() => {
    const job = this.active();
    return job ? Math.max(0, job.submitted - job.processed) : 0;
  });
  protected readonly elapsed = computed(() => Math.max(0, this.store.now() - this.store.runStartedAt()));
  protected readonly speed = computed(() => {
    const job = this.active();
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
      (j) => (filter === 'all' || j.status === filter) && (!q || j.id.toLowerCase().includes(q) || j.fileName.toLowerCase().includes(q) || j.taskId.includes(q)),
    );
  });
  protected readonly jobSlice = computed(() => {
    const size = this.jobSize();
    const start = (this.jobPage() - 1) * size;
    return this.jobRows().slice(start, start + size);
  });

  // ------------------------------------------------------------------ job report
  protected readonly job = computed(() => this.store.job(this.jobId()));
  protected readonly reportTab = signal<ReportTab>('all');
  protected readonly reportQuery = signal('');
  protected readonly reportPage = signal(1);
  protected readonly reportSize = signal(50);
  protected readonly copied = signal(false);

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
    const q = this.reportQuery().replace(/[\s-]/g, '').toLowerCase();
    return job.results.filter((r) => {
      if (tab === 'valid' && r.whatsapp !== 'yes') return false;
      if (tab === 'invalid' && r.whatsapp !== 'no') return false;
      if (tab === 'unverified' && r.whatsapp !== 'unknown') return false;
      if (tab === 'saved' && r.status !== 'saved') return false;
      return !q || r.number.includes(q) || r.country.toLowerCase().includes(q) || r.note.toLowerCase().includes(q);
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
  protected readonly timeline = computed(() => {
    const job = this.job();
    if (!job) return [];
    const steps: { label: string; at: string | null; state: 'done' | 'bad' | 'wait' }[] = [
      { label: 'File uploaded and read', at: job.createdAt, state: 'done' },
      { label: 'Submitted to CheckNumber.ai', at: job.createdAt, state: 'done' },
    ];
    if (job.status === 'failed') {
      steps.push({ label: 'Failed', at: job.finishedAt, state: 'bad' });
    } else if (job.status === 'cancelled') {
      steps.push({ label: 'Stopped by you', at: job.finishedAt, state: 'bad' });
    } else if (job.status === 'completed') {
      steps.push({ label: 'Results received', at: job.finishedAt, state: 'done' });
      steps.push({ label: job.sharedToWati > 0 ? `${count(job.sharedToWati)} valid numbers shared to Wati` : 'No new numbers to share', at: job.finishedAt, state: 'done' });
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
    effect(() => {
      const latest = this.store.feed()[0];
      if (latest && latest.number !== this.scanTarget) {
        this.scanTarget = latest.number;
        this.scanAnswer = latest.whatsapp;
        this.scanResolved = 1;
      }
    });
    const scanTimer = setInterval(() => this.tickScan(), 45);
    this.destroyRef.onDestroy(() => clearInterval(scanTimer));

    // Reset the paging whenever the thing being paged changes.
    effect(() => { this.reviewTab(); this.recheck(); untracked(() => this.reviewPage.set(1)); });
    effect(() => { this.jobFilter(); this.jobQuery(); untracked(() => this.jobPage.set(1)); });
    effect(() => { this.reportTab(); this.reportQuery(); this.jobId(); untracked(() => this.reportPage.set(1)); });

    // When the job being watched finishes, move to its report.
    effect(() => {
      const id = this.store.activeJobId();
      untracked(() => {
        if (this.watching && !id && this.view() === 'new') {
          void this.router.navigate(['/app/whatsapp/check-number/jobs', this.watching], { queryParams: { done: 1 } });
        }
        this.watching = id;
      });
    });

    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((d) => this.view.set((d['view'] as View) ?? 'new'));
  }

  private tickScan(): void {
    const target = this.scanTarget;
    if (!target || !this.store.activeJobId()) {
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

  protected discard(): void {
    this.store.setDraft(null);
    this.problem.set(null);
    this.recheck.set(false);
  }

  protected canStart(d: UploadAnalysis): boolean {
    return d.fresh.length > 0 || d.alreadyChecked.length > 0;
  }

  protected start(): void {
    const d = this.draft();
    if (!d || !this.canStart(d)) return;
    const id = this.store.startJob(d, this.recheck());
    if (!this.store.activeJobId()) {
      void this.router.navigate(['/app/whatsapp/check-number/jobs', id], { queryParams: { done: 1 } });
    }
  }

  protected stop(): void {
    const id = this.store.activeJobId();
    if (id) this.store.cancel(id);
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

  protected resume(job: CheckJob): void {
    this.store.resume(job.id);
    if (this.store.activeJobId() === job.id) {
      void this.router.navigate(['/app/whatsapp/check-number']);
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

  protected download(job: CheckJob, kind: 'original' | 'submitted' | 'results' | 'raw' | 'invalid'): void {
    const base = job.id;
    switch (kind) {
      case 'original':
        if (job.original) {
          saveFile(job.fileName, job.original, job.original.type || 'application/octet-stream');
        }
        break;
      case 'submitted':
        saveFile(`${base}-submitted-numbers.txt`, job.submittedNumbers.join('\r\n'), 'text/plain;charset=utf-8');
        break;
      case 'results':
        saveFile(
          `${base}-results.csv`,
          '﻿' + toCsv(
            ['Number', 'Country', 'WhatsApp enabled', 'Result', 'Note', 'Status'],
            job.results.map((r) => [r.number, r.country, REPORT_LABEL[r.whatsapp], RESULT_LABEL[r.whatsapp], r.note, r.status === 'saved' ? 'Saved result' : r.status === 'unverified' ? 'Unverified' : 'Checked']),
          ),
          'text/csv;charset=utf-8',
        );
        break;
      case 'raw':
        saveFile(
          `checknumber-ai-raw-${job.taskId}.json`,
          JSON.stringify(
            {
              task_id: job.taskId,
              status: job.status,
              created_at: job.createdAt,
              finished_at: job.finishedAt,
              error: job.errorCode,
              total: job.submitted,
              data: job.results.filter((r) => r.status !== 'saved').map((r) => ({
                number: r.number,
                whatsapp: r.whatsapp,
                message: r.note,
              })),
            },
            null,
            2,
          ),
          'application/json',
        );
        break;
      case 'invalid':
        saveFile(
          `${base}-invalid-lines.csv`,
          '﻿' + toCsv(['Sheet', 'Line', 'Value', 'Reason'], job.invalidLines.map((l) => [l.sheet, l.line, l.raw, l.reason])),
          'text/csv;charset=utf-8',
        );
        break;
    }
  }

  protected resetDemo(): void {
    this.store.resetAll();
    void this.router.navigate(['/app/whatsapp/check-number/jobs']);
  }
}
