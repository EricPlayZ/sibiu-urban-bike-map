import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applySchoolCatchments } from "./schoolCatchment";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("applySchoolCatchments on repo data", () => {
  it("finishes on osm-streets + catchments csv", () => {
    const osm = JSON.parse(readFileSync(join(root, "public/osm-streets.geojson"), "utf8")) as GeoJSON.FeatureCollection;
    const csv = readFileSync(join(root, "public/data/school-catchments.csv"), "utf8");
    const schools = JSON.parse(readFileSync(join(root, "public/schools.geojson"), "utf8")) as GeoJSON.FeatureCollection;
    const slugs = new Set(
      (schools.features || [])
        .map((f) => String((f.properties as { slug?: string } | null)?.slug || "").trim())
        .filter(Boolean)
    );
    const t0 = Date.now();
    const { stats } = applySchoolCatchments(osm.features, csv, slugs);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(15_000);
    expect(stats.csvRows).toBeGreaterThan(0);
    expect(stats.osmMatched).toBeGreaterThan(0);
  });
});
