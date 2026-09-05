import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCHOOL_COLORS,
  assignSchoolColors,
  explodeSchoolColorFeatures,
  schoolColor,
} from "./schoolColors";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const SIBIU_SLUGS = Object.keys(SCHOOL_COLORS);

function rgbDist(a: string, b: string) {
  const to = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const A = to(a);
  const B = to(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

describe("schoolColor", () => {
  it("is stable per slug without assignment and differs across schools", () => {
    expect(schoolColor("scoala_1")).toBe(schoolColor("scoala_1"));
    expect(schoolColor("scoala_1")).toMatch(/^#[0-9a-f]{6}$/);
    expect(schoolColor("scoala_1")).not.toBe(schoolColor("scoala_2"));
  });

  it("keeps a unique, persistent color for every Sibiu school", () => {
    const colors = SIBIU_SLUGS.map((s) => schoolColor(s));
    expect(new Set(colors).size).toBe(SIBIU_SLUGS.length);
    expect(schoolColor("scoala_10")).not.toBe(schoolColor("scoala_11"));
    expect(schoolColor("scoala_12")).not.toBe(schoolColor("scoala_13"));
  });

  it("gives Nicolae Iorga and Constantin Noica clearly different colors", () => {
    const iorga = schoolColor("scoala_nicolae_iorga");
    const noica = schoolColor("liceu_constantin_noica");
    expect(iorga).not.toBe(noica);
    expect(rgbDist(iorga, noica)).toBeGreaterThan(150);
  });

  it("does not reshuffle known colors when the school list changes", () => {
    const before = Object.fromEntries(SIBIU_SLUGS.map((s) => [s, schoolColor(s)]));
    assignSchoolColors([...SIBIU_SLUGS].reverse());
    assignSchoolColors(SIBIU_SLUGS.slice(0, 5));
    assignSchoolColors([]);
    for (const slug of SIBIU_SLUGS) {
      expect(schoolColor(slug)).toBe(before[slug]);
    }
  });

  it("derives a stable fallback for unknown slugs", () => {
    expect(schoolColor("scoala_noua")).toBe(schoolColor("scoala_noua"));
    expect(schoolColor("scoala_noua")).not.toBe(schoolColor("scoala_1"));
  });

  it("has a fixed color for every school in schools.geojson", () => {
    const schools = JSON.parse(readFileSync(join(root, "public/schools.geojson"), "utf8")) as GeoJSON.FeatureCollection;
    const slugs = (schools.features || [])
      .map((f) => String((f.properties as { slug?: string } | null)?.slug || "").trim())
      .filter(Boolean);
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(SCHOOL_COLORS[slug], slug).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("explodeSchoolColorFeatures", () => {
  const geom: GeoJSON.LineString = { type: "LineString", coordinates: [[0, 0], [1, 1]] };

  it("emits one stripe per selected school, with offsets when shared", () => {
    const features: GeoJSON.Feature[] = [
      {
        type: "Feature",
        geometry: geom,
        properties: { sid: "st_1", has_arondat: 1, arondat: "a,b,c", off_sch: 0, flag_count: 1 },
      },
    ];
    const stripes = explodeSchoolColorFeatures(features, new Set(["a", "c"]));
    expect(stripes).toHaveLength(2);
    expect(stripes.map((f) => f.properties?.school_slug)).toEqual(["a", "c"]);
    expect(stripes[0].properties?.school_color).toBe(schoolColor("a"));
    expect(stripes[0].properties?.school_n).toBe(2);
    expect(Number(stripes[0].properties?.off_sch)).toBeLessThan(Number(stripes[1].properties?.off_sch));
  });

  it("skips streets without arondare flag", () => {
    const features: GeoJSON.Feature[] = [
      { type: "Feature", geometry: geom, properties: { sid: "st_1", arondat: "a", has_arondat: 0 } },
    ];
    expect(explodeSchoolColorFeatures(features, new Set(["a"]))).toEqual([]);
  });
});
