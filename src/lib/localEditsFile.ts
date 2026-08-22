/** Formatul pe disk pentru `local-edits.json` — fără I/O de browser. */

import { FORM_FIELDS, hasMeaningfulLocalEdit, type Measurement } from "./space";

export const LOCAL_EDITS_REL = "data/local-edits.json";

export type LocalEditsFile = {
  version: 1;
  updated_at?: string;
  edits: Record<string, Measurement>;
};

function numOrUndef(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeEdit(sid: string, value: unknown): Measurement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const m = value as Measurement;
  return { ...m, street_id: sid, source: m.source || "local" };
}

function isForbiddenKey(key: string) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

/** Acceptă `{ version, edits }` sau o mapă goală `sid → Measurement`. */
export function parseLocalEditsFile(data: unknown): Record<string, Measurement> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const root = data as Record<string, unknown>;
  const raw =
    root.edits && typeof root.edits === "object" && !Array.isArray(root.edits)
      ? (root.edits as Record<string, unknown>)
      : root;
  const out: Record<string, Measurement> = {};
  for (const [sid, value] of Object.entries(raw)) {
    if (sid === "version" || sid === "updated_at" || sid === "edits") continue;
    if (isForbiddenKey(sid)) continue;
    const m = normalizeEdit(sid, value);
    if (!m || !hasMeaningfulLocalEdit(m)) continue;
    out[sid] = m;
  }
  return out;
}

export function parseLocalEditsDocument(data: unknown): LocalEditsFile {
  const edits = parseLocalEditsFile(data);
  const updated_at =
    data && typeof data === "object" && !Array.isArray(data) && typeof (data as { updated_at?: unknown }).updated_at === "string"
      ? (data as { updated_at: string }).updated_at
      : undefined;
  return { version: 1, updated_at, edits };
}

export function measurementForCommit(sid: string, m: Measurement): Measurement {
  const out: Measurement = { street_id: sid, source: "local" };
  if (m.name) out.name = m.name;
  if (m.neighborhood_slug) out.neighborhood_slug = m.neighborhood_slug;
  for (const f of FORM_FIELDS) {
    const n = numOrUndef(m[f.key]);
    if (n == null) continue;
    (out as Record<string, unknown>)[f.key] = n;
  }
  if (m.illgl_park === true) out.illgl_park = true;
  if (m.updated_at) out.updated_at = m.updated_at;
  return out;
}

export function buildLocalEditsFile(edits: Record<string, Measurement>): LocalEditsFile {
  const cleaned: Record<string, Measurement> = {};
  for (const [sid, m] of Object.entries(edits)) {
    if (isForbiddenKey(sid) || !hasMeaningfulLocalEdit(m)) continue;
    cleaned[sid] = measurementForCommit(sid, m);
  }
  return { version: 1, updated_at: new Date().toISOString(), edits: cleaned };
}

export function serializeLocalEditsFile(edits: Record<string, Measurement>): string {
  return JSON.stringify(buildLocalEditsFile(edits), null, 2) + "\n";
}

export function serializeLocalEditsDocument(file: LocalEditsFile): string {
  return JSON.stringify({ version: 1 as const, updated_at: file.updated_at, edits: file.edits }, null, 2) + "\n";
}
