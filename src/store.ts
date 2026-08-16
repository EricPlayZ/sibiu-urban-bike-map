import { create } from "zustand";
import type { BasemapId, Measurement, ViewMode } from "./lib/space";
import type { UiTheme } from "./lib/theme";
import { applyDocumentTheme, basemapForTheme, defaultBasemapForTheme, loadUiTheme, resolveTheme, saveUiTheme } from "./lib/theme";
import {
  deleteMeasurement,
  exportAll,
  loadBuildingTypes,
  loadCustomNeighborhoods,
  loadMeasurements,
  loadRemovedSids,
  markRemovedSid,
  migrateV1,
  purgeAllMeasurements,
  purgeEmptyOrFlagOnlyMeasurements,
  purgeExcelSeedMeasurements,
  saveBuildingType,
  saveCustomNeighborhoods,
  saveMeasurement,
  saveRemovedSids,
  unmarkRemovedSid,
} from "./lib/store";
import { applyLocalEditsToCollection, fetchCommittedLocalEdits, mergeWorkingEdits } from "./lib/localEdits";
import { neighborhoodIsActive } from "./lib/geoAssign";
import {
  featureHasReservedParking,
  hasAnyEdit,
  makeBuildingId,
  resolveStreetMeasurement,
  slugify,
  streetHasBikeLane,
  streetHasDoorZoneBikeLane,
  streetHasIllegalParking,
  streetHasSafeBikeLane,
  streetPaintColor,
  LAYER_COLORS,
} from "./lib/space";
import { assignFlagOffsets } from "./lib/streetPopup";
import { VIEW_PRESETS, FOCUS_PRESETS, type FocusId, type LayerVisibility, type MapLayerId } from "./lib/layers";
import { runImportPipeline, type ImportReport } from "./lib/importPipeline";
import type { SearchFocus, SearchHit } from "./lib/mapSearch";

type Filters = {
  /** Slug-uri cartiere selectate (multi). Goale = nimic pe hartă. */
  neighborhoods: string[];
  /** Slug-uri școli selectate — controlează markere + străzi arondate. */
  schools: string[];
};

type Selected =
  | { kind: "street"; id: string; name: string; props: Record<string, unknown> }
  | { kind: "building"; id: string; type: string }
  | null;

type AppState = {
  ready: boolean;
  loadingMsg: string;
  editMode: boolean;
  /** streetsBase înainte de editare (pt. restaurare). */
  streetsBaseBeforeEdit: boolean | null;
  drawing: boolean;
  drawPoints: [number, number][];
  viewMode: ViewMode;
  layers: LayerVisibility;
  basemap: BasemapId;
  uiTheme: UiTheme;
  filters: Filters;
  filtersOpen: boolean;
  basemapOpen: boolean;
  statsOpen: boolean;
  themeOpen: boolean;
  editsOpen: boolean;
  importReportOpen: boolean;
  searchOpen: boolean;
  searchFocus: SearchFocus | null;
  sheetOpen: boolean;
  selected: Selected;
  streets: GeoJSON.FeatureCollection | null;
  /** Pipeline CSV/OSM, fără overlay de editări locale. */
  pipelineStreets: GeoJSON.FeatureCollection | null;
  neighborhoods: GeoJSON.FeatureCollection | null;
  measurements: Record<string, Measurement>;
  /** Editări din `public/data/local-edits.json` (sursă pe site-ul live). */
  committedEdits: Record<string, Measurement>;
  /** Catalog măsurători din CSV pe cartier (cheie cartier::strada). */
  seedMeasurements: Record<string, Measurement>;
  importReport: ImportReport | null;
  buildingTypes: Record<string, { type: string }>;
  buildings: GeoJSON.FeatureCollection | null;
  schools: GeoJSON.FeatureCollection | null;
  neighborhoodList: { slug: string; name: string }[];
  schoolList: { slug: string; name: string }[];
  toast: string | null;

  init: () => Promise<void>;
  setEditMode: (v: boolean) => void;
  setViewMode: (v: ViewMode) => void;
  setLayer: (id: MapLayerId, on: boolean) => void;
  applyFocus: (id: FocusId) => void;
  clearFocus: () => void;
  setBasemap: (v: BasemapId) => void;
  setUiTheme: (v: UiTheme) => void;
  syncSystemTheme: () => void;
  setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void;
  toggleNeighborhood: (slug: string) => void;
  toggleAllNeighborhoods: () => void;
  toggleSchool: (slug: string) => void;
  toggleAllSchools: () => void;
  toggleFilters: () => void;
  closeFilters: () => void;
  closeStats: () => void;
  toggleBasemap: () => void;
  toggleStats: () => void;
  toggleTheme: () => void;
  toggleEdits: () => void;
  closeEdits: () => void;
  toggleImportReport: () => void;
  closeImportReport: () => void;
  toggleSearch: () => void;
  closeSearch: () => void;
  focusSearchResult: (hit: SearchHit) => void;
  clearSearchFocus: () => void;
  selectStreet: (id: string, name: string, props: Record<string, unknown>) => void;
  selectBuilding: (id: string, type: string) => void;
  closeSheet: () => void;
  saveStreet: (id: string, data: Measurement) => void;
  deleteStreetEdit: (id: string) => void;
  purgeAllStreetEdits: () => void;
  openStreetEdit: (id: string) => void;
  setBuildingType: (id: string, type: string) => void;
  startDraw: () => void;
  addDrawPoint: (lng: number, lat: number) => void;
  finishDraw: (name: string) => void;
  cancelDraw: () => void;
  ensureBuildings: () => Promise<void>;
  paintedStreets: () => GeoJSON.FeatureCollection | null;
  paintedNeighborhoods: () => GeoJSON.FeatureCollection | null;
  measurementForStreet: (id: string, props?: Record<string, unknown> | null) => Measurement;
  showToast: (msg: string) => void;
  doExport: () => void;
};

function syncWorkingStreets(
  pipeline: GeoJSON.FeatureCollection | null,
  committed: Record<string, Measurement>,
  selected: Selected
): {
  measurements: Record<string, Measurement>;
  streets: GeoJSON.FeatureCollection | null;
  selected: Selected;
} {
  const measurements = mergeWorkingEdits(committed, loadMeasurements(), loadRemovedSids());
  const streets = pipeline ? applyLocalEditsToCollection(pipeline, measurements) : null;
  let nextSelected = selected;
  if (selected?.kind === "street" && streets) {
    const f = streets.features.find((x) => String((x.properties as { sid?: string })?.sid) === selected.id);
    if (f) {
      nextSelected = { ...selected, props: (f.properties || selected.props) as Record<string, unknown> };
    }
  }
  return { measurements, streets, selected: nextSelected };
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  loadingMsg: "Pregătim harta…",
  editMode: false,
  streetsBaseBeforeEdit: null,
  drawing: false,
  drawPoints: [],
  viewMode: "space",
  layers: { ...VIEW_PRESETS.space },
  basemap: defaultBasemapForTheme(loadUiTheme()),
  uiTheme: loadUiTheme(),
  filters: { neighborhoods: [], schools: [] },
  filtersOpen: false,
  basemapOpen: false,
  statsOpen: true,
  themeOpen: false,
  editsOpen: false,
  importReportOpen: false,
  searchOpen: false,
  searchFocus: null,
  sheetOpen: false,
  selected: null,
  streets: null,
  pipelineStreets: null,
  neighborhoods: null,
  measurements: {},
  committedEdits: {},
  seedMeasurements: {},
  importReport: null,
  buildingTypes: {},
  buildings: null,
  schools: null,
  neighborhoodList: [],
  schoolList: [],
  toast: null,

  showToast: (msg) => {
    set({ toast: msg });
    window.setTimeout(() => set({ toast: null }), 2800);
  },

  init: async () => {
    applyDocumentTheme(get().uiTheme);
    set({ loadingMsg: "Importăm geometrie + CSV…" });
    const [limits, schools] = await Promise.all([
      fetch("./neighborhood_limits.geojson").then((r) => r.json()) as Promise<GeoJSON.FeatureCollection>,
      fetch("./schools.geojson")
        .then((r) => r.json())
        .catch(() => ({ type: "FeatureCollection", features: [] })) as Promise<GeoJSON.FeatureCollection>,
    ]);

    const [imported, committedEdits] = await Promise.all([runImportPipeline(limits), fetchCommittedLocalEdits()]);
    const pipelineStreets = imported.streets;

    purgeExcelSeedMeasurements();
    migrateV1(pipelineStreets);
    purgeEmptyOrFlagOnlyMeasurements();

    const measurements = mergeWorkingEdits(committedEdits, loadMeasurements(), loadRemovedSids());
    const streets = applyLocalEditsToCollection(pipelineStreets, measurements);

    const officialFeatures = (limits.features || []).filter((f) =>
      neighborhoodIsActive(f.properties as { dissolve?: unknown })
    );
    const custom = loadCustomNeighborhoods();
    const neighborhoodList = officialFeatures
      .map((f) => {
        const p = f.properties as { slug?: string; denumire?: string; name?: string };
        return { slug: p.slug || "", name: p.denumire || p.name || p.slug || "" };
      })
      .filter((n) => n.slug)
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));

    const schoolList = (schools.features || [])
      .map((f) => {
        const p = f.properties as { slug?: string; denumire?: string; name?: string };
        return { slug: p.slug || "", name: p.denumire || p.name || p.slug || "" };
      })
      .filter((n) => n.slug)
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));

    const errorCount = imported.report.issues.filter((i) => i.severity === "error").length;

    set({
      streets,
      pipelineStreets,
      neighborhoods: {
        type: "FeatureCollection",
        features: [...officialFeatures, ...(custom.features || [])],
      },
      measurements,
      committedEdits,
      seedMeasurements: imported.csvMeasurements,
      importReport: imported.report,
      importReportOpen: true,
      statsOpen: true,
      buildingTypes: loadBuildingTypes(),
      schools,
      neighborhoodList,
      schoolList,
      filters: {
        ...get().filters,
        neighborhoods: neighborhoodList.map((n) => n.slug),
        schools: schoolList.map((s) => s.slug),
      },
      ready: true,
      loadingMsg: "",
    });

    if (errorCount > 0) {
      get().showToast(`Import: ${errorCount} erori de potrivire CSV↔OSM`);
    }
  },

  setEditMode: (v) => {
    if (v) {
      if (get().editMode) return;
      set({
        editMode: true,
        streetsBaseBeforeEdit: get().layers.streetsBase,
        layers: { ...get().layers, streetsBase: true },
      });
      return;
    }
    if (!get().editMode) return;
    const restore = get().streetsBaseBeforeEdit;
    set({
      editMode: false,
      streetsBaseBeforeEdit: null,
      drawing: false,
      drawPoints: [],
      layers: {
        ...get().layers,
        streetsBase: restore == null ? get().layers.streetsBase : restore,
      },
    });
  },
  setViewMode: (v) => {
    const layers = { ...VIEW_PRESETS[v] };
    if (get().editMode) layers.streetsBase = true;
    set({ viewMode: v, layers });
  },
  setLayer: (id, on) => {
    // În editare, baza rămâne mereu activă ca să vezi străzile needitate
    if (get().editMode && id === "streetsBase" && !on) return;
    set({ layers: { ...get().layers, [id]: on } });
  },
  applyFocus: (id) => {
    const layers = { ...VIEW_PRESETS[get().viewMode], ...FOCUS_PRESETS[id] };
    if (get().editMode) layers.streetsBase = true;
    set({ layers });
  },
  clearFocus: () => {
    const layers = { ...VIEW_PRESETS[get().viewMode] };
    if (get().editMode) layers.streetsBase = true;
    set({ layers });
  },
  setBasemap: (v) => set({ basemap: v, basemapOpen: false }),
  setUiTheme: (v) => {
    saveUiTheme(v);
    const resolved = applyDocumentTheme(v);
    const nextBasemap = basemapForTheme(resolved, get().basemap);
    set(nextBasemap ? { uiTheme: v, themeOpen: false, basemap: nextBasemap } : { uiTheme: v, themeOpen: false });
  },

  /** Când tema e „system” și OS se schimbă — actualizează UI + basemap light/dark. */
  syncSystemTheme: () => {
    if (get().uiTheme !== "system") return;
    const resolved = resolveTheme("system");
    applyDocumentTheme("system");
    const nextBasemap = basemapForTheme(resolved, get().basemap);
    if (nextBasemap) set({ basemap: nextBasemap });
  },
  setFilter: (k, v) => set({ filters: { ...get().filters, [k]: v } }),
  toggleNeighborhood: (slug) => {
    const cur = get().filters.neighborhoods;
    const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug];
    set({ filters: { ...get().filters, neighborhoods: next } });
  },
  toggleAllNeighborhoods: () => {
    const list = get().neighborhoodList.map((n) => n.slug);
    const cur = get().filters.neighborhoods;
    const allOn = list.length > 0 && list.every((s) => cur.includes(s));
    set({ filters: { ...get().filters, neighborhoods: allOn ? [] : list } });
  },
  toggleSchool: (slug) => {
    const cur = get().filters.schools;
    const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug];
    set({ filters: { ...get().filters, schools: next } });
  },
  toggleAllSchools: () => {
    const list = get().schoolList.map((s) => s.slug);
    const cur = get().filters.schools;
    const allOn = list.length > 0 && list.every((s) => cur.includes(s));
    set({ filters: { ...get().filters, schools: allOn ? [] : list } });
  },
  toggleFilters: () =>
    set({ filtersOpen: !get().filtersOpen, basemapOpen: false, themeOpen: false, statsOpen: false, editsOpen: false, importReportOpen: false, searchOpen: false }),
  closeFilters: () => set({ filtersOpen: false }),
  closeStats: () => set({ statsOpen: false }),
  toggleBasemap: () =>
    set({ basemapOpen: !get().basemapOpen, filtersOpen: false, themeOpen: false, statsOpen: false, editsOpen: false, importReportOpen: false, searchOpen: false }),
  toggleStats: () =>
    set({ statsOpen: !get().statsOpen, filtersOpen: false, basemapOpen: false, themeOpen: false, editsOpen: false, importReportOpen: false, searchOpen: false }),
  toggleTheme: () =>
    set({ themeOpen: !get().themeOpen, filtersOpen: false, basemapOpen: false, statsOpen: false, editsOpen: false, importReportOpen: false, searchOpen: false }),
  toggleEdits: () =>
    set({ editsOpen: !get().editsOpen, filtersOpen: false, basemapOpen: false, themeOpen: false, statsOpen: false, importReportOpen: false, searchOpen: false }),
  closeEdits: () => set({ editsOpen: false }),
  toggleImportReport: () =>
    set({
      importReportOpen: !get().importReportOpen,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
      editsOpen: false,
      searchOpen: false,
    }),
  closeImportReport: () => set({ importReportOpen: false }),
  toggleSearch: () =>
    set({
      searchOpen: !get().searchOpen,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
      editsOpen: false,
      importReportOpen: false,
    }),
  closeSearch: () => set({ searchOpen: false }),
  focusSearchResult: (hit) =>
    set({
      searchOpen: false,
      searchFocus: { token: (get().searchFocus?.token ?? 0) + 1, hit },
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
      editsOpen: false,
      importReportOpen: false,
    }),
  clearSearchFocus: () => set({ searchFocus: null }),

  selectStreet: (id, name, props) =>
    set({
      selected: { kind: "street", id, name, props },
      sheetOpen: true,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      editsOpen: false,
      statsOpen: false,
      importReportOpen: false,
      searchOpen: false,
    }),
  selectBuilding: (id, type) =>
    set({
      selected: { kind: "building", id, type },
      sheetOpen: true,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      editsOpen: false,
      statsOpen: false,
      importReportOpen: false,
      searchOpen: false,
    }),
  closeSheet: () => set({ sheetOpen: false, selected: null }),

  saveStreet: (id, data) => {
    unmarkRemovedSid(id);
    saveMeasurement(id, data);
    set(syncWorkingStreets(get().pipelineStreets, get().committedEdits, get().selected));
    get().showToast("Salvat pe acest segment");
  },

  deleteStreetEdit: (id) => {
    markRemovedSid(id);
    deleteMeasurement(id);
    const sel = get().selected;
    const selected = sel?.kind === "street" && sel.id === id ? null : sel;
    set({
      ...syncWorkingStreets(get().pipelineStreets, get().committedEdits, selected),
      ...(selected ? {} : { sheetOpen: false }),
    });
    get().showToast("Editare ștearsă pe acest segment");
  },

  purgeAllStreetEdits: () => {
    saveRemovedSids([
      ...loadRemovedSids(),
      ...Object.keys(get().committedEdits),
      ...Object.keys(loadMeasurements()),
    ]);
    purgeAllMeasurements();
    set({
      ...syncWorkingStreets(get().pipelineStreets, get().committedEdits, null),
      sheetOpen: false,
    });
    get().showToast("Editările din acest browser au fost golite");
  },

  openStreetEdit: (id) => {
    const streets = get().streets;
    const f = streets?.features.find((x) => String((x.properties as { sid?: string })?.sid) === id);
    const props = (f?.properties || { sid: id }) as Record<string, unknown>;
    const name = String(props.name || get().measurements[id]?.name || "Stradă");
    get().setEditMode(true);
    set({
      selected: { kind: "street", id, name, props },
      sheetOpen: true,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
      editsOpen: false,
      searchOpen: false,
    });
  },

  setBuildingType: (id, type) => {
    const types = saveBuildingType(id, type);
    const buildings = get().buildings;
    if (buildings) {
      for (const f of buildings.features) {
        if ((f.properties as { bid?: string }).bid === id) (f.properties as { ubr_type: string }).ubr_type = type;
      }
    }
    set({ buildingTypes: types, buildings: buildings ? { ...buildings } : null });
    get().showToast(`Clădire: ${type}`);
  },

  startDraw: () => {
    get().setEditMode(true);
    set({ drawing: true, drawPoints: [] });
  },
  addDrawPoint: (lng, lat) => set({ drawPoints: [...get().drawPoints, [lng, lat]] }),
  cancelDraw: () => set({ drawing: false, drawPoints: [] }),
  finishDraw: (name) => {
    const pts = get().drawPoints;
    if (pts.length < 3) {
      get().showToast("Minim 3 puncte");
      return;
    }
    const slug = slugify(name);
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: { denumire: name, name, slug, source: "drawn" },
      geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] },
    };
    const custom = loadCustomNeighborhoods();
    const idx = custom.features.findIndex((f) => (f.properties as { slug?: string })?.slug === slug);
    if (idx >= 0) custom.features[idx] = feature;
    else custom.features.push(feature);
    saveCustomNeighborhoods(custom);
    const official = (get().neighborhoods?.features || []).filter((f) => (f.properties as { source?: string })?.source !== "drawn");
    // keep only non-drawn from current + all custom
    const base = official.filter((f) => !(f.properties as { source?: string })?.source);
    set({
      neighborhoods: { type: "FeatureCollection", features: [...base, ...custom.features] },
      drawing: false,
      drawPoints: [],
      neighborhoodList: [
        ...get().neighborhoodList.filter((n) => n.slug !== slug),
        { slug, name },
      ].sort((a, b) => a.name.localeCompare(b.name, "ro")),
      filters: {
        ...get().filters,
        neighborhoods: get().filters.neighborhoods.includes(slug)
          ? get().filters.neighborhoods
          : [...get().filters.neighborhoods, slug],
      },
    });
    // reload limits + custom properly
    fetch("./neighborhood_limits.geojson")
      .then((r) => r.json())
      .then((limits: GeoJSON.FeatureCollection) => {
        set({
          neighborhoods: {
            type: "FeatureCollection",
            features: [
              ...(limits.features || []).filter((f) => neighborhoodIsActive(f.properties as { dissolve?: unknown })),
              ...loadCustomNeighborhoods().features,
            ],
          },
        });
      });
    get().showToast(`Cartier salvat: ${name}`);
  },

  ensureBuildings: async () => {
    if (get().buildings) return;
    set({ loadingMsg: "Încărcăm clădirile…" });
    const raw = (await fetch("./buildings.geojson").then((r) => r.json())) as GeoJSON.FeatureCollection;
    const types = get().buildingTypes;
    const features = raw.features.map((f, i) => {
      const id = makeBuildingId(f, i);
      const osm = String((f.properties as { building?: string })?.building || "").toLowerCase();
      let t = types[id]?.type;
      if (!t) {
        if (["house", "detached", "semidetached_house", "bungalow", "villa"].includes(osm)) t = "casa";
        else if (["apartments", "residential", "dormitory", "terrace"].includes(osm)) t = "bloc";
        else t = "necunoscut";
      }
      return {
        type: "Feature" as const,
        properties: { bid: id, ubr_type: t },
        geometry: f.geometry,
      };
    });
    set({ buildings: { type: "FeatureCollection", features }, loadingMsg: "" });
  },

  measurementForStreet: (id, props) => {
    const p = props || (() => {
      const f = get().streets?.features.find((x) => String((x.properties as { sid?: string })?.sid) === id);
      return (f?.properties || {}) as Record<string, unknown>;
    })();
    return resolveStreetMeasurement(id, p, get().measurements, get().seedMeasurements);
  },

  paintedStreets: () => {
    const { streets, measurements, seedMeasurements, filters, layers, editMode } = get();
    if (!streets) return null;
    const selected = new Set(filters.neighborhoods);
    const selectedSchools = new Set(filters.schools);
    const features: GeoJSON.Feature[] = [];
    for (const f of streets.features) {
      const raw = (f.properties || {}) as Record<string, unknown>;
      const sid = String(raw.sid || "");
      const m = resolveStreetMeasurement(sid, raw, measurements, seedMeasurements);
      const cartier = String(raw.cartier || "");
      const showData = !cartier || selected.has(cartier);

      const rawBike = streetHasBikeLane(raw, m);
      const rawIllegal = streetHasIllegalParking(raw, m);
      const rawReserved = featureHasReservedParking(raw);
      const schoolSlug = String(raw.arondat || "").trim();
      const rawSchool = Boolean(schoolSlug);
      const schoolSelected = !schoolSlug || selectedSchools.has(schoolSlug);
      const hasLocal = hasAnyEdit(measurements[sid]);
      // Străzile doar-școală: ascunse fără strat arondare — DAR apar ca bază dacă streetsBase / edit
      const onlySchool = rawSchool && !rawBike && !rawIllegal && !rawReserved && !hasLocal;
      if (!layers.schoolAssign && onlySchool && !layers.streetsBase && !editMode) continue;
      // Școală neselectată: ascunde străzile doar-arondate acelei școli
      if (onlySchool && !schoolSelected && !layers.streetsBase && !editMode) continue;

      // Păstrăm flag-urile semantice din geojson; show_* controlează doar vizibilitatea pe hartă.
      const p: Record<string, unknown> = { ...raw };
      const safeBike = streetHasSafeBikeLane(raw, m);
      const doorBike = streetHasDoorZoneBikeLane(raw, m);
      p.show_bike = showData && layers.bike && safeBike ? 1 : 0;
      p.show_bike_door = showData && layers.bikeDoor && doorBike ? 1 : 0;
      p.show_illgl = showData && layers.illegal && rawIllegal ? 1 : 0;
      p.show_rsrvd = showData && layers.reserved && rawReserved ? 1 : 0;
      p.has_arondat = showData && layers.schoolAssign && rawSchool && schoolSelected ? 1 : 0;
      p.arondat = schoolSlug;

      const edited = editMode && showData && hasLocal;
      p.edited = edited ? 1 : 0;
      p.color = edited ? streetPaintColor(measurements[sid], "space") : LAYER_COLORS.base;

      const hasVisibleGeo = Boolean(p.show_bike || p.show_bike_door || p.show_illgl || p.show_rsrvd || p.has_arondat);
      if (!layers.streetsBase && !editMode && !hasVisibleGeo && !edited) continue;

      assignFlagOffsets(p, { includeSchool: layers.schoolAssign, includeEdit: edited });
      features.push({ ...f, properties: p });
    }
    return { type: "FeatureCollection", features };
  },

  paintedNeighborhoods: () => {
    const { neighborhoods, filters } = get();
    if (!neighborhoods) return null;
    const selected = new Set(filters.neighborhoods);
    return {
      type: "FeatureCollection",
      features: neighborhoods.features.filter((f) => {
        const p = f.properties as { slug?: string };
        return selected.has(String(p.slug || ""));
      }),
    };
  },

  doExport: () => {
    const blob = new Blob(
      [JSON.stringify({ ...exportAll(), measurements: get().measurements }, null, 2)],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `map-the-city-${Date.now()}.json`;
    a.click();
    get().showToast("Export descărcat");
  },
}));
