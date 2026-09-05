import { FORM_FIELDS, type Measurement } from "./space";
import { normalizeBuildingType } from "./buildingTypes";

const KEY_M = "ubr_v2_measurements";
const KEY_N = "ubr_v2_neighborhoods";
const KEY_B = "ubr_v2_buildings";
const KEY_REMOVED = "ubr_v2_removed_sids";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadMeasurements(): Record<string, Measurement> {
  return read(KEY_M, {});
}
export function saveMeasurement(id: string, data: Measurement) {
  const all = loadMeasurements();
  all[id] = { ...data, street_id: id, source: "local", updated_at: new Date().toISOString() };
  write(KEY_M, all);
  return all[id];
}

export function deleteMeasurement(id: string) {
  const all = loadMeasurements();
  delete all[id];
  write(KEY_M, all);
  return all;
}

export function purgeAllMeasurements() {
  write(KEY_M, {});
}

export function loadRemovedSids(): string[] {
  const ids = read<unknown>(KEY_REMOVED, []);
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

export function saveRemovedSids(ids: string[]) {
  write(KEY_REMOVED, [...new Set(ids)]);
}

export function markRemovedSid(id: string) {
  saveRemovedSids([...loadRemovedSids(), id]);
}

export function unmarkRemovedSid(id: string) {
  saveRemovedSids(loadRemovedSids().filter((x) => x !== id));
}

export function loadCustomNeighborhoods(): GeoJSON.FeatureCollection {
  return read(KEY_N, { type: "FeatureCollection", features: [] });
}
export function saveCustomNeighborhoods(fc: GeoJSON.FeatureCollection) {
  write(KEY_N, fc);
}

export function loadBuildingTypes(): Record<string, { type: string }> {
  const raw = read<Record<string, { type?: unknown }>>(KEY_B, {});
  const out: Record<string, { type: string }> = {};
  for (const [id, value] of Object.entries(raw)) {
    const type = normalizeBuildingType(value?.type);
    if (type) out[id] = { type };
  }
  return out;
}
export function saveBuildingType(id: string, type: string) {
  const all = loadBuildingTypes();
  all[id] = { type };
  write(KEY_B, all);
  return all;
}

export function exportAll() {
  return {
    exported_at: new Date().toISOString(),
    measurements: loadMeasurements(),
    neighborhoods: loadCustomNeighborhoods(),
    buildings: loadBuildingTypes(),
  };
}

/** Șterge din localStorage măsurătorile venite din Excel seed. */
export function purgeExcelSeedMeasurements() {
  const all = loadMeasurements();
  let removed = 0;
  const next: Record<string, Measurement> = {};
  for (const [id, m] of Object.entries(all)) {
    if (m.source === "excel_seed") {
      removed++;
      continue;
    }
    next[id] = m;
  }
  if (removed) write(KEY_M, next);
  return removed;
}

/**
 * Curăță resturi vechi: flag-uri ilegale / seed fără lățimi reale.
 * Păstrează doar măsurători cu valori numerice de lățime (sau source local + lățimi).
 */
export function purgeEmptyOrFlagOnlyMeasurements() {
  const all = loadMeasurements();
  let removed = 0;
  const next: Record<string, Measurement> = {};
  for (const [id, m] of Object.entries(all)) {
    if (m.source === "excel_seed") {
      removed++;
      continue;
    }
    if (m.source === "local") {
      next[id] = m;
      continue;
    }
    const hasWidths = FORM_FIELDS.some((f) => {
      const v = Number(m[f.key as keyof Measurement]);
      return Number.isFinite(v) && v > 0;
    });
    if (!hasWidths) {
      removed++;
      continue;
    }
    next[id] = { ...m, source: "local" };
  }
  if (removed) write(KEY_M, next);
  return removed;
}

export function migrateV1(_streets: GeoJSON.FeatureCollection) {
  // Dezactivat: importa resturi vechi care apăreau ca „editate local”.
  // Datele oficiale vin din OSM + CSV; măsurătorile noi au source: "local".
}
