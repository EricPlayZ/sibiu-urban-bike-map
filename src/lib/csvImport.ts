/** Parser CSV măsurători + derivare flag-uri din lățimi. */

import type { Measurement } from "./space";
import { stripSegmentSuffix, nameKey } from "./streetMatch";

export type CsvStreetRow = {
  /** Nume din CSV (poate fi scurt / cu 1/2). */
  name: string;
  row_width_m?: number;
  carriageway_m?: number;
  sidewalk1_m?: number;
  sidewalk2_m?: number;
  parking1_m?: number;
  parking2_m?: number;
  free_sidewalk1_m?: number;
  free_sidewalk2_m?: number;
  bike1_m?: number;
  bike2_m?: number;
  green1_m?: number;
  green2_m?: number;
  /** Câte rânduri CSV au fost mediate (ex. Stefan 1 + Stefan 2). */
  _mergedFrom?: number;
};

export type DerivedFlags = {
  bike_lane: boolean;
  rsrvd_park: boolean;
  illgl_park: boolean;
  /** Pistă pe carosabil = pistă + parcare amenajată. */
  bike_door: boolean;
  has_green: boolean;
};

const COL = {
  name: ["nume", "name", "strada"],
  row: ["latime trama stradala", "tramă stradală", "trama stradala", "row_width_m"],
  carriage: ["latime carosabil", "carosabil", "carriageway_m"],
  sw1: ["latime trotuar 1", "trotuar 1", "sidewalk1_m"],
  sw2: ["latime trotuar 2", "trotuar 2", "sidewalk2_m"],
  park1: ["latime parcare 1", "latimea parcare 1", "parcare 1", "parking1_m"],
  park2: ["latime parcare 2", "latimea parcare 2", "parcare 2", "parking2_m"],
  free1: ["zona libera trotuar 1", "zona liberă trotuar 1", "free_sidewalk1_m"],
  free2: ["zona libera trotuar 2", "zona liberă trotuar 2", "free_sidewalk2_m"],
  bike1: ["latime pista biciclete 1", "lățime pistă biciclete 1", "pista 1", "bike1_m"],
  bike2: ["latime pista biciclete 2", "lățime pistă biciclete 2", "pista 2", "bike2_m"],
  green1: ["zona verde 1", "green1_m"],
  green2: ["zona verde 2", "green2_m"],
} as const;

const WIDTH_KEYS = [
  "row_width_m",
  "carriageway_m",
  "sidewalk1_m",
  "sidewalk2_m",
  "parking1_m",
  "parking2_m",
  "free_sidewalk1_m",
  "free_sidewalk2_m",
  "bike1_m",
  "bike2_m",
  "green1_m",
  "green2_m",
] as const;

function normHeader(h: string) {
  return h
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

function findCol(headers: string[], aliases: readonly string[]) {
  const normalized = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  for (const a of aliases) {
    const an = normHeader(a);
    const hit = normalized.find((h) => h.n === an);
    if (hit) return hit.raw;
  }
  for (const a of aliases) {
    const an = normHeader(a);
    const hit = normalized.find((h) => h.n.includes(an) || an.includes(h.n));
    if (hit) return hit.raw;
  }
  return null;
}

function parseNum(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const t = String(v).trim().replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function hasWidth(v: number | undefined) {
  return v != null && Number.isFinite(v) && v > 0;
}

/** Media valorilor > 0; dacă e una singură, o păstrăm. */
export function avgPositive(...vals: (number | undefined)[]): number | undefined {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  if (!xs.length) return undefined;
  const sum = xs.reduce((a, b) => a + b, 0);
  return Math.round((sum / xs.length) * 1000) / 1000;
}

/** Media pe mai multe rânduri CSV (ex. „Stefan cel Mare 1” + „… 2”), păstrând coloanele stânga/dreapta. */
export function averageCsvRows(rows: CsvStreetRow[], displayName: string): CsvStreetRow {
  const out: CsvStreetRow = { name: displayName, _mergedFrom: rows.length };
  for (const key of WIDTH_KEYS) {
    out[key] = avgPositive(...rows.map((r) => r[key]));
  }
  return out;
}

/**
 * Grupează „Nume 1”, „Nume 2” → o măsurătoare medie pe numele de bază.
 * Numele afișat = baza fără sufix numeric.
 * Coloanele 1/2 (trotuar, parcare, …) rămân pe partea lor — nu se mediează între stânga și dreapta.
 */
export function mergeNumberedCsvStreets(rows: CsvStreetRow[]): CsvStreetRow[] {
  const groups = new Map<string, CsvStreetRow[]>();
  for (const row of rows) {
    const { base } = stripSegmentSuffix(row.name);
    const key = nameKey(base);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  const out: CsvStreetRow[] = [];
  for (const [, list] of groups) {
    const { base } = stripSegmentSuffix(list[0].name);
    if (list.length === 1 && stripSegmentSuffix(list[0].name).index == null) {
      out.push(list[0]);
    } else {
      out.push(averageCsvRows(list, base));
    }
  }
  return out;
}

/** Verifică dacă textul arată a CSV real (nu HTML de la SPA 404). */
export function looksLikeMeasurementCsv(text: string): boolean {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t || t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<HTML")) return false;
  const first = t.split(/\r?\n/)[0] || "";
  if (!first.includes(",")) return false;
  const h = normHeader(first);
  return h.includes("nume") || h.includes("name") || h.includes("latime") || h.includes("trotuar");
}

/** Parse CSV simplu (virgule, fără escaped quotes complexe). */
export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function csvRowsToMeasurements(text: string): {
  rows: CsvStreetRow[];
  missingColumns: string[];
} {
  const { headers, rows: raw } = parseCsvText(text);
  const map = {
    name: findCol(headers, COL.name),
    row: findCol(headers, COL.row),
    carriage: findCol(headers, COL.carriage),
    sw1: findCol(headers, COL.sw1),
    sw2: findCol(headers, COL.sw2),
    park1: findCol(headers, COL.park1),
    park2: findCol(headers, COL.park2),
    free1: findCol(headers, COL.free1),
    free2: findCol(headers, COL.free2),
    bike1: findCol(headers, COL.bike1),
    bike2: findCol(headers, COL.bike2),
    green1: findCol(headers, COL.green1),
    green2: findCol(headers, COL.green2),
  };

  const missingColumns: string[] = [];
  if (!map.name) missingColumns.push("Nume");
  if (!map.free1) missingColumns.push("Zona libera trotuar 1");
  if (!map.park1) missingColumns.push("Latime parcare 1");
  if (!map.bike1) missingColumns.push("Latime pista biciclete 1");

  const rows: CsvStreetRow[] = [];
  for (const r of raw) {
    const name = map.name ? String(r[map.name] || "").trim() : "";
    if (!name) continue;
    const get = (key: keyof typeof map) => (map[key] ? parseNum(r[map[key]!]) : undefined);
    rows.push({
      name,
      row_width_m: get("row"),
      carriageway_m: get("carriage"),
      sidewalk1_m: get("sw1"),
      sidewalk2_m: get("sw2"),
      parking1_m: get("park1"),
      parking2_m: get("park2"),
      free_sidewalk1_m: get("free1"),
      free_sidewalk2_m: get("free2"),
      bike1_m: get("bike1"),
      bike2_m: get("bike2"),
      green1_m: get("green1"),
      green2_m: get("green2"),
    });
  }
  return { rows, missingColumns };
}

/**
 * Reguli din CSV:
 * - parcare amenajată: fără zonă liberă trotuar, cu lățime parcare
 * - parcare ilegală: cu zonă liberă trotuar, fără lățime parcare
 * - pistă: lățime pistă
 * - pistă pe carosabil: pistă + parcare amenajată
 * - verde: lățime zonă verde (doar pentru spațiu / raport)
 */
export function deriveFlagsFromWidths(row: CsvStreetRow): DerivedFlags {
  const hasFree = hasWidth(row.free_sidewalk1_m) || hasWidth(row.free_sidewalk2_m);
  const hasPark = hasWidth(row.parking1_m) || hasWidth(row.parking2_m);
  const bike = hasWidth(row.bike1_m) || hasWidth(row.bike2_m);
  const has_green = hasWidth(row.green1_m) || hasWidth(row.green2_m);

  const rsrvd_park = !hasFree && hasPark;
  const illgl_park = hasFree && !hasPark;
  const bike_lane = bike;
  const bike_door = bike_lane && rsrvd_park;

  return { bike_lane, rsrvd_park, illgl_park, bike_door, has_green };
}

export function csvRowToMeasurement(row: CsvStreetRow, neighborhoodSlug: string): Measurement {
  return {
    name: row.name,
    neighborhood_slug: neighborhoodSlug,
    row_width_m: row.row_width_m,
    carriageway_m: row.carriageway_m,
    sidewalk1_m: row.sidewalk1_m,
    sidewalk2_m: row.sidewalk2_m,
    parking1_m: row.parking1_m,
    parking2_m: row.parking2_m,
    free_sidewalk1_m: row.free_sidewalk1_m,
    free_sidewalk2_m: row.free_sidewalk2_m,
    bike1_m: row.bike1_m,
    bike2_m: row.bike2_m,
    green1_m: row.green1_m,
    green2_m: row.green2_m,
    source: "csv",
  };
}

export function rowHasAnyWidth(row: CsvStreetRow) {
  return (
    hasWidth(row.row_width_m) ||
    hasWidth(row.carriageway_m) ||
    hasWidth(row.sidewalk1_m) ||
    hasWidth(row.sidewalk2_m) ||
    hasWidth(row.parking1_m) ||
    hasWidth(row.parking2_m) ||
    hasWidth(row.free_sidewalk1_m) ||
    hasWidth(row.free_sidewalk2_m) ||
    hasWidth(row.bike1_m) ||
    hasWidth(row.bike2_m) ||
    hasWidth(row.green1_m) ||
    hasWidth(row.green2_m)
  );
}
