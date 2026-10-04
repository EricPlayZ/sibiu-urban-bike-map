import { describe, expect, it } from "vitest";
import { VIEW_PRESETS, layerLabel, type LayerVisibility } from "./layers";
import { legendLayerId, mapLegendItems } from "./mapLegend";
import type { Measurement } from "./space";

const schoolList = [
  { slug: "saguna", name: "Colegiul Național Pedagogic Andrei Șaguna" },
  { slug: "noica", name: "Liceul Teoretic Constantin Noica" },
];

function legend(layers: LayerVisibility, selectedSchools = ["saguna", "noica"]) {
  return mapLegendItems({
    layers,
    editMode: false,
    schoolList,
    selectedSchools,
    streets: { type: "FeatureCollection", features: [] },
    measurements: {},
    seedMeasurements: {},
    neighborhoods: [],
  });
}

describe("mapLegendItems school section", () => {
  it("lists schools only while a school layer is on", () => {
    expect(legend(VIEW_PRESETS.space).schools).toEqual([]);
    expect(legend(VIEW_PRESETS.buildings).schools).toEqual([]);
    expect(legend(VIEW_PRESETS.reach).schools.map((s) => s.key)).toEqual(["saguna", "noica"]);
    expect(legend(VIEW_PRESETS.schools).schools.map((s) => s.key)).toEqual(["saguna", "noica"]);
  });

  it("keeps a hidden school in the list while either school layer is on", () => {
    const assignOnly: LayerVisibility = { ...VIEW_PRESETS.space, schoolAssign: true, schoolMarkers: false };
    const markersOnly: LayerVisibility = { ...VIEW_PRESETS.space, schoolAssign: false, schoolMarkers: true };
    const hidden = legend(assignOnly, ["saguna"]).schools;
    expect(hidden.map((s) => s.key)).toEqual(["saguna", "noica"]);
    expect(hidden.find((s) => s.key === "noica")?.off).toBe(true);
    expect(hidden.find((s) => s.key === "saguna")?.off).toBe(false);
    expect(legend(markersOnly, []).schools.every((s) => s.off)).toBe(true);
    expect(legend({ ...VIEW_PRESETS.schools, schoolAssign: false, schoolMarkers: false }).schools).toEqual([]);
  });
});

function street(cartier: string, props: Record<string, unknown> = {}) {
  return {
    type: "Feature" as const,
    geometry: { type: "LineString" as const, coordinates: [[0, 0], [0.01, 0]] },
    properties: { sid: "s1", cartier, ...props },
  };
}

function streetLegend(
  features: ReturnType<typeof street>[],
  layers: LayerVisibility,
  neighborhoods: string[],
  editMode = false,
  measurements: Record<string, Measurement> = {}
) {
  return mapLegendItems({
    layers,
    editMode,
    schoolList: [],
    selectedSchools: [],
    streets: { type: "FeatureCollection", features },
    measurements,
    seedMeasurements: {},
    neighborhoods,
  }).layers;
}

describe("mapLegendItems street filters", () => {
  const layers = VIEW_PRESETS.space;

  it("counts an unassigned street with the selected neighborhoods", () => {
    const items = streetLegend([street("", { bike_lane: true })], layers, ["centru"]);
    expect(items.map((item) => item.key)).toEqual(["base", "bike"]);
    expect(items.find((item) => item.key === "bike")?.off).toBe(false);
  });

  it("keeps street types in the legend when every neighborhood is off", () => {
    const items = streetLegend([street("hipodrom", { bike_lane: true, illgl_park: true })], layers, []);
    expect(items.map((item) => item.key)).toEqual(["base", "bike", "illegal"]);
    expect(items.find((item) => item.key === "bike")?.off).toBe(false);
  });

  it("shows the base swatch as drawn while editing, even if the flag is off", () => {
    const items = streetLegend([street("centru")], { ...layers, streetsBase: false }, ["centru"], true);
    expect(items.find((item) => item.key === "base")?.off).toBe(false);
  });

  it("uses the same layer names as the filters panel", () => {
    const items = streetLegend(
      [street("centru", { bike_lane: true, bike_door: true, rsrvd_park: true, illgl_park: true })],
      { ...layers, streetsBase: true },
      ["centru"],
      true,
      { s1: { source: "local" } }
    );
    for (const item of items) {
      if (item.filter !== "layer") continue;
      const id = legendLayerId(item.key);
      expect(id).not.toBeNull();
      if (item.key === "edited") expect(item.label).toBe("Străzi editate");
      else expect(item.label).toBe(layerLabel(id!));
    }
    expect(items.find((item) => item.key === "edited")?.off).toBe(false);
  });
});
