import type { Measurement } from "./space";
import { parseLocalEditsFile } from "./localEditsFile";
import { parseBuildingEditsFile, type BuildingEditsFile, type BuildingType } from "./buildingEdits";
import type { StreetFixesFile } from "./streetFixes";
import { parseStreetSplitsFile, type SplitPoint, type StreetSplitsFile } from "./streetSplits";

const jsonHeaders = {
  "Content-Type": "application/json",
  "X-Requested-With": "ubr",
};

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`api ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function parseBody(r: Response): Promise<unknown> {
  const text = await r.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function req(url: string, init?: RequestInit) {
  const r = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  const body = await parseBody(r);
  if (!r.ok) throw new ApiError(r.status, body);
  return body;
}

export async function apiMe(): Promise<{ name: string; sid: string } | null> {
  try {
    return (await req("/api/me", { signal: AbortSignal.timeout(8_000) })) as { name: string; sid: string };
  } catch {
    return null;
  }
}

export async function apiLogin(password: string, name: string): Promise<{ name: string }> {
  return (await req("/api/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ password, name }),
  })) as { name: string };
}

function retryAfterSec(body: unknown): number {
  if (body && typeof body === "object" && "retryAfterSec" in body) {
    const n = Number((body as { retryAfterSec: unknown }).retryAfterSec);
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }
  return 0;
}

export function loginFailureMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const sec = retryAfterSec(err.body);
      if (sec >= 60) {
        const min = Math.max(1, Math.ceil(sec / 60));
        return `Prea multe parole greșite. Așteaptă ${min} min, apoi încearcă din nou.`;
      }
      if (sec > 0) return `Prea multe încercări. Așteaptă ${sec}s.`;
      return "Prea multe încercări. Așteaptă puțin și încearcă din nou.";
    }
    if (err.status === 403) {
      return "Cererea a fost respinsă. Deschide site-ul pe adresa oficială și reîncearcă.";
    }
    if (err.status === 401) return "Parolă greșită.";
  }
  return "Serverul nu e disponibil. Încearcă din nou.";
}

export async function apiLogout() {
  try {
    await req("/api/logout", { method: "POST", headers: jsonHeaders, body: "{}" });
  } catch {
    /* still clear local state */
  }
}

export type LiveEdits = {
  streets: Record<string, Measurement>;
  buildings: BuildingEditsFile;
  splits: StreetSplitsFile;
  etag: string | null;
};

function liveEditsFrom(data: { streets?: unknown; buildings?: unknown; splits?: unknown }, etag: string | null): LiveEdits {
  return {
    streets: parseLocalEditsFile(data.streets),
    buildings: parseBuildingEditsFile(data.buildings),
    splits: parseStreetSplitsFile(data.splits),
    etag,
  };
}

export async function fetchLiveEdits(): Promise<LiveEdits> {
  const r = await fetch("/api/edits", { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw new Error("edits");
  return liveEditsFrom((await r.json()) as Record<string, unknown>, r.headers.get("etag"));
}

export async function fetchLiveEditsIfChanged(etag: string | null): Promise<LiveEdits | null> {
  const r = await fetch("/api/edits", {
    cache: "no-store",
    headers: etag ? { "If-None-Match": etag } : {},
  });
  if (r.status === 304) return null;
  if (!r.ok) throw new Error("edits");
  return liveEditsFrom((await r.json()) as Record<string, unknown>, r.headers.get("etag"));
}

/** Când altcineva editează entitatea, serverul răspunde 423 `{ error: "locked", holder }`. */
export function lockedHolder(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 423) return null;
  const b = err.body;
  return b && typeof b === "object" && "holder" in b ? String((b as { holder: unknown }).holder) : "cineva";
}

/** 409 `{ error: "conflict", current: { updated_at } }` — versiunea If-Match e veche. */
export function conflictUpdatedAt(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const b = err.body;
  if (!b || typeof b !== "object" || !("current" in b)) return null;
  const current = (b as { current: unknown }).current;
  if (!current || typeof current !== "object" || !("updated_at" in current)) return null;
  const at = (current as { updated_at: unknown }).updated_at;
  return typeof at === "string" && at ? at : null;
}

export type SplitsSaved = {
  points: SplitPoint[];
  removed: string[];
  inherited: Record<string, Measurement>;
  rootEdit?: Measurement | null;
  updated_at?: string;
};

export async function putSplits(
  rootSid: string,
  points: SplitPoint[],
  inherit: Record<string, string>,
  ifMatch?: string
): Promise<SplitsSaved> {
  return (await req(`/api/edits/splits/${encodeURIComponent(rootSid)}`, {
    method: "PUT",
    headers: { ...jsonHeaders, ...(ifMatch ? { "If-Match": ifMatch } : {}) },
    body: JSON.stringify({ points, inherit }),
  })) as SplitsSaved;
}

export async function putStreet(sid: string, data: Measurement, ifMatch?: string) {
  return (await req(`/api/edits/streets/${encodeURIComponent(sid)}`, {
    method: "PUT",
    headers: { ...jsonHeaders, ...(ifMatch ? { "If-Match": ifMatch } : {}) },
    body: JSON.stringify(data),
  })) as Measurement;
}

export async function deleteStreet(sid: string) {
  const r = await fetch(`/api/edits/streets/${encodeURIComponent(sid)}`, {
    method: "DELETE",
    credentials: "include",
    headers: jsonHeaders,
  });
  if (!r.ok && r.status !== 204) throw new ApiError(r.status, await parseBody(r));
}

export async function purgeStreets() {
  await req("/api/edits/streets/purge", { method: "POST", headers: jsonHeaders, body: "{}" });
}

export async function purgeBuildings() {
  return (await req("/api/edits/buildings/purge", { method: "POST", headers: jsonHeaders, body: "{}" })) as {
    updated_at?: string;
  };
}

export async function purgeSplits() {
  return (await req("/api/edits/splits/purge", { method: "POST", headers: jsonHeaders, body: "{}" })) as {
    removed: string[];
    updated_at?: string;
  };
}

export async function putBuilding(id: string, type: BuildingType, ifMatch?: string) {
  await req(`/api/edits/buildings/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { ...jsonHeaders, ...(ifMatch ? { "If-Match": ifMatch } : {}) },
    body: JSON.stringify({ type }),
  });
}

export async function deleteBuilding(id: string) {
  const r = await fetch(`/api/edits/buildings/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
    headers: jsonHeaders,
  });
  if (!r.ok && r.status !== 204) throw new ApiError(r.status, await parseBody(r));
}

export async function putStreetFixes(file: StreetFixesFile, ifMatch?: string) {
  return (await req("/api/edits/street-fixes", {
    method: "PUT",
    headers: { ...jsonHeaders, ...(ifMatch ? { "If-Match": ifMatch } : {}) },
    body: JSON.stringify(file),
  })) as StreetFixesFile;
}

const TAB_KEY = "ubr-edit-tab";

/** Identifică tab-ul. Supraviețuiește refresh-ului, ca serverul să poată elibera doar lock-ul acestui tab. */
export function editTabId(): string {
  const storage = typeof sessionStorage !== "undefined" ? sessionStorage : null;
  if (!storage) return "localtab1";
  let id = storage.getItem(TAB_KEY) || "";
  if (!/^[a-z0-9]{8,32}$/.test(id)) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    id = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    storage.setItem(TAB_KEY, id);
  }
  return id;
}

let tabReleaseBound = false;

/** La refresh / închidere, lock-ul nu așteaptă TTL-ul de 45s. */
export function bindEditTabRelease() {
  if (tabReleaseBound || typeof window === "undefined") return;
  tabReleaseBound = true;
  window.addEventListener("pagehide", () => {
    const body = new Blob([JSON.stringify({ tab: editTabId() })], { type: "text/plain" });
    navigator.sendBeacon("/api/locks/release-tab", body);
  });
}

export type LockKind = "street" | "building" | "sheets";

export async function acquireLock(kind: LockKind, id?: string): Promise<{ ok: true } | { ok: false; holder: string }> {
  try {
    await req("/api/locks", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ kind, id, tab: editTabId() }),
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const holder =
        e.body && typeof e.body === "object" && "holder" in e.body ? String((e.body as { holder: unknown }).holder) : "cineva";
      return { ok: false, holder };
    }
    throw e;
  }
}

export async function releaseLock(kind: LockKind, id?: string) {
  try {
    await req("/api/locks", {
      method: "DELETE",
      headers: jsonHeaders,
      body: JSON.stringify({ kind, id }),
    });
  } catch {
    /* ignore */
  }
}

export type PresenceLock = { kind: "street" | "building"; id: string };
export type PresenceUser = { sid: string; name: string; locks: PresenceLock[] };

export type TeamEvent =
  | { type: "hello"; locks?: { key: string; holder: string }[] }
  | { type: "presence"; users: PresenceUser[] }
  | { type: "street_upsert"; sid: string; measurement: Measurement }
  | { type: "street_delete"; sid: string }
  | { type: "streets_purged" }
  | { type: "buildings_purged"; updated_at?: string }
  | { type: "splits_purged"; removed: string[]; updated_at?: string }
  | { type: "building_upsert"; id: string; buildingType: string }
  | { type: "building_delete"; id: string }
  | { type: "street_fixes_updated" }
  | {
      type: "splits_updated";
      sid: string;
      points: SplitPoint[];
      removed: string[];
      inherited: Record<string, Measurement>;
      rootEdit?: Measurement | null;
      updated_at?: string;
    }
  | { type: "lock"; key: string; holder: string }
  | { type: "unlock"; key: string };

export function openTeamEvents(onEvent: (ev: TeamEvent) => void): () => void {
  const es = new EventSource(`/api/events?tab=${encodeURIComponent(editTabId())}`);
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as TeamEvent);
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}
