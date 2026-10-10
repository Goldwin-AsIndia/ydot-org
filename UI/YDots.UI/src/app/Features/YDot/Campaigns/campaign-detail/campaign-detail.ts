import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, map } from 'rxjs';

import {
  UiState,
  CampaignStatus,
  DetailTab,
  HistoryRow,
  ActivityItem,
} from '../../../../Shared/models/campaign.model';
import { CampaignStoreService } from '../../../../Shared/services/campaign-store.service';
import { CurrentUserService } from '../../../../Shared/services/current-user.service';
import { TrackingAssetStoreService } from '../../../../Shared/services/tracking-asset-store.service';
import { BudgetTargetStoreService } from '../../../../Shared/services/budget-target-store.service';
import { ToastService } from '../../../../Shared/services/toast.service';
import { CloseRequestStoreService } from '../../../../Shared/services/close-request-store.service';
import { PeopleDirectoryService } from '../../../../Shared/services/people-directory.service';
import { CampaignApiService } from '../../../../Service/campaign-api.service';
import { DonorApiService } from '../../../../Service/donor-api.service';
import { PaymentApiService } from '../../../../Service/payment-api.service';
import {
  AttributionListItem,
  AttributionSummary,
  CampaignHistoryEntry,
} from '../../../../Shared/models/campaign-contract.model';
import { LeadListItem } from '../../../../Shared/models/donor-contract.model';
import { fetchAllPages } from '../../../../Shared/services/paging';
import { DonationListItem, MoneyResponse } from '../../../../Shared/models/payment.model';
import { apiErrorMessage } from '../../../../Shared/models/api-response.model';

/** One named lifecycle transition offered from a given state. */
interface LifecycleTransition {
  readonly key: string;
  readonly label: string;
  readonly target: CampaignStatus;

  /**
   * The server-side action name this transition corresponds to, as it appears in the campaign's
   * `permittedActions`. A transition whose action is not in that list is not offered.
   */
  readonly requires?: string;
}

/**
 * The primary lifecycle transition offered from each state — the verb the header
 * button runs: Draft→Submit, Submitted→Approve, Approved→Schedule,
 * Scheduled→Activate, Active→Pause, Paused→Resume and Closing→Complete closure.
 * Together these make the state machine fully traversable.
 */
const PRIMARY_TRANSITION: Partial<Record<CampaignStatus, LifecycleTransition>> = {
  // SUBMIT NEEDS THE SERVER'S WORD LIKE EVERY OTHER TRANSITION. It carried no `requires`, and a
  // transition without one is withheld - so the header never offered Submit on a Draft to anybody,
  // the Campaign Executive whose step it is included.
  Draft: { key: 'primary', label: 'Submit', target: 'Submitted', requires: 'Submit' },

  // APPROVAL LANDS ON SCHEDULED. The server moves a Submitted campaign to Scheduled while its
  // start date is still ahead, and to Approved only when that date has already passed. Naming
  // the target `Approved` here made the confirm dialog promise a status the campaign was not
  // going to end up in.
  Submitted: { key: 'primary', label: 'Approve', target: 'Scheduled', requires: 'Approve' },

  // APPROVED GOES TO ACTIVE, NOT TO SCHEDULED, and that is the shape of the server's state
  // machine rather than a preference. `Scheduled` is where an approved campaign waits for its own
  // start date — there is no separate "schedule" step for anybody to run. This offered one: it
  // was labelled Schedule, it routed to the approve endpoint, and approve refuses anything that
  // is not Submitted, so pressing it on an Approved campaign answered 409 every time.
  Approved: { key: 'primary', label: 'Activate', target: 'Active', requires: 'Activate' },
  Scheduled: { key: 'primary', label: 'Activate', target: 'Active', requires: 'Activate' },
  Active: { key: 'primary', label: 'Pause', target: 'Paused', requires: 'Pause' },
  Paused: { key: 'primary', label: 'Resume', target: 'Active', requires: 'Resume' },
};
const SECONDARY_TRANSITIONS: Partial<Record<CampaignStatus, readonly LifecycleTransition[]>> = {
  // REJECT IS THE OTHER ANSWER TO A SUBMITTED CAMPAIGN: back to Draft, with the reason. Offered in
  // the same confirm dialog as Approve, to whoever the server lists it for.
  Submitted: [{ key: 'reject', label: 'Reject', target: 'Draft', requires: 'Reject' }],
  Scheduled: [{ key: 'pause', label: 'Pause', target: 'Paused', requires: 'Pause' }],
  Active: [{ key: 'close', label: 'Close', target: 'Closing', requires: 'RequestClose' }],
  Paused: [{ key: 'close', label: 'Close', target: 'Closing', requires: 'RequestClose' }],
};
/**
 * States from which Cancel used to be offered.
 *
 * EMPTY, AND THE CONSTANT IS KEPT TO SAY SO. The CAM service has a `Cancelled` status on its enum
 * and NO endpoint that ever assigns it - nothing in the module can put a campaign there. Offering
 * "Cancel campaign" was therefore offering an action with nowhere to go: it routed into the same
 * confirm dialog as the real transitions and then had no call to make. Deleting a draft, or
 * requesting a close on a live campaign, are the two real ways to end a campaign early.
 */
const CANCELLABLE_STATES: readonly CampaignStatus[] = [];
const CANCEL_TRANSITION: LifecycleTransition = {
  key: 'cancel', label: 'Cancel campaign', target: 'Cancelled',
};

/**
 * States whose lifecycle primary action is a Pause / Resume / Close operation.
 * For these the header button is a doorway to the dedicated Pause / Resume /
 * Close screen rather than resolving in place — that screen is the only one that
 * runs Activate / Pause / Resume / Request close / Approve close. The earlier
 * transitions (Draft→Submit … Closing→Complete) keep their in-place confirm dialog.
 *
 * `Scheduled` is included so activation (Scheduled → Active) also happens on that
 * screen; the detail page never opens an in-place activation dialog.
 */
const LIFECYCLE_PAGE_STATES: readonly CampaignStatus[] = ['Scheduled', 'Active', 'Paused'];

/** The keys of the lifecycle actions shown in the header. */
type LifecycleActionKey =
  | 'activate' | 'pause' | 'resume' | 'requestClose' | 'approveClose' | 'rejectClose' | 'reject';

/**
 * Campaign detail.
 *
 * A read-only view of a single campaign — summary, targets, budget, tracking and
 * payments — plus the lifecycle actions available from its current state.
 */
/**
 * One entry on the campaign calendar: a dot in the month grid.
 *
 * `kind` picks the dot's icon and colour from the calendar's existing set: `launch` and `email`
 * for the campaign's own start and end, `report` for a lifecycle step, `website` for a tracking
 * asset and `donor` for the day's donations.
 */
interface CalEvent {
  label: string;
  kind: string;
}

/** A row of the tabbed table, with the calendar day it belongs to. */
type DatedRow = HistoryRow & { dayKey?: string | null };

@Component({
  selector: 'app-campaign-detail',
  imports: [CommonModule, FormsModule],
  templateUrl: './campaign-detail.html',
  styleUrl: './campaign-detail.css',
})
export class CampaignDetailComponent {
  /**
   * Reads the campaign reference passed by the register's Open action and pulls
   * the record from the single shared CampaignStoreService. Falls back to a
   * built-in mock when opened directly without a reference.
   */
  private readonly campaignApi = inject(CampaignApiService);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(CampaignStoreService);
  private readonly currentUser = inject(CurrentUserService);
  private readonly trackingStore = inject(TrackingAssetStoreService);
  private readonly budgetStore = inject(BudgetTargetStoreService);
  private readonly toast = inject(ToastService);
  private readonly closeStore = inject(CloseRequestStoreService);

  /** The payments service. This campaign's Payments tab reads its donations from it. */
  private readonly payments = inject(PaymentApiService);

  /** The donors service. The Leads tab reads this campaign's leads from it, for those who may. */
  private readonly donors = inject(DonorApiService);
  /**
   * Owner names, resolved from IAM rather than from a map in this file.
   *
   * THE FOUR NAMES HERE WERE INVENTED, and the fallbacks below made that invisible: an unknown
   * owner reference rendered as 'Arun Kumar' and an absent one as 'USR-0114'. Somebody reading
   * this screen to find out who is accountable for a campaign got a confident answer that was not
   * connected to anything.
   */
  private readonly people = inject(PeopleDirectoryService);
  /**
   * The campaign code from the URL (?ref=...).
   *
   * READ FROM THE URL, NOT FROM THE STORE. On a refresh or a deep link the campaign list has not
   * loaded yet when this screen is built, so a store lookup finds nothing - and the reference used
   * to fall back to the built-in demo campaign, which is how a refreshed "Hope Foundation Annual
   * Giving" page turned into "Educate a Child 2025". The URL is the one thing that survives a
   * refresh, so it decides which campaign this is; the record fills in when the list arrives.
   */
  private readonly routeRef = this.route.snapshot.queryParamMap.get('ref')?.trim() || null;
  private readonly initialRecord = this.store.get(this.routeRef ?? '');

  constructor() {
    // THE DETAIL RECORD, NOT JUST THE REGISTER ROW. Everything on this screen below the header -
    // purpose, currency, channels, location, the publication wording, the activation mode - lives
    // on the detail response, and so does `permittedActions`, which every lifecycle button is
    // drawn from. Without this call the screen renders a register row and fills the gaps with
    // dashes.
    this.store.loadDetail(this.reference);

    // THE HISTORY WAITS FOR THE CAMPAIGN'S ID.
    //
    // `loadActivity` needs `store.apiId(reference)`, and on a cold load - a deep link, a refresh,
    // anything that is not a click through from the register - the store has not fetched the
    // campaign list yet, so that map is empty. The call used to be made once here, found no id,
    // set the trail to an empty array and never asked again: the Related history tab was blank
    // for exactly the visits where somebody would go looking at it.
    let historyLoadedFor: string | null = null;

    // NO CAMPAIGN IN THE ADDRESS IS "NOTHING SELECTED", not a demonstration campaign. This screen
    // used to fall back to an invented one - a name, a purpose, dates and two tracking assets
    // that exist nowhere - whenever it was opened without a reference.
    if (!this.routeRef) {
      this.uiState.set('empty');
    }

    effect(() => {
      // A reference that matches nothing once the register has answered is also "nothing here".
      if (this.routeRef && !this.store.isLoading() && !this.liveRecord() && !this.store.loadError()) {
        untracked(() => this.uiState.set('empty'));
      } else if (this.liveRecord() && untracked(this.uiState) === 'empty') {
        untracked(() => this.uiState.set('ready'));
      }
    });

    effect(() => {
      // `apiId` reads a plain Map, which no effect can track; reading the record makes this
      // re-run when the campaign list lands, which is also when the id becomes known.
      this.liveRecord();
      const campaignId = this.store.apiId(this.reference);

      if (!campaignId || historyLoadedFor === campaignId) {
        return;
      }

      historyLoadedFor = campaignId;
      untracked(() => {
        // On a cold load the constructor's loadDetail / donations calls found no id and did
        // nothing; now that the list has arrived, fetch this campaign's detail and donations.
        this.store.loadDetail(this.reference);
        this.loadDonations();
        this.loadActivity();
        this.loadAttribution();
        this.loadLeads();
        this.lastRefresh.set(this.nowLabel());
      });
    });

    // Donations-in-scope is modelled as a backend fetch: stamp a freshly-fetched time on load,
    // the same as the manual refresh action does.
    this.refreshDonationsScope();
  }

  // ================= Task header =================
  /** Campaign reference — server-derived, immutable in this view. */
  protected readonly reference = this.routeRef ?? '';
  /**
   * Live re-read of this campaign's record from the shared store on every access
   * NOT a one-time snapshot — so a change made on another page (Wizard edit, Operate
   * on this page, etc.) is reflected here without a reload.
   */
  private readonly liveRecord = computed(() => this.store.get(this.reference));
  /** Campaign name — read-only. */
  protected readonly campaignName = computed(
    () => this.liveRecord()?.name ?? (this.routeRef && this.uiState() !== 'empty' ? 'Loading campaign…' : 'No campaign selected'),
  );

  /** Whether the campaign's record has arrived. The status chip waits for it rather than guessing. */
  protected readonly hasRecord = computed(() => !!this.liveRecord());
  /**
   * Status — server-derived current state, READ LIVE FROM THE RECORD.
   *
   * IT WAS A LOCAL SIGNAL SEEDED ONCE AT CONSTRUCTION, and nothing that changed the campaign's
   * state afterwards reached it except this page's own confirm dialog, which set it by hand. So a
   * campaign activated on the Manage lifecycle panel kept its old badge - the panel reported
   * "state Active" and the pill an inch above it went on saying SCHEDULED - and every lifecycle
   * button on the header, all of which are chosen by status, went on offering the moves for the
   * state the campaign had been in when the page opened.
   */
  protected readonly status = computed<CampaignStatus>(
    // 'Draft' IS NEVER SHOWN FOR A CAMPAIGN THAT HAS NOT LOADED: the chip is drawn only once the
    // record is here (`hasRecord`), and no lifecycle button exists without its permitted actions.
    () => this.liveRecord()?.status ?? this.initialRecord?.status ?? 'Draft',
  );
  /** Owner — read-only. */
  protected readonly owner = computed(() => {
    const rec = this.liveRecord();

    // 'Unassigned' rather than a name. A campaign whose owner has not loaded, or which has no
    // owner at all, must not read as one belonging to a particular person.
    return rec ? this.people.name(rec.ownerReference) : 'Unassigned';
  });
  /**
   * Owner reference/id.
   *
   * NOT FOR DISPLAY. This is the API's Guid — it exists so the directory can be asked about the
   * person. The summary card used to print it verbatim between the owner's name and their role,
   * which put a 36-character identifier in the middle of a sentence a fundraiser reads.
   * `ownerCode()` is the one to show.
   */
  protected readonly ownerRef = computed(() => this.liveRecord()?.ownerReference ?? '');
  /** The owner's human reference — USR-00001 — or an empty string when it is not known. */
  protected readonly ownerCode = computed(() => this.people.get(this.ownerRef())?.code ?? '');
  /**
   * The owner's role.
   *
   * FROM THE DIRECTORY'S OWN CONTEXT - designation and unit - rather than from a table of mock
   * profiles. 'Campaign Owner' remains the fallback because that IS this person's role in relation
   * to this campaign, whatever their job title says.
   */
  protected readonly ownerRole = computed(
    () => this.people.get(this.ownerRef())?.context || 'Campaign Owner',
  );
  /**
   * The owner line as one string: name, then reference and role when either is known.
   *
   * Assembled here rather than in the template so the separators disappear along with the parts
   * they separate — a template that interpolates three values with two dots between them prints
   * "Rajat Sivan · · " when two of the three are empty.
   */
  protected readonly ownerLine = computed(() =>
    [this.ownersLabel(), this.ownerCode(), this.ownerRole()]
      .filter((part) => !!part && part !== '—')
      .join(' · '),
  );
  /** Every accountable owner's name — a campaign may have more than one (Wizard "+ Add owner"). */
  protected readonly ownersLabel = computed(() => {
    const rec = this.liveRecord();
    const refs = rec?.ownerReferences?.length ? rec.ownerReferences : rec ? [rec.ownerReference] : [];
    return refs.length ? refs.map((r) => this.people.name(r)).join(', ') : this.owner();
  });
  /** Freshness — when this screen last read the campaign from the server, in the viewer's time. */
  protected readonly lastRefresh = signal(this.nowLabel());
  private nowLabel(): string {
    return new Date().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    });
  }
  /** "Created" for a freshly created campaign with no content edits since; "Updated" once it has
   *  been edited (record.wasEdited) — never both fixed labels regardless of record state. */
  protected readonly createdOrUpdatedLabel = computed(() => (this.liveRecord()?.wasEdited ? 'Updated' : 'Created'));
  protected readonly createdOrUpdatedAt = computed(() => {
    const rec = this.liveRecord();
    if (!rec) return this.lastRefresh();
    const iso = rec.wasEdited ? rec.updatedAt ?? rec.createdAt : rec.createdAt;
    return iso ? this.formatDate(iso) : this.lastRefresh();
  });

  /**
   * What the server says THIS caller may do to THIS campaign.
   *
   * THE ONLY AUTHORITY FOR A LIFECYCLE BUTTON ON THIS SCREEN. Empty until the detail has loaded,
   * which is deliberate: showing nothing for a moment is honest, and showing a button that turns
   * out to be forbidden is not.
   */
  protected readonly permittedActions = computed(
    () => new Set(this.liveRecord()?.permittedActions ?? []),
  );

  protected readonly allows = (action: string): boolean => this.permittedActions().has(action);

  /**
   * Page-level permissions.
   *
   * NOTE WHAT IS NOT HERE ANY MORE: an `operate` flag computed as "holds ANY lifecycle
   * permission". That check is what put an <strong>Approve</strong> button in front of an
   * INITIATOR. Per-record lifecycle rights now come from `permittedActions` above. What stays
   * here is only what is genuinely a page-level capability, decided by permission alone.
   */
  protected readonly permissions = computed(() => ({
    view: this.currentUser.hasPermission('cam.campaigns.view'),
    export: this.currentUser.hasPermission('cam.campaigns.export'),
  }));
  protected readonly exportAllowed = computed(
    () => (this.allows('Export') || this.permissions().export) && this.uiState() !== 'no-access',
  );
  /** Edit is offered for a Draft, Submitted, Scheduled or Active campaign (the server decides) — opens the Campaign Wizard pre-filled with this record. */
  protected readonly canEdit = computed(() => this.allows('Edit') && this.uiState() !== 'no-access');
  /** Tooltip for the overview's edit icon — says why it is unavailable when it is. */
  protected readonly editHint = computed(() => {
    if (this.canEdit()) {
      return 'Edit campaign';
    }
    const status = this.status();
    return !['Draft', 'Submitted', 'Approved', 'Scheduled', 'Active'].includes(status)
      ? `Only a Draft, Submitted, Scheduled or Active campaign can be edited. This one is ${status}.`
      : 'You do not have permission to edit this campaign.';
  });
  protected openEdit(): void {
    if (!this.canEdit()) {
      return;
    }
    this.router.navigate(['/app/fundraising/campaigns/campaign-wizard'], { queryParams: { ref: this.reference } });
  }
  /** Delete draft is offered only for a Draft campaign with no downstream reference, to a permitted
   *  user — a permanent delete of an unused draft, distinct from the lifecycle Cancel. */
  protected readonly canDeleteDraft = computed(
    () =>
      this.allows('Delete') &&
      !this.liveRecord()?.hasDownstreamReference &&
      this.uiState() !== 'no-access',
  );

  // ================= Read-only fields =================
  /** Purpose — read-only. */
  protected readonly purpose = computed(() => this.liveRecord()?.purpose ?? '');
  /** Longer purpose text is cut in the overview card and opens in full from "Read more". */
  protected readonly purposeIsLong = computed(() => this.purpose().trim().length > 160);
  protected readonly purposePreview = computed(() => {
    const t = this.purpose().trim();
    return t.length > 160 ? `${t.slice(0, 160).trimEnd()}…` : t;
  });
  protected readonly purposeHtml = computed(() => {
    const esc = this.purpose().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<p>${esc}</p>`;
  });

  /** Date range — read-only. Empty until the record arrives; `formatDate` prints a dash for that. */
  protected readonly launchDate = computed(() => this.liveRecord()?.startDate || '');
  protected readonly endDate = computed(() => this.liveRecord()?.endDate || '');

  /** Target (entered on the wizard's first step) and what has actually been raised against it. */
  protected readonly targetAmount = computed(() => this.liveRecord()?.targetAmount ?? 0);
  protected readonly reconciledAmount = computed(() =>
    this.donationStats().reduce((sum, d) => sum + d.amount, 0),
  );
  protected readonly progressPercent = computed(() => {
    const target = this.targetAmount();
    return target > 0 ? Math.round((this.reconciledAmount() / target) * 100) : 0;
  });

  /** Targets — server-derived plan amount. */
  protected readonly targetsAmount = computed(() => this.targetAmount());

  /**
   * Budget summary — live from the shared BudgetTargetStoreService, not a page-local mock.
   * Reads ONLY each plan's current Approved version (`approvedForCampaign`), never
   * summing across Draft/Submitted/Superseded versions.
   */
  protected readonly budgetPlans = computed(() => this.budgetStore.approvedForCampaign(this.campaignName()));
  protected readonly budgetAmount = computed(() =>
    this.budgetPlans().reduce((sum, v) => sum + v.budgetAmount, 0),
  );
  /** Planned operating budget and fundraising target, formatted for the overview card. */
  protected readonly plannedBudgetLabel = computed(() => this.rupeeINR(this.budgetAmount()));
  protected readonly fundraisingTargetLabel = computed(() => this.rupeeINR(this.targetAmount()));
  /** Each approved allocation's share of the total budget. */
  protected budgetShare(planBudget: number): number {
    const total = this.budgetAmount();
    return total ? Math.round((planBudget / total) * 1000) / 10 : 0;
  }

  /**
   * Tracking assets — read-only. Read live from the single shared TrackingAssetStoreService,
   * so a Generate on the Tracking Asset Manager appears here immediately, without a refresh.
   */
  protected readonly trackingAssets = computed<
    readonly (HistoryRow & { createdOn?: string; usageCount?: number; dayKey?: string | null })[]
  >(() => {
    return this.trackingStore.forCampaign(this.reference).map((a) => ({
      primary: a.trackingReference,
      secondary: `${a.assetType} · ${a.channel}`,
      createdOn: a.activeFrom ? this.formatDate(a.activeFrom) : '—',
      dayKey: this.dayKeyOf(a.activeFrom),
      usageCount: a.usageCount,
      meta: `${a.assetStatus} · ${a.usageCount.toLocaleString('en-IN')} uses`,
    }));
  });

  /**
   * This campaign's donations — THE REAL ONES, from the payments service
   * (GET /donations?campaignId={id}), permission-checked and organisation-scoped server-side.
   * A campaign with no donations shows the empty state, which is the truth.
   */
  protected readonly donations = signal<readonly (HistoryRow & { dayKey?: string | null })[]>([]);
  protected readonly donationsCount = signal(0);
  protected readonly donationsLoading = signal(false);
  protected readonly donationsError = signal<string | null>(null);

  // ================= Campaign dashboard =================

  /** Every counted donation on the campaign — amount, date and donor — behind the header figures. */
  private readonly donationStats = signal<readonly { amount: number; at: string; donor: string }[]>([]);

  /** Each donor's first gift to this campaign, for the Donors tab. From the same payments read. */
  private readonly firstGifts = signal<readonly DatedRow[]>([]);

  private readonly donationSamples = signal<readonly { amount: number; currency: string; at: string }[]>([]);

  /** The trend chart's range — the dashboard dropdown. */
  protected readonly trendRange = signal<'6' | '12'>('12');
  protected readonly trendRanges: readonly { key: '6' | '12'; label: string }[] = [
    { key: '6', label: 'Last 6 months' },
    { key: '12', label: 'Last 12 months' },
  ];
  protected setTrendRange(key: '6' | '12'): void {
    this.trendRange.set(key);
  }

  /** "Donations received" — the total of the donations this screen has loaded. Null when none. */
  protected readonly donationsReceivedLabel = computed(() => {
    const samples = this.donationSamples();
    if (!samples.length) {
      return null;
    }
    const total = samples.reduce((sum, sample) => sum + (sample.amount || 0), 0);
    const currency = samples[0]?.currency || 'INR';
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(total);
    } catch {
      return total.toLocaleString('en-IN');
    }
  });

  /** Tracking assets on this campaign — the record carries the count the tab badge uses. */
  protected readonly assetsCountLabel = computed(() => {
    const count = this.liveRecord()?.trackingAssetCount;
    return count == null ? null : String(count);
  });

  /** The true number of payments the server reports for this campaign. Null when zero. */
  protected readonly paymentsCountLabel = computed(() => {
    const count = this.donationsCount();
    return count > 0 ? String(count) : null;
  });

  /** The recent-donations list's rows — the same payments read, kept as display fields. */
  protected readonly recentDonations = signal<
    readonly { name: string; initials: string; amount: string; when: string; key: string }[]
  >([]);

  /**
   * The trend series — one bucket per month over the chosen range, each holding the total
   * received that month. Buckets with nothing received stay at zero, which is the truth.
   */
  protected readonly trendSeries = computed(() => {
    const months = Number(this.trendRange());
    const now = new Date();
    const buckets: { key: string; label: string; value: number }[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${month.getFullYear()}-${month.getMonth()}`,
        label: month.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
        value: 0,
      });
    }
    const index = new Map(buckets.map((bucket, i) => [bucket.key, i]));
    for (const sample of this.donationSamples()) {
      const when = new Date(sample.at);
      if (Number.isNaN(when.getTime())) {
        continue;
      }
      const i = index.get(`${when.getFullYear()}-${when.getMonth()}`);
      if (i !== undefined) {
        buckets[i].value += sample.amount || 0;
      }
    }
    return buckets;
  });

  /** Y-axis ticks — five steps that always round the peak up to a whole multiple. */
  protected readonly trendTicks = computed(() => {
    const peak = Math.max(...this.trendSeries().map((bucket) => bucket.value), 0);
    const step = peak <= 0 ? 25 : Math.ceil(peak / 4 / 25) * 25;
    return [0, 1, 2, 3, 4].map((i) => i * step);
  });

  /** The channel chart's plot box — a compact 660×124 canvas with small inset margins. */
  private readonly trendView = { w: 660, h: 124, top: 10, right: 15, bottom: 14, left: 15 };

  private trendX(i: number, count: number): number {
    const { w, left, right } = this.trendView;
    return left + ((w - left - right) * i) / Math.max(1, count - 1);
  }
  /** The template plots grid lines directly, so this must be visible to it. */
  protected trendY(value: number): number {
    const { h, top, bottom } = this.trendView;
    const peak = this.trendTicks()[4] || 1;
    return h - bottom - ((h - top - bottom) * value) / peak;
  }

  /** The plotted points — chart-space x/y plus the label and figure each carries. */
  private readonly trendPoints = computed(() =>
    this.trendSeries().map((bucket, i) => ({
      x: this.trendX(i, this.trendSeries().length),
      y: this.trendY(bucket.value),
      label: bucket.label,
      value: bucket.value,
    })),
  );

  /**
   * A SMOOTH LINE THROUGH THE POINTS — monotone cubic (Fritsch–Carlson), not Catmull–Rom,
   * so the curve never dips below the baseline or overshoots a point.
   */
  private smoothPath(points: readonly { x: number; y: number }[]): string {
    const n = points.length;
    if (n === 0) {
      return '';
    }
    if (n === 1) {
      return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    }

    const dx: number[] = [];
    const slope: number[] = []; // secant slope between point i and i+1
    for (let i = 0; i < n - 1; i++) {
      dx[i] = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      slope[i] = dx[i] === 0 ? 0 : dy / dx[i];
    }

    // Tangent at each point: the average of its two adjacent secant slopes, flattened at any
    // local peak/valley (including a flat run) so the curve can't swing past it.
    const tangent: number[] = new Array(n).fill(0);
    tangent[0] = slope[0] ?? 0;
    tangent[n - 1] = slope[n - 2] ?? 0;
    for (let i = 1; i < n - 1; i++) {
      const s0 = slope[i - 1];
      const s1 = slope[i];
      tangent[i] = s0 === 0 || s1 === 0 || s0 * s1 < 0 ? 0 : (s0 + s1) / 2;
    }

    // Fritsch-Carlson limiter: clamp each segment's tangents so the cubic between any two
    // points can never overshoot either point's value.
    for (let i = 0; i < n - 1; i++) {
      if (slope[i] === 0) {
        tangent[i] = 0;
        tangent[i + 1] = 0;
        continue;
      }
      const a = tangent[i] / slope[i];
      const b = tangent[i + 1] / slope[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        const t = 3 / h;
        tangent[i] = t * a * slope[i];
        tangent[i + 1] = t * b * slope[i];
      }
    }

    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const c1x = p0.x + dx[i] / 3;
      const c1y = p0.y + tangent[i] * (dx[i] / 3);
      const c2x = p1.x - dx[i] / 3;
      const c2y = p1.y - tangent[i + 1] * (dx[i] / 3);
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
    }
    return d;
  }

  protected readonly trendPath = computed(() => this.smoothPath(this.trendPoints()));

  protected readonly trendAreaPath = computed(() => {
    const points = this.trendPoints();
    if (!points.length) {
      return '';
    }
    const first = points[0].x.toFixed(1);
    const last = points[points.length - 1].x.toFixed(1);
    const base = (this.trendView.h - this.trendView.bottom).toFixed(1);
    return `${this.trendPath()} L ${last} ${base} L ${first} ${base} Z`;
  });

  /** Each month as a plottable dot — the hover state highlights the one under the pointer. */
  protected readonly trendDots = computed(() => this.trendPoints());

  protected readonly trendLabels = computed(() => this.trendSeries().map((bucket) => bucket.label));

  /** A figure as a compact label — 1.2L rather than 120000 — for the axis and the tooltip. */
  protected compactValue(value: number): string {
    try {
      return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    } catch {
      return String(value);
    }
  }

  protected readonly trendTickLabels = computed(() => this.trendTicks().map((value) => this.compactValue(value)));

  /** The status ring's filled share — the campaign's collected progress, clamped to the ring. */
  protected readonly statusDonutDash = computed(() => {
    const progress = Math.max(0, Math.min(100, this.liveRecord()?.progress ?? 0));
    const circumference = 2 * Math.PI * 42;
    return `${((circumference * progress) / 100).toFixed(1)} ${circumference.toFixed(1)}`;
  });

  /** The same progress, exposed for the ring's accessible label in the template. */
  protected readonly statusProgress = computed(() => this.liveRecord()?.progress ?? 0);

  /**
   * Reads this campaign's donations — every page, so the header figures describe the whole
   * campaign; the lists below still show the twenty most recent.
   */
  private loadDonations(): void {
    const campaignId = this.store.apiId(this.reference);

    if (!campaignId) {
      this.donations.set([]);
      this.donationsCount.set(0);
      this.donationSamples.set([]);
      this.donationStats.set([]);
      this.recentDonations.set([]);
      return;
    }

    this.donationsLoading.set(true);
    this.donationsError.set(null);

    const all: DonationListItem[] = [];
    const maxPages = 50;

    const fetchPage = (page: number): void => {
      this.payments.searchDonations({ campaignId, page, pageSize: 100 }).subscribe({
        next: (result) => {
          all.push(...(result.items ?? []));

          if (result.hasNextPage && page < maxPages) {
            fetchPage(page + 1);
            return;
          }

          this.applyDonations(all, result.totalCount ?? all.length);
        },

        // REPORTED, NOT SWALLOWED INTO AN EMPTY LIST. "No donations" and "the payments service did
        // not answer" are different facts.
        error: (error: unknown) => {
          this.donations.set([]);
          this.donationsCount.set(0);
          this.donationSamples.set([]);
          this.donationStats.set([]);
          this.firstGifts.set([]);
          this.recentDonations.set([]);
          this.donationsLoading.set(false);
          this.donationsError.set(
            apiErrorMessage(error, 'This campaign\u2019s donations could not be loaded.'));
        },
      });
    };

    fetchPage(1);
  }

  /** Fills the Payments tab, the recent list and the header figures from the donations read. */
  private applyDonations(all: readonly DonationListItem[], totalCount: number): void {
    const recent = all.slice(0, 20);

    // EVERY DONATION, NOT THE TWENTY NEWEST. The table under the calendar is filtered to one day,
    // and a day older than the twentieth gift used to read "nothing recorded" when gifts had
    // been.
    this.donations.set(
      all.map((donation) => ({
        primary: `${this.money(donation.amount)} · ${donation.donorName || 'Anonymous donor'}`,
        secondary: [donation.sourceType as string | null, donation.methodType as string | null]
          .filter((part): part is string => !!part)
          .join(' · ') || donation.statusDescription,
        meta: this.donationWhen(donation.donatedAtUtc),
        dayKey: this.dayKeyOf(donation.donatedAtUtc),
      })),
    );

    this.donationsCount.set(totalCount);
    this.donationSamples.set(
      recent.map((donation) => ({
        amount: donation.amount?.amount ?? 0,
        currency: donation.amount?.currencyCode || 'INR',
        at: donation.donatedAtUtc,
      })),
    );

    // What counts as money raised: everything except a donation that was returned or voided.
    this.donationStats.set(
      all
        .filter((d) => d.status !== 'refunded' && d.status !== 'chargedBack' && d.status !== 'voided')
        .map((d) => ({
          amount: (d.status === 'partiallyRefunded' ? d.netAmount?.amount : undefined) ?? d.amount?.amount ?? 0,
          at: d.donatedAtUtc,
          donor: (d.donorEmail || d.donorName || '').trim().toLowerCase(),
        })),
    );

    // Each donor's FIRST gift to this campaign: the Donors tab lists who started giving on a day.
    const firstByDonor = new Map<string, DonationListItem>();

    for (const donation of all) {
      const key = (donation.donorEmail || donation.donorName || '').trim().toLowerCase();

      if (!key) {
        continue;
      }

      const known = firstByDonor.get(key);

      if (!known || new Date(donation.donatedAtUtc) < new Date(known.donatedAtUtc)) {
        firstByDonor.set(key, donation);
      }
    }

    this.firstGifts.set(
      [...firstByDonor.values()].map((donation) => ({
        primary: donation.donorName || 'Anonymous donor',
        secondary: `First gift ${this.money(donation.amount)}`,
        meta: this.donationWhen(donation.donatedAtUtc),
        dayKey: this.dayKeyOf(donation.donatedAtUtc),
      })),
    );

    // The dashboard's "Recent Donations" list — initials stand in for avatars we don't store.
    this.recentDonations.set(
      recent.map((donation, i) => {
        const name = donation.donorName || 'Anonymous donor';
        const parts = name.trim().split(/\s+/);
        const initials =
          (parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
        return {
          name,
          initials: initials.toUpperCase(),
          amount: this.money(donation.amount),
          when: this.donationWhen(donation.donatedAtUtc),
          key: `${donation.donatedAtUtc ?? 'na'}-${i}`,
        };
      }),
    );
    this.donationsLoading.set(false);
  }

  /** An amount as its own currency prints it, rather than as a bare number. */
  private money(amount: Pick<MoneyResponse, 'amount' | 'currencyCode'> | null | undefined): string {
    if (!amount) {
      return '—';
    }

    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: amount.currencyCode || 'INR',
        maximumFractionDigits: 2,
      }).format(amount.amount ?? 0);
    } catch {
      return `${amount.currencyCode ?? ''} ${amount.amount ?? 0}`.trim();
    }
  }

  private donationWhen(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }

    const when = new Date(value);

    return Number.isNaN(when.getTime())
      ? '—'
      : when.toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
  }

  /**
   * The campaign's activity chronology — the server's append-only trail of who did what to this
   * campaign and whether it was allowed.
   */
  protected readonly recentActivity = signal<readonly ActivityItem[]>([]);

  /** Whether the history call is in flight, so the panel can say so instead of showing blank. */
  protected readonly activityLoading = signal(false);

  /** The reason the trail is missing, when it is missing for a reason. Null when all is well. */
  protected readonly activityError = signal<string | null>(null);

  /** The history entries as the server sent them - the calendar reads their dates. */
  private readonly historyEntries = signal<readonly CampaignHistoryEntry[]>([]);

  /**
   * The icon + colour family of a Recent Activity row, read from its title. A refused action is
   * always 'alert', whatever it was.
   */
  protected activityKind(item: ActivityItem): 'email' | 'whatsapp' | 'instagram' | 'sms' | 'person' | 'approve' | 'create' | 'edit' | 'alert' {
    if (item.tone === 'plum') return 'alert';
    const t = item.title.toLowerCase();
    if (/e-?mail/.test(t)) return 'email';
    if (/whats\s?app/.test(t)) return 'whatsapp';
    if (/insta/.test(t)) return 'instagram';
    if (/\bsms\b|text message/.test(t)) return 'sms';
    if (/donor|lead|owner|assign/.test(t)) return 'person';
    if (/approv|submit|launch|activat|resum/.test(t)) return 'approve';
    if (/creat|\badd/.test(t)) return 'create';
    return 'edit';
  }

  /** Recent Activity grouped by day for the chronicle: a day caption, then that day's entries. */
  protected readonly activityDays = computed(() => {
    const items = this.recentActivity();
    const days: { day: string; items: { item: ActivityItem; time: string; kind: ReturnType<CampaignDetailComponent['activityKind']> }[] }[] = [];
    for (const item of items) {
      const [datePart, timePart] = item.time.split(',').map((x) => x.trim());
      const day = timePart ? datePart : '';
      let group = days[days.length - 1];
      if (!group || group.day !== day) {
        group = { day, items: [] };
        days.push(group);
      }
      group.items.push({ item, time: (timePart || item.time).toUpperCase(), kind: this.activityKind(item) });
    }
    return days;
  });

  /** The word under a chronicle entry's kind: the channel it went out on, or the kind of step. */
  protected activityKindLabel(kind: string): string {
    switch (kind) {
      case 'email': return 'Email';
      case 'whatsapp': return 'WhatsApp';
      case 'instagram': return 'Instagram';
      case 'sms': return 'SMS';
      case 'person': return 'People';
      case 'approve': return 'Approval';
      case 'create': return 'Created';
      case 'alert': return 'Refused';
      default: return 'Change';
    }
  }

  /** "22 Sep 2026, 10:00 AM" -> { time: '10:00 AM', date: '22 Sep' } for the timeline's left column. */
  protected activityWhen(item: ActivityItem): { time: string; date: string } {
    const [datePart, timePart] = item.time.split(',').map(x => x.trim());
    if (!timePart) return { time: item.time, date: '' };
    return { time: timePart.toUpperCase(), date: datePart.split(' ').slice(0, 2).join(' ') };
  }

  /** Loads the history for the campaign on screen. */
  private loadActivity(): void {
    const campaignId = this.store.apiId(this.reference);

    if (!campaignId) {
      this.historyEntries.set([]);
      this.recentActivity.set([]);
      this.activityLoading.set(false);
      this.activityError.set(null);
      return;
    }

    this.activityLoading.set(true);
    this.activityError.set(null);

    // THE FIELD NAMES ARE THE ONES THE SERVER ACTUALLY SENDS: `actionCode`, `actorUserId`,
    // `result`, `reason` and `occurredAtUtc` on CampaignHistoryResponse.
    this.campaignApi.getCampaignHistory(campaignId).subscribe({
      next: (entries) => {
        this.historyEntries.set(entries);
        this.recentActivity.set(
          entries.map((entry) => {
            const result = String(entry.result ?? '');

            // WHO DID IT, beside what they said. The trail is the record of who took each step,
            // and a row reading only "Campaign approved" left out the half people look for.
            const actor = entry.actorUserId ? this.people.name(entry.actorUserId) : '';
            const said = entry.reason ?? this.describeHistoryResult(result);

            return {
              title: this.describeHistoryAction(entry.actionCode),
              detail: [said, actor && actor !== '—' ? `by ${actor}` : ''].filter(Boolean).join(' · '),
              time: entry.occurredAtUtc
                ? new Date(entry.occurredAtUtc).toLocaleString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })
                : '',

              // A REFUSED ACTION IS DRAWN DIFFERENTLY.
              tone: /denied|failure|failed|reject|refus/i.test(result) ? 'plum' : 'good',
            } as ActivityItem;
          }),
        );
      },
      error: () => {
        this.historyEntries.set([]);
        this.recentActivity.set([]);
        this.activityLoading.set(false);
        this.activityError.set("This campaign's history could not be loaded.");
      },
      complete: () => this.activityLoading.set(false),
    });
  }

  /** An audit action code as a sentence ('CampaignSubmitted' -> 'Campaign submitted'). */
  private describeHistoryAction(code: string | null | undefined): string {
    const raw = (code ?? '').trim();

    if (!raw) {
      return 'Recorded change';
    }

    return raw
      .replace(/[_.-]+/g, ' ')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .replace(/^./, (first) => first.toUpperCase());
  }

  /** The outcome, for the rows that carry no reason of their own. */
  private describeHistoryResult(result: string): string {
    if (!result) {
      return '';
    }

    return /denied|failure|failed|reject|refus/i.test(result) ? 'Not permitted' : 'Completed';
  }

  // ================= Design-mirror dashboard (KPI cards, channels, calendar) =================

  /** A figure with the rupee mark and Indian grouping — ₹2,500 — for chart ticks and cards. */
  protected rupeeINR(value: number): string {
    try {
      return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)}`;
    } catch {
      return `₹${value}`;
    }
  }

  // ---------- Header figures: real data for this campaign ----------

  /** Start of the current and previous calendar month. */
  private monthBounds(): { thisStart: Date; prevStart: Date; nextStart: Date } {
    const now = new Date();
    return {
      thisStart: new Date(now.getFullYear(), now.getMonth(), 1),
      prevStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      nextStart: new Date(now.getFullYear(), now.getMonth() + 1, 1),
    };
  }

  /** The increase or decrease between two counts, as the arrow and percentage shown on the card. */
  protected changeOf(current: number, previous: number): { cls: string; text: string } {
    if (previous <= 0) {
      return current > 0 ? { cls: 'is-up', text: '↑ New' } : { cls: 'is-flat', text: '— 0%' };
    }
    const pct = Math.round(((current - previous) / previous) * 100);
    if (pct > 0) return { cls: 'is-up', text: `↑ ${pct}%` };
    if (pct < 0) return { cls: 'is-down', text: `↓ ${Math.abs(pct)}%` };
    return { cls: 'is-flat', text: '→ 0%' };
  }

  private readonly monthlyDonations = computed(() => {
    const { thisStart, prevStart, nextStart } = this.monthBounds();
    let current = 0;
    let previous = 0;
    let currentGifts = 0;
    let previousGifts = 0;
    const currentDonors = new Set<string>();
    const previousDonors = new Set<string>();

    for (const d of this.donationStats()) {
      const when = new Date(d.at);
      if (Number.isNaN(when.getTime())) continue;
      if (when >= thisStart && when < nextStart) {
        current += d.amount;
        currentGifts++;
        if (d.donor) currentDonors.add(d.donor);
      } else if (when >= prevStart && when < thisStart) {
        previous += d.amount;
        previousGifts++;
        if (d.donor) previousDonors.add(d.donor);
      }
    }

    return {
      current, previous, currentGifts, previousGifts,
      currentDonors: currentDonors.size, previousDonors: previousDonors.size,
    };
  });

  // ---------- Donations (how many gifts, and how many of them this month) ----------
  //
  // THIS TILE READ "WHATSAPP SENDS  0" WITH A FIXED "— 0%", for every campaign. Nothing on the
  // platform counts WhatsApp sends, so the figure could only ever be the literal typed into the
  // template. It now counts what the payments service holds for this campaign.
  protected readonly donationsTotalLabel = computed(() => this.donationStats().length.toLocaleString('en-IN'));
  protected readonly donationsThisMonthLabel = computed(() =>
    this.monthlyDonations().currentGifts.toLocaleString('en-IN'),
  );
  protected readonly donationsChange = computed(() =>
    this.changeOf(this.monthlyDonations().currentGifts, this.monthlyDonations().previousGifts),
  );

  // ---------- Monthly revenue (this month's donations vs last month's) ----------
  protected readonly kpiRevenue = computed(() => this.rupeeINR(this.monthlyDonations().current));
  protected readonly kpiRevenueChange = computed(() =>
    this.changeOf(this.monthlyDonations().current, this.monthlyDonations().previous),
  );

  // ---------- Total donors (distinct donors, and how many gave this month) ----------
  protected readonly totalDonorsLabel = computed(() =>
    new Set(this.donationStats().map((d) => d.donor).filter((d) => !!d)).size.toLocaleString('en-IN'),
  );
  protected readonly monthlyDonorsLabel = computed(() =>
    this.monthlyDonations().currentDonors.toLocaleString('en-IN'),
  );
  protected readonly donorsChange = computed(() =>
    this.changeOf(this.monthlyDonations().currentDonors, this.monthlyDonations().previousDonors),
  );

  // ---------- Tracking assets (created this month vs last month) ----------
  protected readonly assetsThisMonth = computed(() => this.assetsCreatedIn(0));
  protected readonly assetsChange = computed(() =>
    this.changeOf(this.assetsThisMonth(), this.assetsCreatedIn(-1)),
  );
  private assetsCreatedIn(monthOffset: 0 | -1): number {
    const { thisStart, prevStart, nextStart } = this.monthBounds();
    const from = monthOffset === 0 ? thisStart : prevStart;
    const to = monthOffset === 0 ? nextStart : thisStart;
    return this.trackingStore.forCampaign(this.reference).filter((a) => {
      const when = new Date(a.activeFrom ?? '');
      return !Number.isNaN(when.getTime()) && when >= from && when < to;
    }).length;
  }

  /**
   * Donut segments for a 100-unit circumference starting at 12 o'clock — the classic
   * r=15.9155 circle, so percentages map straight onto dash lengths.
   */
  private donutSegments<T extends { label: string; pct: number; color: string }>(mix: readonly T[]) {
    let offset = 25;
    return mix.map((seg) => {
      const circle = { ...seg, dash: `${seg.pct} ${100 - seg.pct}`, offset };
      offset = (((offset - seg.pct) % 100) + 100) % 100;
      return circle;
    });
  }

  // ---------- Donations by Channel (CAM's attribution of this campaign's gifts) ----------

  /** How this campaign's donations of the last twelve months break down, from CAM. */
  private readonly attribution = signal<AttributionSummary | null>(null);

  /** Every attributed-or-not donation of the campaign, for the Source and channel tabs. */
  private readonly attributedDonations = signal<readonly AttributionListItem[]>([]);

  protected readonly attributionError = signal<string | null>(null);

  /** Whether the caller may read attribution at all. Without it the panel and its tabs are withheld. */
  protected readonly canSeeAttribution = computed(() => this.currentUser.hasPermission('cam.attribution.view'));

  /**
   * Reads the campaign's attribution: the twelve-month summary behind the channel panel, and the
   * donation-by-donation list behind the Source and channel tabs.
   */
  private loadAttribution(): void {
    const campaignId = this.store.apiId(this.reference);

    if (!campaignId || !this.canSeeAttribution()) {
      this.attribution.set(null);
      this.attributedDonations.set([]);
      return;
    }

    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);

    this.attributionError.set(null);

    this.campaignApi.getAttributionSummary(campaignId, { fromUtc: from.toISOString() }).subscribe({
      next: (summary) => this.attribution.set(summary),
      error: (error: unknown) => {
        this.attribution.set(null);
        this.attributionError.set(apiErrorMessage(error, 'The channel breakdown could not be loaded.'));
      },
    });

    fetchAllPages((page, pageSize) =>
      this.campaignApi.searchAttribution({ campaignId, page, pageSize })).subscribe({
      next: (items) => this.attributedDonations.set(items),
      error: () => this.attributedDonations.set([]),
    });
  }

  /** The panel's ring colours, by position. Presentation only - the segments are the server's. */
  private static readonly MIX_COLOURS = ['#f2a6bf', '#96e0bb', '#c9adf0', '#f6c177', '#8ecae6', '#b8c0cc'];

  /**
   * The channel panel's segments: one per channel CAM traced gifts to, and one for the gifts it
   * could not trace, so the ring always adds up to every donation in the window.
   *
   * THESE WERE THREE LITERALS - SMS 1,120, WhatsApp 860, Instagram 580, of "2,560 donors" - shown
   * on every campaign, including ones with no donations at all.
   */
  protected readonly donorMix = computed(() => {
    const summary = this.attribution();

    if (!summary || summary.totalDonations <= 0) {
      return [] as { label: string; display: string; pct: number; color: string }[];
    }

    const rows = (summary.byChannel ?? [])
      .filter((row) => row.donationCount > 0)
      .map((row) => ({ label: row.label || 'Unnamed channel', count: row.donationCount }));

    if (summary.unattributedDonations > 0) {
      rows.push({ label: 'Not traced to a channel', count: summary.unattributedDonations });
    }

    return rows.map((row, index) => ({
      label: row.label,
      display: row.count.toLocaleString('en-IN'),
      pct: Math.round((row.count / summary.totalDonations) * 1000) / 10,
      color: CampaignDetailComponent.MIX_COLOURS[index % CampaignDetailComponent.MIX_COLOURS.length],
    }));
  });

  protected readonly donorMixTotalLabel = computed(() =>
    (this.attribution()?.totalDonations ?? 0).toLocaleString('en-IN'),
  );

  protected readonly donorMixDonut = computed(() => this.donutSegments(this.donorMix()));

  // ---------- Campaign Calendar (this campaign's own dates, steps, assets and gifts) ----------

  /** Monday-first weekday captions, in the viewer's language. */
  protected readonly calDow = Array.from({ length: 7 }, (_, index) =>
    new Date(2024, 0, 1 + index).toLocaleDateString('en-GB', { weekday: 'short' }));

  /** What each kind of calendar entry is called in the legend. */
  private static readonly CAL_KIND_LABELS: Readonly<Record<string, string>> = {
    launch: 'Campaign launch',
    email: 'Campaign end',
    report: 'Lifecycle step',
    website: 'Tracking asset',
    donor: 'Donations received',
  };

  /**
   * The legend: only the kinds of entry the shown month actually holds.
   *
   * IT LISTED SEVEN ACTIVITY TYPES - email, SMS, social media, report review and the rest - none
   * of which this platform records. They explained the invented dots that used to fill the grid.
   */
  protected readonly calLegend = computed(() => {
    const present = new Set<string>();

    for (const cell of this.calCells()) {
      for (const event of cell.events) {
        present.add(event.kind);
      }
    }

    return Object.entries(CampaignDetailComponent.CAL_KIND_LABELS)
      .filter(([kind]) => present.has(kind))
      .map(([kind, label]) => ({ kind, label }));
  });

  /** The logo stacked on a calendar day, one per event kind or channel (Remix icons). */
  protected calKindIcon(kind: string): string {
    const icons: Record<string, string> = {
      email: 'ri-mail-line',
      sms: 'ri-message-2-line',
      whatsapp: 'ri-whatsapp-line',
      instagram: 'ri-instagram-line',
      facebook: 'ri-facebook-line',
      linkedin: 'ri-linkedin-line',
      x: 'ri-twitter-x-line',
      donor: 'ri-user-heart-line',
      social: 'ri-share-line',
      report: 'ri-file-chart-line',
      website: 'ri-global-line',
      launch: 'ri-rocket-2-line',
    };
    return icons[kind] ?? 'ri-calendar-event-line';
  }

  private readonly calMonth = signal(this.startOfMonth(new Date()));
  /** The clicked day's key, or null. */
  private readonly calSelected = signal<string | null>(null);

  private startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }
  private dateKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }
  /** A bare YYYY-MM-DD as that LOCAL calendar day (not UTC midnight), or any other date as given. */
  private tryDateOnly(value: string | null | undefined): Date | null {
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');

    return ymd ? new Date(+ymd[1], +ymd[2] - 1, +ymd[3]) : this.tryDate(value);
  }

  /** A parseable date or nothing — campaign dates arrive as strings from the API. */
  private tryDate(value: string | null | undefined): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** Changing month clears the selected day: it is no longer on screen. */
  protected calShift(delta: number): void {
    const current = this.calMonth();
    this.calMonth.set(new Date(current.getFullYear(), current.getMonth() + delta, 1));
    this.calSelected.set(null);
  }

  protected readonly calLabel = computed(() =>
    this.calMonth().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  );

  /**
   * The calendar's entries, every one a record: the campaign's start and end dates, each step of
   * its lifecycle history, each tracking asset on the day it goes live, and each day donations
   * arrived.
   *
   * SEVENTEEN INVENTED ACTIVITIES USED TO BE PAINTED ONTO FIXED DAYS OF WHICHEVER MONTH WAS SHOWN -
   * "Impact Update", "Volunteer Alert", a "New Donor" of 5,800 euros - with two invented owners,
   * identically on every campaign and every month.
   */
  private calEvents(): Map<string, CalEvent[]> {
    const map = new Map<string, CalEvent[]>();
    const add = (date: Date | null, event: CalEvent) => {
      if (!date) {
        return;
      }
      const key = this.dateKey(date);
      const list = map.get(key) ?? [];
      if (!list.some((entry) => entry.label === event.label)) {
        list.push(event);
      }
      map.set(key, list);
    };
    add(this.tryDateOnly(this.liveRecord()?.startDate), { label: 'Campaign launch', kind: 'launch' });
    add(this.tryDateOnly(this.liveRecord()?.endDate), { label: 'Campaign ends', kind: 'email' });

    for (const entry of this.historyEntries()) {
      add(this.tryDate(entry.occurredAtUtc), {
        label: this.describeHistoryAction(entry.actionCode),
        kind: 'report',
      });
    }

    for (const asset of this.trackingStore.forCampaign(this.reference)) {
      add(this.tryDateOnly(asset.activeFrom), {
        label: `Tracking asset ${asset.trackingReference}`,
        kind: 'website',
      });
    }

    const giftsByDay = new Map<string, { date: Date; count: number }>();

    for (const gift of this.donationStats()) {
      const when = this.tryDate(gift.at);

      if (!when) {
        continue;
      }

      const key = this.dateKey(when);
      const day = giftsByDay.get(key) ?? { date: when, count: 0 };
      day.count++;
      giftsByDay.set(key, day);
    }

    for (const day of giftsByDay.values()) {
      add(day.date, {
        label: `${day.count} donation${day.count === 1 ? '' : 's'} received`,
        kind: 'donor',
      });
    }

    return map;
  }

  /**
   * Just this month's own days, with blank Monday-first alignment cells before day 1 —
   * never a day borrowed from the month before or after.
   */
  protected readonly calCells = computed(() => {
    const first = this.calMonth();
    const events = this.calEvents();
    const todayKey = this.dateKey(new Date());
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const cells: {
      key: string;
      day: number;
      inMonth: boolean;
      date: Date | null;
      isToday: boolean;
      selected: boolean;
      events: CalEvent[];
    }[] = [];
    for (let i = 0; i < lead; i++) {
      cells.push({
        key: `lead-${i}`, day: 0, inMonth: false, date: null, isToday: false, selected: false, events: [],
      });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(first.getFullYear(), first.getMonth(), day);
      const key = this.dateKey(date);
      cells.push({
        key,
        day,
        date,
        inMonth: true,
        isToday: key === todayKey,
        selected: key === this.calSelected(),
        events: events.get(key) ?? [],
      });
    }
    return cells;
  });

  /**
   * Clicking a day filters the tabbed lists below the calendar to that date and scrolls them into
   * view. Clicking the same day again goes back to today.
   */
  protected selectCalDay(cell: { key: string }): void {
    const next = this.calSelected() === cell.key ? null : cell.key;
    this.calSelected.set(next);
    this.trackPage.set(1);
    if (next) {
      setTimeout(() =>
        document.getElementById('cd-date-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  }

  /** The same key `dateKey` builds, for a stored date string. A bare `YYYY-MM-DD` is read as a
   *  local calendar day (not UTC midnight). */
  private dayKeyOf(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = ymd ? new Date(+ymd[1], +ymd[2] - 1, +ymd[3]) : this.tryDate(value);
    return date ? this.dateKey(date) : null;
  }

  /** Whether a calendar day is picked — the empty state then offers "Back to today". */
  protected readonly hasCalDay = computed(() => this.calSelected() !== null);

  /** Drops the picked day, so the tab lists go back to today. */
  protected clearCalDay(): void {
    this.calSelected.set(null);
    this.trackPage.set(1);
  }

  /** The day the tab lists show: the date picked on the calendar, or TODAY when none is picked. */
  private readonly activeDayKey = computed(() => this.calSelected() ?? this.dateKey(new Date()));

  /** The day the tab lists are filtered to, for their empty-state messages. */
  protected readonly calFilterLabel = computed(() => {
    const cell = this.calCells().find((c) => c.selected && c.date);
    const date = cell?.date ?? new Date();
    const label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return cell ? label : `Today · ${label}`;
  });

  /** Payments, narrowed to the selected calendar day. */
  protected readonly paymentRows = computed(() => {
    const day = this.activeDayKey();
    return this.donations().filter((row) => row.dayKey === day);
  });

  // ================= Campaign Overview summary card content =================
  // THE `*Name` FIELDS, NOT THE ID FIELDS — the id fields hold the API's Guids.
  protected readonly channelsLabel = computed(() => {
    const list = this.liveRecord()?.channelNames;
    return list && list.length ? list.join(', ') : '—';
  });
  /** Fund or programme — captured on Wizard step 1. */
  protected readonly fundProgramme = computed(() => this.liveRecord()?.fundProgramme || '—');

  /**
   * The campaign amount, as the summary card prints it. A DASH FOR ZERO: campaigns created
   * before the column existed hold 0, which means "never stated" rather than "free".
   */
  protected readonly campaignAmountLabel = computed(() => {
    const record = this.liveRecord();
    const amount = record?.campaignAmount ?? 0;

    if (!amount) {
      return '—';
    }

    const formatted = amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const code = (record?.currencyName ?? '').split('—')[0].split('-')[0].trim();

    return code ? `${code} ${formatted}` : formatted;
  });
  /** Country / State / City / Zip code — captured on Wizard step 3. */
  protected readonly locationLabel = computed(() => {
    const rec = this.liveRecord();
    const parts = [rec?.countryName, rec?.regionName, rec?.cityName, rec?.pincode].filter(
      (v): v is string => !!v,
    );
    return parts.length ? parts.join(' · ') : '—';
  });
  /** Lifecycle activation + reminder — captured on Wizard step 3. */
  protected readonly activationLabel = computed(() => {
    const rec = this.liveRecord();
    if (!rec) return '—';
    const mode = rec.activationMode === 'auto' ? 'Auto-activate on the start date' : 'Manual activate';
    const reminder =
      rec.reminderDaysBefore != null
        ? ` · Reminder ${rec.reminderDaysBefore} day(s) before at ${rec.reminderTime || '—'}`
        : '';
    return `${mode}${reminder}`;
  });

  private richOrPlain(html: string | undefined, plain: string | undefined, emptyText: string): string {
    if (html && html.trim()) return html;
    if (plain && plain.trim()) return `<p>${plain}</p>`;
    return `<p>${emptyText}</p>`;
  }
  private previewOf(plain: string | undefined, emptyText: string): string {
    const t = (plain ?? '').trim();
    if (!t) return emptyText;
    return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  }
  protected readonly publicDescriptionHtml = computed(() =>
    this.richOrPlain(this.liveRecord()?.publicDescriptionHtml, this.liveRecord()?.publicDescription, 'No public description provided.'),
  );
  protected readonly publicDescriptionPreview = computed(() =>
    this.previewOf(this.liveRecord()?.publicDescription, 'No public description provided.'),
  );
  protected readonly termsNoticeHtml = computed(() =>
    this.richOrPlain(this.liveRecord()?.termsNoticeHtml, this.liveRecord()?.termsNotice, 'No terms and notice provided.'),
  );
  protected readonly termsNoticePreview = computed(() =>
    this.previewOf(this.liveRecord()?.termsNotice, 'No terms and notice provided.'),
  );
  /** Whether a value was actually entered — drives whether "Read more" is shown at all. */
  protected readonly hasPublicDescription = computed(() =>
    !!(this.liveRecord()?.publicDescription ?? '').trim() || !!(this.liveRecord()?.publicDescriptionHtml ?? '').trim(),
  );
  protected readonly hasTermsNotice = computed(() =>
    !!(this.liveRecord()?.termsNotice ?? '').trim() || !!(this.liveRecord()?.termsNoticeHtml ?? '').trim(),
  );

  /** "Read more" popup — Public description and Terms & notice open the full rendered content. */
  protected readonly readMoreField = signal<'description' | 'terms' | 'purpose' | null>(null);
  protected openReadMore(which: 'description' | 'terms' | 'purpose'): void {
    if (which === 'purpose' ? !this.purposeIsLong() : which === 'terms' ? !this.hasTermsNotice() : !this.hasPublicDescription()) return;
    this.readMoreField.set(which);
  }
  protected closeReadMore(): void {
    this.readMoreField.set(null);
  }
  protected readonly readMoreTitle = computed(() => {
    const f = this.readMoreField();
    return f === 'terms' ? 'Terms and notice' : f === 'purpose' ? 'Purpose' : 'Public description';
  });
  protected readonly readMoreHtml = computed(() => {
    const f = this.readMoreField();
    return f === 'terms' ? this.termsNoticeHtml() : f === 'purpose' ? this.purposeHtml() : this.publicDescriptionHtml();
  });
  /** Word count and reading time for the popup footer, counted on the visible text (tags stripped). */
  protected readonly readMoreWordCount = computed(() => {
    const text = String(this.readMoreHtml() ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    return text ? text.split(/\s+/).length : 0;
  });
  protected readonly readMoreMinutes = computed(() => Math.max(1, Math.round(this.readMoreWordCount() / 200)));

  // ================= Main work: tabs =================

  /** Whether the caller may read the organisation's leads. Campaign roles do not; the admin does. */
  protected readonly canSeeLeads = computed(() => this.currentUser.hasPermission('don.lead-work-queue.view'));

  /**
   * The tabs, each one backed by a service this caller can read.
   *
   * THE LAST SIX WERE Leads, Donors, Source, SMS, Whatsapp AND Instagram, AND ALL SIX WERE ALWAYS
   * EMPTY - the template handed every one of them an empty array. Leads now reads the donors
   * service (for those who may), Donors and Source read this campaign's gifts, and the three
   * channel names typed in here are replaced by the channels THIS campaign actually runs on, as
   * CAM holds them.
   */
  protected readonly tabs = computed<readonly DetailTab[]>(() => [
    { key: 'tracking', label: 'Tracking' },
    { key: 'payments', label: 'Payments' },
    ...(this.canSeeLeads() ? [{ key: 'leads', label: 'Leads' }] : []),
    { key: 'donors', label: 'Donors' },
    ...(this.canSeeAttribution() ? [{ key: 'source', label: 'Source' }] : []),
    ...(this.canSeeAttribution()
      ? (this.liveRecord()?.channelNames ?? []).map((name) => ({ key: `channel:${name}`, label: name }))
      : []),
  ]);

  /** The tab shown on arrival: Tracking, the first of the list. */
  protected readonly activeTab = signal<string>('tracking');
  protected selectTab(key: string): void {
    this.activeTab.set(key);
    this.trackPage.set(1);
  }

  /** This campaign's leads, from the donors service. Empty for a caller who may not read leads. */
  private readonly leads = signal<readonly LeadListItem[]>([]);
  protected readonly leadsError = signal<string | null>(null);

  private loadLeads(): void {
    const campaignId = this.store.apiId(this.reference);

    if (!campaignId || !this.canSeeLeads()) {
      this.leads.set([]);
      return;
    }

    this.leadsError.set(null);

    // Converted leads as well as open ones: a lead that became a donor is still this campaign's.
    const read = (isConverted: boolean) =>
      fetchAllPages((page, pageSize) =>
        this.donors
          .getLeadWorkQueue({ campaignId, page, pageSize, isConverted })
          .pipe(map((response) => response.leads)));

    forkJoin([read(false), read(true)]).subscribe({
      next: ([open, converted]) => this.leads.set([...open, ...converted]),
      error: (error: unknown) => {
        this.leads.set([]);
        this.leadsError.set(apiErrorMessage(error, 'This campaign\u2019s leads could not be loaded.'));
      },
    });
  }

  /** One attributed donation as a row of the Source and channel tabs. */
  private attributionRow(item: AttributionListItem, detail: string): DatedRow {
    return {
      primary: `${this.money({ amount: item.amount, currencyCode: item.currencyCode })} · ${item.donorName || 'Anonymous donor'}`,
      secondary: detail,
      meta: this.donationWhen(item.receivedAtUtc),
      dayKey: this.dayKeyOf(item.receivedAtUtc),
    };
  }

  /** Column captions for the tab on screen. */
  protected readonly tabColumns = computed<readonly string[]>(() => {
    const tab = this.activeTab();

    if (tab === 'leads') return ['Lead', 'Stage · Owner', 'Captured'];
    if (tab === 'donors') return ['Donor', 'First gift', 'Received'];
    if (tab === 'source') return ['Donation', 'Source · Medium', 'Received'];
    return ['Donation', 'Tracking asset · Source', 'Received'];
  });

  /** The rows of the tab on screen, narrowed to the selected calendar day like every other tab. */
  protected readonly tabRows = computed<readonly DatedRow[]>(() => {
    const tab = this.activeTab();
    const day = this.activeDayKey();
    let rows: readonly DatedRow[] = [];

    if (tab === 'leads') {
      rows = this.leads().map((lead) => ({
        primary: `${lead.name} · ${lead.leadReference}`,
        secondary: [lead.status, lead.ownerName || 'Unassigned'].filter(Boolean).join(' · '),
        meta: this.donationWhen(lead.createdAtUtc),
        dayKey: this.dayKeyOf(lead.createdAtUtc),
      }));
    } else if (tab === 'donors') {
      rows = this.firstGifts();
    } else if (tab === 'source') {
      rows = this.attributedDonations().map((item) =>
        this.attributionRow(
          item,
          item.isAttributed
            ? [item.sourceName, item.mediumName].filter(Boolean).join(' · ') || 'Traced'
            : 'Not traced to a source'));
    } else if (tab.startsWith('channel:')) {
      const channel = tab.slice('channel:'.length);

      rows = this.attributedDonations()
        .filter((item) => item.isAttributed && item.channelName === channel)
        .map((item) =>
          this.attributionRow(item, [item.trackingReference, item.sourceName].filter(Boolean).join(' · ')));
    }

    return rows.filter((row) => row.dayKey === day);
  });

  /** Why the tab on screen has nothing to show, when that is a failed read rather than an empty day. */
  protected readonly tabError = computed(() => {
    const tab = this.activeTab();

    if (tab === 'leads') return this.leadsError();
    if (tab === 'source' || tab.startsWith('channel:')) return this.attributionError();
    return null;
  });

  // ---------- Tracking mini-table (paged five at a time, like the design) ----------
  private static readonly TRACK_PAGE_SIZE = 5;
  protected readonly trackPage = signal(1);

  /** Free-text filter over reference/type-channel. Resets to page 1 whenever it changes. */
  protected readonly trackSearchTerm = signal('');
  protected setTrackSearch(value: string): void {
    this.trackSearchTerm.set(value);
    this.trackPage.set(1);
  }

  /** The status word's dot colour — green for live, blue for approved, grey otherwise. */
  private statusTone(status: string): string {
    if (/active/i.test(status)) {
      return 'good';
    }
    if (/approved|verified/i.test(status)) {
      return 'blue';
    }
    if (/paused|hold|pending/i.test(status)) {
      return 'warn';
    }
    if (/fail|deny|reject|expir/i.test(status)) {
      return 'bad';
    }
    return 'muted';
  }

  /** Tracking rows shaped for the compact card: status word for the dot, plus a usage tail. */
  protected readonly trackRows = computed(() => {
    const rows = this.trackingAssets().map((row) => {
      const parts = row.meta.split('·');
      const status = parts[0] ?? '';
      return {
        primary: row.primary,
        secondary: row.secondary,
        statusText: status.trim() || '—',
        uses: parts.slice(1).join('·').trim(),
        usesCount: row.usageCount != null ? `${row.usageCount.toLocaleString('en-IN')} Uses` : '—',
        createdOn: row.createdOn ?? '—',
        dayKey: row.dayKey ?? null,
        tone: this.statusTone(status),
      };
    });
    const day = this.activeDayKey();
    const dated = rows.filter((row) => row.dayKey === day);
    const term = this.trackSearchTerm().trim().toLowerCase();
    if (!term) {
      return dated;
    }
    return dated.filter(
      (row) => row.primary.toLowerCase().includes(term) || row.secondary.toLowerCase().includes(term),
    );
  });

  protected readonly trackPageCount = computed(() =>
    Math.max(1, Math.ceil(this.trackRows().length / CampaignDetailComponent.TRACK_PAGE_SIZE)),
  );

  protected readonly pagedTrackingRows = computed(() => {
    const page = Math.min(Math.max(1, this.trackPage()), this.trackPageCount());
    return this.trackRows().slice(
      (page - 1) * CampaignDetailComponent.TRACK_PAGE_SIZE,
      page * CampaignDetailComponent.TRACK_PAGE_SIZE,
    );
  });

  protected readonly trackShowing = computed(
    () => `Showing ${this.pagedTrackingRows().length} of ${this.trackRows().length}`,
  );

  protected trackGo(delta: number): void {
    this.trackPage.set(Math.min(Math.max(1, this.trackPage() + delta), this.trackPageCount()));
  }

  // ================= Context and filters =================
  /** Active data scope - this campaign's own country and state (names, not ids). */
  protected readonly scope = computed(() => {
    const rec = this.liveRecord();
    const parts = [rec?.countryName, rec?.regionName].filter((v): v is string => !!v);
    return parts.length ? `${parts.join(' · ')} · This campaign` : 'This campaign';
  });

  /** Active-filter summary chips — kept for a possible future filter, empty today. */
  protected readonly activeFilterSummary = computed<readonly { key: string; label: string }[]>(() => []);

  /** Donations in scope — re-reading it stamps a fresh refreshed time. */
  protected readonly donationsScopeFetching = signal(false);
  protected readonly scopedTotals = computed(
    () => `${this.donationsCount().toLocaleString('en-IN')} donations in scope · refreshed ${this.lastRefresh()}`,
  );

  /** Re-reads this campaign's donations. */
  protected refreshDonationsScope(): void {
    this.donationsScopeFetching.set(true);
    this.loadDonations();
    this.lastRefresh.set(this.nowLabel());
    this.donationsScopeFetching.set(false);
  }

  /** Back to the register - the way out of "no campaign to show". */
  protected openRegister(): void {
    this.router.navigate(['/app/fundraising/campaigns/campaign-register']);
  }

  protected clearFilters(): void {
    /* No search/saved-view filters remain on this page — kept as a no-op for the state-panel Reset button. */
  }

  // ================= Actions, eligibility and result =================
  /**
   * The primary transition for this status, IF the server has listed it for this caller.
   * The status decides which transition is interesting; `permittedActions` decides whether
   * this particular person may run it.
   */
  protected readonly primaryTransition = computed(() => {
    const transition = PRIMARY_TRANSITION[this.status()];

    if (!transition) {
      return undefined;
    }

    // No `requires` means the transition predates this rule; fail closed.
    return transition.requires && this.allows(transition.requires) ? transition : undefined;
  });

  /** Other eligible transitions for this state, offered inside the same confirm dialog. */
  protected readonly alternateTransitions = computed<readonly LifecycleTransition[]>(() => {
    const alts = [...(SECONDARY_TRANSITIONS[this.status()] ?? [])];

    if (CANCELLABLE_STATES.includes(this.status())) {
      alts.push(CANCEL_TRANSITION);
    }

    return alts.filter((transition) => !!transition.requires && this.allows(transition.requires));
  });

  /** True when this state's lifecycle actions run from the header's lifecycle buttons rather
   *  than in the in-place confirm dialog. */
  protected readonly lifecycleUsesDedicatedPage = computed(() => LIFECYCLE_PAGE_STATES.includes(this.status()));

  /** The in-place maker action — Submit on a Draft, Approve on a Submitted campaign. */
  protected readonly operateAllowed = computed(
    () => !!this.primaryTransition() && !this.lifecycleUsesDedicatedPage() && this.uiState() !== 'no-access',
  );
  protected readonly primaryActionLabel = computed(() => this.primaryTransition()?.label ?? '');

  /** Lifecycle actions — offered for every state a reader can see; each action is filtered below. */
  protected readonly lifecycleAllowed = computed(
    () => this.permissions().view && this.uiState() !== 'no-access',
  );

  // ================= Lifecycle actions in the header =================
  //
  // Activate / Pause / Resume / Approve close run straight away. Request close opens the
  // reason popup (a cd-modal, the same shell as Delete draft) and is sent from there.

  protected readonly lifecycleBusy = signal(false);
  protected readonly lifecycleError = signal('');

  /** Whether the Request close popup is open. */
  protected readonly closeBoxOpen = signal(false);
  protected readonly closeReason = signal('');
  /** Set on the first submit attempt, never on blur — so an untouched box shows no error. */
  protected readonly closeReasonTouched = signal(false);
  protected readonly closeReasonMin = 10;
  protected readonly closeReasonMax = 2000;
  protected readonly closeReasonCount = computed(() => this.closeReason().trim().length);
  protected readonly closeReasonValid = computed(() => {
    const length = this.closeReasonCount();
    return length >= this.closeReasonMin && length <= this.closeReasonMax;
  });
  /** The error appears only after a submit attempt, then updates live as the user types. */
  protected readonly closeReasonShowError = computed(
    () => this.closeReasonTouched() && !this.closeReasonValid(),
  );

  /**
   * The actions offered for the campaign's current state, and only the ones the server lists for
   * this caller:
   *
   *   Approved / Scheduled → Activate        Active → Pause, Request close
   *   Paused               → Resume, Request close        Closing → Approve close
   */
  protected readonly lifecycleActions = computed<
    readonly { key: LifecycleActionKey; label: string; tone: 'primary' | 'danger' }[]
  >(() => {
    const status = this.status();
    const actions: { key: LifecycleActionKey; label: string; tone: 'primary' | 'danger' }[] = [];

    // REJECT HAS ITS OWN BUTTON, beside Approve. It was reachable only as the second option inside
    // the dialog the Approve button opens, which is not where somebody about to refuse a campaign
    // looks. It opens that same dialog, on Reject.
    if (status === 'Submitted' && this.allows('Reject')) {
      actions.push({ key: 'reject', label: 'Reject', tone: 'danger' });
    }
    if ((status === 'Approved' || status === 'Scheduled') && this.allows('Activate')) {
      actions.push({ key: 'activate', label: 'Activate', tone: 'primary' });
    }
    if (status === 'Active' && this.allows('Pause')) {
      actions.push({ key: 'pause', label: 'Pause', tone: 'primary' });
    }
    if (status === 'Paused' && this.allows('Resume')) {
      actions.push({ key: 'resume', label: 'Resume', tone: 'primary' });
    }
    if ((status === 'Active' || status === 'Paused') && this.allows('RequestClose')) {
      actions.push({ key: 'requestClose', label: 'Request close', tone: 'danger' });
    }
    if (status === 'Closing' && this.allows('ApproveClose')) {
      actions.push({ key: 'approveClose', label: 'Approve close', tone: 'danger' });
    }
    if (status === 'Closing' && this.allows('RejectClose')) {
      actions.push({ key: 'rejectClose', label: 'Reject close', tone: 'primary' });
    }
    return actions;
  });

  protected runLifecycle(key: LifecycleActionKey): void {
    if (this.lifecycleBusy()) {
      return;
    }
    this.lifecycleError.set('');

    // Request close and Reject close only open the reason popup; the call is made from its button.
    if (key === 'requestClose' || key === 'rejectClose') {
      this.openCloseRequest(key === 'rejectClose' ? 'reject' : 'request');
      return;
    }

    // Reject is decided in the confirm dialog, with its reason.
    if (key === 'reject') {
      this.openOperate('reject');
      return;
    }

    const ref = this.reference;
    const finish = (landedOn: CampaignStatus, message: string) =>
      (result: { readonly applied: boolean; readonly error?: string }): void => {
        this.lifecycleBusy.set(false);
        if (!result.applied) {
          // Refusals (e.g. "You cannot approve a close request you raised") go to a toast,
          // not an inline row under the header.
          this.toast.show(
            'Not changed',
            result.error ?? 'That change was refused. The campaign has not been changed.',
            'error',
          );
          return;
        }
        // Show the new state at once, then let the reload bring the server's own.
        this.store.applyStatus(ref, landedOn);
        this.store.reload(ref);
        this.closeStore.load(ref);
        this.toast.show('Lifecycle updated', message, 'success');
      };

    this.lifecycleBusy.set(true);
    switch (key) {
      case 'activate':
        this.store.activate(ref, finish('Active', `${ref} is now Active.`));
        break;
      case 'pause':
        this.store.pause(ref, finish('Paused', `${ref} is now Paused.`));
        break;
      case 'resume':
        this.store.resume(ref, finish('Active', `${ref} is now Active.`));
        break;
      case 'approveClose':
        // APPROVES THE OUTSTANDING REQUEST rather than calling the request-close endpoint again.
        this.closeStore.approveClose(ref, 'Close request approved.', finish('Closed', `${ref} is now Closed.`));
        break;
    }
  }

  /**
   * Which decision the reason popup is collecting a reason for: asking for a close, or refusing
   * one that was asked for.
   */
  protected readonly closeBoxMode = signal<'request' | 'reject'>('request');

  /** Opens the reason popup with an empty, untouched reason, and focuses the box. */
  protected openCloseRequest(mode: 'request' | 'reject' = 'request'): void {
    this.closeBoxMode.set(mode);
    this.closeReason.set('');
    this.closeReasonTouched.set(false);
    this.lifecycleError.set('');
    this.closeBoxOpen.set(true);
    setTimeout(() => document.getElementById('cd-close-reason')?.focus());
  }

  /** Closes the popup (✕, Cancel, backdrop or Esc). Not while the request is being sent. */
  protected cancelCloseRequest(): void {
    if (this.lifecycleBusy()) {
      return;
    }
    this.closeBoxOpen.set(false);
    this.closeReason.set('');
    this.closeReasonTouched.set(false);
    this.lifecycleError.set('');
  }

  /** Sends the close request with the reason typed in the popup. */
  protected submitCloseRequest(): void {
    this.closeReasonTouched.set(true);
    if (!this.closeReasonValid() || this.lifecycleBusy()) {
      return;
    }
    const ref = this.reference;
    const reason = this.closeReason().trim();

    this.lifecycleBusy.set(true);
    this.lifecycleError.set('');

    // REFUSING A CLOSE: the campaign goes back to Active or Paused, and whoever asked is told why.
    if (this.closeBoxMode() === 'reject') {
      this.store.rejectClose(ref, reason, (result) => {
        this.lifecycleBusy.set(false);
        if (!result.applied) {
          this.lifecycleError.set(result.error ?? 'The close request could not be rejected.');
          return;
        }
        this.closeBoxOpen.set(false);
        this.closeReason.set('');
        this.closeReasonTouched.set(false);
        this.closeStore.load(ref);
        this.toast.show('Close request rejected', `${ref} stays open.`, 'success');
      });
      return;
    }

    this.closeStore.requestClose(ref, 'Close requested', reason, '', reason, (result) => {
      this.lifecycleBusy.set(false);
      if (!result.applied) {
        // Stays inside the popup, so the typed reason is not lost.
        this.lifecycleError.set(result.error ?? 'The close request could not be raised.');
        return;
      }
      this.closeBoxOpen.set(false);
      this.closeReason.set('');
      this.closeReasonTouched.set(false);
      this.store.applyStatus(ref, 'Closing');
      this.store.reload(ref);
      this.toast.show('Close requested', `${ref} is waiting for a close approval.`, 'success');
    });
  }

  /** The header's maker action — Submit / Approve — in its in-place high-risk confirm dialog. */
  protected runPrimaryLifecycle(): void {
    if (!this.operateAllowed()) {
      return;
    }
    this.openOperate();
  }

  // ----- Operate according to lifecycle: high-risk confirm -----
  protected readonly operateDialogOpen = signal(false);
  protected readonly operateReason = signal('');
  protected readonly operateReasonMin = 10;
  protected readonly operateReasonMax = 2000;
  protected readonly operateReasonCount = computed(() => this.operateReason().trim().length);
  protected readonly operateReasonValid = computed(() => {
    const len = this.operateReason().trim().length;
    return len >= this.operateReasonMin && len <= this.operateReasonMax;
  });
  protected readonly operateReasonTouched = signal(false);

  /** Which of primaryTransition / alternateTransitions the dialog currently proposes. */
  protected readonly selectedTransitionKey = signal('primary');
  protected readonly dialogOptions = computed<readonly LifecycleTransition[]>(() => {
    const primary = this.primaryTransition();
    return primary ? [primary, ...this.alternateTransitions()] : this.alternateTransitions();
  });
  protected readonly proposedTransition = computed<LifecycleTransition | null>(
    () =>
      this.dialogOptions().find((t) => t.key === this.selectedTransitionKey()) ?? this.dialogOptions()[0] ?? null,
  );
  /** Before-and-after values for the decision/review region. */
  protected readonly proposedState = computed<CampaignStatus>(
    () => this.proposedTransition()?.target ?? this.status(),
  );
  /** When the confirm dialog was opened - the moment the decision is being taken. */
  protected readonly effectiveTime = signal('');

  protected selectTransition(key: string): void {
    this.selectedTransitionKey.set(key);
  }

  /**
   * Opens the confirm dialog on one of its options.
   *
   * ANY OPTION OPENS IT, not only the primary one: somebody who may reject a submitted campaign
   * and may not approve it still has a decision to record.
   */
  protected openOperate(preselect = 'primary'): void {
    if (
      this.dialogOptions().length === 0 ||
      this.lifecycleUsesDedicatedPage() ||
      this.uiState() === 'no-access'
    ) {
      return;
    }
    this.operateReason.set('');
    this.operateReasonTouched.set(false);
    this.selectedTransitionKey.set(preselect);
    this.effectiveTime.set(this.nowLabel());
    this.operateDialogOpen.set(true);
  }
  protected cancelOperate(): void {
    this.operateDialogOpen.set(false);
  }
  /**
   * Require explicit confirmation; change only the authorised record and show a persistent result.
   * `setStatus` routes to the transition's own endpoint.
   */
  protected confirmOperate(): void {
    this.operateReasonTouched.set(true);
    if (!this.operateReasonValid()) {
      return;
    }
    const transition = this.proposedTransition();
    const target = this.proposedState();
    const reason = this.operateReason().trim();

    const done = (result: { readonly applied: boolean; readonly error?: string }): void => {
      if (!result.applied) {
        this.toast.show('Not changed', result.error ?? 'That change was refused.', 'error');
        return;
      }

      // THE STATE THE SERVER LEFT IT IN, not the one this dialog proposed: an approved campaign
      // whose start date has come goes straight to Active rather than resting in Scheduled.
      const landed = this.store.get(this.reference)?.status ?? target;
      this.toast.show('Lifecycle updated', `${this.reference} is now ${landed}.`, 'success');
    };

    // THE REASON GOES WITH THE TRANSITION. This dialog has always required one and never sent it.
    if (transition?.key === 'reject') {
      this.store.returnToDraft(this.reference, reason, done);
    } else {
      this.store.setStatus(this.reference, target, done, {
        reasonCategory: transition?.label ?? '',
        detailedReason: reason,
      });
    }

    this.operateDialogOpen.set(false);
    this.uiState.set('ready');
  }

  // ================= UI states =================
  protected readonly uiState = signal<UiState>('ready');
  protected setUiState(state: UiState): void {
    this.uiState.set(state);
  }
  protected dismissBanner(): void {
    this.uiState.set('ready');
  }

  // ----- Export this campaign -----
  /**
   * The campaign, as a key-and-value document about THIS campaign, stamped with when it was taken.
   */
  protected exportThisCampaign(): void {
    if (!this.exportAllowed()) {
      return;
    }

    const csvField = (value: string | number | null | undefined): string => {
      const s = String(value ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const takenAt = new Date();
    const rows: readonly (readonly [string, string | number])[] = [
      ['Campaign reference', this.reference],
      ['Campaign name', this.campaignName()],
      ['Status', this.status()],
      ['Owner', this.ownerLine()],
      ['Fund or programme', this.fundProgramme()],
      ['Campaign amount', this.campaignAmountLabel()],
      ['Purpose', this.purpose()],
      ['Start date', this.launchDate()],
      ['End date', this.endDate()],
      ['Channel', this.channelsLabel()],
      ['Location', this.locationLabel()],
      ['Lifecycle activation', this.activationLabel()],
      ['Public description', this.publicDescriptionPlain()],
      ['Terms and notice', this.termsNoticePlain()],
      ['Tracking assets', this.trackingAssets().length],
      ['Exported on', takenAt.toLocaleString('en-IN')],
      ['Exported by', this.currentUser.current().name],
    ];

    const csv = [
      ['Field', 'Value'].join(','),
      ...rows.map(([field, value]) => [csvField(field), csvField(value)].join(',')),
    ].join('\n');

    const stamp = takenAt.toISOString().slice(0, 10);

    this.saveFile(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      'campaign-' + this.reference + '-' + stamp + '.csv');
  }

  /** The two rich-text fields as plain text, so a spreadsheet cell does not fill with markup. */
  private readonly publicDescriptionPlain = computed(
    () => this.liveRecord()?.publicDescription?.trim() || '',
  );
  private readonly termsNoticePlain = computed(
    () => this.liveRecord()?.termsNotice?.trim() || '',
  );

  /** Hand a blob to the browser under a given name. */
  private saveFile(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = fileName;
    link.click();

    URL.revokeObjectURL(url);
  }

  // ----- Delete draft (permanent removal of an unused draft) -----
  protected readonly deleteDraftDialogOpen = signal(false);
  protected openDeleteDraft(): void {
    if (!this.canDeleteDraft()) {
      return;
    }
    this.deleteDraftDialogOpen.set(true);
  }
  protected cancelDeleteDraft(): void {
    this.deleteDraftDialogOpen.set(false);
  }
  /** Permanently remove the draft from the shared store, then return to the campaign register. */
  protected confirmDeleteDraft(): void {
    if (!this.canDeleteDraft()) {
      return;
    }
    this.store.delete(this.reference);
    this.deleteDraftDialogOpen.set(false);
    this.router.navigate(['/app/fundraising/campaigns/campaign-register']);
  }

  // ================= Formatting helpers =================
  protected formatAmount(value: number): string {
    return '₹' + value.toLocaleString('en-IN');
  }
  protected formatDate(iso: string): string {
    if (!iso) {
      return '—';
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  protected statusClass(status: CampaignStatus): string {
    switch (status) {
      case 'Draft':
        return 'cd-badge-draft';
      case 'Submitted':
        return 'cd-badge-submitted';
      case 'Approved':
        return 'cd-badge-approved';
      case 'Scheduled':
        return 'cd-badge-scheduled';
      case 'Active':
        return 'cd-badge-active';
      case 'Paused':
        return 'cd-badge-paused';
      case 'Closing':
        return 'cd-badge-closing';
      case 'Closed':
        return 'cd-badge-closed';
      case 'Cancelled':
        return 'cd-badge-cancelled';
    }
  }

  protected getLifecycleIcon(key: string): string {
    switch (key) {
      case 'activate':
        return 'ri-play-circle-line';
      case 'pause':
        return 'ri-pause-circle-line';
      case 'resume':
        return 'ri-play-circle-line';
      case 'requestClose':
        return 'ri-close-circle-line';
      case 'approveClose':
      case 'close':
        return 'ri-lock-line';
      case 'rejectClose':
      case 'reject':
        return 'ri-arrow-go-back-line';
      case 'cancel':
        return 'ri-close-line';
      case 'reopen':
        return 'ri-refresh-line';
      default:
        return 'ri-arrow-right-line';
    }
  }
}