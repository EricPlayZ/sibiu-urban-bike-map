import type { StyleSpecification } from "maplibre-gl";
import type { BasemapId } from "./space";

export const BASEMAPS: Record<BasemapId, { label: string; style: string | StyleSpecification }> = {
  light: {
    label: "Deschis",
    style: {
      version: 8,
      sources: {
        carto: {
          type: "raster",
          tiles: [
            "https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png",
            "https://cartodb-basemaps-b.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: "© OSM © CARTO",
        },
      },
      layers: [{ id: "carto", type: "raster", source: "carto" }],
    },
  },
  dark: {
    label: "Întunecat",
    style: {
      version: 8,
      sources: {
        carto: {
          type: "raster",
          tiles: [
            "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
            "https://cartodb-basemaps-b.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
          ],
          tileSize: 256,
          attribution: "© OSM © CARTO",
        },
      },
      layers: [{ id: "carto", type: "raster", source: "carto" }],
    },
  },
  satellite: {
    label: "Satelit",
    style: {
      version: 8,
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
