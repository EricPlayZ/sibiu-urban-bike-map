import { normalizeBuildingType } from "./buildingTypes";
import { FORM_FIELDS, hasMeaningfulLocalEdit, resolveStreetMeasurement, type Measurement } from "./space";
import { SPLIT_SEP, type SplitPoint } from "./streetSplits";
import type { StreetFixesFile } from "./streetFixes";

export const EDIT_BUNDLE_KIND = "ubr-edit-bundle";
export const EDIT_BUNDLE_VERSION = 1;

export type EditBundle = {
  kind: typeof EDIT_BUNDLE_KIND;
  version: typeof EDIT_BUNDLE_VERSION;
  exported_at: string;
  streets: Record<string, Measurement>;
  buildings: Record<string, string>;
  splits: Record<string, SplitPoint[]>;
  streetFixes: StreetFixesFile | null;
};

export type EditBundleServer = {
  streets: Record<string, Measurement>;
  buildings: Record<string, string>;
  splits: Record<string, SplitPoint[]>;
  streetsUpdatedAt?: string;
  buildingsUpdatedAt?: string;
  splitsUpdatedAt?: string;
  streetFixes?: StreetFixesFile | null;
};

export type ImportRowKind = "street" | "building" | "split" | "streetFixes";

export type ImportReviewRow = {
  id: string;
  kind: ImportRowKind;
  state: "same" | "add" | "replace";
  title: string;
  detail?: string;
  serverSummary?: string;
  fileSummary?: string;
  /** Implicit bifat doar pentru „add”. */
  selected: boolean;
  /** Pentru replace: permite If-Match * la aplicare. */
  forceOverwrite: boolean;
  street?: Measurement;
  buildingType?: string;
  splitPoints?: SplitPoint[];
};

function isForbiddenKey(key: string) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function parsePoint(v: unknown): SplitPoint | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const lng = Number(v[0]);
  const lat = Number(v[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

function splitPointsEqual(a: SplitPoint[], b: SplitPoint[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
  }
  return true;
}

/** Un import nu are voie să scoată puncte deja salvate: asta șterge măsurătorile bucăților. */
export function splitImportRemovesPoints(serverPts: readonly SplitPoint[], filePts: readonly SplitPoint[]) {
  return serverPts.some((p) => !filePts.some((q) => q[0] === p[0] && q[1] === p[1]));
}

function streetEqual(a: Measurement, b: Measurement) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Measurement)[]);
  for (const k of keys) {
    if (k === "updated_at" || k === "street_id") continue;
    const va = a[k];
    const vb = b[k];
    if (va === vb) continue;
    if (va == null && vb == null) continue;
    if (typeof va === "number" && typeof vb === "number" && Math.abs(va - vb) < 1e-9) continue;
    return false;
  }
  return true;
}

export function buildEditBundle(input: {
  streets: Record<string, Measurement>;
  buildings: Record<string, string>;
  splits: Record<string, SplitPoint[]>;
  streetFixes?: StreetFixesFile | null;
}): EditBundle {
  const streets: Record<string, Measurement> = {};
  for (const [sid, m] of Object.entries(input.streets)) {
    if (hasMeaningfulLocalEdit(m)) streets[sid] = m;
  }
  return {
    kind: EDIT_BUNDLE_KIND,
    version: EDIT_BUNDLE_VERSION,
    exported_at: new Date().toISOString(),
    streets,
    buildings: { ...input.buildings },
    splits: { ...input.splits },
    streetFixes: input.streetFixes ?? null,
  };
}

export function parseEditBundle(raw: unknown): { ok: true; bundle: EditBundle } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "Fișierul nu e un obiect JSON valid." };
  }
  const root = raw as Record<string, unknown>;
  if (root.kind !== EDIT_BUNDLE_KIND) {
    return { ok: false, reason: "Tip de fișier necunoscut (kind)." };
  }
  if (root.version !== EDIT_BUNDLE_VERSION) {
    return { ok: false, reason: "Versiune de bundle neacceptată." };
  }
  if (!root.streets || typeof root.streets !== "object" || Array.isArray(root.streets)) {
    return { ok: false, reason: "Secțiunea „streets” lipsește sau e invalidă." };
  }
  if (!root.buildings || typeof root.buildings !== "object" || Array.isArray(root.buildings)) {
    return { ok: false, reason: "Secțiunea „buildings” lipsește sau e invalidă." };
  }
  if (!root.splits || typeof root.splits !== "object" || Array.isArray(root.splits)) {
    return { ok: false, reason: "Secțiunea „splits” lipsește sau e invalidă." };
  }

  const streets: Record<string, Measurement> = {};
  for (const [sid, value] of Object.entries(root.streets as Record<string, unknown>)) {
    if (isForbiddenKey(sid)) return { ok: false, reason: `Cheie interzisă: ${sid}` };
    if (sid in streets) return { ok: false, reason: `Strada „${sid}” apare de două ori.` };
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, reason: `Măsurătoare invalidă pentru „${sid}".` };
    }
    if (!hasMeaningfulLocalEdit(value as Measurement)) {
      return { ok: false, reason: `Strada „${sid}" nu conține o editare validă.` };
    }
    streets[sid] = value as Measurement;
  }

  const buildings: Record<string, string> = {};
  for (const [id, value] of Object.entries(root.buildings as Record<string, unknown>)) {
    if (isForbiddenKey(id)) return { ok: false, reason: `Cheie interzisă: ${id}` };
    if (id in buildings) return { ok: false, reason: `Clădirea „${id}" apare de două ori.` };
    const type = normalizeBuildingType(typeof value === "string" ? value : (value as { type?: unknown })?.type);
    if (!type) return { ok: false, reason: `Tip de clădire necunoscut pentru „${id}".` };
    buildings[id] = type;
  }

  const splits: Record<string, SplitPoint[]> = {};
  for (const [rootSid, value] of Object.entries(root.splits as Record<string, unknown>)) {
    if (isForbiddenKey(rootSid)) return { ok: false, reason: `Cheie interzisă: ${rootSid}` };
    if (rootSid.includes(SPLIT_SEP)) return { ok: false, reason: `Segmentare invalidă: „${rootSid}" conține „:".` };
    if (rootSid in splits) return { ok: false, reason: `Segmentarea „${rootSid}" apare de două ori.` };
    if (!Array.isArray(value)) return { ok: false, reason: `Puncte invalide pentru „${rootSid}".` };
    const points: SplitPoint[] = [];
    for (const p of value) {
      const pt = parsePoint(p);
      if (!pt) return { ok: false, reason: `Punct invalid în segmentarea „${rootSid}".` };
      points.push(pt);
    }
    if (points.length) splits[rootSid] = points;
  }

  let streetFixes: StreetFixesFile | null = null;
  if (root.streetFixes != null) {
    if (typeof root.streetFixes !== "object" || Array.isArray(root.streetFixes)) {
      return { ok: false, reason: "streetFixes trebuie să fie obiect sau null." };
    }
    streetFixes = root.streetFixes as StreetFixesFile;
  }

  return {
    ok: true,
    bundle: {
      kind: EDIT_BUNDLE_KIND,
      version: EDIT_BUNDLE_VERSION,
      exported_at: typeof root.exported_at === "string" ? root.exported_at : new Date(0).toISOString(),
      streets,
      buildings,
      splits,
      streetFixes,
    },
  };
}

/** Câte editări salvate sunt, pe fel. Badge-ul „Editări” folosește `total`. */
export function countSavedEdits(
  streets: Record<string, Measurement>,
  buildings: Record<string, unknown>,
  splits: Record<string, readonly SplitPoint[]>
) {
  const streetCount = Object.values(streets).filter((m) => hasMeaningfulLocalEdit(m)).length;
  const buildingCount = Object.keys(buildings).length;
  const splitCount = Object.values(splits).filter((pts) => pts.length > 0).length;
  return {
    streets: streetCount,
    buildings: buildingCount,
    splits: splitCount,
    total: streetCount + buildingCount + splitCount,
  };
}

export function classifyEditBundle(bundle: EditBundle, server: EditBundleServer): ImportReviewRow[] {
  const rows: ImportReviewRow[] = [];

  for (const [sid, fileM] of Object.entries(bundle.streets)) {
    const srv = server.streets[sid];
    let state: ImportReviewRow["state"] = "add";
    if (srv) state = streetEqual(srv, fileM) ? "same" : "replace";
    rows.push({
      id: sid,
      kind: "street",
      state,
      title: sid,
      selected: state === "add",
      forceOverwrite: false,
      street: fileM,
      fileSummary: state === "replace" ? "din fișier" : undefined,
      serverSummary: srv && state === "replace" ? "pe server" : undefined,
      detail: state === "same" ? "deja la fel" : undefined,
    });
  }

  for (const [id, fileType] of Object.entries(bundle.buildings)) {
    const srv = server.buildings[id];
    let state: ImportReviewRow["state"] = "add";
    if (srv) state = srv === fileType ? "same" : "replace";
    rows.push({
      id,
      kind: "building",
      state,
      title: id,
      selected: state === "add",
      forceOverwrite: false,
      buildingType: fileType,
      detail: state === "same" ? "deja la fel" : undefined,
    });
  }

  for (const [root, filePts] of Object.entries(bundle.splits)) {
    const srv = server.splits[root] || [];
    let state: ImportReviewRow["state"] = "add";
    let detail: string | undefined;
    if (server.splits[root]) {
      if (splitPointsEqual(srv, filePts)) {
        state = "same";
        detail = "deja la fel";
      } else if (splitImportRemovesPoints(srv, filePts)) {
        state = "same";
        detail = "rămâne pe server — importul nu șterge segmentarea";
      } else state = "replace";
    } else if (!filePts.length) {
      state = "same";
      detail = "deja la fel";
    }
    rows.push({
      id: root,
      kind: "split",
      state,
      title: root,
      selected: state === "add",
      forceOverwrite: false,
      splitPoints: filePts,
      detail,
    });
  }

  if (bundle.streetFixes) {
    rows.push({
      id: "__streetFixes__",
      kind: "streetFixes",
      state: "replace",
      title: "Corecții CSV/OSM (street-fixes)",
      selected: false,
      forceOverwrite: false,
      detail: "Periculos — rescrie corecțiile pentru întreaga hartă",
    });
  }

  return rows;
}

function fmtVal(v: unknown) {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "da" : "nu";
  if (typeof v === "number") return String(v);
  return String(v);
}

/** Câmpuri care diferă între măsurătoarea fără override local vs cu override. */
export function streetMeasurementDiffs(
  sid: string,
  props: Record<string, unknown>,
  local: Measurement,
  allLocal: Record<string, Measurement>,
  seed: Record<string, Measurement>
): { label: string; oldVal: string; newVal: string }[] {
  const without = { ...allLocal };
  delete without[sid];
  const before = resolveStreetMeasurement(sid, props, without, seed);
  const after = resolveStreetMeasurement(sid, props, { ...without, [sid]: local }, seed);
  const out: { label: string; oldVal: string; newVal: string }[] = [];
  if ((before.name || "") !== (after.name || "")) {
    out.push({ label: "Nume", oldVal: fmtVal(before.name), newVal: fmtVal(after.name) });
  }
  for (const f of FORM_FIELDS) {
    const o = before[f.key];
    const n = after[f.key];
    if (o === n) continue;
    if (typeof o === "number" && typeof n === "number" && Math.abs(o - n) < 1e-9) continue;
    out.push({ label: f.label, oldVal: fmtVal(o), newVal: fmtVal(n) });
  }
  if (Boolean(before.illgl_park) !== Boolean(after.illgl_park)) {
    out.push({
      label: "Parcare ilegală",
      oldVal: before.illgl_park ? "da" : "nu",
      newVal: after.illgl_park ? "da" : "nu",
    });
  }
  return out;
}

/** One line on a saved-edit card. Blank old values drop the arrow; a name change always shows both sides. */
export function formatEditDiff(d: { label: string; oldVal: string; newVal: string }) {
  const meters = /\(m\)\s*$/i.test(d.label.trim());
  const name = d.label.replace(/\s*\(m\)\s*$/i, "").trim();
  const side = (v: string) => (meters && v !== "—" && v !== "" ? `${v} m` : v);
  const blank = d.oldVal === "" || d.oldVal === "—";
  if (d.label.trim() === "Nume" || !blank) return `${name}: ${side(d.oldVal)} → ${side(d.newVal)}`;
  return `${name}: ${side(d.newVal)}`;
}
