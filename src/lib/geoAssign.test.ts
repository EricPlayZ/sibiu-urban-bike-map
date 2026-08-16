import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clipLineOutsideNeighborhoods,
  clipStreetToNeighborhoods,
  geometryLineStrings,
  neighborhoodIsActive,
  shouldKeepUncut,
  uncutOwner,
  type NeighborhoodPoly,
} from "./geoAssign";
import { normalizeStreetName } from "./space";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), "utf8")) as T;
}

function square(slug: string, minX: number, minY: number, maxX: number, maxY: number): NeighborhoodPoly {
  return {
    slug,
    name: slug,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
  };
}

function line(coords: [number, number][]): GeoJSON.LineString {
  return { type: "LineString", coordinates: coords };
}

function activeNeighborhoods(): NeighborhoodPoly[] {
  const fc = loadJson<GeoJSON.FeatureCollection>("public/neighborhood_limits.geojson");
  return fc.features.flatMap((f) => {
    const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string; dissolve?: unknown };
    if (!neighborhoodIsActive(p)) return [];
    const slug = String(p.slug || "");
    if (!slug || !f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) return [];
    return [
      {
        slug,
        name: String(p.denumire || p.name || slug),
        geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      },
    ];
  });
}

function streetFeatures(name: string): GeoJSON.Feature[] {
  const fc = loadJson<GeoJSON.FeatureCollection>("public/osm-streets.geojson");
  const key = normalizeStreetName(name);
  return fc.features.filter((f) => normalizeStreetName(String((f.properties as { name?: string })?.name || "")) === key);
}

describe("uncutOwner", () => {
  const west = square("west", 0, 0, 1, 1);
  const east = square("east", 1, 0, 2, 1);
  const polys = [west, east];
  const crossing = line([
    [0.2, 0.5],
    [1.8, 0.5],
  ]);

  it("keeps a single crossing line when only one neighborhood has data", () => {
    const pieces = clipStreetToNeighborhoods(crossing, polys);
    expect(new Set(pieces.map((p) => p.neighborhood.slug))).toEqual(new Set(["west", "east"]));
    expect(uncutOwner(pieces, false, new Set(["west"]))?.slug).toBe("west");
    expect(uncutOwner(pieces, false, new Set(["east"]))?.slug).toBe("east");
  });

  it("still cuts when both neighborhoods have data", () => {
    const pieces = clipStreetToNeighborhoods(crossing, polys);
    expect(uncutOwner(pieces, false, new Set(["west", "east"]))).toBeNull();
  });

  it("still cuts when neither neighborhood has data", () => {
    const pieces = clipStreetToNeighborhoods(crossing, polys);
    expect(uncutOwner(pieces, false, new Set())).toBeNull();
  });

  it("keeps a line that sticks out of its only neighborhood when that neighborhood has data", () => {
    const poking = line([
      [0.5, 0.2],
      [0.5, 1.6],
    ]);
    const pieces = clipStreetToNeighborhoods(poking, [west]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].neighborhood.slug).toBe("west");
    const outside = clipLineOutsideNeighborhoods(geometryLineStrings(poking)[0], [west]);
    expect(outside.length).toBeGreaterThan(0);
    expect(uncutOwner(pieces, true, new Set(["west"]))?.slug).toBe("west");
    expect(uncutOwner(pieces, true, new Set())).toBeNull();
  });

  it("does not uncut a street fully inside one neighborhood", () => {
    const inside = line([
      [0.2, 0.2],
      [0.8, 0.8],
    ]);
    const pieces = clipStreetToNeighborhoods(inside, [west]);
    expect(pieces).toHaveLength(1);
    expect(uncutOwner(pieces, false, new Set(["west"]))).toBeNull();
  });
});

describe("uncut vs real Sibiu streets", () => {
  const polys = activeNeighborhoods();

  it("still cuts Egalității because Lupeni and Lazaret both have data", () => {
    const raw = streetFeatures("Strada Egalității");
    expect(raw).toHaveLength(1);
    const pieces = clipStreetToNeighborhoods(raw[0].geometry, polys);
    const slugs = new Set(pieces.map((p) => p.neighborhood.slug));
    expect(slugs.has("lupeni")).toBe(true);
    expect(slugs.has("lazaret")).toBe(true);
    expect(uncutOwner(pieces, false, new Set(["lupeni", "lazaret"]))).toBeNull();
    expect(uncutOwner(pieces, false, new Set(["lupeni"]))?.slug).toBe("lupeni");
  });

  it("still cuts Vulcan because Lupeni and Lazaret both have data", () => {
    const raw = streetFeatures("Strada Vulcan");
    expect(raw).toHaveLength(1);
    const pieces = clipStreetToNeighborhoods(raw[0].geometry, polys);
    const slugs = new Set(pieces.map((p) => p.neighborhood.slug));
    expect(slugs.has("lupeni")).toBe(true);
    expect(slugs.has("lazaret")).toBe(true);
    expect(uncutOwner(pieces, false, new Set(["lupeni", "lazaret"]))).toBeNull();
  });

  it("keeps each Mihai Viteazu way that crosses Hipodrom, per carriageway", () => {
    const raw = streetFeatures("Bulevardul Mihai Viteazul");
    expect(raw.length).toBeGreaterThan(2);
    const hipodromOnly = new Set(["hipodrom"]);
    const crossing = raw.filter((f) => {
      const pieces = clipStreetToNeighborhoods(f.geometry, polys);
      const outside = geometryLineStrings(f.geometry).flatMap((line) => clipLineOutsideNeighborhoods(line, polys));
      return shouldKeepUncut(f.geometry, pieces, outside.length > 0, hipodromOnly)?.slug === "hipodrom";
    });
    expect(crossing.length).toBeGreaterThanOrEqual(2);

    const fullyOutside = raw.filter((f) => !clipStreetToNeighborhoods(f.geometry, polys).length);
    expect(fullyOutside.length).toBeGreaterThan(0);
    for (const f of fullyOutside) {
      const outside = geometryLineStrings(f.geometry).flatMap((line) => clipLineOutsideNeighborhoods(line, polys));
      expect(shouldKeepUncut(f.geometry, [], outside.length > 0, hipodromOnly)).toBeNull();
    }
  });
});
