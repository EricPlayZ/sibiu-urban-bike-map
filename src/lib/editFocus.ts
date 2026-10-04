import { buildingTypeMeta, coerceBuildingType, inferBuildingTypeFromOsm } from "./buildingTypes";
import type { PresenceLock } from "./livePresence";
import { boundsOfFeatures, type SearchHit } from "./mapSearch";
import { rootSid } from "./streetSplits";

type FeatureCollection = GeoJSON.FeatureCollection | null | undefined;

export function featureWithProp(
  fc: FeatureCollection,
  key: "sid" | "bid",
  id: string,
): GeoJSON.Feature | null {
  const f = fc?.features.find((x) => String((x.properties as Record<string, unknown> | null)?.[key] ?? "") === id);
  if (!f?.geometry || f.geometry.type === "GeometryCollection") return null;
  return f;
}

/** Segment in the painted streets, then the same id in the raw pipeline, then the split root. */
export function streetFeatureForFocus(
  streets: FeatureCollection,
  pipeline: FeatureCollection,
  id: string,
): GeoJSON.Feature | null {
  const root = rootSid(id);
  return (
    featureWithProp(streets, "sid", id) ||
    featureWithProp(pipeline, "sid", id) ||
    (root !== id ? featureWithProp(pipeline, "sid", root) || featureWithProp(streets, "sid", root) : null)
  );
}

/** Unsplit street: pipeline root first, painted streets if the raw line is missing. */
export function splitRootFeature(
  streets: FeatureCollection,
  pipeline: FeatureCollection,
  root: string,
): GeoJSON.Feature | null {
  return featureWithProp(pipeline, "sid", root) || featureWithProp(streets, "sid", root);
}

export function buildingFeatureForFocus(buildings: FeatureCollection, id: string): GeoJSON.Feature | null {
  return featureWithProp(buildings, "bid", id);
}

export function editMapHit(
  id: string,
  label: string,
  hint: string,
  feature: GeoJSON.Feature | null,
): SearchHit | null {
  if (!feature?.geometry) return null;
  if (!boundsOfFeatures([feature])) return null;
  return { id: `edit:${id}`, kind: "street", label, hint, features: [feature], quiet: true };
}

export function lockTargetLabel(
  lock: PresenceLock,
  ctx: {
    streets: FeatureCollection;
    pipeline: FeatureCollection;
    buildings: FeatureCollection;
    buildingTypes: Record<string, { type?: string } | undefined>;
  },
): string {
  if (lock.kind === "street") {
    const root = rootSid(lock.id);
    const f =
      featureWithProp(ctx.pipeline, "sid", lock.id) ||
      featureWithProp(ctx.pipeline, "sid", root) ||
      featureWithProp(ctx.streets, "sid", lock.id) ||
      featureWithProp(ctx.streets, "sid", root);
    const name = String((f?.properties as { name?: string } | null)?.name || "").trim();
    return name || lock.id;
  }
  const f = featureWithProp(ctx.buildings, "bid", lock.id);
  const osm = String((f?.properties as { building?: string } | null)?.building || "");
  const t = coerceBuildingType(ctx.buildingTypes[lock.id]?.type) ?? inferBuildingTypeFromOsm(osm);
  return `Clădire · ${buildingTypeMeta(t).label}`;
}
