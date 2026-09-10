import type { Map } from "maplibre-gl";

/** Flags for overlays that blur or sit on the map and should steal pointer/wheel. */
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

export function isMapUiLocked(s: MapUiLockFlags): boolean {
  return (
    s.filtersOpen ||
    s.statsOpen ||
    s.basemapOpen ||
    s.themeOpen ||
    s.editsOpen ||
    s.importReportOpen ||
    s.csvEditorOpen ||
    s.teamLoginOpen ||
    s.sheetOpen ||
    s.searchOpen
  );
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
