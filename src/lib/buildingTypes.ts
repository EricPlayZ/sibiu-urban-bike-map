export const BUILDING_TYPES = ["casa", "casa_multi", "bloc_4", "bloc_10", "public_business"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

/** Tipul implicit: orice clădire care nu e casă / bloc. */
export const DEFAULT_BUILDING_TYPE: BuildingType = "public_business";

export type BuildingTypeMeta = {
  label: string;
  color: string;
  blurb: string;
  icon: "home" | "homes" | "building" | "tower" | "store";
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
  public_business: {
    label: "Clădire publică / privată",
    color: "#ced4da",
    blurb: "Clădire care nu e locuință: instituție, spațiu public sau altceva.",
    icon: "store",
  },
};

/** Toate tipurile din legendă / picker / filtre (fără „necunoscut”). */
export const BUILDING_CLASSIFIED_TYPES = BUILDING_TYPES;

/** Valori vechi din fișiere salvate → tipul curent. */
const LEGACY_BUILDING_TYPES: Record<string, BuildingType> = {
  bloc: "bloc_4",
  altceva: DEFAULT_BUILDING_TYPE,
  necunoscut: DEFAULT_BUILDING_TYPE,
};

export function isBuildingType(v: unknown): v is BuildingType {
  return typeof v === "string" && (BUILDING_TYPES as readonly string[]).includes(v);
}

export function isClassifiedBuildingType(v: unknown): v is BuildingType {
  return isBuildingType(v);
}

/** Acceptă și vechile `bloc` / `altceva` / `necunoscut` din fișiere salvate. */
export function normalizeBuildingType(v: unknown): BuildingType | null {
  if (typeof v !== "string") return null;
  if (isBuildingType(v)) return v;
  return LEGACY_BUILDING_TYPES[v] ?? null;
}

/** Ca `normalizeBuildingType`, dar niciodată null — orice valoare necunoscută devine tipul implicit. */
export function coerceBuildingType(v: unknown): BuildingType {
  return normalizeBuildingType(v) ?? DEFAULT_BUILDING_TYPE;
}

export function buildingTypeMeta(type: string): BuildingTypeMeta {
  return BUILDING_TYPE_META[coerceBuildingType(type)];
}

export function inferBuildingTypeFromOsm(osmBuilding: string): BuildingType {
  const osm = osmBuilding.toLowerCase().trim();
  if (["house", "detached", "bungalow", "villa", "cabin", "farm", "static_caravan"].includes(osm)) return "casa";
  if (["semidetached_house", "terrace", "terrace_house", "residential"].includes(osm)) return "casa_multi";
  return DEFAULT_BUILDING_TYPE;
}

export function buildingLegendItems(): { key: BuildingType; color: string; label: string }[] {
  return BUILDING_TYPES.map((key) => ({
    key,
    color: BUILDING_TYPE_META[key].color,
    label: BUILDING_TYPE_META[key].label,
  }));
}

/** MapLibre `match` pe `ubr_type`. */
export function buildingFillColorExpr(): unknown[] {
  const expr: unknown[] = ["match", ["get", "ubr_type"]];
  for (const key of BUILDING_TYPES) {
    expr.push(key, BUILDING_TYPE_META[key].color);
  }
  expr.push("bloc", BUILDING_TYPE_META.bloc_4.color);
  expr.push(BUILDING_TYPE_META[DEFAULT_BUILDING_TYPE].color);
  return expr;
}

/** Filtru MapLibre: doar tipurile bifate. Listă goală → nimic. */
export function buildingTypeFilterExpr(selected: readonly string[]): unknown[] {
  const known = selected.filter(isBuildingType);
  if (!known.length) return ["==", ["get", "ubr_type"], "__none__"];
  if (known.length === BUILDING_TYPES.length) return ["has", "ubr_type"];
  return ["in", ["get", "ubr_type"], ["literal", known]];
}
