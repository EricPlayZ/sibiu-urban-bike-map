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

export const LAYER_META: { id: MapLayerId; label: string; hint: string }[] = [
  { id: "streetsBase", label: "Străzi (bază)", hint: "Linia gri pentru toate străzile" },
  { id: "bike", label: "Pistă biciclete", hint: "Pistă fără mașini parcate pe lângă ea" },
  {
    id: "bikeDoor",
    label: "Pistă pe carosabil",
    hint: "Între carosabil și mașinile parcate — fără protecție",
  },
  { id: "reserved", label: "Parcare amenajată", hint: "Parcare pe trotuar amenajată" },
  { id: "illegal", label: "Parcare ilegală", hint: "Parcare ilegală pe trotuar" },
  { id: "schoolAssign", label: "Arondare școli", hint: "Străzi arondate unei școli" },
  { id: "schoolMarkers", label: "Markere școli", hint: "Pin-urile pe hartă" },
  { id: "buildings", label: "Clădiri", hint: "Poligoane tip casă / bloc" },
  { id: "neighborhoods", label: "Contur cartiere", hint: "Limitele de cartier" },
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
