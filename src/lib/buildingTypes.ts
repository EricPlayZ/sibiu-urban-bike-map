export const BUILDING_TYPES = ["casa", "casa_multi", "bloc_4", "bloc_10", "necunoscut"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export type BuildingTypeMeta = {
  label: string;
  color: string;
  blurb: string;
  icon: "home" | "homes" | "building" | "tower" | "help";
};

export const BUILDING_TYPE_META: Record<BuildingType, BuildingTypeMeta> = {
  casa: {
    label: "Casă individuală",
    color: "#2f9e44",
    blurb: "Casă unifamilială",
    icon: "home",
  },
  casa_multi: {
    label: "Casă cu mai multe locuințe",
    color: "#e6b422",
    blurb: "Casă cu mai multe locuințe, ca în centru",
    icon: "homes",
  },
  bloc_4: {
    label: "Bloc 4 etaje",
    color: "#e03131",
    blurb: "Bloc de locuințe cu 4 etaje",
    icon: "building",
  },
  bloc_10: {
    label: "Bloc 10 etaje",
    color: "#9c36b5",
    blurb: "Bloc de locuințe cu 10 etaje",
    icon: "tower",
  },
  necunoscut: {
    label: "Necunoscut",
    color: "#ced4da",
    blurb: "Neclasificat încă",
    icon: "help",
  },
};

/** Cele 4 coduri de culoare din legendă / picker. */
export const BUILDING_CLASSIFIED_TYPES = ["casa", "casa_multi", "bloc_4", "bloc_10"] as const satisfies readonly BuildingType[];

const LEGACY_BUILDING_TYPES: Record<string, BuildingType> = {
  bloc: "bloc_4",
  altceva: "necunoscut",
};

export function isBuildingType(v: unknown): v is BuildingType {
  return typeof v === "string" && (BUILDING_TYPES as readonly string[]).includes(v);
}

export function isClassifiedBuildingType(v: unknown): v is (typeof BUILDING_CLASSIFIED_TYPES)[number] {
  return typeof v === "string" && (BUILDING_CLASSIFIED_TYPES as readonly string[]).includes(v);
}

/** Acceptă și vechile `bloc` / `altceva` din fișiere salvate. */
export function normalizeBuildingType(v: unknown): BuildingType | null {
  if (typeof v !== "string") return null;
  if (isBuildingType(v)) return v;
  return LEGACY_BUILDING_TYPES[v] ?? null;
}

export function buildingTypeMeta(type: string): BuildingTypeMeta {
  return BUILDING_TYPE_META[normalizeBuildingType(type) ?? "necunoscut"];
}

export function inferBuildingTypeFromOsm(osmBuilding: string): BuildingType {
  const osm = osmBuilding.toLowerCase().trim();
  if (["house", "detached", "bungalow", "villa", "cabin", "farm", "static_caravan"].includes(osm)) return "casa";
  if (["semidetached_house", "terrace", "terrace_house", "residential"].includes(osm)) return "casa_multi";
  return "necunoscut";
}

export function buildingLegendItems(): { key: BuildingType; color: string; label: string }[] {
  return BUILDING_CLASSIFIED_TYPES.map((key) => ({
    key,
    color: BUILDING_TYPE_META[key].color,
    label: BUILDING_TYPE_META[key].label,
  }));
}

/** MapLibre `match` pe `ubr_type`. */
export function buildingFillColorExpr(): unknown[] {
  const expr: unknown[] = ["match", ["get", "ubr_type"]];
  for (const key of BUILDING_CLASSIFIED_TYPES) {
    expr.push(key, BUILDING_TYPE_META[key].color);
  }
  expr.push("bloc", BUILDING_TYPE_META.bloc_4.color);
  expr.push("altceva", BUILDING_TYPE_META.necunoscut.color);
  expr.push(BUILDING_TYPE_META.necunoscut.color);
  return expr;
}
