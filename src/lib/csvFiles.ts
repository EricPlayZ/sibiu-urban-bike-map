/** Încărcare / salvare CSV măsurători (editorul e doar în `npm run dev`). */

import {
  parseCsvText,
  serializeCsvText,
  type ParkingMark,
} from "./csvImport";
import { MEASUREMENT_CSV_SLUGS } from "./measurementsSlugs.generated";

export type CsvEditorRow = {
  id: string;
  cells: Record<string, string>;
  mark: ParkingMark;
};

export type CsvEditorTable = {
  slug: string;
  headers: string[];
  rows: CsvEditorRow[];
};

function assetUrl(rel: string) {
  const base = import.meta.env.BASE_URL || "./";
  const b = base.endsWith("/") ? base : `${base}/`;
  const r = rel.replace(/^\.\//, "").replace(/^\//, "");
  return `${b}${r}`;
}

export function newCsvRowId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptyCsvRow(headers: string[], mark: ParkingMark = "none"): CsvEditorRow {
  const cells: Record<string, string> = {};
  for (const h of headers) cells[h] = "";
  return { id: newCsvRowId(), cells, mark };
}

export function cloneCsvTables(tables: CsvEditorTable[]): CsvEditorTable[] {
  return structuredClone(tables);
}

/** Fingerprint fără marcaje — doar ce se scrie pe disk. */
export function csvTablesFileFingerprint(tables: CsvEditorTable[]): string {
  return JSON.stringify(
    tables.map((t) => ({
      slug: t.slug,
      headers: t.headers,
      rows: t.rows.map((r) => r.cells),
    }))
  );
}

function tableFileKey(t: CsvEditorTable) {
  return JSON.stringify({ headers: t.headers, rows: t.rows.map((r) => r.cells) });
}

/** Doar tabelele cu celule schimbate — evită diff-uri CSV pe cartiere neatins. */
export function serializeDirtyCsvTables(tables: CsvEditorTable[], saved: CsvEditorTable[]): Record<string, string> {
  const prev = new Map(saved.map((t) => [t.slug, t]));
  const files: Record<string, string> = {};
  for (const t of tables) {
    const before = prev.get(t.slug);
    if (before && tableFileKey(t) === tableFileKey(before)) continue;
    files[t.slug] = serializeCsvText(
      t.headers,
      t.rows.map((r) => r.cells)
    );
  }
  return files;
}

export async function fetchMeasurementTables(): Promise<CsvEditorTable[]> {
  const tables: CsvEditorTable[] = [];
  for (const slug of MEASUREMENT_CSV_SLUGS) {
    const r = await fetch(assetUrl(`data/measurements/${slug}.csv`), { cache: "no-store" });
    if (!r.ok) throw new Error(`Nu am putut încărca ${slug}.csv`);
    const text = await r.text();
    const { headers, rows } = parseCsvText(text);
    tables.push({
      slug,
      headers,
      rows: rows.map((cells) => ({ id: newCsvRowId(), cells, mark: "none" })),
    });
  }
  return tables;
}

/** În `npm run dev`, scrie CSV-urile pe disk. Production: no-op. */
export async function persistMeasurementCsvFiles(files: Record<string, string>): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const r = await fetch("/__ubr/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
