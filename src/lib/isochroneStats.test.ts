import { describe, expect, it } from "vitest";
import { neighborhoodAtPoint, neighborhoodsFromCollection, type NeighborhoodPoly } from "./geoAssign";
import { describeReach, formatKm2, geomAreaKm2, shortSchoolName } from "./isochroneStats";

const square = (lng: number, lat: number, d: number): GeoJSON.Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ],
  ],
});

const nhood = (slug: string, name: string, geom: GeoJSON.Polygon): NeighborhoodPoly => ({
  slug,
  name,
  geometry: geom,
});

describe("isochrone stats", () => {
  it("formats square kilometres in Romanian", () => {
    expect(formatKm2(1.8)).toMatch(/1[,.]8/);
    expect(formatKm2(1.8)).toContain("km²");
    expect(formatKm2(10)).toMatch(/^10\s*km²/);
  });

  it("shortens school titles for chips", () => {
    expect(shortSchoolName('Colegiul Național "Octavian Goga"')).toBe("Octavian Goga");
    expect(shortSchoolName("Școala Gimnazială „Ioan Slavici”")).toBe("Ioan Slavici");
    expect(shortSchoolName("Școala Gimnazială nr. 5")).toBe("Gimn. nr. 5");
    expect(shortSchoolName("Școala Gimnazială Nr. 4")).toBe("Gimn. nr. 4");
    expect(shortSchoolName('Colegiul Național Pedagogic "Andrei Șaguna"')).toBe('Pedagogic "Andrei Șaguna"');
    expect(shortSchoolName('Liceu Tehnologic de Construcții și Arhitectură "Carol I"')).toBe(
      'Liceu Tehnologic de Construcții și Arhitectură "Carol I"'
    );
    expect(shortSchoolName('Liceul Teoretic "Constantin Noica"')).toBe("Constantin Noica");
  });

  it("measures a ~100 m square as about 0.01 km²", () => {
    const dLat = 100 / 111320;
    const dLng = 100 / (111320 * Math.cos((45.8 * Math.PI) / 180));
    const geom: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [24.15, 45.8],
          [24.15 + dLng, 45.8],
          [24.15 + dLng, 45.8 + dLat],
          [24.15, 45.8 + dLat],
          [24.15, 45.8],
        ],
      ],
    };
    const km2 = geomAreaKm2(geom);
    expect(km2).toBeGreaterThan(0.009);
    expect(km2).toBeLessThan(0.011);
  });

  it("names the neighbourhood at the origin and those inside the blob", () => {
    const west = nhood("west", "Vest", square(24.14, 45.79, 0.02));
    const east = nhood("east", "Est", square(24.16, 45.79, 0.02));
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { slug: west.slug, denumire: west.name }, geometry: west.geometry },
        { type: "Feature", properties: { slug: east.slug, denumire: east.name }, geometry: east.geometry },
      ],
    };
    const band: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "band" },
          geometry: square(24.145, 45.792, 0.03),
        },
      ],
    };
    const stats = describeReach({ lng: 24.15, lat: 45.8 }, band, fc, null);
    expect(stats.here).toBe("Vest");
    expect(stats.reachable).toBe(true);
    expect(stats.reached).toContain("Vest");
    expect(stats.reached).toContain("Est");
  });

  it("keeps every school name inside the blob", () => {
    const band: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { kind: "band" }, geometry: square(24.14, 45.79, 0.04) }],
    };
    const schools: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: Array.from({ length: 6 }, (_, i) => ({
        type: "Feature" as const,
        properties: { denumire: `Școala ${i + 1}` },
        geometry: { type: "Point" as const, coordinates: [24.15, 45.8] },
      })),
    };
    const stats = describeReach({ lng: 24.15, lat: 45.8 }, band, null, schools);
    expect(stats.schoolCount).toBe(6);
    expect(stats.schoolNames).toHaveLength(6);
    expect(stats.schoolNames).toEqual(["Școala 1", "Școala 2", "Școala 3", "Școala 4", "Școala 5", "Școala 6"]);
  });

  it("picks the smallest containing neighbourhood", () => {
    const list = [
      nhood("big", "Mare", square(24.1, 45.7, 0.3)),
      nhood("small", "Mic", square(24.15, 45.79, 0.02)),
    ];
    expect(neighborhoodAtPoint(list, [24.16, 45.8])?.name).toBe("Mic");
    expect(neighborhoodsFromCollection({ type: "FeatureCollection", features: [] })).toEqual([]);
  });
});
