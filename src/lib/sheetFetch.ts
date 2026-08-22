/** Fetch live din Google Sheets (dev: proxy Vite; production: gviz CSV). */

import { googleSheetCsvUrl, SHEET_TABS, type SheetTab } from "./sheetCatalog";
import {
  editorHeadersFor,
  mergeSheetRecords,
  recordsBySlugMap,
  recordsToTable,
  serializeSheetTable,
  type NeighborhoodRecords,
  type SheetStreetRecord,
  type TransformedSheetTable,
} from "./sheetTransform";
import {
  detectFixDrift,
  emptyStreetFixes,
  parseStreetFixesFile,
  persistStreetFixesFile as persistStreetFixes,
  type FixDrift,
  type StreetFixesFile,
} from "./streetFixes";

export type SheetLoadResult = {
  tables: TransformedSheetTable[];
  groups: NeighborhoodRecords[];
  loadedTabs: { tab: string; slug: string }[];
  failedTabs: { tab: string; detail: string }[];
  fixes: StreetFixesFile;
  drift: FixDrift[];
};

function assetUrl(rel: string) {
  const base = import.meta.env.BASE_URL || "./";
  const b = base.endsWith("/") ? base : `${base}/`;
  const r = rel.replace(/^\.\//, "").replace(/^\//, "");
  return `${b}${r}`;
}

function tabFetchUrl(tab: SheetTab) {
  if (import.meta.env.DEV) return `/__ubr/google-sheet?gid=${encodeURIComponent(tab.gid)}`;
  return googleSheetCsvUrl(tab.gid);
}

async function fetchTabCsv(tab: SheetTab): Promise<string> {
  const r = await fetch(tabFetchUrl(tab), { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (!text.trim() || text.trimStart().startsWith("<!")) throw new Error("răspunsul nu e CSV");
  return text;
}

export async function fetchStreetFixesFile(): Promise<StreetFixesFile> {
  try {
    const r = await fetch(assetUrl("data/street-fixes.json"), { cache: "no-store" });
    if (!r.ok) return emptyStreetFixes();
    return parseStreetFixesFile(await r.json());
  } catch {
    return emptyStreetFixes();
  }
}

export { persistStreetFixes as persistStreetFixesFile };

export async function fetchGoogleSheetMeasurements(): Promise<SheetLoadResult> {
  const [fixes, settled] = await Promise.all([
    fetchStreetFixesFile(),
    Promise.allSettled(
      SHEET_TABS.map(async (tab) => {
        const text = await fetchTabCsv(tab);
        return { tab, text };
      })
    ),
  ]);

  const parts: { neighborhoodSlug: string; text: string }[] = [];
  const loadedTabs: SheetLoadResult["loadedTabs"] = [];
  const failedTabs: SheetLoadResult["failedTabs"] = [];

  settled.forEach((item, i) => {
    const tab = SHEET_TABS[i];
    if (item.status === "fulfilled") {
      parts.push({ neighborhoodSlug: tab.neighborhoodSlug, text: item.value.text });
      loadedTabs.push({ tab: tab.tab, slug: tab.neighborhoodSlug });
    } else {
      failedTabs.push({
        tab: tab.tab,
        detail: item.reason instanceof Error ? item.reason.message : String(item.reason),
      });
    }
  });

  const groups = mergeSheetRecords(parts, fixes);
  return {
    tables: groups.map((g) => recordsToTable(g.slug, g.records)),
    groups,
    loadedTabs,
    failedTabs,
    fixes,
    drift: detectFixDrift(recordsBySlugMap(groups), fixes),
  };
}

export function sheetTablesToCsvFiles(tables: TransformedSheetTable[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const t of tables) files[t.slug] = serializeSheetTable(t);
  return files;
}

export function recordsToEditorRows(records: SheetStreetRecord[], newId: () => string) {
  const headers = editorHeadersFor(records);
  return {
    headers,
    rows: records.map((rec) => ({
      id: newId(),
      cells: Object.fromEntries(headers.map((h) => [h, rec.cells[h] ?? (h === "Nume" ? rec.displayName : "")])),
      mark: "none" as const,
      uniqueKey: rec.uniqueKey,
      baseKey: rec.baseKey,
      sheetName: rec.sheetName,
      sheetCells: { ...rec.sheetCells },
      omitted: rec.omitted,
    })),
  };
}
