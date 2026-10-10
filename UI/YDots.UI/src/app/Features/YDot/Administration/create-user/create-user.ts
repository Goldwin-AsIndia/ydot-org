import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PopupComponent } from '../../../../Shared/components/popup/popup';
import { HasPendingChanges } from '../../../../Shared/guards/pending-changes.guard';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';
import { ToastService } from '../../../../Shared/services/toast.service';
import { createGeoCascade } from '../../../../Shared/services/geo-cascade';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { UserAdminApiService } from '../../../../Service/user-admin-api.service';
import { LookupItem } from '../../../../Shared/models/api-response.model';
import {
  CreateUserRequest,
  EnumOption,
  EnumOptionsResponse,
  ReferenceDataResponse,
} from '../../../../Shared/models/iam-contract.model';
import { emailError, employeeNumberError, minLengthError, nameError, phoneWithCodeError, requiredError, textWithLettersError, usernameError } from '../../../../Shared/validation/field-rules';

import { NavigationHistoryService } from '../../../../Shared/services/navigation-history.service';
/** One row of a custom dropdown, normalised from whichever source the list comes from. */
interface CuDdOption {
  value: string;
  label: string;
}

/**
 * IAM-USR-01 — Invite or create a user.
 *
 * WHAT THIS SCREEN PRODUCES
 * -------------------------
 * A real account and a real invitation e-mail. Pressing "Create and send invitation" calls the
 * API, which creates the record, generates a single-use token, stores only its hash, and e-mails
 * a link to `/auth/invitation?token=…`. That link is the first step of the activation stepper.
 *
 * So the loop is: create here → e-mail → activate there → the directory shows the account as
 * Active, with MFA reading **Enrolled** if they added a second factor.
 *
 * WHY THE DROPDOWNS ARE LOADED, NOT TYPED
 * ---------------------------------------
 * Roles and organisation units are identifiers, not words. The previous version collected the
 * *name* of a role from a text list and stored it in a browser cache, which is why nothing it
 * created ever existed on the server. Every option here comes from
 * `GET /users/invite-or-create-user-guided-flow`, already filtered to what this administrator is
 * allowed to grant.
 */
@Component({
  selector: 'app-create-user',
  standalone: true,
  imports: [PageHeader, CommonModule, FormsModule, PopupComponent],
  templateUrl: './create-user.html',
  styleUrl: './create-user.css',
})
export class CreateUserComponent implements OnInit, HasPendingChanges {
  private readonly router = inject(Router);
  private readonly navHistory = inject(NavigationHistoryService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(UserAdminApiService);
  private readonly tokens = inject(AuthTokenService);

  // ---- Screen state ---------------------------------------------------------------------------
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly loadFailed = signal(false);
  readonly errorMessage = signal('');
  readonly view = signal<ReferenceDataResponse | null>(null);

  /** The enumerations the form renders as dropdowns, with their display labels. */
  readonly enums = signal<EnumOptionsResponse | null>(null);

  readonly activeStep = signal(0);
  readonly steps = ['Identity', 'Organisation', 'Access', 'Review'];

  /**
   * The stepper renders each step with a one-line description under its title, so the rail
   * reads as a guide rather than four bare words. The descriptions are presentational only —
   * `steps` above stays the single source the server-error mapping indexes into.
   */
  readonly stepMeta: { title: string; description: string }[] = [
    { title: 'Identity', description: 'Basic information about the user' },
    { title: 'Organisation', description: 'Department and reporting structure' },
    { title: 'Access', description: 'Permissions and system access' },
    { title: 'Review', description: 'Review details before creating' },
  ];

  /**
   * Honorifics for the Title dropdown.
   *
   * Saved on the user record as `title`. The platform keeps no catalogue of honorifics, so the
   * list lives here; every entry passes the server's name rule. Rendered as a dropdown, as the
   * design asks, rather than a free-text box that invites "Dr." and "Mr " into the same column.
   */
  readonly titles = ['Mr', 'Ms', 'Mrs', 'Mx', 'Dr', 'Prof'];

  readonly submitted = signal(false);

  /**
   * Set once the account exists, so the screen can confirm rather than offer Create again.
   *
   * `invitationStatus` is the server's word, not ours: `Sent` means the relay accepted the
   * message, `Pending` means it did not. Reporting the button the administrator pressed instead
   * of what actually happened would tell them an e-mail is on its way when none was ever sent —
   * and they would go on waiting for it.
   */
  readonly createdUser = signal<{
    code: string;
    displayName: string;
    email: string;
    requestedInvite: boolean;
    invitationStatus: string;
  } | null>(null);

  /** True only when the relay actually accepted the invitation. */
  readonly invitationDelivered = computed(() => this.createdUser()?.invitationStatus === 'Sent');

  /** The invitation was asked for, but the relay refused it. */
  readonly invitationStuck = computed(() => {
    const created = this.createdUser();
    return Boolean(created?.requestedInvite) && created?.invitationStatus !== 'Sent';
  });

  // ---- The form ------------------------------------------------------------------------------
  readonly form = signal({
    // Identity
    accountCategory: '',
    title: '',
    firstName: '',
    middleName: '',
    lastName: '',
    displayName: '',
    preferredName: '',
    email: '',
    username: '',
    mobileCountryCode: '',
    mobileNumber: '',
    employeeNumber: '',

    // Organisation
    engagementType: '',
    organisationUnitId: '',
    departmentId: '',
    designation: '',
    workLocation: '',
    // Empty means "inherit the Organisation's default", which is what the server stores for an
    // unanswered locale. These used to start at "en-GB" and "UTC" - the second of which exists
    // nowhere in the time-zone catalogue - and neither was ever sent.
    preferredLanguage: '',
    timeZoneId: '',

    // Access
    primaryRoleId: '',
    dataScopeType: '',
    accessStartsAt: new Date().toISOString().slice(0, 10),
    accessEndsAt: '',
    businessJustification: '',

    // Security
    mfaRequirement: '',
    sendInvitationNow: true,
    welcomeMessage: '',
  });

  /** The form as it first rendered, to tell whether anything has been typed since. */
  private readonly pristine = JSON.stringify(this.form());

  /** Result of the live "is this taken?" check on e-mail and username. */
  readonly identityCheck = signal<{ checking: boolean; message: string; ok: boolean; suggestions: string[] } | null>(null);

  /**
   * Field-level errors returned by the API, keyed by field name.
   *
   * The API answers a rejected create with `{ message, errors: [{ field, message }] }`. The
   * summary line is deliberately vague — "Review the highlighted fields before continuing" — on
   * the assumption that the client highlights them. Throwing `errors` away, as this component
   * first did, left that sentence pointing at nothing: a dead end with no way to discover which
   * field the server disliked.
   */
  readonly serverErrors = signal<Record<string, string>>({});

  /**
   * Which step each field belongs to, so a rejection can send the person to the right one.
   * Without this they land on Review, told to fix a field that is three steps back.
   */
  private static readonly FIELD_STEP: Record<string, number> = {
    accountCategory: 0, title: 0, firstName: 0, middleName: 0, lastName: 0, displayName: 0,
    preferredName: 0, email: 0, username: 0, alternateEmail: 0,
    mobileCountryCode: 0, mobileNumber: 0, employeeNumber: 0,

    engagementType: 1, organisationId: 1, organisationUnitId: 1, departmentId: 1,
    designation: 1, managerUserId: 1, workLocation: 1, preferredLanguage: 1, timeZoneId: 1,

    primaryRoleId: 2, additionalRoleIds: 2, dataScopeType: 2, dataScopes: 2,
    accessStartsAtUtc: 2, accessEndsAtUtc: 2, accessReviewDueAtUtc: 2,
    approverUserId: 2, businessJustification: 2,

    credentialSetupMethod: 3, temporaryPassword: 3, mfaRequirement: 3,
    preferredMfaMethod: 3, sendInvitationNow: 3, welcomeMessage: 3,
  };

  /** The server's complaint about one field, if it made one. */
  errorFor(field: string): string | null {
    return this.serverErrors()[field] ?? (this.submitted() || this.touched().has(field) ? this.localError(field) : null);
  }

  /** Fields the person has left at least once: their messages show without waiting for Continue. */
  readonly touched = signal<ReadonlySet<string>>(new Set());

  touch(field: string): void {
    if (!this.touched().has(field)) {
      this.touched.update((current) => new Set(current).add(field));
    }
  }

  /** Element ids, to move focus to the first invalid field. */
  private static readonly FIELD_ID: Record<string, string> = {
    accountCategory: 'cuCategory', firstName: 'cuFirst', lastName: 'cuLast', displayName: 'cuDisplay',
    preferredName: 'cuPreferred', email: 'cuEmail', username: 'cuUsername', mobileCountryCode: 'cuCode',
    mobileNumber: 'cuMobile', employeeNumber: 'cuEmployee', designation: 'cuDesignation',
    workLocation: 'cuLocation', businessJustification: 'cuJustification',
  };

  private focusFirstInvalid(step: number): void {
    const first = (CreateUserComponent.STEP_FIELDS[step] ?? []).find((field) => this.errorFor(field) !== null);
    const id = first ? CreateUserComponent.FIELD_ID[first] : undefined;
    if (id) {
      setTimeout(() => (document.getElementById(id) as HTMLElement | null)?.focus());
    }
  }

  /** Display names of the fields, for the "fix these" summary. */
  private static readonly FIELD_LABEL: Record<string, string> = {
    accountCategory: 'Account type', firstName: 'First name', lastName: 'Last name', displayName: 'Display name',
    preferredName: 'Preferred name', email: 'Login e-mail', username: 'Username', mobileCountryCode: 'Country code',
    mobileNumber: 'Mobile', employeeNumber: 'Employee or volunteer number', engagementType: 'Engagement',
    workLocation: 'Work location',
    primaryRoleId: 'Primary role', dataScopeType: 'Data scope', mfaRequirement: 'Two-step verification',
    businessJustification: 'Business justification',
  };

  /** The fields each step checks, in screen order. */
  private static readonly STEP_FIELDS: string[][] = [
    ['accountCategory', 'firstName', 'lastName', 'displayName', 'preferredName', 'email', 'username',
      'mobileCountryCode', 'mobileNumber', 'employeeNumber'],
    ['engagementType', 'designation', 'workLocation'],
    ['primaryRoleId', 'dataScopeType', 'businessJustification'],
    ['mfaRequirement'],
  ];

  /**
   * What is wrong with a field by this screen's own rules, or null. Independent of whether the
   * person has tried to continue yet: that decides only whether the message is SHOWN (errorFor).
   */
  private localError(field: string): string | null {
    const f = this.form();

    switch (field) {
      case 'accountCategory': return requiredError('Account type', f.accountCategory);
      case 'firstName': return nameError('First name', f.firstName, true, 80);
      case 'lastName': return nameError('Last name', f.lastName, true, 80);
      case 'displayName': return nameError('Display name', f.displayName, true, 160);
      case 'preferredName': return nameError('Preferred name', f.preferredName, false, 160);
      case 'email': return emailError('Login e-mail', f.email);
      case 'username': return usernameError('Username', f.username);
      case 'mobileCountryCode':
        return f.mobileNumber.trim() && !f.mobileCountryCode ? 'Choose a country code for this number.' : null;
      case 'mobileNumber':
        return f.mobileNumber.trim() && !f.mobileCountryCode
          ? null
          : phoneWithCodeError('Mobile', f.mobileCountryCode, f.mobileNumber, { required: this.mobileRequired() });
      case 'employeeNumber':
        return employeeNumberError('Employee or volunteer number', f.employeeNumber, this.employeeNumberRequired());
      case 'designation': return textWithLettersError('Designation', f.designation, { required: false, max: 120 });
      case 'workLocation': return textWithLettersError('Work location', f.workLocation, { required: false, max: 200 });
      case 'engagementType': return requiredError('Engagement', f.engagementType);
      case 'primaryRoleId': return f.primaryRoleId ? null : 'Choose a primary role.';
      case 'dataScopeType': return requiredError('Data scope', f.dataScopeType);
      case 'mfaRequirement': return requiredError('Two-step verification', f.mfaRequirement);
      case 'businessJustification':
        return minLengthError('Business justification', f.businessJustification, 10);
      default: return null;
    }
  }

  /** Names of the fields on a step that fail, for the summary banner. */
  private invalidLabels(step: number): string[] {
    return (CreateUserComponent.STEP_FIELDS[step] ?? [])
      .filter((field) => this.localError(field) !== null)
      .map((field) => CreateUserComponent.FIELD_LABEL[field] ?? field);
  }

  /** Every server error, with the step each belongs to, for the summary banner. */
  readonly serverErrorList = computed(() =>
    Object.entries(this.serverErrors()).map(([field, message]) => ({
      field,
      message,
      step: CreateUserComponent.FIELD_STEP[field] ?? 0,
      stepName: this.steps[CreateUserComponent.FIELD_STEP[field] ?? 0],
    })),
  );

  // ---- Options -------------------------------------------------------------------------------
  //
  // TWO SOURCES, AND THE DISTINCTION MATTERS. Reference data is this ORGANISATION'S records -
  // its roles, departments, units and managers, each a GUID. The enum payload is the PRODUCT'S
  // fixed vocabulary - account categories, engagement types - each a stable name. Reading one
  // from the other is how a dropdown ends up permanently empty.
  readonly organisationUnits = computed<LookupItem[]>(() => this.view()?.organisationUnits ?? []);
  readonly departments = computed<LookupItem[]>(() => this.view()?.departments ?? []);
  readonly roles = computed<LookupItem[]>(() => this.view()?.roles ?? []);

  /**
   * The role being granted, by name.
   *
   * FOR THE REVIEW STEP, which listed the name, the e-mail, the username, the account type, the
   * access dates, the two-step policy and the justification - and not the two fields that decide
   * what the account can actually DO. "Check before you send" was missing the thing worth
   * checking.
   */
  /** Two letters for the confirmation monogram, from the display name or the first / last name. */
  readonly previewInitials = computed(() => {
    const f = this.form();
    const parts = (f.displayName || `${f.firstName} ${f.lastName}`).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) { return '+'; }
    return ((parts[0]?.charAt(0) ?? '') + (parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? '' : '')).toUpperCase();
  });

  readonly primaryRoleName = computed(() => {
    const chosen = String(this.form().primaryRoleId ?? '');

    if (!chosen) {
      return 'Not chosen';
    }

    return this.roles().find((role) => String(role.id) === chosen)?.name ?? chosen;
  });

  /** The data scope being granted, by its display name rather than its enum value. */
  readonly dataScopeName = computed(() => {
    const chosen = String(this.form().dataScopeType ?? '');

    if (!chosen) {
      return 'Not chosen';
    }

    return this.dataScopeTypes().find((scope) => String(scope.value) === chosen)?.label ?? chosen;
  });
  readonly managers = computed<LookupItem[]>(() => this.view()?.managers ?? []);

  readonly accountCategories = computed<EnumOption[]>(() => this.enums()?.accountCategories ?? []);
  readonly engagementTypes = computed<EnumOption[]>(() => this.enums()?.engagementTypes ?? []);

  /**
   * The data scopes this form can actually grant.
   *
   * ONLY THE TWO THAT NAME NO RECORD. Every other scope type - a campaign, a warehouse, a queue,
   * a place, named records - needs to say WHICH one, and this form has nowhere to say it. They
   * used to be offered anyway and, like the two that remain, were never sent: whatever was
   * chosen, the account was created with access to the whole Organisation. A narrower scope is
   * granted afterwards through an access request, which does carry a value.
   */
  readonly dataScopeTypes = computed<EnumOption[]>(() =>
    (this.enums()?.dataScopeTypes ?? []).filter((option) =>
      CreateUserComponent.GRANTABLE_SCOPES.includes(String(option.value ?? '').toLowerCase())));

  private static readonly GRANTABLE_SCOPES = ['organisation', 'assignment'];

  readonly mfaRequirements = computed<EnumOption[]>(() => this.enums()?.mfaRequirements ?? []);

  readonly initials = computed(() => {
    const name = this.form().displayName.trim();
    if (!name) {
      return '?';
    }

    const parts = name.split(' ').filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  });

  // ---- Step validity ---------------------------------------------------------------------------

  /**
   * Fields that become mandatory for the chosen account category.
   *
   * MIRRORS THE SERVER'S VALIDATOR, and is a courtesy rather than a control: the API refuses a
   * create that breaks the same rule, so the worst this can do if it drifts is let somebody
   * press Create and be told one step later. It is written out here rather than fetched because
   * the rule is two lines long, and an endpoint whose whole payload is "employees need a staff
   * number" is more moving parts than the rule deserves.
   *
   * The rule: an EMPLOYEE has a staff number, because payroll and the directory both key on it.
   * A volunteer, a contractor or an external party does not.
   */
  readonly conditionalFields = computed<string[]>(() => {
    const form = this.form();

    // CASE-INSENSITIVE, AND IT HAS TO BE. The form holds the server's own enum value, which is
    // "Employee" with a capital E - this compared it against lower-case "employee", so the test
    // was never true and the field was never marked required. The server, meanwhile, refuses the
    // create without it. The person filled in the form, saw no asterisk and no validation, and
    // was rejected on submit for a field nothing had asked them for.
    const isEmployee = form.accountCategory?.toLowerCase() === 'employee';

    // The server narrows it further: a staff number is expected of full and part-time employees,
    // not of somebody on a contract, an internship or an external engagement. Mirrored here so
    // the form asks for exactly what the API will insist on - no more, and no less.
    const engagement = form.engagementType?.toLowerCase();
    const isSalaried = engagement === 'fulltime' || engagement === 'parttime';

    return isEmployee && isSalaried ? ['employeeNumber'] : [];
  });

  readonly employeeNumberRequired = computed(() =>
    this.conditionalFields().some((field) => field.toLowerCase().includes('employee')),
  );

  readonly mobileRequired = computed(() =>
    this.conditionalFields().some((field) => field.toLowerCase().includes('mobile')),
  );

  readonly identityComplete = computed(() =>
    CreateUserComponent.STEP_FIELDS[0].every((field) => this.localError(field) === null),
  );

  /**
   * The Organisation step has nothing that must be answered.
   *
   * Organisation unit USED TO BE REQUIRED HERE, and the API has always treated it as optional -
   * OrganisationUnitId is a nullable Guid defaulting to null. A brand-new Organisation has no
   * units yet, so the only choice in the list was "Choose…", the step could never be
   * completed, and NO USER COULD BE CREATED AT ALL until somebody guessed that a unit had to be
   * built first. The one requirement the client added by itself was the one that blocked the
   * screen.
   *
   * Units and departments are a reporting structure. They are worth filling in, and the hint
   * beside the empty list says where to create them, but nobody should be unable to invite their
   * first colleague for want of an org chart.
   */
  readonly organisationComplete = computed(() =>
    CreateUserComponent.STEP_FIELDS[1].every((field) => this.localError(field) === null),
  );

  readonly accessComplete = computed(() =>
    // The API insists on a justification of at least ten characters: granting access without a
    // recorded reason is exactly what an access review later has no answer for.
    CreateUserComponent.STEP_FIELDS[2].every((field) => this.localError(field) === null),
  );

  /** Security step: two-step verification is an enum the API requires, so it must be chosen. */
  readonly securityComplete = computed(() => this.localError('mfaRequirement') === null);

  readonly canSubmit = computed(
    () =>
      this.identityComplete() &&
      this.organisationComplete() &&
      this.accessComplete() &&
      this.securityComplete() &&
      !this.submitting(),
  );

  // =========================================================================================
  // Lifecycle
  // =========================================================================================

  ngOnInit(): void {
    // ONE REQUEST. The reference data already carries the enum labels the dropdowns need; they
    // used to be fetched a second time from `/reference-data/enums`.
    this.api.getFormReferenceData().subscribe({
      next: (reference) => {
        this.loading.set(false);
        this.view.set(reference);
        this.enums.set(reference.enums ?? null);

        // Organisation unit deliberately keeps its "Select Organisation Unit" placeholder
        // rather than pre-picking the first unit: the field is optional and is sent as null
        // when left blank, so a guessed default only risks filing someone under the wrong unit.
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.loadFailed.set(true);
        this.errorMessage.set(error.message);
      },
    });
  }

  // =========================================================================================
  // Form helpers
  // =========================================================================================

  update<K extends keyof ReturnType<typeof this.form>>(key: K, value: ReturnType<typeof this.form>[K]): void {
    this.form.update((current) => ({ ...current, [key]: value }));
    this.errorMessage.set('');

    // Editing a field the server complained about clears that complaint, so a stale message
    // cannot sit under a value the person has already corrected.
    const errors = this.serverErrors();
    if (errors[key as string]) {
      const { [key as string]: _removed, ...rest } = errors;
      this.serverErrors.set(rest);
    }
  }

  /**
   * The country codes the form offers.
   *
   * A plain text box here was the cause of a rejected create that the screen could not explain:
   * the API requires the international form (+91), a typed "91" was accepted by the browser, and
   * the failure only surfaced on the very last step. A fixed list cannot produce an invalid value.
   */
  /**
   * Time zones and dialling prefixes from the GlobalMaster catalogue.
   *
   * THIS FORM NEVER ASKS FOR A COUNTRY, which is exactly the case the brief calls out. The
   * cascade is therefore used in its uncountried mode: `geo.timeZones()` holds the FULL zone
   * catalogue from the first render, with no country to link to and nothing thrown. See
   * `GeoMasterService.getTimeZones`.
   *
   * The zone list here used to be five hard-coded <option> elements, one of which - the "UTC"
   * this form still defaults to - existed nowhere in the database.
   */
  protected readonly geo = createGeoCascade();

  /**
   * The dialling prefixes, derived from the countries rather than listed by hand.
   *
   * Was ten literals. A country added on the Masters screen now brings its prefix with it, and
   * the list cannot drift from the country dropdown on the next form along. Duplicates are
   * collapsed - Canada and the United States both dial +1 - and the order follows the country
   * sort order, so +91 stays first.
   */
  protected readonly countryCodes = computed(() => [
    ...new Set(
      this.geo
        .countries()
        .map((country) => country.phoneCountryCode)
        .filter((code): code is string => !!code),
    ),
  ]);

  // =========================================================================================
  // Custom dropdowns — replace every native <select> (see #cuDd in the template)
  // =========================================================================================

  /** Key of the dropdown that is open (the form field it writes), or null. */
  readonly openDd = signal<string | null>(null);

  /** Text typed in the open dropdown's search box. */
  readonly ddQuery = signal('');

  /**
   * Every dropdown's options, normalised to { value, label }.
   *
   * The same sources the old <select> tags read - nothing new is fetched. A computed, so the
   * long catalogues (time zones, languages) are mapped once rather than on every
   * change-detection pass.
   */
  readonly ddOptionMap = computed<Record<string, CuDdOption[]>>(() => {
    const text = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
    const fromEnum = (list: EnumOption[]) => list.map((o) => ({ value: text(o.value), label: text(o.label) }));
    const fromLookup = (list: LookupItem[]) => list.map((o) => ({ value: text(o.id), label: text(o.name) }));

    return {
      accountCategory: fromEnum(this.accountCategories()),
      title: this.titles.map((t) => ({ value: t, label: t })),
      mobileCountryCode: this.countryCodes().map((c) => ({ value: c, label: c })),
      engagementType: fromEnum(this.engagementTypes()),
      organisationUnitId: fromLookup(this.organisationUnits()),
      departmentId: fromLookup(this.departments()),
      // VALUE is the culture code, because users.preferred_language stores exactly that.
      preferredLanguage: this.geo.languages().map((l) => ({ value: text(l.cultureCode), label: text(l.displayLabel) })),
      timeZoneId: this.geo.timeZones().map((z) => ({ value: text(z.ianaKey), label: text(z.name) })),
      primaryRoleId: fromLookup(this.roles()),
      dataScopeType: fromEnum(this.dataScopeTypes()),
      mfaRequirement: fromEnum(this.mfaRequirements()),
    };
  });

  ddOptions(key: string): CuDdOption[] {
    return this.ddOptionMap()[key] ?? [];
  }

  /** Options narrowed by the search box inside the open dropdown. */
  ddFiltered(key: string): CuDdOption[] {
    const q = this.ddQuery().trim().toLowerCase();
    const all = this.ddOptions(key);
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  }

  /**
   * A form field's current value as a string, for the template.
   * Indexing form()[key] directly in the template fails strict mode (TS7053), because an
   * ng-template context variable is `any`.
   */
  formValue(key: string): string {
    const value = (this.form() as unknown as Record<string, unknown>)[key];
    return value === undefined || value === null ? '' : String(value);
  }

  /** Text on the trigger (and in the Review step): the chosen option's label, else the fallback. */
  ddLabel(key: string, placeholder: string): string {
    const value = this.formValue(key);

    if (!value) {
      return placeholder;
    }

    return this.ddOptions(key).find((o) => o.value === value)?.label ?? value;
  }

  toggleDd(key: string): void {
    this.ddQuery.set('');
    this.openDd.update((current) => (current === key ? null : key));
  }

  /** Writes through update(), so clearing a server error on that field still happens. */
  pickDd(key: string, value: string): void {
    this.openDd.set(null);
    this.ddQuery.set('');

    if (this.formValue(key) === value) {
      return;
    }

    this.update(key as keyof ReturnType<typeof this.form>, value as never);
  }

  /** A click anywhere outside a dropdown closes it (clicks inside stop propagation). */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openDd() !== null) {
      this.openDd.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.openDd.set(null);
  }

  /** Fills the display name from the first and last name, until somebody edits it themselves. */
  onNameChanged(): void {
    const f = this.form();
    const suggested = [f.firstName.trim(), f.lastName.trim()].filter(Boolean).join(' ');

    if (suggested && !f.displayName.trim()) {
      this.update('displayName', suggested);
    }
  }

  /** Suggests a username from the e-mail, which is what most people would type anyway. */
  onEmailChanged(): void {
    const f = this.form();

    // Letters and digits only - the username rule, on this form and on the server. The raw local
    // part ("first.last") was suggested as-is and then rejected by the very next check.
    const suggestion = f.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');

    if (f.email.includes('@') && !f.username.trim() && suggestion) {
      this.update('username', suggestion);
    }

    this.checkIdentity();
  }

  /**
   * Asks the server whether the e-mail or username is already taken, without naming the owner.
   *
   * NO ORGANISATION IS SENT. The check runs inside whichever Organisation the token names, which
   * is exactly the scope the uniqueness rule uses: the same address may exist in another
   * Organisation and that is not a clash. Passing an id from the browser would let the check be
   * aimed at somebody else's Organisation and answer a question about their people.
   */
  checkIdentity(): void {
    const f = this.form();

    if (!f.email.trim() && !f.username.trim()) {
      return;
    }

    this.identityCheck.set({ checking: true, message: '', ok: false, suggestions: [] });

    this.api
      .checkIdentity({
        email: f.email.trim() || undefined,
        username: f.username.trim() || undefined,
      })
      .subscribe({
      next: (outcome) =>
        this.identityCheck.set({
          checking: false,
          message: outcome.message ?? '',
          ok: outcome.isAvailable === true,
          suggestions: outcome.suggestions ?? [],
        }),
      // A failed check must not block the form. The server validates again on create, so the
      // worst case is finding out one step later rather than here.
      error: () => this.identityCheck.set(null),
    });
  }

  // =========================================================================================
  // Navigation
  // =========================================================================================

  goToStep(index: number): void {
    this.openDd.set(null);

    // Forward movement is gated on the current step being complete; going back never is, so a
    // half-finished form is never a trap.
    if (index <= this.activeStep() || this.isStepComplete(this.activeStep())) {
      this.activeStep.set(index);
      this.submitted.set(false);
    }
  }

  nextStep(): void {
    this.openDd.set(null);

    if (!this.isStepComplete(this.activeStep())) {
      this.submitted.set(true);
      this.errorMessage.set(`Please correct: ${this.invalidLabels(this.activeStep()).join(', ')}.`);
      this.focusFirstInvalid(this.activeStep());
      return;
    }

    // The e-mail / username check is the server's word on "already in use": stay here until it is clean.
    if (this.activeStep() === 0 && !this.identityPasses()) {
      return;
    }

    this.activeStep.update((step) => Math.min(step + 1, this.steps.length - 1));
    this.submitted.set(false);
  }

  /** False (with the message under the field) while the server says the e-mail or username is taken. */
  private identityPasses(): boolean {
    const check = this.identityCheck();

    if (!check) {
      return true;
    }

    if (check.checking) {
      this.errorMessage.set('Still checking the e-mail and username. Try again in a moment.');
      return false;
    }

    if (check.ok) {
      return true;
    }

    const field = /user ?name/i.test(check.message) ? 'username' : 'email';
    this.serverErrors.update((current) => ({ ...current, [field]: check.message || 'That value is not available.' }));
    this.submitted.set(true);
    this.errorMessage.set(check.message);
    this.focusFirstInvalid(0);
    return false;
  }

  previousStep(): void {
    this.openDd.set(null);
    this.activeStep.update((step) => Math.max(step - 1, 0));
  }

  /**
   * Share of ALL user-fillable fields that have a value, for the stepper's progress line.
   * Mandatory AND optional both move it: filling an optional field (middle name, designation,
   * welcome message…) raises the percentage the same as filling a required one.
   *
   * System-defaulted fields (preferred language, time zone, access start date) and the
   * send-invitation toggle are excluded — they already have values before the person types
   * anything, so counting them would start a fresh form above 0% without any effort.
   * The Review step has nothing to fill in, so it is not counted either.
   */
  progressPct(): number {
    const checks = this.allFieldChecks();
    const done = checks.filter(Boolean).length;
    if (checks.length === 0) { return 0; }
    return Math.round((done / checks.length) * 100);
  }

  /**
   * One boolean per fillable field, so the progress line moves with every field filled in
   * rather than jumping a quarter at a time when a whole step happens to be complete.
   * Business justification counts once it reaches its usable length (10+ characters).
   */
  private allFieldChecks(): boolean[] {
    const f = this.form();
    const filled = (value: unknown): boolean =>
      typeof value === 'string' ? value.trim().length > 0 : Boolean(value);

    return [
      // Identity — every box on the step, not just the asterisked ones.
      filled(f.accountCategory),
      filled(f.title),
      filled(f.firstName),
      filled(f.middleName),
      filled(f.lastName),
      filled(f.displayName),
      filled(f.preferredName),
      filled(f.email),
      filled(f.username),
      filled(f.mobileCountryCode),
      filled(f.mobileNumber),
      filled(f.employeeNumber),
      // Organisation.
      filled(f.engagementType),
      filled(f.organisationUnitId),
      filled(f.departmentId),
      filled(f.designation),
      filled(f.workLocation),
      // Access.
      filled(f.primaryRoleId),
      filled(f.dataScopeType),
      filled(f.accessEndsAt),
      f.businessJustification.trim().length >= 10,
      // Security.
      filled(f.mfaRequirement),
      filled(f.welcomeMessage),
    ];
  }

  isStepComplete(index: number): boolean {
    switch (index) {
      case 0: return this.identityComplete();
      case 1: return this.organisationComplete();
      case 2: return this.accessComplete();
      case 3: return this.securityComplete();
      default: return true;
    }
  }

  isFieldInvalid(field: string): boolean {
    // A field the server rejected is invalid whatever the local rules think - its rules are the
    // ones that actually decide whether the create succeeds. Otherwise it is this screen's rules,
    // shown once the person has tried to continue.
    return this.errorFor(field) !== null;
  }

  // =========================================================================================
  // Submit
  // =========================================================================================

  /** Creates the account and sends the invitation e-mail. */
  createAndInvite(): void {
    this.submit(true);
  }

  /** Creates the account and leaves the invitation for later. */
  createWithoutInvite(): void {
    this.submit(false);
  }

  private submit(sendInvitation: boolean): void {
    this.submitted.set(true);

    if (!this.canSubmit()) {
      const bad = [0, 1, 2, 3].flatMap((step) => this.invalidLabels(step));
      this.errorMessage.set(`Please correct: ${bad.join(', ')}.`);
      const stepWithError = [0, 1, 2, 3].find((step) => !this.isStepComplete(step));
      if (stepWithError !== undefined) {
        this.activeStep.set(stepWithError);
        this.focusFirstInvalid(stepWithError);
      }
      return;
    }

    // The Organisation comes from the token, never from this form - see checkIdentity above.
    if (!this.tokens.tenant()?.tenantId && !this.tokens.isSuperAdmin()) {
      this.errorMessage.set('Your session is not operating in an organisation. Sign in again.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    const f = this.form();

    // NO ORGANISATION FIELD. It comes from the signed token; an id from this form would let
    // the request be aimed at somebody else's Organisation.
    //
    // EVERY FIELD THE FORM COLLECTS IS SENT. Title, preferred name, work location, language, time
    // zone, the business justification and the data scope were all asked for and then left out
    // of this object, so each was typed in and discarded - the justification the form insists
    // is "recorded in the audit trail" included.
    const request: CreateUserRequest = {
      title: f.title.trim() || null,
      firstName: f.firstName.trim(),
      middleName: f.middleName || null,
      lastName: f.lastName.trim(),
      displayName: f.displayName.trim(),
      preferredName: f.preferredName.trim() || null,
      email: f.email.trim().toLowerCase(),
      username: f.username.trim().toLowerCase() || null,
      employeeNumber: f.employeeNumber || null,
      mobileCountryCode: f.mobileNumber ? f.mobileCountryCode : null,
      mobileNumber: f.mobileNumber || null,

      accountCategory: f.accountCategory as CreateUserRequest['accountCategory'],
      engagementType: f.engagementType as CreateUserRequest['engagementType'],
      organisationUnitId: f.organisationUnitId || null,
      departmentId: f.departmentId || null,
      designation: f.designation || null,
      workLocation: f.workLocation.trim() || null,
      managerUserId: null,

      // Null inherits the Organisation's defaults.
      preferredCulture: f.preferredLanguage || null,
      timeZone: f.timeZoneId || null,

      // Dates go over the wire as UTC instants, not as the local strings the pickers produce.
      accessStartsAtUtc: f.accessStartsAt ? new Date(f.accessStartsAt).toISOString() : null,
      accessEndsAtUtc: f.accessEndsAt ? new Date(f.accessEndsAt).toISOString() : null,

      mfaRequirement: f.mfaRequirement as CreateUserRequest['mfaRequirement'],
      roleIds: f.primaryRoleId ? [f.primaryRoleId] : [],

      // "Whole organisation" is the absence of a narrowing scope, so it sends nothing. "What they
      // are assigned" is a real narrowing; the server fills in its value (the new account
      // itself), which this form cannot know yet.
      dataScopes: f.dataScopeType.toLowerCase() === 'assignment'
        ? [{ scopeType: 'assignment', scopeValue: '' }]
        : [],
      justification: f.businessJustification.trim() || null,

      // The person sets their own password from the e-mailed link, so no temporary password is
      // ever generated, written down, or sent anywhere.
      credentialSetupMethod: 'invitationLink',
      sendInvitation,
      invitationMessage: f.welcomeMessage || null,
    };

    this.api.createUser(request).subscribe({
      next: (user) => {
        this.submitting.set(false);

        this.createdUser.set({
          code: user.code ?? '',
          displayName: user.displayName ?? '',
          email: user.email ?? '',
          requestedInvite: sendInvitation,
          invitationStatus: user.invitationSent ? 'Sent' : 'NotSent',
        });

        // `invitationSent` reports what actually happened, not what was asked for. Delivery can
        // fail after the account is safely created, and saying "invitation sent" when it was not
        // is how somebody waits three days for an e-mail that never left.
        const delivered = user.invitationSent === true;

        this.toast.show(
          'Account created',
          !sendInvitation
            ? `${user.displayName} was created. No invitation was sent yet.`
            : delivered
              ? `${user.displayName} has been e-mailed an invitation link.`
              : `${user.displayName} was created, but the invitation e-mail could not be sent.`,
          delivered || !sendInvitation ? 'success' : 'warning',
        );
      },
      error: (error: Error) => {
        this.submitting.set(false);
        this.errorMessage.set(error.message);
        this.applyServerErrors(error);
      },
    });
  }

  /**
   * Turns the API's `errors` array into per-field messages and jumps to the earliest step that
   * has one, so "review the highlighted fields" actually has something highlighted to look at.
   */
  private applyServerErrors(error: Error): void {
    // The interceptor copies the envelope's `errors` onto the error object. Reading it through a
    // cast keeps that contract in one place rather than widening the type everywhere.
    const details = (error as { validationErrors?: { field: string; message: string }[] }).validationErrors ?? [];

    if (details.length === 0) {
      this.serverErrors.set({});
      return;
    }

    const mapped: Record<string, string> = {};
    for (const detail of details) {
      // The API camel-cases its field names; guard anyway so an unexpected casing still shows.
      const key = detail.field.charAt(0).toLowerCase() + detail.field.slice(1);
      mapped[key] = detail.message;
    }

    this.serverErrors.set(mapped);
    this.submitted.set(true);

    const firstStep = Math.min(...Object.keys(mapped).map((f) => CreateUserComponent.FIELD_STEP[f] ?? 0));
    if (Number.isFinite(firstStep)) {
      this.activeStep.set(firstStep);
    }
  }

  // =========================================================================================
  // After creation
  // =========================================================================================

  createAnother(): void {
    this.createdUser.set(null);
    this.activeStep.set(0);
    this.submitted.set(false);
    this.identityCheck.set(null);

    this.form.update((current) => ({
      ...current,
      title: '',
      firstName: '',
      middleName: '',
      lastName: '',
      displayName: '',
      preferredName: '',
      email: '',
      username: '',
      mobileNumber: '',
      employeeNumber: '',
      designation: '',
      workLocation: '',
      businessJustification: '',
      welcomeMessage: '',
    }));
  }

  // ---- Leaving halfway --------------------------------------------------------------------------

  readonly showLeaveDialog = signal(false);
  private leaveDecision: ((leave: boolean) => void) | null = null;

  /**
   * Set only for the single navigation that follows a confirmed Cancel, so the pending-changes
   * guard waves that navigation through instead of asking again. The next visit constructs a
   * fresh component, so no reset is needed.
   */
  private cancelling = false;

  /** Anything typed, and not yet turned into a user. */
  hasUnsavedWork(): boolean {
    return !this.createdUser() && JSON.stringify(this.form()) !== this.pristine;
  }

  /**
   * Footer Cancel: with nothing typed it simply returns; with a half-filled form it reuses the
   * same "leave without creating?" dialog as the route guard, then navigates once confirmed.
   * Blocked while a create is in flight, matching the footer's disabled state, and while the
   * leave dialog is already open (a guard-driven prompt owns it then).
   */
  onCancel(): void {
    if (this.submitting() || this.showLeaveDialog()) {
      return;
    }

    if (!this.hasUnsavedWork()) {
      this.goBack();
      return;
    }

    this.leaveDecision = (leave: boolean) => {
      if (leave) {
        this.goBackBypassingGuard();
      }
    };
    this.showLeaveDialog.set(true);
  }

  /** Called by the route guard: asks before throwing away a half-filled form. */
  canDeactivate(): boolean | Promise<boolean> {
    if (this.cancelling || !this.hasUnsavedWork()) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      this.leaveDecision = resolve;
      this.showLeaveDialog.set(true);
    });
  }

  resolveLeave(leave: boolean): void {
    this.showLeaveDialog.set(false);
    const decision = this.leaveDecision;
    this.leaveDecision = null;
    // Guard-driven leaves resolve the guard's promise (the router then navigates itself);
    // Cancel-driven leaves navigate inside the callback set by `onCancel`.
    decision?.(leave);
  }

  /** Closing the tab or reloading gets the browser's own prompt. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedWork()) {
      event.preventDefault();
    }
  }

  goBack(): void {
    this.navHistory.back(['/app/administration/access/user-directory']);
  }

  /**
   * Navigation after a confirmed Cancel. The flag stays set until the router has left this
   * screen, so `canDeactivate` waves that single navigation through instead of asking again.
   * The next visit constructs a fresh component, so no reset is needed.
   */
  private goBackBypassingGuard(): void {
    this.cancelling = true;
    void this.router.navigate(['/app/administration/access/user-directory']);
  }
}