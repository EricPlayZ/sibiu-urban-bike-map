import { describe, expect, it } from "vitest";
import {
  FOCUS_PRESETS,
  LAYER_META,
  VIEW_PRESETS,
  hideEmptyFocusOn,
  layerLabel,
  layersForFocus,
  layersForView,
  layersMatchFocus,
  layersMatchPreset,
  nextLayerToggle,
  type MapLayerId,
} from "./layers";

const ALL_LAYERS: MapLayerId[] = [
  "streetsBase",
  "bike",
  "bikeDoor",
  "reserved",
  "illegal",
  "editedStreets",
  "schoolAssign",
  "schoolMarkers",
  "buildings",
  "neighborhoods",
];

describe("layer presets", () => {
  it("gives every view a value for every layer", () => {
    for (const preset of Object.values(VIEW_PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual([...ALL_LAYERS].sort());
    }
  });

  it("lists every layer in the filters panel except edited streets", () => {
    const listed = LAYER_META.map((layer) => layer.id);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual(ALL_LAYERS.filter((id) => id !== "editedStreets").sort());
    expect(LAYER_META.every((layer) => layer.label.trim().length > 0)).toBe(true);
  });

  it("keeps the two data focuses mutually exclusive", () => {
    const illegal = layersForFocus("space", "illegalOnly", false, false);
    const bike = layersForFocus("space", "bikeOnly", false, false);
    expect(layersMatchFocus(illegal, "illegalOnly")).toBe(true);
    expect(layersMatchFocus(illegal, "bikeOnly")).toBe(false);
    expect(layersMatchFocus(bike, "bikeOnly")).toBe(true);
    expect(layersMatchFocus(bike, "illegalOnly")).toBe(false);
  });

  it("forces the base street layer on while editing", () => {
    expect(layersForView("space", true).streetsBase).toBe(true);
    expect(layersForFocus("space", "illegalOnly", true, false).streetsBase).toBe(true);
    expect(layersForView("reach", false).streetsBase).toBe(true);
    const locked = nextLayerToggle(layersForView("space", true), "streetsBase", false, true);
    expect(locked.streetsBase).toBe(true);
    expect(nextLayerToggle(locked, "bike", false, true).bike).toBe(false);
  });

  it("turns school markers on in access mode", () => {
    expect(VIEW_PRESETS.reach.schoolMarkers).toBe(true);
  });

  it("does not rewrite the shared presets", () => {
    const layers = layersForView("space", false);
    layers.bike = false;
    expect(VIEW_PRESETS.space.bike).toBe(true);
    expect(FOCUS_PRESETS.hideEmpty).toEqual({ streetsBase: false });
  });
});

describe("focus switches", () => {
  it("keeps hide-empty on its own, including while another focus is on", () => {
    expect(hideEmptyFocusOn(layersForView("space", false))).toBe(true);
    expect(hideEmptyFocusOn(layersForView("reach", false))).toBe(false);
    const illegal = layersForFocus("space", "illegalOnly", false, false);
    const bike = layersForFocus("space", "bikeOnly", false, true);
    expect(hideEmptyFocusOn(illegal)).toBe(true);
    expect(layersMatchFocus(illegal, "illegalOnly")).toBe(true);
    expect(hideEmptyFocusOn(bike)).toBe(false);
    expect(bike.streetsBase).toBe(true);
    expect(layersMatchFocus(bike, "bikeOnly")).toBe(true);
  });

  it("restores the view without changing hide-empty", () => {
    const cleared = layersForView("space", false, { streetsBase: true });
    expect(cleared.streetsBase).toBe(true);
    expect(cleared.bike).toBe(true);
    expect(hideEmptyFocusOn(cleared)).toBe(false);
  });

  it("keeps a data focus checked in edit mode, when the base layer is forced on", () => {
    const illegal = layersForFocus("space", "illegalOnly", true, false);
    expect(layersMatchFocus(illegal, "illegalOnly")).toBe(true);
    expect(illegal.streetsBase).toBe(true);
    expect(hideEmptyFocusOn(illegal)).toBe(false);
    expect(layersMatchPreset(illegal, "space", { ignore: ["streetsBase"] })).toBe(false);
  });
});

describe("layer labels", () => {
  it("uses one label for each filter-panel layer", () => {
    for (const layer of LAYER_META) expect(layerLabel(layer.id)).toBe(layer.label);
    expect(layerLabel("editedStreets")).toBe("editedStreets");
  });
});
