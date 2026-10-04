import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bikeAllowed, bikeOneway, walkAllowed, type OsmWayTags } from "./routingAccess";
import {
  buildEngine,
  computeIsochrones,
  distM,
  routingFromLineCollection,
  sealReachGrid,
  type RoutingFile,
} from "./isochrone";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** 100 m east at 45.8°N. */
const DLNG = 100 / (111320 * Math.cos((45.8 * Math.PI) / 180));

function corridor(n = 21, highway = "residential"): RoutingFile {
  const nodes: number[] = [];
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push(24.15 + i * DLNG, 45.8);
    ids.push(i);
  }
  return { v: 1, nodes, ways: [{ n: ids, h: highway }] };
}

describe("routingAccess", () => {
  const road = (extra: Partial<OsmWayTags> = {}): OsmWayTags => ({ highway: "residential", ...extra });

  it("allows walking and cycling on residential streets", () => {
    expect(walkAllowed(road())).toBe(true);
    expect(bikeAllowed(road())).toBe(true);
  });

  it("keeps a private alley on the walk and bike network", () => {
    expect(walkAllowed(road({ highway: "service", access: "private" }))).toBe(true);
    expect(bikeAllowed(road({ highway: "service", access: "private" }))).toBe(true);
    expect(walkAllowed(road({ access: "no" }))).toBe(false);
    expect(bikeAllowed(road({ bicycle: "private" }))).toBe(false);
  });

  it("keeps footways walk-only unless tagged for bikes", () => {
    expect(walkAllowed({ highway: "footway" })).toBe(true);
    expect(bikeAllowed({ highway: "footway" })).toBe(false);
    expect(bikeAllowed({ highway: "footway", bicycle: "yes" })).toBe(true);
  });

  it("blocks motorways without an explicit foot/bike tag", () => {
    expect(walkAllowed({ highway: "motorway" })).toBe(false);
    expect(bikeAllowed({ highway: "motorway" })).toBe(false);
  });

  it("respects bicycle oneway, including opposite cycleways", () => {
    expect(bikeOneway(road({ oneway: "yes" }))).toBe(1);
    expect(bikeOneway(road({ oneway: "yes", onewayBicycle: "no" }))).toBe(0);
    expect(bikeOneway(road({ oneway: "yes", cycleway: "opposite" }))).toBe(0);
  });
});

describe("isochrone", () => {
  it("reaches farther by bike than on foot in the same time", () => {
    const engine = buildEngine(corridor());
    const origin = { lng: 24.15, lat: 45.8 };
    const walk = computeIsochrones(engine, origin, { profiles: ["walk"], minutes: [5], bufferM: 40 });
    const bike = computeIsochrones(engine, origin, { profiles: ["bike"], minutes: [5], bufferM: 40 });
    expect(walk.ok && bike.ok).toBe(true);
    if (!walk.ok || !bike.ok) return;
    const walkNet = walk.features.features.find((f) => f.properties?.kind === "net");
    const bikeNet = bike.features.features.find((f) => f.properties?.kind === "net");
    expect(walkNet?.geometry?.type).toBe("MultiLineString");
    expect(bikeNet?.geometry?.type).toBe("MultiLineString");
    const walkLen = netLengthM(walkNet!);
    const bikeLen = netLengthM(bikeNet!);
    expect(bikeLen).toBeGreaterThan(walkLen * 1.6);
    expect(walkLen).toBeGreaterThan(300);
    expect(walkLen).toBeLessThan(700);
  });

  it("builds nested 5/10/15 minute bands", () => {
    const engine = buildEngine(corridor(36));
    const out = computeIsochrones(engine, { lng: 24.15, lat: 45.8 }, { profiles: ["walk"] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const bands = out.features.features.filter((f) => f.properties?.kind === "band");
    expect(bands.map((f) => Number(f.properties?.minutes)).sort((a, b) => a - b)).toEqual([5, 10, 15]);
    for (const b of bands) {
      expect(b.geometry?.type === "Polygon" || b.geometry?.type === "MultiPolygon").toBe(true);
    }
  });

  it("does not send bikes onto an untagged footway", () => {
    const engine = buildEngine(corridor(12, "footway"));
    const origin = { lng: 24.15, lat: 45.8 };
    const walk = computeIsochrones(engine, origin, { profiles: ["walk"], minutes: [5] });
    const bike = computeIsochrones(engine, origin, { profiles: ["bike"], minutes: [5] });
    expect(walk.ok).toBe(true);
    expect(bike.ok).toBe(false);
  });

  it("does not snap to a tiny disconnected island when the main network is in range", () => {
    // Rețea principală: 5 km spre est. Insulă: 3 segmente de 100 m, la ~25 m nord de rețea, fără legătură.
    const main = corridor(51);
    const dLat = 25 / 111320;
    const nodes = main.nodes.slice();
    const base = nodes.length / 2;
    for (let i = 0; i < 4; i++) nodes.push(24.15 + (20 + i) * DLNG, 45.8 + dLat);
    const file: RoutingFile = {
      v: 1,
      nodes,
      ways: [...main.ways, { n: [base, base + 1, base + 2, base + 3], h: "residential" }],
    };
    const engine = buildEngine(file);
    for (const profile of ["walk", "bike"] as const) {
      const g = engine[profile];
      expect(g.segMain.filter((v) => v === 0).length).toBe(3);
    }
    const origin = { lng: 24.15 + 21.5 * DLNG, lat: 45.8 + dLat * 0.9 };
    const out = computeIsochrones(engine, origin, { profiles: ["walk"], minutes: [10], bufferM: 40 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const net = out.features.features.find((f) => f.properties?.kind === "net");
    // 10 min pe jos = ~830 m în fiecare direcție pe rețeaua principală; insula ar fi dat doar 300 m.
    expect(netLengthM(net!)).toBeGreaterThan(1200);
  });

  it("reaches the public network through a private alley", () => {
    const main = corridor(21);
    const nodes = main.nodes.slice();
    const join = 10;
    const spur = nodes.length / 2;
    nodes.push(24.15 + join * DLNG, 45.8 + 100 / 111320);
    nodes.push(24.15 + join * DLNG, 45.8 + 200 / 111320);
    const file: RoutingFile = {
      v: 1,
      nodes,
      ways: [
        ...main.ways,
        { n: [join, spur], h: "service", a: "private" },
        { n: [spur, spur + 1], h: "residential" },
      ],
    };
    const engine = buildEngine(file);
    const out = computeIsochrones(engine, { lng: nodes[spur * 2], lat: nodes[spur * 2 + 1] }, { profiles: ["bike"], minutes: [10] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const net = out.features.features.find((f) => f.properties?.kind === "net");
    expect(netLengthM(net!)).toBeGreaterThan(800);
  });

  it("still uses an island when nothing else is in range", () => {
    const island: RoutingFile = { v: 1, nodes: [24.15, 45.8, 24.15 + DLNG, 45.8], ways: [{ n: [0, 1], h: "residential" }] };
    const engine = buildEngine(island);
    expect(engine.walk.segMain[0]).toBe(1);
    const out = computeIsochrones(engine, { lng: 24.15, lat: 45.8 }, { profiles: ["walk"], minutes: [5] });
    expect(out.ok).toBe(true);
  });

  it("closes a one-cell staircase inlet in the raster", () => {
    const nx = 12;
    const ny = 12;
    const grid = new Uint8Array(nx * ny);
    grid.fill(1);
    const inlet: [number, number][] = [
      [0, 6],
      [1, 6],
      [1, 7],
      [2, 7],
      [2, 8],
      [3, 8],
    ];
    for (const [x, y] of inlet) grid[y * nx + x] = 0;
    sealReachGrid(grid, nx, ny);
    expect(grid[6 * nx + 1]).toBe(1);
    expect(grid[7 * nx + 2]).toBe(1);
    expect(grid[8 * nx + 3]).toBe(1);
  });

  it("converts line collections into a routing file", () => {
    const file = routingFromLineCollection({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { highway: "tertiary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [24.15, 45.8],
              [24.16, 45.8],
            ],
          },
        },
      ],
    });
    expect(file.ways).toHaveLength(1);
    expect(file.nodes.length).toBe(4);
  });
});

describe("Sibiu routing graph", () => {
  it("loads and can snap in the city centre", () => {
    const raw = JSON.parse(readFileSync(join(root, "public/data/routing-graph.json"), "utf8")) as RoutingFile;
    const engine = buildEngine(raw);
    expect(engine.walk.segs.length).toBeGreaterThan(4000);
    expect(engine.bike.segs.length).toBeGreaterThan(4000);
    const t0 = Date.now();
    const one = computeIsochrones(engine, { lng: 24.1516, lat: 45.7973 }, { profiles: ["walk"], minutes: [10] });
    const ms = Date.now() - t0;
    expect(one.ok).toBe(true);
    expect(ms).toBeLessThan(1500);
    if (!one.ok) return;
    expect(one.features.features.filter((f) => f.properties?.kind === "band")).toHaveLength(1);
  });

  it("gives Aleea Principală a city-scale bike reach instead of a tiny island", () => {
    const raw = JSON.parse(readFileSync(join(root, "public/data/routing-graph.json"), "utf8")) as RoutingFile;
    const engine = buildEngine(raw);
    const out = computeIsochrones(engine, { lng: 24.138142, lat: 45.770038 }, { profiles: ["bike"], minutes: [15] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const net = out.features.features.find((f) => f.properties?.kind === "net");
    expect(netLengthM(net!)).toBeGreaterThan(2000);
  });
});

function netLengthM(f: GeoJSON.Feature) {
  if (f.geometry?.type !== "MultiLineString") return 0;
  let n = 0;
  for (const line of f.geometry.coordinates) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      n += distM(a[0], a[1], b[0], b[1]);
    }
  }
  return n;
}
