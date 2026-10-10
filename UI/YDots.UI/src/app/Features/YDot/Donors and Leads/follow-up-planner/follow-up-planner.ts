import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ElementRef, viewChild, effect } from '@angular/core';
import { ConfirmDialogConfig } from '../../../../Shared/models/donors-leads.model';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  ConsentWarning,
  DonLookupItem,
  FollowUp as ApiFollowUp,
} from '../../../../Shared/models/donor-contract.model';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';

import { NavigationHistoryService } from '../../../../Shared/services/navigation-history.service';
type PlannerUiState = 'ready' | 'loading' | 'success' | 'error' | 'empty';

/**
 * DON-UI-08 — Follow-up planner.
 * Plan a respectful, consent-aware next action with clear ownership and due time.
 */
@Component({
  selector: 'app-follow-up-planner',
  imports: [CommonModule, FormsModule],
  templateUrl: './follow-up-planner.html',
  styleUrl: './follow-up-planner.css',
  host: { class: 'd-block' },
})
export class FollowUpPlannerComponent {
  private readonly router = inject(Router);
  private readonly navHistory = inject(NavigationHistoryService);
  private readonly route = inject(ActivatedRoute);
    private readonly api = inject(DonorApiService);
  private readonly toast = inject(ToastService);
  private readonly tokens = inject(AuthTokenService);

  /**
   * The Follow-Up Planner - the destination of every "Schedule Follow-Up" in the document.
   *
   * WHAT THIS REPLACES. `follow-up-planner.json` supplied the screen's permissions, its default
   * channel, its default priority, its purpose text and a `donorOrLeadReference` used whenever
   * the in-memory store had nothing - which was on every fresh load. Scheduling then called
   * `workflow.addFollowUp`, so a follow-up planned here existed only until the tab was closed
   * and never appeared in anybody else's Follow-Up Queue.
   */

  protected readonly uiState = signal<PlannerUiState>('loading');
  protected readonly confirmConfig = signal<ConfirmDialogConfig | null>(null);
  protected readonly activeActionId = signal('');
  protected readonly savedFilter = signal('All follow-ups (Default)');
  protected readonly savedFilters = signal<readonly string[]>(['All follow-ups (Default)']);

  /** The caller's permitted actions, as the server listed them. */
  protected readonly permissions = signal<Record<string, boolean>>({
    scheduleFollowUp: false,
    assign: false,
    markComplete: false,
    reschedule: false,
    cancelTask: false,
  });

  protected readonly leadId = signal(this.route.snapshot.queryParamMap.get('leadId'));
  protected readonly donorId = signal(this.route.snapshot.queryParamMap.get('donorId'));
  protected readonly followUpId = signal(this.route.snapshot.queryParamMap.get('followUpId'));

  /** The follow-up being edited, when the screen was opened on one. */
  protected readonly existing = signal<ApiFollowUp | null>(null);

  protected readonly channelOptions = signal<readonly DonLookupItem[]>([]);
  protected readonly priorityOptions = signal<readonly DonLookupItem[]>([]);
  protected readonly ownerOptions = signal<readonly DonLookupItem[]>([]);

  protected readonly resolvedDonorId = computed(
    () => this.donorId() ?? this.existing()?.donorId ?? null,
  );
  protected readonly resolvedLeadId = computed(
    () => this.leadId() ?? this.existing()?.leadId ?? null,
  );

    /**
   * The reference a person reads - LED-2026-000019, DON-2026-000004.
   *
   * IT USED TO FALL BACK TO THE RECORD'S ID, so a new follow-up was headed with a 36-character
   * GUID where the lead's number should be. The record, once loaded, carries its own reference.
   */
  protected readonly recordReference = computed(
    () =>
      this.existing()?.donorReference ??
      this.existing()?.leadReference ??
      this.record().reference,
  );
  protected readonly relationshipOwner = computed(
    () => this.existing()?.relationshipOwnerName ?? '',
  );
  protected readonly preferredLanguage = computed(
    () => this.existing()?.preferredLanguage || this.record().language,
  );

  protected readonly followUpType = signal('');
  protected readonly scheduledDate = signal('');
  protected readonly scheduledTime = signal('');

  // The API's priorities are Low, Normal, High and Urgent. This used to start on "Medium", a
  // value it does not have - and then on the first option in its list, which is Low.
  protected readonly priority = signal('');
  protected readonly owner = signal('');
  protected readonly purpose = signal('');
  protected readonly expectedOutcome = signal('');
  protected readonly validationMessage = signal<string | null>(null);

  /**
   * Set when Schedule / Reschedule is pressed with a required field empty (TS-134). From then on
   * every empty required field - Expected outcome included - is outlined in red with its own
   * message under it, and each message clears as soon as that field is filled in. It used to hang
   * off the banner text, so a consent message could hide the field errors and the Expected outcome
   * gap was only named in the banner.
   */
  protected readonly attempted = signal<'scheduleFollowUp' | 'reschedule' | null>(null);

  /** True for a required field that is empty, once Save / Reschedule has been tried. */
  protected fieldMissing(field: 'followUpType' | 'owner' | 'date' | 'time' | 'priority' | 'purpose' | 'outcome'): boolean {
    const tried = this.attempted();
    if (tried === null) return false;
    // Rescheduling only changes the date, time and priority.
    if (tried === 'reschedule' && !['date', 'time', 'priority'].includes(field)) return false;
    switch (field) {
      case 'followUpType': return !this.followUpType().trim();
      case 'owner': return !this.owner().trim();
      case 'date': return !this.scheduledDate();
      case 'time': return !this.scheduledTime();
      case 'priority': return !this.priority().trim();
      case 'purpose': return !this.purpose().trim();
      // The API refuses a new follow-up with no expected outcome ("Enter Next action."), so it is
      // required here too - but only while scheduling; an existing one is read-only.
      case 'outcome': return !this.existing() && !this.expectedOutcome().trim();
    }
  }

  /**
   * The consent warning for the chosen channel.
   *
   * IT IS THE SERVER'S, AND IT BLOCKS. A follow-up on a channel the person has withdrawn consent
   * for is refused by the API; asking first means the refusal is a sentence beside the channel
   * picker rather than a 400 after the confirm dialog.
   */
    protected readonly consentWarning = signal<string>('');

  /** The server's whole answer for this person, so a caution can be told from a refusal. */
  private readonly consentAnswer = signal<ConsentWarning | null>(null);

  /**
   * The person scheduling has read the caution and will confirm permission before contact.
   *
   * WITHOUT THIS NO FOLLOW-UP COULD BE PLANNED FOR A LEAD WITH NO CONSENT ON FILE - which is most
   * new leads. The server draws two different lines: a channel the person has WITHDRAWN is
   * refused outright, and a caution ("no consent has been recorded", or "another channel is
   * withdrawn") is allowed once it is acknowledged. The screen treated both as a refusal and
   * never sent the acknowledgement, so the caution could not be got past at all.
   */
  protected readonly consentAcknowledged = signal(false);


  /** When the screen last read the server, for the header's freshness line. */
  protected readonly lastRefresh = signal('');

  /** Whose records this caller may see, as the server described it. */
  protected readonly activeScope = signal('');

  protected readonly saving = signal(false);
  protected readonly page = signal(1);
  protected readonly totalPages = signal(1);
  protected readonly rows = signal<readonly ApiFollowUp[]>([]);
  protected readonly modalReason = signal('');
    protected readonly record = signal({
    name: '—',
    reference: '',
    email: '—',
    phone: '—',
    owner: 'Unassigned',
    ownerUserId: null as string | null,
    language: '',
  });
  protected readonly searches = signal<Record<string, string>>({});
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  private readonly showConfirmation = effect(() => {
    const dialog = this.dialog()?.nativeElement;
    if (this.confirmConfig() && dialog && !dialog.open) dialog.showModal();
  });
  protected readonly reasonValid = computed(
    () =>
      !this.confirmConfig()?.requireReason ||
      (this.modalReason().trim().length >= 10 && this.modalReason().trim().length <= 2000),
  );
  protected searchOptions(key: string, value: string): void {
    this.searches.update((current) => ({ ...current, [key]: value }));
  }
  protected options(key: string, values: readonly DonLookupItem[]): readonly DonLookupItem[] {
    const search = (this.searches()[key] ?? '').toLowerCase().trim();
    const selected =
      key === 'owner' ? this.owner() : key === 'channel' ? this.followUpType() : this.priority();
    return values.filter(
      (item) => item.value === selected || item.label.toLowerCase().includes(search),
    );
  }
  protected changePage(delta: number): void {
    const page = this.page() + delta;
    if (page < 1 || page > this.totalPages()) return;
    this.page.set(page);
    this.load();
  }
  protected selectRecord(item: ApiFollowUp): void {
    this.openedFromPicker.set(true);
    this.followUpId.set(item.id);
    this.leadId.set(item.leadId);
    this.donorId.set(item.donorId);
    this.load();
  }
  /**
   * True once the form was reached from this screen's own "New follow-up" list (Plan on a lead or
   * donor, or one of the already-scheduled rows). Back and Discard then return to that list, not
   * to the queue the list itself was opened from.
   */
  private readonly openedFromPicker = signal(false);

  protected cancelPlanner(): void {
    if (this.openedFromPicker() && this.hasRecord()) {
      this.changePerson();
      return;
    }
    this.navHistory.back(['/app/fundraising/relationships/follow-up-queue']);
  }

  /** Change person: clears the person and the form and shows the New follow-up list again. */
  protected changePerson(): void {
    this.leadId.set(null);
    this.donorId.set(null);
    this.followUpId.set(null);
    this.existing.set(null);
    this.record.set({
      name: '—',
      reference: '',
      email: '—',
      phone: '—',
      owner: 'Unassigned',
      ownerUserId: null,
      language: '',
    });
    this.owner.set('');
    this.purpose.set('');
    this.expectedOutcome.set('');
    this.scheduledDate.set('');
    this.scheduledTime.set('');
    this.consentAcknowledged.set(false);
    this.consentWarning.set('');
    this.validationMessage.set(null);
    this.attempted.set(null);
    this.openedFromPicker.set(true);
    this.pickerPrimed = false;
    this.page.set(1);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'create' },
      replaceUrl: true,
    });
    this.load();
  }

  /**
   * The page this planner was opened from, captured when it was opened.
   *
   * "Schedule follow-up" is reachable from Donor 360, the Donor List, the lead queues, the
   * timeline and the queue itself, so Discard cannot assume one destination - it returns to
   * whichever screen sent the person here. Read during the opening navigation, because by the
   * time a button is pressed the router no longer knows where it came from.
   */
  private readonly openedFrom: string | null = (() => {
    const url = this.router.currentNavigation()?.previousNavigation?.finalUrl?.toString() ?? null;
    return url && !url.includes('follow-up-planner') ? url : null;
  })();

  protected discardPlanner(): void {
    if (this.openedFromPicker()) {
      this.changePerson();
      return;
    }
    if (this.openedFrom) {
      this.router.navigateByUrl(this.openedFrom);
      return;
    }
    this.cancelPlanner();
  }
  private loadRecord(): void {
    const lead = this.resolvedLeadId();
    const donor = this.resolvedDonorId();
    if (lead)
      this.api.getLead(lead).subscribe({
                next: (r) => {
          this.record.set({
            name: [r.firstName, r.lastName].filter(Boolean).join(' '),
            reference: r.leadReference,
            email: r.emailAddress || '—',
            phone: r.mobileNumber || '—',
            owner: r.ownerName || 'Unassigned',
            ownerUserId: r.ownerUserId,
            language: r.preferredLanguage ?? '',
          });
          this.defaultAssignee();
        },
        error: () =>
          this.toast.show(
            'Record details unavailable',
            'Contact details could not be loaded.',
            'error',
          ),
      });
    else if (donor)
      this.api.getDonor(donor).subscribe({
                next: (r) => {
          this.record.set({
            name: r.displayName,
            reference: r.donorNumber,
            email: r.primaryEmail || '—',
            phone: r.primaryPhone || '—',
            owner: r.relationshipOwnerName || 'Unassigned',
            ownerUserId: r.relationshipOwnerUserId,
            language: r.preferredLanguage ?? '',
          });
          this.defaultAssignee();
        },
        error: () =>
          this.toast.show(
            'Record details unavailable',
            'Contact details could not be loaded.',
            'error',
          ),
      });
  }

    /**
   * Who the follow-up starts out assigned to, when nobody has been chosen yet.
   *
   * THE RECORD'S OWNER, WHEN THEY CAN TAKE WORK; OTHERWISE THE PERSON PLANNING IT. For a lead
   * nobody owns, that leaves the planner themselves - or whoever they then pick. Choosing an
   * assignee here never changes who owns the lead or the donor: the role flow keeps the two
   * apart, and so does the API.
   */
  private defaultAssignee(): void {
    if (this.owner() || this.existing()) return;

    const options = this.ownerOptions();
    const has = (id: string | null | undefined) => !!id && options.some((option) => option.value === id);
    const me = this.tokens.user()?.id;

    if (has(this.record().ownerUserId)) this.owner.set(this.record().ownerUserId!);
    else if (has(me)) this.owner.set(me!);
  }

  constructor() {
    this.load();
  }

  protected load(): void {
    this.uiState.set('loading');

    this.api
      .getFollowUpPlanner({
        page: this.page(),
        pageSize: 10,
        leadId: this.leadId(),
        donorId: this.donorId(),
      })
      .subscribe({
        next: (response) => {
          this.rows.set(response.followUps.items);
          this.totalPages.set(response.followUps.totalPages);
          this.channelOptions.set(response.channelOptions);
          this.priorityOptions.set(response.priorityOptions);
          this.ownerOptions.set(response.ownerOptions);

          // VERBS: ['Schedule follow-up','View','Assign','Mark complete','Reschedule','Cancel task'].
          const permitted = response.permittedActions ?? [];
          this.permissions.set({
            scheduleFollowUp: permitted.includes('Schedule follow-up'),
            assign: permitted.includes('Assign'),
            markComplete: permitted.includes('Mark complete'),
            reschedule: permitted.includes('Reschedule'),
            cancelTask: permitted.includes('Cancel task'),
          });

          // Editing an existing follow-up: fill the form from it.
          const editing = this.followUpId()
            ? response.followUps.items.find((item) => item.id === this.followUpId())
            : null;

          if (editing) {
            this.existing.set(editing);
            this.followUpType.set(editing.permittedChannel);
            this.priority.set(editing.priority);
            this.owner.set(editing.relationshipOwnerUserId);
            this.purpose.set(editing.purpose ?? '');
            this.expectedOutcome.set(editing.nextAction ?? '');

            if (editing.dueAtUtc) {
              const due = new Date(editing.dueAtUtc);
              this.scheduledDate.set(this.toDateInput(due));
              this.scheduledTime.set(this.toTimeInput(due));
            }
            if (editing.consentWarning?.hasWarning) {
              this.consentWarning.set(editing.consentWarning.message);
            }
                    } else {
            // Keep what the person has already chosen on a reload; otherwise the first channel
            // the API offers, and its ordinary priority.
            const offers = (options: readonly DonLookupItem[], value: string) =>
              options.some((option) => option.value === value);

            if (!offers(response.channelOptions, this.followUpType())) {
              this.followUpType.set(response.channelOptions[0]?.value ?? '');
            }
            if (!offers(response.priorityOptions, this.priority())) {
              this.priority.set(
                response.priorityOptions.find((option) => option.value === 'Normal')?.value
                  ?? response.priorityOptions[0]?.value
                  ?? '',
              );
            }
          }

          this.activeScope.set(response.activeScope);
          this.lastRefresh.set(
            new Date().toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
          );

          if (this.followUpId() && !editing) {
            if (response.followUps.hasNextPage) {
              this.page.update((p) => p + 1);
              this.load();
              return;
            }
            this.uiState.set('error');
            return;
          }
          this.loadRecord();
          this.uiState.set('ready');
          this.checkConsent();
        },
        error: (error: unknown) => {
          this.uiState.set('error');
          this.toast.show('Planner unavailable', apiErrorMessage(error), 'error');
        },
      });
  }

  /** Re-asks the server whether the chosen channel is permitted for this person. */
  private consentRequest = 0;
  protected checkConsent(): void {
        const request = ++this.consentRequest;
    this.consentWarning.set('Checking channel consent…');
    this.consentAnswer.set(null);
    this.consentAcknowledged.set(false);
    const leadId = this.resolvedLeadId();
    const donorId = this.resolvedDonorId();
    if (!leadId && !donorId) {
      this.consentWarning.set('');
      return;
    }

    this.api
      .getConsentWarning(donorId ?? undefined, leadId ?? undefined, this.followUpType())
      .subscribe({
                next: (warning) => {
          if (request !== this.consentRequest) return;
          this.consentAnswer.set(warning);
          this.consentWarning.set(warning.hasWarning ? warning.message : '');
        },
        error: () => {
          if (request === this.consentRequest)
            this.consentWarning.set(
              'Consent could not be verified. Select the channel again to retry.',
            );
        },
      });
  }

  private toDateInput(value: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  private toTimeInput(value: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  private toDueUtc(): string {
    return new Date(`${this.scheduledDate()}T${this.scheduledTime() || '09:00'}`).toISOString();
  }

  /**
   * The actions this screen offers.
   *
   * DECLARED HERE, GATED BY THE SERVER. The list used to come from the JSON file's `actions`
   * array, which meant the buttons a person saw were whatever the bundle said rather than what
   * their token allows. The labels are the screen's; the gate is `permissions()`.
   */
  private readonly actionCatalogue = [
    {
      id: 'scheduleFollowUp',
      label: 'Schedule follow-up',
      result: 'The follow-up is scheduled and appears in the owner\u2019s Follow-Up Queue.',
      placement: 'primary',
      requiresReason: false,
    },
    {
      id: 'reschedule',
      label: 'Reschedule',
      result: 'The follow-up moves to a new date and the reason is recorded.',
      placement: 'primary',
      requiresReason: true,
    },
    {
      id: 'cancelTask',
      label: 'Cancel follow-up',
      result: 'The follow-up is cancelled. The reason is recorded against it.',
      placement: 'danger',
      requiresReason: true,
    },
  ] as const;

  protected readonly visibleActions = computed(() =>
    this.actionCatalogue.filter(
      (action) =>
        this.permissions()[action.id] === true &&
        (action.id === 'scheduleFollowUp' ? !this.existing() : !!this.existing()),
    ),
  );

  protected readonly activeFilterSummary = computed(() => {
    const defaultFilter = this.savedFilters()[0];
    return this.savedFilter() !== defaultFilter
      ? [{ key: 'saved', label: `View: ${this.savedFilter()}` }]
      : [];
  });

  protected readonly hasRecord = computed(() => Boolean(this.recordReference()));

  protected removeFilterChip(key: string): void {
    if (key === 'saved') {
      this.savedFilter.set(this.savedFilters()[0] ?? 'All follow-ups (Default)');
    }
  }

  protected setUiState(state: PlannerUiState): void {
    this.uiState.set(state);
  }

  protected dismissBanner(): void {
    this.uiState.set('ready');
  }

  protected priorityClass(priority: string): string {
    switch (priority.toLowerCase()) {
            case 'high':
      case 'urgent':
        return 'fup-badge-high';
      case 'medium':
      case 'normal':
        return 'fup-badge-medium';
      case 'low':
        return 'fup-badge-low';
      default:
        return 'fup-badge-neutral';
    }
  }

  protected actionIcon(actionId: string): string {
    switch (actionId) {
      case 'scheduleFollowUp':
        return 'plus';
      case 'assign':
        return 'users';
      case 'markComplete':
        return 'check';
      case 'reschedule':
        return 'refresh';
      case 'cancelTask':
        return 'close';
      default:
        return 'dot';
    }
  }

  protected openAction(actionId: string): void {
    if (this.saving()) return;
    if (actionId === 'scheduleFollowUp' || actionId === 'reschedule') {
      const missing =
        !this.scheduledDate() ||
        !this.scheduledTime() ||
        !this.priority().trim() ||
        (actionId === 'scheduleFollowUp' &&
          (!this.followUpType().trim() ||
            !this.owner().trim() ||
            !this.purpose().trim() ||
            !this.expectedOutcome().trim()));
      this.attempted.set(missing ? (actionId as 'scheduleFollowUp' | 'reschedule') : null);
      if (missing) {
        // Take the person to the first field that needs them.
        queueMicrotask(() =>
          document
            .querySelector<HTMLElement>('.fp-form .is-invalid')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        );
        this.validationMessage.set(
          actionId === 'reschedule'
            ? 'Complete date, time, and priority before rescheduling.'
            : 'Complete follow-up type, date, time, priority, purpose, expected outcome, and owner before saving.',
        );
        return;
      }
      if (
        !this.hasRecord() ||
        !Number.isFinite(new Date(`${this.scheduledDate()}T${this.scheduledTime()}`).getTime())
      ) {
        this.validationMessage.set('Select a record and enter a valid date and time.');
        return;
      }
      this.validationMessage.set(null);
    }

    const action = this.actionCatalogue.find((candidate) => candidate.id === actionId);
    if (!action || this.permissions()[actionId] !== true || this.uiState() === 'loading') {
      return;
    }

        // A CHANNEL THE PERSON HAS WITHDRAWN IS REFUSED BY THE SERVER, so it is refused here first -
    // the alternative is a confirm dialog, a typed reason and then a 400. A caution is different:
    // it has to be read and acknowledged, and then the follow-up may be planned.
    if (actionId === 'scheduleFollowUp') {
      if (this.consentState() === 'checking') {
        this.validationMessage.set('Consent is still being checked. Try again in a moment.');
        return;
      }
      if (this.consentState() === 'blocked') {
        this.validationMessage.set(this.consentWarning());
        return;
      }
      if (this.consentState() === 'caution' && !this.consentAcknowledged()) {
        this.validationMessage.set('Read the consent note under Channel and tick it before scheduling.');
        return;
      }
    }

    this.modalReason.set('');
    this.activeActionId.set(actionId);
    this.confirmConfig.set({
      title: `Confirm ${action.label}`,
      message: action.result,
      confirmLabel: action.label,
      cancelLabel: 'Cancel',
      tone: action.placement === 'danger' ? 'danger' : 'primary',
      requireReason: Boolean(action.requiresReason),
      reasonLabel: 'Reason',
      reasonMin: 10,
      reasonMax: 2000,
      typedConfirm: false,
      affectedRecord: `${this.existing()?.followUpReference ?? 'New follow-up'} · ${this.recordReference()}`,
      effectiveTime: `${this.scheduledDate()} ${this.scheduledTime()}`.trim() || 'On confirmation',
      beforeAfter: [
        { label: 'Priority', before: this.existing()?.priority ?? '—', after: this.priority() },
        { label: 'Due', before: this.existing()?.dueAtUtc ?? '—', after: this.scheduledDate() },
      ],
    });
  }

  protected onConfirm(reason: string): void {
    if (this.saving() || !this.confirmConfig() || !this.reasonValid()) return;
    this.saving.set(true);
    const action = this.activeActionId();
    const existingId = this.followUpId();

    if (action === 'reschedule' && existingId) {
      this.api
        .rescheduleFollowUp(existingId, {
          dueAtUtc: this.toDueUtc(),
          rescheduleReason: reason,
          priority: this.priority(),
          expectedVersion: this.existing()?.version ?? null,
        })
        .subscribe({
          next: () => this.afterWrite('Follow-up rescheduled.'),
          error: (error: unknown) => this.afterError(error),
        });
      return;
    }

    if (action === 'cancelTask' && existingId) {
      this.api
        .cancelFollowUp(existingId, { reason, expectedVersion: this.existing()?.version ?? null })
        .subscribe({
          next: () => this.afterWrite('Follow-up cancelled.'),
          error: (error: unknown) => this.afterError(error),
        });
      return;
    }

    if (action === 'scheduleFollowUp') {
      const owner = this.ownerOptions().find((option) => option.value === this.owner());

      this.api
        .scheduleFollowUp({
          leadId: this.resolvedLeadId(),
          donorId: this.resolvedDonorId(),
          relationshipOwnerUserId: owner?.value ?? null,
          relationshipOwnerName: owner?.label ?? null,
          purpose: this.purpose().trim(),
          permittedChannel: this.followUpType(),
          preferredLanguage: this.preferredLanguage() || null,
          nextAction: this.expectedOutcome().trim(),
          dueAtUtc: this.toDueUtc(),
          priority: this.priority(),

                    // TRUE ONLY WHEN THE PERSON TICKED IT. A caution is acknowledged by the tick under
          // Channel, never silently; with no warning there is nothing to acknowledge.
          consentWarningAcknowledged: this.consentState() === 'caution' && this.consentAcknowledged(),
        })
        .subscribe({
          next: (created) => {
            this.followUpId.set(created.id);
            this.afterWrite('Follow-up scheduled.');
          },
          error: (error: unknown) => this.afterError(error),
        });
      return;
    }

    this.saving.set(false);
    this.confirmConfig.set(null);
    this.activeActionId.set('');
  }

  private afterWrite(message: string): void {
    this.saving.set(false);
    this.confirmConfig.set(null);
    this.activeActionId.set('');
    this.uiState.set('success');
    this.toast.show('Saved', message, 'success');

    // THE DOCUMENT'S DESTINATION: scheduling from the planner lands in the Follow-Up Queue.
    this.router.navigate(['/app/fundraising/relationships/follow-up-queue'], {
      // No parameters: the full list, and no side panel opened.
    });
  }

  private afterError(error: unknown): void {
    this.saving.set(false);
    this.confirmConfig.set(null);
    this.activeActionId.set('');
    this.uiState.set('ready');
    this.toast.show('Not saved', apiErrorMessage(error), 'error');
  }

  protected onCancel(): void {
    if (this.saving()) return;
    this.confirmConfig.set(null);
    this.activeActionId.set('');
  }

  // ===========================================================================================
  // NEW FOLLOW-UP - choosing who the follow-up is for.
  //
  // "New follow-up" on the queue opens this screen with no lead or donor, and there used to be
  // nothing to do here except open one of the already-scheduled rows. The planner cannot plan a
  // contact without a person, so this start page asks for one: it searches the existing lead and
  // donor lookups (the same ones Lead Capture and Donor 360 use) and hands the choice to the form.
  // ===========================================================================================

  protected readonly pickerKind = signal<'lead' | 'donor'>('lead');
  protected readonly pickerQuery = signal('');
  protected readonly pickerLoading = signal(false);
  protected readonly pickerError = signal('');
  protected readonly pickerResults = signal<
    readonly { id: string; reference: string; name: string; status: string }[]
  >([]);
  private pickerTimer: ReturnType<typeof setTimeout> | undefined;
  private pickerRequest = 0;
  private pickerPrimed = false;

  /** Runs once the planner knows it has no record, so the start page opens with suggestions. */
  private readonly primePicker = effect(() => {
    if (this.uiState() !== 'loading' && !this.hasRecord() && !this.pickerPrimed) {
      this.pickerPrimed = true;
      queueMicrotask(() => this.searchPeople());
    }
  });

  protected setPickerKind(kind: 'lead' | 'donor'): void {
    if (this.pickerKind() === kind) return;
    this.pickerKind.set(kind);
    this.searchPeople();
  }

  protected onPickerQuery(value: string): void {
    this.pickerQuery.set(value);
    clearTimeout(this.pickerTimer);
    this.pickerTimer = setTimeout(() => this.searchPeople(), 280);
  }

  protected searchPeople(): void {
    const request = ++this.pickerRequest;
    const query = this.pickerQuery().trim() || undefined;
    this.pickerLoading.set(true);
    this.pickerError.set('');
    const done = (rows: { id: string; reference: string; name: string; status: string }[]) => {
      if (request !== this.pickerRequest) return;
      this.pickerResults.set(rows);
      this.pickerLoading.set(false);
    };
    const fail = (error: unknown) => {
      if (request !== this.pickerRequest) return;
      this.pickerResults.set([]);
      this.pickerError.set(apiErrorMessage(error));
      this.pickerLoading.set(false);
    };
    if (this.pickerKind() === 'lead') {
      this.api.searchLeads(query, 12).subscribe({
        next: (rows) => done(rows.map((r) => ({ id: r.id, reference: r.leadReference, name: r.displayName, status: r.status }))),
        error: fail,
      });
    } else {
      this.api.lookupDonors(query, 12).subscribe({
        next: (rows) => done(rows.map((r) => ({ id: r.id, reference: '', name: r.displayName, status: r.status }))),
        error: fail,
      });
    }
  }

  /** Hands the chosen person to the planner form, and keeps the address bar in step with it. */
  protected choosePerson(person: { id: string }): void {
    const isLead = this.pickerKind() === 'lead';
    this.openedFromPicker.set(true);
    this.followUpId.set(null);
    this.existing.set(null);
    this.leadId.set(isLead ? person.id : null);
    this.donorId.set(isLead ? null : person.id);
    this.purpose.set('');
    this.expectedOutcome.set('');
    this.scheduledDate.set('');
    this.scheduledTime.set('');
    this.validationMessage.set(null);
    this.attempted.set(null);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { leadId: this.leadId(), donorId: this.donorId(), mode: 'create' },
      replaceUrl: true,
    });
    this.load();
  }

  // ===========================================================================================
  // PLANNER presentation - the live appointment ticket beside the form
  // ===========================================================================================

  protected readonly channelGlyph: Record<string, string> = {
    Call: 'ri-phone-line',
        PhoneCall: 'ri-phone-line',
    Email: 'ri-mail-line',
    'E-mail': 'ri-mail-line',
    SMS: 'ri-message-2-line',
    Sms: 'ri-message-2-line',
    WhatsApp: 'ri-whatsapp-line',
    Meeting: 'ri-team-line',
    Visit: 'ri-map-pin-line',
    Event: 'ri-calendar-event-line',
    Post: 'ri-mail-open-line',
  };

  protected glyphFor(channel: string): string {
    return this.channelGlyph[channel] ?? 'ri-chat-3-line';
  }

  protected readonly ownerLabel = computed(
    () =>
      this.ownerOptions().find((o) => o.value === this.owner())?.label ||
      this.existing()?.relationshipOwnerName ||
      '',
  );

  protected readonly slip = computed(() => {
    const date = this.scheduledDate();
    if (!date) return null;
    const [y, m, d] = date.split('-').map(Number);
    const when = new Date(y, (m || 1) - 1, d || 1);
    if (Number.isNaN(when.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((when.getTime() - today.getTime()) / 86400000);
    const distance =
      days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : days > 0 ? `In ${days} days` : `${-days} days ago`;
    return {
      day: String(d).padStart(2, '0'),
      month: when.toLocaleDateString('en-GB', { month: 'long' }),
      weekday: when.toLocaleDateString('en-GB', { weekday: 'long' }),
      year: y,
      distance,
      past: days < 0,
    };
  });

  protected readonly slipTime = computed(() => {
    const time = this.scheduledTime();
    if (!time) return '';
    const [h, min] = time.split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    return `${((h + 11) % 12) + 1}:${String(min).padStart(2, '0')} ${suffix}`;
  });

  protected readonly dateShortcuts = [
    { label: 'Tomorrow', days: 1 },
    { label: '3 days', days: 3 },
    { label: '1 week', days: 7 },
    { label: '2 weeks', days: 14 },
  ];
  protected readonly timeShortcuts = ['09:30', '11:00', '14:00', '16:30'];

  protected dateIn(days: number): string {
    const when = new Date();
    when.setDate(when.getDate() + days);
    return this.toDateInput(when);
  }

  protected readonly todayIso = this.toDateInput(new Date());

    /**
   * Consent, as four plain states: checking, blocked, a caution to acknowledge, or clear.
   *
   * BLOCKED IS THE SERVER'S REFUSAL: the person is marked do-not-contact, every channel is
   * withdrawn, or the chosen channel is one they have withdrawn. Anything else it warns about is
   * a caution - see `consentAcknowledged`.
   */
  protected readonly consentState = computed<'checking' | 'blocked' | 'caution' | 'clear'>(() => {
    const warning = this.consentWarning();
    if (warning === 'Checking channel consent…') return 'checking';
    if (!warning) return 'clear';

    const answer = this.consentAnswer();

    // No answer to read the level from (the check failed): refuse rather than assume.
    if (!answer) return 'blocked';

    const refused =
      answer.level === 'Blocking' || (answer.prohibitedChannels ?? []).includes(this.followUpType());

    return refused ? 'blocked' : 'caution';
  });

  /** The colour key the styles know: a caution is drawn like a block until it is acknowledged. */
  protected readonly consentTone = computed(() => {
    const state = this.consentState();
    if (state !== 'caution') return state;
    return this.consentAcknowledged() ? 'clear' : 'blocked';
  });

  /** The API's middle priority is Normal; the styles call that colour Medium. */
  protected priorityTone(priority: string): string {
    return priority === 'Normal' ? 'Medium' : priority;
  }

}