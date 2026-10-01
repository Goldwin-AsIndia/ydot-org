import { CommonModule, DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, Subject, Subscription } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import {
  DonLookupItem,
  LeadListItem,
  LeadWorkQueueFilter,
  LeadWorkQueueResponse,
} from '../../../../Shared/models/donor-contract.model';

export type UiState = 'ready' | 'loading' | 'success' | 'error' | 'empty';

/**
 * One row of the queue, as this screen draws it.
 *
 * IT IS A VIEW OF `LeadListItem`, NOT A SEPARATE TRUTH. Every field is copied straight from the
 * server's row; nothing is computed here that the server also computes. `masked` in particular
 * is the server's `isContactMasked` - whether the caller may read a donor's phone number is a
 * permission decision, and a browser that decided it for itself would be deciding it wrongly.
 */
export interface LeadItem {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly mobile: string;
  readonly email: string;
  readonly source: string;
  readonly campaign: string;
  readonly stage: string;
  readonly temperature: string;
  readonly donationPotential: string;
  readonly owner: string;
  readonly ownerUserId: string | null;
  readonly lastActivity: string;
  readonly nextFollowUp: string;
  readonly nextDue: string | null;
  readonly healthScore: number;
  readonly lastContactOutcome: string;
  readonly language: string;
  readonly masked: boolean;
  readonly converted: boolean;
  readonly donorId: string | null;
  readonly version: number;
  readonly permittedActions: readonly string[];
}

export interface KpiCard {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly hint: string;
}

export interface PipelineStage {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface LeadQueuePermissions {
  readonly view: boolean;
  readonly create: boolean;
  readonly assign: boolean;
  readonly communicate: boolean;
  readonly schedule: boolean;
  readonly export: boolean;
}

/** Nothing until the server answers. A screen that assumes permissions shows buttons that 403. */
const NO_PERMISSIONS: LeadQueuePermissions = {
  view: false,
  create: false,
  assign: false,
  communicate: false,
  schedule: false,
  export: false,
};

/**
 * The tabs across the top of the queue, exactly as the workflow document draws them.
 *
 * EACH ONE IS A SERVER FILTER, not a predicate over an array in this browser. The distinction
 * matters because the grid is paged: filtering the current page client-side would show "4
 * unassigned" when the organisation has ninety, and the count on the tab would disagree with the
 * rows underneath it.
 */
const SAVED_VIEWS = [
  'All Leads',
  'Unassigned Leads',
  'Assigned Leads',
  'Hot Leads',
  'High Donation Potential',
  'Recently Added',
  'Converted Leads',
] as const;
type SavedView = (typeof SAVED_VIEWS)[number];

/**
 * SCR-DON-001 - Lead Queue. The document's central list page.
 *
 * WHAT THIS REPLACES. The component imported two JSON files at build time -
 * `donors-leads/lead-work-queue.json` for the screen chrome and `my-leads.json` for the rows -
 * seeded a `WorkflowStateService` signal from them and worked over that array in memory. Four
 * things followed, and all four were real:
 *
 *   - NOTHING WAS EVER SAVED. A lead assigned or contacted here was back to its old state on
 *     refresh, because no request ever left the browser.
 *   - EVERY ORGANISATION SAW THE SAME ELEVEN LEADS. A file compiled into the bundle has no idea
 *     who is asking, so tenant isolation stopped at the API boundary.
 *   - THE MASKING RULES COULD NOT WORK. Whether a lead's mobile number is visible depends on
 *     `don.donors.view-sensitive-contact`, which the server checks; a static file has one answer
 *     for everybody and it was "show it".
 *   - THE COUNTS WERE FICTION. The KPI cards and the pipeline tabs counted the rows in the file.
 *
 * IT NOW READS `GET /api/v1/donors/lead-work-queue`, which answers the rows, the dropdowns, the
 * status counts, the summary cards and the caller's permitted actions in ONE call - so the tabs
 * and the grid can never disagree, because they came from the same answer.
 */
@Component({
  selector: 'app-lead-work-queue',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './lead-work-queue.html',
  styleUrl: './lead-work-queue.css',
})
export class LeadWorkQueueComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DonorApiService);

  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchChanges = new Subject<void>();
  private loadSubscription?: Subscription;
  protected readonly previewDialog = viewChild<ElementRef<HTMLDialogElement>>('leadDialog');
  protected readonly optionSearch = signal<Partial<Record<string, string>>>({});
  protected readonly filterFields = computed(() => {
    const options = this.filterOptions();
    const choices = (values: readonly string[]) => values.map((value) => ({ value, label: value }));
    return [
      { key: 'stage', label: 'Stage', value: this.stageFilter(), options: options.stages },
      {
        key: 'temperature',
        label: 'Temperature',
        value: this.temperatureFilter(),
        options: options.temperatures,
      },
      {
        key: 'potential',
        label: 'Donation potential',
        value: this.potentialFilter(),
        options: options.potentials,
      },
      {
        key: 'source',
        label: 'Lead source',
        value: this.sourceFilter(),
        options: choices(options.sources),
      },
      {
        key: 'owner',
        label: 'Owner',
        value: this.ownerFilter(),
        options: [
          { value: 'Unassigned', label: 'Unassigned' },
          ...this.ownerOptions().filter((owner) => owner.value !== 'Unassigned'),
        ],
      },
    ];
  });

  protected onSearchChange(value: string): void {
    this.searchTerm.set(value);
    this.pageIndex.set(1);
    this.searchChanges.next();
  }

  protected setOptionSearch(key: string, value: string): void {
    this.optionSearch.update((current) => ({ ...current, [key]: value }));
  }

  protected matchingOptions(
    key: string,
    options: readonly DonLookupItem[],
    selected: string,
  ): readonly DonLookupItem[] {
    const query = (this.optionSearch()[key] ?? '').trim().toLocaleLowerCase();
    return options.filter(
      (option) => option.value === selected || option.label.toLocaleLowerCase().includes(query),
    );
  }

  protected setFilterValue(key: string, value: string): void {
    // Explicit field choices supersede saved views that force the same field.
    if (
      (key === 'temperature' && this.savedView() === 'Hot Leads') ||
      (key === 'potential' && this.savedView() === 'High Donation Potential') ||
      (key === 'owner' && ['Assigned Leads', 'Unassigned Leads'].includes(this.savedView()))
    ) {
      this.savedView.set('All Leads');
    }
    switch (key) {
      case 'stage':
        this.stageFilter.set(value);
        break;
      case 'temperature':
        this.temperatureFilter.set(value);
        break;
      case 'potential':
        this.potentialFilter.set(value);
        break;
      case 'source':
        this.sourceFilter.set(value);
        break;
      case 'owner':
        this.ownerFilter.set(value);
        break;
    }
  }

  protected onPreviewBackdrop(event: MouseEvent): void {
    const dialog = this.previewDialog()?.nativeElement;
    if (!dialog || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      this.closePreview();
    }
  }

  // ===========================================================================================
  // Screen chrome. Signals rather than constants, because the server supplies them.
  // ===========================================================================================
  protected readonly screen = signal({
    viewId: 'SCR-DON-001',
    title: 'Lead Work Queue',
    route: '/app/fundraising/relationships/lead-work-queue',
    purpose: 'Manage and monitor all leads within the tenant.',
    scope: '',
    lastRefresh: '',
    breadcrumb: ['Fundraising', 'Relationships', 'Lead Queue'] as readonly string[],
  });

  protected readonly uiState = signal<UiState>('loading');
  protected readonly errorMessage = signal<string>('');

  protected readonly permissions = signal<LeadQueuePermissions>(NO_PERMISSIONS);
  protected readonly kpis = signal<readonly KpiCard[]>([]);
  protected readonly pipeline = signal<readonly PipelineStage[]>([]);
  protected readonly savedViews = signal<readonly string[]>(SAVED_VIEWS);
  protected readonly filterOptions = signal<{
    readonly stages: readonly DonLookupItem[];
    readonly temperatures: readonly DonLookupItem[];
    readonly potentials: readonly DonLookupItem[];
    readonly sources: readonly string[];
  }>({ stages: [], temperatures: [], potentials: [], sources: [] });
  protected readonly ownerOptions = signal<readonly DonLookupItem[]>([]);

  // ===========================================================================================
  // Filter state. Every one of these re-queries the server.
  // ===========================================================================================
  protected readonly savedView = signal<string>('All Leads');
  protected readonly searchTerm = signal('');
  protected readonly stageFilter = signal<string>('');
  protected readonly temperatureFilter = signal<string>('');
  protected readonly potentialFilter = signal<string>('');
  protected readonly sourceFilter = signal<string>('');
  protected readonly ownerFilter = signal<string>('');
  protected readonly showFilters = signal(false);

  // Paging. The server pages the queue; these are the page asked for and its size.
  protected readonly pageSizes = [12, 24, 48, 96] as const;
  protected readonly pageIndex = signal(1);
  protected readonly pageSize = signal(12);

  protected readonly leads = signal<readonly LeadItem[]>([]);
  protected readonly totalCount = signal(0);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly selectedLead = signal<LeadItem | null>(null);
  protected readonly copiedField = signal<string | null>(null);

  constructor() {
    this.searchChanges
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load());
    this.destroyRef.onDestroy(() => this.loadSubscription?.unsubscribe());

    // THE SELECTION BAR IS STICKY, and sticky needs the window to be its scroller. The shell's
    // `.content-page` carries `overflow-y: auto` without ever scrolling, which traps it; clip it
    // while this screen is up and put it back on the way out.
    let column: HTMLElement | null = null;
    let overflow = '';
    afterNextRender(() => {
      column = this.host.nativeElement.closest('.content-page') as HTMLElement | null;
      overflow = column?.style.overflow ?? '';
      if (column) column.style.overflow = 'clip';
    });
    this.destroyRef.onDestroy(() => {
      if (column) column.style.overflow = overflow;
    });
    afterRenderEffect((onCleanup) => {
      const lead = this.selectedLead();
      const dialog = this.previewDialog()?.nativeElement;
      if (!lead || !dialog) return;
      const previousOverflow = this.document.body.style.overflow;
      this.document.body.style.overflow = 'hidden';
      if (!dialog.open) dialog.showModal();
      onCleanup(() => {
        if (dialog.open) dialog.close();
        this.document.body.style.overflow = previousOverflow;
      });
    });

    // Coming back from Lead Capture. The reference is the API's, not one this browser minted,
    // so the row it opens is the row that was actually saved.
    const createdLeadId = this.route.snapshot.queryParamMap.get('createdLeadId');
    if (createdLeadId) {
      this.openAfterLoad = createdLeadId;
    }
    this.load();
  }

  private openAfterLoad: string | null = null;

  // ===========================================================================================
  // Loading
  // ===========================================================================================

  /**
   * One call fills the whole screen.
   *
   * THE FILTERS GO TO THE SERVER, not to a `.filter()` over what is already here. The grid is
   * paged, so a client-side predicate would filter one page and label it as the whole set.
   */
  private load(): void {
    this.uiState.set('loading');
    this.errorMessage.set('');

    this.loadSubscription?.unsubscribe();
    this.loadSubscription = this.api
      .getLeadWorkQueue(this.buildFilter())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.applyResponse(response),
        error: (error: unknown) => {
          this.errorMessage.set(apiErrorMessage(error));
          this.uiState.set('error');
        },
      });
  }

  /** The saved view and the filter controls, translated into the API's query string. */
  private buildFilter(): LeadWorkQueueFilter {
    const filter: LeadWorkQueueFilter = {
      page: this.pageIndex(),
      pageSize: this.pageSize(),
      search: this.searchTerm().trim() || undefined,
      status: this.stageFilter() || null,
      temperature: this.temperatureFilter() || null,
      donationPotential: this.potentialFilter() || null,
    };

    const owner = this.ownerFilter();
    if (owner === 'Unassigned') {
      filter.assignmentState = 'Unassigned';
    } else if (owner && owner !== 'All') {
      filter.ownerUserId = owner;
    }

    switch (this.savedView() as SavedView) {
      case 'Unassigned Leads':
        filter.assignmentState = 'Unassigned';
        break;
      case 'Assigned Leads':
        filter.assignmentState = 'Assigned';
        break;
      case 'Hot Leads':
        filter.temperature = 'Hot';
        break;
      case 'High Donation Potential':
        filter.donationPotential = 'High';
        break;
      case 'Recently Added':
        filter.newestFirst = true;
        break;

      // THE ONLY TAB THAT ASKS FOR CONVERTED ROWS. Everywhere else they are hidden, because the
      // document says a converted lead leaves this queue for the Donor List.
      case 'Converted Leads':
        filter.isConverted = true;
        break;
    }

    return filter;
  }

  private applyResponse(response: LeadWorkQueueResponse): void {
    // A page past the end (the set shrank since it was asked for): step back to the last page.
    const lastPage = Math.max(1, Math.ceil(response.leads.totalCount / this.pageSize()));
    if (response.leads.items.length === 0 && response.leads.totalCount > 0 && this.pageIndex() > lastPage) {
      this.pageIndex.set(lastPage);
      this.load();
      return;
    }
    this.leads.set(response.leads.items.map((row) => this.toRow(row)));
    this.totalCount.set(response.leads.totalCount);
    const visibleIds = new Set(this.filteredLeads().map((lead) => lead.id));
    this.selectedIds.update((ids) => new Set([...ids].filter((id) => visibleIds.has(id))));

    this.screen.update((current) => ({
      ...current,
      scope: response.activeScope,
      lastRefresh: this.formatDateTime(response.lastRefreshedAtUtc),
    }));

    // THE CARDS COME FROM THE SERVER'S SUMMARY, not from counting the page. The summary is
    // scope-wide; the page is a hundred rows at most, and the two are different numbers.
    const summary = response.summary;
    this.kpis.set([
      { id: 'total', label: 'Total Leads', value: summary.totalLeads, hint: 'In selected scope' },
      {
        id: 'unassigned',
        label: 'Unassigned Leads',
        value: summary.unassignedLeads,
        hint: 'In selected scope',
      },
      {
        id: 'assigned',
        label: 'Assigned Leads',
        value: summary.assignedLeads,
        hint: 'In selected scope',
      },
      { id: 'hot', label: 'Hot Leads', value: summary.hotLeads, hint: 'In selected scope' },
      {
        id: 'converted',
        label: 'Converted Leads',
        value: summary.convertedLeads,
        hint: 'Donation recorded',
      },
      {
        id: 'potential',
        label: 'High Donation Potential',
        value: summary.highDonationPotential,
        hint: 'In selected scope',
      },
    ]);

    this.pipeline.set(
      response.statusOptions.map((option) => ({
        key: option.value,
        label: option.label,
        count: response.statusCounts[option.value] ?? 0,
      })),
    );

    this.filterOptions.set({
      stages: response.statusOptions,
      temperatures: response.temperatureOptions,
      potentials: response.donationPotentialOptions,
      sources: this.distinct(response.leads.items.map((row) => row.source ?? '').filter(Boolean)),
    });
    this.ownerOptions.set(response.ownerOptions);

    this.permissions.set(this.toPermissions(response.permittedActions));

    this.uiState.set(this.leads().length === 0 ? 'empty' : 'ready');

    if (this.openAfterLoad) {
      const created = this.leads().find(
        (lead) => lead.id === this.openAfterLoad || lead.reference === this.openAfterLoad,
      );
      if (created) {
        this.selectedLead.set(created);
      }
      this.openAfterLoad = null;
    }
  }

  private toRow(row: LeadListItem): LeadItem {
    return {
      id: row.id,
      reference: row.leadReference,
      name: row.name,

      // ALREADY MASKED, OR ALREADY NOT. The server sends '+91 98•••••210' or the real number
      // depending on the caller's permission, so there is nothing left to decide here.
      mobile: row.mobileNumber ?? '',
      email: row.emailAddress ?? '',
      source: row.source ?? '',
      campaign: row.campaignName ?? '',
      stage: row.status,
      temperature: row.temperature,
      donationPotential: row.donationPotential,
      owner: row.ownerName ?? 'Unassigned',
      ownerUserId: row.ownerUserId,
      lastActivity: row.lastContactOutcome,
      nextFollowUp: this.formatDate(row.nextActionDueUtc),
      nextDue: row.nextActionDueUtc,
      healthScore: row.healthScore,
      lastContactOutcome: row.lastContactOutcome,
      language: row.preferredLanguage,
      masked: row.isContactMasked,
      converted: row.isConverted,
      donorId: row.convertedDonorId,
      version: row.version,
      permittedActions: row.permittedActions ?? [],
    };
  }

  /**
   * The caller's permitted actions, as the server listed them.
   *
   * THIS IS THE WHOLE ROLE MODEL ON THIS SCREEN. TENANT_ADMIN, INITIATOR and APPROVER differ
   * only in which verbs appear in `permittedActions`, so nothing here names a role. The
   * endpoints re-check every one of these, so a hidden button is a courtesy rather than a
   * control.
   */
  private toPermissions(permitted: readonly string[]): LeadQueuePermissions {
    // THE SERVER ANSWERS IN VERBS, NOT PERMISSION CODES. This used to compare against strings
    // like 'don.lead-work-queue.assign', which match nothing the API returns - so every flag was
    // false and Create Lead, Export, Communicate and Assign were all hidden. The endpoint answers
    // ['Accept','Filter','Open','Create','Assign','Contact','Qualify','Close'].
    //
    // CREATE IS ITS OWN VERB, and it has to be. It was read off `Accept || Contact`, which are
    // rights over leads that ALREADY EXIST and say nothing about whether this caller may save a
    // new one - the form behind the button is Lead Capture, gated on `don.lead-capture.save`.
    // The queue endpoint now answers 'Create' for exactly that permission.
    const has = (verb: string) => permitted.includes(verb);
    return {
      view: has('Open') || has('Filter'),
      create: has('Create'),
      assign: has('Assign'),
      communicate: has('Contact'),
      schedule: has('Contact'),
      export: has('Filter') || has('Open'),
    };
  }

  private distinct(values: readonly string[]): readonly string[] {
    return [...new Set(values)].sort();
  }

  // ===========================================================================================
  // Derived view state
  // ===========================================================================================

  /**
   * The filter-panel choices, as removable tokens.
   *
   * THE VIEW, THE SEARCH AND THE STAGE ARE NOT HERE: each already shows where it was chosen (the
   * underlined lane, the search box with its clear button, the outlined stage key), and a token
   * that repeats them is noise.
   */
  protected readonly filterTokens = computed(() => {
    const tokens: { key: string; label: string }[] = [];
    const label = (options: readonly DonLookupItem[], value: string) =>
      options.find((option) => option.value === value)?.label ?? value;
    if (this.temperatureFilter()) {
      tokens.push({ key: 'temperature', label: `Temperature: ${label(this.filterOptions().temperatures, this.temperatureFilter())}` });
    }
    if (this.potentialFilter()) {
      tokens.push({ key: 'potential', label: `Potential: ${label(this.filterOptions().potentials, this.potentialFilter())}` });
    }
    if (this.sourceFilter()) {
      tokens.push({ key: 'source', label: `Source: ${this.sourceFilter()}` });
    }
    if (this.ownerFilter()) {
      tokens.push({ key: 'owner', label: `Owner: ${label(this.ownerOptions(), this.ownerFilter())}` });
    }
    return tokens;
  });

  /** How many filter-panel fields are set (the stage counts; it lives in the panel too). */
  protected readonly panelFilterCount = computed(
    () => this.filterTokens().length + (this.stageFilter() ? 1 : 0),
  );

  /** Anything narrowing the queue at all - drives the one Reset link. */
  protected readonly isFiltered = computed(
    () => this.savedView() !== 'All Leads' || !!this.searchTerm().trim() || this.panelFilterCount() > 0,
  );

  /**
   * The rows on screen.
   *
   * SOURCE IS THE ONE FILTER STILL APPLIED HERE, because the API has no source parameter. It is
   * a narrowing of the page rather than of the set, and the chip says so.
   */
  protected readonly filteredLeads = computed(() => {
    const source = this.sourceFilter();
    const rows = this.leads();
    return source ? rows.filter((lead) => lead.source === source) : rows;
  });

  protected readonly hasResults = computed(() => this.filteredLeads().length > 0);
  protected readonly selectedRows = computed(() =>
    this.filteredLeads().filter((lead) => this.selectedIds().has(lead.id)),
  );
  protected readonly selectionCount = computed(() => this.selectedRows().length);
  protected readonly allSelected = computed(() => {
    const ids = this.filteredLeads().map((l) => l.id);
    return ids.length > 0 && ids.every((id) => this.selectedIds().has(id));
  });

  // ===========================================================================================
  // Triage desk presentation - lanes, stage shares, due dates, next steps
  // ===========================================================================================

  /** Which summary figure counts each saved view. "Recently Added" has no server count. */
  private readonly viewKpi: Record<string, string> = {
    'All Leads': 'total',
    'Unassigned Leads': 'unassigned',
    'Assigned Leads': 'assigned',
    'Hot Leads': 'hot',
    'High Donation Potential': 'potential',
    'Converted Leads': 'converted',
  };

  private readonly laneMeta: Record<string, { label: string; glyph: string; hint: string }> = {
    'All Leads': { label: 'All leads', glyph: 'ri-stack-line', hint: 'Every lead in scope' },
    'Unassigned Leads': { label: 'Unassigned', glyph: 'ri-user-unfollow-line', hint: 'Waiting for an owner' },
    'Assigned Leads': { label: 'Assigned', glyph: 'ri-user-follow-line', hint: 'With a fundraiser' },
    'Hot Leads': { label: 'Hot', glyph: 'ri-fire-line', hint: 'Ready to talk' },
    'High Donation Potential': { label: 'High potential', glyph: 'ri-vip-diamond-line', hint: 'Largest likely gifts' },
    'Recently Added': { label: 'Recently added', glyph: 'ri-time-line', hint: 'Sorted by capture date' },
    'Converted Leads': { label: 'Converted', glyph: 'ri-hand-heart-line', hint: 'Donation recorded' },
  };

  /**
   * One lane per saved view, carrying the view's server count.
   *
   * THE LANES ARE BOTH THE SUMMARY AND THE TABS. The screen used to draw the same six counts
   * twice - once as summary figures and again as tab counts - so they now live in one row.
   * `value` is undefined before the first answer and null for a view the server does not count.
   */
  protected readonly lanes = computed(() => {
    const byId = new Map(this.kpis().map((k) => [k.id, k.value]));
    return this.savedViews().map((view) => {
      const meta = this.laneMeta[view] ?? { label: view, glyph: 'ri-list-check', hint: view };
      const id = this.viewKpi[view];
      return { view, ...meta, value: id ? byId.get(id) : null };
    });
  });

  /** The next contact relative to today, so an overdue lead reads as overdue at a glance. */
  protected dueState(lead: LeadItem): { label: string; tone: 'none' | 'late' | 'today' | 'soon' | 'later' } {
    if (!lead.nextDue) return { label: 'Not planned', tone: 'none' };
    const due = new Date(lead.nextDue);
    if (Number.isNaN(due.getTime())) return { label: 'Not planned', tone: 'none' };
    const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((day(due) - day(new Date())) / 86_400_000);
    if (days < 0) return { label: days === -1 ? 'Overdue by a day' : `Overdue by ${-days} days`, tone: 'late' };
    if (days === 0) return { label: 'Due today', tone: 'today' };
    if (days === 1) return { label: 'Tomorrow', tone: 'soon' };
    return { label: `In ${days} days`, tone: days <= 7 ? 'soon' : 'later' };
  }

  protected readonly pipelineTotal = computed(() => this.pipeline().reduce((sum, s) => sum + s.count, 0));

  protected stageShare(count: number): number {
    const total = this.pipelineTotal();
    return total > 0 ? Math.round((count / total) * 100) : 0;
  }

  /** The document's recommended next step for a lead at each stage. */
  protected nextStep(lead: LeadItem): string {
    switch (lead.stage) {
      case 'New': return 'Make the first contact';
      case 'Assigned': return 'Hold a qualification call';
      case 'Contacted': return 'Follow up the conversation';
      case 'Engaged': return 'Discuss a proposal';
      default: return lead.converted ? 'Continue on Donor 360' : 'Review where this lead stands';
    }
  }

  protected potentialLevel(potential: string): number {
    switch (potential) {
      case 'High': return 3;
      case 'Medium': return 2;
      case 'Low': return 1;
      default: return 0;
    }
  }

  // ===========================================================================================
  // Paging
  // ===========================================================================================

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalCount() / this.pageSize())));

  /** First row number on this page - "Showing 13-24 of 248". */
  protected readonly rangeStart = computed(() =>
    this.totalCount() === 0 ? 0 : (this.pageIndex() - 1) * this.pageSize() + 1,
  );

  /** Last row number on this page (source narrows the page, so it counts the rows shown). */
  protected readonly rangeEnd = computed(() =>
    Math.min(this.totalCount(), this.rangeStart() + Math.max(0, this.filteredLeads().length - 1)),
  );

  /** Up to five page numbers around the current one; the pager adds first / last with a gap. */
  protected readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.pageIndex();
    const from = Math.max(1, Math.min(current - 2, total - 4));
    const to = Math.min(total, from + 4);
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  });

  protected goToPage(page: number): void {
    const next = Math.min(Math.max(1, page), this.totalPages());
    if (next === this.pageIndex()) return;
    this.pageIndex.set(next);
    this.load();
  }

  protected setPageSize(size: number): void {
    if (!size || size === this.pageSize()) return;
    this.pageSize.set(size);
    this.pageIndex.set(1);
    this.load();
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  // ===========================================================================================
  // Filter controls. Each one reloads, because each one is a server filter.
  // ===========================================================================================

  protected selectSavedView(view: string): void {
    this.savedView.set(view);
    this.pageIndex.set(1);
    this.clearAdvancedFilters();
    this.load();
  }

  protected selectPipelineStage(key: string): void {
    const stage = this.pipeline().find((p) => p.key === key);
    if (!stage) {
      return;
    }
    this.stageFilter.set(stage.key);
    this.savedView.set('All Leads');
    this.pageIndex.set(1);
    this.load();
  }

  protected removeFilterChip(key: string): void {
    switch (key) {
      case 'view':
        this.savedView.set('All Leads');
        break;
      case 'search':
        this.searchTerm.set('');
        break;
      case 'stage':
        this.stageFilter.set('');
        break;
      case 'temperature':
        this.temperatureFilter.set('');
        break;
      case 'potential':
        this.potentialFilter.set('');
        break;
      case 'source':
        this.sourceFilter.set('');
        break;
      case 'owner':
        this.ownerFilter.set('');
        break;
    }
    this.pageIndex.set(1);
    this.load();
  }

  protected clearAdvancedFilters(): void {
    this.optionSearch.set({});
    this.stageFilter.set('');
    this.temperatureFilter.set('');
    this.potentialFilter.set('');
    this.sourceFilter.set('');
    this.ownerFilter.set('');
  }

  protected clearAllFilters(): void {
    this.savedView.set('All Leads');
    this.pageIndex.set(1);
    this.searchTerm.set('');
    this.clearAdvancedFilters();
    this.load();
  }

  protected applyFilters(): void {
    this.showFilters.set(false);
    this.pageIndex.set(1);
    this.load();
  }

  protected toggleFilters(): void {
    this.showFilters.update((v) => !v);
  }

  // ===========================================================================================
  // Selection
  // ===========================================================================================

  protected toggleSelectAll(): void {
    const ids = this.filteredLeads().map((l) => l.id);
    this.selectedIds.set(this.allSelected() ? new Set() : new Set(ids));
  }

  protected toggleSelect(id: string): void {
    const next = new Set(this.selectedIds());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.selectedIds.set(next);
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  // ===========================================================================================
  // Row actions - the document's Action-to-Destination matrix
  // ===========================================================================================

  protected previewLead(lead: LeadItem): void {
    this.selectedLead.set(lead);
  }

  protected isPreviewed(lead: LeadItem): boolean {
    return this.selectedLead()?.id === lead.id;
  }

  protected closePreview(): void {
    this.selectedLead.set(null);
  }

  /** Assign - "available only for an unassigned lead; opens the Assignment Board". */
  protected onAssign(lead: LeadItem): void {
    this.router.navigate(['/app/fundraising/relationships/assignment-board'], {
      queryParams: { leadId: lead.id },
    });
  }

  /** Communicate - "opens the selected lead's Communication Timeline". */
  protected onCommunicate(lead: LeadItem): void {
    this.router.navigate(['/app/fundraising/relationships/communication-timeline'], {
      queryParams: { leadId: lead.id },
    });
  }

  /** Schedule Follow-Up - "opens the Follow-Up Planner". */
  protected onSchedule(lead: LeadItem): void {
    this.router.navigate(['/app/don/follow-up-planner'], {
      queryParams: { leadId: lead.id, mode: 'create' },
    });
  }

  /** Open Timeline - the same destination as Communicate, per the document. */
  protected onTimeline(lead: LeadItem): void {
    this.onCommunicate(lead);
  }

  protected bulkAssign(): void {
    if (this.selectionCount() === 0) {
      return;
    }
    this.router.navigate(['/app/fundraising/relationships/assignment-board'], {
      queryParams: {
        leadIds: this.selectedRows()
          .map((lead) => lead.id)
          .join(','),
      },
    });
  }

  protected createLead(): void {
    this.router.navigate(['/app/fundraising/relationships/lead-capture']);
  }

  // ===========================================================================================
  // Export
  // ===========================================================================================

  /**
   * Export - the document's shared function.
   *
   * IT EXPORTS WHAT IS ON SCREEN. The server has its own donor export endpoint for a full
   * extract; this is the filtered view the person is looking at, which is what the control
   * beside the grid means.
   */
  protected exportLeads(): void {
    this.exportRows(this.filteredLeads());
  }

  protected bulkExport(): void {
    if (this.selectionCount() === 0) {
      return;
    }
    this.exportRows(this.filteredLeads().filter((lead) => this.selectedIds().has(lead.id)));
  }

  private exportRows(rows: readonly LeadItem[]): void {
    const headers = [
      'Lead ID',
      'Name',
      'Mobile',
      'Email',
      'Source',
      'Campaign',
      'Stage',
      'Temperature',
      'Donation Potential',
      'Owner',
      'Next Follow-Up',
    ];
    const lines = rows.map((lead) =>
      [
        lead.reference,
        lead.name,
        lead.mobile,
        lead.email,
        lead.source,
        lead.campaign,
        lead.stage,
        lead.temperature,
        lead.donationPotential,
        lead.owner,
        lead.nextFollowUp,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    );

    const blob = new Blob([[headers.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lead-work-queue.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // ===========================================================================================
  // Bulk qualification - REMOVED
  //
  // The bulk bar used to carry "Update Temperature" and "Update Donation Potential", and neither
  // appears anywhere in the Donors and Leads workflow document: its Lead Work Queue offers
  // Preview, Communicate and Assign, and its only bulk operation is Bulk Assign on the Assignment
  // Board. Both buttons also had no endpoint behind them - `QualifyLeadRequest` carries
  // qualification notes and a next action, not a temperature - so they set a local `success`
  // banner and changed nothing. Selection now serves Assign and Export, which the document does
  // describe.
  // ===========================================================================================

  // ===========================================================================================
  // Presentation helpers
  // ===========================================================================================

  protected refresh(): void {
    this.load();
  }

  protected dismissBanner(): void {
    this.uiState.set(this.leads().length === 0 ? 'empty' : 'ready');
  }

  protected async copyValue(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copiedField.set(label);
      setTimeout(() => {
        if (this.copiedField() === label) {
          this.copiedField.set(null);
        }
      }, 1500);
    } catch {
      this.copiedField.set(null);
    }
  }

  protected healthClass(score: number): string {
    if (score >= 80) return 'lq-health-high';
    if (score >= 55) return 'lq-health-mid';
    return 'lq-health-low';
  }

  protected displayValue(value: string | null | undefined): string {
    return value && value.trim().length > 0 ? value : '-';
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

  private formatDateTime(value: string | null): string {
    if (!value) {
      return '';
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? ''
      : parsed.toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  }
}
