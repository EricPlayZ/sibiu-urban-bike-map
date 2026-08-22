import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { csvRowsToMeasurements } from "./csvImport";
import {
  cleanSheetStreetName,
  diffAgainstGoldenCsv,
  fixKey,
  leadingNamesFromHeader,
  mergeSheetRecords,
  mergeSheetTabs,
  romanStreetSuffix,
  serializeSheetTable,
} from "./sheetTransform";
import { parseStreetFixesFile, type StreetFixesFile } from "./streetFixes";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = join(root, "src/lib/fixtures/sheets");
const goldenDir = join(root, "public/data/measurements");
const streetFixesPath = join(root, "public/data/street-fixes.json");

function readFixture(name: string) {
  return readFileSync(join(fixtures, `${name}.csv`), "utf8");
}

function readGolden(slug: string) {
  return readFileSync(join(goldenDir, `${slug}.csv`), "utf8");
}

export function loadStreetFixes(): StreetFixesFile {
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

function tableFor(slug: string, sheets: string[]) {
  const [table] = mergeSheetTabs(
    sheets.map((s) => ({ neighborhoodSlug: slug, text: readFixture(s) })),
    loadStreetFixes()
  );
  return table;
}

describe("sheet name cleanup", () => {
  it("strips stars, roman suffixes and (V) tags", () => {
    expect(cleanSheetStreetName("Diaconu Coresi*")).toBe("Diaconu Coresi");
    expect(romanStreetSuffix("Calea Dumbravii II")).toBe("Calea Dumbravii 2");
    expect(cleanSheetStreetName("Rahovei 2 (intre blocuri)")).toBe("Rahovei 2");
    expect(cleanSheetStreetName("Ludos (V)")).toBe("Ludos");
    expect(fixKey("Aleea Artiileristilor")).toBe("aleea_artiileristilor");
  });

  it("pulls Aleea Petuniei out of the Terezian header cell", () => {
    expect(leadingNamesFromHeader("Numele străzii Aleea Petuniei")).toEqual(["Aleea Petuniei"]);
    expect(leadingNamesFromHeader("Numele străzii")).toEqual([]);
  });
});

describe("Google Sheets transform vs existing neighborhood CSVs", () => {
  const cases: { slug: string; sheets: string[] }[] = [
    { slug: "trei_stejari", sheets: ["trei_stejari"] },
    { slug: "dumbravii", sheets: ["dumbravii"] },
    { slug: "lupeni", sheets: ["lupeni"] },
    { slug: "lazaret", sheets: ["lazaret"] },
    { slug: "strand2", sheets: ["strand2"] },
    { slug: "terezian", sheets: ["terezian"] },
    { slug: "valea_aurie", sheets: ["valea_aurie"] },
    { slug: "hipodrom", sheets: ["hipodrom1", "hipodrom2"] },
  ];

  it.each(cases)("$slug matches golden CSV names and widths exactly", ({ slug, sheets }) => {
    const table = tableFor(slug, sheets);
    const diff = diffAgainstGoldenCsv(table, readGolden(slug));
    expect({ extra: diff.extra, missing: diff.missing, values: diff.values }).toEqual({ extra: [], missing: [], values: [] });
  });

  it("merges Hipodrom I–IV into hipodrom and keeps I+II equal to the golden CSV", () => {
    const iIi = tableFor("hipodrom", ["hipodrom1", "hipodrom2"]);
    const all = tableFor("hipodrom", ["hipodrom1", "hipodrom2", "hipodrom3", "hipodrom4"]);
    expect(diffAgainstGoldenCsv(iIi, readGolden("hipodrom"))).toMatchObject({ extra: [], missing: [], values: [] });
    expect(all.rows.map((r) => r.Nume)).toEqual(iIi.rows.map((r) => r.Nume));
    expect(serializeSheetTable(all)).toContain("Zona verde intre benzi");
    const mihai = all.rows.find((r) => r.Nume === "Bulevardul Mihai Viteazul");
    expect(mihai?.["Zona verde intre benzi"]).toBe("5.2");
  });

  it("parsed measurements for Dumbrăvii Aleea Calaretilor stay on side 2", () => {
    const table = tableFor("dumbravii", ["dumbravii"]);
    const { rows } = csvRowsToMeasurements(serializeSheetTable(table));
    expect(rows.find((r) => r.name === "Aleea Calaretilor")).toMatchObject({
      sidewalk1_m: 1.7,
      parking2_m: 2.4,
      free_sidewalk2_m: 0.7,
      bike1_m: 2.2,
    });
  });
});

describe("street-fixes.json", () => {
  it("applies Hegel rename from the editable file, not hardcoded maps", () => {
    const withFixes = tableFor("trei_stejari", ["trei_stejari"]);
    const without = mergeSheetTabs([{ neighborhoodSlug: "trei_stejari", text: readFixture("trei_stejari") }])[0];
    expect(withFixes.rows.some((r) => r.Nume === "Georg Wilhelm Friedrich Hegel")).toBe(true);
    expect(without.rows.some((r) => r.Nume === "Hegel")).toBe(true);
    expect(without.rows.some((r) => r.Nume === "Georg Wilhelm Friedrich Hegel")).toBe(false);
  });

  it("keeps omitted Fabricii out of the processed table but in editor records", () => {
    const table = tableFor("trei_stejari", ["trei_stejari"]);
    expect(table.rows.some((r) => r.Nume === "Fabricii")).toBe(false);
    const group = mergeSheetRecords([{ neighborhoodSlug: "trei_stejari", text: readFixture("trei_stejari") }], loadStreetFixes())[0];
    const fabricii = group.records.find((r) => r.baseKey === "fabricii");
    expect(fabricii?.omitted).toBe(true);
    expect(fabricii?.sheetName).toBe("Fabricii");
  });
});
