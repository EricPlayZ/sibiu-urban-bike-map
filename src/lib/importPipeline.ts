/** Pipeline: OSM local + măsurători (Google Sheets, fallback CSV) → props + catalog + raport. */

import {
  csvRowToMeasurement,
  csvRowsToMeasurements,
  deriveFlagsFromWidths,
  looksLikeMeasurementCsv,
  mergeNumberedCsvStreets,
  rowHasAnyWidth,
  type CsvStreetRow,
} from "./csvImport";
import {
  assignStreetToNeighborhood,
  clipLineOutsideNeighborhoods,
  clipStreetToNeighborhoods,
  geometryLineStrings,
  neighborhoodIsActive,
  shouldKeepUncut,
  type ClippedStreetPiece,
  type NeighborhoodPoly,
} from "./geoAssign";
import { MEASUREMENT_CSV_SLUGS } from "./measurementsSlugs.generated";
import { fetchGoogleSheetMeasurements } from "./sheetFetch";
import { diffAgainstGoldenCsv, serializeSheetTable, type TransformedSheetTable } from "./sheetTransform";
import { applySchoolCatchments, type CatchmentStats } from "./schoolCatchment";
import { makeStreetId, normalizeStreetName, type Measurement } from "./space";
import {
  groupByNameKey,
  matchCsvNameToOsm,
  measurementCatalogKey,
  nameKey,
  type ImportIssue,
  type OsmStreet,
} from "./streetMatch";

const EMPTY_CATCHMENT: CatchmentStats = {
  csvRows: 0,
  osmMatched: 0,
  csvUnmatched: 0,
  osmWithoutSchool: 0,
  schoolUnmatched: 0,
  multiSchool: 0,
};

export type ImportReport = {
  geometrySource: "osm-streets.geojson" | "none";
  measurementSource: "google-sheets" | "csv" | "none";
  streetCount: number;
  assignedCount: number;
  unassignedCount: number;
  csvFilesLoaded: string[];
  matchedCsvRows: number;
  catchment: CatchmentStats;
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

async function tryFetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const r = await fetch(assetUrl(url), init);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("text/html")) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function tryFetchCsv(url: string): Promise<string | null> {
  const text = await tryFetchText(url, { cache: "no-store" });
  if (text == null || !looksLikeMeasurementCsv(text)) return null;
  return text;
}

const CSV_PARITY_SAMPLE = 25;

async function pushCsvParityIssues(tables: TransformedSheetTable[], issues: ImportIssue[]) {
  const tableBySlug = new Map(tables.map((t) => [t.slug, t]));
  for (const slug of MEASUREMENT_CSV_SLUGS) {
    const gold = await tryFetchCsv(`data/measurements/${slug}.csv`);
    if (gold == null) {
      issues.push({
        code: "sheets_csv_mismatch",
        severity: "warn",
        neighborhood_slug: slug,
        detail: `Nu am putut încărca CSV-ul de referință ${slug}.csv pentru verificarea spreadsheet-ului.`,
        hint: `public/data/measurements/${slug}.csv`,
      });
      continue;
    }
    const table = tableBySlug.get(slug);
    if (!table) {
      issues.push({
        code: "sheets_csv_mismatch",
        severity: "error",
        neighborhood_slug: slug,
        detail: `CSV „${slug}” există, dar cartierul lipsește din spreadsheet-ul prelucrat.`,
        hint: "Verifică tab-ul din Google Sheets sau maparea din sheetCatalog.",
      });
      continue;
    }
    const diff = diffAgainstGoldenCsv(table, gold);
    for (const name of diff.missing.slice(0, CSV_PARITY_SAMPLE)) {
      issues.push({
        code: "sheets_csv_mismatch",
        severity: "error",
        neighborhood_slug: slug,
        csv_name: name,
        detail: `„${name}” e în CSV dar lipsește din spreadsheet-ul prelucrat (${slug}).`,
        hint: "Strada a dispărut din sheet sau e omisă / fără lățimi.",
      });
    }
    for (const name of diff.extra.slice(0, CSV_PARITY_SAMPLE)) {
      issues.push({
        code: "sheets_csv_mismatch",
        severity: "error",
        neighborhood_slug: slug,
        csv_name: name,
        detail: `„${name}” e în spreadsheet-ul prelucrat dar lipsește din CSV (${slug}).`,
        hint: "Actualizează CSV-ul de referință sau adaugă un omit/rename în meniul de măsurători.",
      });
    }
    for (const v of diff.values.slice(0, CSV_PARITY_SAMPLE)) {
      issues.push({
        code: "sheets_csv_mismatch",
        severity: "error",
        neighborhood_slug: slug,
        csv_name: v.name,
        detail: `„${v.name}” · ${v.field}: spreadsheet ${v.got || "∅"} ≠ CSV ${v.gold || "∅"} (${slug}).`,
        hint: "CSV-ul de referință și rezultatul final trebuie să coincidă exact.",
      });
    }
    const overflow =
      Math.max(0, diff.missing.length - CSV_PARITY_SAMPLE) +
      Math.max(0, diff.extra.length - CSV_PARITY_SAMPLE) +
      Math.max(0, diff.values.length - CSV_PARITY_SAMPLE);
    if (overflow > 0) {
      issues.push({
        code: "sheets_csv_mismatch",
        severity: "error",
        neighborhood_slug: slug,
        detail: `+${overflow} diferențe CSV ↔ spreadsheet în ${slug} (total ${diff.missing.length + diff.extra.length + diff.values.length}).`,
      });
    }
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
      const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string; dissolve?: unknown };
      const slug = String(p.slug || "").trim();
      if (!neighborhoodIsActive(p)) return null;
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
      measurementSource: "none",
      streetCount: 0,
      assignedCount: 0,
      unassignedCount: 0,
      csvFilesLoaded: [],
      matchedCsvRows: 0,
      catchment: { ...EMPTY_CATCHMENT },
      issues,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Geometrie: doar `public/osm-streets.geojson` (generat offline cu `npm run fetch-osm`).
 * Măsurători: Google Sheets (prelucrat) cu fallback la CSV din `public/data/measurements/`.
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
  let featIndex = 0;

  const pushAssigned = (
    geom: GeoJSON.Geometry,
    baseProps: Record<string, unknown>,
    n: { slug: string; name: string },
    method: string
  ) => {
    const copy: GeoJSON.Feature = {
      type: "Feature",
      properties: { ...baseProps },
      geometry: geom,
    };
    const p = copy.properties as Record<string, unknown>;
    p.cartier = n.slug;
    p.cartier_name = n.name;
    p.cartier_assign = method;
    p.sid = makeStreetId(copy, featIndex++);
    features.push(copy);
  };

  const pushUnassigned = (geom: GeoJSON.Geometry, baseProps: Record<string, unknown>) => {
    const copy: GeoJSON.Feature = {
      type: "Feature",
      properties: { ...baseProps },
      geometry: geom,
    };
    const p = copy.properties as Record<string, unknown>;
    p.cartier = "";
    p.sid = makeStreetId(copy, featIndex++);
    features.push(copy);
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
  };

  /** Cartiere care deja au geometrie în poligon (clip / coverage / midpoint) pentru un nume OSM. */
  const inPolygonKeys = new Set<string>();
  const markInPolygon = (slug: string, nameKey: string) => {
    if (nameKey) inPolygonKeys.add(`${slug}::${nameKey}`);
  };

  type PreparedStreet = {
    baseProps: Record<string, unknown>;
    geometry: GeoJSON.Geometry | null | undefined;
    pieces: ClippedStreetPiece[];
    nameKey: string;
  };

  const prepared: PreparedStreet[] = [];
  for (const f of raw.features) {
    const baseProps: Record<string, unknown> = { ...(f.properties || {}) };
    clearLegacyFlags(baseProps);
    delete baseProps.arondat;
    const nameKey = normalizeStreetName(String(baseProps.name || ""));
    const pieces = clipStreetToNeighborhoods(f.geometry, polys);
    if (pieces.length) {
      for (const piece of pieces) markInPolygon(piece.neighborhood.slug, nameKey);
    } else {
      const probe: GeoJSON.Feature = { type: "Feature", properties: baseProps, geometry: f.geometry };
      const inside = assignStreetToNeighborhood(probe, polys, { allowBbox: false });
      if (inside) markInPolygon(inside.slug, nameKey);
    }
    prepared.push({ baseProps, geometry: f.geometry, pieces, nameKey });
  }

  const fallbackAssign = (
    geom: GeoJSON.Geometry,
    baseProps: Record<string, unknown>,
    streetNameKey: string
  ) => {
    const probe: GeoJSON.Feature = { type: "Feature", properties: baseProps, geometry: geom };
    const hit = assignStreetToNeighborhood(probe, polys);
    if (!hit) return null;
    if (hit.method !== "bbox" || !streetNameKey || !inPolygonKeys.has(`${hit.slug}::${streetNameKey}`)) return hit;
    const allowed = polys.filter((p) => !inPolygonKeys.has(`${p.slug}::${streetNameKey}`));
    return assignStreetToNeighborhood(probe, allowed);
  };

  const csvMeasurements: Record<string, Measurement> = {};
  const csvFilesLoaded: string[] = [];
  const loadedCsvs: { slug: string; rows: CsvStreetRow[] }[] = [];
  const csvNameKeysBySlug = new Map<string, Set<string>>();
  let measurementSource: ImportReport["measurementSource"] = "none";

  const ingestText = (slug: string, text: string, label: string) => {
    if (!polyBySlug.has(slug)) {
      issues.push({
        code: "csv_parse_columns",
        severity: "warn",
        neighborhood_slug: slug,
        detail: `${label} „${slug}” nu e în neighborhood_limits.geojson — potrivirea OSM pe cartier poate eșua.`,
        hint: "Adaugă poligonul cartierului sau mapează tab-ul la slug-ul corect.",
      });
    }

    csvFilesLoaded.push(slug);
    const { rows: rawRows, missingColumns } = csvRowsToMeasurements(text);
    if (missingColumns.length) {
      issues.push({
        code: "csv_parse_columns",
        severity: "warn",
        neighborhood_slug: slug,
        detail: `${label} ${slug}: coloane lipsă: ${missingColumns.join(", ")}.`,
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
          detail: `„${row.name}”: medie din ${row._mergedFrom} rânduri (sufixe 1/2/…) → aplicată pe toate segmentele OSM cu acest nume.`,
        });
      }
    }

    const keys = new Set<string>();
    for (const row of rows) {
      if (rowHasAnyWidth(row)) keys.add(nameKey(row.name));
    }
    csvNameKeysBySlug.set(slug, keys);
    loadedCsvs.push({ slug, rows });
  };

  try {
    const sheets = await fetchGoogleSheetMeasurements();
    for (const fail of sheets.failedTabs) {
      issues.push({
        code: "sheets_source",
        severity: "warn",
        detail: `Tab Google Sheets „${fail.tab}”: ${fail.detail}`,
        hint: "Verifică că spreadsheet-ul e public (Anyone with the link).",
      });
    }
    for (const drift of sheets.drift) {
      issues.push({
        code: drift.kind === "orphan" ? "sheets_fix_orphan" : "sheets_fix_stale",
        severity: "warn",
        neighborhood_slug: drift.slug,
        csv_name: drift.displayName || drift.sheetName,
        detail: drift.detail,
        hint:
          drift.kind === "orphan"
            ? "Strada a dispărut din spreadsheet; corecția din street-fixes.json a rămas. Deschide meniul de măsurători."
            : "Spreadsheet-ul s-a schimbat peste o corecție deja salvată. Verifică și re-salvează din meniul de măsurători.",
      });
    }
    if (sheets.tables.length) {
      measurementSource = "google-sheets";
      for (const table of sheets.tables) {
        ingestText(table.slug, serializeSheetTable(table), "Sheets");
      }
      await pushCsvParityIssues(sheets.tables, issues);
    }
  } catch (err) {
    issues.push({
      code: "sheets_source",
      severity: "warn",
      detail: `Google Sheets indisponibil (${err instanceof Error ? err.message : String(err)}). Folosim CSV-urile locale.`,
      hint: "https://docs.google.com/spreadsheets/d/1Xi_cYqgpAp45mNvv6YeNCdBSRnmpwKUE3VoyfN-cLT8",
    });
  }

  if (!loadedCsvs.length) {
    const csvSlugs = await resolveCsvSlugs(polys.map((p) => p.slug));
    if (!csvSlugs.length) {
      issues.push({
        code: "geometry_source",
        severity: "warn",
        detail: `Nicio măsurătoare din Google Sheets și niciun CSV în lista generată.`,
        hint: "Adaugă public/data/measurements/{slug}.csv sau deschide spreadsheet-ul public.",
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
      ingestText(slug, text, "CSV");
    }
    if (loadedCsvs.length) measurementSource = "csv";
  }

  const dataSlugsFor = (streetNameKey: string) => {
    const slugs = new Set<string>();
    if (!streetNameKey) return slugs;
    for (const [slug, keys] of csvNameKeysBySlug) {
      if (keys.has(streetNameKey)) slugs.add(slug);
    }
    return slugs;
  };

  for (const row of prepared) {
    if (row.pieces.length) {
      const nhoods = [...new Set(row.pieces.map((p) => p.neighborhood.slug))];
      const outside: GeoJSON.Position[][] = [];
      for (const line of geometryLineStrings(row.geometry)) {
        outside.push(...clipLineOutsideNeighborhoods(line, polys));
      }

      const owner = shouldKeepUncut(row.geometry, row.pieces, outside.length > 0, dataSlugsFor(row.nameKey));

      if (owner && row.geometry) {
        pushAssigned(row.geometry, row.baseProps, owner, "uncut");
        continue;
      }

      if (nhoods.length > 1) {
        const osmName = String(row.baseProps.name || "");
        const osmId = (row.baseProps.osm_id as string | number | undefined) || undefined;
        for (const slug of nhoods) {
          issues.push({
            code: "osm_clipped_neighborhood",
            severity: "info",
            neighborhood_slug: slug,
            osm_name: osmName || undefined,
            osm_id: osmId,
            detail: `OSM „${osmName || osmId || "?"}” tăiat pe limita dintre cartiere; porțiuni în ${nhoods.join(", ")} (${row.pieces.length} segmente).`,
          });
        }
      }
      for (const piece of row.pieces) {
        pushAssigned(
          { type: "LineString", coordinates: piece.coordinates },
          row.baseProps,
          piece.neighborhood,
          "clip"
        );
      }
      for (const coordinates of outside) {
        // Restul e în afara poligoanelor (mijloc de subsegment). Nu-l reasignăm:
        // un vârf de pe contur ar da coverage > 0 și ar păstra props-urile cartierului.
        pushUnassigned({ type: "LineString", coordinates }, row.baseProps);
      }
      continue;
    }

    if (!row.geometry) continue;
    const hit = fallbackAssign(row.geometry, row.baseProps, row.nameKey);
    if (hit) pushAssigned(row.geometry, row.baseProps, hit, hit.method);
    else pushUnassigned(row.geometry, row.baseProps);
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

  let matchedCsvRows = 0;
  const matchedSids = new Set<string>();

  for (const { slug, rows } of loadedCsvs) {
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

  const schoolFc = await tryFetchJson("schools.geojson");
  const schoolSlugs = new Set(
    (schoolFc?.features || [])
      .map((f) => String((f.properties as { slug?: string } | null)?.slug || "").trim())
      .filter(Boolean)
  );
  const catchmentText = await tryFetchText("data/school-catchments.csv");
  const catchment = applySchoolCatchments(features, catchmentText, schoolSlugs);
  issues.push(...catchment.issues);

  return {
    streets: { type: "FeatureCollection", features },
    csvMeasurements,
    report: {
      geometrySource: "osm-streets.geojson",
      measurementSource,
      streetCount: features.length,
      assignedCount,
      unassignedCount,
      csvFilesLoaded,
      matchedCsvRows,
      catchment: catchment.stats,
      issues,
      generatedAt: new Date().toISOString(),
    },
  };
}
