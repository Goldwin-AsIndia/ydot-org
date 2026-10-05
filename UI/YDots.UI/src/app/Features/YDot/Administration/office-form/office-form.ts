import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { IamAdminApiService } from '../../../../Service/iam-admin-api.service';
import { apiErrorMessage, apiFieldErrors } from '../../../../Shared/models/api-response.model';
import { OrganisationUnitResponse, RecordStatus } from '../../../../Shared/models/iam-contract.model';
import { ApiEnumOption } from '../../../../Shared/models/enum-option.model';
import { EnumOptionsService } from '../../../../Shared/services/enum-options.service';
import { createGeoCascade } from '../../../../Shared/services/geo-cascade';
import { PeopleDirectoryService } from '../../../../Shared/services/people-directory.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { codeError, emailError, maxLengthError, phoneError, postalCodeError, requiredError, textWithLettersError } from '../../../../Shared/validation/field-rules';

/**
 * Add or edit one office (organisation unit) on a page of its own.
 *
 * The list screen used to open this as a card above the table, which pushed the list down and gave
 * a long address form no room. Here it is a full page of section cards laid out to fill the width. `/units/new` adds; `/units/:id/edit` edits.
 *
 * The save rules are the list screen's, unchanged: a create sends null for an empty box, an update
 * sends the trimmed text - empty included - because the server reads null as "leave it alone".
 */
@Component({
  selector: 'app-office-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './office-form.html',
  styleUrl: './office-form.css',
})
export class OfficeFormComponent implements OnInit, OnDestroy {
  private readonly api = inject(IamAdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly enums = inject(EnumOptionsService);

  protected readonly people = inject(PeopleDirectoryService);
  protected readonly geo = createGeoCascade();

  private readonly destroy$ = new Subject<void>();

  readonly listUrl = '/app/administration/organisation/units';

  /** Kinds offered as one-click suggestions; the box still takes anything. */
  readonly kindSuggestions = ['Head office', 'Branch', 'Regional office', 'Warehouse', 'Field office'];

  readonly officeId = signal<string | null>(null);
  readonly isNew = computed(() => this.officeId() === null);

  readonly units = signal<OrganisationUnitResponse[]>([]);
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
    unitType: '',
    managerUserId: '',
    contactEmail: '',
    contactPhone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    country: '',
    postalCode: '',
    timeZone: '',
    status: 'active' as RecordStatus,
    displayOrder: 0,
    expectedVersion: 0,
  });

  // ---- Derived ------------------------------------------------------------------------------

  /** Parent options: every office except this one and anything beneath it. */
  readonly parentOptions = computed(() => {
    const id = this.officeId();
    if (!id) return this.units();

    const blocked = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const unit of this.units()) {
        if (unit.id && unit.parentUnitId && blocked.has(unit.parentUnitId) && !blocked.has(unit.id)) {
          blocked.add(unit.id);
          grew = true;
        }
      }
    }
    return this.units().filter((unit) => !unit.id || !blocked.has(unit.id));
  });

  /**
   * What is wrong with each field right now (null = fine). Required for an office: its name, code,
   * kind and the whole postal address - an office without an address cannot be found, mailed or
   * placed on a map. Everything else (parent, manager, contacts, time zone) is optional.
   */
  readonly rules = computed<Record<string, string | null>>(() => {
    const f = this.form();
    // Limits are the API's column sizes: name 200, code 50, kind 80, e-mail 320, phone 30,
    // address lines 250, city / state / country 120, postal code 20, description 1000.
    return {
      name: textWithLettersError('Name', f.name, { min: 2, max: 200 }),
      code: codeError('Code', f.code, { allowHyphen: true, max: 50 }),
      unitType: requiredError('Kind', f.unitType) ?? maxLengthError(f.unitType, 80),
      description: maxLengthError(f.description, 1000),
      contactEmail: emailError('Contact e-mail', f.contactEmail, false) ?? maxLengthError(f.contactEmail, 320),
      contactPhone: phoneError('Contact phone', f.contactPhone, false),
      addressLine1: requiredError('Address line 1', f.addressLine1) ?? maxLengthError(f.addressLine1, 250),
      addressLine2: maxLengthError(f.addressLine2, 250),
      country: requiredError('Country', f.country) ?? maxLengthError(f.country, 120),
      state: requiredError('State or province', f.state) ?? maxLengthError(f.state, 120),
      city: requiredError('City', f.city) ?? maxLengthError(f.city, 120),
      postalCode: postalCodeError('Postal code', f.postalCode, f.country, true),
    };
  });

  private static readonly LABELS: Record<string, string> = {
    name: 'Name', code: 'Code', unitType: 'Kind', description: 'Description', addressLine2: 'Address line 2', contactEmail: 'Contact e-mail', contactPhone: 'Contact phone',
    addressLine1: 'Address line 1', country: 'Country', state: 'State or province', city: 'City', postalCode: 'Postal code',
  };

  /** The message under a field: the server's, else ours once Save has been pressed. */
  err(field: string): string | null {
    return this.fieldErrors()[field] ?? (this.attempted() || this.touched().has(field) ? (this.rules()[field] ?? null) : null);
  }

  /** Fields left at least once; their messages show before Save is pressed. */
  readonly touched = signal<ReadonlySet<string>>(new Set());

  private static readonly FIELD_IDS: Record<string, string> = {
    'of-name': 'name', 'of-code': 'code', 'of-kind': 'unitType', 'of-description': 'description',
    'of-email': 'contactEmail', 'of-phone': 'contactPhone', 'of-address1': 'addressLine1', 'of-address2': 'addressLine2',
    'of-country': 'country', 'of-state': 'state', 'of-city': 'city', 'of-postal': 'postalCode',
  };

  /** Called when focus leaves any field of the form. */
  onFieldLeft(id: string): void {
    const field = OfficeFormComponent.FIELD_IDS[id];
    if (field && !this.touched().has(field)) {
      this.touched.update((current) => new Set(current).add(field));
    }
  }

  private focusFirstInvalid(fields: string[]): void {
    const entry = Object.entries(OfficeFormComponent.FIELD_IDS).find(([, field]) => fields.includes(field));
    if (entry) setTimeout(() => (document.getElementById(entry[0]) as HTMLElement | null)?.focus());
  }

  readonly canSave = computed(() =>
    Object.values(this.rules()).every((message) => message === null) && !this.saving() && !this.loading());

  protected readonly orphanTimeZone = computed(() => {
    const value = this.form().timeZone;
    return value && !this.geo.timeZones().some((zone) => zone.ianaKey === value) ? value : '';
  });

  // ---- Lifecycle ----------------------------------------------------------------------------

  ngOnInit(): void {
    this.officeId.set(this.route.snapshot.paramMap.get('id'));

    this.enums
      .options('recordStatuses')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (options) => this.statusOptions.set(options),
        error: () => this.statusOptions.set([]),
      });

    // The list is needed either way: for the "sits under" picker, and to find the office being
    // edited (there is no single-unit endpoint).
    this.api.getUnits().pipe(takeUntil(this.destroy$)).subscribe({
      next: (units) => {
        this.units.set(units);
        const id = this.officeId();

        if (id) {
          const unit = units.find((item) => item.id === id);
          if (!unit) {
            this.notFound.set(true);
          } else {
            this.fill(unit);
          }
        } else {
          this.form.update((f) => ({ ...f, displayOrder: units.length * 10 }));
          this.geo.selectCountry(null);
        }
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.errorMessage.set(apiErrorMessage(error, 'The offices could not be loaded.'));
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private fill(unit: OrganisationUnitResponse): void {
    this.form.set({
      name: unit.name ?? '',
      code: unit.code ?? '',
      description: unit.description ?? '',
      parentId: unit.parentUnitId ?? '',
      unitType: unit.unitType ?? '',
      managerUserId: unit.managerUserId ?? '',
      contactEmail: unit.contactEmail ?? '',
      contactPhone: unit.contactPhone ?? '',
      addressLine1: unit.addressLine1 ?? '',
      addressLine2: unit.addressLine2 ?? '',
      city: unit.city ?? '',
      state: unit.state ?? '',
      country: unit.country ?? '',
      postalCode: unit.postalCode ?? '',
      timeZone: unit.timeZone ?? '',
      status: unit.status ?? 'active',
      displayOrder: unit.displayOrder ?? 0,
      expectedVersion: unit.version ?? 0,
    });
    // Rebuild the cascade from the stored names so the pickers open on what was saved.
    this.geo.restore(unit.country, unit.state, unit.city);
  }

  // ---- Editing ------------------------------------------------------------------------------

  update<K extends keyof ReturnType<typeof this.form>>(key: K, value: ReturnType<typeof this.form>[K]): void {
    this.form.update((current) => ({ ...current, [key]: value }));
    this.clearFieldError(key as string);
  }

  private clearFieldError(key: string): void {
    const errors = this.fieldErrors();
    if (errors[key]) {
      const { [key]: _removed, ...rest } = errors;
      this.fieldErrors.set(rest);
    }
  }

  /** The failing field that comes first on the page. */
  private static fieldOrder(fields: string[]): string {
    const order = ['name', 'code', 'unitType', 'description', 'contactEmail', 'contactPhone', 'addressLine1', 'addressLine2', 'country', 'state', 'city', 'postalCode'];
    return order.find((field) => fields.includes(field)) ?? fields[0];
  }

  protected onCountryChange(value: string): void {
    this.form.update((f) => ({ ...f, country: value, state: '', city: '' }));
    this.clearFieldError('country');
    this.geo.selectCountry(value);
  }

  protected onStateChange(value: string): void {
    this.form.update((f) => ({ ...f, state: value, city: '' }));
    this.geo.selectState(value);
  }

  protected personMissing(reference: string): boolean {
    return !!reference && !this.people.assignable().some((person) => person.reference === reference);
  }

  cancel(): void {
    this.router.navigateByUrl(this.listUrl);
  }

  save(): void {
    this.attempted.set(true);
    const failing = Object.entries(this.rules()).filter(([, message]) => message !== null);
    if (failing.length > 0) {
      this.errorMessage.set(`Please correct: ${failing.map(([field]) => OfficeFormComponent.LABELS[field] ?? field).join(', ')}.`);
      this.focusFirstInvalid([OfficeFormComponent.fieldOrder(failing.map(([field]) => field))]);
      return;
    }
    if (this.saving() || this.loading()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set('');
    this.fieldErrors.set({});

    const f = this.form();
    const id = this.officeId();

    const request = id
      ? this.api.updateUnit(id, {
          expectedVersion: f.expectedVersion,
          name: f.name.trim(),
          code: f.code.trim().toUpperCase(),
          description: f.description.trim(),
          parentUnitId: f.parentId || null,
          unitType: f.unitType.trim(),
          addressLine1: f.addressLine1.trim(),
          addressLine2: f.addressLine2.trim(),
          city: f.city.trim(),
          state: f.state.trim(),
          country: f.country.trim(),
          postalCode: f.postalCode.trim(),
          contactEmail: f.contactEmail.trim(),
          contactPhone: f.contactPhone.trim(),
          timeZone: f.timeZone.trim(),
          managerUserId: f.managerUserId || null,
          status: f.status,
          displayOrder: f.displayOrder,
        })
      : this.api.createUnit({
          name: f.name.trim(),
          code: f.code.trim().toUpperCase(),
          description: f.description.trim() || null,
          parentUnitId: f.parentId || null,
          unitType: f.unitType.trim() || null,
          addressLine1: f.addressLine1.trim() || null,
          addressLine2: f.addressLine2.trim() || null,
          city: f.city.trim() || null,
          state: f.state.trim() || null,
          country: f.country.trim() || null,
          postalCode: f.postalCode.trim() || null,
          contactEmail: f.contactEmail.trim() || null,
          contactPhone: f.contactPhone.trim() || null,
          timeZone: f.timeZone.trim() || null,
          managerUserId: f.managerUserId || null,
          displayOrder: f.displayOrder,
        });

    request.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.show('Saved', id ? `${f.name} has been updated.` : `${f.name} has been added.`, 'success');
        this.router.navigateByUrl(this.listUrl);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(apiErrorMessage(error, 'That could not be saved.'));
        const mapped: Record<string, string> = {};
        for (const [field, message] of Object.entries(apiFieldErrors(error))) {
          mapped[field.charAt(0).toLowerCase() + field.slice(1)] = message;
        }
        this.fieldErrors.set(mapped);
        const failing = Object.keys(mapped);
        if (failing.length > 0) {
          this.focusFirstInvalid([OfficeFormComponent.fieldOrder(failing)]);
        } else {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
    });
  }
}
