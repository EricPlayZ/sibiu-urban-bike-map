import polygonClipping from "polygon-clipping";
import type { Pt } from "./glowRibbon";
import {
  bikeAllowed,
  bikeOneway,
  speedKmh,
  tagsFromWay,
  walkAllowed,
  type IsochroneProfile,
} from "./routingAccess";

export { BIKE_KMH, WALK_KMH, type IsochroneProfile } from "./routingAccess";

export const ISOCHRONE_MINUTES = [5, 10, 15] as const;
export type IsochroneMinutes = (typeof ISOCHRONE_MINUTES)[number];

export const ISOCHRONE_BUFFER_M = 52;
export const ISOCHRONE_SNAP_M = 160;
const NODE_MERGE_M = 4;

/** Un blob pe ecran — culoare după mod, nu după minut. */
export const ISOCHRONE_STYLE: Record<
  IsochroneProfile,
  { fill: string; line: string; net: string; opacity: number }
> = {
  bike: { fill: "#00C853", line: "#01331c", net: "#00E676", opacity: 0.5 },
  walk: { fill: "#FF6D00", line: "#4A1600", net: "#FFAB40", opacity: 0.52 },
};

let drawnIsochrone: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
let lastOrigin: { lng: number; lat: number } | null = null;

export function lastIsochroneFeatures() {
  return drawnIsochrone;
}

export function setLastIsochroneFeatures(fc: GeoJSON.FeatureCollection) {
  drawnIsochrone = fc;
}

export function lastReachOrigin() {
  return lastOrigin;
}

export function setLastReachOrigin(pt: { lng: number; lat: number } | null) {
  lastOrigin = pt;
}

export type RoutingWay = {
  n: number[];
  h: string;
  f?: string;
  b?: string;
  a?: string;
  o?: string;
  ob?: string;
  cw?: string;
};

export type RoutingFile = {
  v: number;
  nodes: number[];
  ways: RoutingWay[];
};

type AdjEdge = { to: number; seconds: number };
type Seg = { a: number; b: number; lengthM: number; speedMps: number };

export type ProfileGraph = {
  n: number;
  lng: Float64Array;
  lat: Float64Array;
  adj: AdjEdge[][];
  segs: Seg[];
  grid: Map<number, number[]>;
  cell: number;
};

export type IsochroneEngine = {
  walk: ProfileGraph;
  bike: ProfileGraph;
};

export type IsochroneOk = {
  ok: true;
  features: GeoJSON.FeatureCollection;
  snapDistM: number;
};

export type IsochroneFail = { ok: false; reason: "no-graph" | "off-network" };
export type IsochroneResult = IsochroneOk | IsochroneFail;

type ClipMulti = [number, number][][][];

let enginePromise: Promise<IsochroneEngine> | null = null;

export function resetIsochroneEngineForTests() {
  enginePromise = null;
}

export function ensureIsochroneEngine(): Promise<IsochroneEngine> {
  if (!enginePromise) enginePromise = loadEngine();
  return enginePromise;
}

async function loadEngine(): Promise<IsochroneEngine> {
  try {
    const r = await fetch("./data/routing-graph.json", { signal: AbortSignal.timeout(20_000) });
    if (r.ok) return buildEngine((await r.json()) as RoutingFile);
  } catch {
    /* fallback */
  }
  const r2 = await fetch("./osm-streets.geojson", { signal: AbortSignal.timeout(20_000) });
  if (!r2.ok) throw new Error("routing-graph");
  return buildEngine(routingFromLineCollection((await r2.json()) as GeoJSON.FeatureCollection));
}

export function routingFromLineCollection(fc: GeoJSON.FeatureCollection): RoutingFile {
  const index = new Map<string, number>();
  const nodes: number[] = [];
  const nodeOf = (p: number[]) => {
    const k = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    const hit = index.get(k);
    if (hit != null) return hit;
    const i = nodes.length / 2;
    index.set(k, i);
    nodes.push(p[0], p[1]);
    return i;
  };
  const ways: RoutingWay[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    const h = String((f.properties as { highway?: string } | null)?.highway || "residential");
    for (const line of lines) {
      const n: number[] = [];
      for (const c of line) {
        if (!Array.isArray(c) || c.length < 2) continue;
        const i = nodeOf(c as number[]);
        if (!n.length || n[n.length - 1] !== i) n.push(i);
      }
      if (n.length >= 2) ways.push({ n, h });
    }
  }
  return { v: 1, nodes, ways };
}

export function buildEngine(file: RoutingFile): IsochroneEngine {
  const rawN = Math.floor(file.nodes.length / 2);
  const rawLng = new Float64Array(rawN);
  const rawLat = new Float64Array(rawN);
  for (let i = 0; i < rawN; i++) {
    rawLng[i] = file.nodes[i * 2];
    rawLat[i] = file.nodes[i * 2 + 1];
  }
  const merged = mergeCloseNodes(rawLng, rawLat, NODE_MERGE_M);
  const walk = emptyProfile(merged.n, merged.lng, merged.lat);
  const bike = emptyProfile(merged.n, merged.lng, merged.lat);

  for (const way of file.ways) {
    const ids: number[] = [];
    for (const raw of way.n) {
      if (raw < 0 || raw >= rawN) continue;
      const id = merged.remap[raw];
      if (id < 0) continue;
      if (!ids.length || ids[ids.length - 1] !== id) ids.push(id);
    }
    if (ids.length < 2) continue;
    const tags = tagsFromWay(way);
    if (walkAllowed(tags)) addWay(walk, ids, "walk", way.h, 0);
    if (bikeAllowed(tags)) addWay(bike, ids, "bike", way.h, bikeOneway(tags));
  }

  indexSegs(walk);
  indexSegs(bike);
  return { walk, bike };
}

function emptyProfile(n: number, lng: Float64Array, lat: Float64Array): ProfileGraph {
  return {
    n,
    lng,
    lat,
    adj: Array.from({ length: n }, () => []),
    segs: [],
    grid: new Map(),
    cell: 0.0014,
  };
}

function addWay(g: ProfileGraph, ids: number[], profile: IsochroneProfile, highway: string, dir: -1 | 0 | 1) {
  const speedMps = (speedKmh(profile, highway) * 1000) / 3600;
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i];
    const b = ids[i + 1];
    const lengthM = distM(g.lng[a], g.lat[a], g.lng[b], g.lat[b]);
    if (!(lengthM > 0.4)) continue;
    const seconds = lengthM / speedMps;
    g.segs.push({ a, b, lengthM, speedMps });
    if (dir >= 0) g.adj[a].push({ to: b, seconds });
    if (dir <= 0) g.adj[b].push({ to: a, seconds });
  }
}

function mergeCloseNodes(lng: Float64Array, lat: Float64Array, snapM: number) {
  const n = lng.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    let y = i;
    while (parent[y] !== y) {
      const p = parent[y];
      parent[y] = x;
      y = p;
    }
    return x;
  };
  const stepLng = snapM / (111320 * 0.7);
  const stepLat = snapM / 111320;
  const buckets = new Map<number, number[]>();
  const keyOf = (ix: number, iy: number) => ix * 200000 + iy;
  for (let i = 0; i < n; i++) {
    const ix = Math.floor(lng[i] / stepLng);
    const iy = Math.floor(lat[i] / stepLat);
    const k = keyOf(ix, iy);
    const list = buckets.get(k);
    if (list) list.push(i);
    else buckets.set(k, [i]);
  }
  const visitNear = (i: number, j: number) => {
    if (i >= j) return;
    if (distM(lng[i], lat[i], lng[j], lat[j]) > snapM) return;
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < n; i++) {
    const ix = Math.floor(lng[i] / stepLng);
    const iy = Math.floor(lat[i] / stepLat);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = buckets.get(keyOf(ix + dx, iy + dy));
        if (!list) continue;
        for (const j of list) visitNear(i, j);
      }
    }
  }

  const remap = new Int32Array(n);
  remap.fill(-1);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (remap[r] < 0) remap[r] = count++;
  }
  for (let i = 0; i < n; i++) remap[i] = remap[find(i)];

  const outLng = new Float64Array(count);
  const outLat = new Float64Array(count);
  const acc = new Float64Array(count * 2);
  const w = new Int32Array(count);
  for (let i = 0; i < n; i++) {
    const k = remap[i];
    acc[k * 2] += lng[i];
    acc[k * 2 + 1] += lat[i];
    w[k]++;
  }
  for (let k = 0; k < count; k++) {
    const d = Math.max(1, w[k]);
    outLng[k] = acc[k * 2] / d;
    outLat[k] = acc[k * 2 + 1] / d;
  }
  return { n: count, lng: outLng, lat: outLat, remap };
}

function indexSegs(g: ProfileGraph) {
  g.grid.clear();
  const c = g.cell;
  for (let i = 0; i < g.segs.length; i++) {
    const s = g.segs[i];
    const minX = Math.min(g.lng[s.a], g.lng[s.b]);
    const maxX = Math.max(g.lng[s.a], g.lng[s.b]);
    const minY = Math.min(g.lat[s.a], g.lat[s.b]);
    const maxY = Math.max(g.lat[s.a], g.lat[s.b]);
    const x0 = Math.floor(minX / c);
    const x1 = Math.floor(maxX / c);
    const y0 = Math.floor(minY / c);
    const y1 = Math.floor(maxY / c);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = x * 200000 + y;
        const list = g.grid.get(k);
        if (list) list.push(i);
        else g.grid.set(k, [i]);
      }
    }
  }
}

export function distM(lng1: number, lat1: number, lng2: number, lat2: number) {
  const av = ((lat1 + lat2) * Math.PI) / 360;
  const dx = (lng2 - lng1) * Math.cos(av) * 111320;
  const dy = (lat2 - lat1) * 111320;
  return Math.hypot(dx, dy);
}

function projectSeg(
  lng: number,
  lat: number,
  alng: number,
  alat: number,
  blng: number,
  blat: number
): { t: number; lng: number; lat: number; distM: number } {
  const mLng = 111320 * Math.max(0.2, Math.cos((alat * Math.PI) / 180));
  const ax = 0;
  const ay = 0;
  const bx = (blng - alng) * mLng;
  const by = (blat - alat) * 111320;
  const px = (lng - alng) * mLng;
  const py = (lat - alat) * 111320;
  const len2 = bx * bx + by * by;
  const t = len2 > 1e-6 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  const qx = ax + bx * t;
  const qy = ay + by * t;
  return {
    t,
    lng: alng + (bx * t) / mLng,
    lat: alat + (qy - ay) / 111320,
    distM: Math.hypot(px - qx, py - qy),
  };
}

type Snap = {
  a: number;
  b: number;
  t: number;
  lng: number;
  lat: number;
  distM: number;
  lengthM: number;
  speedMps: number;
};

function snapToGraph(g: ProfileGraph, lng: number, lat: number, maxM: number): Snap | null {
  const padLng = maxM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const padLat = maxM / 111320;
  const x0 = Math.floor((lng - padLng) / g.cell);
  const x1 = Math.floor((lng + padLng) / g.cell);
  const y0 = Math.floor((lat - padLat) / g.cell);
  const y1 = Math.floor((lat + padLat) / g.cell);
  const seen = new Set<number>();
  let best: Snap | null = null;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const list = g.grid.get(x * 200000 + y);
      if (!list) continue;
      for (const i of list) {
        if (seen.has(i)) continue;
        seen.add(i);
        const s = g.segs[i];
        const hit = projectSeg(lng, lat, g.lng[s.a], g.lat[s.a], g.lng[s.b], g.lat[s.b]);
        if (hit.distM > maxM) continue;
        if (!best || hit.distM < best.distM) {
          best = {
            a: s.a,
            b: s.b,
            t: hit.t,
            lng: hit.lng,
            lat: hit.lat,
            distM: hit.distM,
            lengthM: s.lengthM,
            speedMps: s.speedMps,
          };
        }
      }
    }
  }
  return best;
}

function heapPush(h: { t: number; n: number }[], x: { t: number; n: number }) {
  h.push(x);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].t <= h[i].t) break;
    const tmp = h[p];
    h[p] = h[i];
    h[i] = tmp;
    i = p;
  }
}

function heapPop(h: { t: number; n: number }[]) {
  const top = h[0];
  const last = h.pop();
  if (!h.length || !last) return top;
  h[0] = last;
  let i = 0;
  for (;;) {
    const l = i * 2 + 1;
    const r = l + 1;
    let s = i;
    if (l < h.length && h[l].t < h[s].t) s = l;
    if (r < h.length && h[r].t < h[s].t) s = r;
    if (s === i) break;
    const tmp = h[i];
    h[i] = h[s];
    h[s] = tmp;
    i = s;
  }
  return top;
}

function dijkstra(g: ProfileGraph, seeds: { n: number; t: number }[], maxT: number): Float64Array {
  const times = new Float64Array(g.n);
  times.fill(Number.POSITIVE_INFINITY);
  const heap: { t: number; n: number }[] = [];
  for (const s of seeds) {
    if (s.t >= times[s.n]) continue;
    times[s.n] = s.t;
    heapPush(heap, { n: s.n, t: s.t });
  }
  while (heap.length) {
    const cur = heapPop(heap)!;
    if (cur.t !== times[cur.n]) continue;
    if (cur.t > maxT) continue;
    const edges = g.adj[cur.n];
    for (let i = 0; i < edges.length; i++) {
      const nt = cur.t + edges[i].seconds;
      if (nt >= times[edges[i].to] || nt > maxT + 0.05) continue;
      times[edges[i].to] = nt;
      heapPush(heap, { n: edges[i].to, t: nt });
    }
  }
  return times;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clipSeg(g: ProfileGraph, s: Seg, ta: number, tb: number, maxT: number): Pt[][] {
  const a: Pt = [g.lng[s.a], g.lat[s.a]];
  const b: Pt = [g.lng[s.b], g.lat[s.b]];
  const fromA = ta <= maxT ? Math.min(1, Math.max(0, ((maxT - ta) * s.speedMps) / s.lengthM)) : 0;
  const fromB = tb <= maxT ? Math.min(1, Math.max(0, ((maxT - tb) * s.speedMps) / s.lengthM)) : 0;
  if (fromA + fromB >= 0.999) return [[a, b]];
  const out: Pt[][] = [];
  if (fromA > 0.012) out.push([a, [lerp(a[0], b[0], fromA), lerp(a[1], b[1], fromA)]]);
  if (fromB > 0.012) out.push([[lerp(b[0], a[0], fromB), lerp(b[1], a[1], fromB)], b]);
  return out;
}

export function reachableLines(g: ProfileGraph, times: Float64Array, maxT: number, extra: Pt[][]): Pt[][] {
  const lines: Pt[][] = extra.map((l) => l.slice());
  for (const s of g.segs) {
    const ta = times[s.a];
    const tb = times[s.b];
    if (ta > maxT && tb > maxT) continue;
    lines.push(...clipSeg(g, s, ta, tb, maxT));
  }
  return lines;
}

function asClip(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): ClipMulti {
  return (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as ClipMulti;
}

function fromClip(c: ClipMulti): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!c.length) return null;
  if (c.length === 1) return { type: "Polygon", coordinates: c[0] as GeoJSON.Position[][] };
  return { type: "MultiPolygon", coordinates: c as GeoJSON.Position[][][] };
}

function subtractGeom(
  a: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  b: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
) {
  if (!b) return a;
  try {
    const d = polygonClipping.difference(asClip(a), asClip(b));
    return fromClip(d) || a;
  } catch {
    return a;
  }
}

function polygonFromLines(lines: Pt[][], meters: number): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const cleaned = lines.map(uniqLine).filter((l) => l.length >= 2);
  if (!cleaned.length) return null;
  return rasterPolygon(cleaned, meters);
}

function uniqLine(line: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of line) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}

function rasterPolygon(lines: Pt[][], padM: number): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const line of lines) {
    for (const p of line) {
      if (p[0] < minLng) minLng = p[0];
      if (p[0] > maxLng) maxLng = p[0];
      if (p[1] < minLat) minLat = p[1];
      if (p[1] > maxLat) maxLat = p[1];
    }
  }
  if (!Number.isFinite(minLng)) return null;

  const lat0 = (minLat + maxLat) / 2;
  const mLng = 111320 * Math.max(0.2, Math.cos((lat0 * Math.PI) / 180));
  const mLat = 111320;
  const padLng = padM / mLng;
  const padLat = padM / mLat;
  minLng -= padLng;
  maxLng += padLng;
  minLat -= padLat;
  maxLat += padLat;

  const widthM = (maxLng - minLng) * mLng;
  const heightM = (maxLat - minLat) * mLat;
  let cell = 26;
  const maxDim = 360;
  if (widthM / cell > maxDim) cell = widthM / maxDim;
  if (heightM / cell > maxDim) cell = Math.max(cell, heightM / maxDim);
  const nx = Math.max(4, Math.ceil(widthM / cell) + 1);
  const ny = Math.max(4, Math.ceil(heightM / cell) + 1);
  const grid = new Uint8Array(nx * ny);
  const toCell = (lng: number, lat: number): [number, number] => [
    ((lng - minLng) * mLng) / cell,
    ((lat - minLat) * mLat) / cell,
  ];

  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = toCell(line[i - 1][0], line[i - 1][1]);
      const [x1, y1] = toCell(line[i][0], line[i][1]);
      paintLine(grid, nx, ny, x0, y0, x1, y1);
    }
  }

  const grow = Math.max(1, Math.round(padM / cell));
  dilate(grid, nx, ny, grow);
  sealReachGrid(grid, nx, ny);

  const rings = marchingRings(grid, nx, ny, minLng, minLat, cell / mLng, cell / mLat);
  const oriented = rings
    .map((r) => (ringArea(r) < 0 ? r.slice().reverse() : r))
    .filter((r) => Math.abs(ringArea(r)) > 1e-14);
  if (!oriented.length) return null;
  if (oriented.length === 1) return { type: "Polygon", coordinates: [oriented[0]] };
  try {
    let acc: ClipMulti = [[oriented[0] as [number, number][]]];
    for (let i = 1; i < oriented.length; i++) {
      acc = polygonClipping.union(acc, [[oriented[i] as [number, number][]]]);
    }
    return fromClip(acc);
  } catch {
    return { type: "MultiPolygon", coordinates: oriented.map((r) => [r]) };
  }
}

function plotCell(grid: Uint8Array, nx: number, ny: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= nx || y >= ny) return;
  grid[y * nx + x] = 1;
}

function paintLine(grid: Uint8Array, nx: number, ny: number, x0: number, y0: number, x1: number, y1: number) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  let prevX = Math.round(x0);
  let prevY = Math.round(y0);
  plotCell(grid, nx, ny, prevX, prevY);
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    if (x !== prevX && y !== prevY) plotCell(grid, nx, ny, x, prevY);
    plotCell(grid, nx, ny, x, y);
    prevX = x;
    prevY = y;
  }
}

/** Închide gâturile pe diagonală (fjord-uri de 1 celulă) și găurile interioare. */
export function sealReachGrid(grid: Uint8Array, nx: number, ny: number) {
  bridgeDiagonals(grid, nx, ny);
  dilate(grid, nx, ny, 1);
  erode(grid, nx, ny);
  fillInteriorHoles(grid, nx, ny);
  bridgeDiagonals(grid, nx, ny);
}

function bridgeDiagonals(grid: Uint8Array, nx: number, ny: number) {
  const src = grid.slice();
  for (let y = 0; y < ny - 1; y++) {
    for (let x = 0; x < nx - 1; x++) {
      const a = src[y * nx + x];
      const b = src[y * nx + x + 1];
      const c = src[(y + 1) * nx + x];
      const d = src[(y + 1) * nx + x + 1];
      if (a && d && !b && !c) {
        grid[y * nx + x + 1] = 1;
        grid[(y + 1) * nx + x] = 1;
      } else if (b && c && !a && !d) {
        grid[y * nx + x] = 1;
        grid[(y + 1) * nx + x + 1] = 1;
      }
    }
  }
}

function fillInteriorHoles(grid: Uint8Array, nx: number, ny: number) {
  const seen = new Uint8Array(grid.length);
  const qx = new Int32Array(grid.length);
  const qy = new Int32Array(grid.length);
  let head = 0;
  let tail = 0;
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= nx || y >= ny) return;
    const i = y * nx + x;
    if (grid[i] || seen[i]) return;
    seen[i] = 1;
    qx[tail] = x;
    qy[tail] = y;
    tail++;
  };
  for (let x = 0; x < nx; x++) {
    push(x, 0);
    push(x, ny - 1);
  }
  for (let y = 0; y < ny; y++) {
    push(0, y);
    push(nx - 1, y);
  }
  while (head < tail) {
    const x = qx[head];
    const y = qy[head];
    head++;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] && !seen[i]) grid[i] = 1;
  }
}

function dilate(grid: Uint8Array, nx: number, ny: number, rounds: number) {
  const tmp = new Uint8Array(grid.length);
  for (let r = 0; r < rounds; r++) {
    tmp.set(grid);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (tmp[y * nx + x]) continue;
        let hit = 0;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
            if (tmp[yy * nx + xx]) {
              hit = 1;
              break;
            }
          }
        }
        if (hit) grid[y * nx + x] = 1;
      }
    }
  }
}

function erode(grid: Uint8Array, nx: number, ny: number) {
  const src = grid.slice();
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      if (!src[y * nx + x]) continue;
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= nx || yy >= ny || !src[yy * nx + xx]) {
            keep = 0;
            break;
          }
        }
      }
      grid[y * nx + x] = keep;
    }
  }
}

function cellVal(grid: Uint8Array, nx: number, ny: number, x: number, y: number) {
  if (x < 0 || y < 0 || x >= nx || y >= ny) return 0;
  return grid[y * nx + x];
}

function marchingRings(
  grid: Uint8Array,
  nx: number,
  ny: number,
  minLng: number,
  minLat: number,
  cellLng: number,
  cellLat: number
): GeoJSON.Position[][] {
  const segs: [Pt, Pt][] = [];
  const pt = (x: number, y: number): Pt => [minLng + x * cellLng, minLat + y * cellLat];
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const tl = cellVal(grid, nx, ny, x, y + 1);
      const tr = cellVal(grid, nx, ny, x + 1, y + 1);
      const br = cellVal(grid, nx, ny, x + 1, y);
      const bl = cellVal(grid, nx, ny, x, y);
      const idx = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (idx === 0 || idx === 15) continue;
      const l: Pt = pt(x, y + 0.5);
      const r: Pt = pt(x + 1, y + 0.5);
      const b: Pt = pt(x + 0.5, y);
      const t: Pt = pt(x + 0.5, y + 1);
      const add = (a: Pt, c: Pt) => segs.push([a, c]);
      switch (idx) {
        case 1: add(l, b); break;
        case 2: add(b, r); break;
        case 3: add(l, r); break;
        case 4: add(t, r); break;
        case 5: add(l, t); add(b, r); break;
        case 6: add(t, b); break;
        case 7: add(l, t); break;
        case 8: add(l, t); break;
        case 9: add(t, b); break;
        case 10: add(l, b); add(t, r); break;
        case 11: add(t, r); break;
        case 12: add(l, r); break;
        case 13: add(b, r); break;
        case 14: add(l, b); break;
        default: break;
      }
    }
  }
  return stitchSegs(segs);
}

function keyPt(p: Pt) {
  return `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
}

function stitchSegs(segs: [Pt, Pt][]): GeoJSON.Position[][] {
  const adj = new Map<string, { p: Pt; q: Pt; used: boolean }[]>();
  const add = (p: Pt, q: Pt) => {
    const k = keyPt(p);
    const rec = { p, q, used: false };
    const list = adj.get(k);
    if (list) list.push(rec);
    else adj.set(k, [rec]);
  };
  for (const [a, b] of segs) {
    add(a, b);
    add(b, a);
  }
  const rings: GeoJSON.Position[][] = [];
  for (const startList of adj.values()) {
    for (const start of startList) {
      if (start.used) continue;
      const ring: Pt[] = [start.p];
      start.used = true;
      const twin = (adj.get(keyPt(start.q)) || []).find((e) => keyPt(e.q) === keyPt(start.p) && !e.used);
      if (twin) twin.used = true;
      let cur = start.q;
      ring.push(cur);
      for (let guard = 0; guard < segs.length + 4; guard++) {
        if (keyPt(cur) === keyPt(ring[0]) && ring.length > 3) break;
        const next = (adj.get(keyPt(cur)) || []).find((e) => !e.used);
        if (!next) break;
        next.used = true;
        const back = (adj.get(keyPt(next.q)) || []).find((e) => keyPt(e.q) === keyPt(cur) && !e.used);
        if (back) back.used = true;
        cur = next.q;
        ring.push(cur);
      }
      if (ring.length >= 4) {
        if (keyPt(ring[0]) !== keyPt(ring[ring.length - 1])) ring.push(ring[0]);
        if (ring.length >= 4) rings.push(ring);
      }
    }
  }
  return rings;
}

function ringArea(ring: GeoJSON.Position[]) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

function connectorLines(origin: Pt, snap: Snap, times: Float64Array, maxT: number): Pt[][] {
  const start: Pt = [origin[0], origin[1]];
  const mid: Pt = [snap.lng, snap.lat];
  const tSnap = Math.min(times[snap.a] + (snap.t * snap.lengthM) / snap.speedMps, times[snap.b] + ((1 - snap.t) * snap.lengthM) / snap.speedMps);
  const lines: Pt[][] = [];
  if (tSnap <= maxT && distM(start[0], start[1], mid[0], mid[1]) > 2) lines.push([start, mid]);
  return lines;
}

function seedsFromSnap(origin: Pt, snap: Snap): { n: number; t: number }[] {
  const tWalk = distM(origin[0], origin[1], snap.lng, snap.lat) / snap.speedMps;
  const tA = tWalk + (snap.t * snap.lengthM) / snap.speedMps;
  const tB = tWalk + ((1 - snap.t) * snap.lengthM) / snap.speedMps;
  return [
    { n: snap.a, t: tA },
    { n: snap.b, t: tB },
  ];
}

function profileGraph(engine: IsochroneEngine, profile: IsochroneProfile) {
  return profile === "bike" ? engine.bike : engine.walk;
}

export function computeIsochrones(
  engine: IsochroneEngine,
  origin: { lng: number; lat: number },
  opts?: {
    profiles?: IsochroneProfile[];
    minutes?: readonly number[];
    bufferM?: number;
    snapM?: number;
  }
): IsochroneResult {
  const profiles = opts?.profiles?.length ? opts.profiles : (["bike", "walk"] as IsochroneProfile[]);
  const minutes = (opts?.minutes?.length ? opts.minutes : ISOCHRONE_MINUTES).slice().sort((a, b) => a - b);
  const bufferM = opts?.bufferM ?? ISOCHRONE_BUFFER_M;
  const snapM = opts?.snapM ?? ISOCHRONE_SNAP_M;
  const originPt: Pt = [origin.lng, origin.lat];
  const features: GeoJSON.Feature[] = [];
  let snapDistM = Infinity;
  let any = false;

  for (const profile of profiles) {
    const g = profileGraph(engine, profile);
    if (!g.segs.length) continue;
    const snap = snapToGraph(g, origin.lng, origin.lat, snapM);
    if (!snap) continue;
    any = true;
    snapDistM = Math.min(snapDistM, snap.distM);
    const maxTAll = minutes[minutes.length - 1] * 60;
    const times = dijkstra(g, seedsFromSnap(originPt, snap), maxTAll);
    const polys: { minutes: number; geom: GeoJSON.Polygon | GeoJSON.MultiPolygon }[] = [];
    for (const m of minutes) {
      const maxT = m * 60;
      const extra = connectorLines(originPt, snap, times, maxT);
      if (distM(originPt[0], originPt[1], snap.lng, snap.lat) > 2 && extra.length === 0 && maxT >= 0) {
        extra.push([originPt, [snap.lng, snap.lat]]);
      }
      const lines = reachableLines(g, times, maxT, extra);
      const geom = polygonFromLines(lines, bufferM);
      if (geom) polys.push({ minutes: m, geom });
      if (lines.length && m === minutes[minutes.length - 1]) {
        features.push({
          type: "Feature",
          properties: { profile, minutes: m, kind: "net", net: ISOCHRONE_STYLE[profile].net },
          geometry: { type: "MultiLineString", coordinates: lines },
        });
      }
    }
    for (let i = polys.length - 1; i >= 0; i--) {
      const inner = polys[i - 1]?.geom ?? null;
      const geom = inner ? subtractGeom(polys[i].geom, inner) : polys[i].geom;
      const m = polys[i].minutes as IsochroneMinutes;
      const style = ISOCHRONE_STYLE[profile];
      features.push({
        type: "Feature",
        properties: {
          profile,
          minutes: m,
          kind: "band",
          fill: style.fill,
          line: style.line,
          net: style.net,
          opacity: style.opacity,
        },
        geometry: geom,
      });
    }
  }

  if (!any) return { ok: false, reason: "off-network" };
  return { ok: true, features: { type: "FeatureCollection", features }, snapDistM };
}

export async function computeIsochronesAt(
  origin: { lng: number; lat: number },
  opts?: {
    profiles?: IsochroneProfile[];
    minutes?: readonly number[];
  }
): Promise<IsochroneResult> {
  try {
    const engine = await ensureIsochroneEngine();
    return computeIsochrones(engine, origin, opts);
  } catch {
    return { ok: false, reason: "no-graph" };
  }
}
