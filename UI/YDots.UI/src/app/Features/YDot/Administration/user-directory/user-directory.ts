import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Observable, Subject, debounceTime, distinctUntilChanged, finalize, forkJoin, map, shareReplay, takeUntil, tap } from 'rxjs';
import { ToastService } from '../../../../Shared/services/toast.service';
import { UserDirectoryApiService } from '../../../../Service/user-directory-api.service';
import {
  UserDetail,
  UserDirectoryResponse,
  UserListItem,
  UserSearchFilter,
} from '../../../../Shared/models/user-directory.model';
import { LookupItem } from '../../../../Shared/models/api-response.model';
import { UserStatus } from '../../../../Shared/models/iam-contract.model';
import { dialCodeError, employeeNumberError, minLengthError, nameError, phoneWithCodeError, textWithLettersError } from '../../../../Shared/validation/field-rules';

type DialogKind = 'none' | 'view' | 'edit' | 'suspend' | 'reactivate' | 'delete' | 'invite';

/** The folder tabs above the table. `all` is the directory without a status filter. */
type DirectoryTab = 'all' | 'active' | 'invited' | 'suspended' | 'draft';


@Component({
  selector: 'app-user-directory',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './user-directory.html',
  styleUrl: './user-directory.css',
})
export class UserDirectoryComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly api = inject(UserDirectoryApiService);

  private readonly destroy$ = new Subject<void>();
  private readonly searchInput$ = new Subject<string>();

  // ---- Data ---------------------------------------------------------------------------------
  readonly data = signal<UserDirectoryResponse | null>(null);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal('');

  // ---- Filters ------------------------------------------------------------------------------
  searchText = '';
  readonly filter = signal<UserSearchFilter>({ pageIndex: 1, pageSize: 12 });

  // ---- Dialogs -------------------------------------------------------------------------------
  readonly dialog = signal<DialogKind>('none');
  readonly selected = signal<UserListItem | null>(null);
  readonly detail = signal<UserDetail | null>(null);
  readonly detailLoading = signal(false);

  // ---- Bulk selection ------------------------------------------------------------------------
  /** User ids checked in the table for a bulk action. */
  /**
   * The rows checked for a bulk action, keyed by user id.
   *
   * A Map of the rows themselves rather than a Set of ids, so a selection SURVIVES paging,
   * searching and filtering: tick two people on page 1, three on page 2, and Bulk Actions still
   * receives all five - the old code re-read them from the current page and silently dropped
   * the rest.
   */
  readonly selectedUsers = signal<Map<string, UserListItem>>(new Map());

  /** Just the ids, for quick look-ups in the template. */
  readonly selectedIds = computed(() => new Set(this.selectedUsers().keys()));

  readonly bulkSelectionCount = computed(() => this.selectedUsers().size);

  /** Every row on this page is ticked — drives the header checkbox. */
  readonly allOnPageSelected = computed(() => {
    const page = this.users();
    const ids = this.selectedIds();
    return page.length > 0 && page.every((u) => ids.has(u.id ?? ''));
  });

  /** Some, but not all, rows on this page are ticked — the header checkbox shows a dash. */
  readonly someOnPageSelected = computed(() => {
    const ids = this.selectedIds();
    return !this.allOnPageSelected() && this.users().some((u) => ids.has(u.id ?? ''));
  });

  /** Ticked rows that are NOT on the current page, for the selection bar's hint. */
  readonly selectedOffPage = computed(() => {
    const onPage = new Set(this.users().map((u) => u.id ?? ''));
    return [...this.selectedIds()].filter((id) => !onPage.has(id)).length;
  });

  // ---- Tabs, filter panel and page sort -------------------------------------------------------
  /** The status filter that is open, so the matching stat card can light up. */
  readonly activeTab = signal<string>('all');

  // ---- Dossier pane --------------------------------------------------------------------------
  /**
   * The person whose record is open in the pane beside the register. The first row is chosen after
   * every load unless the chosen person is still on the page.
   */
  readonly focusedId = signal<string | null>(null);
  readonly focusDetail = signal<UserDetail | null>(null);
  readonly focusLoading = signal(false);
  readonly focusFailed = signal(false);

  /** Records already fetched this visit, by user id, so going back to somebody is instant. */
  private readonly detailCache = new Map<string, UserDetail>();
  private readonly inFlight = new Map<string, Observable<UserDetail>>();
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;

  /** The list row of the focused person: status and lock-out read from here, so they follow actions at once. */
  readonly focused = computed(() => {
    const id = this.focusedId();
    return id ? this.users().find((user) => user.id === id) ?? null : null;
  });

  /** The status tabs above the results, with the icon each one shows. */
  readonly statusTabs: { key: DirectoryTab; label: string; icon: string }[] = [
    { key: 'all', label: 'Everyone', icon: 'ri-team-line' },
    { key: 'active', label: 'Active', icon: 'ri-checkbox-circle-line' },
    { key: 'invited', label: 'Invited', icon: 'ri-mail-send-line' },
    { key: 'suspended', label: 'Suspended', icon: 'ri-pause-circle-line' },
    { key: 'draft', label: 'Draft', icon: 'ri-draft-line' },
  ];

  /** The real counts, as the server last reported them. */
  readonly statusCounts = signal<Record<DirectoryTab, number>>({
    all: 0,
    active: 0,
    invited: 0,
    suspended: 0,
    draft: 0,
  });

  /**
   * The counts as they are being displayed, mid count-up.
   *
   * The stat cards start at zero and roll up to the real numbers — and roll between numbers on
   * every refresh — which is why the cards read this rather than {@link statusCounts}.
   */
  readonly shownCounts = signal<Record<DirectoryTab, number>>({
    all: 0,
    active: 0,
    invited: 0,
    suspended: 0,
    draft: 0,
  });

  /** Handle of the in-flight count-up animation, so a refresh can cut it short. */
  private countRaf: number | null = null;

  /** The search bar's sliders button opens the filters that did not earn a tab. */
  readonly showAdvancedFilters = signal(false);

  /** Client-side sort of the loaded page by name: asc, then desc, then off. */
  readonly sortDirection = signal<'asc' | 'desc' | 'none'>('none');

  // ---- Custom dropdowns ------------------------------------------------------------------------
  /** Which custom dropdown is open: 'accountCategory' | 'organisationUnitId' | 'roleId' | 'pageSize'. */
  readonly openDropdown = signal<string | null>(null);

  /** Text typed in the open dropdown's search box. */
  readonly dropdownQuery = signal('');

  /** Multiples of 12 split evenly into 2, 3, 4 and 6 card columns, so the last row is never half empty. */
  readonly pageSizes = [12, 24, 48, 96];

  /** Placeholder cards shown while a page loads. */
  readonly skeletons = [1, 2, 3, 4, 5, 6];

  reason = '';
  readonly deleteConfirmation = signal('');
  welcomeMessage = '';

  readonly editForm = signal({
    title: '',
    firstName: '',
    middleName: '',
    lastName: '',
    displayName: '',
    preferredName: '',
    mobileCountryCode: '',
    mobileNumber: '',
    employeeNumber: '',
    designation: '',
    workLocation: '',
    preferredLanguage: 'en-GB',
    timeZoneId: 'UTC',
  });

  /** Set once Save has been pressed, so untouched fields are not shouted at before then. */
  readonly editSubmitted = signal(false);

  /** Per-field complaints the API made about a save (its `errors` list), keyed by field name. */
  private readonly editServerErrors = signal<Record<string, string>>({});

  private static readonly EDIT_LABELS: Record<string, string> = {
    firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', displayName: 'Display name',
    preferredName: 'Preferred name', mobileCountryCode: 'Country code', mobileNumber: 'Mobile',
    employeeNumber: 'Employee number', designation: 'Designation', reason: 'Reason for this change',
  };

  /** What is wrong with each edit-profile field right now (ignores whether Save was pressed). */
  private editRuleErrors(): Record<string, string | null> {
    const f = this.editForm();
    const code = f.mobileCountryCode.trim();
    return {
      firstName: nameError('First name', f.firstName, true, 80),
      middleName: nameError('Middle name', f.middleName, false, 80),
      lastName: nameError('Last name', f.lastName, true, 80),
      displayName: nameError('Display name', f.displayName, true, 160),
      preferredName: nameError('Preferred name', f.preferredName, false, 160),
      mobileCountryCode: dialCodeError('Country code', code)
        ?? (f.mobileNumber.trim() && !code ? 'Enter the country code for this number (for example +91).' : null),
      mobileNumber: code && dialCodeError('Country code', code) ? null : phoneWithCodeError('Mobile', code, f.mobileNumber),
      employeeNumber: employeeNumberError('Employee number', f.employeeNumber, false),
      designation: textWithLettersError('Designation', f.designation, { required: false, max: 120 }),
      reason: minLengthError('Reason for this change', this.reason, 10),
    };
  }

  /** The message to show under an edit-profile field, or null while it is fine (or untouched). */
  editError(field: string): string | null {
    const server = this.editServerErrors()[field];
    if (server) return server;
    return this.editSubmitted() || this.editTouched().has(field) ? (this.editRuleErrors()[field] ?? null) : null;
  }

  private static readonly EDIT_IDS: Record<string, string> = {
    firstName: 'edFirst', middleName: 'edMiddle', lastName: 'edLast', displayName: 'edDisplay',
    preferredName: 'edPreferred', mobileCountryCode: 'edCode', mobileNumber: 'edMobile',
    employeeNumber: 'edEmployee', designation: 'edDesignation', reason: 'edReason',
  };

  private focusEditField(field: string): void {
    const id = UserDirectoryComponent.EDIT_IDS[field];
    if (id) setTimeout(() => (document.getElementById(id) as HTMLElement | null)?.focus());
  }

  /** Fields left at least once; their messages show before Save is pressed. */
  readonly editTouched = signal<ReadonlySet<string>>(new Set());

  touchEdit(field: string): void {
    if (!this.editTouched().has(field)) {
      this.editTouched.update((current) => new Set(current).add(field));
    }
  }

  readonly copiedField = signal('');

  // =========================================================================================
  // Derived
  // =========================================================================================

  readonly users = computed(() => this.data()?.users.items ?? []);

  /** The page in display order — the name column sorts client-side, asc then desc. */
  readonly sortedUsers = computed(() => {
    const rows = [...this.users()];
    const direction = this.sortDirection();

    if (direction === 'none') {
      return rows;
    }

    return rows.sort(
      (a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '') * (direction === 'asc' ? 1 : -1),
    );
  });

  readonly totalCount = computed(() => this.data()?.users.totalCount ?? 0);
  readonly pageIndex = computed(() => this.data()?.users.page ?? 1);
  readonly pageSize = computed(() => this.data()?.users.pageSize ?? 12);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));

  /** First row number on this page — "Showing 11–20 of 42". */
  readonly rangeStart = computed(() =>
    this.totalCount() === 0 ? 0 : (this.pageIndex() - 1) * this.pageSize() + 1,
  );

  /** Last row number on this page. */
  readonly rangeEnd = computed(() =>
    Math.min(this.totalCount(), this.rangeStart() + Math.max(0, this.users().length - 1)),
  );

  readonly statusOptions = computed<LookupItem[]>(() => this.data()?.statusOptions ?? []);
  readonly categoryOptions = computed<LookupItem[]>(() => this.data()?.accountCategoryOptions ?? []);
  readonly unitOptions = computed<LookupItem[]>(() => this.data()?.organisationUnitOptions ?? []);
  readonly roleOptions = computed<LookupItem[]>(() => this.data()?.roleOptions ?? []);

  /**
   * Statuses that don't already have their own tab card (active/invited/suspended/draft) —
   * e.g. expired, deactivated, withdrawn. Rendered as chips behind the sliders button.
   */
  readonly extraStatusOptions = computed<LookupItem[]>(() => {
    const tabStatuses = new Set<string>(['active', 'invited', 'suspended', 'draft']);
    return this.statusOptions().filter((option) => !tabStatuses.has(option.id ?? ''));
  });

  /** What this caller may do, decided by the server from their permissions — not guessed here. */
  readonly permittedActions = computed(() => this.data()?.permittedActions ?? []);

  /**
   * These stay visible until the server has actually said "no".
   *
   * Gating purely on `permittedActions.includes(…)` hides the button whenever `data()` is null —
   * which is also true while the page is loading and after a failed load. Showing it until we
   * know otherwise is the kinder failure: the server still refuses an unauthorised create.
   */
  private readonly loaded = computed(() => this.data() !== null);

  readonly canCreate = computed(() => !this.loaded() || this.permittedActions().includes('Invite'));
  readonly canExport = computed(() => !this.loaded() || this.permittedActions().some((action) => action.startsWith('Export')));

  /** Row-level actions are only drawn once the row exists, so plain gating is right here. */
  readonly canSuspend = computed(() => this.permittedActions().includes('Suspend'));

  readonly filterSummary = computed(() => this.data()?.activeFilterSummary ?? '');
  readonly dataScopeSummary = computed(() => this.data()?.dataScopeSummary ?? '');

  readonly hasActiveFilters = computed(() => {
    const current = this.filter();
    return Boolean(current.search || current.status || current.accountCategory || current.organisationUnitId || current.roleId);
  });

  /** Page numbers around the current one, so the pager stays short on a large directory. */
  readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.pageIndex();
    const from = Math.max(1, current - 2);
    const to = Math.min(total, current + 2);

    return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
  });

  /**
   * True when the record can simply be removed rather than deactivated.
   *
   * Only a DRAFT qualifies: nobody has ever signed in as it, so there is no history to preserve
   * and nothing to attribute. Everything else is deactivated, because a person's actions have to
   * remain traceable to somebody long after they have left.
   */
  readonly isHardDelete = computed(() => this.selected()?.status === 'draft');

  readonly canConfirmDelete = computed(
    () => this.deleteConfirmation().trim().toLowerCase() === (this.selected()?.displayName ?? '').toLowerCase(),
  );

  /** Tone + icon for the centered confirm dialog — drives its accent colour. */
  readonly dialogMeta = computed<{ tone: 'danger' | 'warning' | 'success' | 'primary'; icon: string }>(() => {
    switch (this.dialog()) {
      case 'suspend': return { tone: 'warning', icon: 'ri-forbid-2-line' };
      case 'reactivate': return { tone: 'success', icon: 'ri-play-circle-line' };
      case 'delete': return { tone: 'danger', icon: 'ri-delete-bin-6-line' };
      case 'invite': return { tone: 'primary', icon: 'ri-mail-send-line' };
      default: return { tone: 'primary', icon: 'ri-information-line' };
    }
  });

  // =========================================================================================
  // Lifecycle
  // =========================================================================================

  ngOnInit(): void {
    // Typing fires a request per keystroke without this. 350 ms is long enough to finish a word
    // and short enough that the list still feels live.
    this.searchInput$
      .pipe(debounceTime(350), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((text) => {
        this.filter.update((current) => ({ ...current, search: text || undefined, pageIndex: 1 }));
        this.load();
      });

    this.load();
    this.loadStatusCounts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();

    if (this.countRaf !== null) {
      cancelAnimationFrame(this.countRaf);
    }
    this.cancelPrefetch();
  }

  // =========================================================================================
  // Loading
  // =========================================================================================

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    this.api.getDirectory(this.filter()).subscribe({
      next: (response) => {
        this.data.set(response);
        this.loading.set(false);
        this.keepFocus(response.users.items ?? []);
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.loadFailed.set(true);
        this.errorMessage.set(error.message);
      },
    });
  }

  retry(): void {
    this.load();
  }

  // =========================================================================================
  // Dossier pane
  // =========================================================================================

  /** Opens a person's record in the pane beside the register. */
  focusUser(user: UserListItem): void {
    const id = user.id ?? '';
    if (!id || id === this.focusedId()) {
      return;
    }

    this.focusedId.set(id);

    // Somebody already read (or fetched on hover) opens at once, with no round trip.
    const cached = this.detailCache.get(id);
    if (cached) {
      this.focusDetail.set(cached);
      this.focusLoading.set(false);
      this.focusFailed.set(false);
      return;
    }

    this.loadFocus(id);
  }

  /**
   * Starts fetching a person's record as soon as the pointer rests on their line, so the click that
   * usually follows finds it already there. A short delay keeps a sweep across the list from firing a
   * request per line.
   */
  prefetch(user: UserListItem): void {
    const id = user.id ?? '';
    if (this.prefetchTimer !== null) {
      clearTimeout(this.prefetchTimer);
    }
    if (!id || this.detailCache.has(id) || this.inFlight.has(id)) {
      return;
    }

    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      this.fetchDetail(id).subscribe({ error: () => undefined });
    }, 120);
  }

  cancelPrefetch(): void {
    if (this.prefetchTimer !== null) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
    }
  }

  /** One request per person at a time; the answer is kept for the next time they are opened. */
  private fetchDetail(id: string): Observable<UserDetail> {
    const pending = this.inFlight.get(id);
    if (pending) {
      return pending;
    }

    const request = this.api.getUser(id).pipe(
      tap((detail) => this.detailCache.set(id, detail)),
      finalize(() => this.inFlight.delete(id)),
      shareReplay(1),
      takeUntil(this.destroy$),
    );
    this.inFlight.set(id, request);
    return request;
  }

  /** After a load: keep the open person when they are still on the page, otherwise open the first row. */
  private keepFocus(rows: UserListItem[]): void {
    if (rows.some((user) => user.id === this.focusedId())) {
      return;
    }

    this.focusedId.set(null);
    this.focusDetail.set(null);
    if (rows[0]) {
      this.focusUser(rows[0]);
    }
  }

  /**
   * Reads the focused person's record. The record already on screen STAYS while the next one loads
   * (the template only dims it); swapping it for loading lines made the pane collapse and re-grow on
   * every click, which read as a flicker.
   */
  private loadFocus(id: string): void {
    this.focusLoading.set(true);
    this.focusFailed.set(false);

    this.fetchDetail(id).subscribe({
      next: (detail) => {
        // A quicker click may have moved on to somebody else while this was in flight.
        if (this.focusedId() !== id) {
          return;
        }
        this.focusDetail.set(detail);
        this.focusLoading.set(false);
      },
      error: () => {
        if (this.focusedId() !== id) {
          return;
        }
        this.focusDetail.set(null);
        this.focusLoading.set(false);
        this.focusFailed.set(true);
      },
    });
  }

  // =========================================================================================
  // Filters and paging
  // =========================================================================================

  onSearchChange(value: string): void {
    this.searchText = value;
    this.searchInput$.next(value.trim());
  }

  setFilter(key: keyof UserSearchFilter, value: string): void {
    this.filter.update((current) => ({
      ...current,
      [key]: value || undefined,
      // Any filter change invalidates the current page number.
      pageIndex: 1,
    }));

    this.load();
  }

  clearFilters(): void {
    this.openDropdown.set(null);
    this.searchText = '';
    this.activeTab.set('all');
    this.filter.set({ pageIndex: 1, pageSize: this.pageSize() });
    this.load();
  }

  /** Opens a status filter from one of the stat cards. */
  selectTab(tab: DirectoryTab): void {
    if (tab === this.activeTab()) {
      return;
    }

    this.activeTab.set(tab);
    this.filter.update((current) => ({
      ...current,
      status: tab === 'all' ? undefined : tab,
      pageIndex: 1,
    }));
    this.load();
  }

  toggleAdvancedFilters(): void {
    this.showAdvancedFilters.update((open) => !open);
    this.openDropdown.set(null);
  }

  /** The header's search icon: jumps the pointer to the search box instead of duplicating it. */
  focusSearch(): void {
    document.getElementById('udSearch')?.focus();
  }

  /** A status chosen outside the cards — the chips in the filter panel. */
  setStatus(status: string): void {
    this.activeTab.set(status || 'all');
    this.filter.update((current) => ({ ...current, status: status || undefined, pageIndex: 1 }));
    this.load();
  }

  /** asc → desc → off, so a third click puts the page back the way the server returned it. */
  toggleSort(): void {
    this.sortDirection.update((current) => (current === 'asc' ? 'desc' : current === 'desc' ? 'none' : 'asc'));
  }

  // =========================================================================================
  // Custom dropdowns (replace native <select>)
  // =========================================================================================

  toggleDropdown(key: string): void {
    this.dropdownQuery.set('');
    this.openDropdown.update((current) => (current === key ? null : key));
  }

  /** Picks a value in a filter dropdown; '' means "All …". */
  pickOption(key: string, value: string): void {
    this.openDropdown.set(null);

    if (this.filterValue(key) === String(value ?? '')) {
      return;
    }

    this.setFilter(key as keyof UserSearchFilter, value);
  }

  pickPageSize(size: number): void {
    this.openDropdown.set(null);

    if (size !== this.pageSize()) {
      this.changePageSize(size);
    }
  }

  /**
   * The current value of a filter field, typed for the template.
   * Indexing `filter()[key]` directly in the template fails strict mode (TS7053) because the
   * ng-template context variable is `any`.
   */
  filterValue(key: string): string {
    const value = this.filter()[key as keyof UserSearchFilter];
    return value === undefined || value === null ? '' : String(value);
  }

  /** The text shown on a dropdown's trigger. */
  optionLabel(options: LookupItem[], value: unknown, placeholder: string): string {
    if (!value) {
      return placeholder;
    }

    return options.find((o) => String(o.id) === String(value))?.name ?? placeholder;
  }

  isPicked(value: unknown, id: unknown): boolean {
    return !!value && String(value) === String(id);
  }

  /** Options narrowed by the search box inside the open dropdown. */
  filterOptions(options: LookupItem[]): LookupItem[] {
    const q = this.dropdownQuery().trim().toLowerCase();
    return q ? options.filter((o) => (o.name ?? '').toLowerCase().includes(q)) : options;
  }

  /** Any click outside a dropdown closes it — clicks inside stop propagation in the template. */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openDropdown() !== null) {
      this.openDropdown.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openDropdown.set(null);
  }

  // =========================================================================================
  // Status counts
  // =========================================================================================

  /**
   * Counts for the tab badges, read straight off the search endpoint with a page of one.
   * Deliberately cosmetic — a failed count leaves the tabs working and the badges blank.
   */
  private loadStatusCounts(): void {
    const countFor = (status?: UserStatus) =>
      this.api.searchUsers({ pageIndex: 1, pageSize: 1, status }).pipe(map((page) => page.totalCount ?? 0));

    forkJoin({
      all: countFor(),
      active: countFor('active'),
      invited: countFor('invited'),
      suspended: countFor('suspended'),
      draft: countFor('draft'),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (counts) => {
          this.statusCounts.set(counts);
          this.animateCounts(counts);
        },
        error: () => {
          const zeros = { all: 0, active: 0, invited: 0, suspended: 0, draft: 0 };
          this.statusCounts.set(zeros);
          this.shownCounts.set(zeros);
        },
      });
  }

  /** Rolls the stat cards from their current numbers to the new ones (700 ms ease-out). */
  private animateCounts(target: Record<DirectoryTab, number>): void {
    if (this.countRaf !== null) {
      cancelAnimationFrame(this.countRaf);
    }

    const from = { ...this.shownCounts() };
    const startedAt = performance.now();
    const duration = 700;

    const tick = (now: number): void => {
      const t = Math.min(1, (now - startedAt) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const next = { all: 0, active: 0, invited: 0, suspended: 0, draft: 0 };

      (Object.keys(next) as DirectoryTab[]).forEach((key) => {
        next[key] = Math.round(from[key] + (target[key] - from[key]) * ease);
      });
      this.shownCounts.set(next);

      this.countRaf = t < 1 ? requestAnimationFrame(tick) : null;
    };

    this.countRaf = requestAnimationFrame(tick);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.pageIndex()) {
      return;
    }

    this.filter.update((current) => ({ ...current, pageIndex: page }));
    this.load();
  }

  changePageSize(size: number): void {
    this.filter.update((current) => ({ ...current, pageSize: size, pageIndex: 1 }));
    this.load();
  }

  // =========================================================================================
  // Navigation
  // =========================================================================================

  openProfile(user: UserListItem): void {
    // Pass the row along in router state so the profile page can render the selected
    // user immediately, and still has data to show if the detail API call fails.
    void this.router.navigate(['/app/administration/access/user-profile-and-access', (user.id ?? '')], {
      state: { userData: user },
    });
  }

  createUser(): void {
    void this.router.navigate(['/app/administration/access/create-user']);
  }

  // =========================================================================================
  // Bulk selection
  // =========================================================================================

  toggleRowSelection(user: UserListItem): void {
    const id = user.id ?? '';
    if (!id) {
      return;
    }

    this.selectedUsers.update((current) => {
      const next = new Map(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.set(id, user);
      }
      return next;
    });
  }

  /** Header checkbox: ticks the whole page, or clears it when it is already all ticked. */
  toggleAllOnPage(): void {
    const selectAll = !this.allOnPageSelected();

    this.selectedUsers.update((current) => {
      const next = new Map(current);
      for (const user of this.users()) {
        const id = user.id ?? '';
        if (!id) {
          continue;
        }
        if (selectAll) {
          next.set(id, user);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  isRowSelected(user: UserListItem): boolean {
    return this.selectedIds().has(user.id ?? '');
  }

  clearSelection(): void {
    this.selectedUsers.set(new Map());
  }

  goToBulkActions(): void {
    // Every ticked row, from every page — not just the rows that happen to be on screen.
    const selected = [...this.selectedUsers().values()];

    if (selected.length === 0) {
      this.toast.show('No Selection', 'Select at least one user to run a bulk action.', 'warning');
      return;
    }

    // Pass the API rows (with the GUID `id`) so the bulk page can send real user ids.
    void this.router.navigate(['/app/administration/users/bulk-actions'], {
      state: { selectedUsers: selected },
    });
  }

  // =========================================================================================
  // Dialogs
  // =========================================================================================

  openView(user: UserListItem): void {
    this.selected.set(user);
    this.dialog.set('view');
    this.loadDetail((user.id ?? ''));
  }

  openEdit(user: UserListItem): void {
    this.selected.set(user);
    this.dialog.set('edit');
    this.errorMessage.set('');
    this.reason = '';
    this.editSubmitted.set(false);
    this.editTouched.set(new Set());
    this.editServerErrors.set({});

    // The list row does not carry every editable field, so the full record is fetched.
    this.loadDetail((user.id ?? ''), (detail) => {
      this.editForm.set({
        title: '',
        firstName: detail.firstName ?? '',
        middleName: detail.middleName ?? '',
        lastName: detail.lastName ?? '',
        displayName: detail.displayName ?? '',
        preferredName: '',
        mobileCountryCode: detail.mobileCountryCode || '+91',
        mobileNumber: detail.mobileNumber ?? '',
        employeeNumber: detail.employeeNumber ?? '',
        designation: detail.designation ?? '',
        workLocation: '',
        preferredLanguage: detail.preferredCulture ?? 'en-GB',
        timeZoneId: detail.timeZone ?? 'UTC',
      });
    });
  }

  openSuspend(user: UserListItem): void {
    this.selected.set(user);
    this.reason = '';
    this.errorMessage.set('');
    this.dialog.set('suspend');
  }

  openReactivate(user: UserListItem): void {
    this.selected.set(user);
    this.reason = '';
    this.errorMessage.set('');
    this.dialog.set('reactivate');
  }

  openDelete(user: UserListItem): void {
    this.selected.set(user);
    this.reason = '';
    this.deleteConfirmation.set('');
    this.errorMessage.set('');
    this.dialog.set('delete');
  }

  openInvite(user: UserListItem): void {
    this.selected.set(user);
    this.welcomeMessage = '';
    this.errorMessage.set('');
    this.dialog.set('invite');
  }

  closeDialog(): void {
    this.dialog.set('none');
    this.selected.set(null);
    this.detail.set(null);
    this.reason = '';
    this.deleteConfirmation.set('');
    this.welcomeMessage = '';
    this.errorMessage.set('');
  }

  private loadDetail(id: string, then?: (detail: UserDetail) => void): void {
    this.detailLoading.set(true);
    this.detail.set(null);

    this.api.getUser(id).subscribe({
      next: (detail) => {
        this.detailLoading.set(false);
        this.detail.set(detail);
        then?.(detail);
      },
      error: (error: Error) => {
        this.detailLoading.set(false);
        this.errorMessage.set(error.message);
      },
    });
  }

  // =========================================================================================
  // Actions
  // =========================================================================================

  saveEdit(): void {
    const detail = this.detail();
    const form = this.editForm();

    if (!detail) {
      return;
    }

    this.editSubmitted.set(true);
    const failing = Object.entries(this.editRuleErrors()).filter(([, message]) => message !== null);
    if (failing.length > 0) {
      const names = failing.map(([field]) => UserDirectoryComponent.EDIT_LABELS[field] ?? field);
      this.errorMessage.set(`Please correct: ${names.join(', ')}.`);
      this.focusEditField(failing[0][0]);
      return;
    }

    this.busy.set(true);
    this.errorMessage.set('');
    this.editServerErrors.set({});

    this.api
      .updateUser((detail.id ?? ''), {
        firstName: form.firstName.trim(),
        middleName: form.middleName || null,
        lastName: form.lastName.trim(),
        displayName: form.displayName.trim(),
        mobileCountryCode: form.mobileCountryCode || null,
        mobileNumber: form.mobileNumber || null,
        employeeNumber: form.employeeNumber || null,
        // Sent back unchanged: this dialog does not move people between units or departments.
        organisationUnitId: detail.organisationUnitId ?? null,
        departmentId: detail.departmentId ?? null,
        designation: form.designation || null,
        managerUserId: detail.managerUserId ?? null,
        preferredCulture: form.preferredLanguage,
        timeZone: form.timeZoneId,
        reason: this.reason.trim(),
        // Carrying the version back lets the server refuse the write if somebody else saved.
        expectedVersion: (detail.version ?? 0),
      })
      .subscribe({
        next: () => this.finish(`${form.displayName.trim()} was updated.`),
        error: (error: Error) => {
          this.fail(error);
          this.showServerFieldErrors(error);
        },
      });
  }

  confirmSuspend(): void {
    const user = this.selected();

    if (!user) {
      return;
    }

    if (this.reason.trim().length < 10) {
      this.errorMessage.set('Give a reason of at least 10 characters. It is recorded in the audit trail.');
      return;
    }

    this.busy.set(true);
    this.errorMessage.set('');

    this.api.suspendUser((user.id ?? ''), { reason: this.reason.trim(), expectedVersion: (user.version ?? 0) }).subscribe({
      next: () => this.finish(`${user.displayName ?? 'That person'} has been suspended and signed out of every device.`),
      error: (error: Error) => this.fail(error),
    });
  }

  confirmReactivate(): void {
    const user = this.selected();

    if (!user) {
      return;
    }

    if (this.reason.trim().length < 10) {
      this.errorMessage.set('Give a reason of at least 10 characters. It is recorded in the audit trail.');
      return;
    }

    this.busy.set(true);
    this.errorMessage.set('');

    this.api.reactivateUser((user.id ?? ''), { reason: this.reason.trim(), expectedVersion: (user.version ?? 0) }).subscribe({
      next: () => this.finish(`${user.displayName ?? 'That person'} can sign in again.`),
      error: (error: Error) => this.fail(error),
    });
  }

  /** True when the invitation has not been accepted, so withdrawing applies rather than deactivating. */
  isPendingInvite(user: UserListItem): boolean {
    return user.status === 'invited';
  }

  confirmDelete(): void {
    const user = this.selected();

    if (!user || !this.canConfirmDelete()) {
      return;
    }

    if (this.reason.trim().length < 10) {
      this.errorMessage.set('Give a reason of at least 10 characters. It is recorded in the audit trail.');
      return;
    }

    this.busy.set(true);
    this.errorMessage.set('');

    const request = { reason: this.reason.trim(), expectedVersion: (user.version ?? 0) };

    // A draft and an unaccepted invitation are both WITHDRAWN: nobody ever signed in as
    // either, so there is no history to keep and the invitation link has to stop working.
    // Anything else is deactivated, never deleted, because a person's past actions must stay
    // attributable to somebody.
    const call: Observable<unknown> = this.isHardDelete() || this.isPendingInvite(user)
      ? this.api.withdrawUser((user.id ?? ''), request)
      : this.api.deactivateUser((user.id ?? ''), request);

    call.subscribe({
      next: () =>
        this.finish(
          this.isHardDelete()
            ? `The draft for ${user.displayName ?? 'that person'} was withdrawn.`
            : this.isPendingInvite(user)
              ? `The invitation for ${user.displayName ?? 'That person'} was withdrawn.`
              : `${user.displayName ?? 'That person'} was deactivated. The record and its history are retained.`,
        ),
      error: (error: Error) => this.fail(error),
    });
  }

  confirmInvite(): void {
    const user = this.selected();

    if (!user) {
      return;
    }

    this.busy.set(true);
    this.errorMessage.set('');

    this.api.resendInvitation((user.id ?? ''), this.welcomeMessage.trim() || undefined).subscribe({
      next: (outcome) => this.finish(outcome.message ?? 'The invitation has been re-sent.'),
      error: (error: Error) => this.fail(error),
    });
  }

  // =========================================================================================
  // Export
  // =========================================================================================

  exportCsv(): void {
    this.busy.set(true);

    this.api.exportDirectory(this.filter()).subscribe({
      next: (blob) => {
        this.busy.set(false);

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ydot-user-directory-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.toast.show('Export ready', 'The directory was downloaded as CSV.', 'success');
      },
      error: (error: Error) => {
        this.busy.set(false);
        this.toast.show('Export failed', error.message, 'error');
      },
    });
  }

  // =========================================================================================
  // Presentation helpers
  // =========================================================================================

  /** The badge colour for a status — keyed off the stored value, not the display text. */
  statusClass(status: UserStatus | undefined): string {
    switch (status) {
      case 'active': return 'ud-badge-good';
      case 'suspended': return 'ud-badge-danger';
      case 'invited': return 'ud-badge-blue';
      case 'draft': return 'ud-badge-muted';
      case 'expired':
      case 'withdrawn':
      case 'deactivated': return 'ud-badge-muted';
      default: return 'ud-badge-muted';
    }
  }

  /** Enrolled once a second factor has been confirmed. */
  mfaClass(enrolled: boolean | undefined): string {
    return enrolled ? 'ud-badge-good' : 'ud-badge-muted';
  }

  mfaLabel(enrolled: boolean | undefined): string {
    return enrolled ? 'Enrolled' : 'Not enrolled';
  }

  /** The roles somebody holds, as one line. */
  roleSummary(user: UserListItem): string {
    const roles = user.roleNames ?? [];
    return roles.length > 0 ? roles.join(', ') : 'No roles';
  }

  /** Whether an invitation can be sent to this row. */
  canInvite(user: UserListItem): boolean {
    return user.status === 'draft' || user.status === 'invited' || user.status === 'expired';
  }

  /** What the profile panel says about an outstanding invitation. */
  invitationLabel(detail: UserDetail): string {
    if (detail.hasPendingInvitation) {
      return detail.invitationExpiresAtUtc
        ? `Outstanding — expires ${new Date(detail.invitationExpiresAtUtc).toLocaleDateString()}`
        : 'Outstanding';
    }

    return detail.status === 'draft' ? 'Not sent' : 'Accepted';
  }

  /** How somebody signs in with a second factor, in the words the screen uses. */
  mfaRequirementLabel(detail: UserDetail): string {
    if (!detail.mfaEnabled) {
      return detail.mfaRequirement === 'required'
        ? 'Required — not yet enrolled'
        : 'Not enrolled';
    }

    return detail.mfaRequirement === 'required' ? 'Enrolled — required' : 'Enrolled';
  }

  copy(text: string | null | undefined, field: string): void {
    if (!text) {
      return;
    }

    void navigator.clipboard.writeText(text).then(() => {
      this.copiedField.set(field);
      setTimeout(() => this.copiedField.set(''), 2000);
    });
  }

  updateEditField(key: keyof ReturnType<typeof this.editForm>, value: string): void {
    this.editForm.update((current) => ({ ...current, [key]: value }));
    this.clearEditServerError(key);
  }

  private clearEditServerError(key: string): void {
    const errors = this.editServerErrors();
    if (errors[key]) {
      const { [key]: _removed, ...rest } = errors;
      this.editServerErrors.set(rest);
    }
  }

  /** Editing the reason box clears the API's complaint about it, like any other field. */
  onEditReasonChange(): void {
    this.clearEditServerError('reason');
  }

  /**
   * "Some of the details are not valid" says nothing by itself. The API also sends which field and
   * why; this puts each message under its field and names the fields in the banner.
   */
  private showServerFieldErrors(error: Error): void {
    const details = (error as { validationErrors?: { field: string; message: string }[] }).validationErrors ?? [];
    if (details.length === 0) return;

    const mapped: Record<string, string> = {};
    for (const detail of details) {
      const key = detail.field.charAt(0).toLowerCase() + detail.field.slice(1);
      mapped[key] = detail.message;
    }
    this.editServerErrors.set(mapped);
    this.editSubmitted.set(true);

    const names = Object.keys(mapped).map((field) => UserDirectoryComponent.EDIT_LABELS[field] ?? field);
    this.errorMessage.set(`${error.message} Check: ${names.join(', ')}.`);
    this.focusEditField(Object.keys(mapped)[0]);
  }

  // =========================================================================================
  // Internals
  // =========================================================================================

  /** Re-reads the list after a write, so the screen shows what is stored, not what was assumed. */
  private finish(message: string): void {
    this.busy.set(false);
    this.closeDialog();
    this.toast.show('Done', message, 'success');
    this.load();
    this.loadStatusCounts();

    // The open dossier may be the record just changed: forget what was kept and read it again.
    this.detailCache.clear();
    const focusedId = this.focusedId();
    if (focusedId) {
      this.loadFocus(focusedId);
    }
  }

  private fail(error: Error): void {
    this.busy.set(false);
    this.errorMessage.set(error.message);
  }
}