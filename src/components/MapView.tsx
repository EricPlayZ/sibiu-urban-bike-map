import { useEffect, useRef } from "react";
import maplibregl, { Map, GeoJSONSource, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useApp } from "../store";
import { BASEMAPS } from "../lib/basemaps";
import { CompassDialControl } from "../lib/northControl";
import { enableChasingWheelZoom } from "../lib/chasingWheelZoom";
import { LAYER_COLORS, type BasemapId } from "../lib/space";
import { buildingPopupHtml, schoolMarkerHtml, schoolPopupHtml, streetPopupHtml } from "../lib/streetPopup";

const SRC = "streets";
const NB = "nb";
const DRAW = "draw";
const BLD = "bld";

const STREET_HIT_LAYERS = [
  "streets-illegal",
  "streets-reserved",
  "streets-bike-door",
  "streets-bike",
  "streets-school",
  "streets-edit",
  "streets-base",
];

/** Filtru ca în harta originală — proprietăți 0/1. */
function flagFilter(key: string): maplibregl.FilterSpecification {
  return ["==", ["get", key], 1];
}

/** Așteaptă stilul gata — acoperă cazul în care style.load a tras deja. */
function whenStyleReady(map: Map, fn: () => void) {
  if (map.isStyleLoaded()) {
    fn();
    return () => {};
  }
  let done = false;
  const onReady = () => {
    if (done) return;
    done = true;
    map.off("style.load", onReady);
    map.off("load", onReady);
    fn();
  };
  map.once("style.load", onReady);
  map.once("load", onReady);
  return () => {
    done = true;
    map.off("style.load", onReady);
    map.off("load", onReady);
  };
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const appliedBasemap = useRef<BasemapId | null>(null);

  const ready = useApp((s) => s.ready);
  const basemap = useApp((s) => s.basemap);
  const viewMode = useApp((s) => s.viewMode);
  const neighborhoods = useApp((s) => s.neighborhoods);
  const measurements = useApp((s) => s.measurements);
  const filters = useApp((s) => s.filters);
  const drawing = useApp((s) => s.drawing);
  const drawPoints = useApp((s) => s.drawPoints);
  const buildings = useApp((s) => s.buildings);
  const selectStreet = useApp((s) => s.selectStreet);
  const selectBuilding = useApp((s) => s.selectBuilding);
  const addDrawPoint = useApp((s) => s.addDrawPoint);
  const finishDraw = useApp((s) => s.finishDraw);
  const ensureBuildings = useApp((s) => s.ensureBuildings);
  const showToast = useApp((s) => s.showToast);
  const schools = useApp((s) => s.schools);
  const layers = useApp((s) => s.layers);
  const editMode = useApp((s) => s.editMode);
  const schoolMarkersRef = useRef<Marker[]>([]);
  const streetPopupRef = useRef<Popup | null>(null);

  const clearStreetPopup = () => {
    streetPopupRef.current?.remove();
    streetPopupRef.current = null;
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initial = useApp.getState().basemap;
    const initialStyle = BASEMAPS[initial]?.style ?? BASEMAPS.light.style;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center: [24.1617, 45.7909],
      zoom: 13.8,
      attributionControl: { compact: true },
      fadeDuration: 0,
      antialias: false,
      maxPitch: 60,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-right");
    map.addControl(new CompassDialControl(), "bottom-right");
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
      "bottom-right"
    );
    const stopWheelZoom = enableChasingWheelZoom(map);
    mapRef.current = map;
    appliedBasemap.current = initial;

    const cancel = whenStyleReady(map, () => {
      if (useApp.getState().ready) rebuildOverlays(map);
    });

    return () => {
      stopWheelZoom();
      cancel();
      streetPopupRef.current?.remove();
      streetPopupRef.current = null;
      map.remove();
      mapRef.current = null;
      appliedBasemap.current = null;
    };
  }, []);

  // Date gata — montează overlay-urile pe stilul curent
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    return whenStyleReady(map, () => rebuildOverlays(map));
  }, [ready]);

  // Schimbare basemap — diff:false ca să forțăm rebuild + style.load
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (appliedBasemap.current === basemap) {
      // Stilul inițial e deja cel bun — asigură overlay-urile
      if (!map.getSource(SRC) && map.isStyleLoaded()) rebuildOverlays(map);
      return;
    }

    let cancelled = false;
    const onStyleLoad = () => {
      if (cancelled) return;
      rebuildOverlays(map);
      appliedBasemap.current = basemap;
    };

    map.once("style.load", onStyleLoad);
    map.setStyle(BASEMAPS[basemap]?.style ?? BASEMAPS.light.style, { diff: false });

    return () => {
      cancelled = true;
      map.off("style.load", onStyleLoad);
    };
  }, [basemap, ready]);

  // Actualizare date pe layere existente
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource(SRC)) return;
    pushData(map);
    applyLayerVisibility(map);
  }, [ready, measurements, filters, viewMode, layers, neighborhoods, drawPoints, buildings, schools, editMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (layers.buildings) {
      ensureBuildings().then(() => {
        if (!map.getSource(BLD) && useApp.getState().buildings) addBuildingLayers(map);
        const b = useApp.getState().buildings;
        if (b && map.getSource(BLD)) (map.getSource(BLD) as GeoJSONSource).setData(b);
        applyLayerVisibility(map);
      });
    } else {
      applyLayerVisibility(map);
    }
  }, [layers, ready, ensureBuildings]);

  // Markere școli
  useEffect(() => {
    const map = mapRef.current;
    schoolMarkersRef.current.forEach((m) => m.remove());
    schoolMarkersRef.current = [];
    if (!map || !ready || !layers.schoolMarkers || !schools) return;

    const selectedSchools = new Set(useApp.getState().filters.schools);

    for (const f of schools.features) {
      if (!f.geometry || f.geometry.type !== "Point") continue;
      const slug = String((f.properties as { slug?: string })?.slug || "");
      if (slug && !selectedSchools.has(slug)) continue;
      const [lng, lat] = f.geometry.coordinates;
      const name = String((f.properties as { denumire?: string })?.denumire || "Școală");
      const el = document.createElement("button");
      el.type = "button";
      el.className = "school-marker";
      el.title = name;
      el.setAttribute("aria-label", name);
      el.innerHTML = schoolMarkerHtml(name);
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const st = useApp.getState();
        clearStreetPopup();
        st.closeSheet();
        const selected = new Set(st.filters.neighborhoods);
        const html = schoolPopupHtml((f.properties || {}) as Record<string, unknown>, st.streets, selected);
        streetPopupRef.current = new maplibregl.Popup({
          closeOnClick: true,
          maxWidth: "320px",
          offset: 18,
          className: "ubr-street-popup",
        })
          .setLngLat([lng, lat])
          .setHTML(html)
          .addTo(map);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
      schoolMarkersRef.current.push(marker);
    }

    return () => {
      schoolMarkersRef.current.forEach((m) => m.remove());
      schoolMarkersRef.current = [];
    };
  }, [layers.schoolMarkers, schools, ready, basemap, filters]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const st = useApp.getState();
      if (st.drawing) {
        addDrawPoint(e.lngLat.lng, e.lngLat.lat);
        return;
      }
      if (st.layers.buildings && map.getLayer(BLD + "-fill")) {
        clearStreetPopup();
        const bhits = map.queryRenderedFeatures(e.point, { layers: [BLD + "-fill"] });
        if (bhits[0]) {
          const p = bhits[0].properties || {};
          const bid = String(p.bid);
          const btype = String(p.ubr_type || "necunoscut");
          if (!st.editMode) {
            st.closeSheet();
            const html = buildingPopupHtml(btype);
            streetPopupRef.current = new maplibregl.Popup({
              closeOnClick: true,
              maxWidth: "320px",
              offset: 12,
              className: "ubr-street-popup",
            })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);
            return;
          }
          selectBuilding(bid, btype);
          return;
        }
      }
      const layers = STREET_HIT_LAYERS.filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(e.point, { layers });
      if (!hits[0]) {
        clearStreetPopup();
        return;
      }
      const hitProps = (hits[0].properties || {}) as Record<string, unknown>;
      const sid = String(hitProps.sid || "");
      const rawFeat = st.streets?.features.find((f) => String((f.properties as { sid?: string })?.sid || "") === sid);
      const p = ((rawFeat?.properties || hitProps) as Record<string, unknown>);
      const name = String(p.name || "Stradă");

      // În vizualizare: popup pe hartă (ca originalul). În editare: panoul de detalii.
      if (!st.editMode) {
        st.closeSheet();
        clearStreetPopup();
        const html = streetPopupHtml(p, st.schools, st.measurementForStreet(sid, p));
        streetPopupRef.current = new maplibregl.Popup({
          closeOnClick: true,
          maxWidth: "320px",
          offset: 14,
          className: "ubr-street-popup",
        })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map);
        return;
      }

      clearStreetPopup();
      selectStreet(sid, name, p);
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (useApp.getState().drawing) {
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      const layers = [...STREET_HIT_LAYERS, BLD + "-fill"].filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(e.point, { layers });
      map.getCanvas().style.cursor = hits.length ? "pointer" : "";
    };

    const onDbl = (e: maplibregl.MapMouseEvent & { preventDefault: () => void }) => {
      if (!useApp.getState().drawing) return;
      e.preventDefault();
      const name = prompt("Numele cartierului:");
      if (!name) {
        useApp.getState().cancelDraw();
        return;
      }
      finishDraw(name.trim());
    };

    map.on("click", onClick);
    map.on("mousemove", onMove);
    map.on("dblclick", onDbl);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("dblclick", onDbl);
    };
  }, [ready, addDrawPoint, selectStreet, selectBuilding, finishDraw]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawing) {
      map.doubleClickZoom.disable();
      showToast("Click pe colțuri · dublu-click închide");
    } else map.doubleClickZoom.enable();
  }, [drawing, showToast]);

  // La editare, închide popup-ul de pe hartă (editarea folosește panoul)
  useEffect(() => {
    if (editMode) clearStreetPopup();
  }, [editMode]);

  return <div ref={containerRef} className="map-root" aria-label="Hartă Sibiu" />;
}

function rebuildOverlays(map: Map) {
  try {
    addSourcesAndLayers(map);
    if (useApp.getState().buildings) addBuildingLayers(map);
    pushData(map);
    applyLayerVisibility(map);
    ensureOverlayOrder(map);
  } catch (err) {
    console.error("rebuildOverlays failed", err);
  }
}

function pushData(map: Map) {
  const fc = useApp.getState().paintedStreets();
  if (fc && map.getSource(SRC)) (map.getSource(SRC) as GeoJSONSource).setData(fc);
  const nb = useApp.getState().paintedNeighborhoods();
  if (nb && map.getSource(NB)) (map.getSource(NB) as GeoJSONSource).setData(nb);
  const pts = useApp.getState().drawPoints;
  if (map.getSource(DRAW)) {
    const features: GeoJSON.Feature[] = [];
    if (pts.length) {
      features.push({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: pts.length === 1 ? [pts[0], pts[0]] : pts },
      });
      for (const p of pts) {
        features.push({ type: "Feature", properties: { kind: "pt" }, geometry: { type: "Point", coordinates: p } });
      }
    }
    (map.getSource(DRAW) as GeoJSONSource).setData({ type: "FeatureCollection", features });
  }
}

function applyNeighborhoodStyle(map: Map) {
  if (!map.getLayer("nb-line")) return;
  const darkBg = ["dark", "satellite"].includes(useApp.getState().basemap);
  if (darkBg) {
    map.setPaintProperty("nb-fill", "fill-color", "#5dffb0");
    map.setPaintProperty("nb-fill", "fill-opacity", 0.12);
    map.setPaintProperty("nb-halo", "line-color", "#000000");
    map.setPaintProperty("nb-halo", "line-opacity", 0.65);
    map.setPaintProperty("nb-halo", "line-width", 7);
    map.setPaintProperty("nb-line", "line-color", "#8dffc4");
    map.setPaintProperty("nb-line", "line-opacity", 1);
    map.setPaintProperty("nb-line", "line-width", 3);
  } else {
    map.setPaintProperty("nb-fill", "fill-color", "#0f7a4c");
    map.setPaintProperty("nb-fill", "fill-opacity", 0.07);
    map.setPaintProperty("nb-halo", "line-color", "#ffffff");
    map.setPaintProperty("nb-halo", "line-opacity", 0.85);
    map.setPaintProperty("nb-halo", "line-width", 7);
    map.setPaintProperty("nb-line", "line-color", "#0a5c39");
    map.setPaintProperty("nb-line", "line-opacity", 1);
    map.setPaintProperty("nb-line", "line-width", 3);
  }
}

function applyLayerVisibility(map: Map) {
  const { layers, editMode } = useApp.getState();

  setVis(map, BLD + "-fill", layers.buildings);
  setVis(map, BLD + "-line", layers.buildings);

  setVis(map, "streets-base", layers.streetsBase || editMode);
  setVis(map, "streets-bike", layers.bike);
  setVis(map, "streets-bike-door", layers.bikeDoor);
  setVis(map, "streets-reserved", layers.reserved);
  setVis(map, "streets-illegal", layers.illegal);
  setVis(map, "streets-school", layers.schoolAssign);
  setVis(map, "streets-edit", editMode);
  setVis(map, "streets-halo", editMode);
  setVis(map, "nb-fill", layers.neighborhoods);
  setVis(map, "nb-halo", layers.neighborhoods);
  setVis(map, "nb-line", layers.neighborhoods);

  if (map.getLayer("streets-base")) {
    map.setPaintProperty("streets-base", "line-opacity", layers.buildings && !layers.bike ? 0.28 : 0.55);
  }
}

function setVis(map: Map, id: string, on: boolean) {
  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** Conturul cartierelor deasupra străzilor; fill-ul rămâne dedesubt. */
function ensureOverlayOrder(map: Map) {
  const bottomToTop = [
    "nb-fill",
    "streets-base",
    "streets-school",
    "streets-bike",
    "streets-bike-door",
    "streets-reserved",
    "streets-illegal",
    "streets-halo",
    "streets-edit",
    BLD + "-fill",
    BLD + "-line",
    "nb-halo",
    "nb-line",
    "draw-line",
    "draw-pts",
  ];
  for (const id of bottomToTop) {
    if (map.getLayer(id)) {
      try {
        map.moveLayer(id);
      } catch {
        /* layer may be mid-style */
      }
    }
  }
}

function lineWidthExpr(base: number): maplibregl.ExpressionSpecification {
  return ["case", [">", ["get", "flag_count"], 1], Math.max(3.2, base - 1.4), base];
}

function addSourcesAndLayers(map: Map) {
  if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: empty(), tolerance: 0.4 });
  if (!map.getSource(NB)) map.addSource(NB, { type: "geojson", data: empty(), tolerance: 0.75 });
  if (!map.getSource(DRAW)) map.addSource(DRAW, { type: "geojson", data: empty() });

  if (!map.getLayer("nb-fill")) {
    map.addLayer({
      id: "nb-fill",
      type: "fill",
      source: NB,
      paint: { "fill-color": "#0f7a4c", "fill-opacity": 0.08 },
    });
  }
  if (!map.getLayer("nb-halo")) {
    map.addLayer({
      id: "nb-halo",
      type: "line",
      source: NB,
      paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.55, "line-blur": 0.5 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }
  if (!map.getLayer("nb-line")) {
    map.addLayer({
      id: "nb-line",
      type: "line",
      source: NB,
      paint: {
        "line-color": "#0f7a4c",
        "line-width": 2.75,
        "line-opacity": 0.95,
        "line-dasharray": [1.2, 1.1],
      },
      layout: { "line-cap": "round", "line-join": "round" },
    });
  }
  applyNeighborhoodStyle(map);

  const lineLayout = { "line-cap": "round" as const, "line-join": "round" as const };

  const ensureFlagLine = (
    id: string,
    flagKey: string,
    offsetKey: string,
    color: string,
    width: number,
    extra?: { visibility?: "visible" | "none"; dash?: number[] }
  ) => {
    const paint: maplibregl.LineLayerSpecification["paint"] = {
      "line-color": color,
      "line-width": lineWidthExpr(width),
      "line-opacity": 0.95,
      "line-offset": ["coalesce", ["get", offsetKey], 0],
    };
    if (extra?.dash) paint["line-dasharray"] = extra.dash;

    if (!map.getLayer(id)) {
      map.addLayer({
        id,
        type: "line",
        source: SRC,
        filter: flagFilter(flagKey),
        paint,
        layout: { ...lineLayout, ...(extra?.visibility ? { visibility: extra.visibility } : {}) },
      });
    } else {
      map.setFilter(id, flagFilter(flagKey));
      map.setPaintProperty(id, "line-color", color);
      map.setPaintProperty(id, "line-width", lineWidthExpr(width));
      map.setPaintProperty(id, "line-offset", ["coalesce", ["get", offsetKey], 0]);
      map.setPaintProperty(id, "line-opacity", 0.95);
      if (extra?.dash) map.setPaintProperty(id, "line-dasharray", extra.dash);
    }
  };

  if (!map.getLayer("streets-base")) {
    map.addLayer({
      id: "streets-base",
      type: "line",
      source: SRC,
      paint: { "line-color": LAYER_COLORS.base, "line-width": 4, "line-opacity": 0.55 },
      layout: lineLayout,
    });
  }

  ensureFlagLine("streets-school", "has_arondat", "off_sch", LAYER_COLORS.schoolAssign, 5.5, {
    visibility: "none",
    dash: [1.4, 1.1],
  });
  ensureFlagLine("streets-bike", "show_bike", "off_bike", LAYER_COLORS.bike, 5.5);
  ensureFlagLine("streets-bike-door", "show_bike_door", "off_door", LAYER_COLORS.bikeDoor, 5.5);
  ensureFlagLine("streets-reserved", "show_rsrvd", "off_rsv", LAYER_COLORS.reserved, 5.5);
  ensureFlagLine("streets-illegal", "show_illgl", "off_ill", LAYER_COLORS.illegal, 5.5);

  if (!map.getLayer("streets-halo")) {
    map.addLayer({
      id: "streets-halo",
      type: "line",
      source: SRC,
      filter: ["==", ["get", "edited"], 1],
      paint: {
        "line-color": "#ffffff",
        "line-width": 11,
        "line-opacity": 0.4,
        "line-offset": ["coalesce", ["get", "off_edit"], 0],
      },
      layout: lineLayout,
    });
  } else {
    map.setPaintProperty("streets-halo", "line-offset", ["coalesce", ["get", "off_edit"], 0]);
  }
  if (!map.getLayer("streets-edit")) {
    map.addLayer({
      id: "streets-edit",
      type: "line",
      source: SRC,
      filter: ["==", ["get", "edited"], 1],
      paint: {
        "line-color": ["get", "color"],
        "line-width": lineWidthExpr(6),
        "line-opacity": 1,
        "line-offset": ["coalesce", ["get", "off_edit"], 0],
      },
      layout: lineLayout,
    });
  } else {
    map.setPaintProperty("streets-edit", "line-offset", ["coalesce", ["get", "off_edit"], 0]);
    map.setPaintProperty("streets-edit", "line-width", lineWidthExpr(6));
  }
  if (!map.getLayer("draw-line")) {
    map.addLayer({ id: "draw-line", type: "line", source: DRAW, paint: { "line-color": "#ff6a00", "line-width": 3 } });
    map.addLayer({
      id: "draw-pts",
      type: "circle",
      source: DRAW,
      filter: ["==", ["get", "kind"], "pt"],
      paint: { "circle-color": "#ff6a00", "circle-radius": 5, "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
    });
  }

  ensureOverlayOrder(map);
}

function addBuildingLayers(map: Map) {
  const data = useApp.getState().buildings || empty();
  if (!map.getSource(BLD)) map.addSource(BLD, { type: "geojson", data });
  else (map.getSource(BLD) as GeoJSONSource).setData(data);

  if (!map.getLayer(BLD + "-fill")) {
    map.addLayer({
      id: BLD + "-fill",
      type: "fill",
      source: BLD,
      layout: { visibility: "none" },
      paint: {
        "fill-color": ["match", ["get", "ubr_type"], "casa", "#2f9e44", "bloc", "#e03131", "altceva", "#868e96", "#ced4da"],
        "fill-opacity": 0.58,
      },
    });
  }
  if (!map.getLayer(BLD + "-line")) {
    map.addLayer({
      id: BLD + "-line",
      type: "line",
      source: BLD,
      layout: { visibility: "none" },
      paint: { "line-color": "#111", "line-width": 0.4, "line-opacity": 0.35 },
    });
  }
  // Keep buildings visible when zoomed out (older sessions may still have a high minzoom).
  if (map.getLayer(BLD + "-fill")) map.setLayerZoomRange(BLD + "-fill", 0, 24);
  if (map.getLayer(BLD + "-line")) map.setLayerZoomRange(BLD + "-line", 0, 24);
}

function empty(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
