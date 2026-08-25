import { TableData } from '@chat-monorepo/shared';

/**
 * Pure helpers for TableBlockComponent: numeric-column detection, CSV
 * escaping/serialization for file export, and TSV serialization for
 * clipboard copy. No framework dependencies - same style as
 * sse-event-parser.ts - so this is unit-testable in isolation and the
 * escaping logic doesn't have to be hand-verified by eyeballing a template.
 *
 * No CSV library is added for this (checked package.json first - nothing
 * already installed does it). RFC 4126/4180-style escaping for a single
 * cell is about ten lines and easy to get exactly right, so it's written by
 * hand here rather than pulling in a dependency for it.
 */

type TableCell = string | number | null;

/**
 * A cell counts as numeric if it's a finite JS number, or a string that
 * *looks* numeric once common formatting is allowed for - the model is free
 * to emit "$1,234.50" or "12%" as a string rather than a bare number, and a
 * column of those should still right-align like a column of real numbers.
 * Optional leading +/-, optional $ prefix, digit groups with optional
 * thousands separators, optional decimal part, optional trailing %,
 * optional parens (accounting-style negatives).
 */
const NUMERIC_STRING_RE = /^\(?[+-]?\$?\d[\d,]*(\.\d+)?%?\)?$/;

export function isNumericCell(value: TableCell): boolean {
  if (value === null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  const trimmed = value.trim();
  if (trimmed === '') return false;
  return NUMERIC_STRING_RE.test(trimmed);
}

/**
 * Per-column boolean, true when a column is "predominantly numeric" - at
 * least half of its non-null cells (and at least one) look numeric.
 * Detected from the actual `rows` values passed in, never from a schema
 * hint (TableData carries no per-column type information).
 */
export function detectNumericColumns(columns: string[], rows: TableCell[][]): boolean[] {
  return columns.map((_, colIndex) => {
    let numericCount = 0;
    let nonNullCount = 0;
    for (const row of rows) {
      const cell = row[colIndex];
      if (cell === null || cell === undefined) continue;
      nonNullCount++;
      if (isNumericCell(cell)) numericCount++;
    }
    return nonNullCount > 0 && numericCount / nonNullCount >= 0.5;
  });
}

/** null/undefined -> empty cell; everything else -> its plain string form (no display formatting like the '—' placeholder - this is raw data for export). */
function cellToText(value: TableCell | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * RFC 4180 field escaping: a field that contains a comma, a double quote,
 * or a line break must be wrapped in double quotes, and any double quote
 * inside it must itself be doubled. Everything else passes through as-is.
 */
export function escapeCsvField(raw: string): string {
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Full TableData -> a CSV string (header row + all rows), CRLF row endings per RFC 4180. */
export function tableDataToCsv(data: TableData): string {
  const lines = [data.columns.map(escapeCsvField).join(',')];
  for (const row of data.rows) {
    lines.push(row.map((cell) => escapeCsvField(cellToText(cell))).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Full TableData -> a tab-separated string for clipboard copy (pastes
 * straight into a spreadsheet as columns/rows). TSV has no standard quoting
 * convention, so a cell that itself contains a tab or newline has that
 * character flattened to a space instead - rare in practice, and safer than
 * letting it silently shift the paste out of alignment.
 */
export function tableDataToTsv(data: TableData): string {
  const flatten = (text: string) => text.replace(/[\t\r\n]+/g, ' ');
  const lines = [data.columns.map(flatten).join('\t')];
  for (const row of data.rows) {
    lines.push(row.map((cell) => flatten(cellToText(cell))).join('\t'));
  }
  return lines.join('\n');
}
