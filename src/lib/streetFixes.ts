/** Corecții editabile (OSM names / omit / lățimi) aplicate peste Google Sheets. */

import { GREEN_MID_HEADER, MEASUREMENT_CSV_HEADERS } from "./sheetCatalog";

export type WidthField =
  | "row_width_m"
  | "carriageway_m"
  | "sidewalk1_m"
  | "sidewalk2_m"
  | "parking1_m"
  | "parking2_m"
  | "free_sidewalk1_m"
  | "free_sidewalk2_m"
  | "bike1_m"
  | "bike2_m"
  | "green1_m"
  | "green2_m"
  | "green_mid_m";

/** `null` = golește valoarea din sheet. */
export type WidthOverride = Partial<Record<WidthField, number | null>>;

export type StreetFixBaseline = {
  sheetName: string;
  widths: Record<string, string>;
};

export type StreetFixesFile = {
  version: 1;
  updated_at?: string;
  renames: Record<string, Record<string, string>>;
  omit: Record<string, string[]>;
  widths: Record<string, Record<string, WidthOverride>>;
  baselines: Record<string, Record<string, StreetFixBaseline>>;
};

export type FixableStreet = {
  uniqueKey: string;
  baseKey: string;
  sheetName: string;
  displayName: string;
  sheetCells: Record<string, string>;
  cells: Record<string, string>;
  omitted: boolean;
};

export type FixDrift = {
  slug: string;
  fixKey: string;
  kind: "stale" | "orphan";
  sheetName?: string;
  displayName?: string;
  detail: string;
};

/** Hipodrom: rândurile fără nicio lățime (planete goale, III/IV încă necompletate) nu ajung pe hartă. */
export const DROP_EMPTY_WIDTH_SLUGS = new Set(["hipodrom"]);

export const WIDTH_TO_HEADER: Record<WidthField, string> = {
  row_width_m: "Latime trama stradala",
  carriageway_m: "Latime carosabil",
  sidewalk1_m: "Latime trotuar 1",
  sidewalk2_m: "Latime trotuar 2",
  parking1_m: "Latime parcare 1",
  parking2_m: "Latime parcare 2",
  free_sidewalk1_m: "Zona libera trotuar 1",
  free_sidewalk2_m: "Zona libera trotuar 2",
  bike1_m: "Latime pista biciclete 1",
  bike2_m: "Latime pista biciclete 2",
  green1_m: "Zona verde 1",
  green2_m: "Zona verde 2",
  green_mid_m: GREEN_MID_HEADER,
};

export const WIDTH_HEADERS = [...MEASUREMENT_CSV_HEADERS.slice(1), GREEN_MID_HEADER];

const HEADER_TO_WIDTH = Object.fromEntries(
  (Object.entries(WIDTH_TO_HEADER) as [WidthField, string][]).map(([field, header]) => [header, field])
) as Record<string, WidthField>;

export function emptyStreetFixes(): StreetFixesFile {
  return {
    version: 1,
    renames: Object.create(null),
    omit: Object.create(null),
    widths: Object.create(null),
    baselines: Object.create(null),
  };
}

export function baseFixKey(key: string) {
  return String(key || "").replace(/#\d+$/, "");
}

export function formatWidth(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n === 0) return "0";
  return String(n);
}

export function parseSheetNumber(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  let t = String(v).trim();
  if (!t || t === "-----" || t === "-" || t === "—" || /^#/i.test(t)) return undefined;
  t = t.replace(/\s/g, "").replace(",", ".");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function cellHasWidth(v: string | undefined) {
  return parseSheetNumber(v) != null;
}

export function sameWidthCell(a: string | undefined, b: string | undefined) {
  const na = parseSheetNumber(a);
  const nb = parseSheetNumber(b);
  if (na == null && nb == null) return true;
  return na === nb;
}

export function widthFingerprint(cells: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of WIDTH_HEADERS) {
    const formatted = formatWidth(parseSheetNumber(cells?.[h]));
    if (formatted) out[h] = formatted;
  }
  return out;
}

function isForbiddenKey(key: string) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function parseWidthOverride(raw: unknown): WidthOverride {
  const out: WidthOverride = {};
  if (!isPlainObject(raw)) return out;
  for (const field of Object.keys(WIDTH_TO_HEADER) as WidthField[]) {
    if (!(field in raw)) continue;
    const v = raw[field];
    if (v == null) {
      out[field] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[field] = v;
  }
  return out;
}

function sortRecord<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = Object.create(null);
  for (const k of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
    if (isForbiddenKey(k)) continue;
    out[k] = obj[k];
  }
  return out;
}

export function parseStreetFixesFile(raw: unknown): StreetFixesFile {
  const file = emptyStreetFixes();
  if (!isPlainObject(raw)) return file;
  if (typeof raw.updated_at === "string" && raw.updated_at.trim()) file.updated_at = raw.updated_at.trim();

  if (isPlainObject(raw.renames)) {
    for (const [slug, map] of Object.entries(raw.renames)) {
      if (isForbiddenKey(slug) || !isPlainObject(map)) continue;
      const next: Record<string, string> = Object.create(null);
      for (const [key, name] of Object.entries(map)) {
        if (isForbiddenKey(key)) continue;
        if (typeof name === "string" && name.trim()) next[key] = name.trim();
      }
      if (Object.keys(next).length) file.renames[slug] = sortRecord(next);
    }
  }

  if (isPlainObject(raw.omit)) {
    for (const [slug, list] of Object.entries(raw.omit)) {
      if (isForbiddenKey(slug) || !Array.isArray(list)) continue;
      const keys = [
        ...new Set(list.map((k) => String(k || "").trim()).filter((k) => k && !isForbiddenKey(k))),
      ].sort((a, b) => a.localeCompare(b));
      if (keys.length) file.omit[slug] = keys;
    }
  }

  if (isPlainObject(raw.widths)) {
    for (const [slug, map] of Object.entries(raw.widths)) {
      if (isForbiddenKey(slug) || !isPlainObject(map)) continue;
      const next: Record<string, WidthOverride> = Object.create(null);
      for (const [key, override] of Object.entries(map)) {
        if (isForbiddenKey(key)) continue;
        const parsed = parseWidthOverride(override);
        if (Object.keys(parsed).length) next[key] = parsed;
      }
      if (Object.keys(next).length) file.widths[slug] = sortRecord(next);
    }
  }

  if (isPlainObject(raw.baselines)) {
    for (const [slug, map] of Object.entries(raw.baselines)) {
      if (isForbiddenKey(slug) || !isPlainObject(map)) continue;
      const next: Record<string, StreetFixBaseline> = Object.create(null);
      for (const [key, baseline] of Object.entries(map)) {
        if (isForbiddenKey(key) || !isPlainObject(baseline) || typeof baseline.sheetName !== "string") continue;
        const widths = isPlainObject(baseline.widths)
          ? Object.fromEntries(
              Object.entries(baseline.widths)
                .filter(([h, v]) => !isForbiddenKey(h) && typeof v === "string")
                .map(([h, v]) => [h, String(v)])
            )
          : {};
        next[key] = { sheetName: baseline.sheetName, widths };
      }
      if (Object.keys(next).length) file.baselines[slug] = sortRecord(next);
    }
  }

  file.renames = sortRecord(file.renames);
  file.omit = sortRecord(file.omit);
  file.widths = sortRecord(file.widths);
  file.baselines = sortRecord(file.baselines);
  return file;
}

export function serializeStreetFixesFile(file: StreetFixesFile) {
  return JSON.stringify(parseStreetFixesFile(file), null, 2) + "\n";
}

export function lookupRename(fixes: StreetFixesFile, slug: string, uniqueKey: string): string | undefined {
  return fixes.renames[slug]?.[uniqueKey] ?? fixes.renames[slug]?.[baseFixKey(uniqueKey)];
}

export function isOmitted(fixes: StreetFixesFile, slug: string, uniqueKey: string) {
  const list = fixes.omit[slug] || [];
  return list.includes(uniqueKey) || list.includes(baseFixKey(uniqueKey));
}

export function lookupWidths(fixes: StreetFixesFile, slug: string, uniqueKey: string): WidthOverride | undefined {
  return fixes.widths[slug]?.[uniqueKey];
}

export function applyWidthOverride(cells: Record<string, string>, override: WidthOverride | undefined) {
  if (!override) return;
  for (const [field, value] of Object.entries(override) as [WidthField, number | null][]) {
    const header = WIDTH_TO_HEADER[field];
    if (!header) continue;
    cells[header] = value == null ? "" : formatWidth(value);
  }
}

export function rowHasAnyMappedWidth(cells: Record<string, string>) {
  return WIDTH_HEADERS.some((h) => cellHasWidth(cells[h]));
}

export function fixKeysForSlug(fixes: StreetFixesFile, slug: string): string[] {
  return [
    ...Object.keys(fixes.renames[slug] || {}),
    ...(fixes.omit[slug] || []),
    ...Object.keys(fixes.widths[slug] || {}),
  ].filter((k, i, all) => all.indexOf(k) === i);
}

function findRecord(records: FixableStreet[], key: string) {
  return records.find((r) => r.uniqueKey === key) || records.find((r) => r.baseKey === key);
}

function lookupBaseline(fixes: StreetFixesFile, slug: string, rec: FixableStreet, storedKey: string) {
  const map = fixes.baselines[slug] || {};
  return map[storedKey] || map[rec.uniqueKey] || map[rec.baseKey];
}

function widthsDiffer(got: Record<string, string>, want: Record<string, string>) {
  const headers = new Set([...Object.keys(got), ...Object.keys(want), ...WIDTH_HEADERS]);
  for (const h of headers) {
    if (!sameWidthCell(got[h], want[h])) return true;
  }
  return false;
}

export function detectFixDrift(recordsBySlug: Record<string, FixableStreet[]>, fixes: StreetFixesFile): FixDrift[] {
  const drift: FixDrift[] = [];
  const slugs = new Set([...Object.keys(recordsBySlug), ...Object.keys(fixes.renames), ...Object.keys(fixes.omit), ...Object.keys(fixes.widths)]);
  for (const slug of [...slugs].sort((a, b) => a.localeCompare(b))) {
    const records = recordsBySlug[slug] || [];
    for (const key of fixKeysForSlug(fixes, slug).sort((a, b) => a.localeCompare(b))) {
      const rec = findRecord(records, key);
      const renamed = fixes.renames[slug]?.[key];
      if (!rec) {
        drift.push({
          slug,
          fixKey: key,
          kind: "orphan",
          displayName: renamed,
          detail: `Fix „${key}”${renamed ? ` („${renamed}”)` : ""} în ${slug}: strada nu mai e în spreadsheet.`,
        });
        continue;
      }
      const baseline = lookupBaseline(fixes, slug, rec, key);
      if (!baseline) continue;
      const nameChanged = rec.sheetName !== baseline.sheetName;
      const widthChanged = Object.keys(baseline.widths).length > 0 && widthsDiffer(widthFingerprint(rec.sheetCells), baseline.widths);
      if (!nameChanged && !widthChanged) continue;
      const bits: string[] = [];
      if (nameChanged) bits.push(`numele în sheet e „${rec.sheetName}”, la salvare era „${baseline.sheetName}”`);
      if (widthChanged) {
        const changed: string[] = [];
        for (const h of WIDTH_HEADERS) {
          const got = widthFingerprint(rec.sheetCells)[h];
          const want = baseline.widths[h] ?? "";
          if (!sameWidthCell(got, want)) changed.push(`${h}: ${want || "∅"} → ${got || "∅"}`);
        }
        bits.push(`lățimi: ${changed.slice(0, 4).join("; ")}${changed.length > 4 ? "…" : ""}`);
      }
      drift.push({
        slug,
        fixKey: rec.uniqueKey,
        kind: "stale",
        sheetName: rec.sheetName,
        displayName: rec.displayName,
        detail: `Fix pe „${rec.sheetName}” (${slug}): spreadsheet-ul s-a schimbat (${bits.join("; ")}).`,
      });
    }
  }
  return drift;
}

export function widthOverrideFromCells(sheetCells: Record<string, string>, cells: Record<string, string>): WidthOverride | undefined {
  const out: WidthOverride = {};
  for (const h of WIDTH_HEADERS) {
    const field = HEADER_TO_WIDTH[h];
    if (!field) continue;
    if (sameWidthCell(sheetCells[h], cells[h])) continue;
    const n = parseSheetNumber(cells[h]);
    out[field] = n == null ? null : n;
  }
  return Object.keys(out).length ? out : undefined;
}

function cloneFixes(file: StreetFixesFile): StreetFixesFile {
  return parseStreetFixesFile(structuredClone(file));
}

function setRename(file: StreetFixesFile, slug: string, key: string, name: string) {
  file.renames[slug] = { ...(file.renames[slug] || {}), [key]: name };
}

function addOmit(file: StreetFixesFile, slug: string, key: string) {
  const cur = new Set(file.omit[slug] || []);
  cur.add(key);
  file.omit[slug] = [...cur].sort((a, b) => a.localeCompare(b));
}

function setWidths(file: StreetFixesFile, slug: string, key: string, override: WidthOverride) {
  file.widths[slug] = { ...(file.widths[slug] || {}), [key]: override };
}

function setBaseline(file: StreetFixesFile, slug: string, key: string, rec: FixableStreet) {
  file.baselines[slug] = {
    ...(file.baselines[slug] || {}),
    [key]: { sheetName: rec.sheetName, widths: widthFingerprint(rec.sheetCells) },
  };
}

function presentKeys(records: FixableStreet[]) {
  const keys = new Set<string>();
  for (const r of records) {
    keys.add(r.uniqueKey);
    keys.add(r.baseKey);
  }
  return keys;
}

/** Snapshot pentru cheile care au deja un fix (folosit la generarea fișierului din fixtures). */
export function snapshotBaselines(recordsBySlug: Record<string, FixableStreet[]>, file: StreetFixesFile): StreetFixesFile {
  const next = cloneFixes(file);
  next.baselines = {};
  for (const slug of Object.keys({ ...next.renames, ...next.omit, ...next.widths, ...recordsBySlug })) {
    for (const key of fixKeysForSlug(next, slug)) {
      const rec = findRecord(recordsBySlug[slug] || [], key);
      if (!rec) continue;
      setBaseline(next, slug, key, rec);
    }
  }
  return parseStreetFixesFile(next);
}

/**
 * Reconstruiește street-fixes.json din editor.
 * Străzile încă prezente în sheet sunt sursa de adevăr; fix-urile orfane din fișierul vechi rămân.
 */
export function deriveStreetFixes(recordsBySlug: Record<string, FixableStreet[]>, previous: StreetFixesFile): StreetFixesFile {
  const next = emptyStreetFixes();
  next.updated_at = new Date().toISOString();

  for (const [slug, records] of Object.entries(recordsBySlug)) {
    for (const rec of records) {
      const key = rec.uniqueKey;
      if (rec.omitted) addOmit(next, slug, key);
      if (rec.displayName.trim() && rec.displayName.trim() !== rec.sheetName) {
        setRename(next, slug, key, rec.displayName.trim());
      }
      const override = widthOverrideFromCells(rec.sheetCells, rec.cells);
      if (override) setWidths(next, slug, key, override);
      if (fixKeysForSlug(next, slug).includes(key) || (key !== rec.baseKey && fixKeysForSlug(next, slug).includes(rec.baseKey))) {
        setBaseline(next, slug, key, rec);
      }
    }
  }

  for (const slug of Object.keys({ ...previous.renames, ...previous.omit, ...previous.widths, ...previous.baselines })) {
    const keys = presentKeys(recordsBySlug[slug] || []);
    for (const key of fixKeysForSlug(previous, slug)) {
      if (keys.has(key) || keys.has(baseFixKey(key))) continue;
      const renamed = previous.renames[slug]?.[key];
      if (renamed) setRename(next, slug, key, renamed);
      if ((previous.omit[slug] || []).includes(key)) addOmit(next, slug, key);
      const override = previous.widths[slug]?.[key];
      if (override && Object.keys(override).length) setWidths(next, slug, key, override);
      const baseline = previous.baselines[slug]?.[key];
      if (baseline) {
        next.baselines[slug] = { ...(next.baselines[slug] || {}), [key]: baseline };
      }
    }
  }

  return parseStreetFixesFile(next);
}

export function recordsHaveFix(rec: FixableStreet) {
  if (rec.omitted) return true;
  if (rec.displayName.trim() !== rec.sheetName) return true;
  return Boolean(widthOverrideFromCells(rec.sheetCells, rec.cells));
}

/** Persistă `street-fixes.json` prin API (sesiune de echipă). */
export async function persistStreetFixesFile(file: StreetFixesFile, ifMatch?: string): Promise<StreetFixesFile | null> {
  try {
    const { putStreetFixes } = await import("./teamApi");
    return await putStreetFixes(file, ifMatch);
  } catch {
    return null;
  }
}
