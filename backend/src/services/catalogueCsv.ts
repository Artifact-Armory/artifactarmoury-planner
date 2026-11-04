// backend/src/services/catalogueCsv.ts
// Bulk catalogue edit (artist feedback, 3 Nov 2026): an artist downloads their
// whole catalogue as a CSV, edits it in Excel/Sheets (e.g. every price), and
// uploads it again. This file holds the pure parts: writing and reading the CSV
// and working out what would change. No database access here.

export const MAX_CSV_ROWS = 5000;
export const NAME_MAX = 255;
export const DESCRIPTION_MAX = 20000;
export const PRICE_MAX = 10000;

// Columns the import can change, in export order. Everything else in the file
// (status, category, link) is for the artist's reference and is ignored.
export const EDITABLE_FIELDS = ['name', 'price', 'description', 'licence', 'printer_type', 'show_in_planner'] as const;
export type EditableField = typeof EDITABLE_FIELDS[number];

export const EXPORT_COLUMNS = ['id', 'name', 'price', 'description', 'licence', 'printer_type', 'show_in_planner', 'status', 'category', 'link'];

// Header spellings people are likely to type, mapped to our column names.
const HEADER_ALIASES: Record<string, string> = {
  id: 'id', listing_id: 'id', model_id: 'id',
  name: 'name', title: 'name',
  price: 'price', base_price: 'price', 'price_(gbp)': 'price', price_gbp: 'price',
  description: 'description',
  licence: 'licence', license: 'licence',
  printer_type: 'printer_type', printer: 'printer_type',
  show_in_planner: 'show_in_planner', planner: 'show_in_planner',
  status: 'status', category: 'category', link: 'link',
};

export interface CatalogueRow {
  id: string;
  name: string;
  base_price: string | number;
  description: string | null;
  license: string;
  printer_type: string | null;
  show_in_planner: boolean;
  status: string;
  category: string | null;
}

export interface FieldChange {
  field: EditableField;
  from: string;
  to: string;
}

export interface RowChange {
  id: string;
  line: number;
  name: string;
  changes: FieldChange[];
  /** Applied as-is to the models table. */
  update: Partial<{
    name: string;
    base_price: number;
    description: string;
    license: string;
    printer_type: string | null;
    show_in_planner: boolean;
  }>;
}

export interface RowProblem {
  line: number;
  id?: string;
  message: string;
}

export interface ImportPlan {
  rowsRead: number;
  changed: RowChange[];
  unchanged: number;
  errors: RowProblem[];
  warnings: RowProblem[];
  ignoredColumns: string[];
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

// Excel runs a cell that starts with = + - @ as a formula. Prefix a ' so a
// listing name can't become a formula on someone's PC; stripped again on import.
function escapeFormula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function csvCell(v: unknown): string {
  const s = escapeFormula(v == null ? '' : String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatPrice(v: string | number): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '';
}

export function buildCatalogueCsv(rows: CatalogueRow[], siteUrl: string): string {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      r.id,
      r.name,
      formatPrice(r.base_price),
      r.description ?? '',
      r.license,
      r.printer_type ?? '',
      r.show_in_planner ? 'yes' : 'no',
      r.status,
      r.category ?? '',
      `${siteUrl}/models/${r.id}`,
    ].map(csvCell).join(','));
  }
  // BOM so Excel opens it as UTF-8 (accents, £, € survive).
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Excel in much of Europe saves with ; (and Sheets can do tabs). Pick by the header line. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/** RFC 4180 CSV: quoted cells, "" inside quotes, newlines inside quotes, CRLF or LF. */
export function parseCsv(input: string): { rows: string[][]; delimiter: string } {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += c;
    } else if (c === '"' && cell === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(cell); cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return { rows, delimiter };
}

function unescapeFormula(v: string): string {
  return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

/** "12.50", "12,50", "£12.50", "€ 12", "1,234.50" → 12.5 ; null if not a price. */
export function parsePrice(raw: string): number | null {
  let s = raw.trim().replace(/^[£€$]\s*/, '').replace(/\s*(gbp|eur|usd|[£€$])$/i, '').replace(/\s/g, '');
  if (!s) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); // 1,234.50
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,50
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.'); // 12,50
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 100) / 100;
  return Number.isFinite(n) ? n : null;
}

function parseYesNo(raw: string): boolean | null {
  const s = raw.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'si', 'sì', 'oui', 'ja'].includes(s)) return true;
  if (['no', 'n', 'false', '0', 'non', 'nein'].includes(s)) return false;
  return null;
}

/**
 * Compare an uploaded CSV with the artist's current listings and return what
 * would change. `current` must be ONLY this artist's non-deleted listings: any
 * id not in it is reported as an error, so nobody can touch another store.
 */
export function planImport(csvText: string, current: CatalogueRow[]): ImportPlan {
  const plan: ImportPlan = { rowsRead: 0, changed: [], unchanged: 0, errors: [], warnings: [], ignoredColumns: [] };
  const { rows } = parseCsv(csvText);
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) {
    plan.errors.push({ line: 1, message: 'The file is empty.' });
    return plan;
  }

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const colIndex: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key) { if (colIndex[key] === undefined) colIndex[key] = i; }
    else if (h) plan.ignoredColumns.push(rows[0][i].trim());
  });
  if (colIndex.id === undefined) {
    plan.errors.push({ line: 1, message: 'No "id" column. Start from the file you downloaded from this page so each row keeps its id.' });
    return plan;
  }
  if (!EDITABLE_FIELDS.some((f) => colIndex[f] !== undefined)) {
    plan.errors.push({ line: 1, message: 'No columns we can update. Editable columns: ' + EDITABLE_FIELDS.join(', ') + '.' });
    return plan;
  }

  const byId = new Map(current.map((r) => [r.id.toLowerCase(), r]));
  const seen = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells.some((c) => c.trim() !== '')) continue;
    const line = i + 1; // line in the spreadsheet (header is line 1)
    plan.rowsRead++;
    if (plan.rowsRead > MAX_CSV_ROWS) {
      plan.errors.push({ line, message: `Too many rows. The limit is ${MAX_CSV_ROWS} per file.` });
      break;
    }
    const get = (col: string): string | undefined => {
      const idx = colIndex[col];
      if (idx === undefined) return undefined;
      return unescapeFormula(cells[idx] ?? '');
    };

    const id = (get('id') ?? '').trim();
    if (!id) { plan.errors.push({ line, message: 'Missing id.' }); continue; }
    const existing = byId.get(id.toLowerCase());
    if (!existing) {
      plan.errors.push({ line, id, message: 'No listing of yours has this id (it may be deleted, or the cell was changed).' });
      continue;
    }
    if (seen.has(existing.id)) {
      plan.errors.push({ line, id, message: `This listing is also on line ${seen.get(existing.id)}. Keep one row per listing.` });
      continue;
    }
    seen.set(existing.id, line);

    const change: RowChange = { id: existing.id, line, name: existing.name, changes: [], update: {} };
    const rowErrors: string[] = [];

    const name = get('name');
    if (name !== undefined) {
      const v = name.trim().replace(/\s+/g, ' ');
      if (!v) rowErrors.push('Name is empty.');
      else if (v.length > NAME_MAX) rowErrors.push(`Name is longer than ${NAME_MAX} characters.`);
      else if (v !== existing.name) {
        change.update.name = v;
        change.changes.push({ field: 'name', from: existing.name, to: v });
      }
    }

    const priceRaw = get('price');
    if (priceRaw !== undefined) {
      const p = parsePrice(priceRaw);
      const old = Number(existing.base_price);
      if (p === null) rowErrors.push(`Price "${priceRaw.trim()}" is not a number.`);
      else if (p > PRICE_MAX) rowErrors.push(`Price ${p.toFixed(2)} is over the ${PRICE_MAX} limit.`);
      else if (Math.abs(p - old) >= 0.005) {
        change.update.base_price = p;
        change.changes.push({ field: 'price', from: formatPrice(old), to: p.toFixed(2) });
        if (old > 0 && (p >= old * 5 || p <= old / 5)) {
          plan.warnings.push({ line, id: existing.id, message: `Big price change on "${existing.name}": ${formatPrice(old)} to ${p.toFixed(2)}. Check the decimal point.` });
        }
        if (p === 0 && old > 0) {
          plan.warnings.push({ line, id: existing.id, message: `"${existing.name}" will become free.` });
        }
      }
    }

    const desc = get('description');
    if (desc !== undefined) {
      const v = desc.replace(/\r\n/g, '\n').trim();
      if (v.length > DESCRIPTION_MAX) rowErrors.push(`Description is longer than ${DESCRIPTION_MAX} characters.`);
      else if (v !== (existing.description ?? '').replace(/\r\n/g, '\n').trim()) {
        change.update.description = v;
        change.changes.push({ field: 'description', from: shorten(existing.description ?? ''), to: shorten(v) });
      }
    }

    const lic = get('licence');
    if (lic !== undefined) {
      const v = lic.trim().toLowerCase();
      if (!['personal', 'commercial'].includes(v)) rowErrors.push(`Licence must be "personal" or "commercial", not "${lic.trim()}".`);
      else if (v !== existing.license) {
        change.update.license = v;
        change.changes.push({ field: 'licence', from: existing.license, to: v });
      }
    }

    const pt = get('printer_type');
    if (pt !== undefined) {
      const v = pt.trim().toLowerCase();
      if (v && !['fdm', 'resin', 'both'].includes(v)) rowErrors.push(`Printer type must be fdm, resin, both or empty, not "${pt.trim()}".`);
      else if ((v || null) !== (existing.printer_type || null)) {
        change.update.printer_type = v || null;
        change.changes.push({ field: 'printer_type', from: existing.printer_type ?? '', to: v });
      }
    }

    const sp = get('show_in_planner');
    if (sp !== undefined) {
      const v = parseYesNo(sp);
      if (v === null) rowErrors.push(`show_in_planner must be yes or no, not "${sp.trim()}".`);
      else if (v !== !!existing.show_in_planner) {
        change.update.show_in_planner = v;
        change.changes.push({ field: 'show_in_planner', from: existing.show_in_planner ? 'yes' : 'no', to: v ? 'yes' : 'no' });
      }
    }

    if (rowErrors.length) {
      for (const message of rowErrors) plan.errors.push({ line, id: existing.id, message });
      continue;
    }
    if (change.changes.length) plan.changed.push(change);
    else plan.unchanged++;
  }
  return plan;
}

function shorten(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? one.slice(0, 77) + '...' : one;
}
