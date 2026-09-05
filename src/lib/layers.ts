import type { ViewMode } from "./space";

export type MapLayerId =
  | "streetsBase"
  | "bike"
  | "bikeDoor"
  | "reserved"
  | "illegal"
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
  { id: "reserved", label: "Parcare amenajată" },
  { id: "illegal", label: "Parcare ilegală" },
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
    schoolAssign: true,
    schoolMarkers: true,
    buildings: false,
    neighborhoods: true,
  },
};

/** Focalizări = preseturi pe straturi (ca Spațiu / Clădiri / Școli). */
export const FOCUS_PRESETS: Record<FocusId, Partial<LayerVisibility>> = {
  hideEmpty: {
    streetsBase: false,
  },
  illegalOnly: {
    streetsBase: false,
    bike: false,
    bikeDoor: false,
    reserved: false,
    illegal: true,
    schoolAssign: false,
  },
  bikeOnly: {
    streetsBase: false,
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

export function layersMatchFocus(layers: LayerVisibility, focus: FocusId) {
  const preset = FOCUS_PRESETS[focus];
  return (Object.keys(preset) as MapLayerId[]).every((k) => layers[k] === preset[k]!);
}
