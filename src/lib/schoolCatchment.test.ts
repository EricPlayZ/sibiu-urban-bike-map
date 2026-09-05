import { describe, expect, it } from "vitest";
import {
  applySchoolCatchments,
  formatArondat,
  parseArondat,
  streetAssignedToSchool,
  streetSchoolSlugs,
} from "./schoolCatchment";

function line(name: string, sid: string): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { sid, name },
    geometry: { type: "LineString", coordinates: [[24.15, 45.79], [24.16, 45.8]] },
  };
}

describe("parseArondat", () => {
  it("splits, trims and uniques", () => {
    expect(parseArondat("scoala_1, scoala_2,scoala_1")).toEqual(["scoala_1", "scoala_2"]);
    expect(parseArondat(["scoala_2", "", "scoala_1", "scoala_2"])).toEqual(["scoala_2", "scoala_1"]);
    expect(parseArondat("")).toEqual([]);
    expect(formatArondat(["b", "a", "b"])).toBe("b,a");
  });
});

describe("applySchoolCatchments", () => {
  it("keeps every school on a shared street name", () => {
    const features = [line("Strada Testului", "st_1"), line("Strada Unică", "st_2")];
    const csv = [
      "school_slug,school_name,street_name",
      "scoala_1,Școala 1,Strada Testului",
      "scoala_2,Școala 2,Strada Testului",
      "scoala_1,Școala 1,Strada Unică",
    ].join("\n");
    const { stats, issues } = applySchoolCatchments(features, csv, new Set(["scoala_1", "scoala_2"]));
    expect(streetSchoolSlugs(features[0].properties as Record<string, unknown>)).toEqual(["scoala_1", "scoala_2"]);
    expect(streetSchoolSlugs(features[1].properties as Record<string, unknown>)).toEqual(["scoala_1"]);
    expect(streetAssignedToSchool(features[0].properties as Record<string, unknown>, "scoala_2")).toBe(true);
    expect(stats.multiSchool).toBe(1);
    expect(stats.osmMatched).toBe(2);
    expect(issues.some((i) => i.code === "arondare_multi_school" && i.severity === "info")).toBe(true);
    expect(issues.find((i) => i.code === "arondare_multi_school")?.detail).toContain("Păstrăm toate");
  });
});
