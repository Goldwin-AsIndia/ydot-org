import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { switchMap } from 'rxjs';
import { ToastService } from '../../../../Shared/services/toast.service';
import { PaymentApiService } from '../../../../Service/payment-api.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { MoneyResponse, PaymentActivityRow, PaymentOption } from '../../../../Shared/models/payment.model';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
/**
 * The three outcomes a payment event can settle in. Unlike the old Payment Event Queue (which
 * only ever showed Fail/Pending) and the old Receipt Register (which only ever showed
 * Success/Failed), THIS screen shows all three side by side - that is the whole point of merging
 * them: "one place to track every payment event and the receipt it generated."
 */
export type PaymentOutcome = string;

/**
 * What actually happened to the donor's copy of the receipt.
 *
 * IT USED TO BE TWO WORDS AND ONE OF THEM WAS A GUESS. The row showed "Sent" whenever a receipt
 * NUMBER existed - so a receipt whose e-mail bounced, or whose delivery threw, or that was never
 * attempted because the donor had no address, all read as Sent. The register knew better the
 * whole time: `deliveryState` comes back on every row and was being thrown away.
 *
 * The distinction matters because "no receipt arrived" is the single most common thing a donor
 * telephones about, and the page an administrator opens to check was answering Sent regardless.
 */
export type ReceiptStatus = string;

export type UiState =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'error'
  | 'no-access'
  | 'conflict'
  | 'dependency-failure';

/**
 * One row of the merged register, in the shape the template binds to.
 *
 * THE MERGE IS THE SERVER'S. `GET /payments/activity` answers issued receipts (Success) and the
 * gateway event queue's Pending and Fail lines as one paged list, ordered by time, with the five
 * tiles counted where each kind of row comes from. This screen used to compose the two sources
 * itself - two hundred rows of each, merged and paged in the browser - so beyond two hundred the
 * total and the pager were wrong.
 */
export interface PaymentReceiptRow {
  readonly id: string;
  readonly eventReference: string;
  readonly receiptOrIntentRef: string;
  readonly donationIntentId: string | null;
  readonly donorName: string;
  readonly donorEmail: string;
  readonly campaignName: string;
  readonly amount: number | null;
  readonly currency: string;
  readonly paymentStatus: PaymentOutcome;
  readonly receiptStatus: ReceiptStatus;
  readonly receiptReference: string | null;
  readonly receivedTime: string;
  /** Raw ISO timestamp used only to sort the merged "All statuses" list - never rendered. */
  readonly sortKey: string;
  readonly attempts: number;
  readonly version: number;
  readonly processingError: string | null;
  /** What the caller may do from this line - the server's list: Retry, ResendLink, ContinuePayment, Resend. */
  readonly permittedActions: readonly string[];
}

export interface PaymentsReceiptsSummary {
  readonly totalEvents: number;
  readonly totalAmount: MoneyResponse;
  readonly successful: number;
  readonly pending: number;
  readonly failed: number;
}

/**
 * SCR-PAY-00X - Payments & Receipts (merged view).
 *
 * Replaces two separate screens - the Payment Event Queue (SCR-PAY-003) and the Receipt Register
 * (SCR-PAY-005) - with the single index the reference design shows: every payment event, whatever
 * it settled as, in one table, with the receipt outcome alongside it instead of on a different
 * page. Payment Support and Safe Retry, and Receipt Correction, are unaffected - they stay as
 * their own screens for the same reason they always were separate: this index is for finding a
 * record, not for the deeper edit/void workflow.
 *
 * THE ONE WRITE ACTION IS CONTEXTUAL, NOT UNIFORM, because the four statuses are not four
 * variations of the same button:
 *   - Fail    -> Retry, via the same safe-retry flow the queue used (read the intent's version
 *                first, then call safe-retry with it, then report Retried / AlreadyPaid /
 *                StillPending / sent-to-Support exactly as before).
 *   - Pending -> Continue payment, handing over only the reference (never donor data) to the
 *                public donation form.
 *   - Success -> Resend, and only if the row actually has a receipt to resend and the caller is
 *                permitted to (permittedActions().includes('Resend')).
 * A row with none of these available shows no action, not a disabled one.
 */
@Component({
  selector: 'app-payment-event-queue',
  imports: [RowsPerPage, PageHeader, CommonModule, FormsModule],
  templateUrl: './payment-event-queue.html',
  styleUrl: './payment-event-queue.css',
})
export class PaymentEventQueueComponent {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly payments = inject(PaymentApiService);

  /**
   * WHAT A ROW OFFERS IS THE SERVER'S LIST FOR THAT ROW - Retry and ResendLink on a failed
   * payment, ContinuePayment on a pending one, Resend on an issued receipt - worked out from the
   * caller's permissions (pay.payments.safe-retry, pay.intents.resend-link, pay.intents.create,
   * pay.receipts.resend) and the row's own state. A row with none of them shows no action.
   */
  protected can(row: PaymentReceiptRow | null | undefined, action: string): boolean {
    return !!row && row.permittedActions.includes(action);
  }

  protected readonly pageTitle = 'Payments & Receipts';
  protected readonly pageSubtitle = 'One place to track every payment event and the receipt it generated.';
  /** The zone the page's dates are read in - the server's. */
  protected readonly operatingTimeZone = signal('');
  protected readonly lastRefresh = signal('');

  protected readonly uiState = signal<UiState>('loading');
  protected readonly errorMessage = signal('');

  
  // ===========================================================================================
  // Filters
  // ===========================================================================================

  protected readonly filtersVisible = signal(false);
  protected toggleFiltersVisible(): void {
    this.filtersVisible.update((v) => !v);
  }

  protected readonly searchTerm = signal('');

  /** All three outcomes, in the server's words: Success, Pending and Fail. */
  private readonly statusOptions = signal<readonly PaymentOption[]>([]);
  protected readonly paymentStatusOptions = computed<readonly PaymentOutcome[]>(() =>
    this.statusOptions().map((option) => option.value));
  protected readonly paymentStatusFilter = signal<PaymentOutcome | ''>('');

  protected readonly activeFilterSummary = computed(() => {
    const chips: { key: string; label: string }[] = [];
    if (this.paymentStatusFilter()) {
      chips.push({ key: 'paymentStatus', label: `Payment status: ${this.paymentStatusFilter()}` });
    }
    if (this.searchTerm().trim()) {
      chips.push({ key: 'search', label: `Search: ${this.searchTerm().trim()}` });
    }
    return chips;
  });

  protected removeFilterChip(key: string): void {
    if (key === 'paymentStatus') this.paymentStatusFilter.set('');
    if (key === 'search') this.searchTerm.set('');
    this.refreshAfterFilterChange();
  }

  protected clearFilters(): void {
    this.searchTerm.set('');
    this.paymentStatusFilter.set('');
    this.refreshAfterFilterChange();
  }

  protected applyFilters(): void {
    this.refreshAfterFilterChange();
  }

  /** Debounced, same reasoning as the old queue: every keystroke is now a request, not a filter. */
  protected onSearchChange(value: string): void {
    this.searchTerm.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.refreshAfterFilterChange(), 300);
  }
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected onStatusChange(value: PaymentOutcome | ''): void {
    this.paymentStatusFilter.set(value);
    this.refreshAfterFilterChange();
  }

  // ===========================================================================================
  // Payment status dropdown - the custom replacement for the native <select>
  // ===========================================================================================

  /** '' is "All statuses", listed first. */
  protected readonly statusMenuItems = computed<readonly (PaymentOutcome | '')[]>(() => ['', ...this.paymentStatusOptions()]);
  protected readonly statusMenuOpen = signal(false);
  protected readonly statusActiveIndex = signal(0);

  protected toggleStatusMenu(): void {
    if (this.statusMenuOpen()) {
      this.statusMenuOpen.set(false);
      return;
    }
    // Open on the current choice, so the highlight starts where the user already is.
    this.statusActiveIndex.set(Math.max(0, this.statusMenuItems().indexOf(this.paymentStatusFilter())));
    this.statusMenuOpen.set(true);
  }

  /** Picking the value already chosen closes the menu without re-fetching. */
  protected pickStatus(value: PaymentOutcome | ''): void {
    this.statusMenuOpen.set(false);
    if (value !== this.paymentStatusFilter()) {
      this.onStatusChange(value);
    }
  }

  /** Arrow keys move, Enter picks, Escape / Tab close. Focus stays on the trigger throughout. */
  protected onStatusMenuKeydown(event: KeyboardEvent): void {
    const count = this.statusMenuItems().length;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.statusMenuOpen()) {
          this.toggleStatusMenu();
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.statusActiveIndex.update((i) => (i + step + count) % count);
        break;
      }
      case 'Enter':
      case ' ': {
        if (!this.statusMenuOpen()) {
          return; // the button's own click opens it
        }
        event.preventDefault();
        this.pickStatus(this.statusMenuItems()[this.statusActiveIndex()]);
        break;
      }
      case 'Escape':
      case 'Tab':
        this.statusMenuOpen.set(false);
        break;
    }
  }

  /** A click anywhere outside the dropdown closes it. */
  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMouseDown(event: MouseEvent): void {
    if (this.statusMenuOpen() && !(event.target as HTMLElement | null)?.closest('.pr-dd')) {
      this.statusMenuOpen.set(false);
    }
  }

  /** Search affects the summary tiles too (they are scoped by the same search term), so both
   *  the rows and the summary are re-fetched together whenever a filter changes. */
  private refreshAfterFilterChange(): void {
    this.currentPage.set(1);
    this.loadRows();
  }

  // ===========================================================================================
  // Rows, totals and paging - all server-side, scope-wide
  // ===========================================================================================

  protected readonly records = signal<readonly PaymentReceiptRow[]>([]);
  protected readonly totalRecords = signal(0);
  protected readonly summary = signal<PaymentsReceiptsSummary | null>(null);
  protected readonly pageSize = signal(10);
  protected setPageSize(n: number): void { this.pageSize.set(n); this.currentPage.set(1); this.loadRows(); }
  protected readonly currentPage = signal(1);

  protected readonly totalEvents = computed(() => this.summary()?.totalEvents ?? 0);
  protected readonly totalAmount = computed(() => this.summary()?.totalAmount.amount ?? 0);

  /** Successful money, in its own currency - the server's sum. */
  protected readonly totalAmountLabel = computed(() => {
    const total = this.summary()?.totalAmount;
    if (!total) return '0';
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: total.currencyCode, maximumFractionDigits: 2 }).format(total.amount);
    } catch {
      return `${total.currencyCode} ${total.amount.toLocaleString('en-IN')}`;
    }
  });
  protected readonly successfulCount = computed(() => this.summary()?.successful ?? 0);
  protected readonly pendingCount = computed(() => this.summary()?.pending ?? 0);
  protected readonly failedCount = computed(() => this.summary()?.failed ?? 0);

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalRecords() / this.pageSize())));
  protected readonly pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));
  protected readonly pagedRecords = computed(() => this.records());
  protected readonly pageStart = computed(() =>
    this.totalRecords() === 0 ? 0 : (this.currentPage() - 1) * this.pageSize() + 1,
  );
  protected readonly pageEnd = computed(() =>
    Math.min(this.currentPage() * this.pageSize(), this.totalRecords()),
  );

  protected goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) return;
    this.currentPage.set(page);
    this.loadRows();
  }

  constructor() {
    this.loadRows();
  }

  /**
   * One page of the merged index, its five tiles and its status choices - one call.
   *
   * THE SERVER MERGES THE TWO SOURCES. Issued receipts are the Success lines and the gateway event
   * queue supplies the Pending and Fail ones; the payments service merges them by time, pages the
   * merge and counts each tile where its rows come from. This screen used to fetch two hundred rows
   * from each source and merge and page them itself, so beyond two hundred the total and the pager
   * were wrong - the stop-gap this replaces said as much.
   */
  private loadRows(): void {
    this.uiState.set('loading');
    this.errorMessage.set('');

    const outcome = this.paymentStatusFilter();

    this.payments
      .getPaymentActivity({
        page: this.currentPage(),
        pageSize: this.pageSize(),
        search: this.searchTerm().trim() || null,
        outcome: outcome || null,
      })
      .subscribe({
        next: (response) => {
          this.statusOptions.set(response.statusOptions ?? []);
          this.operatingTimeZone.set(response.operatingTimeZoneLabel ?? '');
          this.summary.set(response.summary);
          this.applyRows(response.rows.items.map((row) => this.fromActivityRow(row)), response.rows.totalCount);
        },
        error: (error) => this.handleLoadError(error),
      });
  }

  private applyRows(rows: readonly PaymentReceiptRow[], totalCount: number): void {
    this.records.set(rows);
    this.totalRecords.set(totalCount);
    this.lastRefresh.set(this.nowLabel());
    this.uiState.set(rows.length === 0 ? 'empty' : 'ready');
  }

  private handleLoadError(error: unknown): void {
    this.errorMessage.set(apiErrorMessage(error));
    this.uiState.set(this.isForbidden(error) ? 'no-access' : 'error');
    this.toast.show('Payments & Receipts unavailable', this.errorMessage(), 'error');
  }

  private isForbidden(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { status?: number }).status === 403;
  }

  /** One line of the server's merged index, in the shape the template binds to. */
  private fromActivityRow(row: PaymentActivityRow): PaymentReceiptRow {
    return {
      id: row.id,
      eventReference: row.eventReference,
      receiptOrIntentRef: row.receiptOrIntentReference || '—',
      donationIntentId: row.donationIntentId,
      donorName: row.donorName ?? '—',
      donorEmail: row.donorEmail ?? '—',
      campaignName: row.campaignName ?? '—',
      amount: row.amount?.amount ?? null,
      currency: row.amount?.currencyCode ?? '',
      paymentStatus: row.paymentStatus,
      receiptStatus: row.receiptStatus,
      receiptReference: row.receiptNumber,
      receivedTime: row.occurredAtUtc ? this.formatDateTime(row.occurredAtUtc) : '—',
      sortKey: row.occurredAtUtc ?? '',
      attempts: row.processingAttempts,
      version: row.version,
      processingError: row.processingError,
      permittedActions: row.permittedActions ?? [],
    };
  }

  // ===========================================================================================
  // Detail panel - the eye/gear icon on a row
  // ===========================================================================================

  protected readonly selectedRef = signal<string>('');
  protected readonly selectedEvent = computed(
    () => this.records().find((r) => r.eventReference === this.selectedRef()) ?? null,
  );

  protected inspect(ref: string): void {
    this.selectedRef.set(ref);
  }

  protected closeDetail(): void {
    this.selectedRef.set('');
  }

  protected isSelected(ref: string): boolean {
    return this.selectedRef() === ref;
  }

  // ===========================================================================================

  // Row quick-view popup - the plus icon on a row. Carries the columns the table hides on
  // md screens and below (td-xl-none), so the collapsed index never loses its data.
  // ===========================================================================================

  protected readonly rowPopup = signal<PaymentReceiptRow | null>(null);

  protected openRowPopup(row: PaymentReceiptRow): void {
    this.rowPopup.set(row);
  }

  protected closeRowPopup(): void {
    this.rowPopup.set(null);
  }

  /** Close the quick view first so the full detail drawer opens on a clean screen. */
  protected inspectFromPopup(ref: string): void {
    this.closeRowPopup();
    this.inspect(ref);
  }

  // ===========================================================================================
  // Retry (Fail rows) - unchanged from the queue's safe-retry flow

  // Retry (Fail rows) - verify, then actually issue the link the verification earned
  // ===========================================================================================
  //
  // WHAT "RETRY" DID BEFORE, AND WHY THE TOAST WAS A LIE. Pressing it called safe-retry, which
  // does exactly one thing: it asks the provider what really happened to the last attempt, so a
  // donor who was in fact charged is never charged twice. That check is the whole reason the
  // operation is called SAFE retry, and it worked. What it does NOT do is re-attempt the
  // payment - the server says so in as many words, returning "A new payment link CAN be issued"
  // with paymentLinkUrl null - and nothing was ever done with that answer.
  //
  // So the screen said "Retry started ... A new payment link can be issued", and then:
  //   - no link was created, and none was sent anywhere;
  //   - no new attempt was opened, so the donation never reached the attempt cap and never
  //     moved on to Payment Support & Safe Retry the way the flow document says it should;
  //   - the row stayed Fail, so the obvious reading was that the retry had failed too.
  // The donor was waiting for an e-mail that no part of the system had undertaken to send.
  //
  // A retry now completes the sentence the server starts: verify first, and where the previous
  // attempt is confirmed unsuccessful, issue the fresh link through the endpoint that already
  // exists for it (POST donation-intents/{id}/resend-link) - which opens a new attempt and has
  // the provider e-mail the link to the donor. The toast then names the address it went to,
  // because "where will it be sent" is the question anybody pressing this button is asking.

  protected readonly retryingRef = signal<string | null>(null);

  protected retryPaymentFromQueue(row: PaymentReceiptRow): void {
    // GUARDED HERE AS WELL AS IN THE TEMPLATE. The button is not drawn without the row's Retry,
    // but a method reachable from a template is reachable from a console, and this one takes a
    // payment. The API refuses it too; this is the layer that keeps the screen honest about it.
    if (!this.can(row, 'Retry')) {
      return;
    }

    if (!row.donationIntentId) {
      this.toast.show(
        'Nothing to retry',
        'This event was never matched to a donation, so there is no payment to retry.',
        'warning',
      );
      return;
    }
    if (this.retryingRef() !== null) return;

    const intentId = row.donationIntentId;
    this.retryingRef.set(row.eventReference);

    this.payments
      .getIntent(intentId)
      .pipe(
        switchMap((intent) =>
          this.payments.safeRetry(intentId, {
            expectedVersion: intent.version,
            reason: `Retried from Payments & Receipts for event ${row.eventReference}.`,
          }),
        ),
      )
      .subscribe({
        next: (result) => {
          // ONLY "Retried" MEANS THE MONEY DEFINITELY DID NOT MOVE. AlreadyPaid and StillPending
          // are the two answers that must never be followed by asking for payment again, and
          // they are reported and left alone.
          if (result.outcome === 'Retried') {
            this.issueFreshLinkAfterRetry(row, intentId);
            return;
          }

          this.retryingRef.set(null);
          this.reportRetryOutcome(row, result.outcome, result.message, result.paymentLinkUrl);
          this.loadRows();
        },
        error: (error: unknown) => {
          this.retryingRef.set(null);
          this.toast.show('Retry not completed', apiErrorMessage(error), 'error');
        },
      });
  }

  /**
   * The half of a retry that actually asks the donor for the money again.
   *
   * REACHED ONLY AFTER THE PROVIDER HAS CONFIRMED THE LAST ATTEMPT FAILED. That confirmation is
   * what makes issuing a second link safe rather than a double charge, and it is why this is a
   * separate step instead of one call: a verification that comes back AlreadyPaid must end the
   * whole operation, not merely change the wording on it.
   *
   * THE VERSION IS RE-READ RATHER THAN REUSED. Safe retry may have written to the intent -
   * verification can settle an attempt and move the status - so the version held from before the
   * call is stale, and sending it would be refused as a concurrency conflict the operator can
   * neither see nor act on.
   */
  private issueFreshLinkAfterRetry(row: PaymentReceiptRow, intentId: string): void {
    // A caller who may verify but not re-issue is told plainly what did and did not happen. This
    // is the Donor's case: their own next step is Continue payment, which they hold.
    if (!this.can(row, 'ResendLink')) {
      this.retryingRef.set(null);
      this.toast.show(
        'Previous attempt confirmed failed',
        `Nothing was charged for ${row.receiptOrIntentRef} and no new payment link has been sent. `
          + 'Use Continue payment to pay it now, or ask an administrator to send a fresh link.',
        'info',
      );
      this.loadRows();
      return;
    }

    this.payments
      .getIntent(intentId)
      .pipe(switchMap((intent) => this.payments.resendPaymentLink(intentId, intent.version)))
      .subscribe({
        next: (link) => {
          this.retryingRef.set(null);
          this.toast.show(
            'New payment link sent',
            row.donorEmail && row.donorEmail !== '\u2014'
              ? `A fresh payment link for ${row.receiptOrIntentRef} was e-mailed to `
                + `${row.donorEmail}. It is attempt ${link.attemptNumber} and expires `
                + `${this.formatDateTime(link.expiresAtUtc)}.`
              : `A fresh payment link was issued for ${row.receiptOrIntentRef} (attempt `
                + `${link.attemptNumber}), expiring ${this.formatDateTime(link.expiresAtUtc)}. `
                + 'This donation carries no e-mail address, so nothing was sent - pass the link '
                + 'to the donor yourself.',
            'success',
          );
          this.loadRows();
        },

        // THE TWO HALVES FAIL SEPARATELY AND ARE REPORTED SEPARATELY. The verification succeeded
        // and nothing was charged - saying only "retry failed" here would leave an operator
        // believing the donor may have been billed.
        error: (error: unknown) => {
          this.retryingRef.set(null);
          this.toast.show(
            'No new payment link was issued',
            `The previous attempt for ${row.receiptOrIntentRef} was confirmed as unsuccessful and `
              + `nothing was charged, but a fresh link could not be issued: ${apiErrorMessage(error)}`,
            'warning',
          );
          this.loadRows();
        },
      });
  }

  private reportRetryOutcome(
    row: PaymentReceiptRow,
    outcome: string,
    message: string,
    paymentLinkUrl: string | null,
  ): void {
    switch (outcome) {
      // 'Retried' NEVER ARRIVES HERE any more - it is the one outcome with work still to do, and
      // issueFreshLinkAfterRetry does that work and reports what came of it. The branch remains
      // only so an outcome added server-side that reuses the word is not reported as a refusal.
      case 'Retried':
        this.toast.show(
          'Previous attempt confirmed failed',
          paymentLinkUrl
            ? `A fresh payment link was issued for ${row.receiptOrIntentRef}.`
            : message,
          'success',
        );
        break;
      case 'AlreadyPaid':
        this.toast.show(
          'Already paid',
          `${row.donorName} has already been charged for ${row.receiptOrIntentRef}. No second payment was taken; the receipt appears against this donation as soon as it is issued.`,
          'info',
        );
        break;
      case 'StillPending':
        this.toast.show(
          'Still pending',
          'The gateway has not settled this payment yet. Nothing was charged again - check back rather than retrying.',
          'warning',
        );
        break;
      default:
        this.toast.show(
          'Sent to Payment Support',
          message || 'This payment could not be retried safely. It stays on this page as a failed event for support to investigate.',
          'warning',
        );
        break;
    }
  }

  // ===========================================================================================
  // Continue payment (Pending rows) - reference only, unchanged from the queue
  // ===========================================================================================

  protected continuePaymentFromQueue(row: PaymentReceiptRow): void {
    if (!this.can(row, 'ContinuePayment')) {
      return;
    }

    if (row.receiptOrIntentRef === '—') {
      this.toast.show('No donation to continue', 'This event was never matched to a donation.', 'warning');
      return;
    }
    this.router.navigate(['/app/donations/public-donation-initiation'], {
      queryParams: { intent: row.receiptOrIntentRef },
    });
  }

  // ===========================================================================================
  // Resend receipt (Success rows) - unchanged from the register, reason still audited
  // ===========================================================================================

  protected readonly resendAllowed = computed(() => {
    const current = this.selectedEvent();
    // ANY ISSUED RECEIPT MAY BE RE-SENT, not only one already delivered - the server lists Resend
    // on every line with a receipt when the caller holds pay.receipts.resend.
    return this.can(current, 'Resend');
  });

  protected readonly resendDialogOpen = signal(false);
  protected readonly resendReason = signal('');
  protected readonly resendReasonTouched = signal(false);
  protected readonly resendReasonMin = 10;
  protected readonly resendReasonMax = 500;
  protected readonly resendReasonValid = computed(() => {
    const length = this.resendReason().trim().length;
    return length >= this.resendReasonMin && length <= this.resendReasonMax;
  });

  protected openResendDialog(): void {
    if (!this.resendAllowed()) return;
    this.resendReason.set('');
    this.resendReasonTouched.set(false);
    this.resendDialogOpen.set(true);
  }

  protected cancelResend(): void {
    this.resendDialogOpen.set(false);
  }

  protected confirmResend(): void {
    const current = this.selectedEvent();
    this.resendReasonTouched.set(true);
    if (!current || !this.resendReasonValid()) return;

    this.payments.resendReceipt(current.id, { channel: 'Email' }).subscribe({
      next: () => {
        this.resendDialogOpen.set(false);
        this.toast.show('Receipt resent', `A copy of ${current.receiptReference} was sent to the donor.`, 'success');
        this.loadRows();
      },
      error: (error: unknown) => this.toast.show('Receipt not resent', apiErrorMessage(error), 'error'),
    });
  }

  // ===========================================================================================
  // Presentation
  // ===========================================================================================

  protected readonly copiedField = signal<string | null>(null);
  protected copyValue(label: string, value: string): void {
    navigator.clipboard?.writeText(value).catch(() => undefined);
    this.copiedField.set(label);
    setTimeout(() => {
      if (this.copiedField() === label) this.copiedField.set(null);
    }, 1500);
  }

  protected setUiState(state: UiState): void {
    this.uiState.set(state);
  }

  protected dismissBanner(): void {
    this.uiState.set(this.records().length === 0 ? 'empty' : 'ready');
  }

  protected paymentStatusClass(status: PaymentOutcome): string {
    switch (status) {
      case 'Success': return 'pr-badge-good';
      case 'Fail': return 'pr-badge-danger';
      case 'Pending': return 'pr-badge-gold';
      default: return 'pr-badge-muted';
    }
  }

  /**
   * THE DETAILS-DRAWER BANNER TINTS ITSELF WITH THE EVENT'S PAYMENT STATUS:
   * green artwork for a success, amber while pending, red for a failure.
   */
  protected detailArtClass(): string {
    switch (this.selectedEvent()?.paymentStatus) {
      case 'Pending': return 'art-pending';
      case 'Fail': return 'art-fail';
      default: return 'art-success';
    }
  }

  protected receiptStatusClass(status: ReceiptStatus): string {
    switch (status) {
      case 'Sent': return 'pr-badge-blue';

      // A RECEIPT THAT DID NOT REACH THE DONOR READS AS A PROBLEM, because it is one - the
      // donation succeeded and the donor has nothing to claim tax relief with. It shared the
      // muted grey of "Not generated" while the column said Sent regardless, so a failed
      // delivery was invisible twice over.
      case 'Failed': return 'pr-badge-danger';
      case 'Pending': return 'pr-badge-gold';
      default: return 'pr-badge-muted';
    }
  }

  /**
   * THE REFERENCE CHIP AT THE START OF EACH ROW TAKES ITS TINT FROM THE ROW'S RECEIPT STATUS,
   * so the colour language the receipt-status column used to carry (blue sent, gold pending,
   * red failed, grey otherwise) still reads at a glance on the row itself.
   */
  protected receiptDocClass(status: ReceiptStatus): string {
    switch (status) {
      case 'Sent': return 'pr-doc-blue';
      case 'Pending': return 'pr-doc-gold';
      case 'Failed': return 'pr-doc-danger';
      default: return 'pr-doc-muted';
    }
  }

  protected formatAmount(amount: number | null): string {
    if (amount === null) return '—';
    return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private formatDateTime(iso: string): string {
    if (!iso) return '—';
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime())
      ? iso
      : parsed.toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
  }

  private nowLabel(): string {
    return new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
}