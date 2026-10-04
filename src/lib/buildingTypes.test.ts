import { describe, expect, it } from "vitest";
import {
  buildingFillColorExpr,
  buildingLegendItems,
  buildingTypeFilterExpr,
  buildingTypeMeta,
  coerceBuildingType,
  DEFAULT_BUILDING_TYPE,
  inferBuildingTypeFromOsm,
  isBuildingType,
  isClassifiedBuildingType,
  normalizeBuildingType,
} from "./buildingTypes";

describe("building types", () => {
  it("maps legacy bloc/altceva/necunoscut onto current codes", () => {
    expect(normalizeBuildingType("casa")).toBe("casa");
    expect(normalizeBuildingType("bloc")).toBe("bloc_4");
    expect(normalizeBuildingType("altceva")).toBe("public_business");
    expect(normalizeBuildingType("necunoscut")).toBe("public_business");
    expect(normalizeBuildingType("bloc_10")).toBe("bloc_10");
    expect(normalizeBuildingType("spaceship")).toBeNull();
    expect(isBuildingType("bloc")).toBe(false);
    expect(isBuildingType("necunoscut")).toBe(false);
    expect(isBuildingType("casa_multi")).toBe(true);
    expect(isClassifiedBuildingType("public_business")).toBe(true);
    expect(isClassifiedBuildingType("bloc_10")).toBe(true);
  });

  it("never falls back to an unknown type", () => {
    expect(DEFAULT_BUILDING_TYPE).toBe("public_business");
    expect(coerceBuildingType(undefined)).toBe("public_business");
    expect(coerceBuildingType("garbage")).toBe("public_business");
    expect(coerceBuildingType("casa")).toBe("casa");
    expect(buildingTypeMeta("???").label).toBe("Clădire publică / privată");
  });

  it("infers OSM houses vs centre dwellings; everything else is public/business", () => {
    expect(inferBuildingTypeFromOsm("house")).toBe("casa");
    expect(inferBuildingTypeFromOsm("detached")).toBe("casa");
    expect(inferBuildingTypeFromOsm("residential")).toBe("casa_multi");
    expect(inferBuildingTypeFromOsm("terrace")).toBe("casa_multi");
    expect(inferBuildingTypeFromOsm("apartments")).toBe("public_business");
    expect(inferBuildingTypeFromOsm("yes")).toBe("public_business");
    expect(inferBuildingTypeFromOsm("")).toBe("public_business");
  });

  it("exposes all five legend entries", () => {
    const items = buildingLegendItems();
    expect(items.map((i) => i.key)).toEqual(["casa", "casa_multi", "bloc_4", "bloc_10", "public_business"]);
    expect(items[0].color).toBe("#2f9e44");
    expect(items[1].color).toBe("#e6b422");
    expect(items[2].color).toBe("#e03131");
    expect(items[3].color).toBe("#9c36b5");
    expect(items[4].color).toBe("#ced4da");
  });

  it("paints every code plus leftover file values with the default color", () => {
    const expr = buildingFillColorExpr();
    expect(expr).toContain("casa_multi");
    expect(expr).toContain("#e6b422");
    expect(expr).toContain("bloc_10");
    expect(expr).toContain("#9c36b5");
    expect(expr).toContain("public_business");
    expect(expr).toContain("bloc");
    expect(expr.at(-1)).toBe("#ced4da");
    expect(JSON.stringify(expr)).not.toContain("#1c7ed6");
  });

  it("builds a map filter from the selected types", () => {
    expect(buildingTypeFilterExpr(["casa", "bloc_4"])).toEqual(["in", ["get", "ubr_type"], ["literal", ["casa", "bloc_4"]]]);
    expect(buildingTypeFilterExpr([])).toEqual(["==", ["get", "ubr_type"], "__none__"]);
    expect(buildingTypeFilterExpr(["casa", "casa_multi", "bloc_4", "bloc_10", "public_business"])).toEqual([
      "has",
      "ubr_type",
    ]);
    expect(buildingTypeFilterExpr(["nope"])).toEqual(["==", ["get", "ubr_type"], "__none__"]);
  });
});
