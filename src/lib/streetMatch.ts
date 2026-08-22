/** Matching nume CSV ↔ străzi OSM din același cartier (fără diacritice, fără „Strada”). */

import { lineSortKey } from "./geoAssign";
import { normalizeStreetName, slugify } from "./space";

export type MatchIssueCode =
  | "csv_empty_widths"
  | "csv_no_osm_match"
  | "csv_ambiguous_osm"
  | "csv_multi_osm_segments"
  | "csv_merged_segments"
  | "osm_unassigned_neighborhood"
  | "osm_no_csv_in_neighborhood"
  | "osm_clipped_neighborhood"
  | "csv_parse_columns"
  | "geometry_source"
  | "sheets_source"
  | "arondare_csv_missing"
  | "arondare_no_osm"
  | "arondare_osm_no_school"
  | "arondare_school_unmatched"
  | "arondare_multi_school"
  | "arondare_ambiguous_osm";

export type ImportIssue = {
  code: MatchIssueCode;
  severity: "error" | "warn" | "info";
  neighborhood_slug?: string;
  csv_name?: string;
  osm_name?: string;
  osm_id?: string | number;
  detail: string;
  hint?: string;
};

/** Indici 1–20 = duplicate CSV de secțiune (Egalitatii 1); nu ani (Anul 1907). */
const MAX_CSV_SEGMENT_INDEX = 20;

export function stripSegmentSuffix(name: string): { base: string; index: number | null } {
  const n = String(name || "").trim();
  // „Ștefan cel Mare 1/2” — un singur token de secțiune, nu parte din nume.
  const half = n.match(/^(.*?)(?:\s+|[_-])(1\/2)$/);
  if (half) {
    const base = half[1].trim();
    if (base) return { base, index: 1 };
  }
  const m = n.match(/^(.*?)(?:\s+|[_-])(\d+)$/);
  if (!m) return { base: n, index: null };
  const base = m[1].trim();
  const index = Number(m[2]);
  // Token de sine stătător + index mic de secțiune. 1907 / alte numere semnificative rămân în nume.
  if (!base || !Number.isInteger(index) || index < 1 || index > MAX_CSV_SEGMENT_INDEX) {
    return { base: n, index: null };
  }
  return { base, index };
}

/** Cheie de potrivire: fără „Strada”, fără diacritice, lowercase slug. */
export function nameKey(name: string, opts?: { keepDistinctivePrefix?: boolean }) {
  return normalizeStreetName(name, opts);
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

export type OsmStreet = {
  feature: GeoJSON.Feature;
  sid: string;
  name: string;
  key: string;
  cartier: string;
};

/** Grupează străzile OSM dintr-un cartier după nume normalizat. */
export function groupByNameKey(streets: OsmStreet[]) {
  const map = new Map<string, OsmStreet[]>();
  for (const s of streets) {
    const list = map.get(s.key) || [];
    list.push(s);
    map.set(s.key, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => lineSortKey(a.feature.geometry) - lineSortKey(b.feature.geometry));
  }
  return map;
}

export type MatchResult = {
  targets: OsmStreet[];
  method: "exact" | "fuzzy";
  issues: ImportIssue[];
};

/**
 * Potrivește un nume CSV (deja fără sufix 1/2 dacă a fost mediat) la toate
 * segmentele OSM cu același nume normalizat din cartier.
 * `fuzzy` (implicit true) e pentru măsurători; arondarea școlilor trece `false`
 * ca să nu atribuie școala pe Levenshtein 1–2 (Murelor→Morilor).
 */
export function matchCsvNameToOsm(
  csvName: string,
  neighborhoodSlug: string | undefined,
  byKey: Map<string, OsmStreet[]>,
  opts?: { fuzzy?: boolean; keepDistinctivePrefix?: boolean }
): MatchResult {
  const issues: ImportIssue[] = [];
  const key = nameKey(csvName, opts);
  const loc = neighborhoodSlug ? ` în „${neighborhoodSlug}”` : "";
  const allowFuzzy = opts?.fuzzy ?? true;

  const exact = byKey.get(key);
  if (exact?.length) {
    if (exact.length > 1) {
      issues.push({
        code: "csv_multi_osm_segments",
        severity: "info",
        neighborhood_slug: neighborhoodSlug,
        csv_name: csvName,
        osm_name: exact[0].name,
        osm_id: (exact[0].feature.properties as { osm_id?: string | number } | null)?.osm_id,
        detail: `CSV „${csvName}” → ${exact.length} segmente OSM; aplicăm aceeași măsurătoare pe toate.`,
      });
    }
    return { targets: exact, method: "exact", issues };
  }

  if (allowFuzzy) {
    const fuzzy = fuzzyGroup(key, byKey);
    if (fuzzy?.length) {
      issues.push({
        code: "csv_ambiguous_osm",
        severity: "warn",
        neighborhood_slug: neighborhoodSlug,
        csv_name: csvName,
        osm_name: fuzzy[0].name,
        detail: `Potrivire fuzzy (fără diacritice): CSV „${csvName}” ≈ OSM „${fuzzy[0].name}” (${fuzzy.length} seg.).`,
        hint: "Aliniază denumirea din CSV la OSM ca să eviți false positives.",
      });
      return { targets: fuzzy, method: "fuzzy", issues };
    }
  }

  issues.push({
    code: "csv_no_osm_match",
    severity: "error",
    neighborhood_slug: neighborhoodSlug,
    csv_name: csvName,
    detail: `Nicio potrivire OSM${loc} pentru CSV „${csvName}” (key=${key}).`,
    hint: `Candidați${neighborhoodSlug ? " în cartier" : ""}: ${nearestKeys(key, byKey, 5).join(", ") || "(niciunul)"}. Dacă strada există în OSM dar lipsește aici, e posibil să nu fi fost asignată cartierului (contur poligon).`,
  });
  return { targets: [], method: "exact", issues };
}

function fuzzyGroup(key: string, byKey: Map<string, OsmStreet[]>) {
  let best: { k: string; d: number } | null = null;
  for (const k of byKey.keys()) {
    if (k.includes(key) || key.includes(k)) {
      const d = Math.abs(k.length - key.length);
      if (!best || d < best.d) best = { k, d };
      continue;
    }
    const d = levenshtein(k, key);
    if (d <= 2 && (!best || d < best.d)) best = { k, d };
  }
  return best ? byKey.get(best.k) || null : null;
}

function nearestKeys(key: string, byKey: Map<string, OsmStreet[]>, n: number) {
  return [...byKey.keys()]
    .map((k) => ({ k, d: levenshtein(k, key) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => `${x.k}(d=${x.d})`);
}

export function measurementCatalogKey(neighborhoodSlug: string, csvName: string) {
  return `${slugify(neighborhoodSlug)}::${nameKey(csvName)}`;
}
