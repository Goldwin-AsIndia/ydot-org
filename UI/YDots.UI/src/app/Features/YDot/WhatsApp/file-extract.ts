import { FileKind } from './whatsapp.models';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface SheetRows {
  readonly name: string;
  readonly rows: string[][];
}

export interface FileContents {
  readonly kind: FileKind;
  readonly sheets: SheetRows[];
}

export class FileProblem extends Error {}

const ACCEPTED: Record<string, FileKind> = { txt: 'txt', csv: 'csv', xls: 'xls', xlsx: 'xlsx' };

/** Checks the file before it is read, so a wrong type or size is refused with a plain sentence. */
export function checkFile(file: File): FileKind {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const kind = ACCEPTED[ext];
  if (!kind) {
    throw new FileProblem(
      `“${file.name}” is a ${ext ? '.' + ext : 'file without an extension'} file. Upload a .txt, .csv, .xls or .xlsx file.`,
    );
  }
  if (file.size === 0) {
    throw new FileProblem(`“${file.name}” is empty. Add at least one phone number and upload it again.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new FileProblem(
      `“${file.name}” is ${formatBytes(file.size)}. The limit is 10 MB — split the list into smaller files.`,
    );
  }
  return kind;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reads the file into rows of text cells, one list of rows per sheet. */
export async function readFile(file: File, kind: FileKind): Promise<FileContents> {
  try {
    if (kind === 'txt') {
      const text = await file.text();
      return { kind, sheets: [{ name: 'Text file', rows: splitLines(text).map((l) => [l]) }] };
    }
    if (kind === 'csv') {
      const text = await file.text();
      return { kind, sheets: [{ name: 'CSV file', rows: parseCsv(text) }] };
    }
    return { kind, sheets: await readWorkbook(file) };
  } catch (error) {
    if (error instanceof FileProblem) {
      throw error;
    }
    console.error('[CheckNumber] could not read', file.name, error);
    throw new FileProblem(
      `“${file.name}” could not be read. It may be damaged or password-protected — open it, save a copy and try again.`,
    );
  }
}

function splitLines(text: string): string[] {
  return text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
}

/** A small CSV reader: quoted fields, doubled quotes, commas / semicolons / tabs / pipes as separators. */
function parseCsv(text: string): string[][] {
  const lines = splitLines(text);
  const sample = lines.slice(0, 20).join('\n');
  const separator = [',', ';', '\t', '|']
    .map((s) => ({ s, n: sample.split(s).length }))
    .sort((a, b) => b.n - a.n)[0].s;

  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === separator) {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells;
  });
}

async function readWorkbook(file: File): Promise<SheetRows[]> {
  // Loaded on demand: the spreadsheet reader is large and most uploads are text or CSV.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  if (workbook.SheetNames.length === 0) {
    throw new FileProblem(`“${file.name}” has no sheets.`);
  }
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '', blankrows: false });
    return {
      name,
      rows: grid.map((row) =>
        row.map((cell) => {
          // Phone numbers stored as numbers must not turn into 9.87654E+09.
          if (typeof cell === 'number') {
            return Number.isInteger(cell) ? cell.toFixed(0) : String(cell);
          }
          return String(cell ?? '');
        }),
      ),
    };
  });
}
