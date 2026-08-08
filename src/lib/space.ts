/** Tipuri + utilitare spațiu public */
export type Measurement = {
  street_id?: string;
  name?: string;
  neighborhood_slug?: string | null;
  length_m?: number;
  row_width_m?: number;
  carriageway_m?: number;
  sidewalk1_m?: number;
  sidewalk2_m?: number;
  parking1_m?: number;
  parking2_m?: number;
  bike1_m?: number;
  bike2_m?: number;
  green1_m?: number;
  green2_m?: number;
  free_sidewalk1_m?: number;
  free_sidewalk2_m?: number;
  /** Lungime parcări pe trotuar (m) din Excel — păstrat în model, nu folosit încă pt. ilegal. */
  park_len_m?: number;
  illgl_park?: boolean;
  source?: string;
  updated_at?: string;
};

export type SpaceShares = {
  total_m: number;
  carriageway: number;
  sidewalk: number;
  parking: number;
  bike: number;
  green: number;
  equity: number;
};

export type ViewMode = "space" | "buildings" | "schools";
export type BasemapId = "light" | "dark" | "satellite";

/** Culori din harta originală (QGIS / repo EricPlayZ). */
export const LAYER_COLORS = {
  base: "#666666",
  bike: "#00FF88",
  reserved: "#F50057",
  illegal: "#FFD600",
  schoolAssign: "#ff9100",
  edited: "#2f6fed",
} as const;

export function geoFlag(props: Record<string, unknown> | null | undefined, key: string) {
  if (!props) return false;
  const v = props[key];
  return v === true || v === 1 || v === "true" || v === "1";
}

export function featureHasIllegalParking(props: Record<string, unknown> | null | undefined) {
  return geoFlag(props, "illgl_park");
}

export function featureHasBikeLane(props: Record<string, unknown> | null | undefined) {
  return geoFlag(props, "bike_lane");
}

export function featureHasReservedParking(props: Record<string, unknown> | null | undefined) {
  return geoFlag(props, "rsrvd_park");
}

export const FORM_FIELDS: { key: keyof Measurement; label: string }[] = [
  { key: "length_m", label: "Lungime (m)" },
  { key: "row_width_m", label: "Tramă stradală (m)" },
  { key: "carriageway_m", label: "Carosabil (m)" },
  { key: "sidewalk1_m", label: "Trotuar 1 (m)" },
  { key: "sidewalk2_m", label: "Trotuar 2 (m)" },
  { key: "parking1_m", label: "Parcare 1 (m)" },
  { key: "parking2_m", label: "Parcare 2 (m)" },
  { key: "bike1_m", label: "Pistă 1 (m)" },
  { key: "bike2_m", label: "Pistă 2 (m)" },
  { key: "green1_m", label: "Verde 1 (m)" },
  { key: "green2_m", label: "Verde 2 (m)" },
  { key: "free_sidewalk1_m", label: "Liber trotuar 1 (m)" },
  { key: "free_sidewalk2_m", label: "Liber trotuar 2 (m)" },
];

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

export function hasAnyEdit(m?: Measurement | null) {
  return hasMeaningfulLocalEdit(m);
}

/**
 * Măsurători reale pe dispozitiv (lățimi / salvare din editor).
 * Nu numărăm resturi Excel / flag-uri fără salvare locală — datele vin din streets.geojson.
 */
export function hasMeaningfulLocalEdit(m?: Measurement | null) {
  if (!m) return false;
  if (m.source === "local") {
    if (m.illgl_park === true) return true;
    return FORM_FIELDS.some((f) => {
      const v = m[f.key];
      if (v == null || v === ("" as never)) return false;
      const n = Number(v);
      return Number.isFinite(n) && n > 0;
    });
  }
  return FORM_FIELDS.some((f) => {
    const v = m[f.key];
    if (v == null || v === ("" as never)) return false;
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  });
}

/** Flag manual din editor (nu Excel). */
export function hasIllegalParking(m?: Measurement | null) {
  return m?.illgl_park === true;
}

export function spaceShares(m?: Measurement | null): SpaceShares | null {
  if (!m) return null;
  const carriage = n(m.carriageway_m);
  const sw = n(m.sidewalk1_m) + n(m.sidewalk2_m);
  const park = n(m.parking1_m) + n(m.parking2_m);
  const bike = n(m.bike1_m) + n(m.bike2_m);
  const green = n(m.green1_m) + n(m.green2_m);
  let total = carriage + sw + park + bike + green;
  if (!total && n(m.row_width_m)) {
    const row = n(m.row_width_m);
    return {
      total_m: row,
      carriageway: carriage / row,
      sidewalk: Math.max(0, row - carriage) / row,
      parking: 0,
      bike: 0,
      green: 0,
      equity: 1 - carriage / row,
    };
  }
  if (!total) return null;
  return {
    total_m: total,
    carriageway: carriage / total,
    sidewalk: sw / total,
    parking: park / total,
    bike: bike / total,
    green: green / total,
    equity: (sw + bike + green) / total,
  };
}

export function equityColor(equity: number) {
  const e = Math.max(0, Math.min(1, equity));
  if (e < 0.5) return lerpHex("#b42318", "#e8a317", e / 0.5);
  return lerpHex("#e8a317", "#0f7a4c", (e - 0.5) / 0.5);
}

export function streetPaintColor(m: Measurement | undefined, _mode: ViewMode) {
  if (!hasAnyEdit(m)) return LAYER_COLORS.base;
  return LAYER_COLORS.edited;
}

function lerpHex(a: string, b: string, t: number) {
  const pa = hex(a),
    pb = hex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function hex(h: string) {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] as const;
}

export function pct(x: number | null | undefined) {
  if (x == null || Number.isNaN(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

export function slugify(text: string) {
  let n = String(text || "")
    .trim()
    .toLowerCase();
  const map: Record<string, string> = { ă: "a", â: "a", î: "i", ș: "s", ş: "s", ț: "t", ţ: "t" };
  for (const [a, b] of Object.entries(map)) n = n.split(a).join(b);
  return n.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function normalizeStreetName(name: string) {
  return slugify(String(name || "").replace(/^strada\s+/i, "").replace(/^str\.?\s+/i, ""));
}

export function makeStreetId(feature: GeoJSON.Feature, index: number) {
  const p = (feature.properties || {}) as Record<string, unknown>;
  if (p.id != null) return `st_${p.id}`;
  const name = normalizeStreetName(String(p.name || "x"));
  const cartier = slugify(String(p.cartier || "x"));
  let c = "0";
  try {
    const g = feature.geometry as GeoJSON.LineString | GeoJSON.MultiLineString;
    const first = g.type === "LineString" ? g.coordinates[0] : g.coordinates[0][0];
    c = `${first[0].toFixed(5)}_${first[1].toFixed(5)}`;
  } catch {
    /* ignore */
  }
  return `st_${cartier}_${name}_${c}_${index}`;
}

export function makeBuildingId(feature: GeoJSON.Feature, index: number) {
  const p = (feature.properties || {}) as Record<string, unknown>;
  if (p.osm_id) return `b_osm_${p.osm_id}`;
  let c = String(index);
  try {
    const g = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    const ring = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
    c = `${ring[0][0].toFixed(5)}_${ring[0][1].toFixed(5)}`;
  } catch {
    /* ignore */
  }
  return `b_${c}_${index}`;
}

export function lookupKey(cartier: string, name: string) {
  return `${slugify(cartier)}::${normalizeStreetName(name)}`;
}
