/**
 * Reading and writing CSV text, for a screen that re-shapes a file the server exported.
 *
 * WHY A SCREEN WOULD DO THAT AT ALL. An export has to come from the server - that is where the
 * export permission is checked, the contact columns are masked for the caller, and the fact that
 * somebody took a copy is logged. But the server writes one format, and a screen may offer the
 * same rows as a workbook or a printed page, or only the rows the person ticked. Reading the
 * server's file and re-shaping it keeps every one of those a real, recorded export.
 */

/**
 * Parses CSV text into rows of cells.
 *
 * RFC 4180: quoted cells, doubled quotes inside them, and line breaks inside a quoted cell. A
 * leading byte-order mark is dropped, and a final empty line is not a row.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];

  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index++) {
    const ch = source[index];

    if (quoted) {
      if (ch === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[index + 1] === '\n') index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

/** One cell, quoted when it holds a comma, a quote or a line break. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Rows of cells back to CSV text, in the same dialect `parseCsv` reads. */
export function toCsvText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
