/** Editări locale per segment (`sid`), aplicate după pipeline-ul CSV/OSM. */

import { deriveFlagsFromWidths, type CsvStreetRow } from "./csvImport";
import { FORM_FIELDS, hasMeaningfulLocalEdit, type Measurement } from "./space";

export const LOCAL_EDITS_REL = "data/local-edits.json";

export type LocalEditsFile = {
  version: 1;
  updated_at?: string;
  edits: Record<string, Measurement>;
};

function assetUrl(rel: string) {
  const base = import.meta.env.BASE_URL || "./";
  const b = base.endsWith("/") ? base : `${base}/`;
  const r = rel.replace(/^\.\//, "").replace(/^\//, "");
  return `${b}${r}`;
}

function numOrUndef(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function widthRowFromMeasurement(m: Measurement): CsvStreetRow {
  return {
    name: String(m.name || ""),
    row_width_m: numOrUndef(m.row_width_m),
    carriageway_m: numOrUndef(m.carriageway_m),
    sidewalk1_m: numOrUndef(m.sidewalk1_m),
    sidewalk2_m: numOrUndef(m.sidewalk2_m),
    parking1_m: numOrUndef(m.parking1_m),
    parking2_m: numOrUndef(m.parking2_m),
    free_sidewalk1_m: numOrUndef(m.free_sidewalk1_m),
    free_sidewalk2_m: numOrUndef(m.free_sidewalk2_m),
    bike1_m: numOrUndef(m.bike1_m),
    bike2_m: numOrUndef(m.bike2_m),
    green1_m: numOrUndef(m.green1_m),
    green2_m: numOrUndef(m.green2_m),
  };
}

function normalizeEdit(sid: string, value: unknown): Measurement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Measurement;
  return { ...m, street_id: sid, source: m.source || "local" };
}

/** Acceptă `{ version, edits }` sau o mapă goală `sid → Measurement`. */
export function parseLocalEditsFile(data: unknown): Record<string, Measurement> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const root = data as Record<string, unknown>;
  const raw =
    root.edits && typeof root.edits === "object" && !Array.isArray(root.edits)
      ? (root.edits as Record<string, unknown>)
      : root;
  const out: Record<string, Measurement> = {};
  for (const [sid, value] of Object.entries(raw)) {
    if (sid === "version" || sid === "updated_at" || sid === "edits") continue;
    const m = normalizeEdit(sid, value);
    if (!m || !hasMeaningfulLocalEdit(m)) continue;
    out[sid] = m;
  }
  return out;
}

export function measurementForCommit(sid: string, m: Measurement): Measurement {
  const out: Measurement = { street_id: sid, source: "local" };
  if (m.name) out.name = m.name;
  if (m.neighborhood_slug) out.neighborhood_slug = m.neighborhood_slug;
  for (const f of FORM_FIELDS) {
    const n = numOrUndef(m[f.key]);
    if (n == null) continue;
    (out as Record<string, unknown>)[f.key] = n;
  }
  if (m.illgl_park === true) out.illgl_park = true;
  if (m.updated_at) out.updated_at = m.updated_at;
  return out;
}

export function buildLocalEditsFile(edits: Record<string, Measurement>): LocalEditsFile {
  const cleaned: Record<string, Measurement> = {};
  for (const [sid, m] of Object.entries(edits)) {
    if (!hasMeaningfulLocalEdit(m)) continue;
    cleaned[sid] = measurementForCommit(sid, m);
  }
  return { version: 1, updated_at: new Date().toISOString(), edits: cleaned };
}

export function serializeLocalEditsFile(edits: Record<string, Measurement>): string {
  return JSON.stringify(buildLocalEditsFile(edits), null, 2) + "\n";
}

/**
 * Fișierul din repo e baza; draft-urile din browser câștigă pe același `sid`.
 * `removedSids` scoate o editare comisă din setul de lucru (până la noul JSON).
 */
export function mergeWorkingEdits(
  committed: Record<string, Measurement>,
  drafts: Record<string, Measurement>,
  removedSids: Iterable<string> = []
): Record<string, Measurement> {
  const removed = new Set(removedSids);
  const out: Record<string, Measurement> = {};
  for (const [sid, m] of Object.entries(committed)) {
    if (removed.has(sid) || !hasMeaningfulLocalEdit(m)) continue;
    out[sid] = { ...m, street_id: sid, source: m.source || "local" };
  }
  for (const [sid, m] of Object.entries(drafts)) {
    if (removed.has(sid) || !hasMeaningfulLocalEdit(m)) continue;
    out[sid] = { ...m, street_id: sid, source: m.source || "local" };
  }
  return out;
}

/** Suprascrie lățimile și flag-urile CSV pe un singur feature. Nu mută originalul. */
export function applyLocalEditToFeature(feature: GeoJSON.Feature, m: Measurement): GeoJSON.Feature {
  const p = { ...(feature.properties || {}) } as Record<string, unknown>;
  for (const f of FORM_FIELDS) {
    if (f.key === "length_m") {
      const n = numOrUndef(m.length_m);
      if (n != null && n > 0) p.length_m = n;
      continue;
    }
    const n = numOrUndef(m[f.key]);
    if (n == null) delete p[f.key];
    else p[f.key] = n;
  }

  const flags = deriveFlagsFromWidths(widthRowFromMeasurement(m));
  p.bike_lane = flags.bike_lane ? 1 : 0;
  p.rsrvd_park = flags.rsrvd_park ? 1 : 0;
  p.bike_door = flags.bike_door ? 1 : 0;
  p.has_green = flags.has_green ? 1 : 0;
  p.illgl_park = m.illgl_park === true ? 1 : 0;
  p.local_edit = 1;
  return { ...feature, properties: p };
}

/**
 * Aplică editările pe `sid` după CSV. Segmentele fără editare rămân neschimbate
 * (aceeași referință de feature).
 */
export function applyLocalEditsToCollection(
  streets: GeoJSON.FeatureCollection,
  edits: Record<string, Measurement>
): GeoJSON.FeatureCollection {
  const active = new Set(
    Object.entries(edits)
      .filter(([, m]) => hasMeaningfulLocalEdit(m))
      .map(([sid]) => sid)
  );
  if (!active.size) return streets;
  return {
    type: "FeatureCollection",
    features: streets.features.map((f) => {
      const sid = String((f.properties as { sid?: string } | null)?.sid || "");
      if (!sid || !active.has(sid)) return f;
      return applyLocalEditToFeature(f, edits[sid]);
    }),
  };
}

export async function fetchCommittedLocalEdits(): Promise<Record<string, Measurement>> {
  try {
    const r = await fetch(assetUrl(LOCAL_EDITS_REL));
    if (!r.ok) return {};
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("text/html")) return {};
    return parseLocalEditsFile(await r.json());
  } catch {
    return {};
  }
}
