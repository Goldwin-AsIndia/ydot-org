import {
  Component, DestroyRef, Directive, ElementRef, HostListener, OnDestroy, OnInit,
  computed, inject, signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import {
  Observable, Subject, catchError, combineLatest, debounceTime, forkJoin, of, shareReplay, startWith, switchMap, tap,
} from 'rxjs';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { codeError, textWithLettersError } from '../../../../Shared/validation/field-rules';
import { ComparedPermission, RoleCatalogueApiService } from '../../../../Service/role-catalogue-api.service';
import { PermissionMatrixResponse } from '../../../../Shared/models/iam-contract.model';
import {
  CreateRoleRequest,
  RoleCatalogueResponse,
  RoleDetail,
  RoleListItem,
  RolePermission,
  RoleSearchFilter,
} from '../../../../Shared/models/role-catalogue-api.model';

import { NavigationHistoryService } from '../../../../Shared/services/navigation-history.service';
/** One permission, as the detail panel lists it. */
interface RolePermissionView {
  code: string;
  name: string;
  isSensitive: boolean;
  /** The verb the permission carries, as the server names it - which matrix column it lights. */
  action: string;
  /** The module's readable name, as the server names it everywhere else. */
  moduleName: string;
}

/** One action on a module row: lit when the role grants it, struck when it denies it. */
interface ActionKeyView {
  key: string;
  label: string;
  state: 'granted' | 'denied' | 'none';
}

/** A yes/no filter with a third position for "do not filter". */
type FlagFilter = '' | 'true' | 'false';

/** One segregation-of-duties rule, as the detail panel lists it. */
interface RoleConflictView {
  /**
   * The rule's own id.
   *
   * CARRIED SO THE RULE CAN BE REMOVED. The panel used to render the conflicting role's name
   * and drop everything else, which is why the section could be read and not changed: there
   * was nothing to address a delete to.
   */
  id: string;
  conflictingRoleId: string;
  name: string;
  reason: string;
  isBlocking: boolean;
}

/**
 * The open role, as the detail panel shows it.
 *
 * Deeper than the row: the permission and conflict lists stay lists, because the panel renders
 * one item each rather than a sentence.
 */
interface RoleDetailView {
  id: string;
  name: string;
  code: string;
  purpose: string;
  /** The role type in the server's words (`roleTypeDisplay`). */
  roleType: string;
  owningFunction: string;
  /** The state's value, for the rules that depend on it. */
  status: string;
  /** The state in the server's words (`statusDisplay`). */
  approvalState: string;
  isPrivileged: boolean;
  isDefaultRole: boolean;
  isSystemRole: boolean;
  grantsAllPermissions: boolean;
  priority: number;
  assignedUserCount: number;
  permissionBundle: RolePermissionView[];
  excludedPermissions: RolePermissionView[];
  incompatibleRoles: RoleConflictView[];
  visibleMenuCount: number;
  createdAt: string;
  updatedAt: string;
  canActivate: boolean;
  canDeactivate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  version: number;
}

/**
 * One row of the table. Everything on it is a field of the server's row or its own label for
 * one: the row used to carry a dozen more that no column showed, several of them sentences
 * written here ("Whole organisation", "None") standing in for data the API does not hold.
 */
interface RoleItemView {
  id: string;
  roleName: string;
  roleCode: string;
  /** The role type in the server's words (`roleTypeDisplay`). */
  roleType: string;
  owningFunction: string;
  status: string;
  /** The state in the server's words (`statusDisplay`). */
  approvalState: string;
  assignedUserCount: number;
  permissionCount: number;
  /** True for the role that allows everything without a list, whose count is therefore 0. */
  grantsAllPermissions: boolean;
  effectiveDate: string;
  isSystemRole: boolean;
  isPrivileged: boolean;
  isDefaultRole: boolean;
}

/** The role a dialog is acting on: what it has to name, and the version it expects. */
interface RoleRef {
  id: string;
  name: string;
  code: string;
  version: number;
}

/** Where a floating dropdown menu sits on screen, in viewport pixels. */
interface DdMenuPosition {
  top: number | null;
  bottom: number | null;
  left: number;
  width: number;
}

/**
 * Moves its element to <body> while it lives.
 *
 * WHY. A `position: fixed` element is only fixed to the screen when no ancestor has a
 * transform, filter or backdrop-filter. The shared dialog styles give the popup one, so the
 * menu was being positioned against the dialog instead of the screen - pushed below it and
 * clipped out of sight, while the trigger still showed as open. Living on <body>, the menu has
 * no such ancestor and lands exactly under its trigger. Bindings and listeners keep working:
 * Angular still owns the element, it just sits somewhere else in the DOM.
 */
@Directive({ selector: '[rxPortal]', standalone: true })
export class RxPortalDirective implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);

  ngOnInit(): void {
    this.doc.body.appendChild(this.el.nativeElement);
  }

  ngOnDestroy(): void {
    this.el.nativeElement.remove();
  }
}

@Component({
  selector: 'app-role-catalogue',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, RxPortalDirective],
  templateUrl: './role-catalogue.html',
  styleUrl: './role-catalogue.css',
})
export class RoleCatalogueComponent {
  private readonly router = inject(Router);
  private readonly navHistory = inject(NavigationHistoryService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(RoleCatalogueApiService);
  private readonly tokens = inject(AuthTokenService);
  private readonly destroyRef = inject(DestroyRef);

  // =========================================================================================
  // What the signed-in person may do here.
  //
  // ONE FLAG PER ENDPOINT, named for the permission that endpoint asks for. Every button on this
  // screen used to be drawn for anybody who could open it, so somebody holding only
  // iam.roles.view was offered Create, Edit, Retire and Delete and found out from a 403. These
  // only decide what is DRAWN: the API checks the same codes again on every call.
  // =========================================================================================
  readonly canCreateRole = computed(() => this.tokens.hasPermission('iam.roles.create'));
  readonly canExportRoles = computed(() => this.tokens.hasPermission('iam.roles.export'));
  readonly canManageConflicts = computed(() => this.tokens.hasPermission('iam.roles.manage-incompatibility'));
  private readonly mayEditRoles = computed(() => this.tokens.hasPermission('iam.roles.edit'));
  private readonly mayDeleteRoles = computed(() => this.tokens.hasPermission('iam.roles.delete'));
  private readonly mayActivateRoles = computed(() => this.tokens.hasPermission('iam.roles.activate'));
  private readonly mayDeactivateRoles = computed(() => this.tokens.hasPermission('iam.roles.deactivate'));
  private readonly mayAssignPermissions = computed(() => this.tokens.hasPermission('iam.roles.assign-permissions'));

  /** The whole catalogue and its vocabularies: what the masthead counts and the filters offer. */
  data = signal<RoleCatalogueResponse | null>(null);
  loading = signal(true);
  loadFailed = signal(false);
  submitting = signal(false);
  errorMessage = signal('');

  // =========================================================================================
  // Filters.
  //
  // THE SERVER FILTERS. Each control below is one parameter of `GET /roles`; the table prints
  // what that request returns and Export sends the same parameters, so the file always holds
  // the rows on screen. The filtering used to be done here, over the whole catalogue, with
  // rules that had drifted from the API's: it searched two fields where the server searches
  // three, and there was no way to export what had been filtered.
  // =========================================================================================
  searchQuery = signal('');
  filterStatus = signal('');
  filterType = signal('');
  filterFunction = signal('');
  /** Privileged roles only, standard roles only, or either. */
  filterPrivilege = signal<FlagFilter>('');
  /** Built-in roles only, roles created here only, or either. */
  filterOrigin = signal<FlagFilter>('');

  /** What the controls hold, as the API's query parameters. An unset control sends nothing. */
  readonly activeFilter = computed<RoleSearchFilter>(() => ({
    search: this.searchQuery().trim() || undefined,
    status: this.filterStatus() || undefined,
    roleType: this.filterType() || undefined,
    displayTag: this.filterFunction() || undefined,
    isPrivileged: this.filterPrivilege() === '' ? undefined : this.filterPrivilege() === 'true',
    isSystemRole: this.filterOrigin() === '' ? undefined : this.filterOrigin() === 'true',
  }));

  /** True while the filter panel (not the tabs or the search box) is narrowing the list. */
  readonly panelFiltersActive = computed(() =>
    !!(this.filterType() || this.filterFunction() || this.filterPrivilege() || this.filterOrigin()));

  /** The roles the server returned for the filter; null while nothing is being filtered. */
  private readonly matchedRoles = signal<RoleListItem[] | null>(null);
  /** True while a filtered list is on its way. */
  readonly filtering = signal(false);
  /** Asks for the filtered list again after a role changes. */
  private readonly refreshRows$ = new Subject<void>();

  readonly filteredRoles = computed<RoleItemView[]>(() =>
    (this.matchedRoles() ?? this.data()?.roles ?? []).map((role) => this.toRoleItemView(role)));

  exporting = signal(false);

  /**
   * The owning functions to offer, taken from the roles the API returned.
   *
   * NOT A HARDCODED LIST, which is what this was. The filter offered four fixed names and the
   * create form offered six, so a role tagged "Inventory" or "Communications" could be created
   * and then never filtered for - and any function an organisation actually used, arriving
   * through the API or a future import, appeared in neither. There is no catalogue of functions
   * on the server to fetch: `displayTag` is free text on the role. So the honest source is the
   * data itself, which also means the list can never drift out of step with what exists.
   */
  owningFunctions = computed(() => [...new Set(
    (this.data()?.roles ?? [])
      .map((role) => (role.displayTag ?? '').trim())
      .filter((tag) => tag.length > 0))]
    .sort((left, right) => left.localeCompare(right)));

  /**
   * The role types to offer: the server's, narrowed to the types this catalogue holds.
   *
   * An Organisation's catalogue only ever holds Organisation roles - the API keeps platform and
   * template roles out of it - so offering those two would be offering filters that can never
   * match. The label is the server's, the same one each row prints.
   */
  readonly roleTypeChoices = computed(() => {
    const held = new Set<string>((this.data()?.roles ?? []).map((role) => role.roleType ?? ''));
    return (this.data()?.roleTypeOptions ?? []).filter((option) => held.has(option.value));
  });

  // ===== Stats used by the masthead + status tabs =====
  roleCounts = computed(() => ({
    total: (this.data()?.roles ?? []).length,
  }));

  /**
   * The state tabs and the masthead's status mix: one entry per state the SERVER names, in its
   * order, each with how many roles are in it.
   *
   * `status` is the value the filter sends, `label` is the server's word for it. The tabs used
   * to be built from whatever states the rows happened to be in, ordered by a list typed here,
   * while the masthead beside them printed three more labels of its own - so one screen called
   * the same state Active, In use and (for its opposite) both Inactive and Retired.
   */
  statusBreakdown = computed(() => {
    const roles = this.data()?.roles ?? [];
    const countOf = (status: string) => roles.filter((role) => role.status === status).length;

    const served = (this.data()?.statusOptions ?? []).map((option) => ({
      status: option.value,
      label: option.label,
      count: countOf(option.value),
    }));

    // A state the option list does not name still gets its tab, worded as its rows word it.
    const known = new Set(served.map((entry) => entry.status));
    const unnamed = [...new Map(roles
      .filter((role) => !!role.status && !known.has(role.status))
      .map((role): [string, string] => [role.status!, role.statusDisplay ?? role.status!])).entries()]
      .map(([status, label]) => ({ status, label, count: countOf(status) }));

    return [...served, ...unnamed];
  });

  /** The server's word for a state, or the value itself until the vocabulary has loaded. */
  statusLabel(status: string): string {
    return (this.data()?.statusOptions ?? []).find((option) => option.value === status)?.label ?? status;
  }

  /** Which of the screen's four status colours a state is drawn in. Colour only - never wording. */
  statusBucket(status: string): 'active' | 'draft' | 'retired' | 'default' {
    const s = (status ?? '').toLowerCase();
    if (s === 'active') return 'active';
    if (s === 'draft') return 'draft';
    if (s === 'inactive') return 'retired';
    return 'default';
  }

  /**
   * Monogram colours. One restrained neutral for every role: the screen reads as a register, and
   * a rainbow of per-role tints competed with the status marks that actually carry meaning.
   */
  avatarStyle(_name: string): { background: string; color: string } {
    return { background: '#f1f3f2', color: '#3d4744' };
  }

  // ===== Create Role Modal =====
  showCreateModal = signal(false);
  /** Set once Create has been pressed, so the form does not shout before anyone has tried. */
  readonly roleSubmitted = signal(false);

  /** What is wrong with each field of the create-role form right now (null = fine). */
  private roleRuleErrors(): Record<string, string | null> {
    const f = this.createRoleForm();
    const name = f.name.trim();
    const code = f.code.trim();
    return {
      name: textWithLettersError('Role name', name, { min: 2, max: 120 }),
      code: codeError('Role code', code, { max: 50 }),
      description: textWithLettersError('Purpose', f.description, { min: 10, max: 500 }),
      isPrivileged: f.isPrivileged === null ? 'Choose a privilege level.' : null,
      isDefaultRole: f.isDefaultRole === null ? 'Choose whether new people get this role by default.' : null,
      // The server takes 0 to 999. The stepper used to stop at 9999 and the box takes anything
      // typed, so a value the API would refuse reached it and came back as a bare error.
      priority: Number.isInteger(f.priority) && f.priority >= 0 && f.priority <= RoleCatalogueComponent.MAX_PRIORITY
        ? null
        : `Priority must be a whole number from 0 to ${RoleCatalogueComponent.MAX_PRIORITY}.`,
      // The server keeps 40 characters. The box took 80, so a longer name was typed in full and
      // refused on save.
      displayTag: f.displayTag.trim().length > RoleCatalogueComponent.MAX_OWNING_FUNCTION
        ? `Owning function can be at most ${RoleCatalogueComponent.MAX_OWNING_FUNCTION} characters.`
        : null,
      // Asked only when roles were picked: the reason is what a person refused the combination
      // is shown, so it has to be the administrator's and not a sentence of this screen's.
      incompatReason: this.selectedIncompatibleRoleIds().length > 0 && !this.incompatReason().trim()
        ? 'Say why these roles cannot be held together.'
        : null,
    };
  }

  private static readonly MAX_PRIORITY = 999;
  static readonly MAX_OWNING_FUNCTION = 40;
  readonly maxOwningFunction = RoleCatalogueComponent.MAX_OWNING_FUNCTION;

  /** The message under a create-role field, or null while it is fine (or untouched). */
  roleErr(field: string): string | null {
    return this.roleSubmitted() || this.roleTouched().has(field) ? (this.roleRuleErrors()[field] ?? null) : null;
  }

  /** Fields left at least once; their messages show before Create is pressed. */
  readonly roleTouched = signal<ReadonlySet<string>>(new Set());

  touchRole(field: string): void {
    if (!this.roleTouched().has(field)) {
      this.roleTouched.update((current) => new Set(current).add(field));
    }
  }

  private static readonly ROLE_IDS: Record<string, string> = {
    name: 'roleNameInput', code: 'roleCodeInput', description: 'rolePurposeInput',
    displayTag: 'owningFunctionInput', incompatReason: 'incompatReasonInput',
  };

  createRoleForm = signal({
    name: '',
    code: '',
    description: '',
    displayTag: '',
    priority: 100,
    isPrivileged: null as boolean | null,
    isDefaultRole: null as boolean | null,
  });

  /** The permissions ticked, BY CODE rather than by id. */
  selectedPermissionCodes = signal<string[]>([]);

  /** Codes ticked as explicit denials. Deny beats allow wherever the two overlap. */
  selectedDeniedCodes = signal<string[]>([]);

  /** The permission matrix, loaded when the editor opens. */
  readonly permissionMatrix = signal<PermissionMatrixResponse | null>(null);
  selectedIncompatibleRoleIds = signal<string[]>([]);
  /** Why the roles picked above cannot be held with the new one. Recorded on each rule. */
  readonly incompatReason = signal('');

  // ===== Role Detail =====
  detailRole = signal<RoleDetail | null>(null);

  /** The open role, shaped for the detail panel. */
  readonly detailView = computed<RoleDetailView | null>(() => {
    const detail = this.detailRole();

    if (!detail) {
      return null;
    }

    const permissions = detail.permissions ?? [];

    const toPermissionView = (permission: RolePermission): RolePermissionView => ({
      code: permission.permissionCode ?? '',
      name: permission.permissionName ?? permission.permissionCode ?? '',
      isSensitive: permission.isSensitive === true,
      action: (permission.action ?? (permission.permissionCode ?? '').split('.').pop() ?? '').toLowerCase(),
      moduleName: permission.moduleName ?? '',
    });

    const status = detail.status ?? '';

    // WHAT THE RECORD'S STATE ALLOWS IS THE SERVER'S ANSWER (`permittedActions`), and nothing
    // else. Each button is that answer AND the permission its endpoint asks for. Three of them
    // used to carry a rule of this screen's as well - "not for a built-in role", "only a draft
    // can be deleted" - which the API did not have, so the two disagreed: the screen hid Edit on
    // roles the server would save, and offered Delete on roles the server could not delete.
    // The rules for built-in roles are the server's now, and it sends them here like the rest.
    const allows = (action: string) => (detail.permittedActions ?? []).includes(action);

    return {
      id: detail.id ?? '',
      name: detail.name ?? '',
      code: detail.code ?? '',
      purpose: detail.description ?? '',
      roleType: detail.roleTypeDisplay ?? '',
      owningFunction: detail.displayTag ?? '',
      status,
      approvalState: detail.statusDisplay ?? status,
      isPrivileged: detail.isPrivileged === true,
      isDefaultRole: detail.isDefaultRole === true,
      isSystemRole: detail.isSystemRole === true,
      grantsAllPermissions: detail.grantsAllTenantPermissions === true,
      priority: detail.priority ?? 0,
      assignedUserCount: detail.memberCount ?? 0,

      permissionBundle: permissions
        .filter((permission) => permission.isDenied !== true)
        .map(toPermissionView),

      excludedPermissions: permissions
        .filter((permission) => permission.isDenied === true)
        .map(toPermissionView),

      // THE OTHER ROLE OF THE PAIR, whichever way round the rule was recorded. A rule is stored
      // once and the API returns it for both roles, so on the role named second the
      // "conflicting" one is this role itself - which is what this list used to print there.
      incompatibleRoles: (detail.incompatibilities ?? []).map((conflict) => {
        const namedSecond = conflict.conflictingRoleId === detail.id;

        return {
          id: conflict.id ?? '',
          conflictingRoleId: (namedSecond ? conflict.roleId : conflict.conflictingRoleId) ?? '',
          name: (namedSecond ? conflict.roleName : conflict.conflictingRoleName) ?? '',
          reason: conflict.reason ?? '',
          isBlocking: conflict.isBlocking === true,
        };
      }),

      visibleMenuCount: (detail.visibleMenuIds ?? []).length,
      createdAt: detail.createdAtUtc ? this.formatDate(detail.createdAtUtc) : '—',
      updatedAt: detail.updatedAtUtc ? this.formatDate(detail.updatedAtUtc) : '—',

      canActivate: allows('Activate') && this.mayActivateRoles(),
      canDeactivate: allows('Deactivate') && this.mayDeactivateRoles(),
      canEdit: allows('Edit') && this.mayEditRoles(),
      canDelete: allows('Delete') && this.mayDeleteRoles(),
      version: detail.version ?? 0,
    };
  });

  /** Up to two initials for the live preview in the create panel. */
  initials(name: string): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '+';
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  // =========================================================================================
  // Custom dropdowns — replace every native <select> / <datalist> on this screen.
  // One key is open at a time; clicks inside a dropdown stop propagation, anything else closes.
  //
  // FLOATING MENUS. A menu inside a dialog is placed with `position: fixed` at the trigger's
  // screen position, so the dialog's scrolling body can neither clip it nor grow because of it.
  // Pass the click event to `toggleDd` and give the menu the `rx-dd__menu--float` class.
  // =========================================================================================
  readonly openDd = signal<string | null>(null);
  /** Search text inside the open dropdown. */
  readonly ddQuery = signal('');
  /** Screen position of the open floating menu; null when it is not a floating one. */
  readonly ddMenuPos = signal<DdMenuPosition | null>(null);

  toggleDd(key: string, ev?: Event): void {
    if (this.openDd() === key) {
      this.closeDd();
      return;
    }

    this.ddQuery.set('');
    this.ddMenuPos.set(null);
    this.openDd.set(key);

    const trigger = ev?.currentTarget as HTMLElement | null;
    if (trigger) {
      this.placeDdMenu(trigger);
    }
  }

  closeDd(): void {
    this.openDd.set(null);
    this.ddQuery.set('');
    this.ddMenuPos.set(null);
  }

  /** Puts the menu below the trigger, or above it when there is not enough room below. */
  private placeDdMenu(trigger: HTMLElement): void {
    const r = trigger.getBoundingClientRect();
    const gap = 6;
    const edge = 12;
    const menuHeight = 320; // search box + list max height + padding
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < menuHeight && r.top > spaceBelow;

    const width = Math.min(r.width, window.innerWidth - edge * 2);
    const left = Math.max(edge, Math.min(r.left, window.innerWidth - width - edge));

    this.ddMenuPos.set({
      top: openUp ? null : r.bottom + gap,
      bottom: openUp ? window.innerHeight - r.top + gap : null,
      left,
      width,
    });
  }

  /** Does a label match the dropdown search? */
  ddMatch(text: string | null | undefined): boolean {
    const q = this.ddQuery().trim().toLowerCase();
    return !q || (text ?? '').toLowerCase().includes(q);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openDd()) this.closeDd();
  }

  /** A fixed menu would drift away from its trigger on resize, so close it. */
  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.ddMenuPos()) this.closeDd();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.openDd()) { this.closeDd(); return; }
    if (this.showCompareModal()) { this.closeCompareModal(); return; }
    if (this.showDeleteRoleModal()) { this.closeDeleteRoleModal(); return; }
    if (this.statusChange()) { this.closeStatusChange(); return; }
    if (this.showCreateModal()) { this.closeCreateModal(); }
  }

  readonly conflictRoleLabel = computed(() => {
    const id = this.conflictForm().conflictingRoleId;
    return id ? (this.conflictCandidates().find((c) => c.id === id)?.name ?? '') : '';
  });

  /** Roles the compare dialog can pick: everything except the base role. */
  readonly compareCandidates = computed(() => {
    const baseId = this.actionRole()?.id;
    return (this.data()?.roles ?? [])
      .filter((r) => r.id !== baseId)
      .map((r) => ({ id: r.id ?? '', name: r.name ?? '', code: r.code ?? '' }));
  });

  readonly compareRoleLabel = computed(() =>
    this.compareCandidates().find((c) => c.id === this.compareRoleId())?.name ?? '');

  // ---- Create panel: permission picker ----------------------------------------------------
  /** Which list the permission picker writes to: granted, or explicitly denied. */
  readonly permMode = signal<'grant' | 'deny'>('grant');
  readonly permQuery = signal('');

  readonly filteredPermissionChoices = computed(() => {
    const q = this.permQuery().trim().toLowerCase();
    const all = this.permissionChoices();
    return q
      ? all.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      : all;
  });

  readonly incompatQuery = signal('');

  readonly filteredIncompatRoles = computed(() => {
    const q = this.incompatQuery().trim().toLowerCase();
    return (this.data()?.roles ?? []).filter((r) =>
      !q || (r.name ?? '').toLowerCase().includes(q) || (r.code ?? '').toLowerCase().includes(q));
  });

  /** Owning-function suggestions matching what has been typed. */
  readonly owningSuggestions = computed(() => {
    const q = (this.createRoleForm().displayTag ?? '').trim().toLowerCase();
    return this.owningFunctions().filter((fn) => !q || fn.toLowerCase().includes(q));
  });

  permissionName(code: string): string {
    return this.permissionChoices().find((p) => p.code === code)?.name ?? code;
  }

  roleNameById(id: string): string {
    return (this.data()?.roles ?? []).find((r) => r.id === id)?.name ?? id;
  }

  togglePermPick(code: string): void {
    if (this.permMode() === 'grant') this.togglePermission(code);
    else this.toggleDeniedPermission(code);
  }

  isPermPicked(code: string): boolean {
    return this.permMode() === 'grant' ? this.isPermissionSelected(code) : this.isPermissionDenied(code);
  }

  setOwningFunction(value: string): void {
    this.createRoleForm.set({ ...this.createRoleForm(), displayTag: value });
  }

  stepPriority(delta: number): void {
    const next = Math.min(RoleCatalogueComponent.MAX_PRIORITY, Math.max(0, (this.createRoleForm().priority ?? 0) + delta));
    this.createRoleForm.set({ ...this.createRoleForm(), priority: next });
  }

  // ---- Detail pane: permissions grouped by module -----------------------------------------
  //
  // THE MODULE NAMES COME FROM THE SERVER (`moduleName` on each permission), the same names the
  // permission matrix uses. This used to be a list of eight typed here - four of them modules the
  // platform does not have, and none for Global Masters or Platform, which showed up as "GM" and
  // "PLATFORM".

  /**
   * The matrix's columns: the verbs a permission can carry, in the server's order and words
   * (`permissionActions` from `/reference-data/enums`).
   *
   * The seven were typed here, so an eighth added on the server would have had permissions and
   * no column to show them in.
   */
  private readonly actionColumns = computed(() =>
    (this.data()?.permissionActions ?? []).map((option) => ({
      key: option.value.toLowerCase(),
      label: option.label,
    })));

  readonly permFilter = signal('');

  /** Modules whose permission names are unfolded under the matrix row. Folded by default; a search unfolds all. */
  readonly openGroups = signal<string[]>([]);

  readonly detailPermGroups = computed(() => {
    const d = this.detailView();
    if (!d) return [];
    const q = this.permFilter().trim().toLowerCase();
    const rows = [
      ...d.permissionBundle.map((p) => ({ ...p, denied: false })),
      ...d.excludedPermissions.map((p) => ({ ...p, denied: true })),
    ].filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = (row.code.split('.')[0] || 'other').toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const columns = this.actionColumns();

    return [...groups.entries()]
      .map(([key, items]) => {
        const denied = items.filter((i) => i.denied).length;
        const actions: ActionKeyView[] = columns.map((a) => {
          const hits = items.filter((i) => i.action === a.key);
          const state: ActionKeyView['state'] = hits.some((i) => !i.denied)
            ? 'granted'
            : hits.length ? 'denied' : 'none';
          return { ...a, state };
        });
        return {
          key,
          label: items.find((item) => item.moduleName)?.moduleName || key.toUpperCase(),
          items,
          granted: items.length - denied,
          denied,
          sensitive: items.filter((i) => i.isSensitive).length,
          actions,
          litActions: actions.filter((a) => a.state === 'granted').length,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly permStats = computed(() => {
    const d = this.detailView();
    return {
      granted: d?.permissionBundle.length ?? 0,
      denied: d?.excludedPermissions.length ?? 0,
      sensitive: (d?.permissionBundle ?? []).filter((p) => p.isSensitive).length,
    };
  });

  isGroupOpen(key: string): boolean {
    return !!this.permFilter().trim() || this.openGroups().includes(key);
  }

  toggleGroup(key: string): void {
    const o = this.openGroups();
    this.openGroups.set(o.includes(key) ? o.filter((k) => k !== key) : [...o, key]);
  }

  /** Unfold every module, or fold them all back when they are all open. */
  toggleAllGroups(): void {
    this.openGroups.set(this.allGroupsOpen() ? [] : this.detailPermGroups().map((g) => g.key));
  }

  readonly allGroupsOpen = computed(() => {
    const groups = this.detailPermGroups();
    return groups.length > 0 && groups.every((g) => this.openGroups().includes(g.key));
  });

  // ---- Catalogue masthead figures -----------------------------------------------------------
  //
  // Counted over the whole catalogue as the API returned it. The share of roles in each state
  // is `statusBreakdown`, which is worded and ordered by the server.
  readonly catalogueFigures = computed(() => {
    const roles = this.data()?.roles ?? [];
    return {
      total: roles.length,
      privileged: roles.filter((r) => r.isPrivileged).length,
      system: roles.filter((r) => r.isSystemRole).length,
      holders: roles.reduce((sum, r) => sum + (r.memberCount ?? 0), 0),
      staffed: roles.filter((r) => (r.memberCount ?? 0) > 0).length,
      permissions: roles.reduce((sum, r) => sum + (r.permissionCount ?? 0), 0),
    };
  });

  /** The role that is the Organisation's default now, for the create panel's note. */
  readonly currentDefaultRole = computed(() => {
    const role = (this.data()?.roles ?? []).find((r) => r.isDefaultRole === true && r.status === 'active');
    return role ? { id: role.id ?? '', name: role.name ?? role.code ?? '' } : null;
  });

  // ===== Compare & Delete Modal =====
  showCompareModal = signal(false);
  showDeleteRoleModal = signal(false);
  actionRole = signal<RoleRef | null>(null);
  deleteReason = signal('');
  deleteError = signal('');
  compareRoleId = signal('');
  comparing = signal(false);
  compareResult = signal<{
    onlyInLeft: ComparedPermission[];
    onlyInRight: ComparedPermission[];
    inBoth: ComparedPermission[];
  } | null>(null);

  constructor() {
    this.loadData();

    // The filtered list. Asked for again whenever a control changes (after a pause, so typing
    // in the search box is one request and not one per letter) and whenever a role changes.
    // `switchMap` drops the answer to a question that has since been replaced.
    combineLatest([
      toObservable(this.activeFilter).pipe(debounceTime(RoleCatalogueComponent.FILTER_PAUSE_MS)),
      this.refreshRows$.pipe(startWith(undefined)),
    ]).pipe(
      switchMap(([filter]) => this.fetchMatchedRoles(filter)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((roles) => {
      this.matchedRoles.set(roles);
      this.filtering.set(false);
    });

    // A floating menu is fixed to the screen, so any scroll other than its own list
    // (the page, the dialog body, the drawer body) would leave it behind. Close it instead.
    // Capture mode, because scroll events do not bubble out of inner scroll boxes.
    const onScroll = (event: Event) => {
      if (!this.ddMenuPos()) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.rx-dd__menu--float')) return;
      this.closeDd();
    };
    window.addEventListener('scroll', onScroll, true);
    this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll, true));
  }

  private loadData(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    // The whole catalogue, with the vocabularies: what the masthead counts, what the tabs and
    // the filter panel offer, and the roles every picker on the screen chooses from.
    this.api.getCatalogue().subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.loadFailed.set(true);
        this.errorMessage.set(error.message);
        this.toast.show('Could not load the roles', error.message, 'error');
      },
    });
  }

  /**
   * Re-reads the catalogue and the filtered list after a role changes - quietly, so the counts
   * and the rows update without the page flashing its loader or closing the open role.
   */
  private reloadCatalogue(): void {
    this.api.getCatalogue().subscribe({
      next: (res) => this.data.set(res),
      error: (error: Error) => this.toast.show('Could not refresh the roles', error.message, 'error'),
    });
    this.refreshRows$.next();
  }

  retry(): void { this.loadData(); }

  /** How long the controls must be still before the filtered list is asked for. */
  private static readonly FILTER_PAUSE_MS = 250;

  /**
   * The roles for a filter, from the server. With no control set the catalogue already holds
   * the answer, so nothing is asked and `null` says "show the catalogue".
   */
  private fetchMatchedRoles(filter: RoleSearchFilter): Observable<RoleListItem[] | null> {
    if (Object.values(filter).every((value) => value === undefined)) {
      return of(null);
    }

    this.filtering.set(true);

    return this.api.searchAll(filter).pipe(
      catchError((error: Error) => {
        this.toast.show('Could not filter the roles', error.message, 'error');
        return of<RoleListItem[]>([]);
      }));
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.filterStatus.set('');
    this.filterType.set('');
    this.filterFunction.set('');
    this.filterPrivilege.set('');
    this.filterOrigin.set('');
  }

  // ===== EXPORT =====

  /**
   * Downloads the roles on screen as CSV.
   *
   * THE SERVER BUILDS THE FILE from the same filter the table sent, names it, and records the
   * export in the audit trail under the reference shown in the confirmation.
   */
  exportRoles(): void {
    this.exporting.set(true);

    this.api.export(this.activeFilter()).subscribe({
      next: (file) => {
        this.exporting.set(false);

        const url = URL.createObjectURL(file.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.toast.show(
          'Export ready',
          file.reference ? `${file.fileName} was downloaded. Reference ${file.reference}.` : `${file.fileName} was downloaded.`,
          'success');
      },
      error: (error: Error) => {
        this.exporting.set(false);
        this.toast.show('Export failed', error.message, 'error');
      },
    });
  }

  private toRoleItemView(r: RoleListItem): RoleItemView {
    return {
      id: r.id ?? '',
      roleName: r.name ?? '',
      roleCode: r.code ?? '',
      roleType: r.roleTypeDisplay ?? '',
      owningFunction: r.displayTag ?? '',
      status: r.status ?? '',
      approvalState: r.statusDisplay ?? r.status ?? '',
      assignedUserCount: r.memberCount ?? 0,
      permissionCount: r.permissionCount ?? 0,
      grantsAllPermissions: r.grantsAllTenantPermissions === true,
      effectiveDate: r.updatedAtUtc ? this.formatDate(r.updatedAtUtc) : '—',
      isSystemRole: r.isSystemRole === true,
      isPrivileged: r.isPrivileged === true,
      isDefaultRole: r.isDefaultRole === true,
    };
  }

  private formatDate(value: string): string {
    try {
      return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return value;
    }
  }

  // ===== CREATE ROLE =====
  openCreateModal(): void {
    this.editingRoleId.set('');
    this.roleSubmitted.set(false);
    this.roleTouched.set(new Set());
    this.createRoleForm.set({
      name: '',
      code: '',
      description: '',
      displayTag: '',
      priority: 100,
      isPrivileged: null,
      isDefaultRole: null,
    });
    this.selectedPermissionCodes.set([]);
    this.selectedDeniedCodes.set([]);
    this.selectedIncompatibleRoleIds.set([]);
    this.incompatReason.set('');
    this.permMode.set('grant');
    this.permQuery.set('');
    this.incompatQuery.set('');
    this.closeDd();
    this.errorMessage.set('');
    this.editingSystemRole.set(false);
    this.showCreateModal.set(true);

    // The matrix is fetched when the editor opens rather than with the catalogue.
    this.loadPermissionMatrix().subscribe();
  }

  /**
   * The permission matrix - every permission an Organisation role can carry, by module - read
   * from the API once and kept for as long as the screen is open.
   */
  private loadPermissionMatrix(): Observable<PermissionMatrixResponse | null> {
    const loaded = this.permissionMatrix();
    if (loaded) {
      return of(loaded);
    }

    // One request however many callers ask while it is on its way.
    this.matrixRequest$ ??= this.api.getPermissionMatrix().pipe(
      tap((matrix) => this.permissionMatrix.set(matrix)),
      catchError((error: Error) => {
        this.matrixRequest$ = undefined;
        this.toast.show('Permissions unavailable', error.message, 'error');
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: false }));

    return this.matrixRequest$;
  }

  private matrixRequest$?: Observable<PermissionMatrixResponse | null>;

  closeCreateModal(): void {
    this.closeDd();
    this.showCreateModal.set(false);
    this.editingRoleId.set('');
    this.editingSystemRole.set(false);
  }

  /** The role the drawer is editing; empty while it is creating a new one. */
  readonly editingRoleId = signal('');
  /** True while the drawer is editing a built-in role, whose name the server keeps as it is. */
  readonly editingSystemRole = signal(false);
  /** The state of the role being edited, in the server's word, for the drawer's heading. */
  readonly editingStatusLabel = signal('');
  private editingVersion = 0;

  /** Opens the drawer on an existing role's name, purpose, classification and priority. */
  openEditRole(role: RoleDetailView): void {
    this.openCreateModal();
    this.editingRoleId.set(role.id);
    this.editingSystemRole.set(role.isSystemRole);
    this.editingStatusLabel.set(role.approvalState);
    this.editingVersion = role.version;
    this.createRoleForm.set({
      name: role.name,
      code: role.code,
      description: role.purpose,
      displayTag: role.owningFunction,
      priority: role.priority,
      isPrivileged: role.isPrivileged,
      isDefaultRole: role.isDefaultRole,
    });
  }

  /**
   * Opens the drawer as a new draft that starts as a copy of this role: its purpose, owning
   * function, priority and privilege level, what it allows and blocks, and the roles it cannot
   * be combined with. The name and code are suggestions to change, and the copy is never the
   * default role - one Organisation has one default.
   */
  cloneRole(role: RoleDetailView): void {
    this.openCreateModal();
    this.createRoleForm.set({
      name: `Copy of ${role.name}`,
      code: `${role.code}-COPY`,
      description: role.purpose,
      displayTag: role.owningFunction,
      priority: role.priority,
      isPrivileged: role.isPrivileged,
      isDefaultRole: false,
    });
    this.selectedPermissionCodes.set(role.permissionBundle.map((p) => p.code));
    this.selectedDeniedCodes.set(role.excludedPermissions.map((p) => p.code));
    this.selectedIncompatibleRoleIds.set(
      role.incompatibleRoles.map((c) => c.conflictingRoleId).filter((id) => !!id));

    // One reason is recorded for the copy's rules. When the original's rules all give the same
    // one it is carried over; otherwise it is left for the administrator to write.
    const reasons = [...new Set(role.incompatibleRoles.map((c) => c.reason.trim()).filter(Boolean))];
    this.incompatReason.set(reasons.length === 1 ? reasons[0] : '');

    // A ROLE THAT GRANTS EVERYTHING HAS NO LIST TO COPY - the grant is a flag on the role, which
    // only the built-in administrator role carries and no created role can. Its copy used to
    // come out holding nothing at all. It now starts with every permission the API offers,
    // listed one by one, which is the nearest thing a created role can be.
    if (role.grantsAllPermissions) {
      this.loadPermissionMatrix().subscribe(() => {
        this.selectedPermissionCodes.set(this.permissionChoices().map((p) => p.code));
        this.toast.show(
          'Every permission selected',
          `${role.name} grants everything without a list, so the copy starts with all ${this.permissionChoices().length} permissions another role can hold (Master Data stays with the Organisation Admin). Remove what it should not have.`,
          'info');
      });
    }
  }

  private saveRoleEdits(id: string): void {
    const form = this.createRoleForm();
    this.submitting.set(true);

    this.api.updateRole(id, {
      expectedVersion: this.editingVersion,
      name: form.name.trim(),
      description: form.description.trim(),
      displayTag: form.displayTag.trim(),
      priority: form.priority,
      isPrivileged: form.isPrivileged ?? false,
      isDefaultRole: form.isDefaultRole ?? false,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeCreateModal();
        this.toast.show('Role updated', `${form.name.trim()} has been saved.`, 'success');
        this.refreshIfOpen(id);
        this.reloadCatalogue();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.toast.show('Could not save the role', error.message, 'error');
      },
    });
  }

  createDraftRole(): void {
    this.openCreateModal();
  }

  togglePermission(code: string): void {
    const current = this.selectedPermissionCodes();
    this.selectedPermissionCodes.set(
      current.includes(code) ? current.filter(x => x !== code) : [...current, code]
    );

    // Granting a permission clears any denial of the same code.
    if (this.selectedPermissionCodes().includes(code)) {
      this.selectedDeniedCodes.set(this.selectedDeniedCodes().filter(x => x !== code));
    }
  }

  toggleDeniedPermission(code: string): void {
    const current = this.selectedDeniedCodes();
    this.selectedDeniedCodes.set(
      current.includes(code) ? current.filter(x => x !== code) : [...current, code]
    );

    if (this.selectedDeniedCodes().includes(code)) {
      this.selectedPermissionCodes.set(
        this.selectedPermissionCodes().filter(x => x !== code));
    }
  }

  isPermissionDenied(code: string): boolean {
    return this.selectedDeniedCodes().includes(code);
  }

  toggleIncompatibleRole(id: string): void {
    const current = this.selectedIncompatibleRoleIds();
    this.selectedIncompatibleRoleIds.set(
      current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    );
  }

  isPermissionSelected(code: string): boolean {
    return this.selectedPermissionCodes().includes(code);
  }

  isIncompatibleRoleSelected(id: string): boolean {
    return this.selectedIncompatibleRoleIds().includes(id);
  }

  /**
   * Every permission in the matrix a created role may hold, flattened. The Masters codes are left
   * out: they belong to the Organisation Admin alone and the server refuses them for any other role.
   */
  readonly permissionChoices = computed(() => {
    const choices: { code: string; name: string; description: string; isSensitive: boolean }[] = [];

    for (const module of this.permissionMatrix()?.modules ?? []) {
      for (const group of module.groups ?? []) {
        for (const permission of group.permissions ?? []) {
          if (permission.isOrganisationAdminOnly === true) continue;
          choices.push({
            code: permission.code ?? '',
            name: permission.name ?? permission.code ?? '',
            description: permission.description
              ?? `${module.moduleName ?? ''} · ${group.groupName ?? ''}`,
            isSensitive: permission.isSensitive === true,
          });
        }
      }
    }

    return choices;
  });

  confirmCreateRole(): void {
    const form = this.createRoleForm();

    this.roleSubmitted.set(true);
    const labels: Record<string, string> = {
      name: 'Role name', code: 'Role code', description: 'Purpose', isPrivileged: 'Privilege level', isDefaultRole: 'Given to everybody',
      priority: 'Priority', displayTag: 'Owning function', incompatReason: 'Why the roles cannot be combined',
    };
    const failing = Object.entries(this.roleRuleErrors()).filter(([, message]) => message !== null);
    if (failing.length > 0) {
      this.toast.show('Check the highlighted fields', `Please correct: ${failing.map(([field]) => labels[field]).join(', ')}.`, 'warning');
      const firstId = RoleCatalogueComponent.ROLE_IDS[failing[0][0]];
      if (firstId) setTimeout(() => (document.getElementById(firstId) as HTMLElement | null)?.focus());
      return;
    }

    const editingId = this.editingRoleId();
    if (editingId) {
      this.saveRoleEdits(editingId);
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    const request: CreateRoleRequest = {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      displayTag: form.displayTag.trim() || null,
      status: 'draft',
      priority: form.priority,
      isPrivileged: form.isPrivileged ?? false,
      isDefaultRole: form.isDefaultRole ?? false,
      permissionCodes: this.selectedPermissionCodes(),
      // THE DENY HALF OF THE PICKER. It was collected, counted in the dropdown's footer, shown as
      // red chips - and never sent, so a role created with three permissions blocked was created
      // with none blocked, and a clone of a role came out more permissive than the original.
      deniedPermissionCodes: this.selectedDeniedCodes(),
      visibleMenuIds: [],
    };

    this.api.createRole(request).subscribe({
      next: (role) => this.recordConflicts(role),
      error: (error: Error) => {
        this.submitting.set(false);
        this.errorMessage.set(error.message);
        this.toast.show('Could not create the role', error.message, 'error');
      },
    });
  }

  /**
   * Records the roles the new one must not be held alongside, then shows the new role.
   *
   * THE REASON IS THE ONE TYPED IN THE PANEL. Each rule used to be saved with a sentence of this
   * screen's - "Recorded when the role was created." - and the reason is what a person refused
   * the combination is shown, so it told them nothing about why.
   */
  private recordConflicts(created: RoleDetail): void {
    const roleId = created.id ?? '';
    const roleName = created.name ?? this.createRoleForm().name;
    const conflictIds = this.selectedIncompatibleRoleIds();
    const reason = this.incompatReason().trim();

    const finish = (conflictError?: string) => {
      this.submitting.set(false);
      this.showCreateModal.set(false);

      // The new draft is shown open, so no filter may be hiding its row.
      this.clearFilters();
      this.permFilter.set('');
      this.openGroups.set([]);
      this.detailTab.set('perms');
      this.detailRole.set(created);

      if (conflictError) {
        this.toast.show(
          'Role created, rules not recorded',
          `${roleName} was created. The segregation-of-duties rules could not be saved: ${conflictError}`,
          'warning');
      } else {
        this.toast.show('Role created', `${roleName} has been created as a draft.`, 'success');
      }

      // Read again: the rules were added after the role was returned.
      if (conflictIds.length > 0 && roleId) {
        this.refreshOpenRole(roleId);
      }

      this.reloadCatalogue();
    };

    if (!roleId || conflictIds.length === 0) {
      finish();
      return;
    }

    forkJoin(
      conflictIds.map((conflictingRoleId) =>
        this.api.addIncompatibility({ roleId, conflictingRoleId, reason, isBlocking: true })),
    ).subscribe({
      next: () => finish(),
      error: (error: Error) => finish(error.message),
    });
  }

  // ===== ROLE DETAIL =====

  /**
   * Opens a role beneath its row, read from the API each time.
   *
   * NOT KEPT FROM THE LAST TIME IT WAS OPEN. What the buttons offer is the server's answer for
   * the role as it is now - who holds it, what state it is in - and a copy from earlier in the
   * visit could offer a delete the server has since stopped allowing.
   */
  openDetail(role: RoleItemView): void {
    this.permFilter.set('');
    this.openGroups.set([]);

    this.api.getRole(role.id).subscribe({
      next: (detail) => this.detailRole.set(detail),
      error: (error: Error) => this.toast.show('Could not open the role', error.message, 'error'),
    });
  }

  /** Which tab of the open role's details is showing. */
  readonly detailTab = signal<'perms' | 'sod' | 'info'>('perms');

  /** A row click opens that role beneath its row, or closes it when it is already open. */
  toggleRow(role: RoleItemView): void {
    if (this.detailRole()?.id === role.id) {
      this.closeDetail();
      return;
    }
    this.detailTab.set('perms');
    this.resetConflictForm();
    this.openDetail(role);
  }

  closeDetail(): void {
    this.detailRole.set(null);
    this.resetConflictForm();
    this.cancelPermEdit();
  }

  // ===== PICKING PERMISSIONS ON AN EXISTING ROLE =====

  /** True while the Permissions tab shows checkboxes instead of the read-only matrix. */
  readonly permEditing = signal(false);
  readonly permSaving = signal(false);
  /** The permission codes ticked in the editor - the draft, not yet saved. */
  readonly permDraft = signal<string[]>([]);
  /** The codes this role BLOCKS - the other half of the draft. Deny beats allow. */
  readonly permDenyDraft = signal<string[]>([]);
  /** Which list the checkboxes are writing to: what the role allows, or what it blocks. */
  readonly permEditMode = signal<'grant' | 'deny'>('grant');
  readonly permReason = signal('');

  /**
   * Every permission, grouped by module, narrowed by the search box.
   *
   * WHAT A CHECKBOX MEANS DEPENDS ON THE MODE. Allowing: ticked is "this role grants it", and a
   * blocked permission is locked, because lifting a block is a decision to take on purpose and
   * not something a tick-all should do in passing. Blocking: ticked is "this role blocks it",
   * and nothing is locked.
   */
  readonly editableModules = computed(() => {
    const q = this.permFilter().trim().toLowerCase();
    const granted = new Set(this.permDraft());
    const denied = new Set(this.permDenyDraft());
    const blocking = this.permEditMode() === 'deny';

    return (this.permissionMatrix()?.modules ?? [])
      .map((module) => {
        const items = (module.groups ?? [])
          .flatMap((group) => group.permissions ?? [])
          // The Masters codes belong to the Organisation Admin alone; the server refuses them for any other role.
          .filter((permission) => permission.isOrganisationAdminOnly !== true)
          .map((permission) => {
            const code = permission.code ?? '';
            return {
              code,
              name: permission.name ?? permission.code ?? '',
              isSensitive: permission.isSensitive === true,
              denied: denied.has(code),
              /** Allowed by this role - shown beside the name while blocking, so it is not blocked by accident. */
              allowed: blocking && granted.has(code),
              ticked: blocking ? denied.has(code) : granted.has(code),
              locked: !blocking && denied.has(code),
            };
          })
          .filter((p) => !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));

        return { key: module.moduleName ?? '', name: module.moduleName ?? 'Other', items };
      })
      .filter((module) => module.items.length > 0);
  });

  readonly permDirty = computed(() => {
    const d = this.detailView();
    const differs = (draft: string[], saved: string[]) => {
      const original = new Set(saved);
      return draft.length !== original.size || draft.some((code) => !original.has(code));
    };

    return differs(this.permDraft(), d?.permissionBundle.map((p) => p.code) ?? [])
      || differs(this.permDenyDraft(), d?.excludedPermissions.map((p) => p.code) ?? []);
  });

  /**
   * Whether this role's permissions can be changed by the person looking at it.
   *
   * THE SERVER DECIDES WHICH ROLES (`AssignPermissions` in `permittedActions`): every role
   * except the one that grants everything. This used to say "not a built-in role" as well - and
   * every role an organisation starts with is built in, so on a new organisation nobody could
   * add, change or remove a single permission on any role without first cloning it. The server
   * has always allowed it, and keeps what an administrator removes across restarts.
   */
  readonly canEditPermissions = computed(() =>
    (this.detailRole()?.permittedActions ?? []).includes('AssignPermissions') && this.mayAssignPermissions());

  startPermEdit(): void {
    const d = this.detailView();
    if (!d) return;

    this.permDraft.set(d.permissionBundle.map((p) => p.code));
    this.permDenyDraft.set(d.excludedPermissions.map((p) => p.code));
    this.permEditMode.set('grant');
    this.permReason.set('');
    this.permEditing.set(true);

    this.loadPermissionMatrix().subscribe();
  }

  cancelPermEdit(): void {
    this.permEditing.set(false);
    this.permSaving.set(false);
    this.permDraft.set([]);
    this.permDenyDraft.set([]);
    this.permEditMode.set('grant');
    this.permReason.set('');
  }

  /**
   * One checkbox changed, in whichever mode the editor is in.
   *
   * A CODE IS NEVER IN BOTH LISTS. The server refuses a permission that is granted and denied at
   * once, so blocking one takes it out of what the role allows. Unblocking leaves it not given:
   * handing back what was blocked is a second decision, made in the other mode.
   */
  togglePermDraft(code: string): void {
    if (this.permEditMode() === 'deny') {
      const blocked = this.permDenyDraft();

      if (blocked.includes(code)) {
        this.permDenyDraft.set(blocked.filter((c) => c !== code));
      } else {
        this.permDenyDraft.set([...blocked, code]);
        this.permDraft.set(this.permDraft().filter((c) => c !== code));
      }

      return;
    }

    // Allowing. A blocked permission is locked in this mode, so it cannot arrive here ticked.
    if (this.permDenyDraft().includes(code)) return;

    const draft = this.permDraft();
    this.permDraft.set(draft.includes(code) ? draft.filter((c) => c !== code) : [...draft, code]);
  }

  /** The module's tick state: every permission it can change, some of them, or none. */
  moduleDraftState(module: { items: { ticked: boolean; locked: boolean }[] }): 'all' | 'some' | 'none' {
    const usable = module.items.filter((p) => !p.locked);
    const ticked = usable.filter((p) => p.ticked).length;
    return usable.length > 0 && ticked === usable.length ? 'all' : ticked > 0 ? 'some' : 'none';
  }

  toggleModuleDraft(module: { items: { code: string; ticked: boolean; locked: boolean }[] }): void {
    const codes = module.items.filter((p) => !p.locked).map((p) => p.code);
    const untick = this.moduleDraftState(module) === 'all';
    const apply = (draft: string[]) =>
      untick ? draft.filter((c) => !codes.includes(c)) : [...new Set([...draft, ...codes])];

    if (this.permEditMode() === 'deny') {
      this.permDenyDraft.set(apply(this.permDenyDraft()));

      // Blocking a whole area takes it out of what the role allows, one code at a time.
      if (!untick) {
        this.permDraft.set(this.permDraft().filter((c) => !codes.includes(c)));
      }

      return;
    }

    this.permDraft.set(apply(this.permDraft()));
  }

  savePermissions(): void {
    const d = this.detailView();
    if (!d || !this.permDirty()) return;

    this.permSaving.set(true);

    const granted = this.permDraft();
    const blocked = this.permDenyDraft();

    this.api.assignPermissions(d.id, {
      permissionCodes: granted,
      // BOTH LISTS, AS EDITED. The blocked list used to be sent back exactly as it was read,
      // which is why a block could be seen on this screen and never added, changed or lifted.
      deniedPermissionCodes: blocked,
      expectedVersion: d.version,
      justification: this.permReason().trim() || null,
    }).subscribe({
      next: () => {
        this.toast.show(
          'Permissions saved',
          blocked.length > 0
            ? `${d.name} now allows ${granted.length} permissions and blocks ${blocked.length}.`
            : `${d.name} now has ${granted.length} permissions.`,
          'success');
        this.cancelPermEdit();
        this.refreshOpenRole(d.id);
        this.reloadCatalogue();
      },
      error: (error: Error) => {
        this.permSaving.set(false);
        this.toast.show('Not saved', error.message, 'error');
      },
    });
  }

  // ===== SEGREGATION-OF-DUTIES RULES ON AN EXISTING ROLE =====

  /** Whether the add-a-rule form is open on the detail panel. */
  showConflictForm = signal(false);

  conflictForm = signal({ conflictingRoleId: '', reason: '', isBlocking: true });

  conflictSaving = signal(false);

  /** The rule being removed, so the row can show its own spinner rather than the whole panel. */
  conflictRemovingId = signal('');

  /** The roles this one can be paired with: not itself, and nothing already paired. */
  readonly conflictCandidates = computed(() => {
    const detail = this.detailView();

    if (!detail) {
      return [];
    }

    const taken = new Set(detail.incompatibleRoles.map((conflict) => conflict.conflictingRoleId));

    return (this.data()?.roles ?? [])
      .filter((role) => (role.id ?? '') !== detail.id && !taken.has(role.id ?? ''))
      .map((role) => ({ id: role.id ?? '', name: role.name ?? role.code ?? '' }));
  });

  openConflictForm(): void {
    this.conflictForm.set({ conflictingRoleId: '', reason: '', isBlocking: true });
    this.showConflictForm.set(true);
  }

  resetConflictForm(): void {
    this.showConflictForm.set(false);
    this.conflictForm.set({ conflictingRoleId: '', reason: '', isBlocking: true });
    this.conflictSaving.set(false);
    this.conflictRemovingId.set('');
  }

  /** Records the rule. A reason is required: it is what the refused person is shown later. */
  saveConflict(): void {
    const detail = this.detailView();
    const form = this.conflictForm();

    if (!detail || !form.conflictingRoleId || !form.reason.trim()) {
      this.toast.show(
        'Incomplete', 'Choose a role and say why the two cannot be held together.', 'warning');

      return;
    }

    this.conflictSaving.set(true);

    this.api.addIncompatibility({
      roleId: detail.id,
      conflictingRoleId: form.conflictingRoleId,
      reason: form.reason.trim(),
      isBlocking: form.isBlocking,
    }).subscribe({
      next: () => {
        // WHAT THE SERVER DOES WITH EACH KIND. A blocking rule is checked wherever a role is
        // granted. A flagged one is recorded and shown on both roles and nothing more - this
        // used to promise it would be "flagged for review", and no review looks at it.
        this.toast.show(
          'Rule recorded',
          form.isBlocking
            ? 'The combination will now be refused when somebody tries to grant it.'
            : 'The combination stays allowed. The rule is shown on both roles as a warning.',
          'success');

        this.resetConflictForm();
        this.refreshOpenRole(detail.id);
      },
      error: (error: Error) => {
        this.conflictSaving.set(false);
        this.toast.show('Not recorded', error.message, 'error');
      },
    });
  }

  removeConflict(conflict: RoleConflictView): void {
    const detail = this.detailView();

    if (!detail || !conflict.id) {
      return;
    }

    this.conflictRemovingId.set(conflict.id);

    this.api.removeIncompatibility(conflict.id).subscribe({
      next: () => {
        this.toast.show(
          'Rule removed',
          `${detail.name} and ${conflict.name} may now be held together.`,
          'success');

        this.conflictRemovingId.set('');
        this.refreshOpenRole(detail.id);
      },
      error: (error: Error) => {
        this.conflictRemovingId.set('');
        this.toast.show('Not removed', error.message, 'error');
      },
    });
  }

  /** Re-reads the open role after it changes, unless another role has been opened meanwhile. */
  private refreshOpenRole(roleId: string): void {
    this.api.getRole(roleId).subscribe({
      next: (detail) => {
        if (this.detailRole()?.id === detail.id) {
          this.detailRole.set(detail);
        }
      },
      error: (error: Error) => this.toast.show('Reload failed', error.message, 'error'),
    });
  }

  /** The open role as a dialog names it. */
  private toRoleRef(role: RoleDetailView): RoleRef {
    return { id: role.id, name: role.name, code: role.code, version: role.version };
  }

  // ===== COMPARE =====
  openCompareModal(role: RoleDetailView): void {
    this.closeDd();
    this.actionRole.set(this.toRoleRef(role));
    this.compareRoleId.set('');
    this.compareResult.set(null);
    this.showCompareModal.set(true);
  }

  closeCompareModal(): void {
    this.closeDd();
    this.showCompareModal.set(false);
    this.actionRole.set(null);
    this.compareRoleId.set('');
    this.compareResult.set(null);
  }

  /** Picks the role to compare with and closes the menu. */
  pickCompareRole(id: string): void {
    this.compareRoleId.set(id);
    this.compareResult.set(null);
    this.closeDd();
  }

  runCompare(): void {
    const base = this.actionRole();
    const otherId = this.compareRoleId();
    if (!base || !otherId) return;

    this.comparing.set(true);
    this.api.compareRoles(base.id, otherId).subscribe({
      next: (result) => {
        this.comparing.set(false);
        this.compareResult.set({
          onlyInLeft: result.onlyInLeft,
          onlyInRight: result.onlyInRight,
          inBoth: result.inBoth,
        });
      },
      error: (error: Error) => {
        this.comparing.set(false);
        this.toast.show('Compare Failed', error.message, 'error');
      },
    });
  }

  // ===== DELETE =====
  //
  // WHICH ROLES CAN BE DELETED IS THE SERVER'S RULE (`Delete` in `permittedActions`): one that
  // is not built in and that nobody has ever held, whatever state it is in. This screen had its
  // own - "a draft that nobody holds now" - which offered Delete on a draft whose holders had
  // been removed, where the API then failed, and hid it on a role put into use by mistake and
  // never given to anybody, which the API will delete.
  openDeleteRoleModal(role: RoleDetailView): void {
    if (!role.canDelete) return;
    this.actionRole.set(this.toRoleRef(role));
    this.deleteReason.set('');
    this.deleteError.set('');
    this.showDeleteRoleModal.set(true);
  }

  closeDeleteRoleModal(): void {
    this.showDeleteRoleModal.set(false);
    this.actionRole.set(null);
    this.deleteReason.set('');
    this.deleteError.set('');
  }

  confirmDeleteRole(): void {
    const target = this.actionRole();
    if (!target) return;

    const reason = this.deleteReason().trim();
    if (reason.length < RoleCatalogueComponent.MIN_REASON) {
      this.deleteError.set(`The reason must be at least ${RoleCatalogueComponent.MIN_REASON} characters.`);
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api.deleteRole(target.id, { expectedVersion: target.version, reason }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeDeleteRoleModal();
        if (this.detailRole()?.id === target.id) {
          this.closeDetail();
        }
        this.toast.show('Role deleted', `${target.name} (${target.code}) was permanently deleted.`, 'success');
        this.reloadCatalogue();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.deleteError.set(error.message);
      },
    });
  }

  // ===== ROLE ACTIONS =====
  //
  // ASKED FIRST, AND THE REASON IS THE ADMINISTRATOR'S. Deactivating used to act on the click:
  // one press took a role's permissions from everybody who held it, with nothing to confirm and
  // no way back from this screen. Both actions also wrote a sentence of this file's into the
  // audit trail as the reason - "Role is no longer required." against every role ever
  // deactivated - which records that something happened and nothing about why.
  //
  // NAMED AS THE SERVER NAMES THEM. The buttons said "Put into use" and "Retire" while the
  // state they produce is printed, in the server's words, as Active and Inactive, and the
  // permissions that allow them are iam.roles.activate and iam.roles.deactivate.

  /** The status change waiting to be confirmed, or null while the dialog is closed. */
  readonly statusChange = signal<{
    id: string;
    name: string;
    code: string;
    version: number;
    holders: number;
    target: 'active' | 'inactive';
    /** True when the role was deactivated before, so its holders get their permissions back. */
    wasInactive: boolean;
  } | null>(null);

  readonly statusReason = signal('');
  readonly statusError = signal('');

  activateRole(role: RoleDetailView): void {
    this.openStatusChange(role, 'active');
  }

  deactivateRole(role: RoleDetailView): void {
    this.openStatusChange(role, 'inactive');
  }

  private openStatusChange(role: RoleDetailView, target: 'active' | 'inactive'): void {
    this.statusReason.set('');
    this.statusError.set('');
    this.statusChange.set({
      id: role.id,
      name: role.name,
      code: role.code,
      version: role.version,
      holders: role.assignedUserCount,
      target,
      wasInactive: role.status === 'inactive',
    });
  }

  closeStatusChange(): void {
    this.statusChange.set(null);
    this.statusReason.set('');
    this.statusError.set('');
  }

  confirmStatusChange(): void {
    const change = this.statusChange();
    if (!change) return;

    const reason = this.statusReason().trim();
    if (reason.length < RoleCatalogueComponent.MIN_REASON) {
      this.statusError.set(`The reason must be at least ${RoleCatalogueComponent.MIN_REASON} characters.`);
      return;
    }

    const activating = change.target === 'active';

    this.submitting.set(true);
    this.statusError.set('');

    (activating
      ? this.api.activateRole(change.id, change.version, reason)
      : this.api.deactivateRole(change.id, change.version, reason)
    ).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeStatusChange();

        // The new state in the server's word for it, as the table will print it.
        this.toast.show(
          activating ? 'Role activated' : 'Role deactivated',
          `${change.name} is now ${this.statusLabel(change.target)}.`,
          activating ? 'success' : 'info');
        this.refreshIfOpen(change.id);
        this.reloadCatalogue();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.statusError.set(error.message);
      },
    });
  }

  /** The shortest reason the API accepts for a status change or a delete. */
  private static readonly MIN_REASON = 10;

  /** Re-reads the role if it is the one open in the detail pane. */
  private refreshIfOpen(roleId: string): void {
    if (roleId && this.detailRole()?.id === roleId) {
      this.refreshOpenRole(roleId);
    }
  }

  goBack(): void {
    this.navHistory.back(['/app/administration/access/user-directory']);
  }
}