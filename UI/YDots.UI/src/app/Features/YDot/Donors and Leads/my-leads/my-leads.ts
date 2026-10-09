import { ChangeDetectionStrategy, Component, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { map, tap } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { LeadListItem, LeadWorkQueueResponse } from '../../../../Shared/models/donor-contract.model';
import { PageHeader } from '../../../../Shared/components/page-header/page-header';
import { fetchPages } from '../../../../Shared/services/paging';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
// ============================================================================
// DATA MODEL
// ============================================================================
export interface LeadItem {
  reference: string;
  name: string;
  campaign: string;
  owner: string;
  stage: string;
  temperature: 'Cold' | 'Warm' | 'Hot';
  healthScore: number;
  nextFollowUp: string;

  /**
   * Where the next contact stands, from the server's reading of the organisation's day.
   * "Not planned" is a lead with nothing booked - it used to read "Upcoming".
   */
  followUpStatus: 'Upcoming' | 'Due' | 'Overdue' | 'Not planned';

  /** What this lead's state allows - the server's list, e.g. Contact, Qualify, Close. */
  permittedActions: readonly string[];
  language: string;
  source: string;
  lastContactOutcome: string;
  recommendedNextAction: string;
  contactRestricted: boolean;

  /**
   * The reference a person quotes, e.g. LED-2026-001245.
   *
   * SEPARATE FROM `reference`, WHICH IS NOW THE API'S ID. Every write on this screen is addressed
   * to the id; the grid and every message show this.
   */
  displayReference: string;

  /** The server's row version, sent back on every write for the concurrency check. */
  version: number;
  email?: string;
  mobile?: string;
}

export interface LeadGroup {
  key: string;
  label: string;
  count: number;
  items: LeadItem[];
}

export interface ScreenMeta {
  viewId: string;
  title: string;
  route: string;
  purpose: string;
  primaryAction: string;
  viewPermission: string;
  primaryUsers: string[];
  scope: string;
  lastRefresh: string;
}

export interface PermissionMap {
  view: boolean;
  updateStage: boolean;
  updateTemperature: boolean;
  logCommunication: boolean;
  scheduleFollowUp: boolean;
  executeFollowUp: boolean;
  qualify: boolean;
  markLost: boolean;
  markDormant: boolean;
  bulkActions: boolean;
  exportGrid: boolean;
}

export interface PipelineStage {
  stage: string;
  count: number;
}

export interface ActionDef {
  id: string;
  label: string;
  placement: string;
  permission: string;
  allowedState: string;
  result: string;
  requiresReason?: boolean;
}

export interface FieldContract {
  label: string;
  control: string;
  required: boolean;
  visibility: string;
}

export interface LeadsScreenData {
  screen: ScreenMeta;
  permissions: PermissionMap;
  kpis: {
    assignedLeads: number;
    coldLeads: number;
    warmLeads: number;
    hotLeads: number;
    followUpsDueToday: number;
    followUpsOverdue: number;
  };
  pipeline: PipelineStage[];
  groups: LeadGroup[];
  savedFilters: string[];
  fieldContracts: FieldContract[];
  actions: ActionDef[];
}


/**
 * LEADS_SOURCE - REMOVED.
 *
 * It was a `LeadsScreenData` literal compiled into the bundle: eleven named leads with campaigns,
 * owners, health scores and follow-up dates. The constructor flattened it into
 * `WorkflowStateService`, so every fundraiser in every organisation opened My Leads to the same
 * eleven people, and qualifying one of them lasted until the tab was refreshed.
 */


// ============================================================================
// COMPONENT
// ============================================================================
type FilterValue = 'All' | string;


@Component({
  selector: 'app-my-leads',
  standalone: true,
  imports: [RowsPerPage, PageHeader, CommonModule, FormsModule],
templateUrl: './my-leads.html',
styleUrl: './my-leads.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyLeadsComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DonorApiService);
  private readonly toast = inject(ToastService);
  // ---- compatibility outputs; actions are also wired directly to Router/state ----
  @Output() communicate = new EventEmitter<string>();
  @Output() scheduleFollowUp = new EventEmitter<string>();
  @Output() executeFollowUp = new EventEmitter<string>();
  @Output() qualify = new EventEmitter<string>();
  @Output() markLost = new EventEmitter<string>();
  @Output() markDormant = new EventEmitter<string>();
  @Output() openFollowUpQueue = new EventEmitter<void>();
  @Output() viewLeadQueue = new EventEmitter<void>();
  @Output() exportGrid = new EventEmitter<LeadItem[]>();

  // ---- Screen chrome ----
  //
  // THE COUNTS ARE COMPUTED FROM THE SERVER'S ROWS, not read from a constant. `kpis` and
  // `pipeline` used to be literal arrays in the same file as the leads, so the cards showed
  // "11 leads, 4 due today" whatever the queue actually contained.
  readonly screen = {
    title: 'My leads',
    purpose: 'The leads assigned to you. Work them, schedule follow-ups and record what happened.',
    scope: 'Assigned to you',
  };

  /** What the caller may do, from the server's permitted actions for the queue. */
  readonly permissions = signal<Record<string, boolean>>({ view: false });

  /**
   * The summary cards - the server's summary of the caller's own leads.
   *
   * NOT COUNTED HERE. They were first a literal in this file, then a count of the rows this
   * browser had loaded - which stopped at one page, and read "due today" off an hours-to-breach
   * badge rather than off the calendar. The queue endpoint counts the caller's leads when it is
   * asked for `onlyMine`, and counts their open follow-ups against the organisation's day.
   */
  readonly kpis = signal({
    assignedLeads: 0,
    followUpsDueToday: 0,
    followUpsOverdue: 0,
    hotLeads: 0,
    warmLeads: 0,
    coldLeads: 0,
  });

  /** The caller's leads per stage, from the server's counts, in the server's stage order. */
  readonly pipeline = signal<PipelineStage[]>([]);

  readonly savedFilters = ['All my leads', 'Due today', 'Overdue', 'Hot leads'];

  readonly actionDefs: ActionDef[] = [];

  // ---- state ----
  private readonly sourceLeads = signal<LeadItem[]>([]);

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly exporting = signal(false);

  /** Outcome value to the server's label for it - "CallbackRequested" to "Requested callback". */
  private outcomeLabels = new Map<string, string>();

  readonly searchTerm = signal('');
  readonly stageFilter = signal<FilterValue>('All');
  readonly temperatureFilter = signal<FilterValue>('All');
  readonly followUpFilter = signal<FilterValue>('All');
  readonly stageOptionSearch = signal('');

  readonly selectedRefs = signal<ReadonlySet<string>>(new Set());
  readonly activeRef = signal<string | null>(null);
  readonly currentPage = signal(1);
  readonly pageSize = signal(10);
  setPageSize(n: number): void { this.pageSize.set(n); this.currentPage.set(1); }

  // ---- copy-to-clipboard feedback state ----
  readonly copiedRef = signal<string | null>(null);
  private copiedRefTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  /**
   * SCR-DON-009 - My Leads.
   *
   * THE DOCUMENT DEFINES THE SCOPE: "My Leads is the owner-specific list page: it shows the leads
   * assigned to a single owner." `onlyMine` is how the server is told that, and resolving it from
   * the token rather than from a value this browser sends is what makes it true - a browser
   * cannot be trusted to say whose leads it is asking for.
   *
   * WHAT THIS REPLACES. The constructor flattened `LEADS_SOURCE` - a constant compiled into the
   * bundle - into `WorkflowStateService`, so every fundraiser in every organisation saw the same
   * leads and every qualification was forgotten on refresh.
   */
  private load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    // EVERY PAGE, NOT "PAGE 1 OF 200". The API caps a page at 100 whatever is asked for, so the
    // 101st lead was simply missing while the count above it read as a total. The first page's
    // answer also carries the cards, the pipeline and the permitted actions; later pages add rows.
    let first: LeadWorkQueueResponse | null = null;

    fetchPages<LeadListItem>((page, pageSize) =>
      this.api.getLeadWorkQueue({ page, pageSize, onlyMine: true }).pipe(
        tap((response) => { first ??= response; }),
        map((response) => response.leads),
      ),
    ).subscribe({
      next: ({ items }) => {
        const response = first!;

        this.outcomeLabels = new Map(
          (response.contactOutcomeOptions ?? []).map((option) => [option.value, option.label]),
        );

        this.sourceLeads.set(items.map((row) => this.toLeadItem(row)));

        const summary = response.summary;
        this.kpis.set({
          assignedLeads: summary.totalLeads,
          followUpsDueToday: summary.followUpsDueToday,
          followUpsOverdue: summary.followUpsOverdue,
          hotLeads: summary.hotLeads,
          warmLeads: summary.warmLeads,
          coldLeads: summary.coldLeads,
        });

        // Converted leads are not in this list - they are donors now, in My Donor List - so a
        // Converted chip would filter to nothing.
        this.pipeline.set(
          (response.statusOptions ?? [])
            .filter((option) => option.value !== 'Converted')
            .map((option) => ({ stage: option.value, count: response.statusCounts?.[option.value] ?? 0 }))
            .filter((stage) => stage.count > 0),
        );

        this.temperatureOptions.set([
          'All',
          ...(response.temperatureOptions ?? []).map((option) => option.value),
        ]);

        // VERBS, from the same endpoint the Lead Queue reads:
        // ['Accept','Filter','Open','Create','Assign','Contact','Qualify','Close','Score','Export'].
        const permitted = response.permittedActions ?? [];
        this.permissions.set({
          view: permitted.includes('Open') || permitted.includes('Filter'),
          create: permitted.includes('Create'),
          contact: permitted.includes('Contact'),
          qualify: permitted.includes('Qualify'),
          close: permitted.includes('Close'),
          schedule: permitted.includes('Contact'),
          export: permitted.includes('Export'),
        });

        this.loading.set(false);

        const requestedId = this.route.snapshot.queryParamMap.get('leadId');
        const rows = this.sourceLeads();
        this.activeRef.set(
          requestedId && rows.some((lead) => lead.reference === requestedId) ? requestedId : null,
        );
        this.ensureValidPage();
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(apiErrorMessage(error));
      },
    });
  }

  private toLeadItem(row: LeadListItem): LeadItem {
    return {
      // THE API'S ID, NOT THE REFERENCE. Every write below is addressed to it; the reference is
      // what a person quotes and is shown in the grid.
      reference: row.id,
      displayReference: row.leadReference,
      name: row.name,
      campaign: row.campaignName ?? '',
      owner: row.ownerName ?? 'Unassigned',
      stage: row.status,
      temperature: row.temperature as LeadItem['temperature'],
      healthScore: row.healthScore,
      nextFollowUp: this.formatDate(row.nextActionDueUtc),
      followUpStatus: this.toFollowUpStatus(row.followUpState),
      permittedActions: row.permittedActions ?? [],
      language: row.preferredLanguage,
      source: row.source ?? '',
      lastContactOutcome: this.outcomeLabels.get(row.lastContactOutcome) ?? row.lastContactOutcome,

      // The lead's own next action, or nothing. It used to fall back to "Initial contact" for
      // every lead without one - a recommendation nobody had made.
      recommendedNextAction: row.nextAction ?? '',

      // MASKED BY THE SERVER, and a masked lead is one this caller may not contact directly.
      contactRestricted: row.isContactMasked,
      version: row.version,
    };
  }

  /**
   * The server's follow-up state, in this screen's four words.
   *
   * IT USED TO READ THE SLA BADGE, which answers a different question - hours until a breach -
   * and got two things wrong: "DueToday" there means "within 24 hours", so tomorrow morning
   * counted as today; and Breached, the worst state, fell through to "Upcoming". A lead with
   * nothing planned also read "Upcoming". `followUpState` is by calendar day, the same day the
   * cards above count against.
   */
  private toFollowUpStatus(state: string): LeadItem['followUpStatus'] {
    switch (state) {
      case 'Overdue': return 'Overdue';
      case 'Due Today': return 'Due';
      case 'Tomorrow':
      case 'Upcoming': return 'Upcoming';
      default: return 'Not planned';
    }
  }

  private formatDate(value: string | null): string {
    if (!value) {
      return '';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ''
      : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  readonly stageOptions = computed<FilterValue[]>(() => [
    'All',
    ...Array.from(new Set(this.sourceLeads().map((l) => l.stage))),
  ]);
  readonly visibleStageOptions = computed(() => {
    const term = this.stageOptionSearch().trim().toLowerCase();
    return term ? this.stageOptions().filter((option) => option.toLowerCase().includes(term)) : this.stageOptions();
  });
  /** From the server's temperature catalogue; only "All" until it answers. */
  readonly temperatureOptions = signal<FilterValue[]>(['All']);
  readonly followUpOptions: FilterValue[] = ['All', 'Upcoming', 'Due', 'Overdue', 'Not planned'];

  readonly filteredLeads = computed<LeadItem[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const stage = this.stageFilter();
    const temperature = this.temperatureFilter();
    const followUp = this.followUpFilter();

    return this.sourceLeads().filter((lead) => {
      const matchesTerm =
        !term ||
        lead.name.toLowerCase().includes(term) ||
        // The reference a person reads and types - `reference` is the API's id.
        lead.displayReference.toLowerCase().includes(term) ||
        lead.campaign.toLowerCase().includes(term);
      const matchesStage = stage === 'All' || lead.stage === stage;
      const matchesTemperature = temperature === 'All' || lead.temperature === temperature;
      const matchesFollowUp = followUp === 'All' || lead.followUpStatus === followUp;
      return matchesTerm && matchesStage && matchesTemperature && matchesFollowUp;
    });
  });

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredLeads().length / this.pageSize())));

  readonly pagedLeads = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredLeads().slice(start, start + this.pageSize());
  });

  readonly pageStart = computed(() => this.filteredLeads().length === 0 ? 0 : (this.currentPage() - 1) * this.pageSize() + 1);
  readonly pageEnd = computed(() => Math.min(this.currentPage() * this.pageSize(), this.filteredLeads().length));

  readonly pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, index) => index + 1));

  readonly isEmpty = computed(() => !this.loading() && !this.loadError() && this.filteredLeads().length === 0);

  readonly activeLead = computed<LeadItem | null>(() => {
    const ref = this.activeRef();
    if (!ref) return null;
    return this.sourceLeads().find((l) => l.reference === ref) ?? null;
  });

  readonly selectedCount = computed(() => this.selectedRefs().size);
  readonly hasSelection = computed(() => this.selectedCount() > 0);

  readonly allVisibleSelected = computed(() => {
    const visible = this.pagedLeads();
    if (visible.length === 0) return false;
    const selected = this.selectedRefs();
    return visible.every((l) => selected.has(l.reference));
  });

  // ---- derived label helpers (pure functions, template-safe) ----
  temperatureClass(t: LeadItem['temperature']): string {
    return t === 'Hot' ? 'badge-hot' : t === 'Warm' ? 'badge-warm' : 'badge-cold';
  }

  followUpClass(status: LeadItem['followUpStatus']): string {
    switch (status) {
      case 'Overdue':
        return 'badge-overdue';
      case 'Due':
        return 'badge-due';
      case 'Not planned':
        return 'badge-completed';
      default:
        return 'badge-upcoming';
    }
  }

  // ---- Permission gating ----
  //
  // ONE SOURCE: the codes the server listed for this caller. The old version looked each action
  // up in a `PermissionMap` object that lived in the same file as the leads, so what somebody
  // could do was decided by the bundle rather than by their token.
  //
  // THE THREE-ROLE MODEL NEEDS NO CODE HERE. An APPROVER holds no `don.lead-work-queue.qualify`,
  // so Qualify is not drawn for them; TENANT_ADMIN and INITIATOR both hold it.

  canQualify(lead: LeadItem): boolean {
    // STATE AS WELL AS PERMISSION, AND THE STATE IS THE SERVER'S. This used to require a Hot
    // lead with "readiness" - a word this screen derived from donation potential - so whether a
    // lead could be qualified was decided by a rule that exists nowhere on the server.
    return this.permissions()['qualify'] === true && lead.permittedActions.includes('Qualify');
  }

  canMarkLost(lead: LeadItem): boolean {
    return this.permissions()['close'] === true && lead.permittedActions.includes('Close');
  }

  canMarkDormant(lead: LeadItem): boolean {
    return this.permissions()['close'] === true && lead.permittedActions.includes('Close');
  }

  get canCommunicate(): boolean {
    return this.permissions()['contact'] === true;
  }

  get canScheduleFollowUp(): boolean {
    return this.permissions()['schedule'] === true;
  }

  get canExecuteFollowUp(): boolean {
    return this.permissions()['schedule'] === true;
  }

  /** Export Leads needs the export permission - the server refuses it otherwise. */
  get canExport(): boolean {
    return this.permissions()['export'] === true;
  }

  /** Create Lead belongs to Lead Capture; DonorCare does not hold it. */
  get canCreate(): boolean {
    return this.permissions()['create'] === true;
  }

  get canBulkAct(): boolean {
    return this.permissions()['view'] === true;
  }

  // ---- interactions ----
  openLead(ref: string): void {
    this.activeRef.set(ref);
  }

  closeLeadDetails(): void {
    this.activeRef.set(null);
  }

  toggleSelection(ref: string, event: Event): void {
    event.stopPropagation();
    const next = new Set(this.selectedRefs());
    if (next.has(ref)) {
      next.delete(ref);
    } else {
      next.add(ref);
    }
    this.selectedRefs.set(next);
  }

  toggleSelectAllVisible(): void {
    const visible = this.pagedLeads();
    if (this.allVisibleSelected()) {
      const next = new Set(this.selectedRefs());
      visible.forEach((l) => next.delete(l.reference));
      this.selectedRefs.set(next);
    } else {
      const next = new Set(this.selectedRefs());
      visible.forEach((l) => next.add(l.reference));
      this.selectedRefs.set(next);
    }
  }

  clearSelection(): void {
    this.selectedRefs.set(new Set());
  }

  applyPipelineFilter(stage: string): void {
    this.stageFilter.set(stage);
    this.currentPage.set(1);
  }

  updateSearch(term: string): void {
    this.searchTerm.set(term);
    this.currentPage.set(1);
  }

  updateStageFilter(value: FilterValue): void {
    this.stageFilter.set(value);
    this.currentPage.set(1);
  }

  updateTemperatureFilter(value: FilterValue): void {
    this.temperatureFilter.set(value);
    this.currentPage.set(1);
  }

  updateFollowUpFilter(value: FilterValue): void {
    this.followUpFilter.set(value);
    this.currentPage.set(1);
  }

  goToPage(page: number): void {
    this.currentPage.set(Math.min(Math.max(page, 1), this.totalPages()));
  }

  private ensureValidPage(): void {
    this.goToPage(this.currentPage());
  }

  applySavedFilter(name: string): void {
    switch (name) {
      case 'Due today':
        this.resetFilters(false);
        this.followUpFilter.set('Due');
        break;
      case 'Overdue':
        this.resetFilters(false);
        this.followUpFilter.set('Overdue');
        break;
      case 'Hot leads':
        this.resetFilters(false);
        this.temperatureFilter.set('Hot');
        break;
      case 'Ready for qualification':
        this.resetFilters(false);
        this.stageFilter.set('Qualified');
        break;
      default:
        this.resetFilters(false);
    }
  }

  resetFilters(clearSearch = true): void {
    if (clearSearch) this.searchTerm.set('');
    this.stageFilter.set('All');
    this.temperatureFilter.set('All');
    this.followUpFilter.set('All');
    this.currentPage.set(1);
  }

  refresh(): void {
    this.load();
  }

  /**
   * Export Leads - the caller's own leads, written by the server.
   *
   * THE FILE USED TO BE BUILT HERE from whatever rows were loaded, with the API's id in the
   * Reference column, no permission check and no record that a copy had been taken. The server
   * exports the same scope this list shows (`onlyMine`), under the filters on screen, masks the
   * contact columns by the caller's permission and logs it. A selection narrows it to those leads.
   */
  exportSelected(): void {
    if (!this.canExport || this.exporting()) return;

    const selected = [...this.selectedRefs()];
    const stage = this.stageFilter();
    const temperature = this.temperatureFilter();
    const followUp = this.followUpFilter();

    this.exportGrid.emit(
      selected.length > 0
        ? this.sourceLeads().filter((lead) => this.selectedRefs().has(lead.reference))
        : this.filteredLeads(),
    );

    this.exporting.set(true);
    this.api
      .exportLeads({
        onlyMine: true,
        search: this.searchTerm().trim() || undefined,
        status: stage === 'All' ? null : stage,
        temperature: temperature === 'All' ? null : temperature,
        followUpState: followUp === 'All' ? null : this.toServerFollowUpState(followUp),
        leadIds: selected.length > 0 ? selected.join(',') : null,
      })
      .subscribe({
        next: ({ blob, fileName }) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: (error: unknown) => {
          this.exporting.set(false);
          this.toast.show('Not exported', apiErrorMessage(error, 'The leads could not be exported.'), 'error');
        },
      });
  }

  /** This screen's follow-up words to the server's filter values. */
  private toServerFollowUpState(status: string): string {
    switch (status) {
      case 'Due': return 'DueToday';
      case 'Not planned': return 'None';
      default: return status;
    }
  }

  requestCommunicate(ref: string): void {
    if (!this.canCommunicate) return;
    this.communicate.emit(ref);
    this.router.navigate(['/app/fundraising/relationships/communication-timeline'], { queryParams: { leadId: ref } });
  }

  requestScheduleFollowUp(ref: string): void {
    if (!this.canScheduleFollowUp) return;
    this.scheduleFollowUp.emit(ref);
    this.router.navigate(['/app/don/follow-up-planner'], { queryParams: { leadId: ref, mode: 'create' } });
  }

  /**
   * Execute Follow-Up - "opens the Follow-Up Execution page", per the document.
   *
   * IT NO LONGER INVENTS A FOLLOW-UP. The old version created one on the spot when the lead had
   * none, so pressing Execute manufactured the very task it then claimed to be executing. The
   * execution screen loads the lead's real follow-ups and says so when there are none.
   */
  requestExecuteFollowUp(ref: string): void {
    if (!this.canExecuteFollowUp) {
      return;
    }
    this.executeFollowUp.emit(ref);
    this.router.navigate(['/app/fundraising/relationships/follow-up-execution'], {
      queryParams: { leadId: ref },
    });
  }

  /**
   * Qualify - saved through the lead's own qualify command.
   *
   * THE NOTES ARE REQUIRED, 10 to 2000 characters, because qualifying is a judgement somebody
   * made and the audit trail should carry why. The old version set a local string.
   */
  requestQualify(lead: LeadItem): void {
    if (!this.canQualify(lead)) {
      return;
    }

    this.api
      .qualifyLead(lead.reference, {
        qualificationNotes: lead.recommendedNextAction
          ? `Qualified from My Leads. Next action: ${lead.recommendedNextAction}.`
          : 'Qualified from My Leads.',
        moveToNurture: false,
        expectedVersion: lead.version,
      })
      .subscribe({
        next: () => {
          this.qualify.emit(lead.reference);
          this.toast.show('Lead qualified', `${lead.displayReference} is now qualified.`, 'success');
          this.load();
        },
        error: (error: unknown) => this.toast.show('Not qualified', apiErrorMessage(error), 'error'),
      });
  }

  requestMarkLost(lead: LeadItem): void {
    if (!this.canMarkLost(lead)) {
      return;
    }
    this.closeLead(lead, 'Lost', 'Marked lost from My Leads.');
  }

  requestMarkDormant(lead: LeadItem): void {
    if (!this.canMarkDormant(lead)) {
      return;
    }
    this.closeLead(lead, 'Dormant', 'Marked dormant from My Leads.');
  }

  /**
   * Closes a lead with a recorded reason.
   *
   * LOST AND DORMANT ARE THE SAME WRITE with a different reason, which is why they share this.
   * Both take the lead out of the working queue, and the trail should say which one it was.
   */
  private closeLead(lead: LeadItem, outcome: string, reason: string): void {
    this.api
      .closeLead(lead.reference, { reason: `${outcome}: ${reason}`, expectedVersion: lead.version })
      .subscribe({
        next: () => {
          if (outcome === 'Lost') {
            this.markLost.emit(lead.reference);
          } else {
            this.markDormant.emit(lead.reference);
          }
          this.toast.show(`Marked ${outcome.toLowerCase()}`, `${lead.displayReference} was closed.`, 'success');
          this.load();
        },
        error: (error: unknown) => this.toast.show('Not saved', apiErrorMessage(error), 'error'),
      });
  }

  requestOpenFollowUpQueue(): void {
    this.openFollowUpQueue.emit();
    this.router.navigate(['/app/fundraising/relationships/follow-up-queue']);
  }

  requestCreateLead(): void {
    this.router.navigate(['/app/fundraising/relationships/lead-capture']);
  }

  requestViewLeadQueue(): void {
    this.viewLeadQueue.emit();
    this.router.navigate(['/app/fundraising/relationships/lead-work-queue']);
  }

  /**
   * Copies the lead reference to the clipboard and shows a brief
   * "copied" confirmation on the icon button.
   */
  async copyReference(ref: string, event: Event): Promise<void> {
    event.stopPropagation();

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(ref);
      } else {
        this.legacyCopy(ref);
      }
    } catch {
      this.legacyCopy(ref);
    }

    if (this.copiedRefTimeout) {
      clearTimeout(this.copiedRefTimeout);
    }
    this.copiedRef.set(ref);
    this.copiedRefTimeout = setTimeout(() => {
      this.copiedRef.set(null);
      this.copiedRefTimeout = null;
    }, 1500);
  }

  private legacyCopy(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  trackByRef(_index: number, item: LeadItem): string {
    return item.reference;
  }
}
