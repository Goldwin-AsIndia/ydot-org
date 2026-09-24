import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { IamAdminApiService } from '../../../../Service/iam-admin-api.service';
import { apiErrorMessage, apiFieldErrors } from '../../../../Shared/models/api-response.model';
import { DepartmentResponse, RecordStatus } from '../../../../Shared/models/iam-contract.model';
import { ApiEnumOption } from '../../../../Shared/models/enum-option.model';
import { EnumOptionsService } from '../../../../Shared/services/enum-options.service';
import { PeopleDirectoryService } from '../../../../Shared/services/people-directory.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { PickerComponent, PickerOption } from '../../../../Shared/components/picker/picker';

/**
 * Add or edit one department in a pop-up over the Departments list.
 *
 *   <app-department-form [departmentId]="id or null" (saved)="..." (closed)="..." />
 *
 * `departmentId` null adds; an id edits. The host decides when it is shown and removes it on
 * `closed` / `saved`. Escape and a click on the backdrop close it, as Cancel does.
 *
 * It borrows the field and button styles of the office page (office-form.css) so the two forms look
 * alike, with its own dialog frame on top (department-form.css).
 *
 * The save rules are the list screen's, unchanged: a create sends null for an empty description,
 * an update sends the trimmed text - empty included - because the server reads null as "leave it
 * alone".
 */
@Component({
  selector: 'app-department-form',
  standalone: true,
  imports: [CommonModule, FormsModule, PickerComponent],
  templateUrl: './department-form.html',
  styleUrls: ['../office-form/office-form.css', './department-form.css'],
})
export class DepartmentFormComponent implements OnInit, OnDestroy {
  private readonly api = inject(IamAdminApiService);
  private readonly toast = inject(ToastService);
  private readonly enums = inject(EnumOptionsService);

  protected readonly people = inject(PeopleDirectoryService);

  private readonly destroy$ = new Subject<void>();

  /** The department to edit, or null to add one. */
  readonly departmentId = input<string | null>(null);
  readonly saved = output<void>();
  readonly closed = output<void>();

  /** Common department names, offered as one-click starting points for a new one. */
  readonly nameSuggestions = ['Fundraising', 'Finance', 'Programmes', 'Operations', 'Communications', 'Volunteers'];

  readonly isNew = computed(() => this.departmentId() === null);

  readonly departments = signal<DepartmentResponse[]>([]);
  readonly statusOptions = signal<ApiEnumOption[]>([]);

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});
  /** Set on the first Save press, so required hints do not shout before anybody has typed. */
  readonly attempted = signal(false);

  readonly form = signal({
    name: '',
    code: '',
    description: '',
    parentId: '',
    headUserId: '',
    status: 'active' as RecordStatus,
    displayOrder: 0,
    expectedVersion: 0,
  });

  /** Parent options: every department except this one and anything beneath it. */
  readonly parentOptions = computed(() => {
    const id = this.departmentId();
    if (!id) return this.departments();

    const blocked = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of this.departments()) {
        if (item.id && item.parentDepartmentId && blocked.has(item.parentDepartmentId) && !blocked.has(item.id)) {
          blocked.add(item.id);
          grew = true;
        }
      }
    }
    return this.departments().filter((item) => !item.id || !blocked.has(item.id));
  });

  // ---- Picker lists ---------------------------------------------------------------------------

  readonly parentPickerOptions = computed<PickerOption[]>(() =>
    this.parentOptions()
      .filter((item) => !!item.id)
      .map((item) => ({ value: item.id!, label: item.name ?? '', hint: item.code ?? null })));

  /** The organisation's active people, plus the stored head when they are no longer in that list. */
  readonly headPickerOptions = computed<PickerOption[]>(() => {
    const people: PickerOption[] = this.people.assignable()
      .map((person) => ({ value: person.reference, label: person.name, hint: person.context ?? null }));
    const current = this.form().headUserId;
    return current && !people.some((option) => option.value === current)
      ? [{ value: current, label: this.people.name(current), hint: 'No longer active' }, ...people]
      : people;
  });

  readonly statusPickerOptions = computed<PickerOption[]>(() =>
    this.statusOptions().map((option) => ({ value: option.value, label: option.label })));

  readonly nameValid = computed(() => this.form().name.trim().length >= 2);
  readonly codeValid = computed(() => this.form().code.trim().length >= 2);
  readonly canSave = computed(() => this.nameValid() && this.codeValid() && !this.saving() && !this.loading());

  // ---- Lifecycle ----------------------------------------------------------------------------

  ngOnInit(): void {
    this.enums
      .options('recordStatuses')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (options) => this.statusOptions.set(options),
        error: () => this.statusOptions.set([]),
      });

    // The list is needed either way: for the "sits under" picker, and to find the department
    // being edited (there is no single-department endpoint).
    this.api.getDepartments().pipe(takeUntil(this.destroy$)).subscribe({
      next: (items) => {
        this.departments.set(items);
        const id = this.departmentId();

        if (id) {
          const item = items.find((department) => department.id === id);
          if (!item) {
            this.notFound.set(true);
          } else {
            this.fill(item);
          }
        } else {
          this.form.update((f) => ({ ...f, displayOrder: items.length * 10 }));
        }
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.errorMessage.set(apiErrorMessage(error, 'The departments could not be loaded.'));
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private fill(item: DepartmentResponse): void {
    this.form.set({
      name: item.name ?? '',
      code: item.code ?? '',
      description: item.description ?? '',
      parentId: item.parentDepartmentId ?? '',
      headUserId: item.headUserId ?? '',
      status: item.status ?? 'active',
      displayOrder: item.displayOrder ?? 0,
      expectedVersion: item.version ?? 0,
    });
  }

  // ---- Editing ------------------------------------------------------------------------------

  update<K extends keyof ReturnType<typeof this.form>>(key: K, value: ReturnType<typeof this.form>[K]): void {
    this.form.update((current) => ({ ...current, [key]: value }));
  }

  /** A suggested name fills the name, and the code too while the code is still empty. */
  useSuggestion(name: string): void {
    this.form.update((f) => ({
      ...f,
      name,
      code: f.code.trim() ? f.code : name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(),
    }));
  }

  @HostListener('document:keydown.escape')
  cancel(): void {
    if (!this.saving()) {
      this.closed.emit();
    }
  }

  save(): void {
    this.attempted.set(true);
    if (!this.canSave()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');
    this.fieldErrors.set({});

    const f = this.form();
    const id = this.departmentId();

    const request = id
      ? this.api.updateDepartment(id, {
          expectedVersion: f.expectedVersion,
          name: f.name.trim(),
          code: f.code.trim().toUpperCase(),
          description: f.description.trim(),
          parentDepartmentId: f.parentId || null,
          headUserId: f.headUserId || null,
          status: f.status,
          displayOrder: f.displayOrder,
        })
      : this.api.createDepartment({
          name: f.name.trim(),
          code: f.code.trim().toUpperCase(),
          description: f.description.trim() || null,
          parentDepartmentId: f.parentId || null,
          headUserId: f.headUserId || null,
          displayOrder: f.displayOrder,
        });

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.show('Saved', id ? `${f.name} has been updated.` : `${f.name} has been added.`, 'success');
        this.saved.emit();
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(apiErrorMessage(error, 'That could not be saved.'));
        this.fieldErrors.set(apiFieldErrors(error));
      },
    });
  }
}
