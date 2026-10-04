import { BUILDING_TYPES, coerceBuildingType, type BuildingType } from "./buildingTypes";
import { neighborhoodsFromCollection, pointInPolygon, type LngLat, type NeighborhoodPoly } from "./geoAssign";
import { streetSchoolSlugs } from "./schoolCatchment";
import {
  featureHasReservedParking,
  featureLengthMeters,
  resolveStreetMeasurement,
  spaceShares,
  streetHasDoorZoneBikeLane,
  streetHasIllegalParking,
  streetHasSafeBikeLane,
  streetHasSurveyedAttributes,
  type Measurement,
} from "./space";

/** Tot ce arătăm în fereastra unui cartier. Fiecare secțiune poate lipsi (`null`) dacă datele nu sunt încărcate. */
export type NeighborhoodInfo = {
  slug: string;
  name: string;
  streets: {
    /** Bucăți de stradă (segmente) din cartier. */
    segments: number;
    /** Străzi distincte după nume. */
    names: number;
    km: number;
    bikeSafeKm: number;
    bikeDoorKm: number;
    illegalKm: number;
    reservedKm: number;
    schoolAssigned: number;
  };
  schools: { slug: string; name: string }[];
  buildings: { total: number; byType: Record<BuildingType, number> } | null;
  coverage: {
    measuredSegments: number;
    totalSegments: number;
    measuredKm: number;
    totalKm: number;
    /** Segmente cu lățimi complete pentru bara de spațiu. */
    withWidths: number;
    /** Segmente editate de echipă. */
    edited: number;
  };
};

export type NeighborhoodInfoInput = {
  slug: string;
  streets: GeoJSON.FeatureCollection | null;
  neighborhoods: GeoJSON.FeatureCollection | null;
  schools: GeoJSON.FeatureCollection | null;
  buildings: GeoJSON.FeatureCollection | null;
  measurements: Record<string, Measurement>;
  seedMeasurements: Record<string, Measurement>;
};

const km = (m: number) => Math.round(m / 10) / 100;

function firstCoord(geom: GeoJSON.Geometry | null | undefined): LngLat | null {
  let c: unknown = geom && "coordinates" in geom ? geom.coordinates : null;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
  return [c[0], c[1]];
}

/** Punct reprezentativ al unei clădiri: media colțurilor primului inel (destul de bun pentru a o pune într-un cartier). */
export function buildingAnchor(geom: GeoJSON.Geometry | null | undefined): LngLat | null {
  if (!geom) return null;
  let ring: number[][] | null = null;
  if (geom.type === "Polygon") ring = geom.coordinates[0] ?? null;
  else if (geom.type === "MultiPolygon") ring = geom.coordinates[0]?.[0] ?? null;
  if (!ring?.length) return firstCoord(geom);
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

type Bbox = [number, number, number, number];

function polyBbox(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const p of poly[0] || []) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return [minX, minY, maxX, maxY];
}

/** bid → slug cartier. Pozițiile clădirilor nu se schimbă, deci calculul se face o singură dată per clădire. */
const buildingCartier = new Map<string, string>();
let cartierKey = "";

function assignBuildings(buildings: GeoJSON.FeatureCollection, polys: NeighborhoodPoly[]) {
  const key = polys.map((p) => p.slug).join("|");
  if (key !== cartierKey) {
    buildingCartier.clear();
    cartierKey = key;
  }
  const boxes = polys.map((p) => polyBbox(p.geometry));
  for (const f of buildings.features) {
    const bid = String((f.properties as { bid?: string } | null)?.bid || "");
    if (!bid || buildingCartier.has(bid)) continue;
    const pt = buildingAnchor(f.geometry);
    let slug = "";
    if (pt) {
      for (let i = 0; i < polys.length; i++) {
        const b = boxes[i];
        if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
        if (pointInPolygon(pt, polys[i].geometry)) {
          slug = polys[i].slug;
          break;
        }
      }
    }
    buildingCartier.set(bid, slug);
  }
}

/**
 * Pune `cartier` (slug sau "" în afara cartierelor) pe fiecare clădire, ca hartă să le poată filtra.
 * Returnează aceeași colecție dacă nu e nimic de schimbat.
 */
export function stampBuildingCartiere(
  buildings: GeoJSON.FeatureCollection | null,
  neighborhoods: GeoJSON.FeatureCollection | null
): GeoJSON.FeatureCollection | null {
  if (!buildings) return buildings;
  const polys = neighborhoodsFromCollection(neighborhoods);
  if (!polys.length) return buildings;
  assignBuildings(buildings, polys);
  return {
    type: "FeatureCollection",
    features: buildings.features.map((f) => {
      const props = (f.properties || {}) as Record<string, unknown>;
      const cartier = buildingCartier.get(String(props.bid || "")) ?? "";
      return props.cartier === cartier ? f : { ...f, properties: { ...props, cartier } };
    }),
  };
}

export function neighborhoodInfo(input: NeighborhoodInfoInput): NeighborhoodInfo | null {
  const polys = neighborhoodsFromCollection(input.neighborhoods);
  const poly = polys.find((p) => p.slug === input.slug);
  if (!poly) return null;

  const streets = {
    segments: 0,
    names: 0,
    km: 0,
    bikeSafeKm: 0,
    bikeDoorKm: 0,
    illegalKm: 0,
    reservedKm: 0,
    schoolAssigned: 0,
  };
  const coverage = { measuredSegments: 0, totalSegments: 0, measuredKm: 0, totalKm: 0, withWidths: 0, edited: 0 };
  const names = new Set<string>();
  let totalM = 0;
  let bikeSafeM = 0;
  let bikeDoorM = 0;
  let illegalM = 0;
  let reservedM = 0;
  let measuredM = 0;

  for (const f of input.streets?.features || []) {
    const props = (f.properties || {}) as Record<string, unknown>;
    if (String(props.cartier || "") !== input.slug) continue;
    const sid = String(props.sid || "");
    const m = resolveStreetMeasurement(sid, props, input.measurements, input.seedMeasurements);
    const len = featureLengthMeters(f);
    streets.segments += 1;
    totalM += len;
    const name = String(props.name || "").trim();
    if (name) names.add(name.toLowerCase());
    if (streetHasSafeBikeLane(props, m)) bikeSafeM += len;
    if (streetHasDoorZoneBikeLane(props, m)) bikeDoorM += len;
    if (streetHasIllegalParking(props, m)) illegalM += len;
    if (featureHasReservedParking(props)) reservedM += len;
    if (streetSchoolSlugs(props).length) streets.schoolAssigned += 1;

    coverage.totalSegments += 1;
    coverage.totalKm += len;
    if (streetHasSurveyedAttributes(props, m)) {
      coverage.measuredSegments += 1;
      measuredM += len;
    }
    if (spaceShares(m)) coverage.withWidths += 1;
    if (input.measurements[sid]?.source === "local") coverage.edited += 1;
  }
  streets.names = names.size;
  streets.km = km(totalM);
  streets.bikeSafeKm = km(bikeSafeM);
  streets.bikeDoorKm = km(bikeDoorM);
  streets.illegalKm = km(illegalM);
  streets.reservedKm = km(reservedM);
  coverage.totalKm = km(totalM);
  coverage.measuredKm = km(measuredM);

  const schools: { slug: string; name: string }[] = [];
  for (const f of input.schools?.features || []) {
    if (!f.geometry || f.geometry.type !== "Point") continue;
    const p = (f.properties || {}) as { slug?: string; denumire?: string; name?: string };
    const slug = String(p.slug || "");
    if (!slug) continue;
    if (!pointInPolygon(f.geometry.coordinates as LngLat, poly.geometry)) continue;
    schools.push({ slug, name: String(p.denumire || p.name || slug) });
  }
  schools.sort((a, b) => a.name.localeCompare(b.name, "ro"));

  let buildings: NeighborhoodInfo["buildings"] = null;
  if (input.buildings) {
    assignBuildings(input.buildings, polys);
    const byType = Object.fromEntries(BUILDING_TYPES.map((t) => [t, 0])) as Record<BuildingType, number>;
    let total = 0;
    for (const f of input.buildings.features) {
      const props = (f.properties || {}) as { bid?: string; ubr_type?: string };
      if (buildingCartier.get(String(props.bid || "")) !== input.slug) continue;
      byType[coerceBuildingType(props.ubr_type)] += 1;
      total += 1;
    }
    buildings = { total, byType };
  }

  return { slug: input.slug, name: poly.name, streets, schools, buildings, coverage };
}
