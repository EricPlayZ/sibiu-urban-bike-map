import { describe, expect, it } from "vitest";
import {
  buildingFillColorExpr,
  buildingLegendItems,
  inferBuildingTypeFromOsm,
  isBuildingType,
  isClassifiedBuildingType,
  normalizeBuildingType,
} from "./buildingTypes";

describe("building types", () => {
  it("maps legacy bloc/altceva onto the new codes", () => {
    expect(normalizeBuildingType("casa")).toBe("casa");
    expect(normalizeBuildingType("bloc")).toBe("bloc_4");
    expect(normalizeBuildingType("altceva")).toBe("necunoscut");
    expect(normalizeBuildingType("bloc_10")).toBe("bloc_10");
    expect(isBuildingType("bloc")).toBe(false);
    expect(isBuildingType("casa_multi")).toBe(true);
    expect(isClassifiedBuildingType("necunoscut")).toBe(false);
    expect(isClassifiedBuildingType("bloc_10")).toBe(true);
  });

  it("infers OSM houses vs centre dwellings, without guessing apartment floors", () => {
    expect(inferBuildingTypeFromOsm("house")).toBe("casa");
    expect(inferBuildingTypeFromOsm("detached")).toBe("casa");
    expect(inferBuildingTypeFromOsm("residential")).toBe("casa_multi");
    expect(inferBuildingTypeFromOsm("terrace")).toBe("casa_multi");
    expect(inferBuildingTypeFromOsm("apartments")).toBe("necunoscut");
    expect(inferBuildingTypeFromOsm("yes")).toBe("necunoscut");
  });

  it("exposes the four legend colors", () => {
    const items = buildingLegendItems();
    expect(items.map((i) => i.key)).toEqual(["casa", "casa_multi", "bloc_4", "bloc_10"]);
    expect(items[0].color).toBe("#2f9e44");
    expect(items[1].color).toBe("#e6b422");
    expect(items[2].color).toBe("#e03131");
    expect(items[3].color).toBe("#9c36b5");
  });

  it("paints the four codes plus leftover OSM/file values", () => {
    const expr = buildingFillColorExpr();
    expect(expr).toContain("casa_multi");
    expect(expr).toContain("#e6b422");
    expect(expr).toContain("bloc_10");
    expect(expr).toContain("#9c36b5");
    expect(expr).toContain("bloc");
    expect(expr.at(-1)).toBe("#ced4da");
  });
});
