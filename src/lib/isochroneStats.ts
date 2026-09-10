import { neighborhoodAtPoint, neighborhoodsFromCollection, pointInPolygon, type LngLat } from "./geoAssign";
import { distM } from "./isochrone";

export type IsochroneStats = {
  here: string | null;
  reached: string[];
  areaKm2: number;
  streetKm: number;
  schoolCount: number;
  schoolNames: string[];
  reachable: boolean;
};

export function emptyIsochroneStats(): IsochroneStats {
  return {
    here: null,
    reached: [],
    areaKm2: 0,
    streetKm: 0,
    schoolCount: 0,
    schoolNames: [],
    reachable: false,
  };
}

export function describeReach(
  origin: { lng: number; lat: number },
  features: GeoJSON.FeatureCollection | null | undefined,
  neighborhoods: GeoJSON.FeatureCollection | null | undefined,
  schools: GeoJSON.FeatureCollection | null | undefined
): IsochroneStats {
  const nb = neighborhoodsFromCollection(neighborhoods);
  const hereNb = neighborhoodAtPoint(nb, [origin.lng, origin.lat]);
  const band = features?.features.find((f) => f.properties?.kind === "band");
  const net = features?.features.find((f) => f.properties?.kind === "net");
  const geom = band?.geometry;
  const poly = geom && (geom.type === "Polygon" || geom.type === "MultiPolygon") ? geom : null;
  if (!poly) {
    return {
      here: hereNb?.name ?? null,
      reached: hereNb ? [hereNb.name] : [],
      areaKm2: 0,
      streetKm: 0,
      schoolCount: 0,
      schoolNames: [],
      reachable: false,
    };
  }
  const schoolHits = schoolsInPolygon(schools, poly);
  return {
    here: hereNb?.name ?? null,
    reached: reachedNeighborhoods(nb, poly, origin),
    areaKm2: geomAreaKm2(poly),
    streetKm: net ? netLengthKm(net) : 0,
    schoolCount: schoolHits.length,
    schoolNames: schoolHits,
    reachable: true,
  };
}

export function formatStatNumber(n: number) {
  if (!(n > 0)) return "0";
  const rounded = Math.round(n * 10) / 10;
  const digits = rounded < 10 ? 1 : 0;
  return rounded.toLocaleString("ro-RO", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatKm2(n: number) {
  return `${formatStatNumber(n)} km²`;
}

export function formatStreetKm(n: number) {
  return `${formatStatNumber(n)} km străzi`;
}

const SCHOOL_PREFIXES = [
  "școala gimnazială ",
  "colegiul național ",
  "liceul teoretic ",
  "liceul tehnologic ",
  "liceu tehnologic ",
  "grădinița ",
];

export function shortSchoolName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return name;
  const lower = trimmed.toLocaleLowerCase("ro");
  let out = trimmed;
  for (const prefix of SCHOOL_PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    const rest = trimmed.slice(prefix.length).trim();
    if (!rest || leftoverNeedsInstitutionKind(rest)) break;
    out = rest;
    break;
  }
  out = unwrapOuterQuotes(out);
  const numbered = numberedSchoolRemnant(out);
  if (numbered) return `Gimn. nr. ${numbered}`;
  return out || trimmed;
}

function leftoverNeedsInstitutionKind(rest: string) {
  return /^(tehnologic|de construc[țt]ii)\b/i.test(rest.trim());
}

function unwrapOuterQuotes(s: string) {
  const t = s.trim();
  if (!/^["„”'«»]/.test(t) || !/["„”'«»]$/.test(t)) return t;
  return t.replace(/^["„”'«»]+/, "").replace(/["„”'«»]+$/, "").trim();
}

function numberedSchoolRemnant(s: string) {
  const m = s.trim().match(/^(?:nr\.?\s*)?(\d+)$/i);
  return m?.[1] ?? null;
}

export function geomAreaKm2(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  return geomAreaM2(geom) / 1_000_000;
}

function geomAreaM2(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const lat0 = geomLat0(geom);
  const mLng = 111320 * Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  const mLat = 111320;
  const ringM2 = (ring: GeoJSON.Position[]) => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      a += ring[i][0] * mLng * (ring[i + 1][1] * mLat) - ring[i + 1][0] * mLng * (ring[i][1] * mLat);
    }
    return Math.abs(a) / 2;
  };
  if (geom.type === "Polygon") {
    const [outer, ...holes] = geom.coordinates;
    return ringM2(outer) - holes.reduce((s, h) => s + ringM2(h), 0);
  }
  return geom.coordinates.reduce((s, poly) => {
    const [outer, ...holes] = poly;
    return s + ringM2(outer) - holes.reduce((t, h) => t + ringM2(h), 0);
  }, 0);
}

function geomLat0(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const ring = geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0]?.[0];
  if (!ring?.length) return 45.8;
  let s = 0;
  for (const p of ring) s += p[1];
  return s / ring.length;
}

function netLengthKm(f: GeoJSON.Feature) {
  const g = f.geometry;
  if (!g) return 0;
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  let n = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      n += distM(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    }
  }
  return n / 1000;
}

function reachedNeighborhoods(
  nb: ReturnType<typeof neighborhoodsFromCollection>,
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  origin: { lng: number; lat: number }
) {
  const isoBb = polyBbox(geom);
  const samples = polygonSamples(geom);
  samples.push([origin.lng, origin.lat]);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const n of nb) {
    const bb = polyBbox(n.geometry);
    if (isoBb && bb && !bboxesOverlap(isoBb, bb, 0.0004)) continue;
    const hit = samples.some((pt) => pointInPolygon(pt, n.geometry)) || pointInPolygon(polygonProbe(n.geometry), geom);
    if (!hit) continue;
    if (seen.has(n.slug)) continue;
    seen.add(n.slug);
    names.push(n.name);
  }
  names.sort((a, b) => a.localeCompare(b, "ro"));
  return names;
}

function schoolsInPolygon(schools: GeoJSON.FeatureCollection | null | undefined, geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  if (!schools) return [];
  const names: string[] = [];
  for (const f of schools.features) {
    const pt = featurePoint(f);
    if (!pt || !pointInPolygon(pt, geom)) continue;
    const p = (f.properties || {}) as { denumire?: string; name?: string };
    const name = String(p.denumire || p.name || "").trim();
    if (name) names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b, "ro"));
  return names;
}

function featurePoint(f: GeoJSON.Feature): LngLat | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === "Point") return g.coordinates as LngLat;
  if (g.type === "MultiPoint" && g.coordinates[0]) return g.coordinates[0] as LngLat;
  return null;
}

function polygonSamples(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): LngLat[] {
  const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  const out: LngLat[] = [];
  for (const ring of rings) {
    const step = Math.max(1, Math.floor(ring.length / 28));
    for (let i = 0; i < ring.length; i += step) {
      const p = ring[i];
      if (p) out.push([p[0], p[1]]);
    }
  }
  return out;
}

function polygonProbe(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): LngLat {
  const ring = geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0]?.[0];
  if (!ring?.length) return [24.15, 45.8];
  let x = 0;
  let y = 0;
  const n = Math.max(1, ring.length - (ring.length > 1 ? 1 : 0));
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

function polyBbox(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] | null {
  const pts: number[][] = [];
  if (geom.type === "Polygon") pts.push(...geom.coordinates[0]);
  else for (const p of geom.coordinates) pts.push(...p[0]);
  if (!pts.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
}

function bboxesOverlap(a: [number, number, number, number], b: [number, number, number, number], pad = 0) {
  return !(a[2] + pad < b[0] - pad || a[0] - pad > b[2] + pad || a[3] + pad < b[1] - pad || a[1] - pad > b[3] + pad);
}
