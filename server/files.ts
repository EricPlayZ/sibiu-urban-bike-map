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
import type { ApiConfig } from "./config";
import { rejectForbiddenKeys } from "./ids";

const MAX_STREETS = 20_000;
const MAX_BUILDINGS = 50_000;

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
        streetFixesUpdatedAt: loadFixes().updated_at || "",
      }));
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
