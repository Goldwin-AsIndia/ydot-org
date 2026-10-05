import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { IamAdminApiService } from '../../../../Service/iam-admin-api.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { PermissionMatrixResponse } from '../../../../Shared/models/iam-contract.model';

/** One permission with the place it lives. */
interface PermissionEntry {
  id: string;
  code: string;
  name: string;
  description: string;
  action: string;
  isSensitive: boolean;
  moduleCode: string;
  moduleName: string;
  groupName: string;
}

/**
 * The permission catalogue: every code the product defines, and what each one lets somebody do.
 *
 * READ-ONLY, AND THAT IS NOT AN OVERSIGHT. A permission code is not configuration — it is the
 * name of a check written into the API. Adding a row here would produce a permission nothing
 * enforces, which is worse than not having it: it would appear on the role editor, be granted in
 * good faith, and grant nothing. Codes arrive with the code that checks them.
 *
 * WHAT THE SCREEN IS ACTUALLY FOR
 * -------------------------------
 * Answering "what does this permission let somebody do" and "which permission do I need to grant
 * for X". It is a REGISTER: modules down the left, one ruled table of permissions on the right,
 * filtered by action or sensitivity and paged, so a hundred and thirty codes are read a screenful
 * at a time instead of scrolled through.
 */
@Component({
  selector: 'app-permission-catalogue',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './permission-catalogue.html',
  styleUrl: './permission-catalogue.css',
})
export class PermissionCatalogueComponent implements OnInit, OnDestroy {
  private readonly api = inject(IamAdminApiService);
  private readonly destroy$ = new Subject<void>();

  readonly pageSizes = [10, 20, 50];

  readonly matrix = signal<PermissionMatrixResponse | null>(null);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly errorMessage = signal('');

  readonly search = signal('');
  readonly moduleCode = signal('');
  readonly actionFilter = signal('');
  readonly sensitiveOnly = signal(false);
  readonly page = signal(1);
  readonly pageSize = signal(10);

  /** The code just copied, so its row can say so for a moment. */
  readonly copied = signal('');
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly modules = computed(() => this.matrix()?.modules ?? []);

  readonly entries = computed<PermissionEntry[]>(() =>
    this.modules().flatMap((module) => (module.groups ?? []).flatMap((group) =>
      (group.permissions ?? []).map((permission) => ({
        id: permission.id ?? permission.code ?? '',
        code: permission.code ?? '',
        name: permission.name ?? '',
        description: permission.description ?? '',
        action: permission.action ?? '',
        isSensitive: permission.isSensitive === true,
        moduleCode: module.moduleCode ?? '',
        moduleName: module.moduleName || module.moduleCode || '',
        groupName: group.groupName || group.groupCode || '',
      })))));

  readonly totalPermissions = computed(() => this.entries().length);
  readonly sensitiveTotal = computed(() => this.entries().filter((entry) => entry.isSensitive).length);
  readonly sensitiveShare = computed(() => {
    const total = this.totalPermissions();
    return total ? Math.round((this.sensitiveTotal() / total) * 100) : 0;
  });

  /** The modules for the rail, with their sizes. */
  readonly moduleList = computed(() => this.modules().map((module) => {
    const mine = this.entries().filter((entry) => entry.moduleCode === module.moduleCode);

    return {
      code: module.moduleCode ?? '',
      name: module.moduleName || module.moduleCode || '',
      count: mine.length,
      sensitive: mine.filter((entry) => entry.isSensitive).length,
    };
  }));

  /** Actions in the order a reader weighs them: reading first, deleting and administering last. */
  readonly actionKinds = computed(() => {
    const order = ['view', 'export', 'create', 'edit', 'approve', 'reject', 'delete', 'administer'];
    const counts = new Map<string, number>();
    const code = this.moduleCode();

    for (const entry of this.entries()) {
      if (entry.action && (!code || entry.moduleCode === code)) {
        counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
      }
    }

    const rank = (action: string): number => {
      const index = order.indexOf(action);
      return index === -1 ? order.length : index;
    };

    return [...counts.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => rank(a.action) - rank(b.action) || a.action.localeCompare(b.action));
  });

  /** Search matches the code as well as the name: people arrive holding a code from an error. */
  readonly filtered = computed(() => {
    const term = this.search().trim().toLowerCase();
    const code = this.moduleCode();
    const action = this.actionFilter();
    const sensitiveOnly = this.sensitiveOnly();

    return this.entries().filter((entry) =>
      (!code || entry.moduleCode === code)
      && (!action || entry.action === action)
      && (!sensitiveOnly || entry.isSensitive)
      && (!term
        || entry.code.toLowerCase().includes(term)
        || entry.name.toLowerCase().includes(term)
        || entry.description.toLowerCase().includes(term)));
  });

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  readonly safePage = computed(() => Math.min(this.page(), this.pageCount()));

  readonly rows = computed(() => {
    const start = (this.safePage() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  readonly range = computed(() => {
    const total = this.filtered().length;
    const start = total === 0 ? 0 : (this.safePage() - 1) * this.pageSize() + 1;
    return { from: start, to: Math.min(total, start + this.pageSize() - 1), total };
  });

  /** Page buttons: first, last and the neighbours of the current page, with gaps as null. */
  readonly pageButtons = computed(() => {
    const last = this.pageCount();
    const current = this.safePage();
    const shown = new Set([1, last, current - 1, current, current + 1].filter((n) => n >= 1 && n <= last));
    const sorted = [...shown].sort((a, b) => a - b);
    const out: (number | null)[] = [];

    sorted.forEach((n, index) => {
      if (index > 0 && n - sorted[index - 1] > 1) {
        out.push(null);
      }

      out.push(n);
    });

    return out;
  });

  readonly filtering = computed(() =>
    this.search().trim().length > 0 || this.moduleCode() !== '' || this.actionFilter() !== '' || this.sensitiveOnly());

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
    }

    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    this.api
      .getPermissionMatrix()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (matrix) => {
          this.matrix.set(matrix);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadFailed.set(true);
          this.errorMessage.set(apiErrorMessage(error, 'The catalogue could not be loaded.'));
        },
      });
  }

  // Every filter change returns to page one, so a narrower list never opens on an empty page.
  setSearch(value: string): void { this.search.set(value); this.page.set(1); }
  setModule(code: string): void { this.moduleCode.set(code); this.actionFilter.set(''); this.page.set(1); }
  setAction(action: string): void { this.actionFilter.set(this.actionFilter() === action ? '' : action); this.page.set(1); }
  toggleSensitive(): void { this.sensitiveOnly.update((value) => !value); this.page.set(1); }
  setPageSize(size: number | string): void { this.pageSize.set(Number(size)); this.page.set(1); }
  goTo(page: number): void { this.page.set(Math.min(Math.max(1, page), this.pageCount())); }

  clearFilters(): void {
    this.search.set('');
    this.moduleCode.set('');
    this.actionFilter.set('');
    this.sensitiveOnly.set(false);
    this.page.set(1);
  }

  /**
   * The ink for an action.
   *
   * Reading is safe, writing changes things, and approving or deleting is where somebody should
   * look twice. Inking by that rather than one shade per verb is what makes the list scannable.
   */
  actionInk(action: string | null | undefined): string {
    switch (action) {
      case 'view':
      case 'export':
        return 'read';

      case 'create':
      case 'edit':
        return 'write';

      case 'approve':
      case 'reject':
        return 'review';

      case 'delete':
      case 'administer':
        return 'risk';

      default:
        return 'other';
    }
  }

  /** Copies a code, which is what most visits to this screen end in. */
  copyCode(code: string | null | undefined): void {
    if (!code) {
      return;
    }

    void navigator.clipboard.writeText(code);

    this.copied.set(code);

    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
    }

    this.copiedTimer = setTimeout(() => this.copied.set(''), 1600);
  }
}
