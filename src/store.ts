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
  BUILDING_TYPES,
  buildingTypeMeta,
  coerceBuildingType,
  inferBuildingTypeFromOsm,
  isClassifiedBuildingType,
  normalizeBuildingType,
} from "./lib/buildingTypes";
import {
  applyStreetSplits,
  computePieces,
  featureLines,
  parseStreetSplitsFile,
  pieceSidsFor,
  planSplitChange,
  rootSid,
  type SplitPoint,
} from "./lib/streetSplits";
import { streetSchoolSlugs } from "./lib/schoolCatchment";
import { stampBuildingCartiere } from "./lib/neighborhoodInfo";
import {
  acquireLock,
  apiLogin,
  apiLogout,
  apiMe,
  deleteStreet as apiDeleteStreet,
  deleteBuilding as apiDeleteBuilding,
  fetchLiveEdits,
  fetchLiveEditsIfChanged,
  openTeamEvents,
  bindEditTabRelease,
  purgeStreets as apiPurgeStreets,
  purgeBuildings as apiPurgeBuildings,
  purgeSplits as apiPurgeSplits,
  conflictUpdatedAt,
  lockedHolder,
  putBuilding,
  putSplits,
  putStreet,
  releaseLock,
  type SplitsSaved,
  type PresenceUser,
  type TeamEvent,
} from "./lib/teamApi";
import { setPresence } from "./lib/livePresence";
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
import { VIEW_PRESETS, layersForFocus, layersForView, nextLayerToggle, type FocusId, type LayerVisibility, type MapLayerId } from "./lib/layers";
import { isMobileViewport } from "./lib/breakpoints";
import { dockPanelPatch } from "./lib/panelSlots";
import { streetMatchesNeighborhood } from "./lib/mapFilters";
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

const REACH_HUD_KEY = "ubr_reach_hud_open";

/** Pe telefon panoul de acces pornește restrâns, ca să nu acopere harta. */
function loadReachHudOpen(): boolean {
  try {
    const v = localStorage.getItem(REACH_HUD_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  try {
    return !window.matchMedia("(max-width: 720px)").matches;
  } catch {
    return true;
  }
}

function persistReachHudOpen(open: boolean) {
  try {
    localStorage.setItem(REACH_HUD_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

type Filters = {
  /** Slug-uri cartiere selectate (multi). Goale = nimic pe hartă. */
  neighborhoods: string[];
  /** Slug-uri școli selectate — controlează markere + străzi arondate. */
  schools: string[];
  /** Tipuri de clădiri afișate pe hartă. Goale = nicio clădire. */
  buildingTypes: string[];
};

export type SplitTool = {
  /** `sid`-ul rădăcină al străzii tăiate. */
  root: string;
  name: string;
  geometry: GeoJSON.Geometry;
  /** Punctele salvate pe server când s-a deschis unealta. */
  before: SplitPoint[];
  /** Punctele curente (nesalvate). */
  points: SplitPoint[];
  saving: boolean;
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
  /** Pipeline înainte de segmentare (geometria „rădăcină” a fiecărei străzi). */
  pipelineStreetsRaw: GeoJSON.FeatureCollection | null;
  /** Puncte de tăiere salvate pe server, pe `sid` rădăcină. */
  streetSplits: Record<string, SplitPoint[]>;
  splitTool: SplitTool | null;
  reachHudOpen: boolean;
  toggleReachHud: () => void;
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
  teamSid: string | null;
  presence: PresenceUser[];
  buildingsEditsUpdatedAt: string | null;
  splitsEditsUpdatedAt: string | null;
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
  toggleBuildingType: (type: string) => void;
  toggleAllBuildingTypes: () => void;
  showOnlyBuildingType: (type: string) => void;
  showOnlyNeighborhood: (slug: string) => void;
  hideNeighborhood: (slug: string) => void;
  showOnlySchool: (slug: string) => void;
  hideSchool: (slug: string) => void;
  startSplitTool: (sid: string) => Promise<void>;
  addSplitPoint: (p: SplitPoint) => void;
  moveSplitPoint: (index: number, p: SplitPoint) => boolean;
  removeSplitPoint: (index: number) => void;
  revertSplitPoints: () => void;
  cancelSplitTool: () => void;
  applySplitTool: () => Promise<void>;
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
  /** Highlight a saved edit on the map without closing the edits panel or opening the sheet. */
  focusEditsHit: (hit: SearchHit) => number;
  clearSearchFocus: () => void;
  selectStreet: (id: string, name: string, props: Record<string, unknown>) => void;
  selectBuilding: (id: string, type: string) => void;
  closeSheet: () => void;
  saveStreet: (id: string, data: Measurement, opts?: { quiet?: boolean }) => Promise<boolean>;
  deleteStreetEdit: (id: string) => Promise<void>;
  deleteBuildingEdit: (id: string) => Promise<void>;
  clearSplitEdit: (root: string) => Promise<void>;
  refreshLiveEdits: () => Promise<void>;
  purgeAllStreetEdits: () => Promise<void>;
  purgeAllBuildingEdits: () => Promise<void>;
  purgeAllSplitEdits: () => Promise<void>;
  openStreetEdit: (id: string) => void;
  setBuildingType: (id: string, type: string) => Promise<boolean>;
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
let lockSeq = 0;

function paintBuildingTypes(buildings: GeoJSON.FeatureCollection | null, types: Record<string, { type: string }>) {
  if (!buildings) return null;
  const stamped = stampBuildingCartiere(buildings, useApp.getState().neighborhoods) ?? buildings;
  return {
    type: "FeatureCollection" as const,
    features: stamped.features.map((f) => {
      const properties = { ...(f.properties || {}) } as Record<string, unknown>;
      const id = String(properties.bid || "");
      const osm = String(properties.building || "");
      const saved = id ? normalizeBuildingType(types[id]?.type) : null;
      if (saved) properties.ubr_type = saved;
      else if (osm) properties.ubr_type = inferBuildingTypeFromOsm(osm);
      else properties.ubr_type = coerceBuildingType(properties.ubr_type);
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

/** Aplică rezultatul unei segmentări (răspuns PUT sau eveniment SSE) peste starea locală. */
function applySplitsResult(
  root: string,
  res: Pick<SplitsSaved, "points" | "removed" | "inherited" | "rootEdit" | "updated_at">
) {
  const st = useApp.getState();
  const streetSplits = { ...st.streetSplits };
  if (res.points.length) streetSplits[root] = res.points;
  else delete streetSplits[root];

  const committed = { ...st.committedEdits };
  for (const sid of res.removed || []) delete committed[sid];
  for (const [sid, m] of Object.entries(res.inherited || {})) committed[sid] = m;
  if (res.rootEdit === null) delete committed[root];
  else if (res.rootEdit) committed[root] = res.rootEdit;

  const pipelineStreets = st.pipelineStreetsRaw ? applyStreetSplits(st.pipelineStreetsRaw, streetSplits) : null;
  useApp.setState({
    streetSplits,
    pipelineStreets,
    committedEdits: committed,
    ...(res.updated_at ? { splitsEditsUpdatedAt: res.updated_at } : {}),
    ...syncWorkingStreets(pipelineStreets, committed, st.selected),
  });
}

function applySplitsPurged(removed: string[], updatedAt?: string) {
  const st = useApp.getState();
  const committed = { ...st.committedEdits };
  for (const sid of removed) delete committed[sid];
  const streetSplits: Record<string, SplitPoint[]> = {};
  const pipelineStreets = st.pipelineStreetsRaw ? applyStreetSplits(st.pipelineStreetsRaw, streetSplits) : st.pipelineStreets;
  const pieceGone = st.selected?.kind === "street" && removed.includes(st.selected.id);
  useApp.setState({
    streetSplits,
    pipelineStreets,
    committedEdits: committed,
    splitTool: null,
    ...(updatedAt ? { splitsEditsUpdatedAt: updatedAt } : {}),
    ...(pieceGone ? { sheetOpen: false } : {}),
    ...syncWorkingStreets(pipelineStreets, committed, pieceGone ? null : st.selected),
  });
}

function lockKeyOf(sel: Selected): string | null {
  return sel ? `${sel.kind}:${sel.id}` : null;
}

function applyTeamEvent(ev: TeamEvent) {
  const st = useApp.getState();
  if (ev.type === "hello") {
    if (st.teamAuthed && st.editMode) {
      if (st.splitTool) void st.refreshEntityLock("street", st.splitTool.root);
      else if (st.selected && st.sheetOpen) void st.refreshEntityLock(st.selected.kind, st.selected.id);
      if (st.csvEditorOpen) void st.refreshEntityLock("sheets");
    }
    return;
  }
  if (ev.type === "splits_updated") {
    applySplitsResult(ev.sid, ev);
    return;
  }
  if (ev.type === "unlock") {
    // Cineva a terminat de editat: dacă noi așteptam, încercăm imediat să preluăm entitatea.
    const sel = st.selected;
    if (sel && st.sheetOpen && st.editMode && st.teamAuthed && !st.entityLock.held && ev.key === lockKeyOf(sel)) {
      void st.refreshEntityLock(sel.kind, sel.id);
    }
    return;
  }
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
  if (ev.type === "buildings_purged") {
    useApp.setState({
      buildingTypes: {},
      buildings: paintBuildingTypes(st.buildings, {}),
      ...(ev.updated_at ? { buildingsEditsUpdatedAt: ev.updated_at } : {}),
    });
    return;
  }
  if (ev.type === "splits_purged") {
    applySplitsPurged(ev.removed, ev.updated_at);
    return;
  }
  if (ev.type === "building_upsert") {
    const types = {
      ...st.buildingTypes,
      [ev.id]: { type: coerceBuildingType(ev.buildingType) },
    };
    useApp.setState({ buildingTypes: types, buildings: paintBuildingTypes(st.buildings, types) });
    return;
  }
  if (ev.type === "building_delete") {
    const types = { ...st.buildingTypes };
    delete types[ev.id];
    useApp.setState({ buildingTypes: types, buildings: paintBuildingTypes(st.buildings, types) });
    return;
  }
  if (ev.type === "presence") {
    setPresence(ev.users);
    useApp.setState({ presence: ev.users });
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
    bindEditTabRelease();
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
      const streetSplits = next.splits.splits;
      const pipelineStreets = st.pipelineStreetsRaw ? applyStreetSplits(st.pipelineStreetsRaw, streetSplits) : st.pipelineStreets;
      useApp.setState({
        committedEdits: next.streets,
        buildingTypes: types,
        buildings: paintBuildingTypes(st.buildings, types),
        streetSplits,
        pipelineStreets,
        buildingsEditsUpdatedAt: next.buildings.updated_at ?? null,
        splitsEditsUpdatedAt: next.splits.updated_at ?? null,
        ...syncWorkingStreets(pipelineStreets, next.streets, st.selected),
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
  filters: { neighborhoods: [], schools: [], buildingTypes: [...BUILDING_TYPES] },
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
  pipelineStreetsRaw: null,
  streetSplits: {},
  splitTool: null,
  reachHudOpen: loadReachHudOpen(),
  toggleReachHud: () => {
    const next = !get().reachHudOpen;
    persistReachHudOpen(next);
    set({ reachHudOpen: next });
  },
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
  teamSid: null,
  presence: [],
  buildingsEditsUpdatedAt: null,
  splitsEditsUpdatedAt: null,
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
              splits: parseStreetSplitsFile(
                await fetch("./data/street-splits.json", { signal: AbortSignal.timeout(8_000) })
                  .then((r) => (r.ok ? r.json() : {}))
                  .catch(() => ({}))
              ),
              etag: null,
            })),
          apiMe(),
        ]);
        const pipelineStreetsRaw = imported.streets;

        purgeExcelSeedMeasurements();
        migrateV1(pipelineStreetsRaw);
        purgeEmptyOrFlagOnlyMeasurements();

        const streetSplits = live.splits.splits;
        const pipelineStreets = applyStreetSplits(pipelineStreetsRaw, streetSplits);
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
        const signedIn = get().teamAuthed;

        set({
          streets,
          pipelineStreets,
          pipelineStreetsRaw,
          streetSplits,
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
          teamAuthed: signedIn || Boolean(me),
          teamName: signedIn ? get().teamName : (me?.name ?? null),
          teamSid: signedIn ? get().teamSid : (me?.sid ?? null),
          buildingsEditsUpdatedAt: live.buildings.updated_at ?? null,
          splitsEditsUpdatedAt: live.splits.updated_at ?? null,
          filters: {
            ...get().filters,
            neighborhoods: neighborhoodList.map((n) => n.slug),
            schools: schoolList.map((s) => s.slug),
          },
          ready: true,
          loadingMsg: "",
        });

        startLiveSync(get().teamAuthed);

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
    if (get().splitTool) get().cancelSplitTool();
    const restore = get().streetsBaseBeforeEdit;
    set({
      editMode: false,
      streetsBaseBeforeEdit: null,
      csvEditorOpen: false,
      editsOpen: false,
      layers: {
        ...get().layers,
        streetsBase: restore == null ? get().layers.streetsBase : restore,
      },
    });
  },
  teamLogin: async (password, name) => {
    await apiLogin(password, name);
    const me = await apiMe();
    set({ teamAuthed: true, teamName: me?.name ?? name, teamSid: me?.sid ?? null, teamLoginOpen: false });
    startLiveSync(true);
    get().setEditMode(true);
  },
  teamLogout: async () => {
    await apiLogout();
    get().setEditMode(false);
    set({
      teamAuthed: false,
      teamName: null,
      teamSid: null,
      presence: [],
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
    const seq = ++lockSeq;
    try {
      const r = await acquireLock(kind, id);
      // Un răspuns mai vechi nu are voie să suprascrie unul mai nou (schimbare de entitate / închidere între timp).
      if (seq !== lockSeq) return r.ok;
      set({ entityLock: r.ok ? { held: true, holder: null } : { held: false, holder: r.holder } });
      return r.ok;
    } catch {
      // Rețea căzută: nu blocăm editarea; serverul respinge oricum scrierile dacă altcineva ține entitatea.
      if (seq === lockSeq) set({ entityLock: { held: true, holder: null } });
      return true;
    }
  },
  dropEntityLock: async (kind, id) => {
    // Panoul de detalii se închide când începe segmentarea; lock-ul străzii rămâne al uneltei de segmentare.
    if (kind === "street" && id && get().splitTool?.root === id) return;
    const seq = ++lockSeq;
    await releaseLock(kind, id);
    if (seq === lockSeq) set({ entityLock: { held: true, holder: null } });
  },
  setViewMode: (v) => {
    const layers = layersForView(v, get().editMode);
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
    set({ layers: nextLayerToggle(get().layers, id, on, get().editMode) });
  },
  applyFocus: (id) => {
    const s = get();
    set({ layers: layersForFocus(s.viewMode, id, s.editMode, s.layers.streetsBase) });
  },
  clearFocus: () => {
    const s = get();
    set({ layers: layersForView(s.viewMode, s.editMode, { streetsBase: s.layers.streetsBase }) });
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
  toggleBuildingType: (type) => {
    if (!isClassifiedBuildingType(type)) return;
    const cur = get().filters.buildingTypes;
    const next = cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type];
    set({ filters: { ...get().filters, buildingTypes: next } });
  },
  toggleAllBuildingTypes: () => {
    const cur = get().filters.buildingTypes;
    const allOn = BUILDING_TYPES.every((t) => cur.includes(t));
    set({ filters: { ...get().filters, buildingTypes: allOn ? [] : [...BUILDING_TYPES] } });
  },
  showOnlyBuildingType: (type) => {
    if (!isClassifiedBuildingType(type)) return;
    set({ filters: { ...get().filters, buildingTypes: [type] } });
  },
  showOnlyNeighborhood: (slug) => set({ filters: { ...get().filters, neighborhoods: [slug] } }),
  hideNeighborhood: (slug) =>
    set({ filters: { ...get().filters, neighborhoods: get().filters.neighborhoods.filter((s) => s !== slug) } }),
  showOnlySchool: (slug) => set({ filters: { ...get().filters, schools: [slug] } }),
  hideSchool: (slug) =>
    set({ filters: { ...get().filters, schools: get().filters.schools.filter((s) => s !== slug) } }),

  startSplitTool: async (sid) => {
    const st = get();
    if (!st.teamAuthed || !st.editMode) return;
    const root = rootSid(sid);
    const feature = st.pipelineStreetsRaw?.features.find((f) => String((f.properties as { sid?: string })?.sid) === root);
    if (!feature?.geometry || !featureLines(feature.geometry).length) {
      get().showToast("Nu găsesc geometria străzii");
      return;
    }
    const ok = await get().refreshEntityLock("street", root);
    if (!ok) {
      get().showToast(`${get().entityLock.holder || "Cineva"} editează această stradă`);
      return;
    }
    const before = st.streetSplits[root] || [];
    set({
      sheetOpen: false,
      selected: null,
      filtersOpen: false,
      searchOpen: false,
      statsOpen: false,
      splitTool: {
        root,
        name: String((feature.properties as { name?: string })?.name || "Stradă"),
        geometry: feature.geometry,
        before,
        points: [...before],
        saving: false,
      },
    });
  },
  addSplitPoint: (p) => {
    const tool = get().splitTool;
    if (!tool || tool.saving) return;
    const now = computePieces(tool.root, tool.geometry, tool.points).length;
    const next = computePieces(tool.root, tool.geometry, [...tool.points, p]).length;
    // Punct prea aproape de un capăt / de alt punct: ignorat (nu ar crea o bucată utilă).
    if (next <= now) {
      get().showToast("Punctul e prea aproape de un capăt sau de alt punct");
      return;
    }
    set({ splitTool: { ...tool, points: [...tool.points, p] } });
  },
  moveSplitPoint: (index, p) => {
    const tool = get().splitTool;
    if (!tool || tool.saving || index < 0 || index >= tool.points.length) return false;
    const prev = tool.points[index];
    if (prev[0] === p[0] && prev[1] === p[1]) return true;
    const pts = tool.points.map((pt, i) => (i === index ? p : pt));
    const now = computePieces(tool.root, tool.geometry, tool.points).length;
    const next = computePieces(tool.root, tool.geometry, pts).length;
    // Adăugarea cere o bucată nouă. Mutarea păstrează numărul: respingem doar dacă tăietura se lipește de un capăt sau de alt punct.
    if (next < now) {
      get().showToast("Punctul e prea aproape de un capăt sau de alt punct");
      return false;
    }
    set({ splitTool: { ...tool, points: pts } });
    return true;
  },
  removeSplitPoint: (index) => {
    const tool = get().splitTool;
    if (!tool || tool.saving) return;
    set({ splitTool: { ...tool, points: tool.points.filter((_, i) => i !== index) } });
  },
  revertSplitPoints: () => {
    const tool = get().splitTool;
    if (!tool || tool.saving) return;
    set({ splitTool: { ...tool, points: [...tool.before] } });
  },
  cancelSplitTool: () => {
    const tool = get().splitTool;
    if (!tool) return;
    set({ splitTool: null });
    void get().dropEntityLock("street", tool.root);
  },
  applySplitTool: async () => {
    const tool = get().splitTool;
    if (!tool || tool.saving) return;
    const unchanged =
      tool.points.length === tool.before.length && tool.points.every((p, i) => p[0] === tool.before[i][0] && p[1] === tool.before[i][1]);
    if (unchanged) {
      get().cancelSplitTool();
      return;
    }
    const plan = planSplitChange(tool.root, tool.geometry, tool.before, tool.points);
    set({ splitTool: { ...tool, saving: true } });
    try {
      const saved = await putSplits(tool.root, tool.points, plan.inherit);
      applySplitsResult(tool.root, saved);
      set({ splitTool: null });
      void get().dropEntityLock("street", tool.root);
      get().showToast(saved.points.length ? `Strada e împărțită în ${saved.points.length + 1} bucăți` : "Segmentarea a fost scoasă");
    } catch (e) {
      const holder = lockedHolder(e);
      const cur = get().splitTool;
      if (cur) set({ splitTool: { ...cur, saving: false } });
      get().showToast(holder ? `${holder} editează această stradă` : "Nu am putut salva segmentarea");
    }
  },
  toggleFilters: () => set(dockPanelPatch("filtersOpen", get().filtersOpen, isMobileViewport())),
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
  toggleBasemap: () => set(dockPanelPatch("basemapOpen", get().basemapOpen, isMobileViewport())),
  toggleStats: () => set(dockPanelPatch("statsOpen", get().statsOpen, isMobileViewport())),
  toggleTheme: () => set(dockPanelPatch("themeOpen", get().themeOpen, isMobileViewport())),
  toggleEdits: () => {
    if (!get().teamAuthed) return;
    set(dockPanelPatch("editsOpen", get().editsOpen, isMobileViewport()));
  },
  closeEdits: () => set({ editsOpen: false }),
  toggleImportReport: () => {
    if (!get().teamAuthed) return;
    set(dockPanelPatch("importReportOpen", get().importReportOpen, isMobileViewport()));
  },
  closeImportReport: () => set({ importReportOpen: false }),
  toggleCsvEditor: () => {
    if (!get().teamAuthed || !get().editMode) return;
    set(dockPanelPatch("csvEditorOpen", get().csvEditorOpen, isMobileViewport()));
  },
  closeCsvEditor: () => set({ csvEditorOpen: false }),
  reloadPipeline: async () => {
    set({ loadingMsg: "Reîncărcăm măsurătorile…" });
    try {
      const limits = (await fetch("./neighborhood_limits.geojson").then((r) => r.json())) as GeoJSON.FeatureCollection;
      const imported = await runImportPipeline(limits);
      const pipelineStreetsRaw = imported.streets;
      const pipelineStreets = applyStreetSplits(pipelineStreetsRaw, get().streetSplits);
      const synced = syncWorkingStreets(pipelineStreets, get().committedEdits, get().selected);
      set({
        pipelineStreets,
        pipelineStreetsRaw,
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
  toggleSearch: () => set(dockPanelPatch("searchOpen", get().searchOpen, isMobileViewport())),
  closeSearch: () => set({ searchOpen: false }),
  focusSearchResult: (hit) =>
    set({
      searchOpen: false,
      searchFocus: { token: (get().searchFocus?.token ?? 0) + 1, hit },
    }),
  focusEditsHit: (hit) => {
    const token = (get().searchFocus?.token ?? 0) + 1;
    set({ searchFocus: { token, hit } });
    return token;
  },
  clearSearchFocus: () => set({ searchFocus: null }),

  selectStreet: (id, name, props) =>
    set({
      selected: { kind: "street", id, name, props },
      sheetOpen: true,
    }),
  selectBuilding: (id, type) =>
    set({
      selected: { kind: "building", id, type: coerceBuildingType(type) },
      sheetOpen: true,
    }),
  closeSheet: () => set({ sheetOpen: false, selected: null }),

  saveStreet: async (id, data, opts) => {
    if (!get().teamAuthed) return false;
    try {
      const saved = await putStreet(id, data, get().committedEdits[id]?.updated_at);
      const committed = { ...get().committedEdits, [id]: saved };
      set({ committedEdits: committed, ...syncWorkingStreets(get().pipelineStreets, committed, get().selected) });
      if (!opts?.quiet) get().showToast("Salvat pe server");
      return true;
    } catch (e) {
      const holder = lockedHolder(e);
      if (holder) {
        get().showToast(`${holder} editează acest segment — nu am salvat`);
        return false;
      }
      const status = e && typeof e === "object" && "status" in e ? Number((e as { status: number }).status) : 0;
      const body = e && typeof e === "object" && "body" in e ? (e as { body: unknown }).body : null;
      if (status === 409 && body && typeof body === "object" && body !== null && "current" in body) {
        const overwrite = window.confirm("Pe server e o versiune mai nouă. Suprascrii?");
        if (!overwrite) {
          const current = (body as { current: Measurement }).current;
          const committed = { ...get().committedEdits, [id]: current };
          set({ committedEdits: committed, ...syncWorkingStreets(get().pipelineStreets, committed, get().selected) });
          get().showToast("Am încărcat versiunea de pe server");
          return false;
        }
        try {
          const saved = await putStreet(id, data, "*");
          const committed = { ...get().committedEdits, [id]: saved };
          set({ committedEdits: committed, ...syncWorkingStreets(get().pipelineStreets, committed, get().selected) });
          if (!opts?.quiet) get().showToast("Suprascris pe server");
          return true;
        } catch (e2) {
          const h2 = lockedHolder(e2);
          get().showToast(h2 ? `${h2} editează acest segment — nu am salvat` : "Salvarea a eșuat");
          return false;
        }
      }
      get().showToast("Salvarea a eșuat");
      return false;
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

  deleteBuildingEdit: async (id) => {
    if (!get().teamAuthed) return;
    try {
      await apiDeleteBuilding(id);
      const types = { ...get().buildingTypes };
      delete types[id];
      set({ buildingTypes: types, buildings: paintBuildingTypes(get().buildings, types) });
      get().showToast("Tip clădire resetat pe server");
    } catch {
      get().showToast("Ștergerea a eșuat");
    }
  },

  clearSplitEdit: async (root) => {
    if (!get().teamAuthed) return;
    const stale = get().splitsEditsUpdatedAt || undefined;
    try {
      let saved: SplitsSaved;
      try {
        saved = await putSplits(root, [], {}, stale);
      } catch (e) {
        const newer = conflictUpdatedAt(e);
        if (!newer || newer === stale) throw e;
        saved = await putSplits(root, [], {}, newer);
      }
      applySplitsResult(root, saved);
      get().showToast("Segmentare scoasă");
    } catch (e) {
      const h = lockedHolder(e);
      get().showToast(h ? `${h} editează — nu am putut scoate segmentarea` : "Nu am putut scoate segmentarea");
    }
  },

  refreshLiveEdits: async () => {
    try {
      const live = await fetchLiveEdits();
      pollEtag = live.etag;
      const st = get();
      const types = buildingTypesFromFile(live.buildings);
      const streetSplits = live.splits.splits;
      const pipelineStreets = st.pipelineStreetsRaw ? applyStreetSplits(st.pipelineStreetsRaw, streetSplits) : st.pipelineStreets;
      set({
        committedEdits: live.streets,
        buildingTypes: types,
        buildings: paintBuildingTypes(st.buildings, types),
        streetSplits,
        pipelineStreets,
        buildingsEditsUpdatedAt: live.buildings.updated_at ?? null,
        splitsEditsUpdatedAt: live.splits.updated_at ?? null,
        ...syncWorkingStreets(pipelineStreets, live.streets, st.selected),
      });
    } catch {
      get().showToast("Nu am putut reîmprospăta editările");
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

  purgeAllBuildingEdits: async () => {
    if (!get().teamAuthed) return;
    try {
      const saved = await apiPurgeBuildings();
      set({
        buildingTypes: {},
        buildings: paintBuildingTypes(get().buildings, {}),
        ...(saved.updated_at ? { buildingsEditsUpdatedAt: saved.updated_at } : {}),
      });
      get().showToast("Toate tipurile de clădiri au fost șterse de pe server");
    } catch {
      get().showToast("Nu am putut șterge tipurile de clădiri");
    }
  },

  purgeAllSplitEdits: async () => {
    if (!get().teamAuthed) return;
    try {
      const saved = await apiPurgeSplits();
      applySplitsPurged(saved.removed || [], saved.updated_at);
      get().showToast("Toate segmentările au fost scoase");
    } catch {
      get().showToast("Nu am putut scoate segmentările");
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
    });
  },

  setBuildingType: async (id, type) => {
    if (!get().teamAuthed) return false;
    if (!isClassifiedBuildingType(type)) return false;
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
      return true;
    } catch (e) {
      set({ buildingTypes: prevTypes, buildings: prevBuildings, selected: prevSelected });
      const holder = lockedHolder(e);
      get().showToast(holder ? `${holder} editează această clădire — nu am salvat` : "Nu am putut salva tipul clădirii");
      return false;
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
    const stamped = stampBuildingCartiere({ type: "FeatureCollection", features }, get().neighborhoods);
    set({ buildings: stamped ?? { type: "FeatureCollection", features }, loadingMsg: "" });
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
    const showData = streetMatchesNeighborhood(cartier, selected);

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
