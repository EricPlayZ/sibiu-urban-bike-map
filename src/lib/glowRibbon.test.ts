import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clipStreetToNeighborhoods, neighborhoodIsActive, type NeighborhoodPoly } from "./geoAssign";
import {
  bufferLine,
  glowGeometry,
  linesFromFeatures,
  overlapArea,
  polygonPartCount,
  ringVertexCount,
  stitchLines,
  unionPolygons,
  HALO_METERS,
  type Pt,
} from "./glowRibbon";
import { normalizeStreetName } from "./space";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), "utf8")) as T;
}

function streetFeatures(name: string): GeoJSON.Feature[] {
  const fc = loadJson<GeoJSON.FeatureCollection>("public/osm-streets.geojson");
  const key = normalizeStreetName(name);
  return fc.features.filter((f) => normalizeStreetName(String((f.properties as { name?: string })?.name || "")) === key);
}

function activeNeighborhoods(): NeighborhoodPoly[] {
  const fc = loadJson<GeoJSON.FeatureCollection>("public/neighborhood_limits.geojson");
  return fc.features.flatMap((f) => {
    const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string; dissolve?: unknown };
    if (!neighborhoodIsActive(p)) return [];
    const slug = String(p.slug || "");
    if (!slug || !f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) return [];
    return [
      {
        slug,
        name: String(p.denumire || p.name || slug),
        geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      },
    ];
  });
}

function clipLikeApp(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const polys = activeNeighborhoods();
  const out: GeoJSON.Feature[] = [];
  for (const f of features) {
    const pieces = clipStreetToNeighborhoods(f.geometry, polys);
    if (!pieces.length) {
      out.push(f);
      continue;
    }
    for (const piece of pieces) {
      out.push({
        type: "Feature",
        properties: { ...(f.properties || {}), cartier: piece.neighborhood.slug },
        geometry: { type: "LineString", coordinates: piece.coordinates },
      });
    }
  }
  return out;
}

function chainSegments(n: number, gapDeg = 0): Pt[][] {
  const segs: Pt[][] = [];
  const x0 = 24.15;
  const y0 = 45.79;
  const step = 0.00025;
  for (let i = 0; i < n; i++) {
    const a: Pt = [x0 + i * (step + gapDeg), y0];
    const b: Pt = [x0 + i * (step + gapDeg) + step, y0];
    segs.push([a, b]);
  }
  return segs;
}

function glowOfLines(lines: Pt[][], zoom = 16.5) {
  const features = lines.map((coordinates) => ({
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates },
  }));
  return glowGeometry(features, { zoom, lat: 45.79 });
}

function outerGeom(fc: GeoJSON.FeatureCollection) {
  const f = fc.features.find((x) => x.properties?.ring === "outer");
  return f?.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined;
}

describe("stitchLines", () => {
  it("joins two segments that share an endpoint into one line", () => {
    const a: Pt[] = [
      [24.15, 45.79],
      [24.151, 45.79],
    ];
    const b: Pt[] = [
      [24.151, 45.79],
      [24.152, 45.791],
    ];
    const stitched = stitchLines([a, b]);
    expect(stitched).toHaveLength(1);
    expect(stitched[0].length).toBeGreaterThanOrEqual(3);
  });

  it("joins a chain of two-point OSM-style pieces into one polyline", () => {
    const segs = chainSegments(9);
    expect(segs).toHaveLength(9);
    const stitched = stitchLines(segs);
    expect(stitched).toHaveLength(1);
    expect(stitched[0].length).toBe(10);
  });

  it("still joins pieces when clip leaves a few-meter gap", () => {
    const gapDeg = 8 / 111320;
    const stitched = stitchLines(chainSegments(6, gapDeg));
    expect(stitched).toHaveLength(1);
  });
});

describe("buffer + union", () => {
  it("buffers a polyline into one smooth polygon, not a stack of quads", () => {
    const line: Pt[] = chainSegments(9).reduce((acc, seg) => {
      if (!acc.length) return seg.slice();
      return acc.concat(seg.slice(1));
    }, [] as Pt[]);
    const polys = bufferLine(line, 12);
    expect(polys.length).toBe(1);
    const verts = polys[0].coordinates[0].length;
    expect(verts).toBeGreaterThan(12);
  });

  it("unions overlapping capsules into a single polygon", () => {
    const segs = chainSegments(9);
    const caps = segs.flatMap((s) => bufferLine(s, 12));
    expect(caps.length).toBe(9);
    const u = unionPolygons(caps);
    expect(u.ok).toBe(true);
    expect(polygonPartCount(u.geometry)).toBe(1);
    expect(overlapArea(u.geometry)).toBe(0);
  });
});

describe("glowGeometry", () => {
  it("keeps a 5 meter halo and emits a centerline for contrast strokes", () => {
    expect(HALO_METERS).toBe(5);
    const fc = glowOfLines(chainSegments(4));
    expect(fc.features.some((f) => f.properties?.kind === "path" && f.geometry?.type === "LineString")).toBe(true);
    expect(fc.features.some((f) => f.properties?.ring === "outer")).toBe(true);
  });

  it("does not emit one rectangle per input segment", () => {
    const fc = glowOfLines(chainSegments(9));
    const geom = outerGeom(fc);
    expect(geom).toBeTruthy();
    expect(polygonPartCount(geom)).toBe(1);
    expect(ringVertexCount(geom)).toBeGreaterThan(16);
    expect(overlapArea(geom)).toBe(0);
    expect(fc.features.find((f) => f.properties?.ring === "outer")?.properties?.unionOk).toBe(true);
  });

  it("keeps a closed ring as one halo, not a pearl-string of blobs", () => {
    const ring: Pt[] = [];
    const cx = 24.155;
    const cy = 45.792;
    const r = 0.00035;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    ring.push(ring[0]);
    const fc = glowOfLines([ring]);
    const geom = outerGeom(fc);
    expect(polygonPartCount(geom)).toBe(1);
    expect(overlapArea(geom)).toBe(0);
  });
});

describe("real Sibiu streets", () => {
  it("stitches Calea Dumbrăvii clips; leftover paths are branches, not every OSM cut", () => {
    const raw = streetFeatures("Calea Dumbrăvii");
    expect(raw.length).toBeGreaterThan(5);
    const clipped = clipLikeApp(raw);
    expect(clipped.length).toBeGreaterThan(raw.length * 0.5);
    const stitched = stitchLines(linesFromFeatures(clipped));
    expect(stitched.length).toBeLessThan(clipped.length);
    expect(stitched.length).toBeLessThanOrEqual(raw.length + 8);
  });

  it("builds a non-overlapping halo for clipped Calea Dumbrăvii", () => {
    const clipped = clipLikeApp(streetFeatures("Calea Dumbrăvii"));
    const fc = glowGeometry(clipped, { zoom: 16.2, lat: 45.79 });
    const geom = outerGeom(fc);
    expect(geom).toBeTruthy();
    expect(fc.features.find((f) => f.properties?.ring === "outer")?.properties?.unionOk).toBe(true);
    expect(polygonPartCount(geom)).toBeLessThan(8);
    expect(overlapArea(geom)).toBeLessThan(1e-12);
    expect(ringVertexCount(geom)).toBeGreaterThan(40);
  });

  it("builds a non-overlapping halo for a branched residential street", () => {
    const raw = streetFeatures("Strada Justiției");
    expect(raw.length).toBeGreaterThan(0);
    const clipped = clipLikeApp(raw);
    const fc = glowGeometry(clipped.length ? clipped : raw, { zoom: 16.5, lat: 45.79 });
    const geom = outerGeom(fc);
    expect(geom).toBeTruthy();
    expect(overlapArea(geom)).toBeLessThan(1e-12);
    expect(polygonPartCount(geom)).toBeLessThan(6);
  });
});
