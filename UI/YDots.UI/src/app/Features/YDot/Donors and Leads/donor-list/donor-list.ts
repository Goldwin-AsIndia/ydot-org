import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  signal,
  untracked,
} from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { WorkflowStateService } from '../../../../Service/workflow-state.service';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

/**
 * One Donor List row, as `WorkflowStateService` maps it from `DON /api/v1/donors`
 * (DonorListItem). Contact may arrive masked by the server; `contactMasked` says so.
 */
export interface Donor {
  donorId: string;
  name: string;
  mobile: string;
  email: string;
  location: string;
  region: string;
  campaign: string;
  owner: string;
  ownerInitials: string;
  ownerColor: string;
  reference: string;
  lastDonationAmount: number;
  lastDonationDate: string;
  /** Received only; pledges are not counted. */
  lifetimeGiving: number;
  /** Overdue | Due Today | Tomorrow | None */
  followUpStatus: string;
  /** Granted | Partial | Withdrawn | Not provided */
  consentStatus: string;
  /** Verified | Pending | Failed | Expired, or empty when never checked */
  verificationStatus: string;
  engagementTag: string;
  consentReviewRequired: boolean;
  createdDate: string;
  /** Prospect | Active | Restricted | Archived | Merged */
  status?: string;
  currency?: string;
  contactMasked?: boolean;
}

type SortableColumn = 'name' | 'lastDonationDate' | 'lifetimeGiving' | 'campaign' | 'owner';
type SortDirection = 'asc' | 'desc';
type ExportFormat = 'excel' | 'csv' | 'pdf';
type ViewMode = 'table' | 'cards';
/** The "needs attention" shortcuts; each narrows the register to one piece of work. */
type Attention = 'overdue' | 'today' | 'unverified' | 'consent' | 'unowned';
type GiftPeriod = 'all' | '30' | '90' | '365' | 'never';

interface FilterToken {
  key: string;
  label: string;
  clear: () => void;
}

/** Lifecycle order for the status composition; unknown values follow in data order. */
const STATUS_ORDER = ['Active', 'Prospect', 'Restricted', 'Archived', 'Merged'];
const FOLLOW_UP_OPTIONS = ['Overdue', 'Due Today', 'Tomorrow', 'None'];
const VERIFICATION_OPTIONS = ['Verified', 'Pending', 'Failed', 'Expired', 'Not checked'];
const CONSENT_OPTIONS = ['Granted', 'Partial', 'Withdrawn', 'Not provided'];
const VIEW_KEY = 'ydot.donor-list.view';

@Component({
  selector: 'app-donor-list',
  standalone: true,
  imports: [PageHeader, DecimalPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:click)': 'onDocumentClick()',
  },
  templateUrl: './donor-list.html',
  styleUrl: './donor-list.css',
})
export class DonorListComponent {
  /** ----- Data + async state (owned by the workflow service) ----- */
  protected readonly donors = computed<Donor[]>(() => this.workflow.donors() as Donor[]);
  protected readonly loading = computed(() => this.workflow.isLoading() && this.donors().length === 0);
  protected readonly refreshing = computed(() => this.workflow.isLoading());
  protected readonly error = computed(() => (this.donors().length === 0 ? this.workflow.loadError() : null));
  protected readonly lastRefreshed = signal<Date>(new Date());

  /** ----- View ----- */
  protected readonly viewMode = signal<ViewMode>(this.readView());

  /** ----- Search + filters ----- */
  protected readonly searchTerm = signal('');
  protected readonly attention = signal<Attention | null>(null);
  protected readonly statusFilter = signal('all');
  protected readonly ownerFilter = signal('all');
  protected readonly campaignFilter = signal('all');
  protected readonly followUpFilter = signal('all');
  protected readonly verificationFilter = signal('all');
  protected readonly consentFilter = signal('all');
  protected readonly giftPeriod = signal<GiftPeriod>('all');
  protected readonly filterPanelOpen = signal(false);

  /** Option search appears inside Owner / Campaign only above 20 options. */
  protected readonly ownerOptionSearch = signal('');
  protected readonly campaignOptionSearch = signal('');

  /** ----- Sorting ----- */
  protected readonly sortColumn = signal<SortableColumn>('lastDonationDate');
  protected readonly sortDirection = signal<SortDirection>('desc');

  /** ----- Selection, sheet, menus ----- */
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly previewDonorId = signal<string | null>(null);
  protected readonly openMoreMenuId = signal<string | null>(null);
  protected readonly exportMenuOpen = signal(false);

  /** ----- Pagination (multiples of 12 so the card grid fills its rows) ----- */
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(12);
  protected readonly pageSizeOptions = [12, 24, 48];

  protected readonly followUpOptions = FOLLOW_UP_OPTIONS;
  protected readonly verificationOptions = VERIFICATION_OPTIONS;
  protected readonly consentOptions = CONSENT_OPTIONS;

  constructor(
    private readonly router: Router,
    private readonly workflow: WorkflowStateService,
  ) {
    // Stamp "Updated" whenever a read settles.
    effect(() => {
      if (!this.workflow.isLoading()) untracked(() => this.lastRefreshed.set(new Date()));
    });
  }

  /* =================================================================================
     Derived data
     ================================================================================= */

  protected readonly ownerOptions = computed(() => this.uniqueSorted(this.donors().map((d) => d.owner)));
  protected readonly campaignOptions = computed(() => this.uniqueSorted(this.donors().map((d) => d.campaign)));

  /** Status composition over every record, in lifecycle order. */
  protected readonly statusMix = computed(() => {
    const list = this.donors();
    const counts = new Map<string, number>();
    for (const donor of list) {
      const status = this.statusOf(donor);
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    const known = STATUS_ORDER.filter((s) => counts.has(s));
    const other = [...counts.keys()].filter((s) => !STATUS_ORDER.includes(s));
    return [...known, ...other].map((status) => ({
      status,
      count: counts.get(status) ?? 0,
      share: list.length ? ((counts.get(status) ?? 0) / list.length) * 100 : 0,
    }));
  });

  /** The two largest statuses for the summary line; the rest are counted as "other". */
  protected readonly statusLead = computed(() =>
    [...this.statusMix()].sort((a, b) => b.count - a.count).slice(0, 2));
  protected readonly statusOther = computed(() =>
    this.donors().length - this.statusLead().reduce((sum, s) => sum + s.count, 0));

  /** Money figures over every record. */
  protected readonly portfolio = computed(() => {
    const list = this.donors();
    const givers = list.filter((d) => (d.lifetimeGiving || 0) > 0);
    const lifetime = givers.reduce((sum, d) => sum + d.lifetimeGiving, 0);
    const since = Date.now() - 90 * 864e5;
    const recent = list.filter((d) => {
      const t = new Date(d.lastDonationDate).getTime();
      return Number.isFinite(t) && t >= since && d.lastDonationAmount > 0;
    });
    return {
      lifetime,
      givers: givers.length,
      average: givers.length ? Math.round(lifetime / givers.length) : 0,
      recentCount: recent.length,
      recentSum: recent.reduce((sum, d) => sum + d.lastDonationAmount, 0),
      currency: this.portfolioCurrency(),
    };
  });

  protected readonly attentionItems = computed(() => {
    const list = this.donors();
    const items: { key: Attention; label: string; hint: string; glyph: string; tone: string }[] = [
      { key: 'overdue', label: 'Follow-ups overdue', hint: 'Promised contact has slipped', glyph: 'ri-alarm-warning-line', tone: 'danger' },
      { key: 'today', label: 'Follow-ups due today', hint: 'Planned for today', glyph: 'ri-calendar-event-line', tone: 'warn' },
      { key: 'unverified', label: 'Identity not verified', hint: 'Pending, failed, expired or unchecked', glyph: 'ri-shield-user-line', tone: 'info' },
      { key: 'consent', label: 'Consent to review', hint: 'A consent expired or was withdrawn', glyph: 'ri-shield-keyhole-line', tone: 'plum' },
      { key: 'unowned', label: 'Without an owner', hint: 'Nobody looks after them yet', glyph: 'ri-user-unfollow-line', tone: 'slate' },
    ];
    return items.map((item) => ({ ...item, count: list.filter((d) => this.needs(d, item.key)).length }));
  });

  /** ----- Search + filter + sort pipeline ----- */
  protected readonly filteredDonors = computed<Donor[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const attention = this.attention();
    const status = this.statusFilter();
    const owner = this.ownerFilter();
    const campaign = this.campaignFilter();
    const followUp = this.followUpFilter();
    const verification = this.verificationFilter();
    const consent = this.consentFilter();
    const period = this.giftPeriod();

    const result = this.donors().filter((d) =>
      (term.length === 0 ||
        [d.donorId, d.reference, d.name, d.mobile, d.email, d.campaign, d.owner]
          .some((field) => (field ?? '').toLowerCase().includes(term))) &&
      (!attention || this.needs(d, attention)) &&
      (status === 'all' || this.statusOf(d) === status) &&
      (owner === 'all' || d.owner === owner) &&
      (campaign === 'all' || d.campaign === campaign) &&
      (followUp === 'all' || (d.followUpStatus || 'None') === followUp) &&
      (verification === 'all' || this.verificationLabel(d) === verification) &&
      (consent === 'all' || (d.consentStatus || 'Not provided') === consent) &&
      this.inGiftPeriod(d, period));

    const col = this.sortColumn();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;
    return [...result].sort((a, b) => {
      switch (col) {
        case 'name': return a.name.localeCompare(b.name) * dir;
        case 'campaign': return (a.campaign || '').localeCompare(b.campaign || '') * dir;
        case 'owner': return (a.owner || '').localeCompare(b.owner || '') * dir;
        case 'lifetimeGiving': return ((a.lifetimeGiving || 0) - (b.lifetimeGiving || 0)) * dir;
        default: {
          // Donors who never gave sort last whichever the direction.
          const ta = new Date(a.lastDonationDate).getTime();
          const tb = new Date(b.lastDonationDate).getTime();
          const va = Number.isFinite(ta) ? ta : null;
          const vb = Number.isFinite(tb) ? tb : null;
          if (va === null && vb === null) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va - vb) * dir;
        }
      }
    });
  });

  protected readonly totalRecords = computed(() => this.filteredDonors().length);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalRecords() / this.pageSize())));
  protected readonly effectivePage = computed(() => Math.min(this.currentPage(), this.totalPages()));
  protected readonly paginatedDonors = computed<Donor[]>(() => {
    const start = (this.effectivePage() - 1) * this.pageSize();
    return this.filteredDonors().slice(start, start + this.pageSize());
  });
  protected readonly rangeStart = computed(() =>
    this.totalRecords() === 0 ? 0 : (this.effectivePage() - 1) * this.pageSize() + 1);
  protected readonly rangeEnd = computed(() => Math.min(this.effectivePage() * this.pageSize(), this.totalRecords()));

  /** Page numbers for the pager, `0` standing for a gap. */
  protected readonly pageList = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.effectivePage();
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const sorted = [...new Set([1, total, current - 1, current, current + 1])]
      .filter((p) => p >= 1 && p <= total)
      .sort((a, b) => a - b);
    const out: number[] = [];
    sorted.forEach((page, i) => {
      if (i > 0 && page - sorted[i - 1] > 1) out.push(0);
      out.push(page);
    });
    return out;
  });

  /** The page's largest lifetime giving, so each row's bar reads relative to it. */
  private readonly pageTopGiving = computed(() =>
    Math.max(1, ...this.paginatedDonors().map((d) => d.lifetimeGiving || 0)));

  protected givingShare(donor: Donor): number {
    return Math.round(((donor.lifetimeGiving || 0) / this.pageTopGiving()) * 100);
  }

  /** Every applied filter as a removable token. */
  protected readonly filterTokens = computed<FilterToken[]>(() => {
    const tokens: FilterToken[] = [];
    const attention = this.attention();
    if (attention) {
      const item = this.attentionItems().find((a) => a.key === attention);
      tokens.push({ key: 'attention', label: item?.label ?? attention, clear: () => this.setAttention(null) });
    }
    if (this.statusFilter() !== 'all') tokens.push({ key: 'status', label: 'Status: ' + this.statusFilter(), clear: () => this.setStatusFilter('all') });
    if (this.ownerFilter() !== 'all') tokens.push({ key: 'owner', label: 'Owner: ' + this.ownerFilter(), clear: () => this.setFilter(this.ownerFilter, 'all') });
    if (this.campaignFilter() !== 'all') tokens.push({ key: 'campaign', label: 'Campaign: ' + this.campaignFilter(), clear: () => this.setFilter(this.campaignFilter, 'all') });
    if (this.followUpFilter() !== 'all') tokens.push({ key: 'followup', label: 'Follow-up: ' + this.followUpFilter(), clear: () => this.setFilter(this.followUpFilter, 'all') });
    if (this.verificationFilter() !== 'all') tokens.push({ key: 'identity', label: 'Identity: ' + this.verificationFilter(), clear: () => this.setFilter(this.verificationFilter, 'all') });
    if (this.consentFilter() !== 'all') tokens.push({ key: 'consent', label: 'Consent: ' + this.consentFilter(), clear: () => this.setFilter(this.consentFilter, 'all') });
    if (this.giftPeriod() !== 'all') tokens.push({ key: 'period', label: this.periodLabel(this.giftPeriod()), clear: () => this.setGiftPeriod('all') });
    return tokens;
  });

  /** Count of the filters that live in the Filters panel (drives its dot). */
  protected readonly panelFilterCount = computed(() =>
    [this.ownerFilter(), this.campaignFilter(), this.followUpFilter(), this.verificationFilter(), this.consentFilter(), this.giftPeriod()]
      .filter((v) => v !== 'all').length);

  protected readonly previewDonor = computed<Donor | null>(() => {
    const id = this.previewDonorId();
    return id ? this.donors().find((d) => d.donorId === id) ?? null : null;
  });

  protected readonly selectedCount = computed(() => this.selectedIds().size);

  protected readonly allOnPageSelected = computed(() => {
    const page = this.paginatedDonors();
    const selected = this.selectedIds();
    return page.length > 0 && page.every((d) => selected.has(d.donorId));
  });

  protected readonly someOnPageSelected = computed(() => {
    const selected = this.selectedIds();
    return !this.allOnPageSelected() && this.paginatedDonors().some((d) => selected.has(d.donorId));
  });

  protected readonly sortLabel = computed(() => {
    const labels: Record<SortableColumn, string> = {
      name: 'name', lastDonationDate: 'last gift', lifetimeGiving: 'lifetime giving', campaign: 'campaign', owner: 'owner',
    };
    return labels[this.sortColumn()] + (this.sortDirection() === 'asc' ? ', ascending' : ', descending');
  });

  /* =================================================================================
     Filter + view actions
     ================================================================================= */

  protected setView(mode: ViewMode): void {
    this.viewMode.set(mode);
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* storage unavailable */ }
  }

  protected onSearchInput(value: string): void {
    this.searchTerm.set(value);
    this.currentPage.set(1);
  }

  protected resetSearch(): void {
    this.searchTerm.set('');
    this.currentPage.set(1);
  }

  protected setAttention(key: Attention | null): void {
    this.attention.set(this.attention() === key ? null : key);
    this.currentPage.set(1);
  }

  protected setStatusFilter(status: string): void {
    this.statusFilter.set(this.statusFilter() === status ? 'all' : status);
    this.currentPage.set(1);
  }

  protected selectStatus(status: string): void {
    this.statusFilter.set(status);
    this.currentPage.set(1);
  }

  protected setFilter(target: { set(value: string): void }, value: string): void {
    target.set(value);
    this.currentPage.set(1);
  }

  protected setGiftPeriod(value: GiftPeriod): void {
    this.giftPeriod.set(value);
    this.currentPage.set(1);
  }

  protected toggleFilterPanel(): void {
    this.filterPanelOpen.update((open) => !open);
  }

  protected searchDropdownOptions(options: string[], term: string, selected: string): string[] {
    if (options.length <= 20) return options;
    const query = term.trim().toLocaleLowerCase();
    return options.filter((o) => o === selected || o.toLocaleLowerCase().includes(query));
  }

  protected clearFilters(): void {
    this.ownerOptionSearch.set('');
    this.campaignOptionSearch.set('');
    this.attention.set(null);
    this.statusFilter.set('all');
    this.ownerFilter.set('all');
    this.campaignFilter.set('all');
    this.followUpFilter.set('all');
    this.verificationFilter.set('all');
    this.consentFilter.set('all');
    this.giftPeriod.set('all');
    this.currentPage.set(1);
  }

  protected clearAll(): void {
    this.clearFilters();
    this.resetSearch();
  }

  /* ----- Sorting ----- */
  protected toggleSort(column: SortableColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set(column === 'name' || column === 'campaign' || column === 'owner' ? 'asc' : 'desc');
    }
  }

  protected setSortColumn(column: SortableColumn): void {
    if (this.sortColumn() !== column) this.toggleSort(column);
  }

  protected sortIndicator(column: SortableColumn): 'asc' | 'desc' | 'none' {
    return this.sortColumn() === column ? this.sortDirection() : 'none';
  }

  /* ----- Selection ----- */
  protected toggleRowSelection(donorId: string, event: Event): void {
    event.stopPropagation();
    this.selectedIds.update((current) => {
      const next = new Set(current);
      if (next.has(donorId)) next.delete(donorId); else next.add(donorId);
      return next;
    });
  }

  protected toggleSelectAllOnPage(): void {
    const page = this.paginatedDonors();
    const allSelected = this.allOnPageSelected();
    this.selectedIds.update((current) => {
      const next = new Set(current);
      for (const donor of page) {
        if (allSelected) next.delete(donor.donorId); else next.add(donor.donorId);
      }
      return next;
    });
  }

  protected isSelected(donorId: string): boolean {
    return this.selectedIds().has(donorId);
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  /* ----- Quick-look sheet ----- */
  protected openPreview(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.openMoreMenuId.set(null);
    this.previewDonorId.set(donor.donorId);
  }

  protected closePreview(): void {
    this.previewDonorId.set(null);
  }

  /* =================================================================================
     Navigation (destinations and query parameters unchanged)
     ================================================================================= */

  protected openDonor360(donor: Donor, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/app/fundraising/relationships/donor-360'], {
      queryParams: { donorId: donor.donorId, tab: 'overview' },
    });
  }

  protected openDonations(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/app/fundraising/relationships/donor-360'], {
      queryParams: { donorId: donor.donorId, tab: 'donations' },
    });
  }

  protected openCommunicationTimeline(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/app/fundraising/relationships/communication-timeline'], {
      queryParams: { donorId: donor.donorId },
    });
  }

  protected openFollowUpPlanner(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/app/don/follow-up-planner'], {
      queryParams: { donorId: donor.donorId, mode: 'create' },
    });
  }

  protected openConsentCentre(donor: Donor, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/app/fundraising/relationships/consent-and-preference-centre'], {
      queryParams: { donorId: donor.donorId },
    });
  }

  protected openIdentityVerification(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/app/don/donor-identity-verification'], {
      queryParams: { donorId: donor.donorId },
    });
  }

  protected exportDonorRecord(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.downloadCsv([donor], `${donor.reference || donor.donorId}.csv`);
    this.openMoreMenuId.set(null);
  }

  protected onRowClick(donor: Donor): void {
    this.openDonor360(donor);
  }

  protected toggleMoreMenu(donorId: string, event: Event): void {
    event.stopPropagation();
    this.exportMenuOpen.set(false);
    this.openMoreMenuId.set(this.openMoreMenuId() === donorId ? null : donorId);
  }

  /* ----- Header actions ----- */
  protected refresh(): void {
    this.workflow.refresh();
  }

  protected toggleExportMenu(): void {
    this.openMoreMenuId.set(null);
    this.exportMenuOpen.update((open) => !open);
  }

  protected exportData(format: ExportFormat): void {
    const rows = this.selectedIds().size > 0
      ? this.donors().filter((d) => this.selectedIds().has(d.donorId))
      : this.filteredDonors();
    if (format === 'csv') this.downloadCsv(rows, 'donor-list.csv');
    else if (format === 'excel') this.downloadExcel(rows, 'donor-list.xls');
    else this.printAsPdf(rows);
    this.exportMenuOpen.set(false);
  }

  /* ----- Pagination ----- */
  protected goToPage(page: number): void {
    this.currentPage.set(Math.min(Math.max(1, page), this.totalPages()));
  }

  protected nextPage(): void {
    this.goToPage(this.effectivePage() + 1);
  }

  protected previousPage(): void {
    this.goToPage(this.effectivePage() - 1);
  }

  protected setPageSize(size: number): void {
    if (!this.pageSizeOptions.includes(size)) return;
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  protected onEscape(): void {
    this.previewDonorId.set(null);
    this.openMoreMenuId.set(null);
    this.exportMenuOpen.set(false);
  }

  protected onDocumentClick(): void {
    this.openMoreMenuId.set(null);
    this.exportMenuOpen.set(false);
  }

  /* =================================================================================
     Display helpers
     ================================================================================= */

  protected statusOf(donor: Donor): string {
    return donor.status || donor.engagementTag || 'Active';
  }

  protected verificationLabel(donor: Donor): string {
    return donor.verificationStatus || 'Not checked';
  }

  protected consentLabel(donor: Donor): string {
    return donor.consentStatus || 'Not provided';
  }

  protected followUpNote(donor: Donor): string {
    switch (donor.followUpStatus) {
      case 'Overdue': return 'A planned follow-up has passed its date.';
      case 'Due Today': return 'A follow-up is planned for today.';
      case 'Tomorrow': return 'A follow-up is planned for tomorrow.';
      default: return 'Nothing is planned at the moment.';
    }
  }

  protected identityNote(donor: Donor): string {
    switch (donor.verificationStatus) {
      case 'Verified': return 'Identity has been checked and confirmed.';
      case 'Pending': return 'A check has started and is awaiting its result.';
      case 'Failed': return 'The last check failed and needs another attempt.';
      case 'Expired': return 'The verification has lapsed and should be renewed.';
      default: return 'Identity has not been checked yet.';
    }
  }

  protected consentNote(donor: Donor): string {
    const base = (() => {
      switch (donor.consentStatus) {
        case 'Granted': return 'Every recorded channel is permitted.';
        case 'Partial': return 'Some channels are permitted, others withdrawn.';
        case 'Withdrawn': return 'Consent is withdrawn on every channel.';
        default: return 'No consent has been recorded yet.';
      }
    })();
    return donor.consentReviewRequired ? base + ' Review needed: a consent expired or changed.' : base;
  }

  protected hasGiven(donor: Donor): boolean {
    return (donor.lifetimeGiving || 0) > 0 || (donor.lastDonationAmount || 0) > 0;
  }

  protected hasOwner(donor: Donor): boolean {
    return !!donor.owner && donor.owner !== 'Unassigned';
  }

  protected formatMoney(value: number, currency = 'INR'): string {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0);
    } catch {
      return `${currency} ${new Intl.NumberFormat('en-IN').format(value || 0)}`;
    }
  }

  /** Compact money for the overview: ₹4.2 L, ₹1.3 Cr for INR; 4.2M style otherwise. */
  protected formatCompact(value: number, currency = 'INR'): string {
    if (currency === 'INR') {
      const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, '');
      if (value >= 1e7) return '₹' + trim(value / 1e7) + ' Cr';
      if (value >= 1e5) return '₹' + trim(value / 1e5) + ' L';
      return this.formatMoney(value, currency);
    }
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
    } catch {
      return this.formatMoney(value, currency);
    }
  }

  protected formatDate(value: string): string {
    if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
  }

  /** "Today", "3 days ago", "5 weeks ago", "4 months ago", "2 years ago". */
  protected relativeDate(value: string): string {
    const t = new Date(value).getTime();
    if (!value || !Number.isFinite(t)) return '';
    const days = Math.floor((Date.now() - t) / 864e5);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    const years = Math.round(days / 365);
    return years === 1 ? 'A year ago' : `${years} years ago`;
  }

  protected formatDateTime(value: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    }).format(value);
  }

  protected initials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  }

  protected periodLabel(period: GiftPeriod): string {
    switch (period) {
      case '30': return 'Gave in the last 30 days';
      case '90': return 'Gave in the last 90 days';
      case '365': return 'Gave in the last 12 months';
      case 'never': return 'Not given yet';
      default: return 'Any time';
    }
  }

  /* =================================================================================
     Private
     ================================================================================= */

  private needs(donor: Donor, key: Attention): boolean {
    switch (key) {
      case 'overdue': return donor.followUpStatus === 'Overdue';
      case 'today': return donor.followUpStatus === 'Due Today';
      case 'unverified': return donor.verificationStatus !== 'Verified';
      case 'consent': return donor.consentReviewRequired;
      case 'unowned': return !this.hasOwner(donor);
    }
  }

  private inGiftPeriod(donor: Donor, period: GiftPeriod): boolean {
    if (period === 'all') return true;
    const t = new Date(donor.lastDonationDate).getTime();
    const gave = Number.isFinite(t) && (donor.lastDonationAmount || 0) > 0;
    if (period === 'never') return !gave;
    return gave && t >= Date.now() - Number(period) * 864e5;
  }

  /** The currency most rows use; the overview totals are only shown in one. */
  private portfolioCurrency(): string {
    const counts = new Map<string, number>();
    for (const d of this.donors()) counts.set(d.currency || 'INR', (counts.get(d.currency || 'INR') ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR';
  }

  private readView(): ViewMode {
    try {
      return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  }

  private uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values.filter((v) => !!v && v !== 'Unassigned'))).sort((a, b) => a.localeCompare(b));
  }

  private exportRow(d: Donor): (string | number)[] {
    return [
      d.reference || d.donorId, d.name, this.statusOf(d), d.mobile, d.email, d.campaign, d.owner,
      d.currency || 'INR', d.lastDonationAmount, d.lastDonationDate, d.lifetimeGiving,
      d.followUpStatus, this.consentLabel(d), this.verificationLabel(d),
    ];
  }

  private readonly exportHeaders = [
    'Donor ID', 'Donor Name', 'Status', 'Mobile', 'Email', 'Campaign', 'Owner', 'Currency',
    'Last Donation Amount', 'Last Donation Date', 'Lifetime Giving', 'Follow-Up Status', 'Consent Status', 'Verification Status',
  ];

  private downloadCsv(rows: Donor[], filename: string): void {
    const lines = rows.map((d) =>
      this.exportRow(d).map((field) => `"${String(field ?? '').replace(/"/g, '""')}"`).join(','));
    this.triggerDownload([this.exportHeaders.join(','), ...lines].join('\r\n'), filename, 'text/csv;charset=utf-8;');
  }

  private downloadExcel(rows: Donor[], filename: string): void {
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const head = '<tr>' + this.exportHeaders.map((h) => `<th>${h}</th>`).join('') + '</tr>';
    const body = rows.map((d) => '<tr>' + this.exportRow(d).map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('');
    this.triggerDownload(`<table>${head}${body}</table>`, filename, 'application/vnd.ms-excel');
  }

  private printAsPdf(rows: Donor[]): void {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const rowsHtml = rows.map((d) =>
      `<tr><td>${esc(d.reference || d.donorId)}</td><td>${esc(d.name)}</td><td>${esc(this.statusOf(d))}</td>` +
      `<td>${esc(d.campaign || '—')}</td><td>${esc(d.owner)}</td>` +
      `<td style="text-align:right">${esc(this.formatMoney(d.lifetimeGiving, d.currency))}</td>` +
      `<td>${esc(this.verificationLabel(d))}</td></tr>`).join('');
    printWindow.document.write(`
      <html>
        <head>
          <title>Donor List</title>
          <style>
            body { font-family: Georgia, serif; padding: 32px; color: #17211c; }
            h2 { font-weight: 600; margin: 0 0 4px; }
            p { font: 12px Arial, sans-serif; color: #5f6b65; margin: 0 0 20px; }
            table { width: 100%; border-collapse: collapse; font: 12px Arial, sans-serif; }
            th { text-align: left; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #5f6b65; border-bottom: 1.5px solid #17211c; padding: 8px; }
            td { border-bottom: 1px solid #e3e6e4; padding: 8px; }
          </style>
        </head>
        <body>
          <h2>Donor List</h2>
          <p>${rows.length} donors · printed ${esc(this.formatDateTime(new Date()))}</p>
          <table>
            <thead><tr><th>Donor ID</th><th>Name</th><th>Status</th><th>Campaign</th><th>Owner</th><th style="text-align:right">Lifetime giving</th><th>Identity</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  private triggerDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
