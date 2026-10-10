import {
  Component, DestroyRef, Directive, ElementRef, HostListener, OnDestroy, OnInit,
  computed, effect, inject, signal,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { codeError, textWithLettersError } from '../../../../Shared/validation/field-rules';
import { RoleCatalogueApiService } from '../../../../Service/role-catalogue-api.service';
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
  /** view / create / edit / submit / approve / operate / export - drives the action strip. */
  action: string;
  /** The module's readable name, as the server names it everywhere else. */
  moduleName: string;
}

/** One action on a module card: lit when the role grants it, struck when it denies it. */
interface ActionKeyView {
  key: string;
  label: string;
  short: string;
  state: 'granted' | 'denied' | 'none';
}

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
  roleType: string;
  owningFunction: string;
  approvalState: string;
  privilegeLevel: string;
  isPrivileged: boolean | null;
  isDefaultRole: boolean;
  isSystemRole: boolean;
  grantsAllPermissions: boolean;
  priority: number;
  assignedUserCount: number;
  permissionBundle: RolePermissionView[];
  excludedPermissions: RolePermissionView[];
  incompatibleRoles: RoleConflictView[];
  visibleMenuCount: number;
  roleVersion: number;
  createdAt: string;
  updatedAt: string;
  canActivate: boolean;
  canRetire: boolean;
  canEdit: boolean;
  version: number;
}

interface RoleItemView {
  status: string;
  canActivate: boolean;
  canRetire: boolean;
  canDelete: boolean;
  id: string;
  reference: string;
  roleName: string;
  roleCode: string;
  purpose: string;
  roleType: string;
  owningFunction: string;
  permissionBundle: string;
  excludedPermissions: string;
  defaultScopeType: string;
  incompatibleRoles: string;
  assignmentPrerequisites: string;
  maximumDuration: string;
  reviewInterval: string;
  privilegeClassification: string;
  roleVersion: string;
  approvalState: string;
  approvalStateClass: string;
  assignedUserCount: number;
  effectiveDate: string;
  retirementReason: string;
  isSystemRole: boolean;
  isPrivileged: boolean;
  isDefaultRole: boolean;
  permissionCount: number;
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
  readonly canManageConflicts = computed(() => this.tokens.hasPermission('iam.roles.manage-incompatibility'));
  private readonly mayEditRoles = computed(() => this.tokens.hasPermission('iam.roles.edit'));
  private readonly mayDeleteRoles = computed(() => this.tokens.hasPermission('iam.roles.delete'));
  private readonly mayActivateRoles = computed(() => this.tokens.hasPermission('iam.roles.activate'));
  private readonly mayRetireRoles = computed(() => this.tokens.hasPermission('iam.roles.deactivate'));
  private readonly mayAssignPermissions = computed(() => this.tokens.hasPermission('iam.roles.assign-permissions'));

  data = signal<RoleCatalogueResponse | null>(null);
  detailCache = new Map<string, RoleDetail>();
  loading = signal(true);
  loadFailed = signal(false);
  submitting = signal(false);
  errorMessage = signal('');

  searchQuery = signal('');
  filterStatus = signal('');
  filterType = signal('');
  filterFunction = signal('');

  filteredRoles = signal<RoleItemView[]>([]);

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

  // ===== Stats used by the top summary cards + status tabs =====
  roleCounts = computed(() => ({
    total: (this.data()?.roles ?? []).length,
  }));

  // ===== Count of built-in/system roles =====
  systemRoleCount = computed(() => (this.data()?.roles ?? []).filter(r => r.isSystemRole).length);

  /**
   * The state tabs and stat cards: one entry per state present in the data.
   *
   * `status` is the raw value the filter compares, `label` is what the tab prints.
   */
  statusBreakdown = computed(() => {
    const items = this.data()?.roles ?? [];
    const counts = new Map<string, { label: string; count: number }>();

    for (const r of items) {
      const status = r.status ?? 'unknown';
      const label = r.statusDisplay ?? r.status ?? 'Unknown';
      const existing = counts.get(status);

      counts.set(status, { label, count: (existing?.count ?? 0) + 1 });
    }

    // Stable, readable order: the states people care about first, then anything else.
    const priority: Record<string, number> = { active: 0, draft: 1, inactive: 2 };

    return Array.from(counts.entries())
      .map(([status, entry]) => ({ status, label: entry.label, count: entry.count }))
      .sort((a, b) =>
        (priority[a.status] ?? 99) - (priority[b.status] ?? 99) || a.label.localeCompare(b.label));
  });

  // Maps any approvalState string to a consistent visual bucket.
  statusBucket(status: string): 'active' | 'draft' | 'retired' | 'default' {
    const s = (status ?? '').toLowerCase();
    if (s === 'active' || s === 'approved') return 'active';
    if (s === 'draft' || s === 'pending') return 'draft';
    if (s === 'retired' || s === 'inactive' || s === 'rejected') return 'retired';
    return 'default';
  }

  statCardClass(status: string): string {
    return `stat-${this.statusBucket(status)}`;
  }

  statusTabClass(status: string): string {
    return `tab-${this.statusBucket(status)}-state`;
  }

  statusBadgeClass(status: string): string {
    return `status-${this.statusBucket(status)}`;
  }

  statusIcon(status: string): string {
    switch (this.statusBucket(status)) {
      case 'active': return 'ri-shield-check-line';
      case 'draft': return 'ri-draft-line';
      case 'retired': return 'ri-archive-line';
      default: return 'ri-shield-line';
    }
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
      isDefaultRole: f.isDefaultRole === null ? 'Choose whether everybody gets this role.' : null,
      // The server takes 0 to 999. The stepper used to stop at 9999 and the box takes anything
      // typed, so a value the API would refuse reached it and came back as a bare error.
      priority: Number.isInteger(f.priority) && f.priority >= 0 && f.priority <= RoleCatalogueComponent.MAX_PRIORITY
        ? null
        : `Priority must be a whole number from 0 to ${RoleCatalogueComponent.MAX_PRIORITY}.`,
    };
  }

  private static readonly MAX_PRIORITY = 999;

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

  private static readonly ROLE_IDS: Record<string, string> = { name: 'roleNameInput', code: 'roleCodeInput', description: 'rolePurposeInput' };

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
  permissionDropdownOpen = signal(false);
  incompatibleDropdownOpen = signal(false);

  // ===== Role Detail =====
  showDetailModal = signal(false);
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
    const isSystemRole = detail.isSystemRole === true;

    // WHAT THE RECORD'S STATE ALLOWS IS THE SERVER'S ANSWER (`permittedActions`), not a second
    // copy of its rules kept here. The copy had drifted: it offered "Put into use" for a draft
    // only, so a retired role could never be brought back, and it offered Edit on a retired
    // role, which the server does not.
    const allows = (action: string) => (detail.permittedActions ?? []).includes(action);

    return {
      id: detail.id ?? '',
      name: detail.name ?? '',
      code: detail.code ?? '',
      purpose: detail.description ?? '',
      roleType: this.roleTypeLabel(detail.roleType),
      owningFunction: detail.displayTag ?? '',
      approvalState: detail.statusDisplay ?? status,
      privilegeLevel: detail.isPrivileged ? 'Privileged' : 'Standard',
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

      incompatibleRoles: (detail.incompatibilities ?? []).map((conflict) => ({
        id: conflict.id ?? '',
        conflictingRoleId: conflict.conflictingRoleId ?? '',
        name: conflict.conflictingRoleName ?? '',
        reason: conflict.reason ?? '',
        isBlocking: conflict.isBlocking === true,
      })),

      visibleMenuCount: (detail.visibleMenuIds ?? []).length,
      roleVersion: detail.version ?? 0,
      createdAt: detail.createdAtUtc ? this.formatDate(detail.createdAtUtc) : '—',
      updatedAt: detail.updatedAtUtc ? this.formatDate(detail.updatedAtUtc) : '—',

      // A built-in role keeps its name, its code and its place in the catalogue: it is not
      // renamed, retired or put back from this screen. What it GRANTS can be changed - see
      // `canEditPermissions`.
      canActivate: allows('Activate') && !isSystemRole && this.mayActivateRoles(),
      canRetire: allows('Deactivate') && !isSystemRole && this.mayRetireRoles(),
      canEdit: allows('Edit') && !isSystemRole && this.mayEditRoles(),
      version: detail.version ?? 0,
    };
  });

  /** The role type in the words the screen uses. */
  private roleTypeLabel(roleType: string | undefined): string {
    switch (roleType) {
      case 'platform': return 'Platform';
      case 'tenant': return 'Organisation';
      case 'template': return 'Template';
      default: return roleType ?? '';
    }
  }

  /**
   * The open role as a list row — what Compare and Delete take. Looked up across ALL roles, not
   * just the filtered ones, so the detail actions keep working when a filter hides the row.
   */
  readonly selectedItem = computed<RoleItemView | null>(() => {
    const id = this.detailRole()?.id;
    if (!id) return null;
    const row = (this.data()?.roles ?? []).find((r) => r.id === id);
    return row ? this.toRoleItemView(row) : null;
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

  /** The seven verbs a permission can carry, in the order the action strip prints them. */
  private static readonly ACTIONS: { key: string; label: string; short: string }[] = [
    { key: 'view', label: 'View', short: 'V' },
    { key: 'create', label: 'Create', short: 'C' },
    { key: 'edit', label: 'Edit', short: 'E' },
    { key: 'submit', label: 'Submit', short: 'S' },
    { key: 'approve', label: 'Approve', short: 'A' },
    { key: 'operate', label: 'Operate', short: 'O' },
    { key: 'export', label: 'Export', short: 'X' },
  ];

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
    return [...groups.entries()]
      .map(([key, items]) => {
        const denied = items.filter((i) => i.denied).length;
        const actions: ActionKeyView[] = RoleCatalogueComponent.ACTIONS.map((a) => {
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

  // ---- Catalogue masthead figures and the grouped role index ------------------------------
  readonly catalogueFigures = computed(() => {
    const roles = this.data()?.roles ?? [];
    const total = roles.length || 1;
    const share = (status: string) =>
      Math.round((roles.filter((r) => this.statusBucket(r.status ?? '') === status).length / total) * 100);
    return {
      total: roles.length,
      active: roles.filter((r) => r.status === 'active').length,
      draft: roles.filter((r) => r.status === 'draft').length,
      retired: roles.filter((r) => this.statusBucket(r.status ?? '') === 'retired').length,
      privileged: roles.filter((r) => r.isPrivileged).length,
      system: roles.filter((r) => r.isSystemRole).length,
      holders: roles.reduce((sum, r) => sum + (r.memberCount ?? 0), 0),
      staffed: roles.filter((r) => (r.memberCount ?? 0) > 0).length,
      permissions: roles.reduce((sum, r) => sum + (r.permissionCount ?? 0), 0),
      shares: { active: share('active'), draft: share('draft'), retired: share('retired'), other: share('default') },
    };
  });

  /** The catalogue's state ring: one arc per state on a circle of radius 52. */
  readonly stateRing = computed(() => {
    const f = this.catalogueFigures();
    const total = f.total || 1;
    const circumference = 2 * Math.PI * 52;
    let run = 0;
    return [
      { key: 'active', label: 'In use', count: f.active },
      { key: 'draft', label: 'Draft', count: f.draft },
      { key: 'retired', label: 'Retired', count: f.retired },
    ].map((seg) => {
      const length = (seg.count / total) * circumference;
      const arc = { ...seg, dash: `${length} ${circumference - length}`, offset: -run };
      run += length;
      return arc;
    });
  });

  /** Share of this role's module actions that are granted, 0-100, for the module bars. */
  moduleShare(granted: number, total: number): number {
    return total ? Math.round((granted / total) * 100) : 0;
  }

  /** The filtered roles, sectioned by state in the same order as the status segments. */
  readonly roleSections = computed(() => {
    const labels = new Map(this.statusBreakdown().map((s) => [s.status, s.label]));
    const order = this.statusBreakdown().map((s) => s.status);
    const sections = new Map<string, RoleItemView[]>();
    for (const role of this.filteredRoles()) {
      sections.set(role.status, [...(sections.get(role.status) ?? []), role]);
    }
    return [...sections.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([status, roles]) => ({ status, label: labels.get(status) ?? status, roles }));
  });

  /** The widest permission count in the catalogue - scales each index row's bar. */
  readonly maxPermissionCount = computed(() =>
    Math.max(1, ...(this.data()?.roles ?? []).map((r) => r.permissionCount ?? 0)));

  // ===== Compare & Delete Modal =====
  showCompareModal = signal(false);
  showDeleteRoleModal = signal(false);
  actionRole = signal<RoleItemView | null>(null);
  deleteReason = signal('');
  deleteError = signal('');
  compareRoleId = signal('');
  comparing = signal(false);
  compareResult = signal<{ onlyInLeft: string[]; onlyInRight: string[]; inBoth: string[] } | null>(null);

  constructor() {
    this.loadData();
    effect(() => { this.applyFilters(); });

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

    // The whole catalogue: search, the state tabs and every count on the masthead run in the
    // browser, so a first page standing in for the catalogue would undercount all of them.
    this.api.getCatalogue().subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
        this.applyFilters();
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.loadFailed.set(true);
        this.errorMessage.set(error.message);
        this.toast.show('Error', 'Failed to load role catalogue.', 'error');
      },
    });
  }

  /** Re-reads the list quietly, so counts update without the page flashing its loader. */
  private reloadCatalogue(): void {
    this.api.getCatalogue().subscribe({
      next: (res) => { this.data.set(res); this.applyFilters(); },
    });
  }

  retry(): void { this.loadData(); }

  applyFilters(): void {
    const all = this.data()?.roles ?? [];
    const q = this.searchQuery().toLowerCase();
    const s = this.filterStatus();
    const t = this.filterType();
    const f = this.filterFunction();
    let result = all;
    if (q) {
      result = result.filter((r) =>
        (r.name ?? '').toLowerCase().includes(q)
        || (r.code ?? '').toLowerCase().includes(q));
    }
    if (s) result = result.filter((r) => r.status === s);
    if (t) result = result.filter((r) => r.roleType === t);
    if (f) result = result.filter((r) => (r.displayTag ?? '').trim() === f);

    this.filteredRoles.set(result.map(r => this.toRoleItemView(r)));
  }

  clearFilters(): void {
    this.searchQuery.set(''); this.filterStatus.set(''); this.filterType.set(''); this.filterFunction.set('');
  }

  private toRoleItemView(r: RoleListItem): RoleItemView {
    const detail = this.detailCache.get(r.id ?? '');

    const permissions = (detail?.permissions ?? []);
    const granted = permissions.filter((permission) => permission.isDenied !== true);
    const denied = permissions.filter((permission) => permission.isDenied === true);

    const status = r.status ?? '';

    return {
      status,
      canActivate: status !== 'active' && r.isSystemRole !== true && this.mayActivateRoles(),
      canRetire: status === 'active' && r.isSystemRole !== true && this.mayRetireRoles(),

      // Only a draft can be removed outright; once a role has been in use, retiring applies.
      // Nobody may hold it either - the server refuses that delete, so the button is not drawn.
      canDelete: status === 'draft' && r.isSystemRole !== true && (r.memberCount ?? 0) === 0
        && this.mayDeleteRoles(),

      id: r.id ?? '',
      reference: r.code ?? '',
      roleName: r.name ?? '',
      roleCode: r.code ?? '',
      purpose: r.description ?? detail?.description ?? '',
      roleType: this.roleTypeLabel(r.roleType),
      owningFunction: r.displayTag ?? '',

      permissionBundle: granted.length > 0
        ? granted.map((permission) => permission.permissionCode).join(', ')
        : `${r.permissionCount ?? 0} permission(s)`,

      excludedPermissions: denied.length > 0
        ? denied.map((permission) => permission.permissionCode).join(', ')
        : 'None',

      defaultScopeType: 'Whole organisation',

      incompatibleRoles: (detail?.incompatibilities ?? []).length > 0
        ? (detail?.incompatibilities ?? [])
            .map((item) => item.conflictingRoleName)
            .join(', ')
        : 'None',

      assignmentPrerequisites: 'None',
      maximumDuration: '',
      reviewInterval: '',
      privilegeClassification: r.isPrivileged ? 'Privileged' : 'Standard',
      roleVersion: `v${r.version ?? 0}`,
      approvalState: r.statusDisplay ?? r.status ?? '',
      approvalStateClass: this.approvalStateClass(r.status ?? ''),
      assignedUserCount: r.memberCount ?? 0,
      effectiveDate: r.updatedAtUtc ? this.formatDate(r.updatedAtUtc) : '—',
      retirementReason: '',
      isSystemRole: r.isSystemRole === true,
      isPrivileged: r.isPrivileged === true,
      isDefaultRole: r.isDefaultRole === true,
      permissionCount: r.permissionCount ?? granted.length,
      version: r.version ?? 0,
    };
  }

  private approvalStateClass(state: string): string {
    switch (state) {
      case 'active': return 'bg-success-subtle text-success';
      case 'draft': return 'bg-warning-subtle text-warning';
      case 'inactive': return 'bg-secondary-subtle text-secondary';
      default: return 'bg-secondary-subtle text-secondary';
    }
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
    this.permissionDropdownOpen.set(false);
    this.incompatibleDropdownOpen.set(false);
    this.permMode.set('grant');
    this.permQuery.set('');
    this.incompatQuery.set('');
    this.closeDd();
    this.errorMessage.set('');
    this.showCreateModal.set(true);

    // The matrix is fetched when the editor opens rather than with the catalogue.
    if (!this.permissionMatrix()) {
      this.api.getPermissionMatrix().subscribe({
        next: (matrix) => this.permissionMatrix.set(matrix),
        error: (error: Error) =>
          this.toast.show('Permissions unavailable', error.message, 'error'),
      });
    }
  }

  closeCreateModal(): void {
    this.closeDd();
    this.showCreateModal.set(false);
    this.editingRoleId.set('');
  }

  /** The role the drawer is editing; empty while it is creating a new one. */
  readonly editingRoleId = signal('');
  private editingVersion = 0;

  /** Opens the drawer on an existing role's name, purpose, classification and priority. */
  openEditRole(role: RoleDetailView): void {
    this.openCreateModal();
    this.editingRoleId.set(role.id);
    this.editingVersion = role.version;
    this.createRoleForm.set({
      name: role.name,
      code: role.code,
      description: role.purpose,
      displayTag: role.owningFunction,
      priority: role.priority,
      isPrivileged: role.isPrivileged === true,
      isDefaultRole: role.isDefaultRole,
    });
  }

  /** Opens the drawer as a new draft that starts as a copy of this role. */
  cloneRole(role: RoleDetailView): void {
    this.openCreateModal();
    this.createRoleForm.set({
      name: `Copy of ${role.name}`,
      code: `${role.code}-COPY`,
      description: role.purpose,
      displayTag: role.owningFunction,
      priority: role.priority,
      isPrivileged: role.isPrivileged === true,
      isDefaultRole: false,
    });
    this.selectedPermissionCodes.set(role.permissionBundle.map((p) => p.code));
    this.selectedDeniedCodes.set(role.excludedPermissions.map((p) => p.code));
    this.selectedIncompatibleRoleIds.set(
      role.incompatibleRoles.map((c) => c.conflictingRoleId).filter((id) => !!id));
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

  togglePermissionDropdown(): void {
    this.permissionDropdownOpen.set(!this.permissionDropdownOpen());
  }

  toggleIncompatibleDropdown(): void {
    this.incompatibleDropdownOpen.set(!this.incompatibleDropdownOpen());
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

  /** The permissions currently ticked, by name. */
  selectedPermissionLabels(): string {
    const byCode = new Map<string, string>();

    for (const module of this.permissionMatrix()?.modules ?? []) {
      for (const group of module.groups ?? []) {
        for (const permission of group.permissions ?? []) {
          byCode.set(permission.code ?? '', permission.name ?? permission.code ?? '');
        }
      }
    }

    return this.selectedPermissionCodes()
      .map((code) => byCode.get(code) ?? code)
      .join(', ');
  }

  /** Every permission in the matrix, flattened. */
  readonly permissionChoices = computed(() => {
    const choices: { code: string; name: string; description: string; isSensitive: boolean }[] = [];

    for (const module of this.permissionMatrix()?.modules ?? []) {
      for (const group of module.groups ?? []) {
        for (const permission of group.permissions ?? []) {
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

  selectedIncompatibleRoleLabels(): string {
    const roles = this.data()?.roles ?? [];
    return this.selectedIncompatibleRoleIds()
      .map(id => roles.find(r => r.id === id)?.name ?? id)
      .join(', ');
  }

  confirmCreateRole(): void {
    const form = this.createRoleForm();

    this.roleSubmitted.set(true);
    const labels: Record<string, string> = {
      name: 'Role name', code: 'Role code', description: 'Purpose', isPrivileged: 'Privilege level', isDefaultRole: 'Given to everybody',
      priority: 'Priority',
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
      next: (role) => {
        this.detailCache.set(role.id ?? '', role);
        this.recordConflicts(role.id ?? '', role.name ?? form.name);
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.errorMessage.set(error.message);
        this.toast.show('Could not create the role', error.message, 'error');
      },
    });
  }

  /** Records the roles the new one must not be held alongside. */
  private recordConflicts(roleId: string, roleName: string): void {
    const conflictIds = this.selectedIncompatibleRoleIds();

    const finish = (conflictError?: string) => {
      this.submitting.set(false);
      this.showCreateModal.set(false);

      // Open the role that was just created, so the detail pane shows it straight away.
      const created = this.detailCache.get(roleId);
      if (created) {
        this.detailRole.set(created);
        this.showDetailModal.set(true);
      }

      if (conflictError) {
        this.toast.show(
          'Role created, rules not recorded',
          `${roleName} was created. The segregation-of-duties rules could not be saved: ${conflictError}`,
          'warning');
      } else {
        this.toast.show('Role created', `${roleName} has been created as a draft.`, 'success');
      }

      this.loadData();
    };

    if (!roleId || conflictIds.length === 0) {
      finish();
      return;
    }

    forkJoin(
      conflictIds.map((conflictingRoleId) =>
        this.api.addIncompatibility({
          roleId,
          conflictingRoleId,
          reason: 'Recorded when the role was created.',
          isBlocking: true,
        })),
    ).subscribe({
      next: () => finish(),
      error: (error: Error) => finish(error.message),
    });
  }

  // ===== ROLE DETAIL =====
  openDetail(role: RoleItemView): void {
    this.permFilter.set('');
    this.openGroups.set([]);
    const cached = this.detailCache.get((role.id ?? ''));
    if (cached) {
      this.detailRole.set(cached);
      this.showDetailModal.set(true);
      return;
    }

    this.api.getRole((role.id ?? '')).subscribe({
      next: (detail) => {
        this.detailCache.set(detail.id ?? '', detail);
        this.detailRole.set(detail);
        this.showDetailModal.set(true);
      },
      error: (error: Error) => {
        this.toast.show('Load Failed', error.message, 'error');
      },
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
    this.showDetailModal.set(false);
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

    if (!this.permissionMatrix()) {
      this.api.getPermissionMatrix().subscribe({
        next: (matrix) => this.permissionMatrix.set(matrix),
        error: (error: Error) => this.toast.show('Permissions unavailable', error.message, 'error'),
      });
    }
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
        this.toast.show(
          'Rule recorded',
          form.isBlocking
            ? 'The combination will now be refused when somebody tries to grant it.'
            : 'The combination will now be flagged for review.',
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

  /** Re-reads the open role after a rule changes. The cache is evicted first. */
  private refreshOpenRole(roleId: string): void {
    this.detailCache.delete(roleId);

    this.api.getRole(roleId).subscribe({
      next: (detail) => {
        this.detailCache.set(detail.id ?? '', detail);
        this.detailRole.set(detail);
      },
      error: (error: Error) => this.toast.show('Reload failed', error.message, 'error'),
    });
  }

  // ===== COMPARE =====
  openCompareModal(role: RoleItemView): void {
    this.closeDd();
    this.actionRole.set(role);
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

  // ===== DELETE DRAFT =====
  openDeleteRoleModal(role: RoleItemView): void {
    if (!role.canDelete) return;
    this.actionRole.set(role);
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
    if (reason.length < 10) {
      this.deleteError.set('Deletion reason must be at least 10 characters.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    this.api.deleteDraftRole(target.id, target.version, reason).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeDeleteRoleModal();
        if (this.detailRole()?.id === target.id) {
          this.detailRole.set(null);
        }
        this.toast.show('Role Deleted', `Role ${target.roleCode} was permanently deleted.`, 'success');
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.deleteError.set(error.message);
      },
    });
  }

  // ===== ROLE ACTIONS =====
  //
  // ASKED FIRST, AND THE REASON IS THE ADMINISTRATOR'S. Retire used to act on the click: one
  // press took a role's permissions from everybody who held it, with nothing to confirm and no
  // way back from this screen. Both actions also wrote a sentence of this file's into the audit
  // trail as the reason - "Role is no longer required." against every role ever retired - which
  // records that something happened and nothing about why.

  /** The status change waiting to be confirmed, or null while the dialog is closed. */
  readonly statusChange = signal<{
    id: string;
    name: string;
    code: string;
    version: number;
    holders: number;
    target: 'active' | 'inactive';
    /** True when the role was retired before, so its holders get their permissions back. */
    wasRetired: boolean;
  } | null>(null);

  readonly statusReason = signal('');
  readonly statusError = signal('');

  submitRole(role: RoleItemView | RoleDetailView): void {
    this.openStatusChange(role, 'active');
  }

  retireRole(role: RoleItemView | RoleDetailView): void {
    this.openStatusChange(role, 'inactive');
  }

  private openStatusChange(role: RoleItemView | RoleDetailView, target: 'active' | 'inactive'): void {
    const listed = (this.data()?.roles ?? []).find((item) => item.id === role.id);

    this.statusReason.set('');
    this.statusError.set('');
    this.statusChange.set({
      id: role.id ?? '',
      name: this.roleDisplayName(role),
      code: 'roleCode' in role ? role.roleCode : role.code,
      version: role.version ?? 0,
      holders: role.assignedUserCount ?? 0,
      target,
      wasRetired: listed?.status === 'inactive',
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
    if (reason.length < 10) {
      this.statusError.set('The reason must be at least 10 characters.');
      return;
    }

    const activating = change.target === 'active';

    this.submitting.set(true);
    this.statusError.set('');

    (activating
      ? this.api.submitRole(change.id, change.version, reason)
      : this.api.retireRole(change.id, change.version, reason)
    ).subscribe({
      next: () => {
        this.submitting.set(false);
        this.closeStatusChange();
        this.detailCache.delete(change.id);

        this.toast.show(
          activating ? 'Role activated' : 'Role retired',
          activating ? `${change.name} is now in use.` : `${change.name} has been retired.`,
          activating ? 'success' : 'info');
        this.refreshIfOpen(change.id);
        this.loadData();
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.statusError.set(error.message);
      },
    });
  }

  /** Re-reads the role if it is the one open in the detail pane. */
  private refreshIfOpen(roleId: string): void {
    if (roleId && this.detailRole()?.id === roleId) {
      this.refreshOpenRole(roleId);
    }
  }

  private roleDisplayName(role: RoleItemView | RoleDetailView): string {
    return 'roleName' in role ? role.roleName : role.name;
  }

  goBack(): void {
    this.navHistory.back(['/app/administration/access/user-directory']);
  }
}