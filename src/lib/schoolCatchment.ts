/** Arondare școli: CSV streets → OSM `arondat` (slug-uri, virgulă), oraș-wide după nume. */

import { parseCsvText } from "./csvImport";
import { makeStreetId } from "./space";
import {
  groupByNameKey,
  matchCsvNameToOsm,
  nameKey,
  type ImportIssue,
  type OsmStreet,
} from "./streetMatch";

const CATCHMENT_KEY = { keepDistinctivePrefix: true } as const;

export type CatchmentRow = {
  school_slug: string;
  school_name: string;
  street_name: string;
  description?: string;
  source_pdf?: string;
};

export type CatchmentStats = {
  csvRows: number;
  osmMatched: number;
  csvUnmatched: number;
  osmWithoutSchool: number;
  schoolUnmatched: number;
  multiSchool: number;
};

const OSM_NO_SCHOOL_SAMPLE = 30;

/** Slug-uri din `arondat` — string cu virgulă sau listă (GeoJSON / MapLibre). */
export function parseArondat(value: unknown): string[] {
  const raw =
    Array.isArray(value)
      ? value.map((v) => String(v ?? "").trim())
      : String(value ?? "")
          .split(",")
          .map((v) => v.trim());
  const out: string[] = [];
  const seen = new Set<string>();
  for (const slug of raw) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

export function formatArondat(slugs: string[]): string {
  return parseArondat(slugs).join(",");
}

export function streetSchoolSlugs(props: Record<string, unknown> | null | undefined): string[] {
  return parseArondat(props?.arondat);
}

export function streetAssignedToSchool(props: Record<string, unknown> | null | undefined, slug: string): boolean {
  if (!slug) return false;
  return streetSchoolSlugs(props).includes(slug);
}

function col(row: Record<string, string>, names: string[]) {
  const keys = Object.keys(row);
  for (const n of names) {
    const hit = keys.find((k) => k.trim().toLowerCase() === n);
    if (hit) return String(row[hit] || "").trim();
  }
  return "";
}

export function parseCatchmentCsv(text: string): CatchmentRow[] {
  const { rows } = parseCsvText(text);
  const out: CatchmentRow[] = [];
  for (const raw of rows) {
    const street_name = col(raw, ["street_name", "nume artera", "strada", "name"]);
    if (!street_name) continue;
    out.push({
      school_slug: col(raw, ["school_slug", "slug"]),
      school_name: col(raw, ["school_name", "denumire", "scoala"]),
      street_name,
      description: col(raw, ["description", "descriere"]) || undefined,
      source_pdf: col(raw, ["source_pdf", "pdf"]) || undefined,
    });
  }
  return out;
}

function remapMatchIssue(issue: ImportIssue, row: CatchmentRow): ImportIssue | null {
  if (issue.code === "csv_multi_osm_segments") return null;
  if (issue.code === "csv_no_osm_match") {
    return {
      ...issue,
      code: "arondare_no_osm",
      csv_name: row.street_name,
      detail: `Arondare: nicio stradă OSM pentru „${row.street_name}” (${row.school_name || row.school_slug}).`,
      hint: "Adaugă way-ul în OSM cu același tip (Aleea/Piața/Strada) sau lasă-l nepotrivit până e mapat. Nu atribuim școala pe un nume similar.",
    };
  }
  if (issue.code === "csv_ambiguous_osm") {
    return {
      ...issue,
      code: "arondare_ambiguous_osm",
      csv_name: row.street_name,
      detail: `Arondare fuzzy: CSV „${row.street_name}” ≈ OSM „${issue.osm_name || "?"}” → ${row.school_slug || row.school_name}.`,
      hint: "Aliniază numele din PDF/CSV la OSM dacă potrivirea e greșită.",
    };
  }
  return issue;
}

/**
 * Toate școlile CSV pentru un nume normalizat ajung pe `arondat` (ordine CSV).
 * Ordinea rândurilor urmează circumscripțiile din PDF (1, 2, …).
 */
export function applySchoolCatchments(
  features: GeoJSON.Feature[],
  csvText: string | null,
  schoolSlugs: Set<string>
): { issues: ImportIssue[]; stats: CatchmentStats } {
  const issues: ImportIssue[] = [];
  const stats: CatchmentStats = {
    csvRows: 0,
    osmMatched: 0,
    csvUnmatched: 0,
    osmWithoutSchool: 0,
    schoolUnmatched: 0,
    multiSchool: 0,
  };

  for (const f of features) {
    const p = (f.properties || {}) as Record<string, unknown>;
    delete p.arondat;
    f.properties = p;
  }

  if (csvText == null) {
    issues.push({
      code: "arondare_csv_missing",
      severity: "warn",
      detail: "Lipsește public/data/school-catchments.csv — străzile nu primesc arondat.",
      hint: "Generează CSV-ul cu scripts/extract-school-catchments.py din PDF-urile ISJ.",
    });
    return { issues, stats };
  }

  const rows = parseCatchmentCsv(csvText);
  stats.csvRows = rows.length;
  if (!rows.length) {
    issues.push({
      code: "arondare_csv_missing",
      severity: "warn",
      detail: "school-catchments.csv e gol sau fără coloana street_name.",
    });
    return { issues, stats };
  }

  const osmStreets: OsmStreet[] = features.map((f, i) => {
    const p = (f.properties || {}) as Record<string, unknown>;
    const name = String(p.name || "");
    return {
      feature: f,
      sid: String(p.sid || makeStreetId(f, i)),
      name,
      key: nameKey(name, CATCHMENT_KEY),
      cartier: String(p.cartier || ""),
    };
  });
  const byKey = groupByNameKey(osmStreets.filter((s) => s.key));

  const byName = new Map<string, CatchmentRow[]>();
  for (const row of rows) {
    const key = nameKey(row.street_name, CATCHMENT_KEY);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(row);
    byName.set(key, list);
  }

  const unmatchedSchools = new Set<string>();
  let csvUnmatched = 0;

  for (const [, list] of byName) {
    const slugs = parseArondat(list.map((r) => r.school_slug));
    const primary = list[0];
    if (slugs.length > 1) {
      stats.multiSchool++;
      issues.push({
        code: "arondare_multi_school",
        severity: "info",
        csv_name: primary.street_name,
        detail: `„${primary.street_name}” e în ${slugs.length} școli (${slugs.join(", ")}). Păstrăm toate pe stradă.`,
        hint: "Strada e desenată cu toate culorile școlilor. Segmentele din DESCRIERE nu sunt tăiate pe OSM.",
      });
    }

    for (const row of list) {
      if (!row.school_slug || schoolSlugs.has(row.school_slug)) continue;
      const key = `${row.school_slug}::${row.school_name}`;
      if (unmatchedSchools.has(key)) continue;
      unmatchedSchools.add(key);
      issues.push({
        code: "arondare_school_unmatched",
        severity: "warn",
        csv_name: row.street_name,
        detail: `Școala CSV „${row.school_name || row.school_slug}” (slug ${row.school_slug}) nu e în schools.geojson. Arondăm strada oricum.`,
        hint: "Adaugă punctul școlii în public/schools.geojson sau corectează slug-ul.",
      });
    }

    const match = matchCsvNameToOsm(primary.street_name, undefined, byKey, {
      fuzzy: false,
      ...CATCHMENT_KEY,
    });
    for (const issue of match.issues) {
      const remapped = remapMatchIssue(issue, primary);
      if (remapped) issues.push(remapped);
    }
    if (!match.targets.length) {
      csvUnmatched++;
      continue;
    }

    for (const t of match.targets) {
      const p = (t.feature.properties || {}) as Record<string, unknown>;
      p.arondat = formatArondat([...parseArondat(p.arondat), ...slugs]);
      t.feature.properties = p;
    }
  }

  stats.csvUnmatched = csvUnmatched;
  stats.schoolUnmatched = unmatchedSchools.size;
  stats.osmMatched = features.filter((f) => streetSchoolSlugs((f.properties || {}) as Record<string, unknown>).length > 0).length;

  const without = osmStreets.filter((s) => {
    if (!s.key) return false;
    return streetSchoolSlugs((s.feature.properties || {}) as Record<string, unknown>).length === 0;
  });
  stats.osmWithoutSchool = without.length;
  for (const s of without.slice(0, OSM_NO_SCHOOL_SAMPLE)) {
    issues.push({
      code: "arondare_osm_no_school",
      severity: "info",
      osm_name: s.name,
      osm_id: (s.feature.properties as { osm_id?: string | number } | null)?.osm_id,
      neighborhood_slug: s.cartier || undefined,
      detail: `OSM „${s.name}” fără arondare în PDF/CSV.`,
    });
  }
  if (without.length > OSM_NO_SCHOOL_SAMPLE) {
    issues.push({
      code: "arondare_osm_no_school",
      severity: "info",
      detail: `+${without.length - OSM_NO_SCHOOL_SAMPLE} străzi OSM fără arondare (total ${without.length}).`,
    });
  }

  return { issues, stats };
}
