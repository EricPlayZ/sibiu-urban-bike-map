import { LngLatBounds } from "maplibre-gl";
import { isMobileViewport } from "./breakpoints";
import { normalizeStreetName, slugify } from "./space";

export type SearchKind = "street" | "neighborhood" | "school";

export type SearchHit = {
  id: string;
  kind: SearchKind;
  label: string;
  hint: string;
  features: GeoJSON.Feature[];
};

export type SearchFocus = {
  token: number;
  hit: SearchHit;
};

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  street: "Străzi",
  neighborhood: "Cartiere",
  school: "Școli",
};

const KIND_LIMIT: Record<SearchKind, number> = {
  neighborhood: 6,
  school: 6,
  street: 8,
};

const KIND_ORDER: SearchKind[] = ["neighborhood", "school", "street"];

/** Lowercase + fără diacritice, spațiile rămân (pt. căutare). */
export function foldSearch(text: string) {
  let n = String(text || "")
    .trim()
    .toLowerCase();
  const map: Record<string, string> = { ă: "a", â: "a", î: "i", ș: "s", ş: "s", ț: "t", ţ: "t" };
  for (const [a, b] of Object.entries(map)) n = n.split(a).join(b);
  return n.replace(/\s+/g, " ");
}

type IndexedHit = SearchHit & { hay: string };

export function buildSearchIndex(
  streets: GeoJSON.FeatureCollection | null,
  neighborhoods: GeoJSON.FeatureCollection | null,
  schools: GeoJSON.FeatureCollection | null,
  neighborhoodList: { slug: string; name: string }[]
): IndexedHit[] {
  const cartierName = new Map(neighborhoodList.map((n) => [n.slug, n.name]));
  const out: IndexedHit[] = [];

  const streetGroups = new Map<
    string,
    { label: string; features: GeoJSON.Feature[]; cartiers: Set<string> }
  >();
  for (const f of streets?.features || []) {
    if (!f.geometry) continue;
    const p = (f.properties || {}) as { name?: string; cartier?: string };
    const name = String(p.name || "").trim();
    if (!name) continue;
    const key = normalizeStreetName(name) || slugify(name);
    if (!key) continue;
    let g = streetGroups.get(key);
    if (!g) {
      g = { label: name, features: [], cartiers: new Set() };
      streetGroups.set(key, g);
    }
    g.features.push(f);
    const cartier = String(p.cartier || "").trim();
    if (cartier) g.cartiers.add(cartier);
  }
  for (const [key, g] of streetGroups) {
    const places = [...g.cartiers].map((s) => cartierName.get(s) || s).filter(Boolean);
    const hint =
      places.length > 2 ? `${places.length} cartiere` : places.join(" · ") || `${g.features.length} segmente`;
    out.push({
      id: `street:${key}`,
      kind: "street",
      label: g.label,
      hint,
      features: g.features,
      hay: foldSearch([g.label, key, ...places, ...g.cartiers].join(" ")),
    });
  }

  for (const f of neighborhoods?.features || []) {
    if (!f.geometry) continue;
    const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string; dissolve?: unknown };
    const slug = String(p.slug || "");
    const name = String(p.denumire || p.name || slug).trim();
    if (!slug || !name) continue;
    if (p.dissolve === true || p.dissolve === "true") continue;
    out.push({
      id: `neighborhood:${slug}`,
      kind: "neighborhood",
      label: name,
      hint: "Cartier",
      features: [f],
      hay: foldSearch(`${name} ${slug} cartier`),
    });
  }

  for (const f of schools?.features || []) {
    if (!f.geometry) continue;
    const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string };
    const slug = String(p.slug || "");
    const name = String(p.denumire || p.name || slug).trim();
    if (!slug || !name) continue;
    out.push({
      id: `school:${slug}`,
      kind: "school",
      label: name,
      hint: "Școală",
      features: [f],
      hay: foldSearch(`${name} ${slug} scoala liceu colegiu`),
    });
  }

  return out;
}

function scoreHit(hay: string, needle: string, labelFold: string): number {
  if (!needle) return 0;
  if (labelFold === needle) return 120;
  if (labelFold.startsWith(needle)) return 90;
  if (hay.startsWith(needle)) return 80;
  const word = hay.split(" ").some((w) => w.startsWith(needle));
  if (word) return 70;
  const idx = hay.indexOf(needle);
  if (idx >= 0) return Math.max(24, 56 - idx);
  return 0;
}

export function filterSearchHits(index: IndexedHit[], query: string): SearchHit[] {
  const needle = foldSearch(query);
  if (needle.length < 1) return [];

  const ranked = index
    .map((hit) => ({ hit, score: scoreHit(hit.hay, needle, foldSearch(hit.label)) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label, "ro"));

  const used: Record<SearchKind, number> = { street: 0, neighborhood: 0, school: 0 };
  const out: SearchHit[] = [];
  for (const { hit } of ranked) {
    if (used[hit.kind] >= KIND_LIMIT[hit.kind]) continue;
    used[hit.kind] += 1;
    out.push(hit);
  }
  return out;
}

export function groupSearchHits(hits: SearchHit[]): { kind: SearchKind; items: SearchHit[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, items: hits.filter((h) => h.kind === kind) })).filter((g) => g.items.length);
}

export function boundsOfFeatures(features: GeoJSON.Feature[]): LngLatBounds | null {
  const b = new LngLatBounds();
  let any = false;
  const extend = (lng: number, lat: number) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    b.extend([lng, lat]);
    any = true;
  };
  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords) || !coords.length) return;
    if (typeof coords[0] === "number") {
      extend(Number(coords[0]), Number(coords[1]));
      return;
    }
    for (const c of coords) walk(c);
  };
  for (const f of features) {
    const g = f.geometry;
    if (!g || g.type === "GeometryCollection") continue;
    walk(g.coordinates);
  }
  return any ? b : null;
}

export function hitAnchor(hit: SearchHit): [number, number] | null {
  for (const f of hit.features) {
    const g = f.geometry;
    if (g?.type === "Point") return g.coordinates as [number, number];
    if (g?.type === "MultiPoint" && g.coordinates[0]) return g.coordinates[0] as [number, number];
  }

  let best: number[] | null = null;
  let bestLen = -1;
  for (const f of hit.features) {
    const g = f.geometry;
    if (!g || g.type === "GeometryCollection") continue;
    const lines: number[][][] = [];
    if (g.type === "LineString") lines.push(g.coordinates);
    else if (g.type === "MultiLineString") lines.push(...g.coordinates);
    else if (g.type === "Polygon") lines.push(...g.coordinates);
    else if (g.type === "MultiPolygon") lines.push(...g.coordinates.flat());
    for (const line of lines) {
      let len = 0;
      for (let i = 1; i < line.length; i++) {
        len += Math.hypot(Number(line[i][0]) - Number(line[i - 1][0]), Number(line[i][1]) - Number(line[i - 1][1]));
      }
      if (len >= bestLen && line.length) {
        bestLen = len;
        best = line[Math.floor(line.length / 2)];
      }
    }
  }
  if (best) return [Number(best[0]), Number(best[1])];
  const b = boundsOfFeatures(hit.features);
  return b ? [b.getCenter().lng, b.getCenter().lat] : null;
}

export function hitPrimaryFeature(hit: SearchHit): GeoJSON.Feature | null {
  if (!hit.features.length) return null;
  if (hit.kind !== "street") return hit.features[0];
  let best = hit.features[0];
  let bestLen = -1;
  for (const f of hit.features) {
    const g = f.geometry;
    if (!g || (g.type !== "LineString" && g.type !== "MultiLineString")) continue;
    const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    let len = 0;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        len += Math.hypot(Number(line[i][0]) - Number(line[i - 1][0]), Number(line[i][1]) - Number(line[i - 1][1]));
      }
    }
    if (len > bestLen) {
      bestLen = len;
      best = f;
    }
  }
  return best;
}

/** Ease-out cubic — decelerare lină la sfârșitul zoom-ului. */
export function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

export function searchCameraPadding() {
  const mobile = isMobileViewport();
  return {
    top: 108,
    bottom: mobile ? 176 : 108,
    left: 48,
    right: 48,
  };
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
