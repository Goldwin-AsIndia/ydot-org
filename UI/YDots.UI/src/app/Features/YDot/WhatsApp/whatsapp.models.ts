/** Shared shapes for the CheckNumber and Wati screens. Everything here lives in the browser for now. */

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
  /** The file itself, kept so it can be downloaded again from the job. */
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

export interface CheckJob {
  id: string;
  fileName: string;
  fileSize: number;
  kind: FileKind;
  sheetCount: number;
  status: JobStatus;
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
  /** "Success" or "Failed" with the reason, as the report header shows it. */
  outcome: 'Success' | 'Failed' | 'Cancelled' | 'Pending';
  reason: string;
  errorCode: string | null;
  sharedToWati: number;
  results: ResultRow[];
  invalidLines: InvalidLine[];
  /** Rows of the original upload, for the "submitted numbers" download. */
  submittedNumbers: string[];
  /** The upload itself; absent once the page has been reloaded. */
  original?: File | null;
  /** Sample data seeded for first use. */
  sample?: boolean;
}

/** One number the system has an answer for. The registry is what makes the duplicate check possible. */
export interface RegistryEntry {
  readonly number: string;
  readonly iso: string;
  readonly country: string;
  readonly whatsapp: WaResult;
  readonly note: string;
  readonly checkedAt: string;
  readonly jobId: string;
  /** True once a Yes number has been handed to Wati. */
  readonly sharedToWati: boolean;
}

// ---------------------------------------------------------------- Wati

export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'REPLIED' | 'FAILED';

export interface WatiTemplate {
  readonly name: string;
  readonly label: string;
  readonly category: 'Utility' | 'Marketing';
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
  /** When the next status change is due (simulated delivery). */
  nextAt: number | null;
  /** The fate this message is scripted to reach, fixed at send time. */
  fate: 'DELIVERED' | 'READ' | 'REPLIED' | 'FAILED';
}

export interface WatiBroadcast {
  readonly id: string;
  readonly name: string;
  readonly templateName: string;
  readonly templateLabel: string;
  readonly createdAt: string;
  readonly recipients: number;
}
