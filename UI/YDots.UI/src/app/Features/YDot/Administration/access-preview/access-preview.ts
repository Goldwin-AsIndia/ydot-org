import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ToastService } from '../../../../Shared/services/toast.service';
import { UserDirectoryApiService } from '../../../../Service/user-directory-api.service';
import { UserSearchFilter } from '../../../../Shared/models/user-directory.model';
import {
  PermissionSummaryResponse,
  UserAccessPreviewResponse,
} from '../../../../Shared/models/iam-contract.model';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

/** One person in the picker. Lean on purpose: the picker is a search, not a directory. */
interface PersonOption {
  id: string;
  reference: string;
  displayName: string;
  orgUnit: string;
  roleSummary: string;
}

/**
 * A module's worth of permissions, ready to render.
 *
 * The API answers grouped by module AND group; the screen groups by module and shows the groups
 * as rows inside it, because "what can this person do in Payments" is the question somebody
 * actually asks and a flat list of two hundred codes cannot answer it.
 */
interface ModuleSection {
  moduleCode: string;
  groups: { groupCode: string; permissions: PermissionSummaryResponse[] }[];
  grantedCount: number;
  sensitiveCount: number;
}

/** The seven verbs the matrix shows as columns. */
type ActionKey = 'view' | 'create' | 'edit' | 'manage' | 'approve' | 'export' | 'delete';

/**
 * One matrix cell.
 * - `on`   granted
 * - `sens` granted, and at least one granted code is sensitive
 * - `off`  the module has codes for this verb, none granted
 * - `na`   the module has no code for this verb
 */
type CellState = 'on' | 'sens' | 'off' | 'na';

interface MatrixCell {
  state: CellState;
  granted: number;
  total: number;
}

/** A module as one matrix row, with every one of its codes kept for the drill-down. */
interface MatrixRow {
  moduleCode: string;
  cells: Record<ActionKey, MatrixCell>;
  permissions: PermissionSummaryResponse[];
  grantedCount: number;
  sensitiveCount: number;
  /** Codes whose verb is not one of the seven columns; they still show in the drill-down. */
  otherCount: number;
}

/**
 * IAM-USR-03 — Access preview.
 *
 * WHAT IT ANSWERS, AND WHY IT IS NOT THE REVIEW SCREEN. "What can this person do right now?" is
 * a question with one answer and no workflow attached: no approval, no decision, nothing to
 * submit. The recertification campaign asks a different question - "should they still have it?" -
 * and needs a reviewer, a due date and a decision. This route pointed at that campaign screen,
 * so the menu entry existed, opened something real, and answered the wrong question.
 *
 * IT READS THE SAME SERVICE THE TOKEN IS BUILT FROM. `GET /users/{id}/access` resolves through
 * `EffectiveAccessService`, which is also what stamps the sign-in token - so what this screen
 * shows and what the person can actually do cannot drift. That was the stated reason for putting
 * the resolution in one service, and it is only worth anything if the screen uses it.
 *
 * THE UNION IS THE POINT. Somebody holding two roles gets the union of both, and the interesting
 * cases are exactly the ones a role list does not reveal: a permission reached through two roles,
 * a sensitive code nobody realised was in the second role, a data scope that widens everything.
 * So the screen leads with the totals and lets the detail be opened per module.
 */
@Component({
  selector: 'app-access-preview',
  standalone: true,
  imports: [PageHeader, CommonModule, FormsModule, RouterModule],
  templateUrl: './access-preview.html',
  styleUrl: './access-preview.css',
})
export class AccessPreviewComponent {
  private readonly api = inject(UserDirectoryApiService);
  private readonly toast = inject(ToastService);

  // ---- The picker ---------------------------------------------------------------------------

  readonly people = signal<PersonOption[]>([]);
  readonly peopleLoading = signal(true);
  readonly peopleError = signal(false);
  readonly personSearch = signal('');
  readonly selectedPersonId = signal('');
  readonly peoplePage = signal(1);
  readonly peoplePageSize = 10;

  readonly filteredPeople = computed(() => {
    const term = this.personSearch().trim().toLowerCase();
    const all = this.people();

    if (!term) {
      return all;
    }

    return all.filter((person) =>
      person.displayName.toLowerCase().includes(term)
      || person.reference.toLowerCase().includes(term)
      || person.orgUnit.toLowerCase().includes(term));
  });

  readonly selectedPerson = computed(() =>
    this.people().find((person) => person.id === this.selectedPersonId()) ?? null);

  readonly peoplePageCount = computed(() =>
    Math.max(1, Math.ceil(this.filteredPeople().length / this.peoplePageSize)));

  readonly pagedPeople = computed(() => {
    const page = Math.min(this.peoplePage(), this.peoplePageCount());
    const start = (page - 1) * this.peoplePageSize;
    return this.filteredPeople().slice(start, start + this.peoplePageSize);
  });

  readonly peopleRangeStart = computed(() =>
    this.filteredPeople().length === 0 ? 0 : (Math.min(this.peoplePage(), this.peoplePageCount()) - 1) * this.peoplePageSize + 1);

  readonly peopleRangeEnd = computed(() =>
    Math.min(Math.min(this.peoplePage(), this.peoplePageCount()) * this.peoplePageSize, this.filteredPeople().length));

  // ---- The answer ---------------------------------------------------------------------------

  readonly access = signal<UserAccessPreviewResponse | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal(false);
  readonly errorMessage = signal('');

  /** Which module panels are open. Everything starts closed: the totals are the headline. */
  readonly openModules = signal<Set<string>>(new Set());

  /** Hide the codes this person does NOT have, which is the default and the useful view. */
  readonly grantedOnly = signal(true);

  /** Show only the codes that carry an enhanced audit row. */
  readonly sensitiveOnly = signal(false);

  constructor() {
    this.loadPeople();
  }

  // =============================================================================================
  // Loading
  // =============================================================================================

  private loadPeople(): void {
    this.peopleLoading.set(true);
    this.peopleError.set(false);

    const filter: UserSearchFilter = { pageIndex: 1, pageSize: 200 };

    this.api.getDirectory(filter).subscribe({
      next: (response) => {
        this.people.set((response.users.items ?? []).map((user) => ({
          id: user.id ?? '',
          reference: user.code ?? '',
          displayName: user.displayName ?? '',
          orgUnit: user.organisationUnitName ?? user.departmentName ?? '',
          roleSummary: (user.roleNames ?? []).join(', ') || 'No role',
        })));

        this.peopleLoading.set(false);

        // Open on the first person so the screen never starts empty.
        const first = this.people()[0];
        if (first && !this.selectedPersonId()) {
          this.selectPerson(first.id);
        }
      },
      error: () => {
        this.peopleLoading.set(false);
        this.peopleError.set(true);
        this.toast.show('Error', 'The user directory could not be loaded.', 'error');
      },
    });
  }

  selectPerson(id: string): void {
    if (!id || id === this.selectedPersonId()) {
      return;
    }

    this.selectedPersonId.set(id);
    this.loadAccess(id);
  }

  updatePersonSearch(value: string): void {
    this.personSearch.set(value);
    this.peoplePage.set(1);
  }

  setPeoplePage(page: number): void {
    this.peoplePage.set(Math.min(Math.max(1, page), this.peoplePageCount()));
  }

  private loadAccess(id: string): void {
    this.loading.set(true);
    this.loadError.set(false);
    this.access.set(null);
    this.openModules.set(new Set());

    this.api.getUserAccess(id).subscribe({
      next: (result) => {
        this.access.set(result);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.loadError.set(true);
        this.errorMessage.set(error.message);
        this.toast.show('Error', 'That person’s access could not be resolved.', 'error');
      },
    });
  }

  retry(): void {
    const id = this.selectedPersonId();

    if (id) {
      this.loadAccess(id);
    } else {
      this.loadPeople();
    }
  }

  clearSelection(): void {
    this.selectedPersonId.set('');
    this.access.set(null);
    this.loadError.set(false);
  }

  // =============================================================================================
  // Shaping the answer
  // =============================================================================================

  /** The roles the grant actually flows from. An expired assignment is shown, and marked. */
  readonly roles = computed(() => this.access()?.roles ?? []);

  readonly dataScopes = computed(() => this.access()?.dataScopes ?? []);

  readonly directClaims = computed(() => this.access()?.directClaims ?? []);

  /**
   * Whether this person's access comes from a flag rather than from grants.
   *
   * WORTH ITS OWN BANNER. A SuperAdmin or a role marked "grants all" holds every code without a
   * single permission row behind it, so the module list below would look thin and mislead
   * somebody into thinking they had found the whole picture.
   */
  readonly isBlanketGrant = computed(() =>
    this.access()?.isSuperAdmin === true || this.access()?.hasAllTenantPermissions === true);

  readonly modules = computed<ModuleSection[]>(() => {
    const groups = this.access()?.permissionGroups ?? [];
    const byModule = new Map<string, ModuleSection>();

    for (const group of groups) {
      const moduleCode = group.moduleCode ?? 'OTHER';
      const permissions = this.applyFilters(group.permissions ?? []);

      if (permissions.length === 0) {
        continue;
      }

      const section = byModule.get(moduleCode) ?? {
        moduleCode,
        groups: [],
        grantedCount: 0,
        sensitiveCount: 0,
      };

      section.groups.push({ groupCode: group.groupCode ?? 'General', permissions });
      section.grantedCount += permissions.filter((item) => item.isGranted === true).length;
      section.sensitiveCount += permissions.filter(
        (item) => item.isSensitive === true && item.isGranted === true).length;

      byModule.set(moduleCode, section);
    }

    return [...byModule.values()].sort((a, b) => a.moduleCode.localeCompare(b.moduleCode));
  });

  // ---- The matrix: modules down, verbs across --------------------------------------------------

  readonly actionColumns: { key: ActionKey; label: string }[] = [
    { key: 'view', label: 'View' },
    { key: 'create', label: 'Create' },
    { key: 'edit', label: 'Edit' },
    { key: 'manage', label: 'Manage' },
    { key: 'approve', label: 'Approve' },
    { key: 'export', label: 'Export' },
    { key: 'delete', label: 'Delete' },
  ];

  /**
   * Built from every code, not the filtered list: "available, not granted" is only visible when the
   * codes the person does NOT hold are counted too.
   */
  readonly matrix = computed<MatrixRow[]>(() => {
    const groups = this.access()?.permissionGroups ?? [];
    const byModule = new Map<string, MatrixRow>();

    for (const group of groups) {
      const moduleCode = group.moduleCode ?? 'OTHER';
      const row = byModule.get(moduleCode) ?? this.emptyRow(moduleCode);

      for (const permission of group.permissions ?? []) {
        row.permissions.push(permission);
        const granted = permission.isGranted === true;
        if (granted) { row.grantedCount++; }
        if (granted && permission.isSensitive === true) { row.sensitiveCount++; }

        const action = this.actionOf(permission);
        if (!action) { row.otherCount++; continue; }

        const cell = row.cells[action];
        cell.total++;
        if (granted) {
          cell.granted++;
          cell.state = permission.isSensitive === true || cell.state === 'sens' ? 'sens' : 'on';
        } else if (cell.state === 'na') {
          cell.state = 'off';
        }
      }

      byModule.set(moduleCode, row);
    }

    for (const row of byModule.values()) {
      row.permissions.sort((a, b) => Number(b.isGranted === true) - Number(a.isGranted === true)
        || (a.name ?? a.code ?? '').localeCompare(b.name ?? b.code ?? ''));
    }

    return [...byModule.values()].sort((a, b) => this.moduleLabel(a.moduleCode).localeCompare(this.moduleLabel(b.moduleCode)));
  });

  cell(row: MatrixRow, key: ActionKey): MatrixCell {
    return row.cells[key] ?? { state: 'na', granted: 0, total: 0 };
  }

  cellTitle(row: MatrixRow, column: { key: ActionKey; label: string }): string {
    const c = this.cell(row, column.key);
    const where = `${this.moduleLabel(row.moduleCode)} · ${column.label}`;
    if (c.state === 'na') { return `${where}: not applicable`; }
    if (c.state === 'off') { return `${where}: available, not granted (${c.total})`; }
    return `${where}: ${c.granted} of ${c.total} granted${c.state === 'sens' ? ' · includes sensitive' : ''}`;
  }

  private emptyRow(moduleCode: string): MatrixRow {
    const blank = (): MatrixCell => ({ state: 'na', granted: 0, total: 0 });
    return {
      moduleCode,
      cells: { view: blank(), create: blank(), edit: blank(), manage: blank(), approve: blank(), export: blank(), delete: blank() },
      permissions: [],
      grantedCount: 0,
      sensitiveCount: 0,
      otherCount: 0,
    };
  }

  /** Reads the verb from the code's last segment first (e.g. `CAM.CAMPAIGN.EXPORT`), then the whole code and name. */
  private actionOf(permission: PermissionSummaryResponse): ActionKey | null {
    const code = (permission.code ?? '').toLowerCase();
    const last = code.split(/[.:_\-\/\s]+/).filter(Boolean).pop() ?? '';
    const rules: [ActionKey, RegExp][] = [
      ['delete', /delete|remove|purge|erase/],
      ['export', /export|download|extract/],
      ['approve', /approve|reject|decide|decision|authori[sz]e|sign.?off/],
      ['manage', /manage|admin|configure|config|assign|grant|revoke|setting/],
      ['edit', /edit|update|modify|change|write|amend/],
      ['create', /create|add|new|submit|raise|insert|register/],
      ['view', /view|read|list|get|search|see|browse|show/],
    ];
    for (const source of [last, code, (permission.name ?? '').toLowerCase()]) {
      if (!source) { continue; }
      for (const [key, pattern] of rules) {
        if (pattern.test(source)) { return key; }
      }
    }
    return null;
  }

  expandAllRows(): void {
    this.openModules.set(new Set(this.matrix().map((row) => row.moduleCode)));
  }

  initials(name?: string | null): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) { return '?'; }
    const first = parts[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1] ?? '' : '';
    return (first.charAt(0) + last.charAt(0)).toUpperCase();
  }

  /** First role in the summary, for the one-line subtitle under a name. */
  firstRole(person: PersonOption): string {
    return person.roleSummary.split(',')[0]?.trim() || 'No role';
  }

  private applyFilters(permissions: PermissionSummaryResponse[]): PermissionSummaryResponse[] {
    let result = permissions;

    if (this.grantedOnly()) {
      result = result.filter((item) => item.isGranted === true);
    }

    if (this.sensitiveOnly()) {
      result = result.filter((item) => item.isSensitive === true);
    }

    return result;
  }

  toggleModule(moduleCode: string): void {
    const open = new Set(this.openModules());

    if (open.has(moduleCode)) {
      open.delete(moduleCode);
    } else {
      open.add(moduleCode);
    }

    this.openModules.set(open);
  }

  isModuleOpen(moduleCode: string): boolean {
    return this.openModules().has(moduleCode);
  }

  expandAll(): void {
    this.openModules.set(new Set(this.modules().map((item) => item.moduleCode)));
  }

  collapseAll(): void {
    this.openModules.set(new Set());
  }

  // =============================================================================================
  // Display helpers
  // =============================================================================================

  /**
   * Where a permission came from.
   *
   * THE MOST USEFUL COLUMN ON THE SCREEN, and the reason it is a preview rather than a role list.
   * "Payments: refund" tells somebody what a person can do; "granted via APPROVER" tells them
   * which role to change to stop it.
   */
  grantedViaLabel(permission: PermissionSummaryResponse): string {
    return permission.grantedVia?.trim() || 'Role';
  }

  moduleLabel(moduleCode: string): string {
    const names: Record<string, string> = {
      IAM: 'Users and access',
      GM: 'Master data',
      CAM: 'Campaigns',
      DON: 'Donors',
      PAY: 'Donations and payments',
      PLATFORM: 'Platform',
    };

    return names[moduleCode] ?? moduleCode;
  }

  moduleIcon(moduleCode: string): string {
    const icons: Record<string, string> = {
      IAM: 'ri-shield-user-line',
      GM: 'ri-database-2-line',
      CAM: 'ri-megaphone-line',
      DON: 'ri-heart-line',
      PAY: 'ri-bank-card-line',
      PLATFORM: 'ri-building-line',
    };

    return icons[moduleCode] ?? 'ri-apps-line';
  }

  scopeLabel(scopeType?: string | null): string {
    const labels: Record<string, string> = {
      organisation: 'Whole organisation',
      geography: 'A place',
      campaign: 'A campaign',
      warehouse: 'A warehouse',
      queue: 'A work queue',
      assignment: 'What they are assigned',
      explicitRecord: 'Named records only',
    };

    return labels[scopeType ?? ''] ?? scopeType ?? '—';
  }

  formatDate(value?: string | null): string {
    if (!value) {
      return '—';
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}