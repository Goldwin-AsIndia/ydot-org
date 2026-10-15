import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse, PagedResponse } from '../Shared/models/api-response.model';

// =================================================================================================
// What the Campaign service answers under /whatsapp. The names follow the API exactly; the
// screens' own shapes (whatsapp.models.ts) are built from these in WhatsAppStore.
// =================================================================================================

export interface WhatsAppOverviewDto {
  integrationAvailable: boolean;
  worker: {
    online: boolean;
    instanceName?: string | null;
    version?: string | null;
    startedAtUtc?: string | null;
    lastHeartbeatAtUtc?: string | null;
  };
  settings: {
    checkNumberEnabled: boolean;
    checkNumberConfigured: boolean;
    watiEnabled: boolean;
    watiConfigured: boolean;
    /** Always false: a check never messages anybody by itself. */
    autoSendWati: boolean;
    manualBroadcastsAllowed: boolean;
    pricePerNumber: number;
    minimumChargePerTask: number;
    currency: string;
    maxFileSizeMegabytes: number;
    pollingIntervalSeconds: number;
    maxPollingAttempts: number;
    reuseScope: string;
    resultValidityDays: number;
    defaultTemplateName?: string | null;
    defaultBroadcastName?: string | null;
    maxRecipientsPerJob: number;
    allowListActive: boolean;
    allowListSize: number;
    batchSize: number;
    /** The most numbers one selection may hold; the server refuses a larger send. */
    maxRecipientsPerSend: number;
    /** The worker refuses a check with fewer numbers to pay for than this. */
    minimumNumbersPerTask: number;
    /** How many numbers CheckNumber.ai's minimum charge pays for (500). */
    billableMinimumNumbers: number;
    sendToUnverifiedNumbers: boolean;
    skipAlreadyMessagedNumbers: boolean;
    duplicateWindowDays: number;
    retryableFailureCodes: string[];
  };
  statistics: {
    numbersVerified: number;
    onWhatsApp: number;
    jobsRun: number;
    jobsRunning: number;
    messagesSent: number;
    messagesDelivered: number;
    messagesRead: number;
    messagesFailed: number;
    readRatePercent: number;
  };
}

export interface NumberAnswerDto {
  number: string;
  whatsApp: 'yes' | 'no';
  checkedAtUtc: string;
  sharedToWati: boolean;
}

export interface CheckJobUploadDto {
  /** Queued: the worker will pick the file up. Duplicate: this exact file already has a job. */
  status: 'Queued' | 'Duplicate';
  uploadReference?: string | null;
  duplicateOfJobId?: string | null;
  duplicateOfJobNumber?: string | null;
  message: string;
}

export interface UploadStatusDto {
  uploadReference: string;
  /** Queued (still in the inbox), Registered (a job exists), Duplicate or Rejected. */
  status: 'Queued' | 'Registered' | 'Duplicate' | 'Rejected';
  jobId?: string | null;
  jobNumber?: string | null;
  reason?: string | null;
}

export interface CheckJobDto {
  id: string;
  jobNumber: string;
  fileName: string;
  fileSizeBytes: number;
  fileKind: string;
  sheetCount: number;
  status: string;
  displayStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStep?: string | null;
  taskId?: string | null;
  createdAtUtc: string;
  startedAtUtc?: string | null;
  completedAtUtc?: string | null;
  totalRows: number;
  submitted: number;
  total: number;
  processed: number;
  yes: number;
  no: number;
  unknown: number;
  saved: number;
  duplicates: number;
  invalid: number;
  estimatedCost?: number | null;
  actualCost?: number | null;
  currency?: string | null;
  outcome: 'Success' | 'Failed' | 'Cancelled' | 'Pending';
  reason?: string | null;
  errorCode?: string | null;
  sharedToWati: number;
  watiSent: number;
  watiFailed: number;
  watiSkipped: number;
  runCheckNumber: boolean;
  runWati: boolean;
  campaignId?: string | null;
  campaignName?: string | null;
  uploadedByName?: string | null;
  source: string;
  uploadReference?: string | null;
  hasErrors: boolean;
  canRetry: boolean;
  canCancel: boolean;
  cancelRequested: boolean;
}

export interface JobTimelineDto {
  stepCode: string;
  label: string;
  status: string;
  attempt: number;
  startedAtUtc: string;
  completedAtUtc?: string | null;
  durationMs?: number | null;
  message?: string | null;
  errorMessage?: string | null;
}

export interface WatiJobSummaryDto {
  id: string;
  reference: string;
  status: string;
  templateName: string;
  templateLabel?: string | null;
  broadcastName: string;
  totalRecipients: number;
  accepted: number;
  failed: number;
  skipped: number;
  skippedByReason: Record<string, number>;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAtUtc: string;
  completedAtUtc?: string | null;
}

export interface JobDownloadsDto {
  original: boolean;
  submitted: boolean;
  results: boolean;
  raw: boolean;
  invalid: boolean;
  summary: boolean;
}

/** A send that messaged numbers picked from a check. */
export interface CheckJobSendDto {
  id: string;
  reference: string;
  name: string;
  templateName: string;
  status: string;
  createdAtUtc: string;
  requestedByName?: string | null;
  fromThisCheck: number;
  acceptedFromThisCheck: number;
}

export interface CheckJobDetailDto {
  job: CheckJobDto;
  timeline: JobTimelineDto[];
  /** The automatic send of an OLDER check; null for every check since 15 October 2026. */
  wati?: WatiJobSummaryDto | null;
  downloads: JobDownloadsDto;
  /** The sends people made with numbers picked from this check. */
  sends: CheckJobSendDto[];
}

export interface CheckJobResultDto {
  number: string;
  iso: string;
  country: string;
  whatsApp: 'yes' | 'no' | 'unknown';
  note: string;
  status: 'checked' | 'unverified' | 'saved';
  sheet: string;
  line: number;
  raw: string;
  watiStatus?: string | null;
  watiSkipReason?: string | null;
  contactName?: string | null;
  lastSendReference?: string | null;
}

export interface InvalidLineDto {
  sheet: string;
  line: number;
  raw: string;
  reason: string;
}

export interface WatiTemplateDto {
  name: string;
  label: string;
  category: string;
  body?: string | null;
  variables: string[];
  defaults: Record<string, string>;
  source: string;
  status?: string | null;
  language?: string | null;
  lastSyncedAtUtc?: string | null;
  /** IMAGE, VIDEO, DOCUMENT or TEXT when the template has a header. */
  headerFormat?: string | null;
  headerText?: string | null;
  /** The parameter that carries the header's picture (e.g. image_url). */
  mediaVariable?: string | null;
  footer?: string | null;
  buttons: string[];
}

// ---- The selection pool -----------------------------------------------------------------------------

export interface WatiRecipientFilterDto {
  page?: number;
  pageSize?: number;
  search?: string | null;
  jobId?: string | null;
  country?: string | null;
  groupId?: string | null;
  tag?: string | null;
  /** any | never | messaged */
  history?: string | null;
}

export interface WatiRecipientDto {
  number: string;
  iso: string;
  country: string;
  contactName?: string | null;
  checkedAtUtc: string;
  jobId: string;
  jobNumber: string;
  fileName: string;
  lastMessagedAtUtc?: string | null;
  lastTemplateName?: string | null;
  messagesSent: number;
  groups: string[];
}

export interface WatiRecipientFacetsDto {
  poolSize: number;
  jobs: { id: string; jobNumber: string; fileName: string; count: number; createdAtUtc: string }[];
  countries: { iso: string; name: string; count: number }[];
  groups: { id: string; name: string; count: number }[];
  tags: { tag: string; count: number }[];
  histories: { value: string; label: string; count: number }[];
}

export interface WatiRecipientSearchDto {
  results: PagedResponse<WatiRecipientDto>;
  facets: WatiRecipientFacetsDto;
}

export interface WatiSelectableRecipientDto {
  number: string;
  jobId: string;
  jobNumber: string;
  contactName?: string | null;
}

export interface WatiMatchingRecipientsDto {
  recipients: WatiSelectableRecipientDto[];
  totalMatching: number;
  limit: number;
}

// ---- Recipient groups -------------------------------------------------------------------------------

export interface WhatsAppGroupDto {
  id: string;
  name: string;
  description?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  tags: string[];
  memberCount: number;
  reachableCount: number;
  sendCount: number;
  lastSentAtUtc?: string | null;
  createdAtUtc: string;
  createdByName?: string | null;
  updatedAtUtc?: string | null;
  updatedByName?: string | null;
  version: number;
  /** use | edit | delete */
  permittedActions: string[];
}

export interface WhatsAppGroupMemberDto {
  number: string;
  contactName?: string | null;
  sourceJobId?: string | null;
  sourceJobNumber?: string | null;
  addedAtUtc: string;
  addedByName?: string | null;
  reachable: boolean;
  lastMessagedAtUtc?: string | null;
}

export interface WhatsAppGroupDetailDto {
  group: WhatsAppGroupDto;
  members: WhatsAppGroupMemberDto[];
}

export interface WhatsAppGroupChangeDto {
  groupId: string;
  added: number;
  alreadyMembers: number;
  notInPool: number;
  removed: number;
  memberCount: number;
  message: string;
}

export interface SelectedRecipientDto {
  number: string;
  sourceJobId?: string | null;
}

// ---- Review and send ---------------------------------------------------------------------------------

export interface ParameterBindingDto {
  name: string;
  /** contactName | phoneNumber */
  source: string;
}

export interface SendBroadcastDto {
  templateName: string;
  templateLabel?: string | null;
  broadcastName: string;
  values: Record<string, string>;
  campaignId?: string | null;
  selection: SelectedRecipientDto[];
  recipientGroupId?: string | null;
  tags?: string[];
  bindings?: ParameterBindingDto[];
}

export interface SendReviewRecipientDto {
  number: string;
  contactName?: string | null;
  sourceJobId?: string | null;
  sourceJobNumber?: string | null;
  /** send | skip | exclude */
  outcome: 'send' | 'skip' | 'exclude';
  reason?: string | null;
  reasonText?: string | null;
  renderedText?: string | null;
  values: Record<string, string>;
}

export interface SendReviewDto {
  summary: {
    selected: number;
    willSend: number;
    willSkip: number;
    excluded: number;
    byReason: Record<string, number>;
    maxRecipientsPerSend: number;
    allowListActive: boolean;
    allowListSize: number;
    templateLabel?: string | null;
    headerFormat?: string | null;
    mediaUrl?: string | null;
    problems: string[];
  };
  recipients: SendReviewRecipientDto[];
}

// ---- The send log ------------------------------------------------------------------------------------

export interface WatiBroadcastFilterDto {
  page?: number;
  pageSize?: number;
  search?: string | null;
  status?: string | null;
  templateName?: string | null;
  groupId?: string | null;
  campaignId?: string | null;
  jobId?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface WatiBroadcastDto {
  id: string;
  reference: string;
  name: string;
  templateName: string;
  templateLabel: string;
  status: string;
  source: string;
  createdAtUtc: string;
  completedAtUtc?: string | null;
  recipients: number;
  accepted: number;
  failed: number;
  skipped: number;
  campaignId?: string | null;
  integrationJobId?: string | null;
  jobNumber?: string | null;
  requestedByName?: string | null;
  errorMessage?: string | null;
  requestedCount: number;
  excludedCount: number;
  campaignName?: string | null;
  recipientGroupId?: string | null;
  recipientGroupName?: string | null;
  tags: string[];
  sourceJobs: string[];
  retryableFailures: number;
  /** export | retry */
  permittedActions: string[];
}

export interface WatiOptionFacetDto {
  value: string;
  label: string;
  count: number;
}

export interface WatiBroadcastSearchDto {
  results: PagedResponse<WatiBroadcastDto>;
  facets: { statuses: WatiOptionFacetDto[]; templates: WatiOptionFacetDto[]; groups: WatiOptionFacetDto[] };
}

export interface WatiBroadcastRecipientDto {
  number: string;
  contactName?: string | null;
  /** PENDING | SENT | DELIVERED | READ | REPLIED | FAILED | SKIPPED | EXCLUDED */
  status: string;
  reason?: string | null;
  reasonText?: string | null;
  sourceJobId?: string | null;
  sourceJobNumber?: string | null;
  checkNumberTaskId?: string | null;
  sentAtUtc?: string | null;
  deliveredAtUtc?: string | null;
  readAtUtc?: string | null;
  failedAtUtc?: string | null;
  renderedText?: string | null;
  localMessageId?: string | null;
}

export interface WatiBroadcastDetailDto {
  broadcast: WatiBroadcastDto;
  values: Record<string, string>;
  bindings: Record<string, string>;
  templateBody?: string | null;
  renderedPreview?: string | null;
  recipients: WatiBroadcastRecipientDto[];
  events: { eventCode: string; level: string; message: string; occurredAtUtc: string }[];
}

export interface WatiMessageDto {
  id: string;
  number: string;
  iso: string;
  country: string;
  whatsAppCheck: 'yes' | 'no' | 'unknown';
  templateLabel: string;
  templateName: string;
  broadcastId: string;
  broadcastName: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'REPLIED' | 'FAILED' | 'SKIPPED';
  values: Record<string, string>;
  renderedText?: string | null;
  createdAtUtc: string;
  sentAtUtc?: string | null;
  deliveredAtUtc?: string | null;
  readAtUtc?: string | null;
  repliedAtUtc?: string | null;
  failedCode?: string | null;
  failedReason?: string | null;
  replyText?: string | null;
  skipReason?: string | null;
  timesObserved: boolean;
  localMessageId: string;
  campaignId?: string | null;
  contactName?: string | null;
  sourceJobNumber?: string | null;
  checkNumberTaskId?: string | null;
}

/** A request left for the integration worker (retry, stop, send, template refresh). */
export interface CommandAcceptedDto {
  commandId: string;
  reference: string;
  status: string;
}

export interface CommandStatusDto {
  commandId: string;
  reference: string;
  type: string;
  /** Pending, Processing, Completed, Rejected (with the worker's reason) or Failed. */
  status: 'Pending' | 'Processing' | 'Completed' | 'Rejected' | 'Failed';
  resultMessage?: string | null;
  resultEntityId?: string | null;
  requestedAtUtc: string;
  processedAtUtc?: string | null;
}

export type JobFileKind = 'original' | 'submitted' | 'results' | 'raw' | 'invalid' | 'summary';

/**
 * The door to WhatsApp outreach on the Campaign service: CheckNumber.ai checks and WATI
 * messages.
 *
 * NOTHING HERE TALKS TO CheckNumber.ai OR WATI. The Campaign service does not either: it hands the
 * uploaded file and every request to the YDot.Integration worker and reads back what the worker
 * recorded. So an upload answers with a REFERENCE at once, and the job appears a few seconds later
 * - `uploadStatus` is what the screen polls in between.
 *
 * LIKE CampaignApiService, IT UNWRAPS THE ENVELOPE. A failure never reaches the `map`: the HTTP
 * interceptor rethrows the parsed envelope, so `apiErrorMessage` can read it in the caller.
 */
@Injectable({ providedIn: 'root' })
export class WhatsAppApiService {
  private readonly http = inject(HttpClient);

  private readonly baseUrl = `${environment.campaignApiBaseUrl}/whatsapp`;

  // ============================================================================== overview

  overview(): Observable<WhatsAppOverviewDto> {
    return this.http.get<ApiResponse<WhatsAppOverviewDto>>(`${this.baseUrl}/overview`).pipe(map((r) => r.data!));
  }

  // ============================================================================== CheckNumber

  /** Which of these numbers already have a saved answer. A POST only because the list is long. */
  lookupNumbers(numbers: readonly string[]): Observable<NumberAnswerDto[]> {
    return this.http
      .post<ApiResponse<{ answers: NumberAnswerDto[] }>>(`${this.baseUrl}/numbers/lookup`, { numbers })
      .pipe(map((r) => r.data?.answers ?? []));
  }

  uploadList(file: File, options: { campaignId?: string | null; forceRecheck?: boolean }): Observable<CheckJobUploadDto> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (options.campaignId) {
      form.append('campaignId', options.campaignId);
    }
    form.append('forceRecheck', options.forceRecheck ? 'true' : 'false');

    return this.http.post<ApiResponse<CheckJobUploadDto>>(`${this.baseUrl}/check-jobs`, form).pipe(map((r) => r.data!));
  }

  uploadStatus(reference: string): Observable<UploadStatusDto> {
    return this.http
      .get<ApiResponse<UploadStatusDto>>(`${this.baseUrl}/uploads/${encodeURIComponent(reference)}`)
      .pipe(map((r) => r.data!));
  }

  jobs(pageSize = 500): Observable<PagedResponse<CheckJobDto>> {
    return this.http
      .get<ApiResponse<PagedResponse<CheckJobDto>>>(`${this.baseUrl}/check-jobs`, {
        params: new HttpParams().set('page', 1).set('pageSize', pageSize),
      })
      .pipe(map((r) => r.data!));
  }

  /** `job` is the job's number (INT-20261010-000001) or its id. */
  job(job: string): Observable<CheckJobDetailDto> {
    return this.http.get<ApiResponse<CheckJobDetailDto>>(this.jobUrl(job)).pipe(map((r) => r.data!));
  }

  jobResults(job: string): Observable<CheckJobResultDto[]> {
    return this.http.get<ApiResponse<CheckJobResultDto[]>>(`${this.jobUrl(job)}/results`).pipe(map((r) => r.data ?? []));
  }

  jobInvalidLines(job: string): Observable<InvalidLineDto[]> {
    return this.http.get<ApiResponse<InvalidLineDto[]>>(`${this.jobUrl(job)}/invalid-lines`).pipe(map((r) => r.data ?? []));
  }

  jobFile(job: string, kind: JobFileKind): Observable<{ blob: Blob; fileName: string }> {
    return this.download(`${this.jobUrl(job)}/files/${kind}`, `${job}-${kind}`);
  }

  retryJob(job: string): Observable<CommandAcceptedDto> {
    return this.http.post<ApiResponse<CommandAcceptedDto>>(`${this.jobUrl(job)}/retry`, {}).pipe(map((r) => r.data!));
  }

  cancelJob(job: string, reason?: string): Observable<CommandAcceptedDto> {
    return this.http
      .post<ApiResponse<CommandAcceptedDto>>(`${this.jobUrl(job)}/cancel`, { reason: reason ?? null })
      .pipe(map((r) => r.data!));
  }

  // ============================================================================== Wati: templates

  templates(): Observable<WatiTemplateDto[]> {
    return this.http.get<ApiResponse<WatiTemplateDto[]>>(`${this.baseUrl}/wati/templates`).pipe(map((r) => r.data ?? []));
  }

  refreshTemplates(): Observable<CommandAcceptedDto> {
    return this.http
      .post<ApiResponse<CommandAcceptedDto>>(`${this.baseUrl}/wati/templates/refresh`, {})
      .pipe(map((r) => r.data!));
  }

  // ============================================================================== Wati: the selection pool

  /** One page of the validated numbers a send can be picked from, filtered on the server. */
  recipients(filter: WatiRecipientFilterDto): Observable<WatiRecipientSearchDto> {
    return this.http
      .get<ApiResponse<WatiRecipientSearchDto>>(`${this.baseUrl}/wati/recipients`, { params: toParams(filter) })
      .pipe(map((r) => r.data!));
  }

  /** "Select all that match", up to `limit` numbers (never more than one send may hold). */
  matchingRecipients(filter: WatiRecipientFilterDto, limit: number): Observable<WatiMatchingRecipientsDto> {
    return this.http
      .get<ApiResponse<WatiMatchingRecipientsDto>>(`${this.baseUrl}/wati/recipients/matching`, {
        params: toParams({ ...filter, page: undefined, pageSize: undefined }).set('limit', limit),
      })
      .pipe(map((r) => r.data!));
  }

  // ============================================================================== Wati: groups

  groups(): Observable<WhatsAppGroupDto[]> {
    return this.http.get<ApiResponse<WhatsAppGroupDto[]>>(`${this.baseUrl}/wati/groups`).pipe(map((r) => r.data ?? []));
  }

  group(id: string): Observable<WhatsAppGroupDetailDto> {
    return this.http.get<ApiResponse<WhatsAppGroupDetailDto>>(`${this.baseUrl}/wati/groups/${encodeURIComponent(id)}`).pipe(map((r) => r.data!));
  }

  createGroup(request: {
    name: string; description?: string | null; campaignId?: string | null; tags: string[]; members: SelectedRecipientDto[];
  }): Observable<WhatsAppGroupChangeDto> {
    return this.http.post<ApiResponse<WhatsAppGroupChangeDto>>(`${this.baseUrl}/wati/groups`, request).pipe(map((r) => r.data!));
  }

  updateGroup(id: string, request: {
    name: string; description?: string | null; campaignId?: string | null; tags: string[]; expectedVersion: number;
  }): Observable<WhatsAppGroupChangeDto> {
    return this.http
      .put<ApiResponse<WhatsAppGroupChangeDto>>(`${this.baseUrl}/wati/groups/${encodeURIComponent(id)}`, request)
      .pipe(map((r) => r.data!));
  }

  addGroupMembers(id: string, members: SelectedRecipientDto[]): Observable<WhatsAppGroupChangeDto> {
    return this.http
      .post<ApiResponse<WhatsAppGroupChangeDto>>(`${this.baseUrl}/wati/groups/${encodeURIComponent(id)}/members`, { members })
      .pipe(map((r) => r.data!));
  }

  removeGroupMembers(id: string, numbers: string[]): Observable<WhatsAppGroupChangeDto> {
    return this.http
      .post<ApiResponse<WhatsAppGroupChangeDto>>(`${this.baseUrl}/wati/groups/${encodeURIComponent(id)}/members/remove`, { numbers })
      .pipe(map((r) => r.data!));
  }

  deleteGroup(id: string): Observable<WhatsAppGroupChangeDto> {
    return this.http
      .delete<ApiResponse<WhatsAppGroupChangeDto>>(`${this.baseUrl}/wati/groups/${encodeURIComponent(id)}`)
      .pipe(map((r) => r.data!));
  }

  // ============================================================================== Wati: review, send, log

  /** What a send would do. Nothing is queued. */
  reviewSend(request: SendBroadcastDto): Observable<SendReviewDto> {
    return this.http.post<ApiResponse<SendReviewDto>>(`${this.baseUrl}/wati/broadcasts/review`, request).pipe(map((r) => r.data!));
  }

  sendBroadcast(request: SendBroadcastDto): Observable<CommandAcceptedDto> {
    return this.http
      .post<ApiResponse<CommandAcceptedDto>>(`${this.baseUrl}/wati/broadcasts`, request)
      .pipe(map((r) => r.data!));
  }

  broadcasts(filter: WatiBroadcastFilterDto): Observable<WatiBroadcastSearchDto> {
    return this.http
      .get<ApiResponse<WatiBroadcastSearchDto>>(`${this.baseUrl}/wati/broadcasts`, { params: toParams(filter) })
      .pipe(map((r) => r.data!));
  }

  broadcast(id: string): Observable<WatiBroadcastDetailDto> {
    return this.http
      .get<ApiResponse<WatiBroadcastDetailDto>>(`${this.baseUrl}/wati/broadcasts/${encodeURIComponent(id)}`)
      .pipe(map((r) => r.data!));
  }

  /** The send log as a CSV, every selected number of every matching send on its own row. */
  exportBroadcasts(filter: WatiBroadcastFilterDto): Observable<{ blob: Blob; fileName: string }> {
    const query = toParams({ ...filter, page: undefined, pageSize: undefined }).toString();
    return this.download(`${this.baseUrl}/wati/broadcasts/export${query ? '?' + query : ''}`, 'whatsapp-send-log.csv');
  }

  exportBroadcast(id: string): Observable<{ blob: Blob; fileName: string }> {
    return this.download(`${this.baseUrl}/wati/broadcasts/${encodeURIComponent(id)}/export`, 'whatsapp-send.csv');
  }

  retryBroadcast(id: string): Observable<CommandAcceptedDto> {
    return this.http
      .post<ApiResponse<CommandAcceptedDto>>(`${this.baseUrl}/wati/broadcasts/${encodeURIComponent(id)}/retry`, {})
      .pipe(map((r) => r.data!));
  }

  messages(): Observable<WatiMessageDto[]> {
    return this.http.get<ApiResponse<WatiMessageDto[]>>(`${this.baseUrl}/wati/messages`).pipe(map((r) => r.data ?? []));
  }

  // ============================================================================== requests

  command(reference: string): Observable<CommandStatusDto> {
    return this.http
      .get<ApiResponse<CommandStatusDto>>(`${this.baseUrl}/commands/${encodeURIComponent(reference)}`)
      .pipe(map((r) => r.data!));
  }

  private jobUrl(job: string): string {
    return `${this.baseUrl}/check-jobs/${encodeURIComponent(job)}`;
  }

  /** A file download, named the way the server names it (Content-Disposition). */
  private download(url: string, fallbackName: string): Observable<{ blob: Blob; fileName: string }> {
    return this.http.get(url, { responseType: 'blob', observe: 'response' }).pipe(
      map((response) => {
        const disposition = response.headers.get('Content-Disposition') ?? '';
        const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
        return { blob: response.body ?? new Blob(), fileName: match ? decodeURIComponent(match[1]) : fallbackName };
      }),
    );
  }
}

/** A filter object as query parameters, leaving out what is not set. */
function toParams(filter: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== null && value !== undefined && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
