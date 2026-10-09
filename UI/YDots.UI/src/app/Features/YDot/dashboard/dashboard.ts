import { Component, ElementRef, computed, effect, inject, OnInit, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { forkJoin, ObservedValueOf, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthSessionService } from '../../../Shared/services/auth-session.service';
import { AuthTokenService } from '../../../Shared/services/auth-token.service';
import { PaymentApiService } from '../../../Service/payment-api.service';
import { CampaignApiService } from '../../../Service/campaign-api.service';
import { DonorApiService } from '../../../Service/donor-api.service';
import { IamAdminApiService } from '../../../Service/iam-admin-api.service';
import { UserDirectoryApiService } from '../../../Service/user-directory-api.service';
import { AccessRequestApiService } from '../../../Service/access-request-api.service';
import { DonationListItem, DonationStatistics, ReceiptRegisterSummary } from '../../../Shared/models/payment.model';
import { AttributionSummary, CampaignListItem, CampaignStatistics } from '../../../Shared/models/campaign-contract.model';

import { AuditEventResponse } from '../../../Shared/models/iam-contract.model';
import { FollowUp, LeadQueueSummary } from '../../../Shared/models/donor-contract.model';
// SAMPLE DATA - delete with dashboard.mock.ts (see the note at the top of that file).
import { buildDashboardMock, DASHBOARD_MOCK_ENABLED, mockCampaignsForStage } from './dashboard.mock';

interface JourneyStage {
  key: keyof CampaignStatistics;
  label: string;
  count: number;
}

interface AttentionItem {
  label: string;
  hint: string;
  count: number;
  glyph: string;
  route: string;
}

interface TrendDay {
  label: string;
  amount: number;
  count: number;
  height: number;
  isToday: boolean;
}

interface MixRow {
  label: string;
  amount: number;
  count: number;
  share: number;
}

interface CaseRow {
  kind: 'Refund' | 'Chargeback';
  reference: string;
  donor: string;
  amount: string;
  state: string;
  due: string | null;
  urgent: boolean;
}

interface Arc {
  label: string;
  count: number;
  pct: number;
  dash: string;
  offset: number;
  tone: string;
}

interface ChartPoint {
  x: number;
  y: number;
  label: string;
  value: string;
  count: number;
  today: boolean;
}

interface LifecycleSlice {
  label: string;
  count: number;
  tone: 'ok' | 'wait' | 'warn' | 'bad';
}

/**
 * THE DASHBOARD - "Daybook".
 *
 * ONLY FIGURES THE PLATFORM CAN ANSWER. Every number on this page is read from the organisation's
 * own payments, campaign and donor services. It used to carry literals (48.72 lakh, 1,240 donors,
 * a fictional top donor, invented activity) shown identically to every charity, so a new customer
 * saw somebody else's money on the first screen it ever opened. Beneficiaries and stock have no
 * service on this platform yet, so they are not on the page at all rather than shown as a dash.
 *
 * FOUR INDEPENDENT READS. A person who may see donations but not campaigns is a normal shape here,
 * so each section carries its own "unavailable" state; one refused permission never blanks the page.
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
  private readonly paymentApi = inject(PaymentApiService);
  private readonly campaignApi = inject(CampaignApiService);
  private readonly donorApi = inject(DonorApiService);
  private readonly iamApi = inject(IamAdminApiService);
  private readonly userApi = inject(UserDirectoryApiService);
  private readonly accessApi = inject(AccessRequestApiService);

  readonly now = new Date();

  readonly displayName = computed(() => {
    const user = this.tokens.user();
    return user?.displayName || user?.username || '';
  });
  readonly firstName = computed(() => this.displayName().trim().split(/\s+/)[0] ?? '');
  readonly role = computed(() => this.tokens.user()?.roles?.[0] ?? '');
  readonly organisation = this.tokens.organisationName;

  readonly greeting = (() => {
    const hour = this.now.getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  })();

  readonly loading = signal(true);
  readonly donations = signal<DonationStatistics | null>(null);
  readonly campaigns = signal<CampaignStatistics | null>(null);
  readonly donorCount = signal<number | null>(null);
  readonly recent = signal<DonationListItem[] | null>(null);
  readonly running = signal<CampaignListItem[] | null>(null);
  readonly stage =signal<keyof CampaignStatistics>('active');
  readonly stageMenu = signal(false);
  readonly stageCount = computed(() => this.journey().find((j) => j.key === this.stage())?.count ?? 0);
  readonly stageRows = signal<CampaignListItem[] | null>(null);
  readonly stageTotal = signal(0);
  readonly stageLoading = signal(false);
  readonly stageLabel = computed(() => this.journey().find((j) => j.key === this.stage())?.label ?? '');

  /** Show a stage's campaigns inside the tile instead of leaving for the register. */
  pickStage(key: keyof CampaignStatistics): void {
    this.stage.set(key);
    if (DASHBOARD_MOCK_ENABLED) {
      const res = mockCampaignsForStage(key);
      this.stageRows.set(res.items as unknown as CampaignListItem[]);
      this.stageTotal.set(res.totalCount);
      this.stageLoading.set(false);
      return;
    }
    this.stageLoading.set(true);
    this.campaignApi
      .searchCampaigns({ page: 1, pageSize: 6, status: key as never })
      .pipe(catchError(() => of(null)))
      .subscribe((res) => {
        if (this.stage() !== key) return;
        this.stageRows.set(res?.items ?? []);
        this.stageTotal.set(res?.totalCount ?? res?.items?.length ?? 0);
        this.stageLoading.set(false);
      });
  }

  readonly leads = signal<LeadQueueSummary | null>(null);
  readonly receipts = signal<ReceiptRegisterSummary | null>(null);
  readonly sources = signal<AttributionSummary | null>(null);
  readonly openRefunds = signal<number | null>(null);
  readonly openChargebacks = signal<number | null>(null);
  readonly overdueChargebacks = signal<number | null>(null);
  readonly failedEvents = signal<number | null>(null);
  readonly sample = signal<{ items: DonationListItem[]; total: number } | null>(null);
  readonly activity = signal<AuditEventResponse[] | null>(null);
  readonly followUps = signal<FollowUp[] | null>(null);

  /** Overdue follow-ups across the caller's whole scope, counted by the server. */
  private readonly followUpsOverdueCount = signal<number | null>(null);
  readonly cases = signal<CaseRow[] | null>(null);
  readonly activeUsers = signal<number | null>(null);
  readonly invitedUsers = signal<number | null>(null);
  readonly pendingAccess = signal<number | null>(null);

  /** The window the trend, the campaign ranking and the method mix are read from. */
  readonly trendDays = 14;

  /** Whether the sample covers every donation in the window, or only the newest ones. */
  readonly sampleTruncated = computed(() => {
    const s = this.sample();
    return !!s && s.total > s.items.length;
  });

  readonly trend = computed<TrendDay[]>(() => {
    const s = this.sample();
    if (!s) return [];
    const start = this.windowStart();
    const days: TrendDay[] = [];
    for (let i = 0; i < this.trendDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push({
        label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        amount: 0,
        count: 0,
        height: 0,
        isToday: i === this.trendDays - 1,
      });
    }
    for (const item of s.items) {
      if (item.status === 'voided') continue;
      const day = new Date(item.donatedAtUtc);
      day.setHours(0, 0, 0, 0);
      const idx = Math.round((day.getTime() - start.getTime()) / 86_400_000);
      if (idx >= 0 && idx < days.length) {
        days[idx].amount += item.amount.amount;
        days[idx].count += 1;
      }
    }
    const peak = Math.max(...days.map((d) => d.amount), 0);
    days.forEach((d) => (d.height = peak > 0 && d.amount > 0 ? Math.max(4, (d.amount / peak) * 100) : 0));
    return days;
  });

  private readonly sampleCounted = computed(() =>
    (this.sample()?.items ?? []).filter((i) => i.status !== 'voided'),
  );

  readonly windowTotal = computed(() => this.sampleCounted().reduce((t, i) => t + i.amount.amount, 0));
  readonly windowCount = computed(() => this.sampleCounted().length);
  readonly averageGift = computed(() =>
    this.windowCount() ? this.windowTotal() / this.windowCount() : 0,
  );
  readonly largestGift = computed(() =>
    this.sampleCounted().reduce((m, i) => Math.max(m, i.amount.amount), 0),
  );
  readonly currencyCode = computed(() => this.sample()?.items[0]?.amount.currencyCode ?? 'INR');

  private mix(keyOf: (i: DonationListItem) => string, limit: number): MixRow[] {
    const grouped = new Map<string, { amount: number; count: number }>();
    for (const i of this.sampleCounted()) {
      const k = keyOf(i);
      const row = grouped.get(k) ?? { amount: 0, count: 0 };
      row.amount += i.amount.amount;
      row.count += 1;
      grouped.set(k, row);
    }
    const total = this.windowTotal();
    return [...grouped.entries()]
      .map(([label, v]) => ({ label, ...v, share: total > 0 ? (v.amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
  }

  readonly topDonors = computed(() => {
    const rows = this.mix((i) => i.donorName || 'Anonymous', 4);
    const top = Math.max(...rows.map((r) => r.amount), 1);
    return rows.map((r, i) => ({ ...r, rank: i + 1, width: (r.amount / top) * 100 }));
  });
  readonly giftStats = computed(() => {
    const items = this.sampleCounted();
    if (!items.length) return null;
    const total = items.reduce((t, i) => t + i.amount.amount, 0);
    const largest = Math.max(...items.map((i) => i.amount.amount));
    const donors = new Set(items.map((i) => i.donorName || 'Anonymous')).size;
    return { average: total / items.length, largest, donors };
  });
  readonly topCampaigns = computed(() => this.mix((i) => i.campaignName || 'General giving', 5));
  readonly cbHover = signal<number | null>(null);
  readonly campBoard = computed(() => {
    const rows = this.topCampaigns();
    const top = Math.max(...rows.map((r) => r.amount), 1);
    const colours = ['var(--c-ok)', '#3f9d8f', 'var(--c-wait)', '#6b7fd7', '#8a6fd1'];
    return rows.map((r, i) => ({ ...r, rank: i + 1, width: (r.amount / top) * 100, colour: colours[i % colours.length] }));
  });
  readonly methodMix = computed(() =>
    this.mix(
      (i) =>
        i.methodType
          ? i.methodType.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
          : 'Not stated',
      5,
    ),
  );

  /** Open follow-ups, soonest first, so the overdue ones lead - they are the ones being missed. */
  readonly nextFollowUps = computed(() => {
    const list = this.followUps();
    if (!list) return null;
        // The server says which are still open - it used to be guessed from the status word.
    return list
      .filter((f) => f.isOpen)
      .sort(
        (a, b) =>
          (a.dueAtUtc ? new Date(a.dueAtUtc).getTime() : Infinity) -
          (b.dueAtUtc ? new Date(b.dueAtUtc).getTime() : Infinity),
      );
  });
    /**
   * Overdue follow-ups - the server's count, by the organisation's calendar day.
   *
   * IT WAS COUNTED FROM THE FIRST FIFTY ROWS, against the browser's clock: an organisation with
   * more follow-ups than that under-counted, and the figure disagreed with the Follow-up Queue's
   * own Overdue tile for anything due earlier the same day.
   */
  readonly followUpsOverdue = computed(
    () =>
      this.followUpsOverdueCount()
      ?? (this.nextFollowUps() ?? []).filter((f) => f.isOverdue).length,
  );

  /** The four biggest traced channels, each already a share of the TOTAL (untraced gifts included). */
  readonly topChannels = computed(() =>
    [...(this.sources()?.byChannel ?? [])].sort((a, b) => b.amount - a.amount).slice(0, 4),
  );

  /** Hovered channel on the Gift sources ring; the matching arc and row light up while the rest dim. */
  readonly srcHover = signal<number | null>(null);

  /** Channels as ring arcs: each carries its colour, glyph, and where its arc starts on the 100-unit circle. */
  readonly srcBoard = computed(() => {
    const s = this.sources();
    const channels = this.topChannels();
    if (!s) return null;
    const colours = ['#1f7a5c', '#3f9d8f', '#4a97a0', '#6b7fd7'];
    const icon = (l: string) =>
      /whats/i.test(l) ? 'ri-whatsapp-line'
      : /mail/i.test(l) ? 'ri-mail-send-line'
      : /qr|poster|print/i.test(l) ? 'ri-qr-code-line'
      : /web|site|link/i.test(l) ? 'ri-global-line'
      : /sms|text/i.test(l) ? 'ri-message-2-line'
      : /social|insta|face|twit/i.test(l) ? 'ri-share-circle-line'
      : 'ri-radar-line';
    const topAmount = Math.max(...channels.map((c) => c.amount), 1);
    const gap = 0.9;
    let cursor = 0;
    const arcs = channels.map((c, i) => {
      const span = Math.max(c.sharePercentage, 0);
      const arc = { start: cursor, len: Math.max(span - gap, 0.4) };
      cursor += span;
      return {
        key: c.key, label: c.label, share: c.sharePercentage, count: c.donationCount, amount: c.amount,
        colour: colours[i % colours.length], icon: icon(c.label), rel: (c.amount / topAmount) * 100, size: Math.round(46 + Math.sqrt(Math.max(c.sharePercentage, 0)) * 8),
        dash: `${arc.len} ${100 - arc.len}`, offset: 25 - arc.start, lead: i === 0,
      };
    });
    const untraced = Math.max(100 - s.attributionRate, 0);
    const other = Math.max(s.attributionRate - cursor, 0);
    const rest = (start: number, span: number) => ({ dash: `${Math.max(span - gap, 0.4)} ${100 - Math.max(span - gap, 0.4)}`, offset: 25 - start });
    return {
      arcs,
      traced: s.attributionRate,
      untraced,
      untracedArc: rest(cursor + other, untraced),
      untracedSize: Math.round(46 + Math.sqrt(untraced) * 8),
      /** Untraced share scaled against the leading channel, so its ring reads on the same scale as the others. */
      untracedRel: Math.min(untraced / Math.max(channels[0]?.sharePercentage ?? 1, 1), 1) * 100,
      other,
      otherArc: rest(cursor, other),
      untracedGifts: s.unattributedDonations,
      tracedGifts: s.attributedDonations,
    };
  });

  readonly nothingYet = computed(
    () =>
      !this.loading() &&
      (this.donations()?.totalCount ?? 0) === 0 &&
      (this.campaigns()?.total ?? 0) === 0 &&
      (this.donorCount() ?? 0) === 0,
  );

  /** Settled as a share of what was recorded; null at zero so "no donations" never reads as "0% settled". */
  readonly settledShare = computed(() => {
    const d = this.donations();
    return d && d.totalCount > 0 ? Math.round((d.settledCount / d.totalCount) * 100) : null;
  });

  readonly lifecycle = computed<LifecycleSlice[]>(() => {
    const d = this.donations();
    if (!d) return [];
    return [
      { label: 'Settled', count: d.settledCount, tone: 'ok' as const },
      { label: 'Awaiting settlement', count: d.recordedCount, tone: 'wait' as const },
      { label: 'Refunded', count: d.refundedCount, tone: 'warn' as const },
      { label: 'Charged back', count: d.chargedBackCount, tone: 'bad' as const },
    ];
  });
  readonly lifecycleTotal = computed(() => this.lifecycle().reduce((sum, s) => sum + s.count, 0));

  readonly journey = computed<JourneyStage[]>(() => {
    const c = this.campaigns();
    if (!c) return [];
    return [
      { key: 'draft', label: 'Draft', count: c.draft },
      { key: 'submitted', label: 'Submitted', count: c.submitted },
      { key: 'approved', label: 'Approved', count: c.approved },
      { key: 'scheduled', label: 'Scheduled', count: c.scheduled },
      { key: 'active', label: 'Active', count: c.active },
      { key: 'paused', label: 'Paused', count: c.paused },
      { key: 'closing', label: 'Closing', count: c.closing },
      { key: 'closed', label: 'Closed', count: c.closed },
    ];
  });

  /** Only what needs a person, ordered by how much it blocks money. Zero rows are left out. */
  readonly attention = computed<AttentionItem[]>(() => {
    const d = this.donations();
    const c = this.campaigns();
    const items: AttentionItem[] = [];
    if (d) {
      items.push(
        {
          label: 'Receipts to issue',
          hint: 'Donations received without a receipt',
          count: d.awaitingReceiptCount,
          glyph: 'ri-receipt-line',
          route: '/app/donations/payment-event-queue',
        },
        {
          label: 'Not yet reconciled',
          hint: 'Donations not matched to a settlement',
          count: d.unreconciledCount,
          glyph: 'ri-scales-3-line',
          route: '/app/money/finance/reconciliation-workspace',
        },
        {
          label: 'Charged back',
          hint: 'Disputed by the donor’s bank',
          count: d.chargedBackCount,
          glyph: 'ri-error-warning-line',
          route: '/app/money/finance/finance-workbench',
        },
      );
    }
    if ((this.overdueChargebacks() ?? 0) > 0) {
      items.push({
        label: 'Chargebacks past evidence deadline',
        hint: 'Respond before the dispute is lost',
        count: this.overdueChargebacks()!,
        glyph: 'ri-alarm-warning-line',
        route: '/app/money/finance/finance-workbench',
      });
    }
    if ((this.failedEvents() ?? 0) > 0) {
      items.push({
        label: 'Payment events needing review',
        hint: 'Gateway events not yet processed',
        count: this.failedEvents()!,
        glyph: 'ri-flashlight-line',
        route: '/app/donations/payment-event-queue',
      });
    }
    if ((this.openRefunds() ?? 0) > 0) {
      items.push({
        label: 'Open refund requests',
        hint: 'Waiting for a decision',
        count: this.openRefunds()!,
        glyph: 'ri-refund-2-line',
        route: '/app/money/finance/finance-workbench',
      });
    }
    if ((this.pendingAccess() ?? 0) > 0) {
      items.push({
        label: 'Access requests awaiting a decision',
        hint: 'Submitted and not yet decided',
        count: this.pendingAccess()!,
        glyph: 'ri-shield-user-line',
        route: '/app/administration/access/access-request-and-approval',
      });
    }
    if (this.followUpsOverdue() > 0) {
      items.push({
        label: 'Overdue follow-ups',
        hint: 'Past their due time',
        count: this.followUpsOverdue(),
        glyph: 'ri-phone-line',
        route: '/app/fundraising/relationships/follow-up-queue',
      });
    }
    if ((this.leads()?.unassignedLeads ?? 0) > 0) {
      items.push({
        label: 'Leads without an owner',
        hint: 'Assign so they are followed up',
        count: this.leads()!.unassignedLeads,
        glyph: 'ri-user-unfollow-line',
        route: '/app/fundraising/relationships/assignment-board',
      });
    }
    if (c) {
      items.push(
        {
          label: 'Campaigns awaiting approval',
          hint: 'Submitted and not yet approved',
          count: c.submitted,
          glyph: 'ri-file-list-3-line',
          route: '/app/fundraising/campaigns/campaign-register',
        },
        {
          label: 'Paused campaigns',
          hint: 'Not collecting until resumed',
          count: c.paused,
          glyph: 'ri-pause-circle-line',
          route: '/app/fundraising/campaigns/campaign-register',
        },
      );
    }
    return items.filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  });

  readonly donationsUnavailable = computed(() => !this.loading() && !this.donations());
  readonly campaignsUnavailable = computed(() => !this.loading() && !this.campaigns());

  // =============================================================================================
  // Chart geometry. Everything below is drawn from the figures above - no chart library, so the
  // marks take the theme's colours and follow dark mode and the type scale like the rest of the page.
  // =============================================================================================

  readonly updatedAt = signal<Date | null>(null);

  /** True while the sample data is on, so the page can say so. */
  readonly mockOn = DASHBOARD_MOCK_ENABLED;

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

  /** The big area chart: giving per day over the window. */
  readonly chart = computed(() => {
    const days = this.trend();
    const { w: W, h: H } = this.chartBox();
    const L = 48;
    const R = 14;
    const T = 14;
    const B = 28;
    if (!days.length) return null;
    const peak = Math.max(...days.map((d) => d.amount), 0) || 10000;
    const top = this.niceCeil(peak);
    const x = (i: number) => L + (i * (W - L - R)) / Math.max(days.length - 1, 1);
    const y = (v: number) => T + (1 - v / top) * (H - T - B);
    const pts = days.map((d, i) => ({ x: x(i), y: y(d.amount) }));
    const line = this.smooth(pts);
    const area = pts.length
      ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${H - B} L${pts[0].x.toFixed(1)},${H - B} Z`
      : '';
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: y(top * f), label: this.short(top * f) }));
    const points: ChartPoint[] = days.map((d, i) => ({
      x: pts[i].x,
      y: pts[i].y,
      label: d.label,
      value: this.short(d.amount),
      count: d.count,
      today: d.isToday,
    }));
    return { W, H, L, R, B, line, area, grid, points };
  });

  private niceCeil(v: number): number {
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  private spark(values: number[], w = 120, h = 36): { line: string; area: string } {
    if (values.length < 2) return { line: '', area: '' };
    const peak = Math.max(...values, 1);
    const pts = values.map((v, i) => ({
      x: (i * w) / (values.length - 1),
      y: 3 + (1 - v / peak) * (h - 6),
    }));
    const line = this.smooth(pts);
    return { line, area: `${line} L${w},${h} L0,${h} Z` };
  }

  readonly sparkNet = computed(() => this.spark(this.trend().map((d) => d.amount)));
  readonly sparkGifts = computed(() => {
    const counts = this.trend().map((d) => d.count);
    const peak = Math.max(...counts, 1);
    return counts.map((c) => (c / peak) * 100);
  });

  private arcs(rows: { label: string; count: number; tone: string }[]): Arc[] {
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
        };
        acc += pct;
        return arc;
      });
  }

  readonly lifecycleArcs = computed(() =>
    this.arcs(this.lifecycle().map((s) => ({ label: s.label, count: s.count, tone: s.tone }))),
  );

  private readonly palette = ['ok', 'wait', 'warn', 'bad', 'mute'];
  readonly methodArcs = computed(() =>
    this.arcs(
      this.mix(
        (i) =>
          i.methodType
            ? i.methodType.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
            : 'Not stated',
        5,
      ).map((m, i) => ({ label: m.label, count: m.amount, tone: this.palette[i % this.palette.length] })),
    ),
  );

  readonly methodTotal = computed(() => this.methodArcs().reduce((t, a) => t + a.count, 0));
  /** The slice under the pointer (or focused); drives the centre read-out and the tooltip. */
  readonly hoverMethod = signal<Arc | null>(null);
  readonly hoverPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });

  pointMethod(a: Arc | null, ev?: MouseEvent): void {
    this.hoverMethod.set(a);
    if (a && ev) {
      const box = (ev.currentTarget as Element).closest('.dbd-donut')!.getBoundingClientRect();
      this.hoverPos.set({ x: ev.clientX - box.left, y: ev.clientY - box.top });
    }
  }

  readonly receiptRate = computed(() => {
    const r = this.receipts();
    const t = r ? r.successful + r.failed : 0;
    return t > 0 ? Math.round((r!.successful / t) * 100) : null;
  });

  readonly leadFunnel = computed(() => {
    const l = this.leads();
    if (!l) return [];
    const top = Math.max(l.totalLeads, 1);
    return [
      { label: 'All leads', count: l.totalLeads },
      { label: 'Assigned', count: l.assignedLeads },
      { label: 'Hot', count: l.hotLeads },
      { label: 'Converted', count: l.convertedLeads },
    ].map((r) => ({ ...r, width: Math.max((r.count / top) * 100, r.count > 0 ? 3 : 0) }));
  });

  /** Share of all leads that reached each step, for the tapered funnel. */
  readonly funnelSteps = computed(() => {
    const rows = this.leadFunnel();
    const all = rows[0]?.count || 0;
    return rows.map((r, i) => ({
      ...r,
      tone: ['brand', 'wait', 'warn', 'ok'][i] ?? 'ok',
      pct: all > 0 ? Math.round((r.count / all) * 100) : 0,
      span: Math.max(all > 0 ? (r.count / all) * 100 : 0, 64),
    }));
  });
  /** Funnel silhouette: one curved band per step on a 100 x 400 canvas, each as wide as the share of leads that reached it. */
  readonly funnelBands = computed(() => {
    const steps = this.funnelSteps();
    const half = (i: number) => Math.max(steps[Math.min(i, steps.length - 1)]?.pct ?? 0, 16) / 2;
    return steps.map((s, i) => {
      const y0 = i * 100;
      const y1 = y0 + 98.5;
      const ym = (y0 + y1) / 2;
      const a = half(i);
      const b = i === steps.length - 1 ? a * 0.82 : half(i + 1);
      return {
        tone: s.tone,
        d: `M${50 - a} ${y0} C${50 - a} ${ym} ${50 - b} ${ym} ${50 - b} ${y1} L${50 + b} ${y1} C${50 + b} ${ym} ${50 + a} ${ym} ${50 + a} ${y0} Z`,
      };
    });
  });

  readonly conversion = computed(() => {
    const f = this.leadFunnel();
    const all = f[0]?.count || 0;
    return all > 0 ? Math.round(((f[3]?.count ?? 0) / all) * 1000) / 10 : 0;
  });

  /** Needs-attention workload as a ring: one coloured arc per item, sized by its count. */
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

  readonly ldHover = signal<number | null>(null);
  readonly ldStats = computed(() => {
    const rows = this.recent() ?? [];
    const total = rows.reduce((t, r) => t + r.amount.amount, 0);
    const peak = Math.max(...rows.map((r) => r.amount.amount), 1);
    const settled = rows.filter((r) => this.statusTone(r.status) === 'ok').length;
    return { count: rows.length, total, peak, settled };
  });

  readonly stageMax = computed(() => Math.max(...this.journey().map((j) => j.count), 1));

  refresh(): void {
    this.load();
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    const live$ = forkJoin({
      donations: this.paymentApi.getDonationStatistics().pipe(catchError(() => of(null))),
      campaigns: this.campaignApi.getCampaignStatistics().pipe(catchError(() => of(null))),
      donors: this.donorApi.searchDonors({ page: 1, pageSize: 1 }).pipe(catchError(() => of(null))),
      sample: this.paymentApi
        .searchDonations({
          page: 1,
          pageSize: 100,
          donatedFromUtc: this.windowStart().toISOString(),
        })
        .pipe(catchError(() => of(null))),
      activity: this.iamApi
        .searchAuditEvents({ page: 1, pageSize: 8 })
        .pipe(catchError(() => of(null))),
      followUps: this.donorApi
                .getFollowUpPlanner({ page: 1, pageSize: 100 })
        .pipe(catchError(() => of(null))),
      activeUsers: this.userApi
        .searchUsers({ pageIndex: 1, pageSize: 1, status: 'active' })
        .pipe(catchError(() => of(null))),
      invitedUsers: this.userApi
        .searchUsers({ pageIndex: 1, pageSize: 1, status: 'invited' })
        .pipe(catchError(() => of(null))),
      access: this.accessApi
        .search({ status: 'submitted', page: 1, pageSize: 1 })
        .pipe(catchError(() => of(null))),
      running: this.campaignApi
        .searchCampaigns({ page: 1, pageSize: 5, status: 'active' })
        .pipe(catchError(() => of(null))),
      leads: this.donorApi
        .getLeadWorkQueue({ page: 1, pageSize: 1 })
        .pipe(catchError(() => of(null))),
      receipts: this.paymentApi
        .getReceiptRegister({ page: 1, pageSize: 1 })
        .pipe(catchError(() => of(null))),
      sources: this.campaignApi.getAttributionSummary().pipe(catchError(() => of(null))),
      refunds: this.paymentApi
        .searchRefunds({ page: 1, pageSize: 4, openOnly: true })
        .pipe(catchError(() => of(null))),
      chargebacks: this.paymentApi
        .searchChargebacks({ page: 1, pageSize: 4, openOnly: true })
        .pipe(catchError(() => of(null))),
      overdue: this.paymentApi
        .searchChargebacks({ page: 1, pageSize: 1, overdueOnly: true })
        .pipe(catchError(() => of(null))),
      events: this.paymentApi
        .searchPaymentEvents({ page: 1, pageSize: 1, outstandingOnly: true })
        .pipe(catchError(() => of(null))),
    });
    type Feed = ObservedValueOf<typeof live$>;
    const feed$ = DASHBOARD_MOCK_ENABLED ? of(buildDashboardMock() as unknown as Feed) : live$;

    feed$.subscribe((result) => {
      this.donations.set(result.donations);
      this.campaigns.set(result.campaigns);
      this.donorCount.set(result.donors?.totalCount ?? null);
      this.sample.set(
        result.sample ? { items: result.sample.items, total: result.sample.totalCount } : null,
      );
      this.recent.set(result.sample ? this.newestFirst(result.sample.items).slice(0, 6) : null);
      this.activity.set(result.activity?.items ?? null);
            this.followUps.set(result.followUps?.followUps?.items ?? null);
      this.followUpsOverdueCount.set(result.followUps?.summary?.overdue ?? null);
      this.activeUsers.set(result.activeUsers?.totalCount ?? null);
      this.invitedUsers.set(result.invitedUsers?.totalCount ?? null);
      this.pendingAccess.set(result.access?.totalCount ?? null);
      this.cases.set(
        result.refunds || result.chargebacks
          ? [
              ...(result.chargebacks?.items ?? []).map(
                (c): CaseRow => ({
                  kind: 'Chargeback',
                  reference: c.caseReference,
                  donor: c.donorName,
                  amount: c.disputedAmount.display,
                  state: c.statusDescription,
                  due:
                    c.daysUntilEvidenceDue === null
                      ? null
                      : c.daysUntilEvidenceDue < 0
                        ? `${-c.daysUntilEvidenceDue}d overdue`
                        : `${c.daysUntilEvidenceDue}d left`,
                  urgent: c.isOverdue,
                }),
              ),
              ...(result.refunds?.items ?? []).map(
                (r): CaseRow => ({
                  kind: 'Refund',
                  reference: r.caseReference,
                  donor: r.donorName,
                  amount: r.amount.display,
                  state: r.statusDescription,
                  due: null,
                  urgent: false,
                }),
              ),
            ].slice(0, 5)
          : null,
      );
      this.running.set(result.running?.items ?? null);
      this.pickStage(this.stage());
      this.leads.set(result.leads?.summary ?? null);
      this.receipts.set(result.receipts?.summary ?? null);
      this.sources.set(result.sources);
      this.openRefunds.set(result.refunds?.totalCount ?? null);
      this.openChargebacks.set(result.chargebacks?.totalCount ?? null);
      this.overdueChargebacks.set(result.overdue?.totalCount ?? null);
      this.failedEvents.set(result.events?.totalCount ?? null);
      this.updatedAt.set(new Date());
      this.loading.set(false);
    });
  }

  private windowStart(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (this.trendDays - 1));
    return d;
  }

  /** When a campaign starts, ends or ended, worded for the stage the tile is showing. */
  timing(r: { startDate: string; endDate: string }): { text: string; urgent: boolean } {
    const days = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
    const stage = this.stage();
    if (['draft', 'submitted', 'approved', 'scheduled'].includes(stage)) {
      const d = days(r.startDate);
      return { text: d > 0 ? `Starts in ${d}d` : 'Starts today', urgent: false };
    }
    if (stage === 'closed') {
      return { text: `Ended ${new Date(r.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, urgent: false };
    }
    const d = days(r.endDate);
    if (d < 0) return { text: `${-d}d overdue`, urgent: true };
    if (d === 0) return { text: 'Ends today', urgent: true };
    return { text: `${d}d left`, urgent: d <= 14 };
  }

  /** Compact money for chart captions, in the sample's own currency. */
  short(amount: number): string {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: this.currencyCode(),
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(amount);
    } catch {
      return String(Math.round(amount));
    }
  }

  private newestFirst(items: DonationListItem[]): DonationListItem[] {
    return [...items].sort(
      (a, b) => new Date(b.donatedAtUtc).getTime() - new Date(a.donatedAtUtc).getTime(),
    );
  }

  statusTone(status: string): string {
    switch (status) {
      case 'settled':
        return 'ok';
      case 'recorded':
        return 'wait';
      case 'partiallyRefunded':
      case 'refunded':
        return 'warn';
      case 'chargedBack':
        return 'bad';
      default:
        return 'mute';
    }
  }

  /** Where a donation-status slice leads: money still moving goes to the queue, trouble goes to finance. */
  sliceRoute(tone: string): string {
    return tone === 'warn' || tone === 'bad'
      ? '/app/money/finance/finance-workbench'
      : '/app/donations/payment-event-queue';
  }

  /** A share for a meter: never NaN, always 0-100, so an empty organisation still draws a full track. */
  pct(part: number | null | undefined, whole: number | null | undefined): number {
    return whole && whole > 0 && part ? Math.min(100, Math.round((part / whole) * 100)) : 0;
  }

  isLate(iso: string | null | undefined): boolean {
    return !!iso && new Date(iso).getTime() < Date.now();
  }

  /** The last events, bucketed by calendar day so the feed reads as a timeline. */
  readonly activityGroups = computed(() => {
    const events = (this.activity() ?? []).slice(0, 7);
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = day(new Date());
    const groups: { label: string; items: AuditEventResponse[] }[] = [];
    for (const e of events) {
      const d = new Date(e.occurredAtUtc ?? Date.now());
      const diff = Math.round((today - day(d)) / 86400000);
      const label = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(e);
      else groups.push({ label, items: [e] });
    }
    return groups;
  });

  /** A glyph that says what kind of thing happened, picked from the action's wording. */
  actIcon(e: AuditEventResponse): string {
    const t = `${e.actionCode ?? ''} ${e.actionDisplay ?? ''}`.toLowerCase();
    if (/sign|login|logout|auth/.test(t)) return 'ri-login-circle-line';
    if (/approv/.test(t)) return 'ri-checkbox-circle-line';
    if (/reject|den|fail/.test(t)) return 'ri-close-circle-line';
    if (/user|role|permission|access/.test(t)) return 'ri-user-settings-line';
    if (/donat|payment|gateway|refund|receipt/.test(t)) return 'ri-hand-coin-line';
    if (/campaign/.test(t)) return 'ri-megaphone-line';
    if (/lead|donor/.test(t)) return 'ri-user-heart-line';
    if (/creat|add|record/.test(t)) return 'ri-add-circle-line';
    return 'ri-flashlight-line';
  }

  /** Which family an event belongs to, for its colour and label. */
  actKind(e: AuditEventResponse): { key: string; label: string } {
    const t = `${e.actionCode ?? ''} ${e.actionDisplay ?? ''}`.toLowerCase();
    if (/sign|login|logout|auth|password/.test(t)) return { key: 'sec', label: 'Security' };
    if (/user|role|permission|access|approv/.test(t)) return { key: 'access', label: 'Access' };
    if (/donat|payment|gateway|refund|receipt/.test(t)) return { key: 'money', label: 'Payments' };
    if (/campaign/.test(t)) return { key: 'camp', label: 'Campaign' };
    if (/lead|donor/.test(t)) return { key: 'lead', label: 'Relationships' };
    return { key: 'gen', label: 'System' };
  }

  readonly activityStats = computed(() => {
    const ev = (this.activity() ?? []).slice(0, 7);
    const failed = ev.filter((e) => this.auditTone(e.resultDisplay) === 'bad').length;
    const people = new Set(ev.map((e) => e.actorDisplayName || 'System')).size;
    return { total: ev.length, failed, people };
  });

  ago(iso: string | undefined): string {
    if (!iso) return '';
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h}h ago` : '';
  }

  methodIcon(type: string | null | undefined): string {
    const t = (type ?? '').toLowerCase();
    if (/upi/.test(t)) return 'ri-qr-code-line';
    if (/card/.test(t)) return 'ri-bank-card-line';
    if (/net|bank|transfer|neft|rtgs|imps/.test(t)) return 'ri-bank-line';
    if (/cash/.test(t)) return 'ri-money-rupee-circle-line';
    if (/cheque|check/.test(t)) return 'ri-file-list-3-line';
    return 'ri-hand-coin-line';
  }

  /** "Overdue", "Today", "Tomorrow" or "In 3d" for a follow-up's due moment. */
  dueIn(iso: string | null | undefined): string {
    if (!iso) return 'No date';
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((day(new Date(iso)) - day(new Date())) / 86400000);
    if (diff < 0) return `Overdue ${-diff}d`;
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff}d`;
  }

  auditTone(result: string | null | undefined): string {
    return /fail|den|reject|error/i.test(result ?? '') ? 'bad' : 'ok';
  }

  barWidth(count: number): string {
    const total = this.lifecycleTotal();
    return total > 0 ? `${(count / total) * 100}%` : '0%';
  }

  go(route: string): void {
    this.router.navigate([route]);
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
