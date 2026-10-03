/** Formatting and download helpers shared by the CheckNumber and Wati screens. */

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const DATE_TIME_FULL = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const TIME = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const DAY = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' });

/** "03 Oct, 14:22:05" in the viewer's own time zone. */
export function localDateTime(iso: string | null | undefined): string {
  return iso ? DATE_TIME.format(new Date(iso)).replace(' at ', ', ') : '—';
}

export function localDateTimeFull(iso: string | null | undefined): string {
  return iso ? DATE_TIME_FULL.format(new Date(iso)).replace(' at ', ', ') : '—';
}

export function localTime(iso: string | null | undefined): string {
  return iso ? TIME.format(new Date(iso)) : '—';
}

export function localDay(iso: string | null | undefined): string {
  return iso ? DAY.format(new Date(iso)) : '';
}

export function timeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'local time';
  }
}

export function rupees(value: number): string {
  return '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function count(value: number): string {
  return value.toLocaleString('en-IN');
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** One CSV cell, quoted when it needs to be and guarded against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text) && !/^\+\d[\d\s]*$/.test(text)) {
    text = "'" + text;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function saveFile(name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fnv(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
