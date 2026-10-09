import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { DonorListItem, DonorListSummary } from '../../../../Shared/models/donor-contract.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { parseCsv, toCsvText } from '../../../../Shared/services/csv';
import { fetchAllPages } from '../../../../Shared/services/paging';
import { ToastService } from '../../../../Shared/services/toast.service';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
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
  /** Overdue | Due Today | Tomorrow | Upcoming | None */
  followUpStatus: string;
  /** Granted | Partial | Withdrawn | Not provided */
  consentStatus: string;
  /** Verified | Pending | Under review | Failed | Expired | Cancelled | Not checked */
  verificationStatus: string;
  consentReviewRequired: boolean;
  createdDate: string;
  /** Prospect | Active | Restricted | Archived | Merged */
  status: string;
  currency: string;
  contactMasked: boolean;
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

// THE ORDER THE FILTER CHIPS ARE DRAWN IN - not the list of chips. Which values exist is read off
// the donors themselves (see `present`), so a chip can never offer a value the server does not
// send. These used to be the chips, and two of them were wrong: "Pending" matched nothing because
// the server sent the enum name, and a follow-up booked for next week had no chip at all.
const FOLLOW_UP_ORDER = ['Overdue', 'Due Today', 'Tomorrow', 'Upcoming', 'None'];
const VERIFICATION_ORDER = ['Verified', 'Pending', 'Under review', 'Failed', 'Expired', 'Cancelled', 'Not checked'];
const CONSENT_ORDER = ['Granted', 'Partial', 'Withdrawn', 'Not provided'];
const VIEW_KEY = 'ydot.donor-list.view';

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

  /**
   * My Donor List: the donors whose relationship the caller owns.
   *
   * THE SAME SCREEN, ASKED A NARROWER QUESTION. The route says which list this is; the server
   * decides who "me" is from the token, for the rows, the summary and the export alike.
   */
  protected readonly mineOnly = this.route.snapshot.data['mine'] === true;

  protected readonly heading = this.mineOnly
    ? { title: 'My Donor List', subtitle: 'The donors whose relationship you own: what they gave and what needs doing next.' }
    : { title: 'Donor List', subtitle: 'Everyone who has given: what they gave, who looks after them and what needs doing next.' };

  /**
   * ----- Data + async state -----
   *
   * READ FROM THE API BY THIS SCREEN. It used to read a shared in-browser store that loaded "the
   * first 200" leads, donors and follow-ups for every screen in the section; the API caps a page
   * at 100, so the 101st donor was missing from the list and from every figure above it.
   */
  protected readonly donors = signal<Donor[]>([]);

  /** The figures over the caller's whole scope, counted by the server. Null until it answers. */
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
  protected readonly pageSize = signal(10);
  protected readonly pageSizeOptions = [10, 20, 30, 40, 50];

  // The filter chips: the values the donors actually carry, in a fixed reading order.
  protected readonly followUpOptions = computed(() =>
    this.present(FOLLOW_UP_ORDER, this.donors().map((d) => d.followUpStatus || 'None')));
  protected readonly verificationOptions = computed(() =>
    this.present(VERIFICATION_ORDER, this.donors().map((d) => this.verificationLabel(d))));
  protected readonly consentOptions = computed(() =>
    this.present(CONSENT_ORDER, this.donors().map((d) => this.consentLabel(d))));

  constructor(private readonly router: Router) {
    this.load();
  }

  /**
   * The rows and the summary, together.
   *
   * EVERY PAGE OF ROWS, because the search, the filters and the sort on this screen work over the
   * whole list; AND THE SUMMARY FROM THE SERVER, because the figures above the list are facts
   * about the organisation's donors (or the caller's own), not about the rows a browser happens
   * to be holding.
   */
  private load(): void {
    this.busy.set(true);
    this.failure.set(null);

    forkJoin({
      rows: fetchAllPages<DonorListItem>((page, pageSize) =>
        this.api.searchDonors({ page, pageSize, onlyMine: this.mineOnly || null })),
      summary: this.api.getDonorSummary(this.mineOnly),
    }).subscribe({
      next: ({ rows, summary }) => {
        this.donors.set(rows.map((row) => this.toDonor(row)));
        this.summary.set(summary);

        // A selection can outlive the rows it was made on: a donor reassigned away is gone.
        const ids = new Set(rows.map((row) => row.id));
        this.selectedIds.update((current) => new Set([...current].filter((id) => ids.has(id))));

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
      owner: item.relationshipOwnerName?.trim() || 'Unassigned',
      ownerUserId: item.relationshipOwnerUserId,
      reference: item.displayCode,
      lastDonationAmount: item.lastDonationAmount ?? 0,
      lastDonationDate: item.lastDonationAtUtc ?? '',
      lifetimeGiving: item.lifetimeGiving ?? 0,
      followUpStatus: item.followUpStatus || 'None',
      consentStatus: item.consentStatus ?? '',
      verificationStatus: item.verificationStatus ?? '',
      consentReviewRequired: item.consentReviewRequired ?? false,

      // WHEN THE RECORD WAS CREATED. This was the last-updated instant under a "created" name.
      createdDate: item.createdAtUtc ?? '',
      status: item.status,
      currency: item.currency || 'INR',
      contactMasked: item.isContactMasked ?? false,
    };
  }

  /* =================================================================================
     Derived data
     ================================================================================= */

  protected readonly ownerOptions = computed(() => this.uniqueSorted(this.donors().map((d) => d.owner)));
  protected readonly campaignOptions = computed(() => this.uniqueSorted(this.donors().map((d) => d.campaign)));

  /** Every donor in the caller's scope, by the server's count. */
  protected readonly donorsOnRecord = computed(() => this.summary()?.donorsOnRecord ?? 0);

  /** Status composition over every record, in lifecycle order - the server's counts. */
  protected readonly statusMix = computed(() => {
    const counts = this.summary()?.statusCounts ?? {};
    const total = this.donorsOnRecord();
    const present = Object.keys(counts).filter((status) => counts[status] > 0);
    const known = STATUS_ORDER.filter((status) => present.includes(status));
    const other = present.filter((status) => !STATUS_ORDER.includes(status));
    return [...known, ...other].map((status) => ({
      status,
      count: counts[status],
      share: total ? (counts[status] / total) * 100 : 0,
    }));
  });

  /** The two largest statuses for the summary line; the rest are counted as "other". */
  protected readonly statusLead = computed(() =>
    [...this.statusMix()].sort((a, b) => b.count - a.count).slice(0, 2));
  protected readonly statusOther = computed(() =>
    this.donorsOnRecord() - this.statusLead().reduce((sum, s) => sum + s.count, 0));

  /**
   * Money figures over every record - the server's, from the payments module, net of refunds.
   *
   * THEY WERE ADDED UP HERE FROM THE LOADED ROWS, and "gave recently" summed each donor's LATEST
   * gift rather than what was received in the period - so somebody who gave three times in the
   * quarter counted once, at the size of their last gift.
   */
  protected readonly portfolio = computed(() => {
    const summary = this.summary();
    return {
      lifetime: summary?.lifetimeReceived ?? 0,
      givers: summary?.givers ?? 0,
      average: summary?.averagePerGiver ?? 0,
      recentCount: summary?.recentGivers ?? 0,
      recentSum: summary?.recentGiving ?? 0,
      recentDays: summary?.recentWindowDays ?? 90,
      yetToGive: summary?.yetToGive ?? 0,
      currency: summary?.currency || 'INR',
    };
  });

  protected readonly attentionItems = computed(() => {
    const summary = this.summary();
    const items: { key: Attention; label: string; hint: string; glyph: string; tone: string; count: number }[] = [
      { key: 'overdue', label: 'Follow-ups overdue', hint: 'Promised contact has slipped', glyph: 'ri-alarm-warning-line', tone: 'danger', count: summary?.followUpsOverdue ?? 0 },
      { key: 'today', label: 'Follow-ups due today', hint: 'Planned for today', glyph: 'ri-calendar-event-line', tone: 'warn', count: summary?.followUpsDueToday ?? 0 },
      { key: 'unverified', label: 'Identity not verified', hint: 'Pending, failed, expired or unchecked', glyph: 'ri-shield-user-line', tone: 'info', count: summary?.identityNotVerified ?? 0 },
      { key: 'consent', label: 'Consent to review', hint: 'A consent expired or was withdrawn', glyph: 'ri-shield-keyhole-line', tone: 'plum', count: summary?.consentToReview ?? 0 },
      { key: 'unowned', label: 'Without an owner', hint: 'Nobody looks after them yet', glyph: 'ri-user-unfollow-line', tone: 'slate', count: summary?.withoutOwner ?? 0 },
    ];
    return items;
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

  /**
   * Assign or reassign the donor's owner, on the Assignment Board's Donors view.
   *
   * THE WAY IN FOR A DONOR NOBODY OWNS. Somebody who gave without ever being a lead arrives with
   * no owner, and the board is where the organisation's administrator gives them one. It is
   * reached from the lead queue for leads; this is the same door for donors.
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
   * holds them. It used to write the donor's single list row to a file, built in the browser.
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
    this.load();
  }

  protected toggleExportMenu(): void {
    this.openMoreMenuId.set(null);
    this.exportMenuOpen.update((open) => !open);
  }

  protected readonly exporting = signal(false);

  /**
   * Export - the donors in view (or the ticked ones), from a file the server wrote.
   *
   * ALL THREE FORMATS START FROM THE SERVER'S EXPORT. They used to be built in the browser from
   * the rows it was holding: no permission check, no masking beyond what the screen happened to
   * show, and no record that anybody had taken a copy of the donor list. The server's file is
   * the export - checked against `don.donors.export`, masked for the caller, and logged - and
   * this re-shapes it: keeps the donors the search, filters or ticks ask for, then saves it as
   * CSV, as a workbook, or sends it to the printer.
   */
  protected exportData(format: ExportFormat): void {
    this.exportMenuOpen.set(false);
    if (!this.canExport || this.exporting()) return;

    const chosen = this.selectedIds().size > 0
      ? this.donors().filter((d) => this.selectedIds().has(d.donorId))
      : this.filteredDonors();
    const wanted = new Set(chosen.map((d) => d.reference));

    // Opened now, inside the click, or the browser treats it as a pop-up and blocks it.
    const printWindow = format === 'pdf' ? window.open('', '_blank') : null;

    this.exporting.set(true);
    this.api.exportDonors({ onlyMine: this.mineOnly || null }).subscribe({
      next: ({ blob, fileName }) => {
        void blob.text().then((text) => {
          const [headers = [], ...all] = parseCsv(text);
          const rows = all.filter((row) => wanted.has(row[0]));
          const base = fileName.replace(/\.csv$/i, '');

          if (format === 'csv') {
            this.saveBlob(new Blob([toCsvText([headers, ...rows])], { type: 'text/csv;charset=utf-8;' }), `${base}.csv`);
          } else if (format === 'excel') {
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
    return donor.status;
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
      case 'Upcoming': return 'A follow-up is planned for a later date.';
      default: return 'Nothing is planned at the moment.';
    }
  }

  protected identityNote(donor: Donor): string {
    switch (donor.verificationStatus) {
      case 'Verified': return 'Identity has been checked and confirmed.';
      case 'Pending': return 'A code has been sent and is awaiting entry.';
      case 'Under review': return 'The check was escalated and is being reviewed.';
      case 'Failed': return 'The last check failed and needs another attempt.';
      case 'Expired': return 'The verification has lapsed and should be renewed.';
      case 'Cancelled': return 'The last check was cancelled before it finished.';
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

  /** The values present among `values`, in `order`; anything unexpected follows, sorted. */
  private present(order: readonly string[], values: readonly string[]): string[] {
    const seen = new Set(values.filter((value) => !!value));
    const known = order.filter((value) => seen.has(value));
    const other = [...seen].filter((value) => !order.includes(value)).sort((a, b) => a.localeCompare(b));
    return [...known, ...other];
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

  /** The server's export as a workbook: the same columns, the same rows. */
  private downloadExcel(headers: readonly string[], rows: readonly (readonly string[])[], filename: string): void {
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const head = '<tr>' + headers.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
    const body = rows.map((row) => '<tr>' + row.map((v) => `<td>${esc(v)}</td>`).join('') + '</tr>').join('');
    this.saveBlob(new Blob([`<table>${head}${body}</table>`], { type: 'application/vnd.ms-excel' }), filename);
  }

  /** The server's export on a page: the seven columns that fit one, read by their headings. */
  private printAsPdf(printWindow: Window, headers: readonly string[], rows: readonly (readonly string[])[]): void {
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const column = (name: string) => headers.indexOf(name);
    const cell = (row: readonly string[], name: string) => (column(name) >= 0 ? row[column(name)] ?? '' : '');
    const money = (row: readonly string[]) => {
      const amount = Number(cell(row, 'Lifetime received'));
      return Number.isFinite(amount) && amount > 0 ? this.formatMoney(amount, cell(row, 'Currency') || 'INR') : '—';
    };
    const rowsHtml = rows.map((row) =>
      `<tr><td>${esc(cell(row, 'Donor number'))}</td><td>${esc(cell(row, 'Name'))}</td><td>${esc(cell(row, 'Status'))}</td>` +
      `<td>${esc(cell(row, 'Campaign') || '—')}</td><td>${esc(cell(row, 'Owner'))}</td>` +
      `<td style="text-align:right">${esc(money(row))}</td>` +
      `<td>${esc(cell(row, 'Identity'))}</td></tr>`).join('');
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

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}
