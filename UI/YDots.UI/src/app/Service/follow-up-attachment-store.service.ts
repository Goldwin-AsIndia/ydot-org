/**
 * Follow-up attachment store
 * DON Module | Fundraising CRM
 *
 * Keeps the ORIGINAL file attached when a follow-up is executed (PDF, DOCX, PNG, JPG ...), so the
 * Follow-up Queue can open it in its own format (View) and hand back the very same file (Download).
 *
 * WHY THIS EXISTS. The complete-follow-up API stores only the file NAME ("Attachments: a.pdf").
 * No bytes and no URL reach the server, so the queue had nothing to open and its Download wrote
 * a .txt note instead of the document. Until the API has a document endpoint, the file itself is
 * kept here, in the browser's IndexedDB, under the follow-up's id and the file's name.
 *
 * LIMITATION: IndexedDB belongs to one browser on one device. The person who executed the
 * follow-up (or anyone using the same browser) can view and download it; on another device the
 * queue says the original is not available there. When a backend upload endpoint is added,
 * replace `save` / `get` with HTTP calls - the screens only use these two methods.
 *
 * Save path: Shared/services/follow-up-attachment-store.service.ts
 */
import { Injectable } from "@angular/core";

export interface StoredAttachment {
  followUpId: string;
  name: string;
  type: string;
  size: number;
  savedAt: string;
  blob: Blob;
}

const DB_NAME = "don-follow-up-attachments";
const DB_VERSION = 1;
const STORE = "files";

/** MIME type from the file name, for files the browser gave no type (some .docx / .jpg drops). */
export function mimeFromName(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "txt": return "text/plain";
    case "csv": return "text/csv";
    case "doc": return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls": return "application/vnd.ms-excel";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default: return "application/octet-stream";
  }
}

@Injectable({ providedIn: "root" })
export class FollowUpAttachmentStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private key(followUpId: string, name: string): string {
    return `${followUpId}::${name}`;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("File storage is not available in this browser."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("File storage could not be opened."));
    });
    // A failed open is retried next time instead of being cached forever.
    this.dbPromise.catch(() => (this.dbPromise = null));
    return this.dbPromise;
  }

  /** Keeps every file attached to a follow-up, in its original format. */
  async save(followUpId: string, files: File[]): Promise<void> {
    if (!followUpId || !files.length) return;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const file of files) {
        const record: StoredAttachment = {
          followUpId,
          name: file.name,
          type: file.type || mimeFromName(file.name),
          size: file.size,
          savedAt: new Date().toISOString(),
          blob: file,
        };
        store.put(record, this.key(followUpId, file.name));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("The attachment could not be stored."));
      tx.onabort = () => reject(tx.error ?? new Error("The attachment could not be stored."));
    });
  }

  /** The original file, or null when it was attached on another device / before this existed. */
  async get(followUpId: string, name: string): Promise<StoredAttachment | null> {
    if (!followUpId || !name) return null;
    try {
      const db = await this.open();
      return await new Promise<StoredAttachment | null>((resolve, reject) => {
        const request = db.transaction(STORE, "readonly").objectStore(STORE).get(this.key(followUpId, name));
        request.onsuccess = () => resolve((request.result as StoredAttachment | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }
}
