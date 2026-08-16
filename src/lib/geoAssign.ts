/** Point-in-polygon + asignare stradă → cartier. */

export type LngLat = [number, number];

function pointInRing(pt: LngLat, ring: number[][]) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonRings(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][] {
  if (geom.type === "Polygon") return geom.coordinates;
  return geom.coordinates.flat();
}

function pointOnSeg(pt: LngLat, a: number[], b: number[], eps = 1e-12) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = pt[0] - a[0];
  const apy = pt[1] - a[1];
  const ab2 = abx * abx + aby * aby;
  if (ab2 < eps) return apx * apx + apy * apy < eps;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const dx = apx - t * abx;
  const dy = apy - t * aby;
  return dx * dx + dy * dy < eps;
}

function pointOnBoundary(pt: LngLat, geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  for (const ring of polygonRings(geom)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if (pointOnSeg(pt, ring[j], ring[i])) return true;
    }
  }
  return false;
}

export function pointInPolygon(pt: LngLat, geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  if (pointOnBoundary(pt, geom)) return true;
  if (geom.type === "Polygon") {
    const [outer, ...holes] = geom.coordinates;
    if (!pointInRing(pt, outer)) return false;
    return !holes.some((h) => pointInRing(pt, h));
  }
  return geom.coordinates.some((poly) => {
    const [outer, ...holes] = poly;
    if (!pointInRing(pt, outer)) return false;
    return !holes.some((h) => pointInRing(pt, h));
  });
}

function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Intersecții AB cu CD; t pe AB în (0,1). */
function segIntersectT(a: LngLat, b: LngLat, c: number[], d: number[]): number | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-18) return null;
  const qx = c[0] - a[0];
  const qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}

function uniqueTs(ts: number[]) {
  const sorted = [...ts].sort((x, y) => x - y);
  const out: number[] = [];
  for (const t of sorted) {
    if (!out.length || Math.abs(t - out[out.length - 1]) > 1e-9) out.push(t);
  }
  return out;
}

function lineLength2(coords: LngLat[]) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    const dx = coords[i][0] - coords[i - 1][0];
    const dy = coords[i][1] - coords[i - 1][1];
    s += Math.hypot(dx, dy);
  }
  return s;
}

function ringArea(ring: number[][]) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a) / 2;
}

function polygonArea(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  if (geom.type === "Polygon") {
    const [outer, ...holes] = geom.coordinates;
    return ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0);
  }
  return geom.coordinates.reduce((s, poly) => {
    const [outer, ...holes] = poly;
    return s + ringArea(outer) - holes.reduce((t, h) => t + ringArea(h), 0);
  }, 0);
}

function largestPolygonPart(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Position[][] {
  if (geom.type === "Polygon") return geom.coordinates;
  let best = geom.coordinates[0];
  let bestA = -1;
  for (const poly of geom.coordinates) {
    const a = ringArea(poly[0] || []);
    if (a > bestA) {
      bestA = a;
      best = poly;
    }
  }
  return best;
}

function ringCentroid(ring: number[][]): LngLat {
  let twiceA = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0];
    const y0 = ring[j][1];
    const x1 = ring[i][0];
    const y1 = ring[i][1];
    const cross = x0 * y1 - x1 * y0;
    twiceA += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(twiceA) < 1e-18) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const p of ring) {
      if (n && p[0] === ring[0][0] && p[1] === ring[0][1]) continue;
      sx += p[0];
      sy += p[1];
      n++;
    }
    return n ? [sx / n, sy / n] : [ring[0][0], ring[0][1]];
  }
  return [cx / (3 * twiceA), cy / (3 * twiceA)];
}

function dist2ToSeg(pt: LngLat, a: number[], b: number[]) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = pt[0] - a[0];
  const apy = pt[1] - a[1];
  const ab2 = abx * abx + aby * aby;
  const t = ab2 < 1e-18 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const dx = apx - t * abx;
  const dy = apy - t * aby;
  return dx * dx + dy * dy;
}

function minDist2ToRing(pt: LngLat, ring: number[][]) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    best = Math.min(best, dist2ToSeg(pt, ring[j], ring[i]));
  }
  return best;
}

/** Punct de etichetă în interiorul poligonului (centroid, altfel eșantion pe grilă). */
export function polygonLabelPoint(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): LngLat | null {
  const part = largestPolygonPart(geom);
  const outer = part[0];
  if (!outer || outer.length < 3) return null;
  const poly: GeoJSON.Polygon = { type: "Polygon", coordinates: part };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }

  const candidates: LngLat[] = [ringCentroid(outer), [(minX + maxX) / 2, (minY + maxY) / 2]];
  for (const pt of candidates) {
    if (pointInPolygon(pt, poly)) return pt;
  }

  let bestPt: LngLat | null = null;
  let bestD = -1;
  const steps = 9;
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      const pt: LngLat = [minX + ((maxX - minX) * i) / steps, minY + ((maxY - minY) * j) / steps];
      if (!pointInPolygon(pt, poly)) continue;
      const d = minDist2ToRing(pt, outer);
      if (d > bestD) {
        bestD = d;
        bestPt = pt;
      }
    }
  }
  return bestPt;
}

/** Puncte GeoJSON pentru numele cartierelor (un label per poligon). */
export function neighborhoodLabelCollection(nb: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of nb.features) {
    const geom = f.geometry;
    if (!geom || (geom.type !== "Polygon" && geom.type !== "MultiPolygon")) continue;
    const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string };
    const name = String(p.denumire || p.name || p.slug || "").trim();
    if (!name) continue;
    const coordinates = polygonLabelPoint(geom);
    if (!coordinates) continue;
    features.push({
      type: "Feature",
      properties: {
        slug: String(p.slug || ""),
        label: name.toLocaleUpperCase("ro"),
        area: polygonArea(geom),
      },
      geometry: { type: "Point", coordinates },
    });
  }
  return { type: "FeatureCollection", features };
}

function pieceSample(coords: LngLat[]): LngLat {
  if (coords.length >= 2) {
    const i = Math.max(1, Math.floor(coords.length / 2));
    return lerp(coords[i - 1], coords[i], 0.5);
  }
  return coords[0];
}

function clipLineByPredicate(coords: LngLat[], rings: number[][][], keepMid: (mid: LngLat) => boolean): LngLat[][] {
  if (coords.length < 2) return [];
  const parts: LngLat[][] = [];
  let current: LngLat[] = [];

  const flush = () => {
    if (current.length >= 2 && lineLength2(current) > 1e-8) parts.push(current);
    current = [];
  };
  const pushPt = (p: LngLat) => {
    const last = current[current.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-12 && Math.abs(last[1] - p[1]) < 1e-12) return;
    current.push(p);
  };

  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const ts = [0, 1];
    for (const ring of rings) {
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        const t = segIntersectT(a, b, ring[j], ring[k]);
        if (t != null) ts.push(t);
      }
    }
    const cuts = uniqueTs(ts);
    for (let c = 1; c < cuts.length; c++) {
      const t0 = cuts[c - 1];
      const t1 = cuts[c];
      const mid = lerp(a, b, (t0 + t1) / 2);
      if (keepMid(mid)) {
        pushPt(lerp(a, b, t0));
        pushPt(lerp(a, b, t1));
      } else {
        flush();
      }
    }
  }
  flush();
  return parts;
}

/**
 * Taie o LineString la interiorul poligonului. Returnează una sau mai multe linii.
 * Punctele de pe contur sunt considerate înăuntru, ca porțiunile să se întâlnească pe limită.
 */
export function clipLineToPolygon(coords: LngLat[], geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): LngLat[][] {
  return clipLineByPredicate(coords, polygonRings(geom), (mid) => pointInPolygon(mid, geom));
}

export function geometryLineStrings(geom: GeoJSON.Geometry | null | undefined): LngLat[][] {
  if (!geom) return [];
  if (geom.type === "LineString") return [geom.coordinates as LngLat[]];
  if (geom.type === "MultiLineString") return geom.coordinates as LngLat[][];
  return [];
}

export type NeighborhoodPoly = {
  slug: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

/** Porțiuni din linie care nu cad în niciun cartier activ (restul după clip). */
export function clipLineOutsideNeighborhoods(coords: LngLat[], neighborhoods: NeighborhoodPoly[]): LngLat[][] {
  if (coords.length < 2) return [];
  const rings = neighborhoods.flatMap((n) => polygonRings(n.geometry));
  return clipLineByPredicate(coords, rings, (mid) => !neighborhoods.some((n) => pointInPolygon(mid, n.geometry)));
}

/** Hipodrom I–IV etc.: `dissolve: true` e doar subdiviziune; folosim poligonul părinte. */
export function neighborhoodIsActive(props: { dissolve?: unknown } | null | undefined): boolean {
  const d = props?.dissolve;
  return d !== true && d !== "true";
}

export type ClippedStreetPiece = {
  neighborhood: NeighborhoodPoly;
  coordinates: LngLat[];
};

/**
 * Porțiuni din geometria străzii care cad în fiecare cartier.
 * Dacă poligoanele se suprapun (ex. Hipodrom vs Hipodrom I–IV), rămâne cartierul cel mai mic.
 */
export function clipStreetToNeighborhoods(
  geom: GeoJSON.Geometry | null | undefined,
  neighborhoods: NeighborhoodPoly[]
): ClippedStreetPiece[] {
  if (!geom || !neighborhoods.length) return [];
  const lines = geometryLineStrings(geom);
  const streetBb = geomBbox(geom);
  const areas = new Map(neighborhoods.map((n) => [n.slug, polygonArea(n.geometry)]));
  const out: ClippedStreetPiece[] = [];
  for (const n of neighborhoods) {
    const nb = geomBbox(n.geometry);
    if (streetBb && nb && !bboxesOverlap(streetBb, nb, 0.0007)) continue;
    for (const line of lines) {
      for (const coordinates of clipLineToPolygon(line, n.geometry)) {
        const sample = pieceSample(coordinates);
        const nested = neighborhoods.some(
          (other) =>
            other.slug !== n.slug &&
            (areas.get(other.slug) || 0) < (areas.get(n.slug) || 0) &&
            pointInPolygon(sample, other.geometry)
        );
        if (nested) continue;
        out.push({ neighborhood: n, coordinates });
      }
    }
  }
  return out;
}

/**
 * Excepție la tăiere, pe fiecare way OSM (nu pe tot numele străzii):
 * un LineString care iese din cartier (în altul sau în afara poligoanelor).
 * Dacă exact un cartier dintre cele intersectate are date, păstrăm linia întreagă acolo.
 * Dual carriageway = două way-uri paralele, fiecare se judecă separat.
 * Way-urile complet în afara poligonului nu ajung aici (rămân neatribuite).
 */
export function uncutOwner(
  pieces: ClippedStreetPiece[],
  hasOutsideRemainder: boolean,
  dataSlugs: ReadonlySet<string>
): NeighborhoodPoly | null {
  if (!pieces.length) return null;
  const bySlug = new Map<string, NeighborhoodPoly>();
  for (const p of pieces) bySlug.set(p.neighborhood.slug, p.neighborhood);
  const crossed = [...bySlug.keys()];
  const withData = crossed.filter((s) => dataSlugs.has(s));
  if (withData.length !== 1) return null;
  if (crossed.length < 2 && !hasOutsideRemainder) return null;
  return bySlug.get(withData[0]) || null;
}

/** Păstrează geometria OSM întreagă doar dacă e un singur LineString pe acest way. */
export function shouldKeepUncut(
  geom: GeoJSON.Geometry | null | undefined,
  pieces: ClippedStreetPiece[],
  hasOutsideRemainder: boolean,
  dataSlugs: ReadonlySet<string>
): NeighborhoodPoly | null {
  if (geometryLineStrings(geom).length !== 1) return null;
  return uncutOwner(pieces, hasOutsideRemainder, dataSlugs);
}

function lineCoords(geom: GeoJSON.Geometry | null | undefined): LngLat[] {
  if (!geom) return [];
  if (geom.type === "LineString") return geom.coordinates as LngLat[];
  if (geom.type === "MultiLineString") return (geom.coordinates as LngLat[][]).flat();
  return [];
}

function geomBbox(geom: GeoJSON.Geometry | GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] | null {
  const pts: number[][] = [];
  if (geom.type === "LineString") pts.push(...geom.coordinates);
  else if (geom.type === "MultiLineString") for (const c of geom.coordinates) pts.push(...c);
  else if (geom.type === "Polygon") pts.push(...geom.coordinates[0]);
  else if (geom.type === "MultiPolygon") for (const p of geom.coordinates) pts.push(...p[0]);
  if (!pts.length) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
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

/** Fracțiune din vârfurile liniei aflate în poligon. */
export function lineCoverageInPolygon(geom: GeoJSON.Geometry | null | undefined, poly: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const pts = lineCoords(geom);
  if (!pts.length) return 0;
  let hit = 0;
  for (const pt of pts) if (pointInPolygon(pt, poly)) hit++;
  return hit / pts.length;
}

/** Punct reprezentativ pe linie (mijlocul primului segment). */
export function lineSamplePoint(geom: GeoJSON.Geometry | null | undefined): LngLat | null {
  const pts = lineCoords(geom);
  if (!pts.length) return null;
  return pts[Math.floor(pts.length / 2)];
}

export function lineSortKey(geom: GeoJSON.Geometry | null | undefined): number {
  const pt = lineSamplePoint(geom);
  if (!pt) return 0;
  return pt[0] * 1000 + pt[1];
}

/**
 * Asignare cartier:
 * 1) cel mai bun coverage (vârfuri în poligon) dacă > 0
 * 2) altfel midpoint în poligon
 * 3) altfel overlap bbox (străzi pe contur / imediat lângă poligon, ex. Ceferiștilor)
 *
 * Bbox e doar pentru străzi fără omolog în poligon. Pipeline-ul nu trebuie să
 * asigneze via bbox un nume care are deja piese clip/coverage în acel cartier
 * (continuări OSM în afara limitei, ex. Bulevardul Mihai Viteazul lângă Hipodrom).
 */
export function assignStreetToNeighborhood(
  feature: GeoJSON.Feature,
  neighborhoods: NeighborhoodPoly[],
  options?: { allowBbox?: boolean }
): { slug: string; name: string; method: "coverage" | "midpoint" | "bbox" } | null {
  if (!feature.geometry || !neighborhoods.length) return null;

  let bestCov: { n: NeighborhoodPoly; frac: number } | null = null;
  for (const n of neighborhoods) {
    const frac = lineCoverageInPolygon(feature.geometry, n.geometry);
    if (frac > 0 && (!bestCov || frac > bestCov.frac)) bestCov = { n, frac };
  }
  if (bestCov && bestCov.frac > 0) {
    return { slug: bestCov.n.slug, name: bestCov.n.name, method: "coverage" };
  }

  const pt = lineSamplePoint(feature.geometry);
  if (pt) {
    for (const n of neighborhoods) {
      if (pointInPolygon(pt, n.geometry)) return { slug: n.slug, name: n.name, method: "midpoint" };
    }
  }

  if (options?.allowBbox === false) return null;

  const streetBb = geomBbox(feature.geometry);
  if (streetBb) {
    const hits: NeighborhoodPoly[] = [];
    for (const n of neighborhoods) {
      const nb = geomBbox(n.geometry);
      // ~60–80 m padding la latitudinea Sibiului
      if (nb && bboxesOverlap(streetBb, nb, 0.0007)) hits.push(n);
    }
    if (hits.length === 1) return { slug: hits[0].slug, name: hits[0].name, method: "bbox" };
    if (hits.length > 1 && pt) {
      // alege cartierul al cărui bbox e cel mai apropiat de midpoint
      let best: { n: NeighborhoodPoly; d: number } | null = null;
      for (const n of hits) {
        const nb = geomBbox(n.geometry)!;
        const cx = (nb[0] + nb[2]) / 2;
        const cy = (nb[1] + nb[3]) / 2;
        const d = (pt[0] - cx) ** 2 + (pt[1] - cy) ** 2;
        if (!best || d < best.d) best = { n, d };
      }
      if (best) return { slug: best.n.slug, name: best.n.name, method: "bbox" };
    }
  }

  return null;
}
