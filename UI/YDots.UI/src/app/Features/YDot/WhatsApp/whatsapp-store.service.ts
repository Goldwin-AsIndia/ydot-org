import { Injectable, computed, signal } from '@angular/core';
import { checkFile, readFile } from './file-extract';
import { countryOf, scanRow } from './number-tools';
import {
  AlreadyChecked,
  CheckJob,
  DeliveryStatus,
  InvalidLine,
  RegistryEntry,
  ResultRow,
  SheetSummary,
  UploadAnalysis,
  UploadNumber,
  WaResult,
  WatiBroadcast,
  WatiMessage,
  WatiTemplate,
} from './whatsapp.models';
import { fnv } from './wa-format';

/**
 * CheckNumber -> Wati, held in the browser.
 *
 * NO BACKEND YET. Checking a number and sending a message are simulated here with the same shapes the real
 * services will return (task ids, per-number result and note, delivery statuses with failure codes), so the
 * screens can be built and exercised end to end. Swapping in the API later means replacing `tick()` and
 * `advanceMessages()`; the screens read only the signals below.
 *
 * THE REGISTRY IS THE DUPLICATE CHECK. Every number that has been answered Yes or No is remembered with its
 * result; the upload review looks numbers up there before anything is submitted, so a number is never paid
 * for twice. Every Yes is handed to Wati ("shared"), and that pool is what the Wati screen sends to.
 */

/** Placeholder price per number checked; unverified numbers are not charged. */
export const COST_PER_CHECK = 0.12;

export const WATI_TEMPLATES: readonly WatiTemplate[] = [
  {
    name: 'donation_thank_you_v2',
    label: 'Donation thank-you',
    category: 'Utility',
    body: 'Thank you, {{name}}! Your gift of ₹{{amount}} to {{campaign}} is already at work. We are grateful to have you with us.',
    variables: ['name', 'amount', 'campaign'],
    defaults: { name: 'Friend', amount: '1,000', campaign: 'Winter Relief' },
  },
  {
    name: 'receipt_ready_80g',
    label: '80G receipt ready',
    category: 'Utility',
    body: 'Hello {{name}}, your 80G receipt for ₹{{amount}} is ready. Download it here: {{link}}',
    variables: ['name', 'amount', 'link'],
    defaults: { name: 'Friend', amount: '1,000', link: 'https://ydot.org/r/receipt' },
  },
  {
    name: 'event_invite_2026',
    label: 'Event invitation',
    category: 'Marketing',
    body: 'Hi {{name}}, you are invited to {{event}} on {{date}} at {{venue}}. Reply YES to save your seat.',
    variables: ['name', 'event', 'date', 'venue'],
    defaults: { name: 'Friend', event: 'Annual Gratitude Evening', date: '14 Nov', venue: 'Hyderabad' },
  },
  {
    name: 'follow_up_checkin',
    label: 'Follow-up check-in',
    category: 'Marketing',
    body: 'Hi {{name}}, a quick check-in about {{campaign}}. Would you like to hear how your support is helping? Reply YES.',
    variables: ['name', 'campaign'],
    defaults: { name: 'Friend', campaign: 'Winter Relief' },
  },
];

const STORAGE_KEY = 'ydot.whatsapp.v1';

/** Failure codes the simulated Wati returns, in the shape of Meta's cloud API errors. */
const FAILURES: readonly { code: string; reason: string }[] = [
  { code: '131026', reason: 'Message undeliverable — the recipient cannot receive this message right now.' },
  { code: '131049', reason: 'Meta chose not to deliver this marketing message, to keep a healthy experience for the recipient.' },
  { code: '131048', reason: 'Spam rate limit hit — too many recent messages were reported or blocked.' },
];

const REPLIES = ['Thank you!', 'Yes, please', 'Received, thanks', 'Please call me', 'Sure 👍'];

interface Persisted {
  registry: Record<string, RegistryEntry>;
  jobs: CheckJob[];
  messages: WatiMessage[];
  broadcasts: WatiBroadcast[];
}

@Injectable({ providedIn: 'root' })
export class WhatsAppStore {
  readonly templates = WATI_TEMPLATES;

  readonly registry = signal<Record<string, RegistryEntry>>({});
  readonly jobs = signal<CheckJob[]>([]);
  readonly messages = signal<WatiMessage[]>([]);
  readonly broadcasts = signal<WatiBroadcast[]>([]);

  /** The upload being reviewed. Kept here so leaving the screen and coming back does not lose it. */
  readonly draft = signal<UploadAnalysis | null>(null);

  /** The job being checked right now, and the last few answers for the live ticker. */
  readonly activeJobId = signal<string | null>(null);
  readonly feed = signal<{ number: string; whatsapp: WaResult }[]>([]);
  readonly runStartedAt = signal<number>(0);
  readonly now = signal<number>(Date.now());

  readonly activeJob = computed(() => this.jobs().find((j) => j.id === this.activeJobId()) ?? null);

  /** Yes numbers that have been handed to Wati, newest check first. */
  readonly pool = computed(() =>
    Object.values(this.registry())
      .filter((e) => e.whatsapp === 'yes' && e.sharedToWati)
      .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)),
  );

  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private messageTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Numbers still to be sent to the provider, per running job. */
  private readonly pending = new Map<string, string[]>();

  constructor() {
    this.load();
    // A reload mid-run leaves the job "running" with nobody driving it; it resumes where it stopped.
    const stuck = this.jobs().find((j) => j.status === 'running' || j.status === 'queued');
    if (stuck) {
      this.resume(stuck.id);
    }
    this.ensureMessageClock();
  }

  // =========================================================================================== upload

  /** Reads a file and works out what it holds: numbers, duplicates, answers already known, bad lines. */
  async analyse(file: File): Promise<UploadAnalysis> {
    const kind = checkFile(file);
    const contents = await readFile(file, kind);
    const registry = this.registry();

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
          const known = registry[hit.e164];
          // A Yes or No is an answer worth reusing; Unknown means the provider could not tell, so it is checked again.
          if (known && known.whatsapp !== 'unknown') {
            sheetKnown++;
            alreadyChecked.push({
              ...base, result: known.whatsapp, checkedAt: known.checkedAt, sharedToWati: known.sharedToWati,
            });
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

  /** Creates the job for the reviewed upload and starts it. Returns the job id. */
  startJob(analysis: UploadAnalysis, recheck: boolean): string {
    const submit = [...analysis.fresh, ...(recheck ? analysis.alreadyChecked : [])];
    const saved: ResultRow[] = recheck
      ? []
      : analysis.alreadyChecked.map((k) => ({
          number: k.number, iso: k.iso, country: k.country, whatsapp: k.result,
          note: k.result === 'yes' ? 'Answered from an earlier check — not charged' : 'Answered from an earlier check — not registered on WhatsApp',
          status: 'saved' as const,
        }));

    const id = this.nextJobId();
    const estimated = round2(submit.length * COST_PER_CHECK);
    const job: CheckJob = {
      id,
      fileName: analysis.fileName,
      fileSize: analysis.fileSize,
      kind: analysis.kind,
      sheetCount: analysis.sheets.length,
      status: submit.length > 0 ? 'running' : 'completed',
      taskId: 'cn_' + randomHex(12),
      createdAt: new Date().toISOString(),
      finishedAt: null,
      submitted: submit.length,
      total: submit.length + saved.length,
      processed: 0,
      yes: saved.filter((r) => r.whatsapp === 'yes').length,
      no: saved.filter((r) => r.whatsapp === 'no').length,
      unknown: 0,
      saved: saved.length,
      duplicates: analysis.duplicates.length,
      invalid: analysis.invalid.length,
      estimatedCost: estimated,
      actualCost: 0,
      outcome: 'Pending',
      reason: submit.length > 0 ? 'Waiting for CheckNumber.ai to return results' : '',
      errorCode: null,
      sharedToWati: 0,
      results: [...saved],
      invalidLines: analysis.invalid,
      submittedNumbers: submit.map((s) => s.number),
      original: analysis.file,
    };

    this.jobs.update((list) => [job, ...list]);
    this.draft.set(null);

    if (submit.length === 0) {
      this.finish(id);
    } else {
      this.pending.set(id, [...job.submittedNumbers]);
      this.beginRun(id);
    }
    this.save();
    return id;
  }

  /** Picks a failed or stopped job up where it left off. */
  resume(id: string): void {
    const job = this.jobs().find((j) => j.id === id);
    if (!job || this.activeJobId()) {
      return;
    }
    const done = new Set(job.results.map((r) => r.number));
    this.pending.set(id, job.submittedNumbers.filter((n) => !done.has(n)));
    this.patch(id, { status: 'running', outcome: 'Pending', reason: 'Resumed — waiting for CheckNumber.ai to return results', errorCode: null, finishedAt: null, taskId: 'cn_' + randomHex(12) });
    this.beginRun(id);
  }

  cancel(id: string): void {
    if (this.activeJobId() !== id) {
      return;
    }
    this.stopTimer();
    this.activeJobId.set(null);
    this.pending.delete(id);
    this.patch(id, { status: 'cancelled', outcome: 'Cancelled', reason: 'Stopped before it finished. Numbers checked so far were kept.', finishedAt: new Date().toISOString() });
    this.commitToRegistry(id);
    this.save();
  }

  job(id: string | null): CheckJob | null {
    return id ? this.jobs().find((j) => j.id === id) ?? null : null;
  }

  private beginRun(id: string): void {
    this.activeJobId.set(id);
    this.feed.set([]);
    this.runStartedAt.set(Date.now());
    const total = this.pending.get(id)?.length ?? 0;
    // Long enough to watch, short enough not to be a wait: 3 to 24 seconds depending on the size.
    const durationMs = Math.min(24000, Math.max(3000, total * 9));
    const ticks = Math.max(1, Math.round(durationMs / 140));
    const batch = Math.max(1, Math.ceil(total / ticks));
    this.stopTimer();
    this.checkTimer = setInterval(() => this.tick(id, batch), 140);
  }

  private tick(id: string, batch: number): void {
    const queue = this.pending.get(id);
    const job = this.job(id);
    if (!queue || !job) {
      this.stopTimer();
      return;
    }
    this.now.set(Date.now());
    const take = queue.splice(0, batch);
    const rows: ResultRow[] = [];
    let yes = 0;
    let no = 0;
    let unknown = 0;
    for (const number of take) {
      const verdict = verdictFor(number);
      const country = countryOf(number);
      rows.push({
        number, iso: country.iso, country: country.name, whatsapp: verdict.whatsapp, note: verdict.note,
        status: verdict.whatsapp === 'unknown' ? 'unverified' : 'checked',
      });
      if (verdict.whatsapp === 'yes') yes++;
      else if (verdict.whatsapp === 'no') no++;
      else unknown++;
    }
    job.results.push(...rows);
    this.feed.set([...rows.slice(-6).reverse().map((r) => ({ number: r.number, whatsapp: r.whatsapp })), ...this.feed()].slice(0, 7));
    this.patch(id, {
      processed: job.processed + take.length,
      yes: job.yes + yes,
      no: job.no + no,
      unknown: job.unknown + unknown,
      actualCost: round2(job.actualCost + (yes + no) * COST_PER_CHECK),
    });

    if (queue.length === 0) {
      this.finish(id);
    }
  }

  private finish(id: string): void {
    this.stopTimer();
    this.pending.delete(id);
    if (this.activeJobId() === id) {
      this.activeJobId.set(null);
    }
    const job = this.job(id);
    if (!job) {
      return;
    }
    const parts = [`${count(job.submitted)} number${job.submitted === 1 ? '' : 's'} processed by CheckNumber.ai`];
    if (job.saved > 0) parts.push(`${count(job.saved)} answered from earlier checks`);
    if (job.unknown > 0) parts.push(`${count(job.unknown)} could not be verified and were not charged`);
    this.patch(id, {
      status: 'completed',
      outcome: 'Success',
      reason: parts.join(' · '),
      finishedAt: new Date().toISOString(),
    });
    const shared = this.commitToRegistry(id);
    this.patch(id, { sharedToWati: shared });
    this.save();
  }

  /** Writes the job's answers into the registry and hands every Yes to Wati. Returns how many Yes numbers were handed over. */
  private commitToRegistry(id: string): number {
    const job = this.job(id);
    if (!job) {
      return 0;
    }
    const next = { ...this.registry() };
    let shared = 0;
    for (const row of job.results) {
      if (row.status === 'saved') {
        const existing = next[row.number];
        if (existing && existing.whatsapp === 'yes' && !existing.sharedToWati) {
          next[row.number] = { ...existing, sharedToWati: true };
        }
        continue;
      }
      const yes = row.whatsapp === 'yes';
      next[row.number] = {
        number: row.number, iso: row.iso, country: row.country, whatsapp: row.whatsapp, note: row.note,
        checkedAt: job.finishedAt ?? new Date().toISOString(), jobId: job.id, sharedToWati: yes,
      };
      if (yes) shared++;
    }
    this.registry.set(next);
    return shared;
  }

  private patch(id: string, change: Partial<CheckJob>): void {
    this.jobs.update((list) => list.map((j) => (j.id === id ? { ...j, ...change } : j)));
  }

  private stopTimer(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  private nextJobId(): string {
    const stamp = jobStamp(new Date());
    const prefix = `CN-${stamp}-`;
    const highest = this.jobs()
      .filter((j) => j.id.startsWith(prefix))
      .reduce((max, j) => Math.max(max, Number(j.id.slice(prefix.length)) || 0), 0);
    return `${prefix}${String(highest + 1).padStart(4, '0')}`;
  }

  // =========================================================================================== wati

  /** Queues a broadcast: one message per number, each scripted to reach its own fate over the next seconds. */
  sendBroadcast(input: {
    name: string;
    template: WatiTemplate;
    values: Record<string, string>;
    numbers: readonly string[];
  }): string {
    const createdAt = new Date().toISOString();
    const broadcastId = 'bc_' + randomHex(8);
    const text = renderTemplate(input.template, input.values);
    const registry = this.registry();
    const base = Date.now();

    const messages: WatiMessage[] = input.numbers.map((number, index) => {
      const entry = registry[number];
      const country = countryOf(number);
      const r = fnv(number + broadcastId) % 100;
      const fate: WatiMessage['fate'] = r < 6 ? 'FAILED' : r < 28 ? 'DELIVERED' : r < 78 ? 'READ' : 'REPLIED';
      return {
        id: 'wm_' + randomHex(10),
        number,
        iso: country.iso,
        country: country.name,
        whatsappCheck: entry?.whatsapp ?? 'yes',
        templateLabel: input.template.label,
        templateName: input.template.name,
        broadcastId,
        broadcastName: input.name,
        status: 'PENDING',
        values: { ...input.values },
        renderedText: text,
        createdAt,
        sentAt: null, deliveredAt: null, readAt: null, repliedAt: null,
        failedCode: null, failedReason: null, replyText: null,
        nextAt: base + 500 + Math.min(index * 12, 6000) + (fnv(number) % 900),
        fate,
      };
    });

    this.broadcasts.update((list) => [
      { id: broadcastId, name: input.name, templateName: input.template.name, templateLabel: input.template.label, createdAt, recipients: messages.length },
      ...list,
    ]);
    this.messages.update((list) => [...messages, ...list]);
    this.ensureMessageClock();
    this.save();
    return broadcastId;
  }

  private ensureMessageClock(): void {
    const open = this.messages().some((m) => m.nextAt !== null);
    if (open && !this.messageTimer) {
      this.messageTimer = setInterval(() => this.advanceMessages(), 600);
    }
  }

  private advanceMessages(): void {
    const now = Date.now();
    let changed = false;
    const next = this.messages().map((m) => {
      if (m.nextAt === null) {
        return m;
      }
      if (m.nextAt > now) {
        return m;
      }
      changed = true;
      const stamp = new Date(now).toISOString();
      const h = fnv(m.id);
      switch (m.status) {
        case 'PENDING': {
          if (m.fate === 'FAILED') {
            const failure = FAILURES[h % FAILURES.length];
            return { ...m, status: 'FAILED' as DeliveryStatus, failedCode: failure.code, failedReason: failure.reason, nextAt: null };
          }
          return { ...m, status: 'SENT' as DeliveryStatus, sentAt: stamp, nextAt: now + 700 + (h % 2200) };
        }
        case 'SENT': {
          return { ...m, status: 'DELIVERED' as DeliveryStatus, deliveredAt: stamp, nextAt: m.fate === 'DELIVERED' ? null : now + 1500 + (h % 5000) };
        }
        case 'DELIVERED': {
          return { ...m, status: 'READ' as DeliveryStatus, readAt: stamp, nextAt: m.fate === 'REPLIED' ? now + 2500 + (h % 6000) : null };
        }
        case 'READ': {
          return { ...m, status: 'REPLIED' as DeliveryStatus, repliedAt: stamp, replyText: REPLIES[h % REPLIES.length], nextAt: null };
        }
        default:
          return { ...m, nextAt: null };
      }
    });

    if (changed) {
      this.messages.set(next);
      this.save();
    }
    const open = next.some((m) => m.nextAt !== null);
    if (!open && this.messageTimer) {
      clearInterval(this.messageTimer);
      this.messageTimer = null;
    }
  }

  // =========================================================================================== storage

  private load(): void {
    let data: Persisted | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      data = raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      data = null;
    }
    if (!data) {
      data = seedData();
    }
    this.registry.set(data.registry);
    this.jobs.set(data.jobs);
    this.messages.set(data.messages);
    this.broadcasts.set(data.broadcasts);
    // A job in flight keeps its provider queue only in memory; the rest of its numbers are worked out on resume.
  }

  save(): void {
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const payload: Persisted = {
        registry: this.registry(),
        jobs: this.jobs().map(({ original, ...rest }) => rest as CheckJob),
        messages: this.messages().slice(0, 20000),
        broadcasts: this.broadcasts(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Storage full or blocked: everything keeps working for this visit, it just is not remembered.
      }
    }, 600);
  }

  /** Wipes everything back to the starter data. */
  resetAll(): void {
    this.stopTimer();
    if (this.messageTimer) {
      clearInterval(this.messageTimer);
      this.messageTimer = null;
    }
    this.pending.clear();
    this.activeJobId.set(null);
    this.draft.set(null);
    const data = seedData();
    this.registry.set(data.registry);
    this.jobs.set(data.jobs);
    this.messages.set(data.messages);
    this.broadcasts.set(data.broadcasts);
    this.save();
  }
}

// ================================================================================================ helpers

export function renderTemplate(template: WatiTemplate, values: Record<string, string>): string {
  return template.body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => (values[key]?.trim() ? values[key].trim() : `{{${key}}}`));
}

function verdictFor(number: string): { whatsapp: WaResult; note: string } {
  const h = fnv(number);
  const r = h % 100;
  if (r < 68) {
    return { whatsapp: 'yes', note: (h >>> 8) % 6 === 0 ? 'WhatsApp Business account' : 'Active WhatsApp account' };
  }
  if (r < 91) {
    return { whatsapp: 'no', note: 'Not registered on WhatsApp' };
  }
  const notes = ['Lookup timed out — check again later', 'Carrier did not respond', 'Number type could not be confirmed'];
  return { whatsapp: 'unknown', note: notes[(h >>> 8) % notes.length] };
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

function jobStamp(d: Date): string {
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function count(value: number): string {
  return value.toLocaleString('en-IN');
}

// ================================================================================================ seed data

/** Starter data so the screens are not empty on first open: three past jobs and one finished broadcast. */
function seedData(): Persisted {
  const registry: Record<string, RegistryEntry> = {};
  const jobs: CheckJob[] = [];
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

  const makeNumbers = (seed: number, n: number): string[] => {
    const out: string[] = [];
    let x = seed;
    for (let i = 0; i < n; i++) {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      out.push('+91' + (6 + (x % 4)) + String(10_000_000 + ((x >>> 4) % 89_999_999)).slice(0, 8) + String((x >>> 9) % 10));
    }
    return out;
  };

  const build = (
    id: string, file: string, kind: CheckJob['kind'], sheets: number, size: number, ago: number, numbers: string[],
    options: { dup: number; invalid: number; failed?: boolean },
  ): CheckJob => {
    const rows: ResultRow[] = [];
    let yes = 0, no = 0, unknown = 0;
    const done = options.failed ? [] : numbers;
    for (const number of done) {
      const v = verdictFor(number);
      const c = countryOf(number);
      rows.push({ number, iso: c.iso, country: c.name, whatsapp: v.whatsapp, note: v.note, status: v.whatsapp === 'unknown' ? 'unverified' : 'checked' });
      if (v.whatsapp === 'yes') yes++; else if (v.whatsapp === 'no') no++; else unknown++;
    }
    const finishedAt = hoursAgo(ago - 0.05);
    const job: CheckJob = {
      id, fileName: file, fileSize: size, kind, sheetCount: sheets,
      status: options.failed ? 'failed' : 'completed',
      taskId: 'cn_' + randomHex(12),
      createdAt: hoursAgo(ago), finishedAt,
      submitted: numbers.length, total: numbers.length, processed: rows.length,
      yes, no, unknown, saved: 0, duplicates: options.dup, invalid: options.invalid,
      estimatedCost: round2(numbers.length * COST_PER_CHECK),
      actualCost: round2((yes + no) * COST_PER_CHECK),
      outcome: options.failed ? 'Failed' : 'Success',
      reason: options.failed
        ? 'CheckNumber.ai rejected the request: too many requests in the last minute. Nothing was charged — resume the job to try again.'
        : `${count(numbers.length)} numbers processed by CheckNumber.ai${unknown ? ` · ${unknown} could not be verified and were not charged` : ''}`,
      errorCode: options.failed ? 'HTTP 429 · RATE_LIMITED' : null,
      sharedToWati: yes,
      results: rows,
      invalidLines: Array.from({ length: options.invalid }, (_v, i) => ({
        sheet: sheets > 1 ? 'Sheet1' : kind === 'csv' ? 'CSV file' : 'Text file', line: 4 + i * 7,
        raw: i % 2 ? '98765 4321' : 'Not available', reason: i % 2 ? 'Too short (9 digits) and no country code' : 'No phone number found',
      })),
      submittedNumbers: numbers,
      sample: true,
    };
    if (!options.failed) {
      for (const r of rows) {
        registry[r.number] = {
          number: r.number, iso: r.iso, country: r.country, whatsapp: r.whatsapp, note: r.note,
          checkedAt: finishedAt, jobId: id, sharedToWati: r.whatsapp === 'yes',
        };
      }
    }
    return job;
  };

  const a = makeNumbers(11, 148);
  const b = makeNumbers(23, 60);
  const c = makeNumbers(37, 42);
  const idFor = (ago: number, seq: number) => `CN-${jobStamp(new Date(Date.now() - ago * 3600_000))}-${String(seq).padStart(4, '0')}`;
  jobs.push(
    build(idFor(3, 3), 'regional-leads.csv', 'csv', 1, 3400, 3, b, { dup: 2, invalid: 1, failed: true }),
    build(idFor(26, 2), 'event-guests.txt', 'txt', 1, 1100, 26, c, { dup: 0, invalid: 0 }),
    build(idFor(52, 1), 'donor-list-september.xlsx', 'xlsx', 3, 48200, 52, a, { dup: 9, invalid: 3 }),
  );

  // One broadcast already delivered, so the delivery report has something to read on first open.
  const messages: WatiMessage[] = [];
  const template = WATI_TEMPLATES[0];
  const values = { ...template.defaults };
  const broadcastId = 'bc_sample01';
  const text = renderTemplate(template, values);
  const yesNumbers = a.filter((n) => registry[n]?.whatsapp === 'yes').slice(0, 36);
  yesNumbers.forEach((number, i) => {
    const h = fnv(number + broadcastId);
    const r = h % 100;
    const fate: WatiMessage['fate'] = r < 8 ? 'FAILED' : r < 30 ? 'DELIVERED' : r < 75 ? 'READ' : 'REPLIED';
    const sent = Date.now() - 20 * 3600_000 + i * 4000;
    const iso = (offset: number) => new Date(sent + offset).toISOString();
    const c2 = countryOf(number);
    const failure = FAILURES[h % FAILURES.length];
    messages.push({
      id: 'wm_seed' + i, number, iso: c2.iso, country: c2.name, whatsappCheck: 'yes',
      templateLabel: template.label, templateName: template.name, broadcastId, broadcastName: 'September thank-you',
      status: fate, values, renderedText: text, createdAt: iso(0),
      sentAt: fate === 'FAILED' ? null : iso(900),
      deliveredAt: fate === 'FAILED' ? null : iso(2400 + (h % 3000)),
      readAt: fate === 'READ' || fate === 'REPLIED' ? iso(60_000 + (h % 900_000)) : null,
      repliedAt: fate === 'REPLIED' ? iso(120_000 + (h % 1_200_000)) : null,
      failedCode: fate === 'FAILED' ? failure.code : null,
      failedReason: fate === 'FAILED' ? failure.reason : null,
      replyText: fate === 'REPLIED' ? REPLIES[h % REPLIES.length] : null,
      nextAt: null, fate,
    });
  });
  const broadcasts: WatiBroadcast[] = [{
    id: broadcastId, name: 'September thank-you', templateName: template.name, templateLabel: template.label,
    createdAt: new Date(Date.now() - 20 * 3600_000).toISOString(), recipients: messages.length,
  }];

  return { registry, jobs, messages, broadcasts };
}
