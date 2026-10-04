import { describe, expect, it } from "vitest";
import { buildingFeatureForFocus, editMapHit, splitRootFeature, streetFeatureForFocus } from "./editFocus";

function line(sid: string): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { sid, name: sid },
    geometry: { type: "LineString", coordinates: [[24.1, 45.7], [24.12, 45.72]] },
  };
}

function poly(bid: string): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { bid },
    geometry: {
      type: "Polygon",
      coordinates: [[[24.1, 45.7], [24.11, 45.7], [24.11, 45.71], [24.1, 45.7]]],
    },
  };
}

describe("streetFeatureForFocus", () => {
  it("prefers the painted segment, then the pipeline id, then the split root", () => {
    const piece = line("strada:s1");
    const root = line("strada");
    const streets = { type: "FeatureCollection" as const, features: [piece] };
    const pipeline = { type: "FeatureCollection" as const, features: [root] };
    expect(streetFeatureForFocus(streets, pipeline, "strada:s1")).toBe(piece);
    expect(streetFeatureForFocus(null, pipeline, "strada:s1")).toBe(root);
    expect(streetFeatureForFocus(null, null, "strada:s1")).toBeNull();
  });
});

describe("splitRootFeature", () => {
  it("reads the unsplit line from the pipeline before the painted streets", () => {
    const painted = line("strada");
    const raw = line("strada");
    raw.properties = { sid: "strada", name: "raw" };
    expect(splitRootFeature({ type: "FeatureCollection", features: [painted] }, { type: "FeatureCollection", features: [raw] }, "strada")).toBe(raw);
  });
});

describe("editMapHit", () => {
  it("builds a quiet fly target and skips missing geometry", () => {
    const feature = poly("b1");
    const hit = editMapHit("building:b1", "Clădire", "Clădire", feature);
    expect(hit?.id).toBe("edit:building:b1");
    expect(hit?.quiet).toBe(true);
    expect(hit?.features).toEqual([feature]);
    expect(editMapHit("building:b1", "Clădire", "Clădire", null)).toBeNull();
    expect(buildingFeatureForFocus({ type: "FeatureCollection", features: [feature] }, "b1")).toBe(feature);
  });
});
