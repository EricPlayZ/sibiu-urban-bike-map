import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  csvRowToMeasurement,
  csvRowsToMeasurements,
  deriveFlagsFromWidths,
  flagsFromRawRecord,
  mergeNumberedCsvStreets,
  normHeader,
  parseCsvText,
  parkingMarkMatchesFlags,
  serializeCsvText,
  type CsvStreetRow,
} from "./csvImport";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("CSV side columns", () => {
  it("keeps Dumbrăvii Aleea Calaretilor parking/free sidewalk on side 2", () => {
    const text = readFileSync(join(root, "public/data/measurements/dumbravii.csv"), "utf8");
    const { rows } = csvRowsToMeasurements(text);
    const raw = rows.find((r) => r.name === "Aleea Calaretilor");
    expect(raw).toMatchObject({
      row_width_m: 9,
      carriageway_m: 7,
      sidewalk1_m: 1.7,
      sidewalk2_m: undefined,
      parking1_m: undefined,
      parking2_m: 2.4,
      free_sidewalk1_m: undefined,
      free_sidewalk2_m: 0.7,
      bike1_m: 2.2,
    });

    const merged = mergeNumberedCsvStreets(rows).find((r) => r.name === "Aleea Calaretilor");
    expect(merged?.parking1_m).toBeUndefined();
    expect(merged?.parking2_m).toBe(2.4);
    expect(merged?.free_sidewalk1_m).toBeUndefined();
    expect(merged?.free_sidewalk2_m).toBe(0.7);
    expect(merged?.sidewalk1_m).toBe(1.7);
    expect(merged?.sidewalk2_m).toBeUndefined();
    expect(merged?.bike1_m).toBe(2.2);

    const m = csvRowToMeasurement(merged!, "dumbravii");
    expect(m.parking1_m).toBeUndefined();
    expect(m.parking2_m).toBe(2.4);
    expect(m.free_sidewalk1_m).toBeUndefined();
    expect(m.free_sidewalk2_m).toBe(0.7);

    const flags = deriveFlagsFromWidths(merged!);
    expect(flags.bike_lane).toBe(true);
    expect(flags.rsrvd_park).toBe(false);
    expect(flags.illgl_park).toBe(false);
  });

  it("does not copy a side-2-only parking width onto parking1", () => {
    const rows: CsvStreetRow[] = [
      { name: "Strada Test", parking2_m: 2.4, free_sidewalk2_m: 0.7, sidewalk1_m: 1.7 },
    ];
    const [out] = mergeNumberedCsvStreets(rows);
    expect(out.parking1_m).toBeUndefined();
    expect(out.parking2_m).toBe(2.4);
    expect(out.free_sidewalk1_m).toBeUndefined();
    expect(out.free_sidewalk2_m).toBe(0.7);
    expect(deriveFlagsFromWidths(out).illgl_park).toBe(false);
    expect(deriveFlagsFromWidths(out).rsrvd_park).toBe(false);
  });

  it("averages numbered CSV rows per side, not across left/right columns", () => {
    const rows: CsvStreetRow[] = [
      {
        name: "Egalitatii 1",
        sidewalk1_m: 1.5,
        sidewalk2_m: 2.1,
        parking2_m: 2,
        free_sidewalk1_m: 0.8,
        free_sidewalk2_m: 0.7,
      },
      {
        name: "Egalitatii 2",
        sidewalk1_m: 1.7,
        sidewalk2_m: 1.9,
        parking2_m: 2.4,
        free_sidewalk1_m: 1,
        free_sidewalk2_m: 0.5,
      },
    ];
    const [out] = mergeNumberedCsvStreets(rows);
    expect(out.name).toBe("Egalitatii");
    expect(out._mergedFrom).toBe(2);
    expect(out.sidewalk1_m).toBe(1.6);
    expect(out.sidewalk2_m).toBe(2);
    expect(out.parking1_m).toBeUndefined();
    expect(out.parking2_m).toBe(2.2);
    expect(out.free_sidewalk1_m).toBe(0.9);
    expect(out.free_sidewalk2_m).toBe(0.6);
    expect(deriveFlagsFromWidths(out).rsrvd_park).toBe(false);
  });

  it("treats parking or free sidewalk on either side as present for flags", () => {
    expect(deriveFlagsFromWidths({ name: "A", parking2_m: 2 }).rsrvd_park).toBe(true);
    expect(deriveFlagsFromWidths({ name: "A", free_sidewalk2_m: 0.7 }).illgl_park).toBe(true);
    expect(deriveFlagsFromWidths({ name: "A", bike2_m: 1.5 }).bike_lane).toBe(true);
    expect(deriveFlagsFromWidths({ name: "A", bike2_m: 1.5, parking1_m: 2 }).bike_door).toBe(true);
  });
});

describe("CSV round-trip + parking marks", () => {
  it("serializes extra columns (hipodrom zona verde între benzi) and round-trips cells", () => {
    const text = readFileSync(join(root, "public/data/measurements/hipodrom.csv"), "utf8");
    const parsed = parseCsvText(text);
    const extra = parsed.headers.find((h) => normHeader(h).includes("intre benzi"));
    expect(extra).toBeTruthy();
    const nameCol = parsed.headers[0];
    const mihai = parsed.rows.find((r) => r[nameCol] === "Bulevardul Mihai Viteazul");
    expect(mihai?.[extra!]).toBe("5.2");

    const out = serializeCsvText(parsed.headers, parsed.rows);
    const again = parseCsvText(out);
    expect(again.headers).toEqual(parsed.headers);
    expect(again.rows).toEqual(parsed.rows);
    expect(csvRowsToMeasurements(out).rows).toEqual(csvRowsToMeasurements(text).rows);
  });

  it("derives flags from raw cells and matches yellow/red/none marks", () => {
    const headers = ["Nume", "Latime parcare 1", "Zona libera trotuar 1"];
    const reserved = { Nume: "A", "Latime parcare 1": "2.4", "Zona libera trotuar 1": "" };
    const illegal = { Nume: "B", "Latime parcare 1": "", "Zona libera trotuar 1": "0.8" };
    const neither = { Nume: "C", "Latime parcare 1": "2", "Zona libera trotuar 1": "0.7" };
    const empty = { Nume: "D", "Latime parcare 1": "", "Zona libera trotuar 1": "" };

    expect(flagsFromRawRecord(headers, reserved)).toMatchObject({ rsrvd_park: true, illgl_park: false });
    expect(flagsFromRawRecord(headers, illegal)).toMatchObject({ rsrvd_park: false, illgl_park: true });
    expect(flagsFromRawRecord(headers, neither)).toMatchObject({ rsrvd_park: false, illgl_park: false });
    expect(flagsFromRawRecord(headers, empty)).toMatchObject({ rsrvd_park: false, illgl_park: false });

    expect(parkingMarkMatchesFlags("reserved", flagsFromRawRecord(headers, reserved))).toBe(true);
    expect(parkingMarkMatchesFlags("illegal", flagsFromRawRecord(headers, reserved))).toBe(false);
    expect(parkingMarkMatchesFlags("illegal", flagsFromRawRecord(headers, illegal))).toBe(true);
    expect(parkingMarkMatchesFlags("none", flagsFromRawRecord(headers, empty))).toBe(true);
    expect(parkingMarkMatchesFlags("none", flagsFromRawRecord(headers, illegal))).toBe(false);
    expect(parkingMarkMatchesFlags("reserved", flagsFromRawRecord(headers, neither))).toBe(false);
  });
});
