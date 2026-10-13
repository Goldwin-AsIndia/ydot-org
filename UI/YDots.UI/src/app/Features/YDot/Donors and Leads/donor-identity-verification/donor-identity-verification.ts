import { countOf } from '../../../../Shared/pipes/count.pipe';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmModalComponent } from '../../../../Shared/components/confirm-modal/confirm-modal';
import {
  UiState,
  IdentityVerificationData,
  ConfirmDialogConfig,
} from '../../../../Shared/models/donors-leads.model';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  DonLookupItem,
  IdentityVerification,
  QueueView,
  VerificationTrailEntry,
} from '../../../../Shared/models/donor-contract.model';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';


import { NavigationHistoryService } from '../../../../Shared/services/navigation-history.service';
type TabId = 'overview' | 'history' | 'actions';

/** Statuses only the server's own steps reach - sending a code, the right code, the last wrong one. */
const AUTOMATIC_STATUSES: readonly string[] = ['ChallengeSent', 'Verified', 'Failed'];

/** The screen's action ids and the verbs the server lists on an attempt. */
const ACTION_VERBS: Record<string, string> = {
  sendChallenge: 'Send challenge',
  verifyCode: 'Verify code',
  escalateReview: 'Escalate review',
  cancelVerification: 'Cancel verification',
};

/** Extended, page-local workflow states beyond the shared ready/success UiState. */
type FlowState =
  | 'idle'
  | 'loading'
  | 'validation'
  | 'duplicate'
  | 'conflict'
  | 'dependency-failure';

/** Persistent (non-toast) outcome shown after a committed action. */
interface ResultPanel {
  actionLabel: string;
  reference: string;
  status: string;
  effectiveTime: string;
  dependency: string;
  nextAction: string;
  isDependencyFailure: boolean;
}

/**
 * DON-UI-07 — Donor identity verification.
 * Verify contact ownership and identity confidence before sensitive correction, merge or portal access.
 */
@Component({
  selector: 'app-donor-identity-verification',
  imports: [PageHeader, CommonModule, FormsModule, ConfirmModalComponent],
  templateUrl: './donor-identity-verification.html',
  styleUrl: './donor-identity-verification.css',
})
export class DonorIdentityVerificationComponent {
  private readonly router = inject(Router);
  private readonly navHistory = inject(NavigationHistoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DonorApiService);
  private readonly toast = inject(ToastService);

  /**
   * SCR-DON-007 - Donor identity verification. The document lists it among the shared functions:
   * "Identity Verification redirects to the page where the donor's identity is verified."
   *
   * WHAT THIS REPLACES, AND WHY THE LAST ITEM IS THE WORST OF THEM.
   * `donor-identity-verification.json` supplied the verification reference, the channel, the
   * masked destination, the attempt count, the expiry and the status. It also supplied
   * `demoValidCode` - a literal code the screen compared the donor's answer against, so identity
   * was "verified" by matching a string compiled into the bundle. Anybody who opened dev-tools
   * could read it, and the real code the donor received was never checked at all.
   *
   * VERIFICATION IS NOW THE SERVER'S. `verifyIdentityCode` compares against the code it issued,
   * counts the attempt, and refuses once the allowance is spent.
   */
  protected readonly donorReference = signal(this.route.snapshot.queryParamMap.get('donorId') ?? '');
  protected readonly leadId = signal(this.route.snapshot.queryParamMap.get('leadId'));

  /** The verification being worked on, as the server holds it. */
  protected readonly verification = signal<IdentityVerification | null>(null);

  protected readonly uiState = signal<UiState>('loading');
  protected readonly confirmConfig = signal<ConfirmDialogConfig | null>(null);
  protected readonly activeActionId = signal('');
  protected readonly activeTab = signal<TabId>('overview');

  /** All attempts / Current attempt, as the server serves and counts them. */
  protected readonly savedFilters = signal<readonly QueueView[]>([]);
  protected readonly savedFilter = signal('all');
  private readonly trail = signal<readonly VerificationTrailEntry[]>([]);

  protected readonly permissions = signal<Record<string, boolean>>({
    view: false,
    sendChallenge: false,
    verifyCode: false,
    escalateReview: false,
    cancelVerification: false,
  });

  protected readonly channelOptions = signal<readonly DonLookupItem[]>([]);
  protected readonly statusOptions = signal<readonly DonLookupItem[]>([]);
  private readonly confidenceOptions = signal<readonly DonLookupItem[]>([]);

  private labelOf(options: readonly DonLookupItem[], value: string): string {
    return options.find((option) => option.value === value)?.label ?? value;
  }

  private valueOf(options: readonly DonLookupItem[], label: string): string {
    return options.find((option) => option.label === label)?.value ?? label;
  }
  protected readonly codeValidMinutes = signal(0);
  protected readonly maxAttempts = signal(0);
  protected readonly activeScope = signal('');
  protected readonly lastRefresh = signal('');

  // ---- The record, read from the server's answer ----
  /** The status VALUE ("ChallengeSent"), which is what the screen's rules compare. */
  protected readonly verificationStatus = computed(() => this.verification()?.status ?? 'NotStarted');
  /** The status as the server words it ("Challenge sent"). */
  protected readonly verificationStatusLabel = computed(() => this.labelOf(this.statusOptions(), this.verificationStatus()));
  protected readonly verificationReference = computed(() => this.verification()?.verificationReference ?? '');
  protected readonly currentPurpose = computed(() => this.verification()?.verificationPurpose ?? '');
  protected readonly currentChannel = computed(() => this.verification()?.verificationChannel ?? '');
  protected readonly currentChannelLabel = computed(() => this.labelOf(this.channelOptions(), this.currentChannel()));

  /** Masked by the SERVER. The full address never reaches this screen. */
  protected readonly currentDestination = computed(() => this.verification()?.maskedDestination ?? '');
  protected readonly attemptsUsed = computed(() => this.verification()?.attemptCount ?? 0);
  protected readonly remainingAttempts = computed(() => this.verification()?.remainingAttempts ?? 0);
  protected readonly expiryTime = computed(() => this.formatDateTime(this.verification()?.expiryAtUtc ?? null));
  protected readonly identityConfidence = computed(() =>
    this.labelOf(this.confidenceOptions(), this.verification()?.identityConfidence ?? ''),
  );
  protected readonly evidenceReference = computed(() => this.verification()?.evidenceReference ?? '—');
  protected readonly reviewer = computed(() => this.verification()?.reviewerName ?? '—');
  protected readonly recordVersion = computed(() => this.verification()?.version ?? 0);
  protected readonly integrationStatus = signal('');

  // ---- Detail edit mode: the channel and purpose a new challenge would use ----
  protected readonly isEditingDetails = signal(false);
  protected readonly draftPurpose = signal('');
  protected readonly draftChannel = signal('');
  protected readonly draftDestination = signal('');
  protected readonly draftStatus = signal('');
  protected readonly purposeError = signal<string | null>(null);
  protected readonly destinationError = signal<string | null>(null);
  protected readonly channelFilter = signal('');
  protected readonly statusFilter = signal('');

  protected readonly channels = computed(() => this.channelOptions().map((option) => option.label));

  protected readonly filteredChannelOptions = computed(() =>
    this.channels().filter((c) => c.toLowerCase().includes(this.channelFilter().toLowerCase())),
  );
  protected readonly draftChannelLabel = computed(() => this.labelOf(this.channelOptions(), this.draftChannel()));
  protected readonly draftStatusLabel = computed(() => this.labelOf(this.statusOptions(), this.draftStatus()));

  protected readonly filteredStatusOptions = computed(() =>
    this.statusOptions()
      .map((option) => option.label)
      .filter((value) => value.toLowerCase().includes(this.statusFilter().toLowerCase())),
  );

  constructor() {
    this.load();
  }

  /** `quiet` re-reads for a trail view change without blanking the page. */
  private load(quiet = false): void {
    const donorId = this.donorReference();
    if (!donorId) {
      this.uiState.set('empty');
      return;
    }

    if (!quiet) this.uiState.set('loading');

    const view = this.savedFilter() === 'all' ? null : this.savedFilter();
    this.api.getIdentityVerifications({ donorId, page: 1, pageSize: 20, view }).subscribe({
      next: (response) => {
        // THE MOST RECENT ONE. A donor may have been challenged more than once, and the screen
        // acts on the current attempt.
        this.verification.set(response.verifications.items[0] ?? null);
        this.trail.set(response.trail ?? []);
        this.savedFilters.set(response.trailViews ?? []);
        this.savedFilter.set(response.activeTrailView ?? 'all');

        this.channelOptions.set(response.channelOptions);
        this.statusOptions.set(response.statusOptions);
        this.confidenceOptions.set(response.confidenceOptions ?? []);
        this.codeValidMinutes.set(response.codeValidMinutes);
        this.maxAttempts.set(response.maximumAttempts);
        this.activeScope.set(response.activeScope);
        this.lastRefresh.set(new Date().toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }));

        // VERBS: ['Send challenge','View','Verify code','Escalate review','Cancel verification'].
        const permitted = response.permittedActions ?? [];
        this.permissions.set({
          view: permitted.includes('View'),
          sendChallenge: permitted.includes('Send challenge'),
          verifyCode: permitted.includes('Verify code'),
          escalateReview: permitted.includes('Escalate review'),
          cancelVerification: permitted.includes('Cancel verification'),
        });

        const current = this.verification();
        this.draftPurpose.set(current?.verificationPurpose ?? '');
        this.draftChannel.set(current?.verificationChannel ?? response.channelOptions[0]?.value ?? '');
        this.draftDestination.set(current?.maskedDestination ?? '');
        this.draftStatus.set(current?.status ?? '');

        this.uiState.set('ready');
      },
      error: (error: unknown) => {
        this.uiState.set('dependency-failure');
        this.toast.show('Verification unavailable', apiErrorMessage(error), 'error');
      },
    });
  }

  private formatDateTime(value: string | null): string {
    if (!value) {
      return '—';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? '—'
      : parsed.toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
  }

  // ---- Verify-code inline widget ----
  protected readonly codeInput = signal('');
  protected readonly codeError = signal<string | null>(null);

  // ---- Extended workflow / non-toast states ----
  protected readonly flowState = signal<FlowState>('idle');
  protected readonly resultPanel = signal<ResultPanel | null>(null);
  protected readonly conflictInfo = signal<{ theirChange: string; yourChange: string } | null>(null);

  protected readonly activeFilterSummary = computed(() => {
    const chips: { key: string; label: string }[] = [];
    if (this.savedFilter() !== 'all') {
      const view = this.savedFilters().find((option) => option.value === this.savedFilter());
      chips.push({ key: 'saved', label: `View: ${view?.label ?? this.savedFilter()}` });
    }
    return chips;
  });

  /** A trail view picked: the server narrows the trail and counts it. */
  protected setSavedFilter(value: string): void {
    if (value === this.savedFilter()) return;
    this.savedFilter.set(value);
    this.load(true);
  }

  /**
   * The verification trail, as the server built it from every attempt the donor has had - each
   * step with who took it and when. The screen used to assemble it from the current attempt's
   * timestamps, and dated a cancellation by when the attempt had been created.
   */
  protected readonly filteredHistory = computed(() =>
    this.trail().map((entry) => ({
      primary: entry.event,
      secondary: entry.detail,
      meta: `${entry.actor ?? '—'} · ${this.formatDateTime(entry.atUtc)}`,
    })),
  );

  /**
   * Statuses a user may not set by hand, keyed by the label the picker shows, with the server's
   * own explanation of each as the reason.
   */
  protected readonly lockedStatusReasons = computed<Record<string, string>>(() =>
    Object.fromEntries(
      this.statusOptions()
        .filter((option) => AUTOMATIC_STATUSES.includes(option.value))
        .map((option) => [option.label, option.description ?? '']),
    ),
  );

  protected setTab(tab: TabId): void {
    this.activeTab.set(tab);
  }

  protected removeFilterChip(key: string): void {
    if (key === 'saved') this.setSavedFilter('all');
  }

  protected setUiState(state: UiState): void {
    this.uiState.set(state);
  }

  protected dismissBanner(): void {
    this.uiState.set('ready');
  }

  protected dismissFlowBanner(): void {
    this.flowState.set('idle');
    this.conflictInfo.set(null);
  }

  protected dismissResultPanel(): void {
    this.resultPanel.set(null);
  }

  protected statusClass(status: string): string {
    if (status === 'Verified') {
      return 'div-badge-good';
    }
    if (status === 'Failed' || status === 'Expired') {
      return 'div-badge-danger';
    }
    if (status === 'Escalated') {
      return 'div-badge-warn';
    }
    return 'div-badge-blue';
  }

  // ---------------------------------------------------------------------
  // Detail edit mode (Verification purpose / channel / masked destination /
  // status) — rendered per fieldContracts control types.
  // ---------------------------------------------------------------------

  protected canEditDetails(): boolean {
    return !!this.permissions()['sendChallenge'] || !!this.permissions()['verifyCode'];
  }

  protected startEditDetails(): void {
    if (!this.canEditDetails()) {
      return;
    }
    this.draftPurpose.set(this.currentPurpose());
    this.draftChannel.set(this.currentChannel());
    this.draftDestination.set(this.currentDestination());
    this.draftStatus.set(this.verificationStatus());
    this.purposeError.set(null);
    this.destinationError.set(null);
    this.isEditingDetails.set(true);
  }

  protected cancelEditDetails(): void {
    this.isEditingDetails.set(false);
    this.purposeError.set(null);
    this.destinationError.set(null);
  }

  /** The pickers show labels; the draft keeps the value the server takes ("PhoneCall"). */
  protected selectChannel(label: string): void {
    this.draftChannel.set(this.valueOf(this.channelOptions(), label));
  }

  protected selectStatus(label: string): void {
    if (this.lockedStatusReasons()[label]) {
      return;
    }
    this.draftStatus.set(this.valueOf(this.statusOptions(), label));
  }

  private validatePurpose(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null; // not required
    }
    if (trimmed.length < 10 || trimmed.length > 2000) {
      return 'Enter between 10 and 2,000 characters.';
    }
    if (!/[a-zA-Z]{3,}/.test(trimmed)) {
      return 'Enter meaningful text, not just symbols or whitespace.';
    }
    return null;
  }

  private validateDestination(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return 'Masked destination is required.';
    }
    if (trimmed.length < 6) {
      return 'Enter a valid masked destination.';
    }
    return null;
  }

  protected saveEditDetails(): void {
    const purposeErr = this.validatePurpose(this.draftPurpose());
    const destinationErr = this.validateDestination(this.draftDestination());
    this.purposeError.set(purposeErr);
    this.destinationError.set(destinationErr);

    if (purposeErr || destinationErr) {
      this.flowState.set('validation');
      return;
    }

    // Detect a stale edit session: the record moved on (e.g. a challenge was
    // sent) while this edit was open.
    if (false) {
      this.conflictInfo.set({
        theirChange: `Status changed to "${this.verificationStatus()}" while you were editing.`,
        yourChange: `Your update to purpose, channel and destination is still pending.`,
      });
      this.flowState.set('conflict');
      return;
    }

    // NOTHING IS WRITTEN HERE. Purpose and channel describe the NEXT challenge, and the record
    // only changes when one is actually sent - the old version set the status directly from a
    // dropdown, which meant "Verified" could be chosen rather than earned.
    this.isEditingDetails.set(false);
    this.flowState.set('idle');
    this.uiState.set('success');
  }

  protected resolveConflict(choice: 'compare' | 'reapply' | 'cancel'): void {
    if (choice === 'reapply') {
        this.flowState.set('idle');
      this.saveEditDetails();
      return;
    }
    if (choice === 'cancel') {
      this.isEditingDetails.set(false);
    }
    // 'compare' simply leaves the edit form open with both values visible.
    this.flowState.set('idle');
    this.conflictInfo.set(null);
  }

  // ---------------------------------------------------------------------
  // Verify code — inline widget
  // ---------------------------------------------------------------------

  protected onCodeInputChange(value: string): void {
    this.codeInput.set(value.replace(/[^0-9]/g, '').slice(0, 6));
    this.codeError.set(null);
  }

  protected submitVerifyCode(): void {
    if (!this.can('verifyCode')) {
      return;
    }
    const code = this.codeInput();
    if (code.length !== 6) {
      this.codeError.set('Enter the 6-digit code sent to the donor.');
      this.flowState.set('validation');
      return;
    }
    this.flowState.set('idle');
    this.openAction('verifyCode');
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  private readonly actionCatalogue = [
    {
      id: 'sendChallenge',
      label: 'Send challenge',
      result: 'A one-time code is sent to the donor on the selected channel.',
      placement: 'primary',
      requiresReason: false,
    },
    {
      id: 'verifyCode',
      label: 'Verify code',
      result: 'The code the donor gave is checked against the one that was issued.',
      placement: 'primary',
      requiresReason: false,
    },
    {
      id: 'escalateReview',
      label: 'Escalate for review',
      result: 'The verification is handed to a reviewer with the reason recorded.',
      placement: 'primary',
      requiresReason: true,
    },
    {
      id: 'cancelVerification',
      label: 'Cancel verification',
      result: 'The verification is cancelled and no further codes are accepted.',
      placement: 'danger',
      requiresReason: true,
    },
  ] as const;

  /**
   * The actions valid here: the caller may take it and the attempt on screen allows it (the
   * server lists what each status allows). With no attempt yet, only a challenge can be sent.
   * Escalation needs a reviewer to hand to, and the screen has none to offer unless the attempt
   * already names one.
   */
  protected can(actionId: string): boolean {
    if (this.permissions()[actionId] !== true) return false;
    const current = this.verification();
    if (!current) return actionId === 'sendChallenge';
    const verb = ACTION_VERBS[actionId];
    if (!verb || !current.permittedActions.includes(verb)) return false;
    return actionId !== 'escalateReview' || !!current.reviewerUserId;
  }

  protected readonly canVerifyCode = computed(() => this.can('verifyCode'));

  protected readonly visibleActions = computed(() =>
    this.actionCatalogue.filter((action) => this.can(action.id)),
  );

  protected openAction(actionId: string): void {
    const action = this.actionCatalogue.find((candidate) => candidate.id === actionId);
    if (!action) {
      return;
    }
    if (!this.can(actionId)) {
      this.flowState.set('idle');
      return;
    }

    if (actionId === 'sendChallenge' && this.verificationStatus() === 'ChallengeSent') {
      // A challenge is already in flight. Sending another invalidates the first, so the person
      // is told rather than issuing a second code silently.
      this.flowState.set('duplicate');
      return;
    }

    if (actionId === 'verifyCode' && this.codeInput().length !== 6) {
      this.codeError.set('Enter the 6-digit code sent to the donor.');
      this.flowState.set('validation');
      return;
    }

    this.activeActionId.set(actionId);
    this.confirmConfig.set({
      title: `Confirm ${action.label}`,
      message: action.result,
      confirmLabel: action.label,
      cancelLabel: 'Cancel',
      tone: action.placement === 'danger' ? 'danger' : 'primary',
      requireReason: action.requiresReason,
      reasonLabel: 'Reason',
      reasonMin: 10,
      reasonMax: 2000,
      typedConfirm: false,
      affectedRecord: `${this.verificationReference() || 'New verification'} · ${this.donorReference()}`,
      effectiveTime: this.lastRefresh(),
      beforeAfter: [
        {
          label: 'Status',
          before: this.verificationStatusLabel(),

          // "THE SERVER DECIDES" IS THE HONEST ANSWER for a code check. The old version predicted
          // it here by comparing the typed code against `demoValidCode` from the JSON file - which
          // is to say it knew the answer before asking, and so did anybody reading the bundle.
          after:
            actionId === 'verifyCode'
              ? 'Decided by the server'
              : this.labelOf(
                  this.statusOptions(),
                  actionId === 'cancelVerification' ? 'Cancelled' : actionId === 'escalateReview' ? 'Escalated' : 'ChallengeSent',
                ),
        },
      ],
    });
  }

  protected proceedDuplicateChallenge(): void {
    this.flowState.set('idle');
    this.activeActionId.set('sendChallenge');
    this.confirmConfig.set({
      title: 'Confirm send challenge',
      message: 'A challenge is already active for this record. Sending a new one invalidates the previous code.',
      confirmLabel: 'Send new challenge',
      cancelLabel: 'Cancel',
      tone: 'primary',
      requireReason: false,
      typedConfirm: false,
      affectedRecord: `${this.verificationReference()} · ${this.donorReference()}`,
      effectiveTime: this.lastRefresh(),
      beforeAfter: [{ label: 'Status', before: this.verificationStatusLabel(), after: this.labelOf(this.statusOptions(), 'ChallengeSent') }],
    });
  }

  /**
   * Commits the action.
   *
   * NO SIMULATED DELAY. The previous version ran `setTimeout(..., 550)` "so the loading state is
   * meaningfully visible", then changed local signals - the wait was the only part of it that
   * resembled a server.
   */
  protected onConfirm(reason: string): void {
    const action = this.activeActionId();
    this.confirmConfig.set(null);
    this.activeActionId.set('');
    this.flowState.set('loading');

    switch (action) {
      case 'sendChallenge':
        this.sendChallenge();
        break;
      case 'verifyCode':
        this.verifyCode();
        break;
      case 'escalateReview':
        this.escalate(reason);
        break;
      case 'cancelVerification':
        this.cancelVerification(reason);
        break;
      default:
        this.flowState.set('idle');
    }
  }

  private sendChallenge(): void {
    this.api
      .sendIdentityChallenge({
        donorId: this.donorReference(),
        verificationPurpose: this.draftPurpose().trim() || 'Identity verification',
        verificationChannel: this.draftChannel(),
      })
      .subscribe({
        next: (sent) => {
          this.verification.set(sent.verification);
          this.codeInput.set('');
          this.codeError.set(null);
          this.flowState.set('idle');
          this.resultPanel.set({
            actionLabel: 'Send challenge',
            reference: sent.verification.verificationReference,
            status: this.labelOf(this.statusOptions(), sent.verification.status),
            effectiveTime: this.formatDateTime(sent.verification.sentAtUtc),

            // NAMED WHEN THE MESSAGE IS ONLY QUEUED, so nobody waits for a code that has not left.
            dependency: sent.pendingDependency ?? 'Awaiting the donor to enter the one-time code.',
            nextAction: 'Enter the code below once the donor shares it.',
            isDependencyFailure: false,
          });
          this.toast.show('Challenge sent', sent.message, 'success');
          this.load(true);
        },
        error: (error: unknown) => this.failAction('Send challenge', error),
      });
  }

  /**
   * Checks the donor's code.
   *
   * THE SERVER COMPARES IT, counts the attempt and refuses once the allowance is spent. This
   * screen only reports the answer - which is the whole reason `demoValidCode` had to go.
   */
  private verifyCode(): void {
    const current = this.verification();
    if (!current) {
      this.flowState.set('idle');
      return;
    }

    this.api
      .verifyIdentityCode(current.id, { code: this.codeInput(), expectedVersion: current.version })
      .subscribe({
        next: (updated) => {
          this.verification.set(updated);
          this.flowState.set('idle');
          this.codeInput.set('');

          if (updated.status === 'Verified') {
            this.codeError.set(null);
            this.uiState.set('success');
            this.resultPanel.set({
              actionLabel: 'Verify code',
              reference: updated.verificationReference,
              status: this.labelOf(this.statusOptions(), 'Verified'),
              effectiveTime: this.formatDateTime(updated.verifiedAtUtc),
              dependency: 'None — identity confirmed.',
              nextAction: 'Continue to the consent and preference centre.',
              isDependencyFailure: false,
            });
            this.toast.show('Identity verified', `${this.donorReference()} is verified.`, 'success');
            this.router.navigate(['/app/fundraising/relationships/consent-and-preference-centre'], {
              queryParams: { donorId: this.donorReference(), leadId: this.leadId() },
            });
            return;
          }

          this.codeError.set(
            updated.remainingAttempts > 0
              ? `That code did not match. ${countOf(updated.remainingAttempts, 'attempt')} left.`
              : 'That code did not match and no attempts remain. Send a new challenge.',
          );
          this.uiState.set('ready');
        },
        error: (error: unknown) => this.failAction('Verify code', error),
      });
  }

  private escalate(reason: string): void {
    const current = this.verification();
    if (!current) {
      this.flowState.set('idle');
      return;
    }

    this.api
      .escalateIdentityVerification(current.id, {
        reviewerUserId: current.reviewerUserId ?? '',
        reviewerName: current.reviewerName ?? 'Review team',
        escalationReason: reason,
        expectedVersion: current.version,
      })
      .subscribe({
        next: (updated) => {
          this.verification.set(updated);
          this.flowState.set('idle');
          this.toast.show('Escalated', 'The verification is now with a reviewer.', 'success');
          this.load(true);
        },
        error: (error: unknown) => this.failAction('Escalate for review', error),
      });
  }

  private cancelVerification(reason: string): void {
    const current = this.verification();
    if (!current) {
      this.flowState.set('idle');
      return;
    }

    this.api
      .cancelIdentityVerification(current.id, { reason, expectedVersion: current.version })
      .subscribe({
        next: (updated) => {
          this.verification.set(updated);
          this.flowState.set('idle');
          this.toast.show('Verification cancelled', 'No further codes will be accepted.', 'success');
          this.load(true);
        },
        error: (error: unknown) => this.failAction('Cancel verification', error),
      });
  }

  private failAction(label: string, error: unknown): void {
    this.flowState.set('idle');
    this.resultPanel.set({
      actionLabel: label,
      reference: this.verificationReference(),
      status: this.verificationStatusLabel(),
      effectiveTime: this.lastRefresh(),
      dependency: apiErrorMessage(error),
      nextAction: 'Try again, or escalate for review.',
      isDependencyFailure: true,
    });
    this.toast.show(label + ' failed', apiErrorMessage(error), 'error');
  }

  protected onCancel(): void {
    this.confirmConfig.set(null);
    this.activeActionId.set('');
    this.flowState.set('idle');
  }

  /** Re-reads the record from the server. */
  protected reload(): void {
    this.load();
  }

  protected dismissResult(): void {
    this.resultPanel.set(null);
  }

  protected backToDonor(): void {
    this.navHistory.back(['/app/fundraising/relationships/donor-360'], {
      queryParams: { donorId: this.donorReference(), leadId: this.leadId() },
    });
  }
}
