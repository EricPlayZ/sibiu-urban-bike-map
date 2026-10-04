import { describe, expect, it } from "vitest";
import { neighborhoodInfo, stampBuildingCartiere } from "./neighborhoodInfo";
import { neighborhoodPopupHtml } from "./streetPopup";

const square = (slug: string, x0: number, x1: number): GeoJSON.Feature => ({
  type: "Feature",
  properties: { slug, denumire: slug.toUpperCase() },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [x0, 45.7],
        [x1, 45.7],
        [x1, 45.8],
        [x0, 45.8],
        [x0, 45.7],
      ],
    ],
  },
});

const neighborhoods: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [square("a", 24.0, 24.1), square("b", 24.1, 24.2)],
};

const building = (bid: string, lng: number, type: string): GeoJSON.Feature => ({
  type: "Feature",
  properties: { bid, ubr_type: type },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [lng, 45.75],
        [lng + 0.0002, 45.75],
        [lng + 0.0002, 45.7502],
        [lng, 45.7502],
        [lng, 45.75],
      ],
    ],
  },
});

const street = (sid: string, cartier: string, lng: number, extra: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: "Feature",
  properties: { sid, cartier, name: `Strada ${sid}`, ...extra },
  geometry: {
    type: "LineString",
    coordinates: [
      [lng, 45.75],
      [lng + 0.001, 45.75],
    ],
  },
});

describe("neighborhoodInfo", () => {
  const streets: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [street("s1", "a", 24.01), street("s2", "a", 24.03), street("s3", "b", 24.15)],
  };
  const schools: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { slug: "sc1", denumire: "Școala 1" }, geometry: { type: "Point", coordinates: [24.05, 45.75] } },
      { type: "Feature", properties: { slug: "sc2", denumire: "Școala 2" }, geometry: { type: "Point", coordinates: [24.15, 45.75] } },
    ],
  };
  const buildings: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [building("b1", 24.02, "casa"), building("b2", 24.04, "public_business"), building("b3", 24.15, "bloc_4")],
  };

  it("summarises streets, schools, buildings and coverage of one cartier only", () => {
    const info = neighborhoodInfo({
      slug: "a",
      streets,
      neighborhoods,
      schools,
      buildings,
      measurements: { s1: { carriageway_m: 6, sidewalk1_m: 2, source: "local" } },
      seedMeasurements: {},
    });
    expect(info).not.toBeNull();
    expect(info!.streets.segments).toBe(2);
    expect(info!.schools.map((s) => s.slug)).toEqual(["sc1"]);
    expect(info!.buildings?.total).toBe(2);
    expect(info!.buildings?.byType.casa).toBe(1);
    expect(info!.buildings?.byType.public_business).toBe(1);
    expect(info!.coverage.totalSegments).toBe(2);
    expect(info!.coverage.measuredSegments).toBe(1);
    expect(info!.coverage.edited).toBe(1);
  });

  it("returns null for an unknown cartier and leaves buildings null when not loaded", () => {
    const base = { streets, neighborhoods, schools, buildings: null, measurements: {}, seedMeasurements: {} };
    expect(neighborhoodInfo({ ...base, slug: "zzz" })).toBeNull();
    expect(neighborhoodInfo({ ...base, slug: "b" })?.buildings).toBeNull();
  });

  it("stamps the cartier on each building for map filtering", () => {
    const stamped = stampBuildingCartiere(buildings, neighborhoods)!;
    const by = Object.fromEntries(stamped.features.map((f) => [(f.properties as { bid: string }).bid, (f.properties as { cartier: string }).cartier]));
    expect(by).toEqual({ b1: "a", b2: "a", b3: "b" });
  });

  it("popup: every section starts collapsed and actions exist, without changing filters on its own", () => {
    const info = neighborhoodInfo({ slug: "a", streets, neighborhoods, schools, buildings, measurements: {}, seedMeasurements: {} });
    const html = neighborhoodPopupHtml("A", info, "a");
    const folds = html.match(/<details\b[^>]*>/g) ?? [];
    expect(folds).toHaveLength(4);
    expect(folds.every((tag) => !/\sopen(?:\s|=|>|$)/.test(tag))).toBe(true);
    for (const title of ["Străzi", "Școli", "Clădiri", "Acoperire măsurători"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain('data-ubr-act="only-nb"');
    expect(html).toContain('data-ubr-act="hide-nb"');
    expect(html).toContain("Arată doar acest cartier");
    expect(html).toContain("Ascunde acest cartier");
  });
});
