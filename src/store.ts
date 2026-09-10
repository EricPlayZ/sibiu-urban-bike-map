import { create } from "zustand";
import type { BasemapId, Measurement, ViewMode } from "./lib/space";
import type { UiTheme } from "./lib/theme";
import { applyDocumentTheme, basemapForTheme, defaultBasemapForTheme, loadUiTheme, resolveTheme, saveUiTheme } from "./lib/theme";
import {
  exportAll,
  migrateV1,
  purgeEmptyOrFlagOnlyMeasurements,
  purgeExcelSeedMeasurements,
} from "./lib/store";
import { applyLocalEditsToCollection, fetchCommittedLocalEdits } from "./lib/localEdits";
import { buildingTypesFromFile, parseBuildingEditsFile } from "./lib/buildingEdits";
import {
  buildingTypeMeta,
  inferBuildingTypeFromOsm,
  isClassifiedBuildingType,
  normalizeBuildingType,
} from "./lib/buildingTypes";
import { streetSchoolSlugs } from "./lib/schoolCatchment";
import {
  acquireLock,
  apiLogin,
  apiLogout,
  apiMe,
  deleteStreet as apiDeleteStreet,
  fetchLiveEdits,
  fetchLiveEditsIfChanged,
  openTeamEvents,
  purgeStreets as apiPurgeStreets,
  putBuilding,
  putStreet,
  releaseLock,
  type TeamEvent,
} from "./lib/teamApi";
import { neighborhoodIsActive } from "./lib/geoAssign";
import {
  featureHasReservedParking,
  hasAnyEdit,
  makeBuildingId,
  resolveStreetMeasurement,
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
import {
  ensureIsochroneEngine,
  lastReachOrigin,
  setLastIsochroneFeatures,
  setLastReachOrigin,
  type IsochroneMinutes,
  type IsochroneProfile,
} from "./lib/isochrone";
import { emptyIsochroneStats, type IsochroneStats } from "./lib/isochroneStats";

const LEGEND_OPEN_KEY = "ubr_legend_open";

function loadLegendOpen(): boolean {
  try {
    const v = localStorage.getItem(LEGEND_OPEN_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

function persistLegendOpen(open: boolean) {
  try {
    localStorage.setItem(LEGEND_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

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
  viewMode: ViewMode;
  layers: LayerVisibility;
  basemap: BasemapId;
  uiTheme: UiTheme;
  filters: Filters;
  filtersOpen: boolean;
  basemapOpen: boolean;
  statsOpen: boolean;
  legendOpen: boolean;
  themeOpen: boolean;
  editsOpen: boolean;
  importReportOpen: boolean;
  csvEditorOpen: boolean;
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
  teamAuthed: boolean;
  teamName: string | null;
  teamLoginOpen: boolean;
  entityLock: { held: boolean; holder: string | null };
  isochroneOrigin: { lng: number; lat: number } | null;
  isochroneProfile: IsochroneProfile;
  isochroneMinutes: IsochroneMinutes;
  isochronePinned: boolean;
  isochroneStatus: "idle" | "ready" | "error";
  isochroneStats: IsochroneStats;
  setIsochroneOrigin: (lng: number, lat: number, pinned?: boolean) => void;
  setIsochronePinned: (pinned: boolean) => void;
  setIsochroneProfile: (profile: IsochroneProfile) => void;
  setIsochroneMinutes: (minutes: IsochroneMinutes) => void;
  setIsochroneStats: (stats: IsochroneStats) => void;
  clearIsochrone: () => void;
  warmIsochrone: () => Promise<void>;

  init: () => Promise<void>;
  teamLogin: (password: string, name: string) => Promise<void>;
  teamLogout: () => Promise<void>;
  openTeamLogin: () => void;
  closeTeamLogin: () => void;
  toggleEditAccess: () => void;
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
  closeLegend: () => void;
  openLegend: () => void;
  toggleLegend: () => void;
  toggleBasemap: () => void;
  toggleStats: () => void;
  toggleTheme: () => void;
  toggleEdits: () => void;
  closeEdits: () => void;
  toggleImportReport: () => void;
  closeImportReport: () => void;
  toggleCsvEditor: () => void;
  closeCsvEditor: () => void;
  reloadPipeline: () => Promise<void>;
  toggleSearch: () => void;
  closeSearch: () => void;
  focusSearchResult: (hit: SearchHit) => void;
  clearSearchFocus: () => void;
  selectStreet: (id: string, name: string, props: Record<string, unknown>) => void;
  selectBuilding: (id: string, type: string) => void;
  closeSheet: () => void;
  saveStreet: (id: string, data: Measurement) => Promise<void>;
  deleteStreetEdit: (id: string) => Promise<void>;
  purgeAllStreetEdits: () => Promise<void>;
  openStreetEdit: (id: string) => void;
  setBuildingType: (id: string, type: string) => Promise<void>;
  refreshEntityLock: (kind: "street" | "building" | "sheets", id?: string) => Promise<boolean>;
  dropEntityLock: (kind: "street" | "building" | "sheets", id?: string) => Promise<void>;
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
  const measurements = committed;
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

let stopSync: (() => void) | null = null;
let pollEtag: string | null = null;
let bootPromise: Promise<void> | null = null;

function paintBuildingTypes(buildings: GeoJSON.FeatureCollection | null, types: Record<string, { type: string }>) {
  if (!buildings) return null;
  return {
    type: "FeatureCollection" as const,
    features: buildings.features.map((f) => {
      const properties = { ...(f.properties || {}) } as Record<string, unknown>;
      const id = String(properties.bid || "");
      const osm = String(properties.building || "");
      const saved = id ? normalizeBuildingType(types[id]?.type) : null;
      if (saved) properties.ubr_type = saved;
      else if (osm) properties.ubr_type = inferBuildingTypeFromOsm(osm);
      else properties.ubr_type = normalizeBuildingType(properties.ubr_type) ?? "necunoscut";
      return { ...f, properties };
    }),
  };
}

function buildingsNeedTypeReload(buildings: GeoJSON.FeatureCollection | null) {
  if (!buildings) return true;
  return buildings.features.some((f) => {
    const t = String((f.properties as { ubr_type?: string } | null)?.ubr_type || "");
    return t === "bloc" || t === "altceva";
  });
}

function applyTeamEvent(ev: TeamEvent) {
  const st = useApp.getState();
  if (ev.type === "street_upsert") {
    const committed = { ...st.committedEdits, [ev.sid]: ev.measurement };
    useApp.setState({ committedEdits: committed, ...syncWorkingStreets(st.pipelineStreets, committed, st.selected) });
    return;
  }
  if (ev.type === "street_delete") {
    const committed = { ...st.committedEdits };
    delete committed[ev.sid];
    useApp.setState({ committedEdits: committed, ...syncWorkingStreets(st.pipelineStreets, committed, st.selected) });
    return;
  }
  if (ev.type === "streets_purged") {
    useApp.setState({ committedEdits: {}, ...syncWorkingStreets(st.pipelineStreets, {}, st.selected) });
    return;
  }
  if (ev.type === "building_upsert") {
    const types = {
      ...st.buildingTypes,
      [ev.id]: { type: normalizeBuildingType(ev.buildingType) ?? "necunoscut" },
    };
    useApp.setState({ buildingTypes: types, buildings: paintBuildingTypes(st.buildings, types) });
    return;
  }
  if (ev.type === "street_fixes_updated") {
    void st.reloadPipeline();
  }
}

function startLiveSync(authed: boolean) {
  stopSync?.();
  stopSync = null;
  if (authed) {
    stopSync = openTeamEvents(applyTeamEvent);
    return;
  }
  const tick = async () => {
    try {
      const next = await fetchLiveEditsIfChanged(pollEtag);
      if (!next) return;
      pollEtag = next.etag;
      const st = useApp.getState();
      const types = buildingTypesFromFile(next.buildings);
      useApp.setState({
        committedEdits: next.streets,
        buildingTypes: types,
        buildings: paintBuildingTypes(st.buildings, types),
        ...syncWorkingStreets(st.pipelineStreets, next.streets, st.selected),
      });
    } catch {
      /* ignore */
    }
  };
  const id = window.setInterval(() => void tick(), 15_000);
  stopSync = () => window.clearInterval(id);
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  loadingMsg: "Pregătim harta…",
  editMode: false,
  streetsBaseBeforeEdit: null,
  viewMode: "space",
  layers: { ...VIEW_PRESETS.space },
  basemap: defaultBasemapForTheme(loadUiTheme()),
  uiTheme: loadUiTheme(),
  filters: { neighborhoods: [], schools: [] },
  filtersOpen: false,
  basemapOpen: false,
  statsOpen: false,
  legendOpen: loadLegendOpen(),
  themeOpen: false,
  editsOpen: false,
  importReportOpen: false,
  csvEditorOpen: false,
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
  teamAuthed: false,
  teamName: null,
  teamLoginOpen: false,
  entityLock: { held: true, holder: null },
  isochroneOrigin: null,
  isochroneProfile: "bike",
  isochroneMinutes: 10,
  isochronePinned: false,
  isochroneStatus: "idle",
  isochroneStats: emptyIsochroneStats(),

  showToast: (msg) => {
    set({ toast: msg });
    window.setTimeout(() => set({ toast: null }), 2800);
  },

  init: () => {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      applyDocumentTheme(get().uiTheme);
      set({ loadingMsg: "Importăm geometrie…" });
      try {
        const [limits, schools] = await Promise.all([
          fetch("./neighborhood_limits.geojson", { signal: AbortSignal.timeout(20_000) }).then((r) => {
            if (!r.ok) throw new Error(`neighborhood_limits ${r.status}`);
            return r.json() as Promise<GeoJSON.FeatureCollection>;
          }),
          fetch("./schools.geojson", { signal: AbortSignal.timeout(20_000) })
            .then((r) => r.json())
            .catch(() => ({ type: "FeatureCollection", features: [] })) as Promise<GeoJSON.FeatureCollection>,
        ]);

        const [imported, live, me] = await Promise.all([
          runImportPipeline(limits),
          fetchLiveEdits()
            .then((v) => {
              pollEtag = v.etag;
              return v;
            })
            .catch(async () => ({
              streets: await fetchCommittedLocalEdits(),
              buildings: parseBuildingEditsFile(
                await fetch("./data/building-edits.json", { signal: AbortSignal.timeout(8_000) })
                  .then((r) => (r.ok ? r.json() : {}))
                  .catch(() => ({}))
              ),
              etag: null,
            })),
          apiMe(),
        ]);
        const pipelineStreets = imported.streets;

        purgeExcelSeedMeasurements();
        migrateV1(pipelineStreets);
        purgeEmptyOrFlagOnlyMeasurements();

        const committedEdits = live.streets;
        const measurements = committedEdits;
        const streets = applyLocalEditsToCollection(pipelineStreets, measurements);

        const officialFeatures = (limits.features || []).filter((f) =>
          neighborhoodIsActive(f.properties as { dissolve?: unknown })
        );
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
            features: officialFeatures,
          },
          measurements,
          committedEdits,
          seedMeasurements: imported.csvMeasurements,
          importReport: imported.report,
          buildingTypes: buildingTypesFromFile(live.buildings),
          schools,
          neighborhoodList,
          schoolList,
          teamAuthed: Boolean(me),
          teamName: me?.name ?? null,
          filters: {
            ...get().filters,
            neighborhoods: neighborhoodList.map((n) => n.slug),
            schools: schoolList.map((s) => s.slug),
          },
          ready: true,
          loadingMsg: "",
        });

        startLiveSync(Boolean(me));

        if (me && errorCount > 0) {
          get().showToast(`Import: ${errorCount} erori de potrivire CSV↔OSM`);
        }
      } catch (e) {
        console.error(e);
        set({ ready: true, loadingMsg: "" });
        get().showToast("Eroare la încărcare");
      }
    })();
    return bootPromise;
  },

  setEditMode: (v) => {
    if (v && !get().teamAuthed) {
      set({ teamLoginOpen: true });
      return;
    }
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
      layers: {
        ...get().layers,
        streetsBase: restore == null ? get().layers.streetsBase : restore,
      },
    });
  },
  teamLogin: async (password, name) => {
    const me = await apiLogin(password, name);
    set({ teamAuthed: true, teamName: me.name, teamLoginOpen: false });
    startLiveSync(true);
    get().setEditMode(true);
  },
  teamLogout: async () => {
    await apiLogout();
    get().setEditMode(false);
    set({
      teamAuthed: false,
      teamName: null,
      teamLoginOpen: false,
      csvEditorOpen: false,
      editsOpen: false,
      importReportOpen: false,
      entityLock: { held: true, holder: null },
    });
    startLiveSync(false);
  },
  openTeamLogin: () => set({ teamLoginOpen: true }),
  closeTeamLogin: () => set({ teamLoginOpen: false }),
  toggleEditAccess: () => {
    if (!get().teamAuthed) {
      set({ teamLoginOpen: true });
      return;
    }
    get().setEditMode(!get().editMode);
  },
  refreshEntityLock: async (kind, id) => {
    if (!get().teamAuthed) {
      set({ entityLock: { held: false, holder: null } });
      return false;
    }
    const r = await acquireLock(kind, id);
    if (r.ok) {
      set({ entityLock: { held: true, holder: null } });
      return true;
    }
    set({ entityLock: { held: false, holder: r.holder } });
    return false;
  },
  dropEntityLock: async (kind, id) => {
    await releaseLock(kind, id);
    set({ entityLock: { held: true, holder: null } });
  },
  setViewMode: (v) => {
    const layers = { ...VIEW_PRESETS[v] };
    if (get().editMode) layers.streetsBase = true;
    if (v === "reach") {
      set({
        viewMode: v,
        layers,
        sheetOpen: false,
        selected: null,
        filtersOpen: false,
        statsOpen: false,
        searchOpen: false,
        searchFocus: null,
      });
      void get().warmIsochrone();
      return;
    }
    set({ viewMode: v, layers });
  },
  warmIsochrone: async () => {
    try {
      await ensureIsochroneEngine();
    } catch {
      get().showToast("Nu am putut încărca rețeaua de acces.");
    }
  },
  setIsochroneOrigin: (lng, lat, pinned = true) => {
    setLastReachOrigin({ lng, lat });
    set({
      isochroneOrigin: { lng, lat },
      isochronePinned: pinned,
      isochroneStatus: "ready",
    });
  },
  setIsochronePinned: (pinned) => {
    if (pinned) {
      const ll = lastReachOrigin() || get().isochroneOrigin;
      set({
        isochronePinned: true,
        ...(ll ? { isochroneOrigin: ll, isochroneStatus: "ready" as const } : {}),
      });
      return;
    }
    set({ isochronePinned: false });
  },
  setIsochroneProfile: (profile) => set({ isochroneProfile: profile }),
  setIsochroneMinutes: (minutes) => set({ isochroneMinutes: minutes }),
  setIsochroneStats: (stats) => set({ isochroneStats: stats }),
  clearIsochrone: () => {
    setLastIsochroneFeatures({ type: "FeatureCollection", features: [] });
    setLastReachOrigin(null);
    set({
      isochroneOrigin: null,
      isochronePinned: false,
      isochroneStatus: "idle",
      isochroneStats: emptyIsochroneStats(),
    });
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
    set({ filtersOpen: !get().filtersOpen, basemapOpen: false, themeOpen: false, statsOpen: false, editsOpen: false, importReportOpen: false, csvEditorOpen: false, searchOpen: false }),
  closeFilters: () => set({ filtersOpen: false }),
  closeStats: () => set({ statsOpen: false }),
  closeLegend: () => {
    persistLegendOpen(false);
    set({ legendOpen: false });
  },
  openLegend: () => {
    persistLegendOpen(true);
    set({ legendOpen: true });
  },
  toggleLegend: () => {
    const next = !get().legendOpen;
    persistLegendOpen(next);
    set({ legendOpen: next });
  },
  toggleBasemap: () =>
    set({ basemapOpen: !get().basemapOpen, filtersOpen: false, themeOpen: false, statsOpen: false, editsOpen: false, importReportOpen: false, csvEditorOpen: false, searchOpen: false }),
  toggleStats: () =>
    set({ statsOpen: !get().statsOpen, filtersOpen: false, basemapOpen: false, themeOpen: false, editsOpen: false, importReportOpen: false, csvEditorOpen: false, searchOpen: false }),
  toggleTheme: () =>
    set({ themeOpen: !get().themeOpen, filtersOpen: false, basemapOpen: false, statsOpen: false, editsOpen: false, importReportOpen: false, csvEditorOpen: false, searchOpen: false }),
  toggleEdits: () => {
    if (!get().teamAuthed) return;
    set({ editsOpen: !get().editsOpen, filtersOpen: false, basemapOpen: false, themeOpen: false, statsOpen: false, importReportOpen: false, csvEditorOpen: false, searchOpen: false });
  },
  closeEdits: () => set({ editsOpen: false }),
  toggleImportReport: () => {
    if (!get().teamAuthed) return;
    set({
      importReportOpen: !get().importReportOpen,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
      editsOpen: false,
      csvEditorOpen: false,
      searchOpen: false,
    });
  },
  closeImportReport: () => set({ importReportOpen: false }),
  toggleCsvEditor: () => {
    if (!get().teamAuthed) return;
    set({
      csvEditorOpen: !get().csvEditorOpen,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
      editsOpen: false,
      importReportOpen: false,
      searchOpen: false,
    });
  },
  closeCsvEditor: () => set({ csvEditorOpen: false }),
  reloadPipeline: async () => {
    set({ loadingMsg: "Reîncărcăm măsurătorile…" });
    try {
      const limits = (await fetch("./neighborhood_limits.geojson").then((r) => r.json())) as GeoJSON.FeatureCollection;
      const imported = await runImportPipeline(limits);
      const pipelineStreets = imported.streets;
      const synced = syncWorkingStreets(pipelineStreets, get().committedEdits, get().selected);
      set({
        pipelineStreets,
        seedMeasurements: imported.csvMeasurements,
        importReport: imported.report,
        loadingMsg: "",
        ...synced,
      });
    } catch (e) {
      console.error(e);
      set({ loadingMsg: "" });
      get().showToast("Nu am putut reîncărca harta după CSV");
    }
  },
  toggleSearch: () =>
    set({
      searchOpen: !get().searchOpen,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
      editsOpen: false,
      importReportOpen: false,
      csvEditorOpen: false,
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
      csvEditorOpen: false,
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
      csvEditorOpen: false,
      searchOpen: false,
    }),
  selectBuilding: (id, type) =>
    set({
      selected: { kind: "building", id, type: normalizeBuildingType(type) ?? "necunoscut" },
      sheetOpen: true,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      editsOpen: false,
      statsOpen: false,
      importReportOpen: false,
      csvEditorOpen: false,
      searchOpen: false,
    }),
  closeSheet: () => set({ sheetOpen: false, selected: null }),

  saveStreet: async (id, data) => {
    if (!get().teamAuthed) return;
    try {
      const saved = await putStreet(id, data, get().committedEdits[id]?.updated_at);
      const committed = { ...get().committedEdits, [id]: saved };
      set({ committedEdits: committed, ...syncWorkingStreets(get().pipelineStreets, committed, get().selected) });
      get().showToast("Salvat pe server");
    } catch (e) {
      const status = e && typeof e === "object" && "status" in e ? Number((e as { status: number }).status) : 0;
      const body = e && typeof e === "object" && "body" in e ? (e as { body: unknown }).body : null;
      if (status === 409 && body && typeof body === "object" && body !== null && "current" in body) {
        const overwrite = window.confirm("Pe server e o versiune mai nouă. Suprascrii?");
        if (!overwrite) {
          const current = (body as { current: Measurement }).current;
          const committed = { ...get().committedEdits, [id]: current };
          set({ committedEdits: committed, ...syncWorkingStreets(get().pipelineStreets, committed, get().selected) });
          get().showToast("Am încărcat versiunea de pe server");
          return;
        }
        const saved = await putStreet(id, data, "*");
        const committed = { ...get().committedEdits, [id]: saved };
        set({ committedEdits: committed, ...syncWorkingStreets(get().pipelineStreets, committed, get().selected) });
        get().showToast("Suprascris pe server");
        return;
      }
      get().showToast("Salvarea a eșuat");
    }
  },

  deleteStreetEdit: async (id) => {
    if (!get().teamAuthed) return;
    try {
      await apiDeleteStreet(id);
      const committed = { ...get().committedEdits };
      delete committed[id];
      const sel = get().selected;
      const selected = sel?.kind === "street" && sel.id === id ? null : sel;
      set({
        committedEdits: committed,
        ...syncWorkingStreets(get().pipelineStreets, committed, selected),
        ...(selected ? {} : { sheetOpen: false }),
      });
      get().showToast("Editare ștearsă de pe server");
    } catch {
      get().showToast("Ștergerea a eșuat");
    }
  },

  purgeAllStreetEdits: async () => {
    if (!get().teamAuthed) return;
    try {
      await apiPurgeStreets();
      set({
        committedEdits: {},
        ...syncWorkingStreets(get().pipelineStreets, {}, null),
        sheetOpen: false,
      });
      get().showToast("Toate editările de străzi au fost șterse de pe server");
    } catch {
      get().showToast("Nu am putut șterge editările");
    }
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
      csvEditorOpen: false,
      searchOpen: false,
    });
  },

  setBuildingType: async (id, type) => {
    if (!get().teamAuthed) return;
    if (!isClassifiedBuildingType(type)) return;
    const prevTypes = get().buildingTypes;
    const prevBuildings = get().buildings;
    const prevSelected = get().selected;
    const types = { ...prevTypes, [id]: { type } };
    const nextBuildings = paintBuildingTypes(prevBuildings, types);
    const selected =
      prevSelected?.kind === "building" && prevSelected.id === id ? { ...prevSelected, type } : prevSelected;
    set({
      buildingTypes: types,
      ...(nextBuildings ? { buildings: nextBuildings } : {}),
      selected,
    });
    try {
      await putBuilding(id, type, prevTypes[id] ? "*" : undefined);
      get().showToast(`Clădire: ${buildingTypeMeta(type).label}`);
    } catch {
      set({ buildingTypes: prevTypes, buildings: prevBuildings, selected: prevSelected });
      get().showToast("Nu am putut salva tipul clădirii");
    }
  },

  ensureBuildings: async () => {
    if (!buildingsNeedTypeReload(get().buildings)) return;
    set({ loadingMsg: "Încărcăm clădirile…" });
    const raw = (await fetch("./buildings.geojson").then((r) => r.json())) as GeoJSON.FeatureCollection;
    const types = get().buildingTypes;
    const features = raw.features.map((f, i) => {
      const id = makeBuildingId(f, i);
      const osm = String((f.properties as { building?: string })?.building || "").toLowerCase();
      const t = normalizeBuildingType(types[id]?.type) ?? inferBuildingTypeFromOsm(osm);
      return {
        type: "Feature" as const,
        properties: { bid: id, building: osm, ubr_type: t },
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
      const schoolSlugs = streetSchoolSlugs(raw);
      const rawSchool = schoolSlugs.length > 0;
      const schoolSelected = schoolSlugs.length === 0 || schoolSlugs.some((slug) => selectedSchools.has(slug));
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
      p.arondat = schoolSlugs.join(",");

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
