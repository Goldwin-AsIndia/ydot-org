import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { Subject, Subscription, forkJoin, catchError, debounceTime, distinctUntilChanged, map, of } from "rxjs";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { DonorApiService } from "../../../../Service/donor-api.service";
import { apiErrorMessage } from "../../../../Shared/models/api-response.model";
import {
  DonLookupItem,
  FollowUp as ApiFollowUp,
  FollowUpQueueFilter,
  FollowUpQueuePulse,
  FollowUpQueueResponse,
  FollowUpQueueSummary,
  FollowUpQueueView,
  QueueView as CountedView,
} from "../../../../Shared/models/donor-contract.model";
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
import { AuthTokenService } from '../../../../Shared/services/auth-token.service';
import { SafeResourceUrl, SafeUrl } from "@angular/platform-browser";
import { FollowUpAttachmentStore, mimeFromName } from "../../../../Service/follow-up-attachment-store.service";

/** How an attachment is shown in the viewer, chosen from its own format. */
export type AttachmentKind = "pdf" | "image" | "text" | "office" | "other";

/** The open attachment viewer. */
export interface AttachmentViewer {
  followUpId: string;
  name: string;
  kind: AttachmentKind;
  loading: boolean;

  /** True when the original file is not kept on this device. */
  missing: boolean;
  type: string;
  sizeLabel: string;
  objectUrl: string | null;
  frameUrl: SafeResourceUrl | null;
  imageUrl: SafeUrl | null;
}
export type RecordType = "Lead" | "Donor";
/**
 * The channel a follow-up is planned on, in this screen's words: Call, Email, SMS, WhatsApp or
 * Post. One per consent channel the API has - the list used to include Meeting, Task and Site
 * Visit, which no follow-up can be, so three filter chips and a whole tab matched nothing.
 */
export type FollowUpType = string;

/** The API's priority: Low, Normal, High or Urgent. (It has never had a "Medium".) */
export type Priority = string;

/**
 * What a row's status badge reads.
 *
 * FIVE WORDS FOR THE SERVER'S STATE, and the mapping is in `toQueueRow`. The API has Planned,
 * Assigned, Rescheduled, Completed and Cancelled, and records an escalation as a fact about the
 * follow-up rather than a status. "Pending" is this screen's word for planned-or-assigned work.
 *
 * NOTHING IS DECIDED FROM THIS WORD. Whether a follow-up is open, overdue or the caller's to act
 * on comes from the server's own flags on the row - the screen used to test for "Pending", which
 * the API never sends, so every count of open work on this page was zero.
 */
export type FollowUpStatus = string;
/** Executed or cancelled - no longer work to do. The server's open flag, carried on the agenda item. */
export const isClosedStatus = (item: { isOpen: boolean }): boolean => !item.isOpen;
export type DependencyStatus = "Ready" | "Blocked";
export type SlaStatus = "On Time" | "Approaching" | "Breached";
export type QueueView = "grid" | "kanban" | "calendar";

export interface HistoryEvent {
  date: string;
  label: string;
}

export interface FollowUp {
  id: string;
  /** The human-readable reference (FU-…). `id` is the GUID the API writes against. */
  reference: string;
  recordId?: string;
  recordName: string;
  recordType: RecordType;
  followUpType: FollowUpType;
  scheduledDate: string;
  scheduledTime: string;
  priority: Priority;
  status: FollowUpStatus;
  dependencyStatus: DependencyStatus;
  dependencyBlockedReason?: string;
  slaStatus: SlaStatus;
  assignedTo: string;
  assignedToInitials: string;
  campaign: string;
  phone: string;
  email: string;
  purpose: string;
  expectedOutcome: string;
  successCriteria: string;
  lastCommunicationType?: string;
  lastCommunicationOutcome?: string;
  lastCommunicationDate?: string;
  reminderSettings: string;
  notes: string;
  attachments: string[];
  history: HistoryEvent[];
  /** The server's row version. Every write on this screen sends it back for the concurrency check. */
  version: number;
    /** What the caller may do to THIS follow-up, as the server decided it. */
  permittedActions: readonly string[];

  /** Still to be done. */
  isOpen: boolean;

  /** Open and due before today, by the organisation's calendar. */
  isOverdue: boolean;

  /** Overdue | Due Today | Tomorrow | Upcoming | None while open; Completed today | Closed after. */
  dueState: string;

  /** Assigned to the caller. Only the assignee may execute, reschedule or cancel it. */
  isMine: boolean;
  escalated: boolean;

  /**
   * Who owns the lead or donor this is about - not necessarily who the follow-up is assigned to.
   * An owner sees a colleague's follow-up on their record, to view; they cannot execute it.
   */
  recordOwner: string;

  /** How the execution went, once it has been executed - the executor's own classification. */
  executionStatus: string;
  completionReason: string;
  disposition: string;

  /** The board column the server put it in, or null for none. */
  boardColumn: string | null;
}

export interface SavedView {
  id: string;
  label: string;
  /** Tab text, when the full label is too long for one line of tabs. */
  short?: string;
  /** Draws a hairline before the tab, opening a new group (focus, channels). */
  groupStart?: boolean;
}

export interface CalendarDay {
  date: string;
  label: string;
  dayNumber: string;
  count: number;
}

export interface AgendaItem {
  time: string;
  title: string;
  name: string;
  type: FollowUpType;
  status: FollowUpStatus;
  followUpId: string;
  isOpen: boolean;
}

export interface KpiTile {
  key: string;
  label: string;
  value: number;
  hint: string;
  icon: string;
  tone: "info" | "ok" | "danger" | "violet" | "warn";
}

/**
 * OWNERS - REMOVED as a constant.
 *
 * It listed four names compiled into the bundle, so every organisation's Reassign and Escalate
 * dropdowns offered the same four strangers - and reassigning to one of them wrote a name that
 * matched no user account. The owners now come from the API's `ownerOptions`, which are real
 * users inside the caller's scope.
 */

/**
 * SAVED_VIEWS - REMOVED as a constant. The tabs are the server's `views`, each with its words,
 * its group and its count, and a tab's value is sent back as `view`.
 */

/** The icon and tone each headline tile is drawn in - presentation only. */
const TILE_LOOK: Readonly<Record<string, { icon: string; tone: KpiTile["tone"] }>> = {
  today: { icon: "clock", tone: "info" },
  upcoming: { icon: "calendar", tone: "ok" },
  overdue: { icon: "alert", tone: "danger" },
  completedToday: { icon: "check-circle", tone: "violet" },
  escalated: { icon: "flag", tone: "warn" },
};

/** The tone each age bucket's column is drawn in, by its place - presentation only. */
const AGE_TONES = ["hot", "warm", "ok", "ok"] as const;

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/**
 * MOCK_FOLLOW_UPS - REMOVED.
 *
 * It was an array of fabricated follow-ups compiled into the bundle and pushed into
 * `WorkflowStateService` on construction, so every organisation saw the same queue, every
 * reschedule was forgotten on refresh, and the counts across the top counted the file.
 */

function buildCalendarStrip(
  centerIso: string,
  dayCounts: Readonly<Record<string, number>>,
): CalendarDay[] {
  const days: CalendarDay[] = [];
  const center = new Date(centerIso + "T00:00:00");
  for (let i = -3; i <= 3; i++) {
    const d = new Date(center);
    d.setDate(center.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // THE SERVER'S COUNT FOR THE DAY, over the whole scope, cancelled follow-ups left out.
    const count = dayCounts[iso] ?? 0;
    days.push({
      date: iso,
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      dayNumber: String(d.getDate()),
      count,
    });
  }
  return days;
}

/** Minutes past midnight for "14:30" (what `toTimeInput` produces) or "2:30 PM". */
function to24h(time: string): number {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(time);
  if (!match) return 0;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3]?.toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** A server view's value - mine, today, overdue, upcoming, completedToday, high, attention, escalated, calls. */
type QuickFilterKey = string | null;

interface GeneralFilters {
  status: Set<FollowUpStatus>;
  type: Set<FollowUpType>;
  priority: Set<Priority>;
  owner: string | null;
  campaign: string | null;
  dateFrom: string | null;
  dateTo: string | null;
}

type ModalKind =
  | "reschedule"
  | "reassign"
  | "cancel"
  | "escalate"
  | "history"
  | "complete";

interface ActiveModal {
  kind: ModalKind;
  ids: string[];
}

const now = new Date();
const TODAY_ISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

function emptyFilters(): GeneralFilters {
  return {
    status: new Set(),
    type: new Set(),
    priority: new Set(),
    owner: null,
    campaign: null,
    dateFrom: null,
    dateTo: null,
  };
}

/**
 * The execution screen writes the uploaded file names as the last line of the notes -
 * "Attachments: a.pdf, b.png" - because the server keeps the notes but not `attachmentName`
 * (TS-138). This splits that line off: the notes to show, and the file names.
 */
function splitAttachmentLine(text: string): { text: string; files: string[] } {
  const match = /\n*\s*Attachments:\s*(.+)\s*$/.exec(text ?? "");
  if (!match) return { text: (text ?? "").trim(), files: [] };
  return { text: text.slice(0, match.index).trim(), files: splitFileNames(match[1]) };
}

/** Everything the execution screen records, as the queue's side panel shows it. */
export interface ExecutionReport {
  channel: string;
  executedAt: string;
  executedBy: string;
  executionStatus: string;
  completionReason: string;
  outcome: string;
  engagement: string;
  quality: string;
  notes: string;
  internalNotes: string;
  temperature: string;
  disposition: string;
  files: string[];
}

/**
 * Split the stored `attachmentName` text back into file names (TS-138).
 *
 * A FILE NAME CAN HOLD A COMMA. "ChatGPT Image Sep 5, 2026, 11_34_56 PM.pdf" split on every comma
 * came out as three "files" - "ChatGPT Image Sep 5", "2026", "11_34_56 PM.pdf". So the text is read
 * name by name up to each file extension the upload accepts, and the separator after it ("," or
 * "|" or ";"). Text with no recognisable extension falls back to a plain comma split.
 */
function splitFileNames(text: string): string[] {
  const byExtension = [
    ...text.matchAll(/\s*(.+?\.(?:pdf|docx?|png|jpe?g|xlsx?|csv|txt))(?=\s*(?:[,|;]|$))[\s,|;]*/gi),
  ].map((m) => m[1].trim());
  if (byExtension.length) return byExtension.filter(Boolean);
  return text.split(/[,|;]/).map((part) => part.trim()).filter(Boolean);
}

/**
 * The file names attached to a follow-up (TS-138). The API has carried them in different shapes:
 * an `attachments` array of names or of `{ name | fileName }` objects, and - what the execution
 * screen sends on completion - one comma-separated `attachmentName` (also read from the newest
 * execution / interaction the row carries, if any). Duplicates are dropped.
 */
function attachmentNames(item: ApiFollowUp): string[] {
  const raw = item as unknown as Record<string, unknown>;
  const names: string[] = [];
  const add = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(add);
    } else if (typeof value === "string") {
      splitFileNames(value).forEach((n) => names.push(n));
    } else if (typeof value === "object") {
      const o = value as Record<string, unknown>;
      add(o["name"] ?? o["fileName"] ?? o["originalFileName"] ?? o["attachmentName"]);
    }
  };
  add(raw["attachments"]);
  add(raw["attachmentNames"]);
  add(raw["attachmentName"]);
  add(raw["completionAttachmentName"]);
  const execution = (raw["execution"] ?? raw["lastExecution"] ?? raw["lastInteraction"]) as
    | Record<string, unknown>
    | undefined;
  if (execution) {
    add(execution["attachments"]);
    add(execution["attachmentName"]);
  }
  return [...new Set(names)];
}

/** TS-136 reschedule messages. */
const RESCHEDULE_PAST_DATE = "Choose today or a later date";
const RESCHEDULE_PAST_TIME = "Choose a time later than now";
const RESCHEDULE_UNCHANGED = "Pick a new date or time to reschedule";

@Component({
  selector: "app-follow-up-queue",
  standalone: true,
  imports: [RowsPerPage, PageHeader, CommonModule, FormsModule],
  templateUrl: "./follow-up-queue.html",
  styleUrls: ["./follow-up-queue.css"],
})
export class FollowUpQueueComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DonorApiService);
  private readonly tokens = inject(AuthTokenService);
  private readonly attachmentStore = inject(FollowUpAttachmentStore);
  /** The organisation's today, yyyy-mm-dd - the server's, once it has answered. */
  today = TODAY_ISO;

  /** The whole answer for the current filters: rows, tabs, tiles, pulse and option lists. */
  private readonly queue = signal<FollowUpQueueResponse | null>(null);

  /** The tabs - the server's views, with their words and groups. */
  readonly savedViews = computed<SavedView[]>(() => {
    const views: readonly FollowUpQueueView[] = this.queue()?.views ?? [];
    return views.map((view, index) => ({
      id: view.value,
      label: view.label,
      short: view.shortLabel,
      groupStart: index > 0 && views[index - 1].group !== view.group,
    }));
  });

  /** Real users, from the API. `value` is the user id the write needs; `label` is the name. */
  readonly ownerOptions = computed<readonly DonLookupItem[]>(() => this.queue()?.ownerOptions ?? []);
  readonly owners = computed(() => this.ownerOptions().map((option) => option.label));

  /** The people the caller's follow-ups are assigned to now - the Owner filter's choices. */
  private readonly assigneeOptions = computed<readonly DonLookupItem[]>(() => this.queue()?.assigneeOptions ?? []);
  readonly assignees = computed(() => this.assigneeOptions().map((option) => option.label));

  /** The server's status words: Pending, Rescheduled, Escalated, Completed and so on. */
  readonly statusOptions = computed<FollowUpStatus[]>(() => (this.queue()?.statusOptions ?? []).map((option) => option.value));

  /** The channels a follow-up can be planned on, in the server's words (Call, SMS...). */
  private readonly channelOptions = computed<readonly DonLookupItem[]>(() => this.queue()?.channelOptions ?? []);
  readonly typeOptions = computed<FollowUpType[]>(() => this.channelOptions().map((option) => option.label));

  /** Low, Normal, High, Urgent - the API's priorities. */
  readonly priorityOptions = computed<Priority[]>(() => (this.queue()?.priorityOptions ?? []).map((option) => option.value));

  /** The queue's figures over the caller's whole scope, counted by the server. */
  readonly summary = computed<FollowUpQueueSummary | null>(() => this.queue()?.summary ?? null);

  /** The pulse panel, agenda and date rail - the server's, over the whole scope. */
  private readonly pulse = computed<FollowUpQueuePulse | null>(() => this.queue()?.pulse ?? null);

  /** How many follow-ups the filters matched, by the server's count. */
  readonly totalCount = computed(() => this.queue()?.totalCount ?? 0);

  /** The orders the queue can be read in. */
  readonly sortOptions = computed<readonly DonLookupItem[]>(() => this.queue()?.sortOptions ?? []);

  /** What the caller may do on this screen at all: the server's verbs for the queue. */
  private readonly queueActions = computed<readonly string[]>(() => this.queue()?.permittedActions ?? []);
  readonly canSchedule = computed(() => this.queueActions().includes("Schedule follow-up"));
  readonly canExport = computed(() => this.queueActions().includes("Export"));
  readonly canComplete = computed(() => this.queueActions().includes("Mark complete"));
  readonly canReschedule = computed(() => this.queueActions().includes("Reschedule"));
  readonly canCancel = computed(() => this.queueActions().includes("Cancel task"));
  readonly canAssign = computed(() => this.queueActions().includes("Assign"));

  /**
   * Whether this caller may VIEW and DOWNLOAD a document attached to a follow-up.
   *
   * RESTRICTED TO FOUR ROLES, by request: Fundraiser Executive (FUNDRAISER_EXECUTIVE),
   * Fundraising Manager (FUNDRAISING_MANAGER), Platform Admin (SUPER_ADMIN) and Organisation
   * Admin (TENANT_ADMIN). Every other role reads the file's name and nothing more - DonorCare,
   * the campaign roles and a plain staff user see "Attachments" with no way to open or take one.
   * This is the screen's courtesy check; a real fetch is re-checked by the API, so a hand-edited
   * client gains nothing the server would not already grant.
   */
  readonly canViewDownloadAttachment = computed(() => {
    if (this.tokens.isSuperAdmin() || this.tokens.isTenantAdmin()) return true;
    const roles = this.tokens.roles();
    return roles.includes("FUNDRAISER_EXECUTIVE") || roles.includes("FUNDRAISING_MANAGER");
  });

  /** "Your whole organisation", or the caller's own follow-ups - the server's description. */
  readonly scopeLabel = computed(() => this.queue()?.activeScope ?? "");

  /** The campaigns the caller's follow-ups belong to - the server's list over the whole scope. */
  readonly campaigns = computed(() => (this.queue()?.campaignOptions ?? []).map((option) => option.label));

  private readonly followUps = signal<FollowUp[]>([]);

  readonly viewMode = signal<QueueView>("grid");
  readonly searchTerm = signal("");
  readonly filtersOpen = signal(false);
  readonly activeFilters = signal<GeneralFilters>(emptyFilters());
  readonly draftFilters = signal<GeneralFilters>(emptyFilters());
  readonly activeSavedViewId = signal<string | null>(null);
  readonly activeQuickFilter = signal<QuickFilterKey>(null);
  readonly calendarCenterDate = signal<string>(TODAY_ISO);
  readonly selectedStripDate = signal<string | null>(null);
  readonly calendarMonthCursor = signal<string>(TODAY_ISO.slice(0, 7) + "-01");
  readonly calendarSelectedDate = signal<string | null>(null);

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly previewId = signal<string | null>(null);
  readonly activeModal = signal<ActiveModal | null>(null);
  readonly toastMessage = signal<string | null>(null);
  readonly openActionMenuId = signal<string | null>(null);
  private toastTimer: any = null;

  readonly rescheduleDate = signal("");
  readonly rescheduleTime = signal("");
  readonly rescheduleReason = signal("");
  readonly reassignOwner = signal("");
  readonly reassignReason = signal("");
  readonly cancelReason = signal("");
  readonly escalateTo = signal("");
  readonly escalateReason = signal("");
  readonly escalateNotes = signal("");
  readonly completionNote = signal("");
  readonly recordFilterId = signal(
    this.route.snapshot.queryParamMap.get("donorId") ??
      this.route.snapshot.queryParamMap.get("leadId"),
  );

  private readonly searchChanges = new Subject<void>();
  private loadSubscription?: Subscription;

  constructor() {
    this.searchChanges
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.load());

    // THE ADDRESS DECIDES WHOSE FOLLOW-UPS THIS IS, EVERY TIME IT CHANGES. Opening the queue from a
    // lead or a donor (`?leadId=`) and then from the menu (no query) is the same route, so Angular
    // keeps this component alive: the old person stayed in the list until the screen was
    // rebuilt. Reload whenever the person named in the address changes (and once at the start).
    this.route.queryParamMap
      .pipe(
        map((params) => ({
          person: `${params.get("donorId") ?? ""}|${params.get("leadId") ?? ""}`,
          // BACK FROM EXECUTION / ESCALATION (TS-128). The execution screen returns naming the
          // follow-up it just changed. If Angular kept this screen alive the counts were never
          // re-read, so the Escalated tile stayed where it was: a returning id reloads too. The
          // address clean-up that follows (id removed, same person) does not.
          returning: params.get("highlightId") ?? params.get("followUpId"),
        })),
        distinctUntilChanged((prev, next) => prev.person === next.person && !next.returning),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.recordFilterId.set(
          this.route.snapshot.queryParamMap.get("donorId") ??
            this.route.snapshot.queryParamMap.get("leadId"),
        );
        // A different list: a panel left open on the old one does not carry over.
        this.previewId.set(null);
        this.load();
      });
  }

  readonly loading = signal(false);
  readonly loadError = signal("");

  /**
   * The follow-ups the filters match, and everything counted about the caller's whole scope.
   *
   * THE SERVER FILTERS, SORTS AND COUNTS. The role flow decides whose follow-ups these are
   * (Fundraising Manager and Executive: the organisation's; DonorCare: their own, and to view only
   * the ones a colleague holds on a record they own). The screen used to download every page and
   * apply its own status words, tab rules and tile counts to them - so the Escalated tile and the
   * Escalated tab disagreed, and an executed follow-up always read "Completed". The queue endpoint
   * answers the filtered rows (all of them: the board and the calendar lay the whole set out),
   * with the tabs, tiles and pulse panel counted by the rules it filtered by.
   *
   * A record named in the address (from Donor 360 or a lead) narrows the rows and every figure.
   */
  private load(): void {
    this.loading.set(true);
    this.loadError.set("");

    this.loadSubscription?.unsubscribe();
    this.loadSubscription = this.api.getFollowUpQueue(this.buildFilter()).subscribe({
      next: (response) => {
        this.queue.set(response);
        this.today = response.today || TODAY_ISO;
        this.followUps.set(response.followUps.map((item) => this.toQueueRow(item)));

        // Fresh rows: files fetched for a panel earlier may have changed.
        this.drawerFilesAsked.clear();
        this.drawerReports.set({});

        // The words the execution screen offered, so the panel prints "Information requested"
        // rather than the stored value "InformationRequested".
        this.rememberLabels(response as unknown as Record<string, unknown>);
        this.loading.set(false);

        if (response.isTruncated) {
          this.showToast(`Showing the first ${response.followUps.length} of ${response.totalCount} follow-ups. Narrow the filters to see the rest.`);
        }

        // A selection can outlive the rows it was made on.
        const ids = new Set(response.followUps.map((item) => item.id));
        this.selectedIds.update((current) => new Set([...current].filter((id) => ids.has(id))));

        // A follow-up named in the address (just scheduled, or opened from elsewhere) opens its
        // panel ONCE. The address is then cleaned, so a refresh or a trip back to this screen
        // shows the list, not a panel nobody asked for.
        const requestedId = this.route.snapshot.queryParamMap.get("followUpId");
        const highlighted = this.route.snapshot.queryParamMap.get("highlightId");
        if (highlighted) this.highlightId.set(highlighted);
        const wantsReschedule = this.route.snapshot.queryParamMap.get("action") === "reschedule";
        if (requestedId || highlighted) {
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { followUpId: null, action: null, highlightId: null },
            queryParamsHandling: "merge",
            replaceUrl: true,
          });
        }
        if (requestedId) {
          const requested = this.followUps().find((item) => item.id === requestedId);

          // BACK FROM EXECUTION IS NOT A REQUEST TO SEE THE DETAILS (TS-133): a follow-up that is
          // no longer open is highlighted instead; only an OPEN one opens its panel.
          if (requested && !requested.isOpen) {
            this.highlightId.set(requestedId);
          } else if (requested) {
            this.previewId.set(requestedId);
            if (wantsReschedule) {
              queueMicrotask(() => this.openReschedule(requestedId));
            }
          }
        }
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.loadError.set(apiErrorMessage(error));
        this.showToast(this.loadError());
      },
    });
  }

  /** The person in the address, the tab or tile, the panel's filters, the day and the order. */
  private buildFilter(): FollowUpQueueFilter {
    const donorId = this.route.snapshot.queryParamMap.get("donorId");
    const leadId = donorId ? null : this.route.snapshot.queryParamMap.get("leadId");
    const filters = this.activeFilters();
    const channelValue = (label: string) =>
      this.channelOptions().find((option) => option.label === label)?.value ?? label;
    const assignee = filters.owner
      ? this.assigneeOptions().find((option) => option.label === filters.owner)?.value ?? null
      : null;
    const list = (values: Iterable<string>) => [...values].join(",") || null;

    return {
      donorId,
      leadId,
      search: this.searchTerm().trim() || null,
      view: this.activeQuickFilter(),
      statuses: list(filters.status),
      channels: list([...filters.type].map(channelValue)),
      priorities: list(filters.priority),
      assignedToUserId: assignee,
      campaign: filters.campaign,
      dueFrom: filters.dateFrom,
      dueTo: filters.dateTo,
      dueOn: this.selectedStripDate(),
      sort: this.sortOrder() || null,
    };
  }

  /**
   * Maps the API's follow-up onto the row this screen draws.
   *
   * THE DUE DATE ARRIVES AS ONE UTC INSTANT and the grid shows a date and a time separately, so
   * it is split here rather than stored twice. Splitting in local time is deliberate: a follow-up
   * due at 09:00 for a fundraiser in Chennai should read 09:00 to them.
   */
  private toQueueRow(item: ApiFollowUp): FollowUp {
    const due = item.dueAtUtc ? new Date(item.dueAtUtc) : null;
    const isLead = !item.donorId && !!item.leadId;
    const owner = item.relationshipOwnerName ?? "Unassigned";

    return {
      id: item.id,
      reference: item.followUpReference || item.id,

      // A donor first: a follow-up on a converted lead's donor is about the donor now.
      recordId: item.donorId ?? item.leadId ?? undefined,

      // THE PERSON'S NAME. This used to fall back to the lead's reference number, so every lead
      // follow-up in the queue was titled "LED-2026-000019" rather than with who to call.
      recordName:
        item.recordDisplayName ??
        item.donorDisplayName ??
        item.leadDisplayName ??
        item.leadReference ??
        item.followUpReference,
      recordType: isLead ? "Lead" : "Donor",

      // THE CHANNEL IS THE PERMITTED ONE, not a preference. The server refuses a follow-up on a
      // channel the donor has withdrawn consent for, so this is already the allowed answer.
      followUpType: this.channelLabel(item.permittedChannel),
      scheduledDate: due ? this.toDateInput(due) : "",
      scheduledTime: due ? this.toTimeInput(due) : "",
      priority: item.priority,
      // THE SERVER'S STATUS WORD - it reads the execution outcome from the enum, so a follow-up
      // executed as "No response" says so instead of "Completed".
      status: item.queueStatus,

      // A CONSENT WARNING IS A BLOCKER. The document's queue shows a dependency state; the real
      // dependency on a follow-up is whether the donor may be contacted on that channel at all.
      dependencyStatus:
        item.consentWarning?.hasWarning && !item.consentWarningAcknowledged
          ? "Blocked"
          : "Ready",
      dependencyBlockedReason: item.consentWarning?.hasWarning
        ? item.consentWarning.message
        : undefined,
      slaStatus: this.toSlaStatus(item),
      assignedTo: owner,
      assignedToInitials: initials(owner),
      campaign: item.campaignName ?? "",

      // MASKED BY THE SERVER unless the caller holds the sensitive-contact permission.
      phone: item.contactPhone ?? "",
      email: item.contactEmail ?? "",
      purpose: item.purpose ?? "",
      expectedOutcome: item.nextAction ?? "",
      successCriteria: "",
      // The executor's notes without the "Attachments:" line the execution screen adds (TS-138).
      lastCommunicationOutcome: splitAttachmentLine(item.completionOutcome ?? "").text || undefined,
      reminderSettings: "",
      notes: item.isNotesMasked ? "" : (item.notes ?? ""),
      // THE FILES UPLOADED AT EXECUTION. They were stored on the task at completion but the row
      // dropped them, so the detail panel's Attachments section never drew anything (BUG-106).
      // TS-138: the execution screen records the file names in `attachmentName` (comma-separated)
      // on the completed task; read that as well as an `attachments` list, whichever the API sends.
      attachments: [
        ...new Set([...attachmentNames(item), ...splitAttachmentLine(item.completionOutcome ?? "").files]),
      ],

      // WHAT HAPPENED TO IT, AND WHO DID IT - the server's trail, newest first.
      history: (item.history ?? []).map((entry) => ({
        date: new Date(entry.occurredAtUtc).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        label: [entry.action, entry.detail, entry.actorName ? `by ${entry.actorName}` : ""]
          .filter(Boolean)
          .join(" · "),
      })),
      version: item.version,
      permittedActions: item.permittedActions ?? [],
      isOpen: item.isOpen,
      isOverdue: item.isOverdue,
      dueState: item.dueState,
      isMine: item.isAssignedToMe,
      escalated: !!item.escalatedAtUtc,
      recordOwner: item.recordOwnerName ?? "",
      executionStatus: item.executionStatus ?? "",
      completionReason: item.completionReason ?? "",
      disposition: item.disposition ?? "",
      boardColumn: item.boardColumn,
    };
  }

  /** What the executor recorded - "Partially completed", "No response" - or empty before execution. */
  executionLabel(f: FollowUp): string {
    return (f.executionStatus || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (m, c) => " " + c.toLowerCase());
  }

  /** A channel in the server's words for it (PhoneCall is "Call"). */
  private channelLabel(channel: string): FollowUpType {
    return this.channelOptions().find((option) => option.value === channel)?.label ?? channel;
  }

  /**
   * On time / approaching / breached - read off the server's due state.
   *
   * THE SERVER SAYS WHERE A FOLLOW-UP STANDS, by the organisation's calendar day, and the tiles
   * above count by the same days. This used to be worked out here from the browser's clock, so
   * the SLA panel, the Overdue tile and the row's own badge could each give a different answer.
   */
  private toSlaStatus(item: ApiFollowUp): SlaStatus {
    if (item.isOverdue) return "Breached";
    return item.isOpen && item.dueState === "Due Today" ? "Approaching" : "On Time";
  }

  private toDateInput(value: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  private toTimeInput(value: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  /** A date and a time from the form, back into the UTC instant the API stores. */
  private toDueUtc(date: string, time: string): string {
    return new Date(`${date}T${time || "09:00"}`).toISOString();
  }

  private followUpById(id: string): FollowUp | undefined {
    return this.followUps().find((item) => item.id === id);
  }

  /** The rows the filters matched - the server's set, exactly; nothing is filtered here. */
  readonly filteredFollowUps = computed<FollowUp[]>(() => this.followUps());

  readonly pageSize = signal(10);

  setPageSize(n: number): void { this.pageSize.set(n); this.currentPage.set(1); }
  /** The chosen order, as the server names it; empty is its default. */
  readonly sortOrder = signal("");

  /** The order's words, for the panel's subtitle. */
  readonly sortLabel = computed(() => {
    const options = this.sortOptions();
    return (options.find((option) => option.value === this.sortOrder()) ?? options[0])?.label ?? "";
  });

  setSort(value: string): void {
    this.sortOrder.set(value);
    this.load();
  }

  /** The follow-up just completed: it is shown first and highlighted until the page is left. */
  readonly highlightId = signal<string | null>(null);

  /**
   * The rows in the server's order, with the follow-up just completed pinned first and
   * highlighted until the page is left.
   */
  readonly sortedFollowUps = computed(() => {
    const pinned = this.highlightId();
    const rows = this.filteredFollowUps();
    if (!pinned) return rows;
    return [...rows.filter((f) => f.id === pinned), ...rows.filter((f) => f.id !== pinned)];
  });

  /** Set when the side panel's backdrop is clicked: the X pulses to say that is the way out. */
  readonly nudgeClose = signal(false);
  private nudgeTimer: any = null;
  nudgeCloseButton() {
    this.nudgeClose.set(true);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => this.nudgeClose.set(false), 900);
  }
  readonly currentPage = linkedSignal({
    source: this.sortedFollowUps,
    computation: () => 1,
  });
  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.sortedFollowUps().length / this.pageSize())),
  );
  readonly pagedFollowUps = computed(() =>
    this.sortedFollowUps().slice(
      (this.currentPage() - 1) * this.pageSize(),
      this.currentPage() * this.pageSize(),
    ),
  );
  readonly pageStart = computed(() =>
    this.sortedFollowUps().length
      ? (this.currentPage() - 1) * this.pageSize() + 1
      : 0,
  );
  readonly pageEnd = computed(() =>
    Math.min(this.currentPage() * this.pageSize(), this.sortedFollowUps().length),
  );
  readonly pageNumbers = computed(() => {
    const start = Math.max(
      1,
      Math.min(this.currentPage() - 2, this.totalPages() - 4),
    );
    return Array.from(
      { length: Math.min(5, this.totalPages()) },
      (_, i) => start + i,
    );
  });
  goToPage(page: number): void {
    this.currentPage.set(Math.max(1, Math.min(this.totalPages(), page)));
    this.closeActionMenu();
  }
  readonly ownerSearch = signal("");
  readonly campaignSearch = signal("");
  readonly reassignSearch = signal("");
  readonly escalateSearch = signal("");
  matchingOptions(
    options: readonly string[],
    query: string,
    selected = "",
  ): readonly string[] {
    const term = query.trim().toLowerCase();
    return options.filter(
      (option) => option === selected || option.toLowerCase().includes(term),
    );
  }

  // THE HEADLINE FIGURES ARE THE SERVER'S, over the caller's whole scope. They were counted here
  // from one page of rows, by a status the API does not have.
  readonly kpiOverdue = computed(() => this.summary()?.overdue ?? 0);
  readonly overduePercent = computed(() => this.summary()?.overduePercent ?? 0);
  readonly queueHealth = computed(() => this.summary()?.health ?? "Healthy");

  /** The board's columns - the server's, each holding the rows the server put in it. */
  readonly kanbanColumns = computed(() => {
    const list = this.filteredFollowUps();
    return (this.queue()?.boardColumns ?? []).map((column) => ({
      key: column.value,
      label: column.label,
      items: list.filter((f) => f.boardColumn === column.value),
    }));
  });

  readonly calendarWeeks = computed(() => {
    const cursor = new Date(this.calendarMonthCursor() + "T00:00:00");
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - startOffset);

    const list = this.filteredFollowUps();
    const weeks = [];
    let cell = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const iso = this.toDateInput(cell);
        week.push({
          iso,
          dayNumber: cell.getDate(),
          inMonth: cell.getMonth() === month,
          items: list.filter((f) => f.scheduledDate === iso),
        });
        cell.setDate(cell.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  });

  readonly calendarMonthLabel = computed(() =>
    new Date(this.calendarMonthCursor() + "T00:00:00").toLocaleDateString(
      "en-US",
      { month: "long", year: "numeric" },
    ),
  );

  readonly previewFollowUp = computed<FollowUp | null>(() => {
    const id = this.previewId();
    return id ? (this.followUps().find((f) => f.id === id) ?? null) : null;
  });

  readonly allVisibleSelected = computed(() => {
    const visible = this.pagedFollowUps();
    if (!visible.length) return false;
    const sel = this.selectedIds();
    return visible.every((f) => sel.has(f.id));
  });

  readonly calendarStrip = computed<CalendarDay[]>(() =>
    buildCalendarStrip(this.calendarCenterDate(), this.pulse()?.dayCounts ?? {}),
  );

  /** Today's follow-ups by time (cancelled left out) - the server's agenda, at most five. */
  readonly agendaToday = computed<AgendaItem[]>(() =>
    (this.pulse()?.agendaToday ?? []).map((item) => {
      const due = item.dueAtUtc ? new Date(item.dueAtUtc) : null;
      return {
        time: due ? this.toTimeInput(due) : "",
        title: `${item.channelLabel} \u00b7 ${item.recordName}`,
        name: item.recordName,
        type: item.channelLabel,
        status: item.queueStatus,
        followUpId: item.id,
        isOpen: item.isOpen,
      };
    }),
  );

  /** Every follow-up due today (not only the five shown) - done plus to do. */
  readonly agendaTotal = computed(() => (this.pulse()?.agendaDone ?? 0) + (this.pulse()?.agendaLeft ?? 0));
  readonly agendaDone = computed(() => this.pulse()?.agendaDone ?? 0);
  readonly agendaLeft = computed(() => this.pulse()?.agendaLeft ?? 0);

  /** What is coming up after today, filling the agenda card to five - the server's. */
  readonly agendaNext = computed(() =>
    (this.pulse()?.agendaNext ?? []).map((item) => {
      const due = item.dueAtUtc ? new Date(item.dueAtUtc) : null;
      return {
        id: item.id,
        recordName: item.recordName,
        followUpType: item.channelLabel,
        scheduledDate: due ? this.toDateInput(due) : "",
        scheduledTime: due ? this.toTimeInput(due) : "",
      };
    }),
  );

  readonly kpiDueToday = computed(() => this.summary()?.dueToday ?? 0);
  readonly kpiUpcoming = computed(() => this.summary()?.upcoming ?? 0);
  readonly kpiCompletedToday = computed(() => this.summary()?.completedToday ?? 0);
  /** ESCALATED (TS-128): the server's count, by the same rule the Escalated tab filters by. */
  readonly kpiEscalated = computed(() => this.summary()?.escalated ?? 0);

  readonly kpiCompletionRate = computed(() => this.summary()?.completionRatePercent ?? 0);

  /** On time / due today / overdue, over the open follow-ups in scope - the server's. */
  readonly slaBreakdown = computed(() => ({
    onTime: this.pulse()?.slaOnTime ?? 0,
    approaching: this.pulse()?.slaApproaching ?? 0,
    breached: this.pulse()?.slaBreached ?? 0,
  }));

  /** PENDING BY AGE (TS-127): open, not overdue, by days until due - the server's four buckets. */
  private readonly ageBuckets = computed<readonly CountedView[]>(() => this.pulse()?.ageBuckets ?? []);
  readonly agingBuckets = computed(() => {
    const counts = this.ageBuckets().map((bucket) => bucket.count);
    return { b0: counts[0] ?? 0, b1: counts[1] ?? 0, b2: counts[2] ?? 0, b3: counts[3] ?? 0 };
  });

  /** Today's date as yyyy-mm-dd, read fresh (the module constant goes stale past midnight). */
  todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  readonly activeFilterCount = computed(() => {
    const f = this.activeFilters();
    return (
      f.status.size +
      f.type.size +
      f.priority.size +
      (f.owner ? 1 : 0) +
      (f.campaign ? 1 : 0) +
      (f.dateFrom ? 1 : 0) +
      (f.dateTo ? 1 : 0)
    );
  });

  readonly historyFollowUp = computed<FollowUp | null>(() => {
    const modal = this.activeModal();
    if (!modal || modal.kind !== "history") return null;
    return this.followUps().find((f) => f.id === modal.ids[0]) ?? null;
  });

  readonly bulkFollowUps = computed<FollowUp[]>(() => {
    const ids = this.selectedIds();
    return this.followUps().filter((f) => ids.has(f.id));
  });

  /** The long form of today, for the header ("Thursday, 24 September"). */
  readonly todayLabel = new Date(TODAY_ISO + "T00:00:00").toLocaleDateString(
    "en-GB",
    { weekday: "long", day: "numeric", month: "long" },
  );

  /** The five headline tiles - the server's words and counts. Each one is also the view it names. */
  readonly kpiTiles = computed<KpiTile[]>(() =>
    (this.queue()?.tiles ?? []).map((tile) => ({
      key: tile.value,
      label: tile.label,
      value: tile.count,
      hint: tile.description,
      icon: TILE_LOOK[tile.value]?.icon ?? "task",
      tone: TILE_LOOK[tile.value]?.tone ?? "info",
    })),
  );

  readonly slaTotal = computed(() => {
    const s = this.slaBreakdown();
    return s.onTime + s.approaching + s.breached;
  });

  readonly agingTotal = computed(() => {
    const b = this.agingBuckets();
    return b.b0 + b.b1 + b.b2 + b.b3;
  });

  /** What the queue panel is showing, as its title. */
  readonly queueTitle = computed(() => {
    const strip = this.selectedStripDate();
    if (strip) {
      return strip === TODAY_ISO
        ? "Today's follow-ups"
        : `Follow-ups on ${this.formatDate(strip)}`;
    }
    const saved = this.savedViews().find(
      (v) => v.id === this.activeSavedViewId(),
    );
    if (saved) return saved.label;
    const tile = this.kpiTiles().find(
      (k) => k.key === this.activeQuickFilter(),
    );
    if (tile) return tile.label.charAt(0).toUpperCase() + tile.label.slice(1);
    return "All follow-ups";
  });

  /** True when anything narrows the list, so the toolbar can offer one "clear all". */
  readonly isNarrowed = computed(
    () =>
      !!this.searchTerm().trim() ||
      this.activeFilterCount() > 0 ||
      !!this.activeQuickFilter() ||
      !!this.selectedStripDate() ||
      !!this.activeSavedViewId(),
  );

  /** Follow-ups in each tab - the server's counts; "all" is everything in scope. */
  readonly viewCounts = computed<Record<string, number>>(() => {
    const counts: Record<string, number> = { all: this.summary()?.total ?? 0 };
    for (const view of this.queue()?.views ?? []) {
      counts[view.value] = view.count;
    }
    return counts;
  });

  /** Open follow-ups blocked by an unacknowledged consent caution - the server's count. */
  readonly kpiBlocked = computed(() => this.pulse()?.blocked ?? 0);

  /** The four aging buckets as columns for the pulse panel's chart. */
  readonly agingColumns = computed(() => {
    const buckets = this.ageBuckets();
    const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
    return buckets.map((bucket, index) => ({
      label: bucket.label,
      value: bucket.count,
      tone: AGE_TONES[index] ?? "ok",
      height: (bucket.count / max) * 100,
    }));
  });

  /** "21 – 27 Sep" for the week the date rail shows. */
  readonly stripRangeLabel = computed(() => {
    const days = this.calendarStrip();
    if (!days.length) return "";
    const fmt = (iso: string) =>
      new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
    return `${fmt(days[0].date)} – ${fmt(days[days.length - 1].date)}`;
  });

  /** The busiest day in the rail, so each day's load bar is relative to it. */
  readonly stripMax = computed(() =>
    Math.max(1, ...this.calendarStrip().map((d) => d.count)),
  );

  readonly stripMonthLabel = computed(() =>
    new Date(this.calendarCenterDate() + "T00:00:00").toLocaleDateString(
      "en-US",
      { month: "long", year: "numeric" },
    ),
  );

  setView(view: QueueView) {
    this.viewMode.set(view);
  }

  onSearchChange(value: string) {
    this.searchTerm.set(value);
    this.searchChanges.next();
  }

  toggleFiltersPanel() {
    if (!this.filtersOpen()) {
      this.draftFilters.set(this.cloneFilters(this.activeFilters()));
    }
    this.filtersOpen.set(!this.filtersOpen());
  }

  private cloneFilters(f: GeneralFilters): GeneralFilters {
    return {
      status: new Set(f.status),
      type: new Set(f.type),
      priority: new Set(f.priority),
      owner: f.owner,
      campaign: f.campaign,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
    };
  }

  toggleDraftSet<T extends string>(
    key: "status" | "type" | "priority",
    value: T,
  ) {
    const draft = this.cloneFilters(this.draftFilters());
    const set = draft[key] as unknown as Set<T>;
    if (set.has(value)) set.delete(value);
    else set.add(value);
    this.draftFilters.set(draft);
    this.commitDraft();
  }

  /** A choice in the panel takes effect at once; there is no separate Apply step. */
  private commitDraft() {
    this.activeFilters.set(this.cloneFilters(this.draftFilters()));
    this.activeSavedViewId.set(null);
    this.load();
    this.scrollToResults();
  }

  /** On the board and calendar the results sit below the filter panel; bring them into view. */
  private scrollToResults() {
    if (this.viewMode() === "grid") return;
    setTimeout(() => {
      document
        .querySelector(".fq-board, .fq-cal")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  setDraftOwner(v: string) {
    this.draftFilters.update((f) => ({
      ...this.cloneFilters(f),
      owner: v || null,
    }));
    this.commitDraft();
  }
  setDraftCampaign(v: string) {
    this.draftFilters.update((f) => ({
      ...this.cloneFilters(f),
      campaign: v || null,
    }));
    this.commitDraft();
  }
  /**
   * DUE BETWEEN (TS-122): the "to" date can never fall before the "from" date. The inputs carry
   * min/max so the picker greys the wrong days out, and a typed date that breaks the rule is
   * refused here: a later "from" clears an earlier "to", an earlier "to" is rejected.
   */
  setDraftDateFrom(v: string) {
    const from = v || null;
    const to = this.draftFilters().dateTo;
    this.draftFilters.update((f) => ({
      ...this.cloneFilters(f),
      dateFrom: from,
      dateTo: from && to && to < from ? null : f.dateTo,
    }));
    this.commitDraft();
  }
  setDraftDateTo(v: string, input?: HTMLInputElement) {
    const to = v || null;
    const from = this.draftFilters().dateFrom;
    if (to && from && to < from) {
      if (input) input.value = this.draftFilters().dateTo ?? "";
      this.showToast("The end date cannot be before the start date");
      return;
    }
    this.draftFilters.update((f) => ({
      ...this.cloneFilters(f),
      dateTo: to,
    }));
    this.commitDraft();
  }

  applyFilters() {
    this.activeFilters.set(this.cloneFilters(this.draftFilters()));
    this.activeSavedViewId.set(null);
    this.filtersOpen.set(false);
    this.load();
    this.showToast("Filters applied");
  }

  resetFilters() {
    this.selectedStripDate.set(null);
    this.draftFilters.set(emptyFilters());
    this.activeFilters.set(emptyFilters());
    this.activeQuickFilter.set(null);
    this.activeSavedViewId.set(null);
    this.searchTerm.set("");
    this.load();
    this.showToast("Filters reset");
    this.scrollToResults();
  }

  /** A tab is the server's view of that name; the panel's filters and the day are let go. */
  applySavedView(view: SavedView) {
    this.activeFilters.set(emptyFilters());
    this.draftFilters.set(emptyFilters());
    this.selectedStripDate.set(null);
    this.activeSavedViewId.set(view.id);
    this.activeQuickFilter.set(view.id);
    this.load();
  }

  shiftCalendarMonth(months: number) {
    const d = new Date(this.calendarMonthCursor() + "T00:00:00");
    d.setMonth(d.getMonth() + months);
    this.calendarMonthCursor.set(this.toDateInput(d));
  }

  /**
   * A day in the CALENDAR was clicked. BUG-094.
   *
   * THE VIEW NEVER CHANGES FROM HERE. A day with several follow-ups used to go through
   * `onStripDateClick`, which switches the screen to the List view - so the person was thrown
   * out of the calendar and had to find the row and open its three-dot menu to see the detail.
   * A day with one follow-up opened the detail straight away, so the two cases behaved
   * differently for no reason the person could see.
   *
   * Now both stay in the calendar:
   *   - one follow-up  -> its detail panel opens, as before;
   *   - several        -> a small pop-up lists that day's follow-ups; choosing one opens its
   *                       detail panel. Closing either returns to the same month.
   *   - none           -> the day is only marked as chosen.
   */
  onCalendarDayClick(day: { iso: string; items: FollowUp[] }) {
    this.calendarSelectedDate.set(day.iso);

    if (day.items.length === 1) {
      this.openPreview(day.items[0].id);
      return;
    }

    if (day.items.length > 1) {
      this.calendarDayPopup.set({ iso: day.iso, items: [...day.items] });
    }
  }

  /** The day whose follow-ups are listed in the calendar pop-up, or null when it is closed. */
  readonly calendarDayPopup = signal<{ iso: string; items: FollowUp[] } | null>(null);

  /** The pop-up's follow-ups in time order, so the list reads like the day. */
  readonly calendarDayPopupItems = computed(() =>
    [...(this.calendarDayPopup()?.items ?? [])].sort((a, b) =>
      (a.scheduledTime || '').localeCompare(b.scheduledTime || '')));

  closeCalendarDayPopup() {
    this.calendarDayPopup.set(null);
  }

  /** A follow-up chosen in the pop-up: the pop-up closes and its detail panel opens, still on the calendar. */
  openFromCalendarDay(id: string) {
    this.calendarDayPopup.set(null);
    this.openPreview(id);
  }

  isSelected(id: string) {
    return this.selectedIds().has(id);
  }
  toggleSelect(id: string) {
    const set = new Set(this.selectedIds());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.selectedIds.set(set);
  }
  toggleSelectAllVisible() {
    const visible = this.pagedFollowUps();
    if (this.allVisibleSelected()) {
      const set = new Set(this.selectedIds());
      visible.forEach((f) => set.delete(f.id));
      this.selectedIds.set(set);
    } else {
      const set = new Set(this.selectedIds());
      visible.forEach((f) => set.add(f.id));
      this.selectedIds.set(set);
    }
  }
  clearSelection() {
    this.selectedIds.set(new Set());
  }

  openPreview(id: string) {
    this.previewId.set(id);
  }

  // ---- Drawer: execution report + attachments (TS-138) ----------------------
  /**
   * WHAT WAS RECORDED ON THE EXECUTION SCREEN, SHOWN IN THE PANEL. Executing a follow-up records
   * how and when contact was made, the execution status, completion reason, outcome, engagement,
   * communication quality, the notes, the disposition and the files - but the panel showed only a
   * line or two of it, and no documents (the list rows leave most of it out). When a closed
   * follow-up opens, the panel asks for the follow-up itself and for the record's communication
   * timeline (the completion is written there as an interaction) and lays the whole report out.
   */
  readonly drawerReports = signal<Record<string, Partial<ExecutionReport>>>({});
  readonly drawerFilesLoading = signal<string | null>(null);
  private readonly drawerFilesAsked = new Set<string>();
  private readonly lookupLabels = new Map<string, string>();

  private readonly loadDrawerDetailsOnOpen = effect(() => {
    const f = this.previewFollowUp();
    if (!f) return;
    untracked(() => this.loadDrawerDetails(f));
  });

  /** The panel's execution report: the row's own fields, completed by what was fetched for it. */
  reportFor(f: FollowUp): ExecutionReport {
    const fetched = this.drawerReports()[f.id] ?? {};
    const pick = (...values: (string | undefined)[]) => values.find((v) => !!v && v.trim()) ?? "";
    return {
      channel: this.labelOf(pick(fetched.channel)),
      executedAt: pick(fetched.executedAt),
      executedBy: pick(fetched.executedBy, f.assignedTo),
      executionStatus: this.labelOf(pick(f.executionStatus, fetched.executionStatus)),
      completionReason: this.labelOf(pick(f.completionReason, fetched.completionReason)),
      outcome: this.labelOf(pick(fetched.outcome)),
      engagement: this.labelOf(pick(fetched.engagement)),
      quality: this.labelOf(pick(fetched.quality)),
      notes: pick(f.lastCommunicationOutcome, fetched.notes),
      internalNotes: pick(fetched.internalNotes),
      temperature: this.labelOf(pick(fetched.temperature)),
      disposition: this.labelOf(pick(f.disposition, fetched.disposition)),
      files: f.attachments.length ? f.attachments : (fetched.files ?? []),
    };
  }

  /** The documents uploaded at execution. */
  filesFor(f: FollowUp): string[] {
    return this.reportFor(f).files;
  }

  /** The attachment viewer, or null. Only opened when the gate allows it. */
  readonly viewingAttachment = signal<AttachmentViewer | null>(null);

  /** PDF, image, text or Office - decides how the viewer shows the file. */
  attachmentKind(name: string, type = ""): AttachmentKind {
    const mime = (type || mimeFromName(name)).toLowerCase();
    if (mime === "application/pdf") return "pdf";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("text/")) return "text";
    if (mime.includes("word") || mime.includes("officedocument") || mime.includes("excel") || mime.includes("msword")) return "office";
    return "other";
  }

  /** The short format label on the viewer: PDF, DOCX, PNG ... */
  attachmentExt(name: string): string {
    const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
    return ext.toUpperCase() || "FILE";
  }

  private sizeLabel(bytes: number): string {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Opens the document IN A NEW BROWSER TAB, in its own format: a PDF in the browser's PDF
   * viewer, an image as the image, a text file as text. No pop-up on this page.
   *
   * THE TAB IS OPENED ON THE CLICK ITSELF (before the file is read), because a browser blocks a
   * new tab opened after an await. The file is then loaded into it, under the file's own name as
   * the tab title. A Word / Excel file cannot be shown by a browser, so it is downloaded instead -
   * it opens in Word / Excel in its own format.
   */
  async viewAttachment(followUpId: string, name: string): Promise<void> {
    if (!this.canViewDownloadAttachment()) return;

    const kind = this.attachmentKind(name);
    if (kind === "office" || kind === "other") {
      await this.downloadAttachment(followUpId, name);
      return;
    }

    const tab = window.open("", "_blank");
    if (tab) {
      try {
        tab.opener = null;
        tab.document.title = name;
        tab.document.body.style.cssText = "margin:0;font:14px system-ui,sans-serif;color:#5b6760;display:grid;place-items:center;height:100vh";
        tab.document.body.textContent = "Opening the document…";
      } catch {
        /* the tab is still usable without the placeholder */
      }
    }

    const stored = await this.attachmentStore.get(followUpId, name);
    if (!stored) {
      tab?.close();
      this.showToast(`"${name}" is not available on this device. Only its name was recorded with the follow-up.`);
      return;
    }

    const type = stored.type || mimeFromName(name);
    const blob = stored.blob.type === type ? stored.blob : new Blob([stored.blob], { type });
    const url = URL.createObjectURL(blob);
    // Kept alive a while so the tab can finish reading it (and reload it), then released.
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);

    if (!tab) {
      // Pop-ups blocked: open it in place of a blank tab the browser refused.
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }

    try {
      // The file fills the tab; the tab carries the file's name instead of a random id.
      const doc = tab.document;
      doc.title = name;
      doc.body.removeAttribute("style");
      doc.body.textContent = "";
      doc.body.style.cssText = "margin:0;height:100vh;background:#525659";
      const realKind = this.attachmentKind(name, type);
      if (realKind === "image") {
        doc.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#1f1f1f";
        const img = doc.createElement("img");
        img.src = url;
        img.alt = name;
        img.style.cssText = "max-width:100%;max-height:100vh;object-fit:contain";
        doc.body.appendChild(img);
      } else {
        const frame = doc.createElement("iframe");
        frame.src = url;
        frame.title = name;
        frame.style.cssText = "border:0;width:100%;height:100vh;display:block;background:#ffffff";
        doc.body.appendChild(frame);
      }
    } catch {
      tab.location.href = url;
    }
  }

  closeViewAttachment(): void {
    const current = this.viewingAttachment();
    if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
    this.viewingAttachment.set(null);
  }

  /** Opens the file in a new browser tab, in its own format (PDF / image / text). */
  openAttachmentInNewTab(): void {
    const current = this.viewingAttachment();
    if (current?.objectUrl) window.open(current.objectUrl, "_blank", "noopener");
  }

  /**
   * Downloads THE ORIGINAL FILE, with its own name and format (a.pdf stays a.pdf, b.docx stays
   * b.docx). It used to save a .txt note about the file, because only the name was recorded.
   */
  async downloadAttachment(target: string | AttachmentViewer, fileName?: string): Promise<void> {
    if (!this.canViewDownloadAttachment()) return;

    // Called as (followUpId, name) from the panel, or with the open viewer itself (one argument)
    // from the viewer's own Download button.
    const followUpId = typeof target === "string" ? target : target.followUpId;
    const name = typeof target === "string" ? fileName ?? "" : target.name;
    if (!followUpId || !name) return;

    const stored = await this.attachmentStore.get(followUpId, name);
    if (!stored) {
      this.showToast(`"${name}" is not available on this device. Only its name was recorded with the follow-up.`);
      return;
    }

    const type = stored.type || mimeFromName(name);
    const blob = stored.blob.type === type ? stored.blob : new Blob([stored.blob], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** "Tue, 14 Oct 2026, 02:30 PM" for the executed date and time. */
  formatExecutedAt(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-GB", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
    });
  }

  /** A stored value as the words the execution screen showed for it. */
  private labelOf(value: string): string {
    if (!value) return "";
    return (
      this.lookupLabels.get(value) ??
      value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/ ([A-Z])(?=[a-z])/g, (_m, c: string) => " " + c.toLowerCase())
    );
  }

  /** Every `{ value, label }` list a response carries, remembered for labelOf. */
  private rememberLabels(source: Record<string, unknown> | null): void {
    if (!source) return;
    for (const [key, list] of Object.entries(source)) {
      if (!key.endsWith("Options") || !Array.isArray(list)) continue;
      for (const o of list as { value?: unknown; label?: unknown }[]) {
        if (typeof o?.value === "string" && typeof o?.label === "string" && o.label) {
          this.lookupLabels.set(o.value, o.label);
        }
      }
    }
  }

  private loadDrawerDetails(f: FollowUp): void {
    if (f.isOpen || this.drawerFilesAsked.has(f.id)) return;
    this.drawerFilesAsked.add(f.id);
    this.drawerFilesLoading.set(f.id);

    const leadId = f.recordType === "Lead" ? (f.recordId ?? null) : null;
    const donorId = f.recordType === "Donor" ? (f.recordId ?? null) : null;

    forkJoin({
      detail: this.api.getFollowUp(f.id).pipe(catchError(() => of(null))),
      timeline: f.recordId
        ? this.api.getCommunicationTimeline(leadId, donorId).pipe(catchError(() => of(null)))
        : of(null),
    }).subscribe(({ detail, timeline }) => {
      const d = (detail ?? {}) as unknown as Record<string, unknown>;
      const t = (timeline ?? {}) as unknown as Record<string, unknown>;
      this.rememberLabels(t);

      // The completion's own entry on the timeline: linked by the follow-up's id or reference,
      // or - when the API links neither - the entry whose summary is the executor's notes.
      const entries = (Array.isArray(t["entries"]) ? t["entries"] : []) as Record<string, unknown>[];
      const entry =
        entries.find(
          (e) =>
            e["followUpId"] === f.id ||
            e["followUpReference"] === f.reference ||
            (!!f.lastCommunicationOutcome &&
              typeof e["summary"] === "string" &&
              splitAttachmentLine(e["summary"]).text === f.lastCommunicationOutcome),
        ) ?? {};

      const text = (...values: unknown[]) =>
        (values.find((v) => typeof v === "string" && v.trim()) as string | undefined) ?? "";

      const files = new Set<string>(detail ? attachmentNames(detail) : []);
      attachmentNames(entry as unknown as ApiFollowUp).forEach((n) => files.add(n));
      // The "Attachments:" line on the completion's notes, wherever the notes came back.
      [d["completionOutcome"], entry["summary"]].forEach((v) => {
        if (typeof v === "string") splitAttachmentLine(v).files.forEach((n) => files.add(n));
      });

      const report: Partial<ExecutionReport> = {
        channel: text(d["interactionType"], d["completionInteractionType"], entry["interactionType"]),
        executedAt: text(d["completedAtUtc"], entry["occurredAtUtc"]),
        executedBy: text(d["completedByName"], entry["actorName"], entry["recordedByName"]),
        executionStatus: text(d["executionStatus"]),
        completionReason: text(d["completionReason"]),
        outcome: text(d["outcome"], d["completionOutcomeCode"], entry["outcome"]),
        engagement: text(d["engagementLevel"], entry["engagementLevel"], entry["engagement"]),
        quality: text(d["quality"], d["communicationQuality"], entry["quality"]),
        notes: splitAttachmentLine(text(d["completionOutcome"], entry["summary"])).text,
        internalNotes: text(d["completionNotes"], entry["notes"]),
        temperature: text(d["newTemperature"], entry["temperature"], entry["newTemperature"]),
        disposition: text(d["disposition"]),
        files: [...files],
      };

      this.drawerReports.update((all) => ({ ...all, [f.id]: report }));
      if (this.drawerFilesLoading() === f.id) this.drawerFilesLoading.set(null);
    });
  }
  closePreview() {
    this.previewId.set(null);
  }

  /**
   * RESCHEDULE RULES (TS-136): the new date cannot be in the past, a time today cannot be earlier
   * than now, and a single follow-up has to actually move - saving the same date and time was
   * accepted and did nothing. Empty means the dialog may save.
   */
  readonly rescheduleProblem = computed(() => this.rescheduleCheck().message);

  /**
   * The rule that failed and the field it belongs to - "date", "time", or "both" when the new
   * date and time are the same as the current ones.
   */
  private readonly rescheduleCheck = computed<{ message: string; field: "date" | "time" | "both" | null }>(() => {
    const message = this.rescheduleRule();
    if (!message) return { message: "", field: null };
    if (message === RESCHEDULE_UNCHANGED) return { message, field: "both" };
    return { message, field: message === RESCHEDULE_PAST_TIME ? "time" : "date" };
  });

  /**
   * POPUP OPENS QUIET. The dialog is filled with the follow-up's current date and time, and the
   * "same date and time" rule used to fire the moment it opened - an error before the person had
   * done anything. A message now shows only once a field has been changed (a past date or time
   * they picked) or Save has been pressed (which is when "pick a new date or time" applies).
   */
  readonly rescheduleEdited = signal(false);
  readonly rescheduleAttempted = signal(false);

  /** The message under the fields, or "" while the dialog has nothing to say yet. */
  readonly rescheduleError = computed(() => {
    const { message, field } = this.rescheduleCheck();
    if (!message) return "";
    if (this.rescheduleAttempted()) return message;
    return this.rescheduleEdited() && field !== "both" ? message : "";
  });

  /** Which input to outline in red. */
  rescheduleInvalid(input: "date" | "time"): boolean {
    if (!this.rescheduleError()) return false;
    const field = this.rescheduleCheck().field;
    return field === input;
  }

  setRescheduleDate(value: string) {
    this.rescheduleDate.set(value);
    this.rescheduleEdited.set(true);
  }

  setRescheduleTime(value: string) {
    this.rescheduleTime.set(value);
    this.rescheduleEdited.set(true);
  }

  private readonly rescheduleRule = computed(() => {
    const date = this.rescheduleDate();
    const time = this.rescheduleTime();
    if (!date) return "";
    const today = this.todayIso();
    if (date < today) return RESCHEDULE_PAST_DATE;
    if (date === today && time) {
      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      if (to24h(time) < nowMinutes) return RESCHEDULE_PAST_TIME;
    }
    const modal = this.activeModal();
    if (modal?.kind === "reschedule" && modal.ids.length === 1) {
      const current = this.followUpById(modal.ids[0]);
      if (current && current.scheduledDate === date && (current.scheduledTime ?? "") === time) {
        return RESCHEDULE_UNCHANGED;
      }
    }
    return "";
  });

  openReschedule(id: string) {
    const f = this.followUps().find((x) => x.id === id);
    this.rescheduleDate.set(f?.scheduledDate ?? "");
    this.rescheduleTime.set(f?.scheduledTime ?? "");
    this.rescheduleReason.set("");
    this.rescheduleEdited.set(false);
    this.rescheduleAttempted.set(false);
    this.activeModal.set({ kind: "reschedule", ids: [id] });
  }
    openBulkReschedule() {
    const ids = this.selectedWith("Reschedule");
    if (!ids.length) return;
    this.rescheduleDate.set("");
    this.rescheduleTime.set("");
    this.rescheduleReason.set("");
    this.rescheduleEdited.set(false);
    this.rescheduleAttempted.set(false);
    this.activeModal.set({ kind: "reschedule", ids });
  }

  /** Whether the caller may do this to this follow-up - the server's per-row answer. */
  can(f: FollowUp, action: string): boolean {
    return f.permittedActions.includes(action);
  }

  /**
   * The ticked follow-ups the caller may actually do this to.
   *
   * A BULK ACTION ONLY GOES TO THE ROWS THAT ALLOW IT. Rescheduling, cancelling and completing
   * belong to the person a follow-up is assigned to, and a selection in a manager's queue mixes
   * their own with everybody else's; sending all of them produced a row of refusals. The message
   * says how many were left out and why.
   */
  private selectedWith(action: string): string[] {
    const selected = this.bulkFollowUps();
    const allowed = selected.filter((f) => f.permittedActions.includes(action));

    if (allowed.length === 0) {
      this.showToast(
        selected.length === 1
          ? "That follow-up cannot be changed this way - it is closed, or assigned to somebody else."
          : "None of the selected follow-ups can be changed this way - they are closed, or assigned to somebody else.",
      );
    } else if (allowed.length < selected.length) {
      this.showToast(
        `${selected.length - allowed.length} of ${selected.length} left out: closed, or assigned to somebody else.`,
      );
    }

    return allowed.map((f) => f.id);
  }
  /**
   * Reschedule - the document's own menu action.
   *
   * ONE REQUEST PER FOLLOW-UP, because each carries its own version. Bundling them would mean
   * dropping the concurrency check, and a follow-up somebody else moved while this dialog was
   * open would be silently overwritten rather than reported.
   */
  confirmReschedule() {
    const modal = this.activeModal();
    if (!modal || !this.rescheduleDate()) {
      return;
    }
    // Save shows the message under the fields (no toast) and stops.
    this.rescheduleAttempted.set(true);
    if (this.rescheduleProblem()) return;

    const dueAtUtc = this.toDueUtc(
      this.rescheduleDate(),
      this.rescheduleTime(),
    );
    const reason =
      this.rescheduleReason().trim() || "Rescheduled from the follow-up queue.";

    this.runBatch(
      modal.ids,
      (id) => {
        const row = this.followUpById(id);
        return this.api.rescheduleFollowUp(id, {
          dueAtUtc,
          rescheduleReason: reason,
          expectedVersion: row?.version ?? null,
        });
      },
      (count) =>
        count > 1 ? `${count} follow-ups rescheduled` : "Follow-up rescheduled",
    );
  }

    openReassign(id: string) {
    this.reassignOwner.set("");
    this.reassignReason.set("");
    this.activeModal.set({ kind: "reassign", ids: [id] });
  }
    openBulkReassign() {
    const ids = this.selectedWith("Reassign");
    if (!ids.length) return;
    this.reassignOwner.set("");
    this.reassignReason.set("");
    this.activeModal.set({ kind: "reassign", ids });
  }
  confirmReassign() {
    const modal = this.activeModal();
    const ownerName = this.reassignOwner();
    if (!modal || !ownerName) {
      return;
    }

    // THE USER ID, NOT THE NAME. The dropdown shows names; the API assigns to an account.
    const owner = this.ownerOptions().find(
      (option) => option.label === ownerName,
    );
    if (!owner) {
      this.showToast("Choose an owner from the list.");
      return;
    }

    this.runBatch(
      modal.ids,
      (id) => {
        const row = this.followUpById(id);
                return this.api.assignFollowUp(id, {
          relationshipOwnerUserId: owner.value,
          relationshipOwnerName: owner.label,

          // THE REASON THE PERSON TYPED. The dialog has always asked for one and this sent a
          // fixed sentence instead, so the trail never said why work had been moved.
          reason: this.reassignReason().trim() || "Reassigned from the follow-up queue.",
          expectedVersion: row?.version ?? null,
        });
      },
      (count) =>
        count > 1
          ? `${count} reassigned to ${ownerName}`
          : `Reassigned to ${ownerName}`,
    );
  }

  openCancel(id: string) {
    this.cancelReason.set("");
    this.activeModal.set({ kind: "cancel", ids: [id] });
  }
    openBulkCancel() {
    const ids = this.selectedWith("Cancel");
    if (!ids.length) return;
    this.cancelReason.set("");
    this.activeModal.set({ kind: "cancel", ids });
  }
  confirmCancel() {
    const modal = this.activeModal();
    const reason = this.cancelReason().trim();
    if (!modal || !reason) {
      return;
    }

    this.runBatch(
      modal.ids,
      (id) => {
        const row = this.followUpById(id);
        return this.api.cancelFollowUp(id, {
          reason,
          expectedVersion: row?.version ?? null,
        });
      },
      (count) => (count > 1 ? `${count} cancelled` : "Follow-up cancelled"),
    );
  }

    openEscalate(id: string) {
    this.escalateTo.set("");
    this.escalateReason.set("");
    this.escalateNotes.set("");
    this.activeModal.set({ kind: "escalate", ids: [id] });
  }
  /**
   * Escalate - the document's menu action, which "opens the escalation pop-up".
   *
   * IT IS RECORDED AS AN ESCALATION NOW. It used to be sent as an ordinary reassignment with the
   * word "Escalated" in its reason, so nothing marked the follow-up as escalated: the Escalated
   * tile, tab and filter were all permanently empty. The server stamps the follow-up, hands it to
   * the person chosen and writes both to its history.
   */
  confirmEscalate() {
    const modal = this.activeModal();
    const target = this.escalateTo();
    const reason = this.escalateReason().trim();
    if (!modal || !target || !reason) {
      return;
    }

    const owner = this.ownerOptions().find((option) => option.label === target);
    if (!owner) {
      this.showToast("Choose somebody to escalate to.");
      return;
    }

    const notes = this.escalateNotes().trim();

    this.runBatch(
      modal.ids,
      (id) => {
        const row = this.followUpById(id);
        return this.api.escalateFollowUp(id, {
          escalateToUserId: owner.value,
          escalateToName: owner.label,
          reason: notes ? `${reason} - ${notes}` : reason,
          expectedVersion: row?.version ?? null,
        });
      },
      () => `Escalated to ${target}`,
    );
  }

  openCompletion(id: string) {
    const item = this.followUpById(id);
    // BUG-097: the same rule as the Execute button, for every other way into the execution screen.
    if (item && !this.canExecute(item)) {
      this.showToast(this.executeHint(item));
      return;
    }
    this.router.navigate(
      ["/app/fundraising/relationships/follow-up-execution"],
      {
        queryParams: {
          followUpId: id,
          leadId: item?.recordType === "Lead" ? item.recordId : null,
          donorId: item?.recordType === "Donor" ? item.recordId : null,
        },
      },
    );
  }

    openBulkComplete() {
    const allowed = this.selectedWith("Execute");
    // BUG-097: upcoming follow-ups are left out of a bulk completion as well.
    const ids = allowed.filter((id) => {
      const row = this.followUpById(id);
      return !!row && !this.isUpcoming(row);
    });
    if (ids.length < allowed.length) {
      this.showToast(
        ids.length === 0
          ? "Upcoming follow-ups cannot be executed before their scheduled day."
          : `${allowed.length - ids.length} upcoming follow-up(s) left out - they can be executed from their scheduled day.`,
      );
    }
    if (!ids.length) return;
    this.completionNote.set("");
    this.activeModal.set({ kind: "complete", ids });
  }
  confirmBulkComplete() {
    const modal = this.activeModal();
    if (!modal) {
      return;
    }

    const outcome =
      this.completionNote().trim() || "Completed from the follow-up queue.";

    this.runBatch(
      modal.ids,
      (id) => {
        const row = this.followUpById(id);
        return this.api.completeFollowUp(id, {
          completionOutcome: outcome,
          expectedVersion: row?.version ?? null,
        });
      },
      (count) =>
        count > 1
          ? `${count} follow-ups marked complete`
          : "Follow-up marked complete",
      () => this.clearSelection(),
    );
  }

  /**
   * Runs one call per selected follow-up and reports the set.
   *
   * EACH FAILURE IS CAUGHT INTO A BOOLEAN rather than thrown. `forkJoin` abandons the whole set
   * on the first error, which would leave somebody unable to tell which of twelve follow-ups had
   * moved - so the set always completes and the message says how many did not.
   */
  private runBatch(
    ids: readonly string[],
    call: (id: string) => import("rxjs").Observable<unknown>,
    message: (count: number) => string,
    onDone?: () => void,
  ): void {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return;
    }

    this.loading.set(true);

    forkJoin(
      unique.map((id) =>
        call(id).pipe(
          map(() => true),
          catchError(() => of(false)),
        ),
      ),
    ).subscribe((results) => {
      const failed = results.filter((ok) => !ok).length;
      this.loading.set(false);
      this.closeModal();
      onDone?.();

      this.showToast(
        failed === 0
          ? message(unique.length)
          : `${unique.length - failed} of ${unique.length} updated; ${failed} could not be changed.`,
      );

      // RELOAD RATHER THAN PATCH. Completing or rescheduling changes the SLA badge and the
      // version, both of which the server decides.
      this.load();
    });
  }

    /**
   * Execute is the assignee's, and nobody else's.
   *
   * THE ROLE FLOW: "Execute is available only to the user this follow-up is assigned to." The
   * owner of the lead or donor sees a colleague's follow-up here and can open it; the server
   * leaves Execute off that row's actions, and refuses the call if it is made anyway.
   */
  canExecute(f: FollowUp): boolean {
    // "only they can execute it": a colleague's row never shows the Execute (play) icon, even if
    // the server's action list says otherwise - the assignee is the only one who executes.
    return f.isOpen
      && f.isMine
      && f.permittedActions.includes("Execute")
      && f.dependencyStatus !== "Blocked"
      // BUG-097: an UPCOMING follow-up cannot be executed yet. It is work planned for a later
      // day; recording it as done now would close it before the contact it describes could
      // have happened, and the queue's "due today" / "overdue" counts would stop being true.
      && !this.isUpcoming(f);
  }

  /**
   * Scheduled for a LATER day than the organisation's today - Tomorrow or Upcoming.
   *
   * Read two ways, so a missing or differently-worded `dueState` cannot let one through: the
   * server's own word for it, and the scheduled date against the server's today (both
   * yyyy-mm-dd, so a plain string comparison orders them). Today's and overdue follow-ups are
   * NOT upcoming - they are exactly the ones meant to be executed.
   */
  isUpcoming(f: FollowUp): boolean {
    if (!f.isOpen) return false;
    const state = (f.dueState ?? "").trim().toLowerCase();
    if (state === "upcoming" || state === "tomorrow") return true;
    const due = (f.scheduledDate ?? "").slice(0, 10);
    return !!due && !!this.today && due > this.today;
  }

  /** Who may execute an open follow-up the caller cannot - the drawer's line in place of the button. */
  executeHint(f: FollowUp): string {
    if (!f.isOpen) return "This follow-up is closed";
    if (!f.isMine) return `Assigned to ${f.assignedTo} - only they can execute it`;
    if (!f.permittedActions.includes("Execute")) {
      return f.isMine
        ? "You do not have permission to execute follow-ups"
        : `Assigned to ${f.assignedTo} - only they can execute it`;
    }
    if (f.dependencyStatus === "Blocked") {
      return `Blocked: ${f.dependencyBlockedReason ?? "dependency pending"}`;
    }
    if (this.isUpcoming(f)) {
      return `Scheduled for ${this.formatDate(f.scheduledDate)} - it can be executed from that day`;
    }
    return "Execute";
  }

  executeFollowUp(f: FollowUp) {
    if (!this.canExecute(f)) {
      this.showToast(this.executeHint(f));
      return;
    }
    this.router.navigate(
      ["/app/fundraising/relationships/follow-up-execution"],
      {
        queryParams: {
          followUpId: f.id,
          leadId: f.recordType === "Lead" ? f.recordId : null,
          donorId: f.recordType === "Donor" ? f.recordId : null,
        },
      },
    );
  }

  toggleActionMenu(id: string, ev: Event) {
    ev.stopPropagation();
    this.openActionMenuId.set(this.openActionMenuId() === id ? null : id);
  }
  @HostListener("document:keydown.escape")
  onEscapeKey() {
    if (this.calendarDayPopup()) {
      this.closeCalendarDayPopup();
      return;
    }
    if (this.viewingAttachment()) {
      this.closeViewAttachment();
      return;
    }
    if (this.activeModal()) {
      this.closeModal();
      return;
    }
    if (this.openActionMenuId()) {
      this.closeActionMenu();
      return;
    }
    // The side panel closes only from its own X.
  }

  @HostListener("document:click")
  closeActionMenu() {
    this.openActionMenuId.set(null);
  }

  openHistory(id: string) {
    this.activeModal.set({ kind: "history", ids: [id] });
  }

  onStripDateClick(iso: string) {
    this.selectedStripDate.set(iso);
    this.activeQuickFilter.set(null);
    this.viewMode.set("grid");
    this.activeSavedViewId.set(null);
    this.load();
  }

  shiftStripWeek(direction: number): void {
    const date = new Date(this.calendarCenterDate() + "T00:00:00");
    date.setDate(date.getDate() + direction * 7);
    this.calendarCenterDate.set(this.toDateInput(date));
    if (this.selectedStripDate()) {
      const selected = new Date(this.selectedStripDate()! + "T00:00:00");
      selected.setDate(selected.getDate() + direction * 7);
      this.onStripDateClick(this.toDateInput(selected));
    }
  }

  setQuickFilter(key: QuickFilterKey) {
    this.selectedStripDate.set(null);
    this.activeQuickFilter.set(this.activeQuickFilter() === key ? null : key);
    this.activeSavedViewId.set(null);
    this.load();
  }

  closeModal() {
    this.activeModal.set(null);
  }

  private draggingId: string | null = null;
  onDragStart(id: string, ev: DragEvent) {
    this.draggingId = id;
    ev.dataTransfer?.setData("text/plain", id);
  }
  onDropOnCompleted(ev: DragEvent) {
    ev.preventDefault();
    const id = this.draggingId ?? ev.dataTransfer?.getData("text/plain");
    const row = id ? this.followUpById(id) : undefined;

    // Dropping a card on Completed is Execute by another route, so it is the assignee's alone.
    if (row) this.executeFollowUp(row);
    this.draggingId = null;
  }
  allowDrop(ev: DragEvent) {
    ev.preventDefault();
  }

  refresh() {
    this.load();
    this.showToast("Queue refreshed");
  }
  /**
   * Export - the follow-ups in view (or the ticked ones), in a file the server wrote.
   *
   * IT USED TO BE BUILT HERE, from the rows this browser held, with no record that anybody had
   * taken a copy. The server applies the same filters, masks as the screen does, needs the export
   * permission and logs it.
   */
  readonly exporting = signal(false);

  exportQueue() {
    if (!this.canExport() || this.exporting()) return;

    const selected = [...this.selectedIds()];
    this.exporting.set(true);

    this.api
      .exportFollowUpQueue({ ...this.buildFilter(), followUpIds: selected.length ? selected.join(",") : null })
      .subscribe({
        next: ({ blob, fileName }) => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = fileName;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          this.exporting.set(false);
          this.showToast(selected.length ? `Exported ${selected.length} follow-ups` : `Exported ${this.totalCount()} follow-ups`);
        },
        error: (error: unknown) => {
          this.exporting.set(false);
          this.showToast(apiErrorMessage(error, "The follow-ups could not be exported."));
        },
      });
  }

  createFollowUp() {
    this.router.navigate(["/app/don/follow-up-planner"], {
      queryParams: { mode: "create" },
    });
  }

  private showToast(message: string) {
    this.toastMessage.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMessage.set(null), 3200);
  }

  formatDate(iso: string): string {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  slaClass(status: SlaStatus): string {
    return status === "On Time"
      ? "sla-ontime"
      : status === "Approaching"
        ? "sla-approaching"
        : "sla-breached";
  }
  priorityClass(p: Priority): string {
    return `priority-${p.toLowerCase()}`;
  }
  statusClass(s: FollowUpStatus): string {
    return `status-${s.toLowerCase()}`;
  }
  healthClass(): string {
    return `health-${this.queueHealth().toLowerCase()}`;
  }

    isOverdue(f: FollowUp): boolean {
    return f.isOverdue;
  }

  /**
   * The colour key for a priority. The styles were written for Low / Medium / High / Urgent;
   * the API's middle value is Normal, and it takes the middle colour.
   */
  priorityTone(priority: Priority): string {
    return priority === "Normal" ? "Medium" : priority;
  }
  trackById(_index: number, item: FollowUp): string {
    return item.id;
  }
  trackByDay(_index: number, item: CalendarDay): string {
    return item.date;
  }
  trackByString(_index: number, item: string): string {
    return item;
  }
  maxBucket(): number {
    const b = this.agingBuckets();
    return Math.max(1, b.b0, b.b1, b.b2, b.b3);
  }

  /** The sprite symbol (see the <svg> sprite at the top of the template) for a channel. */
  typeIcon(type: FollowUpType): string {
    switch (type) {
      case "Call":
        return "phone";
      case "Meeting":
        return "users";
      case "Email":
        return "mail";
      case "SMS":
        return "message";
      case "WhatsApp":
        return "chat";
            case "Post":
        return "note";
      default:
        return "task";
    }
  }

  initialsOf(name: string): string {
    return initials(name || "?");
  }

  /** "Today", "Tomorrow", "In 3 days", "2 days overdue" - how far the due date is from today. */
  dueLabel(f: FollowUp): string {
    if (!f.scheduledDate) return "Unscheduled";
    const days = Math.round(
      (new Date(f.scheduledDate + "T00:00:00").getTime() -
        new Date(TODAY_ISO + "T00:00:00").getTime()) /
        86_400_000,
    );
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
        if (days === -1) return f.isOpen ? "1 day overdue" : "Yesterday";
    if (days > 1) return `In ${days} days`;
    return f.isOpen
      ? `${-days} days overdue`
      : `${-days} days ago`;
  }

  /** "Fri 25" - a day in the agenda's coming-up list. */
  shortDay(iso: string): string {
    const d = new Date(iso + "T00:00:00");
    return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.getDate()}`;
  }

  /** "14:30" as "2:30 PM". */
  formatTime(time: string): string {
    if (!time) return "";
    const minutes = to24h(time);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }

  /** A second click on the selected day lets go of it. */
  toggleStripDate(iso: string): void {
    if (this.selectedStripDate() === iso) {
      this.selectedStripDate.set(null);
      this.load();
      return;
    }
    this.onStripDateClick(iso);
  }

  /** The "All" tab: drops the tab, tile and day narrowing but keeps the search and the filter panel's choices. */
  showAll(): void {
    this.activeQuickFilter.set(null);
    this.activeSavedViewId.set(null);
    this.selectedStripDate.set(null);
    this.load();
  }

  readonly hasData = computed(() => this.followUps().length > 0);

  jumpToToday(): void {
    this.calendarCenterDate.set(TODAY_ISO);
    this.calendarMonthCursor.set(TODAY_ISO.slice(0, 7) + "-01");
  }

  percentOf(value: number, total: number): number {
    return total ? Math.round((value / total) * 100) : 0;
  }

  /** Circumference share of the completion ring (r = 42). */
  ringDash(percent: number): string {
    const c = 2 * Math.PI * 42;
    return `${(c * percent) / 100} ${c}`;
  }
}