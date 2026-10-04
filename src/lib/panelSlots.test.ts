import { describe, expect, it } from "vitest";
import { dockPanelPatch } from "./panelSlots";

describe("dock panels", () => {
  it("replaces filters, basemap, theme, stats and edits with each other", () => {
    expect(dockPanelPatch("statsOpen", false, false)).toEqual({
      statsOpen: true,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      editsOpen: false,
    });
    expect(dockPanelPatch("editsOpen", false, false)).toEqual({
      editsOpen: true,
      filtersOpen: false,
      basemapOpen: false,
      themeOpen: false,
      statsOpen: false,
    });
    expect(dockPanelPatch("filtersOpen", false, false).editsOpen).toBe(false);
  });

  it("leaves import and search open beside the right-hand panels", () => {
    expect(dockPanelPatch("importReportOpen", false, false)).toEqual({ importReportOpen: true });
    expect(dockPanelPatch("editsOpen", false, false).importReportOpen).toBeUndefined();
    expect(dockPanelPatch("searchOpen", false, false)).toEqual({ searchOpen: true });
    expect(dockPanelPatch("csvEditorOpen", false, false)).toEqual({ csvEditorOpen: true });
  });

  it("closes import when opening edits on a phone, where they share the dock", () => {
    expect(dockPanelPatch("importReportOpen", false, true)).toMatchObject({
      importReportOpen: true,
      editsOpen: false,
      filtersOpen: false,
    });
  });

  it("only closes the panel that is toggled off", () => {
    expect(dockPanelPatch("filtersOpen", true, false)).toEqual({ filtersOpen: false });
  });
});