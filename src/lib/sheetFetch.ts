/** Fetch live din Google Sheets (dev: proxy Vite; production: gviz CSV). */

import { googleSheetCsvUrl, SHEET_TABS, type SheetTab } from "./sheetCatalog";
import { mergeSheetTabs, serializeSheetTable, type TransformedSheetTable } from "./sheetTransform";

export type SheetLoadResult = {
  tables: TransformedSheetTable[];
  loadedTabs: { tab: string; slug: string }[];
  failedTabs: { tab: string; detail: string }[];
};

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

export async function fetchGoogleSheetMeasurements(): Promise<SheetLoadResult> {
  const settled = await Promise.allSettled(
    SHEET_TABS.map(async (tab) => {
      const text = await fetchTabCsv(tab);
      return { tab, text };
    })
  );

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

  return {
    tables: mergeSheetTabs(parts),
    loadedTabs,
    failedTabs,
  };
}

export function sheetTablesToCsvFiles(tables: TransformedSheetTable[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const t of tables) files[t.slug] = serializeSheetTable(t);
  return files;
}
