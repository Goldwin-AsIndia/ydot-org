import { Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { ToastService } from '../../../../Shared/services/toast.service';
import { AccessRequestApiService, AccessRequestSearchFilter } from '../../../../Service/access-request-api.service';
import { UserDirectoryApiService } from '../../../../Service/user-directory-api.service';
import { UserAdminApiService } from '../../../../Service/user-admin-api.service';
import { IamAdminApiService } from '../../../../Service/iam-admin-api.service';
import {
  AccessRequestItemApi,
  CreateAccessRequestRequest,
  UpdateAccessRequestRequest,
} from '../../../../Shared/models/access-request-api.model';
import {
  AccessRequestDetailResponse,
  AccessRequestSummaryResponse,
} from '../../../../Shared/models/iam-contract.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { EnumOptionsService } from '../../../../Shared/services/enum-options.service';
import { ApiEnumOption, enumLabel } from '../../../../Shared/models/enum-option.model';
import { apiErrorMessage, LookupItem, OutcomeResponse } from '../../../../Shared/models/api-response.model';
import { PopupComponent } from '../../../../Shared/components/popup/popup';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';
import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';

/** One queue row, as the table and the dialogs read it. */
interface AccessRequestView {
  id: string;
  reference: string;

  /** The server's value ("roleAssignment") and its words ("Role assignment"). */
  requestTypeValue: string;
  requestType: string;

  user: string;
  requester: string;

  /** What is asked for: the role, the permission, or "—" for a scope request. */
  requestedAccess: string;

  scopeType: string;
  scopeValue: string;
  effectiveFrom: string;
  effectiveTo: string;

  /** The server's status value ("submitted") for styling, and its words for reading. */
  status: string;
  statusDisplay: string;

  version: number;

  /**
   * What THIS caller may do with THIS request, exactly as the server worked it out from the
   * state, the caller's permissions and the independence rule. Every button in the row is drawn
   * from here, so the queue never offers something the API would refuse.
   */
  permittedActions: string[];

  /** Why a waiting request cannot be decided by this caller, in the server's words. */
  cannotDecideReason: string;
}

/** The New / Edit request dialog. */
interface RequestForm {
  requestType: string;
  userId: string;
  roleId: string;
  permissionCode: string;
  scopeType: string;
  scopeValue: string;
  effectiveFrom: string;
  effectiveTo: string;
  businessJustification: string;
}

const EMPTY_FORM: RequestForm = {
  requestType: '',
  userId: '',
  roleId: '',
  permissionCode: '',
  scopeType: '',
  scopeValue: '',
  effectiveFrom: '',
  effectiveTo: '',
  businessJustification: '',
};

type DateField = 'effectiveFrom' | 'effectiveTo';

/**
 * IAM access requests: raising, correcting and independently deciding requests for access.
 *
 * EVERYTHING ON THIS SCREEN COMES FROM IAM. The statuses, request types and scope types are the
 * server's (`/reference-data/enums`); the queue is searched, filtered and paged by the server; the
 * five figures above it are counted by the server over every matching request; and each row's
 * buttons are the `permittedActions` the server returned for that row and this caller. The screen
 * used to carry its own three option lists, count the cards from the rows it had loaded, and
 * decide the buttons from the status text.
 */
@Component({
  selector: 'app-access-request',
  standalone: true,
  imports: [RowsPerPage, PageHeader, CommonModule, FormsModule, RouterModule, PopupComponent],
  templateUrl: './access-request.html',
  styleUrl: './access-request.css',
})
export class AccessRequestComponent {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly api = inject(AccessRequestApiService);
  private readonly userApi = inject(UserDirectoryApiService);
  private readonly userAdminApi = inject(UserAdminApiService);
  private readonly files = inject(IamAdminApiService);
  private readonly tokens = inject(AuthTokenService);
  private readonly enums = inject(EnumOptionsService);
  private readonly destroyRef = inject(DestroyRef);

  // ===== What the caller may do at page level ==================================================

  /** Raising a request. The server checks the same permission on POST. */
  readonly canCreate = computed(() => this.tokens.hasPermission('iam.access-requests.create'));

  /**
   * Raising a request for somebody else. The server allows it only to a caller who decides
   * requests; everybody else - every working staff role - asks for themselves, so the User box
   * is filled with the caller and fixed.
   */
  readonly mayRequestForOthers = computed(() => this.tokens.hasPermission('iam.access-requests.approve'));

  /** Exporting the queue. Its own permission, like every export; the export is audited. */
  readonly canExport = computed(() => this.tokens.hasPermission('iam.access-requests.export'));

  // ===== The server's vocabularies =============================================================

  readonly statusOptions = signal<ApiEnumOption[]>([]);
  readonly requestTypeOptions = signal<ApiEnumOption[]>([]);
  readonly scopeTypeOptions = signal<ApiEnumOption[]>([]);

  /** Active organisation roles, from `/governance/access-requests/requestable-roles`. */
  readonly availableRoles = signal<LookupItem[]>([]);

  /** Permissions an organisation role may carry, for a single-permission request. Loaded on first use. */
  readonly permissionOptions = signal<LookupItem[]>([]);
  private permissionsRequested = false;

  /** Active people in the organisation, for the User picker. */
  readonly userOptions = signal<{ id: string; reference: string; displayName: string; orgUnit: string }[]>([]);

  // ===== The queue =============================================================================

  readonly rows = signal<AccessRequestView[]>([]);
  readonly totalCount = signal(0);
  readonly summary = signal<AccessRequestSummaryResponse | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly exporting = signal(false);
  readonly errorMessage = signal('');

  /** What is typed in the search box, at once; `searchQuery` follows it after a pause. */
  readonly searchText = signal('');
  readonly searchQuery = signal('');
  readonly filterState = signal('');
  private readonly searchInput$ = new Subject<string>();

  readonly pageSize = signal(10);
  readonly currentPage = signal(1);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));
  readonly firstVisibleRow = computed(() => this.totalCount() ? ((this.currentPage() - 1) * this.pageSize()) + 1 : 0);
  readonly lastVisibleRow = computed(() => Math.min(this.currentPage() * this.pageSize(), this.totalCount()));

  /** The row whose Submit is in flight, kept apart from `submitting` so another dialog stays usable. */
  readonly rowSubmittingId = signal('');
  readonly submitting = signal(false);

  // ===== New / Edit dialog =====================================================================

  readonly showNewRequestModal = signal(false);

  /** The request being edited, or null when the dialog raises a new one. */
  readonly editing = signal<{ id: string; reference: string; version: number; hadEndDate: boolean } | null>(null);

  readonly newRequestForm = signal<RequestForm>({ ...EMPTY_FORM });
  readonly newReqSubmitted = signal(false);
  readonly userSearch = signal('');
  readonly roleSearch = signal('');
  readonly permissionSearch = signal('');

  /** Which fields the chosen request type uses: the server refuses the others. */
  readonly usesRole = computed(() => ['roleAssignment', 'temporaryElevation'].includes(this.newRequestForm().requestType));
  readonly usesPermission = computed(() => this.newRequestForm().requestType === 'permissionGrant');
  readonly usesScope = computed(() => this.newRequestForm().requestType === 'dataScopeGrant');
  readonly needsEndDate = computed(() => this.newRequestForm().requestType === 'temporaryElevation');

  readonly filteredUserOptions = computed(() => {
    const query = this.userSearch().trim().toLowerCase();
    return query
      ? this.userOptions().filter(user => `${user.displayName} ${user.reference} ${user.orgUnit}`.toLowerCase().includes(query))
      : this.userOptions();
  });

  readonly filteredRoleOptions = computed(() => {
    const query = this.roleSearch().trim().toLowerCase();
    const roles = this.availableRoles();
    return query
      ? roles.filter(role => `${role.name ?? ''} ${role.code ?? ''} ${role.description ?? ''}`.toLowerCase().includes(query))
      : roles;
  });

  readonly filteredPermissionOptions = computed(() => {
    const query = this.permissionSearch().trim().toLowerCase();
    const permissions = this.permissionOptions();
    const matches = query
      ? permissions.filter(item => `${item.name ?? ''} ${item.code ?? ''}`.toLowerCase().includes(query))
      : permissions;

    // A long catalogue is searched rather than scrolled; the first hundred matches are plenty.
    return matches.slice(0, 100);
  });

  // ===== Decision, return and withdraw dialogs =================================================

  readonly showApproveModal = signal(false);
  readonly showRejectModal = signal(false);
  readonly showReturnModal = signal(false);
  readonly showCancelModal = signal(false);
  readonly decisionTarget = signal<AccessRequestView | null>(null);
  readonly actionTarget = signal<AccessRequestView | null>(null);
  readonly decisionReason = signal('');
  readonly decisionError = signal('');

  readonly showDecisionResultModal = signal(false);
  readonly decisionResult = signal<{ reference: string; state: string; tone: string; effectiveTime: string; nextAction: string } | null>(null);

  // ===== View dialog ===========================================================================

  readonly viewing = signal<AccessRequestDetailResponse | null>(null);
  readonly viewLoadingId = signal('');

  constructor() {
    this.loadVocabularies();
    this.loadUserDirectory();
    this.loadRoleCatalogue();

    this.searchInput$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((term) => {
        this.searchQuery.set(term);
        this.currentPage.set(1);
        this.loadData();
      });

    this.loadData();
  }

  // =============================================================================================
  // Loading
  // =============================================================================================

  /** The three vocabularies, from the one endpoint every administration screen shares. */
  private loadVocabularies(): void {
    this.enums.options('accessRequestStatuses').subscribe({ next: (o) => this.statusOptions.set(o), error: () => undefined });
    this.enums.options('accessRequestTypes').subscribe({ next: (o) => this.requestTypeOptions.set(o), error: () => undefined });
    this.enums.options('dataScopeTypes').subscribe({ next: (o) => this.scopeTypeOptions.set(o), error: () => undefined });
  }

  /** What the queue and the cards are both filtered by. */
  private criteria(): AccessRequestSearchFilter {
    return {
      search: this.searchQuery().trim() || undefined,
      status: this.filterState() || undefined,
    };
  }

  /**
   * One page of the queue, and the figures above it, for the same filter.
   *
   * THE SERVER PAGES AND COUNTS. The screen used to fetch every request and count the cards from
   * whatever it held; the cards now describe every matching request whatever page is showing.
   */
  loadData(): void {
    this.loading.set(true);
    this.loadError.set(false);

    this.api.search({ ...this.criteria(), page: this.currentPage(), pageSize: this.pageSize() }).subscribe({
      next: (page) => {
        this.rows.set((page.items ?? []).map((row) => this.toView(row)));
        this.totalCount.set(page.totalCount ?? 0);
        this.loading.set(false);

        // A page that emptied (the last row on it was withdrawn) steps back rather than showing nothing.
        if (this.rows().length === 0 && this.currentPage() > 1 && this.totalCount() > 0) {
          this.goToPage(this.totalPages());
        }
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(true);
        this.errorMessage.set(apiErrorMessage(error, 'The access request queue could not be loaded.'));
      },
    });

    // The cards are worth having without the queue and the queue without the cards.
    this.api.summary(this.criteria()).subscribe({
      next: (summary) => this.summary.set(summary),
      error: () => this.summary.set(null),
    });
  }

  retry(): void { this.loadData(); }

  /**
   * The roles that can be asked for: active organisation roles, from the access request
   * endpoint rather than `/roles/lookup`, which needs `iam.roles.view` - a role administrator's
   * code that the people asking for access do not hold.
   *
   * A role that holds every permission by flag reports a count of zero rows, so it says "All
   * permissions" rather than "0 permissions" - the same convention as the role catalogue.
   */
  private loadRoleCatalogue(): void {
    this.api.requestableRoles().subscribe({
      next: (roles) => {
        this.availableRoles.set(roles.map((role) => {
          const reach = (role as { grantsAllTenantPermissions?: boolean }).grantsAllTenantPermissions === true
            ? 'All permissions'
            : `${role.permissionCount ?? 0} permissions`;

          return {
            id: role.id ?? '',
            code: role.code ?? '',
            name: role.name ?? role.code ?? '',
            isActive: true,
            description: role.isPrivileged === true ? `Privileged · ${reach}` : reach,
          };
        }));
      },
      error: () => { /* Non-blocking: the queue renders without the dialog's role list. */ },
    });
  }

  /**
   * The permissions a single-permission request can name: everything an organisation role may
   * carry, from `/reference-data`. Fetched the first time somebody chooses that request type.
   */
  private loadPermissionCatalogue(): void {
    if (this.permissionsRequested) {
      return;
    }

    this.permissionsRequested = true;

    this.userAdminApi.getFormReferenceData().subscribe({
      next: (reference) => this.permissionOptions.set(reference.permissions ?? []),
      error: () => { this.permissionsRequested = false; },
    });
  }

  /**
   * The people a request can be raised for: the organisation's people directory, which every
   * member may read and which returns active people only.
   */
  private loadUserDirectory(): void {
    this.userApi.peopleDirectory(undefined, 500).subscribe({
      next: (people) => {
        this.userOptions.set(people.map((person) => ({
          id: person.id ?? '',
          reference: person.code ?? '',
          displayName: person.displayName ?? '',
          orgUnit: person.unitName ?? '',
        })));
      },
      error: () => { /* Non-blocking */ }
    });
  }

  // =============================================================================================
  // Search, filter, paging
  // =============================================================================================

  onSearchInput(value: string): void {
    this.searchText.set(value);
    this.searchInput$.next(value);
  }

  clearSearch(): void {
    this.onSearchInput('');
  }

  /** Status filter dropdown in the table toolbar. */
  pickStatus(value: string): void {
    this.filterState.set(value);
    this.openDd.set(null);
    this.currentPage.set(1);
    this.loadData();
  }

  goToPage(page: number): void {
    const next = Math.min(Math.max(page, 1), this.totalPages());

    if (next !== this.currentPage()) {
      this.currentPage.set(next);
      this.loadData();
    }
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.openDd.set(null);
    this.loadData();
  }

  /** Page numbers with gaps (0 = an ellipsis), e.g. 1 … 4 5 6 … 12. */
  readonly pageNumbers = computed<number[]>(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages = new Set([1, total, current - 1, current, current + 1]);
    const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
    const out: number[] = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) out.push(0);
      out.push(p);
    });
    return out;
  });

  // =============================================================================================
  // Export
  // =============================================================================================

  /**
   * The queue as a CSV file, for the filter on screen. The server builds and names the file and
   * records the export in the audit trail; its reference is quoted back so the two can be matched.
   */
  exportRequests(): void {
    if (this.exporting()) {
      return;
    }

    this.exporting.set(true);

    this.api.export(this.criteria()).subscribe({
      next: ({ blob, fileName, reference }) => {
        this.exporting.set(false);
        this.files.saveBlob(blob, fileName);
        this.toast.show('Export ready',
          reference ? `${fileName} has been downloaded. The export is recorded in the audit trail as ${reference}.`
            : `${fileName} has been downloaded.`,
          'success');
      },
      error: (error: unknown) => {
        this.exporting.set(false);
        this.toast.show('Export failed', apiErrorMessage(error), 'error');
      },
    });
  }

  // =============================================================================================
  // Custom dropdowns and the date picker
  // =============================================================================================

  /** Which custom dropdown is open: 'status' | 'requestType' | 'user' | 'role' | 'permission' | 'scopeType'. */
  readonly openDd = signal<string | null>(null);

  toggleDd(key: string): void {
    this.dpField.set(null);
    this.openDd.set(this.openDd() === key ? null : key);
    if (this.openDd() === key) this.fitOpenDropdown();
  }

  /**
   * Keeps an open dropdown fully visible inside the dialog, FLOATING over the form.
   *
   * The list floats (it does not push the fields down), but it is position: fixed and placed
   * against the SCREEN - the same way as the date picker - so the dialog's scroll area and footer
   * can no longer cut it off. It opens under its field, or above it when there is more room above;
   * its list is capped to that room and scrolls inside itself. Scrolling the dialog or resizing
   * the window closes it (a fixed list would be left behind).
   */
  private fitOpenDropdown(): void {
    setTimeout(() => {
      const dd = document.querySelector<HTMLElement>('.ar-modal-body .ar-dd.is-open');
      const menu = dd?.querySelector<HTMLElement>('.ar-dd-menu');
      const trigger = dd?.querySelector<HTMLElement>('.ar-dd-trigger');
      if (!dd || !menu || !trigger) return;

      const gap = 6;
      const pad = 10;
      const field = trigger.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;

      // Measure where "fixed 0,0" really is (an ancestor with a transform would move it).
      menu.style.top = '0px';
      menu.style.left = '0px';
      menu.style.width = `${field.width}px`;
      const origin = menu.getBoundingClientRect();

      const list = menu.querySelector<HTMLElement>('.ar-dd-list');
      const chrome = origin.height - (list?.getBoundingClientRect().height ?? 0);

      const below = vh - field.bottom - gap - pad;
      const above = field.top - gap - pad;
      const up = origin.height > below && above > below;
      const room = Math.max(140, up ? above : below);

      if (list) {
        list.style.maxHeight = `${Math.max(100, Math.min(280, room - chrome))}px`;
      }

      const top = field.bottom + gap;
      const left = Math.min(Math.max(field.left, pad), Math.max(pad, vw - field.width - pad));

      if (up) {
        // Anchored by its BOTTOM to just above the field, so typing in its search (which shortens
        // the list) keeps it attached to the field instead of leaving a gap.
        menu.style.top = 'auto';
        menu.style.bottom = `${vh - (field.top - gap)}px`;
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = `${top - origin.top}px`;
      }
      menu.style.left = `${left - origin.left}px`;
      menu.classList.toggle('ar-dd-menu--up', up);
      menu.style.visibility = 'visible';
    });
  }

  /** Sets one field of the request form and closes the dropdown. */
  pickField(field: 'requestType' | 'userId' | 'roleId' | 'permissionCode' | 'scopeType', value: string): void {
    const next = { ...this.newRequestForm(), [field]: value };

    // A change of type clears what the new type does not use, so nothing hidden is sent.
    if (field === 'requestType') {
      if (!['roleAssignment', 'temporaryElevation'].includes(value)) next.roleId = '';
      if (value !== 'permissionGrant') next.permissionCode = '';
      if (value !== 'dataScopeGrant') { next.scopeType = ''; next.scopeValue = ''; }
      if (value === 'permissionGrant') this.loadPermissionCatalogue();
    }

    this.newRequestForm.set(next);
    this.openDd.set(null);
  }

  /** The label of an option, from the server's list. */
  optionLabel(options: readonly ApiEnumOption[], value: string | null | undefined): string {
    return value ? enumLabel(options, value) : '';
  }

  lookupName(options: readonly LookupItem[], id: string): string {
    return options.find(option => option.id === id)?.name ?? '';
  }

  permissionName(code: string): string {
    return this.permissionOptions().find(option => option.code === code)?.name ?? code;
  }

  selectedUser(): { id: string; reference: string; displayName: string; orgUnit: string } | undefined {
    const id = this.newRequestForm().userId;
    const listed = this.userOptions().find(u => u.id === id);
    if (listed || !id) {
      return listed;
    }

    // The caller, before the people directory has answered (or if it could not): the box must
    // still name who a self-service request is for.
    const me = this.tokens.user();
    return me?.id === id
      ? { id, reference: me.code ?? '', displayName: me.displayName ?? '', orgUnit: '' }
      : undefined;
  }

  initials(name: string | null | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  readonly dpField = signal<DateField | null>(null);
  readonly dpView = signal(new Date());
  readonly weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  /**
   * The two dates a request carries. There used to be a third, "Review date", which nothing ever
   * sent: the server has no such field, so whatever was picked was dropped on the floor.
   */
  readonly dateFields: { key: DateField; label: string }[] = [
    { key: 'effectiveFrom', label: 'Effective from' },
    { key: 'effectiveTo', label: 'Effective to' },
  ];

  dateValue(key: DateField): string {
    return this.newRequestForm()[key] ?? '';
  }

  openDatePicker(field: DateField): void {
    this.openDd.set(null);
    if (this.dpField() === field) {
      this.dpField.set(null);
      return;
    }
    const current = this.newRequestForm()[field];
    this.dpView.set(current ? new Date(current + 'T00:00:00') : new Date());
    this.dpField.set(field);
  }

  /** The label of a date field, for the open calendar. */
  dateLabel(key: DateField): string {
    return this.dateFields.find((f) => f.key === key)?.label ?? 'Date';
  }

  /**
   * Where the open calendar sits.
   *
   * THE CALENDAR IS DRAWN OUTSIDE THE MODAL (a sibling of it, inside the backdrop), so the modal's
   * rounded, clipped edge can no longer cut its last rows off. It is position: fixed and placed
   * against the SCREEN: under its field, or above it when there is no room below, and always kept
   * fully on screen. It is drawn hidden first, measured, then shown. Null while measuring.
   */
  readonly dpPos = signal<{ top: number; left: number } | null>(null);

  /** Puts the calendar under its field (above it when the screen has no room below). */
  placeDatePicker(trigger: HTMLElement): void {
    this.dpPos.set(null);

    setTimeout(() => {
      const pop = document.querySelector<HTMLElement>('.ar-dp-pop');
      if (!pop) {
        return;
      }

      const field = trigger.getBoundingClientRect();
      const origin = pop.getBoundingClientRect();
      const width = origin.width;
      const height = origin.height;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 6;
      const pad = 8;

      const spaceBelow = vh - field.bottom - gap - pad;
      const spaceAbove = field.top - gap - pad;
      let top = height <= spaceBelow || spaceBelow >= spaceAbove
        ? field.bottom + gap
        : field.top - gap - height;
      top = Math.min(Math.max(top, pad), Math.max(pad, vh - height - pad));
      const left = Math.min(Math.max(field.left, pad), Math.max(pad, vw - width - pad));

      // `origin` is where the hidden pop-up was drawn at 0,0 - non-zero only if an ancestor makes
      // "fixed" relative to itself - so the offset is corrected either way.
      this.dpPos.set({ top: top - origin.top, left: left - origin.left });
    });
  }

  readonly dpTitle = computed(() =>
    this.dpView().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }));

  /** The visible month as 6 weeks of cells, Monday first. */
  readonly dpCells = computed(() => {
    const view = this.dpView();
    const field = this.dpField();
    const selected = field ? this.newRequestForm()[field] : '';
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    const todayIso = this.toIso(new Date());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = this.toIso(d);
      return {
        iso,
        day: d.getDate(),
        outside: d.getMonth() !== view.getMonth(),
        today: iso === todayIso,
        selected: iso === selected,
      };
    });
  });

  dpShift(months: number): void {
    const v = this.dpView();
    this.dpView.set(new Date(v.getFullYear(), v.getMonth() + months, 1));
  }

  dpPick(iso: string): void {
    const field = this.dpField();
    if (!field) return;
    this.newRequestForm.set({ ...this.newRequestForm(), [field]: iso });
    this.dpField.set(null);
  }

  dpToday(): void { this.dpPick(this.toIso(new Date())); }

  dpClear(): void {
    const field = this.dpField();
    if (!field) return;
    this.newRequestForm.set({ ...this.newRequestForm(), [field]: '' });
    this.dpField.set(null);
  }

  /** "2026-09-24" → "24 Sep 2026" for the picker's trigger. */
  displayDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private toIso(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openDd.set(null);
    this.dpField.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openDd.set(null);
    this.dpField.set(null);
  }

  /** A fixed pop-up would be left behind by a resize, so close it instead. */
  @HostListener('window:resize')
  onResize(): void {
    this.dpField.set(null);
    this.openDd.set(null);
  }

  // =============================================================================================
  // Rows
  // =============================================================================================

  private toView(r: AccessRequestItemApi): AccessRequestView {
    return {
      id: r.id ?? '',
      reference: r.requestNumber ?? '',
      requestTypeValue: r.requestType ?? '',
      requestType: r.requestTypeDisplay ?? r.requestType ?? '',
      user: r.requestedForName ?? '',
      requester: r.requestedByName ?? '—',
      requestedAccess: r.roleName ?? r.permissionName ?? r.permissionCode ?? '—',

      // THE SCOPE THE REQUEST ACTUALLY NAMES, in the server's words. No scope means the request
      // narrows nothing, which is a dash rather than "everything".
      scopeType: r.scopeTypeDisplay ?? '—',
      scopeValue: r.scopeType ? (r.scopeValue || '—') : '—',
      effectiveFrom: r.accessStartsAtUtc ? this.formatDate(r.accessStartsAtUtc) : '—',
      effectiveTo: r.accessEndsAtUtc ? this.formatDate(r.accessEndsAtUtc) : '—',
      status: r.status ?? '',
      statusDisplay: r.statusDisplay ?? r.status ?? '',
      version: r.version ?? 0,
      permittedActions: r.permittedActions ?? ['View'],
      cannotDecideReason: r.cannotDecideReason ?? '',
    };
  }

  /** Whether the server offered this action on this row. */
  can(row: AccessRequestView, action: string): boolean {
    return row.permittedActions.includes(action);
  }

  private formatDate(value: string): string {
    const date = new Date(value);
    return isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return isNaN(date.getTime())
      ? value
      : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  // =============================================================================================
  // View
  // =============================================================================================

  /** Opens the full record: the justification, the decision, a return's reason, what it grants. */
  openView(row: AccessRequestView): void {
    if (this.viewLoadingId()) return;
    this.viewLoadingId.set(row.id);

    this.api.get(row.id).subscribe({
      next: (detail) => {
        this.viewLoadingId.set('');
        this.viewing.set(detail);
      },
      error: (error: unknown) => {
        this.viewLoadingId.set('');
        this.toast.show('Could not open the request', apiErrorMessage(error), 'error');
      },
    });
  }

  closeView(): void {
    this.viewing.set(null);
  }

  // =============================================================================================
  // New and Edit
  // =============================================================================================

  private static readonly FIELD_LABELS: Record<string, string> = {
    requestType: 'Request type', userId: 'User', roleId: 'Requested role', permissionCode: 'Requested permission',
    scopeType: 'Scope type', scopeValue: 'Scope value', effectiveTo: 'Effective to',
    businessJustification: 'Business justification',
  };

  /** What is wrong with each field of the dialog right now, or null. The same rules as the server. */
  private formErrors(): Record<string, string | null> {
    const f = this.newRequestForm();
    const just = f.businessJustification.trim();
    return {
      requestType: f.requestType ? null : 'Select a request type.',
      userId: f.userId ? null : 'Select the user this request is for.',
      roleId: this.usesRole() && !f.roleId ? 'Select the role being requested.' : null,
      permissionCode: this.usesPermission() && !f.permissionCode ? 'Select the permission being requested.' : null,
      scopeType: this.usesScope() && !f.scopeType ? 'Select a scope type.' : null,
      scopeValue: this.usesScope() && !f.scopeValue.trim() ? 'Enter the scope value.' : null,
      effectiveTo: this.needsEndDate() && !f.effectiveTo ? 'Temporary access needs an end date.'
        : f.effectiveFrom && f.effectiveTo && f.effectiveTo < f.effectiveFrom ? 'Effective to cannot be before effective from.'
        : f.effectiveTo && f.effectiveTo < this.toIso(new Date()) ? 'The end date must be in the future.'
        : null,
      businessJustification: !just ? 'Business justification is required.'
        : just.length < 10 ? 'Business justification must be at least 10 characters.' : null,
    };
  }

  /**
   * The red border of a required field left empty, set inline with !important: styles.css forces
   * control borders with !important, which a class rule here cannot beat - so before, the text box
   * stayed grey while its message was red.
   */
  readonly invalidStyle = 'border-color:#b3261e !important;box-shadow:0 0 0 3px rgba(179,38,30,.12) !important';

  /** The message under a field, once Submit has been pressed. */
  newReqError(field: string): string | null {
    return this.newReqSubmitted() ? (this.formErrors()[field] ?? null) : null;
  }

  openNewRequest(): void {
    this.editing.set(null);

    // The server offers one request type today - Role assignment - so it starts chosen rather
    // than leaving a one-item list to be picked by hand.
    const types = this.requestTypeOptions();

    // Asking for yourself, unless you are somebody who decides requests - see mayRequestForOthers.
    this.resetDialog({
      ...EMPTY_FORM,
      requestType: types.length === 1 ? types[0].value : '',
      userId: this.mayRequestForOthers() ? '' : (this.tokens.user()?.id ?? ''),
    });
  }

  /**
   * Opens a draft or a returned request for correction, filled from the server's record.
   *
   * The type and the person stay as they are - the server keeps both fixed on an edit - so they
   * show but cannot be changed.
   */
  openEditRequest(row: AccessRequestView): void {
    this.api.get(row.id).subscribe({
      next: (detail) => {
        this.editing.set({
          id: detail.id ?? row.id,
          reference: detail.requestNumber ?? row.reference,
          version: detail.version ?? row.version,
          hadEndDate: !!detail.accessEndsAtUtc,
        });

        if (detail.requestType === 'permissionGrant') {
          this.loadPermissionCatalogue();
        }

        this.resetDialog({
          requestType: detail.requestType ?? '',
          userId: detail.requestedForUserId ?? '',
          roleId: detail.roleId ?? '',
          permissionCode: detail.permissionCode ?? '',
          scopeType: detail.scopeType ?? '',
          scopeValue: detail.scopeValue ?? '',
          effectiveFrom: detail.accessStartsAtUtc ? this.toIso(new Date(detail.accessStartsAtUtc)) : '',
          effectiveTo: detail.accessEndsAtUtc ? this.toIso(new Date(detail.accessEndsAtUtc)) : '',
          businessJustification: detail.businessJustification ?? '',
        });
      },
      error: (error: unknown) => this.toast.show('Could not open the request', apiErrorMessage(error), 'error'),
    });
  }

  private resetDialog(form: RequestForm): void {
    this.newReqSubmitted.set(false);
    this.userSearch.set('');
    this.roleSearch.set('');
    this.permissionSearch.set('');
    this.newRequestForm.set(form);
    this.openDd.set(null);
    this.dpField.set(null);
    this.showNewRequestModal.set(true);
  }

  closeNewRequest(): void {
    this.showNewRequestModal.set(false);
    this.editing.set(null);
  }

  /** True when the dialog is valid; otherwise marks the fields and says which. */
  private validateDialog(): boolean {
    this.newReqSubmitted.set(true);
    const failing = Object.entries(this.formErrors()).filter(([, message]) => message !== null);

    if (failing.length > 0) {
      const names = failing.map(([field]) => AccessRequestComponent.FIELD_LABELS[field] ?? field);
      this.toast.show('Check the highlighted fields', `Please correct: ${names.join(', ')}.`, 'warning');
      return false;
    }

    return true;
  }

  /** A picked day as the instant the server stores: the start of the day for a start, its end for an end. */
  private startOfDay(iso: string): string { return new Date(iso + 'T00:00:00').toISOString(); }
  private endOfDay(iso: string): string { return new Date(iso + 'T23:59:59').toISOString(); }

  /**
   * Raises the request - straight to an approver, or as a draft to finish later.
   *
   * ONLY THE FIELDS THE TYPE USES ARE SENT. A role request used to carry a scope that approval
   * never applied, and a permission request could not be raised at all: the dialog demanded a
   * role and had nowhere to name a permission.
   */
  submitNewRequest(asDraft = false): void {
    if (!this.validateDialog()) return;

    const form = this.newRequestForm();
    this.submitting.set(true);

    const request: CreateAccessRequestRequest = {
      requestType: form.requestType as CreateAccessRequestRequest['requestType'],
      requestedForUserId: form.userId,
      roleId: this.usesRole() ? form.roleId : null,
      permissionCode: this.usesPermission() ? form.permissionCode : null,
      scopeType: this.usesScope() ? form.scopeType as CreateAccessRequestRequest['scopeType'] : undefined,
      scopeValue: this.usesScope() ? form.scopeValue.trim() : null,
      accessStartsAtUtc: form.effectiveFrom ? this.startOfDay(form.effectiveFrom) : null,
      accessEndsAtUtc: form.effectiveTo ? this.endOfDay(form.effectiveTo) : null,
      businessJustification: form.businessJustification.trim(),
      submitImmediately: !asDraft,
    };

    this.api.createRequest(request).subscribe({
      next: (outcome) => {
        this.submitting.set(false);
        this.showNewRequestModal.set(false);

        // A persistent confirmation: somebody who raised a request needs its reference, and the
        // reference and status are read back from the server rather than assumed.
        this.api.get(outcome.id).subscribe({
          next: (detail) => this.showOutcome(detail.requestNumber ?? '', outcome, detail.status ?? outcome.status),
          error: () => this.showOutcome('', outcome, outcome.status),
        });

        this.loadData();
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.toast.show(asDraft ? 'Could not save the draft' : 'Could not raise the request', apiErrorMessage(error), 'error');
      },
    });
  }

  /** Saves a correction to a draft or a returned request. It then waits to be submitted. */
  saveEdit(): void {
    const editing = this.editing();
    if (!editing || !this.validateDialog()) return;

    const form = this.newRequestForm();
    this.submitting.set(true);

    const request: UpdateAccessRequestRequest = {
      expectedVersion: editing.version,
      businessJustification: form.businessJustification.trim(),
      roleId: this.usesRole() ? form.roleId : null,
      permissionCode: this.usesPermission() ? form.permissionCode : null,
      scopeType: this.usesScope() ? form.scopeType as UpdateAccessRequestRequest['scopeType'] : undefined,
      scopeValue: this.usesScope() ? form.scopeValue.trim() : null,
      accessStartsAtUtc: form.effectiveFrom ? this.startOfDay(form.effectiveFrom) : null,
      accessEndsAtUtc: form.effectiveTo ? this.endOfDay(form.effectiveTo) : null,
      removeAccessEndDate: !form.effectiveTo && editing.hadEndDate,
    };

    this.api.update(editing.id, request).subscribe({
      next: (outcome) => {
        this.submitting.set(false);
        this.closeNewRequest();
        this.showOutcome(editing.reference, outcome, outcome.status,
          'Your changes are saved. Submit the request when it is ready for an approver.');
        this.loadData();
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.toast.show('Could not save the request', apiErrorMessage(error), 'error');
      },
    });
  }

  /** The confirmation after any change: the server's status and the server's sentence. */
  private showOutcome(reference: string, outcome: OutcomeResponse, status: string | null | undefined, nextAction?: string): void {
    const value = (status ?? '').toLowerCase();

    this.decisionResult.set({
      reference,
      state: this.optionLabel(this.statusOptions(), status) || status || '',
      tone: value === 'rejected' ? 'danger' : value === 'returned' || value === 'withdrawn' ? 'warning' : 'success',
      effectiveTime: this.formatDateTime(new Date().toISOString()),
      nextAction: nextAction ?? outcome.message ?? '',
    });
    this.showDecisionResultModal.set(true);
  }

  // =============================================================================================
  // Submit, return, withdraw, approve, reject
  // =============================================================================================

  submitRequest(row: AccessRequestView): void {
    if (!this.can(row, 'Submit') || this.rowSubmittingId() === row.id) return;
    this.rowSubmittingId.set(row.id);

    this.api.submitRequest(row.id, { expectedVersion: row.version, comment: 'Submitted for approval' }).subscribe({
      next: (outcome) => {
        this.rowSubmittingId.set('');
        this.showOutcome(row.reference, outcome, outcome.status);
        this.loadData();
      },
      error: (error: unknown) => {
        this.rowSubmittingId.set('');
        this.toast.show('Submit failed', apiErrorMessage(error), 'error');
        this.loadData();
      },
    });
  }

  openReturnModal(row: AccessRequestView): void {
    if (!this.can(row, 'Return')) return;
    this.openActionModal(row, this.showReturnModal);
  }

  /** Withdrawing: the requester taking back a draft, a returned request or one awaiting a decision. */
  openCancelModal(row: AccessRequestView): void {
    if (!this.can(row, 'Withdraw')) return;
    this.openActionModal(row, this.showCancelModal);
  }

  private openActionModal(row: AccessRequestView, flag: { set(value: boolean): void }): void {
    this.actionTarget.set(row);
    this.decisionReason.set('');
    this.decisionError.set('');
    flag.set(true);
  }

  closeActionModal(): void {
    this.showReturnModal.set(false);
    this.showCancelModal.set(false);
    this.actionTarget.set(null);
    this.decisionReason.set('');
    this.decisionError.set('');
  }

  confirmReturn(): void {
    const target = this.actionTarget();
    if (!target || !this.reasonIsLongEnough('Return reason')) return;

    this.submitting.set(true);
    this.api.returnRequest(target.id, { reason: this.decisionReason().trim(), expectedVersion: target.version }).subscribe({
      next: (outcome) => this.afterAction(target, outcome),
      error: (error: unknown) => this.actionFailed(error),
    });
  }

  confirmCancel(): void {
    const target = this.actionTarget();
    if (!target || !this.reasonIsLongEnough('Withdrawal reason')) return;

    this.submitting.set(true);
    this.api.cancelRequest(target.id, { reason: this.decisionReason().trim(), expectedVersion: target.version }).subscribe({
      next: (outcome) => this.afterAction(target, outcome),
      error: (error: unknown) => this.actionFailed(error),
    });
  }

  openApproveModal(row: AccessRequestView): void {
    if (!this.can(row, 'Approve')) return;
    this.openDecisionModal(row, this.showApproveModal);
  }

  openRejectModal(row: AccessRequestView): void {
    if (!this.can(row, 'Reject')) return;
    this.openDecisionModal(row, this.showRejectModal);
  }

  private openDecisionModal(row: AccessRequestView, flag: { set(value: boolean): void }): void {
    this.decisionTarget.set(row);
    this.decisionReason.set('');
    this.decisionError.set('');
    flag.set(true);
  }

  closeDecisionModal(): void {
    this.showApproveModal.set(false);
    this.showRejectModal.set(false);
    this.decisionTarget.set(null);
    this.decisionReason.set('');
    this.decisionError.set('');
  }

  confirmApprove(): void {
    const target = this.decisionTarget();
    if (!target || !this.reasonIsLongEnough('Decision reason')) return;

    this.submitting.set(true);
    this.api.approveRequest(target.id, target.version, this.decisionReason().trim()).subscribe({
      next: (outcome) => this.afterAction(target, outcome),
      error: (error: unknown) => this.actionFailed(error),
    });
  }

  confirmReject(): void {
    const target = this.decisionTarget();
    if (!target || !this.reasonIsLongEnough('Rejection reason')) return;

    this.submitting.set(true);
    this.api.rejectRequest(target.id, target.version, this.decisionReason().trim()).subscribe({
      next: (outcome) => this.afterAction(target, outcome),
      error: (error: unknown) => this.actionFailed(error),
    });
  }

  /** Every reason on this screen is 10 to 1000 characters; the dialogs say so before sending. */
  private reasonIsLongEnough(label: string): boolean {
    if (this.decisionReason().trim().length < 10) {
      this.decisionError.set(`${label} must be at least 10 characters.`);
      return false;
    }

    return true;
  }

  /**
   * After any decision or action: close the dialog, say what the SERVER did, and re-read.
   *
   * Re-read rather than patch: the server may have done more than this screen would predict -
   * written the grant, stamped the decision - and a locally patched row would disagree with it.
   */
  private afterAction(target: AccessRequestView, outcome: OutcomeResponse): void {
    this.submitting.set(false);
    this.closeActionModal();
    this.closeDecisionModal();
    this.showOutcome(target.reference, outcome, outcome.status);
    this.loadData();
  }

  /**
   * A refusal is shown in the dialog. When somebody else changed the request first (a stale
   * version), the queue is re-read so the next attempt starts from what is really there.
   */
  private actionFailed(error: unknown): void {
    this.submitting.set(false);
    this.decisionError.set(apiErrorMessage(error));
    this.loadData();
  }

  closeDecisionResultModal(): void {
    this.showDecisionResultModal.set(false);
    this.decisionResult.set(null);
  }

  goBack(): void { this.router.navigate(['/app/administration/access/user-directory']); }
}