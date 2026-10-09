/**
 * Screen 9 – Follow-Up Execution
 * DON Module | Fundraising CRM
 *
 * Single-file TypeScript module containing the domain models, the data
 * access service, and the standalone Angular component for this screen.
 * Template and styles remain in follow-up-execution.html / .css per the
 * component's templateUrl / styleUrl.
 */

import {
  afterRenderEffect,
  ElementRef,
  viewChild,
  ChangeDetectionStrategy,
  Component,
  Injectable,
  OnInit,
  computed,
  inject,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router } from "@angular/router";
import {
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from "@angular/forms";
import {
  Observable,
  catchError,
  finalize,
  forkJoin,
  map,
  of,
  switchMap,
  throwError,
} from "rxjs";
import { DonorApiService } from "../../../../Service/donor-api.service";
import { apiErrorMessage } from "../../../../Shared/models/api-response.model";
import {
  ConsentWarning,
  DonLookupItem,
  FollowUp as ApiFollowUp,
} from "../../../../Shared/models/donor-contract.model";
import { PageHeader } from '../../../../Shared/components/page-header/page-header';
import { ToastService } from "../../../../Shared/services/toast.service";

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

/**
 * Domain models for Screen 9 – Follow-Up Execution
 * DON Module | Fundraising CRM
 *
 * EVERY CHOICE ON THIS FORM IS ONE THE API OFFERS. The screen used to carry its own lists -
 * thirteen outcomes, six "follow-up types", four priorities, six stages - typed into this file.
 * Most of their values were ones the API does not have ("Very Interested", "Meeting", "Critical",
 * "Engaged"), so completing a follow-up with them was refused before a handler ran; and three
 * required fields (execution status, completion reason, disposition) had nowhere to be sent at
 * all. The lists now arrive with the screen's data, and what is chosen from them is stored.
 */

/** Healthy | Needs attention | At risk, from the server's reading of the lead's health. */
export type RiskLevel = string;

export type QualificationReadiness = "Not Ready" | "Partially Ready" | "Ready";

/** The person the follow-up is about - a lead, or a donor. */
export interface LeadSummary {
  /** The lead's id, or the donor's when the follow-up is about a donor. */
  recordId: string;

  /** The reference a person reads: LED-2026-000019, DON-2026-000004. */
  reference: string;
  isDonor: boolean;
  fullName: string;
  phone: string;
  email: string;
  campaign: string;
  leadSource: string;
  currentOwner: string;
  currentStage: string;

  /** Cold | Warm | Hot. Empty for a donor: nobody scores one. */
  currentTemperature: string;
  currentPotential: string;
  followUpStats: {
    open: number;
    completed: number;
    overdue: number;
  };
}

export interface FollowUpSummary {
  followUpId: string;
  reference: string;

  /** The channel it was planned on, as a person reads it. */
  type: string;

  /** The interaction type that channel corresponds to - the form's starting choice. */
  typeValue: string;
  subject: string;
  priority: string;
  scheduledDate: string;
  scheduledTime: string;
  assignedUser: string;
  originalPurpose: string;
  expectedOutcome: string;
  version: number;
  isOpen: boolean;

  /** The server's per-row answers: only the assignee may execute. */
  canExecute: boolean;
  canEscalate: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  type: "PDF" | "DOCX" | "PNG" | "JPG";
  sizeLabel: string;
}

export interface ExecutionHistoryEntry {
  id: string;
  date: string;

  /** The channel's API value, for its glyph; `typeLabel` is what is printed. */
  type: string;
  typeLabel: string;
  outcome: string;
  detail?: string;
}

export interface QualificationCheck {
  label: string;
  complete: boolean;
}

export interface RiskIndicator {
  level: RiskLevel;
  reason: string;
}

/** Shape of the primary Execution Form (Sections 1-9). All values are the API's. */
export interface ExecutionFormValue {
  actualContactDate: string;
  actualContactTime: string;
  executionStatus: string | null;
  completionReason: string | null;
  outcome: string | null;
  engagementLevel: string | null;
  communicationQuality: string | null;
  completionNotes: string;
  internalNotes: string;
}

export interface TemperatureUpdateValue {
  newTemperature: string | null;
  reasonForChange: string;
}

export interface NextFollowUpValue {
  ownerId?: string;
  enabled: boolean;
  type: string | null;
  date: string;
  time: string;
  priority: string | null;
  purpose: string;
  owner: string;
  consentAcknowledged: boolean;
}

export interface EscalationValue {
  escalateTo: string;
  reason: string;
  notes: string;
}

/**
 * What the form suggests after an outcome is chosen. Keyed by the API's outcome value; an outcome
 * it does not name simply suggests nothing.
 */
export const OUTCOME_RECOMMENDATIONS: Record<string, string[]> = {
  Interested: ["Schedule a meeting", "Send information", "Plan the next follow-up"],
  InformationRequested: ["Send information", "Plan the next follow-up"],
  MeetingScheduled: ["Plan the next follow-up"],
  MeetingCompleted: ["Share the donation link", "Plan the next follow-up"],
  DonationDiscussion: ["Share the donation link", "Plan the next follow-up"],
  CallbackRequested: ["Plan the call back"],
  NoAnswer: ["Try again in a few days"],
  WrongNumber: ["Correct the contact details"],
  NotInterested: ["Close the lead from the queue"],
  DoNotContact: ["Record the withdrawal in the consent centre"],
};

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export interface FollowUpExecutionSnapshot {
  ownerOptions: DonLookupItem[];

  // The form's lists, as the API offers them.
  contactChannelOptions: DonLookupItem[];
  outcomeOptions: DonLookupItem[];
  engagementOptions: DonLookupItem[];
  qualityOptions: DonLookupItem[];
  temperatureOptions: DonLookupItem[];
  executionStatusOptions: DonLookupItem[];
  completionReasonOptions: DonLookupItem[];
  dispositionOptions: DonLookupItem[];
  nextChannelOptions: DonLookupItem[];
  priorityOptions: DonLookupItem[];

  lead: LeadSummary;
  followUp: FollowUpSummary;
  executionHistory: ExecutionHistoryEntry[];
  riskIndicator: RiskIndicator | null;
  readinessScore: number;
  qualificationChecks: QualificationCheck[];

  /** The caller may change a lead's temperature - the same right as scoring it anywhere else. */
  canScore: boolean;
}

export interface CompleteFollowUpPayload {
  followUp: FollowUpSummary;
  record: LeadSummary;

  /** How the contact was actually made: an interaction type the API has. */
  contactChannel: string;
  execution: ExecutionFormValue;
  temperature: TemperatureUpdateValue;
  disposition: string | null;
  attachments: Attachment[];
  nextFollowUp: NextFollowUpValue;
}

/**
 * Data access for Screen 9 – Follow-Up Execution.
 */
@Injectable({ providedIn: "root" })
export class FollowUpExecutionService {
  private readonly api = inject(DonorApiService);

  /**
   * Everything the execution screen needs about one follow-up and the person it is about.
   *
   * THE FOLLOW-UP FIRST, BY ITS OWN ID. It says whether it is about a lead or a donor, so the
   * screen no longer has to be told - it used to treat a donor's id as a lead's, and a donor's
   * follow-up could not be opened here at all. Then, together: that person's communication
   * timeline (profile, history, health and the outcome lists) and the planner's lists for them
   * (owners, channels, priorities, the execution form's own options, and their follow-up counts).
   */
  loadSnapshot(followUpId: string): Observable<FollowUpExecutionSnapshot> {
    return this.api.getFollowUp(followUpId).pipe(
      switchMap((followUp) => {
        const donorId = followUp.donorId;
        const leadId = donorId ? null : followUp.leadId;

        return forkJoin({
          followUp: of(followUp),
          timeline: this.api.getCommunicationTimeline(leadId, donorId),
          planner: this.api.getFollowUpPlanner({ page: 1, pageSize: 1, donorId, leadId }),
        });
      }),
      map(({ followUp, timeline, planner }) => {
        const due = followUp.dueAtUtc ? new Date(followUp.dueAtUtc) : null;
        const label = (options: readonly DonLookupItem[], value: string) =>
          options.find((option) => option.value === value)?.label ?? value;
        const isDonor = !!followUp.donorId;
        const health = timeline.healthScore ?? 0;

        const snapshot: FollowUpExecutionSnapshot = {
          ownerOptions: planner.ownerOptions ?? [],
          contactChannelOptions: planner.contactChannelOptions ?? [],
          outcomeOptions: timeline.outcomeOptions ?? [],
          engagementOptions: timeline.engagementOptions ?? [],
          qualityOptions: timeline.qualityOptions ?? [],
          temperatureOptions: timeline.temperatureOptions ?? [],
          executionStatusOptions: planner.executionStatusOptions ?? [],
          completionReasonOptions: planner.completionReasonOptions ?? [],
          dispositionOptions: planner.dispositionOptions ?? [],
          nextChannelOptions: (planner.channelOptions ?? []).map((option) => ({
            ...option,
            label: channelLabel(option.value),
          })),
          priorityOptions: planner.priorityOptions ?? [],
          lead: {
            recordId: (followUp.donorId ?? followUp.leadId) ?? "",
            reference: followUp.donorReference ?? followUp.leadReference ?? "",
            isDonor,
            fullName: followUp.recordDisplayName ?? timeline.displayName ?? "",

            // MASKED BY THE SERVER unless this caller holds the sensitive-contact permission.
            phone: followUp.contactPhone ?? timeline.mobileNumber ?? "",
            email: followUp.contactEmail ?? timeline.emailAddress ?? "",
            campaign: followUp.campaignName ?? timeline.campaignName ?? "",
            leadSource: timeline.source ?? "",
            currentOwner: followUp.recordOwnerName ?? timeline.ownerName ?? "Unassigned",
            currentStage: timeline.status ?? "",
            currentTemperature: timeline.isLead ? timeline.temperature : "",
            currentPotential: timeline.isLead ? timeline.donationPotential : "",

            // THIS PERSON'S FOLLOW-UPS, counted by the server. They were counted here from the
            // first fifty rows and a status ("Scheduled") the API does not have, so Open and
            // Overdue always read zero.
            followUpStats: {
              open: planner.summary?.open ?? 0,
              completed: planner.summary?.completed ?? 0,
              overdue: planner.summary?.overdue ?? 0,
            },
          },
          followUp: {
            followUpId: followUp.id,
            reference: followUp.followUpReference,
            type: channelLabel(followUp.permittedChannel),
            typeValue: toInteractionType(followUp.permittedChannel),
            subject: followUp.purpose ?? "",
            priority: followUp.priority,
            scheduledDate: due ? localDate(due) : "",
            scheduledTime: due
              ? due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
              : "",
            assignedUser: followUp.relationshipOwnerName ?? "Unassigned",
            originalPurpose: followUp.purpose ?? "",
            expectedOutcome: followUp.nextAction ?? "",
            version: followUp.version,
            isOpen: followUp.isOpen,
            canExecute: (followUp.permittedActions ?? []).includes("Execute"),
            canEscalate: (followUp.permittedActions ?? []).includes("Escalate"),
          },

          // What has already been said to this person, newest first - the timeline's own entries.
          executionHistory: (timeline.entries ?? []).slice(0, 8).map((entry) => ({
            id: entry.id,
            date: localDate(new Date(entry.occurredAtUtc)),
            type: entry.interactionType,
            typeLabel: label(timeline.interactionTypeOptions ?? [], entry.interactionType),
            outcome: entry.outcome === "NotContacted"
              ? "Not contacted"
              : label(timeline.outcomeOptions ?? [], entry.outcome),
            detail: entry.summary,
          })),

          // THE SERVER'S READING OF THE LEAD'S HEALTH - the same word the queue and the timeline
          // print. A donor who was never a lead has no score, and no indicator is drawn.
          riskIndicator: timeline.healthBand
            ? { level: timeline.healthBand, reason: (timeline.healthReasons ?? []).join(" · ") }
            : null,
          readinessScore: health,
          qualificationChecks: isDonor
            ? []
            : [
                { label: "Communication recorded", complete: (timeline.entries ?? []).length > 0 },
                { label: "A follow-up completed", complete: (timeline.followUpCompletedCount ?? 0) > 0 },
                { label: "Relationship healthy", complete: timeline.healthBand === "Healthy" },
                { label: "Temperature hot", complete: timeline.temperature === "Hot" },
                { label: "Interest expressed", complete: (timeline.interestedCount ?? 0) > 0 },
              ],
          canScore: (timeline.permittedActions ?? []).includes("Score"),
        };

        return snapshot;
      }),
    );
  }

  /**
   * Complete Follow-Up - the document's own action.
   *
   * "Complete the required fields on the Follow-Up Execution page. Select Complete Follow-Up. The
   * follow-up details are updated in the Communication Timeline."
   *
   * ONE WRITE COMPLETES IT AND RECORDS THE CONVERSATION. It used to be three calls - the contact
   * posted to the LEAD's own contact action, then the completion, then the next follow-up - and
   * the first of them could only be made by the lead's owner, took outcome words the API does not
   * have, and did not exist for donors. So a follow-up assigned to somebody who did not own the
   * lead, any follow-up on a donor, and most outcomes on anything else, all failed at step one.
   *
   * A CHANGE OF TEMPERATURE GOES FIRST, through the lead's own scoring action with its reason,
   * because that is where the reason is audited. THE NEXT FOLLOW-UP GOES LAST, and a failure
   * there is reported as what it is: the follow-up is complete, the next one was not planned.
   */
  completeFollowUp(
    payload: CompleteFollowUpPayload,
  ): Observable<{ completedAt: string; nextFollowUpId: string | null; nextFollowUpError: string | null }> {
    const execution = payload.execution;

    if (!execution.outcome) {
      return throwError(() => new Error("Outcome is required."));
    }
    if (!execution.completionNotes || execution.completionNotes.trim().length < 20) {
      return throwError(() => new Error("Completion notes are required."));
    }

    const record = payload.record;
    const occurredAt = toUtc(execution.actualContactDate, execution.actualContactTime);
    const newTemperature = payload.temperature.newTemperature;
    const rescoring =
      !record.isDonor && !!newTemperature && newTemperature !== record.currentTemperature;

    const score$: Observable<unknown> = rescoring
      ? this.api.scoreLead(record.recordId, {
          temperature: newTemperature!,
          donationPotential: record.currentPotential,
          reason: payload.temperature.reasonForChange.trim(),
        })
      : of(null);

    return score$.pipe(
      switchMap(() =>
        this.api.completeFollowUp(payload.followUp.followUpId, {
          // The executor's account of what happened - the line the timeline shows.
          completionOutcome: execution.completionNotes.trim(),
          completedAtUtc: occurredAt,
          expectedVersion: payload.followUp.version,
          outcome: execution.outcome,
          interactionType: payload.contactChannel,
          direction: "Outgoing",
          notes: execution.internalNotes?.trim() || null,
          engagementLevel: execution.engagementLevel,
          quality: execution.communicationQuality,
          attachmentName: payload.attachments.map((file) => file.name).join(", ").slice(0, 260) || null,
          executionStatus: execution.executionStatus,
          completionReason: execution.completionReason,
          disposition: payload.disposition,
        }),
      ),
      switchMap(() => {
        const next = payload.nextFollowUp;

        if (!next.enabled || !next.date) {
          return of({ completedAt: new Date().toISOString(), nextFollowUpId: null, nextFollowUpError: null });
        }

        return this.api
          .scheduleFollowUp({
            donorId: record.isDonor ? record.recordId : null,
            leadId: record.isDonor ? null : record.recordId,
            relationshipOwnerUserId: next.ownerId ?? null,
            relationshipOwnerName: next.owner,
            purpose: next.purpose,
            permittedChannel: next.type ?? "",
            nextAction: next.purpose,
            dueAtUtc: toUtc(next.date, next.time),
            priority: next.priority ?? "",
            consentWarningAcknowledged: next.consentAcknowledged,
          })
          .pipe(
            map((created) => ({
              completedAt: new Date().toISOString(),
              nextFollowUpId: created.id as string | null,
              nextFollowUpError: null as string | null,
            })),

            // THE FOLLOW-UP IS ALREADY COMPLETE. Failing the whole save here would tell the
            // person nothing had been recorded, and they would do it again.
            catchError((error: unknown) =>
              of({
                completedAt: new Date().toISOString(),
                nextFollowUpId: null,
                nextFollowUpError: apiErrorMessage(error, "The next follow-up could not be scheduled."),
              }),
            ),
          );
      }),
    );
  }

  /**
   * Escalate - recorded as an escalation on the follow-up, with its reason, and handed to the
   * person chosen. It used to be a plain reassignment with the word "Escalated" in its reason, so
   * nothing marked the follow-up as escalated and the queue's Escalated view stayed empty.
   */
  escalate(
    followUp: FollowUpSummary,
    owner: DonLookupItem,
    escalation: EscalationValue,
  ): Observable<ApiFollowUp> {
    const notes = escalation.notes?.trim();

    return this.api.escalateFollowUp(followUp.followUpId, {
      escalateToUserId: owner.value,
      escalateToName: owner.label,
      reason: notes ? `${escalation.reason.trim()} - ${notes}` : escalation.reason.trim(),
      expectedVersion: followUp.version,
    });
  }

  /** Whether the next follow-up's channel is one this person permits. */
  consentFor(record: LeadSummary, channel: string): Observable<ConsentWarning> {
    return this.api.getConsentWarning(
      record.isDonor ? record.recordId : undefined,
      record.isDonor ? undefined : record.recordId,
      channel,
    );
  }
}

/** A consent channel as a person reads it. */
function channelLabel(channel: string): string {
  switch (channel) {
    case "PhoneCall":
      return "Phone call";
    case "Sms":
      return "SMS";
    default:
      return channel;
  }
}

/** The interaction type a planned channel starts the form on. */
function toInteractionType(channel: string): string {
  switch (channel) {
    case "PhoneCall":
      return "Call";
    case "Email":
    case "Sms":
    case "WhatsApp":
      return channel;
    default:
      return "";
  }
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toUtc(date: string, time: string): string {
  return new Date(`${date}T${time || "09:00"}`).toISOString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ACCEPTED_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** The server asks for a reason of at least this many characters when a lead is re-scored. */
const SCORE_REASON_MINIMUM = 10;

/** Disallow any date later than today. */
function noFutureDateValidator(): ValidatorFn {
  return (control): ValidationErrors | null => {
    if (!control.value) return null;
    const selected = new Date(control.value);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return selected.getTime() > today.getTime() ? { futureDate: true } : null;
  };
}

@Component({
  selector: "app-follow-up-execution",
  standalone: true,
  imports: [PageHeader, ReactiveFormsModule],
  templateUrl: "./follow-up-execution.html",
  styleUrl: "./follow-up-execution.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FollowUpExecutionComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly executionService = inject(FollowUpExecutionService);
  private readonly toast = inject(ToastService);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: null,
  });
  private readonly api = inject(DonorApiService);

  /**
   * The follow-up this screen is executing.
   *
   * NO FABRICATED FALLBACKS. `followUpId` used to fall back to the literal 'FUP-2026-00421' and
   * `leadId` to 'LEAD-2026-0142' when the query string carried neither - so arriving without
   * parameters silently executed a follow-up against an invented lead. An absent id is now an
   * empty string, and the screen says it has nothing to execute.
   *
   * THE FOLLOW-UP SAYS WHO IT IS ABOUT. The lead and donor ids in the address are no longer
   * trusted for that: the record is read from the follow-up itself.
   */
  readonly followUpId = computed(() => this.params()?.get("followUpId") ?? "");

  /** The donor's id, once the follow-up has said it is about a donor. */
  readonly donorId = computed(() => {
    const record = this.snapshot()?.lead;
    return record?.isDonor ? record.recordId : null;
  });

  /** The lead's id, once the follow-up has said it is about a lead. */
  readonly leadId = computed(() => {
    const record = this.snapshot()?.lead;
    return record && !record.isDonor ? record.recordId : "";
  });

  // ---- Async state -------------------------------------------------------
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  readonly snapshot = signal<FollowUpExecutionSnapshot | null>(null);
  readonly attachments = signal<Attachment[]>([]);
  readonly attachmentError = signal<string | null>(null);
  readonly showEscalationModal = signal(false);
  readonly expandedHistoryId = signal<string | null>(null);

  readonly escalationDialog =
    viewChild<ElementRef<HTMLDialogElement>>("escalationDialog");

  constructor() {
    afterRenderEffect(() => {
      const dialog = this.escalationDialog()?.nativeElement;
      if (dialog && !dialog.open) dialog.showModal();
    });
  }

  // ---- Options for template: the server's lists ----------------------------
  readonly executionStatusOptions = computed(() => this.snapshot()?.executionStatusOptions ?? []);
  readonly completionReasonOptions = computed(() => this.snapshot()?.completionReasonOptions ?? []);
  readonly outcomeOptions = computed(() => this.snapshot()?.outcomeOptions ?? []);
  readonly engagementLevelOptions = computed(() => (this.snapshot()?.engagementOptions ?? []).map((o) => o.value));
  readonly communicationQualityOptions = computed(() => (this.snapshot()?.qualityOptions ?? []).map((o) => o.value));
  readonly temperatureOptions = computed(() => (this.snapshot()?.temperatureOptions ?? []).map((o) => o.value));
  readonly dispositionOptions = computed(() => this.snapshot()?.dispositionOptions ?? []);

  /** How the contact was actually made - calls, messages, meetings and visits. */
  readonly followUpTypeOptions = computed(() => this.snapshot()?.contactChannelOptions ?? []);

  /** The channels a next follow-up can be planned on - the consent channels. */
  readonly nextChannelOptions = computed(() => this.snapshot()?.nextChannelOptions ?? []);
  readonly priorityOptions = computed(() => (this.snapshot()?.priorityOptions ?? []).map((o) => o.value));
  readonly ownerOptions = computed(() => this.snapshot()?.ownerOptions ?? []);
  readonly acceptedAttachmentTypes = ACCEPTED_ATTACHMENT_EXTENSIONS.join(",");

  /**
   * Whether the caller may execute this follow-up - the server's answer for this row.
   *
   * THE ROLE FLOW: only the person a follow-up is assigned to may execute it. Somebody else who
   * can see it - the owner of the lead or donor, a manager - opens this screen to read it.
   */
  readonly canExecute = computed(() => this.snapshot()?.followUp.canExecute === true);
  readonly canEscalate = computed(() => this.snapshot()?.followUp.canEscalate === true);
  readonly canScore = computed(() => {
    const data = this.snapshot();
    return !!data && data.canScore && !data.lead.isDonor;
  });

  /** Why the form cannot be saved, when it cannot. */
  readonly viewOnlyReason = computed(() => {
    const followUp = this.snapshot()?.followUp;
    if (!followUp || followUp.canExecute) return "";
    if (!followUp.isOpen) return "This follow-up is closed. It is shown here for reference.";
    return `This follow-up is assigned to ${followUp.assignedUser}. Only they can execute it.`;
  });

  // ---- Forms ---------------------------------------------------------------
  readonly executionChannel = this.fb.nonNullable.control<string>(
    "",
    Validators.required,
  );

  readonly executionForm = this.fb.nonNullable.group({
    actualContactDate: [
      this.today(),
      [Validators.required, noFutureDateValidator()],
    ],
    actualContactTime: [this.nowTime(), Validators.required],
    executionStatus: [
      null as ExecutionFormValue["executionStatus"],
      Validators.required,
    ],
    completionReason: [
      null as ExecutionFormValue["completionReason"],
      Validators.required,
    ],
    outcome: [null as string | null, Validators.required],
    engagementLevel: [
      null as ExecutionFormValue["engagementLevel"],
      Validators.required,
    ],
    communicationQuality: [
      null as ExecutionFormValue["communicationQuality"],
      Validators.required,
    ],
    completionNotes: [
      "",
      [
        Validators.required,
        Validators.minLength(20),
        Validators.maxLength(2000),
      ],
    ],
    internalNotes: ["", Validators.maxLength(3000)],
  });

  readonly temperatureForm = this.fb.nonNullable.group({
    newTemperature: [null as string | null],
    reasonForChange: [""],
  });

  readonly dispositionForm = this.fb.nonNullable.group({
    disposition: [null as string | null, Validators.required],
  });

  readonly nextFollowUpForm = this.fb.nonNullable.group({
    enabled: [false],
    type: [null as string | null],
    date: [""],
    time: [""],
    priority: [null as string | null],
    purpose: ["", Validators.maxLength(500)],
    owner: ["", Validators.required],
  });

  readonly escalationForm = this.fb.nonNullable.group({
    escalateTo: ["", Validators.required],
    reason: ["", [Validators.required, Validators.minLength(10)]],
    notes: [""],
  });

  // ---- Derived / computed state -------------------------------------------
  readonly selectedOutcome = toSignal(
    this.executionForm.controls["outcome"].valueChanges,
    {
      initialValue: null as string | null,
    },
  );

  readonly outcomeRecommendations = computed(() => {
    const outcome = this.selectedOutcome();
    if (!outcome) return [];
    return OUTCOME_RECOMMENDATIONS[outcome] ?? [];
  });

  readonly selectedTemperature = toSignal(
    this.temperatureForm.controls["newTemperature"].valueChanges,
    { initialValue: null as string | null },
  );

  readonly temperatureChanged = computed(() => {
    const current = this.snapshot()?.lead.currentTemperature;
    const next = this.selectedTemperature();
    return this.canScore() && !!next && !!current && next !== current;
  });

  readonly nextFollowUpEnabled = toSignal(
    this.nextFollowUpForm.controls["enabled"].valueChanges,
    {
      initialValue: false,
    },
  );

  /**
   * The server's caution about the next follow-up's channel, when it has one to acknowledge.
   *
   * A CAUTION IS NOT A REFUSAL. "No consent has been recorded" may be scheduled once the person
   * planning it says they have read it; a channel the person has withdrawn may not be at all.
   * The tick under the next follow-up is that acknowledgement - it is never sent silently.
   */
  readonly nextConsentCaution = signal("");
  readonly nextConsentAcknowledged = signal(false);

  readonly qualificationChecks = computed<QualificationCheck[]>(
    () => this.snapshot()?.qualificationChecks ?? [],
  );

  readonly readinessScore = computed(
    () => this.snapshot()?.readinessScore ?? 0,
  );

  /**
   * Ready, partially ready or not ready to qualify - from the server's readings: the lead's
   * temperature and its health band. It used to apply a threshold of its own (75) to a score the
   * rest of the module bands at 70.
   */
  readonly qualificationStatus = computed<QualificationReadiness>(() => {
    const data = this.snapshot();
    if (!data || data.lead.isDonor) return "Not Ready";

    const temperature = this.selectedTemperature() ?? data.lead.currentTemperature;
    const completeCount = this.qualificationChecks().filter((c) => c.complete).length;

    if (temperature === "Hot" && data.riskIndicator?.level === "Healthy") return "Ready";
    if (completeCount === 0) return "Not Ready";
    return "Partially Ready";
  });

  readonly riskIndicator = computed<RiskIndicator | null>(
    () => this.snapshot()?.riskIndicator ?? null,
  );

  readonly gaugeCircumference = 2 * Math.PI * 42;
  readonly gaugeOffset = computed(
    () => this.gaugeCircumference * (1 - this.readinessScore() / 100),
  );

  readonly executionHistory = computed<ExecutionHistoryEntry[]>(
    () => this.snapshot()?.executionHistory ?? [],
  );

  ngOnInit(): void {
    this.loadData();
  }

  // ---- Call report presentation --------------------------------------------
  readonly channelGlyph: Record<string, string> = {
    Call: "ri-phone-line",
    PhoneCall: "ri-phone-line",
    "Phone call": "ri-phone-line",
    Email: "ri-mail-line",
    Sms: "ri-message-2-line",
    SMS: "ri-message-2-line",
    WhatsApp: "ri-whatsapp-line",
    Meeting: "ri-team-line",
    Visit: "ri-map-pin-line",
    Post: "ri-mail-open-line",
    Note: "ri-sticky-note-line",
  };

  glyphFor(channel: string | null | undefined): string {
    return (channel && this.channelGlyph[channel]) || "ri-chat-3-line";
  }

  initials(name: string | null | undefined): string {
    return (name || "?")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0))
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  /** Picks a value on a reactive control from an outlined option button. */
  pick(control: { setValue(value: never): void; markAsDirty(): void }, value: unknown): void {
    control.setValue(value as never);
    control.markAsDirty();
  }

  /** Loads (or reloads) the execution snapshot. Also used by the "Reload" empty-state action. */
  retryLoad(): void {
    this.loadData();
  }

  private loadData(): void {
    this.loading.set(true);
    this.loadError.set(null);
    if (!this.followUpId()) {
      this.loading.set(false);
      this.loadError.set(
        "Select a follow-up from the queue to record its execution.",
      );
      return;
    }

    this.executionService
      .loadSnapshot(this.followUpId())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (snapshot) => {
          this.snapshot.set(snapshot);

          // Start on the channel it was planned on, when that is a way contact can be made.
          const planned = snapshot.followUp.typeValue;
          const offered = snapshot.contactChannelOptions.some((option) => option.value === planned);
          this.executionChannel.setValue(offered ? planned : snapshot.contactChannelOptions[0]?.value ?? "");

          this.temperatureForm.controls["newTemperature"].setValue(
            snapshot.lead.currentTemperature || null,
          );

          // The next follow-up starts out with whoever is executing this one.
          this.nextFollowUpForm.controls["owner"].setValue(
            snapshot.ownerOptions.some((owner) => owner.label === snapshot.followUp.assignedUser)
              ? snapshot.followUp.assignedUser
              : "",
          );

          // A FOLLOW-UP THE CALLER MAY NOT EXECUTE IS SHOWN, NOT WORKED. The forms are switched
          // off rather than left to fail on save.
          const forms = [this.executionForm, this.temperatureForm, this.dispositionForm, this.nextFollowUpForm];
          for (const form of forms) {
            if (snapshot.followUp.canExecute) form.enable({ emitEvent: false });
            else form.disable({ emitEvent: false });
          }
        },
        error: (error: unknown) => {
          this.loadError.set(
            apiErrorMessage(error, "This follow-up could not be opened. Please try again."),
          );
        },
      });
  }

  // ---- Presentation helpers (pure, template-facing) ------------------------
  tempTone(temperature: string): "danger" | "warning" | "info" {
    if (temperature === "Hot") return "danger";
    if (temperature === "Warm") return "warning";
    return "info";
  }

  riskTone(level: RiskLevel): "success" | "warning" | "danger" {
    if (level === "Healthy") return "success";
    if (level === "Needs attention") return "warning";
    return "danger";
  }

  qualTone(status: QualificationReadiness): "success" | "warning" | "neutral" {
    if (status === "Ready") return "success";
    if (status === "Partially Ready") return "warning";
    return "neutral";
  }

  /**
   * The colour key for a priority. The styles were written for Low / Medium / High / Critical;
   * the API's are Low / Normal / High / Urgent.
   */
  priorityKey(priority: string): string {
    if (priority === "Normal") return "Medium";
    return priority === "Urgent" ? "Critical" : priority;
  }

  // ---- Attachments ---------------------------------------------------------
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_ATTACHMENT_EXTENSIONS.includes(extension)) {
      this.attachmentError.set(
        "Only PDF, DOCX, PNG, and JPG files are supported.",
      );
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      this.attachmentError.set("Maximum attachment size is 10 MB.");
      return;
    }

    this.attachmentError.set(null);
    const attachment: Attachment = {
      id: `ATT-${Date.now()}`,
      name: file.name,
      type: extension.replace(".", "").toUpperCase() as Attachment["type"],
      sizeLabel: this.formatBytes(file.size),
    };
    this.attachments.update((list) => [...list, attachment]);
  }

  removeAttachment(id: string): void {
    this.attachments.update((list) => list.filter((a) => a.id !== id));
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ---- Execution history -----------------------------------------------------
  toggleHistoryEntry(id: string): void {
    this.expandedHistoryId.update((current) => (current === id ? null : id));
  }

  // ---- Escalation modal -------------------------------------------------------
  openEscalationModal(): void {
    if (!this.canEscalate()) return;
    this.showEscalationModal.set(true);
  }

  closeEscalationModal(): void {
    this.showEscalationModal.set(false);
    this.escalationForm.reset({ escalateTo: "", reason: "", notes: "" });
  }

  submitEscalation(): void {
    if (this.saving()) return;
    if (this.escalationForm.invalid) {
      this.escalationForm.markAllAsTouched();
      this.formError.set("Choose who to escalate to and give a reason of at least 10 characters.");
      return;
    }

    const data = this.snapshot();
    const value = this.escalationForm.getRawValue();
    const owner = this.ownerOptions().find((option) => option.label === value.escalateTo);

    if (!data || !owner) {
      this.formError.set("Choose somebody to escalate to from the list.");
      return;
    }

    this.saving.set(true);
    this.formError.set(null);
    this.executionService
      .escalate(data.followUp, owner, value)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.closeEscalationModal();
          this.toast.show("Escalated", `The follow-up was escalated to ${owner.label}.`, "success");

          // It is somebody else's now: back to the queue, where it shows as escalated.
          this.backToQueue();
        },
        error: (error: unknown) => this.formError.set(apiErrorMessage(error)),
      });
  }

  // ---- Navigation ----------------------------------------------------------
  openCommunicationTimeline(): void {
    this.router.navigate(
      ["/app/fundraising/relationships/communication-timeline"],
      {
        queryParams: this.donorId()
          ? { donorId: this.donorId() }
          : { leadId: this.leadId() },
      },
    );
  }

  /** The record itself: Donor 360 for a donor; the lead's timeline for a lead. */
  openLead(): void {
    if (this.donorId()) {
      this.router.navigate(["/app/fundraising/relationships/donor-360"], {
        queryParams: { donorId: this.donorId() },
      });
      return;
    }
    this.openCommunicationTimeline();
  }

  /**
   * Qualifies the lead.
   *
   * IT USED TO GO TO DONOR 360 AFTERWARDS, with the lead's id - a screen about donors, for a
   * lead that is not one yet, which opened on "No donor selected". Qualifying does not make a
   * donor; a donation does. The page is reloaded so the lead's new stage shows here.
   */
  startQualification(): void {
    const leadId = this.leadId();
    if (!leadId || !this.canScore() || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.api
      .qualifyLead(leadId, {
        qualificationNotes:
          "Qualification readiness confirmed from follow-up execution.",
        moveToNurture: false,
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.successMessage.set("The lead is now qualified.");
          this.loadData();
        },
        error: (error: unknown) => this.formError.set(apiErrorMessage(error)),
      });
  }

  backToQueue(): void {
    this.router.navigate(["/app/fundraising/relationships/follow-up-queue"], {
      queryParams: {
        followUpId: this.followUpId(),
      },
    });
  }

  cancel(): void {
    this.backToQueue();
  }

  // ---- Complete ---------------------------------------------------------------
  completeFollowUp(): void {
    if (!this.validateBeforeComplete()) return;
    this.persist();
  }

  completeAndCreateFollowUp(): void {
    this.nextFollowUpForm.controls["enabled"].setValue(true);
    this.completeFollowUp();
  }

  private validateBeforeComplete(): boolean {
    this.formError.set(null);

    if (!this.canExecute()) {
      this.formError.set(this.viewOnlyReason() || "This follow-up cannot be executed.");
      return false;
    }

    if (this.executionChannel.invalid) {
      this.formError.set("Choose how the contact was made.");
      return false;
    }

    if (this.executionForm.invalid) {
      this.executionForm.markAllAsTouched();
      const outcomeMissing = this.executionForm.controls["outcome"].invalid;
      const notesMissing =
        this.executionForm.controls["completionNotes"].invalid;
      if (outcomeMissing) {
        this.formError.set("Outcome is required.");
      } else if (notesMissing) {
        this.formError.set("Execution notes are required (20 to 2,000 characters).");
      } else {
        this.formError.set(
          "Please complete all required fields and correct validation errors.",
        );
      }
      return false;
    }

    // The contact cannot have happened later than now.
    const execution = this.executionForm.getRawValue();
    if (new Date(`${execution.actualContactDate}T${execution.actualContactTime}`).getTime() > Date.now() + 60_000) {
      this.formError.set("The executed time cannot be in the future.");
      return false;
    }

    if (
      this.temperatureChanged() &&
      this.temperatureForm.controls["reasonForChange"].value.trim().length < SCORE_REASON_MINIMUM
    ) {
      this.temperatureForm.controls["reasonForChange"].setErrors({
        required: true,
      });
      this.formError.set(
        `Give a reason of at least ${SCORE_REASON_MINIMUM} characters for changing the lead's temperature.`,
      );
      return false;
    }

    if (this.dispositionForm.invalid) {
      this.dispositionForm.markAllAsTouched();
      this.formError.set("Disposition is required.");
      return false;
    }

    if (
      this.nextFollowUpForm.controls["enabled"].value &&
      (!this.nextFollowUpForm.controls["type"].value ||
        !this.nextFollowUpForm.controls["date"].value ||
        !this.nextFollowUpForm.controls["time"].value ||
        this.nextFollowUpForm.controls["purpose"].invalid ||
        !this.nextFollowUpForm.controls["priority"].value ||
        !this.nextFollowUpForm.controls["purpose"].value?.trim() ||
        !this.nextFollowUpForm.controls["owner"].value?.trim())
    ) {
      this.formError.set(
        "Complete all next follow-up fields, or turn the toggle off.",
      );
      return false;
    }

    if (this.nextFollowUpEnabled()) {
      const next = this.nextFollowUpForm.getRawValue();
      if (!this.ownerOptions().some((owner) => owner.label === next.owner)) {
        this.formError.set(
          "Select an assigned user from the available options.",
        );
        return false;
      }
      if (new Date(`${next.date}T${next.time}`).getTime() <= Date.now()) {
        this.formError.set(
          "The next follow-up must be scheduled in the future.",
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Checks the next follow-up's channel against the person's consent, then saves.
   *
   * ASKED BEFORE ANYTHING IS WRITTEN, so a channel the person has withdrawn stops the save while
   * it can still be changed - rather than after the follow-up is complete and the form is gone.
   */
  private persist(): void {
    if (this.saving()) return;

    const data = this.snapshot();
    if (!data) return;

    const next = this.nextFollowUpForm.getRawValue();

    if (!next.enabled || !next.type) {
      this.save(data);
      return;
    }

    this.saving.set(true);
    this.formError.set(null);

    this.executionService.consentFor(data.lead, next.type).subscribe({
      next: (warning) => {
        this.saving.set(false);

        const refused =
          warning.level === "Blocking" || (warning.prohibitedChannels ?? []).includes(next.type!);

        if (warning.hasWarning && refused) {
          this.nextConsentCaution.set("");
          this.formError.set(
            `${warning.message} Choose another channel for the next follow-up, or turn it off.`,
          );
          return;
        }

        if (warning.hasWarning && !this.nextConsentAcknowledged()) {
          this.nextConsentCaution.set(warning.message);
          this.formError.set("Read the consent note under the next follow-up and tick it to continue.");
          return;
        }

        this.save(data, warning.hasWarning && this.nextConsentAcknowledged());
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.formError.set(apiErrorMessage(error, "Consent for the next follow-up could not be checked."));
      },
    });
  }

  private save(data: FollowUpExecutionSnapshot, consentAcknowledged = false): void {
    this.saving.set(true);
    this.formError.set(null);

    const next = this.nextFollowUpForm.getRawValue();

    const payload: CompleteFollowUpPayload = {
      followUp: data.followUp,
      record: data.lead,
      contactChannel: this.executionChannel.value,
      execution: this.executionForm.getRawValue(),
      temperature: this.temperatureForm.getRawValue(),
      disposition: this.dispositionForm.controls["disposition"].value,
      attachments: this.attachments(),
      nextFollowUp: {
        ...next,
        ownerId: this.ownerOptions().find((owner) => owner.label === next.owner)?.value,
        consentAcknowledged,
      },
    };

    this.executionService
      .completeFollowUp(payload)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (result) => {
          if (result.nextFollowUpError) {
            this.toast.show(
              "Completed - next follow-up not scheduled",
              result.nextFollowUpError,
              "warning",
              8000,
            );
          } else {
            this.toast.show(
              "Follow-up completed",
              result.nextFollowUpId
                ? "The conversation is on the timeline and the next follow-up is scheduled."
                : "The conversation is on the communication timeline.",
              "success",
            );
          }

          this.router.navigate(
            ["/app/fundraising/relationships/follow-up-queue"],
            {
              queryParams: {
                followUpId: result.nextFollowUpId ?? this.followUpId(),
              },
            },
          );
        },
        error: (error: unknown) => {
          this.formError.set(apiErrorMessage(error, "The follow-up could not be completed."));
        },
      });
  }

  private today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  private nowTime(): string {
    return new Date().toTimeString().slice(0, 5);
  }
}
