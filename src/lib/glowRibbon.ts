import type { Map as MapLibreMap } from "maplibre-gl";
import buffer from "@turf/buffer";
import { lineString } from "@turf/helpers";
import polygonClipping from "polygon-clipping";
import type { SearchHit } from "./mapSearch";

type ClipMulti = [number, number][][][];

export type Pt = [number, number];

export const SNAP_METERS = 18;

export function metersPerPixel(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function projector(origin: Pt) {
  const mLat = 111320;
  const mLng = 111320 * Math.max(0.2, Math.cos((origin[1] * Math.PI) / 180));
  return {
    xy: (p: Pt): Pt => [(p[0] - origin[0]) * mLng, (p[1] - origin[1]) * mLat],
    ll: (p: Pt): Pt => [p[0] / mLng + origin[0], p[1] / mLat + origin[1]],
  };
}

function uniq(coords: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of coords) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-10) out.push(p);
  }
  return out;
}

function keyOf(p: Pt) {
  return `${p[0]},${p[1]}`;
}

export function linesFromGeometry(geom: GeoJSON.Geometry): Pt[][] {
  if (geom.type === "LineString") return [geom.coordinates as Pt[]];
  if (geom.type === "MultiLineString") return geom.coordinates as Pt[][];
  return [];
}

export function linesFromFeatures(features: GeoJSON.Feature[]): Pt[][] {
  const lines: Pt[][] = [];
  for (const f of features) {
    if (f.geometry) lines.push(...linesFromGeometry(f.geometry));
  }
  return lines;
}

/** Neighborhood clips rarely share an exact node — snap nearby ends before joining. */
export function snapLines(lines: Pt[][], snapM = SNAP_METERS): Pt[][] {
  const cleaned = lines.map(uniq).filter((l) => l.length >= 2);
  type End = { li: number; end: 0 | 1; p: Pt };
  const ends: End[] = [];
  cleaned.forEach((line, li) => {
    ends.push({ li, end: 0, p: line[0] });
    ends.push({ li, end: 1, p: line[line.length - 1] });
  });
  if (!ends.length) return cleaned;

  const pr = projector(ends[0].p);
  const xy = ends.map((e) => pr.xy(e.p));
  const parent = ends.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const snap2 = snapM * snapM;
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const dx = xy[i][0] - xy[j][0];
      const dy = xy[i][1] - xy[j][1];
      if (dx * dx + dy * dy <= snap2) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }

  const groups = new Map<number, number[]>();
  ends.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  const centroid = new Map<number, Pt>();
  for (const [r, idxs] of groups) {
    let x = 0;
    let y = 0;
    for (const i of idxs) {
      x += ends[i].p[0];
      y += ends[i].p[1];
    }
    centroid.set(r, [x / idxs.length, y / idxs.length]);
  }

  const out = cleaned.map((line) => line.slice());
  for (let i = 0; i < ends.length; i++) {
    const c = centroid.get(find(i))!;
    const line = out[ends[i].li];
    if (ends[i].end === 0) line[0] = c;
    else line[line.length - 1] = c;
  }
  return out;
}

export function stitchLines(lines: Pt[][], snapM = SNAP_METERS): Pt[][] {
  const parts = snapLines(lines, snapM);
  const n = parts.length;
  if (!n) return [];

  const aKey = parts.map((l) => keyOf(l[0]));
  const bKey = parts.map((l) => keyOf(l[l.length - 1]));
  const adj = new Map<string, { i: number; atStart: boolean }[]>();
  const add = (k: string, e: { i: number; atStart: boolean }) => {
    const list = adj.get(k);
    if (list) list.push(e);
    else adj.set(k, [e]);
  };
  for (let i = 0; i < n; i++) {
    add(aKey[i], { i, atStart: true });
    add(bKey[i], { i, atStart: false });
  }

  const used = new Array(n).fill(false);
  const out: Pt[][] = [];
  const otherKey = (i: number, atStart: boolean) => (atStart ? bKey[i] : aKey[i]);
  const coordsFrom = (i: number, startAtStart: boolean) => (startAtStart ? parts[i] : parts[i].slice().reverse());

  const walk = (startI: number, startAtStart: boolean) => {
    used[startI] = true;
    let acc = coordsFrom(startI, startAtStart).slice();
    let node = otherKey(startI, startAtStart);
    while (true) {
      const edges = (adj.get(node) || []).filter((e) => !used[e.i]);
      if (edges.length !== 1) break;
      const e = edges[0];
      used[e.i] = true;
      acc = acc.concat(coordsFrom(e.i, e.atStart).slice(1));
      node = otherKey(e.i, e.atStart);
    }
    if (acc.length >= 3 && keyOf(acc[0]) === keyOf(acc[acc.length - 1])) {
      if (acc[0][0] !== acc[acc.length - 1][0] || acc[0][1] !== acc[acc.length - 1][1]) acc.push(acc[0]);
    }
    out.push(acc);
  };

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const degA = (adj.get(aKey[i]) || []).length;
    const degB = (adj.get(bKey[i]) || []).length;
    if (degA === 1 && degB !== 1) walk(i, true);
    else if (degB === 1 && degA !== 1) walk(i, false);
  }
  for (let i = 0; i < n; i++) {
    if (!used[i]) walk(i, true);
  }
  return out;
}

export function flattenPolygons(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Polygon[] {
  if (geom.type === "Polygon") return [geom];
  return geom.coordinates.map((coordinates) => ({ type: "Polygon" as const, coordinates }));
}

export function bufferLine(coords: Pt[], meters: number): GeoJSON.Polygon[] {
  const line = uniq(coords);
  if (line.length < 2 || !(meters > 0)) return [];
  const feat = buffer(lineString(line), meters, { units: "meters", steps: 8 });
  if (!feat?.geometry) return [];
  return flattenPolygons(feat.geometry);
}

export function polygonPartCount(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined) {
  if (!geom) return 0;
  return geom.type === "Polygon" ? 1 : geom.coordinates.length;
}

export function ringVertexCount(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined) {
  if (!geom) return 0;
  const rings = geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  return rings.reduce((n, r) => n + Math.max(0, r.length - 1), 0);
}

function asClipPolygon(p: GeoJSON.Polygon): [number, number][][] {
  return p.coordinates.map((ring) => ring.map((c) => [Number(c[0]), Number(c[1])] as [number, number]));
}

export function unionPolygons(polys: GeoJSON.Polygon[]): {
  ok: boolean;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
} {
  const valid = polys.filter((p) => p.coordinates[0] && p.coordinates[0].length >= 4);
  if (!valid.length) return { ok: true, geometry: null };
  if (valid.length === 1) return { ok: true, geometry: valid[0] };

  try {
    let acc: ClipMulti = [asClipPolygon(valid[0])];
    for (let i = 1; i < valid.length; i++) {
      acc = polygonClipping.union(acc, asClipPolygon(valid[i]));
    }
    if (!acc.length) return { ok: false, geometry: null };
    if (acc.length === 1) {
      return { ok: true, geometry: { type: "Polygon", coordinates: acc[0] as GeoJSON.Position[][] } };
    }
    return { ok: true, geometry: { type: "MultiPolygon", coordinates: acc as GeoJSON.Position[][][] } };
  } catch {
    return {
      ok: false,
      geometry: { type: "MultiPolygon", coordinates: valid.map((p) => p.coordinates) },
    };
  }
}

/** Pairwise overlap area of MultiPolygon parts. 0 means no stacked fills. */
export function overlapArea(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null | undefined) {
  if (!geom || geom.type === "Polygon") return 0;
  const parts = geom.coordinates;
  let area = 0;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      try {
        const hit = polygonClipping.intersection(
          parts[i] as [number, number][][],
          parts[j] as [number, number][][]
        );
        for (const poly of hit) {
          const ring = poly[0];
          if (!ring || ring.length < 4) continue;
          let a = 0;
          for (let k = 0; k < ring.length - 1; k++) a += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1];
          area += Math.abs(a) / 2;
        }
      } catch {
        area += 1;
      }
    }
  }
  return area;
}

/** Geographic halo width. Pixel-constant buffers were rebuilt on zoom and lagged. */
export const HALO_METERS = 5;

export type GlowOpts = { zoom?: number; lat?: number; pixelWidth?: number; meters?: number };

export function glowGeometry(features: GeoJSON.Feature[], opts: GlowOpts = {}): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  const lines: Pt[][] = [];
  let lat = opts.lat ?? 45.8;

  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Point") {
      lat = (g.coordinates as Pt)[1];
      out.push({ type: "Feature", properties: { kind: "pt" }, geometry: g });
      continue;
    }
    if (g.type === "MultiPoint") {
      for (const c of g.coordinates) {
        out.push({ type: "Feature", properties: { kind: "pt" }, geometry: { type: "Point", coordinates: c } });
      }
      continue;
    }
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      const first = g.type === "Polygon" ? g.coordinates[0]?.[0] : g.coordinates[0]?.[0]?.[0];
      if (first) lat = Number(first[1]);
      lines.push(
        ...(g.type === "Polygon" ? (g.coordinates as Pt[][]) : (g.coordinates.flat() as Pt[][]))
      );
      continue;
    }
    const extracted = linesFromGeometry(g);
    if (extracted[0]?.[0]) lat = extracted[0][0][1];
    lines.push(...extracted);
  }

  const outerM =
    opts.meters ??
    (opts.pixelWidth != null && opts.zoom != null
      ? Math.max(2.5, opts.pixelWidth * metersPerPixel(lat, opts.zoom))
      : HALO_METERS);

  const stitched = stitchLines(lines);
  const outerPolys: GeoJSON.Polygon[] = [];
  for (const line of stitched) {
    outerPolys.push(...bufferLine(line, outerM));
    if (line.length >= 2) {
      out.push({
        type: "Feature",
        properties: { kind: "path" },
        geometry: { type: "LineString", coordinates: line },
      });
    }
  }

  const outer = unionPolygons(outerPolys);
  if (outer.geometry) {
    out.push({
      type: "Feature",
      properties: { ring: "outer", unionOk: outer.ok, parts: polygonPartCount(outer.geometry) },
      geometry: outer.geometry,
    });
  }

  return { type: "FeatureCollection", features: out };
}

export function glowCollection(_map: MapLibreMap, hit: SearchHit): GeoJSON.FeatureCollection {
  return glowGeometry(hit.features, { meters: HALO_METERS });
}
