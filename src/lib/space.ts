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

/** Culori din harta originală (QGIS / repo EricPlayZ) + tipuri de pistă. */
export const LAYER_COLORS = {
  base: "#666666",
  bike: "#00FF88",
  /** Pistă între carosabil și mașinile parcate. */
  bikeDoor: "#00B8D4",
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

/** Lățime de pistă din măsurători (seed / local / geo). */
export function measurementHasBikeLane(m?: Measurement | null) {
  if (!m) return false;
  return n(m.bike1_m) + n(m.bike2_m) > 0;
}

/** Pistă: flag geo sau lățime măsurată. */
export function streetHasBikeLane(props: Record<string, unknown> | null | undefined, m?: Measurement | null) {
  return featureHasBikeLane(props) || measurementHasBikeLane(m);
}

export function streetHasIllegalParking(props: Record<string, unknown> | null | undefined, m?: Measurement | null) {
  return featureHasIllegalParking(props) || hasIllegalParking(m);
}

/** Pistă fără parcare amenajată pe lângă ea. */
export function featureHasSafeBikeLane(props: Record<string, unknown> | null | undefined) {
  return featureHasBikeLane(props) && !featureHasReservedParking(props) && !geoFlag(props, "bike_door");
}

/** Pistă pe carosabil = pistă + parcare amenajată (sau flag bike_door din CSV). */
export function featureHasDoorZoneBikeLane(props: Record<string, unknown> | null | undefined) {
  if (geoFlag(props, "bike_door")) return true;
  return featureHasBikeLane(props) && featureHasReservedParking(props);
}

export function streetHasSafeBikeLane(props: Record<string, unknown> | null | undefined, m?: Measurement | null) {
  return streetHasBikeLane(props, m) && !featureHasReservedParking(props) && !geoFlag(props, "bike_door");
}

export function streetHasDoorZoneBikeLane(props: Record<string, unknown> | null | undefined, m?: Measurement | null) {
  if (geoFlag(props, "bike_door")) return true;
  return streetHasBikeLane(props, m) && featureHasReservedParking(props);
}

/**
 * Ce știm despre pistă pe această stradă.
 * `none` = avem date/modificări pe stradă, dar fără pistă.
 * `unknown` = stradă de bază, fără măsurători sau flag-uri.
 */
export type BikeLaneStatus = "safe" | "door" | "none" | "unknown";

export function streetBikeLaneStatus(
  props: Record<string, unknown> | null | undefined,
  m?: Measurement | null
): BikeLaneStatus {
  if (streetHasDoorZoneBikeLane(props, m)) return "door";
  if (streetHasBikeLane(props, m)) return "safe";
  if (streetHasSurveyedAttributes(props, m)) return "none";
  return "unknown";
}

/** Date sau modificări pe stradă (parcări, măsurători, editări) — nu doar linia de bază. */
export function streetHasSurveyedAttributes(
  props: Record<string, unknown> | null | undefined,
  m?: Measurement | null
) {
  if (featureHasIllegalParking(props) || featureHasReservedParking(props)) return true;
  if (hasIllegalParking(m)) return true;
  if (m && hasCrossSectionWidths(m)) return true;
  if (m && (n(m.row_width_m) > 0 || n(m.free_sidewalk1_m) + n(m.free_sidewalk2_m) > 0)) {
    if (m.source === "seed" || m.source === "csv" || m.source === "local" || hasMeaningfulLocalEdit(m)) return true;
  }
  if (hasMeaningfulLocalEdit(m)) return true;
  return false;
}

function hasCrossSectionWidths(m: Measurement) {
  return (
    n(m.carriageway_m) +
      n(m.sidewalk1_m) +
      n(m.sidewalk2_m) +
      n(m.parking1_m) +
      n(m.parking2_m) +
      n(m.bike1_m) +
      n(m.bike2_m) +
      n(m.green1_m) +
      n(m.green2_m) >
    0
  );
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
/**
 * Override explicit pe un `sid` (inclusiv golire: toate lățimile 0).
 * `source: "local"` = utilizatorul a apăsat Salvează; nu e rest Excel.
 */
export function hasMeaningfulLocalEdit(m?: Measurement | null) {
  if (!m) return false;
  if (m.source === "local") return true;
  if (m.illgl_park === true) return true;
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

/** Verdict scurt pe baza spațiului măsurat — pentru utilizatori, nu listă de metri. */
export function spaceEquityVerdict(shares: SpaceShares): { title: string; detail: string } {
  const people = Math.round(shares.equity * 100);
  const cars = Math.round((shares.carriageway + shares.parking) * 100);
  if (shares.equity >= 0.5) {
    return {
      title: `${people}% pentru oameni`,
      detail: `Pietoni, biciclete și verde au mai mult spațiu decât mașinile (${cars}% carosabil + parcare).`,
    };
  }
  if (shares.equity >= 0.35) {
    return {
      title: `${people}% pentru oameni`,
      detail: `Spațiu mixt: oamenii au o parte vizibilă, dar mașinile rămân dominante (${cars}%).`,
    };
  }
  if (shares.equity >= 0.2) {
    return {
      title: `Doar ${people}% pentru oameni`,
      detail: `Trama e orientată spre mașini (${cars}% carosabil + parcare).`,
    };
  }
  return {
    title: `Foarte puțin spațiu pentru oameni (${people}%)`,
    detail: `Aproape toată trama e pentru mașini (${cars}%).`,
  };
}

/** Lățime medie trotuar liber — utilă (accesibilitate), nu un dump de câmpuri. */
export function freeSidewalkHint(m?: Measurement | null): string | null {
  if (!m) return null;
  const a = n(m.free_sidewalk1_m);
  const b = n(m.free_sidewalk2_m);
  const vals = [a, b].filter((x) => x > 0);
  if (!vals.length) return null;
  const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
  const label = avg.toLocaleString("ro-RO", { maximumFractionDigits: 1, minimumFractionDigits: avg < 10 ? 1 : 0 });
  if (avg < 1) return `Trotuar liber ~${label} m — foarte îngust pentru pietoni.`;
  if (avg < 1.5) return `Trotuar liber ~${label} m — strâmt (sub ~1,5 m).`;
  if (avg < 2) return `Trotuar liber ~${label} m — acceptabil, dar fără confort.`;
  return `Trotuar liber ~${label} m — spațiu pietonal confortabil.`;
}

/** Citire calitativă din flag-uri când nu există măsurători de lățime. */
export function flagSpaceStory(props: Record<string, unknown>): string | null {
  const bike = featureHasBikeLane(props);
  const doorBike = featureHasDoorZoneBikeLane(props);
  const illegal = featureHasIllegalParking(props);
  const reserved = featureHasReservedParking(props);
  if (!bike && !illegal && !reserved) return null;
  if (doorBike && reserved) {
    return "Pistă biciclete carosabil (între carosabil și parcări); trotuarul e afectat și de parcare amenajată.";
  }
  if (doorBike) {
    return "Pistă biciclete carosabil — între carosabil și mașinile parcate, fără protecție.";
  }
  if (bike && reserved) {
    return "Are pistă; o parte din trotuar e totuși rezervată parcării de mașini.";
  }
  if (illegal && reserved) {
    return "Trotuarele sunt afectate: și parcare amenajată, și ocupare ilegală.";
  }
  if (illegal) return "Parcare ilegală pe trotuar — spațiul pietonal e compromis.";
  if (reserved) return "Parcare amenajată pe trotuar — spațiul pietonal e redus formal.";
  if (bike) return "Există spațiu dedicat bicicletelor pe acest segment.";
  return null;
}


export function slugify(text: string) {
  let n = String(text || "")
    .trim()
    .toLowerCase();
  const map: Record<string, string> = { ă: "a", â: "a", î: "i", ș: "s", ş: "s", ț: "t", ţ: "t" };
  for (const [a, b] of Object.entries(map)) n = n.split(a).join(b);
  return n.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function normalizeStreetName(name: string, opts?: { keepDistinctivePrefix?: boolean }) {
  let s = String(name || "").trim();
  // Strada / Bd / Calea / Șoseaua sunt generice — CSV „Strada X” = OSM „X”.
  // Aleea / Piața / Intrarea / Fundătura / Pasajul: păstrate doar la arondare (keepDistinctivePrefix),
  // ca „Aleea X” să nu coincidă cu „Strada X”. Măsurătorile păstrează strip-ul vechi (sid / seed).
  const prefix = opts?.keepDistinctivePrefix
    ? /^(strada|stradă|str\.?|bulevardul|bd\.?|șoseaua|soseaua|sos\.?|calea)\s+/i
    : /^(strada|stradă|str\.?|bulevardul|bd\.?|șoseaua|soseaua|sos\.?|calea|aleea|piața|piata)\s+/i;
  s = s.replace(prefix, "");
  return slugify(s);
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

const EARTH_R_M = 6_371_000;

/** Distanță echirectangulară (m) — suficient de precisă la scară de oraș. */
export function lngLatDistanceMeters(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const x = (b[0] - a[0]) * toRad * Math.cos((lat1 + lat2) / 2);
  const y = (b[1] - a[1]) * toRad;
  return Math.hypot(x, y) * EARTH_R_M;
}

export function lineCoordsLengthMeters(coords: number[][]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) s += lngLatDistanceMeters(coords[i - 1], coords[i]);
  return s;
}

/** Lungime geometrie LineString / MultiLineString în metri. */
export function geometryLengthMeters(geom: GeoJSON.Geometry | null | undefined): number {
  if (!geom) return 0;
  if (geom.type === "LineString") return lineCoordsLengthMeters(geom.coordinates);
  if (geom.type === "MultiLineString") {
    return geom.coordinates.reduce((s, line) => s + lineCoordsLengthMeters(line), 0);
  }
  return 0;
}

function propertyLengthMeters(props: Record<string, unknown> | null | undefined): number {
  if (!props) return 0;
  const n = Number(props.length_m ?? props.length);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Lungimea acestui feature (bucată clipată, nu strada OSM întreagă).
 * Folosește `length` / `length_m` doar dacă sunt pe acest feature; altfel calculează din coordonate.
 * Nu folosește măsurători seed/CSV — acelea ar putea fi lungimea străzii complete.
 */
export function featureLengthMeters(feature: GeoJSON.Feature): number {
  const fromProps = propertyLengthMeters((feature.properties || null) as Record<string, unknown> | null);
  if (fromProps > 0) return fromProps;
  return geometryLengthMeters(feature.geometry);
}

/** Date din streets.geojson → Measurement (doar câmpurile disponibile). */
export function measurementFromGeoProps(props: Record<string, unknown> | null | undefined): Measurement {
  if (!props) return {};
  const length = Number(props.length_m ?? props.length);
  const out: Measurement = {
    name: String(props.name || "") || undefined,
    neighborhood_slug: props.cartier != null && String(props.cartier).trim() ? String(props.cartier) : undefined,
  };
  if (Number.isFinite(length) && length > 0) out.length_m = length;
  if (featureHasIllegalParking(props)) out.illgl_park = true;

  // Dacă geojson-ul are vreodată lățimi, le preluăm
  for (const f of FORM_FIELDS) {
    if (f.key === "length_m") continue;
    const v = Number(props[f.key]);
    if (Number.isFinite(v) && v > 0) (out as Record<string, unknown>)[f.key] = v;
  }
  return out;
}

/**
 * Măsurătoare afișată / editabilă: geojson → seed CSV (pe nume) → override local (pe sid).
 * O editare locală pe sid e completă: nu mai completăm lățimi din CSV-ul fraților.
 */
export function resolveStreetMeasurement(
  sid: string,
  props: Record<string, unknown> | null | undefined,
  local: Record<string, Measurement>,
  seedByLookup: Record<string, Measurement>
): Measurement {
  const base = measurementFromGeoProps(props);
  const cartier = String(props?.cartier || base.neighborhood_slug || "");
  const name = String(props?.name || base.name || "");
  const loc = local[sid];
  if (loc && hasMeaningfulLocalEdit(loc)) {
    const length = n(loc.length_m) > 0 ? loc.length_m : base.length_m;
    return {
      ...loc,
      street_id: sid,
      name: loc.name || base.name || name || undefined,
      neighborhood_slug: loc.neighborhood_slug || cartier || undefined,
      length_m: length,
      source: loc.source || "local",
    };
  }
  const seed = seedByLookup[lookupKey(cartier, name)];
  return {
    ...base,
    ...(seed || {}),
    name: seed?.name || base.name || name || undefined,
    street_id: sid,
    source: seed?.source || base.source,
  };
}

