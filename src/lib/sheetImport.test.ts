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
  mergeSheetTabs,
  romanStreetSuffix,
  serializeSheetTable,
} from "./sheetTransform";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = join(root, "src/lib/fixtures/sheets");
const goldenDir = join(root, "public/data/measurements");

function readFixture(name: string) {
  return readFileSync(join(fixtures, `${name}.csv`), "utf8");
}

function readGolden(slug: string) {
  return readFileSync(join(goldenDir, `${slug}.csv`), "utf8");
}

function tableFor(slug: string, sheets: string[]) {
  const [table] = mergeSheetTabs(sheets.map((s) => ({ neighborhoodSlug: slug, text: readFixture(s) })));
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

  it.each(cases)("$slug matches golden CSV names and widths", ({ slug, sheets }) => {
    const table = tableFor(slug, sheets);
    const diff = diffAgainstGoldenCsv(table, readGolden(slug));
    const knownValues =
      slug === "strand2"
        ? [{ name: "Mehedinti", field: "Latime parcare 2", got: "5.1", gold: "510" }]
        : [];
    expect({ extra: diff.extra, missing: diff.missing }).toEqual({ extra: [], missing: [] });
    expect(diff.values).toEqual(knownValues);
  });

  it("merges Hipodrom I–IV into hipodrom and keeps I+II equal to the golden CSV", () => {
    const iIi = tableFor("hipodrom", ["hipodrom1", "hipodrom2"]);
    const all = tableFor("hipodrom", ["hipodrom1", "hipodrom2", "hipodrom3", "hipodrom4"]);
    expect(diffAgainstGoldenCsv(iIi, readGolden("hipodrom"))).toMatchObject({ extra: [], missing: [] });
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
