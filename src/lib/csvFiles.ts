/** Încărcare editor măsurători (DEV) — date din Google Sheets + street-fixes.json. */

import { type ParkingMark } from "./csvImport";
import { SHEET_TABS } from "./sheetCatalog";
import { fetchGoogleSheetMeasurements, persistStreetFixesFile, recordsToEditorRows } from "./sheetFetch";
import type { FixDrift, StreetFixesFile } from "./streetFixes";

export type CsvEditorRow = {
  id: string;
  cells: Record<string, string>;
  mark: ParkingMark;
  uniqueKey: string;
  baseKey: string;
  sheetName: string;
  sheetCells: Record<string, string>;
  omitted: boolean;
};

export type CsvEditorTable = {
  slug: string;
  headers: string[];
  rows: CsvEditorRow[];
};

export type SheetEditorLoad = {
  tables: CsvEditorTable[];
  fixes: StreetFixesFile;
  drift: FixDrift[];
};

export function newCsvRowId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function cloneCsvTables(tables: CsvEditorTable[]): CsvEditorTable[] {
  return structuredClone(tables);
}

function editorRowFingerprint(r: CsvEditorRow) {
  return {
    uniqueKey: r.uniqueKey,
    omitted: r.omitted,
    cells: r.cells,
  };
}

/** Fingerprint fără marcaje — doar ce se scrie în street-fixes.json. */
export function csvTablesFileFingerprint(tables: CsvEditorTable[]): string {
  return JSON.stringify(
    tables.map((t) => ({
      slug: t.slug,
      rows: t.rows.map(editorRowFingerprint),
    }))
  );
}

export function editorRowToFixable(row: CsvEditorRow) {
  const displayName = String(row.cells.Nume ?? row.sheetName).trim() || row.sheetName;
  return {
    uniqueKey: row.uniqueKey,
    baseKey: row.baseKey,
    sheetName: row.sheetName,
    displayName,
    sheetCells: row.sheetCells,
    cells: { ...row.cells, Nume: displayName },
    omitted: row.omitted,
  };
}

export function tablesToRecordsBySlug(tables: CsvEditorTable[]) {
  const out: Record<string, ReturnType<typeof editorRowToFixable>[]> = {};
  for (const t of tables) out[t.slug] = t.rows.map(editorRowToFixable);
  return out;
}

export async function fetchSheetEditorTables(): Promise<SheetEditorLoad> {
  const sheets = await fetchGoogleSheetMeasurements();
  if (!sheets.loadedTabs.length && sheets.failedTabs.length) {
    const first = sheets.failedTabs[0]?.detail || "necunoscut";
    throw new Error(`Nu am putut încărca Google Sheets (${first}).`);
  }
  const bySlug = new Map(sheets.groups.map((g) => [g.slug, g.records]));
  const order = [...new Set(SHEET_TABS.map((t) => t.neighborhoodSlug))];
  const tables: CsvEditorTable[] = [];
  for (const slug of order) {
    const records = bySlug.get(slug) || [];
    const { headers, rows } = recordsToEditorRows(records, newCsvRowId);
    tables.push({ slug, headers, rows });
  }
  return { tables, fixes: sheets.fixes, drift: sheets.drift };
}

export { persistStreetFixesFile };
