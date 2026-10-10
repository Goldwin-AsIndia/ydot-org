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
import { forkJoin, catchError, distinctUntilChanged, map, of, tap } from "rxjs";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { DonorApiService } from "../../../../Service/donor-api.service";
import { apiErrorMessage } from "../../../../Shared/models/api-response.model";
import {
  DonLookupItem,
  FollowUp as ApiFollowUp,
  FollowUpPlannerResponse,
  FollowUpQueueSummary,
} from "../../../../Shared/models/donor-contract.model";
import { fetchPages } from "../../../../Shared/services/paging";
import { PageHeader } from '../../../../Shared/components/page-header/page-header';

import { RowsPerPage } from '../../../../Shared/components/rows-per-page/rows-per-page';
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
export type FollowUpStatus =
  | "Pending"
  | "Completed"
  | "Partially completed"
  | "No response"
  | "Cancelled"
  | "Escalated"
  | "Rescheduled";
/** Executed or cancelled - no longer work to do. */
export const isClosedStatus = (status: string): boolean =>
  status === "Completed" ||
  status === "Partially completed" ||
  status === "No response" ||
  status === "Cancelled";
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
}

export interface KpiTile {
  key: Exclude<QuickFilterKey, null>;
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

export const SAVED_VIEWS: SavedView[] = [
  { id: "mine", label: "My Follow-Ups", short: "Mine" },
  { id: "today", label: "Today's Follow-Ups", short: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completedToday", label: "Completed Today", short: "Done today" },
  { id: "high", label: "High Priority", short: "High priority", groupStart: true },
  { id: "attention", label: "Needs Attention", short: "Needs attention" },
  { id: "escalated", label: "Escalated" },
    { id: "calls", label: "Calls", groupStart: true },
];

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
  source: FollowUp[],
): CalendarDay[] {
  const days: CalendarDay[] = [];
  const center = new Date(centerIso + "T00:00:00");
  for (let i = -3; i <= 3; i++) {
    const d = new Date(center);
    d.setDate(center.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const count = source.filter(
      (f) => f.scheduledDate === iso && f.status !== "Cancelled",
    ).length;
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

type QuickFilterKey =
  | "dueToday"
  | "overdue"
  | "upcoming"
  | "highPriority"
    | "attention"
  | "mine"
  | "today"
  | "calls"
  | "escalated"
  | "completedToday"
  | null;

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
  readonly today = TODAY_ISO;
  readonly savedViews: SavedView[] = SAVED_VIEWS;
  /** Real users, from the API. `value` is the user id the write needs; `label` is the name. */
  readonly ownerOptions = signal<readonly DonLookupItem[]>([]);
  readonly owners = computed(() =>
    this.ownerOptions().map((option) => option.label),
  );
  readonly statusOptions: FollowUpStatus[] = [
    "Pending",
    "Completed",
    "Partially completed",
    "No response",
    "Cancelled",
    "Rescheduled",
    "Escalated",
  ];
  /** The channels a follow-up can be planned on, from the API's own list. */
  readonly typeOptions = signal<FollowUpType[]>([]);

  /** Low, Normal, High, Urgent - the API's priorities. */
  readonly priorityOptions = signal<Priority[]>([]);

  /** The queue's figures over the caller's whole scope, counted by the server. */
  readonly summary = signal<FollowUpQueueSummary | null>(null);

  /** What the caller may do on this screen at all: the server's verbs for the queue. */
  private readonly queueActions = signal<readonly string[]>([]);
  readonly canSchedule = computed(() => this.queueActions().includes("Schedule follow-up"));
  readonly canExport = computed(() => this.queueActions().includes("Export"));
  readonly canComplete = computed(() => this.queueActions().includes("Mark complete"));
  readonly canReschedule = computed(() => this.queueActions().includes("Reschedule"));
  readonly canCancel = computed(() => this.queueActions().includes("Cancel task"));
  readonly canAssign = computed(() => this.queueActions().includes("Assign"));

  /** "Your whole organisation", or the caller's own follow-ups - the server's description. */
  readonly scopeLabel = signal("");

  /** Filled from whatever campaigns the loaded follow-ups actually belong to. */
  readonly campaigns = computed(() =>
    Array.from(
      new Set(
        this.followUps()
          .map((f) => f.campaign)
          .filter(Boolean),
      ),
    ).sort(),
  );

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

  constructor() {
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
   * The follow-ups the caller may see.
   *
   * THE SERVER DECIDES WHOSE THEY ARE. The role flow: the Fundraising Manager and Executive see
   * every follow-up in the organisation; DonorCare sees the ones assigned to them, and - to view
   * only - the ones a colleague holds on a lead or donor they own. This screen used to ask for
   * `onlyMine`, which hid the organisation's queue from the people who manage it.
   *
   * EVERY PAGE. The API caps a page at 100 and the request asked for 200, so the 101st
   * follow-up never appeared while every count on the page read as a total.
   *
   * A record named in the address (from Donor 360 or a lead) narrows the list AND the summary to
   * that person, on the server.
   */
  private load(): void {
    this.loading.set(true);
    this.loadError.set("");

    const donorId = this.route.snapshot.queryParamMap.get("donorId");
    const leadId = donorId ? null : this.route.snapshot.queryParamMap.get("leadId");

    // The first page's answer carries the summary, the option lists and the permitted actions.
    let first: FollowUpPlannerResponse | null = null;

    fetchPages<ApiFollowUp>((page, pageSize) =>
      this.api.getFollowUpPlanner({ page, pageSize, donorId, leadId }).pipe(
        tap((response) => {
          first ??= response;
        }),
        map((response) => response.followUps),
      ),
    ).subscribe({
      next: ({ items }) => {
        const response = first!;

        this.followUps.set(items.map((item) => this.toQueueRow(item)));
        // Fresh rows: files fetched for a panel earlier may have changed.
        this.drawerFilesAsked.clear();
        this.drawerReports.set({});
        this.ownerOptions.set(response.ownerOptions);
        this.summary.set(response.summary);
        this.queueActions.set(response.permittedActions ?? []);
        this.scopeLabel.set(response.activeScope ?? "");
        this.typeOptions.set(
          (response.channelOptions ?? []).map((option) => this.toFollowUpType(option.value)),
        );
        this.priorityOptions.set((response.priorityOptions ?? []).map((option) => option.value));
        // The words the execution screen offered, so the panel prints "Information requested"
        // rather than the stored value "InformationRequested".
        this.rememberLabels(response as unknown as Record<string, unknown>);
        this.loading.set(false);

        // A selection can outlive the rows it was made on.
        const ids = new Set(items.map((item) => item.id));
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

          // BACK FROM EXECUTION IS NOT A REQUEST TO SEE THE DETAILS. The execution screen returns
          // here naming the follow-up it just closed; opening its side panel on arrival put a
          // panel nobody asked for over the queue (TS-133). A follow-up that is no longer open is
          // highlighted in the list instead, and only an OPEN one - just scheduled, or opened from
          // elsewhere to be worked on - still opens its panel.
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
      followUpType: this.toFollowUpType(item.permittedChannel),
      scheduledDate: due ? this.toDateInput(due) : "",
      scheduledTime: due ? this.toTimeInput(due) : "",
      priority: item.priority,
      status: this.toStatus(item),

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
    };
  }

  /** What the executor recorded - "Partially completed", "No response" - or empty before execution. */
  executionLabel(f: FollowUp): string {
    return (f.executionStatus || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])/g, (m, c) => " " + c.toLowerCase());
  }

  /** The server's state as this screen's status word. See FollowUpStatus. */
  private toStatus(item: ApiFollowUp): FollowUpStatus {
    // THE SERVER CLOSES EVERY EXECUTED FOLLOW-UP AS "Completed" and keeps what the executor chose
    // (Completed, Partially completed, No response, Cancelled) in `executionStatus`. The list shows
    // that choice - it used to read "Completed" whatever was selected on the execution screen.
    if (item.status === "Completed") {
      switch (item.executionStatus) {
        case "PartiallyCompleted":
          return "Partially completed";
        case "NoResponse":
          return "No response";
        case "Cancelled":
          return "Cancelled";
      }
      return "Completed";
    }
    if (item.status === "Cancelled") return "Cancelled";
    if (item.escalatedAtUtc) return "Escalated";
    return item.status === "Rescheduled" ? "Rescheduled" : "Pending";
  }

  /** A consent channel as this screen names it. */
  private toFollowUpType(channel: string): FollowUpType {
    switch (channel) {
      case "PhoneCall":
        return "Call";
      case "Sms":
        return "SMS";
      default:
        return channel;
    }
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

  readonly filteredFollowUps = computed<FollowUp[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const gf = this.activeFilters();
    const quick = this.activeQuickFilter();
    const strip = this.selectedStripDate();

    return this.followUps().filter((f) => {
      if (this.recordFilterId() && f.recordId !== this.recordFilterId())
        return false;
      if (term) {
        const hay =
          `${f.id} ${f.reference} ${f.recordName} ${f.phone} ${f.purpose}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (gf.status.size && !gf.status.has(f.status)) return false;
      if (gf.type.size && !gf.type.has(f.followUpType)) return false;
      if (gf.priority.size && !gf.priority.has(f.priority)) return false;
      if (gf.owner && f.assignedTo !== gf.owner) return false;
      if (gf.campaign && f.campaign !== gf.campaign) return false;
      if (gf.dateFrom && f.scheduledDate < gf.dateFrom) return false;
      if (gf.dateTo && f.scheduledDate > gf.dateTo) return false;
      if (strip && f.scheduledDate !== strip) return false;

      return this.matchesQuick(f, quick);
    });
  });

  /**
   * Whether a follow-up belongs to a quick filter / saved view. Shared by the list and the view
   * counts.
   *
   * EVERY TEST IS ON THE SERVER'S OWN FLAGS, and each matches the tile of the same name: the
   * tiles are the server's counts, so the rows a tile opens are the rows it counted.
   */
  private matchesQuick(f: FollowUp, quick: QuickFilterKey): boolean {
    switch (quick) {
      case "dueToday":
      case "today":
        return f.dueState === "Due Today";
      case "overdue":
        return f.isOverdue;
      case "upcoming":
        return f.dueState === "Tomorrow" || f.dueState === "Upcoming";
      case "highPriority":
        return f.priority === "High" || f.priority === "Urgent";
      case "attention":
        return f.isOpen && (f.escalated || f.isOverdue || f.dependencyStatus === "Blocked");
      case "mine":
        // Assigned to the caller and still to be done - the server's own "assigned to me".
        return f.isMine && f.isOpen;
      case "escalated":
        // THE TILE'S OWN RULE, APPLIED TO ROWS. The Escalated figure counts a task escalated by
        // the Escalate action (still open) AND one executed with "Escalated" as its completion
        // reason or disposition - otherwise the tile and the list it filters disagree. See
        // SupportingRepositories.GetSummaryAsync on the server.
        return this.isEscalated(f);
      case "calls":
        return f.followUpType === "Call";
      case "completedToday":
        return f.dueState === "Completed today";
      default:
        return true;
    }
  }

  readonly pageSize = signal(10);

  setPageSize(n: number): void { this.pageSize.set(n); this.currentPage.set(1); }
  readonly sortOrder = signal("newest");

  /** The follow-up just completed: it is shown first and highlighted until the page is left. */
  readonly highlightId = signal<string | null>(null);

  private static readonly STATUS_RANK: Record<string, number> = {
    Pending: 0,
    Rescheduled: 1,
    Escalated: 2,
    Completed: 3,
    "Partially completed": 4,
    "No response": 5,
    Cancelled: 6,
  };

  readonly sortedFollowUps = computed(() => {
    const pinned = this.highlightId();
    const mode = this.sortOrder();
    return [...this.filteredFollowUps()].sort((a, b) => {
      if (pinned) {
        if (a.id === pinned && b.id !== pinned) return -1;
        if (b.id === pinned && a.id !== pinned) return 1;
      }
      // A follow-up with no due date goes to the END in every order. Its key was "T", which sorts
      // AFTER every real date - so "Latest first" (descending) put all of them on top, and those are
      // mostly the cancelled ones.
      const undated = (f: FollowUp) => !f.scheduledDate;
      if (undated(a) !== undated(b)) return undated(a) ? 1 : -1;
      const order = `${a.scheduledDate}T${a.scheduledTime}`.localeCompare(
        `${b.scheduledDate}T${b.scheduledTime}`,
      );
      if (mode === "status") {
        const rank =
          (FollowUpQueueComponent.STATUS_RANK[a.status] ?? 9) -
          (FollowUpQueueComponent.STATUS_RANK[b.status] ?? 9);
        return rank || -order || a.id.localeCompare(b.id);
      }
      return (mode === "oldest" ? order : -order) || a.id.localeCompare(b.id);
    });
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

  readonly kanbanColumns = computed(() => {
    const list = this.filteredFollowUps();
    return [
      {
        key: "dueToday",
        label: "Due Today",
        items: list.filter((f) => f.dueState === "Due Today"),
      },
      {
        key: "upcoming",
        label: "Upcoming",
        items: list.filter((f) => f.dueState === "Tomorrow" || f.dueState === "Upcoming"),
      },
      {
        key: "overdue",
        label: "Overdue",
        items: list.filter((f) => f.isOverdue),
      },
      {
        key: "completed",
        label: "Completed",
        items: list.filter((f) => isClosedStatus(f.status) && f.status !== "Cancelled"),
      },
    ];
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
    buildCalendarStrip(this.calendarCenterDate(), this.followUps()),
  );

  readonly agendaItems = computed<AgendaItem[]>(() =>
    this.followUps()
      .filter((f) => f.scheduledDate === TODAY_ISO && f.status !== "Cancelled")
      .sort((a, b) => to24h(a.scheduledTime) - to24h(b.scheduledTime))
      .map((f) => ({
        time: f.scheduledTime,
        title: `${f.followUpType} \u00b7 ${f.recordName}`,
        name: f.recordName,
        type: f.followUpType,
        status: f.status,
        followUpId: f.id,
      })),
  );

  readonly agendaDone = computed(
    () => this.agendaItems().filter((a) => isClosedStatus(a.status)).length,
  );
  readonly agendaLeft = computed(
    () => this.agendaItems().filter((a) => !isClosedStatus(a.status)).length,
  );

  /** Rows the agenda card shows in total: today first, then what is coming up, so the card is always full. */
  private readonly agendaRows = 5;
  readonly agendaToday = computed(() =>
    this.agendaItems().slice(0, this.agendaRows),
  );
  readonly agendaNext = computed(() => {
    const room = this.agendaRows - this.agendaToday().length;
    if (room <= 0) return [];
    return this.followUps()
      .filter((f) => f.isOpen && f.scheduledDate > TODAY_ISO)
      .sort((a, b) =>
        `${a.scheduledDate}T${a.scheduledTime}`.localeCompare(
          `${b.scheduledDate}T${b.scheduledTime}`,
        ),
      )
      .slice(0, room);
  });

  readonly kpiDueToday = computed(() => this.summary()?.dueToday ?? 0);
  readonly kpiUpcoming = computed(() => this.summary()?.upcoming ?? 0);
  readonly kpiCompletedToday = computed(() => this.summary()?.completedToday ?? 0);
  /**
   * ESCALATED (TS-128): counted from the rows with the same rule the Escalated filter uses - a
   * follow-up escalated with the Escalate action that is still open, OR one executed with
   * "Escalated" as its status, reason or disposition. The server's summary only counted the first
   * kind, so executing a follow-up as escalated left the tile unchanged. Every page of the queue is
   * loaded, so the rows are the whole scope; the summary is the fallback before they arrive.
   */
  readonly kpiEscalated = computed(() => {
    const rows = this.followUps();
    if (!rows.length) return this.summary()?.escalated ?? 0;
    return rows.filter((f) => this.isEscalated(f)).length;
  });

  /** One rule for "escalated", shared by the tile and the filter. */
  isEscalated(f: FollowUp): boolean {
    const says = (v: string | undefined | null) => /escalat/i.test(v ?? "");
    return (
      (f.isOpen && f.escalated) ||
      says(f.executionStatus) ||
      says(f.completionReason) ||
      says(f.disposition)
    );
  }
  readonly kpiCompletionRate = computed(() => this.summary()?.completionRatePercent ?? 0);

  readonly slaBreakdown = computed(() => {
    const list = this.followUps().filter((f) => f.isOpen);
    return {
      onTime: list.filter((f) => f.slaStatus === "On Time").length,
      approaching: list.filter((f) => f.slaStatus === "Approaching").length,
      breached: list.filter((f) => f.slaStatus === "Breached").length,
    };
  });

  /**
   * PENDING BY AGE (TS-127): open follow-ups that are NOT overdue, by how many days remain until
   * they are due - 0–3d is due today up to three days out. Overdue work used to be counted here
   * too (its "age" was clamped to 0, so it landed in 0–3d), which made the chart disagree with
   * the Overdue figure next to it. Overdue has its own tile and column; follow-ups with no due
   * date are left out because they have no age to show.
   */
  readonly agingBuckets = computed(() => {
    const buckets = { b0: 0, b1: 0, b2: 0, b3: 0 };
    const today = new Date(this.todayIso() + "T00:00:00").getTime();
    this.followUps()
      .filter((f) => f.isOpen && !f.isOverdue && f.dueState !== "Overdue" && !!f.scheduledDate)
      .forEach((f) => {
        const due = new Date(f.scheduledDate + "T00:00:00").getTime();
        if (Number.isNaN(due)) return;
        const days = Math.round((due - today) / 86400000);
        // A due date already behind us is overdue even if the server's flag has not caught up
        // yet (it is worked out when the list is read) - it belongs to the Overdue tile, not here.
        if (days < 0) return;
        if (days <= 3) buckets.b0++;
        else if (days <= 7) buckets.b1++;
        else if (days <= 15) buckets.b2++;
        else buckets.b3++;
      });
    return buckets;
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

  /** The five headline tiles. Each one is also the quick filter it names. */
  readonly kpiTiles = computed<KpiTile[]>(() => [
    {
      key: "dueToday",
      label: "Due today",
      value: this.kpiDueToday(),
      hint: "Pending for today",
      icon: "clock",
      tone: "info",
    },
    {
      key: "upcoming",
      label: "Upcoming",
      value: this.kpiUpcoming(),
      hint: "Scheduled ahead",
      icon: "calendar",
      tone: "ok",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: this.kpiOverdue(),
      hint: "Past their due date",
      icon: "alert",
      tone: "danger",
    },
    {
      key: "completedToday",
      label: "Completed today",
      value: this.kpiCompletedToday(),
      hint: "Closed out today",
      icon: "check-circle",
      tone: "violet",
    },
    {
      key: "escalated",
      label: "Escalated",
      value: this.kpiEscalated(),
      hint: "Need attention",
      icon: "flag",
      tone: "warn",
    },
  ]);

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
    const saved = this.savedViews.find(
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

  /** Follow-ups in each saved view, so the view pills can show their size. */
  readonly viewCounts = computed<Record<string, number>>(() => {
    const map: Record<string, QuickFilterKey> = {
      mine: "mine",
      today: "today",
      overdue: "overdue",
      upcoming: "upcoming",
            high: "highPriority",
      attention: "attention",
      calls: "calls",
      escalated: "escalated",
      completedToday: "completedToday",
    };
    const scoped = this.followUps().filter(
      (f) => !this.recordFilterId() || f.recordId === this.recordFilterId(),
    );
    const counts: Record<string, number> = { all: scoped.length };
    for (const view of this.savedViews) {
      counts[view.id] = scoped.filter((f) =>
        this.matchesQuick(f, map[view.id] ?? null),
      ).length;
    }
    return counts;
  });

  readonly kpiBlocked = computed(
    () =>
      this.followUps().filter(
        (f) => f.dependencyStatus === "Blocked" && f.isOpen,
      ).length,
  );

  /** The four aging buckets as columns for the pulse panel's chart. */
  readonly agingColumns = computed(() => {
    const b = this.agingBuckets();
    const max = Math.max(1, b.b0, b.b1, b.b2, b.b3);
    return [
      { label: "0–3d", value: b.b0, tone: "hot" },
      { label: "4–7d", value: b.b1, tone: "warn" },
      { label: "8–15d", value: b.b2, tone: "ok" },
      { label: "15d+", value: b.b3, tone: "ok" },
    ].map((c) => ({ ...c, height: (c.value / max) * 100 }));
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
    this.showToast("Filters applied");
  }

  resetFilters() {
    this.selectedStripDate.set(null);
    this.draftFilters.set(emptyFilters());
    this.activeFilters.set(emptyFilters());
    this.activeQuickFilter.set(null);
    this.activeSavedViewId.set(null);
    this.searchTerm.set("");
    this.showToast("Filters reset");
    this.scrollToResults();
  }

  applySavedView(view: SavedView) {
    this.activeFilters.set(emptyFilters());
    this.selectedStripDate.set(null);
    this.activeSavedViewId.set(view.id);
    const map: Record<string, QuickFilterKey> = {
      mine: "mine",
      today: "today",
      overdue: "overdue",
      upcoming: "upcoming",
            high: "highPriority",
      attention: "attention",
      calls: "calls",
      escalated: "escalated",
      completedToday: "completedToday",
    };
    this.activeQuickFilter.set(map[view.id] ?? null);
  }

  shiftCalendarMonth(months: number) {
    const d = new Date(this.calendarMonthCursor() + "T00:00:00");
    d.setMonth(d.getMonth() + months);
    this.calendarMonthCursor.set(this.toDateInput(d));
  }

  onCalendarDayClick(day: { iso: string; items: FollowUp[] }) {
    if (day.items.length === 1) {
      this.openPreview(day.items[0].id);
    } else {
      this.calendarSelectedDate.set(day.iso);
      this.calendarCenterDate.set(day.iso);
      this.onStripDateClick(day.iso);
    }
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
    const ids = this.selectedWith("Execute");
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
    return f.permittedActions.includes("Execute") && f.dependencyStatus !== "Blocked";
  }

  /** Why Execute is not available on this row, for its tooltip. */
  executeHint(f: FollowUp): string {
    if (!f.isOpen) return "This follow-up is closed";
    if (!f.permittedActions.includes("Execute")) {
      return f.isMine
        ? "You do not have permission to execute follow-ups"
        : `Assigned to ${f.assignedTo} - only they can execute it`;
    }
    return f.dependencyStatus === "Blocked"
      ? `Blocked: ${f.dependencyBlockedReason ?? "dependency pending"}`
      : "Execute";
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
    exportQueue() {
    if (!this.canExport()) return;
    const rows = this.selectedIds().size
      ? this.bulkFollowUps()
      : this.filteredFollowUps();
    const cell = (value: string) =>
      '"' +
      (/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replace(/"/g, '""') +
      '"';
    const data = [
      [
        "Follow-Up ID",
        "Related To",
        "Type",
        "Reason",
        "Date",
        "Time",
        "Assigned User",
        "Priority",
        "Status",
      ],
      ...rows.map((f) => [
        f.reference,
        f.recordName,
        f.followUpType,
        f.purpose,
        f.scheduledDate,
        f.scheduledTime,
        f.assignedTo,
        f.priority,
        f.status,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + data], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `follow-up-queue-${this.today}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showToast(`Exported ${rows.length} follow-ups`);
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
      return;
    }
    this.onStripDateClick(iso);
  }

  /** The "All" tab: drops the tab, tile and day narrowing but keeps the search and the filter panel's choices. */
  showAll(): void {
    this.activeQuickFilter.set(null);
    this.activeSavedViewId.set(null);
    this.selectedStripDate.set(null);
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