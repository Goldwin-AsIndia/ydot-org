import { Component, ElementRef, computed, effect, inject, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthSessionService } from '../../../Shared/services/auth-session.service';
import { AuthTokenService } from '../../../Shared/services/auth-token.service';
import { DashboardApiService } from '../../../Service/dashboard-api.service';
import {
  DashboardActivityItem,
  DashboardAttentionItem,
  DashboardHeadline,
  DashboardMeta,
  DashboardPage,
  DashboardPipelineStage,
  DashboardUnit,
} from '../../../Shared/models/dashboard-contract.model';

interface Arc {
  label: string;
  count: number;
  pct: number;
  dash: string;
  offset: number;
  tone: string;
  route?: string;
}

interface ChartPoint {
  x: number;
  y: number;
  label: string;
  value: string;
  tip: string;
  today: boolean;
}

/** A rail card with its small chart already drawn. */
interface RailCard extends DashboardHeadline {
  line: { line: string; area: string } | null;
  bars: { height: number; now: boolean }[];
  split: number[];
}

/**
 * THE DASHBOARD - "Daybook".
 *
 * EVERY FIGURE, LABEL AND LINK COMES FROM THE SERVER. IAM, CAM, DON and PAY each answer one
 * question - what belongs on this person's landing page - and `DashboardApiService` merges the
 * four by the rank each part carries. This component only draws: it holds no figure, no caption,
 * no route and no rule about which role sees what.
 *
 * THE SAME TILES FOR EVERY ROLE, FILLED DIFFERENTLY. An Organisation Admin's Giving curve is the
 * Organisation's money; a Fundraiser's is lead intake; a Donor's is their own giving; the Platform
 * Admin's is sign-ins across the platform. The layout never changes; what fills each tile does.
 *
 * IT USED TO DO ITS OWN SUMS, from the newest hundred donations it fetched, so the curve, the top
 * campaigns and the top supporters were wrong for any Organisation past a hundred gifts a
 * fortnight - and it asked seventeen endpoints, letting the ones a role could not use fail.
 */
@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly sessionService = inject(AuthSessionService);
  private readonly tokens = inject(AuthTokenService);
  private readonly dashboardApi = inject(DashboardApiService);

  readonly now = new Date();

  readonly loading = signal(true);
  readonly page = signal<DashboardPage | null>(null);
  readonly updatedAt = signal<Date | null>(null);

  // =============================================================================================
  // Who is looking
  // =============================================================================================

  readonly viewer = computed(() => this.page()?.viewer ?? null);

  readonly displayName = computed(() => {
    const user = this.tokens.user();
    return this.viewer()?.displayName || user?.displayName || user?.username || '';
  });
  readonly firstName = computed(() => this.displayName().trim().split(/\s+/)[0] ?? '');

  /** The roles as the Organisation names them - "Organisation Admin", not TENANT_ADMIN. */
  readonly role = computed(() => (this.viewer()?.roleNames ?? []).join(' · '));

  readonly organisation = computed(
    () => this.viewer()?.organisationName || this.viewer()?.scopeLabel || this.tokens.organisationName() || '',
  );

  readonly greeting = (() => {
    const hour = this.now.getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  })();

  // =============================================================================================
  // What the services sent
  // =============================================================================================

  readonly actions = computed(() => this.page()?.actions ?? []);
  readonly counters = computed(() => this.page()?.counters ?? []);
  readonly attention = computed(() => this.page()?.attention ?? []);

  private readonly panels = computed(() => this.page()?.panels ?? {});
  readonly trendPanel = computed(() => this.panels().trend ?? null);
  readonly healthPanel = computed(() => this.panels().health ?? null);
  readonly activityPanel = computed(() => this.panels().activity ?? null);
  readonly agendaPanel = computed(() => this.panels().agenda ?? null);
  readonly pipelinePanel = computed(() => this.panels().pipeline ?? null);
  readonly rankingPanel = computed(() => this.panels().ranking ?? null);
  readonly leadersPanel = computed(() => this.panels().leaders ?? null);
  readonly feedPanel = computed(() => this.panels().feed ?? null);
  readonly sourcesPanel = computed(() => this.panels().sources ?? null);
  readonly funnelPanel = computed(() => this.panels().funnel ?? null);

  /** True once loaded with nothing at all to show - a tile then says it is not for this role. */
  readonly settled = computed(() => !this.loading());

  // =============================================================================================
  // The status rail
  // =============================================================================================

  readonly rail = computed<RailCard[]>(() =>
    (this.page()?.headlines ?? []).map((card) => {
      const values = card.spark?.values ?? [];
      const peak = Math.max(...values, 1);
      const kind = card.spark?.kind;
      return {
        ...card,
        line: kind === 'line' ? this.spark(values) : null,
        bars:
          kind === 'bars' || kind === 'stages'
            ? values.map((value, index) => ({
                height: value > 0 ? (value / peak) * 100 : 0,
                now: kind === 'stages' && index === card.spark?.highlightIndex,
              }))
            : [],
        split: kind === 'split' ? values.map((value) => Math.max(value, 0)) : [],
      };
    }),
  );

  // =============================================================================================
  // The large curve
  // =============================================================================================

  /** No point carries anything - the tile shows its empty state over the axis. */
  readonly trendEmpty = computed(() =>
    (this.trendPanel()?.points ?? []).every((point) => point.count === 0 && point.value === 0),
  );

  /**
   * The giving chart is drawn at the size of the space it is given, so it fills its tile instead of
   * keeping a fixed shape with blank bands above and below. The wrapper is measured; the SVG's
   * coordinate system is then 1 unit to 1 CSS pixel, which also keeps the axis text crisp.
   */
  private readonly chartWrap = viewChild<ElementRef<HTMLElement>>('chartWrap');
  readonly chartBox = signal({ w: 640, h: 300 });

  constructor() {
    effect((onCleanup) => {
      const el = this.chartWrap()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (width > 60 && height > 60) {
          this.chartBox.set({ w: Math.round(width), h: Math.round(height) });
        }
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
  }

  /** A smooth path through the points (Catmull-Rom converted to cubic Beziers). */
  private smooth(pts: { x: number; y: number }[]): string {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const lo = Math.min(p1.y, p2.y);
      const hi = Math.max(p1.y, p2.y);
      const c1y = Math.min(hi, Math.max(lo, p1.y + (p2.y - p0.y) / 6));
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = Math.min(hi, Math.max(lo, p2.y - (p3.y - p1.y) / 6));
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }
    return d;
  }

  readonly chart = computed(() => {
    const panel = this.trendPanel();
    if (!panel || !panel.points.length) return null;
    const days = panel.points;
    const { w: W, h: H } = this.chartBox();
    const L = 48;
    const R = 14;
    const T = 14;
    const B = 28;
    const peak = Math.max(...days.map((d) => d.value), 0) || (panel.unit === 'money' ? 10000 : 10);
    const top = this.niceCeil(peak);
    const x = (i: number) => L + (i * (W - L - R)) / Math.max(days.length - 1, 1);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const pts = days.map((d, i) => ({ x: x(i), y: y(d.value) }));
    const line = this.smooth(pts);
    const area = pts.length
      ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${H - B} L${pts[0].x.toFixed(1)},${H - B} Z`
      : '';
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      y: y(top * f),
      label: this.fmt(top * f, panel.unit, panel.currencyCode),
    }));
    const points: ChartPoint[] = days.map((d, i) => {
      const value = this.fmt(d.value, panel.unit, panel.currencyCode);
      const noun = d.count === 1 ? panel.countSingular : panel.countPlural;
      return {
        x: pts[i].x,
        y: pts[i].y,
        label: d.label,
        value,
        tip:
          panel.unit === 'money'
            ? `${d.label}: ${value} from ${d.count} ${noun}`
            : `${d.label}: ${d.count} ${noun}`,
        today: d.isToday,
      };
    });
    return { W, H, L, R, B, line, area, grid, points };
  });

  private niceCeil(v: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  private spark(values: number[], w = 120, h = 36): { line: string; area: string } | null {
    if (values.length < 2) return null;
    const peak = Math.max(...values, 1);
    const pts = values.map((v, i) => ({
      x: (i * w) / (values.length - 1),
      y: 3 + (1 - v / peak) * (h - 6),
    }));
    const line = this.smooth(pts);
    return { line, area: `${line} L${w},${h} L0,${h} Z` };
  }

  // =============================================================================================
  // The breakdown donut
  // =============================================================================================

  readonly healthTotal = computed(() =>
    (this.healthPanel()?.slices ?? []).reduce((sum, slice) => sum + slice.count, 0),
  );

  readonly healthArcs = computed(() =>
    this.arcs((this.healthPanel()?.slices ?? []).map((s) => ({ label: s.label, count: s.count, tone: s.tone, route: s.route }))),
  );

  private arcs(rows: { label: string; count: number; tone: string; route?: string }[]): Arc[] {
    const total = rows.reduce((t, r) => t + r.count, 0);
    if (total === 0) return [];
    let acc = 0;
    return rows
      .filter((r) => r.count > 0)
      .map((r) => {
        const pct = (r.count / total) * 100;
        const arc: Arc = {
          label: r.label,
          count: r.count,
          pct,
          dash: `${Math.max(pct - 1.2, 0.4)} ${100 - Math.max(pct - 1.2, 0.4)}`,
          offset: 25 - acc,
          tone: r.tone,
          route: r.route,
        };
        acc += pct;
        return arc;
      });
  }

  // =============================================================================================
  // Needs attention
  // =============================================================================================

  readonly attnHover = signal<number | null>(null);
  readonly attnRing = computed(() => {
    const items = this.attention().slice(0, 6);
    const total = items.reduce((t, a) => t + a.count, 0);
    const peak = Math.max(...items.map((a) => a.count), 1);
    const colours = ['var(--c-bad)', '#e08a3c', 'var(--c-warn)', 'var(--c-wait)', '#6b7fd7', 'var(--c-ok)'];
    let acc = 0;
    return {
      total,
      rows: items.map((a, i) => {
        const pct = total > 0 ? (a.count / total) * 100 : 0;
        const dash = Math.max(pct - 1.6, 0.5);
        const row = { ...a, pct, colour: colours[i % colours.length], dash: `${dash} ${100 - dash}`, offset: 25 - acc, width: (a.count / peak) * 100 };
        acc += pct;
        return row;
      }),
    };
  });

  /** With nothing waiting, the clear state offers the caller's main shortcut instead. */
  readonly clearAction = computed(() => this.actions()[0] ?? null);

  // =============================================================================================
  // Activity
  // =============================================================================================

  /**
   * The events, bucketed by calendar day so the feed reads as a timeline.
   *
   * "12m ago" IS WORKED OUT HERE, against the moment the page loaded, not in the template against
   * the clock - the clock moves between Angular's render and its development-mode check, and a
   * label that changes in that gap is an ExpressionChanged error.
   */
  readonly activityGroups = computed(() => {
    const events = (this.activityPanel()?.items ?? []).slice(0, 7);
    const loadedAt = (this.updatedAt() ?? this.now).getTime();
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = day(new Date(loadedAt));
    const groups: { label: string; items: (DashboardActivityItem & { ago: string })[] }[] = [];
    for (const raw of events) {
      const e = { ...raw, ago: this.ago(raw.occurredAtUtc, loadedAt) };
      const d = new Date(e.occurredAtUtc);
      const diff = Math.round((today - day(d)) / 86400000);
      const label = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    }
    return groups;
  });

  ago(iso: string | undefined, reference = Date.now()): string {
    if (!iso) return '';
    const m = Math.max(0, Math.round((reference - new Date(iso).getTime()) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h ago` : '';
  }

  // =============================================================================================
  // The pipeline
  // =============================================================================================

  /** The stage the person picked; empty means the one the server opens on. */
  readonly stage = signal('');

  readonly currentStage = computed<DashboardPipelineStage | null>(() => {
    const panel = this.pipelinePanel();
    if (!panel) return null;
    const key = this.stage() || panel.defaultStage;
    return panel.stages.find((s) => s.key === key) ?? panel.stages[0] ?? null;
  });

  readonly stageMax = computed(() => Math.max(...(this.pipelinePanel()?.stages ?? []).map((s) => s.count), 1));

  /** Show a stage's rows inside the tile - every stage arrived with the page, so no call is made. */
  pickStage(key: string): void {
    this.stage.set(key);
  }

  // =============================================================================================
  // Rankings, the feed and the shares
  // =============================================================================================

  readonly cbHover = signal<number | null>(null);
  readonly campBoard = computed(() => {
    const panel = this.rankingPanel();
    const rows = panel?.items ?? [];
    const top = Math.max(...rows.map((r) => r.value), 1);
    const colours = ['var(--c-ok)', '#3f9d8f', 'var(--c-wait)', '#6b7fd7', '#8a6fd1'];
    return rows.map((r, i) => ({ ...r, rank: i + 1, width: (r.value / top) * 100, colour: colours[i % colours.length] }));
  });

  readonly leaderRows = computed(() => {
    const rows = this.leadersPanel()?.items ?? [];
    const top = Math.max(...rows.map((r) => r.value), 1);
    return rows.map((r, i) => ({ ...r, rank: i + 1, width: (r.value / top) * 100 }));
  });

  readonly ldHover = signal<number | null>(null);
  readonly ldPeak = computed(() => Math.max(...(this.feedPanel()?.items ?? []).map((r) => r.value ?? 0), 1));

  /** Hovered channel on the share bar; the matching segment and row light up while the rest dim. */
  readonly srcHover = signal<number | null>(null);

  readonly srcBoard = computed(() => {
    const panel = this.sourcesPanel();
    if (!panel) return null;
    const colours = ['#1f7a5c', '#3f9d8f', '#4a97a0', '#6b7fd7'];
    return {
      arcs: panel.items.map((item, i) => ({ ...item, colour: colours[i % colours.length] })),
      rest: panel.rest ?? null,
    };
  });

  // =============================================================================================
  // Formatting - presentation only
  // =============================================================================================

  /** Compact money for captions, in the panel's currency. */
  short(amount: number, currencyCode = 'INR'): string {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: currencyCode || 'INR',
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(amount);
    } catch {
      return String(Math.round(amount));
    }
  }

  /** A figure in its unit: compact money, a plain count, or a percentage. */
  fmt(value: number | null | undefined, unit: DashboardUnit, currencyCode?: string): string {
    const v = value ?? 0;
    if (unit === 'money') return this.short(v, currencyCode);
    if (unit === 'percent') return `${Math.round(v)}%`;
    return new Intl.NumberFormat('en-IN', {
      notation: Math.abs(v) >= 100000 ? 'compact' : 'standard',
      maximumFractionDigits: 1,
    }).format(v);
  }

  /** A pipeline fact: compact money ahead of its words when it carries an amount ("₹5L goal"). */
  metaText(meta: DashboardMeta): string {
    return meta.amount !== undefined && meta.amount !== null
      ? `${this.short(meta.amount, meta.currencyCode)} ${meta.text}`
      : meta.text;
  }

  /** "1 gift" / "3 gifts" - the nouns come with the panel. */
  counted(count: number, singular: string, plural: string): string {
    return plural ? `${count} ${count === 1 ? singular : plural}` : '';
  }

  /** A share for a meter or a ring: never NaN, always 0-100. */
  pct(value: number | null | undefined): number {
    return value && value > 0 ? Math.min(100, Math.round(value)) : 0;
  }

  // =============================================================================================
  // Loading and navigation
  // =============================================================================================

  refresh(): void {
    this.load();
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.dashboardApi.load().subscribe((page) => {
      this.page.set(page);
      const stages = page.panels.pipeline?.stages ?? [];
      if (this.stage() && !stages.some((s) => s.key === this.stage())) {
        this.stage.set('');
      }
      this.updatedAt.set(new Date());
      this.loading.set(false);
    });
  }

  go(route: string | null | undefined, queryParams?: Record<string, string>): void {
    if (!route) return;
    this.router.navigate([route], queryParams ? { queryParams } : undefined);
  }

  /** Attention rows and the ring segments open the row's own screen, filtered where it can be. */
  open(item: Pick<DashboardAttentionItem, 'route' | 'queryParams'>): void {
    this.go(item.route, item.queryParams);
  }

  signOut(): void {
    this.sessionService.endSession();
    sessionStorage.removeItem('userData');
    sessionStorage.removeItem('loginResponse');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('refreshToken');
    sessionStorage.removeItem('sessionId');
    sessionStorage.removeItem('mfaChallenge');
    sessionStorage.removeItem('challengeToken');
    sessionStorage.removeItem('mfaRemainingAttempts');
    localStorage.removeItem('userData');
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('sessionId');
    this.router.navigate(['/auth/sign-in']);
  }
}
