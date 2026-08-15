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

export function pointInPolygon(pt: LngLat, geom: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
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

export type NeighborhoodPoly = {
  slug: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

/**
 * Asignare cartier:
 * 1) cel mai bun coverage (vârfuri în poligon) dacă > 0
 * 2) altfel midpoint în poligon
 * 3) altfel overlap bbox (străzi pe contur / imediat lângă poligon, ex. Ceferiștilor)
 */
export function assignStreetToNeighborhood(
  feature: GeoJSON.Feature,
  neighborhoods: NeighborhoodPoly[]
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
