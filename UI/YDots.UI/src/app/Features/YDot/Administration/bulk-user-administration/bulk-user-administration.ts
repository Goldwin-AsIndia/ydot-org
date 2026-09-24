import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ToastService } from '../../../../Shared/services/toast.service';
import { readableIdentifier } from '../../../../Shared/models/identifier';
import { BulkUserAdminApiService } from '../../../../Service/bulk-user-admin-api.service';
import { RoleCatalogueApiService } from '../../../../Service/role-catalogue-api.service';
import { UserDirectoryApiService } from '../../../../Service/user-directory-api.service';
import {
  BulkActionOption,
  BulkActionRequest,
  BulkActionType,
  BulkImpactPreviewResponse,
  BulkOperationResponse,
  BulkUserAdministrationViewResponse,
} from '../../../../Shared/models/bulk-user-administration.model';
import { UserListItem, UserSearchFilter } from '../../../../Shared/models/user-directory.model';
import { LookupItem } from '../../../../Shared/models/api-response.model';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

@Component({
  selector: 'app-bulk-user-administration',
  standalone: true,
  imports: [PageHeader, 
    CommonModule,
    ReactiveFormsModule,

    // For the empty state's link back to the directory. Without it routerLink binds to
    // nothing and the button is inert - the quiet kind of failure, with no console error.
    RouterModule,
  ],
  templateUrl: './bulk-user-administration.html',
  styleUrl: './bulk-user-administration.css',
})
export class BulkUserAdministrationComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly api = inject(BulkUserAdminApiService);
  private readonly userApi = inject(UserDirectoryApiService);
  private readonly roleApi = inject(RoleCatalogueApiService);

  selectedUsers = signal<UserListItem[]>([]);

  data = signal<BulkUserAdministrationViewResponse | null>(null);
  loading = signal(true);
  loadError = signal(false);
  submitting = signal(false);

  /** The validated preview (and the result of the submit). */
  impactPreview = signal<BulkImpactPreviewResponse | null>(null);
  operation = signal<BulkOperationResponse | null>(null);
  /** True while a preview/validate request is in flight. */
  validating = signal(false);
  /** What this caller may do, decided by the server from their permissions. */
  permittedActions = signal<string[]>([]);
  approverRequired = signal(false);
  approverReason = signal('');
  /** The operation id that produced the downloadable result file. */
  operationId = signal('');
  validationError = signal('');

  /** Scope type options loaded from the user-directory API. */
  scopeTypeOptions = signal<LookupItem[]>([]);
  /** Campaign options loaded from the bulk view API. */

  // Selection state
  totalCount = signal(0);
  excludedCount = signal(0);
  affectedCount = signal(0);

  // Many-users display threshold
  readonly MAX_CHIPS = 20;
  showAllSelected = signal(false);

  // Modal
  showConfirmModal = signal(false);
  showPreviewModal = signal(false);
  showResultModal = signal(false);
  resultFileUrl = signal('');

  // Conditional fields
  selectedAction = signal('');

  /** Section anchors on the single-page layout: 0 Action, 1 Selected users, 2 Justification. */
  private static readonly SECTION_IDS = ['buSectionAction', 'buSectionScope', 'buSectionJustification'];

  /**
   * Line-icon paths per action (24×24 viewBox, stroke only). Drawn as inline SVG so the
   * selected card can animate each stroke being drawn, line by line.
   */
  private static readonly ACTION_PATHS: Record<string, string[]> = {
    invite: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M3 7l9 6 9-6'],
    activate: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'M8 12.5l2.5 2.5L16 9.5'],
    suspend: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'M10 9v6', 'M14 9v6'],
    reactivate: ['M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z', 'M8 11V7a4 4 0 0 1 7.5-2', 'M12 15v2'],
    deactivate: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'M9 9l6 6', 'M15 9l-6 6'],
    assignRole: ['M9 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8z', 'M2 21a7 7 0 0 1 14 0', 'M19 8v6', 'M16 11h6'],
    removeRole: ['M9 4a4 4 0 1 1 0 8a4 4 0 1 1 0-8z', 'M2 21a7 7 0 0 1 14 0', 'M16 11h6'],
    resetPassword: ['M7.5 11.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8z', 'M10.5 12.5L20 3', 'M16 7l3 3', 'M13.5 9.5l2 2'],
    forceSignOut: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
    requireMfaReset: ['M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
    extendAccess: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'M12 7v5l3 2'],
    export: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  };

  /** The stroke paths for an action's line icon. */
  actionPaths(value: string): string[] {
    return BulkUserAdministrationComponent.ACTION_PATHS[value] ?? ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z'];
  }

  /** Remix icon per action, for the action cards. */
  private static readonly ACTION_ICONS: Record<string, string> = {
    invite: 'ri-mail-line',
    activate: 'ri-checkbox-circle-line',
    suspend: 'ri-pause-circle-line',
    reactivate: 'ri-lock-unlock-line',
    deactivate: 'ri-close-circle-line',
    assignRole: 'ri-user-add-line',
    removeRole: 'ri-user-unfollow-line',
    resetPassword: 'ri-lock-password-line',
    forceSignOut: 'ri-logout-box-r-line',
    requireMfaReset: 'ri-shield-keyhole-line',
    extendAccess: 'ri-time-line',
    export: 'ri-download-2-line',
  };

  // =========================================================================================
  // Custom date picker (Extend access) — replaces the native datetime-local input.
  // Date only: access ends at the end of the chosen day, so the value is written to the
  // `accessEndsAt` control as 'YYYY-MM-DDT23:59' (same shape datetime-local produced) and
  // buildRequest() is unchanged.
  // =========================================================================================
  readonly dpOpen = signal(false);
  /** Which grid is showing: days of a month, months of a year, or a range of years. */
  readonly dpMode = signal<'day' | 'month' | 'year'>('day');
  /** The month on screen: year + month index (0–11). */
  readonly dpView = signal(this.monthOf(new Date()));
  /** Draft selection inside the open picker. */
  readonly dpDate = signal<Date | null>(null);
  /** The applied value, mirrored from the form control for display. */
  readonly accessEnds = signal('');

  readonly dpWeekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  readonly dpMonthName = computed(() =>
    new Date(this.dpView().y, this.dpView().m, 1).toLocaleDateString('en-GB', { month: 'long' }));

  /** Header: the draft date in large type. */
  readonly dpHeadDay = computed(() => {
    const d = this.dpDate();
    return d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Select a date';
  });

  readonly dpHeadYear = computed(() => (this.dpDate() ?? new Date()).getFullYear());

  /** Days from today to the draft date. */
  readonly dpDraftDays = computed(() => {
    const d = this.dpDate();
    if (!d) return null;
    return Math.round((d.getTime() - this.startOfDay(new Date()).getTime()) / 86400000);
  });

  /** 6 weeks × 7 days, Monday first. */
  readonly dpCells = computed(() => {
    const { y, m } = this.dpView();
    const first = new Date(y, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const today = this.startOfDay(new Date());
    const picked = this.dpDate();
    return Array.from({ length: 42 }, (_, i) => {
      const date = new Date(y, m, 1 - offset + i);
      return {
        key: date.toDateString(),
        date,
        day: date.getDate(),
        inMonth: date.getMonth() === m,
        isToday: date.getTime() === today.getTime(),
        isPast: date < today,
        isSelected: !!picked && date.toDateString() === picked.toDateString(),
      };
    });
  });

  /** The 12 months of the year on screen. */
  readonly dpMonths = computed(() => {
    const { y } = this.dpView();
    const now = this.monthOf(new Date());
    const picked = this.dpDate();
    return Array.from({ length: 12 }, (_, m) => ({
      m,
      label: new Date(y, m, 1).toLocaleDateString('en-GB', { month: 'short' }),
      isPast: y < now.y || (y === now.y && m < now.m),
      isCurrent: y === now.y && m === now.m,
      isSelected: !!picked && picked.getFullYear() === y && picked.getMonth() === m,
    }));
  });

  /** 12 years starting from this year. */
  readonly dpYears = computed(() => {
    const start = new Date().getFullYear();
    const picked = this.dpDate()?.getFullYear();
    return Array.from({ length: 12 }, (_, i) => ({
      y: start + i,
      isCurrent: i === 0,
      isSelected: picked === start + i,
    }));
  });

  /** Can the user go back? Not before the current month / year. */
  readonly dpCanPrev = computed(() => {
    const v = this.dpView(), now = this.monthOf(new Date());
    if (this.dpMode() === 'month') return v.y > now.y;
    if (this.dpMode() === 'year') return false;
    return v.y > now.y || (v.y === now.y && v.m > now.m);
  });

  readonly dpCanNext = computed(() => this.dpMode() !== 'year');

  /** Human label for the trigger, e.g. "Sat, 31 Oct 2026". */
  readonly accessEndsLabel = computed(() => {
    const v = this.accessEnds();
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  });

  toggleDp(): void {
    if (this.dpOpen()) { this.dpOpen.set(false); return; }
    this.roleDdOpen.set(false);
    const current = this.accessEnds() ? new Date(this.accessEnds()) : null;
    const valid = !!current && !isNaN(current.getTime());
    this.dpDate.set(valid ? this.startOfDay(current!) : null);
    this.dpView.set(this.monthOf(valid ? current! : new Date()));
    this.dpMode.set('day');
    this.dpOpen.set(true);
  }

  /** Previous / next month, year, depending on the grid showing. */
  dpShift(delta: number): void {
    const { y, m } = this.dpView();
    if (this.dpMode() === 'day') this.dpView.set(this.monthOf(new Date(y, m + delta, 1)));
    else if (this.dpMode() === 'month') this.dpView.set({ y: y + delta, m });
  }

  dpShowMonths(): void {
    this.dpMode.set(this.dpMode() === 'month' ? 'day' : 'month');
  }

  dpShowYears(): void {
    this.dpMode.set(this.dpMode() === 'year' ? 'day' : 'year');
  }

  dpPickMonth(m: number): void {
    this.dpView.update((v) => ({ y: v.y, m }));
    this.dpMode.set('day');
  }

  dpPickYear(y: number): void {
    const now = this.monthOf(new Date());
    const m = y === now.y ? Math.max(this.dpView().m, now.m) : this.dpView().m;
    this.dpView.set({ y, m });
    this.dpMode.set('month');
  }

  dpPick(cell: { date: Date; isPast: boolean; inMonth: boolean }): void {
    if (cell.isPast) return;
    this.dpDate.set(this.startOfDay(cell.date));
    if (!cell.inMonth) this.dpView.set(this.monthOf(cell.date));
  }

  dpToday(): void {
    const t = this.startOfDay(new Date());
    this.dpDate.set(t);
    this.dpView.set(this.monthOf(t));
    this.dpMode.set('day');
  }

  dpApply(): void {
    const d = this.dpDate();
    if (!d) return;
    const pad = (n: number) => String(n).padStart(2, '0');
    // End of the chosen day.
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`;
    this.accessEnds.set(value);
    this.bulkForm.controls.accessEndsAt.setValue(value);
    this.bulkForm.controls.accessEndsAt.markAsTouched();
    this.dpOpen.set(false);
  }

  dpClear(): void {
    this.dpDate.set(null);
    this.accessEnds.set('');
    this.bulkForm.controls.accessEndsAt.setValue('');
    this.dpOpen.set(false);
  }

  private monthOf(d: Date): { y: number; m: number } {
    return { y: d.getFullYear(), m: d.getMonth() };
  }

  private startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** Custom role dropdown (Add / Remove a role) — no native <select>. */
  readonly roleDdOpen = signal(false);
  readonly roleQuery = signal('');
  readonly roleId = signal('');

  readonly roleLabel = computed(() => {
    const id = this.roleId();
    return id ? (this.roleOptions().find((r) => String(r.id) === id)?.name ?? id) : '';
  });

  readonly filteredRoles = computed(() => {
    const q = this.roleQuery().trim().toLowerCase();
    const all = this.roleOptions();
    return q ? all.filter((r) => (r.name ?? '').toLowerCase().includes(q)) : all;
  });
  validationErrors = signal<string[]>([]);

  bulkForm = this.fb.group({
    action: ['', Validators.required],

    // THE ROLE THE ACTION GRANTS OR REMOVES. This replaces a control named `campaign`, which was
    // written only by the access-review campaign picker and read into `roleId` on the way out -
    // so the server's "Choose a role for this action." was unavoidable for assignRole and
    // removeRole, and there was no control on the screen that could have satisfied it.
    roleId: [''],

    // The new end of the access window, for Extend access. `accessEndsAtUtc` on the request.
    accessEndsAt: [''],

    suspensionReason: [''],
    businessJustification: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(1000)]],
  });

  constructor() {
    const navState = history.state as { selectedUsers?: UserListItem[] } | null;
    const passedSelection = navState?.selectedUsers;
    if (passedSelection && passedSelection.length > 0) {
      this.selectedUsers.set(passedSelection);
      this.totalCount.set(passedSelection.length);
    }
    this.loadData();

    effect(() => {
      this.bulkForm.updateValueAndValidity({ emitEvent: false });
      const errors: string[] = [];
      const actionErrors = this.bulkForm.controls.action.errors;
      const justErrors = this.bulkForm.controls.businessJustification.errors;

      if (actionErrors?.['required']) errors.push('Bulk action is required.');
      if (justErrors?.['required']) errors.push('Business justification is required.');
      if (justErrors?.['minlength']) errors.push('Business justification must be at least 10 characters.');
      if (justErrors?.['maxlength']) errors.push('Business justification cannot exceed 1000 characters.');

      this.validationErrors.set(errors);
    });
  }

  /** Recent operations, so somebody can see what was run and how it went. */
  readonly recentOperations = signal<BulkOperationResponse[]>([]);

  /** The roles Add/Remove a role can name, from the catalogue the server already publishes. */
  readonly roleOptions = signal<LookupItem[]>([]);

  /**
   * What a bulk operation can do.
   *
   * The domain's own vocabulary rather than configuration: each of these is a code path on the
   * server, and a new one means new server behaviour rather than a new row in a table.
   */
  private static readonly ACTIONS: BulkActionOption[] = [
    { value: 'invite', label: 'Send invitations', description: 'E-mail an activation link to each person.' },
    { value: 'activate', label: 'Activate', description: 'Bring accounts into use.' },
    { value: 'suspend', label: 'Suspend', description: 'Pause access and end every live session.' },
    { value: 'reactivate', label: 'Lift suspension', description: 'Let people sign in again.' },
    { value: 'deactivate', label: 'Deactivate', description: 'End access permanently. Nothing is deleted.' },
    { value: 'assignRole', label: 'Add a role', description: 'Grant one role to everybody selected.' },
    { value: 'removeRole', label: 'Remove a role', description: 'Take one role away from everybody selected.' },
    { value: 'resetPassword', label: 'Send a password reset', description: 'E-mail a reset link. No password is generated.' },
    { value: 'forceSignOut', label: 'Sign out everywhere', description: 'End every session on every device.' },
    { value: 'requireMfaReset', label: 'Reset two-step verification', description: 'Clear enrolled factors so they are set up again.' },
    { value: 'extendAccess', label: 'Extend access', description: 'Move the end of the access window.' },
    { value: 'export', label: 'Export', description: 'Download the selection as a file.' },
  ];

  private loadData(): void {
    this.loading.set(true);
    this.loadError.set(false);

    // The actions a bulk operation can perform are the domain's own vocabulary, not
    // configuration: each one is a code path on the server. Naming them here rather than
    // fetching a list keeps the screen honest about that.
    this.data.set({ availableActions: BulkUserAdministrationComponent.ACTIONS });
    this.permittedActions.set(BulkUserAdministrationComponent.ACTIONS.map((a) => a.value));
    this.loading.set(false);

    this.loadRoles();

    this.api.getOperations(1, 20).subscribe({
      next: (page) => {
        this.recentOperations.set(page.items ?? []);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.loadError.set(true);
        this.validationError.set(error.message);
        this.toast.show('Error', 'Failed to load bulk administration data.', 'error');
      },
    });

    // Load the scope type options from the user-directory API so the dropdown
    // is bound to real server data, not hard-coded strings.
    const filter: UserSearchFilter = { pageIndex: 1, pageSize: 1 };
    this.userApi.getDirectory(filter).subscribe({
      next: (res) => {
        this.scopeTypeOptions.set(res.dataScopeTypeOptions ?? []);
      },
      error: () => {
        // Non-blocking — the form still works with the fallback options.
        // A LookupItem is id/code/name, matching what the API sends. The ids here are the
        // enum names, which is what the server expects back for a scope type - so the fallback
        // stays usable rather than merely present.
        this.scopeTypeOptions.set([
          { id: 'organisation', code: 'organisation', name: 'Organisation', isActive: true },
          { id: 'geography', code: 'geography', name: 'Geography', isActive: true },
          { id: 'campaign', code: 'campaign', name: 'Campaign', isActive: true },
          { id: 'warehouse', code: 'warehouse', name: 'Warehouse', isActive: true },
          { id: 'queue', code: 'queue', name: 'Queue', isActive: true },
          { id: 'assignment', code: 'assignment', name: 'Assignment', isActive: true },
          { id: 'explicitRecord', code: 'explicitRecord', name: 'Explicit records', isActive: true },
        ]);
      },
    });
  }

  /**
   * The role catalogue, for the Add/Remove a role picker.
   *
   * Non-blocking: the other ten actions do not need it, and a failure here should not stop
   * somebody suspending forty accounts.
   */
  private loadRoles(): void {
    this.roleApi.getRoleLookup().subscribe({
      next: (roles) => this.roleOptions.set(roles.map((role) => ({
        id: role.id ?? '',
        code: role.code ?? '',
        name: role.name ?? role.code ?? '',
        isActive: true,
      }))),
      error: () => { /* Non-blocking. */ },
    });
  }

  retry(): void {
    this.loadData();
  }

  onActionChange(): void {
    this.selectedAction.set(this.bulkForm.value.action ?? '');
  }

  /** Maps the form + selected users into the bulk action request the API expects. */
  private buildRequest(): BulkActionRequest {
    const form = this.bulkForm.value;
    return {
      actionType: (form.action || undefined) as BulkActionRequest['actionType'],
      // Ids, not references. The API takes user ids and resolves nothing: a reference like
      // USR-000123 is unique only inside one Organisation, so resolving one server-side would
      // mean deciding which Organisation it belonged to — which is exactly the guess this
      // system never makes.
      userIds: this.selectedUsers().map(u => u.id ?? '').filter(Boolean),

      // Explicit ids only. There is deliberately no "everybody matching this scope" option: a
      // bulk action driven by a scope expression is one where nobody has looked at the list, and
      // the whole point of the preview is that somebody does.
      roleId: form.roleId || null,
      accessEndsAtUtc: form.accessEndsAt ? new Date(form.accessEndsAt).toISOString() : null,
      reason: form.businessJustification || form.suspensionReason || null,

      // Never true from this screen. Applying is a second, deliberate press after the preview
      // has been read — which is the whole shape of this feature.
      applyImmediately: false,
    };
  }

  validateSelection(): void {
    const selected = this.selectedUsers();
    if (selected.length === 0) {
      this.toast.show('No Selection', 'No users were passed from the directory. Please go back and select users.', 'warning');
      return;
    }
    if (!this.selectedAction()) {
      this.toast.show('Validation Error', 'Please select a bulk action first.', 'warning');
      return;
    }

    this.validating.set(true);
    this.validationError.set('');
    // Creating the operation VALIDATES it and reports what would happen, row by row, without
    // changing anything. Applying it is a separate call — see the service for why the two-step
    // shape is the point rather than an inconvenience.
    this.createThenLoad({
      next: (detail) => {
        this.validating.set(false);

        const total = detail.totalItemCount ?? 0;
        const failed = (detail.items ?? []).filter((item) => item.isValid === false).length;

        this.toast.show(
          'Selection checked',
          `${total} in the selection. ${failed} cannot be actioned.`,
          failed > 0 ? 'warning' : 'success',
        );
      },
    });
  }

  previewImpact(): void {
    const selected = this.selectedUsers();
    if (selected.length === 0) {
      this.toast.show('No Selection', 'Select users first, then preview the impact.', 'warning');
      return;
    }
    this.validating.set(true);
    this.validationError.set('');
    this.createThenLoad({
      next: () => {
        this.validating.set(false);
        this.showPreviewModal.set(true);
      },
      failureTitle: 'Preview Failed',
    });
  }

  /**
   * Validates the selection, then reads back what the server made of it.
   *
   * TWO CALLS, AND BOTH ARE NEEDED. `POST /users/bulk-actions` validates and answers with an
   * outcome - an id, a status and a message - and nothing else. The rows, the counts and the
   * per-person reasons live on the operation, which is read with `GET bulk-operations/{id}`.
   *
   * The screen used to make only the first call and read `items` and `totalItemCount` off its
   * response. Those fields are not on it, so every counter resolved to 0 and the page reported
   * "0 in the selection" for a validation the server had genuinely performed - and `apply` was
   * left with no operation id to send, so nothing could be applied either.
   */
  private createThenLoad(handlers: {
    next: (detail: BulkImpactPreviewResponse) => void;
    failureTitle?: string;
  }): void {
    this.api.createOperation(this.buildRequest()).subscribe({
      next: (outcome) => {
        if (!outcome.id) {
          this.validating.set(false);
          this.validationError.set('The server did not return an operation to read.');
          return;
        }

        this.api.getOperation(outcome.id).subscribe({
          next: (detail) => {
            // Held so `apply` can name the operation and its version. This is the step whose
            // absence made the Apply button report "Check the selection before applying it."
            // however many times the selection had been checked.
            this.operation.set(detail);
            this.operationId.set(detail.id ?? '');
            this.applyPreview(detail);
            handlers.next(detail);
          },
          error: (error: Error) => {
            this.validating.set(false);
            this.validationError.set(error.message);
            this.toast.show(handlers.failureTitle ?? 'Validation Failed', error.message, 'error');
          },
        });
      },
      error: (error: Error) => {
        this.validating.set(false);
        this.validationError.set(error.message);
        this.toast.show(handlers.failureTitle ?? 'Validation Failed', error.message, 'error');
      },
    });
  }

  closePreview(): void {
    this.showPreviewModal.set(false);
  }

  /**
   * Reads the validated operation into the counters the preview shows.
   *
   * The server counts rows rather than reporting a "selection" and an "eligible" pair: an
   * operation has items, and each item is either valid or carries the reason it is not. Deriving
   * the counters from the rows means the number beside "cannot be actioned" and the list beneath
   * it can never disagree.
   */
  private applyPreview(preview: BulkImpactPreviewResponse): void {
    const items = preview.items ?? [];
    const blocked = items.filter((item) => item.isValid === false);

    this.impactPreview.set(preview);
    this.totalCount.set(preview.totalItemCount ?? items.length);
    this.excludedCount.set(blocked.length);
    this.affectedCount.set((preview.totalItemCount ?? items.length) - blocked.length);

    // Whether a second pair of eyes is needed is a policy question the server answers when it
    // validates; the screen shows what it was told rather than deciding for itself.
    this.approverRequired.set(preview.status === 'queued');
    this.approverReason.set(preview.failureSummary ?? '');
  }

  submitBulkAction(): void {
    this.bulkForm.markAllAsTouched();
    if (this.bulkForm.invalid) {
      // Scroll to the section that holds the problem, rather than a toast pointing nowhere.
      this.goStep(this.bulkForm.controls.action.invalid ? 0 : 2);
      this.toast.show('Validation Error', 'Please fix the form errors before submitting.', 'error');
      return;
    }
    if (this.affectedCount() === 0 && this.totalCount() === 0) {
      this.goStep(1);
      this.toast.show('Validation Error', 'Validate the selection before submitting.', 'warning');
      return;
    }
    this.showConfirmModal.set(true);
  }

  confirmSubmit(): void {
    this.showConfirmModal.set(false);
    this.submitting.set(true);
    this.validationError.set('');

    const validated = this.operation();

    if (!validated?.id) {
      this.submitting.set(false);
      this.validationError.set('Check the selection before applying it.');
      return;
    }

    this.api
      .apply({ operationId: validated.id, expectedVersion: validated.version ?? 0 })
      .subscribe({
      // AND READ IT BACK, for the same reason the validate step does: applying answers with an
      // outcome, and the per-person results the modal lists live on the operation.
      next: (outcome) => {
        this.api.getOperation(outcome.id ?? validated.id!).subscribe({
          next: (operation) => {
            this.submitting.set(false);
            this.operation.set(operation);
            this.operationId.set(operation.id ?? '');
            this.applyPreview(operation);
            this.resultFileUrl.set(
              `bulk-operation-${readableIdentifier(operation.operationNumber, 'result')}.csv`);

            // The directory listens for this so it can re-read: several of these actions change
            // rows it is showing, and a stale list after a bulk suspend is confusing.
            window.dispatchEvent(
              new CustomEvent('bulk-operation-completed', { detail: operation }));
            this.showResultModal.set(true);

            // PARTIAL SUCCESS IS A REAL RESULT, not a failure. Forty-seven of fifty succeeding
            // is exactly what happened, and the three that did not are listed with their
            // reasons.
            const succeeded = operation.succeededItemCount ?? 0;
            const failed = operation.failedItemCount ?? 0;

            this.toast.show(
              'Bulk action applied',
              failed > 0
                ? `${succeeded} succeeded, ${failed} could not be actioned. See the list for why.`
                : `${succeeded} completed.`,
              failed > 0 ? 'warning' : 'success',
            );
          },
          error: (error: Error) => {
            this.submitting.set(false);
            this.validationError.set(error.message);
            this.toast.show('Submit Failed', error.message, 'error');
          },
        });
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.validationError.set(error.message);
        this.showConfirmModal.set(false);
        this.toast.show('Submit Failed', error.message, 'error');
      },
    });
  }

  closeModal(): void {
    this.showConfirmModal.set(false);
    this.showResultModal.set(false);
  }

  downloadResult(): void {
    const operation = this.operation();
    if (!operation) {
      this.closeModal();
      return;
    }
    // Built here rather than fetched: the operation already carries a row per person with its
    // own outcome, so a download endpoint would be a round trip to re-serialise what the screen
    // is holding. The BOM is for Excel, which otherwise reads UTF-8 as the system code page and
    // mangles every accented name.
    const rows = [
      'User,Outcome,Detail',
      ...(operation.items ?? []).map((item) => [
        readableIdentifier(item.sourceIdentifier, 'User not in this organisation'),
        item.succeeded ? 'Succeeded' : item.wasSkipped ? 'Skipped' : 'Failed',
        (item.resultMessage ?? item.validationMessage ?? '').replace(/"/g, '""'),
      ].map((field) => `"${field}"`).join(',')),
    ];

    const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = this.resultFileUrl();
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    // Released straight away: without this every download holds its bytes in memory until the
    // tab closes, which on a long administrative session adds up.
    URL.revokeObjectURL(url);

    this.toast.show('Downloaded', `Saved ${this.resultFileUrl()}.`, 'info');
    this.showResultModal.set(false);
  }

  cancel(): void {
    // If we already have a submitted operation, cancel it server-side first.
    const operation = this.operation();
    // Only an operation that has been checked but not applied can be cancelled. Once applied
    // the changes are made, and undoing them means a fresh operation in the other direction.
    if (operation && (operation.status === 'validated' || operation.status === 'queued')) {
      this.api.cancel(
        operation.id ?? '',
        operation.version ?? 0,
        'Cancelled before it was applied.')
        .subscribe({
          next: (outcome) => this.toast.show(
            'Cancelled', outcome.message ?? 'The operation was cancelled.', 'info'),
          error: (error: Error) => this.toast.show('Cancel Failed', error.message, 'error'),
        });
    }

    this.bulkForm.reset();
    this.totalCount.set(0);
    this.excludedCount.set(0);
    this.affectedCount.set(0);
    this.selectedAction.set('');
    this.roleId.set('');
    this.accessEnds.set('');
    this.dpOpen.set(false);
    this.selectedUsers.set([]);
    this.showAllSelected.set(false);
    this.impactPreview.set(null);
    this.operation.set(null);
    this.operationId.set('');
    this.approverRequired.set(false);
    this.approverReason.set('');
    this.toast.show('Cancelled', 'Bulk action has been cancelled.', 'info');
    this.router.navigate(['/app/administration/access/user-directory']);
  }

  // Many-users display helpers
  get visibleSelectedUsers(): UserListItem[] {
    const users = this.selectedUsers();
    if (users.length <= this.MAX_CHIPS || this.showAllSelected()) {
      return users;
    }
    return users.slice(0, this.MAX_CHIPS);
  }

  get hiddenSelectedCount(): number {
    const users = this.selectedUsers();
    return users.length > this.MAX_CHIPS ? users.length - this.MAX_CHIPS : 0;
  }

  toggleShowAllSelected(): void {
    this.showAllSelected.set(!this.showAllSelected());
  }

  // Account category counts from the actual selection
  get activeCategoryCount(): number {
    return this.selectedUsers().filter(u => u.status === 'active').length;
  }

  get invitedCategoryCount(): number {
    return this.selectedUsers().filter(u => u.status === 'invited').length;
  }

  get suspendedCategoryCount(): number {
    return this.selectedUsers().filter(u => u.status === 'suspended').length;
  }

  /**
   * Locked out is not a status of its own.
   *
   * It is a flag on an otherwise active account: the person's access is intact, they have simply
   * mistyped their password five times. Treating it as a status would hide them from the active
   * count and make a temporary state look like a permanent one.
   */
  get lockedCategoryCount(): number {
    return this.selectedUsers().filter(u => u.isLockedOut === true).length;
  }

  getActionLabel(value: string): string {
    const found = this.data()?.availableActions.find(a => a.value === value);
    return found?.label ?? 'Not selected';
  }

  // =========================================================================================
  // Presentation helpers
  // =========================================================================================

  /** Scrolls to a section of the page (there are no tabs any more). */
  goStep(index: number): void {
    this.roleDdOpen.set(false);
    this.dpOpen.set(false);
    const ids = BulkUserAdministrationComponent.SECTION_IDS;
    const id = ids[Math.max(0, Math.min(index, ids.length - 1))];
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Picks an action card. */
  pickAction(value: string): void {
    this.bulkForm.controls.action.setValue(value);
    this.onActionChange();
  }

  actionIcon(value: string): string {
    return BulkUserAdministrationComponent.ACTION_ICONS[value] ?? 'ri-checkbox-blank-circle-line';
  }

  toggleRoleDd(): void {
    this.roleQuery.set('');
    this.roleDdOpen.update((open) => !open);
  }

  pickRole(id: string): void {
    this.roleId.set(id);
    this.bulkForm.controls.roleId.setValue(id);
    this.roleDdOpen.set(false);
  }

  /** Any click outside the role dropdown closes it (clicks inside stop propagation). */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.roleDdOpen()) {
      this.roleDdOpen.set(false);
    }
    if (this.dpOpen()) {
      this.dpOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.roleDdOpen.set(false);
    this.dpOpen.set(false);
  }

  initial(name: string | null | undefined): string {
    return (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  }

  /** Characters typed in the justification, for the counter. */
  justificationLength(): number {
    return (this.bulkForm.controls.businessJustification.value ?? '').length;
  }

  goBack(): void {
    this.router.navigate(['/app/administration/access/user-directory']);
  }
}