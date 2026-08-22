/** Catalogul Google Sheets „Map the city SB” — un tab per cartier. */

export const GOOGLE_SHEET_ID = "1Xi_cYqgpAp45mNvv6YeNCdBSRnmpwKUE3VoyfN-cLT8";

export type SheetTab = {
  /** Numele tab-ului din spreadsheet. */
  tab: string;
  gid: string;
  /** Slug-ul cartierului din neighborhood_limits (după combinări). */
  neighborhoodSlug: string;
};

/**
 * Hipodrom I–IV → un singur cartier `hipodrom` (poligonul părinte, `dissolve: true` pe subdiviziuni).
 * Tab-urile fără poligon activ (ex. „Intre 3 Stejari…”) sunt omise.
 */
export const SHEET_TABS: readonly SheetTab[] = [
  { tab: "Trei stejari", gid: "0", neighborhoodSlug: "trei_stejari" },
  { tab: "Dumbrăvii", gid: "741226641", neighborhoodSlug: "dumbravii" },
  { tab: "Lupeni", gid: "1784216432", neighborhoodSlug: "lupeni" },
  { tab: "Hipodrom I", gid: "89706331", neighborhoodSlug: "hipodrom" },
  { tab: "Hipodrom II", gid: "1913837601", neighborhoodSlug: "hipodrom" },
  { tab: "Hipodrom III", gid: "2047069047", neighborhoodSlug: "hipodrom" },
  { tab: "Hipodrom IV", gid: "229732066", neighborhoodSlug: "hipodrom" },
  { tab: "Strand II", gid: "1878428156", neighborhoodSlug: "strand2" },
  { tab: "Lazaret", gid: "1751522187", neighborhoodSlug: "lazaret" },
  { tab: "Terezian", gid: "915308226", neighborhoodSlug: "terezian" },
  { tab: "Valea Aurie", gid: "347581253", neighborhoodSlug: "valea_aurie" },
  { tab: "Centru", gid: "775315853", neighborhoodSlug: "centru" },
  { tab: "Strand", gid: "22374326", neighborhoodSlug: "strand" },
  { tab: "Resita", gid: "2021843085", neighborhoodSlug: "resita" },
  { tab: "Tiglari", gid: "1851945598", neighborhoodSlug: "tiglari" },
  { tab: "Tineretului", gid: "1376809326", neighborhoodSlug: "tineretului" },
  { tab: "Veteranilor de Razboi", gid: "1100243022", neighborhoodSlug: "veteranilor_de_razboi" },
  { tab: "Tilisca", gid: "329938168", neighborhoodSlug: "tilisca" },
  { tab: "Vasile Aaron", gid: "956776783", neighborhoodSlug: "vasile_aaron" },
  { tab: "Broscarie", gid: "842003355", neighborhoodSlug: "broscarie" },
];

export function googleSheetCsvUrl(gid: string) {
  return `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
}

export const MEASUREMENT_CSV_HEADERS = [
  "Nume",
  "Latime trama stradala",
  "Latime carosabil",
  "Latime trotuar 1",
  "Latime trotuar 2",
  "Latime parcare 1",
  "Latime parcare 2",
  "Zona libera trotuar 1",
  "Zona libera trotuar 2",
  "Latime pista biciclete 1",
  "Latime pista biciclete 2",
  "Zona verde 1",
  "Zona verde 2",
] as const;

export const GREEN_MID_HEADER = "Zona verde intre benzi";
