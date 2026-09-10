import type { StyleSpecification } from "maplibre-gl";
import type { BasemapId } from "./space";

/** Glyphs MapLibre — necesare pentru etichetele de cartier pe stilurile raster. */
const GLYPHS = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

/**
 * Light/dark used to be CARTO raster tiles (light_all / dark_all). Those now
 * return a watermarked “API KEY REQUIRED” image unless you register a key at
 * carto.com/basemaps/apikey. OpenFreeMap Positron/Dark are the same cartography
 * and need no key.
 */
export const BASEMAPS: Record<BasemapId, { label: string; style: string | StyleSpecification }> = {
  light: {
    label: "Deschis",
    style: "https://tiles.openfreemap.org/styles/positron",
  },
  dark: {
    label: "Întunecat",
    style: "https://tiles.openfreemap.org/styles/dark",
  },
  satellite: {
    label: "Satelit",
    style: {
      version: 8,
      name: "satellite",
      glyphs: GLYPHS,
      sources: {
        esri: {
          type: "raster",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          tileSize: 256,
          attribution: "© Esri",
        },
      },
      layers: [{ id: "esri", type: "raster", source: "esri" }],
    },
  },
};
