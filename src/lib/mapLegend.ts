import { hasAnyEdit, LAYER_COLORS, resolveStreetMeasurement, streetHasDoorZoneBikeLane, streetHasIllegalParking, streetHasSafeBikeLane, featureHasReservedParking, type Measurement } from "./space";
import { streetSchoolSlugs } from "./schoolCatchment";
import { schoolColor } from "./schoolColors";
import { BUILDING_TYPES, buildingLegendItems } from "./buildingTypes";
import { layerLabel, type LayerVisibility, type MapLayerId } from "./layers";

/** Cheile din legendă care pornesc / opresc un strat de hartă. */
export const LEGEND_LAYER_IDS: Record<string, MapLayerId> = {
  base: "streetsBase",
  bike: "bike",
  bikeDoor: "bikeDoor",
  reserved: "reserved",
  illegal: "illegal",
  edited: "editedStreets",
};

export function legendLayerId(key: string): MapLayerId | null {
  return LEGEND_LAYER_IDS[key] ?? null;
}

/** `filter`: elementul din legendă se poate apăsa ca să pornească / oprească filtrul; `off` = ascuns pe hartă acum. */
export type LegendSwatch = {
  key: string;
  color: string;
  label: string;
  filter?: "building" | "school" | "layer";
  off?: boolean;
};

export function mapLegendItems(opts: {
  layers: LayerVisibility;
  editMode: boolean;
  schoolList: { slug: string; name: string }[];
  selectedSchools: string[];
  streets: GeoJSON.FeatureCollection | null;
  measurements: Record<string, Measurement>;
  seedMeasurements: Record<string, Measurement>;
  /** Păstrat pentru apeluri. Rândurile de străzi nu dispar când cartierele sunt închise. */
  neighborhoods: string[];
  buildingTypes?: string[];
}): { layers: LegendSwatch[]; schools: LegendSwatch[] } {
  const { layers, editMode, schoolList, selectedSchools, streets, measurements, seedMeasurements } = opts;
  const selectedBuildingTypes = new Set<string>(opts.buildingTypes ?? BUILDING_TYPES);
  const selectedSch = new Set(selectedSchools);
  const allFeats = streets?.features || [];
  const resolved = allFeats.map((f) => {
    const props = (f.properties || {}) as Record<string, unknown>;
    const sid = String(props.sid || "");
    return { props, m: resolveStreetMeasurement(sid, props, measurements, seedMeasurements) };
  });

  const layerItems: LegendSwatch[] = [];
  if (layers.buildings) {
    layerItems.push(
      ...buildingLegendItems().map((i) => ({ ...i, filter: "building" as const, off: !selectedBuildingTypes.has(i.key) }))
    );
  } else {
    const safeBike = resolved.some(({ props, m }) => streetHasSafeBikeLane(props, m));
    const doorBike = resolved.some(({ props, m }) => streetHasDoorZoneBikeLane(props, m));
    const illegal = resolved.some(({ props, m }) => streetHasIllegalParking(props, m));
    const reserved = allFeats.some((f) => featureHasReservedParking((f.properties || {}) as Record<string, unknown>));
    const baseDrawn = layers.streetsBase || editMode;
    const showBase = allFeats.length > 0;
    if (showBase) {
      layerItems.push({
        key: "base",
        color: LAYER_COLORS.base,
        label: layerLabel("streetsBase"),
        filter: "layer",
        off: !baseDrawn,
      });
    }
    if (safeBike) {
      layerItems.push({ key: "bike", color: LAYER_COLORS.bike, label: layerLabel("bike"), filter: "layer", off: !layers.bike });
    }
    if (doorBike) {
      layerItems.push({ key: "bikeDoor", color: LAYER_COLORS.bikeDoor, label: layerLabel("bikeDoor"), filter: "layer", off: !layers.bikeDoor });
    }
    if (reserved) {
      layerItems.push({
        key: "reserved",
        color: LAYER_COLORS.reserved,
        label: layerLabel("reserved"),
        filter: "layer",
        off: !layers.reserved,
      });
    }
    if (illegal) {
      layerItems.push({
        key: "illegal",
        color: LAYER_COLORS.illegal,
        label: layerLabel("illegal"),
        filter: "layer",
        off: !layers.illegal,
      });
    }
    if (editMode && Object.values(measurements).some(hasAnyEdit)) {
      layerItems.push({
        key: "edited",
        color: LAYER_COLORS.edited,
        label: "Străzi editate",
        filter: "layer",
        off: !layers.editedStreets,
      });
    }
  }

  const schoolsOnMap = layers.schoolAssign || layers.schoolMarkers;
  const schoolItems: LegendSwatch[] = schoolsOnMap
    ? schoolList.map((s) => ({
        key: s.slug,
        color: schoolColor(s.slug),
        label: s.name,
        filter: "school" as const,
        off: !selectedSch.has(s.slug),
      }))
    : [];

  return { layers: layerItems, schools: schoolItems };
}
