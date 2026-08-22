export const BUILDING_EDITS_REL = "data/building-edits.json";

export const BUILDING_TYPES = ["casa", "bloc", "altceva", "necunoscut"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export type BuildingEditsFile = {
  version: 1;
  updated_at?: string;
  edits: Record<string, { type: BuildingType }>;
};

function isForbiddenKey(key: string) {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

export function isBuildingType(v: unknown): v is BuildingType {
  return typeof v === "string" && (BUILDING_TYPES as readonly string[]).includes(v);
}

export function emptyBuildingEdits(): BuildingEditsFile {
  return { version: 1, edits: {} };
}

export function parseBuildingEditsFile(data: unknown): BuildingEditsFile {
  const file = emptyBuildingEdits();
  if (!data || typeof data !== "object" || Array.isArray(data)) return file;
  const root = data as Record<string, unknown>;
  if (typeof root.updated_at === "string" && root.updated_at.trim()) file.updated_at = root.updated_at.trim();
  const raw =
    root.edits && typeof root.edits === "object" && !Array.isArray(root.edits)
      ? (root.edits as Record<string, unknown>)
      : root.version != null
        ? {}
        : (root as Record<string, unknown>);
  for (const [id, value] of Object.entries(raw)) {
    if (id === "version" || id === "updated_at" || id === "edits") continue;
    if (isForbiddenKey(id)) continue;
    const type =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { type?: unknown }).type
        : typeof value === "string"
          ? value
          : null;
    if (!isBuildingType(type)) continue;
    file.edits[id] = { type };
  }
  return file;
}

export function serializeBuildingEditsFile(file: BuildingEditsFile): string {
  return JSON.stringify({ version: 1 as const, updated_at: file.updated_at, edits: file.edits }, null, 2) + "\n";
}

export function buildingTypesFromFile(file: BuildingEditsFile): Record<string, { type: string }> {
  const out: Record<string, { type: string }> = {};
  for (const [id, v] of Object.entries(file.edits)) out[id] = { type: v.type };
  return out;
}
