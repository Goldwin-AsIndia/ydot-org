import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  DonLookupItem,
  DonorListItem,
  DonorListOptions,
  DonorListSummary,
  DonorSearchFilter,
} from '../../../../Shared/models/donor-contract.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { parseCsv } from '../../../../Shared/services/csv';
import { ToastService } from '../../../../Shared/services/toast.service';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
import { formatMoney } from '../../../../Shared/services/money-format';
/**
 * One Donor List row, mapped from `DON /api/v1/donors` (DonorListItem). Contact may arrive
 * masked by the server; `contactMasked` says so.
 */
export interface Donor {
  donorId: string;
  name: string;
  mobile: string;
  email: string;
  campaign: string;
  owner: string;
  ownerUserId: string | null;
  reference: string;
  lastDonationAmount: number;
  lastDonationDate: string;
  /** Received only; pledges are not counted. */
  lifetimeGiving: number;
  /** One of the server's follow-up states: Overdue | Due Today | Tomorrow | Upcoming | None. */
  followUpStatus: string;
  /** One of the server's consent positions. */
  consentStatus: string;
  /** One of the server's identity states. */
  verificationStatus: string;
  consentReviewRequired: boolean;
  createdDate: string;
  /** Prospect | Active | Restricted | Archived | Merged */
  status: string;
  currency: string;
  contactMasked: boolean;
}

type ExportFormat = 'excel' | 'csv' | 'pdf';
type ViewMode = 'table' | 'cards';

interface FilterToken {
  key: string;
  label: string;
  clear: () => void;
}

const ALL = 'all';
const VIEW_KEY = 'ydot.donor-list.view';

/** The tone and icon each "needs attention" shortcut is drawn in - presentation only. */
const ATTENTION_LOOK: Readonly<Record<string, { glyph: string; tone: string }>> = {
  overdue: { glyph: 'ri-alarm-warning-line', tone: 'danger' },
  today: { glyph: 'ri-calendar-event-line', tone: 'warn' },
  unverified: { glyph: 'ri-shield-user-line', tone: 'info' },
  consent: { glyph: 'ri-shield-keyhole-line', tone: 'plum' },
  unowned: { glyph: 'ri-user-unfollow-line', tone: 'slate' },
};

const NO_OPTIONS: DonorListOptions = {
  statusOptions: [],
  followUpStateOptions: [],
  verificationOptions: [],
  consentOptions: [],
  giftPeriodOptions: [],
  sortOptions: [],
  defaultSort: '',
  ownerOptions: [],
  campaignOptions: [],
};

@Component({
  selector: 'app-donor-list',
  standalone: true,
  imports: [RowsPerPage, PageHeader, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:click)': 'onDocumentClick()',
  },
  templateUrl: './donor-list.html',
  styleUrl: './donor-list.css',
})
export class DonorListComponent {
  private readonly api = inject(DonorApiService);
  private readonly tokens = inject(AuthTokenService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchChanges = new Subject<void>();
  private rowsSubscription?: Subscription;

  /**
   * My Donors: the donors whose relationship the caller owns.
   *
   * THE SAME SCREEN, ASKED A NARROWER QUESTION. The route says which list this is; the server
   * decides who "me" is from the token, for the rows, the summary and the export alike.
   */
  protected readonly mineOnly = this.route.snapshot.data['mine'] === true;

  protected readonly heading = this.mineOnly
    ? { title: 'My Donors', subtitle: 'The donors whose relationship you own: what they gave and what needs doing next.' }
    : { title: 'All Donors', subtitle: 'Everyone who has given: what they gave, who looks after them and what needs doing next.' };

  /**
   * ----- Data + async state -----
   *
   * ONE PAGE OF ROWS AT A TIME, FILTERED, SORTED AND COUNTED BY THE SERVER. The list used to
   * download every page and filter, sort and page them here, and offered as filter choices only
   * the words it found on the rows it had loaded. The server applies every filter now (campaign,
   * follow-up, identity, consent and last gift are facts from other tables it works out per row),
   * so the page, the total and the export answer the same question.
   */
  protected readonly donors = signal<Donor[]>([]);
  protected readonly totalRecords = signal(0);

  /** The figures, shortcuts and filter options over the caller's whole scope. Null until it answers. */
  protected readonly summary = signal<DonorListSummary | null>(null);

  private readonly busy = signal(false);
  private readonly failure = signal<string | null>(null);

  protected readonly loading = computed(() => this.busy() && this.donors().length === 0);
  protected readonly refreshing = computed(() => this.busy());
  protected readonly error = computed(() => (this.donors().length === 0 ? this.failure() : null));
  protected readonly lastRefreshed = signal<Date>(new Date());

  // What the caller may do from a row. Each is rechecked by the server when it is used; hiding
  // the control only saves somebody a refusal.
  protected readonly canExport = this.tokens.hasPermission('don.donors.export');
  protected readonly canPlanFollowUp = this.tokens.hasPermission('don.follow-up-planner.schedule-follow-up');
  protected readonly canSeeTimeline = this.tokens.hasPermission('don.lead-work-queue.view');
  protected readonly canAssignOwner = this.tokens.hasPermission('don.assignment-board.view');
  protected readonly canVerifyIdentity = this.tokens.hasPermission('don.donor-identity-verification.view');
  protected readonly canSeeConsent = this.tokens.hasPermission('don.consent-and-preference-centre.view');

  /** ----- View ----- */
  protected readonly viewMode = signal<ViewMode>(this.readView());

  /** ----- Search + filters ----- */
  protected readonly searchTerm = signal('');
  protected readonly attention = signal<string | null>(null);
  protected readonly statusFilter = signal(ALL);
  protected readonly ownerFilter = signal(ALL);
  protected readonly campaignFilter = signal(ALL);
  protected readonly followUpFilter = signal(ALL);
  protected readonly verificationFilter = signal(ALL);
  protected readonly consentFilter = signal(ALL);
  protected readonly giftPeriod = signal(ALL);
  protected readonly filterPanelOpen = signal(false);

  /** Option search appears inside Owner / Campaign only above 20 options. */
  protected readonly ownerOptionSearch = signal('');
  protected readonly campaignOptionSearch = signal('');

  /** ----- Sorting: the server's columns; empty until it answers with its default ----- */
  protected readonly sortColumn = signal<string>('');
  protected readonly sortDirection = signal<'asc' | 'desc'>('desc');

  /** ----- Selection, sheet, menus ----- */
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly previewDonorId = signal<string | null>(null);
  protected readonly openMoreMenuId = signal<string | null>(null);
  protected readonly exportMenuOpen = signal(false);

  /** ----- Pagination ----- */
  protected readonly currentPage = signal(1);
  protected readonly pageSize = signal(10);
  protected readonly pageSizeOptions = [10, 20, 30, 40, 50];

  /** The server's option lists. */
  protected readonly options = computed(() => this.summary()?.options ?? NO_OPTIONS);
  protected readonly ownerOptions = computed(() => this.options().ownerOptions);
  protected readonly campaignOptions = computed(() => this.options().campaignOptions);
  protected readonly followUpOptions = computed(() => this.options().followUpStateOptions);
  protected readonly verificationOptions = computed(() => this.options().verificationOptions);
  protected readonly consentOptions = computed(() => this.options().consentOptions);
  protected readonly giftPeriodOptions = computed(() => this.options().giftPeriodOptions);
  protected readonly sortOptions = computed(() => this.options().sortOptions);

  /** Where the rows are restored to after the selected donor's page changes. */
  private readonly previewCache = new Map<string, Donor>();

  constructor(private readonly router: Router) {
    this.searchChanges
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadRows());
    this.destroyRef.onDestroy(() => this.rowsSubscription?.unsubscribe());

    this.loadSummary();
  }

  /** The figures and the option lists, then the first page in the server's default order. */
  private loadSummary(): void {
    this.busy.set(true);
    this.failure.set(null);

    this.api
      .getDonorSummary(this.mineOnly)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.summary.set(summary);

          if (!this.sortColumn()) {
            const [column, direction] = (summary.options?.defaultSort ?? '').split(' ');
            this.sortColumn.set(column || summary.options?.sortOptions?.[0]?.value || '');
            this.sortDirection.set(direction === 'asc' ? 'asc' : 'desc');
          }

          this.loadRows();
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.failure.set(apiErrorMessage(error, 'The donor list could not be loaded.'));
        },
      });
  }

  /** The search, the filters, the order and the page, as the server's query string. */
  private buildFilter(): DonorSearchFilter {
    const value = (current: string) => (current === ALL ? null : current);
    const sort = this.sortColumn();

    return {
      onlyMine: this.mineOnly || null,
      search: this.searchTerm().trim() || undefined,
      attention: this.attention(),
      status: value(this.statusFilter()),
      relationshipOwnerUserId: value(this.ownerFilter()),
      campaign: value(this.campaignFilter()),
      followUpState: value(this.followUpFilter()),
      verification: value(this.verificationFilter()),
      consent: value(this.consentFilter()),
      giftPeriod: value(this.giftPeriod()),
      sort: sort ? `${sort} ${this.sortDirection()}` : undefined,
    };
  }

  private loadRows(): void {
    this.busy.set(true);
    this.failure.set(null);

    this.rowsSubscription?.unsubscribe();
    this.rowsSubscription = this.api
      .searchDonors({ ...this.buildFilter(), page: this.currentPage(), pageSize: this.pageSize() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          // A page past the end (the set shrank since it was asked for): step back to the last.
          const lastPage = Math.max(1, Math.ceil(page.totalCount / this.pageSize()));
          if (page.items.length === 0 && page.totalCount > 0 && this.currentPage() > lastPage) {
            this.currentPage.set(lastPage);
            this.loadRows();
            return;
          }

          const rows = page.items.map((row) => this.toDonor(row));
          rows.forEach((row) => this.previewCache.set(row.donorId, row));
          this.donors.set(rows);
          this.totalRecords.set(page.totalCount);

          this.busy.set(false);
          this.lastRefreshed.set(new Date());
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.failure.set(apiErrorMessage(error, 'The donor list could not be loaded.'));
        },
      });
  }

  private toDonor(item: DonorListItem): Donor {
    return {
      donorId: item.id,
      name: item.displayName,

      // MASKED BY THE SERVER unless the caller holds the sensitive-contact permission.
      mobile: item.mobileNumber ?? '',
      email: item.emailAddress ?? '',
      campaign: item.campaignName ?? '',
      owner: item.relationshipOwnerName?.trim() ?? '',
      ownerUserId: item.relationshipOwnerUserId,
      reference: item.displayCode,
      lastDonationAmount: item.lastDonationAmount ?? 0,
      lastDonationDate: item.lastDonationAtUtc ?? '',
      lifetimeGiving: item.lifetimeGiving ?? 0,
      followUpStatus: item.followUpStatus ?? '',
      consentStatus: item.consentStatus ?? '',
      verificationStatus: item.verificationStatus ?? '',
      consentReviewRequired: item.consentReviewRequired ?? false,
      createdDate: item.createdAtUtc ?? '',
      status: item.status,
      currency: item.currency,
      contactMasked: item.isContactMasked ?? false,
    };
  }

  /* =================================================================================
     Derived data
     ================================================================================= */

  /** Every donor in the caller's scope, by the server's count. */
  protected readonly donorsOnRecord = computed(() => this.summary()?.donorsOnRecord ?? 0);

  /** Status composition over every record, in the server's lifecycle order - the server's counts. */
  protected readonly statusMix = computed(() => {
    const counts = this.summary()?.statusCounts ?? {};
    const total = this.donorsOnRecord();
    const ordered = this.options().statusOptions.map((option) => option.value);
    const present = Object.keys(counts).filter((status) => counts[status] > 0);
    const known = ordered.filter((status) => present.includes(status));
    const other = present.filter((status) => !ordered.includes(status));
    return [...known, ...other].map((status) => ({
      status,
      label: this.labelIn(this.options().statusOptions, status),
      count: counts[status],
      share: total ? (counts[status] / total) * 100 : 0,
    }));
  });

  /** The two largest statuses for the summary line; the rest are counted as "other". */
  protected readonly statusLead = computed(() =>
    [...this.statusMix()].sort((a, b) => b.count - a.count).slice(0, 2));
  protected readonly statusOther = computed(() =>
    this.donorsOnRecord() - this.statusLead().reduce((sum, s) => sum + s.count, 0));

  /** Money figures over every record - the server's, from the payments module, net of refunds. */
  protected readonly portfolio = computed(() => {
    const summary = this.summary();
    return {
      lifetime: summary?.lifetimeReceived ?? 0,
      givers: summary?.givers ?? 0,
      average: summary?.averagePerGiver ?? 0,
      recentCount: summary?.recentGivers ?? 0,
      recentSum: summary?.recentGiving ?? 0,
      recentDays: summary?.recentWindowDays ?? 0,
      yetToGive: summary?.yetToGive ?? 0,
      currency: summary?.currency ?? '',
    };
  });

  /** The server's "needs attention" shortcuts, with their words, hints and counts. */
  protected readonly attentionItems = computed(() =>
    (this.summary()?.attention ?? []).map((item) => ({
      key: item.value,
      label: item.label,
      hint: item.description,
      count: item.count,
      glyph: ATTENTION_LOOK[item.value]?.glyph ?? 'ri-focus-3-line',
      tone: ATTENTION_LOOK[item.value]?.tone ?? 'slate',
    })));

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalRecords() / this.pageSize())));
  protected readonly effectivePage = computed(() => Math.min(this.currentPage(), this.totalPages()));

  /** The rows on screen - the server's page, exactly. */
  protected readonly paginatedDonors = computed<Donor[]>(() => this.donors());
  protected readonly rangeStart = computed(() =>
    this.totalRecords() === 0 ? 0 : (this.effectivePage() - 1) * this.pageSize() + 1);
  protected readonly rangeEnd = computed(() =>
    Math.min(this.rangeStart() + Math.max(0, this.donors().length - 1), this.totalRecords()));

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

  /** Every applied filter as a removable token, in the server's words. */
  protected readonly filterTokens = computed<FilterToken[]>(() => {
    const tokens: FilterToken[] = [];
    const options = this.options();
    const attention = this.attention();
    if (attention) {
      const item = this.attentionItems().find((a) => a.key === attention);
      tokens.push({ key: 'attention', label: item?.label ?? attention, clear: () => this.setAttention(null) });
    }
    if (this.statusFilter() !== ALL) tokens.push({ key: 'status', label: 'Status: ' + this.labelIn(options.statusOptions, this.statusFilter()), clear: () => this.setStatusFilter(ALL) });
    if (this.ownerFilter() !== ALL) tokens.push({ key: 'owner', label: 'Owner: ' + this.labelIn(options.ownerOptions, this.ownerFilter()), clear: () => this.setFilter(this.ownerFilter, ALL) });
    if (this.campaignFilter() !== ALL) tokens.push({ key: 'campaign', label: 'Campaign: ' + this.labelIn(options.campaignOptions, this.campaignFilter()), clear: () => this.setFilter(this.campaignFilter, ALL) });
    if (this.followUpFilter() !== ALL) tokens.push({ key: 'followup', label: 'Follow-up: ' + this.labelIn(options.followUpStateOptions, this.followUpFilter()), clear: () => this.setFilter(this.followUpFilter, ALL) });
    if (this.verificationFilter() !== ALL) tokens.push({ key: 'identity', label: 'Identity: ' + this.labelIn(options.verificationOptions, this.verificationFilter()), clear: () => this.setFilter(this.verificationFilter, ALL) });
    if (this.consentFilter() !== ALL) tokens.push({ key: 'consent', label: 'Consent: ' + this.labelIn(options.consentOptions, this.consentFilter()), clear: () => this.setFilter(this.consentFilter, ALL) });
    if (this.giftPeriod() !== ALL) tokens.push({ key: 'period', label: this.periodLabel(this.giftPeriod()), clear: () => this.setGiftPeriod(ALL) });
    return tokens;
  });

  /** Count of the filters that live in the Filters panel (drives its dot). */
  protected readonly panelFilterCount = computed(() =>
    [this.ownerFilter(), this.campaignFilter(), this.followUpFilter(), this.verificationFilter(), this.consentFilter(), this.giftPeriod()]
      .filter((v) => v !== ALL).length);

  protected readonly previewDonor = computed<Donor | null>(() => {
    const id = this.previewDonorId();
    return id ? this.donors().find((d) => d.donorId === id) ?? this.previewCache.get(id) ?? null : null;
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

  /** "last gift, descending" - the server's word for the column. */
  protected readonly sortLabel = computed(() => {
    const label = this.labelIn(this.sortOptions(), this.sortColumn()).toLowerCase();
    return label + (this.sortDirection() === 'asc' ? ', ascending' : ', descending');
  });

  /* =================================================================================
     Filter + view actions - each one asks the server again
     ================================================================================= */

  private reload(): void {
    this.currentPage.set(1);
    this.loadRows();
  }

  protected setView(mode: ViewMode): void {
    this.viewMode.set(mode);
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* storage unavailable */ }
  }

  protected onSearchInput(value: string): void {
    this.searchTerm.set(value);
    this.currentPage.set(1);
    this.searchChanges.next();
  }

  protected resetSearch(): void {
    this.searchTerm.set('');
    this.reload();
  }

  protected setAttention(key: string | null): void {
    this.attention.set(this.attention() === key ? null : key);
    this.reload();
  }

  protected setStatusFilter(status: string): void {
    this.statusFilter.set(this.statusFilter() === status ? ALL : status);
    this.reload();
  }

  protected selectStatus(status: string): void {
    this.statusFilter.set(status);
    this.reload();
  }

  protected setFilter(target: { set(value: string): void }, value: string): void {
    target.set(value);
    this.reload();
  }

  protected setGiftPeriod(value: string): void {
    this.giftPeriod.set(value);
    this.reload();
  }

  protected toggleFilterPanel(): void {
    this.filterPanelOpen.update((open) => !open);
  }

  protected searchDropdownOptions(options: readonly DonLookupItem[], term: string, selected: string): readonly DonLookupItem[] {
    if (options.length <= 20) return options;
    const query = term.trim().toLocaleLowerCase();
    return options.filter((o) => o.value === selected || o.label.toLocaleLowerCase().includes(query));
  }

  private resetFilterState(): void {
    this.ownerOptionSearch.set('');
    this.campaignOptionSearch.set('');
    this.attention.set(null);
    this.statusFilter.set(ALL);
    this.ownerFilter.set(ALL);
    this.campaignFilter.set(ALL);
    this.followUpFilter.set(ALL);
    this.verificationFilter.set(ALL);
    this.consentFilter.set(ALL);
    this.giftPeriod.set(ALL);
  }

  protected clearFilters(): void {
    this.resetFilterState();
    this.reload();
  }

  protected clearAll(): void {
    this.resetFilterState();
    this.searchTerm.set('');
    this.reload();
  }

  /* ----- Sorting: a first click starts in the server's direction for the column ----- */
  protected toggleSort(column: string): void {
    if (this.sortColumn() === column) {
      this.sortDirection.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortColumn.set(column);
      const start = this.sortOptions().find((option) => option.value === column)?.description;
      this.sortDirection.set(start === 'asc' ? 'asc' : 'desc');
    }
    this.reload();
  }

  protected setSortColumn(column: string): void {
    if (this.sortColumn() !== column) this.toggleSort(column);
  }

  protected sortIndicator(column: string): 'asc' | 'desc' | 'none' {
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

  /**
   * Assign or reassign the donor's owner, on the Assignment Board's Donors view - the way in for
   * a donor nobody owns.
   */
  protected openAssignmentBoard(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.openMoreMenuId.set(null);
    this.router.navigate(['/app/fundraising/relationships/assignment-board'], {
      // The donor's number as the board's search, so their row is on its first page.
      queryParams: { recordType: 'Donors', donorId: donor.donorId, search: donor.reference },
    });
  }

  /**
   * Export History - one donor's gifts, conversations, follow-ups and ownership, as the server
   * holds them.
   */
  protected exportDonorHistory(donor: Donor, event: Event): void {
    event.stopPropagation();
    this.openMoreMenuId.set(null);

    this.api.exportDonorHistory(donor.donorId).subscribe({
      next: ({ blob, fileName }) => this.saveBlob(blob, fileName),
      error: (error: unknown) =>
        this.toast.show('Not exported', apiErrorMessage(error, 'The donor history could not be exported.'), 'error'),
    });
  }

  protected onRowClick(donor: Donor): void {
    this.openDonor360(donor);
  }

  /** True when the open row menu should unfold upward because there is no room below its trigger. */
  protected readonly moreMenuUp = signal(false);

  protected toggleMoreMenu(donorId: string, event: Event): void {
    event.stopPropagation();
    this.exportMenuOpen.set(false);
    // The menu is ~270px tall; a row near the bottom of the viewport would push it off-screen.
    const trigger = (event.currentTarget ?? event.target) as HTMLElement | null;
    if (trigger?.getBoundingClientRect) {
      const rect = trigger.getBoundingClientRect();
      const room = window.innerHeight - rect.bottom;
      this.moreMenuUp.set(room < 300 && rect.top > room);
    }
    this.openMoreMenuId.set(this.openMoreMenuId() === donorId ? null : donorId);
  }

  /* ----- Header actions ----- */
  protected refresh(): void {
    this.loadSummary();
  }

  protected toggleExportMenu(): void {
    this.openMoreMenuId.set(null);
    this.exportMenuOpen.update((open) => !open);
  }

  protected readonly exporting = signal(false);

  /**
   * Export - the donors in view (or the ticked ones), in a file the server wrote.
   *
   * THE SERVER APPLIES THE SAME FILTERS AND ORDER AS THE LIST, and narrows to the ticked donors
   * when there are any; nothing is filtered here. The file is checked against `don.donors.export`,
   * masked for the caller and logged; this only saves it as CSV, as a workbook, or prints it.
   */
  protected exportData(format: ExportFormat): void {
    this.exportMenuOpen.set(false);
    if (!this.canExport || this.exporting()) return;

    const selected = [...this.selectedIds()];

    // Opened now, inside the click, or the browser treats it as a pop-up and blocks it.
    const printWindow = format === 'pdf' ? window.open('', '_blank') : null;

    this.exporting.set(true);
    this.api
      .exportDonors({ ...this.buildFilter(), donorIds: selected.length > 0 ? selected.join(',') : null })
      .subscribe({
        next: ({ blob, fileName }) => {
          const base = fileName.replace(/\.csv$/i, '');

          if (format === 'csv') {
            this.saveBlob(blob, fileName);
            this.exporting.set(false);
            return;
          }

          void blob.text().then((text) => {
            const [headers = [], ...rows] = parseCsv(text);

            if (format === 'excel') {
              this.downloadExcel(headers, rows, `${base}.xls`);
            } else if (printWindow) {
              this.printAsPdf(printWindow, headers, rows);
            }

            this.exporting.set(false);
          });
        },
        error: (error: unknown) => {
          printWindow?.close();
          this.exporting.set(false);
          this.toast.show('Not exported', apiErrorMessage(error, 'The donor list could not be exported.'), 'error');
        },
      });
  }

  /* ----- Pagination ----- */
  protected goToPage(page: number): void {
    const next = Math.min(Math.max(1, page), this.totalPages());
    if (next === this.currentPage()) return;
    this.currentPage.set(next);
    this.loadRows();
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
    this.reload();
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
     Display helpers - the words are the server's options
     ================================================================================= */

  protected statusOf(donor: Donor): string {
    return donor.status;
  }

  protected statusLabel(status: string): string {
    return this.labelIn(this.options().statusOptions, status);
  }

  protected verificationLabel(donor: Donor): string {
    return this.labelIn(this.options().verificationOptions, donor.verificationStatus);
  }

  protected consentLabel(donor: Donor): string {
    return this.labelIn(this.options().consentOptions, donor.consentStatus);
  }

  protected followUpLabel(donor: Donor): string {
    return this.labelIn(this.options().followUpStateOptions, donor.followUpStatus);
  }

  /** Whether the donor has a follow-up planned at all - the server's "None" state is nothing. */
  protected hasFollowUp(donor: Donor): boolean {
    return !!donor.followUpStatus && donor.followUpStatus !== 'None';
  }

  protected followUpNote(donor: Donor): string {
    return this.descriptionIn(this.options().followUpStateOptions, donor.followUpStatus);
  }

  protected identityNote(donor: Donor): string {
    return this.descriptionIn(this.options().verificationOptions, donor.verificationStatus);
  }

  protected consentNote(donor: Donor): string {
    return this.descriptionIn(this.options().consentOptions, donor.consentStatus);
  }

  protected hasGiven(donor: Donor): boolean {
    return (donor.lifetimeGiving || 0) > 0 || (donor.lastDonationAmount || 0) > 0;
  }

  protected hasOwner(donor: Donor): boolean {
    return !!donor.ownerUserId;
  }

  /** Giving, whole, in the platform's money format: "₹23,81,600". */
  protected formatMoney(value: number, currency?: string): string {
    return formatMoney(value || 0, currency || null, { style: 'whole' });
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

  /** The gift window's sentence ("Gave in the last 30 days"), from the server's options. */
  protected periodLabel(period: string): string {
    const option = this.giftPeriodOptions().find((candidate) => candidate.value === period);
    return option?.description || option?.label || period;
  }

  /* =================================================================================
     Private
     ================================================================================= */

  private labelIn(options: readonly DonLookupItem[], value: string): string {
    return options.find((option) => option.value === value)?.label ?? value;
  }

  private descriptionIn(options: readonly DonLookupItem[], value: string): string {
    return options.find((option) => option.value === value)?.description ?? '';
  }

  private readView(): ViewMode {
    try {
      return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  }

  /** The server's export as a workbook: the same columns, the same rows. */
  private downloadExcel(headers: readonly string[], rows: readonly (readonly string[])[], filename: string): void {
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const head = '<tr>' + headers.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
    const body = rows.map((row) => '<tr>' + row.map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('');
    this.saveBlob(new Blob([`<table>${head}${body}</table>`], { type: 'application/vnd.ms-excel' }), filename);
  }

  /** The server's export on a page: the columns that fit one, read by their headings. */
  private printAsPdf(printWindow: Window, headers: readonly string[], rows: readonly (readonly string[])[]): void {
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const wanted = ['Donor number', 'Name', 'Status', 'Campaign', 'Owner', 'Lifetime received', 'Identity'];
    const columns = wanted.map((name) => headers.indexOf(name)).filter((index) => index >= 0);
    const head = columns.map((index) => `<th>${esc(headers[index])}</th>`).join('');
    const rowsHtml = rows
      .map((row) => `<tr>${columns.map((index) => `<td>${esc(row[index] ?? '')}</td>`).join('')}</tr>`)
      .join('');
    printWindow.document.write(`
      <html>
        <head>
          <title>${esc(this.heading.title)}</title>
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
          <h2>${esc(this.heading.title)}</h2>
          <p>${rows.length} donors · printed ${esc(this.formatDateTime(new Date()))}</p>
          <table>
            <thead><tr>${head}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
