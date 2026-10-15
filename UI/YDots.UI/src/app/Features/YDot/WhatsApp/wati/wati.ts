import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, firstValueFrom } from 'rxjs';
import { CampaignApiService } from '../../../../Service/campaign-api.service';
import {
  SendReviewDto,
  SendReviewRecipientDto,
  WatiRecipientDto,
  WatiRecipientFacetsDto,
  WatiRecipientFilterDto,
  WhatsAppApiService,
  WhatsAppGroupDto,
} from '../../../../Service/whatsapp-api.service';
import { PopupComponent } from '../../../../Shared/components/popup/popup';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { WaPagerComponent } from '../wa-pager/wa-pager';
import { WaOption, WaSelectComponent } from '../wa-select/wa-select';
import { WatiHeadComponent } from '../wati-head/wati-head';
import { WhatsAppStore, fill, renderTemplate } from '../whatsapp-store.service';
import { DeliveryStatus, SelectedNumber, WatiMessage, WatiTemplate } from '../whatsapp.models';
import { count, localDateTime, localDateTimeFull, localDay, localTime, saveFile, timeZoneLabel, toCsv } from '../wa-format';

type View = 'send' | 'report';
type StatusFilter = 'all' | DeliveryStatus;
type ReviewFilter = 'all' | 'send' | 'skip' | 'exclude';

const STATUSES: readonly DeliveryStatus[] = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'REPLIED', 'FAILED'];
const STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Pending', SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', REPLIED: 'Replied', FAILED: 'Failed',
};

/** What the composer shows until the template list has arrived from the server. */
const NO_TEMPLATE: WatiTemplate = {
  name: '', label: '', category: '', body: '', variables: [], defaults: {}, headerFormat: null, headerText: null,
  mediaVariable: null, footer: null, buttons: [],
};

/** The "everything" choice of the pool's pickers. */
const ALL = 'all';
const NO_CAMPAIGN = 'none';
/** Where a template value comes from: typed once for everybody, or the recipient's own. */
const VALUE_SOURCES: readonly WaOption[] = [
  { value: 'value', label: 'Typed value', hint: 'The same for every recipient' },
  { value: 'contactName', label: 'Name from the file', hint: 'Each recipient\'s own name' },
  { value: 'phoneNumber', label: 'Recipient\'s number', hint: '+91XXXXXXXXXX' },
];

interface PreviewPart {
  readonly text: string;
  readonly variable: string | null;
  readonly filled: boolean;
}

/**
 * WhatsApp Messages: pick the people to message from the numbers CheckNumber validated, fill a template,
 * review what will happen, send - then follow every message to the reader.
 *
 * THE SEND VIEW IS THREE STEPS. 01 numbers: the validated pool, filtered and paged on the server, picked
 * one by one, a page at a time or "all that match", never beyond what one send may hold - and kept as a
 * tagged group if wanted. 02 template: the template, each value typed or taken from the recipient (their
 * name from the file), the send's name, campaign and tags, beside a phone preview that can show the
 * message as any selected recipient will read it. 03 review: the server applies the worker's rules and
 * shows, number by number, who will be messaged and who left out and why; only then can it be sent.
 *
 * NOTHING IS SENT FROM THE BROWSER. "Send" leaves a request for the YDot.Integration worker, which applies
 * its safeguards again and calls WATI. What it did - and why it left anybody out - is in the send log.
 *
 * The report view is the delivered-and-read report: status per message, with a detail drawer.
 */
@Component({
  selector: 'app-wati',
  imports: [RouterLink, PopupComponent, WaPagerComponent, WaSelectComponent, WatiHeadComponent],
  templateUrl: './wati.html',
  styleUrls: ['../wa-shared.css', './wati.css'],
})
export class WatiComponent {
  protected readonly store = inject(WhatsAppStore);
  private readonly api = inject(WhatsAppApiService);
  private readonly campaigns = inject(CampaignApiService);
  private readonly tokens = inject(AuthTokenService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  /** Whose name the recipient sees at the top of the chat: the organisation the person is signed in to. */
  protected readonly organisationName = computed(() => this.tokens.organisationName() || 'Your organisation');
  /** Sending, saving a group and adding to one cost money or change something: cam.whatsapp.operate. */
  protected readonly canOperate = computed(() => this.tokens.hasPermission('cam.whatsapp.operate'));

  protected readonly n = count;
  protected readonly dt = localDateTime;
  protected readonly dtFull = localDateTimeFull;
  protected readonly clock = localTime;
  protected readonly day = localDay;
  protected readonly zone = timeZoneLabel();
  protected readonly statuses = STATUSES;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly valueSources = VALUE_SOURCES;

  protected readonly view = signal<View>((this.route.snapshot.data['view'] as View) ?? 'send');
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly step = this.store.composeStep;
  protected readonly composer = this.store.composer;
  protected readonly cap = this.store.selectionCap;
  protected readonly selectedCount = computed(() => this.store.selection().size);
  /** Something worth saying about the selection that is not a failure ("3 numbers did not fit"). */
  protected readonly selectionNotice = signal<string | null>(null);
  protected readonly selectionProblem = signal<string | null>(null);

  // ================================================================== 01 · numbers (the pool)

  protected readonly search = signal('');
  private readonly searchInput = new Subject<string>();
  protected readonly jobFilter = signal<string>(ALL);
  protected readonly countryFilter = signal<string>(ALL);
  protected readonly groupFilter = signal<string>(ALL);
  protected readonly tagFilter = signal<string>(ALL);
  protected readonly historyFilter = signal<string>('any');
  protected readonly page = signal(1);
  protected readonly pageSize = signal(25);

  protected readonly rows = signal<WatiRecipientDto[]>([]);
  protected readonly total = signal(0);
  protected readonly facets = signal<WatiRecipientFacetsDto | null>(null);
  protected readonly loadingRows = signal(true);
  private poolRequest = 0;

  protected readonly jobOptions = computed<WaOption[]>(() => [
    { value: ALL, label: 'All checks', hint: `${this.n(this.facets()?.poolSize ?? 0)} numbers` },
    ...(this.facets()?.jobs ?? []).map((j) => ({ value: j.id, label: j.fileName || j.jobNumber, hint: `${j.jobNumber} · ${this.n(j.count)} numbers` })),
  ]);
  protected readonly countryOptions = computed<WaOption[]>(() => [
    { value: ALL, label: 'All countries' },
    ...(this.facets()?.countries ?? []).map((c) => ({ value: c.iso || ALL, label: c.name || 'Unknown', hint: `${this.n(c.count)} numbers` })),
  ]);
  protected readonly groupOptions = computed<WaOption[]>(() => [
    { value: ALL, label: 'All groups' },
    ...(this.facets()?.groups ?? []).map((g) => ({ value: g.id, label: g.name, hint: `${this.n(g.count)} on WhatsApp` })),
  ]);
  protected readonly tagOptions = computed<WaOption[]>(() => [
    { value: ALL, label: 'All tags' },
    ...(this.facets()?.tags ?? []).map((t) => ({ value: t.tag, label: t.tag, hint: `${this.n(t.count)} numbers` })),
  ]);
  protected readonly historyOptions = computed<WaOption[]>(() =>
    (this.facets()?.histories ?? []).map((h) => ({ value: h.value, label: h.label, hint: `${this.n(h.count)} numbers` })));
  protected readonly hasGroups = computed(() => (this.facets()?.groups.length ?? 0) > 0);
  protected readonly hasTags = computed(() => (this.facets()?.tags.length ?? 0) > 0);

  protected readonly filtered = computed(() =>
    !!this.search().trim() || this.jobFilter() !== ALL || this.countryFilter() !== ALL || this.groupFilter() !== ALL
    || this.tagFilter() !== ALL || this.historyFilter() !== 'any');
  protected readonly pageAllChosen = computed(() => {
    const picked = this.store.selection();
    const rows = this.rows();
    return rows.length > 0 && rows.every((r) => picked.has(r.number));
  });
  /** Room left in this send. */
  protected readonly room = computed(() => (this.cap() > 0 ? Math.max(0, this.cap() - this.selectedCount()) : this.total()));

  // ------------------------------------------------------------------ groups (save the pick, add to one)
  protected readonly groups = signal<WhatsAppGroupDto[]>([]);
  protected readonly editableGroups = computed(() => this.groups().filter((g) => g.permittedActions.includes('edit')));
  protected readonly groupPickOptions = computed<WaOption[]>(() =>
    this.editableGroups().map((g) => ({ value: g.id, label: g.name, hint: `${this.n(g.memberCount)} numbers` })));
  protected readonly campaignOptions = signal<WaOption[]>([{ value: NO_CAMPAIGN, label: 'No campaign' }]);

  protected readonly saveOpen = signal(false);
  protected readonly saveName = signal('');
  protected readonly saveDescription = signal('');
  protected readonly saveCampaign = signal<string>(NO_CAMPAIGN);
  protected readonly saveTags = signal('');
  protected readonly addOpen = signal(false);
  protected readonly addGroupId = signal<string>('');
  protected readonly groupBusy = signal(false);
  protected readonly groupProblem = signal<string | null>(null);

  // ================================================================== 02 · template

  protected readonly template = computed(() => {
    const templates = this.store.templates();
    return templates.find((t) => t.name === this.composer().templateName) ?? templates[0] ?? NO_TEMPLATE;
  });
  protected readonly tagsText = signal('');
  /** The selected number the preview is shown as; empty = the first one. */
  protected readonly previewAs = signal('');
  protected readonly previewRecipient = computed<SelectedNumber | null>(() => {
    const list = this.store.selectionList();
    return list.find((s) => s.number === this.previewAs()) ?? list[0] ?? null;
  });
  protected readonly previewAsOptions = computed<WaOption[]>(() =>
    this.store.selectionList().slice(0, 200).map((s) => ({ value: s.number, label: s.contactName || s.number, hint: s.contactName ? s.number : s.jobNumber })));

  /** The values as the previewed recipient will get them: bound parameters filled from them. */
  protected readonly personalValues = computed<Record<string, string>>(() => {
    const c = this.composer();
    const values: Record<string, string> = { ...c.values };
    const who = this.previewRecipient();
    for (const [name, source] of Object.entries(c.bindings)) {
      const own = source === 'contactName' ? who?.contactName : source === 'phoneNumber' ? who?.number : null;
      if (own?.trim()) values[name] = own.trim();
    }
    return values;
  });
  protected readonly preview = computed<PreviewPart[]>(() => {
    const body = this.template().body;
    const values = this.personalValues();
    const parts: PreviewPart[] = [];
    const re = /\{\{\s*([\w.-]+)\s*\}\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      if (m.index > last) parts.push({ text: body.slice(last, m.index), variable: null, filled: true });
      const value = values[m[1]]?.trim();
      parts.push({ text: value || `{{${m[1]}}}`, variable: m[1], filled: !!value });
      last = m.index + m[0].length;
    }
    if (last < body.length) parts.push({ text: body.slice(last), variable: null, filled: true });
    return parts;
  });
  protected readonly headerText = computed(() => (this.template().headerText ? fill(this.template().headerText, this.personalValues()) : ''));
  /** The header picture, when the template has one and its value is a link to it. */
  protected readonly mediaUrl = computed(() => {
    const variable = this.template().mediaVariable;
    const value = variable ? this.personalValues()[variable]?.trim() : '';
    return value && /^https?:\/\//i.test(value) ? value : '';
  });
  protected readonly mediaBroken = signal(false);
  protected readonly suggestion = computed(() => {
    const d = new Date();
    return `${this.template().label} · ${d.getDate()} ${d.toLocaleString('en-IN', { month: 'short' })}`;
  });
  protected readonly nameProblem = computed(() => {
    const name = this.composer().broadcastName.trim();
    if (!name) return 'Give this send a name so you can find it in the send log.';
    if (name.length < 3) return 'Use at least 3 characters.';
    return null;
  });
  protected readonly touched = signal(false);
  /** Values neither typed nor taken from the recipient. */
  protected readonly missingValues = computed(() => {
    const c = this.composer();
    return this.template().variables.filter((v) => !c.bindings[v] && !c.values[v]?.trim());
  });

  // ================================================================== 03 · review and send

  protected readonly review = signal<SendReviewDto | null>(null);
  protected readonly reviewing = signal(false);
  protected readonly reviewProblem = signal<string | null>(null);
  protected readonly reviewFilter = signal<ReviewFilter>('all');
  protected readonly reviewPage = signal(1);
  protected readonly reviewSize = signal(25);
  protected readonly reviewRows = computed<SendReviewRecipientDto[]>(() => {
    const f = this.reviewFilter();
    return (this.review()?.recipients ?? []).filter((r) => f === 'all' || r.outcome === f);
  });
  protected readonly reviewSlice = computed(() => {
    const start = (this.reviewPage() - 1) * this.reviewSize();
    return this.reviewRows().slice(start, start + this.reviewSize());
  });
  protected readonly reasons = computed(() =>
    Object.entries(this.review()?.summary.byReason ?? {}).map(([code, total]) => ({ code, total })));
  protected readonly canSend = computed(() => {
    const r = this.review();
    return !!r && this.canOperate() && r.summary.problems.length === 0 && r.summary.willSend > 0;
  });
  protected readonly confirming = signal(false);
  protected readonly sending = signal(false);
  protected readonly sendProblem = signal<string | null>(null);

  // ================================================================== report

  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly broadcastFilter = signal<string>('all');
  protected readonly templateFilter = signal<string>('all');
  protected readonly reportQuery = signal('');
  protected readonly reportPage = signal(1);
  protected readonly reportSize = signal(25);
  protected readonly detailId = signal<string | null>(null);
  protected readonly loadingWati = signal(true);
  protected readonly readRate = computed(() => this.store.overview()?.readRate ?? 0);

  protected readonly broadcastOptions = computed<WaOption[]>(() => [
    { value: 'all', label: 'All sends' },
    ...this.store.broadcasts().map((b) => ({ value: b.id, label: b.name, hint: `${b.recipients.toLocaleString('en-IN')} recipients` })),
  ]);
  protected readonly templateOptions = computed<WaOption[]>(() => [
    { value: 'all', label: 'All templates' },
    ...this.store.templates().map((x) => ({ value: x.name, label: x.label, hint: x.name })),
  ]);
  /** Messages inside the send and template filters, before the status filter: what the figures count. */
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
    return { delivered: pct(reached, c.all), read: pct(c.READ + c.REPLIED, reached), replied: pct(c.REPLIED, c.READ + c.REPLIED), failed: pct(c.FAILED, c.all) };
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
  /** A message WATI has accepted but not yet handed to WhatsApp can still change; the report is read again meanwhile. */
  protected readonly live = computed(() => this.scoped().some((m) => m.status === 'PENDING'));
  protected readonly reportRows = computed(() => {
    const status = this.statusFilter();
    // Numbers are matched without their spaces and dashes ("98765 43210"); names and sends as typed,
    // so "White cane appeal" or "Asha Menon" is found too.
    const text = this.reportQuery().trim().toLowerCase();
    const digits = text.replace(/[\s-]/g, '');
    return this.scoped().filter(
      (m) => (status === 'all' || m.status === status)
        && (!text || m.number.includes(digits) || m.broadcastName.toLowerCase().includes(text)
          || m.templateName.toLowerCase().includes(text) || (m.contactName ?? '').toLowerCase().includes(text)),
    );
  });
  protected readonly reportSlice = computed(() => {
    const start = (this.reportPage() - 1) * this.reportSize();
    return this.reportRows().slice(start, start + this.reportSize());
  });
  protected readonly detail = computed(() => this.store.messages().find((m) => m.id === this.detailId()) ?? null);
  protected readonly journey = computed(() => {
    const m = this.detail();
    if (!m) return [];
    const steps: { label: string; at: string | null; state: 'done' | 'bad' | 'wait' }[] = [{ label: 'Queued in Wati', at: m.createdAt, state: 'done' }];
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
    // The search box waits for a pause in typing before it asks the server.
    this.searchInput.pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef)).subscribe((text) => this.search.set(text));

    // A change of filter starts again at page 1; a change of page or filter reads the pool again.
    effect(() => {
      this.search(); this.jobFilter(); this.countryFilter(); this.groupFilter(); this.tagFilter(); this.historyFilter();
      untracked(() => this.page.set(1));
    });
    effect(() => {
      const filter = this.filterDto();
      untracked(() => {
        if (this.view() === 'send') void this.loadPool(filter);
      });
    });

    effect(() => { this.statusFilter(); this.broadcastFilter(); this.templateFilter(); this.reportQuery(); untracked(() => this.reportPage.set(1)); });
    effect(() => { this.reviewFilter(); untracked(() => this.reviewPage.set(1)); });

    // Arriving from a check's page ("Choose numbers to message") or a group: the pool opens filtered to it.
    effect(() => {
      const params = this.query();
      const job = params.get('job');
      const group = params.get('group');
      const broadcast = params.get('broadcast');
      untracked(() => {
        if (job) { this.jobFilter.set(job); this.step.set(1); }
        if (group) { this.groupFilter.set(group); this.step.set(1); }
        if (broadcast) { this.broadcastFilter.set(broadcast); this.statusFilter.set('all'); }
      });
    });

    // THE WORKER'S DEFAULT TEMPLATE IS PRE-SELECTED (Wati:DefaultTemplateName) rather than whichever comes
    // first alphabetically. It wins until the person picks a template themselves.
    effect(() => {
      const templates = this.store.templates();
      const preferred = this.store.overview()?.defaultTemplateName ?? null;
      untracked(() => {
        if (templates.length === 0) return;
        const c = this.composer();
        const current = templates.find((t) => t.name === c.templateName);
        if (current && c.templateChosenByPerson) return;
        const choice = templates.find((t) => t.name === preferred) ?? current ?? templates[0];
        if (choice.name !== c.templateName) {
          this.store.patchComposer({ templateName: choice.name, values: { ...choice.defaults }, bindings: this.defaultBindings(choice) });
        }
      });
    });

    // The tags box shows what the composer holds (a group's tags carry over when a group is used).
    effect(() => {
      const tags = this.composer().tags;
      untracked(() => {
        if (this.tagsList(this.tagsText()).join('|') !== tags.join('|')) this.tagsText.set(tags.join(', '));
      });
    });

    // Each time the screen is opened it reads the server again; while the report is on screen it keeps
    // doing so, because delivery and read receipts arrive over minutes, not seconds.
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((d) => {
      const view = (d['view'] as View) ?? 'send';
      this.view.set(view);
      void this.store.loadWati(true).finally(() => this.loadingWati.set(false));
      void this.store.loadOverview();
      this.store.watchReport(view === 'report');
      // The pool itself is read by the filter effect above, which also runs once on opening.
      if (view === 'send') {
        void this.loadGroups();
      }
    });
    this.destroyRef.onDestroy(() => this.store.watchReport(false));

    // The campaigns a send - or a group - can be tied to. Without them the picker offers "No campaign".
    this.campaigns.lookupCampaigns().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => this.campaignOptions.set([
        { value: NO_CAMPAIGN, label: 'No campaign', hint: 'Not tied to a campaign' },
        ...list.map((c) => ({ value: c.id, label: c.name, hint: c.code })),
      ]),
      error: () => undefined,
    });
  }

  // ================================================================== 01 · numbers

  private filterDto(): WatiRecipientFilterDto {
    return {
      page: this.page(),
      pageSize: this.pageSize(),
      search: this.search().trim() || null,
      jobId: this.jobFilter() === ALL ? null : this.jobFilter(),
      country: this.countryFilter() === ALL ? null : this.countryFilter(),
      groupId: this.groupFilter() === ALL ? null : this.groupFilter(),
      tag: this.tagFilter() === ALL ? null : this.tagFilter(),
      history: this.historyFilter() === 'any' ? null : this.historyFilter(),
    };
  }

  private async loadPool(filter: WatiRecipientFilterDto): Promise<void> {
    const request = ++this.poolRequest;
    this.loadingRows.set(true);
    try {
      const answer = await firstValueFrom(this.api.recipients(filter));
      if (request !== this.poolRequest) return;
      this.rows.set(answer.results.items);
      this.total.set(answer.results.totalCount);
      this.facets.set(answer.facets);
      this.selectionProblem.set(null);
    } catch (error) {
      if (request === this.poolRequest) this.selectionProblem.set(apiErrorMessage(error, 'The numbers could not be loaded. Please try again.'));
    } finally {
      if (request === this.poolRequest) this.loadingRows.set(false);
    }
  }

  private async loadGroups(): Promise<void> {
    try {
      this.groups.set(await firstValueFrom(this.api.groups()));
    } catch {
      this.groups.set([]);
    }
  }

  protected onSearch(text: string): void {
    this.searchInput.next(text);
  }

  protected clearFilters(): void {
    this.search.set('');
    this.jobFilter.set(ALL);
    this.countryFilter.set(ALL);
    this.groupFilter.set(ALL);
    this.tagFilter.set(ALL);
    this.historyFilter.set('any');
  }

  protected isChosen(number: string): boolean {
    return this.store.selection().has(number);
  }

  protected toggle(row: WatiRecipientDto): void {
    this.selectionNotice.set(null);
    if (this.isChosen(row.number)) {
      this.store.unselect([row.number]);
      return;
    }
    const leftOut = this.store.select([this.asSelected(row)]);
    if (leftOut > 0) this.selectionNotice.set(this.capNotice());
  }

  protected togglePage(): void {
    this.selectionNotice.set(null);
    if (this.pageAllChosen()) {
      this.store.unselect(this.rows().map((r) => r.number));
      return;
    }
    const leftOut = this.store.select(this.rows().map((r) => this.asSelected(r)));
    if (leftOut > 0) this.selectionNotice.set(this.capNotice());
  }

  /** "Select all that match": the server hands the matching numbers back, never more than fit in this send. */
  protected async selectMatching(): Promise<void> {
    this.selectionNotice.set(null);
    this.selectionProblem.set(null);
    try {
      const answer = await firstValueFrom(this.api.matchingRecipients(this.filterDto(), this.room()));
      this.store.select(answer.recipients.map((r) => ({ number: r.number, jobId: r.jobId, jobNumber: r.jobNumber, contactName: r.contactName ?? null })));
      if (answer.totalMatching > answer.recipients.length) {
        this.selectionNotice.set(`${this.n(answer.recipients.length)} of the ${this.n(answer.totalMatching)} matching numbers were added - one send holds at most ${this.n(this.cap())}.`);
      }
    } catch (error) {
      this.selectionProblem.set(apiErrorMessage(error, 'The matching numbers could not be selected.'));
    }
  }

  protected clearSelection(): void {
    this.selectionNotice.set(null);
    this.store.clearSelection();
  }

  protected remove(number: string): void {
    this.store.unselect([number]);
  }

  private asSelected(row: WatiRecipientDto): SelectedNumber {
    return { number: row.number, jobId: row.jobId, jobNumber: row.jobNumber, contactName: row.contactName ?? null };
  }

  private capNotice(): string {
    return `One send holds at most ${this.n(this.cap())} numbers, so the rest were not added. Send these first, or remove some.`;
  }

  // ------------------------------------------------------------------ groups

  protected openSave(): void {
    this.groupProblem.set(null);
    this.saveName.set('');
    this.saveDescription.set('');
    this.saveCampaign.set(this.composer().campaignId ?? NO_CAMPAIGN);
    this.saveTags.set(this.composer().tags.join(', '));
    this.saveOpen.set(true);
  }

  protected async saveGroup(): Promise<void> {
    if (this.groupBusy()) return;
    this.groupBusy.set(true);
    this.groupProblem.set(null);
    try {
      const answer = await this.store.send(() => firstValueFrom(this.api.createGroup({
        name: this.saveName().trim(),
        description: this.saveDescription().trim() || null,
        campaignId: this.saveCampaign() === NO_CAMPAIGN ? null : this.saveCampaign(),
        tags: this.tagsList(this.saveTags()),
        members: this.store.selectionList().map((s) => ({ number: s.number, sourceJobId: s.jobId || null })),
      })), 'The group could not be saved.');
      // The selection is now that group: a send made from it says so in the send log.
      this.store.linkGroup({
        id: answer.groupId,
        name: this.saveName().trim(),
        campaignId: this.saveCampaign() === NO_CAMPAIGN ? null : this.saveCampaign(),
        tags: this.tagsList(this.saveTags()),
      });
      this.saveOpen.set(false);
      this.selectionNotice.set(answer.message);
      void this.loadGroups();
      void this.loadPool(this.filterDto());
    } catch (error) {
      this.groupProblem.set(error instanceof Error ? error.message : 'The group could not be saved.');
    } finally {
      this.groupBusy.set(false);
    }
  }

  protected openAdd(): void {
    this.groupProblem.set(null);
    this.addGroupId.set(this.editableGroups()[0]?.id ?? '');
    this.addOpen.set(true);
  }

  protected async addToGroup(): Promise<void> {
    if (this.groupBusy() || !this.addGroupId()) return;
    this.groupBusy.set(true);
    this.groupProblem.set(null);
    try {
      const answer = await this.store.send(() => firstValueFrom(this.api.addGroupMembers(
        this.addGroupId(),
        this.store.selectionList().map((s) => ({ number: s.number, sourceJobId: s.jobId || null })),
      )), 'The numbers could not be added to the group.');
      this.addOpen.set(false);
      this.selectionNotice.set(answer.message);
      void this.loadGroups();
      void this.loadPool(this.filterDto());
    } catch (error) {
      this.groupProblem.set(error instanceof Error ? error.message : 'The numbers could not be added to the group.');
    } finally {
      this.groupBusy.set(false);
    }
  }

  protected campaignName(id: string | null): string {
    return this.campaignOptions().find((c) => c.value === id)?.label ?? '';
  }

  // ================================================================== 02 · template

  protected goTo(step: 1 | 2 | 3): void {
    if (step === 3) {
      this.touched.set(true);
      void this.runReview();
    }
    this.step.set(step);
  }

  protected pickTemplate(name: string): void {
    const t = this.store.templates().find((x) => x.name === name);
    if (!t) return;
    const c = this.composer();
    // Keep what was already typed for variables the new template shares; fill the rest with its defaults.
    this.store.patchComposer({
      templateName: name,
      templateChosenByPerson: true,
      values: Object.fromEntries(t.variables.map((v) => [v, c.values[v] ?? t.defaults[v] ?? ''])),
      bindings: Object.fromEntries(t.variables.filter((v) => c.bindings[v]).map((v) => [v, c.bindings[v]])),
    });
    if (!Object.keys(this.composer().bindings).length) {
      this.store.patchComposer({ bindings: this.defaultBindings(t) });
    }
    this.mediaBroken.set(false);
  }

  /** A parameter called "name" (or "donor_name"...) is filled from each recipient's name unless the person says otherwise. */
  private defaultBindings(t: WatiTemplate): Record<string, string> {
    const named = t.variables.find((v) => /(^|_)(name|first_?name|donor_?name|full_?name)$/i.test(v));
    return named ? { [named]: 'contactName' } : {};
  }

  protected setValue(key: string, value: string): void {
    this.store.patchComposer({ values: { ...this.composer().values, [key]: value } });
    if (key === this.template().mediaVariable) this.mediaBroken.set(false);
  }

  protected sourceOf(variable: string): string {
    return this.composer().bindings[variable] ?? 'value';
  }

  protected setSource(variable: string, source: string): void {
    const bindings = { ...this.composer().bindings };
    if (source === 'value') delete bindings[variable];
    else bindings[variable] = source;
    this.store.patchComposer({ bindings });
  }

  protected setName(name: string): void {
    this.store.patchComposer({ broadcastName: name });
  }

  protected setCampaign(id: string): void {
    this.store.patchComposer({ campaignId: id === NO_CAMPAIGN ? null : id });
  }

  protected setTags(text: string): void {
    this.tagsText.set(text);
    this.store.patchComposer({ tags: this.tagsList(text) });
  }

  protected tagsList(text: string): string[] {
    const seen = new Set<string>();
    return text.split(',').map((t) => t.trim()).filter((t) => t.length > 0)
      .map((t) => (t.length > 40 ? t.slice(0, 40) : t))
      .filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)))
      .slice(0, 10);
  }

  protected tag(variable: string): string {
    return '{{' + variable + '}}';
  }

  // ================================================================== 03 · review and send

  protected async runReview(): Promise<void> {
    this.reviewing.set(true);
    this.reviewProblem.set(null);
    this.sendProblem.set(null);
    try {
      const request = this.store.sendRequest(this.template().name ? this.template() : null);
      this.review.set(await firstValueFrom(this.api.reviewSend(request)));
      this.reviewFilter.set('all');
    } catch (error) {
      this.review.set(null);
      this.reviewProblem.set(apiErrorMessage(error, 'The send could not be reviewed. Please try again.'));
    } finally {
      this.reviewing.set(false);
    }
  }

  protected outcomeLabel(r: SendReviewRecipientDto): string {
    return r.outcome === 'send' ? 'Will be sent' : r.outcome === 'skip' ? 'Skipped' : 'Left out';
  }

  protected reviewCount(filter: ReviewFilter): number {
    const s = this.review()?.summary;
    if (!s) return 0;
    return filter === 'all' ? s.selected : filter === 'send' ? s.willSend : filter === 'skip' ? s.willSkip : s.excluded;
  }

  /** Leaves the send for the worker, waits for it to be accepted, then opens it in the send log. */
  protected async send(): Promise<void> {
    if (this.sending()) return;
    this.sending.set(true);
    this.sendProblem.set(null);
    try {
      const outcome = await this.store.sendSelection(this.template());
      this.confirming.set(false);
      this.review.set(null);
      this.touched.set(false);
      void this.router.navigate(['/app/whatsapp/wati/send-log'], outcome.broadcastId ? { queryParams: { send: outcome.broadcastId } } : {});
    } catch (error) {
      // The pop-up stays open with the reason, so the person can go back and change what was refused.
      this.sendProblem.set(error instanceof Error ? error.message : 'The send could not be queued.');
    } finally {
      this.sending.set(false);
    }
  }

  // ================================================================== report

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

  /** The text as it was sent: what the server rendered from the send's own copy of the template, or - for an older row - the template filled in. */
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
        ['Number', 'Name', 'WhatsApp check', 'From check', 'CheckNumber task', 'Template', 'TemplateName', 'Send', 'Status', 'Sent', 'Delivered', 'Read', 'Replied', 'Read?', 'FailedCode', 'FailedReason'],
        rows.map((m) => [
          m.number, m.contactName ?? '', m.whatsappCheck === 'yes' ? 'Yes' : m.whatsappCheck === 'no' ? 'No' : 'Unknown', m.sourceJob ?? '', m.checkNumberTask ?? '',
          m.templateLabel, m.templateName, m.broadcastName, m.status, localDateTimeFull(m.sentAt), localDateTimeFull(m.deliveredAt),
          localDateTimeFull(m.readAt), localDateTimeFull(m.repliedAt), this.readLabel(m), m.failedCode ?? '', m.failedReason ?? '',
        ]),
      ),
      'text/csv;charset=utf-8',
    );
  }
}
