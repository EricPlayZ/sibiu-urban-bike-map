import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map } from "maplibre-gl";
import { glowCollection } from "./glowRibbon";
import {
  boundsOfFeatures,
  easeOutCubic,
  prefersReducedMotion,
  searchCameraPadding,
  type SearchHit,
} from "./mapSearch";
import { useApp } from "../store";

export const SEARCH_HL = "search-hl";

const FILL_GLOW = [{ id: "search-glow-fill-outer", ring: "outer", opacityScale: 0.5 }] as const;
const PATH_GLOW = ["search-glow-path-dark", "search-glow-path-light"] as const;
const POINT_GLOW = ["search-glow-pt-bloom", "search-glow-pt-ring"] as const;
const GLOW_OVERLAY = [...PATH_GLOW, ...POINT_GLOW] as const;
const GLOW_LAYERS = [...FILL_GLOW.map((l) => l.id), ...GLOW_OVERLAY] as const;

const STREET_DIM_LAYERS = [
  "streets-base",
  "streets-school",
  "streets-bike",
  "streets-bike-door",
  "streets-reserved",
  "streets-illegal",
  "streets-halo",
  "streets-edit",
] as const;

const DIM_STREET = 0.18;
const DIM_NB_FILL = 0.025;
const DIM_NB_HALO = 0.18;
const DIM_NB_LINE = 0.22;
const DIM_BLD_FILL = 0.16;
const DIM_BLD_LINE = 0.1;
const GLOW_PEAK = 0.92;

let glowRaf = 0;
let glowToken = 0;

function empty(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function uniqueProp(hit: SearchHit, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of hit.features) {
    const v = String((f.properties as Record<string, unknown> | null)?.[key] || "");
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function keepOrDim(full: number, ids: string[], prop: string, dim: number): number | ExpressionSpecification {
  if (!ids.length) return dim;
  return ["case", ["in", ["to-string", ["get", prop]], ["literal", ids]], full, dim];
}

function neonForBasemap(map: Map): {
  fill: string;
  pathDark: string;
  pathLight: string;
  bloom: string;
  ring: string;
  mid: string;
} {
  const style = map.getStyle();
  const name = String(style?.name || "").toLowerCase();
  const dark = name.includes("dark") || name.includes("satellite") || document.documentElement.dataset.theme === "dark";
  if (dark) {
    return {
      fill: "#f7fff9",
      pathDark: "#050505",
      pathLight: "#ffffff",
      bloom: "#ffffff",
      ring: "#ffffff",
      mid: "#0a0a0a",
    };
  }
  return {
    fill: "#ffffff",
    pathDark: "#070707",
    pathLight: "#ffffff",
    bloom: "#ffffff",
    ring: "#ffffff",
    mid: "#0a0a0a",
  };
}

function setPaint(map: Map, id: string, prop: string, value: unknown) {
  if (!map.getLayer(id)) return;
  map.setPaintProperty(id, prop as never, value as never);
}

export function applySearchDim(map: Map, hit: SearchHit | null) {
  const { layers, basemap } = useApp.getState();
  const darkBg = ["dark", "satellite"].includes(basemap);
  const streetBaseFull = layers.buildings && !layers.bike ? 0.28 : 0.55;
  const nbFillFull = darkBg ? 0.12 : 0.07;
  const nbHaloFull = darkBg ? 0.65 : 0.85;
  const streetKeep = hit?.kind === "street" ? uniqueProp(hit, "sid") : [];
  const nbKeep = hit?.kind === "neighborhood" ? uniqueProp(hit, "slug") : [];
  const dimOn = Boolean(hit);

  const streetOpacity = (full: number) => {
    if (!dimOn) return full;
    if (hit?.kind !== "street") return DIM_STREET;
    if (!streetKeep.length) return full;
    return keepOrDim(full, streetKeep, "sid", DIM_STREET);
  };

  setPaint(map, "streets-base", "line-opacity", streetOpacity(streetBaseFull));
  for (const id of ["streets-school", "streets-bike", "streets-bike-door", "streets-reserved", "streets-illegal"] as const) {
    setPaint(map, id, "line-opacity", streetOpacity(0.95));
  }
  setPaint(map, "streets-halo", "line-opacity", streetOpacity(0.4));
  setPaint(map, "streets-edit", "line-opacity", streetOpacity(1));

  const nbFill = !dimOn ? nbFillFull : nbKeep.length ? keepOrDim(nbFillFull, nbKeep, "slug", DIM_NB_FILL) : DIM_NB_FILL;
  const nbHalo = !dimOn ? nbHaloFull : nbKeep.length ? keepOrDim(nbHaloFull, nbKeep, "slug", DIM_NB_HALO) : DIM_NB_HALO;
  const nbLine = !dimOn ? 1 : nbKeep.length ? keepOrDim(1, nbKeep, "slug", DIM_NB_LINE) : DIM_NB_LINE;
  setPaint(map, "nb-fill", "fill-opacity", nbFill);
  setPaint(map, "nb-halo", "line-opacity", nbHalo);
  setPaint(map, "nb-line", "line-opacity", nbLine);

  setPaint(map, "bld-fill", "fill-opacity", dimOn ? DIM_BLD_FILL : 0.58);
  setPaint(map, "bld-line", "line-opacity", dimOn ? DIM_BLD_LINE : 0.35);

  for (const id of STREET_DIM_LAYERS) {
    if (!map.getLayer(id)) continue;
    setPaint(map, id, "line-opacity-transition", { duration: 0 });
  }
}

export function addSearchHighlightLayers(map: Map) {
  if (!map.getSource(SEARCH_HL)) {
    map.addSource(SEARCH_HL, { type: "geojson", data: empty() });
  }

  const keep = new Set<string>(GLOW_LAYERS);
  for (const layer of map.getStyle()?.layers || []) {
    if (layer.id.startsWith("search-glow-") && !keep.has(layer.id)) {
      map.removeLayer(layer.id);
    }
  }

  const neon = neonForBasemap(map);
  const pointFilter: FilterSpecification = ["==", ["geometry-type"], "Point"];
  const pathFilter: FilterSpecification = ["==", ["get", "kind"], "path"];
  const lineLayout = { "line-cap": "round" as const, "line-join": "round" as const };

  for (const layer of FILL_GLOW) {
    if (!map.getLayer(layer.id)) {
      map.addLayer({
        id: layer.id,
        type: "fill",
        source: SEARCH_HL,
        filter: ["==", ["get", "ring"], layer.ring],
        paint: {
          "fill-color": neon.fill,
          "fill-opacity": 0,
          "fill-antialias": true,
        },
      });
    } else {
      map.setPaintProperty(layer.id, "fill-color", neon.fill);
    }
  }

  if (!map.getLayer("search-glow-path-dark")) {
    map.addLayer({
      id: "search-glow-path-dark",
      type: "line",
      source: SEARCH_HL,
      filter: pathFilter,
      layout: lineLayout,
      paint: {
        "line-color": neon.pathDark,
        "line-gap-width": 6.5,
        "line-width": 2.8,
        "line-opacity": 0,
      },
    });
  } else {
    map.setPaintProperty("search-glow-path-dark", "line-color", neon.pathDark);
  }

  if (!map.getLayer("search-glow-path-light")) {
    map.addLayer({
      id: "search-glow-path-light",
      type: "line",
      source: SEARCH_HL,
      filter: pathFilter,
      layout: lineLayout,
      paint: {
        "line-color": neon.pathLight,
        "line-gap-width": 6.5,
        "line-width": 1.35,
        "line-opacity": 0,
      },
    });
  } else {
    map.setPaintProperty("search-glow-path-light", "line-color", neon.pathLight);
  }

  if (!map.getLayer("search-glow-pt-bloom")) {
    map.addLayer({
      id: "search-glow-pt-bloom",
      type: "circle",
      source: SEARCH_HL,
      filter: pointFilter,
      paint: {
        "circle-color": neon.bloom,
        "circle-radius": 18,
        "circle-blur": 0.7,
        "circle-opacity": 0,
        "circle-pitch-alignment": "map",
      },
    });
  } else {
    map.setPaintProperty("search-glow-pt-bloom", "circle-color", neon.bloom);
  }

  if (!map.getLayer("search-glow-pt-ring")) {
    map.addLayer({
      id: "search-glow-pt-ring",
      type: "circle",
      source: SEARCH_HL,
      filter: pointFilter,
      paint: {
        "circle-color": neon.ring,
        "circle-radius": 8,
        "circle-opacity": 0,
        "circle-stroke-width": 2.6,
        "circle-stroke-color": neon.mid,
        "circle-stroke-opacity": 0,
        "circle-blur": 0,
        "circle-pitch-alignment": "map",
      },
    });
  } else {
    map.setPaintProperty("search-glow-pt-ring", "circle-stroke-color", neon.mid);
    map.setPaintProperty("search-glow-pt-ring", "circle-color", neon.ring);
  }

  const transitions: [string, string[]][] = [
    ...FILL_GLOW.map((l) => [l.id, ["fill-opacity"]] as [string, string[]]),
    ["search-glow-path-dark", ["line-opacity"]],
    ["search-glow-path-light", ["line-opacity"]],
    ["search-glow-pt-bloom", ["circle-opacity", "circle-radius"]],
    ["search-glow-pt-ring", ["circle-opacity", "circle-stroke-opacity", "circle-radius"]],
  ];
  for (const [id, props] of transitions) {
    if (!map.getLayer(id)) continue;
    for (const prop of props) {
      map.setPaintProperty(id, `${prop}-transition` as never, { duration: 0 } as never);
    }
  }

  restackSearchGlow(map);
}

function restackSearchGlow(map: Map) {
  const before = ["streets-base", "streets-school", "streets-bike"].find((id) => map.getLayer(id));
  if (map.getLayer("search-glow-fill-outer") && before) {
    try {
      map.moveLayer("search-glow-fill-outer", before);
    } catch {
      /* style may be mid-rebuild */
    }
  }
  for (const id of GLOW_OVERLAY) {
    if (!map.getLayer(id)) continue;
    try {
      map.moveLayer(id);
    } catch {
      /* style may be mid-rebuild */
    }
  }
}

export function searchGlowLayerIds() {
  return GLOW_LAYERS.slice();
}

export function searchGlowFillLayerIds() {
  return FILL_GLOW.map((l) => l.id);
}

export function searchGlowOverlayLayerIds() {
  return GLOW_OVERLAY.slice();
}

function setGlow(map: Map, amp: number) {
  if (!map.getLayer("search-glow-fill-outer")) return;
  map.setPaintProperty("search-glow-fill-outer", "fill-opacity", amp * FILL_GLOW[0].opacityScale);
  setPaint(map, "search-glow-path-dark", "line-opacity", amp * 0.95);
  setPaint(map, "search-glow-path-light", "line-opacity", amp);
  setPaint(map, "search-glow-pt-bloom", "circle-opacity", amp * 0.45);
  setPaint(map, "search-glow-pt-bloom", "circle-radius", 16);
  setPaint(map, "search-glow-pt-ring", "circle-stroke-opacity", amp);
  setPaint(map, "search-glow-pt-ring", "circle-opacity", amp * 0.2);
  setPaint(map, "search-glow-pt-ring", "circle-radius", 7);
}

function pushGlow(map: Map, hit: SearchHit) {
  const src = map.getSource(SEARCH_HL) as GeoJSONSource | undefined;
  src?.setData(glowCollection(map, hit));
}

function startGlow(map: Map, hit: SearchHit) {
  addSearchHighlightLayers(map);
  applySearchDim(map, hit);
  if (glowRaf) cancelAnimationFrame(glowRaf);
  const token = ++glowToken;
  const reduced = prefersReducedMotion();
  pushGlow(map, hit);
  setGlow(map, reduced ? GLOW_PEAK : 0);

  if (reduced) return;

  const t0 = performance.now();
  const tick = (now: number) => {
    if (token !== glowToken || !map.getSource(SEARCH_HL)) return;
    const u = Math.min(1, (now - t0) / 280);
    setGlow(map, easeOutCubic(u) * GLOW_PEAK);
    if (u < 1) glowRaf = requestAnimationFrame(tick);
    else glowRaf = 0;
  };
  glowRaf = requestAnimationFrame(tick);
}

export function stopSearchGlow(map?: Map) {
  glowToken += 1;
  if (glowRaf) cancelAnimationFrame(glowRaf);
  glowRaf = 0;
  if (map?.getLayer("search-glow-fill-outer")) setGlow(map, 0);
}

export function clearSearchHighlight(map: Map) {
  stopSearchGlow(map);
  const src = map.getSource(SEARCH_HL) as GeoJSONSource | undefined;
  src?.setData(empty());
  applySearchDim(map, null);
}

export function restoreSearchHighlight(map: Map, hit: SearchHit | null) {
  if (!hit) {
    clearSearchHighlight(map);
    return;
  }
  startGlow(map, hit);
}

export function flyToSearchHit(map: Map, hit: SearchHit) {
  startGlow(map, hit);

  const reduced = prefersReducedMotion();
  const duration = reduced ? 0 : hit.kind === "school" ? 1100 : 1380;
  const padding = searchCameraPadding();
  const easing = easeOutCubic;
  const bounds = boundsOfFeatures(hit.features);

  if (!bounds) return;

  if (hit.kind === "school" || bounds.isEmpty() || (bounds.getNorth() === bounds.getSouth() && bounds.getEast() === bounds.getWest())) {
    const c = bounds.getCenter();
    map.easeTo({
      center: [c.lng, c.lat],
      zoom: 16.6,
      duration,
      easing,
      padding,
    });
    return;
  }

  const maxZoom = hit.kind === "neighborhood" ? 15.4 : 17.1;
  map.fitBounds(bounds, {
    padding,
    duration,
    easing,
    maxZoom,
    linear: true,
  });
}
