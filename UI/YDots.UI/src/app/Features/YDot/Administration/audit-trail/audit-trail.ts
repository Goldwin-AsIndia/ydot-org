import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  afterRenderEffect,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { AuditSearchFilter, IamAdminApiService } from '../../../../Service/iam-admin-api.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { AuditEventResponse, AuditSummaryResponse } from '../../../../Shared/models/iam-contract.model';
import { apiEnumValue } from '../../../../Shared/models/enum-option.model';
import { supportReference, withoutGuids } from '../../../../Shared/models/identifier';
import { ClickOutsideDirective } from '../../../../Shared/directives/click-outside';
import { SupportReferencePipe } from '../../../../Shared/pipes/support-reference.pipe';
import { ReadableIdPipe } from '../../../../Shared/pipes/readable-id.pipe';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { EnumOptionsService } from '../../../../Shared/services/enum-options.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

declare var ApexCharts: any;

/**
 * The rows fetched per request for the Recent Activity list - the server's ceiling. The cards,
 * donut and heatmap do NOT come from these rows any more: they are counted by the server over
 * every matching event (`/audit-events/summary`).
 */
const LIST_PAGE_SIZE = 100;
const INITIAL_VISIBLE = 5;
const LOAD_MORE_STEP = 5;

/**
 * A metadata property name as words: `previousTenantId` -> "Previous organisation",
 * `roleIds` -> "Roles", `managerUserId` -> "Manager".
 *
 * The "Id" goes because the value beside it is now a name, and "tenant" becomes "organisation"
 * because that is the word every screen uses for it.
 */
function humaniseKey(key: string): string {
  const plural = /Ids$/.test(key);
  let stem = key.replace(/Ids?$/, '');

  if (stem.length > 4 && /User$/.test(stem)) {
    stem = stem.slice(0, -4);
  }

  let words = (stem || key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+ids?\b/g, '')
    .replace(/\btenant\b/g, 'organisation')
    .replace(/\btenants\b/g, 'organisations');

  if (plural && !words.endsWith('s')) {
    words += 's';
  }

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A machine word as words: `ViewedSensitiveContact` -> "Viewed sensitive contact". Only values made
 * of three or more capitalised parts are touched, so names ("McDonald") and codes stay as written.
 */
function readableWord(value: string): string {
  if (!/^(?:[A-Z][a-z]+){3,}$/.test(value)) {
    return value;
  }
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A line in the Record type / Outcome picker. */
interface ComboOption {
  value: string;
  label: string;
  context: string;
  /** Replaces the initial in the round mark (used for the "All …" line). */
  glyph?: string;
  /** An outcome, so the mark can carry its colour. */
  tone?: string;
}

interface DatePreset {
  key: string;
  label: string;
}

interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isStart: boolean;
  isEnd: boolean;
  inRange: boolean;
  isPreviewEnd: boolean;
  disabled: boolean;
}

/** One line of "What changed": a label, its value, and how deeply it is nested. */
interface PayloadRow {
  label: string;
  value: string;
  depth: number;
  /** A heading line for a nested group (no value of its own). */
  group: boolean;
}

/** A local calendar day as `yyyy-mm-dd`, the shape the date filters hold. */
function toIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * The audit trail.
 *
 * READ-ONLY, AND THAT IS THE WHOLE POINT. There is no endpoint behind this screen that writes,
 * edits or deletes an audit event, because a trail that can be corrected is not evidence of
 * anything. Events are written by the handlers themselves, in the same transaction as the change
 * they describe, so an action cannot succeed without leaving a record.
 *
 * TWO THINGS ARE WORTH KNOWING ABOUT WHAT APPEARS HERE
 * ----------------------------------------------------
 * Payloads are REDACTED ON WRITE — password hashes, tokens, secrets and recovery codes never
 * reach the table, so no permission can reveal them on this screen.
 *
 * Detail is GRADED. Without `iam.audit.view-sensitive` the before and after payloads are withheld
 * and only the event envelope is shown. Knowing that a colleague's password was reset is routine;
 * reading the contents of the change is not.
 *
 * EXPORTING IS ITSELF AUDITED, filter included. An unusual export is exactly the kind of thing a
 * later investigation needs to be able to see.
 */
@Component({
  selector: 'app-audit-trail',
  standalone: true,
  imports: [PageHeader, CommonModule, FormsModule, ClickOutsideDirective, SupportReferencePipe, ReadableIdPipe],
  templateUrl: './audit-trail.html',
  styleUrl: './audit-trail.css',
})
export class AuditTrailComponent implements OnInit, OnDestroy {
  private readonly api = inject(IamAdminApiService);
  private readonly tokens = inject(AuthTokenService);
  private readonly toast = inject(ToastService);
  private readonly enums = inject(EnumOptionsService);

  private readonly destroy$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  /** The events fetched so far, for the Recent Activity list. Grows as "Load more" is used. */
  readonly events = signal<AuditEventResponse[]>([]);

  /**
   * The cards, the outcome donut, the heatmap and the insight, for the current filter - counted
   * by the server over EVERY matching event. They used to be worked out here from the first
   * hundred rows, so on a busy Organisation every figure described "the latest hundred".
   */
  readonly summary = signal<AuditSummaryResponse | null>(null);

  /** The viewer's own zone, so the heatmap's bands are the viewer's morning and evening. */
  private readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  readonly totalCount = signal(0);
  readonly hasNextPage = signal(false);
  readonly page = signal(1);
  readonly visibleCount = signal(INITIAL_VISIBLE);

  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly loadFailed = signal(false);
  readonly exporting = signal(false);
  readonly errorMessage = signal('');

  /** The row expanded to show its payload, if any. */
  readonly expandedId = signal<string | null>(null);

  // ---- Filters --------------------------------------------------------------------------------
  readonly search = signal('');
  readonly targetType = signal('');
  readonly result = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');

  readonly hasFilters = computed(
    () => this.search().trim().length > 0
      || this.targetType() !== ''
      || this.result() !== ''
      || this.fromDate() !== ''
      || this.toDate() !== '');

  readonly canExport = computed(() => this.tokens.hasPermission('iam.audit.export'));
  readonly canSeeDetail = computed(() => this.tokens.hasPermission('iam.audit.view-sensitive'));
  readonly organisationName = computed(() => this.tokens.organisationName());

  /**
   * The record types to offer, fetched from the trail itself.
   *
   * THIS USED TO BE A LITERAL LIST of eleven entity names typed into the component. A hardcoded
   * filter list can only be wrong two ways and is silent in both: a type the platform began
   * writing later could never be filtered for, and a type that had never once occurred was
   * offered as a filter that quietly returns nothing. The server answers from DISTINCT over the
   * caller's own Organisation, so the dropdown always matches what is actually there.
   */
  readonly targetTypes = signal<string[]>([]);

  /**
   * The outcome filter's options - the server's `AuditResult` values, with the line saying what
   * each means, from `/reference-data/enums`. They were a literal three-item list with the
   * meanings typed beside it.
   */
  readonly results = signal<{ value: string; label: string; description: string }[]>([]);

  // ---- Record type / Outcome pickers ------------------------------------------------------------
  // The same searchable list as the campaign wizard's Owner field: type to narrow, pick a line.

  /** Which picker's list is open, if any. */
  readonly openCombo = signal<'type' | 'result' | null>(null);
  readonly comboQuery = signal('');
  /** Keyboard highlight within the open list. */
  readonly comboActive = signal(0);

  /** Record types, each with how many of the matching events it accounts for - counted by the server. */
  readonly typeOptions = computed<ComboOption[]>(() => {
    const counts = new Map<string, number>(
      (this.summary()?.targetTypes ?? []).map((item) => [item.targetType ?? '', item.count ?? 0] as const));
    const inView = (n: number) => (n ? `${n} event${n === 1 ? '' : 's'} in view` : 'None in view');
    return [
      { value: '', label: 'All records', context: 'Every record type', glyph: 'ri-stack-line' },
      ...this.targetTypes().map((t) => ({ value: t, label: t, context: inView(counts.get(t) ?? 0) })),
    ];
  });

  readonly resultOptions = computed<ComboOption[]>(() => [
    {
      value: '',
      label: 'All outcomes',
      context: this.results().map((o) => o.label).join(', ') || 'Every outcome',
      glyph: 'ri-stack-line',
    },
    ...this.results().map((o) => ({
      value: o.value,
      label: o.label,
      context: o.description || 'Outcome',
      tone: o.value,
    })),
  ]);

  /** The open picker's options, narrowed by what has been typed. */
  readonly comboResults = computed<ComboOption[]>(() => {
    const which = this.openCombo();
    if (!which) return [];
    const all = which === 'type' ? this.typeOptions() : this.resultOptions();
    const q = this.comboQuery().trim().toLowerCase();
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  });

  readonly typeLabel = computed(
    () => this.typeOptions().find((o) => o.value === this.targetType())?.label ?? this.targetType());
  readonly resultLabel = computed(
    () => this.resultOptions().find((o) => o.value === this.result())?.label ?? this.result());

  // ---- Date range picker ------------------------------------------------------------------------

  /** Which end of the range the calendar is choosing. */
  readonly dateOpen = signal<'from' | 'to' | null>(null);
  /** First day of the month on show. */
  readonly viewMonth = signal(startOfMonth(new Date()));
  readonly calendarMode = signal<'days' | 'months'>('days');
  /** The day under the pointer while choosing the end, for the range preview. */
  readonly hoverIso = signal('');

  readonly weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  readonly monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  readonly datePresets: DatePreset[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'month', label: 'This month' },
    { key: 'lastMonth', label: 'Last month' },
    { key: '90d', label: 'Last 90 days' },
    { key: 'year', label: 'This year' },
  ];

  readonly monthTitle = computed(() =>
    this.viewMonth().toLocaleDateString(undefined, { month: 'long' }));
  readonly yearTitle = computed(() => this.viewMonth().getFullYear());

  /** Six weeks, Monday first, with every state the grid paints. */
  readonly calendarDays = computed<CalendarDay[]>(() => {
    const first = this.viewMonth();
    const today = toIso(new Date());
    const from = this.fromDate();
    const to = this.toDate();
    const choosing = this.dateOpen();
    // While choosing the end, the hovered day previews where the range would stop.
    const end = to || (choosing === 'to' && from && this.hoverIso() >= from ? this.hoverIso() : '');

    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));

    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toIso(d);
      return {
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === first.getMonth(),
        isToday: iso === today,
        isStart: iso === from,
        isEnd: iso === to,
        inRange: !!from && !!end && iso > from && iso < end,
        isPreviewEnd: !to && iso === end && !!end,
        disabled: iso > today || (choosing === 'to' && !!from && iso < from),
      };
    });
  });

  readonly canGoNextMonth = computed(() => {
    const view = this.viewMonth();
    const next = this.calendarMode() === 'months'
      ? new Date(view.getFullYear() + 1, 0, 1)
      : new Date(view.getFullYear(), view.getMonth() + 1, 1);
    return next <= new Date();
  });

  /** "2 Oct 2026 – 9 Oct 2026" style span length, shown under the calendar. */
  readonly rangeSpan = computed(() => {
    const from = this.fromDate();
    const to = this.toDate();
    if (!from || !to) return '';
    const days = Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000) + 1;
    return `${days} day${days === 1 ? '' : 's'}`;
  });

  // ---- Recent Activity (visible slice + "load more") -------------------------------------------

  readonly visibleEvents = computed(() => this.events().slice(0, this.visibleCount()));

  readonly canLoadMore = computed(
    () => this.visibleCount() < this.events().length || this.hasNextPage());

  // ---- Summary cards: the server's figures ---------------------------------------------------------

  readonly statsTotal = computed(() => this.summary()?.totalCount ?? 0);

  private outcome(value: string) {
    return (this.summary()?.outcomes ?? []).find((item) => item.result === value);
  }

  readonly succeededCount = computed(() => this.outcome('succeeded')?.count ?? 0);

  /** Everything that did not succeed: denials and failures, which the card counts together. */
  readonly failedCount = computed(() => this.summary()?.unsuccessfulCount ?? 0);

  readonly succeededPct = computed(() => this.summary()?.succeededPercent ?? 0);
  readonly failedPct = computed(() => this.summary()?.unsuccessfulPercent ?? 0);

  /**
   * The second card's heading, in the server's words for the two outcomes it counts.
   *
   * IT SAID "FAILED" over a count of denials and failures together. A denial is a permission check
   * doing its job, not something breaking - the trail colours them apart - so the heading names both.
   */
  readonly unsuccessfulLabel = computed(() => {
    const denied = this.outcome('denied')?.label;
    const failed = this.outcome('failed')?.label;
    return denied && failed ? `${denied} or ${failed.toLowerCase()}` : 'Not succeeded';
  });

  readonly uniqueUsersCount = computed(() => this.summary()?.distinctActorCount ?? 0);

  readonly mostActiveUser = computed(() => {
    const top = this.summary()?.mostActiveActor;
    return top ? { name: top.displayName || 'System', count: top.eventCount ?? 0 } : null;
  });

  readonly mostActiveShare = computed(() => this.summary()?.mostActiveActor?.sharePercent ?? 0);

  // ---- Activity heatmap: the server's grid, counted on the viewer's clock ----------------------------

  readonly dayLabels = computed(() => this.summary()?.heatmap?.dayLabels ?? []);
  readonly timeLabels = computed(() => (this.summary()?.heatmap?.bands ?? []).map((band) => band.label ?? ''));

  /** Rows are the bands of the day; columns are the days, Monday first. */
  readonly heatmap = computed<{ range: string; counts: number[] }[]>(() =>
    (this.summary()?.heatmap?.bands ?? []).map((band) => ({ range: band.rangeLabel ?? '', counts: band.counts ?? [] })));

  readonly heatmapMax = computed(() => Math.max(1, this.summary()?.heatmap?.maxCount ?? 0));

  /** The busiest band across the week, for the Quick Insights card. */
  readonly busiestTimeRange = computed(() => this.summary()?.busiestTimeRange ?? null);

  // ---- Outcome donut ---------------------------------------------------------------------------------

  /**
   * The donut's outcomes, from the server: every outcome with its own segment, label and count,
   * each in a shade of the theme's primary colour. It drew two - Succeeded and a "Failed" that
   * was really denials and failures together.
   */
  readonly outcomeBreakdown = computed(() => {
    const outcomes = this.summary()?.outcomes ?? [];
    const shades = this.primaryShades(Math.max(outcomes.length, 1));
    return outcomes.map((item, index) => ({
      label: item.label ?? '',
      count: item.count ?? 0,
      pct: item.percent ?? 0,
      color: shades[index],
    }));
  });

  /** The theme's --primary as a hex colour (ApexCharts cannot read CSS variables). */
  private primaryHex(): string {
    const css = getComputedStyle(document.documentElement);
    const raw = (css.getPropertyValue('--primary') || css.getPropertyValue('--theme-primary')).trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (/^#[0-9a-f]{3}$/i.test(raw)) return '#' + raw.slice(1).split('').map((c) => c + c).join('');
    const rgb = raw.match(/\d+/g);
    if (raw.startsWith('rgb') && rgb && rgb.length >= 3) {
      return '#' + rgb.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    }
    return '#07565b';
  }

  /** `count` shades of the primary colour, from full strength to a pale tint. */
  private primaryShades(count: number): string[] {
    const hex = this.primaryHex();
    const base = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Array.from({ length: Math.max(1, count) }, (_, i) => {
      const white = count <= 1 ? 0 : (i / (count - 1)) * 0.7; // 0 = primary, 0.7 = palest
      return '#' + base.map((c) => Math.round(c + (255 - c) * white).toString(16).padStart(2, '0')).join('');
    });
  }

  // ---- Outcome donut (ApexCharts, loaded globally via a <script> tag like the dashboard) -------

  private chart: any = null;

  /** The element the chart was drawn into, to notice when a reload has replaced it. */
  private chartElement: HTMLElement | null = null;

  constructor() {
    // `afterRenderEffect` (not a plain `effect`) is what makes this reliable: a plain effect can
    // flush BEFORE Angular has finished patching the DOM for the same signal change, so on the
    // very first load it was finding `succeededCount`/`failedCount` already updated but the
    // template's `#auditOutcomeChart` div not yet attached — the chart was silently never
    // created. `afterRenderEffect` is specifically the reactive primitive that is guaranteed to
    // run after rendering, so the container is always there by the time this runs.
    //
    // IT ALSO READS THE LIST'S STATE. The container sits in the branch drawn once the list has
    // loaded, and the figures come from a separate request: when they arrived first, the effect
    // ran before the container existed and nothing made it run again.
    afterRenderEffect(() => {
      const listShown = !this.loading() && !this.loadFailed() && this.events().length > 0;
      this.updateChart(this.outcomeBreakdown(), listShown);
    });
  }

  ngOnInit(): void {
    // Fetched once. A failure here costs the dropdown its options and nothing else, so it must
    // not take the page down with it - the trail itself is the thing somebody came for.
    this.api.getAuditTargetTypes()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (types) => this.targetTypes.set(types),
        error: () => this.targetTypes.set([]),
      });

    // The same rule: a failure costs the outcome filter its options, never the page. Read from
    // the full payload because the outcomes carry a description the dropdown shows.
    this.enums
      .getAll()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (all) => this.results.set((all.auditResults ?? [])
          .filter((option) => !!option.value)
          .map((option) => ({
            value: apiEnumValue(option.value),
            label: option.label || option.value || '',
            description: option.description ?? '',
          }))),
        error: () => this.results.set([]),
      });

    this.searchInput$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((term) => {
        this.search.set(term);
        this.load();
      });

    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.chart?.destroy();
  }

  /** A fresh load for the current filters: page 1 of the list, and the server's figures for the cards. */
  load(): void {
    this.page.set(1);
    this.visibleCount.set(INITIAL_VISIBLE);
    this.fetchPage(true);

    // The figures are worth having without the list and the list without the figures.
    this.api
      .getAuditSummary(this.buildFilter())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (summary) => this.summary.set(summary),
        error: () => this.summary.set(null),
      });
  }

  private fetchPage(reset: boolean): void {
    this.loading.set(reset);
    this.loadingMore.set(!reset);
    this.loadFailed.set(false);

    this.api
      .searchAuditEvents(this.buildFilter())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          const items = result.items ?? [];

          if (reset) {
            this.events.set(items);
          } else {
            this.events.update((current) => [...current, ...items]);
          }

          this.totalCount.set(result.totalCount ?? 0);
          this.hasNextPage.set(result.hasNextPage ?? false);
          this.loading.set(false);
          this.loadingMore.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadingMore.set(false);
          this.loadFailed.set(true);
          this.errorMessage.set(apiErrorMessage(error, 'The audit trail could not be loaded.'));
        },
      });
  }

  private buildFilter(): AuditSearchFilter {
    return {
      search: this.search().trim() || undefined,
      targetType: this.targetType() || undefined,
      result: this.result() || undefined,

      // A date input gives a local calendar day; the API wants an instant. Taking the start of
      // the chosen day and the END of the chosen day is what makes "from the 1st to the 1st"
      // return that day's events rather than none.
      fromUtc: this.fromDate() ? new Date(this.fromDate() + 'T00:00:00').toISOString() : undefined,
      toUtc: this.toDate() ? new Date(this.toDate() + 'T23:59:59.999').toISOString() : undefined,

      page: this.page(),
      pageSize: LIST_PAGE_SIZE,
      timeZone: this.timeZone,
    };
  }

  onSearchInput(value: string): void {
    this.searchInput$.next(value);
  }

  applyFilters(): void {
    this.load();
  }

  /** Up to two initials for the avatar badge: "Platform Administrator" -> "PA". */
  initials(name: string): string {
    const words = name.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
    if (words.length === 0) {
      return '?';
    }
    const first = words[0][0];
    const last = words.length > 1 ? words[words.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  clearFilters(): void {
    this.search.set('');
    this.targetType.set('');
    this.result.set('');
    this.fromDate.set('');
    this.toDate.set('');
    this.closeCombo();
    this.closeDate();
    this.load();
  }

  // ---- Record type / Outcome pickers ------------------------------------------------------------

  openComboFor(which: 'type' | 'result'): void {
    if (this.openCombo() === which) return;
    this.closeDate();
    this.comboQuery.set('');
    this.openCombo.set(which);
    const current = which === 'type' ? this.targetType() : this.result();
    this.comboActive.set(Math.max(0, this.comboResults().findIndex((o) => o.value === current)));
  }

  toggleCombo(which: 'type' | 'result'): void {
    if (this.openCombo() === which) this.closeCombo();
    else this.openComboFor(which);
  }

  closeCombo(): void {
    this.openCombo.set(null);
    this.comboQuery.set('');
  }

  onComboQuery(value: string): void {
    this.comboQuery.set(value);
    this.comboActive.set(0);
  }

  chooseCombo(option: ComboOption): void {
    const which = this.openCombo();
    if (which === 'type') this.targetType.set(option.value);
    if (which === 'result') this.result.set(option.value);
    this.closeCombo();
    this.applyFilters();
  }

  clearCombo(which: 'type' | 'result'): void {
    if (which === 'type') this.targetType.set('');
    else this.result.set('');
    this.closeCombo();
    this.applyFilters();
  }

  onComboKey(event: KeyboardEvent, which: 'type' | 'result'): void {
    const list = this.comboResults();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (this.openCombo() !== which) { this.openComboFor(which); return; }
        this.comboActive.update((i) => Math.min(list.length - 1, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.comboActive.update((i) => Math.max(0, i - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        const option = list[this.comboActive()];
        if (option) this.chooseCombo(option);
        break;
      }
      case 'Escape':
      case 'Tab':
        this.closeCombo();
        break;
    }
  }

  // ---- Date range picker ------------------------------------------------------------------------

  /** Opens the calendar on the start or end of the range, showing that day's month. */
  openDate(which: 'from' | 'to'): void {
    this.closeCombo();
    if (this.dateOpen() !== which) {
      const anchor = (which === 'from' ? this.fromDate() : this.toDate())
        || (which === 'to' ? this.fromDate() : this.toDate());
      this.viewMonth.set(startOfMonth(anchor ? parseIso(anchor) : new Date()));
    }
    this.calendarMode.set('days');
    this.hoverIso.set('');
    this.dateOpen.set(which);
  }

  closeDate(): void {
    this.dateOpen.set(null);
    this.hoverIso.set('');
  }

  shiftMonth(step: number): void {
    const view = this.viewMonth();
    let next = new Date(view.getFullYear(), view.getMonth() + step, 1);
    if (this.calendarMode() === 'months') {
      // A year forward lands on the latest month that has already begun.
      next = new Date(view.getFullYear() + step, view.getMonth(), 1);
      if (next > new Date()) next = startOfMonth(new Date());
      if (next.getFullYear() === view.getFullYear()) return;
    }
    if (next > new Date()) return;
    this.viewMonth.set(next);
  }

  toggleCalendarMode(): void {
    this.calendarMode.update((m) => (m === 'days' ? 'months' : 'days'));
  }

  pickMonth(month: number): void {
    this.viewMonth.set(new Date(this.viewMonth().getFullYear(), month, 1));
    this.calendarMode.set('days');
  }

  isFutureMonth(month: number): boolean {
    return new Date(this.viewMonth().getFullYear(), month, 1) > new Date();
  }

  isViewMonth(month: number): boolean {
    return this.viewMonth().getMonth() === month;
  }

  /**
   * Choosing the start moves straight on to the end, as a range picker should. A start after the
   * current end drops the end rather than leaving a backwards range.
   */
  pickDay(day: CalendarDay): void {
    if (day.disabled) return;

    if (this.dateOpen() === 'from') {
      this.fromDate.set(day.iso);
      if (this.toDate() && this.toDate() < day.iso) this.toDate.set('');
      this.applyFilters();
      this.dateOpen.set('to');
      this.hoverIso.set('');
      if (!day.inMonth) this.viewMonth.set(startOfMonth(parseIso(day.iso)));
      return;
    }

    this.toDate.set(day.iso);
    this.applyFilters();
    this.closeDate();
  }

  applyPreset(key: string): void {
    const today = new Date();
    const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
    let from = today;
    let to = today;

    switch (key) {
      case 'yesterday': from = to = daysAgo(1); break;
      case '7d': from = daysAgo(6); break;
      case '30d': from = daysAgo(29); break;
      case '90d': from = daysAgo(89); break;
      case 'month': from = startOfMonth(today); break;
      case 'lastMonth':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      case 'year': from = new Date(today.getFullYear(), 0, 1); break;
    }

    this.fromDate.set(toIso(from));
    this.toDate.set(toIso(to));
    this.applyFilters();
    this.closeDate();
  }

  /** Whether a preset describes the range already chosen, so it can be marked. */
  isPresetActive(key: string): boolean {
    if (!this.fromDate() || !this.toDate()) return false;
    const before = [this.fromDate(), this.toDate()].join();
    const today = new Date();
    const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return toIso(d); };
    const t = toIso(today);
    const ranges: Record<string, string> = {
      today: [t, t].join(),
      yesterday: [daysAgo(1), daysAgo(1)].join(),
      '7d': [daysAgo(6), t].join(),
      '30d': [daysAgo(29), t].join(),
      '90d': [daysAgo(89), t].join(),
      month: [toIso(startOfMonth(today)), t].join(),
      lastMonth: [toIso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
                  toIso(new Date(today.getFullYear(), today.getMonth(), 0))].join(),
      year: [toIso(new Date(today.getFullYear(), 0, 1)), t].join(),
    };
    return ranges[key] === before;
  }

  clearDate(which: 'from' | 'to'): void {
    if (which === 'from') this.fromDate.set('');
    else this.toDate.set('');
    this.applyFilters();
  }

  clearRange(): void {
    this.fromDate.set('');
    this.toDate.set('');
    this.applyFilters();
    this.dateOpen.set('from');
  }

  /** "2 Oct 2026" for a `yyyy-mm-dd` day. */
  dateLabel(iso: string): string {
    return iso
      ? parseIso(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
  }

  /** "Thursday" for a `yyyy-mm-dd` day. */
  weekdayLabel(iso: string): string {
    return iso ? parseIso(iso).toLocaleDateString(undefined, { weekday: 'long' }) : '';
  }

  dayAriaLabel(iso: string): string {
    return parseIso(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ---- Event detail -----------------------------------------------------------------------------

  /** "Thu, 2 Oct 2026" for the detail panel. */
  eventDateLong(occurredAtUtc: string | undefined): string {
    return occurredAtUtc
      ? new Date(occurredAtUtc).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      : '—';
  }

  /** "14:32:05 GMT+5:30" - to the second, with the zone, because evidence needs both. */
  eventTimeExact(occurredAtUtc: string | undefined): string {
    return occurredAtUtc
      ? new Date(occurredAtUtc).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
      : '';
  }

  clientIcon(clientType: string | undefined): string {
    switch (clientType) {
      case 'web': return 'ri-global-line';
      case 'mobile': return 'ri-smartphone-line';
      case 'desktop': return 'ri-computer-line';
      case 'api': return 'ri-code-s-slash-line';
      default: return 'ri-question-line';
    }
  }

  /** "Chrome 154 on Windows" from a user-agent string; the raw string stays beneath it. */
  browserSummary(userAgent: string | null | undefined): string {
    const ua = userAgent || '';
    const version = (re: RegExp) => ua.match(re)?.[1]?.split('.')[0] ?? '';

    let browser = '';
    if (/Edg\//.test(ua)) browser = `Edge ${version(/Edg\/([\d.]+)/)}`;
    else if (/OPR\//.test(ua)) browser = `Opera ${version(/OPR\/([\d.]+)/)}`;
    else if (/Firefox\//.test(ua)) browser = `Firefox ${version(/Firefox\/([\d.]+)/)}`;
    else if (/Chrome\//.test(ua)) browser = `Chrome ${version(/Chrome\/([\d.]+)/)}`;
    else if (/Safari\//.test(ua)) browser = `Safari ${version(/Version\/([\d.]+)/)}`;

    let os = '';
    if (/Windows NT/.test(ua)) os = 'Windows';
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/Linux/.test(ua)) os = 'Linux';

    if (!browser && !os) return 'Unrecognised client';
    return [browser.trim(), os].filter(Boolean).join(' on ');
  }

  browserIcon(userAgent: string | null | undefined): string {
    const ua = userAgent || '';
    if (/Edg\//.test(ua)) return 'ri-edge-line';
    if (/Firefox\//.test(ua)) return 'ri-firefox-line';
    if (/Chrome\//.test(ua)) return 'ri-chrome-line';
    if (/Safari\//.test(ua)) return 'ri-safari-line';
    return 'ri-window-line';
  }

  copySupportRef(correlationId: string | null | undefined): void {
    const ref = supportReference(correlationId, '');
    if (!ref) return;
    navigator.clipboard?.writeText(ref).then(
      () => this.toast.success('Copied', `Support reference ${ref} is on your clipboard.`),
      () => this.toast.error('Copy failed', 'Select the reference and copy it instead.'),
    );
  }

  /**
   * Reveals more of what's already been fetched first; only reaches for the next page over the
   * network once the visible slice has caught up with it.
   */
  loadMore(): void {
    if (this.visibleCount() < this.events().length) {
      this.visibleCount.update((count) => count + LOAD_MORE_STEP);
      return;
    }

    if (this.hasNextPage()) {
      this.page.update((p) => p + 1);
      this.visibleCount.update((count) => count + LOAD_MORE_STEP);
      this.fetchPage(false);
    }
  }

  toggleDetail(id: string | undefined): void {
    if (!id) {
      return;
    }

    this.expandedId.update((current) => (current === id ? null : id));
  }

  export(): void {
    if (this.exporting()) {
      return;
    }

    this.exporting.set(true);

    this.api
      .exportAuditEvents(this.buildFilter())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ blob, fileName, reference }) => {
          this.exporting.set(false);
          this.api.saveBlob(blob, fileName);

          this.toast.show(
            'Export ready',
            reference
              ? `${fileName} has been downloaded. This export is recorded in the trail as ${reference}.`
              : `${fileName} has been downloaded. This export has been recorded in the trail.`,
            'success');
        },
        error: (error: unknown) => {
          this.exporting.set(false);
          this.toast.show('Export failed', apiErrorMessage(error), 'error');
        },
      });
  }

  /**
   * The badge colour for an outcome.
   *
   * A denial is not a failure: it is the system working. They are coloured differently because
   * scanning for "something broke" and scanning for "somebody was refused" are different jobs.
   */
  resultClass(result: string | undefined): string {
    switch (result) {
      case 'succeeded': return 'bg-success-subtle text-success';
      case 'denied': return 'bg-warning-subtle text-warning';
      case 'failed': return 'bg-danger-subtle text-danger';
      default: return 'bg-secondary-subtle text-secondary';
    }
  }

  /**
   * The timeline icon's colour.
   *
   * ONE COLOUR PER ICON. Every icon `actionIcon` can return has its own colour, so the same icon
   * is always the same colour and two different icons never share one. The outcome still wins
   * when something did not go cleanly: a failure is red and a denial amber, whatever the icon.
   */
  private static readonly ICON_COLORS: Record<string, string> = {
    'ri-lock-2-line': '#a8693f',      // password   - muted orange
    'ri-settings-3-line': '#5d6296',  // token      - muted indigo
    'ri-fingerprint-line': '#4b7a5c', // sign-in    - muted green
    'ri-shield-user-line': '#73609c', // role       - muted violet
    'ri-download-2-line': '#437a87',  // export     - muted cyan
    'ri-delete-bin-line': '#9a5068',  // delete     - muted rose
    'ri-user-add-line': '#4f6f9f',    // user       - muted blue
    'ri-history-line': '#457a72',     // anything else - muted teal
  };

  iconColor(actionCode: string | null | undefined, result: string | undefined): string {
    if (result === 'failed') return '#a3524a';
    if (result === 'denied') return '#a07a3c';
    return AuditTrailComponent.ICON_COLORS[this.actionIcon(actionCode)] ?? '#457a72';
  }

  /**
   * "What changed", as lines a person can read - `Previous organisation: Acme Trust` - rather than
   * the JSON the writer stored.
   *
   * THE SERVER HAS ALREADY PUT NAMES WHERE THE IDS WERE (see AuditRecordNames in the IAM read
   * service). The keys are still the writer's property names, so they are turned into words here:
   * `previousTenantId` reads "Previous organisation", `roleIds` reads "Roles". Anything still shaped
   * like an id is replaced as a last resort, because a GUID in this panel is exactly what the panel
   * exists to explain.
   */
  payloadRows(payload: string | null | undefined): PayloadRow[] {
    if (!payload) {
      return [];
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(payload);
    } catch {
      return [{ label: 'Detail', value: withoutGuids(payload, 'Record not available'), depth: 0, group: false }];
    }

    const rows: PayloadRow[] = [];
    const show = (value: unknown): string => {
      if (value === null || value === undefined || value === '') return '—';
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      return readableWord(withoutGuids(String(value), 'Record not available'));
    };
    const isPlain = (value: unknown) => value === null || typeof value !== 'object';

    const walk = (value: unknown, label: string, depth: number): void => {
      if (isPlain(value)) {
        rows.push({ label, value: show(value), depth, group: false });
      } else if (Array.isArray(value)) {
        if (value.every(isPlain)) {
          rows.push({ label, value: value.length ? value.map(show).join(', ') : 'None', depth, group: false });
        } else {
          rows.push({ label, value: '', depth, group: true });
          value.forEach((item, index) => walk(item, `${index + 1}`, depth + 1));
        }
      } else {
        rows.push({ label, value: '', depth, group: true });
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          walk(child, humaniseKey(key), depth + 1);
        }
      }
    };

    if (isPlain(parsed) || Array.isArray(parsed)) {
      walk(parsed, 'Detail', 0);
    } else {
      for (const [key, child] of Object.entries(parsed as Record<string, unknown>)) {
        walk(child, humaniseKey(key), 0);
      }
    }

    return rows;
  }

  /** A server sentence - an outcome reason - with any id in it replaced by words. */
  readableText(text: string | null | undefined): string {
    return withoutGuids(text, 'a record');
  }

  /** A request path with the record ids in it shown as an ellipsis: `/api/v1/users/…/suspend`. */
  requestPathLabel(path: string | null | undefined): string {
    return path ? withoutGuids(path, '…') : '—';
  }

  /** Icon for an event's action category, read from its machine-readable action code. */
  actionIcon(actionCode: string | null | undefined): string {
    const code = (actionCode || '').toLowerCase();

    if (code.includes('password')) return 'ri-lock-2-line';
    if (code.includes('token')) return 'ri-settings-3-line';
    if (code.includes('reauthenticat') || code.includes('login') || code.includes('auth')) return 'ri-fingerprint-line';
    if (code.includes('role')) return 'ri-shield-user-line';
    if (code.includes('export')) return 'ri-download-2-line';
    if (code.includes('delete') || code.includes('remove')) return 'ri-delete-bin-line';
    if (code.includes('user')) return 'ri-user-add-line';
    return 'ri-history-line';
  }

  /** "Today" / "Yesterday" / a short date, in the viewer's own timezone. */
  eventDayLabel(occurredAtUtc: string | undefined): string {
    if (!occurredAtUtc) {
      return '—';
    }

    const occurred = new Date(occurredAtUtc);
    const now = new Date();
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

    if (sameDay(occurred, now)) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(occurred, yesterday)) return 'Yesterday';

    return occurred.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  eventTimeLabel(occurredAtUtc: string | undefined): string {
    if (!occurredAtUtc) {
      return '';
    }

    return new Date(occurredAtUtc).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /** The opacity for one heatmap cell, scaled to the busiest cell in the grid. */
  /** Every cell reads as a shade of green — even an empty one gets a faint tint rather than
   *  switching to a neutral grey, so the grid reads as one continuous scale. */
  heatCellOpacity(count: number): number {
    if (count === 0) {
      return 0.06;
    }

    return 0.18 + 0.82 * (count / this.heatmapMax());
  }

  /** Creates the donut once its container is in the DOM, then just updates its series. See the
   *  note on the `afterRenderEffect` call in the constructor for why this can't be a plain
   *  `effect()`. */
  private updateChart(types: { label: string; count: number; color: string }[], listShown: boolean): void {
    const series = types.map((t) => t.count);
    const labels = types.map((t) => t.label);
    const colors = types.map((t) => t.color);

    // A reload replaces the whole right-hand column, container included. The chart drawn into
    // the old one went on being "updated" in a detached element, so after the first filter the
    // donut stayed blank; it is drawn again into the new container instead.
    if (this.chart && this.chartElement?.isConnected) {
      this.chart.updateOptions({ series, labels, colors });
      return;
    }

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
      this.chartElement = null;
    }

    // Not until the list is on screen and the server's figures are in: a donut created with no
    // series draws nothing and stays blank after the figures arrive.
    if (!listShown || series.length === 0) {
      return;
    }

    const el = document.getElementById('auditOutcomeChart');

    if (!el || typeof ApexCharts === 'undefined') {
      return;
    }

    const options = {
      chart: { type: 'donut', height: 190, sparkline: { enabled: false } },
      series,
      labels,
      colors,
      // White gaps between the segments.
      stroke: { width: 3, colors: ['#ffffff'] },
      dataLabels: { enabled: false },
      legend: { show: false },
      states: { hover: { filter: { type: 'darken', value: 0.9 } } },
      tooltip: { y: { formatter: (value: number) => `${value} event${value === 1 ? '' : 's'}` } },
      plotOptions: { pie: { expandOnClick: false, donut: { size: '68%', labels: { show: false } } } },
    };

    this.chart = new ApexCharts(el, options);
    this.chartElement = el;
    this.chart.render();
  }
}