import { describe, expect, it, vi } from "vitest";
import { isMapUiLocked, setMapHandlersEnabled, type MapUiLockFlags } from "./mapUiLock";

function flags(partial: Partial<MapUiLockFlags> = {}): MapUiLockFlags {
  return {
    filtersOpen: false,
    statsOpen: false,
    basemapOpen: false,
    themeOpen: false,
    editsOpen: false,
    importReportOpen: false,
    csvEditorOpen: false,
    teamLoginOpen: false,
    sheetOpen: false,
    searchOpen: false,
    ...partial,
  };
}

describe("isMapUiLocked", () => {
  it("is unlocked when every overlay is closed", () => {
    expect(isMapUiLocked(flags())).toBe(false);
  });

  it("locks for filters, stats, popovers, sheets, and login", () => {
    expect(isMapUiLocked(flags({ filtersOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ statsOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ basemapOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ themeOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ editsOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ importReportOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ csvEditorOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ teamLoginOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ sheetOpen: true }))).toBe(true);
    expect(isMapUiLocked(flags({ searchOpen: true }))).toBe(true);
  });
});

describe("setMapHandlersEnabled", () => {
  it("disables then re-enables MapLibre interaction handlers", () => {
    const make = () => ({ enable: vi.fn(), disable: vi.fn() });
    const map = {
      dragPan: make(),
      scrollZoom: make(),
      boxZoom: make(),
      keyboard: make(),
      doubleClickZoom: make(),
      touchZoomRotate: make(),
      dragRotate: make(),
      touchPitch: make(),
    };

    setMapHandlersEnabled(map as never, false);
    expect(map.scrollZoom.disable).toHaveBeenCalledOnce();
    expect(map.dragPan.disable).toHaveBeenCalledOnce();
    expect(map.scrollZoom.enable).not.toHaveBeenCalled();

    setMapHandlersEnabled(map as never, true);
    expect(map.scrollZoom.enable).toHaveBeenCalledOnce();
    expect(map.touchPitch.enable).toHaveBeenCalledOnce();
  });
});
