import { describe, expect, it } from "vitest";
import {
  applyStreetSplits,
  computePieces,
  featureLines,
  orderSplits,
  parseStreetSplitsFile,
  pieceSid,
  planSplitChange,
  pointKey,
  projectOnLines,
  rootSid,
  serializeStreetSplitsFile,
  splitFeature,
  type SplitPoint,
} from "./streetSplits";
import { geometryLengthMeters } from "./space";

/** 100 m est la 45.8°N. */
const DLNG = 100 / (111320 * Math.cos((45.8 * Math.PI) / 180));

function street(sid = "st_a", n = 5): GeoJSON.Feature {
  const coordinates: [number, number][] = [];
  for (let i = 0; i < n; i++) coordinates.push([24.15 + i * DLNG, 45.8]);
  return { type: "Feature", properties: { sid, name: "Strada X", cartier: "centru", length: 999 }, geometry: { type: "LineString", coordinates } };
}

const at = (meters: number): SplitPoint => [24.15 + (meters / 100) * DLNG, 45.8];

describe("street ids", () => {
  it("roots and piece ids are stable and reversible", () => {
    const p = at(150);
    expect(pieceSid("st_a", null)).toBe("st_a");
    const id = pieceSid("st_a", p);
    expect(id.startsWith("st_a:s")).toBe(true);
    expect(rootSid(id)).toBe("st_a");
    expect(rootSid("st_a")).toBe("st_a");
    expect(/^[A-Za-z0-9_.:-]+$/.test(id)).toBe(true);
    expect(pointKey(p)).toBe(pointKey([p[0], p[1]]));
  });
});

describe("projection", () => {
  it("projects a click onto the line and reports the distance along", () => {
    const lines = featureLines(street().geometry);
    const hit = projectOnLines(lines, [at(230)[0], 45.8 + 5 / 111320]);
    expect(hit).not.toBeNull();
    expect(hit!.along).toBeGreaterThan(228);
    expect(hit!.along).toBeLessThan(232);
    expect(hit!.distM).toBeGreaterThan(4);
    expect(hit!.distM).toBeLessThan(6);
    expect(hit!.point[1]).toBeCloseTo(45.8, 5);
  });
});

describe("ordering", () => {
  it("sorts, drops points at the ends, duplicates and near-duplicates", () => {
    const lines = featureLines(street().geometry); // 400 m
    const ordered = orderSplits(lines, [at(300), at(100), at(1), at(399.5), at(101), at(100)]);
    expect(ordered.map((o) => Math.round(o.along))).toEqual([100, 300]);
  });

  it("ignores points far from the street", () => {
    const lines = featureLines(street().geometry);
    const far: SplitPoint = [24.15 + DLNG, 45.8 + 200 / 111320];
    expect(orderSplits(lines, [far])).toEqual([]);
  });
});

describe("splitFeature", () => {
  it("cuts a street in three and keeps the first sid", () => {
    const f = street();
    const pieces = splitFeature(f, [at(300), at(120)]);
    expect(pieces).toHaveLength(3);
    const sids = pieces.map((p) => String(p.properties?.sid));
    expect(sids[0]).toBe("st_a");
    expect(new Set(sids).size).toBe(3);
    expect(pieces.map((p) => p.properties?.split_root)).toEqual(["st_a", "st_a", "st_a"]);
    const lens = pieces.map((p) => geometryLengthMeters(p.geometry));
    expect(lens[0]).toBeCloseTo(120, 0);
    expect(lens[1]).toBeCloseTo(180, 0);
    expect(lens[2]).toBeCloseTo(100, 0);
    expect(lens.reduce((a, b) => a + b, 0)).toBeCloseTo(400, 0);
    // lungimea din props e pe bucată, nu a străzii întregi
    expect(pieces.map((p) => Math.round(Number(p.properties?.length_m)))).toEqual(lens.map((l) => Math.round(l)));
    expect(pieces.every((p) => p.properties?.length === undefined)).toBe(true);
    expect(pieces.every((p) => p.properties?.name === "Strada X")).toBe(true);
  });

  it("piece ids do not shift when another split is added later", () => {
    const f = street();
    const before = splitFeature(f, [at(300)]).map((p) => String(p.properties?.sid));
    const after = splitFeature(f, [at(300), at(100)]).map((p) => String(p.properties?.sid));
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(3);
    // piesa care începe la 300 m își păstrează sid-ul, chiar dacă acum e a treia
    expect(after).toContain(before[1]);
    expect(after[0]).toBe("st_a");
  });

  it("returns the same feature when there is nothing to cut", () => {
    const f = street();
    expect(splitFeature(f, [])).toEqual([f]);
    expect(splitFeature(f, [at(0.5)])[0]).toBe(f);
  });

  it("handles MultiLineString streets", () => {
    const f: GeoJSON.Feature = {
      type: "Feature",
      properties: { sid: "st_m" },
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [24.15, 45.8],
            [24.15 + DLNG, 45.8],
          ],
          [
            [24.15 + 2 * DLNG, 45.8],
            [24.15 + 3 * DLNG, 45.8],
          ],
        ],
      },
    };
    // 250 m e la jumătatea celei de-a doua linii → 100 + 50 m parcurși
    const pieces = computePieces("st_m", f.geometry, [at(250)]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0].lengthM).toBeCloseTo(100 + 50, 0);
    expect(pieces[1].lengthM).toBeCloseTo(50, 0);
  });
});

describe("planSplitChange", () => {
  it("new pieces inherit from the piece they were cut out of; merged pieces are removed", () => {
    const g = street().geometry;
    const first = planSplitChange("st_a", g, [], [at(300)]);
    expect(first.removed).toEqual([]);
    expect(first.inherit).toEqual({ [pieceSid("st_a", at(300))]: "st_a" });

    // taie bucata [300, 400] în două → noua bucată vine din bucata care începe la 300
    const second = planSplitChange("st_a", g, [at(300)], [at(300), at(350)]);
    expect(second.inherit).toEqual({ [pieceSid("st_a", at(350))]: pieceSid("st_a", at(300)) });

    // taie bucata inițială înaintea lui 300 → noua bucată vine din rădăcină
    const third = planSplitChange("st_a", g, [at(300)], [at(300), at(100)]);
    expect(third.inherit).toEqual({ [pieceSid("st_a", at(100))]: "st_a" });

    // scoate punctul de la 300 → bucata lui dispare
    const merged = planSplitChange("st_a", g, [at(100), at(300)], [at(100)]);
    expect(merged.removed).toEqual([pieceSid("st_a", at(300))]);
    expect(merged.inherit).toEqual({});
  });
});

describe("applyStreetSplits", () => {
  it("replaces only the split streets, leaves the rest by reference", () => {
    const a = street("st_a");
    const b = street("st_b");
    const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [a, b] };
    const out = applyStreetSplits(fc, { st_a: [at(200)] });
    expect(out.features).toHaveLength(3);
    expect(out.features[2]).toBe(b);
    expect(applyStreetSplits(fc, {})).toBe(fc);
    expect(applyStreetSplits(fc, { st_missing: [at(200)] })).toBe(fc);
  });
});

describe("splits file", () => {
  it("drops junk and round-trips", () => {
    const parsed = parseStreetSplitsFile({
      version: 1,
      splits: {
        st_a: [[24.1, 45.8], [24.1, 45.8], ["x", 1], [500, 1], [24.2, 45.81]],
        __proto__: [[1, 1]],
        "st_a:s1": [[1, 1]],
        st_empty: [],
        st_bad: "nope",
      },
    });
    expect(Object.keys(parsed.splits)).toEqual(["st_a"]);
    expect(parsed.splits.st_a).toEqual([
      [24.1, 45.8],
      [24.2, 45.81],
    ]);
    const round = parseStreetSplitsFile(JSON.parse(serializeStreetSplitsFile(parsed)));
    expect(round.splits).toEqual(parsed.splits);
  });
});
