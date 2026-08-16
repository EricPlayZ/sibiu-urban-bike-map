import { describe, expect, it } from "vitest";
import {
  applyLocalEditsToCollection,
  mergeWorkingEdits,
  parseLocalEditsFile,
  serializeLocalEditsFile,
} from "./localEdits";
import { lookupKey, resolveStreetMeasurement, type Measurement } from "./space";

const STREET = "Strada Exemplu";

function csvFeature(sid: string, extra?: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: {
      sid,
      name: STREET,
      cartier: "hipodrom",
      bike_lane: 1,
      bike_door: 0,
      rsrvd_park: 0,
      illgl_park: 0,
      bike1_m: 1.5,
      carriageway_m: 7,
      sidewalk1_m: 2,
      ...extra,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [24.15, 45.79],
        [24.16, 45.79],
      ],
    },
  };
}

const csvSeed: Measurement = {
  name: STREET,
  neighborhood_slug: "hipodrom",
  bike1_m: 1.5,
  carriageway_m: 7,
  sidewalk1_m: 2,
  source: "csv",
};

describe("local edits overlay", () => {
  it("parses wrapped and bare sid maps", () => {
    const wrapped = parseLocalEditsFile({
      version: 1,
      edits: { st_a: { carriageway_m: 5, source: "local" } },
    });
    expect(wrapped.st_a?.carriageway_m).toBe(5);

    const bare = parseLocalEditsFile({ st_b: { bike1_m: 2, name: "X" } });
    expect(bare.st_b?.bike1_m).toBe(2);
    expect(bare.st_b?.source).toBe("local");
    expect(bare.st_b?.street_id).toBe("st_b");
  });

  it("lets a draft override a committed sid and honors removals", () => {
    const committed = { st_a: { carriageway_m: 6, source: "local" } satisfies Measurement };
    const drafts = { st_a: { carriageway_m: 4, source: "local" } satisfies Measurement };
    const merged = mergeWorkingEdits(committed, drafts);
    expect(merged.st_a.carriageway_m).toBe(4);

    const dropped = mergeWorkingEdits(committed, {}, ["st_a"]);
    expect(dropped.st_a).toBeUndefined();
  });

  it("after CSV on both segments, a local edit overrides only that sid", () => {
    const sidKeep = "st_hipodrom_exemplu_a";
    const sidEdit = "st_hipodrom_exemplu_b";
    const afterCsv: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [csvFeature(sidKeep), csvFeature(sidEdit)],
    };
    const seed = { [lookupKey("hipodrom", STREET)]: csvSeed };

    const localEdit: Measurement = {
      name: STREET,
      neighborhood_slug: "hipodrom",
      carriageway_m: 4,
      sidewalk1_m: 2.4,
      source: "local",
    };
    const working = mergeWorkingEdits({}, { [sidEdit]: localEdit });
    const afterLocal = applyLocalEditsToCollection(afterCsv, working);

    const keep = afterLocal.features.find((f) => (f.properties as { sid: string }).sid === sidKeep)!;
    const edited = afterLocal.features.find((f) => (f.properties as { sid: string }).sid === sidEdit)!;
    const keepP = keep.properties as Record<string, unknown>;
    const editP = edited.properties as Record<string, unknown>;
    const csvEditP = afterCsv.features[1].properties as Record<string, unknown>;

    expect(csvEditP.bike_lane).toBe(1);
    expect(csvEditP.bike1_m).toBe(1.5);

    expect(keepP.bike_lane).toBe(1);
    expect(keepP.bike1_m).toBe(1.5);
    expect(keepP.carriageway_m).toBe(7);
    expect(keepP.local_edit).toBeUndefined();

    expect(editP.bike_lane).toBe(0);
    expect(editP.bike1_m).toBeUndefined();
    expect(editP.carriageway_m).toBe(4);
    expect(editP.sidewalk1_m).toBe(2.4);
    expect(editP.local_edit).toBe(1);

    const mKeep = resolveStreetMeasurement(sidKeep, keepP, working, seed);
    const mEdit = resolveStreetMeasurement(sidEdit, editP, working, seed);
    expect(mKeep.bike1_m).toBe(1.5);
    expect(mKeep.carriageway_m).toBe(7);
    expect(mEdit.bike1_m).toBeUndefined();
    expect(mEdit.carriageway_m).toBe(4);
    expect(mEdit.source).toBe("local");
    expect(resolveStreetMeasurement(sidEdit, csvEditP, working, seed).bike1_m).toBeUndefined();
  });

  it("keeps an explicit local save even when all widths are 0 (clears CSV on that sid)", () => {
    const sid = "st_clear_me";
    const afterCsv: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [csvFeature(sid)],
    };
    const seed = { [lookupKey("hipodrom", STREET)]: csvSeed };
    const cleared: Measurement = { name: STREET, source: "local", carriageway_m: 0, bike1_m: 0 };
    const working = mergeWorkingEdits({}, { [sid]: cleared });
    expect(working[sid]?.source).toBe("local");

    const afterLocal = applyLocalEditsToCollection(afterCsv, working);
    const p = afterLocal.features[0].properties as Record<string, unknown>;
    expect(p.local_edit).toBe(1);
    expect(p.bike_lane).toBe(0);
    expect(p.carriageway_m).toBe(0);

    const resolved = resolveStreetMeasurement(sid, p, working, seed);
    expect(resolved.source).toBe("local");
    expect(resolved.carriageway_m).toBe(0);
    expect(resolved.bike1_m).toBe(0);
  });

  it("serializes explicit local saves, including empty overrides", () => {
    const json = serializeLocalEditsFile({
      st_keep: { carriageway_m: 5, name: "A", source: "local" },
      st_empty: { source: "local" },
    });
    const parsed = JSON.parse(json) as { version: number; edits: Record<string, Measurement> };
    expect(parsed.version).toBe(1);
    expect(parsed.edits.st_keep.carriageway_m).toBe(5);
    expect(parsed.edits.st_empty.source).toBe("local");
    expect(parsed.edits.st_empty.street_id).toBe("st_empty");
  });
});
