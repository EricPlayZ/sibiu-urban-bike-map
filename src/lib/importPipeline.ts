/** Pipeline: OSM local + CSV pe cartier → props + catalog + raport. Fără fallback streets.geojson. */

import {
  csvRowToMeasurement,
  csvRowsToMeasurements,
  deriveFlagsFromWidths,
  looksLikeMeasurementCsv,
  mergeNumberedCsvStreets,
  rowHasAnyWidth,
  type CsvStreetRow,
} from "./csvImport";
import { assignStreetToNeighborhood, type NeighborhoodPoly } from "./geoAssign";
import { MEASUREMENT_CSV_SLUGS } from "./measurementsSlugs.generated";
import { makeStreetId, normalizeStreetName, type Measurement } from "./space";
import {
  groupByNameKey,
  matchCsvNameToOsm,
  measurementCatalogKey,
  type ImportIssue,
  type OsmStreet,
} from "./streetMatch";

export type ImportReport = {
  geometrySource: "osm-streets.geojson" | "none";
  streetCount: number;
  assignedCount: number;
  unassignedCount: number;
  csvFilesLoaded: string[];
  matchedCsvRows: number;
  issues: ImportIssue[];
  generatedAt: string;
};

export type ImportResult = {
  streets: GeoJSON.FeatureCollection;
  csvMeasurements: Record<string, Measurement>;
  report: ImportReport;
};

function assetUrl(rel: string) {
  const base = import.meta.env.BASE_URL || "./";
  const b = base.endsWith("/") ? base : `${base}/`;
  const r = rel.replace(/^\.\//, "").replace(/^\//, "");
  return `${b}${r}`;
}

async function tryFetchJson(url: string): Promise<GeoJSON.FeatureCollection | null> {
  try {
    const r = await fetch(assetUrl(url));
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("text/html")) return null;
    return (await r.json()) as GeoJSON.FeatureCollection;
  } catch {
    return null;
  }
}

async function tryFetchCsv(url: string): Promise<string | null> {
  try {
    const r = await fetch(assetUrl(url));
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("text/html")) return null;
    const text = await r.text();
    if (!looksLikeMeasurementCsv(text)) return null;
    return text;
  } catch {
    return null;
  }
}

/** Slug-uri CSV: din modulul generat la build + verificare că fișierul e chiar CSV. */
/** Slug-uri CSV din modulul generat la build (fără fetch pe manifest.json). */
async function resolveCsvSlugs(neighborhoodSlugs: string[]): Promise<string[]> {
  if (MEASUREMENT_CSV_SLUGS.length > 0) return [...MEASUREMENT_CSV_SLUGS];
  const found: string[] = [];
  for (const slug of neighborhoodSlugs) {
    const text = await tryFetchCsv(`data/measurements/${slug}.csv`);
    if (text != null) found.push(slug);
  }
  return found;
}

function neighborhoodPolys(limits: GeoJSON.FeatureCollection): NeighborhoodPoly[] {
  return (limits.features || [])
    .map((f) => {
      const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string };
      const slug = String(p.slug || "").trim();
      if (!slug || !f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) {
        return null;
      }
      return {
        slug,
        name: String(p.denumire || p.name || slug),
        geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      };
    })
    .filter(Boolean) as NeighborhoodPoly[];
}

function clearLegacyFlags(p: Record<string, unknown>) {
  delete p.bike_lane;
  delete p.rsrvd_park;
  delete p.illgl_park;
  delete p.bike_door;
}

function applyRowToFeature(f: GeoJSON.Feature, row: CsvStreetRow, neighborhoodSlug: string) {
  const p = (f.properties || {}) as Record<string, unknown>;
  const flags = deriveFlagsFromWidths(row);
  p.bike_lane = flags.bike_lane ? 1 : 0;
  p.rsrvd_park = flags.rsrvd_park ? 1 : 0;
  p.illgl_park = flags.illgl_park ? 1 : 0;
  p.bike_door = flags.bike_door ? 1 : 0;
  p.has_green = flags.has_green ? 1 : 0;
  p.csv_name = row.name;
  p.measurement_key = measurementCatalogKey(neighborhoodSlug, row.name);
  if (row._mergedFrom && row._mergedFrom > 1) p.csv_merged_from = row._mergedFrom;
  const m = csvRowToMeasurement(row, neighborhoodSlug);
  for (const [k, v] of Object.entries(m)) {
    if (v != null && k !== "source" && k !== "name") p[k] = v;
  }
  f.properties = p;
}

function emptyReport(issues: ImportIssue[], geometrySource: ImportReport["geometrySource"] = "none"): ImportResult {
  return {
    streets: { type: "FeatureCollection", features: [] },
    csvMeasurements: {},
    report: {
      geometrySource,
      streetCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      csvFilesLoaded: [],
      matchedCsvRows: 0,
      issues,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Geometrie: doar `public/osm-streets.geojson` (generat offline cu `npm run fetch-osm`).
 * Măsurători: CSV din `public/data/measurements/` (lista e în `measurementsSlugs.generated.ts` la build/dev).
 */
export async function runImportPipeline(limits: GeoJSON.FeatureCollection): Promise<ImportResult> {
  const issues: ImportIssue[] = [];
  const polys = neighborhoodPolys(limits);
  const polyBySlug = new Map(polys.map((p) => [p.slug, p]));

  const raw = await tryFetchJson("osm-streets.geojson");
  if (!raw?.features?.length) {
    issues.push({
      code: "geometry_source",
      severity: "error",
      detail: "Lipsește public/osm-streets.geojson. Harta nu folosește fallback la streets.geojson.",
      hint: "Rulează o singură dată (offline după download): npm run fetch-osm — apoi comite fișierul pe GitHub.",
    });
    return emptyReport(issues, "none");
  }

  const features: GeoJSON.Feature[] = [];
  let unassignedSamples = 0;
  const UNASSIGNED_SAMPLE_LIMIT = 25;

  for (let i = 0; i < raw.features.length; i++) {
    const f = raw.features[i];
    const copy: GeoJSON.Feature = {
      type: "Feature",
      properties: { ...(f.properties || {}) },
      geometry: f.geometry,
    };
    const p = copy.properties as Record<string, unknown>;
    clearLegacyFlags(p);
    p.sid = makeStreetId(copy, i);
    const hit = assignStreetToNeighborhood(copy, polys);
    if (hit) {
      p.cartier = hit.slug;
      p.cartier_name = hit.name;
      p.cartier_assign = hit.method;
    } else {
      p.cartier = "";
      if (unassignedSamples < UNASSIGNED_SAMPLE_LIMIT) {
        unassignedSamples++;
        issues.push({
          code: "osm_unassigned_neighborhood",
          severity: "warn",
          osm_name: String(p.name || ""),
          osm_id: (p.osm_id as string | number) || undefined,
          detail: `„${p.name || p.sid}” în afara poligoanelor din neighborhood_limits.geojson.`,
          hint: "Extinde limitele de cartier.",
        });
      }
    }
    features.push(copy);
  }

  const assignedCount = features.filter((f) => String((f.properties as { cartier?: string })?.cartier || "")).length;
  const unassignedCount = features.length - assignedCount;
  if (unassignedCount > UNASSIGNED_SAMPLE_LIMIT) {
    issues.push({
      code: "osm_unassigned_neighborhood",
      severity: "warn",
      detail: `+${unassignedCount - UNASSIGNED_SAMPLE_LIMIT} străzi neatribuite (total ${unassignedCount}).`,
      hint: "Poligoanele de cartier acoperă doar o parte din oraș.",
    });
  }

  const osmByCartier = new Map<string, OsmStreet[]>();
  for (const f of features) {
    const p = (f.properties || {}) as Record<string, unknown>;
    const cartier = String(p.cartier || "");
    if (!cartier) continue;
    const list = osmByCartier.get(cartier) || [];
    list.push({
      feature: f,
      sid: String(p.sid || ""),
      name: String(p.name || ""),
      key: normalizeStreetName(String(p.name || "")),
      cartier,
    });
    osmByCartier.set(cartier, list);
  }

  const csvMeasurements: Record<string, Measurement> = {};
  const csvFilesLoaded: string[] = [];
  let matchedCsvRows = 0;
  const matchedSids = new Set<string>();

  const csvSlugs = await resolveCsvSlugs(polys.map((p) => p.slug));
  if (!csvSlugs.length) {
    issues.push({
      code: "geometry_source",
      severity: "warn",
      detail: `Niciun CSV în lista generată (MEASUREMENT_CSV_SLUGS gol).`,
      hint: "Adaugă public/data/measurements/{slug}.csv și repornește `npm run dev` (Vite scrie measurementsSlugs.generated.ts).",
    });
  }

  for (const slug of csvSlugs) {
    const text = await tryFetchCsv(`data/measurements/${slug}.csv`);
    if (text == null) {
      issues.push({
        code: "csv_parse_columns",
        severity: "error",
        neighborhood_slug: slug,
        detail: `CSV „${slug}” e listat dar nu s-a putut încărca / nu arată a CSV.`,
        hint: `Verifică public/data/measurements/${slug}.csv`,
      });
      continue;
    }

    if (!polyBySlug.has(slug)) {
      issues.push({
        code: "csv_parse_columns",
        severity: "warn",
        neighborhood_slug: slug,
        detail: `CSV ${slug}.csv există, dar slug-ul nu e în neighborhood_limits.geojson — potrivirea OSM pe cartier poate eșua.`,
        hint: "Adaugă poligonul cartierului sau redenumește CSV-ul.",
      });
    }

    csvFilesLoaded.push(slug);
    const { rows: rawRows, missingColumns } = csvRowsToMeasurements(text);
    if (missingColumns.length) {
      issues.push({
        code: "csv_parse_columns",
        severity: "warn",
        neighborhood_slug: slug,
        detail: `CSV ${slug}.csv: coloane lipsă: ${missingColumns.join(", ")}.`,
      });
    }

    const rows = mergeNumberedCsvStreets(rawRows);
    for (const row of rows) {
      if (row._mergedFrom && row._mergedFrom > 1) {
        issues.push({
          code: "csv_merged_segments",
          severity: "info",
          neighborhood_slug: slug,
          csv_name: row.name,
          detail: `„${row.name}”: medie din ${row._mergedFrom} rânduri CSV (sufixe 1/2/…) → aplicată pe toate segmentele OSM cu acest nume.`,
        });
      }
    }

    const inCartier = osmByCartier.get(slug) || [];
    const byKey = groupByNameKey(inCartier);

    for (const row of rows) {
      if (!rowHasAnyWidth(row)) {
        issues.push({
          code: "csv_empty_widths",
          severity: "info",
          neighborhood_slug: slug,
          csv_name: row.name,
          detail: `CSV „${row.name}” în ${slug}: toate lățimile sunt goale/0.`,
        });
        continue;
      }

      const match = matchCsvNameToOsm(row.name, slug, byKey);
      issues.push(...match.issues);
      if (!match.targets.length) continue;

      matchedCsvRows++;
      csvMeasurements[measurementCatalogKey(slug, row.name)] = csvRowToMeasurement(row, slug);

      for (const t of match.targets) {
        applyRowToFeature(t.feature, row, slug);
        matchedSids.add(t.sid);
      }
    }

    const unmatchedOsm = inCartier.filter((s) => !matchedSids.has(s.sid));
    const OSM_SAMPLE = 30;
    for (const s of unmatchedOsm.slice(0, OSM_SAMPLE)) {
      issues.push({
        code: "osm_no_csv_in_neighborhood",
        severity: "info",
        neighborhood_slug: slug,
        osm_name: s.name,
        osm_id: (s.feature.properties as { osm_id?: number })?.osm_id,
        detail: `OSM „${s.name}” în ${slug} fără rând CSV.`,
      });
    }
    if (unmatchedOsm.length > OSM_SAMPLE) {
      issues.push({
        code: "osm_no_csv_in_neighborhood",
        severity: "info",
        neighborhood_slug: slug,
        detail: `+${unmatchedOsm.length - OSM_SAMPLE} străzi OSM în ${slug} fără CSV (total ${unmatchedOsm.length}).`,
      });
    }
  }

  return {
    streets: { type: "FeatureCollection", features },
    csvMeasurements,
    report: {
      geometrySource: "osm-streets.geojson",
      streetCount: features.length,
      assignedCount,
      unassignedCount,
      csvFilesLoaded,
      matchedCsvRows,
      issues,
      generatedAt: new Date().toISOString(),
    },
  };
}
