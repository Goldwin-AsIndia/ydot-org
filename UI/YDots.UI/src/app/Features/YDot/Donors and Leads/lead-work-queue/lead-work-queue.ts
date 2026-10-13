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
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime, Subject, Subscription } from 'rxjs';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';
import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
import {
  DonLookupItem,
  LeadListItem,
  LeadWorkQueueFilter,
  LeadWorkQueueResponse,
  QueueView,
} from '../../../../Shared/models/donor-contract.model';

export type UiState = 'ready' | 'loading' | 'success' | 'error' | 'empty';

/** The owner filter's "nobody" choice - sent to the server as assignmentState=Unassigned. */
const UNASSIGNED_OWNER = '__unassigned__';

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
  /** Somebody owns the lead. Read off the owner's id, not off the word shown for nobody. */
  readonly hasOwner: boolean;
  readonly lastActivity: string;
  /** The next step recorded on the lead - by whoever planned it, not by this screen. */
  readonly nextAction: string;
  /** The lead's campaign by id, for the donation link. */
  readonly campaignId: string;
  readonly nextFollowUp: string;
  readonly nextDue: string | null;
  readonly healthScore: number;
  /** The server's word for the score: Healthy, Needs attention or At risk. */
  readonly healthBand: string;
  readonly lastContactOutcome: string;
  readonly language: string;
  readonly masked: boolean;
  readonly converted: boolean;
  readonly donorId: string | null;
  readonly version: number;
  readonly permittedActions: readonly string[];
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
 * THE TABS ACROSS THE TOP ARE THE SERVER'S VIEWS - its `views`, each with its words and its
 * scope-wide count. The screen used to keep seven names of its own and translate each into query
 * fields; it now sends the view's value back and the server applies the rule it counted by, so the
 * count on a tab and the rows under it cannot disagree.
 */
const ALL_VIEW = 'all';

/** The icon each view is drawn with - presentation only; a view this does not know gets a list icon. */
const VIEW_GLYPHS: Readonly<Record<string, string>> = {
  all: 'ri-stack-line',
  unassigned: 'ri-user-unfollow-line',
  assigned: 'ri-user-follow-line',
  hot: 'ri-fire-line',
  'high-potential': 'ri-vip-diamond-line',
  recent: 'ri-time-line',
  converted: 'ri-hand-heart-line',
};

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
  imports: [RowsPerPage, CommonModule, FormsModule],
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
        options: options.sources,
      },
      {
        key: 'owner',
        label: 'Owner',
        value: this.ownerFilter(),
        options: this.ownerOptions(),
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
    // An explicit choice that contradicts the open view supersedes it - the SERVER decides that
    // and answers the view in effect as `activeView`, so the tab follows the rows.
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

    // A CHOICE IN THE PANEL TAKES EFFECT AT ONCE. It used to wait for "Apply filters", so choosing
    // a temperature or an owner appeared to do nothing until a second button was found and pressed.
    this.pageIndex.set(1);
    this.load();
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
  protected readonly pipeline = signal<readonly PipelineStage[]>([]);

  /** The lanes - the server's views with their words and counts. Empty until it answers. */
  protected readonly savedViews = signal<readonly QueueView[]>([]);
  protected readonly filterOptions = signal<{
    readonly stages: readonly DonLookupItem[];
    readonly temperatures: readonly DonLookupItem[];
    readonly potentials: readonly DonLookupItem[];
    readonly sources: readonly DonLookupItem[];
  }>({ stages: [], temperatures: [], potentials: [], sources: [] });
  protected readonly ownerOptions = signal<readonly DonLookupItem[]>([]);

  // ===========================================================================================
  // Filter state. Every one of these re-queries the server.
  // ===========================================================================================
  protected readonly savedView = signal<string>(ALL_VIEW);
  protected readonly searchTerm = signal('');
  protected readonly stageFilter = signal<string>('');
  protected readonly temperatureFilter = signal<string>('');
  protected readonly potentialFilter = signal<string>('');
  protected readonly sourceFilter = signal<string>('');
  protected readonly ownerFilter = signal<string>('');
  protected readonly showFilters = signal(false);

  /**
   * How the queue is ordered - the server's orders, and THE SERVER ORDERS IT, because the grid is
   * paged. The first is the work-queue order (next contact due soonest), which puts a lead
   * captured a moment ago at the very end - so "Newest first" is the way to find it.
   */
  protected readonly sortOptions = signal<readonly DonLookupItem[]>([]);

  /** The chosen order; empty is the server's default (its first option). */
  protected readonly sortOrder = signal<string>('');

  protected setSortOrder(value: string): void {
    this.sortOrder.set(value);
    this.pageIndex.set(1);
    this.load();
  }

  // Paging. The server pages the queue; these are the page asked for and its size.
  protected readonly pageSizes = [10, 20, 30, 40, 50] as const;
  protected readonly pageIndex = signal(1);
  protected readonly pageSize = signal(10);

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
    // so the row it opens is the row that was actually saved. The newest lead has no contact
    // planned, so in the default order it would sit on the last page: show newest first.
    const createdLeadId = this.route.snapshot.queryParamMap.get('createdLeadId');
    if (createdLeadId) {
      this.openAfterLoad = createdLeadId;
      this.newestFirstOnce = true;
    }
    this.load();
  }

  private openAfterLoad: string | null = null;

  /** Back from Lead Capture: show the newest first, once, so the lead just saved is on page one. */
  private newestFirstOnce = false;

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
      source: this.sourceFilter() || null,
    };

    const owner = this.ownerFilter();
    if (owner === UNASSIGNED_OWNER) {
      filter.assignmentState = 'Unassigned';
    } else if (owner) {
      filter.ownerUserId = owner;
    }

    // The chosen order, as the server names it. Back from Lead Capture: newest first, once.
    const sort = this.newestFirstOnce ? 'newest' : this.sortOrder();
    if (sort) {
      filter.sort = sort;
    }

    // THE VIEW BY NAME. The server turns it into the filter it stands for - the Recently Added
    // window, the Converted rows the queue otherwise hides, and so on.
    if (this.savedView() !== ALL_VIEW) {
      filter.view = this.savedView();
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
    // Before the rows: each row labels its last outcome from this list.
    this.outcomeLabels = new Map(
      (response.contactOutcomeOptions ?? []).map((option) => [option.value, option.label]),
    );
    this.potentialOrder = (response.donationPotentialOptions ?? []).map((option) => option.value);

    this.leads.set(response.leads.items.map((row) => this.toRow(row)));
    this.totalCount.set(response.leads.totalCount);
    const visibleIds = new Set(this.filteredLeads().map((lead) => lead.id));
    this.selectedIds.update((ids) => new Set([...ids].filter((id) => visibleIds.has(id))));

    this.screen.update((current) => ({
      ...current,
      scope: response.activeScope,
      lastRefresh: this.formatDateTime(response.lastRefreshedAtUtc),
    }));

    // THE LANES ARE THE SERVER'S VIEWS, counted over the whole scope - not the page, which is a
    // hundred rows at most. The view in effect is the server's word too (`activeView`): an
    // explicit filter that contradicts the open lane supersedes it.
    this.savedViews.set(response.views ?? []);
    this.savedView.set(response.activeView || ALL_VIEW);
    this.sortOptions.set(response.sortOptions ?? []);
    if (this.newestFirstOnce) {
      this.newestFirstOnce = false;
      this.sortOrder.set('newest');
    } else if (!this.sortOrder()) {
      // The picker starts on the server's first order, which is also its default.
      this.sortOrder.set(response.sortOptions?.[0]?.value ?? '');
    }

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

      // EVERY SOURCE IN SCOPE, from the server. The list was built from the page of rows on
      // screen, so a source whose leads were all on page two could not be chosen at all.
      sources: response.sourceOptions ?? [],
    });

    // "Unassigned" is the server's Unassigned view word, offered in the owner list as the way to
    // ask for leads nobody owns; the people are the server's owner options.
    const unassigned = (response.views ?? []).find((view) => view.value === 'unassigned');
    this.ownerOptions.set([
      ...(unassigned ? [{ value: UNASSIGNED_OWNER, label: unassigned.label }] : []),
      ...(response.ownerOptions ?? []),
    ]);

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

  /** Outcome value to the server's label for it - "CallbackRequested" to "Requested callback". */
  private outcomeLabels = new Map<string, string>();

  /** The donation potentials in the server's order, lowest first - the bars' scale. */
  private potentialOrder: readonly string[] = [];

  private toRow(row: LeadListItem): LeadItem {
    const outcome = this.outcomeLabels.get(row.lastContactOutcome) ?? row.lastContactOutcome;

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
      hasOwner: !!row.ownerUserId,
      lastActivity: outcome,
      nextAction: row.nextAction ?? '',
      campaignId: row.campaignId,
      nextFollowUp: this.formatDate(row.nextActionDueUtc),
      nextDue: row.nextActionDueUtc,
      healthScore: row.healthScore,
      healthBand: row.healthBand,
      lastContactOutcome: outcome,
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

      // ITS OWN VERB, for `don.donors.export`. It was read off Filter/Open, which everybody who
      // can see the queue holds - so the button showed for people the export would refuse.
      export: has('Export'),
    };
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
      tokens.push({ key: 'source', label: `Source: ${label(this.filterOptions().sources, this.sourceFilter())}` });
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
    () => this.savedView() !== ALL_VIEW || !!this.searchTerm().trim() || this.panelFilterCount() > 0,
  );

  /**
   * The rows on screen - the server's page, exactly.
   *
   * NOTHING IS FILTERED HERE ANY MORE. Lead source was the last filter applied in the browser,
   * over one page of a paged set; it is a query parameter now like the rest.
   */
  protected readonly filteredLeads = computed(() => this.leads());

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

  /**
   * One lane per server view: its words, its hint and its scope-wide count.
   *
   * THE LANES ARE BOTH THE SUMMARY AND THE TABS. The words and the counts are the server's; only
   * the icon is chosen here.
   */
  protected readonly lanes = computed(() =>
    this.savedViews().map((view) => ({
      view: view.value,
      label: view.label,
      hint: view.description,
      glyph: VIEW_GLYPHS[view.value] ?? 'ri-list-check',
      value: view.count as number | null | undefined,
    })),
  );

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

  /**
   * The next step recorded on the lead.
   *
   * THE SERVER'S, NOT A LOOK-UP BY STAGE. This used to map New, Assigned, Contacted and Engaged
   * to four fixed sentences, so every Assigned lead read "Hold a qualification call" whatever
   * had actually been planned for it - and "Engaged" is not a stage the API has. The lead carries
   * its own next action, set when a follow-up is scheduled or a conversation is logged.
   */
  protected nextStep(lead: LeadItem): string {
    if (lead.converted) return 'This lead became a donor - continue on Donor 360.';
    return lead.nextAction || 'No next step has been planned yet.';
  }

  /**
   * The donation link for a lead: the public form, bound to the lead's campaign and carrying the
   * lead itself.
   *
   * THE LEAD ON THE LINK IS WHAT MAKES THE GIFT A CONVERSION - the payments service marks this
   * lead converted when the donation lands and the new donor keeps this lead's owner. The host is
   * the organisation's own, which is also how the public form knows whose campaign it is.
   */
  protected donationLink(lead: LeadItem): string {
    const origin = this.document.defaultView?.location.origin ?? '';
    return `${origin}/auth/donor-form?campaign=${lead.campaignId}&lead=${lead.id}`;
  }

  /** How many of the three bars a potential fills: its place in the server's order, lowest first. */
  protected potentialLevel(potential: string): number {
    const index = this.potentialOrder.indexOf(potential);
    return index < 0 ? 0 : Math.min(3, index + 1);
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
    this.savedView.set(ALL_VIEW);
    this.pageIndex.set(1);
    this.load();
  }

  protected removeFilterChip(key: string): void {
    switch (key) {
      case 'view':
        this.savedView.set(ALL_VIEW);
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
    this.savedView.set(ALL_VIEW);
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

  /**
   * Assign or Reassign - both open the Assignment Board on this lead, which decides which of the
   * two it is from whether the lead has an owner. A converted lead has left the queue; its donor
   * is reassigned from the board's Donors view instead.
   */
  protected canRoute(lead: LeadItem): boolean {
    return this.permissions().assign && !lead.converted;
  }

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
  // Closing a lead
  // ===========================================================================================

  /** What the last close did, shown above the queue. */
  protected readonly closeNotice = signal<{ readonly text: string; readonly failed: boolean } | null>(null);
  protected readonly closing = signal(false);

  /**
   * Whether this caller may close this lead.
   *
   * THE SERVER'S LIST FOR THIS ROW, which already accounts for the lead's stage and for who is
   * asking. Closing a lead is the Fundraising Manager's decision and the Organisation Admin's, so
   * a Fundraiser Executive's rows do not carry it. The service has always had the endpoint; no
   * screen had a way to call it.
   */
  protected canClose(lead: LeadItem): boolean {
    return !lead.converted && lead.permittedActions.includes('Close');
  }

  /** Mark lost / Mark dormant - the same close, recorded with which of the two it was. */
  protected onCloseLead(lead: LeadItem, outcome: 'Lost' | 'Dormant'): void {
    if (!this.canClose(lead) || this.closing()) {
      return;
    }
    this.closing.set(true);

    this.api
      .closeLead(lead.id, {
        reason: `${outcome}: Marked ${outcome.toLowerCase()} from the Lead Work Queue.`,
        expectedVersion: lead.version,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closing.set(false);
          this.closePreview();
          this.closeNotice.set({
            text: `${lead.reference} was closed as ${outcome.toLowerCase()}.`,
            failed: false,
          });
          this.load();
        },
        // The drawer is modal and the notice sits behind it, so it closes either way.
        error: (error: unknown) => {
          this.closing.set(false);
          this.closePreview();
          this.closeNotice.set({
            text: apiErrorMessage(error, 'The lead could not be closed.'),
            failed: true,
          });
        },
      });
  }

  // ===========================================================================================
  // Export
  // ===========================================================================================

  protected readonly exporting = signal(false);

  /** An export that failed, shown above the queue without discarding the rows already loaded. */
  protected readonly exportError = signal('');

  /**
   * Export Leads - the whole filtered set, written by the server.
   *
   * IT USED TO BUILD A FILE IN THE BROWSER FROM THE PAGE ON SCREEN: ten rows of a queue of sixty,
   * with no permission check and no record that anybody had taken a copy. The server writes every
   * lead the current view and filters match, masks the contact columns by the caller's
   * permission, requires `don.donors.export`, and logs the export.
   */
  protected exportLeads(): void {
    this.download({ ...this.buildFilter() });
  }

  /** Export selected - the same file, narrowed to the ticked leads. */
  protected bulkExport(): void {
    if (this.selectionCount() === 0) {
      return;
    }
    this.download({
      ...this.buildFilter(),
      leadIds: this.selectedRows().map((lead) => lead.id).join(','),
    });
  }

  private download(filter: LeadWorkQueueFilter): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set('');

    this.api
      .exportLeads(filter)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ blob, fileName }) => {
          const url = URL.createObjectURL(blob);
          const link = this.document.createElement('a');
          link.href = url;
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: (error: unknown) => {
          this.exporting.set(false);
          this.exportError.set(apiErrorMessage(error, 'The leads could not be exported.'));
        },
      });
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

  /**
   * The ring's colour, from the server's reading of the score.
   *
   * THE SCREEN DREW ITS OWN LINES - 80 and 55 here, 70 and 35 on My Leads - so the same lead was
   * green on one screen and amber on the other. The band is decided once, on the server.
   */
  protected healthClass(band: string): string {
    switch (band) {
      case 'Healthy': return 'lq-health-high';
      case 'Needs attention': return 'lq-health-mid';
      default: return 'lq-health-low';
    }
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
