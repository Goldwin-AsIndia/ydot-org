/**
 * Shared shapes for the CheckNumber and Wati screens.
 *
 * The upload under review (`UploadAnalysis`) is worked out in the browser, so the person sees what the
 * file holds before anything is sent. Everything else - jobs, results, recipients, messages - comes from
 * the Campaign service, which reads what the YDot.Integration worker recorded.
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
  sharedToWati: number;
  /** The check finished, but something after it did not (for example WATI refused the messages). */
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
}

/** One number the organisation can message: on WhatsApp, with the check that found it. */
export interface RegistryEntry {
  readonly number: string;
  readonly iso: string;
  readonly country: string;
  readonly whatsapp: WaResult;
  readonly note: string;
  readonly checkedAt: string;
  /** The job number of the newest check that included this number. */
  readonly jobId: string;
  /** That check's file name. */
  readonly fileName: string;
  readonly sharedToWati: boolean;
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
}

export interface WatiBroadcast {
  readonly id: string;
  readonly name: string;
  readonly templateName: string;
  readonly templateLabel: string;
  readonly createdAt: string;
  readonly recipients: number;
}

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
  /** The template an automatic send uses (Wati:DefaultTemplateName); the Wati page pre-selects it. */
  readonly defaultTemplateName: string | null;
  readonly allowListActive: boolean;
  readonly allowListSize: number;
  readonly numbersVerified: number;
  readonly onWhatsApp: number;
  readonly jobsRun: number;
  readonly messagesSent: number;
  readonly readRate: number;
}
