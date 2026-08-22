import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeSheetRecords, recordsBySlugMap, uniquifyRecords } from "./sheetTransform";
import {
  detectFixDrift,
  deriveStreetFixes,
  emptyStreetFixes,
  parseStreetFixesFile,
  serializeStreetFixesFile,
  snapshotBaselines,
  type FixableStreet,
  type StreetFixesFile,
} from "./streetFixes";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = join(root, "src/lib/fixtures/sheets");
const streetFixesPath = join(root, "public/data/street-fixes.json");

function readFixture(name: string) {
  return readFileSync(join(fixtures, `${name}.csv`), "utf8");
}

function loadStreetFixes(): StreetFixesFile {
  return parseStreetFixesFile(JSON.parse(readFileSync(streetFixesPath, "utf8")));
}

const FIXTURE_PARTS = [
  { neighborhoodSlug: "trei_stejari", text: readFixture("trei_stejari") },
  { neighborhoodSlug: "dumbravii", text: readFixture("dumbravii") },
  { neighborhoodSlug: "lupeni", text: readFixture("lupeni") },
  { neighborhoodSlug: "lazaret", text: readFixture("lazaret") },
  { neighborhoodSlug: "strand2", text: readFixture("strand2") },
  { neighborhoodSlug: "terezian", text: readFixture("terezian") },
  { neighborhoodSlug: "valea_aurie", text: readFixture("valea_aurie") },
  { neighborhoodSlug: "hipodrom", text: readFixture("hipodrom1") },
  { neighborhoodSlug: "hipodrom", text: readFixture("hipodrom2") },
  { neighborhoodSlug: "hipodrom", text: readFixture("hipodrom3") },
  { neighborhoodSlug: "hipodrom", text: readFixture("hipodrom4") },
];

function fixtureRecords() {
  return recordsBySlugMap(mergeSheetRecords(FIXTURE_PARTS, loadStreetFixes()));
}

function street(partial: Partial<FixableStreet> & Pick<FixableStreet, "uniqueKey" | "sheetName">): FixableStreet {
  const sheetCells = partial.sheetCells || { Nume: partial.sheetName, "Latime trama stradala": "10" };
  return {
    uniqueKey: partial.uniqueKey,
    baseKey: partial.baseKey || partial.uniqueKey.replace(/#\d+$/, ""),
    sheetName: partial.sheetName,
    displayName: partial.displayName ?? partial.sheetName,
    sheetCells,
    cells: partial.cells || { ...sheetCells, Nume: partial.displayName ?? partial.sheetName },
    omitted: partial.omitted ?? false,
  };
}

describe("street fix keys", () => {
  it("uniquifies duplicate sheet names", () => {
    const [a, b] = uniquifyRecords([
      { baseKey: "cernei", sheetName: "Cernei", sheetCells: { Nume: "Cernei" } },
      { baseKey: "cernei", sheetName: "Cernei", sheetCells: { Nume: "Cernei" } },
    ]);
    expect(a.uniqueKey).toBe("cernei");
    expect(b.uniqueKey).toBe("cernei#2");
  });
});

describe("detectFixDrift", () => {
  it("ignores fixes without a baseline", () => {
    const fixes = parseStreetFixesFile({
      version: 1,
      renames: { trei_stejari: { hegel: "Georg Wilhelm Friedrich Hegel" } },
    });
    const drift = detectFixDrift(
      { trei_stejari: [street({ uniqueKey: "hegel", sheetName: "Hegel X", displayName: "Georg Wilhelm Friedrich Hegel" })] },
      fixes
    );
    expect(drift).toEqual([]);
  });

  it("warns when the sheet name under a fix changes", () => {
    const fixes = parseStreetFixesFile({
      version: 1,
      renames: { trei_stejari: { hegel: "Georg Wilhelm Friedrich Hegel" } },
      baselines: {
        trei_stejari: { hegel: { sheetName: "Hegel", widths: { "Latime trama stradala": "13.9" } } },
      },
    });
    const drift = detectFixDrift(
      {
        trei_stejari: [
          street({
            uniqueKey: "hegel",
            sheetName: "Hegel Nord",
            displayName: "Georg Wilhelm Friedrich Hegel",
            sheetCells: { Nume: "Hegel Nord", "Latime trama stradala": "13.9" },
          }),
        ],
      },
      fixes
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ kind: "stale", slug: "trei_stejari", fixKey: "hegel" });
  });

  it("warns when sheet widths under a fix change", () => {
    const fixes = parseStreetFixesFile({
      version: 1,
      widths: { dumbravii: { calea_dumbravii: { bike1_m: 2.5 } } },
      baselines: {
        dumbravii: { calea_dumbravii: { sheetName: "Calea Dumbravii", widths: { "Latime pista biciclete 1": "" } } },
      },
    });
    const drift = detectFixDrift(
      {
        dumbravii: [
          street({
            uniqueKey: "calea_dumbravii",
            sheetName: "Calea Dumbravii",
            sheetCells: { Nume: "Calea Dumbravii", "Latime pista biciclete 1": "3" },
            cells: { Nume: "Calea Dumbravii", "Latime pista biciclete 1": "2.5" },
          }),
        ],
      },
      fixes
    );
    expect(drift[0]?.kind).toBe("stale");
    expect(drift[0]?.detail).toMatch(/lățimi/i);
  });

  it("warns when a fixed street disappears from the sheet", () => {
    const fixes = parseStreetFixesFile({
      version: 1,
      renames: { trei_stejari: { hegel: "Georg Wilhelm Friedrich Hegel" } },
    });
    const drift = detectFixDrift({ trei_stejari: [] }, fixes);
    expect(drift).toEqual([
      expect.objectContaining({ kind: "orphan", fixKey: "hegel", slug: "trei_stejari" }),
    ]);
  });
});

describe("deriveStreetFixes", () => {
  it("stores rename, omit, width override and a baseline", () => {
    const recs = {
      trei_stejari: [
        street({
          uniqueKey: "hegel",
          sheetName: "Hegel",
          displayName: "Georg Wilhelm Friedrich Hegel",
          sheetCells: { Nume: "Hegel", "Latime trama stradala": "13.9" },
          cells: { Nume: "Georg Wilhelm Friedrich Hegel", "Latime trama stradala": "13.9" },
        }),
        street({
          uniqueKey: "fabricii",
          sheetName: "Fabricii",
          omitted: true,
          sheetCells: { Nume: "Fabricii", "Latime trama stradala": "0" },
          cells: { Nume: "Fabricii", "Latime trama stradala": "0" },
        }),
        street({
          uniqueKey: "negoi_2",
          sheetName: "Negoi 2",
          sheetCells: { Nume: "Negoi 2", "Latime trama stradala": "9.4" },
          cells: { Nume: "Negoi 2", "Latime trama stradala": "" },
        }),
      ],
    };
    const next = deriveStreetFixes(recs, emptyStreetFixes());
    expect(next.renames.trei_stejari.hegel).toBe("Georg Wilhelm Friedrich Hegel");
    expect(next.omit.trei_stejari).toContain("fabricii");
    expect(next.widths.trei_stejari.negoi_2).toEqual({ row_width_m: null });
    expect(next.baselines.trei_stejari.hegel.sheetName).toBe("Hegel");
    expect(next.baselines.trei_stejari.negoi_2.widths["Latime trama stradala"]).toBe("9.4");
  });

  it("keeps orphan fixes from the previous file", () => {
    const previous = parseStreetFixesFile({
      version: 1,
      renames: { lupeni: { vanished: "Gone" } },
      baselines: { lupeni: { vanished: { sheetName: "Vanished", widths: {} } } },
    });
    const next = deriveStreetFixes({ lupeni: [street({ uniqueKey: "ciocarliei", sheetName: "Ciocarliei" })] }, previous);
    expect(next.renames.lupeni.vanished).toBe("Gone");
    expect(next.baselines.lupeni.vanished.sheetName).toBe("Vanished");
  });
});

describe("committed street-fixes baselines", () => {
  it("match the current sheet fixtures (no stale/orphan drift)", () => {
    const fixes = loadStreetFixes();
    const drift = detectFixDrift(fixtureRecords(), fixes);
    expect(drift).toEqual([]);
  });

  it("refreshes baselines from fixtures when UPDATE_STREET_FIX_BASELINES=1", () => {
    if (process.env.UPDATE_STREET_FIX_BASELINES !== "1") return;
    const filled = snapshotBaselines(fixtureRecords(), loadStreetFixes());
    writeFileSync(streetFixesPath, serializeStreetFixesFile(filled));
    expect(detectFixDrift(fixtureRecords(), filled)).toEqual([]);
  });
});
