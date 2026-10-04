import { describe, expect, it } from "vitest";
import { buildingTypeFilterExpr } from "./buildingTypes";
import { buildingLayerFilter, buildingMatchesNeighborhood, streetMatchesNeighborhood } from "./mapFilters";

const all = ["centru", "hipodrom"];

describe("streetMatchesNeighborhood", () => {
  const selected = new Set(["centru"]);

  it("keeps unassigned streets and streets in a selected neighborhood", () => {
    expect(streetMatchesNeighborhood("", selected)).toBe(true);
    expect(streetMatchesNeighborhood("   ", selected)).toBe(true);
    expect(streetMatchesNeighborhood(" centru ", selected)).toBe(true);
  });

  it("hides a street whose neighborhood is not selected", () => {
    expect(streetMatchesNeighborhood("hipodrom", selected)).toBe(false);
    expect(streetMatchesNeighborhood("centru", new Set())).toBe(false);
  });
});

describe("building neighborhood filter", () => {
  it("shows a building before it has a cartier stamp", () => {
    expect(buildingMatchesNeighborhood(undefined, false, [], all)).toBe(true);
  });

  it("keeps buildings outside every neighborhood when one neighborhood is turned off", () => {
    expect(buildingMatchesNeighborhood("", true, all, all)).toBe(true);
    expect(buildingMatchesNeighborhood("", true, ["centru"], all)).toBe(true);
    expect(buildingMatchesNeighborhood("", true, [], all)).toBe(true);
  });

  it("shows a stamped building only in a selected neighborhood", () => {
    expect(buildingMatchesNeighborhood("centru", true, ["centru"], all)).toBe(true);
    expect(buildingMatchesNeighborhood("hipodrom", true, ["centru"], all)).toBe(false);
  });

  it("builds the same MapLibre filter the map applies", () => {
    const typeExpr = buildingTypeFilterExpr(["casa"]);
    expect(buildingLayerFilter(["centru"], all, typeExpr)).toEqual([
      "all",
      typeExpr,
      ["any", ["!", ["has", "cartier"]], ["in", ["get", "cartier"], ["literal", ["centru", ""]]]],
    ]);
    expect(buildingLayerFilter(all, all, typeExpr)[2]).toEqual([
      "any",
      ["!", ["has", "cartier"]],
      ["in", ["get", "cartier"], ["literal", ["centru", "hipodrom", ""]]],
    ]);
  });
});
