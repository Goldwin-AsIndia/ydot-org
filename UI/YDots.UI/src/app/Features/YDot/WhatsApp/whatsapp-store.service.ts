import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  CheckJobDetailDto,
  CheckJobDto,
  CheckJobResultDto,
  JobFileKind,
  JobTimelineDto,
  SendBroadcastDto,
  WatiMessageDto,
  WatiTemplateDto,
  WhatsAppApiService,
  WhatsAppOverviewDto,
} from '../../../Service/whatsapp-api.service';
import { apiErrorMessage } from '../../../Shared/models/api-response.model';
import { AuthTokenService } from '../../../Shared/services/auth-token.service';
import { FileProblem, checkFile, readFile } from './file-extract';
import { countryOf, scanRow } from './number-tools';
import {
  AlreadyChecked,
  CheckJob,
  Composer,
  EMPTY_COMPOSER,
  FileKind,
  InvalidLine,
  JobTimelineStep,
  ResultRow,
  SelectedNumber,
  SheetSummary,
  UploadAnalysis,
  UploadNumber,
  WaResult,
  WatiBroadcast,
  WatiMessage,
  WatiTemplate,
  WhatsAppOverview,
} from './whatsapp.models';
import { saveFile } from './wa-format';

/**
 * CheckNumber -> selection -> Wati, read from the Campaign service.
 *
 * A CHECK ONLY VALIDATES. The YDot.Integration worker finds out which numbers of an uploaded file are on
 * WhatsApp and stops there; nobody is messaged because a file arrived. The validated numbers wait in the
 * organisation's pool, the person picks the ten or fifty to message (the selection kept here), fills a
 * template (the composer kept here), reviews what will happen and sends. Each send is a request left for
 * the worker, followed the same way a check is.
 *
 * THE SERVER IS THE DUPLICATE CHECK. Before a file is submitted, `analyse` asks which of its numbers
 * already have a saved answer, so the review shows what will - and will not - be paid for. The
 * worker applies the same rule again when it reads the file, so the two always agree.
 *
 * NO RESULT IS INVENTED WHILE A CHECK RUNS. CheckNumber.ai answers a whole file at once, not number
 * by number, so the live view shows the provider's own progress counter and the "latest answers"
 * list fills when the result file has been read - never with made-up verdicts.
 */

/** How often a running job is read again. CheckNumber.ai itself is polled by the worker, not from here. */
const JOB_POLL_MS = 2500;
/** How often an upload is checked for the job the worker creates from it. */
const UPLOAD_POLL_MS = 1500;
/** How long an upload is followed before the page stops asking (the job still appears in Jobs later). */
const UPLOAD_FOLLOW_MS = 30 * 60 * 1000;
/** How often a request left for the worker (retry, stop, send) is checked. */
const COMMAND_POLL_MS = 1000;
/** How long a request is followed before the page stops waiting for it. */
const COMMAND_FOLLOW_MS = 45 * 1000;
/** How often the delivery report is read again while it is on screen. */
const REPORT_POLL_MS = 10000;
/** The sends offered as filters on the delivery report. */
const REPORT_BROADCASTS = 200;

const NO_DOWNLOADS = { original: false, submitted: false, results: false, raw: false, invalid: false };

/** What starting a check led to. */
export interface StartOutcome {
  /** The job to show: the new one, or the earlier job that already holds this file's results. */
  readonly jobId: string | null;
  /** True when the file had been processed before and no new check was started. */
  readonly duplicate: boolean;
  /** What to tell the person, when there is something to tell. */
  readonly notice: string | null;
}

@Injectable({ providedIn: 'root' })
export class WhatsAppStore {
  private readonly api = inject(WhatsAppApiService);
  private readonly tokens = inject(AuthTokenService);

  readonly overview = signal<WhatsAppOverview | null>(null);
  readonly templates = signal<WatiTemplate[]>([]);
  readonly jobs = signal<CheckJob[]>([]);
  readonly messages = signal<WatiMessage[]>([]);
  readonly broadcasts = signal<WatiBroadcast[]>([]);

  /** True until the first answer from the server has arrived. */
  readonly loading = signal(true);
  /** Why the last read failed, in words for the person; null when it worked. */
  readonly problem = signal<string | null>(null);

  /** The upload being reviewed. Kept here so leaving the screen and coming back does not lose it. */
  readonly draft = signal<UploadAnalysis | null>(null);

  /** The job being followed right now, and its last few answers once they are in. */
  readonly activeJobId = signal<string | null>(null);
  readonly feed = signal<{ number: string; whatsapp: WaResult }[]>([]);
  readonly runStartedAt = signal<number>(0);
  readonly now = signal<number>(Date.now());
  /** What the worker said about the send just made; shown once on the send log it opens. */
  readonly broadcastNotice = signal<string | null>(null);
  /** Saved answers that were in the running job from the start, so the live tally counts only new ones. */
  readonly runSaved = signal<{ yes: number; no: number }>({ yes: 0, no: 0 });

  // ------------------------------------------------------------------ the send being composed

  /** The numbers picked for the next send, by number, each with the check it was picked from. */
  readonly selection = signal<ReadonlyMap<string, SelectedNumber>>(new Map());
  /** Template, values, bindings, name, campaign, tags - what has been chosen and typed so far. */
  readonly composer = signal<Composer>(EMPTY_COMPOSER);
  /** Which step of the composer is on screen: 1 numbers, 2 template, 3 review and send. */
  readonly composeStep = signal<1 | 2 | 3>(1);
  /**
   * The campaign and tags a recipient group brought into the composer, with what was there before. They
   * came with the group's numbers, so clearing the selection takes them out again - unless the person
   * changed them since. Without it a hand-picked send went out with the last group's tags.
   */
  private fromGroup: { campaignId: string | null; tags: readonly string[]; before: Pick<Composer, 'campaignId' | 'tags'> } | null = null;

  /** The most numbers one send may hold, as the worker and the server agree (0 until known). */
  readonly selectionCap = computed(() => this.overview()?.maxRecipientsPerSend ?? 0);
  readonly selectionList = computed(() => [...this.selection().values()]);

  readonly activeJob = computed(() => this.jobs().find((j) => j.id === this.activeJobId()) ?? null);

  /** Bumped whenever the signed-in session changes, so a slow answer for the previous one is dropped. */
  private generation = 0;
  private sessionKey: string | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private watiLoaded = false;

  constructor() {
    // ONE BROWSER TAB CAN SERVE TWO PEOPLE IN A ROW. This store lives as long as the page does, so
    // without this a second person signing in would briefly see the first one's jobs. Everything
    // is dropped when the session changes, and read again for whoever is signed in now.
    //
    // THE FIRST SESSION IS TAKEN HERE, NOT IN THE EFFECT. An effect runs after construction, and by
    // then the page that created this store has usually asked for something - a job's detail, say.
    // Resetting at that point would throw that answer away as "belongs to the previous session".
    this.sessionKey = this.currentSessionKey();
    if (this.sessionKey) {
      void this.refresh();
    } else {
      this.loading.set(false);
    }

    effect(() => {
      this.tokens.user();
      this.tokens.organisationCode();
      untracked(() => {
        const key = this.currentSessionKey();
        if (key === this.sessionKey) {
          return;
        }
        this.sessionKey = key;
        this.reset();
        if (key) {
          void this.refresh();
        }
      });
    });
  }

  /** Who is signed in, and in which organisation; null when nobody is. */
  private currentSessionKey(): string | null {
    return this.tokens.user() ? `${this.tokens.getSessionId() ?? ''}|${this.tokens.organisationCode()}` : null;
  }

  // =========================================================================================== loading

  /** Reads the overview and the jobs again, and picks up a job that is still running. */
  async refresh(): Promise<void> {
    const generation = this.generation;
    try {
      const [overview, page] = await Promise.all([
        firstValueFrom(this.api.overview()),
        firstValueFrom(this.api.jobs()),
      ]);
      if (generation !== this.generation) {
        return;
      }
      this.overview.set(toOverview(overview));
      this.mergeJobs(page.items);
      this.problem.set(null);

      // A check started earlier - on this device or another - is followed again from here.
      if (!this.activeJobId()) {
        const running = this.jobs().find((j) => j.key && (j.status === 'running' || j.status === 'queued'));
        if (running) {
          this.follow(running.id, Date.parse(running.createdAt) || Date.now());
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        this.problem.set(apiErrorMessage(error, 'The WhatsApp checks could not be loaded. Please try again.'));
      }
    } finally {
      if (generation === this.generation) {
        this.loading.set(false);
      }
    }
  }

  /** Reads what the Wati screens share: templates, the sends offered as report filters, and the delivery report. */
  async loadWati(force = false): Promise<void> {
    if (this.watiLoaded && !force) {
      return;
    }
    const generation = this.generation;
    try {
      const [templates, broadcasts, messages] = await Promise.all([
        firstValueFrom(this.api.templates()),
        firstValueFrom(this.api.broadcasts({ page: 1, pageSize: REPORT_BROADCASTS })),
        firstValueFrom(this.api.messages()),
      ]);
      if (generation !== this.generation) {
        return;
      }
      this.templates.set(templates.map(toTemplate));
      this.broadcasts.set(broadcasts.results.items.map((b) => ({
        id: b.id, name: b.name, templateName: b.templateName, templateLabel: b.templateLabel,
        createdAt: b.createdAtUtc, recipients: b.recipients,
      })));
      this.messages.set(messages.filter((m) => m.status !== 'SKIPPED').map(toMessage));
      this.watiLoaded = true;
      this.problem.set(null);
    } catch (error) {
      if (generation === this.generation) {
        this.problem.set(apiErrorMessage(error, 'The Wati data could not be loaded. Please try again.'));
      }
    }
  }

  /** Keeps the delivery report current while it is on screen; call with false when it closes. */
  watchReport(on: boolean): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    if (on) {
      this.reportTimer = setInterval(() => {
        void this.loadWati(true);
        void this.loadOverview();
      }, REPORT_POLL_MS);
    }
  }

  async loadOverview(): Promise<void> {
    const generation = this.generation;
    try {
      const overview = await firstValueFrom(this.api.overview());
      if (generation === this.generation) {
        this.overview.set(toOverview(overview));
      }
    } catch {
      // The figures simply stay as they were; the next read corrects them.
    }
  }

  private reset(): void {
    this.generation++;
    this.stopClock();
    this.watchReport(false);
    this.watiLoaded = false;
    this.overview.set(null);
    this.templates.set([]);
    this.jobs.set([]);
    this.messages.set([]);
    this.broadcasts.set([]);
    this.draft.set(null);
    this.activeJobId.set(null);
    this.feed.set([]);
    this.broadcastNotice.set(null);
    this.problem.set(null);
    this.selection.set(new Map());
    this.composer.set(EMPTY_COMPOSER);
    this.fromGroup = null;
    this.composeStep.set(1);
    this.loading.set(true);
  }

  // =========================================================================================== upload

  /** What checking `count` numbers is expected to cost, by the worker's own price settings. */
  estimate(count: number): number {
    const settings = this.overview();
    if (!settings || count <= 0) {
      return 0;
    }
    // CheckNumber.ai charges per number, with a floor per task: two numbers cost the same as 500.
    return Math.max(settings.minimumCharge, count * settings.pricePerNumber);
  }

  /** Reads a file and works out what it holds: numbers, duplicates, answers already known, bad lines. */
  async analyse(file: File): Promise<UploadAnalysis> {
    const kind = checkFile(file);
    const contents = await readFile(file, kind);

    // First pass: every valid number in the file, so the saved answers can be asked for in one call.
    const distinct = new Set<string>();
    for (const sheet of contents.sheets) {
      for (const cells of sheet.rows) {
        for (const hit of scanRow(cells).numbers) {
          distinct.add(hit.e164);
        }
      }
    }

    const known = new Map<string, { result: WaResult; checkedAt: string; sharedToWati: boolean }>();
    if (distinct.size > 0) {
      try {
        const answers = await firstValueFrom(this.api.lookupNumbers([...distinct]));
        for (const answer of answers) {
          known.set(answer.number, { result: answer.whatsApp, checkedAt: answer.checkedAtUtc, sharedToWati: answer.sharedToWati });
        }
      } catch (error) {
        throw new FileProblem(
          `The file was read, but the saved results could not be checked: ${apiErrorMessage(error, 'the server did not answer')}`,
        );
      }
    }

    const seen = new Set<string>();
    const fresh: UploadNumber[] = [];
    const duplicates: UploadNumber[] = [];
    const alreadyChecked: AlreadyChecked[] = [];
    const invalid: InvalidLine[] = [];
    const sheets: SheetSummary[] = [];
    let totalRows = 0;

    for (const sheet of contents.sheets) {
      let rows = 0;
      let found = 0;
      let sheetFresh = 0;
      let sheetDup = 0;
      let sheetKnown = 0;
      let sheetInvalid = 0;

      sheet.rows.forEach((cells, index) => {
        if (!cells.some((c) => String(c ?? '').trim() !== '')) {
          return;
        }
        rows++;
        const line = index + 1;
        const scan = scanRow(cells);

        for (const hit of scan.numbers) {
          found++;
          const country = countryOf(hit.e164);
          const base: UploadNumber = {
            number: hit.e164, iso: country.iso, country: country.name, sheet: sheet.name, line, raw: hit.raw,
          };
          if (seen.has(hit.e164)) {
            sheetDup++;
            duplicates.push(base);
            continue;
          }
          seen.add(hit.e164);
          // Only a Yes or a No is an answer worth reusing; the server never returns anything else here.
          const saved = known.get(hit.e164);
          if (saved) {
            sheetKnown++;
            alreadyChecked.push({ ...base, result: saved.result, checkedAt: saved.checkedAt, sharedToWati: saved.sharedToWati });
          } else {
            sheetFresh++;
            fresh.push(base);
          }
        }

        // A first row with no digits at all is a column heading ("Name, Phone"), not a bad line.
        const isHeading = line === 1 && scan.rejected?.reason === 'No phone number found';
        if (scan.rejected && !isHeading) {
          sheetInvalid++;
          invalid.push({ sheet: sheet.name, line, raw: scan.rejected.raw, reason: scan.rejected.reason });
        }
      });

      totalRows += rows;
      sheets.push({
        name: sheet.name, rows, found, fresh: sheetFresh, duplicates: sheetDup, alreadyChecked: sheetKnown, invalid: sheetInvalid,
      });
    }

    return { fileName: file.name, fileSize: file.size, kind, file, sheets, totalRows, fresh, duplicates, alreadyChecked, invalid };
  }

  setDraft(analysis: UploadAnalysis | null): void {
    this.draft.set(analysis);
  }

  // =========================================================================================== jobs

  /**
   * Uploads the reviewed file and follows the check.
   *
   * RESOLVES AS SOON AS THE SERVER HAS THE FILE. The worker creates the job a few seconds later; until
   * then a stand-in is shown so the live view has something to draw, and it is swapped for the real
   * job the moment that exists. Rejects with a sentence for the person when the upload is refused.
   */
  async startJob(analysis: UploadAnalysis, recheck: boolean, campaignId: string | null): Promise<StartOutcome> {
    const generation = this.generation;
    const toCheck = analysis.fresh.length + (recheck ? analysis.alreadyChecked.length : 0);
    const saved = recheck ? [] : analysis.alreadyChecked;
    const savedYes = saved.filter((k) => k.result === 'yes').length;
    const startedAt = Date.now();

    const standIn: CheckJob = {
      id: `Starting-${startedAt}`,
      key: '',
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      kind: analysis.kind,
      sheetCount: analysis.sheets.length,
      status: 'queued',
      taskId: '',
      createdAt: new Date(startedAt).toISOString(),
      finishedAt: null,
      submitted: toCheck,
      total: toCheck + saved.length,
      processed: 0,
      yes: savedYes,
      no: saved.length - savedYes,
      unknown: 0,
      saved: saved.length,
      duplicates: analysis.duplicates.length,
      invalid: analysis.invalid.length,
      estimatedCost: this.estimate(toCheck),
      actualCost: 0,
      currency: this.overview()?.currency ?? 'USD',
      outcome: 'Pending',
      reason: 'Uploading the file',
      errorCode: null,
      sharedToWati: 0,
      hasErrors: false,
      canRetry: false,
      canCancel: false,
      watiSent: 0,
      watiFailed: 0,
      watiSkipped: 0,
      campaignName: null,
      uploadedBy: null,
      results: [],
      invalidLines: analysis.invalid,
      detailLoaded: false,
      timeline: [],
      downloads: NO_DOWNLOADS,
      sends: [],
    };

    this.jobs.update((list) => [standIn, ...list]);
    this.runSaved.set({ yes: savedYes, no: saved.length - savedYes });
    this.feed.set([]);
    this.runStartedAt.set(startedAt);
    this.activeJobId.set(standIn.id);
    this.startClock();

    let upload;
    try {
      upload = await firstValueFrom(this.api.uploadList(analysis.file, { campaignId, forceRecheck: recheck }));
    } catch (error) {
      this.dropStandIn(standIn.id);
      throw new Error(apiErrorMessage(error, 'The file could not be uploaded. Please try again.'));
    }
    if (generation !== this.generation) {
      return { jobId: null, duplicate: false, notice: null };
    }

    // The same file was processed before: its job already holds the answers, so that job is shown
    // instead of paying for the same check again.
    if (upload.status === 'Duplicate' && upload.duplicateOfJobNumber) {
      this.dropStandIn(standIn.id);
      this.draft.set(null);
      await this.openJob(upload.duplicateOfJobNumber);
      return { jobId: upload.duplicateOfJobNumber, duplicate: true, notice: upload.message };
    }

    this.draft.set(null);
    this.patch(standIn.id, { reason: upload.message });
    if (upload.uploadReference) {
      void this.followUpload(standIn.id, upload.uploadReference, generation);
    }
    return { jobId: standIn.id, duplicate: false, notice: null };
  }

  /** Waits for the worker to turn an upload into a job, then follows that job. */
  private async followUpload(standInId: string, reference: string, generation: number): Promise<void> {
    const deadline = Date.now() + UPLOAD_FOLLOW_MS;

    while (generation === this.generation && Date.now() < deadline) {
      await delay(UPLOAD_POLL_MS);
      if (generation !== this.generation || !this.job(standInId)) {
        return;
      }

      let status;
      try {
        status = await firstValueFrom(this.api.uploadStatus(reference));
      } catch {
        continue; // a dropped request is simply asked again
      }

      if (status.status === 'Queued') {
        if (this.overview()?.workerOnline === false) {
          this.patch(standInId, { reason: 'The file is saved. The integration worker is not running right now; the check starts as soon as it is back.' });
        }
        continue;
      }

      if (status.status === 'Rejected' || !status.jobNumber) {
        // The worker refused the file (unreadable, no numbers in it, wrong organisation).
        this.patch(standInId, {
          status: 'failed', outcome: 'Failed', finishedAt: new Date().toISOString(),
          reason: status.reason ?? 'The file was not accepted by the integration worker.',
        });
        this.finishFollowing(standInId);
        return;
      }

      // Registered - or found to be a duplicate by the worker: either way there is a job to show.
      // The real job is loaded BEFORE the stand-in is removed, so the live view never has a moment
      // with nothing to draw.
      const wasActive = this.activeJobId() === standInId;
      await this.openJob(status.jobNumber);
      if (generation !== this.generation) {
        return;
      }
      const loaded = !!this.job(status.jobNumber);
      if (wasActive && loaded) {
        this.follow(status.jobNumber, this.runStartedAt());
      }
      this.dropStandIn(standInId, !loaded);
      return;
    }
  }

  /** Follows a job until it finishes, reading it again every few seconds. */
  private follow(jobId: string, startedAt: number): void {
    const generation = this.generation;
    this.runStartedAt.set(startedAt);
    this.activeJobId.set(jobId);
    this.startClock();

    const read = async (): Promise<void> => {
      while (generation === this.generation && this.activeJobId() === jobId) {
        try {
          const detail = await firstValueFrom(this.api.job(jobId));
          if (generation !== this.generation) {
            return;
          }
          this.mergeDetail(detail);

          const job = this.job(jobId);
          if (job && job.status !== 'running' && job.status !== 'queued') {
            await this.loadReport(jobId);
            const latest = this.job(jobId)?.results ?? [];
            this.feed.set(latest.slice(-7).reverse().map((r) => ({ number: r.number, whatsapp: r.whatsapp })));
            this.finishFollowing(jobId);
            void this.loadOverview();
            return;
          }
        } catch (error) {
          // 404: the job is gone (or belongs to somebody else). Anything else is asked again.
          if ((error as { status?: number })?.status === 404) {
            this.finishFollowing(jobId);
            return;
          }
        }
        await delay(JOB_POLL_MS);
      }
    };
    void read();
  }

  private finishFollowing(jobId: string): void {
    if (this.activeJobId() === jobId) {
      this.activeJobId.set(null);
    }
    this.stopClock();
  }

  /**
   * Asks the worker to pick a check up where it stopped. Nothing that already succeeded is repeated or
   * paid for again. Rejects with the worker's own reason when it turns the request down.
   */
  async resume(id: string): Promise<void> {
    if (this.activeJobId()) {
      return;
    }
    const accepted = await this.send(() => firstValueFrom(this.api.retryJob(id)), 'The check could not be retried.');
    await this.awaitCommand(accepted.reference, 'The integration worker has not picked the retry up yet. It will run as soon as the worker is back.');
    this.feed.set([]);
    this.runSaved.set({ yes: 0, no: 0 });
    this.follow(id, Date.now());
  }

  /** Asks the worker to stop a running job at its next safe point. Answers already received are kept. */
  async cancel(id: string): Promise<void> {
    await this.send(() => firstValueFrom(this.api.cancelJob(id)), 'The check could not be stopped.');
    this.patch(id, { reason: 'Stopping at the next safe point. Numbers already answered are kept.', canCancel: false });
  }

  job(id: string | null): CheckJob | null {
    return id ? this.jobs().find((j) => j.id === id) ?? null : null;
  }

  /** Makes sure a job, its timeline and its report are loaded - for the job's page and the report step. */
  async openJob(id: string): Promise<void> {
    const generation = this.generation;
    try {
      const detail = await firstValueFrom(this.api.job(id));
      if (generation !== this.generation) {
        return;
      }
      this.mergeDetail(detail);
      await this.loadReport(detail.job.jobNumber);
    } catch (error) {
      // A job that is not there is shown as "That job isn't here" by the page; anything else is said.
      if ((error as { status?: number })?.status !== 404 && generation === this.generation) {
        this.problem.set(apiErrorMessage(error, 'That check could not be loaded. Please try again.'));
      }
    }
  }

  private async loadReport(id: string): Promise<void> {
    const generation = this.generation;
    const [results, invalid] = await Promise.all([
      firstValueFrom(this.api.jobResults(id)),
      firstValueFrom(this.api.jobInvalidLines(id)),
    ]);
    if (generation !== this.generation) {
      return;
    }
    this.patch(id, { results: results.map(toResultRow), invalidLines: invalid, detailLoaded: true });
  }

  /** Downloads one of a job's files from the server and hands it to the browser. */
  async download(job: CheckJob, kind: JobFileKind): Promise<void> {
    const file = await this.send(() => firstValueFrom(this.api.jobFile(job.id, kind)), 'That file could not be downloaded.');
    saveFile(file.fileName, file.blob, file.blob.type || 'application/octet-stream');
  }

  private mergeJobs(items: readonly CheckJobDto[]): void {
    const previous = new Map(this.jobs().map((j) => [j.id, j] as const));
    const fromServer = items.map((dto) => toJob(dto, previous.get(dto.jobNumber)));
    // A stand-in for an upload the worker has not registered yet is not on the server; keep it.
    const standIns = this.jobs().filter((j) => !j.key);
    this.jobs.set([...standIns, ...fromServer]);
  }

  private mergeDetail(detail: CheckJobDetailDto): void {
    const previous = this.job(detail.job.jobNumber) ?? undefined;
    const job: CheckJob = {
      ...toJob(detail.job, previous),
      timeline: toTimeline(detail),
      downloads: {
        original: detail.downloads.original,
        submitted: detail.downloads.submitted,
        results: detail.downloads.results,
        raw: detail.downloads.raw,
        invalid: detail.downloads.invalid,
      },
      sends: (detail.sends ?? []).map((s) => ({
        id: s.id, reference: s.reference, name: s.name, templateName: s.templateName, status: s.status,
        createdAt: s.createdAtUtc, requestedBy: s.requestedByName ?? null,
        fromThisCheck: s.fromThisCheck, acceptedFromThisCheck: s.acceptedFromThisCheck,
      })),
    };
    this.jobs.update((list) =>
      list.some((j) => j.id === job.id) ? list.map((j) => (j.id === job.id ? job : j)) : [job, ...list],
    );
  }

  private dropStandIn(id: string, stopFollowing = true): void {
    this.jobs.update((list) => list.filter((j) => j.id !== id));
    if (stopFollowing && this.activeJobId() === id) {
      this.activeJobId.set(null);
      this.stopClock();
    }
  }

  private patch(id: string, change: Partial<CheckJob>): void {
    this.jobs.update((list) => list.map((j) => (j.id === id ? { ...j, ...change } : j)));
  }

  /** The elapsed-time figure on the live view counts up between reads of the job. */
  private startClock(): void {
    this.stopClock();
    this.now.set(Date.now());
    this.clockTimer = setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopClock(): void {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  // =========================================================================================== selection

  /**
   * Adds numbers to the selection, never beyond the per-send cap. Returns how many did not fit, so the
   * screen can say so instead of quietly dropping them.
   */
  select(numbers: readonly SelectedNumber[]): number {
    const cap = this.selectionCap();
    const next = new Map(this.selection());
    let leftOut = 0;
    for (const entry of numbers) {
      if (next.has(entry.number)) {
        next.set(entry.number, entry);
        continue;
      }
      if (cap > 0 && next.size >= cap) {
        leftOut++;
        continue;
      }
      next.set(entry.number, entry);
    }
    this.selection.set(next);
    return leftOut;
  }

  unselect(numbers: readonly string[]): void {
    const next = new Map(this.selection());
    for (const number of numbers) {
      next.delete(number);
    }
    this.selection.set(next);
  }

  clearSelection(): void {
    this.selection.set(new Map());
    const carried = this.fromGroup;
    this.fromGroup = null;
    this.composer.update((c) => ({
      ...c,
      groupId: null,
      groupName: null,
      campaignId: carried && c.campaignId === carried.campaignId ? carried.before.campaignId : c.campaignId,
      tags: carried && c.tags.join('\n') === carried.tags.join('\n') ? carried.before.tags : c.tags,
    }));
  }

  patchComposer(change: Partial<Composer>): void {
    this.composer.update((c) => ({ ...c, ...change }));
  }

  /**
   * Ties the selection to a recipient group (loaded, or just saved from it): a send made from it says so
   * in the send log, and the group's campaign and tags become the send's until the selection is cleared.
   */
  linkGroup(group: { id: string; name: string; campaignId?: string | null; tags: readonly string[] }): void {
    const current = this.composer();
    const before = this.fromGroup?.before ?? { campaignId: current.campaignId, tags: current.tags };
    const campaignId = group.campaignId ?? before.campaignId;
    const tags = group.tags.length > 0 ? group.tags : before.tags;
    this.fromGroup = { campaignId, tags, before };
    this.composer.update((c) => ({ ...c, groupId: group.id, groupName: group.name, campaignId, tags }));
  }

  /**
   * Starts a send from a recipient group: its members that are still on WhatsApp become the selection
   * (as many as one send may hold), and the group's campaign and tags carry over. Returns how many
   * reachable members did not fit under the cap.
   */
  async useGroup(groupId: string): Promise<{ selected: number; leftOut: number; name: string }> {
    const detail = await this.send(() => firstValueFrom(this.api.group(groupId)), 'That group could not be loaded.');
    const reachable = detail.members.filter((m) => m.reachable);
    this.selection.set(new Map());
    const leftOut = this.select(reachable.map((m) => ({
      number: m.number, jobId: m.sourceJobId ?? '', jobNumber: m.sourceJobNumber ?? '', contactName: m.contactName ?? null,
    })));
    this.linkGroup(detail.group);
    this.composeStep.set(1);
    return { selected: this.selection().size, leftOut, name: detail.group.name };
  }

  /** The send as the server wants it, from the selection and the composer. */
  sendRequest(template: WatiTemplate | null): SendBroadcastDto {
    const c = this.composer();
    return {
      templateName: template?.name ?? c.templateName,
      templateLabel: template?.label ?? null,
      broadcastName: c.broadcastName.trim(),
      values: { ...c.values },
      campaignId: c.campaignId,
      selection: this.selectionList().map((s) => ({ number: s.number, sourceJobId: s.jobId || null })),
      recipientGroupId: c.groupId,
      tags: [...c.tags],
      bindings: Object.entries(c.bindings).map(([name, source]) => ({ name, source })),
    };
  }

  // =========================================================================================== sending

  /**
   * Leaves the send for the worker and waits for it to be accepted.
   *
   * Resolves with the send's id (for the send log) once the worker has created it. The worker applies
   * its own safeguards first - the allow-list, the cap per send, "already sent this template" - and each
   * number it leaves out is recorded with the reason. The selection and composer are cleared once the
   * send is with the worker.
   */
  async sendSelection(template: WatiTemplate | null): Promise<{ broadcastId: string | null; notice: string | null }> {
    const accepted = await this.send(
      () => firstValueFrom(this.api.sendBroadcast(this.sendRequest(template))),
      'The send could not be queued.',
    );

    const outcome = await this.awaitCommand(
      accepted.reference,
      'The integration worker has not picked the send up yet. It will be sent as soon as the worker is back - look for it in the send log.',
      true,
    );

    this.selection.set(new Map());
    this.composer.update((c) => ({ ...EMPTY_COMPOSER, templateName: c.templateName, templateChosenByPerson: c.templateChosenByPerson, values: c.values }));
    this.fromGroup = null;
    this.composeStep.set(1);
    await this.loadWati(true);
    void this.loadOverview();
    this.broadcastNotice.set(outcome.message);
    return { broadcastId: outcome.entityId, notice: outcome.message };
  }

  /** Asks the worker to send a send's retryable failures again, and waits for it to accept. */
  async retrySend(id: string): Promise<string | null> {
    const accepted = await this.send(() => firstValueFrom(this.api.retryBroadcast(id)), 'The send could not be retried.');
    const outcome = await this.awaitCommand(accepted.reference, 'The integration worker has not picked the retry up yet. It will run as soon as the worker is back.', true);
    return outcome.message;
  }

  // =========================================================================================== requests

  /** Runs a call and turns a refusal into an Error holding a sentence for the person. */
  async send<T>(call: () => Promise<T>, fallback: string): Promise<T> {
    try {
      return await call();
    } catch (error) {
      throw new Error(apiErrorMessage(error, fallback));
    }
  }

  /**
   * Waits for the worker to carry out a request.
   *
   * Rejects with the worker's own reason when it refuses or fails the request. When the worker simply
   * has not answered in time, it rejects with `lateMessage` - unless `tolerateLate` is set, in which
   * case the request is still pending and will be carried out later, and that is said instead.
   */
  private async awaitCommand(
    reference: string, lateMessage: string, tolerateLate = false,
  ): Promise<{ entityId: string | null; message: string | null }> {
    const deadline = Date.now() + COMMAND_FOLLOW_MS;

    while (Date.now() < deadline) {
      await delay(COMMAND_POLL_MS);
      let command;
      try {
        command = await firstValueFrom(this.api.command(reference));
      } catch {
        continue;
      }
      if (command.status === 'Completed') {
        return { entityId: command.resultEntityId ?? null, message: command.resultMessage ?? null };
      }
      if (command.status === 'Rejected' || command.status === 'Failed') {
        throw new Error(command.resultMessage ?? 'The integration worker could not carry the request out.');
      }
    }

    if (tolerateLate) {
      return { entityId: null, message: lateMessage };
    }
    throw new Error(lateMessage);
  }
}

// ================================================================================================ helpers

/** A template body (or header) with its {{placeholders}} filled; an empty one stays visible. */
export function renderTemplate(template: WatiTemplate, values: Record<string, string>): string {
  return fill(template.body, values);
}

export function fill(text: string | null | undefined, values: Record<string, string>): string {
  return (text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => (values[key]?.trim() ? values[key].trim() : `{{${key}}}`));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toOverview(dto: WhatsAppOverviewDto): WhatsAppOverview {
  return {
    available: dto.integrationAvailable,
    workerOnline: dto.worker.online,
    workerLastSeen: dto.worker.lastHeartbeatAtUtc ?? null,
    checkNumberReady: dto.settings.checkNumberEnabled && dto.settings.checkNumberConfigured,
    watiReady: dto.settings.watiEnabled && dto.settings.watiConfigured && dto.settings.manualBroadcastsAllowed,
    pricePerNumber: dto.settings.pricePerNumber,
    minimumCharge: dto.settings.minimumChargePerTask,
    currency: dto.settings.currency || 'USD',
    maxRecipientsPerJob: dto.settings.maxRecipientsPerJob,
    maxRecipientsPerSend: dto.settings.maxRecipientsPerSend ?? 0,
    defaultTemplateName: dto.settings.defaultTemplateName ?? null,
    allowListActive: dto.settings.allowListActive,
    allowListSize: dto.settings.allowListSize,
    minimumNumbersPerTask: dto.settings.minimumNumbersPerTask ?? 1,
    billableMinimumNumbers: dto.settings.billableMinimumNumbers ?? 0,
    numbersVerified: dto.statistics.numbersVerified,
    onWhatsApp: dto.statistics.onWhatsApp,
    jobsRun: dto.statistics.jobsRun,
    messagesSent: dto.statistics.messagesSent,
    readRate: dto.statistics.readRatePercent,
  };
}

/** A job as the screens draw it. What only the detail call brings is carried over from `previous`. */
function toJob(dto: CheckJobDto, previous?: CheckJob): CheckJob {
  return {
    id: dto.jobNumber,
    key: dto.id,
    fileName: dto.fileName,
    fileSize: dto.fileSizeBytes,
    kind: (['txt', 'csv', 'xls', 'xlsx'].includes(dto.fileKind) ? dto.fileKind : 'txt') as FileKind,
    sheetCount: dto.sheetCount,
    status: dto.displayStatus,
    taskId: dto.taskId ?? '',
    createdAt: dto.createdAtUtc,
    finishedAt: dto.completedAtUtc ?? null,
    submitted: dto.submitted,
    total: dto.total,
    processed: dto.processed,
    yes: dto.yes,
    no: dto.no,
    unknown: dto.unknown,
    saved: dto.saved,
    duplicates: dto.duplicates,
    invalid: dto.invalid,
    estimatedCost: dto.estimatedCost ?? 0,
    actualCost: dto.actualCost ?? 0,
    currency: dto.currency ?? 'USD',
    outcome: dto.outcome,
    reason: dto.reason ?? '',
    errorCode: dto.errorCode ?? null,
    sharedToWati: dto.sharedToWati,
    hasErrors: dto.hasErrors,
    canRetry: dto.canRetry,
    canCancel: dto.canCancel,
    watiSent: dto.watiSent,
    watiFailed: dto.watiFailed,
    watiSkipped: dto.watiSkipped,
    campaignName: dto.campaignName ?? null,
    uploadedBy: dto.uploadedByName ?? null,
    results: previous?.results ?? [],
    invalidLines: previous?.invalidLines ?? [],
    detailLoaded: previous?.detailLoaded ?? false,
    timeline: previous?.timeline ?? [],
    downloads: previous?.downloads ?? NO_DOWNLOADS,
    sends: previous?.sends ?? [],
  };
}

function toResultRow(dto: CheckJobResultDto): ResultRow {
  return {
    number: dto.number, iso: dto.iso, country: dto.country, whatsapp: dto.whatsApp, note: dto.note, status: dto.status,
    contactName: dto.contactName ?? null, lastSend: dto.lastSendReference ?? null,
  };
}

/**
 * The job's timeline: the moments the page was designed to show, each with the REAL time from the
 * worker's own step log.
 *
 * A FEW, NOT EVERY STEP. The worker records up to a dozen steps per job (download, extraction, each
 * retry...), and they are all on the server for whoever needs them; the row under the job's facts
 * has room for a handful. So it shows when the file was read, when it went to CheckNumber.ai, when
 * the answers came back and that the numbers are ready to be picked - and how the job ended, if it
 * did not end well.
 */
function toTimeline(detail: CheckJobDetailDto): JobTimelineStep[] {
  // A step that was retried appears several times; the last attempt is the one that counted.
  const latest = new Map<string, JobTimelineDto>();
  for (const step of detail.timeline) {
    latest.set(step.stepCode, step);
  }
  const moment = (code: string, label: string): JobTimelineStep | null => {
    const step = latest.get(code);
    if (!step) return null;
    return {
      label,
      at: step.completedAtUtc ?? step.startedAtUtc,
      state: step.status === 'Failed' ? 'bad' : step.completedAtUtc ? 'done' : 'wait',
    };
  };

  const job = detail.job;
  const steps: JobTimelineStep[] = [
    moment('PARSE_FILE', 'File uploaded and read') ?? { label: 'File received', at: job.createdAtUtc, state: 'done' },
  ];

  const submitted = moment('CHECKNUMBER_CREATE_TASK', 'Submitted to CheckNumber.ai');
  if (submitted) {
    steps.push(submitted);
  } else if (job.saved > 0 && job.submitted === 0) {
    // Nothing was sent: every number already had a saved answer, which is the whole point of saving them.
    steps.push({ label: 'Answered from saved results — nothing to pay for', at: job.startedAtUtc ?? job.createdAtUtc, state: 'done' });
  }

  const received = moment('CHECKNUMBER_PROCESS_RESULTS', 'Results received') ?? moment('IDENTIFY_VERIFIED', 'WhatsApp numbers identified');
  if (received && submitted) {
    steps.push(received);
  }

  const wati = detail.wati;
  if (wati) {
    // An OLDER check that still messaged its numbers by itself.
    const figures = [`${wati.accepted.toLocaleString('en-IN')} sent`];
    if (wati.failed > 0) figures.push(`${wati.failed.toLocaleString('en-IN')} failed`);
    if (wati.skipped > 0) figures.push(`${wati.skipped.toLocaleString('en-IN')} skipped`);
    steps.push({
      label: `Automatic WhatsApp messages: ${figures.join(', ')}`,
      at: wati.completedAtUtc ?? null,
      state: wati.failed > 0 && wati.accepted === 0 ? 'bad' : wati.completedAtUtc ? 'done' : 'wait',
    });
  } else if (job.displayStatus === 'completed') {
    steps.push({
      label: job.yes > 0 ? `${job.yes.toLocaleString('en-IN')} valid numbers ready to pick for a message` : 'No number on WhatsApp',
      at: job.completedAtUtc ?? null,
      state: 'done',
    });
  }

  if (job.displayStatus === 'failed') {
    steps.push({ label: 'Failed', at: job.completedAtUtc ?? null, state: 'bad' });
  } else if (job.displayStatus === 'cancelled') {
    steps.push({ label: 'Stopped', at: job.completedAtUtc ?? null, state: 'bad' });
  } else if (job.displayStatus !== 'completed') {
    steps.push({ label: 'Waiting for results', at: null, state: 'wait' });
  }
  return steps;
}

function toTemplate(dto: WatiTemplateDto): WatiTemplate {
  return {
    name: dto.name,
    label: dto.label,
    category: dto.category,
    body: dto.body ?? '',
    variables: dto.variables,
    defaults: dto.defaults,
    headerFormat: dto.headerFormat ?? null,
    headerText: dto.headerText ?? null,
    mediaVariable: dto.mediaVariable ?? null,
    footer: dto.footer ?? null,
    buttons: dto.buttons ?? [],
  };
}

function toMessage(dto: WatiMessageDto): WatiMessage {
  return {
    id: dto.id,
    number: dto.number,
    iso: dto.iso,
    country: dto.country,
    whatsappCheck: dto.whatsAppCheck,
    templateLabel: dto.templateLabel,
    templateName: dto.templateName,
    broadcastId: dto.broadcastId,
    broadcastName: dto.broadcastName,
    // Skipped rows are filtered out before this is called, so only the report's six statuses remain.
    status: dto.status as WatiMessage['status'],
    values: dto.values ?? {},
    renderedText: dto.renderedText ?? '',
    createdAt: dto.createdAtUtc,
    sentAt: dto.sentAtUtc ?? null,
    deliveredAt: dto.deliveredAtUtc ?? null,
    readAt: dto.readAtUtc ?? null,
    repliedAt: dto.repliedAtUtc ?? null,
    failedCode: dto.failedCode ?? null,
    failedReason: dto.failedReason ?? null,
    replyText: dto.replyText ?? null,
    contactName: dto.contactName ?? null,
    sourceJob: dto.sourceJobNumber ?? null,
    checkNumberTask: dto.checkNumberTaskId ?? null,
  };
}
