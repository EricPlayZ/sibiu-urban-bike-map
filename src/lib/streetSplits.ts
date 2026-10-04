/**
 * Segmentarea străzilor: o stradă (feature cu `sid`) poate fi tăiată în bucăți în puncte alese de echipă,
 * ca fiecare bucată să aibă propriile măsurători.
 *
 * Model:
 *  - Fișierul (`street-splits.json`) ține doar puncte de tăiere [lng, lat] pe `sid`-ul original („rădăcina”).
 *  - Prima bucată păstrează `sid`-ul rădăcinii (deci editările existente rămân valabile).
 *  - Bucățile următoare primesc `sid = rădăcină + ":s" + cheia punctului de început`. Cheia vine din
 *    coordonate, nu din poziția în listă, așa că adăugarea altui punct nu mută editările celorlalte bucăți.
 */

import { lngLatDistanceMeters } from "./space";

export type SplitPoint = [number, number];

export const STREET_SPLITS_REL = "data/street-splits.json";
export const SPLIT_SEP = ":";
/** Puncte mai apropiate decât atât de capete / între ele sunt ignorate. */
export const MIN_PIECE_M = 3;
/** Cât de departe de linie (m) poate fi un punct salvat ca să mai fie folosit. */
export const SPLIT_SNAP_M = 25;
export const MAX_SPLITS_PER_STREET = 40;

export type StreetSplitsFile = {
  version: 1;
  updated_at?: string;
  splits: Record<string, SplitPoint[]>;
};

type Line = [number, number][];

function isForbiddenKey(key: string) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

export function emptyStreetSplits(): StreetSplitsFile {
  return { version: 1, splits: {} };
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

function parsePoint(v: unknown): SplitPoint | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const lng = Number(v[0]);
  const lat = Number(v[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [round6(lng), round6(lat)];
}

/** Fără duplicate (aceeași cheie) și cu limită pe stradă. */
function normalizePoints(points: SplitPoint[]): SplitPoint[] {
  const seen = new Set<string>();
  const out: SplitPoint[] = [];
  for (const p of points) {
    const k = pointKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.slice(0, MAX_SPLITS_PER_STREET);
}

export function parseStreetSplitsFile(data: unknown): StreetSplitsFile {
  const file = emptyStreetSplits();
  if (!data || typeof data !== "object" || Array.isArray(data)) return file;
  const root = data as Record<string, unknown>;
  if (typeof root.updated_at === "string" && root.updated_at.trim()) file.updated_at = root.updated_at.trim();
  const raw =
    root.splits && typeof root.splits === "object" && !Array.isArray(root.splits)
      ? (root.splits as Record<string, unknown>)
      : {};
  for (const [sid, value] of Object.entries(raw)) {
    if (isForbiddenKey(sid) || sid.includes(SPLIT_SEP) || !Array.isArray(value)) continue;
    const points = normalizePoints(value.map(parsePoint).filter((p): p is SplitPoint => p != null));
    if (points.length) file.splits[sid] = points;
  }
  return file;
}

export function serializeStreetSplitsFile(file: StreetSplitsFile): string {
  return JSON.stringify({ version: 1 as const, updated_at: file.updated_at, splits: file.splits }, null, 2) + "\n";
}

export function sanitizeSplitPoints(raw: unknown): SplitPoint[] {
  if (!Array.isArray(raw)) return [];
  return normalizePoints(raw.map(parsePoint).filter((p): p is SplitPoint => p != null));
}

/* ---------- ids ---------- */

export function rootSid(sid: string) {
  const i = sid.indexOf(SPLIT_SEP);
  return i < 0 ? sid : sid.slice(0, i);
}

export function isPieceSid(sid: string) {
  return sid.includes(SPLIT_SEP);
}

/** Cheie scurtă și stabilă dintr-un punct (6 zecimale → întreg → base36). */
export function pointKey(p: SplitPoint) {
  const [lng, lat] = p;
  return `${Math.round(lng * 1e6).toString(36)}-${Math.round(lat * 1e6).toString(36)}`;
}

export function pieceSid(root: string, start: SplitPoint | null) {
  return start ? `${root}${SPLIT_SEP}s${pointKey(start)}` : root;
}

/* ---------- geometrie ---------- */

export function featureLines(geometry: GeoJSON.Geometry | null | undefined): Line[] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates.map((c) => [c[0], c[1]] as [number, number])];
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.map((l) => l.map((c) => [c[0], c[1]] as [number, number]));
  }
  return [];
}

function linesTotal(lines: Line[]) {
  let s = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) s += lngLatDistanceMeters(l[i - 1], l[i]);
  return s;
}

export type LineProjection = { along: number; point: SplitPoint; distM: number };

/** Cel mai apropiat punct de pe linii + distanța parcursă de la început (m). */
export function projectOnLines(lines: Line[], p: SplitPoint): LineProjection | null {
  const mx = 111320 * Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
  const my = 111320;
  let best: LineProjection | null = null;
  let off = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const len = lngLatDistanceMeters(a, b);
      const bx = (b[0] - a[0]) * mx;
      const by = (b[1] - a[1]) * my;
      const px = (p[0] - a[0]) * mx;
      const py = (p[1] - a[1]) * my;
      const l2 = bx * bx + by * by;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, (px * bx + py * by) / l2)) : 0;
      const d = Math.hypot(px - bx * t, py - by * t);
      if (!best || d < best.distM) {
        best = {
          along: off + t * len,
          point: [round6(a[0] + (b[0] - a[0]) * t), round6(a[1] + (b[1] - a[1]) * t)],
          distM: d,
        };
      }
      off += len;
    }
  }
  return best;
}

function lerpPt(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Sub-liniile dintre distanțele `s0` și `s1` (m), în ordinea liniilor. */
export function sliceLines(lines: Line[], s0: number, s1: number): Line[] {
  const out: Line[] = [];
  let off = 0;
  for (const line of lines) {
    let cur: Line = [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const len = lngLatDistanceMeters(a, b);
      const A = off;
      const B = off + len;
      off = B;
      if (len <= 0) continue;
      const lo = Math.max(A, s0);
      const hi = Math.min(B, s1);
      if (hi - lo <= 1e-6) {
        if (cur.length >= 2) out.push(cur);
        cur = [];
        continue;
      }
      const start = lerpPt(a, b, (lo - A) / len);
      const end = lerpPt(a, b, (hi - A) / len);
      if (!cur.length) cur.push(start);
      cur.push(end);
    }
    if (cur.length >= 2) out.push(cur);
  }
  return out;
}

export type OrderedSplit = { along: number; stored: SplitPoint; point: SplitPoint };

/** Puncte valide, proiectate pe linie, sortate, fără duplicate / capete. */
export function orderSplits(lines: Line[], points: readonly SplitPoint[]): OrderedSplit[] {
  const total = linesTotal(lines);
  const proj: OrderedSplit[] = [];
  for (const stored of points) {
    const hit = projectOnLines(lines, stored);
    if (!hit || hit.distM > SPLIT_SNAP_M) continue;
    if (hit.along < MIN_PIECE_M || hit.along > total - MIN_PIECE_M) continue;
    proj.push({ along: hit.along, stored, point: hit.point });
  }
  proj.sort((a, b) => a.along - b.along);
  const out: OrderedSplit[] = [];
  for (const p of proj) {
    const prev = out[out.length - 1];
    if (prev && p.along - prev.along < MIN_PIECE_M) continue;
    out.push(p);
  }
  return out;
}

function linesToGeometry(lines: Line[]): GeoJSON.LineString | GeoJSON.MultiLineString {
  return lines.length === 1
    ? { type: "LineString", coordinates: lines[0] }
    : { type: "MultiLineString", coordinates: lines };
}

export type StreetPiece = {
  sid: string;
  index: number;
  count: number;
  startAlong: number;
  endAlong: number;
  lengthM: number;
  lines: Line[];
  /** Punctul de tăiere de la începutul bucății (null la prima). */
  start: SplitPoint | null;
};

/** Bucățile în care se împarte `feature` cu punctele date. Fără puncte valide → o singură bucată (rădăcina). */
export function computePieces(root: string, geometry: GeoJSON.Geometry | null | undefined, points: readonly SplitPoint[]): StreetPiece[] {
  const lines = featureLines(geometry);
  if (!lines.length) return [];
  const total = linesTotal(lines);
  const ordered = orderSplits(lines, points);
  const bounds = [0, ...ordered.map((o) => o.along), total];
  const pieces: StreetPiece[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = i === 0 ? null : ordered[i - 1].stored;
    const sliced = ordered.length ? sliceLines(lines, bounds[i], bounds[i + 1]) : lines;
    if (!sliced.length) continue;
    pieces.push({
      sid: pieceSid(root, start),
      index: i,
      count: bounds.length - 1,
      startAlong: bounds[i],
      endAlong: bounds[i + 1],
      lengthM: linesTotal(sliced),
      lines: sliced,
      start,
    });
  }
  return pieces;
}

export function splitFeature(feature: GeoJSON.Feature, points: readonly SplitPoint[]): GeoJSON.Feature[] {
  const props = (feature.properties || {}) as Record<string, unknown>;
  const root = String(props.sid || "");
  if (!root || !points.length) return [feature];
  const pieces = computePieces(root, feature.geometry, points);
  if (pieces.length <= 1) return [feature];
  return pieces.map((piece) => {
    const p: Record<string, unknown> = { ...props };
    p.sid = piece.sid;
    p.split_root = root;
    p.split_index = piece.index;
    p.split_count = piece.count;
    p.length_m = Math.round(piece.lengthM * 10) / 10;
    delete p.length;
    return { type: "Feature" as const, properties: p, geometry: linesToGeometry(piece.lines) };
  });
}

/**
 * Aplică toate segmentările pe colecție. Fără puncte pentru un `sid`, feature-ul rămâne aceeași referință.
 */
export function applyStreetSplits(
  streets: GeoJSON.FeatureCollection,
  splits: Record<string, SplitPoint[]>
): GeoJSON.FeatureCollection {
  if (!Object.keys(splits).length) return streets;
  const features: GeoJSON.Feature[] = [];
  let changed = false;
  for (const f of streets.features) {
    const sid = String((f.properties as { sid?: string } | null)?.sid || "");
    const pts = sid ? splits[sid] : undefined;
    if (!pts?.length) {
      features.push(f);
      continue;
    }
    const pieces = splitFeature(f, pts);
    if (pieces.length > 1 || pieces[0] !== f) changed = true;
    features.push(...pieces);
  }
  return changed ? { type: "FeatureCollection", features } : streets;
}

/**
 * Ce se întâmplă cu editările când punctele se schimbă:
 *  - `inherit`: bucată nouă → bucata veche din care a fost tăiată (primește o copie a măsurătorilor);
 *  - `removed`: bucăți care dispar (s-au unit cu cea dinainte).
 */
export function planSplitChange(
  root: string,
  geometry: GeoJSON.Geometry | null | undefined,
  oldPoints: readonly SplitPoint[],
  newPoints: readonly SplitPoint[]
): { inherit: Record<string, string>; removed: string[] } {
  const before = computePieces(root, geometry, oldPoints);
  const after = computePieces(root, geometry, newPoints);
  const beforeIds = new Set(before.map((p) => p.sid));
  const afterIds = new Set(after.map((p) => p.sid));
  const inherit: Record<string, string> = {};
  for (const piece of after) {
    if (beforeIds.has(piece.sid)) continue;
    // bucata nouă începe într-o bucată veche: cea care conține punctul de început
    const from = before.find((b) => piece.startAlong >= b.startAlong - 1e-6 && piece.startAlong < b.endAlong - 1e-6);
    if (from) inherit[piece.sid] = from.sid;
  }
  const removed = before.map((p) => p.sid).filter((sid) => !afterIds.has(sid));
  return { inherit, removed };
}

/** Sid-urile bucăților rezultate (pentru curățarea editărilor rămase orfane). */
export function pieceSidsFor(root: string, geometry: GeoJSON.Geometry | null | undefined, points: readonly SplitPoint[]): string[] {
  return computePieces(root, geometry, points).map((p) => p.sid);
}
