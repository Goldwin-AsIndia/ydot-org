import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, takeUntil } from 'rxjs';
import { IamAdminApiService } from '../../../../Service/iam-admin-api.service';
import {
  OutcomeResponse,
  apiErrorMessage,
} from '../../../../Shared/models/api-response.model';
import {
  DepartmentResponse,
  OrganisationUnitResponse,
} from '../../../../Shared/models/iam-contract.model';
import { ApiEnumOption, enumLabel } from '../../../../Shared/models/enum-option.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { EnumOptionsService } from '../../../../Shared/services/enum-options.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { DepartmentFormComponent } from '../department-form/department-form';

type Mode = 'departments' | 'units';

/**
 * Departments and organisation units.
 *
 * TWO SEPARATE HIERARCHIES, AND THAT IS DELIBERATE. A department is what somebody DOES —
 * Fundraising, Finance. A unit is where they SIT — Head office, Southern region. Most
 * organisations need both, and collapsing them into one tree forces a choice that has to be
 * undone later: a fundraiser in the southern office belongs to Fundraising AND to Southern, and
 * neither is a child of the other.
 *
 * The same screen serves both because the operations are identical — list, add, edit, retire —
 * and two near-identical components would drift within a month. Which one is being managed comes
 * from the route.
 *
 * WHY NOTHING IS DELETED WHILE IT IS IN USE
 * -----------------------------------------
 * A department with people in it, or with children beneath it, is refused by the server rather
 * than orphaning either. The member and child counts are shown on every row precisely so that
 * refusal is never a surprise — and setting one to inactive is offered as what was almost
 * certainly meant: retire it, keep the history.
 */
@Component({
  selector: 'app-organisation-structure',
  standalone: true,
  imports: [CommonModule, DepartmentFormComponent],
  templateUrl: './organisation-structure.html',
  styleUrl: './organisation-structure.css',
})
export class OrganisationStructureComponent implements OnInit, OnDestroy {
  private readonly api = inject(IamAdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tokens = inject(AuthTokenService);
  private readonly toast = inject(ToastService);
  private readonly enums = inject(EnumOptionsService);

  /** The server's record statuses, values in API case. The Status select offers these. */
  readonly statusOptions = signal<ApiEnumOption[]>([]);

  private readonly destroy$ = new Subject<void>();

  readonly mode = signal<Mode>('departments');

  readonly departments = signal<DepartmentResponse[]>([]);
  readonly units = signal<OrganisationUnitResponse[]>([]);

  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal('');

  readonly confirmingDelete = signal<string | null>(null);

  // =========================================================================================
  // Derived
  // =========================================================================================

  readonly isDepartments = computed(() => this.mode() === 'departments');

  readonly title = computed(() => (this.isDepartments() ? 'Departments' : 'Offices and regions'));

  readonly subtitle = computed(() =>
    this.isDepartments()
      ? 'What people do: the functions this organisation is organised into.'
      : 'Where people sit: the offices, branches and regions this organisation operates from.');

  readonly canManage = computed(() =>
    this.tokens.hasPermission(
      this.isDepartments()
        ? 'iam.organisation.manage-departments'
        : 'iam.organisation.manage-units'));

  /** The rows, sorted so parents come before their children and the tree reads top to bottom. */
  readonly rows = computed(() =>
    this.isDepartments()
      ? this.sortTree(this.departments(), (item) => item.parentDepartmentId)
      : this.sortTree(this.units(), (item) => item.parentUnitId));

  /** The figures in the header strip, read from the rows already loaded - no extra request. */
  readonly summary = computed(() => {
    const rows = this.rows();
    const active = rows.filter((row) => row.status === 'active').length;
    return {
      total: rows.length,
      active,
      inactive: rows.length - active,
      topLevel: rows.filter((row) => row.depth === 0).length,
      people: rows.reduce((sum, row) => sum + this.memberCount(row), 0),
      withoutHead: this.isDepartments()
        ? rows.filter((row) => !(row as unknown as DepartmentResponse).headDisplayName).length
        : 0,
    };
  });

  // =========================================================================================
  // Lifecycle
  // =========================================================================================

  ngOnInit(): void {
    // The route decides which hierarchy this is. Reading it from the data rather than the URL
    // text means the two routes can be renamed without touching the component.
    const mode = this.route.snapshot.data['mode'] as Mode | undefined;
    this.mode.set(mode ?? 'departments');

    this.load();

    // The Status select used to offer a literal Active/Inactive pair; the server also has Draft
    // and Archived, and a record carrying either opened with a blank select.
    this.enums
      .options('recordStatuses')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (options) => this.statusOptions.set(options),
        error: () => this.statusOptions.set([]),
      });
  }

  /** A status code as the server labels it. */
  statusLabel(status: string | null | undefined): string {
    return enumLabel(this.statusOptions(), status);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    const request: Observable<DepartmentResponse[] | OrganisationUnitResponse[]> =
      this.isDepartments() ? this.api.getDepartments() : this.api.getUnits();

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: (items) => {
        if (this.isDepartments()) {
          this.departments.set(items as DepartmentResponse[]);
        } else {
          this.units.set(items as OrganisationUnitResponse[]);
        }

        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadFailed.set(true);
        this.errorMessage.set(apiErrorMessage(error, 'That could not be loaded.'));
      },
    });
  }

  // =========================================================================================
  // Adding and editing - a department in a pop-up over this list (DepartmentFormComponent),
  // an office on a page of its own (OfficeFormComponent).
  // =========================================================================================

  /** The row open in the read-only View pop-up, or null. */
  readonly viewing = signal<(DepartmentResponse | OrganisationUnitResponse) | null>(null);

  @HostListener('document:keydown.escape')
  protected closeView(): void {
    this.viewing.set(null);
  }

  /** An office's address on one line for the View pop-up; empty parts are skipped. */
  addressLine(row: DepartmentResponse | OrganisationUnitResponse): string {
    const unit = row as OrganisationUnitResponse;
    return [unit.addressLine1, unit.addressLine2, unit.city, unit.state, unit.postalCode, unit.country]
      .filter((part) => !!part && `${part}`.trim())
      .join(', ');
  }

  /** The department pop-up: undefined when closed, null when adding, an id when editing. */
  readonly departmentDialog = signal<string | null | undefined>(undefined);

  startAdding(): void {
    if (this.isDepartments()) {
      this.departmentDialog.set(null);
    } else {
      this.router.navigateByUrl('/app/administration/organisation/units/new');
    }
  }

  startEditing(row: DepartmentResponse | OrganisationUnitResponse): void {
    if (!row.id) {
      return;
    }
    if (this.isDepartments()) {
      this.departmentDialog.set(row.id);
    } else {
      this.router.navigate(['/app/administration/organisation/units', row.id, 'edit']);
    }
  }

  closeDepartmentDialog(): void {
    this.departmentDialog.set(undefined);
  }

  onDepartmentSaved(): void {
    this.departmentDialog.set(undefined);
    this.load();
  }

  // =========================================================================================
  // Removing
  // =========================================================================================

  confirmDelete(row: DepartmentResponse | OrganisationUnitResponse): void {
    this.confirmingDelete.set(row.id ?? null);
    this.errorMessage.set('');
  }

  cancelDelete(): void {
    this.confirmingDelete.set(null);
  }

  /**
   * Removes a department or unit.
   *
   * Refused by the server while anybody is in it or anything sits under it. The counts on each
   * row are shown so that refusal is never a surprise, and the message that comes back names the
   * exact obstacle rather than saying "cannot delete".
   */
  delete(row: DepartmentResponse | OrganisationUnitResponse): void {
    if (!row.id || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');

    const request = { expectedVersion: row.version ?? 0 };

    const call: Observable<OutcomeResponse> = this.isDepartments()
      ? this.api.deleteDepartment(row.id, request)
      : this.api.deleteUnit(row.id, request);

    call.pipe(takeUntil(this.destroy$)).subscribe({
      next: (outcome) => {
        this.saving.set(false);
        this.confirmingDelete.set(null);
        this.toast.show('Removed', outcome.message ?? `${row.name} has been removed.`, 'success');
        this.load();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.confirmingDelete.set(null);
        this.errorMessage.set(apiErrorMessage(error, 'That could not be removed.'));
      },
    });
  }

  // =========================================================================================
  // Display helpers
  // =========================================================================================

  /**
   * Orders a flat list so each parent is immediately followed by its children.
   *
   * The server returns them flat with a parent id, which is the right shape to store. Turning it
   * into reading order here rather than nesting it in the template keeps the row markup to one
   * shape at any depth.
   */
  private sortTree<T extends { id?: string; name?: string | null; displayOrder?: number }>(
    items: T[],
    parentOf: (item: T) => string | null | undefined,
  ): (T & { depth: number })[] {
    const ordered: (T & { depth: number })[] = [];

    const append = (parentId: string | null, depth: number): void => {
      // A guard against a cycle: the server refuses to create one, but a screen that hangs is a
      // far worse failure than one that renders a node in the wrong place.
      if (depth > 8) {
        return;
      }

      items
        .filter((item) => (parentOf(item) ?? null) === parentId)
        .sort((left, right) =>
          (left.displayOrder ?? 0) - (right.displayOrder ?? 0)
          || (left.name ?? '').localeCompare(right.name ?? ''))
        .forEach((item) => {
          ordered.push({ ...item, depth });
          append(item.id ?? null, depth + 1);
        });
    };

    append(null, 0);

    // Anything whose parent is missing from the list would otherwise vanish. Appending it flat is
    // better than dropping a real record because its parent was retired.
    const seen = new Set(ordered.map((item) => item.id));
    items.filter((item) => !seen.has(item.id)).forEach((item) => ordered.push({ ...item, depth: 0 }));

    return ordered;
  }

  indent(depth: number): string {
    return `${depth * 1.5}rem`;
  }

  /** Up to two letters for the monogram beside a name: the first letter of the first two words. */
  initials(name: string | null | undefined): string {
    const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || '?';
  }

  statusClass(status: string | undefined): string {
    return status === 'active'
      ? 'bg-success-subtle text-success'
      : 'bg-secondary-subtle text-secondary';
  }

  memberCount(row: DepartmentResponse | OrganisationUnitResponse): number {
    return row.memberCount ?? 0;
  }

  childCount(row: DepartmentResponse | OrganisationUnitResponse): number {
    return row.childCount ?? 0;
  }

  /** Whether removal will be refused, so the button can say so before it is pressed. */
  canRemove(row: DepartmentResponse | OrganisationUnitResponse): boolean {
    return this.memberCount(row) === 0 && this.childCount(row) === 0;
  }
}
