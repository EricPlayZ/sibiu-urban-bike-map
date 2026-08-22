/** Prelucrare CSV brut din Google Sheets → același format ca `public/data/measurements/*.csv`. */

import { csvRowsToMeasurements, parseCsvText, serializeCsvText, type CsvStreetRow } from "./csvImport";
import { GREEN_MID_HEADER, MEASUREMENT_CSV_HEADERS } from "./sheetCatalog";
import {
  DROP_EMPTY_WIDTH_SLUGS,
  OMIT_STREETS,
  STREET_RENAMES,
  WIDTH_OVERRIDES,
  type WidthField,
  type WidthOverride,
} from "./sheetStreetFixes";
import { slugify } from "./space";

const WIDTH_TO_HEADER: Record<WidthField, (typeof MEASUREMENT_CSV_HEADERS)[number]> = {
  row_width_m: "Latime trama stradala",
  carriageway_m: "Latime carosabil",
  sidewalk1_m: "Latime trotuar 1",
  sidewalk2_m: "Latime trotuar 2",
  parking1_m: "Latime parcare 1",
  parking2_m: "Latime parcare 2",
  free_sidewalk1_m: "Zona libera trotuar 1",
  free_sidewalk2_m: "Zona libera trotuar 2",
  bike1_m: "Latime pista biciclete 1",
  bike2_m: "Latime pista biciclete 2",
  green1_m: "Zona verde 1",
  green2_m: "Zona verde 2",
};

const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4" };

export function normSheetHeader(h: string) {
  return String(h || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** CSV cu newline-uri în celule quoted (header-ul „Zona verde între benzi” din Hipodrom I). */
export function parseSheetCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records = splitCsvRecords(text.replace(/^\uFEFF/, ""));
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.replace(/\s+/g, " ").trim());
  const rows = records.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

function splitCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (!inQ && ch === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (!inQ && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      if (row.some((c) => String(c).trim().length)) rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((c) => String(c).trim().length)) rows.push(row);
  }
  return rows;
}

type SheetCol =
  | "name"
  | "row"
  | "carriage"
  | "sw1"
  | "sw2"
  | "park1"
  | "park2"
  | "free1"
  | "free2"
  | "bike1"
  | "bike2"
  | "green1"
  | "green2"
  | "green_mid";

function headerKind(h: string): SheetCol | null {
  const n = normSheetHeader(h);
  if (n.includes("numele strazii") || n === "nume" || n === "name") return "name";
  if (n.includes("trama")) return "row";
  if (n.includes("carosabil")) return "carriage";
  if (n.includes("lungimea trotuarului") || n.includes("ocupare")) return null;
  if ((n.includes("trotuar 1") || n.includes("tortuar 1")) && n.includes("libera")) return "free1";
  if ((n.includes("trotuar 2") || n.includes("tortuar 2")) && n.includes("libera")) return "free2";
  if (n.includes("trotuar 1") || n.includes("tortuar 1")) return "sw1";
  if (n.includes("trotuar 2") || n.includes("tortuar 2")) return "sw2";
  if ((n.includes("parcare 1") || n.includes("parcare1")) && !n.includes("lungime")) return "park1";
  if ((n.includes("parcare 2") || n.includes("parcare2")) && !n.includes("lungime")) return "park2";
  if (n.includes("zona libera") && n.includes("1")) return "free1";
  if (n.includes("zona libera") && n.includes("2")) return "free2";
  if (n.includes("pista") && n.includes("1") && !n.includes("lungime")) return "bike1";
  if (n.includes("pista") && n.includes("2") && !n.includes("lungime")) return "bike2";
  if (n.includes("zona verde") && (n.includes("intre") || n.includes("bezile") || n.includes("benzi") || n.includes("cilculatie"))) {
    return "green_mid";
  }
  if (n.includes("zona verde 1") || n === "zona verde 1") return "green1";
  if (n.includes("zona verde 2") || n === "zona verde 2") return "green2";
  return null;
}

function mapSheetHeaders(headers: string[]): Partial<Record<SheetCol, string>> {
  const map: Partial<Record<SheetCol, string>> = {};
  for (const h of headers) {
    const k = headerKind(h);
    if (k && !map[k]) map[k] = h;
  }
  return map;
}

/** Header-ul Terezian înghite primul nume: „Numele străzii Aleea Petuniei”. */
export function leadingNamesFromHeader(rawHeader: string): string[] {
  const orig = String(rawHeader || "").replace(/\s+/g, " ").trim();
  const m = orig.match(/^Numele străzii\s*(.+)$/i) || orig.match(/^Numele strazii\s*(.+)$/i);
  if (!m) return [];
  const extra = m[1].trim();
  if (!extra) return [];
  if (extra.split(/\s+/).length > 4) return [];
  return [extra];
}

export function stripStarSuffix(name: string) {
  return String(name || "").replace(/\*+\s*$/g, "").trim();
}

/** „Calea Dumbravii II” → „Calea Dumbravii 2”. Nu atinge „(V)” din Valea Aurie. */
export function romanStreetSuffix(name: string) {
  return String(name || "").replace(/\s+(I|II|III|IV)\s*$/i, (_, r: string) => ` ${ROMAN[r.toUpperCase()] ?? r}`);
}

export function stripNeighborhoodParens(name: string) {
  return String(name || "")
    .replace(/\s*\((?:v|intre blocuri)\)\s*$/i, "")
    .trim();
}

export function isJunkSheetName(name: string) {
  const n = String(name || "").trim();
  if (!n) return true;
  if (/intre\s+be[nz]ile/i.test(n)) return true;
  if (/cilculatie/i.test(n)) return true;
  if (n.length > 48 && /de la|pana|până/i.test(n)) return true;
  return false;
}

export function cleanSheetStreetName(raw: string) {
  return stripNeighborhoodParens(romanStreetSuffix(stripStarSuffix(String(raw || "").trim())));
}

/** Cheie stabilă pentru remapări (păstrează Aleea/Calea, spre deosebire de `nameKey`). */
export function fixKey(name: string) {
  return slugify(cleanSheetStreetName(name));
}

function formatWidth(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n === 0) return "0";
  return String(n);
}

export function parseSheetNumber(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  let t = String(v).trim();
  if (!t || t === "-----" || t === "-" || t === "—" || /^#/i.test(t)) return undefined;
  t = t.replace(/\s/g, "").replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function cellHasWidth(v: string) {
  const n = parseSheetNumber(v);
  return n != null;
}

function applyOverride(cells: Record<string, string>, override: WidthOverride | undefined) {
  if (!override) return;
  for (const [field, value] of Object.entries(override) as [WidthField, number | null][]) {
    const header = WIDTH_TO_HEADER[field];
    cells[header] = value == null ? "" : formatWidth(value);
  }
}

export type TransformedSheetTable = {
  slug: string;
  headers: string[];
  rows: Record<string, string>[];
};

function emptyWidthRow(name: string): Record<string, string> {
  const cells: Record<string, string> = { Nume: name };
  for (const h of MEASUREMENT_CSV_HEADERS) {
    if (h !== "Nume") cells[h] = "";
  }
  return cells;
}

function recordFromSheetRow(
  raw: Record<string, string>,
  map: Partial<Record<SheetCol, string>>,
  neighborhoodSlug: string
): Record<string, string> | null {
  const rawName = map.name ? String(raw[map.name] || "").trim() : "";
  if (isJunkSheetName(rawName)) return null;
  const cleaned = cleanSheetStreetName(rawName);
  if (!cleaned) return null;
  const key = fixKey(cleaned);
  if ((OMIT_STREETS[neighborhoodSlug] || []).includes(key)) return null;

  const renamed = STREET_RENAMES[neighborhoodSlug]?.[key] || cleaned;
  const get = (col: SheetCol) => (map[col] ? parseSheetNumber(raw[map[col]!]) : undefined);
  const cells: Record<string, string> = {
    Nume: renamed,
    "Latime trama stradala": formatWidth(get("row")),
    "Latime carosabil": formatWidth(get("carriage")),
    "Latime trotuar 1": formatWidth(get("sw1")),
    "Latime trotuar 2": formatWidth(get("sw2")),
    "Latime parcare 1": formatWidth(get("park1")),
    "Latime parcare 2": formatWidth(get("park2")),
    "Zona libera trotuar 1": formatWidth(get("free1")),
    "Zona libera trotuar 2": formatWidth(get("free2")),
    "Latime pista biciclete 1": formatWidth(get("bike1")),
    "Latime pista biciclete 2": formatWidth(get("bike2")),
    "Zona verde 1": formatWidth(get("green1")),
    "Zona verde 2": formatWidth(get("green2")),
  };
  if (map.green_mid) cells[GREEN_MID_HEADER] = formatWidth(get("green_mid"));
  applyOverride(cells, WIDTH_OVERRIDES[neighborhoodSlug]?.[key]);

  const hasWidth = MEASUREMENT_CSV_HEADERS.slice(1).some((h) => cellHasWidth(cells[h])) || cellHasWidth(cells[GREEN_MID_HEADER] || "");
  if (!hasWidth && DROP_EMPTY_WIDTH_SLUGS.has(neighborhoodSlug)) return null;
  return cells;
}

export function transformSheetTab(text: string, neighborhoodSlug: string): Record<string, string>[] {
  const { headers, rows } = parseSheetCsv(text);
  const map = mapSheetHeaders(headers);
  const out: Record<string, string>[] = [];
  const nameHeader = map.name || headers[0] || "";
  for (const extra of leadingNamesFromHeader(nameHeader)) {
    if (isJunkSheetName(extra)) continue;
    const cleaned = cleanSheetStreetName(extra);
    const key = fixKey(cleaned);
    if ((OMIT_STREETS[neighborhoodSlug] || []).includes(key)) continue;
    const renamed = STREET_RENAMES[neighborhoodSlug]?.[key] || cleaned;
    const cells = emptyWidthRow(renamed);
    applyOverride(cells, WIDTH_OVERRIDES[neighborhoodSlug]?.[key]);
    const hasWidth = MEASUREMENT_CSV_HEADERS.slice(1).some((h) => cellHasWidth(cells[h]));
    if (!hasWidth && DROP_EMPTY_WIDTH_SLUGS.has(neighborhoodSlug)) continue;
    out.push(cells);
  }
  for (const raw of rows) {
    const cells = recordFromSheetRow(raw, map, neighborhoodSlug);
    if (cells) out.push(cells);
  }
  return out;
}

export function mergeSheetTabs(parts: { neighborhoodSlug: string; text: string }[]): TransformedSheetTable[] {
  const grouped = new Map<string, Record<string, string>[]>();
  const tabCount = new Map<string, number>();
  for (const part of parts) {
    const rows = transformSheetTab(part.text, part.neighborhoodSlug);
    const list = grouped.get(part.neighborhoodSlug) || [];
    list.push(...rows);
    grouped.set(part.neighborhoodSlug, list);
    tabCount.set(part.neighborhoodSlug, (tabCount.get(part.neighborhoodSlug) || 0) + 1);
  }

  const tables: TransformedSheetTable[] = [];
  for (const [slug, rows] of grouped) {
    const merged = tabCount.get(slug)! > 1
      ? [...rows].sort((a, b) => String(a.Nume).localeCompare(String(b.Nume), "ro"))
      : rows;
    const hasMid = merged.some((r) => cellHasWidth(r[GREEN_MID_HEADER] || ""));
    const headers = hasMid ? [...MEASUREMENT_CSV_HEADERS, GREEN_MID_HEADER] : [...MEASUREMENT_CSV_HEADERS];
    const normalized = merged.map((r) => {
      const cells: Record<string, string> = {};
      for (const h of headers) cells[h] = r[h] ?? "";
      return cells;
    });
    tables.push({ slug, headers, rows: normalized });
  }
  return tables.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function serializeSheetTable(table: TransformedSheetTable) {
  return serializeCsvText(table.headers, table.rows);
}

export function sheetTableToCsvStreetRows(table: TransformedSheetTable): CsvStreetRow[] {
  return csvRowsToMeasurements(serializeSheetTable(table)).rows;
}

function sameWidthCell(a: string, b: string) {
  const na = parseSheetNumber(a);
  const nb = parseSheetNumber(b);
  if (na == null && nb == null) return true;
  return na === nb;
}

/** Compară tabele prelucrate cu un CSV existent (fără coloana Cartier). */
export function diffAgainstGoldenCsv(table: TransformedSheetTable, goldenText: string) {
  const gold = parseCsvText(goldenText);
  const nameH = gold.headers[0];
  const goldRows = gold.rows.filter((r) => String(r[nameH] || "").trim());
  const widthHeaders = [...MEASUREMENT_CSV_HEADERS.slice(1), GREEN_MID_HEADER];

  const extra: string[] = [];
  const missing: string[] = [];
  const values: { name: string; field: string; got: string; gold: string }[] = [];

  const used = new Set<number>();
  for (const row of table.rows) {
    const name = String(row.Nume || "").trim();
    const idx = goldRows.findIndex((g, i) => !used.has(i) && String(g[nameH] || "").trim() === name);
    if (idx < 0) {
      extra.push(name);
      continue;
    }
    used.add(idx);
    const g = goldRows[idx];
    for (const h of widthHeaders) {
      if (h === GREEN_MID_HEADER && g[h] == null && !row[h]) continue;
      const got = String(row[h] ?? "").trim();
      const want = String(g[h] ?? "").trim();
      if (!sameWidthCell(got, want)) values.push({ name, field: h, got, gold: want });
    }
  }
  goldRows.forEach((g, i) => {
    if (!used.has(i)) missing.push(String(g[nameH] || "").trim());
  });
  return { extra, missing, values, goldCount: goldRows.length, gotCount: table.rows.length };
}
