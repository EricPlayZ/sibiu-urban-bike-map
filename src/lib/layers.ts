import type { ViewMode } from "./space";

export type MapLayerId =
  | "streetsBase"
  | "bike"
  | "bikeDoor"
  | "reserved"
  | "illegal"
  | "editedStreets"
  | "schoolAssign"
  | "schoolMarkers"
  | "buildings"
  | "neighborhoods";

export type LayerVisibility = Record<MapLayerId, boolean>;

export type FocusId = "hideEmpty" | "illegalOnly" | "bikeOnly";

export const BIKE_SAFE_LABEL = "Pistă biciclete separată";
export const BIKE_DOOR_LABEL = "Pistă biciclete carosabil";

export const LAYER_META: { id: MapLayerId; label: string }[] = [
  { id: "streetsBase", label: "Străzi (bază)" },
  { id: "bike", label: BIKE_SAFE_LABEL },
  { id: "bikeDoor", label: BIKE_DOOR_LABEL },
  { id: "reserved", label: "Parcare amenajată pe trotuar" },
  { id: "illegal", label: "Parcare ilegală pe trotuar" },
  { id: "schoolAssign", label: "Arondare școli" },
  { id: "schoolMarkers", label: "Markere școli" },
  { id: "buildings", label: "Clădiri" },
  { id: "neighborhoods", label: "Contur cartiere" },
];

export const VIEW_PRESETS: Record<ViewMode, LayerVisibility> = {
  space: {
    streetsBase: false,
    bike: true,
    bikeDoor: true,
    reserved: true,
    illegal: true,
    editedStreets: true,
    schoolAssign: false,
    schoolMarkers: false,
    buildings: false,
    neighborhoods: true,
  },
  buildings: {
    streetsBase: false,
    bike: false,
    bikeDoor: false,
    reserved: false,
    illegal: false,
    editedStreets: true,
    schoolAssign: false,
    schoolMarkers: false,
    buildings: true,
    neighborhoods: true,
  },
  schools: {
    streetsBase: false,
    bike: false,
    bikeDoor: false,
    reserved: false,
    illegal: false,
    editedStreets: true,
    schoolAssign: true,
    schoolMarkers: true,
    buildings: false,
    neighborhoods: true,
  },
  reach: {
    streetsBase: true,
    bike: false,
    bikeDoor: false,
    reserved: false,
    illegal: false,
    editedStreets: true,
    schoolAssign: false,
    schoolMarkers: true,
    buildings: false,
    neighborhoods: false,
  },
};

/** Focalizări = preseturi pe straturi (ca Străzi / Clădiri / Școli). */
export const FOCUS_PRESETS: Record<FocusId, Partial<LayerVisibility>> = {
  hideEmpty: {
    streetsBase: false,
  },
  illegalOnly: {
    bike: false,
    bikeDoor: false,
    reserved: false,
    illegal: true,
    schoolAssign: false,
  },
  bikeOnly: {
    bike: true,
    bikeDoor: true,
    reserved: false,
    illegal: false,
    schoolAssign: false,
  },
};

export function layersMatchPreset(layers: LayerVisibility, mode: ViewMode, opts?: { ignore?: MapLayerId[] }) {
  const preset = VIEW_PRESETS[mode];
  const ignore = new Set(opts?.ignore || []);
  return (Object.keys(preset) as MapLayerId[]).every((k) => ignore.has(k) || layers[k] === preset[k]);
}

export function layersMatchFocus(layers: LayerVisibility, focus: FocusId, opts?: { ignore?: MapLayerId[] }) {
  const preset = FOCUS_PRESETS[focus];
  const ignore = new Set(opts?.ignore || []);
  return (Object.keys(preset) as MapLayerId[]).every((k) => ignore.has(k) || layers[k] === preset[k]!);
}

/** În editare baza rămâne pornită, ca străzile fără măsurători să se vadă. */
export function layersForView(mode: ViewMode, editMode: boolean, opts?: { streetsBase?: boolean }): LayerVisibility {
  const layers = { ...VIEW_PRESETS[mode] };
  if (opts && "streetsBase" in opts) layers.streetsBase = opts.streetsBase!;
  if (editMode) layers.streetsBase = true;
  return layers;
}

/** Focalizarea nu atinge „ascunde străzile fără date”: baza rămâne cum a lăsat-o utilizatorul. */
export function layersForFocus(mode: ViewMode, focus: FocusId, editMode: boolean, streetsBase: boolean): LayerVisibility {
  const layers = { ...VIEW_PRESETS[mode], ...FOCUS_PRESETS[focus] };
  layers.streetsBase = editMode ? true : streetsBase;
  return layers;
}

export function nextLayerToggle(layers: LayerVisibility, id: MapLayerId, on: boolean, editMode: boolean): LayerVisibility {
  if (editMode && id === "streetsBase" && !on) return layers;
  return { ...layers, [id]: on };
}

/** „Ascunde străzile fără date” e doar stratul de bază, separat de celelalte focalizări. */
export function hideEmptyFocusOn(layers: LayerVisibility) {
  return !layers.streetsBase;
}

export function layerLabel(id: MapLayerId) {
  return LAYER_META.find((layer) => layer.id === id)?.label ?? id;
}
