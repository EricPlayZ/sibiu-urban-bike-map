import { hasAnyEdit, LAYER_COLORS, resolveStreetMeasurement, streetHasDoorZoneBikeLane, streetHasIllegalParking, streetHasSafeBikeLane, featureHasReservedParking, type Measurement } from "./space";
import { streetSchoolSlugs } from "./schoolCatchment";
import { schoolColor } from "./schoolColors";
import { BIKE_DOOR_LABEL, BIKE_SAFE_LABEL, type LayerVisibility } from "./layers";

export type LegendSwatch = { key: string; color: string; label: string };

const BUILDING_ITEMS: LegendSwatch[] = [
  { key: "casa", color: "#2f9e44", label: "Casă" },
  { key: "bloc", color: "#e03131", label: "Bloc" },
  { key: "altceva", color: "#868e96", label: "Altceva" },
  { key: "necunoscut", color: "#ced4da", label: "Necunoscut" },
];

export function mapLegendItems(opts: {
  layers: LayerVisibility;
  editMode: boolean;
  schoolList: { slug: string; name: string }[];
  selectedSchools: string[];
  streets: GeoJSON.FeatureCollection | null;
  measurements: Record<string, Measurement>;
  seedMeasurements: Record<string, Measurement>;
  neighborhoods: string[];
}): { layers: LegendSwatch[]; schools: LegendSwatch[] } {
  const { layers, editMode, schoolList, selectedSchools, streets, measurements, seedMeasurements, neighborhoods } =
    opts;
  const selectedNb = new Set(neighborhoods);
  const selectedSch = new Set(selectedSchools);
  const feats = (streets?.features || []).filter((f) => {
    const cartier = String((f.properties as { cartier?: string })?.cartier || "").trim();
    return Boolean(cartier) && selectedNb.has(cartier);
  });
  const resolved = feats.map((f) => {
    const props = (f.properties || {}) as Record<string, unknown>;
    const sid = String(props.sid || "");
    return { props, m: resolveStreetMeasurement(sid, props, measurements, seedMeasurements) };
  });

  const layerItems: LegendSwatch[] = [];
  if (layers.buildings) {
    layerItems.push(...BUILDING_ITEMS);
  } else {
    const safeBike = resolved.some(({ props, m }) => streetHasSafeBikeLane(props, m));
    const doorBike = resolved.some(({ props, m }) => streetHasDoorZoneBikeLane(props, m));
    const illegal = resolved.some(({ props, m }) => streetHasIllegalParking(props, m));
    const reserved = feats.some((f) => featureHasReservedParking((f.properties || {}) as Record<string, unknown>));
    if (layers.streetsBase) layerItems.push({ key: "base", color: LAYER_COLORS.base, label: "Stradă (bază)" });
    if (layers.bike && safeBike) layerItems.push({ key: "bike", color: LAYER_COLORS.bike, label: BIKE_SAFE_LABEL });
    if (layers.bikeDoor && doorBike)
      layerItems.push({ key: "bikeDoor", color: LAYER_COLORS.bikeDoor, label: BIKE_DOOR_LABEL });
    if (layers.reserved && reserved)
      layerItems.push({ key: "reserved", color: LAYER_COLORS.reserved, label: "Parcare amenajată pe trotuar" });
    if (layers.illegal && illegal)
      layerItems.push({ key: "illegal", color: LAYER_COLORS.illegal, label: "Parcare ilegală pe trotuar" });
    if (editMode && Object.values(measurements).some(hasAnyEdit)) {
      layerItems.push({ key: "edited", color: LAYER_COLORS.edited, label: "Măsurători pe dispozitiv" });
    }
  }

  const schoolItems: LegendSwatch[] =
    layers.schoolAssign || layers.schoolMarkers
      ? schoolList
          .filter((s) => selectedSch.has(s.slug))
          .map((s) => ({ key: s.slug, color: schoolColor(s.slug), label: s.name }))
      : [];

  return { layers: layerItems, schools: schoolItems };
}
