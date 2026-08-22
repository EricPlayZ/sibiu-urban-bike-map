import { describe, expect, it } from "vitest";
import { parseBuildingEditsFile, serializeBuildingEditsFile } from "./buildingEdits";

describe("building edits file", () => {
  it("keeps known types and drops junk", () => {
    const parsed = parseBuildingEditsFile({
      version: 1,
      __proto__: { polluted: true },
      edits: {
        b_osm_1: { type: "casa" },
        b_osm_2: { type: "spaceship" },
        constructor: { type: "bloc" },
      },
    });
    expect(parsed.edits.b_osm_1).toEqual({ type: "casa" });
    expect(parsed.edits.b_osm_2).toBeUndefined();
    expect(Object.hasOwn(parsed.edits, "constructor")).toBe(false);
    const round = parseBuildingEditsFile(JSON.parse(serializeBuildingEditsFile(parsed)));
    expect(round.edits.b_osm_1).toEqual({ type: "casa" });
  });
});
