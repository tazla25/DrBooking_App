/**
 * CSV helpers (Phase 4, GET /api/export/appointments).
 *
 * FORMULA-INJECTION ESCAPE (old-repo bug #9 — mandatory):
 * Any cell whose value starts with `=`, `+`, `-` or `@` is prefixed with a
 * single quote (`'`) so spreadsheet apps render it as text instead of
 * evaluating it as a formula. CR/LF characters are stripped from inside cells
 * so a hostile value can never smuggle extra rows into the export.
 *
 * Notes:
 *  - Normalized phones are stored WITH the leading `+` (+91…), so phone cells
 *    are intentionally escaped too — that IS the defense working.
 *  - Order of operations per cell: stringify → strip CR/LF → formula-prefix →
 *    CSV-quote (double quotes doubled, cell quoted when it contains a comma
 *    or a quote).
 */

const FORMULA_TRIGGER = /^[=+\-@]/;
const CRLF = /[\r\n]+/g;

/** Sanitize ONE cell value (any scalar / null / undefined). */
export function escapeCsvCell(value: unknown): string {
  let cell = value === null || value === undefined ? '' : String(value);
  cell = cell.replace(CRLF, ' '); // strip CR/LF inside cells
  if (FORMULA_TRIGGER.test(cell)) cell = `'${cell}`;
  return cell;
}

/** Quote a sanitized cell per RFC 4180 when required. */
function quoteCell(cell: string): string {
  if (cell.includes(',') || cell.includes('"')) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

/** Build one CSV line (no trailing newline) from raw values. */
export function toCsvRow(values: readonly unknown[]): string {
  return values.map((v) => quoteCell(escapeCsvCell(v))).join(',');
}
