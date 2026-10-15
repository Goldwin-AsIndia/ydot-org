/**
 * Shared shapes for the CheckNumber and Wati screens.
 *
 * The upload under review (`UploadAnalysis`) is worked out in the browser, so the person sees what the
 * file holds before anything is sent. Everything else - jobs, results, the selection pool, groups,
 * sends - comes from the Campaign service, which reads what the YDot.Integration worker recorded.
 */

export type WaResult = 'yes' | 'no' | 'unknown';

export type FileKind = 'txt' | 'csv' | 'xls' | 'xlsx';

/** One number the upload turned up, with where in the file it came from. */
export interface UploadNumber {
  readonly number: string;
  readonly iso: string;
  readonly country: string;
  readonly sheet: string;
  readonly line: number;
  readonly raw: string;
}

export interface InvalidLine {
  readonly sheet: string;
  readonly line: number;
  readonly raw: string;
  readonly reason: string;
}

export interface SheetSummary {
  readonly name: string;
  /** Rows (or lines) that held anything at all. */
  readonly rows: number;
  /** Valid numbers found on this sheet, duplicates included. */
  readonly found: number;
  /** Of those, kept for checking (first sight of that number in the file, not already checked). */
  readonly fresh: number;
  readonly duplicates: number;
  readonly alreadyChecked: number;
  readonly invalid: number;
}

export interface AlreadyChecked extends UploadNumber {
  readonly result: WaResult;
  readonly checkedAt: string;
  readonly sharedToWati: boolean;
}

/** What the upload review shows before anything is submitted. */
export interface UploadAnalysis {
  readonly fileName: string;
  readonly fileSize: number;
  readonly kind: FileKind;
  /** The file itself: it is what gets uploaded when the check is started. */
  readonly file: File;
  readonly sheets: SheetSummary[];
  readonly totalRows: number;
  readonly fresh: UploadNumber[];
  readonly duplicates: UploadNumber[];
  readonly alreadyChecked: AlreadyChecked[];
  readonly invalid: InvalidLine[];
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ResultRow {
  readonly number: string;
  readonly iso: string;
  readonly country: string;
  readonly whatsapp: WaResult;
  readonly note: string;
  /** Checked now, left unverified by the provider, or answered from an earlier check. */
  readonly status: 'checked' | 'unverified' | 'saved';
  /** The name the file gave beside the number. */
  readonly contactName: string | null;
  /** The newest send this number went out in from this check (WAT-...), when it did. */
  readonly lastSend: string | null;
}

/** One moment of a job, as its timeline shows it. */
export interface JobTimelineStep {
  readonly label: string;
  readonly at: string | null;
  readonly state: 'done' | 'bad' | 'wait';
}

/** Which downloads the server can give for a job right now. */
export interface JobDownloads {
  readonly original: boolean;
  readonly submitted: boolean;
  readonly results: boolean;
  readonly raw: boolean;
  readonly invalid: boolean;
}

/** A send that messaged numbers picked from a check: the trail from a check to its messages. */
export interface CheckJobSend {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly templateName: string;
  readonly status: string;
  readonly createdAt: string;
  readonly requestedBy: string | null;
  readonly fromThisCheck: number;
  readonly acceptedFromThisCheck: number;
}

export interface CheckJob {
  /** The job number, as shown on screen and used in the address bar (INT-20261010-000001). */
  id: string;
  /** The job's id on the server. Empty while an upload is still waiting for the worker to pick it up. */
  key: string;
  fileName: string;
  fileSize: number;
  kind: FileKind;
  sheetCount: number;
  status: JobStatus;
  /** The CheckNumber.ai task id; empty when every number was answered from saved results. */
  taskId: string;
  createdAt: string;
  finishedAt: string | null;
  /** Numbers sent to CheckNumber.ai (not counting saved answers). */
  submitted: number;
  total: number;
  processed: number;
  yes: number;
  no: number;
  unknown: number;
  saved: number;
  duplicates: number;
  invalid: number;
  estimatedCost: number;
  actualCost: number;
  /** The currency CheckNumber.ai charges in (USD). */
  currency: string;
  /** "Success" or "Failed" with the reason, as the report header shows it. */
  outcome: 'Success' | 'Failed' | 'Cancelled' | 'Pending';
  reason: string;
  errorCode: string | null;
  /** Valid numbers of a completed check, ready to be picked for a send. */
  sharedToWati: number;
  /** An older check finished, but its automatic send did not (newer checks never send). */
  hasErrors: boolean;
  /** The worker would accept "retry" for this job now. */
  canRetry: boolean;
  /** The worker would accept "stop" for this job now. */
  canCancel: boolean;
  watiSent: number;
  watiFailed: number;
  watiSkipped: number;
  campaignName: string | null;
  uploadedBy: string | null;
  /** The report rows; loaded when the job's page or report is opened. */
  results: ResultRow[];
  invalidLines: InvalidLine[];
  /** True once `results` and `invalidLines` hold what the server has. */
  detailLoaded: boolean;
  /** The job's real timeline, from the worker's step log; empty until the detail is loaded. */
  timeline: JobTimelineStep[];
  downloads: JobDownloads;
  /** The sends made with numbers picked from this check; empty until the detail is loaded. */
  sends: CheckJobSend[];
}

// ---------------------------------------------------------------- Wati

export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'REPLIED' | 'FAILED';

export interface WatiTemplate {
  readonly name: string;
  readonly label: string;
  /** WATI's category: Marketing, Utility or Authentication. */
  readonly category: string;
  readonly body: string;
  readonly variables: readonly string[];
  readonly defaults: Readonly<Record<string, string>>;
  /** IMAGE, VIDEO, DOCUMENT or TEXT when the template has a header. */
  readonly headerFormat: string | null;
  readonly headerText: string | null;
  /** The parameter carrying the header's picture (image_url), so the preview can show it. */
  readonly mediaVariable: string | null;
  readonly footer: string | null;
  readonly buttons: readonly string[];
}

export interface WatiMessage {
  id: string;
  number: string;
  iso: string;
  country: string;
  /** What CheckNumber said about this number when it was handed over. */
  whatsappCheck: WaResult;
  templateLabel: string;
  templateName: string;
  broadcastId: string;
  broadcastName: string;
  status: DeliveryStatus;
  values: Record<string, string>;
  renderedText: string;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  repliedAt: string | null;
  failedCode: string | null;
  failedReason: string | null;
  replyText: string | null;
  contactName: string | null;
  /** The check the number was picked from (INT-...). */
  sourceJob: string | null;
  /** The CheckNumber.ai task whose answer made the number eligible. */
  checkNumberTask: string | null;
}

export interface WatiBroadcast {
  readonly id: string;
  readonly name: string;
  readonly templateName: string;
  readonly templateLabel: string;
  readonly createdAt: string;
  readonly recipients: number;
}

/** One number in the current selection, with the check it was picked from. */
export interface SelectedNumber {
  readonly number: string;
  readonly jobId: string;
  readonly jobNumber: string;
  readonly contactName: string | null;
}

/**
 * The send being composed. Kept in the store, so moving to the Groups tab and back - or reading the
 * report meanwhile - never loses the selection or what was typed.
 */
export interface Composer {
  readonly templateName: string;
  /** Set once the person picks a template, so the worker's default never overrides their choice. */
  readonly templateChosenByPerson: boolean;
  readonly values: Readonly<Record<string, string>>;
  /** Template parameter -> the recipient field that fills it (contactName | phoneNumber). Absent = the typed value for everybody. */
  readonly bindings: Readonly<Record<string, string>>;
  readonly broadcastName: string;
  readonly campaignId: string | null;
  readonly tags: readonly string[];
  /** The recipient group the selection was loaded from, when it was. */
  readonly groupId: string | null;
  readonly groupName: string | null;
}

export const EMPTY_COMPOSER: Composer = {
  templateName: '',
  templateChosenByPerson: false,
  values: {},
  bindings: {},
  broadcastName: '',
  campaignId: null,
  tags: [],
  groupId: null,
  groupName: null,
};

/** The integration worker's state and settings, as the Campaign service reports them. */
export interface WhatsAppOverview {
  /** False when the worker has never been set up for this database. */
  readonly available: boolean;
  readonly workerOnline: boolean;
  readonly workerLastSeen: string | null;
  readonly checkNumberReady: boolean;
  readonly watiReady: boolean;
  /** What CheckNumber.ai charges for one number, in `currency`. */
  readonly pricePerNumber: number;
  /** The least CheckNumber.ai charges for one task, however few numbers it holds. */
  readonly minimumCharge: number;
  readonly currency: string;
  readonly maxRecipientsPerJob: number;
  /** The most numbers one selection may hold; the server refuses a larger send. */
  readonly maxRecipientsPerSend: number;
  /** The template the Wati page pre-selects (Wati:DefaultTemplateName). */
  readonly defaultTemplateName: string | null;
  readonly allowListActive: boolean;
  readonly allowListSize: number;
  /** The worker refuses a check with fewer numbers to pay for than this. */
  readonly minimumNumbersPerTask: number;
  /** How many numbers CheckNumber.ai's minimum charge pays for (500): a smaller check costs the same. */
  readonly billableMinimumNumbers: number;
  readonly numbersVerified: number;
  readonly onWhatsApp: number;
  readonly jobsRun: number;
  readonly messagesSent: number;
  readonly readRate: number;
}
