import { ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Output, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  DonLookupItem,
  LeadListItem,
  LeadWorkQueueFilter,
  LeadWorkQueueResponse,
  QueueView,
} from '../../../../Shared/models/donor-contract.model';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
// ============================================================================
// DATA MODEL
// ============================================================================
export interface LeadItem {
  /** The API's id. Every write on this screen is addressed to it. */
  reference: string;
  name: string;
  campaign: string;
  owner: string;
  stage: string;
  temperature: string;
  healthScore: number;

  /** The server's word for the score: Healthy, Needs attention or At risk. */
  healthBand: string;
  nextFollowUp: string;

  /** Overdue / Due Today / Tomorrow / Upcoming / None - the server's reading of the next contact. */
  followUpState: string;

  /** That state in the words of the server's follow-up options; empty when nothing is planned. */
  followUpLabel: string;

  /** What this lead's state allows - the server's list, e.g. Contact, Qualify, Close. */
  permittedActions: readonly string[];
  language: string;
  source: string;
  lastContactOutcome: string;
  recommendedNextAction: string;
  contactRestricted: boolean;

  /** The reference a person quotes, e.g. LED-2026-001245. */
  displayReference: string;

  /** The server's row version, sent back on every write for the concurrency check. */
  version: number;
  email?: string;
  mobile?: string;
}

export interface PipelineStage {
  stage: string;
  label: string;
  count: number;
}

/** A figure across the top: the server's view, with the tone and icon it is drawn in. */
export interface LeadFigure extends QueueView {
  tone: string;
  icon: string;
}

/**
 * The tone and icon each of the server's views is drawn in - presentation only. The words, the
 * hints and the counts are the server's; a view this does not know is drawn plainly.
 */
const FIGURE_LOOK: Readonly<Record<string, { tone: string; icon: string }>> = {
  all: { tone: 'accent', icon: 'ri-user-heart-line' },
  hot: { tone: 'hot', icon: 'ri-fire-line' },
  warm: { tone: 'warm', icon: 'ri-sun-line' },
  cold: { tone: 'cold', icon: 'ri-snowy-line' },
  'due-today': { tone: 'due', icon: 'ri-calendar-check-line' },
  overdue: { tone: 'late', icon: 'ri-alarm-warning-line' },
};

const ALL = 'All';
const ALL_VIEW = 'all';

/**
 * LEADS_SOURCE - REMOVED.
 *
 * It was a literal compiled into the bundle: eleven named leads with campaigns, owners, health
 * scores and follow-up dates, so every fundraiser in every organisation opened My Leads to the
 * same eleven people.
 */

@Component({
  selector: 'app-my-leads',
  standalone: true,
  imports: [RowsPerPage, CommonModule, FormsModule],
  templateUrl: './my-leads.html',
  styleUrl: './my-leads.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyLeadsComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DonorApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchChanges = new Subject<void>();
  private loadSubscription?: Subscription;

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

  readonly screen = {
    title: 'My leads',
    purpose: 'The leads assigned to you. Work them, schedule follow-ups and record what happened.',
  };

  /** What the caller may do, from the server's permitted actions for the queue. */
  readonly permissions = signal<Record<string, boolean>>({ view: false });

  /**
   * The six figures - the server's views of the caller's own leads, counted over all of them.
   *
   * NOT COUNTED HERE, AND NOT NAMED HERE. They were a literal in this file, then a count of the
   * rows this browser had loaded. The queue endpoint asked for `onlyMine` answers them, each with
   * its words, and a figure's value sent back as `view` returns exactly the leads it counted.
   */
  readonly figures = signal<readonly LeadFigure[]>([]);

  /** The caller's leads per stage, from the server's counts, in the server's stage order. */
  readonly pipeline = signal<PipelineStage[]>([]);

  // ---- state ----
  private readonly rows = signal<LeadItem[]>([]);
  readonly totalCount = signal(0);

  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly exporting = signal(false);

  /** Outcome value to the server's label for it - "CallbackRequested" to "Requested callback". */
  private outcomeLabels = new Map<string, string>();

  /** The view in effect, as the server answered it ("all" when a filter superseded the figure). */
  private readonly view = signal(ALL_VIEW);

  readonly searchTerm = signal('');
  readonly stageFilter = signal<string>(ALL);
  readonly temperatureFilter = signal<string>(ALL);
  readonly followUpFilter = signal<string>(ALL);

  /** The server's temperatures and follow-up states; empty until it answers. */
  readonly temperatureOptions = signal<readonly DonLookupItem[]>([]);
  readonly followUpOptions = signal<readonly DonLookupItem[]>([]);

  readonly selectedRefs = signal<ReadonlySet<string>>(new Set());
  readonly activeRef = signal<string | null>(null);
  readonly currentPage = signal(1);
  readonly pageSize = signal(10);

  setPageSize(n: number): void {
    this.pageSize.set(n);
    this.currentPage.set(1);
    this.load();
  }

  // ---- copy-to-clipboard feedback state ----
  readonly copiedRef = signal<string | null>(null);
  private copiedRefTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.searchChanges
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
    this.destroyRef.onDestroy(() => this.loadSubscription?.unsubscribe());

    this.activeRef.set(this.route.snapshot.queryParamMap.get('leadId'));
    this.load();
  }

  /**
   * SCR-DON-009 - My Leads: "the owner-specific list page: it shows the leads assigned to a
   * single owner". `onlyMine` is how the server is told that, resolved from the token.
   *
   * ONE PAGE PER REQUEST, FILTERED ON THE SERVER. The screen used to download every page and
   * filter, count and page them itself; the queue endpoint does all of it now, as it does for the
   * Lead Work Queue, so the figures, the stage counts, the rows and the export answer one question.
   */
  private buildFilter(): LeadWorkQueueFilter {
    const stage = this.stageFilter();
    const temperature = this.temperatureFilter();
    const followUp = this.followUpFilter();

    return {
      page: this.currentPage(),
      pageSize: this.pageSize(),
      onlyMine: true,
      search: this.searchTerm().trim() || undefined,
      status: stage === ALL ? null : stage,
      temperature: temperature === ALL ? null : temperature,
      followUpState: followUp === ALL ? null : followUp,
      view: this.view() === ALL_VIEW ? null : this.view(),
    };
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.loadSubscription?.unsubscribe();
    this.loadSubscription = this.api
      .getLeadWorkQueue(this.buildFilter())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.apply(response),
        error: (error: unknown) => {
          this.loading.set(false);
          this.loadError.set(apiErrorMessage(error));
        },
      });
  }

  private apply(response: LeadWorkQueueResponse): void {
    // A page past the end (the set shrank since it was asked for): step back to the last page.
    const lastPage = Math.max(1, Math.ceil(response.leads.totalCount / this.pageSize()));
    if (response.leads.items.length === 0 && response.leads.totalCount > 0 && this.currentPage() > lastPage) {
      this.currentPage.set(lastPage);
      this.load();
      return;
    }

    this.outcomeLabels = new Map(
      (response.contactOutcomeOptions ?? []).map((option) => [option.value, option.label]),
    );
    this.temperatureOptions.set(response.temperatureOptions ?? []);
    this.followUpOptions.set(response.followUpStateOptions ?? []);

    this.rows.set(response.leads.items.map((row) => this.toLeadItem(row)));
    this.totalCount.set(response.leads.totalCount);

    this.figures.set(
      (response.views ?? []).map((view) => ({
        ...view,
        tone: FIGURE_LOOK[view.value]?.tone ?? 'accent',
        icon: FIGURE_LOOK[view.value]?.icon ?? 'ri-list-check',
      })),
    );
    this.view.set(response.activeView || ALL_VIEW);

    // Converted leads are not in this list - they are donors now, in My Donor List - so a
    // Converted chip would filter to nothing.
    this.pipeline.set(
      (response.statusOptions ?? [])
        .filter((option) => option.value !== 'Converted')
        .map((option) => ({
          stage: option.value,
          label: option.label,
          count: response.statusCounts?.[option.value] ?? 0,
        }))
        .filter((stage) => stage.count > 0 || stage.stage === this.stageFilter()),
    );

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
      temperature: row.temperature,
      healthScore: row.healthScore,
      healthBand: row.healthBand,
      nextFollowUp: this.formatDate(row.nextActionDueUtc),
      followUpState: row.followUpState,
      followUpLabel: row.followUpState === 'None' ? '' : this.followUpWords(row.followUpState),
      permittedActions: row.permittedActions ?? [],
      language: row.preferredLanguage,
      source: row.source ?? '',
      lastContactOutcome: this.outcomeLabels.get(row.lastContactOutcome) ?? row.lastContactOutcome,

      // The lead's own next action, or nothing.
      recommendedNextAction: row.nextAction ?? '',

      // MASKED BY THE SERVER, and a masked lead is one this caller may not contact directly.
      contactRestricted: row.isContactMasked,
      version: row.version,
    };
  }

  /** A row's follow-up state in the words of the server's options ("DueToday" is "Due today"). */
  private followUpWords(state: string): string {
    const key = (state ?? '').replace(/\s+/g, '');
    return this.followUpOptions().find((option) => option.value === key)?.label ?? state;
  }

  /** The server's word for a lead with nothing planned. */
  readonly notPlannedLabel = computed(
    () => this.followUpOptions().find((option) => option.value === 'None')?.label ?? '',
  );

  private formatDate(value: string | null): string {
    if (!value) {
      return '';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ''
      : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // ---- derived view state ----

  /** The rows on screen - the server's page, exactly. */
  readonly pagedLeads = computed(() => this.rows());
  readonly filteredLeads = computed(() => this.rows());

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));
  readonly pageStart = computed(() => (this.totalCount() === 0 ? 0 : (this.currentPage() - 1) * this.pageSize() + 1));
  readonly pageEnd = computed(() => Math.min(this.currentPage() * this.pageSize(), this.totalCount()));
  readonly pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, index) => index + 1));

  readonly isEmpty = computed(() => !this.loading() && !this.loadError() && this.rows().length === 0);

  /** Every lead in the caller's assignment - the "all" figure, for the Stage tab of the same name. */
  readonly allCount = computed(() => this.figures().find((figure) => figure.value === ALL_VIEW)?.count ?? 0);

  readonly activeLead = computed<LeadItem | null>(() => {
    const ref = this.activeRef();
    if (!ref) return null;
    return this.rows().find((l) => l.reference === ref) ?? null;
  });

  /** True when anything narrows the list - drives the Reset link. */
  readonly hasActiveFilters = computed(
    () =>
      !!this.searchTerm().trim() ||
      this.view() !== ALL_VIEW ||
      this.stageFilter() !== ALL ||
      this.temperatureFilter() !== ALL ||
      this.followUpFilter() !== ALL,
  );

  /** Which figure reads as selected: the server's view in effect, when no other filter narrows it. */
  readonly activeFigure = computed<string>(() => {
    const narrowed = this.stageFilter() !== ALL || this.temperatureFilter() !== ALL || this.followUpFilter() !== ALL;
    return narrowed ? '' : this.view();
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

  /** The meter's colour, from the server's reading of the score - the same band the Lead Queue shows. */
  healthBand(lead: LeadItem): 'high' | 'mid' | 'low' {
    switch (lead.healthBand) {
      case 'Healthy': return 'high';
      case 'Needs attention': return 'mid';
      default: return 'low';
    }
  }

  /** The tone of a lead's next follow-up, for colouring its date line. */
  dueTone(lead: LeadItem): 'late' | 'today' | 'soon' | 'none' {
    switch (lead.followUpState) {
      case 'Overdue': return 'late';
      case 'Due Today': return 'today';
      case 'Tomorrow':
      case 'Upcoming': return 'soon';
      default: return 'none';
    }
  }

  /** A figure is a shortcut: the server's view of that name, with the other narrowings cleared. */
  pickFigure(view: string): void {
    this.stageFilter.set(ALL);
    this.temperatureFilter.set(ALL);
    this.followUpFilter.set(ALL);
    this.view.set(view);
    this.currentPage.set(1);
    this.load();
  }

  // ---- Permission gating: the server's verbs for this caller, and each row's own list ----

  canQualify(lead: LeadItem): boolean {
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
    const next = new Set(this.selectedRefs());
    if (this.allVisibleSelected()) {
      visible.forEach((l) => next.delete(l.reference));
    } else {
      visible.forEach((l) => next.add(l.reference));
    }
    this.selectedRefs.set(next);
  }

  clearSelection(): void {
    this.selectedRefs.set(new Set());
  }

  applyPipelineFilter(stage: string): void {
    this.updateStageFilter(stage);
  }

  updateSearch(term: string): void {
    this.searchTerm.set(term);
    this.currentPage.set(1);
    this.searchChanges.next();
  }

  updateStageFilter(value: string): void {
    this.stageFilter.set(value);
    this.currentPage.set(1);
    this.load();
  }

  updateTemperatureFilter(value: string): void {
    this.temperatureFilter.set(value);
    this.currentPage.set(1);
    this.load();
  }

  updateFollowUpFilter(value: string): void {
    this.followUpFilter.set(value);
    this.currentPage.set(1);
    this.load();
  }

  goToPage(page: number): void {
    const next = Math.min(Math.max(page, 1), this.totalPages());
    if (next === this.currentPage()) return;
    this.currentPage.set(next);
    this.load();
  }

  resetFilters(clearSearch = true): void {
    if (clearSearch) this.searchTerm.set('');
    this.view.set(ALL_VIEW);
    this.stageFilter.set(ALL);
    this.temperatureFilter.set(ALL);
    this.followUpFilter.set(ALL);
    this.currentPage.set(1);
    this.load();
  }

  refresh(): void {
    this.load();
  }

  /**
   * Export Leads - the caller's own leads, written by the server.
   *
   * THE SAME QUESTION THE LIST ASKED: the view, the stage, the temperature, the follow-up state
   * and the search, with `onlyMine`. A selection narrows it to those leads. The server masks the
   * contact columns by the caller's permission and logs the export.
   */
  exportSelected(): void {
    if (!this.canExport || this.exporting()) return;

    const selected = [...this.selectedRefs()];

    this.exportGrid.emit(
      selected.length > 0
        ? this.rows().filter((lead) => this.selectedRefs().has(lead.reference))
        : this.rows(),
    );

    this.exporting.set(true);
    this.api
      .exportLeads({
        ...this.buildFilter(),
        leadIds: selected.length > 0 ? selected.join(',') : null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
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

  /** Execute Follow-Up - "opens the Follow-Up Execution page", per the document. */
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
   * Qualify - saved through the lead's own qualify command. The notes are required, 10 to 2000
   * characters, because qualifying is a judgement somebody made.
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

  /** Lost and dormant are the same write with a different recorded reason. */
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

  /** Copies the lead reference to the clipboard and shows a brief "copied" confirmation. */
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
