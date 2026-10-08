import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, map, takeUntil } from 'rxjs';
import { PaymentGatewayConfigApiService } from '../../../../Service/payment-gateway-config-api.service';
import { GeoMasterService } from '../../../../Shared/services/geo-master.service';
import { apiErrorMessage, apiFieldErrors } from '../../../../Shared/models/api-response.model';
import { httpsUrlError, identifierError, maxLengthError, rangeError, requiredError, webUrlError } from '../../../../Shared/validation/field-rules';
import {
  PaymentGatewayAuditEntry,
  PaymentGatewayCatalogue,
  PaymentGatewayConfiguration,
  PaymentGatewayEnvironment,
  PaymentGatewayPermissions,
  PaymentGatewayProviderOption,
  PaymentGatewayTestResult,
  UpsertPaymentGatewayConfigurationRequest,
} from '../../../../Shared/models/payment-gateway-config.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { PopupComponent } from '../../../../Shared/components/popup/popup';
import { ClickOutsideDirective } from '../../../../Shared/directives/click-outside';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
/**
 * The editable state of the form.
 *
 * THE THREE CREDENTIAL FIELDS START EMPTY ON AN EDIT AND STAY EMPTY UNLESS SOMEBODY TYPES, and
 * that is the whole reason this is a separate shape rather than the response object with a few
 * fields added. The API never returns a credential, so there is nothing to prefill; sending
 * whatever happens to be in the box would send an empty string, and an empty string means
 * "clear it".
 *
 * `clearApiKey` and its two siblings are how a deliberate clear is expressed instead — a
 * checkbox somebody has to tick, which is a different act from leaving a field alone.
 */
interface GatewayFormState {
  id: string | null;
  provider: string;
  environment: PaymentGatewayEnvironment;
  displayName: string;
  merchantId: string;
  apiKey: string;
  secretKey: string;
  webhookUrl: string;
  webhookSecret: string;
  clearApiKey: boolean;
  clearSecretKey: boolean;
  clearWebhookSecret: boolean;
  subscribedEvents: string[];
  settlementCurrencyCode: string;
  returnUrl: string;
  paymentLinkValidityMinutes: number;
  enabledMethods: string[];
  isActive: boolean;
  notes: string;
  reason: string;
  version: number | null;
  /** What the record looked like when the form loaded, for the has-a-secret hints. */
  existing: PaymentGatewayConfiguration | null;
}

type ViewMode = 'list' | 'form' | 'detail';

/**
 * Payment gateway configuration.
 *
 * WHERE AN ORGANISATION SAYS WHICH PROVIDER TAKES ITS DONATIONS, WITH WHICH CREDENTIALS, AND
 * WHERE THE PROVIDER SHOULD POST BACK TO. Only SUPERADMIN and TENANTADMIN reach it: the four
 * permission codes behind it are administrator-only on the server, so no other role carries one
 * however an organisation configures its roles.
 *
 * FOUR THINGS ABOUT THIS SCREEN ARE WORTH KNOWING BEFORE READING THE CODE.
 *
 * 1. THE LIST SHOWS TWO KINDS OF ROW. `Configured` rows were entered here. `Deployment` rows are
 *    the gateways the payments service built from the deployment's own environment — every
 *    organisation on this platform has one, and they are what took donations before this screen
 *    existed. They are read-only here, because their credentials live in the environment and the
 *    API can neither read nor change them. Hiding them would open this page on "nothing
 *    configured" for an organisation whose donations work perfectly.
 *
 * 2. IT NEVER RECEIVES A CREDENTIAL. The API returns a masked hint — `rzp_test_........4f2a` —
 *    and three booleans. There is no reveal button because there is no endpoint behind one, and
 *    adding one would put a merchant secret in the browser's memory and its dev tools for a
 *    convenience nobody needs. A key can be replaced; it cannot be read back.
 *
 * 3. THE SERVER DECIDES WHAT MAY BE DONE. Every action renders from `permittedActions` on the
 *    record rather than from a rule written here, so the buttons cannot disagree with what the
 *    API will allow — including the one that matters: delete is not offered on an active
 *    configuration, because removing the row donations are flowing through stops every payment
 *    for that organisation the moment it commits.
 *
 * 4. THE ENVIRONMENT WARNING IS THE MOST USEFUL THING ON THE PAGE. A live key pasted into a row
 *    marked Sandbox is the expensive mistake this form exists to absorb — it moves real money
 *    whatever the label says — so the key prefix is checked against the chosen environment as
 *    somebody types, before Save is ever pressed. The server checks it again.
 */
@Component({
  selector: 'app-payment-gateway-configuration',
  standalone: true,
  imports: [RowsPerPage, PopupComponent, CommonModule, FormsModule, ClickOutsideDirective],
  templateUrl: './payment-gateway-configuration.html',
  styleUrl: './payment-gateway-configuration.css',
})
export class PaymentGatewayConfigurationComponent implements OnInit, OnDestroy {
  private readonly api = inject(PaymentGatewayConfigApiService);
  private readonly tokens = inject(AuthTokenService);
  private readonly toast = inject(ToastService);
  private readonly geo = inject(GeoMasterService);

  private readonly destroy$ = new Subject<void>();

  // ---- Page state ------------------------------------------------------------------------------
  readonly view = signal<ViewMode>('list');
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly errorMessage = signal('');
  readonly saving = signal(false);
  readonly testing = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);
  /** The row whose "More" action menu is open (one at a time). */
  readonly menuFor = signal<string | null>(null);

  toggleMenu(id: string): void {
    this.menuFor.set(this.menuFor() === id ? null : id);
  }

  readonly catalogue = signal<PaymentGatewayCatalogue | null>(null);
  readonly configurations = signal<PaymentGatewayConfiguration[]>([]);
  readonly totalCount = signal(0);

  /** Field-level messages from the server, keyed by control name. */
  readonly fieldErrors = signal<Record<string, string>>({});

  /** The most recent test result, shown inline against the row it belongs to. */
  readonly testResult = signal<PaymentGatewayTestResult | null>(null);

  /** The row the detail screen shows, if any. */
  readonly selected = signal<PaymentGatewayConfiguration | null>(null);

  // ---- Filters ---------------------------------------------------------------------------------
  readonly filterProvider = signal('');
  readonly filterEnvironment = signal('');
  readonly filterStatus = signal('');
  readonly filterSearch = signal('');
  readonly page = signal(1);
  readonly pageSize = signal(10);

  // ---- Change log ------------------------------------------------------------------------------
  readonly auditEntries = signal<PaymentGatewayAuditEntry[]>([]);
  readonly auditTotal = signal(0);
  readonly auditPage = signal(1);
  readonly auditPageSize = signal(10);
  readonly auditLoading = signal(false);
  readonly auditAction = signal('');
  readonly auditFrom = signal('');
  readonly auditTo = signal('');
  /** Null means "every configuration in scope"; set when the panel is opened from one row. */
  readonly auditConfigurationId = signal<string | null>(null);
  readonly auditVisible = signal(true);

  // ---- Delete confirmation ----------------------------------------------------------------------
  readonly deleteTarget = signal<PaymentGatewayConfiguration | null>(null);
  readonly deleteReason = signal('');

  // ---- The form ----------------------------------------------------------------------------------
  readonly form = signal<GatewayFormState>(PaymentGatewayConfigurationComponent.emptyForm());

  // ---- Caller capability -------------------------------------------------------------------------
  readonly canManage = computed(() => this.tokens.hasPermission(PaymentGatewayPermissions.manage));
  readonly canTest = computed(() => this.tokens.hasPermission(PaymentGatewayPermissions.test));
  readonly isSuperAdmin = computed(() => this.tokens.isSuperAdmin());
  readonly organisationName = computed(() => this.tokens.organisationName());

  readonly auditActions = [
    'Created', 'Updated', 'Activated', 'Deactivated', 'Deleted', 'Tested', 'CredentialsRotated',
  ];

  /** The currencies offered on the form. */
  /**
   * The settlement currencies on offer: the Currency master's active rows, by code.
   *
   * WAS SEVEN CODES TYPED HERE. A currency added on the Masters screen never appeared, one retired
   * there stayed selectable, and the server - which accepts any three-letter code - had no reason
   * to object. The stored value of the configuration being edited is kept in the list even if it
   * has since left the master, so opening an old configuration never silently blanks it.
   */
  private readonly currencyCodes = toSignal(
    this.geo.getCurrencies().pipe(
      map((currencies) => currencies
        .filter((currency) => !currency.status || currency.status === 'active')
        .map((currency) => currency.code))),
    { initialValue: [] as string[] });

  get currencies(): string[] {
    const codes = this.currencyCodes();
    const current = this.form().settlementCurrencyCode;

    return current && !codes.includes(current) ? [current, ...codes] : codes;
  }

  // =============================================================================================
  // Summary tiles
  // =============================================================================================

  /**
   * The counters across the top.
   *
   * THEY COUNT THE PAGE, NOT THE WHOLE SET, and that is honest rather than convenient: the API
   * returns one page, and a tile claiming a platform-wide total from a page of ten would be
   * wrong the moment there were eleven. `totalCount` is shown separately and IS the whole set.
   */
  readonly liveCount = computed(
    () => this.configurations().filter((row) => row.isActive && !row.isSuperseded).length,
  );

  readonly configuredCount = computed(
    () => this.configurations().filter((row) => row.source === 'Configured').length,
  );

  readonly inheritedCount = computed(
    () => this.configurations().filter((row) => row.source === 'Deployment').length,
  );

  readonly needsAttentionCount = computed(
    () => this.configurations().filter((row) => this.needsAttention(row)).length,
  );

  /**
   * A row somebody should look at.
   *
   * ACTIVE BUT INCOMPLETE, or active with a failing test. Both are states where the screen says
   * "Active" and a donor would meet an error, which is the gap this tile exists to close.
   */
  needsAttention(row: PaymentGatewayConfiguration): boolean {
    if (row.source === 'Deployment' || !row.isActive) {
      return false;
    }

    return !row.hasApiKey || !row.hasSecretKey || row.lastTestSucceeded === false;
  }

  // =============================================================================================
  // Lifecycle
  // =============================================================================================

  ngOnInit(): void {
    this.loadCatalogue();
    this.load();
    this.loadAudit();

    // Search filters while typing: wait for a short pause so each keystroke is not a request.
    this.searchTyped$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(() => this.applyFilters());
  }

  private readonly searchTyped$ = new Subject<void>();

  onSearchInput(value: string): void {
    this.filterSearch.set(value);
    this.searchTyped$.next();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // =============================================================================================
  // Loading
  // =============================================================================================

  /**
   * The provider list and its labels.
   *
   * A FAILURE HERE IS NOT FATAL TO THE SCREEN. The list of stored configurations still renders
   * and can still be activated, deactivated and tested; only the form needs the catalogue, and
   * it says so rather than the whole page showing an error.
   */
  private loadCatalogue(): void {
    this.api
      .getCatalogue()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (catalogue) => this.catalogue.set(catalogue),
        error: (error: unknown) =>
          this.toast.warning(
            'Provider list unavailable',
            apiErrorMessage(error, 'The list of payment providers could not be loaded.'),
          ),
      });
  }

  load(): void {
    this.loading.set(true);
    this.loadFailed.set(false);

    this.api
      .search({
        provider: this.filterProvider() || undefined,
        environment: this.filterEnvironment() || undefined,
        isActive: this.filterStatus() === '' ? undefined : this.filterStatus() === 'active',
        search: this.filterSearch().trim() || undefined,
        page: this.page(),
        pageSize: this.pageSize(),
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (page) => {
          this.configurations.set(page.items ?? []);
          this.totalCount.set(page.totalCount ?? 0);
          this.loading.set(false);

          // THE DETAIL SCREEN FOLLOWS THE FRESH ROW, so a test or a status change shows on it at
          // once. A row that has dropped off the page (a filter, a page change) keeps its last copy
          // while its screen is open.
          const open = this.selected();
          const fresh = open ? this.configurations().find((row) => row.id === open.id) : undefined;

          if (fresh) {
            this.selected.set(fresh);
          } else if (open && this.view() !== 'detail') {
            this.selected.set(null);
          }
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadFailed.set(true);
          this.errorMessage.set(
            apiErrorMessage(error, 'The gateway configurations could not be loaded.'),
          );
        },
      });
  }

  loadAudit(): void {
    this.auditLoading.set(true);

    this.api
      .searchAudit({
        configurationId: this.auditConfigurationId() ?? undefined,
        action: this.auditAction() || undefined,
        fromUtc: this.auditFrom() ? new Date(this.auditFrom()).toISOString() : undefined,
        // THE WHOLE OF THE END DAY, not the midnight that starts it. A filter reading
        // "to 12 March" that excluded everything done on 12 March would be quietly wrong.
        toUtc: this.auditTo()
          ? new Date(new Date(this.auditTo()).setHours(23, 59, 59, 999)).toISOString()
          : undefined,
        page: this.auditPage(),
        pageSize: this.auditPageSize(),
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (page) => {
          this.auditEntries.set(page.items ?? []);
          this.auditTotal.set(page.totalCount ?? 0);
          this.auditLoading.set(false);
        },
        error: () => {
          this.auditEntries.set([]);
          this.auditLoading.set(false);
        },
      });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.filterProvider.set('');
    this.filterEnvironment.set('');
    this.filterStatus.set('');
    this.filterSearch.set('');
    this.page.set(1);
    this.load();
  }

  readonly hasFilters = computed(
    () => this.filterProvider() !== ''
      || this.filterEnvironment() !== ''
      || this.filterStatus() !== ''
      || this.filterSearch().trim().length > 0,
  );

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));

  readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.page();

    // A window of five around the current page. A pager listing forty numbers is a pager
    // nobody can use.
    const first = Math.max(1, Math.min(current - 2, total - 4));
    const last = Math.min(total, first + 4);

    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  });

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.page()) {
      return;
    }

    this.page.set(page);
    this.load();
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
    this.load();
  }

  // =============================================================================================
  // The form
  // =============================================================================================

  private static emptyForm(): GatewayFormState {
    return {
      id: null,

      // DEFAULT: NONE SELECTED. A form that opened on Razorpay would have somebody half-fill a
      // provider they never chose.
      provider: '',

      // AND SANDBOX BY DEFAULT. The safe half of the toggle: a sandbox row that should have been
      // production takes no money, and somebody notices. The reverse takes real money.
      environment: 'Sandbox',
      displayName: '',
      merchantId: '',
      apiKey: '',
      secretKey: '',
      webhookUrl: '',
      webhookSecret: '',
      clearApiKey: false,
      clearSecretKey: false,
      clearWebhookSecret: false,
      subscribedEvents: ['payment.success', 'payment.failure'],
      settlementCurrencyCode: '',
      returnUrl: '',
      paymentLinkValidityMinutes: 60,
      enabledMethods: [],
      isActive: false,
      notes: '',
      reason: '',
      version: null,
      existing: null,
    };
  }

  /**
   * The gateway whose detail screen opened the form, so Cancel and Save go back to it rather than
   * dropping the operator on the list they never asked for.
   */
  private formOrigin: PaymentGatewayConfiguration | null = null;

  private rememberOrigin(): void {
    this.formOrigin = this.view() === 'detail' ? this.selected() : null;
  }

  startCreate(): void {
    this.formOrigin = null;
    this.fieldErrors.set({});
    this.formTried.set(false);
    this.formTouched.set(new Set());
    this.testResult.set(null);
    this.selected.set(null);
    this.form.set(PaymentGatewayConfigurationComponent.emptyForm());
    this.view.set('form');
  }

  /**
   * Opens a new configuration pre-filled from a deployment row.
   *
   * WHAT IS CARRIED OVER AND WHAT IS NOT. The provider, merchant id, currency and URLs come
   * across, because they are facts about the merchant account that are already true and retyping
   * them is an invitation to mistype one. THE CREDENTIALS DO NOT, and cannot: they live in the
   * deployment's environment and this application has never been able to read them. That is the
   * point of the exercise — the administrator is taking ownership of the keys, not copying them.
   */
  startCreateFrom(row: PaymentGatewayConfiguration): void {
    this.rememberOrigin();
    this.formTried.set(false);
    this.formTouched.set(new Set());
    this.fieldErrors.set({});
    this.testResult.set(null);
    this.selected.set(null);

    this.form.set({
      ...PaymentGatewayConfigurationComponent.emptyForm(),
      provider: row.provider,
      environment: row.environment,
      merchantId: row.merchantId ?? '',
      webhookUrl: row.webhookUrl ?? '',
      returnUrl: row.returnUrl ?? '',
      settlementCurrencyCode: row.settlementCurrencyCode || '',
      paymentLinkValidityMinutes: row.paymentLinkValidityMinutes || 60,
      enabledMethods: [...row.enabledMethods],
    });

    this.view.set('form');
  }

  /**
   * Opens an existing configuration.
   *
   * NOTHING IS PUT IN THE THREE CREDENTIAL BOXES, because there is nothing to put there — see
   * the interface comment. What the form shows instead is the hint and "a secret is stored", so
   * an operator can tell whether the key on screen is the one their provider dashboard shows.
   */
  startEdit(configuration: PaymentGatewayConfiguration): void {
    this.formTried.set(false);
    this.formTouched.set(new Set());
    this.rememberOrigin();
    this.fieldErrors.set({});
    this.testResult.set(null);
    this.selected.set(null);

    this.form.set({
      id: configuration.id,
      provider: configuration.provider,
      environment: configuration.environment,
      displayName: configuration.displayName ?? '',
      merchantId: configuration.merchantId ?? '',
      apiKey: '',
      secretKey: '',
      webhookUrl: configuration.webhookUrl ?? '',
      webhookSecret: '',
      clearApiKey: false,
      clearSecretKey: false,
      clearWebhookSecret: false,
      subscribedEvents: [...configuration.subscribedEvents],
      settlementCurrencyCode: configuration.settlementCurrencyCode,
      returnUrl: configuration.returnUrl ?? '',
      paymentLinkValidityMinutes: configuration.paymentLinkValidityMinutes,
      enabledMethods: [...configuration.enabledMethods],
      isActive: configuration.isActive,
      notes: configuration.notes ?? '',
      reason: '',
      version: configuration.version,
      existing: configuration,
    });

    this.view.set('form');
  }

  cancelForm(): void {
    this.fieldErrors.set({});
    const origin = this.formOrigin;
    this.formOrigin = null;

    if (origin) {
      this.openDetails(origin);
    } else {
      this.view.set('list');
    }
  }

  patch<K extends keyof GatewayFormState>(key: K, value: GatewayFormState[K]): void {
    this.form.update((state) => ({ ...state, [key]: value }));

    // Editing a field the server complained about clears that complaint.
    const errors = this.fieldErrors();
    const stale = Object.keys(errors).filter((name) => name.toLowerCase() === String(key).toLowerCase());
    if (stale.length > 0) {
      const rest = { ...errors };
      for (const name of stale) delete rest[name];
      this.fieldErrors.set(rest);
    }
  }

  toggleEvent(code: string, checked: boolean): void {
    this.form.update((state) => ({
      ...state,
      subscribedEvents: checked
        ? [...new Set([...state.subscribedEvents, code])]
        : state.subscribedEvents.filter((item) => item !== code),
    }));
  }

  toggleMethod(code: string, checked: boolean): void {
    this.form.update((state) => ({
      ...state,
      enabledMethods: checked
        ? [...new Set([...state.enabledMethods, code])]
        : state.enabledMethods.filter((item) => item !== code),
    }));
  }

  /** The descriptor for whichever provider is selected, for the field labels. */
  readonly selectedProvider = computed<PaymentGatewayProviderOption | null>(() => {
    const code = this.form().provider;

    return this.catalogue()?.providers.find((provider) => provider.code === code) ?? null;
  });

  /**
   * The warning that earns this screen its keep.
   *
   * A LIVE KEY IN A SANDBOX ROW MOVES REAL MONEY, whatever the row says, and somebody who has
   * just pasted one has no reason to look again. The reverse — a test key in a production row —
   * takes no money at all, which is embarrassing but recoverable, so it is worded more mildly.
   *
   * IT IS ADVISORY, NOT A GATE. The server checks the same thing on Test and on activation; this
   * simply catches it a minute earlier, while the dashboard is still open in the other window.
   */
  readonly keyEnvironmentWarning = computed<string | null>(() => {
    const state = this.form();
    const provider = this.selectedProvider();
    const key = state.apiKey.trim();

    if (!provider || key.length === 0) {
      return null;
    }

    if (
      provider.liveKeyPrefix &&
      state.environment === 'Sandbox' &&
      key.toLowerCase().startsWith(provider.liveKeyPrefix.toLowerCase())
    ) {
      return (
        `This looks like a LIVE ${provider.name} key, but the environment is set to Sandbox. ` +
        'A live key moves real money whatever this row says.'
      );
    }

    if (
      provider.testKeyPrefix &&
      state.environment === 'Production' &&
      key.toLowerCase().startsWith(provider.testKeyPrefix.toLowerCase())
    ) {
      return (
        `This looks like a TEST ${provider.name} key in a row marked Production. ` +
        'No donation through it would reach the bank account.'
      );
    }

    return null;
  });

  /** The webhook address to paste into the provider's dashboard, for the chosen provider. */
  readonly suggestedWebhookUrl = computed(() => {
    const template = this.catalogue()?.webhookUrlTemplate;
    const provider = this.form().provider;

    return template && provider ? template.replace('{provider}', provider.toLowerCase()) : null;
  });

  useSuggestedWebhookUrl(): void {
    const suggested = this.suggestedWebhookUrl();

    if (suggested) {
      this.patch('webhookUrl', suggested);
    }
  }

  // =============================================================================================
  // Validation
  // =============================================================================================

  /** Set once Save has been pressed; until then only fields already left show messages. */
  readonly formTried = signal(false);
  readonly formTouched = signal<ReadonlySet<string>>(new Set());

  private static readonly FIELD_LABELS: Record<string, string> = {
    provider: 'Payment gateway', displayName: 'Display name', merchantId: 'Merchant ID',
    settlementCurrencyCode: 'Settlement currency', webhookUrl: 'Webhook URL', returnUrl: 'Return URL',
    paymentLinkValidityMinutes: 'Link validity',
  };

  /** Element ids, in page order, to move focus to the first invalid field. */
  private static readonly FIELD_IDS: Record<string, string> = {
    provider: 'pg-provider', displayName: 'pg-name', merchantId: 'pg-merchant', webhookUrl: 'pg-hook',
    settlementCurrencyCode: 'pg-currency', paymentLinkValidityMinutes: 'pg-validity', returnUrl: 'pg-return',
  };

  /**
   * What is wrong with each field right now (null = fine). The limits are the API's: link validity
   * 15-1440 minutes, URLs and credentials up to 500 characters, display name and merchant ID up to 150.
   *
   * THE TWO ADDRESSES MUST BE HTTPS IN PRODUCTION ONLY, as the API rules them. A sandbox runs on a
   * developer's own machine, and the webhook address "Use ours" fills in there is http.
   */
  private formRules(): Record<string, string | null> {
    const state = this.form();
    const name = state.displayName.trim();
    const urlError = state.environment === 'Production' ? httpsUrlError : webUrlError;
    return {
      provider: state.provider ? null : 'Choose a payment gateway.',
      displayName: !name ? null
        : !/\p{L}/u.test(name) ? 'Display name must contain letters.'
        : !/^[\p{L}\p{N} ._-]+$/u.test(name) ? 'Display name can contain letters, digits, spaces, dot, hyphen and underscore only.'
        : maxLengthError(name, 150),
      merchantId: identifierError('Merchant ID', state.merchantId, { max: 150 }),
      webhookUrl: urlError('Webhook URL', state.webhookUrl, { required: true, max: 500 }),
      settlementCurrencyCode: requiredError('Settlement currency', state.settlementCurrencyCode),
      paymentLinkValidityMinutes: rangeError('Link validity', state.paymentLinkValidityMinutes, 15, 1440),
      returnUrl: urlError('Return URL', state.returnUrl, { max: 500 }),
    };
  }

  /** The message under a field: the server's own, else this form's once the field was left or Save pressed. */
  fieldError(field: string): string | null {
    const errors = this.fieldErrors();
    const server = errors[field] ?? errors[field.charAt(0).toUpperCase() + field.slice(1)];
    if (server) return server;
    return this.formTried() || this.formTouched().has(field) ? (this.formRules()[field] ?? null) : null;
  }

  /** Called when focus leaves any control on the page. */
  onFieldLeft(id: string): void {
    const field = Object.entries(PaymentGatewayConfigurationComponent.FIELD_IDS).find(([, value]) => value === id)?.[0];
    if (field && !this.formTouched().has(field)) {
      this.formTouched.update((current) => new Set(current).add(field));
    }
  }

  private focusField(fields: string[]): void {
    const ids = PaymentGatewayConfigurationComponent.FIELD_IDS;
    const first = Object.keys(ids).find((field) => fields.includes(field));
    if (first) setTimeout(() => (document.getElementById(ids[first]) as HTMLElement | null)?.focus());
  }

  // =============================================================================================
  // Saving
  // =============================================================================================

  save(): void {
    const state = this.form();

    // Every problem is found and shown at once, each under its own field, rather than one per
    // press. Settlement currency is no longer defaulted to INR, so it is asked for here instead of
    // being sent empty and bounced back by the server.
    this.formTried.set(true);
    const failing = Object.entries(this.formRules()).filter(([, message]) => message !== null).map(([field]) => field);

    if (failing.length > 0) {
      this.fieldErrors.set({});
      this.toast.error('Check the highlighted fields', `Please correct: ${failing.map((k) => PaymentGatewayConfigurationComponent.FIELD_LABELS[k] ?? k).join(', ')}.`);
      this.focusField(failing);
      return;
    }

    this.saving.set(true);
    this.fieldErrors.set({});

    this.api
      .save(this.toRequest(state))
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (saved) => {
          this.saving.set(false);
          this.toast.success(
            'Saved',
            saved.isActive
              ? `${saved.providerName} is now taking donations for this organisation.`
              : `${saved.providerName} configuration saved. It is not active yet.`,
          );

          // An edit opened from the detail screen goes back to it, showing what was just saved.
          const origin = this.formOrigin;
          this.formOrigin = null;

          if (origin && origin.id === saved.id) {
            this.openDetails(saved);
          } else {
            this.view.set('list');
          }

          this.load();
          this.loadAudit();
        },
        error: (error: unknown) => {
          this.saving.set(false);
          const server: Record<string, string> = {};
          for (const [field, message] of Object.entries(apiFieldErrors(error))) {
            server[field.charAt(0).toLowerCase() + field.slice(1)] = message;
          }
          this.fieldErrors.set(server);
          this.focusField(Object.keys(server));
          this.toast.error(
            'Not saved',
            apiErrorMessage(error, 'The gateway configuration could not be saved.'),
          );
        },
      });
  }

  /**
   * Form state to request body.
   *
   * THE CREDENTIAL RULE IS ENFORCED HERE AND IN ONE PLACE. A blank box sends `null`, which the
   * server reads as "leave the stored value alone". A ticked Clear box sends an empty string,
   * which is an explicit removal. Anything typed is sent as typed.
   *
   * Getting this backwards would mean every edit to an unrelated field silently wiping a working
   * merchant credential — and the failure would not show up until the next donation.
   */
  private toRequest(state: GatewayFormState): UpsertPaymentGatewayConfigurationRequest {
    return {
      id: state.id,
      provider: state.provider,
      environment: state.environment,
      displayName: state.displayName.trim() || null,
      merchantId: state.merchantId.trim() || null,
      apiKey: this.credentialValue(state.apiKey, state.clearApiKey),
      secretKey: this.credentialValue(state.secretKey, state.clearSecretKey),
      webhookUrl: state.webhookUrl.trim() || null,
      webhookSecret: this.credentialValue(state.webhookSecret, state.clearWebhookSecret),
      subscribedEvents: state.subscribedEvents,
      settlementCurrencyCode: state.settlementCurrencyCode.trim().toUpperCase(),
      returnUrl: state.returnUrl.trim() || null,
      paymentLinkValidityMinutes: state.paymentLinkValidityMinutes,
      enabledMethods: state.enabledMethods,
      isActive: state.isActive,
      notes: state.notes.trim() || null,
      expectedVersion: state.version,
      reason: state.reason.trim() || null,
    };
  }

  private credentialValue(typed: string, clear: boolean): string | null {
    if (clear) {
      return '';
    }

    return typed.trim().length > 0 ? typed.trim() : null;
  }

  // =============================================================================================
  // Row actions
  // =============================================================================================

  toggleActive(configuration: PaymentGatewayConfiguration): void {
    this.busyId.set(configuration.id);

    this.api
      .changeStatus(configuration.id, {
        isActive: !configuration.isActive,
        expectedVersion: configuration.version,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (outcome) => {
          this.busyId.set(null);

          // The server writes the sentence worth showing here — "New donations will be taken
          // through it" — but the generated envelope types it as nullable, so the fallback is
          // what appears if it is ever absent rather than the word "null".
          this.toast.success('Done', outcome.message ?? 'The gateway status has been changed.');
          this.load();
          this.loadAudit();
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          this.toast.error(
            'Not changed',
            apiErrorMessage(error, 'The gateway status could not be changed.'),
          );
        },
      });
  }

  /**
   * Runs the Test.
   *
   * THE RESULT IS SHOWN WHETHER IT PASSED OR FAILED, and a failure is not a toast that
   * disappears: it is the message the operator has to act on, so it stays on the row until the
   * next test or the next reload.
   */
  test(configuration: PaymentGatewayConfiguration): void {
    this.testing.set(configuration.id);
    this.testResult.set(null);

    this.api
      .test(configuration.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.testing.set(null);
          this.testResult.set(result);

          if (result.succeeded) {
            this.toast.success('Gateway reachable', result.message);
          } else {
            this.toast.error('Gateway test failed', result.message);
          }

          this.load();
          this.loadAudit();
        },
        error: (error: unknown) => {
          this.testing.set(null);
          this.toast.error(
            'Test could not run',
            apiErrorMessage(error, 'The gateway test could not be run.'),
          );
        },
      });
  }

  askToDelete(configuration: PaymentGatewayConfiguration): void {
    this.deleteTarget.set(configuration);
    this.deleteReason.set('');
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
    this.deleteReason.set('');
  }

  confirmDelete(): void {
    const target = this.deleteTarget();
    const reason = this.deleteReason().trim();

    if (!target || reason.length === 0) {
      return;
    }

    this.busyId.set(target.id);

    this.api
      .remove(target.id, { expectedVersion: target.version, reason })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.deleteTarget.set(null);

          if (this.view() === 'detail') {
            this.closeDetails();
          }

          this.selected.set(null);
          this.toast.success('Deleted', 'The gateway configuration has been removed.');
          this.load();
          this.loadAudit();
        },
        error: (error: unknown) => {
          this.busyId.set(null);
          this.toast.error(
            'Not deleted',
            apiErrorMessage(error, 'The gateway configuration could not be deleted.'),
          );
        },
      });
  }

  can(configuration: PaymentGatewayConfiguration, action: string): boolean {
    return configuration.permittedActions.includes(action);
  }

  /** True for a gateway the payments service built from the deployment's environment. */
  isInherited(configuration: PaymentGatewayConfiguration): boolean {
    return configuration.source === 'Deployment';
  }

  // =============================================================================================
  // Detail screen
  // =============================================================================================

  /**
   * Opens one gateway as its own screen.
   *
   * THE CHANGE LOG BELOW IT NARROWS TO THIS GATEWAY, so the screen reads as one record: what it
   * is, where the money goes, and everything that has been done to it.
   */
  openDetails(configuration: PaymentGatewayConfiguration): void {
    this.menuFor.set(null);

    if (this.testResult()?.configurationId !== configuration.id) {
      this.testResult.set(null);
    }

    this.selected.set(configuration);
    this.view.set('detail');
    this.showAuditFor(configuration);
    this.scrollTop();
  }

  closeDetails(): void {
    this.menuFor.set(null);
    this.selected.set(null);
    this.view.set('list');

    if (this.auditConfigurationId()) {
      this.showAuditFor(null);
    }

    this.scrollTop();
  }

  /** Escape leaves the detail screen, as it closed the drawer it replaced. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.view() !== 'detail' || this.deleteTarget()) {
      return;
    }

    if (this.menuFor()) {
      this.menuFor.set(null);
      return;
    }

    this.closeDetails();
  }

  private scrollTop(): void {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0 });
    }
  }

  /** Copies a non-secret value (merchant ID, webhook address) for pasting into a dashboard. */
  copy(value: string | null | undefined, what: string): void {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    navigator.clipboard.writeText(value).then(
      () => this.toast.success('Copied', `${what} copied to the clipboard.`),
      () => this.toast.warning('Not copied', `The ${what.toLowerCase()} could not be copied.`),
    );
  }

  /** Every event the provider can send, marked with whether the open gateway receives it. */
  readonly detailEvents = computed(() => {
    const subscribed = this.selected()?.subscribedEvents ?? [];
    const known = this.catalogue()?.webhookEvents ?? [];
    const listed = known.map((event) => ({
      code: event.code, name: event.name, description: event.description, on: subscribed.includes(event.code),
    }));
    const extra = subscribed
      .filter((code) => !known.some((event) => event.code === code))
      .map((code) => ({ code, name: code, description: '', on: true }));

    return [...listed, ...extra];
  });

  /** Every payment method the catalogue knows, marked with whether the open gateway offers it. */
  readonly detailMethods = computed(() => {
    const enabled = this.selected()?.enabledMethods ?? [];
    const known = this.catalogue()?.paymentMethods ?? [];

    // None ticked means whatever the merchant account allows, so every method reads as offered.
    const all = enabled.length === 0;
    const listed = known.map((method) => ({ code: method.code, name: method.name, on: all || enabled.includes(method.code) }));
    const extra = enabled
      .filter((code) => !known.some((method) => method.code === code))
      .map((code) => ({ code, name: code, on: true }));

    return [...listed, ...extra];
  });

  /** Only the payment methods the open gateway offers. */
  readonly chosenMethods = computed(() => this.detailMethods().filter((method) => method.on));

  /** The label for a webhook event code. */
  eventName(code: string): string {
    return this.catalogue()?.webhookEvents.find((event) => event.code === code)?.name ?? code;
  }

  methodName(code: string): string {
    return this.catalogue()?.paymentMethods.find((method) => method.code === code)?.name ?? code;
  }

  // =============================================================================================
  // Change log
  // =============================================================================================

  showAuditFor(configuration: PaymentGatewayConfiguration | null): void {
    this.auditConfigurationId.set(configuration?.id ?? null);
    this.auditPage.set(1);
    this.auditVisible.set(true);
    this.loadAudit();
  }

  applyAuditFilters(): void {
    this.auditPage.set(1);
    this.loadAudit();
  }

  clearAuditFilters(): void {
    this.auditAction.set('');
    this.auditFrom.set('');
    this.auditTo.set('');
    this.auditConfigurationId.set(null);
    this.auditPage.set(1);
    this.loadAudit();
  }

  readonly auditTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.auditTotal() / this.auditPageSize())),
  );

  goToAuditPage(page: number): void {
    if (page < 1 || page > this.auditTotalPages()) {
      return;
    }

    this.auditPage.set(page);
    this.loadAudit();
  }

  /** The pill class for a change-log action. Credential changes stand out on purpose. */
  auditTone(action: string): string {
    switch (action) {
      case 'Created':
      case 'Activated':
        return 'tone-success';
      case 'Deactivated':
        return 'tone-muted';
      case 'Deleted':
        return 'tone-danger';
      case 'CredentialsRotated':
        return 'tone-warning';
      case 'Tested':
        return 'tone-info';
      default:
        return 'tone-neutral';
    }
  }

  /** Name for a configuration in a heading or a confirmation. */
  label(configuration: PaymentGatewayConfiguration): string {
    return configuration.displayName?.trim()
      ? configuration.displayName
      : `${configuration.providerName} (${configuration.environment})`;
  }

  /** `track` expression for the row loops. */
  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }
}
