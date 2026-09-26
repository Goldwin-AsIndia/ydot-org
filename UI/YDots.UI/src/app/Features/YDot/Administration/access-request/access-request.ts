import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { ToastService } from '../../../../Shared/services/toast.service';
import { AccessRequestApiService } from '../../../../Service/access-request-api.service';
import { UserDirectoryApiService } from '../../../../Service/user-directory-api.service';
import { RoleCatalogueApiService } from '../../../../Service/role-catalogue-api.service';
import {
  AccessRequestItemApi,
  AccessRequestListResponse,
  AccessRequestSearchFilter,
  CreateAccessRequestRequest,
} from '../../../../Shared/models/access-request-api.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { UserSearchFilter } from '../../../../Shared/models/user-directory.model';
import { LookupItem } from '../../../../Shared/models/api-response.model';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

interface AccessRequestView {
  id: string;
  reference: string;
  requestType: string;
  user: string;
  currentRoleAndScope: string;
  requestedRole: string;
  scopeType: string;
  scopeValue: string;
  effectiveFrom: string;
  effectiveTo: string;
  businessJustification: string;
  requester: string;
  requestedTime: string;
  approverRoute: string;
  slaDue: string;
  approvalState: string;
  approvalStateClass: string;
  decision?: string;
  decisionReason?: string;
  decisionActor?: string;
  decisionTime?: string;
  version: number;
  permittedActions: string[];

  /**
   * The server's answer to the independence rule, for THIS caller and THIS request.
   *
   * Carried onto the row because the buttons have to obey it. It was already being computed
   * into `permittedActions` and then read by nothing, so the queue offered Approve and Reject
   * on every submitted request - including the ones the caller had raised themselves, which
   * the server refuses outright.
   */
  canDecide: boolean;

  /** Why the decision buttons are absent, when they are. Empty when they are offered. */
  cannotDecideReason: string;
}

@Component({
  selector: 'app-access-request',
  standalone: true,
  imports: [PageHeader, CommonModule, FormsModule, RouterModule],
  templateUrl: './access-request.html',
  styleUrl: './access-request.css',
})
export class AccessRequestComponent {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly api = inject(AccessRequestApiService);
  private readonly userApi = inject(UserDirectoryApiService);
  private readonly roleApi = inject(RoleCatalogueApiService);
  private readonly tokens = inject(AuthTokenService);

  /** Who is looking, so a row can say "you raised this" rather than a vaguer refusal. */
  private currentUserName(): string {
    return this.tokens.user()?.displayName ?? '';
  }

  data = signal<AccessRequestListResponse | null>(null);
  userOptions = signal<{ id: string; reference: string; displayName: string; orgUnit: string }[]>([]);
  loading = signal(true);
  loadError = signal(false);
  submitting = signal(false);
  errorMessage = signal('');

  searchQuery = signal('');
  filterState = signal('');
  readonly showFilters = signal(false);

  filteredRequests = signal<AccessRequestView[]>([]);
  readonly pageSize = signal(10);
  readonly pageSizeOptions = [10, 20, 50, 100];
  readonly currentPage = signal(1);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredRequests().length / this.pageSize())));
  readonly paginatedRequests = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredRequests().slice(start, start + this.pageSize());
  });
  readonly firstVisibleRow = computed(() => this.filteredRequests().length ? ((this.currentPage() - 1) * this.pageSize()) + 1 : 0);
  readonly lastVisibleRow = computed(() => Math.min(this.currentPage() * this.pageSize(), this.filteredRequests().length));

  readonly userSearch = signal('');
  readonly roleSearch = signal('');
  readonly filteredUserOptions = computed(() => {
    const query = this.userSearch().trim().toLowerCase();
    return query
      ? this.userOptions().filter(user => `${user.displayName} ${user.reference} ${user.orgUnit}`.toLowerCase().includes(query))
      : this.userOptions();
  });
  readonly filteredRoleOptions = computed(() => {
    const query = this.roleSearch().trim().toLowerCase();
    const roles = this.data()?.roleOptions ?? [];
    return query
      ? roles.filter(role => `${role.name ?? ''} ${role.code ?? ''} ${role.description ?? ''}`.toLowerCase().includes(query))
      : roles;
  });
  readonly requestSummary = computed(() => {
    const requests = this.filteredRequests();
    const countState = (...states: string[]) => requests.filter(request =>
      states.includes(request.approvalState.toLowerCase().replace(/\s+/g, ''))
    ).length;
    const userCounts = requests.reduce((counts, request) => {
      counts.set(request.user, (counts.get(request.user) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
    const mostActive = [...userCounts.entries()].sort((left, right) => right[1] - left[1])[0];

    return {
      total: requests.length,
      approved: countState('approved'),
      pending: countState('submitted', 'pendingreview', 'returned'),
      rejected: countState('rejected'),
      users: userCounts.size,
      mostActiveUser: mostActive?.[0] ?? '—',
      mostActiveCount: mostActive?.[1] ?? 0,
    };
  });

  // ===== New Request Modal =====
  showNewRequestModal = signal(false);

  /**
   * The New Request dialog's fields.
   *
   * `requestType` STARTS AT 'roleAssignment' AND NOT AT 'NewAccess'. The server's
   * `AccessRequestType` admits four values - roleAssignment, permissionGrant, dataScopeGrant and
   * temporaryElevation - and 'NewAccess' is none of them. It matched no `<option>`, so the
   * select rendered blank on open, and it was sent verbatim on submit.
   */
  newRequestForm = signal({
    requestType: '',
    userId: '',
    requestedRole: '',
    scopeType: '',
    scopeValue: '',
    effectiveFrom: '',
    effectiveTo: '',
    reviewDate: '',
    businessJustification: ''
  });

  // ===== Decision Modals =====
  showApproveModal = signal(false);
  showRejectModal = signal(false);
  showReturnModal = signal(false);
  showCancelModal = signal(false);
  showDeleteModal = signal(false);
  showDecisionResultModal = signal(false);
  decisionTarget = signal<AccessRequestView | null>(null);
  decisionReason = signal('');
  decisionResult = signal<{ reference: string; state: string; effectiveTime: string; nextAction: string } | null>(null);
  decisionError = signal('');
  actionTarget = signal<AccessRequestView | null>(null);

  constructor() {
    this.loadData();
    this.loadUserDirectory();
    this.loadRoleCatalogue();
    effect(() => { this.applyFilters(); });
  }

  /**
   * The statuses a request can be in.
   *
   * Named here rather than fetched: these are the domain's own vocabulary, and a new one means
   * new server behaviour rather than a new row in a table. An endpoint whose entire payload is
   * this list would be more moving parts than the list deserves.
   */
  private static readonly STATUS_OPTIONS: LookupItem[] = [
    { id: 'draft', code: 'draft', name: 'Draft', isActive: true },
    { id: 'submitted', code: 'submitted', name: 'Awaiting decision', isActive: true },
    { id: 'returned', code: 'returned', name: 'Sent back', isActive: true },
    { id: 'approved', code: 'approved', name: 'Approved', isActive: true },
    { id: 'rejected', code: 'rejected', name: 'Rejected', isActive: true },
    { id: 'withdrawn', code: 'withdrawn', name: 'Withdrawn', isActive: true },
    { id: 'expired', code: 'expired', name: 'Expired', isActive: true },
  ];

  /** What can be asked for. Also the domain's own vocabulary. */
  private static readonly REQUEST_TYPE_OPTIONS: LookupItem[] = [
    { id: 'roleAssignment', code: 'roleAssignment', name: 'A role', isActive: true },
    { id: 'permissionGrant', code: 'permissionGrant', name: 'A single permission', isActive: true },
    { id: 'dataScopeGrant', code: 'dataScopeGrant', name: 'A wider data scope', isActive: true },
    { id: 'temporaryElevation', code: 'temporaryElevation', name: 'Temporary elevation', isActive: true },
  ];

  private loadData(): void {
    this.loading.set(true);
    this.loadError.set(false);

    const filter: AccessRequestSearchFilter = { page: 1, pageSize: 100 } as AccessRequestSearchFilter;

    this.api.getRequests(filter).subscribe({
      next: (page) => {
        this.data.set({
          requests: page.items ?? [],
          totalCount: page.totalCount ?? 0,

          // The statuses and request types are the domain's own vocabulary rather than
          // configuration, so they are named here instead of fetched. A new status means new
          // server behaviour, not a new row in a table.
          statusOptions: AccessRequestComponent.STATUS_OPTIONS,
          requestTypeOptions: AccessRequestComponent.REQUEST_TYPE_OPTIONS,
          scopeTypeOptions: AccessRequestComponent.SCOPE_TYPE_OPTIONS,
          roleOptions: this.availableRoles(),
        });

        this.loading.set(false);
        this.applyFilters();
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.loadError.set(true);
        this.errorMessage.set(error.message);
        this.toast.show('Error', 'Failed to load access requests.', 'error');
      },
    });
  }

  /**
   * The kinds of thing access can be limited to.
   *
   * The domain's own vocabulary, like the statuses above: each of these is a code path that
   * decides which records a permission reaches, not a row somebody can add.
   */
  private static readonly SCOPE_TYPE_OPTIONS: LookupItem[] = [
    { id: 'organisation', code: 'organisation', name: 'Whole organisation', isActive: true },
    { id: 'geography', code: 'geography', name: 'A place', isActive: true },
    { id: 'campaign', code: 'campaign', name: 'A campaign', isActive: true },
    { id: 'warehouse', code: 'warehouse', name: 'A warehouse', isActive: true },
    { id: 'queue', code: 'queue', name: 'A work queue', isActive: true },
    { id: 'assignment', code: 'assignment', name: 'What they are assigned', isActive: true },
    { id: 'explicitRecord', code: 'explicitRecord', name: 'Named records only', isActive: true },
  ];

  /** The roles that can be asked for. Populated by `loadRoleCatalogue` below. */
  readonly availableRoles = signal<LookupItem[]>([]);

  /**
   * The roles the New Request dialog offers.
   *
   * FETCHED, UNLIKE THE THREE VOCABULARIES ABOVE, and that is the whole difference. A status or
   * a scope type is a code path and can be named here; a role is a row somebody creates, so the
   * only honest source is the catalogue. This signal was declared, read into `roleOptions` and
   * never written to, which is why the dialog's one required dropdown offered nothing but its
   * own placeholder and no access request could be raised through the screen at all.
   *
   * `/roles/lookup` RATHER THAN THE FULL SEARCH: the server already excludes platform roles and
   * retired ones, so what comes back is exactly the set that can actually be asked for.
   *
   * NON-BLOCKING, like the user directory. The queue is worth rendering without the dialog's
   * dropdown; a failure here leaves the list usable and only the Requested Role picker empty,
   * which is the same shape of degradation the directory load already accepts.
   */
  private loadRoleCatalogue(): void {
    this.roleApi.getRoleLookup().subscribe({
      next: (roles) => {
        this.availableRoles.set(roles.map((role) => ({
          id: role.id ?? '',
          code: role.code ?? '',
          name: role.name ?? role.code ?? '',
          isActive: true,

          // What the option's parenthesis shows. A role name alone does not say whether it is
          // the privileged one, and "how much does this grant" is the question somebody
          // approving the request will ask first.
          description: role.isPrivileged === true
            ? `Privileged - ${role.permissionCount ?? 0} permissions`
            : `${role.permissionCount ?? 0} permissions`,
        })));

        this.refreshRoleOptions();
      },
      error: () => { /* Non-blocking: the queue renders without the dialog's role list. */ },
    });
  }

  /**
   * Puts the loaded roles onto the view model the template reads.
   *
   * NEEDED BECAUSE THE TWO LOADS RACE. `data()` is assembled by `loadData`, which takes the
   * roles from `availableRoles()` at the moment it completes - so whichever of the two calls
   * finishes second has to write into the other's result. `loadData` reads the signal, and this
   * writes into `data()`, which covers both orders.
   */
  private refreshRoleOptions(): void {
    const current = this.data();

    if (current) {
      this.data.set({ ...current, roleOptions: this.availableRoles() });
    }
  }

  private loadUserDirectory(): void {
    const filter: UserSearchFilter = { pageIndex: 1, pageSize: 100 };
    this.userApi.getDirectory(filter).subscribe({
      next: (res) => {
        this.userOptions.set((res.users.items ?? []).map(u => ({
          id: u.id ?? '',
          reference: u.code ?? '',
          displayName: u.displayName ?? '',
          orgUnit: u.organisationUnitName ?? ''
        })));
      },
      error: () => { /* Non-blocking */ }
    });
  }

  retry(): void { this.loadData(); }

  applyFilters(): void {
    const all = this.data()?.requests ?? [];
    const q = this.searchQuery().toLowerCase();
    const s = this.filterState();
    let result = all;
    if (q) {
      result = result.filter((r) =>
        (r.requestNumber ?? '').toLowerCase().includes(q)
        || (r.requestedForName ?? '').toLowerCase().includes(q));
    }
    if (s) result = result.filter(r => r.status === s);
    this.filteredRequests.set(result.map(r => this.toAccessRequestView(r)));
    this.currentPage.set(1);
  }

  clearFilters(): void { this.searchQuery.set(''); this.filterState.set(''); }

  /** Status filter dropdown in the table toolbar. */
  pickStatus(id: string): void {
    this.filterState.set(id);
    this.openDd.set(null);
  }

  openFilters(): void { this.showFilters.set(true); }
  closeFilters(): void { this.showFilters.set(false); }

  goToPage(page: number): void {
    this.currentPage.set(Math.min(Math.max(page, 1), this.totalPages()));
  }

  // ===== Pagination: page-size picker and numbered pages =====

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
    this.openDd.set(null);
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

  // ===== Custom dropdowns (no native <select>) =====

  /** Which custom dropdown is open: 'pageSize' | 'requestType' | 'user' | 'role' | 'scopeType'. */
  readonly openDd = signal<string | null>(null);

  toggleDd(key: string): void {
    this.dpField.set(null);
    this.openDd.set(this.openDd() === key ? null : key);
  }

  /** Sets one field of the New Request form and closes the dropdown. */
  pickField(field: 'requestType' | 'userId' | 'requestedRole' | 'scopeType', value: string): void {
    this.newRequestForm.set({ ...this.newRequestForm(), [field]: value });
    this.openDd.set(null);
  }

  optionName(options: LookupItem[] | undefined | null, id: string): string {
    return (options ?? []).find(option => option.id === id)?.name ?? '';
  }

  selectedUser(): { id: string; reference: string; displayName: string; orgUnit: string } | undefined {
    const id = this.newRequestForm().userId;
    return this.userOptions().find(u => u.id === id);
  }

  initials(name: string | null | undefined): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  // ===== Custom date picker (no native date input) =====

  readonly dpField = signal<'effectiveFrom' | 'effectiveTo' | 'reviewDate' | null>(null);
  readonly dpView = signal(new Date());
  readonly weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  readonly dateFields: { key: 'effectiveFrom' | 'effectiveTo' | 'reviewDate'; label: string }[] = [
    { key: 'effectiveFrom', label: 'Effective from' },
    { key: 'effectiveTo', label: 'Effective to' },
    { key: 'reviewDate', label: 'Review date' },
  ];
  dateValue(key: 'effectiveFrom' | 'effectiveTo' | 'reviewDate'): string {
    return this.newRequestForm()[key] ?? '';
  }

  openDatePicker(field: 'effectiveFrom' | 'effectiveTo' | 'reviewDate'): void {
    this.openDd.set(null);
    if (this.dpField() === field) {
      this.dpField.set(null);
      return;
    }
    const current = this.newRequestForm()[field];
    this.dpView.set(current ? new Date(current + 'T00:00:00') : new Date());
    this.dpField.set(field);
  }

  /**
   * Where the open calendar sits, in its containing block's coordinates.
   *
   * The pop-up is position: fixed so the scrolling modal body cannot clip it. But a fixed
   * element is only relative to the screen when no ancestor has a transform - the modal does
   * (its pop-in animation, and possibly global styles), which made screen coordinates land in
   * the wrong place. So the pop-up is first drawn hidden at 0,0, its real on-screen origin is
   * measured, and the offset is corrected - right whatever the containing block turns out to be.
   * Null while measuring; the template keeps it hidden until then.
   */
  readonly dpPos = signal<{ top: number; left: number } | null>(null);

  /** Puts the calendar under its field (above it when there is no room), inside the modal. */
  placeDatePicker(trigger: HTMLElement): void {
    this.dpPos.set(null);

    setTimeout(() => {
      const pop = document.querySelector<HTMLElement>('.ar-dp-pop');
      if (!pop) {
        return;                                   // it was a click that closed the picker
      }

      const field = trigger.getBoundingClientRect();
      const bounds = (trigger.closest('.ar-modal') as HTMLElement | null)?.getBoundingClientRect()
        ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const origin = pop.getBoundingClientRect(); // drawn at top 0 / left 0 → where 0,0 really is
      const gap = 6;
      const pad = 8;

      const below = field.bottom + gap;
      const above = field.top - gap - origin.height;
      const fitsBelow = below + origin.height <= bounds.bottom - pad;
      const top = fitsBelow || above < bounds.top + pad ? below : above;
      const left = Math.min(Math.max(field.left, bounds.left + pad), bounds.right - origin.width - pad);

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
  }

  private toAccessRequestView(r: AccessRequestItemApi): AccessRequestView {
    return {
      id: r.id ?? '',
      reference: r.requestNumber ?? '',
      requestType: r.requestTypeDisplay ?? r.requestType ?? '',
      user: r.requestedForName ?? '',

      // The queue row is deliberately lean: it carries what triage needs, not the whole
      // request. The justification, the scope and the decision notes are on the detail, which
      // is fetched when a row is opened.
      currentRoleAndScope: '',
      requestedRole: r.roleName ?? r.permissionCode ?? '—',
      scopeType: 'organisation',
      scopeValue: 'All',
      effectiveFrom: r.accessStartsAtUtc ? this.formatDate(r.accessStartsAtUtc) : '—',
      effectiveTo: r.accessEndsAtUtc ? this.formatDate(r.accessEndsAtUtc) : '—',
      businessJustification: '',
      requester: r.requestedByName ?? '—',
      requestedTime: r.submittedAtUtc ? this.formatDateTime(r.submittedAtUtc) : '—',
      approverRoute: 'Independent approver',
      slaDue: '—',
      approvalState: r.statusDisplay ?? r.status ?? '',
      approvalStateClass: this.stateClass(r.status ?? ''),
      decision: r.decidedAtUtc
        ? (r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : '')
        : '',
      decisionReason: '',
      decisionActor: r.decidedByName ?? '',
      decisionTime: r.decidedAtUtc ? this.formatDateTime(r.decidedAtUtc) : '',
      version: r.version ?? 0,

      // `canDecide` is the server's answer to the independence rule for THIS caller: it is
      // false on a request they raised themselves, whatever permissions they hold. Deriving it
      // here would mean re-implementing the rule and eventually disagreeing with it.
      permittedActions: r.canDecide ? ['Approve', 'Reject', 'Return'] : ['View'],
      canDecide: r.canDecide === true,

      // NAMED, NOT JUST WITHHELD. An approver who finds no Approve button and no explanation
      // has no idea whether the queue is broken, their permissions are wrong, or the rule is
      // working as intended. The overwhelmingly common reason is the independence rule, and
      // the row already knows who raised it.
      cannotDecideReason: r.canDecide === true
        ? ''
        : (r.requestedByName && r.requestedByName === this.currentUserName())
          ? 'You raised this request, so somebody else has to decide it.'
          : 'You are not an eligible approver for this request.',
    };
  }

  private stateClass(state: string): string {
    switch (state) {
      case 'Submitted': return 'bg-info';
      case 'PendingReview': return 'bg-warning';
      case 'Approved': return 'bg-success';
      case 'Rejected': return 'bg-danger';
      case 'Draft': return 'bg-secondary';
      case 'Cancelled': return 'bg-secondary';
      case 'Returned': return 'bg-warning';
      default: return 'bg-secondary';
    }
  }

  private formatDate(value: string): string {
    try {
      return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return value;
    }
  }

  private formatDateTime(value: string): string {
    try {
      return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return value;
    }
  }

  // ===== NEW REQUEST =====
  openNewRequest(): void {
    this.userSearch.set('');
    this.roleSearch.set('');
    this.newRequestForm.set({
      requestType: '',
      userId: '',
      requestedRole: '',
      scopeType: '',
      scopeValue: '',
      effectiveFrom: '',
      effectiveTo: '',
      reviewDate: '',
      businessJustification: ''
    });
    this.openDd.set(null);
    this.dpField.set(null);
    this.showNewRequestModal.set(true);
  }

  closeNewRequest(): void {
    this.showNewRequestModal.set(false);
  }

  getSelectedUserName(): string {
    const id = this.newRequestForm().userId;
    const user = this.userOptions().find(u => u.id === id);
    return user ? user.displayName : '';
  }

  submitNewRequest(): void {
    const form = this.newRequestForm();
    if (!form.requestType || !form.userId || !form.requestedRole || !form.businessJustification.trim()) {
      this.toast.show('Validation Error', 'Request type, user, requested role and justification are required.', 'warning');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    const request: CreateAccessRequestRequest = {
      requestType: form.requestType as CreateAccessRequestRequest['requestType'],
      requestedForUserId: form.userId,
      roleId: form.requestedRole || null,
      scopeType: (form.scopeType || undefined) as CreateAccessRequestRequest['scopeType'],
      scopeValue: form.scopeValue || null,
      accessStartsAtUtc: form.effectiveFrom ? new Date(form.effectiveFrom).toISOString() : new Date().toISOString(),
      accessEndsAtUtc: form.effectiveTo ? new Date(form.effectiveTo).toISOString() : null,
      businessJustification: form.businessJustification.trim(),
    };

    this.api.createRequest(request).subscribe({
      next: (outcome) => {
        this.submitting.set(false);
        this.showNewRequestModal.set(false);

        // A persistent confirmation, not just a toast: somebody who raised a request needs its
        // reference afterwards, and a toast that has faded is no use for that.
        this.decisionResult.set({
          reference: outcome.message ?? 'Draft saved',
          state: outcome.status ?? 'Draft',
          effectiveTime: this.formatDateTime(new Date().toISOString()),
          nextAction: `The request has been drafted. Submit it for independent approval.`
        });
        this.showDecisionResultModal.set(true);
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.errorMessage.set(error.message);
        this.toast.show('Create Failed', error.message, 'error');
      },
    });
  }

  // ===== SUBMIT (draft → submitted for independent decision) =====
  submitRequest(request: AccessRequestView): void {
    if (request.approvalState !== 'Draft') return;

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api
      .submitRequest(request.id, {
        expectedVersion: request.version,
        comment: 'Submitted for approval',
      })
      .subscribe({
      next: (outcome) => {
        this.submitting.set(false);

        this.decisionResult.set({
          reference: request.reference,
          state: outcome.status ?? 'Submitted',
          effectiveTime: this.formatDateTime(new Date().toISOString()),
          nextAction: `Request ${request.reference} has been submitted for independent approval.`
        });
        this.showDecisionResultModal.set(true);
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.toast.show('Submit Failed', error.message, 'error');
      },
    });
  }

  // ===== RETURN (submitted/pending → back to requester for correction) =====
  openReturnModal(request: AccessRequestView): void {
    if (request.approvalState !== 'Submitted' && request.approvalState !== 'PendingReview') return;
    this.actionTarget.set(request);
    this.decisionReason.set('');
    this.decisionError.set('');
    this.showReturnModal.set(true);
  }

  closeReturnModal(): void {
    this.showReturnModal.set(false);
    this.actionTarget.set(null);
    this.decisionReason.set('');
    this.decisionError.set('');
  }

  confirmReturn(): void {
    const target = this.actionTarget();
    if (!target) return;

    const reason = this.decisionReason().trim();
    if (reason.length < 10) {
      this.decisionError.set('Return reason must be at least 10 characters.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api
      .returnRequest(target.id, { reason, expectedVersion: target.version })
      .subscribe({
      next: (outcome) => {
        this.submitting.set(false);
        this.closeReturnModal();
        // Re-read rather than merge: the server may have done more than this screen
        // predicted — applied the grant, stamped the decision — and a locally patched row
        // would quietly disagree with it.

        this.decisionResult.set({
          reference: target.reference,
          state: 'Returned',
          effectiveTime: this.formatDateTime(new Date().toISOString()),
          nextAction: `Request ${target.reference} was returned to the requester for correction.`
        });
        this.showDecisionResultModal.set(true);
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.decisionError.set(error.message);
      },
    });
  }

  // ===== CANCEL (preserve history) =====
  openCancelModal(request: AccessRequestView): void {
    this.actionTarget.set(request);
    this.decisionReason.set('');
    this.decisionError.set('');
    this.showCancelModal.set(true);
  }

  closeCancelModal(): void {
    this.showCancelModal.set(false);
    this.actionTarget.set(null);
    this.decisionReason.set('');
    this.decisionError.set('');
  }

  confirmCancel(): void {
    const target = this.actionTarget();
    if (!target) return;

    const reason = this.decisionReason().trim();
    if (reason.length < 10) {
      this.decisionError.set('Cancellation reason must be at least 10 characters.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api
      .cancelRequest(target.id, { reason, expectedVersion: target.version })
      .subscribe({
      next: (outcome) => {
        this.submitting.set(false);
        this.closeCancelModal();
        // Re-read rather than merge: the server may have done more than this screen
        // predicted — applied the grant, stamped the decision — and a locally patched row
        // would quietly disagree with it.

        this.decisionResult.set({
          reference: target.reference,
          state: 'Cancelled',
          effectiveTime: this.formatDateTime(new Date().toISOString()),
          nextAction: `Request ${target.reference} was cancelled. The history is retained.`
        });
        this.showDecisionResultModal.set(true);
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.decisionError.set(error.message);
      },
    });
  }

  // ===== DELETE UNUSED DRAFT =====
  openDeleteModal(request: AccessRequestView): void {
    if (request.approvalState !== 'Draft') return;
    this.actionTarget.set(request);
    this.decisionReason.set('');
    this.decisionError.set('');
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.actionTarget.set(null);
    this.decisionReason.set('');
    this.decisionError.set('');
  }

  confirmDelete(): void {
    const target = this.actionTarget();
    if (!target) return;

    const reason = this.decisionReason().trim();
    if (reason.length < 10) {
      this.decisionError.set('Deletion reason must be at least 10 characters.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api
      .deleteDraft(target.id, { reason, expectedVersion: target.version })
      .subscribe({
      next: (outcome) => {
        this.submitting.set(false);
        this.closeDeleteModal();

        const items = this.filteredRequests().filter(r => r.id !== target.id);
        this.filteredRequests.set(items);

        this.decisionResult.set({
          reference: target.reference,
          state: 'Deleted',
          effectiveTime: this.formatDateTime(new Date().toISOString()),
          nextAction: `Request ${target.reference} was permanently deleted.`
        });
        this.showDecisionResultModal.set(true);
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.decisionError.set(error.message);
      },
    });
  }

  // ===== APPROVE (primary decision — only for Submitted/Pending state) =====
  openApproveModal(request: AccessRequestView): void {
    if (request.approvalState !== 'Submitted' && request.approvalState !== 'PendingReview') return;
    this.decisionTarget.set(request);
    this.decisionReason.set('');
    this.decisionError.set('');
    this.showApproveModal.set(true);
  }

  closeApproveModal(): void {
    this.showApproveModal.set(false);
    this.decisionTarget.set(null);
    this.decisionReason.set('');
    this.decisionError.set('');
  }

  confirmApprove(): void {
    const target = this.decisionTarget();
    if (!target) return;

    // Decision reason is required (10–1000 characters)
    const reason = this.decisionReason().trim();
    if (reason.length < 10) {
      this.decisionError.set('Decision reason must be at least 10 characters.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api.approveRequest(target.id, target.version, reason).subscribe({
      next: (outcome) => {
        this.submitting.set(false);

        const effectiveTime = this.formatDateTime(new Date().toISOString());

        // Persistent confirmation — not just a toast
        this.decisionResult.set({
          reference: target.reference,
          state: 'Approved',
          effectiveTime,
          nextAction: `${target.requestedRole} is now active for ${target.user}.`
        });
        this.showApproveModal.set(false);
        this.showDecisionResultModal.set(true);
        this.decisionTarget.set(null);
        this.decisionReason.set('');
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.decisionError.set(error.message);
      },
    });
  }

  // ===== REJECT (secondary/danger — requires explicit reason) =====
  openRejectModal(request: AccessRequestView): void {
    if (request.approvalState !== 'Submitted' && request.approvalState !== 'PendingReview') return;
    this.decisionTarget.set(request);
    this.decisionReason.set('');
    this.decisionError.set('');
    this.showRejectModal.set(true);
  }

  closeRejectModal(): void {
    this.showRejectModal.set(false);
    this.decisionTarget.set(null);
    this.decisionReason.set('');
    this.decisionError.set('');
  }

  confirmReject(): void {
    const target = this.decisionTarget();
    if (!target) return;

    // Decision reason is required (10–1000 characters)
    const reason = this.decisionReason().trim();
    if (reason.length < 10) {
      this.decisionError.set('Decision reason must be at least 10 characters.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api.rejectRequest(target.id, target.version, reason).subscribe({
      next: (outcome) => {
        this.submitting.set(false);

        const effectiveTime = this.formatDateTime(new Date().toISOString());

        // Persistent confirmation — not just a toast
        this.decisionResult.set({
          reference: target.reference,
          state: 'Rejected',
          effectiveTime,
          nextAction: `Access was not granted for ${target.user}. The decision is recorded permanently.`
        });
        this.showRejectModal.set(false);
        this.showDecisionResultModal.set(true);
        this.decisionTarget.set(null);
        this.decisionReason.set('');
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.decisionError.set(error.message);
      },
    });
  }

  closeDecisionResultModal(): void {
    this.showDecisionResultModal.set(false);
    this.decisionResult.set(null);
  }

  goBack(): void { this.router.navigate(['/app/administration/access/user-directory']); }
}