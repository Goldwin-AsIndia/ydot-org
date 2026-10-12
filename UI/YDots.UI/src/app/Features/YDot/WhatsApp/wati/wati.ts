import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PopupComponent } from '../../../../Shared/components/popup/popup';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { WaPagerComponent } from '../wa-pager/wa-pager';
import { WaOption, WaSelectComponent } from '../wa-select/wa-select';
import { WhatsAppStore, renderTemplate } from '../whatsapp-store.service';
import { DeliveryStatus, RegistryEntry, WatiMessage, WatiTemplate } from '../whatsapp.models';
import { count, localDateTime, localDateTimeFull, localDay, localTime, saveFile, timeZoneLabel, toCsv } from '../wa-format';

type View = 'send' | 'report';
type StatusFilter = 'all' | DeliveryStatus;

const STATUSES: readonly DeliveryStatus[] = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'REPLIED', 'FAILED'];
const STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Pending', SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', REPLIED: 'Replied', FAILED: 'Failed',
};

/** What the composer shows until the template list has arrived from the server. */
const NO_TEMPLATE: WatiTemplate = { name: '', label: '', category: '', body: '', variables: [], defaults: {} };

interface PreviewPart {
  readonly text: string;
  readonly variable: string | null;
  readonly filled: boolean;
}

/**
 * Wati: send a template message to the numbers CheckNumber found on WhatsApp, then follow it to the reader.
 *
 * Two views by route: the composer (recipients, template, broadcast name, template values, live preview)
 * and the delivered-and-read report (status per message, with a detail drawer on row click).
 *
 * NOTHING IS SENT FROM THE BROWSER. "Send now" leaves a request for the YDot.Integration worker, which
 * applies its own safeguards (its allow-list, its cap on recipients per broadcast, "this template was
 * already sent to this number") and then calls WATI. What it did - and why it left anybody out - is
 * what the report shows.
 */
@Component({
  selector: 'app-wati',
  imports: [RouterLink, PopupComponent, WaPagerComponent, WaSelectComponent],
  templateUrl: './wati.html',
  styleUrls: ['../wa-shared.css', './wati.css'],
})
export class WatiComponent {
  protected readonly store = inject(WhatsAppStore);
  private readonly tokens = inject(AuthTokenService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** Whose name the recipient sees at the top of the chat: the organisation the person is signed in to. */
  protected readonly organisationName = computed(() => this.tokens.organisationName() || 'Your organisation');

  protected readonly n = count;
  protected readonly dt = localDateTime;
  protected readonly dtFull = localDateTimeFull;
  protected readonly clock = localTime;
  protected readonly day = localDay;
  protected readonly zone = timeZoneLabel();
  protected readonly statuses = STATUSES;
  protected readonly statusLabel = STATUS_LABEL;

  protected readonly view = signal<View>((this.route.snapshot.data['view'] as View) ?? 'send');
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  // ------------------------------------------------------------------ composer
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly pickQuery = signal('');
  protected readonly pickSource = signal<string>('all');
  protected readonly pickPage = signal(1);
  protected readonly pickSize = signal(25);

  protected readonly templateName = signal('');
  /** Set once the person picks a template, so the default never overrides their choice. */
  private templateChosenByPerson = false;
  protected readonly values = signal<Record<string, string>>({});
  protected readonly broadcastName = signal('');
  protected readonly confirming = signal(false);
  protected readonly touched = signal(false);
  /** True while the broadcast is on its way to the worker. */
  protected readonly sending = signal(false);
  /** Why the last broadcast was not accepted, in the worker's or the server's own words. */
  protected readonly sendProblem = signal<string | null>(null);
  /**
   * What the worker said about the broadcast just sent (how many it will send, how many it left out).
   * Kept in the store, because sending opens the report - a new copy of this component.
   */
  protected readonly sendNotice = this.store.broadcastNotice;
  /** Messages WATI accepted, across every broadcast - an attempt it refused was not "sent". */
  protected readonly messagesSent = computed(() => this.store.overview()?.messagesSent ?? 0);
  /** True until the first answer for this screen has arrived. */
  protected readonly loadingWati = signal(true);

  protected readonly template = computed(() => {
    const templates = this.store.templates();
    return templates.find((t) => t.name === this.templateName()) ?? templates[0] ?? NO_TEMPLATE;
  });

  /** The worker's own limits, said before anything is sent so the report holds no surprises. */
  protected readonly safeguards = computed(() => {
    const o = this.store.overview();
    if (!o) return '';
    const parts: string[] = [];
    if (o.allowListActive) parts.push(`only the ${o.allowListSize.toLocaleString('en-IN')} allow-listed ${o.allowListSize === 1 ? 'number is' : 'numbers are'} messaged`);
    if (o.maxRecipientsPerJob > 0) parts.push(`at most ${o.maxRecipientsPerJob.toLocaleString('en-IN')} per broadcast`);
    return parts.length > 0 ? `Worker safeguards: ${parts.join(', ')}. Anyone left out is recorded as skipped, with the reason.` : '';
  });

  /** Where each number came from: one entry per CheckNumber job that handed numbers over. */
  protected readonly batches = computed(() => {
    const groups = new Map<string, { jobId: string; file: string; total: number; at: string; ids: string[] }>();
    for (const e of this.store.pool()) {
      let g = groups.get(e.jobId);
      if (!g) {
        g = { jobId: e.jobId, file: e.fileName || e.jobId, total: 0, at: e.checkedAt, ids: [] };
        groups.set(e.jobId, g);
      }
      g.total++;
      g.ids.push(e.number);
    }
    const picked = this.selected();
    return [...groups.values()].map((g) => ({ ...g, chosen: g.ids.filter((id) => picked.has(id)).length }));
  });

  protected readonly sourceOptions = computed<WaOption[]>(() => [
    { value: 'all', label: 'All checks', hint: `${this.store.pool().length.toLocaleString('en-IN')} numbers` },
    ...this.batches().map((b) => ({ value: b.jobId, label: b.file, hint: `${b.total.toLocaleString('en-IN')} numbers` })),
  ]);
  protected readonly broadcastOptions = computed<WaOption[]>(() => [
    { value: 'all', label: 'All broadcasts' },
    ...this.store.broadcasts().map((b) => ({ value: b.id, label: b.name, hint: `${b.recipients.toLocaleString('en-IN')} recipients` })),
  ]);
  protected readonly templateOptions = computed<WaOption[]>(() => [
    { value: 'all', label: 'All templates' },
    ...this.store.templates().map((x) => ({ value: x.name, label: x.label, hint: x.name })),
  ]);

  protected readonly pickRows = computed<RegistryEntry[]>(() => {
    const source = this.pickSource();
    const q = this.pickQuery().replace(/[\s-]/g, '').toLowerCase();
    return this.store.pool().filter(
      (e) => (source === 'all' || e.jobId === source) && (!q || e.number.includes(q) || e.country.toLowerCase().includes(q)),
    );
  });
  protected readonly pickSlice = computed(() => {
    const size = this.pickSize();
    const start = (this.pickPage() - 1) * size;
    return this.pickRows().slice(start, start + size);
  });
  protected readonly pageAllChosen = computed(() => {
    const slice = this.pickSlice();
    const picked = this.selected();
    return slice.length > 0 && slice.every((e) => picked.has(e.number));
  });
  protected readonly matchingChosen = computed(() => {
    const picked = this.selected();
    return this.pickRows().filter((e) => picked.has(e.number)).length;
  });

  protected readonly preview = computed<PreviewPart[]>(() => {
    const t = this.template();
    const values = this.values();
    const parts: PreviewPart[] = [];
    const re = /\{\{(\w+)\}\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t.body)) !== null) {
      if (m.index > last) parts.push({ text: t.body.slice(last, m.index), variable: null, filled: true });
      const value = values[m[1]]?.trim();
      parts.push({ text: value || `{{${m[1]}}}`, variable: m[1], filled: !!value });
      last = m.index + m[0].length;
    }
    if (last < t.body.length) parts.push({ text: t.body.slice(last), variable: null, filled: true });
    return parts;
  });
  protected readonly previewText = computed(() => renderTemplate(this.template(), this.values()));
  protected readonly missingValues = computed(() => this.template().variables.filter((v) => !this.values()[v]?.trim()));
  protected readonly suggestion = computed(() => {
    const d = new Date();
    return `${this.template().label} · ${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}`;
  });
  protected readonly nameProblem = computed(() => {
    const name = this.broadcastName().trim();
    if (!name) return 'Give this broadcast a name so you can find it in the report.';
    if (name.length < 3) return 'Use at least 3 characters.';
    return null;
  });
  protected readonly blockers = computed(() => {
    const out: string[] = [];
    if (!this.template().name) out.push('Choose a template');
    if (this.store.overview()?.watiReady === false) out.push('WATI sending is switched off or not configured on the integration worker');
    if (this.selected().size === 0) out.push('Choose at least one recipient');
    if (this.nameProblem()) out.push('Name the broadcast');
    if (this.missingValues().length > 0) out.push(`Fill ${this.missingValues().length} template ${this.missingValues().length === 1 ? 'value' : 'values'}`);
    return out;
  });

  // ------------------------------------------------------------------ report
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly broadcastFilter = signal<string>('all');
  protected readonly templateFilter = signal<string>('all');
  protected readonly reportQuery = signal('');
  protected readonly reportPage = signal(1);
  protected readonly reportSize = signal(25);
  protected readonly detailId = signal<string | null>(null);

  /** Messages inside the broadcast and template filters, before the status filter: what the figures count. */
  protected readonly scoped = computed(() => {
    const b = this.broadcastFilter();
    const t = this.templateFilter();
    return this.store.messages().filter((m) => (b === 'all' || m.broadcastId === b) && (t === 'all' || m.templateName === t));
  });
  protected readonly counts = computed(() => {
    const out: Record<StatusFilter, number> = { all: 0, PENDING: 0, SENT: 0, DELIVERED: 0, READ: 0, REPLIED: 0, FAILED: 0 };
    for (const m of this.scoped()) {
      out.all++;
      out[m.status]++;
    }
    return out;
  });
  protected readonly rates = computed(() => {
    const c = this.counts();
    const reached = c.DELIVERED + c.READ + c.REPLIED;
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
    return {
      delivered: pct(reached, c.all),
      read: pct(c.READ + c.REPLIED, reached),
      replied: pct(c.REPLIED, c.READ + c.REPLIED),
      failed: pct(c.FAILED, c.all),
    };
  });
  /** Cumulative stages: a read message was also delivered and sent, so each stage includes the ones after it. */
  protected readonly funnel = computed(() => {
    const c = this.counts();
    const total = c.all;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
    const sent = c.SENT + c.DELIVERED + c.READ + c.REPLIED;
    const delivered = c.DELIVERED + c.READ + c.REPLIED;
    const read = c.READ + c.REPLIED;
    return [
      { key: 'sent', label: 'Sent', glyph: 'ph-paper-plane-tilt', count: sent, pct: pct(sent) },
      { key: 'delivered', label: 'Delivered', glyph: 'ph-checks', count: delivered, pct: pct(delivered) },
      { key: 'read', label: 'Read', glyph: 'ph-eye', count: read, pct: pct(read) },
      { key: 'replied', label: 'Replied', glyph: 'ph-chat-circle-dots', count: c.REPLIED, pct: pct(c.REPLIED) },
    ];
  });
  /** Across every broadcast: how many delivered messages were read. */
  protected readonly readRate = computed(() => {
    let delivered = 0;
    let read = 0;
    for (const m of this.store.messages()) {
      if (m.deliveredAt) delivered++;
      if (m.readAt || m.repliedAt) read++;
    }
    return delivered > 0 ? Math.round((read / delivered) * 100) : 0;
  });
  /** A message WATI has accepted but not yet handed to WhatsApp can still change; the report is read again meanwhile. */
  protected readonly live = computed(() => this.scoped().some((m) => m.status === 'PENDING'));
  protected readonly reportRows = computed(() => {
    const status = this.statusFilter();
    const q = this.reportQuery().replace(/[\s-]/g, '').toLowerCase();
    return this.scoped().filter(
      (m) => (status === 'all' || m.status === status) && (!q || m.number.includes(q) || m.broadcastName.toLowerCase().includes(q) || m.templateName.includes(q)),
    );
  });
  protected readonly reportSlice = computed(() => {
    const size = this.reportSize();
    const start = (this.reportPage() - 1) * size;
    return this.reportRows().slice(start, start + size);
  });
  protected readonly detail = computed(() => this.store.messages().find((m) => m.id === this.detailId()) ?? null);
  protected readonly journey = computed(() => {
    const m = this.detail();
    if (!m) return [];
    const steps: { label: string; at: string | null; state: 'done' | 'bad' | 'wait' }[] = [
      { label: 'Queued in Wati', at: m.createdAt, state: 'done' },
    ];
    if (m.status === 'FAILED') {
      steps.push({ label: 'Failed', at: null, state: 'bad' });
      return steps;
    }
    steps.push({ label: 'Sent to WhatsApp', at: m.sentAt, state: m.sentAt ? 'done' : 'wait' });
    steps.push({ label: 'Delivered to the phone', at: m.deliveredAt, state: m.deliveredAt ? 'done' : 'wait' });
    steps.push({ label: 'Read by the recipient', at: m.readAt, state: m.readAt ? 'done' : 'wait' });
    steps.push({ label: 'Replied', at: m.repliedAt, state: m.repliedAt ? 'done' : 'wait' });
    return steps;
  });

  constructor() {
    effect(() => { this.pickQuery(); this.pickSource(); untracked(() => this.pickPage.set(1)); });
    effect(() => { this.statusFilter(); this.broadcastFilter(); this.templateFilter(); this.reportQuery(); untracked(() => this.reportPage.set(1)); });

    effect(() => {
      const b = this.query().get('broadcast');
      if (b) untracked(() => { this.broadcastFilter.set(b); this.statusFilter.set('all'); });
    });

    // THE WORKER'S DEFAULT TEMPLATE IS PRE-SELECTED - the one an automatic send after a check uses
    // (Wati:DefaultTemplateName) - rather than whichever comes first alphabetically. It wins until the
    // person picks a template themselves; if the chosen one is withdrawn, the choice falls back again.
    effect(() => {
      const templates = this.store.templates();
      const preferred = this.store.overview()?.defaultTemplateName ?? null;
      untracked(() => {
        if (templates.length === 0) return;
        const current = templates.find((t) => t.name === this.templateName());
        if (current && this.templateChosenByPerson) return;
        const choice = templates.find((t) => t.name === preferred) ?? current ?? templates[0];
        if (choice.name !== this.templateName()) {
          this.templateName.set(choice.name);
          this.values.set({ ...choice.defaults });
        }
      });
    });

    // Each time the screen is opened it reads the server again; while the report is on screen it keeps
    // doing so, because delivery and read receipts arrive over minutes, not seconds.
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((d) => {
      const view = (d['view'] as View) ?? 'send';
      this.view.set(view);
      void this.store.loadWati(true).finally(() => this.loadingWati.set(false));
      this.store.watchReport(view === 'report');
      // The note about a broadcast belongs to the report it opened; composing the next one clears it.
      if (view === 'send') {
        this.store.broadcastNotice.set(null);
      }
    });
    this.destroyRef.onDestroy(() => this.store.watchReport(false));
  }

  // ================================================================== composer actions

  protected isChosen(number: string): boolean {
    return this.selected().has(number);
  }

  protected toggle(number: string): void {
    const next = new Set(this.selected());
    if (!next.delete(number)) next.add(number);
    this.selected.set(next);
  }

  protected togglePage(): void {
    const next = new Set(this.selected());
    const all = this.pageAllChosen();
    for (const e of this.pickSlice()) {
      if (all) next.delete(e.number);
      else next.add(e.number);
    }
    this.selected.set(next);
  }

  protected selectMatching(): void {
    const next = new Set(this.selected());
    for (const e of this.pickRows()) next.add(e.number);
    this.selected.set(next);
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected toggleBatch(batch: { ids: string[]; total: number; chosen: number }): void {
    const next = new Set(this.selected());
    const full = batch.chosen === batch.total;
    for (const id of batch.ids) {
      if (full) next.delete(id);
      else next.add(id);
    }
    this.selected.set(next);
  }

  protected pickTemplate(name: string): void {
    const t = this.store.templates().find((x) => x.name === name);
    if (!t) return;
    this.templateChosenByPerson = true;
    this.templateName.set(name);
    // Keep what was already typed for variables the new template shares; fill the rest with its defaults.
    const old = this.values();
    this.values.set(Object.fromEntries(t.variables.map((v) => [v, old[v] ?? t.defaults[v] ?? ''])));
  }

  protected setValue(key: string, value: string): void {
    this.values.update((v) => ({ ...v, [key]: value }));
  }

  protected review(): void {
    this.touched.set(true);
    this.sendProblem.set(null);
    if (this.blockers().length === 0) this.confirming.set(true);
  }

  /** Leaves the broadcast for the worker, waits for it to be accepted, then opens its report. */
  protected async send(): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    this.sendProblem.set(null);
    this.sendNotice.set(null);
    try {
      const outcome = await this.store.sendBroadcast({
        name: this.broadcastName().trim(),
        template: this.template(),
        values: this.values(),
        numbers: [...this.selected()],
      });
      this.confirming.set(false);
      this.selected.set(new Set());
      this.broadcastName.set('');
      this.touched.set(false);
      void this.router.navigate(
        ['/app/whatsapp/wati/report'],
        outcome.broadcastId ? { queryParams: { broadcast: outcome.broadcastId } } : {},
      );
    } catch (error) {
      // The pop-up stays open with the reason, so the person can go back and change what was refused.
      this.sendProblem.set(error instanceof Error ? error.message : 'The broadcast could not be sent.');
    } finally {
      this.sending.set(false);
    }
  }

  // ================================================================== report actions

  protected setStatus(s: StatusFilter): void {
    this.statusFilter.set(s);
  }

  protected open(m: WatiMessage): void {
    this.detailId.set(m.id);
  }

  protected isRead(m: WatiMessage): boolean {
    return !!(m.readAt || m.repliedAt);
  }

  protected readLabel(m: WatiMessage): string {
    if (m.status === 'FAILED') return '—';
    return this.isRead(m) ? 'Read' : 'Not yet';
  }

  protected statusKeys(m: WatiMessage): string[] {
    return Object.keys(m.values);
  }

  protected tag(variable: string): string {
    return '{{' + variable + '}}';
  }

  /** The text as it was sent: what the worker recorded, or - for an older row without it - the template filled in. */
  protected rendered(m: WatiMessage): string {
    if (m.renderedText) return m.renderedText;
    const template = this.store.templates().find((t) => t.name === m.templateName);
    return template ? renderTemplate(template, m.values) : '';
  }

  protected exportCsv(): void {
    const rows = this.reportRows();
    saveFile(
      `wati-delivery-report-${new Date().toISOString().slice(0, 10)}.csv`,
      '﻿' + toCsv(
        ['Number', 'WhatsApp check', 'Template', 'TemplateName', 'Broadcast', 'Status', 'Sent', 'Delivered', 'Read', 'Replied', 'Read?', 'FailedCode', 'FailedReason'],
        rows.map((m) => [
          m.number, m.whatsappCheck === 'yes' ? 'Yes' : m.whatsappCheck === 'no' ? 'No' : 'Unknown', m.templateLabel, m.templateName, m.broadcastName,
          m.status, localDateTimeFull(m.sentAt), localDateTimeFull(m.deliveredAt), localDateTimeFull(m.readAt), localDateTimeFull(m.repliedAt),
          this.readLabel(m), m.failedCode ?? '', m.failedReason ?? '',
        ]),
      ),
      'text/csv;charset=utf-8',
    );
  }
}
