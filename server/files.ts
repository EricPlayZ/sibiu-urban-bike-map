import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Measurement } from "../src/lib/space";
import {
  parseLocalEditsDocument,
  measurementForCommit,
  serializeLocalEditsDocument,
  type LocalEditsFile,
} from "../src/lib/localEditsFile";
import { hasMeaningfulLocalEdit } from "../src/lib/space";
import {
  emptyBuildingEdits,
  parseBuildingEditsFile,
  serializeBuildingEditsFile,
  type BuildingEditsFile,
  type BuildingType,
} from "../src/lib/buildingEdits";
import { emptyStreetFixes, parseStreetFixesFile, serializeStreetFixesFile, type StreetFixesFile } from "../src/lib/streetFixes";
import {
  emptyStreetSplits,
  parseStreetSplitsFile,
  pieceSid,
  pointKey,
  sanitizeSplitPoints,
  serializeStreetSplitsFile,
  SPLIT_SEP,
  type SplitPoint,
  type StreetSplitsFile,
} from "../src/lib/streetSplits";
import type { ApiConfig } from "./config";
import { rejectForbiddenKeys } from "./ids";

const MAX_STREETS = 20_000;
const MAX_BUILDINGS = 50_000;
const MAX_SPLIT_STREETS = 5_000;

export class ConflictError extends Error {
  current: unknown;
  constructor(current: unknown) {
    super("conflict");
    this.name = "ConflictError";
    this.current = current;
  }
}

function atomicWrite(dest: string, text: string) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { encoding: "utf8" });
  renameSync(tmp, dest);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function seedEditsDir(config: ApiConfig) {
  mkdirSync(config.editsDir, { recursive: true });
  const files: { name: string; fallback: string }[] = [
    { name: "local-edits.json", fallback: serializeLocalEditsDocument({ version: 1, edits: {} }) },
    { name: "building-edits.json", fallback: serializeBuildingEditsFile(emptyBuildingEdits()) },
    { name: "street-fixes.json", fallback: serializeStreetFixesFile(emptyStreetFixes()) },
    { name: "street-splits.json", fallback: serializeStreetSplitsFile(emptyStreetSplits()) },
  ];
  for (const f of files) {
    const dest = join(config.editsDir, f.name);
    if (existsSync(dest)) continue;
    const seed = config.seedDir ? join(config.seedDir, f.name) : "";
    if (seed && existsSync(seed)) copyFileSync(seed, dest);
    else writeFileSync(dest, f.fallback);
  }
}

export function createFileStore(config: ApiConfig) {
  let chain = Promise.resolve();
  function exclusive<T>(fn: () => T): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  const streetsPath = join(config.editsDir, "local-edits.json");
  const buildingsPath = join(config.editsDir, "building-edits.json");
  const fixesPath = join(config.editsDir, "street-fixes.json");
  const splitsPath = join(config.editsDir, "street-splits.json");

  function loadSplits(): StreetSplitsFile {
    try {
      return parseStreetSplitsFile(readJson(splitsPath));
    } catch {
      return emptyStreetSplits();
    }
  }
  function saveSplits(file: StreetSplitsFile) {
    file.updated_at = new Date().toISOString();
    atomicWrite(splitsPath, serializeStreetSplitsFile(file));
    return file;
  }

  function loadStreets(): LocalEditsFile {
    try {
      return parseLocalEditsDocument(readJson(streetsPath));
    } catch {
      return { version: 1, edits: {} };
    }
  }
  function loadBuildings(): BuildingEditsFile {
    try {
      return parseBuildingEditsFile(readJson(buildingsPath));
    } catch {
      return emptyBuildingEdits();
    }
  }
  function loadFixes(): StreetFixesFile {
    try {
      return parseStreetFixesFile(readJson(fixesPath));
    } catch {
      return emptyStreetFixes();
    }
  }

  function saveStreets(file: LocalEditsFile) {
    file.updated_at = new Date().toISOString();
    atomicWrite(streetsPath, serializeLocalEditsDocument(file));
    return file;
  }
  function saveBuildings(file: BuildingEditsFile) {
    file.updated_at = new Date().toISOString();
    atomicWrite(buildingsPath, serializeBuildingEditsFile(file));
    return file;
  }
  function saveFixes(file: StreetFixesFile) {
    const next = parseStreetFixesFile(file);
    next.updated_at = new Date().toISOString();
    atomicWrite(fixesPath, serializeStreetFixesFile(next));
    return next;
  }

  return {
    snapshot() {
      return exclusive(() => ({
        streets: loadStreets(),
        buildings: loadBuildings(),
        splits: loadSplits(),
        streetFixesUpdatedAt: loadFixes().updated_at || "",
      }));
    },
    /**
     * Înlocuiește punctele de tăiere ale unei străzi (rădăcină).
     * - `inherit`: bucăți noi (`sid` nou → `sid` din care provin) care primesc o copie a editării, fără lungime.
     * - bucățile ale căror puncte au dispărut își pierd editarea (s-au unit cu cea dinainte).
     */
    putSplits(root: string, rawPoints: unknown, rawInherit: unknown, ifMatch: string | undefined) {
      return exclusive(() => {
        if (rejectForbiddenKeys(rawPoints) || rejectForbiddenKeys(rawInherit)) throw new Error("bad_keys");
        const points = sanitizeSplitPoints(rawPoints);
        const splits = loadSplits();
        const before = splits.splits[root] || [];
        if (ifMatch && ifMatch !== "*" && splits.updated_at && splits.updated_at !== ifMatch) {
          throw new ConflictError({ points: before, updated_at: splits.updated_at });
        }
        if (!before.length && !points.length) {
          return {
            points: [] as SplitPoint[],
            removed: [] as string[],
            inherited: {} as Record<string, Measurement>,
            rootEdit: undefined as Measurement | null | undefined,
            updated_at: splits.updated_at,
          };
        }
        if (!before.length && Object.keys(splits.splits).length >= MAX_SPLIT_STREETS) throw new Error("too_many");

        const nextKeys = new Set(points.map(pointKey));
        const removedPoints = before.filter((p) => !nextKeys.has(pointKey(p)));
        const removed = removedPoints.map((p) => pieceSid(root, p));

        const streets = loadStreets();
        let streetsChanged = false;
        for (const sid of removed) {
          if (streets.edits[sid]) {
            delete streets.edits[sid];
            streetsChanged = true;
          }
        }

        const allowedNew = new Set(points.map((p) => pieceSid(root, p)));
        const inherited: Record<string, Measurement> = {};
        if (rawInherit && typeof rawInherit === "object" && !Array.isArray(rawInherit)) {
          for (const [newSid, fromSid] of Object.entries(rawInherit as Record<string, unknown>)) {
            if (!allowedNew.has(newSid) || typeof fromSid !== "string") continue;
            if (fromSid !== root && !fromSid.startsWith(root + SPLIT_SEP)) continue;
            if (streets.edits[newSid]) continue; // nu suprascriem o editare deja făcută pe bucata nouă
            const src = streets.edits[fromSid];
            if (!src) continue;
            const copy = measurementForCommit(newSid, { ...src, length_m: undefined });
            copy.updated_at = new Date().toISOString();
            if (!hasMeaningfulLocalEdit(copy)) continue;
            streets.edits[newSid] = copy;
            inherited[newSid] = copy;
            streetsChanged = true;
          }
        }
        // Prima bucată păstrează sid-ul rădăcinii: lungimea salvată pe strada întreagă nu mai e valabilă.
        let rootEdit: Measurement | null | undefined;
        if (points.length && streets.edits[root]?.length_m != null) {
          const { length_m: _drop, ...rest } = streets.edits[root];
          void _drop;
          const next: Measurement = { ...rest, updated_at: new Date().toISOString() };
          if (hasMeaningfulLocalEdit(next)) {
            streets.edits[root] = next;
            rootEdit = next;
          } else {
            delete streets.edits[root];
            rootEdit = null;
          }
          streetsChanged = true;
        }

        if (points.length) splits.splits[root] = points;
        else delete splits.splits[root];
        saveSplits(splits);
        if (streetsChanged) saveStreets(streets);
        return { points, removed, inherited, rootEdit, updated_at: splits.updated_at };
      });
    },
    loadFixes: () => exclusive(() => loadFixes()),
    putStreet(sid: string, raw: unknown, ifMatch: string | undefined) {
      return exclusive(() => {
        if (rejectForbiddenKeys(raw)) throw new Error("bad_keys");
        const file = loadStreets();
        const existing = file.edits[sid];
        if (ifMatch && ifMatch !== "*" && existing?.updated_at && existing.updated_at !== ifMatch) {
          throw new ConflictError(existing);
        }
        const committed = measurementForCommit(sid, { ...(raw as Measurement), street_id: sid, source: "local" });
        committed.updated_at = new Date().toISOString();
        if (!hasMeaningfulLocalEdit(committed)) throw new Error("empty");
        if (!existing && Object.keys(file.edits).length >= MAX_STREETS) throw new Error("too_many");
        file.edits[sid] = committed;
        saveStreets(file);
        return committed;
      });
    },
    deleteStreet(sid: string) {
      return exclusive(() => {
        const file = loadStreets();
        if (!file.edits[sid]) return false;
        delete file.edits[sid];
        saveStreets(file);
        return true;
      });
    },
    purgeStreets() {
      return exclusive(() => {
        saveStreets({ version: 1, edits: {} });
      });
    },
    purgeBuildings() {
      return exclusive(() => {
        const file = emptyBuildingEdits();
        saveBuildings(file);
        return { updated_at: file.updated_at };
      });
    },
    /** Scoate toate segmentările și editările de pe bucățile tăiate. */
    purgeSplits() {
      return exclusive(() => {
        const splits = loadSplits();
        const streets = loadStreets();
        const removed: string[] = [];
        for (const [root, points] of Object.entries(splits.splits)) {
          for (const point of points) {
            const sid = pieceSid(root, point);
            if (!streets.edits[sid]) continue;
            delete streets.edits[sid];
            removed.push(sid);
          }
        }
        if (removed.length) saveStreets(streets);
        const next = emptyStreetSplits();
        saveSplits(next);
        return { removed, updated_at: next.updated_at };
      });
    },
    putBuilding(id: string, type: BuildingType, ifMatch: string | undefined) {
      return exclusive(() => {
        const file = loadBuildings();
        const existing = file.edits[id];
        const existingAt = file.updated_at;
        if (ifMatch && ifMatch !== "*" && existing && existingAt && existingAt !== ifMatch) {
          throw new ConflictError(existing);
        }
        if (!existing && Object.keys(file.edits).length >= MAX_BUILDINGS) throw new Error("too_many");
        file.edits[id] = { type };
        saveBuildings(file);
        return { type, updated_at: file.updated_at };
      });
    },
    deleteBuilding(id: string) {
      return exclusive(() => {
        const file = loadBuildings();
        if (!file.edits[id]) return false;
        delete file.edits[id];
        saveBuildings(file);
        return true;
      });
    },
    putStreetFixes(raw: unknown, ifMatch: string | undefined) {
      return exclusive(() => {
        if (rejectForbiddenKeys(raw)) throw new Error("bad_keys");
        const current = loadFixes();
        if (ifMatch && ifMatch !== "*" && current.updated_at && current.updated_at !== ifMatch) {
          throw new ConflictError(current);
        }
        const parsed = parseStreetFixesFile(raw);
        return saveFixes(parsed);
      });
    },
  };
}

export type FileStore = ReturnType<typeof createFileStore>;
