import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';
import { DashboardApiService } from '../../../../Service/dashboard-api.service';
import { formatCount, formatMoney } from '../../../../Shared/services/money-format';
import {
  DashboardOutcomeMetric,
  DashboardOutcomes,
  DashboardPage,
  DashboardPeriod,
  DashboardUnit,
} from '../../../../Shared/models/dashboard-contract.model';

/**
 * SCR-UX-002 — Executive dashboard.
 *
 * Section 4.2 of the YDot Practical UI/UX Generation Specification: outcome-level trends with
 * drill-down and freshness evidence, filtered by period, scope and comparison.
 *
 * EVERY FIGURE COMES FROM THE SERVER. The page used to render a fixed set of invented values -
 * "₹48.72 L", "24,582 beneficiaries", "3,842 sticks", campaigns that exist nowhere, an owner
 * called Priya Nair and an audit reference nobody issued. Its numbers now come from CAM, DON and
 * PAY (`GET .../dashboard/outcomes`) for the period and campaign chosen, and its history panel,
 * owner and next action from the landing page's own endpoints.
 *
 * THREE METRICS THE PLATFORM CANNOT ANSWER WERE REPLACED, NOT FAKED. Beneficiaries, stock and
 * distributions have no service here; their tiles hold donors who gave, receipted gifts and leads
 * converted - outcomes this platform records.
 *
 *  Route            : /workspace/executive-dashboard
 *  View permission  : ux.executive-dashboard.view
 */

/** The UI states of 4.2.4, plus the settled "ready" surface. */
type UiState =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'validation'
  | 'duplicate'
  | 'no-access'
  | 'conflict'
  | 'dependency-failure'
  | 'success';

/** A scope the period can be narrowed to: the whole Organisation, or one campaign. */
interface ScopeOption {
  readonly reference: string;
  readonly name: string;
  readonly context: string;
  readonly campaignId: string | null;
}

/** A metric tile, worded for the page. */
interface OutcomeMetric {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly qualifier: string;
  readonly definition: string;
  readonly drillLabel: string;
  readonly route: string | null;
}

/** One day of the curve. */
interface TrendPoint {
  readonly date: string;
  readonly label: string;
  readonly axisLabel: string;
  readonly primary: number;
  readonly secondary: number;
}

interface RelatedTab {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly RelatedRow[];
}

interface RelatedRow {
  readonly primary: string;
  readonly secondary: string;
  readonly meta: string;
}

@Component({
  selector: 'app-executive-dashboard',
  imports: [PageHeader, CommonModule, FormsModule],
  templateUrl: './executive-dashboard.html',
  styleUrl: './executive-dashboard.css',
})
export class ExecutiveDashboardComponent implements OnInit {
  private readonly api = inject(DashboardApiService);
  private readonly router = inject(Router);

  // ----- What the services sent -----
  private readonly outcomes = signal<DashboardOutcomes | null>(null);
  private readonly page = signal<DashboardPage | null>(null);

  // ----- Task header -----
  protected readonly pageTitle = 'Executive dashboard';

  /** The live view of the figures - there is no draft or published copy of it. */
  protected readonly lifecycleState = 'Live';

  /** The person reading the figures, as the Organisation names their roles. */
  protected readonly owner = computed(() => {
    const viewer = this.page()?.viewer;
    if (!viewer) return '';
    return [viewer.displayName, ...viewer.roleNames.slice(0, 1)].filter(Boolean).join(' · ');
  });

  /** "Asia/Kolkata · UTC+05:30" - the zone the days are counted in, from the server. */
  protected readonly operatingTimeZone = computed(() => this.outcomes()?.timeZoneLabel ?? DashboardApiService.viewerTimeZone());

  // ----- Context and filters -----
  protected readonly rangeStart = signal('');
  protected readonly rangeEnd = signal('');

  /** The period the server applied when none was asked for - what "Clear filters" returns to. */
  private readonly defaultRange = signal<{ from: string; to: string } | null>(null);

  protected readonly scopeQuery = signal('');
  protected readonly scopePickerOpen = signal(false);

  /** The whole Organisation first, then every campaign CAM lists for the caller. */
  protected readonly scopeOptions = computed<ScopeOption[]>(() => {
    const organisation = this.page()?.viewer?.organisationName ?? 'Whole organisation';
    return [
      { reference: 'All campaigns', name: organisation, context: 'Organisation', campaignId: null },
      ...(this.outcomes()?.scopeOptions ?? []).map((option) => ({
        reference: option.reference,
        name: option.name,
        context: option.context,
        campaignId: option.campaignId,
      })),
    ];
  });

  private readonly scopeId = signal<string | null>(null);
  protected readonly activeScope = computed(
    () => this.scopeOptions().find((option) => option.campaignId === this.scopeId()) ?? this.scopeOptions()[0],
  );

  /** Eligible scope options narrowed by the search box. */
  protected readonly scopeResults = computed(() => {
    const q = this.scopeQuery().trim().toLowerCase();
    if (!q) {
      return this.scopeOptions();
    }
    return this.scopeOptions().filter(
      (o) => o.name.toLowerCase().includes(q) || o.reference.toLowerCase().includes(q) || o.context.toLowerCase().includes(q),
    );
  });

  /** The comparisons the server offers, worded for the current period. */
  protected readonly comparisonOptions = computed<DashboardPeriod[]>(() => this.outcomes()?.comparisons ?? []);
  protected readonly comparisonPeriod = signal('previous');

  /** Ready-made periods - this month, this financial year - with their dates from the server. */
  protected readonly savedFilters = computed<DashboardPeriod[]>(() => this.outcomes()?.presets ?? []);
  protected readonly savedFilter = signal('');

  protected readonly searchTerm = signal('');
  protected readonly appliedSearchTerm = signal('');

  protected readonly interpretedRange = computed(
    () => `${this.formatDate(this.rangeStart())} – ${this.formatDate(this.rangeEnd())} · ${this.operatingTimeZone()}`,
  );

  /** An end before the start, or a period past a year, is refused before it is sent. */
  protected readonly rangeInvalid = computed(() => {
    const start = this.rangeStart();
    const end = this.rangeEnd();
    if (!start || !end) return false;
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1;
    return days < 1 || days > 366;
  });

  /** Only filters that differ from what the page opened on, so "Clear filters" removes every chip. */
  protected readonly activeFilterSummary = computed(() => {
    const chips: { key: string; label: string }[] = [];
    const scope = this.activeScope();
    if (scope?.campaignId) {
      chips.push({ key: 'scope', label: `Scope: ${scope.name}` });
    }
    const initial = this.defaultRange();
    if (initial && (this.rangeStart() !== initial.from || this.rangeEnd() !== initial.to)) {
      chips.push({ key: 'range', label: `Range: ${this.formatDate(this.rangeStart())} – ${this.formatDate(this.rangeEnd())}` });
    }
    if (this.comparisonPeriod() !== 'previous') {
      const label = this.comparisonOptions().find((o) => o.key === this.comparisonPeriod())?.label ?? this.comparisonPeriod();
      chips.push({ key: 'comparison', label: `Compare: ${label}` });
    }
    const term = this.appliedSearchTerm();
    if (term) {
      chips.push({ key: 'search', label: `Search: “${term}”` });
    }
    return chips;
  });

  // ----- Main work -----

  protected readonly lastRefresh = computed(() => {
    const at = this.outcomes()?.generatedAtUtc;
    return at ? this.formatMoment(new Date(at)) : '—';
  });

  protected readonly totalsCaption = computed(() => `Totals for ${this.activeScope()?.name ?? ''} · as of ${this.lastRefresh()}`);

  /** The metric tiles, worded: the figure in its unit and the comparison in the qualifier. */
  protected readonly metrics = computed<OutcomeMetric[]>(() =>
    (this.outcomes()?.metrics ?? []).map((metric) => ({
      key: metric.key,
      label: metric.label,
      value: this.format(metric.value, metric.unit, metric.currencyCode),
      qualifier: this.qualifierOf(metric),
      definition: metric.definition,
      drillLabel: metric.drill?.label ?? '',
      route: metric.drill?.route ?? null,
    })),
  );

  protected readonly openDefinition = signal<string | null>(null);

  protected readonly filteredMetrics = computed(() => {
    const term = this.appliedSearchTerm().trim().toLowerCase();
    if (!term) {
      return this.metrics();
    }
    return this.metrics().filter((m) => m.label.toLowerCase().includes(term) || m.qualifier.toLowerCase().includes(term));
  });

  /** The curve's two series - names and units from the server. */
  protected readonly seriesLabels = computed(() => ({
    primary: this.outcomes()?.series?.primaryLabel ?? '',
    secondary: this.outcomes()?.series?.secondaryLabel ?? '',
  }));

  /** One point a day; about ten of them carry an axis label so the dates never overlap. */
  protected readonly trend = computed<TrendPoint[]>(() => {
    const points = this.outcomes()?.series?.points ?? [];
    const every = Math.max(1, Math.ceil(points.length / 10));
    return points.map((p, i) => ({
      date: p.date,
      label: p.label,
      axisLabel: i % every === 0 || i === points.length - 1 ? p.label : '',
      primary: p.primary,
      secondary: p.secondary,
    }));
  });

  protected readonly comparisonShown = signal(false);
  protected readonly focusedPoint = signal(0);

  // ----- Related and history: the landing page's own sections, each present only if permitted -----
  protected readonly visibleRelatedTabs = computed<RelatedTab[]>(() => {
    const page = this.page();
    if (!page) return [];
    const tabs: RelatedTab[] = [];
    const scope = this.activeScope();

    if (scope?.campaignId) {
      tabs.push({ key: 'linked', label: 'Linked records', rows: [{ primary: scope.reference, secondary: scope.name, meta: scope.context }] });
    } else if (page.panels.pipeline) {
      const stage = page.panels.pipeline.stages.find((s) => s.key === page.panels.pipeline!.defaultStage);
      tabs.push({
        key: 'linked',
        label: 'Linked records',
        rows: (stage?.rows ?? []).map((r) => ({ primary: r.code, secondary: r.name, meta: `${r.kicker} · ${r.whenLabel}` })),
      });
    }
    if (page.panels.feed) {
      tabs.push({
        key: 'gifts',
        label: page.panels.feed.title,
        rows: page.panels.feed.items.map((i) => ({ primary: i.reference, secondary: i.title, meta: [i.valueDisplay, i.statusLabel].filter(Boolean).join(' · ') })),
      });
    }
    if (page.panels.agenda) {
      tabs.push({
        key: 'agenda',
        label: page.panels.agenda.title,
        rows: page.panels.agenda.items.map((i) => ({ primary: i.title, secondary: i.subtitle ?? '', meta: i.whenLabel })),
      });
    }
    if (page.attention.length) {
      tabs.push({
        key: 'attention',
        label: 'Needs attention',
        rows: page.attention.map((a) => ({ primary: a.label, secondary: a.hint, meta: `${a.count}` })),
      });
    }
    if (page.panels.activity) {
      tabs.push({
        key: 'activity',
        label: 'Activity',
        rows: page.panels.activity.items.map((i) => ({
          primary: i.action,
          secondary: [i.actor, i.target].filter(Boolean).join(' · '),
          meta: this.formatMoment(new Date(i.occurredAtUtc)),
        })),
      });
    }
    return tabs;
  });

  protected readonly activeRelatedTab = signal<string>('linked');
  protected readonly activeRelatedRows = computed(
    () => (this.visibleRelatedTabs().find((t) => t.key === this.activeRelatedTab()) ?? this.visibleRelatedTabs()[0])?.rows ?? [],
  );

  // ----- Persistent outcome -----
  private readonly lastExport = signal<{ reference: string; at: string } | null>(null);

  protected readonly persistentOutcome = computed(() => {
    const next = this.page()?.attention[0];
    const exported = this.lastExport();
    return {
      reference: exported?.reference ?? '',
      state: this.outcomes() ? 'Figures current' : 'Loading figures',
      effectiveTime: this.lastRefresh(),
      downstreamStatus: exported ? `Summary exported · ${exported.reference}` : 'No summary exported in this session',
      owner: this.owner(),
      nextAction: next ? `${next.label} (${next.count})` : 'Nothing is waiting',
    };
  });

  // ----- UI state -----
  protected readonly uiState = signal<UiState>('loading');
  protected readonly refusal = signal('');
  protected readonly failedModules = computed(() => (this.outcomes()?.failed ?? []).join(', '));

  // ----- Export -----
  protected readonly exportDialogOpen = signal(false);

  protected readonly exportConfirmation = computed(() => ({
    classification: 'Organisation figures - no personal details',
    purpose: 'Executive summary of the period',
    scope: `${this.activeScope()?.name ?? ''} · ${this.formatDate(this.rangeStart())} – ${this.formatDate(this.rangeEnd())}`,
    rowFileCount: `${this.filteredMetrics().length} metrics · ${this.trend().length} days · 1 file (TXT)`,
    expiry: 'Saved to this device - no shared link is created',
    auditReference: 'Not recorded - the summary is built in this browser',
  }));

  protected readonly filterAllowed = computed(() => !this.rangeInvalid() && this.uiState() !== 'loading');

  /** Offered once there is something to export. */
  protected readonly exportAllowed = computed(() => this.metrics().length > 0);

  ngOnInit(): void {
    this.api.load().subscribe((page) => this.page.set(page));
    this.fetch();
  }

  // ===== Behaviour =====

  protected selectScope(option: ScopeOption): void {
    this.scopeId.set(option.campaignId);
    this.scopePickerOpen.set(false);
    this.scopeQuery.set('');
  }

  protected toggleScopePicker(): void {
    this.scopePickerOpen.update((v) => !v);
  }

  protected setComparison(key: string): void {
    this.comparisonPeriod.set(key);
  }

  /** A preset sets the period to its own dates, as the server worked them out. */
  protected choosePreset(key: string): void {
    this.savedFilter.set(key);
    const preset = this.savedFilters().find((p) => p.key === key);
    if (preset?.fromDate && preset.toDate) {
      this.rangeStart.set(preset.fromDate);
      this.rangeEnd.set(preset.toDate);
    }
  }

  /** Filter - the period, scope and comparison go to the server; the search narrows the tiles. */
  protected applyFilter(): void {
    if (!this.filterAllowed()) {
      return;
    }
    this.scopePickerOpen.set(false);
    this.appliedSearchTerm.set(this.searchTerm().trim());
    this.fetch();
  }

  protected toggleCompare(): void {
    this.comparisonShown.update((v) => !v);
  }

  /** Drill down - opens the screen the figure is counted from, when the caller may open it. */
  protected drillDown(target: string): void {
    const metric = this.metrics().find((m) => m.key === target);
    if (metric?.route) {
      this.router.navigate([metric.route]);
    }
  }

  protected toggleDefinition(metricKey: string): void {
    this.openDefinition.update((cur) => (cur === metricKey ? null : metricKey));
  }

  protected clearFilters(): void {
    const initial = this.defaultRange();
    if (initial) {
      this.rangeStart.set(initial.from);
      this.rangeEnd.set(initial.to);
    }
    this.scopeId.set(null);
    this.comparisonPeriod.set('previous');
    this.savedFilter.set('');
    this.searchTerm.set('');
    this.appliedSearchTerm.set('');
    this.comparisonShown.set(false);
    this.fetch();
  }

  protected selectRelatedTab(key: string): void {
    this.activeRelatedTab.set(key);
  }

  protected focusPoint(index: number): void {
    this.focusedPoint.set(index);
  }

  protected setUiState(state: UiState): void {
    this.uiState.set(state);
  }

  protected openExportDialog(): void {
    if (!this.exportAllowed()) {
      return;
    }
    this.exportDialogOpen.set(true);
  }

  protected cancelExport(): void {
    this.exportDialogOpen.set(false);
  }

  /** The summary file: the figures on screen, their period, scope and comparison, nothing else. */
  protected confirmExport(): void {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const reference = `EXEC-SUMMARY-${stamp}`;
    const confirmation = this.exportConfirmation();
    const lines = [
      `${this.page()?.viewer?.organisationName ?? ''} — Executive summary`,
      `Scope: ${confirmation.scope}`,
      `Days counted in: ${this.operatingTimeZone()}`,
      `Figures as of: ${this.lastRefresh()}`,
      `Exported: ${this.formatMoment(now)} by ${this.owner()}`,
      '',
      ...this.filteredMetrics().map((m) => `${m.label}: ${m.value} (${m.qualifier})`),
    ];
    this.downloadTextFile(`${reference}.txt`, lines.join('\n'));
    this.lastExport.set({ reference, at: this.formatMoment(now) });
    this.exportDialogOpen.set(false);
    this.uiState.set('success');
  }

  // ===== Loading =====

  private fetch(): void {
    this.uiState.set('loading');
    this.refusal.set('');
    this.api
      .loadOutcomes({
        fromDate: this.rangeStart() || undefined,
        toDate: this.rangeEnd() || undefined,
        campaignId: this.scopeId() ?? undefined,
        comparison: this.comparisonPeriod(),
      })
      .subscribe((outcomes) => {
        if (outcomes.refusal) {
          this.refusal.set(outcomes.refusal);
          this.uiState.set('validation');
          return;
        }
        this.outcomes.set(outcomes);
        if (outcomes.fromDate && outcomes.toDate) {
          this.rangeStart.set(outcomes.fromDate);
          this.rangeEnd.set(outcomes.toDate);
          if (!this.defaultRange()) this.defaultRange.set({ from: outcomes.fromDate, to: outcomes.toDate });
        }
        this.focusedPoint.set(Math.max(0, (outcomes.series?.points.length ?? 1) - 1));
        this.uiState.set(
          !outcomes.metrics.length
            ? outcomes.failed.length ? 'dependency-failure' : 'no-access'
            : outcomes.failed.length
              ? 'dependency-failure'
              : this.filteredMetrics().length === 0
                ? 'empty'
                : 'ready',
        );
      });
  }

  // ===== Wording =====

  /** The qualifier, with the comparison period's figure and the change when there is one. */
  private qualifierOf(metric: DashboardOutcomeMetric): string {
    if (metric.comparisonValue === undefined || metric.comparisonValue === null) {
      return metric.qualifier;
    }
    const before = this.format(metric.comparisonValue, metric.unit, metric.currencyCode);
    const change =
      metric.comparisonValue > 0
        ? ` (${metric.value >= metric.comparisonValue ? '+' : ''}${Math.round(((metric.value - metric.comparisonValue) / metric.comparisonValue) * 100)}%)`
        : '';
    const comparison = this.comparisonOptions().find((o) => o.key === this.comparisonPeriod())?.label.toLowerCase() ?? 'the comparison period';
    return `${metric.qualifier} · ${before} in ${comparison}${change}`;
  }

  /**
   * A figure in its unit, in the platform's money format: whole money in the metric's currency
   * ("₹23,81,600" - an outcome is read, not audited), a grouped count, or a percentage.
   */
  protected format(value: number, unit: DashboardUnit, currency?: string): string {
    if (unit === 'money') return formatMoney(value, currency, { style: 'whole' });
    if (unit === 'percent') return `${Math.round(value)}%`;
    return formatCount(value, 1);
  }

  private downloadTextFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private formatMoment(d: Date): string {
    const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timePart = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${datePart}, ${timePart}`;
  }

  private formatDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ===== Chart geometry (SVG viewBox 0 0 900 300) =====
  private readonly chartW = 900;
  private readonly chartH = 300;
  private readonly pad = { top: 12, right: 12, bottom: 28, left: 12 };

  private readonly primaryPeak = computed(() => Math.max(...this.trend().map((p) => p.primary), 0) || 1);
  private readonly secondaryPeak = computed(() => Math.max(...this.trend().map((p) => p.secondary), 0) || 1);

  private scaleX(i: number): number {
    const usable = this.chartW - this.pad.left - this.pad.right;
    return this.pad.left + (usable * i) / Math.max(this.trend().length - 1, 1);
  }

  private scaleY(value: number, peak: number): number {
    const usable = this.chartH - this.pad.top - this.pad.bottom;
    return this.chartH - this.pad.bottom - (usable * value) / (peak * 1.1);
  }

  protected readonly primaryPath = computed(() =>
    this.trend()
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${this.scaleX(i).toFixed(1)} ${this.scaleY(p.primary, this.primaryPeak()).toFixed(1)}`)
      .join(' '),
  );

  protected readonly secondaryPath = computed(() =>
    this.trend()
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${this.scaleX(i).toFixed(1)} ${this.scaleY(p.secondary, this.secondaryPeak()).toFixed(1)}`)
      .join(' '),
  );

  protected readonly primaryPoints = computed(() =>
    this.trend().map((p, i) => ({ x: this.scaleX(i), y: this.scaleY(p.primary, this.primaryPeak()), point: p, index: i })),
  );

  protected readonly secondaryPoints = computed(() =>
    this.trend().map((p, i) => ({ x: this.scaleX(i), y: this.scaleY(p.secondary, this.secondaryPeak()), point: p, index: i })),
  );

  protected readonly focusX = computed(() => this.scaleX(this.focusedPoint()));

  protected readonly focusedTrend = computed(() => {
    const point = this.trend()[this.focusedPoint()];
    const series = this.outcomes()?.series;
    if (!point || !series) return null;
    return {
      label: point.label,
      primary: this.format(point.primary, series.primaryUnit, series.currencyCode),
      secondary: this.format(point.secondary, series.secondaryUnit, series.currencyCode),
    };
  });
}
