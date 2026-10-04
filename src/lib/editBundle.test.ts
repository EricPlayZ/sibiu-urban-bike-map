import { describe, expect, it } from "vitest";
import {
  EDIT_BUNDLE_KIND,
  EDIT_BUNDLE_VERSION,
  buildEditBundle,
  classifyEditBundle,
  countSavedEdits,
  formatEditDiff,
  parseEditBundle,
  splitImportRemovesPoints,
} from "./editBundle";
import type { Measurement } from "./space";

const m = (over: Partial<Measurement> = {}): Measurement => ({
  carriageway_m: 6,
  source: "local",
  ...over,
});

describe("editBundle", () => {
  it("rejects bad version and invalid split roots", () => {
    expect(
      parseEditBundle({
        kind: EDIT_BUNDLE_KIND,
        version: EDIT_BUNDLE_VERSION,
        exported_at: "2020-01-01T00:00:00.000Z",
        streets: {},
        buildings: {},
        splits: { "st_a:piece": [[24, 45]] },
        streetFixes: null,
      }).ok
    ).toBe(false);

    expect(parseEditBundle({ kind: "other", version: 1, streets: {}, buildings: {}, splits: {} }).ok).toBe(false);
    expect(parseEditBundle({ kind: EDIT_BUNDLE_KIND, version: 99, streets: {}, buildings: {}, splits: {} }).ok).toBe(
      false
    );
  });

  it("classifies same, add, and replace", () => {
    const bundle = buildEditBundle({
      streets: { st_a: m({ carriageway_m: 7 }), st_new: m({ bike1_m: 2 }) },
      buildings: { b_1: "casa" },
      splits: { st_root: [[24.1, 45.8]] },
    });
    const server = {
      streets: { st_a: m({ carriageway_m: 7 }), st_b: m({ bike1_m: 1 }) },
      buildings: { b_1: "casa", b_2: "bloc" },
      splits: { st_root: [[24.1, 45.8]], st_other: [[24.2, 45.9]] },
    };
    const rows = classifyEditBundle(bundle, server);
    expect(rows.find((r) => r.id === "st_a")?.state).toBe("same");
    expect(rows.find((r) => r.id === "st_a")?.selected).toBe(false);
    expect(rows.find((r) => r.id === "b_1")?.state).toBe("same");
    expect(rows.filter((r) => r.state === "add").map((r) => r.id).sort()).toEqual(["st_new"]);

    const changed = buildEditBundle({
      streets: { st_a: m({ carriageway_m: 8 }) },
      buildings: { b_1: "bloc" },
      splits: {},
    });
    const rep = classifyEditBundle(changed, server);
    expect(rep.find((r) => r.id === "st_a")?.state).toBe("replace");
    expect(rep.find((r) => r.id === "st_a")?.selected).toBe(false);
    expect(rep.find((r) => r.id === "b_1")?.state).toBe("replace");
  });

  it("never lists server edits that are missing from the file", () => {
    const bundle = buildEditBundle({ streets: {}, buildings: {}, splits: {} });
    const server = {
      streets: { st_only: m() },
      buildings: { b_only: "casa" },
      splits: { st_x: [[24, 45] as [number, number]] },
    };
    const rows = classifyEditBundle(bundle, server);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain("st_only");
    expect(ids).not.toContain("b_only");
    expect(ids).not.toContain("st_x");
  });

  it("refuses an import split that would drop saved cut points", () => {
    const bundle = buildEditBundle({
      streets: {},
      buildings: {},
      splits: { st_root: [[24.1, 45.8]] },
    });
    const server = {
      streets: {},
      buildings: {},
      splits: { st_root: [[24.1, 45.8] as [number, number], [24.2, 45.9] as [number, number]] },
    };
    const row = classifyEditBundle(bundle, server).find((r) => r.id === "st_root");
    expect(splitImportRemovesPoints(server.splits.st_root, bundle.splits.st_root)).toBe(true);
    expect(row?.state).toBe("same");
    expect(row?.selected).toBe(false);
    expect(row?.detail).toContain("nu șterge");
  });

  it("counts streets, buildings, and splits together", () => {
    const counts = countSavedEdits(
      { st_a: m(), st_empty: {} },
      { b_1: "casa", b_2: "bloc" },
      { st_root: [[24.1, 45.8]], st_none: [] }
    );
    expect(counts).toEqual({ streets: 1, buildings: 2, splits: 1, total: 4 });
  });

  it("formats saved-edit lines without a wide arrow table", () => {
    expect(formatEditDiff({ label: "Carosabil (m)", oldVal: "—", newVal: "9.35" })).toBe("Carosabil: 9.35 m");
    expect(formatEditDiff({ label: "Nume", oldVal: "—", newVal: "Calea Dumbravii" })).toBe("Nume: — → Calea Dumbravii");
    expect(formatEditDiff({ label: "Carosabil (m)", oldVal: "8", newVal: "9.35" })).toBe("Carosabil: 8 m → 9.35 m");
    expect(formatEditDiff({ label: "Parcare ilegală", oldVal: "nu", newVal: "da" })).toBe("Parcare ilegală: nu → da");
  });
});
