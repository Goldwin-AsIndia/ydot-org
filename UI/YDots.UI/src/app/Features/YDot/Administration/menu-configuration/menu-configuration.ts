import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { IamAdminApiService } from '../../../../Service/iam-admin-api.service';
import { IconPickerComponent } from '../../../../Shared/components/icon-picker/icon-picker';
import { apiErrorCode, apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  CreateMenuDefinitionRequest,
  MenuLevel,
  RoleLookupResponse,
  RoleMenuNodeResponse,
  TenantMenuItemRequest,
  TenantMenuNodeResponse,
  UpdateMenuDefinitionRequest,
} from '../../../../Shared/models/iam-contract.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { NavigationService } from '../../../../Shared/services/navigation.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

/** The two jobs this screen does, over one tree. */
type Mode = 'organisation' | 'roles';

/** One rendered line of the tree, flattened so the template is a single loop. */
interface Row {
  readonly id: string;
  readonly node: TenantMenuNodeResponse;
  readonly depth: number;
  readonly hasChildren: boolean;
}

/** What the inspector is editing. `create` has no node behind it yet. */
interface Draft {
  readonly kind: 'edit' | 'create';
  readonly id: string | null;
  readonly parentId: string | null;
  readonly level: MenuLevel;
  code: string;
  name: string;
  icon: string | null;
  route: string;
  permission: string;
  order: string;
  opensInNewTab: boolean;
}

/**
 * Menu configuration - structure, appearance and who sees what, on one screen.
 *
 * ============================================================================================
 * WHAT A PERSON SEES IN THE SIDEBAR IS THE OVERLAP OF FOUR THINGS
 * ============================================================================================
 *
 *     platform catalogue   what the product ships          code, plus this screen for SuperAdmin
 *   + this organisation's own nodes                        this screen
 *   ∩ organisation configuration  what is switched on      this screen, Organisation mode
 *   ∩ role mapping        what this role was given         this screen, Roles mode
 *   ∩ held permissions    what this person may actually do the role's permissions, not here
 *
 * The first four are all editable here. The last is not, and deliberately: a menu item mapped to
 * a role whose holders lack the permission simply never appears, which is why every row shows the
 * permission it needs rather than letting somebody wonder.
 *
 * NONE OF IT IS A SECURITY BOUNDARY. Hiding a link is a courtesy; every endpoint behind it
 * re-checks its own permission on every request. Switching a menu item off does not revoke
 * anything, and the banner says so.
 *
 * ============================================================================================
 * WHY THIS REPLACED THE MENU MAPPING SCREEN
 * ============================================================================================
 * That screen could switch nodes on and off and rename them, and nothing else. The API had
 * carried create, edit and delete for menu nodes the whole time and no screen called them, so
 * adding a menu item meant a developer and a release. It also asked for an icon as free text,
 * against a list of fifty names written down nowhere - so the reliable way to choose an icon was
 * to read the TypeScript.
 *
 * TWO MODES, ONE TREE, and that is the point of the redesign. The old screen had two tabs with
 * two separately built trees, and the commonest question - "why can this role not see the thing
 * I mapped to it?" - needed both tabs at once to answer. Here the same tree is rendered either
 * way and a node the organisation has switched off is marked as such while you map roles.
 */
@Component({
  selector: 'app-menu-configuration',
  standalone: true,
  imports: [PageHeader, CommonModule, FormsModule, IconPickerComponent],
  templateUrl: './menu-configuration.html',
  styleUrl: './menu-configuration.css',
})
export class MenuConfigurationComponent implements OnInit, OnDestroy {
  private readonly api = inject(IamAdminApiService);
  private readonly navigation = inject(NavigationService);
  private readonly tokens = inject(AuthTokenService);
  private readonly toast = inject(ToastService);

  private readonly destroy$ = new Subject<void>();

  // ===========================================================================================
  // Screen state
  // ===========================================================================================

  readonly mode = signal<Mode>('organisation');
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly staleData = signal(false);
  readonly search = signal('');

  /**
   * Whether this caller may change the SHAPE of the menu, as opposed to what is switched on.
   *
   * TWO DIFFERENT POWERS, and the screen has to tell them apart or it offers buttons that always
   * fail. Configure renames and hides what the product ships; manage-structure adds nodes that
   * did not exist. A SuperAdmin holds both by scope.
   */
  readonly canManageStructure = computed(
    () =>
      this.tokens.hasAnyPermission(
        'iam.menus.manage-structure',
        'platform.menu-catalogue.manage',
      ),
  );

  readonly canConfigure = computed(() => this.tokens.hasAnyPermission('iam.menus.configure'));
  readonly canMapRoles = computed(() => this.tokens.hasAnyPermission('iam.menus.map-roles'));

  // ---- The tree -----------------------------------------------------------------------------

  readonly nodes = signal<TenantMenuNodeResponse[]>([]);
  readonly expanded = signal<Record<string, boolean>>({});

  /** id → enabled, the organisation switch. Dirty until saved. */
  readonly enabled = signal<Record<string, boolean>>({});
  private readonly savedEnabled = signal<Record<string, boolean>>({});

  /**
   * The whole per-organisation row for each node, not only its switch.
   *
   * THE SAVE REPLACES THE ROW. Sending back only the on/off flag wiped every rename, custom icon
   * and custom ordering the organisation had - silently, on a screen that never showed them.
   */
  readonly overrides = signal<Record<string, TenantMenuItemRequest>>({});
  private readonly savedOverrides = signal<Record<string, TenantMenuItemRequest>>({});

  private parents: Record<string, string> = {};
  private byId: Record<string, TenantMenuNodeResponse> = {};

  // ---- Roles --------------------------------------------------------------------------------

  readonly roles = signal<RoleLookupResponse[]>([]);
  readonly selectedRoleId = signal('');
  readonly roleVersion = signal(0);
  readonly loadingRoleMapping = signal(false);
  readonly mapped = signal<Record<string, boolean>>({});
  private readonly savedMapped = signal<Record<string, boolean>>({});
  private roleNodesById: Record<string, RoleMenuNodeResponse> = {};
  readonly landingMenuId = signal<string | null>(null);

  // ---- Inspector ----------------------------------------------------------------------------

  readonly draft = signal<Draft | null>(null);
  readonly permissionOptions = signal<{ code: string; name: string; moduleCode: string }[]>([]);
  readonly savingNode = signal(false);

  // ===========================================================================================
  // Derived
  // ===========================================================================================

  readonly hasConfigurationChanges = computed(
    () =>
      JSON.stringify(this.enabled()) !== JSON.stringify(this.savedEnabled()) ||
      JSON.stringify(this.overrides()) !== JSON.stringify(this.savedOverrides()),
  );

  readonly hasMappingChanges = computed(
    () => JSON.stringify(this.mapped()) !== JSON.stringify(this.savedMapped()),
  );

  readonly enabledCount = computed(
    () => Object.values(this.enabled()).filter(Boolean).length,
  );

  readonly totalCount = computed(() => Object.keys(this.enabled()).length);

  readonly mappedCount = computed(() => Object.values(this.mapped()).filter(Boolean).length);

  readonly selectedRoleName = computed(
    () => this.roles().find((role) => role.id === this.selectedRoleId())?.name ?? '',
  );

  /**
   * The tree, flattened to the lines actually on screen.
   *
   * A SEARCH KEEPS ANCESTORS. Filtering a tree to only the matching rows produces orphans -
   * "User Directory" floating with no indication that it lives under Administration - so a match
   * pulls its parents in with it and the depth still reads as the real depth.
   */
  readonly rows = computed<readonly Row[]>(() => {
    const term = this.search().trim().toLowerCase();
    const expanded = this.expanded();
    const out: Row[] = [];

    const matches = (node: TenantMenuNodeResponse): boolean => {
      if (!term) {
        return true;
      }

      const haystack = [
        node.resolvedName ?? '',
        node.catalogueName ?? '',
        node.code ?? '',
        node.route ?? '',
        node.requiredPermissionCode ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(term) || (node.children ?? []).some(matches);
    };

    const walk = (list: readonly TenantMenuNodeResponse[], depth: number): void => {
      for (const node of list) {
        const id = node.menuDefinitionId;

        if (!id || !matches(node)) {
          continue;
        }

        const children = node.children ?? [];

        out.push({ id, node, depth, hasChildren: children.length > 0 });

        // A search opens the tree: hiding matches behind a collapsed parent would make the
        // search look broken.
        if (children.length > 0 && (expanded[id] === true || term.length > 0)) {
          walk(children, depth + 1);
        }
      }
    };

    walk(this.nodes(), 0);

    return out;
  });

  // ===========================================================================================
  // Layout: section rail (top-level menus) + workspace (the chosen section's contents)
  // ===========================================================================================

  /** The top-level menu open in the workspace. Null falls back to the first visible one. */
  readonly activeSectionId = signal<string | null>(null);

  /** Whether the "how visibility works" note is open. */
  readonly showRule = signal(false);

  /** Top-level menus for the rail — already filtered by the search, ancestors kept. */
  readonly sections = computed<readonly Row[]>(() => this.rows().filter((row) => row.depth === 0));

  readonly activeSection = computed<Row | null>(() => {
    const list = this.sections();
    return list.find((row) => row.id === this.activeSectionId()) ?? list[0] ?? null;
  });

  /** Everything under the active section, flattened (depth 1 = submenu, 2 = child submenu). */
  readonly sectionRows = computed<readonly Row[]>(() => {
    const section = this.activeSection();
    if (!section) {
      return [];
    }
    const term = this.search().trim().toLowerCase();
    const expanded = this.expanded();
    const out: Row[] = [];

    const walk = (list: readonly TenantMenuNodeResponse[], depth: number): void => {
      for (const node of list) {
        const id = node.menuDefinitionId;
        if (!id || !this.matchesSearch(node, term)) {
          continue;
        }
        const children = node.children ?? [];
        out.push({ id, node, depth, hasChildren: children.length > 0 });
        if (children.length > 0 && (expanded[id] === true || term.length > 0)) {
          walk(children, depth + 1);
        }
      }
    };

    walk(section.node.children ?? [], 1);
    return out;
  });

  /** Every node, flat — for the summary figures. */
  private readonly allNodes = computed<TenantMenuNodeResponse[]>(() => {
    const out: TenantMenuNodeResponse[] = [];
    const walk = (list: readonly TenantMenuNodeResponse[]): void => {
      for (const node of list) {
        out.push(node);
        walk(node.children ?? []);
      }
    };
    walk(this.nodes());
    return out;
  });

  readonly customisedCount = computed(() => this.allNodes().filter((node) => this.hasOverride(node)).length);
  readonly ownedCount = computed(() => this.allNodes().filter((node) => node.isOrganisationOwned).length);

  readonly landingName = computed(() => {
    const id = this.landingMenuId();
    const node = id ? this.allNodes().find((n) => n.menuDefinitionId === id) : undefined;
    return node ? this.pendingName(node) : '';
  });

  /** How many items differ from what is stored, for the save bar. */
  readonly pendingCount = computed(() => {
    if (this.mode() === 'roles') {
      const now = this.mapped();
      const before = this.savedMapped();
      const ids = new Set([...Object.keys(now), ...Object.keys(before)]);
      return [...ids].filter((id) => !!now[id] !== !!before[id]).length;
    }
    const enabled = this.enabled();
    const savedEnabled = this.savedEnabled();
    const overrides = this.overrides();
    const savedOverrides = this.savedOverrides();
    return Object.keys(enabled).filter(
      (id) =>
        enabled[id] !== savedEnabled[id] ||
        JSON.stringify(overrides[id] ?? null) !== JSON.stringify(savedOverrides[id] ?? null),
    ).length;
  });

  selectSection(id: string): void {
    this.activeSectionId.set(id);
    this.openLaneId.set(null);
  }

  // ---- Submenu sections: an accordion, one open at a time -----------------------------------

  /** The submenu whose pages are showing. Null = every section collapsed. */
  readonly openLaneId = signal<string | null>(null);

  private childRows(node: TenantMenuNodeResponse | undefined, depth: number): Row[] {
    const term = this.search().trim().toLowerCase();
    return (node?.children ?? [])
      .filter((child) => !!child.menuDefinitionId && this.matchesSearch(child, term))
      .map((child) => ({
        id: child.menuDefinitionId as string,
        node: child,
        depth,
        hasChildren: (child.children ?? []).length > 0,
      }));
  }

  /** Second column: the submenus of the chosen menu. */
  readonly subItems = computed<readonly Row[]>(() => this.childRows(this.activeSection()?.node, 1));

  /** Open while searching too, so matching pages are never hidden inside a closed section. */
  isLaneOpen(id: string): boolean {
    return this.openLaneId() === id || !!this.search().trim();
  }

  /** Opens a section (closing any other) or closes it again. Clicks on its own controls are ignored. */
  toggleLane(row: Row, event?: Event): void {
    if ((event?.target as HTMLElement | null)?.closest('.mc-lane-side button, .mc-lane-side label')) {
      return;
    }
    if (this.childrenOf(row.node).length === 0) {
      return;
    }
    this.openLaneId.set(this.openLaneId() === row.id ? null : row.id);
  }

  /** A submenu's own children (the child submenus), search-filtered, for its lane's grid. */
  childrenOf(node: TenantMenuNodeResponse): Row[] {
    return this.childRows(node, 2);
  }

  /** 1-based position of the open menu among the visible ones, for "Menu 3 of 11". */
  readonly sectionIndex = computed(() => {
    const active = this.activeSection();
    return active ? this.sections().findIndex((row) => row.id === active.id) + 1 : 0;
  });

  // ---- Card board: one card per top-level menu ---------------------------------------------

  /** Everything inside a top-level menu, flattened (depth 1 = submenu, 2 = child submenu). */
  cardRows(node: TenantMenuNodeResponse): Row[] {
    const term = this.search().trim().toLowerCase();
    const out: Row[] = [];
    const walk = (list: readonly TenantMenuNodeResponse[], depth: number): void => {
      for (const child of list) {
        const id = child.menuDefinitionId;
        if (!id || !this.matchesSearch(child, term)) {
          continue;
        }
        const children = child.children ?? [];
        out.push({ id, node: child, depth, hasChildren: children.length > 0 });
        walk(children, depth + 1);
      }
    };
    walk(node.children ?? [], 1);
    return out;
  }

  /** "on / total" for a card's own items (the card itself excluded). */
  cardOnCount(node: TenantMenuNodeResponse): number {
    return this.descendantIds(node).filter((id) => (this.mode() === 'roles' ? this.isMapped(id) : this.isEnabled(id))).length;
  }

  cardTotal(node: TenantMenuNodeResponse): number {
    return this.descendantIds(node).length;
  }

  /** Ids of a node's descendants (not the node itself). */
  private descendantIds(node: TenantMenuNodeResponse): string[] {
    const out: string[] = [];
    const walk = (list: readonly TenantMenuNodeResponse[]): void => {
      for (const child of list) {
        if (child.menuDefinitionId) {
          out.push(child.menuDefinitionId);
        }
        walk(child.children ?? []);
      }
    };
    walk(node.children ?? []);
    return out;
  }

  /** How many top-level menus are on (organisation) or shown (roles), for the index header. */
  sectionsOnCount(): number {
    return this.sections().filter((row) => (this.mode() === 'roles' ? this.isMapped(row.id) : this.isEnabled(row.id))).length;
  }

  /** "n items · m on" (organisation) or "m of n shown" (roles), for the rail. */
  sectionSummary(node: TenantMenuNodeResponse): string {
    const ids = this.descendantIds(node);
    if (ids.length === 0) {
      return node.route ? 'Single page' : 'Empty heading';
    }
    if (this.mode() === 'roles') {
      return `${ids.filter((id) => this.isMapped(id)).length} of ${ids.length} shown`;
    }
    return `${ids.length} item${ids.length === 1 ? '' : 's'} · ${ids.filter((id) => this.isEnabled(id)).length} on`;
  }

  /** 0–100, share of the section's items that are on (or mapped), for the rail meter. */
  sectionFill(node: TenantMenuNodeResponse): number {
    const ids = [node.menuDefinitionId ?? '', ...this.descendantIds(node)].filter(Boolean);
    if (ids.length === 0) {
      return 0;
    }
    const on = ids.filter((id) => (this.mode() === 'roles' ? this.isMapped(id) : this.isEnabled(id))).length;
    return Math.round((on / ids.length) * 100);
  }

  private matchesSearch(node: TenantMenuNodeResponse, term: string): boolean {
    if (!term) {
      return true;
    }
    const haystack = [
      node.resolvedName ?? '',
      node.catalogueName ?? '',
      node.code ?? '',
      node.route ?? '',
      node.requiredPermissionCode ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(term) || (node.children ?? []).some((child) => this.matchesSearch(child, term));
  }

  // ===========================================================================================
  // Lifecycle
  // ===========================================================================================

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    forkJoin({
      configuration: this.api.getMenuConfiguration(),
      roles: this.api.getRoleLookup(),
      permissions: this.api.getMenuPermissionCodes(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ configuration, roles, permissions }) => {
          const nodes = configuration.nodes ?? [];

          this.nodes.set(nodes);
          this.readTree(nodes);
          this.roles.set(roles);
          this.permissionOptions.set(permissions);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadFailed.set(true);
          this.errorMessage.set(apiErrorMessage(error, 'The menu could not be loaded.'));
        },
      });
  }

  /** One walk, keeping the four things the screen needs: switches, overrides, parents, lookup. */
  private readTree(nodes: readonly TenantMenuNodeResponse[]): void {
    const enabled: Record<string, boolean> = {};
    const overrides: Record<string, TenantMenuItemRequest> = {};
    const parents: Record<string, string> = {};
    const byId: Record<string, TenantMenuNodeResponse> = {};
    const expanded = { ...this.expanded() };

    const walk = (list: readonly TenantMenuNodeResponse[], parentId: string | null): void => {
      for (const node of list) {
        const id = node.menuDefinitionId;

        if (id) {
          enabled[id] = node.isEnabled === true;
          byId[id] = node;

          overrides[id] = {
            menuDefinitionId: id,
            isEnabled: node.isEnabled === true,
            displayNameOverride: node.displayNameOverride ?? null,
            iconOverride: node.iconOverride ?? null,
            displayOrderOverride: node.displayOrderOverride ?? null,
          };

          if (parentId) {
            parents[id] = parentId;
          }

          // New nodes open by default; anything already known stays as the person left it. A tree
          // that reopened wholly on every save would lose their place after every edit.
          if (expanded[id] === undefined) {
            expanded[id] = true;
          }
        }

        walk(node.children ?? [], id ?? parentId);
      }
    };

    walk(nodes, null);

    this.parents = parents;
    this.byId = byId;
    this.expanded.set(expanded);
    this.savedEnabled.set(enabled);
    this.enabled.set({ ...enabled });
    this.savedOverrides.set(overrides);
    this.overrides.set(structuredClone(overrides));
  }

  // ===========================================================================================
  // Tree interaction
  // ===========================================================================================

  toggleExpanded(id: string): void {
    this.expanded.update((current) => ({ ...current, [id]: !current[id] }));
  }

  isExpanded(id: string): boolean {
    return this.expanded()[id] === true;
  }

  /** Opens every node that has children. */
  expandAll(): void {
    const all: Record<string, boolean> = {};
    for (const [id, node] of Object.entries(this.byId)) {
      if ((node.children ?? []).length > 0) {
        all[id] = true;
      }
    }
    this.expanded.set(all);
  }

  /** Closes the whole tree back to its top level. */
  collapseAll(): void {
    const all: Record<string, boolean> = {};
    for (const id of Object.keys(this.byId)) {
      all[id] = false;
    }
    this.expanded.set(all);
  }

  /** How many direct children a node has, for the count beside its name. */
  childCount(node: TenantMenuNodeResponse): number {
    return (node.children ?? []).length;
  }

  // ---- Custom dropdowns (role picker, permission picker) — no native <select> -------------

  readonly roleDdOpen = signal(false);
  readonly permDdOpen = signal(false);
  readonly ddQuery = signal('');

  readonly filteredRoles = computed(() => {
    const q = this.ddQuery().trim().toLowerCase();
    return this.roles().filter((role) => !q || (role.name ?? '').toLowerCase().includes(q));
  });

  readonly filteredPermissionOptions = computed(() => {
    const q = this.ddQuery().trim().toLowerCase();
    return this.permissionOptions().filter(
      (option) => !q || option.name.toLowerCase().includes(q) || option.code.toLowerCase().includes(q),
    );
  });

  /** Permission options grouped by module, for the permission dropdown's section headers. */
  readonly groupedPermissionOptions = computed(() => {
    const groups = new Map<string, { code: string; name: string; moduleCode: string }[]>();
    for (const option of this.filteredPermissionOptions()) {
      const key = option.moduleCode || 'Other';
      const list = groups.get(key) ?? [];
      list.push(option);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, options]) => ({ module, options }));
  });

  readonly permissionLabel = computed(() => {
    const code = this.draft()?.permission;
    return code ? (this.permissionOptions().find((option) => option.code === code)?.name ?? code) : '';
  });

  toggleRoleDd(): void {
    this.ddQuery.set('');
    this.permDdOpen.set(false);
    this.roleDdOpen.update((open) => !open);
  }

  togglePermDd(): void {
    if (!this.draftIsOwned()) {
      return;
    }
    this.ddQuery.set('');
    this.roleDdOpen.set(false);
    this.permDdOpen.update((open) => !open);
  }

  pickRole(roleId: string): void {
    this.roleDdOpen.set(false);
    this.onRoleSelected(roleId);
  }

  pickPermission(code: string): void {
    this.permDdOpen.set(false);
    this.patchDraft({ permission: code });
  }

  stepOrder(delta: number): void {
    const current = Number(this.draft()?.order || 0) || 0;
    this.patchDraft({ order: String(Math.max(0, current + delta)) });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.roleDdOpen.set(false);
    this.permDdOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.roleDdOpen() || this.permDdOpen()) {
      this.roleDdOpen.set(false);
      this.permDdOpen.set(false);
      return;
    }
    if (this.confirmingDelete()) {
      this.cancelDelete();
      return;
    }
    if (this.draft()) {
      this.closeEditor();
    }
  }

  setMode(mode: Mode): void {
    this.mode.set(mode);
    this.errorMessage.set('');
  }

  // ---- Organisation switch ------------------------------------------------------------------

  isEnabled(id: string): boolean {
    return this.enabled()[id] === true;
  }

  /**
   * Switches a node, everything under it, and - when switching on - everything above it.
   *
   * DOWNWARDS, because enabling a child of a disabled parent produces a link nobody can reach,
   * and disabling a parent while leaving children on leaves those links reachable by URL with no
   * way to find them.
   *
   * UPWARDS, because the navigation is built by walking down from the top. A node whose parent is
   * off is not drawn greyed out; it is not drawn at all. Turning one on and leaving its section
   * off was a save that succeeded and showed nothing - the worst kind of failure, because the
   * screen agreed with the administrator and the product did not.
   */
  toggleEnabled(id: string): void {
    const next = !this.isEnabled(id);
    const updates: Record<string, boolean> = {};

    const cascadeDown = (node: TenantMenuNodeResponse | undefined): void => {
      const nodeId = node?.menuDefinitionId;

      if (!node || !nodeId) {
        return;
      }

      updates[nodeId] = next;

      for (const child of node.children ?? []) {
        cascadeDown(child);
      }
    };

    cascadeDown(this.byId[id]);

    if (next) {
      for (let parentId: string | undefined = this.parents[id]; parentId; parentId = this.parents[parentId]) {
        updates[parentId] = true;
      }
    }

    this.enabled.update((current) => ({ ...current, ...updates }));
  }

  // ---- Role mapping -------------------------------------------------------------------------

  onRoleSelected(roleId: string): void {
    this.selectedRoleId.set(roleId);
    this.mapped.set({});
    this.savedMapped.set({});
    this.roleNodesById = {};
    this.landingMenuId.set(null);
    this.errorMessage.set('');
    this.staleData.set(false);

    if (!roleId) {
      return;
    }

    this.loadingRoleMapping.set(true);

    // Both together: the mapping is what the screen renders and the role carries the version the
    // save has to quote. Separately would leave a window where one arrived and the other did not.
    forkJoin({
      mapping: this.api.getRoleMenuMapping(roleId),
      role: this.api.getRole(roleId),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ mapping, role }) => {
          const visible: Record<string, boolean> = {};

          const walk = (list: readonly RoleMenuNodeResponse[]): void => {
            for (const node of list) {
              if (node.menuDefinitionId) {
                visible[node.menuDefinitionId] = node.isVisible === true;
                this.roleNodesById[node.menuDefinitionId] = node;
              }

              walk(node.children ?? []);
            }
          };

          walk(mapping.nodes ?? []);

          this.savedMapped.set(visible);
          this.mapped.set({ ...visible });
          this.landingMenuId.set(mapping.landingMenuId ?? null);
          this.roleVersion.set(role.version ?? 0);
          this.loadingRoleMapping.set(false);
        },
        error: (error: unknown) => {
          this.loadingRoleMapping.set(false);
          this.errorMessage.set(apiErrorMessage(error, 'That mapping could not be loaded.'));
        },
      });
  }

  isMapped(id: string): boolean {
    return this.mapped()[id] === true;
  }

  /**
   * Whether the ROLE holds the permission this node needs.
   *
   * The server's judgement, not the screen's. A node whose permission the role lacks is shown
   * disabled rather than accepted and quietly ignored.
   */
  isPermitted(id: string): boolean {
    return this.roleNodesById[id]?.isPermitted !== false;
  }

  toggleMapped(id: string): void {
    if (!this.isPermitted(id)) {
      return;
    }

    const next = !this.isMapped(id);
    const updates: Record<string, boolean> = {};

    const cascadeDown = (node: TenantMenuNodeResponse | undefined): void => {
      const nodeId = node?.menuDefinitionId;

      if (!node || !nodeId) {
        return;
      }

      if (this.isPermitted(nodeId)) {
        updates[nodeId] = next;
      }

      for (const child of node.children ?? []) {
        cascadeDown(child);
      }
    };

    cascadeDown(this.byId[id]);

    if (next) {
      for (let parentId: string | undefined = this.parents[id]; parentId; parentId = this.parents[parentId]) {
        if (this.isPermitted(parentId)) {
          updates[parentId] = true;
        }
      }
    }

    this.mapped.update((current) => ({ ...current, ...updates }));
  }

  setLanding(id: string): void {
    this.landingMenuId.set(this.landingMenuId() === id ? null : id);
  }

  // ===========================================================================================
  // Saving
  // ===========================================================================================

  saveConfiguration(): void {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');
    this.staleData.set(false);

    const overrides = this.overrides();

    const items: TenantMenuItemRequest[] = Object.entries(this.enabled()).map(
      ([menuDefinitionId, isEnabled]) => ({
        ...(overrides[menuDefinitionId] ?? { menuDefinitionId }),
        menuDefinitionId,
        isEnabled,
      }),
    );

    this.api
      .configureMenu({ items })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (outcome) => {
          this.saving.set(false);
          this.savedEnabled.set({ ...this.enabled() });
          this.savedOverrides.set(structuredClone(this.overrides()));

          this.toast.show(
            'Menu updated',
            outcome.message ?? 'The navigation has been saved.',
            'success',
          );

          this.refreshOwnSidebar();
          this.load();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.reportSaveFailure(error, 'The menu could not be saved.');
        },
      });
  }

  saveMapping(): void {
    const roleId = this.selectedRoleId();

    if (!roleId || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');
    this.staleData.set(false);

    const visibleMenuIds = Object.entries(this.mapped())
      .filter(([, visible]) => visible)
      .map(([id]) => id);

    this.api
      .mapRoleMenus(roleId, {
        visibleMenuIds,
        expectedVersion: this.roleVersion(),
        landingMenuId: this.landingMenuId(),
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (outcome) => {
          this.saving.set(false);
          this.savedMapped.set({ ...this.mapped() });

          this.toast.show(
            'Mapping saved',
            outcome.message ?? `${this.selectedRoleName()} has been updated.`,
            'success',
          );

          this.refreshOwnSidebar();
          this.onRoleSelected(roleId);
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.reportSaveFailure(error, 'That mapping could not be saved.');
        },
      });
  }

  cancelConfiguration(): void {
    this.enabled.set({ ...this.savedEnabled() });
    this.overrides.set(structuredClone(this.savedOverrides()));
    this.errorMessage.set('');
    this.staleData.set(false);
  }

  cancelMapping(): void {
    this.mapped.set({ ...this.savedMapped() });
    this.errorMessage.set('');
    this.staleData.set(false);
  }

  /**
   * The person editing the menu is also using it.
   *
   * Their own sidebar should reflect what they just changed, immediately - otherwise the screen
   * says "saved" and the navigation beside it disagrees until the next full page load.
   */
  private refreshOwnSidebar(): void {
    this.navigation.load().pipe(takeUntil(this.destroy$)).subscribe({ error: () => undefined });
  }

  private reportSaveFailure(error: unknown, fallback: string): void {
    const code = apiErrorCode(error);

    // A concurrency failure is not a validation failure and must not be retried blindly: somebody
    // else changed the same thing, so the screen is out of date and the fix is to reload.
    if (code === 'CONCURRENCY_CONFLICT') {
      this.staleData.set(true);
      this.errorMessage.set(
        'Somebody else changed this while you were editing. Reload to see their version, then apply your change again.',
      );
      return;
    }

    this.errorMessage.set(apiErrorMessage(error, fallback));
  }

  // ===========================================================================================
  // The inspector: create, edit, delete, reorder
  // ===========================================================================================

  /** What a node is called for this organisation, which is what the tree shows. */
  resolvedName(node: TenantMenuNodeResponse): string {
    return node.resolvedName || node.catalogueName || node.code || 'Untitled';
  }

  levelLabel(level: MenuLevel | null | undefined): string {
    switch (level) {
      case 'menu':
        return 'Menu';
      case 'subMenu':
        return 'Submenu';
      case 'childSubMenu':
        return 'Child submenu';
      default:
        return '';
    }
  }

  /** The level a child of this node would occupy, or null when it can have none. */
  childLevel(level: MenuLevel | undefined): MenuLevel | null {
    if (level === 'menu') {
      return 'subMenu';
    }

    if (level === 'subMenu') {
      return 'childSubMenu';
    }

    // Three levels is the whole design: the theme has no styling for a fourth, so it is refused
    // here rather than rendered as something nobody drew.
    return null;
  }

  openEditor(node: TenantMenuNodeResponse): void {
    const id = node.menuDefinitionId;

    if (!id) {
      return;
    }

    const override = this.overrides()[id];

    this.draft.set({
      kind: 'edit',
      id,
      parentId: node.parentMenuDefinitionId ?? null,
      level: node.level ?? 'menu',
      code: node.code ?? '',
      name: override?.displayNameOverride ?? '',
      icon: override?.iconOverride ?? null,
      route: node.route ?? '',
      permission: node.requiredPermissionCode ?? '',
      order: override?.displayOrderOverride?.toString() ?? '',
      opensInNewTab: false,
    });
  }

  openCreator(parent: TenantMenuNodeResponse | null): void {
    const level: MenuLevel | null = parent ? this.childLevel(parent.level) : 'menu';

    if (!level) {
      return;
    }

    this.draft.set({
      kind: 'create',
      id: null,
      parentId: parent?.menuDefinitionId ?? null,
      level,
      code: '',
      name: '',
      icon: null,
      route: '',
      permission: '',
      order: '',
      opensInNewTab: false,
    });
  }

  closeEditor(): void {
    this.draft.set(null);
  }

  /**
   * Whatever an input handed back, as the string the draft holds.
   *
   * The Position field is `type="number"`, so ngModel gives a NUMBER - or null when the box is
   * cleared - into a field typed as string. `.trim()` on the way out then threw on a number and
   * took the whole save with it.
   */
  asText(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  patchDraft(patch: Partial<Draft>): void {
    const current = this.draft();

    if (current) {
      this.draft.set({ ...current, ...patch });
    }
  }

  /** The node behind the open editor, when there is one. */
  readonly draftNode = computed(() => {
    const id = this.draft()?.id;

    return id ? this.byId[id] : undefined;
  });

  /** The icon the open draft will show: its own choice, else the product's. */
  readonly draftIconClass = computed(() => {
    const draft = this.draft();
    if (!draft) return '';
    const icon = draft.icon ?? (this.draftIsOwned() ? null : this.draftNode()?.resolvedIcon ?? null);
    return icon ? this.navigation.iconClass(icon) : '';
  });

  /** Where the draft sits in the tree, for the breadcrumb in the panel header. */
  readonly draftParentName = computed(() => {
    const parentId = this.draft()?.parentId;
    const parent = parentId ? this.byId[parentId] : undefined;
    return parent ? this.pendingName(parent) : '';
  });

  /** The name shown in the panel header: the typed name, else the product's. */
  readonly draftDisplayName = computed(() => {
    const d = this.draft();
    if (!d) return '';
    return d.name.trim() || (d.kind === 'edit' ? (this.draftNode()?.catalogueName ?? '') : '') || 'Untitled item';
  });

  /** Whether the open draft edits a node this organisation owns outright. */
  readonly draftIsOwned = computed(() => {
    const draft = this.draft();

    if (!draft) {
      return false;
    }

    return draft.kind === 'create' || this.draftNode()?.isOrganisationOwned === true;
  });

  /**
   * Applies the inspector.
   *
   * TWO DIFFERENT WRITES BEHIND ONE BUTTON, and the difference is which rows the change belongs
   * in. A node this organisation owns is edited at source - its name, route, icon and permission
   * are its own. A platform node is not: the organisation gets an OVERRIDE row beside it, so the
   * product can still improve the original and every organisation that never overrode it follows
   * along. Presenting that as one Save is the point; making somebody understand which table they
   * are writing to is not.
   */
  applyEditor(): void {
    const draft = this.draft();

    if (!draft) {
      return;
    }

    if (draft.kind === 'create') {
      this.createNode(draft);
      return;
    }

    if (this.draftIsOwned()) {
      this.updateNode(draft);
      return;
    }

    this.applyOverride(draft);
  }

  /**
   * The per-organisation override path.
   *
   * IT SAVES. IT USED TO ONLY STAGE, and that was a defect dressed as a design: the button says
   * Apply, the panel closed, a toast said "select Save changes", and the change then sat in a
   * pending set behind a save bar at the bottom of a table long enough to need scrolling. People
   * renamed a menu, pressed Apply, watched nothing happen and reasonably reported it as broken -
   * because from where they sat it was.
   *
   * A DIALOG'S PRIMARY BUTTON COMMITS THE DIALOG. The staged model is right for the tree of
   * switches, where somebody flips fifteen things and saves once; it is wrong for a form about
   * one item that they have already had to open, fill in and confirm. So the override is merged
   * into the set and the whole set is sent, which is what the endpoint takes anyway - one PUT,
   * no new server work, and Apply means applied.
   *
   * THE PENDING SWITCHES RIDE ALONG, and that is deliberate rather than a side effect. The
   * payload is every item, so anything already toggled is committed by the same request. Sending
   * a stale set instead would silently undo those toggles - the save endpoint replaces rows, it
   * does not merge them.
   */
  private applyOverride(draft: Draft): void {
    const id = draft.id;

    if (!id) {
      return;
    }

    const order = draft.order.trim();
    const parsedOrder = order === '' ? null : Number(order);

    const merged: Record<string, TenantMenuItemRequest> = {
      ...this.overrides(),
      [id]: {
        ...(this.overrides()[id] ?? { menuDefinitionId: id }),
        menuDefinitionId: id,
        isEnabled: this.isEnabled(id),
        displayNameOverride: draft.name.trim() || null,
        iconOverride: draft.icon || null,
        displayOrderOverride:
          parsedOrder !== null && Number.isFinite(parsedOrder) ? parsedOrder : null,
      },
    };

    this.overrides.set(merged);

    const items: TenantMenuItemRequest[] = Object.entries(this.enabled()).map(
      ([menuDefinitionId, isEnabled]) => ({
        ...(merged[menuDefinitionId] ?? { menuDefinitionId }),
        menuDefinitionId,
        isEnabled,
      }),
    );

    this.savingNode.set(true);
    this.errorMessage.set('');

    this.api
      .configureMenu({ items })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingNode.set(false);
          this.draft.set(null);

          // Marked saved so the save bar does not then claim there are unsaved changes: this
          // request committed the switches as well as the override.
          this.savedEnabled.set({ ...this.enabled() });
          this.savedOverrides.set(structuredClone(merged));

          this.toast.show(
            'Menu item updated',
            `${draft.name.trim() || 'The item'} has been saved for this organisation.`,
            'success',
          );

          this.refreshOwnSidebar();
          this.load();
        },
        error: (error: unknown) => {
          this.savingNode.set(false);

          // The panel STAYS OPEN on a failure, holding what they typed. Closing it would lose
          // the edit and leave them to work out what had and had not been kept.
          this.reportSaveFailure(error, 'That change could not be saved.');
        },
      });
  }

  private createNode(draft: Draft): void {
    const request: CreateMenuDefinitionRequest = {
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      level: draft.level,
      moduleCode: 'IAM',
      parentMenuId: draft.parentId,
      route: draft.route.trim() || null,
      icon: draft.icon || null,
      requiredPermissionCode: draft.permission || null,
      displayOrder: Number(draft.order.trim()) || 0,
      isPlatformOnly: false,
      isEnabledByDefault: true,
      isMandatory: false,
      opensInNewTab: draft.opensInNewTab,
    };

    this.savingNode.set(true);

    this.api
      .createMenuDefinition(request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingNode.set(false);
          this.draft.set(null);
          this.toast.show('Menu item added', `${request.name} is now in the menu.`, 'success');
          this.refreshOwnSidebar();
          this.load();
        },
        error: (error: unknown) => {
          this.savingNode.set(false);
          this.errorMessage.set(apiErrorMessage(error, 'That menu item could not be added.'));
        },
      });
  }

  private updateNode(draft: Draft): void {
    const node = this.draftNode();

    if (!draft.id || !node) {
      return;
    }

    const order = draft.order.trim();

    const request: UpdateMenuDefinitionRequest = {
      expectedVersion: node.version ?? 0,
      name: draft.name.trim() || node.catalogueName || '',
      route: draft.route.trim() || null,
      icon: draft.icon || null,
      requiredPermissionCode: draft.permission || null,
      displayOrder: order === '' ? null : Number(order),
      opensInNewTab: draft.opensInNewTab,
    };

    this.savingNode.set(true);

    this.api
      .updateMenuDefinition(draft.id, request)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingNode.set(false);
          this.draft.set(null);
          this.toast.show('Menu item updated', 'The change has been saved.', 'success');
          this.refreshOwnSidebar();
          this.load();
        },
        error: (error: unknown) => {
          this.savingNode.set(false);
          this.reportSaveFailure(error, 'That menu item could not be saved.');
        },
      });
  }

  readonly confirmingDelete = signal<string | null>(null);

  askDelete(id: string): void {
    this.confirmingDelete.set(id);
  }

  cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  confirmDelete(): void {
    const id = this.confirmingDelete();
    const node = id ? this.byId[id] : undefined;

    if (!id || !node) {
      return;
    }

    this.savingNode.set(true);

    this.api
      .deleteMenuDefinition(id, node.version ?? 0)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingNode.set(false);
          this.confirmingDelete.set(null);
          this.draft.set(null);
          this.toast.show('Menu item removed', `${this.resolvedName(node)} is gone.`, 'success');
          this.refreshOwnSidebar();
          this.load();
        },
        error: (error: unknown) => {
          this.savingNode.set(false);
          this.confirmingDelete.set(null);
          this.errorMessage.set(apiErrorMessage(error, 'That menu item could not be removed.'));
        },
      });
  }

  // ---- Reordering ---------------------------------------------------------------------------

  /**
   * Moves a node past its neighbour.
   *
   * IT WRITES AN ORDER, NOT A POSITION. There is no "index" to store - the tree is sorted by
   * DisplayOrder - so moving up means taking a number below the neighbour's. Both nodes are
   * rewritten rather than only the one that moved, because two siblings sharing a number sort by
   * name and the move would appear not to have happened.
   *
   * ON THE ORGANISATION'S OWN OVERRIDE ROW, never on the catalogue: reordering is a per
   * organisation preference and must not reach anybody else's sidebar.
   */
  move(id: string, direction: -1 | 1): void {
    const parentId = this.parents[id] ?? null;
    const siblings = (parentId ? this.byId[parentId]?.children : this.nodes()) ?? [];

    const ordered = [...siblings].sort(
      (a, b) => this.effectiveOrder(a) - this.effectiveOrder(b),
    );

    const index = ordered.findIndex((node) => node.menuDefinitionId === id);
    const swapWith = index + direction;

    if (index < 0 || swapWith < 0 || swapWith >= ordered.length) {
      return;
    }

    const a = ordered[index];
    const b = ordered[swapWith];
    const aId = a.menuDefinitionId;
    const bId = b.menuDefinitionId;

    if (!aId || !bId) {
      return;
    }

    const aOrder = this.effectiveOrder(a);
    const bOrder = this.effectiveOrder(b);

    this.overrides.update((current) => ({
      ...current,
      [aId]: {
        ...(current[aId] ?? { menuDefinitionId: aId }),
        menuDefinitionId: aId,
        isEnabled: this.isEnabled(aId),
        displayOrderOverride: bOrder,
      },
      [bId]: {
        ...(current[bId] ?? { menuDefinitionId: bId }),
        menuDefinitionId: bId,
        isEnabled: this.isEnabled(bId),
        displayOrderOverride: aOrder,
      },
    }));

    // Re-sorted in place so the row visibly moves; the tree itself is only rebuilt on save.
    this.nodes.set(this.sortTree(this.nodes()));
  }

  private effectiveOrder(node: TenantMenuNodeResponse): number {
    const id = node.menuDefinitionId;
    const override = id ? this.overrides()[id]?.displayOrderOverride : null;

    return override ?? node.resolvedOrder ?? 0;
  }

  private sortTree(nodes: readonly TenantMenuNodeResponse[]): TenantMenuNodeResponse[] {
    return [...nodes]
      .sort((a, b) => this.effectiveOrder(a) - this.effectiveOrder(b))
      .map((node) => ({ ...node, children: this.sortTree(node.children ?? []) }));
  }

  // ---- Presentation -------------------------------------------------------------------------

  /**
   * The icon for a row, resolved BY THE SAME CODE THE SIDEBAR USES.
   *
   * IT USED TO PREFIX `ri-` ITSELF, and that is how this screen and the sidebar came to disagree
   * about the same stored value: a raw icon name from the picker rendered here and fell back to a
   * dot there, because the sidebar's resolver knew only the fifty neutral names the catalogue
   * seeds. A configuration screen that shows something other than what it is configuring is
   * worse than one that shows nothing.
   *
   * There is now one resolver, on NavigationService, and both callers ask it.
   */
  iconClassFor(node: TenantMenuNodeResponse): string {
    const id = node.menuDefinitionId;
    const pending = id ? this.overrides()[id]?.iconOverride : null;
    const icon = pending ?? node.resolvedIcon ?? '';

    return icon ? this.navigation.iconClass(icon) : '';
  }

  /** The label the tree shows, including an unsaved rename. */
  pendingName(node: TenantMenuNodeResponse): string {
    const id = node.menuDefinitionId;
    const pending = id ? this.overrides()[id]?.displayNameOverride : null;

    return pending || this.resolvedName(node);
  }

  hasOverride(node: TenantMenuNodeResponse): boolean {
    const id = node.menuDefinitionId;

    if (!id) {
      return false;
    }

    const override = this.overrides()[id];

    return (
      !!override?.displayNameOverride ||
      !!override?.iconOverride ||
      override?.displayOrderOverride !== null && override?.displayOrderOverride !== undefined
    );
  }

  trackRow(_index: number, row: Row): string {
    return row.id;
  }
}