import { useEffect, useLayoutEffect, useRef } from "react";
import maplibregl, { Map, GeoJSONSource, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useApp } from "../store";
import { BASEMAPS } from "../lib/basemaps";
import { CompassDialControl } from "../lib/northControl";
import { enableChasingWheelZoom, type ChasingWheelZoom } from "../lib/chasingWheelZoom";
import { isMapUiLocked, setMapHandlersEnabled } from "../lib/mapUiLock";
import { LAYER_COLORS, type BasemapId } from "../lib/space";
import { buildingFillColorExpr, buildingTypeFilterExpr, coerceBuildingType } from "../lib/buildingTypes";
import { buildingLayerFilter } from "../lib/mapFilters";
import { neighborhoodInfo } from "../lib/neighborhoodInfo";
import { computePieces, featureLines, projectOnLines, type SplitPoint } from "../lib/streetSplits";
import { buildingFeatureForFocus, lockTargetLabel, streetFeatureForFocus } from "../lib/editFocus";
import { getPresence, subscribePresence } from "../lib/livePresence";
import { buildingPopupHtml, neighborhoodPopupHtml, schoolMarkerHtml, schoolPopupHtml, streetPopupHtml } from "../lib/streetPopup";
import {
  addSearchHighlightLayers,
  applySearchDim,
  clearSearchHighlight,
  flyToSearchHit,
  restoreSearchHighlight,
  searchGlowFillLayerIds,
  searchGlowOverlayLayerIds,
  stopSearchGlow,
} from "../lib/searchHighlight";
import { neighborhoodLabelCollection } from "../lib/geoAssign";
import { hitAnchor, hitPrimaryFeature, type SearchHit } from "../lib/mapSearch";
import { isMobileViewport } from "../lib/breakpoints";
import { hitRadiusPx, queryClosestFeature, queryRenderedNear } from "../lib/mapHit";
import { setActiveMap } from "../lib/activeMap";
import { explodeSchoolColorFeatures, schoolColor } from "../lib/schoolColors";
import {
  computeIsochrones,
  ensureIsochroneEngine,
  lastIsochroneFeatures,
  setLastIsochroneFeatures,
  setLastReachOrigin,
  type IsochroneEngine,
} from "../lib/isochrone";
import { describeReach, emptyIsochroneStats } from "../lib/isochroneStats";

const SRC = "streets";
const SCH = "school-stripes";
const NB = "nb";
const NB_LABELS = "nb-labels";
const BLD = "bld";
const ISO = "isochrone";
const SPLIT = "split-preview";
const PRESENCE_LOCK = "presence-lock";
const SPLIT_COLORS = ["#d6336c", "#1c7ed6", "#f08c00", "#2f9e44", "#7048e8", "#0c8599"];

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
  const streets = useApp((s) => s.streets);
  const basemap = useApp((s) => s.basemap);
  const viewMode = useApp((s) => s.viewMode);
  const neighborhoods = useApp((s) => s.neighborhoods);
  const measurements = useApp((s) => s.measurements);
  const filters = useApp((s) => s.filters);
  const buildings = useApp((s) => s.buildings);
  const selectStreet = useApp((s) => s.selectStreet);
  const selectBuilding = useApp((s) => s.selectBuilding);
  const ensureBuildings = useApp((s) => s.ensureBuildings);
  const schools = useApp((s) => s.schools);
  const layers = useApp((s) => s.layers);
  const editMode = useApp((s) => s.editMode);
  const searchFocus = useApp((s) => s.searchFocus);
  const isochroneOrigin = useApp((s) => s.isochroneOrigin);
  const isochroneProfile = useApp((s) => s.isochroneProfile);
  const isochroneMinutes = useApp((s) => s.isochroneMinutes);
  const isochronePinned = useApp((s) => s.isochronePinned);
  const isochroneStatus = useApp((s) => s.isochroneStatus);
  const mapUiLocked = useApp((s) => isMapUiLocked(s));
  const schoolMarkersRef = useRef<Marker[]>([]);
  const streetPopupRef = useRef<Popup | null>(null);
  const popupTipCleanupRef = useRef<(() => void) | null>(null);
  const skipPopupCloseRef = useRef(false);
  const splitPreviewMarkerRef = useRef<Marker | null>(null);
  const splitDragRef = useRef<{ index: number; pointerId: number } | null>(null);
  const splitSkipMapClickRef = useRef(false);
  const splitTouchPlacedRef = useRef(false);
  const presenceMarkersRef = useRef<Marker[]>([]);
  const reachMarkerRef = useRef<Marker | null>(null);
  const reachSkipClickRef = useRef(false);
  const reachEngineRef = useRef<IsochroneEngine | null>(null);
  const reachBusyRef = useRef(false);
  const reachPendingRef = useRef<{ lng: number; lat: number } | null>(null);
  const lastLlRef = useRef<{ lng: number; lat: number } | null>(null);
  const lastPxRef = useRef<{ x: number; y: number } | null>(null);
  const cursorPxRef = useRef<{ x: number; y: number } | null>(null);
  const chaseZoomRef = useRef<ChasingWheelZoom | null>(null);
  const profileRef = useRef(isochroneProfile);
  const minutesRef = useRef(isochroneMinutes);
  const pinnedRef = useRef(isochronePinned);
  profileRef.current = isochroneProfile;
  minutesRef.current = isochroneMinutes;
  pinnedRef.current = isochronePinned;

  const flushReachCompute = () => {
    const map = mapRef.current;
    const engine = reachEngineRef.current;
    const pending = reachPendingRef.current;
    if (!map || !engine || !pending || reachBusyRef.current) return;
    reachPendingRef.current = null;
    reachBusyRef.current = true;
    const result = computeIsochrones(engine, pending, {
      profiles: [profileRef.current],
      minutes: [minutesRef.current],
    });
    applyIsochroneToMap(map, result);
    lastLlRef.current = pending;
    publishReach(pending, result, reachMarkerRef.current, pinnedRef.current, profileRef.current);
    reachBusyRef.current = false;
    if (reachPendingRef.current) requestAnimationFrame(flushReachCompute);
  };

  const scheduleReachCompute = (map: Map, lng: number, lat: number, point?: { x: number; y: number }) => {
    if (point && lastPxRef.current) {
      const dx = point.x - lastPxRef.current.x;
      const dy = point.y - lastPxRef.current.y;
      if (dx * dx + dy * dy < 49) return;
    }
    if (point) lastPxRef.current = point;
    reachPendingRef.current = { lng, lat };
    if (!reachEngineRef.current) {
      void ensureIsochroneEngine().then((engine) => {
        reachEngineRef.current = engine;
        flushReachCompute();
      });
      return;
    }
    if (!reachBusyRef.current) requestAnimationFrame(flushReachCompute);
  };

  const dismissSearchHighlight = () => {
    const map = mapRef.current;
    if (useApp.getState().searchFocus) useApp.getState().clearSearchFocus();
    if (map?.getSource("search-hl")) clearSearchHighlight(map);
  };

  const clearStreetPopup = () => {
    popupTipCleanupRef.current?.();
    popupTipCleanupRef.current = null;
    skipPopupCloseRef.current = true;
    streetPopupRef.current?.remove();
    streetPopupRef.current = null;
    skipPopupCloseRef.current = false;
  };

  const bindPopupClose = (popup: Popup) => {
    popup.on("close", () => {
      if (streetPopupRef.current === popup) streetPopupRef.current = null;
      if (skipPopupCloseRef.current) return;
      dismissSearchHighlight();
    });
  };

  /** Butoanele din popup („Arată doar…” / „Ascunde…”) și pliurile: evenimentele nu ajung la hartă. */
  const onPopupClick = (ev: MouseEvent) => {
    ev.stopPropagation();
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-ubr-act]");
    if (!btn) return;
    const act = btn.dataset.ubrAct;
    const id = btn.dataset.ubrId || "";
    const st = useApp.getState();
    if (!id) return;
    if (act === "only-nb") {
      st.showOnlyNeighborhood(id);
      st.showToast("Arăt doar acest cartier — schimbi din Filtre");
    } else if (act === "hide-nb") {
      st.hideNeighborhood(id);
      st.showToast("Cartier ascuns — îl readuci din Filtre");
    } else if (act === "only-school") {
      st.showOnlySchool(id);
      st.showToast("Arăt doar această școală — schimbi din Filtre sau Legendă");
    } else if (act === "hide-school") {
      st.hideSchool(id);
      st.showToast("Școală ascunsă — o readuci din Filtre sau Legendă");
    } else if (act === "only-bldg") {
      st.showOnlyBuildingType(id);
      st.showToast("Arăt doar acest tip de clădire");
    } else if (act === "hide-bldg") {
      const cur = st.filters.buildingTypes;
      st.setFilter("buildingTypes", cur.filter((t) => t !== id));
      st.showToast("Tip ascuns — îl readuci din Legendă");
    } else {
      return;
    }
    clearStreetPopup();
  };

  const openMapPopup = (map: Map, lngLat: maplibregl.LngLatLike, html: string, offset: number) => {
    clearStreetPopup();
    const popup = new maplibregl.Popup({
      closeOnClick: true,
      focusAfterOpen: false,
      maxWidth: isMobileViewport() ? "280px" : "320px",
      offset,
      className: "ubr-street-popup",
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
    streetPopupRef.current = popup;
    const el = popup.getElement();
    el.addEventListener("click", onPopupClick);
    const stopToMap = (ev: Event) => ev.stopPropagation();
    el.addEventListener("pointerdown", stopToMap);
    el.addEventListener("mousedown", stopToMap);
    popupTipCleanupRef.current = bindPopupTooltips(el);
    bindPopupClose(popup);
  };

  const openNeighborhoodPopup = async (map: Map, lngLat: maplibregl.LngLatLike, slug: string, fallbackName: string) => {
    let st = useApp.getState();
    if (!st.buildings) {
      try {
        await st.ensureBuildings();
      } catch {
        /* secțiunea de clădiri rămâne „neîncărcate” */
      }
      st = useApp.getState();
    }
    const info = neighborhoodInfo({
      slug,
      streets: st.streets,
      neighborhoods: st.neighborhoods,
      schools: st.schools,
      buildings: st.buildings,
      measurements: st.measurements,
      seedMeasurements: st.seedMeasurements,
    });
    openMapPopup(map, lngLat, neighborhoodPopupHtml(info?.name || fallbackName, info, slug), 12);
  };

  const showSearchPopup = (map: Map, hit: SearchHit) => {
    if (hit.quiet) return;
    const st = useApp.getState();
    if (st.editMode) return;
    const anchor = hitAnchor(hit);
    if (!anchor) return;
    st.closeSheet();
    let html = "";
    if (hit.kind === "street") {
      const feat = hitPrimaryFeature(hit);
      const p = ((feat?.properties || {}) as Record<string, unknown>);
      const sid = String(p.sid || "");
      html = streetPopupHtml(p, st.schools, st.measurementForStreet(sid, p));
    } else if (hit.kind === "school") {
      const feat = hit.features[0];
      const selected = new Set(st.filters.neighborhoods);
      html = schoolPopupHtml((feat?.properties || {}) as Record<string, unknown>, st.streets, selected);
    } else {
      const slug = String((hit.features[0]?.properties as { slug?: string } | undefined)?.slug || "");
      if (slug) {
        void openNeighborhoodPopup(map, anchor, slug, hit.label);
        return;
      }
      html = neighborhoodPopupHtml(hit.label);
    }

    openMapPopup(map, anchor, html, hit.kind === "school" ? 18 : 14);
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
      maxCanvasSize: [8192, 8192],
      // Needed so the print export can read the WebGL canvas.
      preserveDrawingBuffer: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-right");
    map.addControl(new CompassDialControl(), "bottom-right");
    const compassEl = map.getContainer().querySelector<HTMLElement>(".ubr-compass-wrap");
    const unbindCompassTips = compassEl ? bindPopupTooltips(compassEl) : null;
    map.addControl(
      new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
      "bottom-right"
    );
    const attribEl = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
    const keepAttribDetailsOpen = () => {
      // MapLibre toggles [open]; keep it on so the chip width can animate.
      if (attribEl instanceof HTMLDetailsElement && !attribEl.open) attribEl.open = true;
    };
    keepAttribDetailsOpen();
    attribEl?.addEventListener("toggle", keepAttribDetailsOpen);
    const chase = enableChasingWheelZoom(map);
    chaseZoomRef.current = chase;
    mapRef.current = map;
    setActiveMap(map);
    appliedBasemap.current = initial;
    if (isMapUiLocked(useApp.getState())) {
      chase.abort();
      setMapHandlersEnabled(map, false);
      containerRef.current?.classList.add("is-ui-locked");
    }

    const cancel = whenStyleReady(map, () => {
      if (useApp.getState().ready) rebuildOverlays(map);
    });

    return () => {
      unbindCompassTips?.();
      attribEl?.removeEventListener("toggle", keepAttribDetailsOpen);
      chase.stop();
      chaseZoomRef.current = null;
      cancel();
      stopSearchGlow(map);
      streetPopupRef.current?.remove();
      streetPopupRef.current = null;
      setActiveMap(null);
      map.remove();
      mapRef.current = null;
      appliedBasemap.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapUiLocked) {
      chaseZoomRef.current?.abort();
      map.stop();
      setMapHandlersEnabled(map, false);
      containerRef.current?.classList.add("is-ui-locked");
    } else {
      setMapHandlersEnabled(map, true);
      containerRef.current?.classList.remove("is-ui-locked");
    }
  }, [mapUiLocked]);

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
    if (!map.getSource(SCH) || schoolLayerNeedsRebuild(map)) addSourcesAndLayers(map);
    pushData(map);
    applyLayerVisibility(map);
  }, [ready, measurements, filters, viewMode, layers, neighborhoods, buildings, schools, editMode]);

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
  }, [layers, ready, ensureBuildings, buildings]);

  // Markere școli
  useEffect(() => {
    const map = mapRef.current;
    schoolMarkersRef.current.forEach((m) => m.remove());
    schoolMarkersRef.current = [];
    if (!map || !ready || !layers.schoolMarkers || !schools) return;

    const selectedSchools = new Set(useApp.getState().filters.schools);
    const tipCleanups: Array<() => void> = [];

    for (const f of schools.features) {
      if (!f.geometry || f.geometry.type !== "Point") continue;
      const slug = String((f.properties as { slug?: string })?.slug || "");
      if (slug && !selectedSchools.has(slug)) continue;
      const [lng, lat] = f.geometry.coordinates;
      const name = String((f.properties as { denumire?: string })?.denumire || "Școală");
      const el = document.createElement("button");
      el.type = "button";
      el.className = "school-marker";
      const focusId = useApp.getState().searchFocus?.hit.id;
      if (focusId === `school:${slug}`) el.classList.add("is-search-hit");
      el.setAttribute("aria-label", name);
      el.dataset.tip = name;
      tipCleanups.push(bindPopupTooltips(el));
      el.innerHTML = schoolMarkerHtml(name, schoolColor(slug));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const st = useApp.getState();
        dismissSearchHighlight();
        st.closeSheet();
        const selected = new Set(st.filters.neighborhoods);
        const html = schoolPopupHtml((f.properties || {}) as Record<string, unknown>, st.streets, selected);
        openMapPopup(map, [lng, lat], html, 18);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
      schoolMarkersRef.current.push(marker);
    }

    return () => {
      tipCleanups.forEach((cleanup) => cleanup());
      schoolMarkersRef.current.forEach((m) => m.remove());
      schoolMarkersRef.current = [];
    };
  }, [layers.schoolMarkers, schools, ready, basemap, filters, searchFocus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const st = useApp.getState();
      if (isMapUiLocked(st)) return;
      if (st.splitTool) {
        if (splitSkipMapClickRef.current || splitDragRef.current) {
          splitSkipMapClickRef.current = false;
          return;
        }
        if (splitTouchPlacedRef.current) {
          splitTouchPlacedRef.current = false;
          return;
        }
        // Segmentare: click lângă stradă = punct nou de tăiere (proiectat exact pe linie).
        const tool = st.splitTool;
        const lines = featureLines(tool.geometry);
        const p: SplitPoint = [e.lngLat.lng, e.lngLat.lat];
        const hit = projectSplitPoint(map, lines, p, hitRadiusPx(e.originalEvent));
        if (!hit) {
          st.showToast("Atinge mai aproape de strada tăiată");
          return;
        }
        st.addSplitPoint(hit.point);
        return;
      }
      if (st.viewMode === "reach") {
        if (reachSkipClickRef.current) return;
        clearStreetPopup();
        dismissSearchHighlight();
        st.closeSheet();
        lastLlRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        st.setIsochroneOrigin(e.lngLat.lng, e.lngLat.lat, true);
        const mapNow = mapRef.current;
        const engine = reachEngineRef.current;
        if (mapNow && engine) {
          const result = computeIsochrones(engine, lastLlRef.current, {
            profiles: [st.isochroneProfile],
            minutes: [st.isochroneMinutes],
          });
          applyIsochroneToMap(mapNow, result);
          publishReach(lastLlRef.current, result, reachMarkerRef.current, true, st.isochroneProfile);
        }
        return;
      }
      const radius = hitRadiusPx(e.originalEvent);
      if (st.layers.buildings && map.getLayer(BLD + "-fill")) {
        const bhits = map.queryRenderedFeatures(e.point, { layers: [BLD + "-fill"] });
        if (bhits[0]) {
          const p = bhits[0].properties || {};
          const bid = String(p.bid);
          const btype = coerceBuildingType(p.ubr_type);
          if (!st.editMode) {
            st.closeSheet();
            dismissSearchHighlight();
            openMapPopup(map, e.lngLat, buildingPopupHtml(btype), 12);
            return;
          }
          clearStreetPopup();
          dismissSearchHighlight();
          selectBuilding(bid, btype);
          return;
        }
      }
      const layers = STREET_HIT_LAYERS.filter((id) => map.getLayer(id));
      const streetHit = queryClosestFeature(map, e.point, layers, radius);
      if (!streetHit) {
        // Un click care doar închide un popup deschis nu deschide altul.
        const hadPopup = Boolean(streetPopupRef.current);
        clearStreetPopup();
        dismissSearchHighlight();
        // Click pe un cartier (nu pe stradă): informații despre cartier, fără să schimbe vreun filtru.
        if (!hadPopup && !st.editMode && map.getLayer("nb-fill")) {
          const nbHit = map.queryRenderedFeatures(e.point, { layers: ["nb-fill"] })[0];
          const nbProps = (nbHit?.properties || {}) as { slug?: string; denumire?: string; name?: string };
          if (nbProps.slug) {
            st.closeSheet();
            void openNeighborhoodPopup(map, e.lngLat, String(nbProps.slug), String(nbProps.denumire || nbProps.name || nbProps.slug));
          }
        }
        return;
      }
      const hitProps = (streetHit.properties || {}) as Record<string, unknown>;
      const sid = String(hitProps.sid || "");
      const rawFeat = st.streets?.features.find((f) => String((f.properties as { sid?: string })?.sid || "") === sid);
      const p = ((rawFeat?.properties || hitProps) as Record<string, unknown>);
      const name = String(p.name || "Stradă");

      // În vizualizare: popup pe hartă (ca originalul). În editare: panoul de detalii.
      if (!st.editMode) {
        st.closeSheet();
        dismissSearchHighlight();
        const html = streetPopupHtml(p, st.schools, st.measurementForStreet(sid, p));
        openMapPopup(map, e.lngLat, html, 14);
        return;
      }

      clearStreetPopup();
      dismissSearchHighlight();
      selectStreet(sid, name, p);
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (useApp.getState().viewMode === "reach" || useApp.getState().splitTool) {
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      const layers = [...STREET_HIT_LAYERS, BLD + "-fill"].filter((id) => map.getLayer(id));
      const hits = queryRenderedNear(map, e.point, layers, hitRadiusPx(e.originalEvent));
      map.getCanvas().style.cursor = hits.length ? "pointer" : "";
    };

    const canvasPoint = (clientX: number, clientY: number) => {
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: clientX - rect.left - map.getCanvas().clientLeft, y: clientY - rect.top - map.getCanvas().clientTop };
    };

    const trackLiveReach = (point: { x: number; y: number }, buttons: number, compute: boolean) => {
      if (useApp.getState().viewMode !== "reach") return;
      if (!fineHover() || pinnedRef.current) return;
      if (isMapUiLocked(useApp.getState())) return;
      if (buttons) return;
      if (map.dragPan.isActive()) return;
      const canvas = map.getCanvas();
      if (point.x < 0 || point.y < 0 || point.x > canvas.clientWidth || point.y > canvas.clientHeight) return;
      cursorPxRef.current = point;
      const ll = map.unproject([point.x, point.y]);
      reachMarkerRef.current?.setLngLat(ll);
      if (compute) scheduleReachCompute(map, ll.lng, ll.lat, point);
    };

    const onPointerMove = (ev: PointerEvent) => {
      trackLiveReach(canvasPoint(ev.clientX, ev.clientY), ev.buttons, true);
    };

    const onCameraMove = () => {
      const px = cursorPxRef.current;
      if (!px) return;
      trackLiveReach(px, 0, false);
    };

    const onZoomSettled = () => {
      const px = cursorPxRef.current;
      if (!px) return;
      lastPxRef.current = null;
      trackLiveReach(px, 0, true);
    };

    const canvasEl = map.getCanvasContainer();
    canvasEl.addEventListener("pointermove", onPointerMove);
    map.on("click", onClick);
    map.on("mousemove", onMove);
    map.on("move", onCameraMove);
    map.on("zoomend", onZoomSettled);
    return () => {
      canvasEl.removeEventListener("pointermove", onPointerMove);
      map.off("click", onClick);
      map.off("mousemove", onMove);
      map.off("move", onCameraMove);
      map.off("zoomend", onZoomSettled);
    };
  }, [ready, selectStreet, selectBuilding, viewMode]);

  // La editare, închide popup-ul de pe hartă (editarea folosește panoul)
  useEffect(() => {
    if (editMode) {
      clearStreetPopup();
      dismissSearchHighlight();
    }
  }, [editMode]);

  useEffect(() => {
    containerRef.current?.classList.toggle("is-search-focus", Boolean(searchFocus));
  }, [searchFocus]);

  // Segmentare: bucățile colorate + punctele de tăiere (click pe punct = îl scoate).
  const splitTool = useApp((s) => s.splitTool);
  const pipelineStreetsRaw = useApp((s) => s.pipelineStreetsRaw);
  const splitMarkersRef = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    splitMarkersRef.current.forEach((m) => m.remove());
    splitMarkersRef.current = [];
    splitPreviewMarkerRef.current?.remove();
    splitPreviewMarkerRef.current = null;
    splitDragRef.current = null;
    if (!map || !ready) return;
    const cancel = whenStyleReady(map, () => {
      ensureSplitLayers(map);
      pushSplitData(map);
      applyLayerVisibility(map);
    });
    if (!splitTool) {
      whenStyleReady(map, () => {
        pushSplitData(map);
        applyLayerVisibility(map);
      });
      map.getCanvas().style.cursor = "";
      return () => {
        cancel();
      };
    }

    const previewEl = document.createElement("div");
    previewEl.className = "split-marker is-preview";
    previewEl.setAttribute("aria-hidden", "true");
    const previewMarker = new maplibregl.Marker({ element: previewEl, anchor: "center" }).setLngLat(splitTool.points[0] || map.getCenter()).addTo(map);
    previewEl.style.display = "none";
    splitPreviewMarkerRef.current = previewMarker;

    const showPreviewAt = (point: SplitPoint | null) => {
      if (!point || splitDragRef.current) {
        previewEl.style.display = "none";
        return;
      }
      previewEl.style.display = "";
      previewMarker.setLngLat(point);
    };

    const onSplitMove = (ev: maplibregl.MapMouseEvent) => {
      if (splitDragRef.current) return;
      const tool = useApp.getState().splitTool;
      if (!tool) return;
      const lines = featureLines(tool.geometry);
      const p: SplitPoint = [ev.lngLat.lng, ev.lngLat.lat];
      const hit = projectSplitPoint(map, lines, p, hitRadiusPx(ev.originalEvent));
      showPreviewAt(hit?.point ?? null);
    };

    const onSplitPointerUp = (ev: PointerEvent) => {
      if (ev.pointerType !== "touch" || splitDragRef.current) return;
      const tool = useApp.getState().splitTool;
      if (!tool) return;
      const rect = map.getCanvas().getBoundingClientRect();
      const x = ev.clientX - rect.left - map.getCanvas().clientLeft;
      const y = ev.clientY - rect.top - map.getCanvas().clientTop;
      const ll = map.unproject([x, y]);
      const lines = featureLines(tool.geometry);
      const hit = projectSplitPoint(map, lines, [ll.lng, ll.lat], hitRadiusPx(ev));
      if (!hit || previewEl.style.display === "none") return;
      useApp.getState().addSplitPoint(hit.point);
      splitTouchPlacedRef.current = true;
      showPreviewAt(null);
    };

    map.on("mousemove", onSplitMove);
    map.getCanvas().addEventListener("pointerup", onSplitPointerUp);

    splitTool.points.forEach((pt, index) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "split-marker";
      el.setAttribute("aria-label", "Trage punctul de-a lungul străzii. Click ca să-l scoți");
      let pendingDrag: { pointerId: number; x: number; y: number } | null = null;
      let dragged = false;
      let pausedPan = false;
      const stopMapGesture = (ev: Event) => ev.stopPropagation();
      const resumePan = () => {
        if (!pausedPan) return;
        pausedPan = false;
        map.dragPan.enable();
      };
      el.addEventListener("mousedown", stopMapGesture);
      el.addEventListener("touchstart", stopMapGesture, { passive: true });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        splitSkipMapClickRef.current = true;
        if (dragged || splitDragRef.current) {
          dragged = false;
          return;
        }
        useApp.getState().removeSplitPoint(index);
      });
      el.addEventListener("pointerdown", (ev) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        ev.stopPropagation();
        splitSkipMapClickRef.current = true;
        dragged = false;
        pendingDrag = { pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY };
        showPreviewAt(null);
        el.setPointerCapture(ev.pointerId);
      });
      el.addEventListener("pointermove", (ev) => {
        const tool = useApp.getState().splitTool;
        if (!tool || !pendingDrag || pendingDrag.pointerId !== ev.pointerId) return;
        if (!splitDragRef.current) {
          const dx = ev.clientX - pendingDrag.x;
          const dy = ev.clientY - pendingDrag.y;
          if (dx * dx + dy * dy < 16) return;
          dragged = true;
          splitDragRef.current = { index, pointerId: ev.pointerId };
          if (map.dragPan.isEnabled()) {
            map.dragPan.disable();
            pausedPan = true;
          }
        }
        const drag = splitDragRef.current;
        if (!drag || drag.index !== index || drag.pointerId !== ev.pointerId) return;
        ev.stopPropagation();
        const rect = map.getCanvas().getBoundingClientRect();
        const x = ev.clientX - rect.left - map.getCanvas().clientLeft;
        const y = ev.clientY - rect.top - map.getCanvas().clientTop;
        const ll = map.unproject([x, y]);
        const lines = featureLines(tool.geometry);
        const hit = projectSplitPoint(map, lines, [ll.lng, ll.lat], 48);
        if (hit) marker.setLngLat(hit.point);
      });
      el.addEventListener("pointerup", (ev) => {
        if (pendingDrag?.pointerId === ev.pointerId) pendingDrag = null;
        const drag = splitDragRef.current;
        resumePan();
        if (!drag || drag.index !== index || drag.pointerId !== ev.pointerId) {
          window.setTimeout(() => {
            dragged = false;
            splitSkipMapClickRef.current = false;
          }, 0);
          return;
        }
        ev.stopPropagation();
        try {
          el.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        const tool = useApp.getState().splitTool;
        if (tool) {
          const ll = marker.getLngLat();
          const lines = featureLines(tool.geometry);
          const hit = projectSplitPoint(map, lines, [ll.lng, ll.lat], 48);
          const kept = hit ? useApp.getState().moveSplitPoint(index, hit.point) : false;
          if (!kept) marker.setLngLat(tool.points[index] ?? [ll.lng, ll.lat]);
        }
        splitDragRef.current = null;
        window.setTimeout(() => {
          dragged = false;
          splitSkipMapClickRef.current = false;
        }, 0);
      });
      el.addEventListener("pointercancel", () => {
        pendingDrag = null;
        resumePan();
        if (splitDragRef.current?.index === index) {
          splitDragRef.current = null;
          const tool = useApp.getState().splitTool;
          const back = tool?.points[index];
          if (back) marker.setLngLat(back);
        }
      });
      const marker = new maplibregl.Marker({ element: el }).setLngLat(pt).addTo(map);
      splitMarkersRef.current.push(marker);
    });
    map.getCanvas().style.cursor = "crosshair";

    return () => {
      cancel();
      map.off("mousemove", onSplitMove);
      map.getCanvas().removeEventListener("pointerup", onSplitPointerUp);
      splitMarkersRef.current.forEach((m) => m.remove());
      splitMarkersRef.current = [];
      splitPreviewMarkerRef.current?.remove();
      splitPreviewMarkerRef.current = null;
      splitDragRef.current = null;
    };
  }, [splitTool, ready, splitTool?.points]);

  const uiTheme = useApp((s) => s.uiTheme);
  const buildingTypes = useApp((s) => s.buildingTypes);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const tipCleanups: Array<() => void> = [];
    const syncPresenceMarkers = () => {
      tipCleanups.forEach((fn) => fn());
      tipCleanups.length = 0;
      presenceMarkersRef.current.forEach((m) => m.remove());
      presenceMarkersRef.current = [];
      const st = useApp.getState();
      for (const user of getPresence()) {
        for (const lock of user.locks) {
          const feature =
            lock.kind === "building"
              ? buildingFeatureForFocus(st.buildings, lock.id)
              : streetFeatureForFocus(st.streets, st.pipelineStreetsRaw, lock.id);
          const ll = feature ? lockAnchor(feature) : null;
          if (!ll) continue;
          const target = lockTargetLabel(lock, {
            streets: st.streets,
            pipeline: st.pipelineStreetsRaw,
            buildings: st.buildings,
            buildingTypes: st.buildingTypes,
          });
          const tip = `${user.name} editează ${target}`;
          const el = document.createElement("div");
          el.className = "edit-lock-pin";
          el.dataset.tip = tip;
          el.setAttribute("aria-label", tip);
          const name = document.createElement("span");
          name.className = "edit-lock-pin-label";
          name.textContent = user.name;
          const caret = document.createElement("span");
          caret.className = "edit-lock-pin-caret";
          caret.setAttribute("aria-hidden", "true");
          el.append(name, caret);
          tipCleanups.push(bindPopupTooltips(el));
          presenceMarkersRef.current.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat(ll).addTo(map));
        }
      }
      if (map.getSource(PRESENCE_LOCK)) pushPresenceLocks(map);
    };
    const cancel = whenStyleReady(map, () => {
      ensurePresenceLockLayers(map);
      syncPresenceMarkers();
      ensureOverlayOrder(map);
    });
    const unsub = subscribePresence(syncPresenceMarkers);
    const frame = window.requestAnimationFrame(() => {
      if (!map.isStyleLoaded()) return;
      ensurePresenceLockLayers(map);
      pushPresenceLocks(map);
      ensureOverlayOrder(map);
    });
    return () => {
      cancel();
      window.cancelAnimationFrame(frame);
      unsub();
      tipCleanups.forEach((fn) => fn());
      presenceMarkersRef.current.forEach((m) => m.remove());
      presenceMarkersRef.current = [];
      clearPresenceLocks(map);
    };
  }, [ready, streets, buildings, pipelineStreetsRaw, uiTheme, buildingTypes]);

  // Cât timp segmentezi, focusul hărții e pe strada aleasă.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !splitTool) return;
    const lines = featureLines(splitTool.geometry);
    if (!lines.length) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const line of lines) for (const c of line) bounds.extend(c as [number, number]);
    map.fitBounds(bounds, { padding: { top: 90, bottom: 190, left: 50, right: 50 }, maxZoom: 18, duration: 500 });
    // doar la pornirea uneltei, nu la fiecare punct nou
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitTool?.root]);

  useEffect(() => {
    if (viewMode !== "reach") return;
    void ensureIsochroneEngine().then((engine) => {
      reachEngineRef.current = engine;
      const map = mapRef.current;
      const ll = lastLlRef.current || useApp.getState().isochroneOrigin;
      const st = useApp.getState();
      if (map && ll && st.viewMode === "reach") {
        const result = computeIsochrones(engine, ll, { profiles: [st.isochroneProfile], minutes: [st.isochroneMinutes] });
        applyIsochroneToMap(map, result);
        publishReach(ll, result, reachMarkerRef.current, pinnedRef.current, st.isochroneProfile);
      }
    });
  }, [viewMode]);

  useEffect(() => {
    containerRef.current?.classList.toggle("is-reach", viewMode === "reach");
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = viewMode === "reach" ? "crosshair" : "";
  }, [viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || viewMode !== "reach") return;
    const ll = lastLlRef.current || isochroneOrigin;
    const engine = reachEngineRef.current;
    if (!ll || !engine) return;
    const result = computeIsochrones(engine, ll, { profiles: [isochroneProfile], minutes: [isochroneMinutes] });
    applyIsochroneToMap(map, result);
    publishReach(ll, result, reachMarkerRef.current, pinnedRef.current, isochroneProfile);
  }, [ready, viewMode, isochroneProfile, isochroneMinutes]);

  useEffect(() => {
    if (viewMode !== "reach" || !isochronePinned || isochroneOrigin || !lastLlRef.current) return;
    const ll = lastLlRef.current;
    useApp.getState().setIsochroneOrigin(ll.lng, ll.lat, true);
  }, [viewMode, isochronePinned, isochroneOrigin]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(ISO) || isochroneStatus !== "idle") return;
    applyIsochroneToMap(map, { ok: false });
    lastLlRef.current = null;
    lastPxRef.current = null;
    useApp.getState().setIsochroneStats(emptyIsochroneStats());
    paintReachPin(reachMarkerRef.current?.getElement() ?? null, {
      live: fineHover() && !pinnedRef.current,
      profile: profileRef.current,
    });
  }, [isochroneStatus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const clearPin = () => {
      reachMarkerRef.current?.remove();
      reachMarkerRef.current = null;
    };

    if (viewMode !== "reach") {
      clearPin();
      return;
    }

    const live = fineHover() && !isochronePinned;
    if (!reachMarkerRef.current) {
      const marker = new maplibregl.Marker({ element: reachPinEl(live), anchor: "center", draggable: !live })
        .setLngLat(isochroneOrigin || map.getCenter())
        .addTo(map);
      marker.on("dragstart", () => {
        reachSkipClickRef.current = true;
      });
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        lastLlRef.current = { lng: ll.lng, lat: ll.lat };
        useApp.getState().setIsochroneOrigin(ll.lng, ll.lat, true);
        const engine = reachEngineRef.current;
        if (engine) {
          const result = computeIsochrones(engine, lastLlRef.current, {
            profiles: [profileRef.current],
            minutes: [minutesRef.current],
          });
          applyIsochroneToMap(map, result);
          publishReach(lastLlRef.current, result, marker, true, profileRef.current);
        }
        window.setTimeout(() => {
          reachSkipClickRef.current = false;
        }, 0);
      });
      marker.getElement().addEventListener("click", (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        reachSkipClickRef.current = true;
        window.setTimeout(() => {
          reachSkipClickRef.current = false;
        }, 0);
        if (!fineHover()) return;
        if (pinnedRef.current) useApp.getState().setIsochronePinned(false);
      });
      reachMarkerRef.current = marker;
    }

    const marker = reachMarkerRef.current;
    const el = marker.getElement();
    marker.setDraggable(!live);
    el.style.pointerEvents = live ? "none" : "auto";
    paintReachPin(el, { live, profile: isochroneProfile });
    if (isochronePinned && isochroneOrigin) marker.setLngLat([isochroneOrigin.lng, isochroneOrigin.lat]);
  }, [ready, viewMode, isochroneOrigin, isochronePinned, isochroneProfile, isochroneMinutes]);

  useEffect(() => {
    return () => {
      reachMarkerRef.current?.remove();
      reachMarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!searchFocus) {
      if (map.getSource("search-hl")) clearSearchHighlight(map);
      return;
    }
    const run = () => {
      flyToSearchHit(map, searchFocus.hit);
      showSearchPopup(map, searchFocus.hit);
    };
    return whenStyleReady(map, run);
  }, [searchFocus, ready]);

  return <div ref={containerRef} className="map-root" aria-label="Hartă Sibiu" />;
}

function ensureSplitLayers(map: Map) {
  if (!map.getSource(SPLIT)) map.addSource(SPLIT, { type: "geojson", data: empty() });
  if (!map.getLayer("split-halo")) {
    map.addLayer({
      id: "split-halo",
      type: "line",
      source: SPLIT,
      paint: { "line-color": "#ffffff", "line-width": 11, "line-opacity": 0.85 },
      layout: { "line-cap": "butt", "line-join": "round" },
    });
  }
  if (!map.getLayer("split-line")) {
    map.addLayer({
      id: "split-line",
      type: "line",
      source: SPLIT,
      paint: { "line-color": ["get", "color"], "line-width": 7, "line-opacity": 1 },
      layout: { "line-cap": "butt", "line-join": "round" },
    });
  }
}

function pushSplitData(map: Map) {
  const src = map.getSource(SPLIT) as GeoJSONSource | undefined;
  if (!src) return;
  const tool = useApp.getState().splitTool;
  if (!tool) {
    src.setData(empty());
    return;
  }
  const pieces = computePieces(tool.root, tool.geometry, tool.points);
  src.setData({
    type: "FeatureCollection",
    features: pieces.map((piece) => ({
      type: "Feature" as const,
      properties: { color: SPLIT_COLORS[piece.index % SPLIT_COLORS.length] },
      geometry:
        piece.lines.length === 1
          ? ({ type: "LineString", coordinates: piece.lines[0] } as GeoJSON.LineString)
          : ({ type: "MultiLineString", coordinates: piece.lines } as GeoJSON.MultiLineString),
    })),
  });
}

function rebuildOverlays(map: Map) {
  try {
    addSourcesAndLayers(map);
    ensureSplitLayers(map);
    pushSplitData(map);
    ensurePresenceLockLayers(map);
    pushPresenceLocks(map);
    if (useApp.getState().buildings) addBuildingLayers(map);
    pushData(map);
    applyLayerVisibility(map);
    ensureOverlayOrder(map);
    const hit = useApp.getState().searchFocus?.hit;
    if (hit) restoreSearchHighlight(map, hit);
  } catch (err) {
    console.error("rebuildOverlays failed", err);
  }
}

function schoolLayerNeedsRebuild(map: Map) {
  try {
    const layer = map.getStyle()?.layers?.find((l) => l.id === "streets-school");
    return Boolean(layer && "source" in layer && layer.source !== SCH);
  } catch {
    return false;
  }
}

function pushData(map: Map) {
  const st = useApp.getState();
  const fc = st.paintedStreets();
  if (fc && map.getSource(SRC)) (map.getSource(SRC) as GeoJSONSource).setData(fc);
  const stripes = fc ? explodeSchoolColorFeatures(fc.features, new Set(st.filters.schools)) : [];
  if (map.getSource(SCH)) {
    (map.getSource(SCH) as GeoJSONSource).setData({ type: "FeatureCollection", features: stripes });
  }
  const nb = st.paintedNeighborhoods();
  if (nb && map.getSource(NB)) (map.getSource(NB) as GeoJSONSource).setData(nb);
  const labelNb = st.viewMode === "reach" ? st.neighborhoods : nb;
  if (labelNb && map.getSource(NB_LABELS)) {
    (map.getSource(NB_LABELS) as GeoJSONSource).setData(neighborhoodLabelCollection(labelNb));
  }
  const b = st.buildings;
  if (b && map.getSource(BLD)) (map.getSource(BLD) as GeoJSONSource).setData(b);
  if (map.getSource(ISO)) (map.getSource(ISO) as GeoJSONSource).setData(lastIsochroneFeatures());
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
    if (map.getLayer("nb-label")) {
      map.setPaintProperty("nb-label", "text-color", "#eafff4");
      map.setPaintProperty("nb-label", "text-halo-color", "#06140c");
      map.setPaintProperty("nb-label", "text-halo-width", 1.6);
    }
    applyStreetLabelContrast(map, true);
  } else {
    map.setPaintProperty("nb-fill", "fill-color", "#0f7a4c");
    map.setPaintProperty("nb-fill", "fill-opacity", 0.07);
    map.setPaintProperty("nb-halo", "line-color", "#ffffff");
    map.setPaintProperty("nb-halo", "line-opacity", 0.85);
    map.setPaintProperty("nb-halo", "line-width", 7);
    map.setPaintProperty("nb-line", "line-color", "#0a5c39");
    map.setPaintProperty("nb-line", "line-opacity", 1);
    map.setPaintProperty("nb-line", "line-width", 3);
    if (map.getLayer("nb-label")) {
      map.setPaintProperty("nb-label", "text-color", "#0a3d28");
      map.setPaintProperty("nb-label", "text-halo-color", "#f7fff9");
      map.setPaintProperty("nb-label", "text-halo-width", 1.8);
    }
    applyStreetLabelContrast(map, false);
  }
  applySearchDim(map, useApp.getState().searchFocus?.hit ?? null);
}

/** Clădirile respectă tipul ales și cartierul. Cele din afara tuturor cartierelor rămân vizibile. */
function buildingFilter(): maplibregl.FilterSpecification {
  const st = useApp.getState();
  return buildingLayerFilter(
    st.filters.neighborhoods,
    st.neighborhoodList.map((n) => n.slug),
    buildingTypeFilterExpr(st.filters.buildingTypes)
  ) as unknown as maplibregl.FilterSpecification;
}

function applyBuildingFilter(map: Map) {
  const f = buildingFilter();
  if (map.getLayer(BLD + "-fill")) map.setFilter(BLD + "-fill", f);
  if (map.getLayer(BLD + "-line")) map.setFilter(BLD + "-line", f);
}

function applyLayerVisibility(map: Map) {
  const { layers, editMode } = useApp.getState();

  setVis(map, BLD + "-fill", layers.buildings);
  setVis(map, BLD + "-line", layers.buildings);
  applyBuildingFilter(map);

  setVis(map, "streets-base", layers.streetsBase || editMode);
  setVis(map, "streets-bike", layers.bike);
  setVis(map, "streets-bike-door", layers.bikeDoor);
  setVis(map, "streets-reserved", layers.reserved);
  setVis(map, "streets-illegal", layers.illegal);
  setVis(map, "streets-school", layers.schoolAssign);
  setVis(map, "streets-edit", editMode && layers.editedStreets);
  setVis(map, "streets-halo", editMode && layers.editedStreets);
  const splitOn = Boolean(useApp.getState().splitTool);
  setVis(map, "split-halo", splitOn);
  setVis(map, "split-line", splitOn);
  if (!splitOn) pushSplitData(map);
  setVis(map, "nb-fill", layers.neighborhoods);
  setVis(map, "nb-halo", layers.neighborhoods);
  setVis(map, "nb-line", layers.neighborhoods);
  setVis(map, "nb-label", layers.neighborhoods);

  const reachOn = useApp.getState().viewMode === "reach";
  if (reachOn) {
    setVis(map, "nb-fill", false);
    setVis(map, "nb-halo", false);
    setVis(map, "nb-line", false);
    setVis(map, "nb-label", true);
    if (map.getLayer("nb-label")) map.setPaintProperty("nb-label", "text-halo-width", 3.2);
  } else if (map.getLayer("nb-label")) {
    const darkBg = ["dark", "satellite"].includes(useApp.getState().basemap);
    map.setPaintProperty("nb-label", "text-halo-width", darkBg ? 1.6 : 1.8);
  }
  setVis(map, "isochrone-fill", reachOn);
  setVis(map, "isochrone-line-halo", reachOn);
  setVis(map, "isochrone-line", reachOn);
  setVis(map, "isochrone-net", reachOn);
  if (map.getLayer("isochrone-fill")) map.setFilter("isochrone-fill", ["==", ["get", "kind"], "band"]);
  if (map.getLayer("isochrone-line-halo")) map.setFilter("isochrone-line-halo", ["==", ["get", "kind"], "band"]);
  if (map.getLayer("isochrone-line")) map.setFilter("isochrone-line", ["==", ["get", "kind"], "band"]);
  if (map.getLayer("isochrone-net")) map.setFilter("isochrone-net", ["==", ["get", "kind"], "net"]);

  if (map.getLayer("streets-base")) {
    const dim = reachOn ? 0.2 : layers.buildings && !layers.bike ? 0.28 : 0.55;
    map.setPaintProperty("streets-base", "line-opacity", dim);
  }
  applySearchDim(map, useApp.getState().searchFocus?.hit ?? null);
}

function setVis(map: Map, id: string, on: boolean) {
  if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** Conturul cartierelor deasupra străzilor; fill-ul rămâne dedesubt. */
function ensureOverlayOrder(map: Map) {
  const bottomToTop = [
    "nb-fill",
    ...searchGlowFillLayerIds(),
    "isochrone-fill",
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
    "presence-lock-casing",
    "presence-lock-line",
    "nb-halo",
    "nb-line",
    "streets-label-halo",
    "streets-label",
    "isochrone-net",
    "isochrone-line-halo",
    "isochrone-line",
    "nb-label",
    ...searchGlowOverlayLayerIds(),
    "split-halo",
    "split-line",
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
  if (!map.getSource(SCH)) map.addSource(SCH, { type: "geojson", data: empty(), tolerance: 0.4 });
  if (!map.getSource(NB)) map.addSource(NB, { type: "geojson", data: empty(), tolerance: 0.75 });
  if (!map.getSource(NB_LABELS)) map.addSource(NB_LABELS, { type: "geojson", data: empty() });
  if (!map.getSource(ISO)) map.addSource(ISO, { type: "geojson", data: empty() });
  addSearchHighlightLayers(map);

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
  if (!map.getLayer("nb-label")) {
    map.addLayer({
      id: "nb-label",
      type: "symbol",
      source: NB_LABELS,
      minzoom: 11.2,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          11,
          13.8,
          13,
          15.5,
          15.5,
          17.5,
          18,
        ],
        "text-max-width": 8,
        "text-line-height": 1.1,
        "text-letter-spacing": 0.04,
        "text-anchor": "center",
        "text-justify": "center",
        "text-padding": 2,
        "text-optional": false,
        "symbol-sort-key": ["-", ["get", "area"]],
        "text-allow-overlap": true,
        "text-ignore-placement": true,
        "text-pitch-alignment": "viewport",
        "text-rotation-alignment": "viewport",
      },
      paint: {
        "text-color": "#0a3d28",
        "text-halo-color": "#f7fff9",
        "text-halo-width": 1.8,
        "text-halo-blur": 0.2,
        "text-opacity": 0.96,
      },
    });
  }

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

  if (schoolLayerNeedsRebuild(map) && map.getLayer("streets-school")) {
    map.removeLayer("streets-school");
  }
  const schoolWidth: maplibregl.ExpressionSpecification = [
    "case",
    [">", ["get", "flag_count"], 1],
    ["case", [">", ["coalesce", ["get", "school_n"], 1], 1], 3.2, 4.1],
    [
      "case",
      [">", ["coalesce", ["get", "school_n"], 1], 2],
      3.6,
      [">", ["coalesce", ["get", "school_n"], 1], 1],
      4.4,
      5.5,
    ],
  ];
  const schoolColorExpr: maplibregl.ExpressionSpecification = [
    "coalesce",
    ["get", "school_color"],
    LAYER_COLORS.schoolAssign,
  ];
  if (!map.getLayer("streets-school")) {
    map.addLayer({
      id: "streets-school",
      type: "line",
      source: SCH,
      filter: flagFilter("has_arondat"),
      paint: {
        "line-color": schoolColorExpr,
        "line-width": schoolWidth,
        "line-opacity": 0.95,
        "line-offset": ["coalesce", ["get", "off_sch"], 0],
      },
      layout: { ...lineLayout, visibility: "none" },
    });
  } else {
    map.setFilter("streets-school", flagFilter("has_arondat"));
    map.setPaintProperty("streets-school", "line-color", schoolColorExpr);
    map.setPaintProperty("streets-school", "line-width", schoolWidth);
    map.setPaintProperty("streets-school", "line-offset", ["coalesce", ["get", "off_sch"], 0]);
    map.setPaintProperty("streets-school", "line-opacity", 0.95);
  }
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

  addStreetLabelLayer(map);
  addIsochroneLayers(map);
  applyNeighborhoodStyle(map);
  ensureOverlayOrder(map);
}

const STREET_LABEL_MINZOOM = 14.2;
const STREET_LABEL_ALL_ZOOM = 15.05;
const MAJOR_STREET_HIGHWAYS = [
  "primary",
  "secondary",
  "tertiary",
  "trunk",
  "primary_link",
  "secondary_link",
  "tertiary_link",
  "trunk_link",
  "unclassified",
];

function applyStreetLabelContrast(map: Map, darkBg: boolean) {
  if (!map.getLayer("streets-label")) return;
  // Contur închis + halo alb: literele rămân lizibile pe galben / verde / roz.
  const fill = darkBg ? "#0b0d0c" : "#121412";
  const knockout = "#ffffff";
  const rim = darkBg ? "#050605" : "#0d0f0e";
  if (map.getLayer("streets-label-halo")) {
    map.setPaintProperty("streets-label-halo", "text-color", knockout);
    map.setPaintProperty("streets-label-halo", "text-halo-color", rim);
    map.setPaintProperty("streets-label-halo", "text-halo-width", darkBg ? 3.1 : 2.85);
    map.setPaintProperty("streets-label-halo", "text-halo-blur", 0.05);
  }
  map.setPaintProperty("streets-label", "text-color", fill);
  map.setPaintProperty("streets-label", "text-halo-color", knockout);
  map.setPaintProperty("streets-label", "text-halo-width", darkBg ? 1.55 : 1.4);
  map.setPaintProperty("streets-label", "text-halo-blur", 0);
}

function addStreetLabelLayer(map: Map) {
  const filter: maplibregl.FilterSpecification = [
    "all",
    [">", ["length", ["to-string", ["coalesce", ["get", "name"], ""]]], 0],
    [
      "any",
      [">=", ["zoom"], STREET_LABEL_ALL_ZOOM],
      ["match", ["get", "highway"], MAJOR_STREET_HIGHWAYS, true, false],
    ],
  ];

  const layout: maplibregl.SymbolLayerSpecification["layout"] = {
    "symbol-placement": "line",
    "symbol-spacing": ["interpolate", ["linear"], ["zoom"], 14.2, 420, 16, 280, 18, 220],
    "text-field": ["get", "name"],
    "text-font": ["Noto Sans Bold"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 14.2, 11.5, 16, 13, 18, 14.5],
    "text-max-angle": 32,
    "text-max-width": 28,
    "text-letter-spacing": 0.03,
    "text-padding": 2,
    "text-keep-upright": true,
    "text-optional": true,
    "text-pitch-alignment": "viewport",
    "text-rotation-alignment": "map",
    "symbol-z-order": "viewport-y",
  };

  if (!map.getLayer("streets-label-halo")) {
    map.addLayer({
      id: "streets-label-halo",
      type: "symbol",
      source: SRC,
      minzoom: STREET_LABEL_MINZOOM,
      filter,
      layout,
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#0d0f0e",
        "text-halo-width": 2.85,
        "text-halo-blur": 0.05,
        "text-opacity": 1,
      },
    });
  } else {
    map.setFilter("streets-label-halo", filter);
  }

  if (!map.getLayer("streets-label")) {
    map.addLayer({
      id: "streets-label",
      type: "symbol",
      source: SRC,
      minzoom: STREET_LABEL_MINZOOM,
      filter,
      layout: {
        ...layout,
        // Același anchor ca halo-ul; fără astea coliziunea dintre cele două straturi ascunde literele.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#121412",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
        "text-halo-blur": 0,
        "text-opacity": 1,
      },
    });
  } else {
    map.setFilter("streets-label", filter);
  }
}

function addBuildingLayers(map: Map) {
  const data = useApp.getState().buildings || empty();
  if (!map.getSource(BLD)) map.addSource(BLD, { type: "geojson", data });
  else (map.getSource(BLD) as GeoJSONSource).setData(data);

  const fillColor = buildingFillColorExpr() as maplibregl.ExpressionSpecification;
  if (!map.getLayer(BLD + "-fill")) {
    map.addLayer({
      id: BLD + "-fill",
      type: "fill",
      source: BLD,
      layout: { visibility: "none" },
      paint: {
        "fill-color": fillColor,
        "fill-opacity": 0.58,
      },
    });
  } else {
    map.setPaintProperty(BLD + "-fill", "fill-color", fillColor);
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
  applyBuildingFilter(map);
  // Keep buildings visible when zoomed out (older sessions may still have a high minzoom).
  if (map.getLayer(BLD + "-fill")) map.setLayerZoomRange(BLD + "-fill", 0, 24);
  if (map.getLayer(BLD + "-line")) map.setLayerZoomRange(BLD + "-line", 0, 24);
}

function fineHover() {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function applyIsochroneToMap(map: Map, result: { ok: true; features: GeoJSON.FeatureCollection } | { ok: false }) {
  const fc = result.ok ? result.features : { type: "FeatureCollection" as const, features: [] };
  setLastIsochroneFeatures(fc);
  if (map.getSource(ISO)) (map.getSource(ISO) as GeoJSONSource).setData(fc);
}

function publishReach(
  origin: { lng: number; lat: number },
  result: { ok: true; features: GeoJSON.FeatureCollection } | { ok: false },
  marker: Marker | null,
  pinned: boolean,
  profile: string
) {
  setLastReachOrigin(origin);
  const st = useApp.getState();
  const stats = describeReach(
    origin,
    result.ok ? result.features : { type: "FeatureCollection", features: [] },
    st.neighborhoods,
    st.schools
  );
  st.setIsochroneStats(stats);
  paintReachPin(marker?.getElement() ?? null, { live: fineHover() && !pinned, profile });
}

/** Pinul de pe hartă: doar punctul + indiciul de mutare. Statisticile stau în panoul din colț. */
function paintReachPin(el: HTMLElement | null, opts: { live: boolean; profile: string }) {
  if (!el) return;
  el.classList.add("reach-pin");
  el.classList.toggle("is-live", opts.live);
  el.classList.toggle("is-pinned", !opts.live);
  el.classList.toggle("is-walk", opts.profile === "walk");
  el.classList.toggle("is-bike", opts.profile !== "walk");
  el.style.pointerEvents = opts.live ? "none" : "auto";
  const hint = el.querySelector<HTMLElement>(".reach-pin-hint");
  if (hint) hint.hidden = opts.live;
}

function reachPinEl(live: boolean) {
  const el = document.createElement("div");
  el.className = "reach-pin is-bike";
  el.innerHTML = `<span class="reach-pin-pulse"></span><span class="reach-pin-dot"></span><div class="reach-pin-hint" hidden><span class="reach-pin-hint-desk">Click pe punct ca să-l muți</span><span class="reach-pin-hint-touch">Ține apăsat ca să muți</span></div>`;
  paintReachPin(el, { live, profile: "bike" });
  return el;
}

function addIsochroneLayers(map: Map) {
  if (!map.getLayer("isochrone-fill")) {
    map.addLayer({
      id: "isochrone-fill",
      type: "fill",
      source: ISO,
      filter: ["==", ["get", "kind"], "band"],
      layout: { visibility: "none" },
      paint: {
        "fill-color": ["coalesce", ["get", "fill"], "#00C853"],
        "fill-opacity": ["coalesce", ["get", "opacity"], 0.5],
      },
    });
  }
  if (!map.getLayer("isochrone-net")) {
    map.addLayer({
      id: "isochrone-net",
      type: "line",
      source: ISO,
      filter: ["==", ["get", "kind"], "net"],
      layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "net"], "#00E676"],
        "line-width": 2.7,
        "line-opacity": 0.92,
      },
    });
  }
  if (!map.getLayer("isochrone-line-halo")) {
    map.addLayer({
      id: "isochrone-line-halo",
      type: "line",
      source: ISO,
      filter: ["==", ["get", "kind"], "band"],
      layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": 5.5,
        "line-opacity": 0.8,
      },
    });
  }
  if (!map.getLayer("isochrone-line")) {
    map.addLayer({
      id: "isochrone-line",
      type: "line",
      source: ISO,
      filter: ["==", ["get", "kind"], "band"],
      layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "line"], "#01331c"],
        "line-width": 2.2,
        "line-opacity": 0.95,
      },
    });
  }
}

function splitReachMeters(map: Map, lat: number, radiusPx: number) {
  const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
  return Math.max(8, radiusPx * metersPerPx * 1.4);
}

function projectSplitPoint(map: Map, lines: ReturnType<typeof featureLines>, p: SplitPoint, radiusPx: number) {
  const hit = projectOnLines(lines, p);
  const reach = splitReachMeters(map, p[1], radiusPx);
  if (!hit || hit.distM > reach) return null;
  return hit;
}

function bindPopupTooltips(popupEl: HTMLElement) {
  const HOVER_MS = 0;
  const HOLD_MS = 450;
  let bubble: HTMLDivElement | null = null;
  let hoverTimer = 0;
  let holdTimer = 0;
  let suppressClick = false;
  let activeBtn: HTMLElement | null = null;

  const placeBubble = (btn: HTMLElement) => {
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "tip-bubble";
      bubble.setAttribute("role", "tooltip");
      document.body.appendChild(bubble);
    }
    const tip = btn.dataset.tip || btn.getAttribute("aria-label") || "";
    bubble.textContent = tip;
    const rect = btn.getBoundingClientRect();
    const gap = 8;
    const estH = 40;
    const below = rect.bottom + gap + estH <= window.innerHeight - 8;
    const top = below ? rect.bottom + gap : rect.top - gap;
    const transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    const center = rect.left + rect.width / 2;
    const half = 110;
    const left = Math.min(window.innerWidth - 8 - half, Math.max(8 + half, center));
    bubble.style.position = "fixed";
    bubble.style.zIndex = "80";
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;
    bubble.style.transform = transform;
    bubble.style.display = "block";
  };

  const hideBubble = () => {
    window.clearTimeout(hoverTimer);
    window.clearTimeout(holdTimer);
    suppressClick = false;
    activeBtn = null;
    if (bubble) bubble.style.display = "none";
  };

  const onOver = (ev: Event) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
    if (!btn || !popupEl.contains(btn)) return;
    activeBtn = btn;
    window.clearTimeout(hoverTimer);
    if (HOVER_MS <= 0) {
      placeBubble(btn);
      return;
    }
    hoverTimer = window.setTimeout(() => placeBubble(btn), HOVER_MS);
  };

  const onOut = (ev: Event) => {
    const rel = (ev as MouseEvent).relatedTarget as Node | null;
    if (rel && (rel as HTMLElement).closest?.("[data-tip]") === activeBtn) return;
    hideBubble();
  };

  const onFocusIn = (ev: Event) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
    if (!btn || !popupEl.contains(btn)) return;
    activeBtn = btn;
    placeBubble(btn);
  };

  const onFocusOut = () => hideBubble();

  const onPointerDown = (ev: PointerEvent) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-tip]");
    if (!btn || !popupEl.contains(btn) || ev.pointerType !== "touch") return;
    activeBtn = btn;
    window.clearTimeout(holdTimer);
    suppressClick = false;
    holdTimer = window.setTimeout(() => {
      suppressClick = true;
      placeBubble(btn);
    }, HOLD_MS);
  };

  const onPointerUp = (ev: PointerEvent) => {
    if (ev.pointerType !== "touch") return;
    window.clearTimeout(holdTimer);
    if (suppressClick) hideBubble();
  };

  const onClickCapture = (ev: Event) => {
    if (!suppressClick) return;
    ev.preventDefault();
    ev.stopPropagation();
    suppressClick = false;
    hideBubble();
  };

  popupEl.addEventListener("mouseover", onOver);
  popupEl.addEventListener("mouseout", onOut);
  popupEl.addEventListener("focusin", onFocusIn);
  popupEl.addEventListener("focusout", onFocusOut);
  popupEl.addEventListener("pointerdown", onPointerDown);
  popupEl.addEventListener("pointerup", onPointerUp);
  popupEl.addEventListener("pointercancel", onPointerUp);
  popupEl.addEventListener("click", onClickCapture, true);

  return () => {
    hideBubble();
    bubble?.remove();
    bubble = null;
    popupEl.removeEventListener("mouseover", onOver);
    popupEl.removeEventListener("mouseout", onOut);
    popupEl.removeEventListener("focusin", onFocusIn);
    popupEl.removeEventListener("focusout", onFocusOut);
    popupEl.removeEventListener("pointerdown", onPointerDown);
    popupEl.removeEventListener("pointerup", onPointerUp);
    popupEl.removeEventListener("pointercancel", onPointerUp);
    popupEl.removeEventListener("click", onClickCapture, true);
  };
}

function featureMidpoint(geometry: GeoJSON.Geometry | null | undefined): [number, number] | null {
  const lines = featureLines(geometry);
  if (!lines.length) return null;
  const bounds = new maplibregl.LngLatBounds();
  for (const line of lines) for (const c of line) bounds.extend(c as [number, number]);
  const c = bounds.getCenter();
  return [c.lng, c.lat];
}

function polygonCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  const ring =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates[0]?.[0]
        : null;
  if (!ring?.length) return null;
  let x = 0;
  let y = 0;
  for (const c of ring) {
    x += c[0];
    y += c[1];
  }
  return [x / ring.length, y / ring.length];
}

function lineMidpoint(geometry: GeoJSON.Geometry): [number, number] | null {
  const lines = featureLines(geometry);
  if (!lines.length) return null;
  let best = lines[0];
  let bestLen = -1;
  for (const line of lines) {
    let len = 0;
    for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (len > bestLen) {
      best = line;
      bestLen = len;
    }
  }
  if (!best.length) return null;
  if (best.length === 1 || bestLen <= 0) return best[0];
  const target = bestLen / 2;
  let walked = 0;
  for (let i = 1; i < best.length; i++) {
    const a = best[i - 1];
    const b = best[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const seg = Math.hypot(dx, dy);
    if (walked + seg >= target && seg > 0) {
      const t = (target - walked) / seg;
      return [a[0] + dx * t, a[1] + dy * t];
    }
    walked += seg;
  }
  return best[best.length - 1];
}

function lockAnchor(feature: GeoJSON.Feature): [number, number] | null {
  const g = feature.geometry;
  if (!g || g.type === "GeometryCollection") return null;
  if (g.type === "Polygon" || g.type === "MultiPolygon") return polygonCentroid(g);
  return lineMidpoint(g) || featureMidpoint(g);
}

function presenceAccentColor() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  return raw || "#0f7a4c";
}

function presenceLockCollection(): GeoJSON.FeatureCollection {
  const st = useApp.getState();
  const features: GeoJSON.Feature[] = [];
  for (const user of getPresence()) {
    for (const lock of user.locks) {
      const feature =
        lock.kind === "building"
          ? buildingFeatureForFocus(st.buildings, lock.id)
          : streetFeatureForFocus(st.streets, st.pipelineStreetsRaw, lock.id);
      if (!feature?.geometry || feature.geometry.type === "GeometryCollection") continue;
      features.push({
        type: "Feature",
        properties: {},
        geometry: feature.geometry,
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function ensurePresenceLockLayers(map: Map) {
  if (!map.getSource(PRESENCE_LOCK)) {
    map.addSource(PRESENCE_LOCK, { type: "geojson", data: empty() });
  }
  const accent = presenceAccentColor();
  if (!map.getLayer("presence-lock-casing")) {
    map.addLayer({
      id: "presence-lock-casing",
      type: "line",
      source: PRESENCE_LOCK,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 5, "line-opacity": 0.8 },
    });
  }
  if (!map.getLayer("presence-lock-line")) {
    map.addLayer({
      id: "presence-lock-line",
      type: "line",
      source: PRESENCE_LOCK,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": accent, "line-width": 2.4, "line-opacity": 0.95 },
    });
  } else {
    map.setPaintProperty("presence-lock-line", "line-color", accent);
  }
}

function pushPresenceLocks(map: Map) {
  const src = map.getSource(PRESENCE_LOCK) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(presenceLockCollection());
  if (map.getLayer("presence-lock-line")) map.setPaintProperty("presence-lock-line", "line-color", presenceAccentColor());
}

function clearPresenceLocks(map: Map) {
  try {
    const src = map.getSource(PRESENCE_LOCK) as GeoJSONSource | undefined;
    src?.setData(empty());
  } catch {
    /* map already removed */
  }
}

function empty(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
