import type { Map } from "maplibre-gl";

/** Flags the map may consult. Corner panels are listed so callers can pass store state. */
export type MapUiLockFlags = {
  filtersOpen: boolean;
  statsOpen: boolean;
  basemapOpen: boolean;
  themeOpen: boolean;
  editsOpen: boolean;
  importReportOpen: boolean;
  csvEditorOpen: boolean;
  teamLoginOpen: boolean;
  sheetOpen: boolean;
  searchOpen: boolean;
};

const MAP_HANDLERS = [
  "dragPan",
  "scrollZoom",
  "boxZoom",
  "keyboard",
  "doubleClickZoom",
  "touchZoomRotate",
  "dragRotate",
  "touchPitch",
] as const;

/**
 * Import, Editări, Stats, Temă, and Hartă stay in a corner and must not block pan, zoom, or clicks.
 * Filters, search, the detail sheet, team login, and the CSV editor still take the map.
 */
export function isMapUiLocked(s: MapUiLockFlags): boolean {
  return s.filtersOpen || s.csvEditorOpen || s.teamLoginOpen || s.sheetOpen || s.searchOpen;
}

type ToggleHandler = { enable: () => void; disable: () => void };

export function setMapHandlersEnabled(map: Map, enabled: boolean) {
  for (const key of MAP_HANDLERS) {
    const handler = map[key] as ToggleHandler | undefined;
    if (!handler) continue;
    if (enabled) handler.enable();
    else handler.disable();
  }
}
