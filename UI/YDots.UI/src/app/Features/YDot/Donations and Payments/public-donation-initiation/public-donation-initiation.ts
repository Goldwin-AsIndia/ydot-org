import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, Injector, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from '../../../../Shared/services/toast.service';
import { DataService } from '../../../../Service/data.service';
import { PaymentApiService } from '../../../../Service/payment-api.service';
import { CurrentUserService } from '../../../../Service/current-user.service';
import { CampaignStoreService } from '../../../../Shared/services/campaign-store.service';
import { GatewayCheckoutService } from '../../../../Shared/services/gateway-checkout.service';
import { GeoMasterService } from '../../../../Shared/services/geo-master.service';
import { MasterLookup } from '../../../../Shared/models/global-master.model';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  CheckoutSession,
  ConfirmCheckoutRequest,
  PublicCampaignSummary,
  CreateDonationIntentRequest,
  DonationIntentResponse,
  ExistingDonorCheckResponse,
} from '../../../../Shared/models/payment.model';


/**
 * THE BROWSER NEVER HOLDS A RAZORPAY KEY, and that is the change that matters most on this
 * screen. It used to open Razorpay Checkout itself with a key compiled into the bundle, which
 * meant three things at once:
 *
 *   - THE KEY WAS PUBLIC. Anyone who opened dev-tools on the donation page could read it and
 *     raise charges against this charity's account from anywhere.
 *   - NOTHING WAS VERIFIED. `handler` believed whatever the browser handed back, so a donation
 *     was "successful" because a script said so - no signature check, no gateway confirmation.
 *   - THE AMOUNT WAS DECIDED CLIENT-SIDE. `amount: Math.round(amount * 100)` came from a signal
 *     a person could edit; a donor could have paid one rupee against a ten-thousand intent.
 *
 * The flow the YDot Donation Flow document describes is the server's: Submit creates the intent
 * (section 2), the server checks Lead/Donor (section 3), and the server issues a Razorpay
 * payment link using credentials only it holds. The donor is sent to that link. The outcome
 * comes back from the gateway - webhook, or the verify poll - never from this page.
 */

type UiState =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'validation'
  | 'duplicate'
  | 'no-access'
  | 'conflict'
  | 'dependency-failure'
  | 'success';

type LifecycleState = 'No record' | 'Submitted' | 'Awaiting payment';

interface EffectivePermissions {
  readonly view: boolean;
  readonly submit: boolean;
  readonly continueToPayment: boolean;
}

interface ScopeOption {
  readonly reference: string;
  readonly name: string;
  readonly context: string;

  /**
   * The campaign's GUID, where the source of the option knows it.
   *
   * The API wants a Guid, and the only code-to-Guid translation was the AUTHENTICATED campaign
   * register - which answers nothing for a caller with no session. The public campaigns endpoint
   * returns the id on every row. Optional because the signed-in branch still resolves through
   * the store.
   */
  readonly apiId?: string | null;

  /**
   * The campaign amount - the fixed figure this appeal is stated at.
   * ZERO OR UNDEFINED MEANS NOT STATED - a campaign created before the column existed.
   */
  readonly amount?: number;

  /** The ISO currency the amount is stated in. */
  readonly currencyCode?: string;
}

interface CatalogueOption {
  readonly reference: string;
  readonly label: string;
}
interface ActivityEntry {
  readonly time: string;
  readonly text: string;
}

type DropdownKey = 'currency' | 'country' | 'state' | 'city';

type RelatedTab = 'Linked' | 'Documents' | 'Activity' | 'Integration' | 'Support' | 'Audit';

interface PublicDonationInitiationConfig {
  readonly pageTitle: string;
  readonly pageSubtitle: string;
  readonly operatingTimeZone: string;
  readonly consentPolicyVersion: string;
  readonly campaigns: readonly ScopeOption[];
  readonly currencies: readonly CatalogueOption[];
  readonly geographies: readonly CatalogueOption[];
  readonly permissions: EffectivePermissions;
  readonly maxDonationAmount: number;
}


/**
 * The campaign states that may receive a donation.
 * Kept as one list so the two donation forms cannot drift apart about what "an approved
 * campaign" means.
 */
const DonatableCampaignStatuses: readonly string[] = ['Approved', 'Scheduled', 'Active'];

@Component({
  selector: 'app-public-donation-initiation',
  imports: [CommonModule, FormsModule],
  templateUrl: './public-donation-initiation.html',
  styleUrl: './public-donation-initiation.css',
})
export class PublicDonationInitiationComponent {
  private readonly toast = inject(ToastService);
  private readonly dataService = inject(DataService);
  private readonly payments = inject(PaymentApiService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  /**
   * The campaign store, resolved only for a signed-in caller.
   *
   * IT IS DELIBERATELY NOT A FIELD INJECTION. `CampaignStoreService` calls the authenticated CAM
   * API in its own constructor and again every sixty seconds; injecting it on the donor-facing
   * form meant a stranger with a QR code triggered a 401 on page load and another every minute.
   */
  private campaignStoreOrNull(): CampaignStoreService | null {
    if (!this.isInternalView()) {
      return null;
    }
    this.campaignStoreRef ??= this.injector.get(CampaignStoreService);
    return this.campaignStoreRef;
  }
  private campaignStoreRef: CampaignStoreService | null = null;

  /**
   * The geo catalogue door, resolved only for a signed-in caller — same discipline as
   * `campaignStoreOrNull` above. The lookups API is authenticated-but-permissionless, so an
   * anonymous donor must never be the one to construct and call it.
   */
  private geoMastersOrNull(): GeoMasterService | null {
    if (!this.isInternalView()) {
      return null;
    }
    this.geoMastersRef ??= this.injector.get(GeoMasterService);
    return this.geoMastersRef;
  }
  private geoMastersRef: GeoMasterService | null = null;


  /**
   * The QR code's or link's own reference, carried on the query string.
   * IT IS HOW AN ANONYMOUS DONOR GETS A CAMPAIGN - the API resolves it to a campaign, a channel
   * and a source, which is also what makes the donation attributable afterwards.
   */
  protected readonly trackingReference = signal<string>('');

  /**
   * Whether this is the admin panel's view of the form rather than the donor's.
   * A signed-in user can be offered the campaign picker, because CAM will answer them.
   */
  protected readonly isInternalView = computed(() => this.currentUser.reference() !== '');

  protected readonly pageTitle = signal('Donation Initiation');
  protected readonly pageSubtitle = signal('Collect minimum identity, amount and consent before creating a unique intent.');
  protected readonly operatingTimeZone = signal('Asia/Kolkata · IST (UTC+05:30)');

  protected readonly lifecycleState = signal<LifecycleState>('No record');

  protected readonly lastRefresh = signal('Today, 09:30 AM · IST');

  protected readonly intentReference = signal<string>('');

  protected readonly owner = computed(() => (this.fullName().trim() ? `${this.fullName().trim()} · Donor` : 'Donor · not yet identified'));


  protected readonly scopeSummary = computed(() =>
    this.selectedCampaign()
      ? `Public intake · ${this.selectedCampaign()!.name} (${this.selectedCampaign()!.context})`
      : 'Public intake · awaiting an eligible campaign or appeal in your active scope',
  );

  protected readonly permissions = signal<EffectivePermissions>({
    view: true,
    submit: true,
    continueToPayment: true,
  });

  /**
   * The campaigns a donation may be started against.
   * Cancelled and Closed campaigns are filtered out because a gift cannot be attributed to one.
   */
  protected readonly campaignOptions = computed<readonly ScopeOption[]>(() => {
    const store = this.campaignStoreOrNull();

    // ANONYMOUS: the public endpoint. See loadPublicCampaigns.
    if (!store) {
      return this.publicCampaigns().map((campaign) => ({
        reference: campaign.code,
        name: campaign.name,
        context: 'Open for donations',
        apiId: campaign.id,
        amount: campaign.campaignAmount,
        currencyCode: campaign.currencyCode,
      }));
    }

    return store
      .all()
      .filter((c) => DonatableCampaignStatuses.includes(c.status))
      .map((c) => ({
        reference: c.code,
        name: c.name,
        context: c.status,
        apiId: store.apiId(c.code) ?? null,
        amount: c.campaignAmount,

        // The register's currency name reads "INR - Indian Rupee"; the ISO code is the half worth
        // printing beside a figure.
        currencyCode: (c.currencyName ?? '').split('—')[0].split('-')[0].trim() || undefined,
      }));
  });

  // ===========================================================================================
  // Campaign amount
  // ===========================================================================================
  //
  // THE FIGURE THE CHOSEN CAMPAIGN IS STATED AT, AND THE AMOUNT THIS DONOR WILL PAY.
  // ITS ENABLED STATE FOLLOWS THE CAMPAIGN PICKER'S.

  /** The selected campaign's stated amount, or null when it has none. */
  protected readonly campaignAmount = computed(() => {
    const amount = this.selectedCampaign()?.amount;
    return typeof amount === 'number' && amount > 0 ? amount : null;
  });

  protected readonly campaignAmountCurrency = computed(
    () => this.selectedCampaign()?.currencyCode ?? '',
  );

  /** The amount as the disabled control shows it. Empty when there is none to show. */
  protected readonly campaignAmountLabel = computed(() => {
    const amount = this.campaignAmount();

    if (amount === null) {
      return '';
    }

    const formatted = amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const code = this.campaignAmountCurrency();

    return code ? `${code} ${formatted}` : formatted;
  });

  /**
   * The options the Campaign amount dropdown offers - EXACTLY ONE, OR NONE.
   */
  protected readonly campaignAmountOptions = computed(() => {
    const label = this.campaignAmountLabel();
    return label ? [label] : [];
  });

  protected readonly campaignAmountDisabled = computed(
    () => this.formLocked() || this.campaignLockedByLink() || this.campaignAmount() === null,
  );

  /** True when a campaign is chosen and states no amount, so there is nothing to charge. */
  protected readonly campaignStatesNoAmount = computed(
    () => !!this.selectedCampaign() && this.campaignAmount() === null,
  );

  /**
   * Keeps the payable amount and the currency in step with the chosen campaign.
   * A REOPENED INTENT WINS. See `amountFromIntent`.
   */
  private syncAmountToCampaign(): void {
    if (this.amountFromIntent()) {
      return;
    }

    const amount = this.campaignAmount();

    this.donationAmount.set(amount === null ? '' : String(amount));

    const code = this.campaignAmountCurrency();

    if (code) {
      this.currency.set(code);
    }
  }

  protected readonly campaignQuery = signal('');
  protected readonly selectedCampaign = signal<ScopeOption | null>(null);
  protected readonly campaignPickerOpen = signal(false);
  protected readonly campaignResults = computed(() => {
    const q = this.campaignQuery().trim().toLowerCase();
    if (!q) {
      return this.campaignOptions();
    }
    return this.campaignOptions().filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.reference.toLowerCase().includes(q) ||
        o.context.toLowerCase().includes(q),
    );
  });
  protected selectCampaign(option: ScopeOption): void {
    this.selectedCampaign.set(option);
    this.campaignPickerOpen.set(false);
    this.syncAmountToCampaign();
    this.campaignQuery.set('');
  }
  protected toggleCampaignPicker(): void {
    if (this.campaignLockedByLink()) {
      return;
    }

    if (this.formLocked()) {
      return;
    }
    this.closeDropdown();
    this.campaignPickerOpen.update((v) => !v);
  }

  protected readonly fullName = signal('');

  protected readonly emailOrMobile = signal('');

  /**
   * The donor's mobile number. OPTIONAL, and VALIDATED ONLY WHEN GIVEN - ten to fifteen digits
   * after punctuation is stripped.
   */
  protected readonly mobileNumber = signal('');

  protected readonly mobileInvalid = computed(() => {
    const digits = this.mobileNumber().replace(/\D+/g, '');
    return digits.length > 0 && (digits.length < 10 || digits.length > 15);
  });

  protected readonly emailValid = computed(() => {
    const v = this.emailOrMobile().trim();
    if (!v) {
      return true;
    }
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  });
  protected readonly emailMasked = computed(() => {
    const v = this.emailOrMobile().trim();
    if (!v) {
      return '';
    }
    const at = v.indexOf('@');
    if (at <= 1) {
      return '•••••';
    }
    return `${v[0]}••••${v.slice(at - 1)}`;
  });


  /**
   * What this donor will be charged. Written from the chosen campaign (see
   * `syncAmountToCampaign`) or restored from a reopened intent, and read by `buildIntentRequest`.
   */
  protected readonly donationAmount = signal<string>('');

  /** True once a reopened intent supplied the amount, which stops the campaign overwriting it. */
  private readonly amountFromIntent = signal(false);

  protected readonly amountOverLimitAllowed = signal(false);
  protected readonly maxDonationAmount = signal(500000);

  /** The stated amount is outside what this form may take. */
  protected readonly amountInvalid = computed(() => {
    const raw = this.donationAmount().trim();
    if (!raw) {
      return false;
    }
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) {
      return true;
    }
    return n > this.maxDonationAmount() && !this.amountOverLimitAllowed();
  });
  protected readonly formattedAmount = computed(() => {
    const n = Number(this.donationAmount());
    if (!this.donationAmount() || Number.isNaN(n)) {
      return '';
    }
    const cur = this.currencyLabel(this.currency()) || this.currency();
    return `${cur} ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  });

  protected readonly currencyCatalogue = signal<readonly CatalogueOption[]>([]);
  protected readonly currency = signal<string>('');
  protected currencyLabel(reference: string): string {
    return this.currencyCatalogue().find((c) => c.reference === reference)?.label.split(' — ')[0] ?? '';
  }
  protected currencyFullLabel(reference: string): string {
    return this.currencyCatalogue().find((c) => c.reference === reference)?.label ?? '';
  }

  /** The PAN the income-tax department issues: five letters, four digits, a check letter. */
  private static readonly PanPattern = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;

  /** A tax reference that is not a PAN - an overseas donor's TIN, a foreign registration number. */
  private static readonly TaxIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9/-]{3,29}$/;

  protected readonly panOrTaxId = signal<string>('');

  /** Whether what has been typed can be a PAN or a tax identifier at all. */
  protected readonly panInvalid = computed(() => {
    const raw = this.panOrTaxId().trim();
    if (!raw) {
      return false;
    }
    if (PublicDonationInitiationComponent.PanPattern.test(raw)) {
      return false;
    }
    return !PublicDonationInitiationComponent.TaxIdentifierPattern.test(raw);
  });
  protected readonly panMasked = computed(() => {
    const v = this.panOrTaxId().trim();
    if (!v) {
      return '';
    }
    return v.length <= 2 ? '••' : `${'•'.repeat(v.length - 2)}${v.slice(-2)}`;
  });


  protected readonly geographyCatalogue = signal<readonly CatalogueOption[]>([]);
  protected readonly geography = signal<string>('');
  protected readonly addressText = signal('');
  protected geographyLabel(reference: string): string {
    return this.geographyCatalogue().find((g) => g.reference === reference)?.label ?? '';
  }

  // ==========================================================================================
  // Address Details block (the receipt address)
  // ==========================================================================================
  protected readonly addressLine2Text = signal('');
  protected readonly pinCode = signal('');

  protected readonly countryCatalogue = signal<readonly CatalogueOption[]>([]);
  protected readonly stateCatalogue = signal<readonly CatalogueOption[]>([]);
  protected readonly cityCatalogue = signal<readonly CatalogueOption[]>([]);
  protected readonly countryId = signal('');
  protected readonly stateId = signal('');
  protected readonly cityId = signal('');

  protected countryLabel(reference: string): string {
    return this.countryCatalogue().find((c) => c.reference === reference)?.label ?? '';
  }
  protected stateLabel(reference: string): string {
    return this.stateCatalogue().find((s) => s.reference === reference)?.label ?? '';
  }
  protected cityLabel(reference: string): string {
    return this.cityCatalogue().find((c) => c.reference === reference)?.label ?? '';
  }

  /** A master lookup row as a picker option — active rows only, ids carried as references. */
  private toMasterOptions(rows: readonly MasterLookup[]): readonly CatalogueOption[] {
    return rows
      .filter((row) => row.status === 'active')
      .map((row) => ({ reference: row.id, label: row.name }));
  }

  /** Loads the country catalogue once, for the internal view only (see geoMastersOrNull). */
  protected loadCountriesForAddress(): void {
    const masters = this.geoMastersOrNull();
    if (!masters || this.countryCatalogue().length > 0) {
      return;
    }
    masters.getCountries().subscribe({
      next: (rows) => this.countryCatalogue.set(this.toMasterOptions(rows)),
      error: () => this.countryCatalogue.set([]),
    });
  }

  /**
   * The standard address cascade: a country names its states, a state names its cities, and
   * changing a parent invalidates the child selections.
   */
  protected onAddressCountryChange(reference: string): void {
    this.countryId.set(reference);
    this.stateId.set('');
    this.cityId.set('');
    this.stateCatalogue.set([]);
    this.cityCatalogue.set([]);

    const masters = this.geoMastersOrNull();
    if (!masters || !reference) {
      return;
    }
    masters.getStates(reference).subscribe({
      next: (rows) => this.stateCatalogue.set(this.toMasterOptions(rows)),
      error: () => this.stateCatalogue.set([]),
    });
  }

  protected onAddressStateChange(reference: string): void {
    this.stateId.set(reference);
    this.cityId.set('');
    this.cityCatalogue.set([]);

    const masters = this.geoMastersOrNull();
    if (!masters || !reference) {
      return;
    }
    masters.getCities(reference).subscribe({
      next: (rows) => this.cityCatalogue.set(this.toMasterOptions(rows)),
      error: () => this.cityCatalogue.set([]),
    });
  }



  protected readonly consentPolicyVersion = signal('Privacy Notice v3.2 · Consent Terms v1.4');
  protected readonly consentChecked = signal(false);
  protected readonly consentEffectiveTime = signal<string>('');

  // ==========================================================================================
  // Stepper milestones — pure reads of the same signals the validation already uses.
  // ==========================================================================================
  protected readonly stepIdentityDone = computed(
    () => !!this.fullName().trim() && !!this.emailOrMobile().trim() && this.emailValid(),
  );
  protected readonly stepCampaignDone = computed(
    () => !!this.selectedCampaign() || !!this.trackingReference() || !!this.campaignIdFromLink(),
  );
  protected readonly stepAmountDone = computed(() => !!this.donationAmount().trim() && !this.amountInvalid());
  protected readonly stepCurrencyDone = computed(() => !!this.currency());
  protected readonly stepTaxDone = computed(() => !!this.panOrTaxId().trim());

  // ==========================================================================================
  // Progress cards + summary strip (header design)
  // ==========================================================================================

  /** Header action and progress UI show only while the form itself is on screen. */
  protected readonly showFormChrome = computed(() =>
    (['ready', 'loading', 'validation', 'success'] as UiState[]).includes(this.uiState()),
  );

  protected readonly donorTotal = 4;
  protected readonly donorFilled = computed(() =>
    [
      this.stepCampaignDone(),
      !!this.fullName().trim(),
      !!this.emailOrMobile().trim() && this.emailValid(),
      !!this.currency(),
    ].filter(Boolean).length,
  );
  protected readonly donorPercent = computed(() => Math.round((this.donorFilled() / this.donorTotal) * 100));
  protected readonly donorComplete = computed(() => this.donorFilled() === this.donorTotal);

  protected readonly addressTotal = 5;
  protected readonly addressFilled = computed(() =>
    [
      !!this.addressText().trim(),
      !!this.countryId(),
      !!this.stateId(),
      !!this.cityId(),
      !!this.pinCode().trim(),
    ].filter(Boolean).length,
  );
  protected readonly addressPercent = computed(() => Math.round((this.addressFilled() / this.addressTotal) * 100));
  protected readonly addressComplete = computed(() => this.addressFilled() === this.addressTotal);

  protected readonly summaryCity = computed(() => this.cityLabel(this.cityId()) || '—');

  // ==========================================================================================
  // Custom dropdowns (Currency / Country / State / City) — replaces the native <select>
  // ==========================================================================================

  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Which dropdown is open. Only one at a time. */
  protected readonly openDropdown = signal<DropdownKey | null>(null);
  protected readonly dropdownQuery = signal('');

  /** The full option list behind a dropdown. */
  private dropdownSource(key: DropdownKey | null): readonly CatalogueOption[] {
    switch (key) {
      case 'currency': return this.currencyCatalogue();
      case 'country':  return this.countryCatalogue();
      case 'state':    return this.stateCatalogue();
      case 'city':     return this.cityCatalogue();
      default:         return [];
    }
  }

  /** The open dropdown's options, filtered by the search box. */
  protected readonly dropdownOptions = computed(() => {
    const all = this.dropdownSource(this.openDropdown());
    const q = this.dropdownQuery().trim().toLowerCase();
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  });

  /** Long lists (countries, states, cities) get a search box. */
  protected readonly dropdownSearchable = computed(
    () => this.dropdownSource(this.openDropdown()).length > 7,
  );

  protected toggleDropdown(key: DropdownKey): void {
    if (this.openDropdown() === key) {
      this.closeDropdown();
      return;
    }
    this.campaignPickerOpen.set(false);
    this.dropdownQuery.set('');
    this.openDropdown.set(key);

    // Focus the search box once it renders.
    setTimeout(() =>
      this.hostEl.nativeElement.querySelector<HTMLInputElement>('.dd.is-open .dd-search-input')?.focus(),
    );
  }

  protected closeDropdown(): void {
    this.openDropdown.set(null);
    this.dropdownQuery.set('');
  }

  /** Writes the picked value through the SAME handlers the native selects used. */
  protected pickDropdownOption(key: DropdownKey, reference: string): void {
    switch (key) {
      case 'currency': this.currency.set(reference); break;
      case 'country':  if (reference !== this.countryId()) { this.onAddressCountryChange(reference); } break;
      case 'state':    if (reference !== this.stateId())   { this.onAddressStateChange(reference); }   break;
      case 'city':     this.cityId.set(reference); break;
    }
    this.closeDropdown();
    this.hostEl.nativeElement.querySelector<HTMLElement>(`#fld-${key}`)?.focus();
  }

  /** Enter in the search box picks the first match. */
  protected pickFirstDropdownMatch(): void {
    const key = this.openDropdown();
    const first = this.dropdownOptions()[0];
    if (key && first) {
      this.pickDropdownOption(key, first.reference);
    }
  }

  /** Clicking anywhere outside an open dropdown closes it. */
  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMouseDown(event: MouseEvent): void {
    if (!this.openDropdown()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.dd.is-open')) {
      this.closeDropdown();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    const key = this.openDropdown();
    if (key) {
      this.closeDropdown();
      this.hostEl.nativeElement.querySelector<HTMLElement>(`#fld-${key}`)?.focus();
    }
  }

  protected toggleConsent(checked: boolean): void {
    if (this.formLocked()) {
      return;
    }
    this.consentChecked.set(checked);
    this.consentEffectiveTime.set(checked ? this.nowLabel() : '');
    if (checked) {
      this.pushActivity(`Consent acknowledged against ${this.consentPolicyVersion()}.`);
    }
  }

  protected readonly publicRecognitionPreference = computed(() =>
    this.intentReference() ? 'Anonymous (default) · not yet approved for public display' : '',
  );


  protected readonly paymentLinkDestination = signal<string>('');

  protected readonly privacyNoticeVersion = computed(() => (this.intentReference() ? this.consentPolicyVersion().split(' · ')[0] : ''));


  protected readonly formLocked = computed(() => this.lifecycleState() !== 'No record');

  protected readonly submitAllowed = computed(
    () => this.permissions().submit && this.lifecycleState() === 'No record' && this.uiState() !== 'no-access',
  );

  protected readonly reviewAllowed = computed(() => this.permissions().view && this.uiState() !== 'no-access');

  /**
   * Whether "Continue to payment" can be pressed.
   * 'AWAITING PAYMENT' COUNTS - it is the state where continuing is the ONLY thing left to do.
   */
  protected readonly continueToPaymentAllowed = computed(
    () =>
      this.permissions().continueToPayment &&
      (this.lifecycleState() === 'Submitted' || this.lifecycleState() === 'Awaiting payment') &&
      this.uiState() !== 'no-access',
  );

  protected requestReview(): void {
    if (!this.reviewAllowed()) {
      return;
    }
    this.lastRefresh.set(this.nowLabel());
    this.reviewedNote.set(`Reviewed as of ${this.lastRefresh()}. No change to the record outside your effective scope.`);
    this.pushActivity('Record reviewed; no unauthorised change applied.');
  }
  protected readonly reviewedNote = signal<string>('');

  protected readonly validationErrors = computed(() => {
    const errors: { field: string; label: string; message: string }[] = [];
    // REQUIRED ONLY WHEN THERE IS SOMETHING TO PICK - a QR-code donor's link carries attribution.
    if (!this.selectedCampaign() && !this.trackingReference() && !this.campaignIdFromLink()) {
      errors.push({ field: 'campaign', label: 'Campaign or appeal', message: 'Enter Campaign or appeal.' });
    }
    if (!this.fullName().trim()) {
      errors.push({ field: 'fullName', label: 'Full name', message: 'Enter Full name.' });
    }
    if (this.mobileInvalid()) {
      errors.push({
        field: 'mobileNumber',
        label: 'Mobile No',
        message: 'Review Mobile No. Enter 10 to 15 digits.',
      });
    }
    if (!this.emailOrMobile().trim()) {
      errors.push({ field: 'emailOrMobile', label: 'Email', message: 'Enter Email.' });
    } else if (!this.emailValid()) {
      errors.push({
        field: 'emailOrMobile',
        label: 'Email or mobile',
        message: 'Review Email or mobile. The value does not meet the stated format or range.',
      });
    }
    // THE AMOUNT IS THE CAMPAIGN'S, SO SO IS THE ERROR.
    if (this.campaignStatesNoAmount()) {
      errors.push({
        field: 'campaign',
        label: 'Campaign or appeal',
        message: 'This appeal does not state an amount to give. Choose another one.',
      });
    } else if (this.amountInvalid()) {
      errors.push({
        field: 'campaign',
        label: 'Campaign or appeal',
        message: "This appeal's amount is outside the range this form can take. Contact the organisation.",
      });
    }
    if (!this.currency()) {
      errors.push({ field: 'currency', label: 'Currency', message: 'Enter Currency.' });
    }
    if (this.panInvalid()) {
      errors.push({
        field: 'panOrTaxId',
        label: 'PAN or tax identifier',
        message: 'Review PAN or tax identifier. The value does not meet the stated format or range.',
      });
    }
    // THE ADDRESS BLOCK, REQUIRED FOR STAFF ENTERING A DONATION ON A DONOR'S BEHALF.
    if (this.isInternalView()) {
      if (!this.addressText().trim()) {
        errors.push({ field: 'addressLine1', label: 'Address line 1', message: 'Enter Address line 1.' });
      }
      if (!this.cityId()) {
        errors.push({ field: 'city', label: 'City', message: 'Enter City.' });
      }
      if (!this.stateId()) {
        errors.push({ field: 'state', label: 'State', message: 'Enter State.' });
      }
      if (!this.countryId()) {
        errors.push({ field: 'country', label: 'Country', message: 'Enter Country.' });
      }
      if (!this.pinCode().trim()) {
        errors.push({ field: 'pinCode', label: 'PIN / ZIP Code', message: 'Enter PIN / ZIP Code.' });
      }
    }
    if (!this.consentChecked()) {
      errors.push({ field: 'consent', label: 'Consent acknowledgement', message: 'Enter Consent acknowledgement.' });
    }
    return errors;
  });

  protected readonly remainingRequired = computed(() =>
    this.validationErrors()
      .filter((e) => e.message.startsWith('Enter '))
      .map((e) => e.label),
  );


  /**
   * Submit - section 2 of the document. The reference comes back from the API.
   */
  protected requestSubmit(): void {
    if (this.validationErrors().length > 0) {
      this.uiState.set('validation');
      this.focusFirstInvalid();
      return;
    }
    if (!this.submitAllowed()) {
      return;
    }

    this.uiState.set('loading');
    this.payments.initiateDonation(this.buildIntentRequest()).subscribe({
      next: (intent) => this.onIntentCreated(intent),
      error: (error: unknown) => {
        this.uiState.set('ready');
        this.toast.show('Donation not started', apiErrorMessage(error), 'error');
      },
    });
  }

  /**
   * The request body, built from the form exactly once.
   * THE AMOUNT GOES AS A NUMBER, NOT AS PAISE - converting to minor units is the server's job.
   */
  private buildIntentRequest(): CreateDonationIntentRequest {
    const campaignRef = this.selectedCampaign()?.reference ?? '';

    return {
      donorName: this.fullName().trim() || 'Donor',
      email: this.emailOrMobile().trim(),
      mobile: this.mobileNumber().trim() || null,
      amount: Number(this.donationAmount()),
      currencyCode: this.currency(),

      // WHAT IS SELECTED ON SCREEN IS WHAT IS SENT; then the link's GUID; then the store.
      campaignId:
        this.selectedCampaign()?.apiId
        ?? this.campaignIdFromLink()
        ?? (campaignRef ? this.campaignStoreOrNull()?.apiId(campaignRef) ?? null : null),
      trackingReference: this.trackingReference() || null,
      taxIdentifier: this.panOrTaxId().trim() || null,
      addressLine1: this.addressText().trim() || null,

      // Line 2, City, State and Country ride on addressLine2 comma-joined.
      addressLine2:
        [
          this.addressLine2Text().trim(),
          this.cityLabel(this.cityId()),
          this.stateLabel(this.stateId()),
          this.countryLabel(this.countryId()),
        ]
          .filter(Boolean)
          .join(', ') || this.geographyLabel(this.geography()) || null,

      countryId: this.countryId() || null,
      stateId: this.stateId() || null,
      cityId: this.cityId() || null,
      postalCode: this.pinCode().trim() || null,

      // Section 11: consent is captured BEFORE the intent exists.
      consentGiven: this.consentChecked(),
      consentVersion: this.consentPolicyVersion(),
    };
  }

  /**
   * Section 3 - the Lead/Donor check, then payment. THE SERVER DECIDES, NOT THIS PAGE.
   */
  private onIntentCreated(intent: DonationIntentResponse): void {
    this.intentReference.set(intent.intentReference);
    this.lifecycleState.set('Submitted');
    this.lastOutcome.set({
      action: 'Submit',
      reference: intent.intentReference,
      state: intent.statusDescription || 'Submitted',
      effectiveTime: this.nowLabel(),
      downstream: 'Payment link requested from the gateway',
      nextAction: 'Complete the payment at the gateway',
    });
    this.pushActivity('Submitted. Reference ' + intent.intentReference + ' created.');

    // NO MATCH IS THE COMMON CASE AND HAS NO BRANCH.
    if (intent.existingDonorMatched !== true) {
      this.startPayment(intent.intentReference, intent.version);
      return;
    }

    // ALREADY SIGNED IN MEANS THERE IS NOTHING TO ASK.
    if (this.isInternalView()) {
      this.pushActivity('Recognised as an existing donor; continuing to payment.');
      this.startPayment(intent.intentReference, intent.version);
      return;
    }

    // A MATCH STOPS THE FLOW AND ASKS.
    this.donorCheckLoading.set(true);
    this.payments.checkExistingDonor(intent.intentReference).subscribe({
      next: (check) => {
        this.donorCheckLoading.set(false);
        this.donorCheck.set(check);
        this.identityChoiceOpen.set(true);
        this.pushActivity(
          'Recognised as an existing donor' +
            (check.maskedEmail ? ' (' + check.maskedEmail + ')' : '') + '.',
        );
      },

      // THE CHECK FAILING MUST NOT BLOCK THE DONATION.
      error: () => {
        this.donorCheckLoading.set(false);
        this.pushActivity('Donor recognition unavailable; continuing to payment.');
        this.startPayment(intent.intentReference, intent.version);
      },
    });
  }

  // ===========================================================================================
  // Section 3 - the Lead/Donor branch
  // ===========================================================================================

  /** The server's answer: masked e-mail, whether an account is active, and what it advises. */
  protected readonly donorCheck = signal<ExistingDonorCheckResponse | null>(null);
  protected readonly donorCheckLoading = signal(false);
  protected readonly identityChoiceOpen = signal(false);

  /** Whether the recognised donor can actually sign in. A DONOR RECORD IS NOT A LOGIN. */
  protected readonly canSignIn = computed(() => this.donorCheck()?.hasActiveAccount === true);

  protected readonly recognisedContact = computed(
    () => this.donorCheck()?.maskedEmail ?? 'your saved contact details',
  );

  /** Sign in first, then come back and pay. THE INTENT REFERENCE TRAVELS ON THE RETURN URL. */
  protected signInAndContinue(): void {
    const reference = this.intentReference();
    if (!reference) {
      return;
    }

    this.identityChoiceOpen.set(false);
    this.pushActivity('Sent to sign in; donation ' + reference + ' preserved.');
    this.router.navigate(['/auth/sign-in'], {
      queryParams: {
        returnUrl: '/app/donations/public-donation-initiation?intent=' + reference,
      },
    });
  }

  /** Pay now, without signing in. The donation is already recorded either way. */
  protected continueWithoutSigningIn(): void {
    const reference = this.intentReference();
    if (!reference) {
      return;
    }

    this.identityChoiceOpen.set(false);

    // RE-READ FOR THE CURRENT VERSION.
    this.payments.getPublicIntent(reference).subscribe({
      next: (detail) => this.startPayment(detail.intentReference, detail.version),
      error: (error: unknown) =>
        this.toast.show('Payment unavailable', apiErrorMessage(error), 'error'),
    });
  }

  // ===========================================================================================
  // Payment - the checkout the donor actually sees
  // ===========================================================================================

  /** Opens whichever provider the ORGANISATION is configured for. */
  private readonly checkout = inject(GatewayCheckoutService);

  /**
   * Submit's real destination: open the provider's checkout over this page.
   * IT FALLS BACK RATHER THAN FAILING - to a payment link.
   */
  private startPayment(intentReference: string, expectedVersion: number): void {
    this.payments.createCheckoutSession(intentReference, { expectedVersion }).subscribe({
      next: (session) => this.openCheckout(session),

      error: () => {
        this.pushActivity('In-page checkout unavailable; requesting a payment link instead.');

        // THE VERSION IS RE-READ, NOT REUSED.
        this.payments.getPublicIntent(intentReference).subscribe({
          next: (detail) => this.requestPaymentLink(detail.intentReference, detail.version),
          error: (readError: unknown) => {
            this.uiState.set('success');
            this.lifecycleState.set('Submitted');
            this.toast.show('Payment unavailable', apiErrorMessage(readError), 'error');
          },
        });
      },
    });
  }

  /** Draws the configured provider's payment form over this page. */
  private openCheckout(session: CheckoutSession): void {
    void this.checkout
      .open(session, this.selectedCampaign()?.name || 'Donation', {
        onSucceeded: (confirmation) => this.confirmCheckout(session, confirmation),
        onFailed: () => this.onCheckoutFailed(session.intentReference),
        onDismissed: () => this.onCheckoutDismissed(),
      })
      .then((outcome) => {
        if (outcome === 'opened') {
          this.lifecycleState.set('Awaiting payment');
          this.uiState.set('success');
          this.pushActivity(
            'Checkout opened via ' + session.gatewayName + ' (attempt ' + session.attemptNumber + ').',
          );
          return;
        }

        if (outcome === 'unsupported') {
          this.pushActivity(
            session.gatewayName + ' has no in-page checkout; requesting a payment link instead.',
          );
        } else {
          this.pushActivity('The payment form could not be opened; requesting a payment link instead.');
        }

        // THE DONATION SURVIVES EITHER WAY.
        this.payments.getPublicIntent(session.intentReference).subscribe({
          next: (detail) => this.requestPaymentLink(detail.intentReference, detail.version),
          error: () => {
            this.uiState.set('success');
            this.lifecycleState.set('Awaiting payment');
            this.pushActivity('The payment form could not be opened; the donation is awaiting payment.');
            this.toast.show(
              'Payment form unavailable',
              'We could not open the payment form. Select Continue to payment to try again.',
              'error',
            );
          },
        });
      });
  }

  /**
   * Hands the signed result back to the server, then shows the donor where they stand.
   * THE PAGE DOES NOT DECIDE THE OUTCOME AND MUST NOT.
   */
  private confirmCheckout(session: CheckoutSession, confirmation: ConfirmCheckoutRequest): void {
    this.pushActivity('Payment completed at the gateway; confirming.');

    this.payments
      .confirmCheckout(session.intentReference, confirmation)
      .subscribe({
        next: () => undefined,
        // A FAILED CONFIRMATION IS NOT A FAILED PAYMENT - the result page asks again.
        error: () => undefined,
      });

    this.goToResult(session.intentReference);
  }

  /** The donor closed the form without paying. Nothing failed; nothing was charged. */
  private onCheckoutDismissed(): void {
    this.uiState.set('success');
    this.lifecycleState.set('Awaiting payment');
    this.pushActivity('The donor closed the payment form without paying.');
    this.toast.show(
      'Payment not completed',
      'The payment form was closed. Select Continue to payment when you are ready.',
      'info',
    );
  }

  /** The provider declined the payment. A real outcome, so the donor is taken to it. */
  private onCheckoutFailed(intentReference: string): void {
    this.pushActivity('The payment was declined at the gateway.');
    this.goToResult(intentReference);
  }

  /** Back to our own application, whatever happened. */
  private goToResult(intentReference: string): void {
    this.router.navigate(['/give/result'], { queryParams: { intent: intentReference } });
  }

  /**
   * Asks the server for the payment link and sends the donor to it - THE FALLBACK.
   * THE EXPECTED VERSION IS SENT so a double-clicked Submit cannot open two attempts.
   */
  private requestPaymentLink(intentReference: string, expectedVersion: number): void {
    this.payments.createPaymentLink(intentReference, { expectedVersion }).subscribe({
      next: (link) => {
        this.lifecycleState.set('Awaiting payment');
        this.paymentLinkDestination.set(link.paymentLinkUrl);
        this.uiState.set('success');
        this.pushActivity('Payment link issued via ' + link.gatewayName + ' (attempt ' + link.attemptNumber + ').');
        this.toast.show('Redirecting to payment', 'Opening the secure payment page.', 'success');

        // A FULL NAVIGATION, NOT A NEW TAB.
        window.location.assign(link.paymentLinkUrl);
      },
      error: (error: unknown) => {
        // THE INTENT SURVIVES A LINK FAILURE.
        this.uiState.set('success');
        this.lifecycleState.set('Submitted');
        this.pushActivity('Payment link could not be issued; the intent remains submitted.');
        this.toast.show('Payment link unavailable', apiErrorMessage(error), 'error');
      },
    });
  }

  protected readonly submitDialogOpen = signal(false);
  protected readonly submitReason = signal('');
  protected readonly submitReasonMin = 10;
  protected readonly submitReasonMax = 500;
  protected readonly submitReasonValid = computed(() => {
    const len = this.submitReason().trim().length;
    return len >= this.submitReasonMin && len <= this.submitReasonMax;
  });
  protected readonly submitReasonCount = computed(() => this.submitReason().trim().length);

  protected cancelSubmit(): void {
    this.submitDialogOpen.set(false);
  }

  /** The confirm button of the submit dialog, which the template currently does not render. */
  protected confirmSubmit(): void {
    this.submitDialogOpen.set(false);
    this.requestSubmit();
  }

  /**
   * Continue to payment, for an intent that exists but has no usable link yet.
   * IT RE-ASKS THE SERVER for the current version first.
   */
  protected requestContinueToPayment(): void {
    const reference = this.intentReference();
    if (!this.continueToPaymentAllowed() || !reference) {
      return;
    }

    const existing = this.paymentLinkDestination();
    if (existing) {
      window.location.assign(existing);
      return;
    }

    this.payments.getPublicIntent(reference).subscribe({
      next: (detail) => this.startPayment(detail.intentReference, detail.version),
      error: (error: unknown) => this.toast.show('Payment unavailable', apiErrorMessage(error), 'error'),
    });
  }

  protected readonly lastOutcome = signal<{
    action: string;
    reference: string;
    state: string;
    effectiveTime: string;
    downstream: string;
    nextAction: string;
  } | null>(null);

  protected readonly relatedTabs: readonly RelatedTab[] = ['Linked', 'Documents', 'Activity', 'Integration', 'Support', 'Audit'];
  protected readonly activeRelatedTab = signal<RelatedTab>('Linked');
  protected selectRelatedTab(tab: RelatedTab): void {
    this.activeRelatedTab.set(tab);
  }
  protected readonly activityLog = signal<readonly ActivityEntry[]>([]);
  private pushActivity(text: string): void {
    this.activityLog.update((cur) => [{ time: this.nowLabel(), text }, ...cur]);
  }

  protected readonly uiState = signal<UiState>('ready');
  protected setUiState(state: UiState): void {
    this.uiState.set(state);
  }

  protected backToForm(): void {
    this.uiState.set('ready');
  }

  private focusFirstInvalid(): void {
    const first = this.validationErrors()[0];
    if (!first) {
      return;
    }
    queueMicrotask(() => {
      const el = document.getElementById(`fld-${first.field}`);
      el?.focus();
    });
  }


  private nowLabel(): string {
    return new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  constructor() {
    // THE LINK'S OWN REFERENCE, BEFORE ANYTHING ELSE.
    const params = this.route.snapshot.queryParamMap;
    this.trackingReference.set(params.get('ref') ?? params.get('tracking') ?? '');

    // A CAMPAIGN NAMED ON THE LINK BINDS THE PICKER AND LOCKS IT.
    const campaignParam = (params.get('campaign') ?? '').trim();

    if (campaignParam) {
      this.campaignLockedByLink.set(true);

      if (PublicDonationInitiationComponent.isGuid(campaignParam)) {
        this.campaignIdFromLink.set(campaignParam);
      }
    }

    // NOTHING FROM A PREVIOUS GIFT, whatever the router did with this component.
    if (!params.get('intent') && !params.get('intentReference')) {
      this.resetDonationFields();
    }

    this.prefillFromAccount();
    this.loadPublicCampaigns();
    this.loadConfig();
    this.loadCountriesForAddress();

    // AND AGAIN ON EVERY LATER ARRIVAL.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((current) => {
      if (this.intentReference() && !current.get('intent') && !current.get('intentReference')) {
        this.resetDonationFields();
        this.prefillFromAccount();
      }
    });
  }

  /** Clears the gift, and keeps who the donor is. */
  private resetDonationFields(): void {
    this.selectedCampaign.set(null);
    this.campaignQuery.set('');
    this.campaignPickerOpen.set(false);
    this.donationAmount.set('');
    this.amountFromIntent.set(false);
    this.consentChecked.set(false);
    this.consentEffectiveTime.set('');
    this.intentReference.set('');
    this.paymentLinkDestination.set('');
    this.lifecycleState.set('No record');
    this.lastOutcome.set(null);
    this.uiState.set('ready');
  }


  /** True when a link named the campaign, so the picker is bound and cannot be changed. */
  protected readonly campaignLockedByLink = signal(false);

  /** A campaign id taken straight from the link, when the link carries one. */
  protected readonly campaignIdFromLink = signal<string | null>(null);

  /** Whether a string is a GUID, and therefore a campaign id rather than a campaign code. */
  private static isGuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }


  /** Whether the donor's own details are fixed by their account rather than typed. */
  protected readonly identityLocked = computed(
    () => this.isInternalView() && this.currentUser.email() !== '',
  );

  /** The appeals an anonymous donor may choose from. */
  protected readonly publicCampaigns = signal<readonly PublicCampaignSummary[]>([]);

  /** Loads the anonymous picker, for a visitor with no session. */
  private loadPublicCampaigns(): void {
    if (this.isInternalView()) {
      return;
    }

    this.payments.getPublicCampaigns().subscribe({
      next: (rows) => {
        this.publicCampaigns.set(rows);

        // RE-MATCHED NOW THE LIST EXISTS.
        this.bindCampaignFromLink();
      },
      error: () => this.publicCampaigns.set([]),
    });
  }

  /** Fills name and e-mail from the signed-in user's token claims. */
  private prefillFromAccount(): void {
    if (!this.isInternalView()) {
      return;
    }

    const email = this.currentUser.email();
    const name = this.currentUser.displayName();

    if (name) {
      this.fullName.set(name);
    }

    if (email) {
      this.emailOrMobile.set(email);
    }
  }

  private loadConfig(): void {
    this.uiState.set('loading');
    this.dataService.getPublicDonationInitiationData().subscribe({
      next: (config: PublicDonationInitiationConfig) => {
        this.pageTitle.set(config.pageTitle);
        this.pageSubtitle.set(config.pageSubtitle);
        this.operatingTimeZone.set(config.operatingTimeZone);
        this.consentPolicyVersion.set(config.consentPolicyVersion);
        this.currencyCatalogue.set(config.currencies);
        this.geographyCatalogue.set(config.geographies);
        this.permissions.set(config.permissions);
        this.maxDonationAmount.set(config.maxDonationAmount);
        this.uiState.set('ready');

        this.bindCampaignFromLink();

        this.bindIntentFromQueryString();
      },
      error: () => {
        this.uiState.set('ready');
        this.toast.show('Error', 'Failed to load public donation initiation configuration.', 'error');
      },
    });
  }

  /**
   * Selects the campaign a link named - by code, name or id.
   * A CAMPAIGN THAT DOES NOT MATCH LEAVES THE PICKER OPEN rather than locking it empty.
   */
  private bindCampaignFromLink(): void {
    const code = (this.route.snapshot.queryParamMap.get('campaign') ?? '').trim().toLowerCase();

    if (!code) {
      return;
    }

    const match = this.campaignOptions().find(
      (option) =>
        option.reference.toLowerCase() === code
        || option.name.toLowerCase() === code
        || (option.apiId ?? '').toLowerCase() === code,
    );

    if (match) {
      this.selectedCampaign.set(match);
      this.campaignPickerOpen.set(false);
      this.syncAmountToCampaign();
      return;
    }

    this.campaignLockedByLink.set(false);
    this.pushActivity('The campaign named on the link is not open for donations; choose one below.');
  }

  /** Reopens an intent this browser was sent to finish paying - read from the API. */
  private bindIntentFromQueryString(): void {
    const params = this.route.snapshot.queryParamMap;
    const reference = params.get('intent') ?? params.get('intentReference') ?? '';
    if (!reference) {
      return;
    }

    this.payments.getPublicIntent(reference).subscribe({
      next: (intent) => {
        this.intentReference.set(intent.intentReference);
        this.fullName.set(intent.donorName);
        this.emailOrMobile.set(intent.email ?? '');
        this.mobileNumber.set(intent.mobile ?? '');
        // THE INTENT'S OWN AMOUNT, AND IT IS PINNED.
        this.donationAmount.set(String(intent.amount.amount));
        this.amountFromIntent.set(true);
        this.currency.set(intent.amount.currencyCode);
        this.paymentLinkDestination.set(intent.paymentLinkUrl ?? '');
        this.lifecycleState.set(intent.paymentLinkUrl ? 'Awaiting payment' : 'Submitted');

        const campaign = this.campaignOptions().find((c) => c.name === intent.campaignName);
        if (campaign) {
          this.selectedCampaign.set(campaign);
        }

        this.pushActivity('Loaded donation intent ' + intent.intentReference + '.');
        this.toast.show(
          'Continue payment',
          'Donation ' + intent.intentReference + ' is ready. Select Continue to payment to finish it.',
          'info',
        );
      },
      error: (error: unknown) =>
        this.toast.show('Donation not found', apiErrorMessage(error), 'error'),
    });
  }
}