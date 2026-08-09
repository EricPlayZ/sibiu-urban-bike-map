import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useApp } from "../store";
import {
  featureHasIllegalParking,
  featureHasReservedParking,
  hasAnyEdit,
  LAYER_COLORS,
  resolveStreetMeasurement,
  streetHasDoorZoneBikeLane,
  streetHasSafeBikeLane,
} from "../lib/space";

function streetLengthM(props: Record<string, unknown>) {
  const n = Number(props.length ?? props.length_m);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function formatKm(meters: number) {
  const km = meters / 1000;
  return km.toLocaleString("ro-RO", {
    maximumFractionDigits: 1,
    minimumFractionDigits: km > 0 && km < 10 ? 1 : 0,
  });
}

export function StatsPanel() {
  const open = useApp((s) => s.statsOpen);
  const streets = useApp((s) => s.streets);
  const schools = useApp((s) => s.schools);
  const measurements = useApp((s) => s.measurements);
  const seedMeasurements = useApp((s) => s.seedMeasurements);
  const filters = useApp((s) => s.filters);
  const layers = useApp((s) => s.layers);
  const editMode = useApp((s) => s.editMode);

  const selected = new Set(filters.neighborhoods);
  const selectedSchools = new Set(filters.schools);
  const feats = (streets?.features || []).filter((f) => {
    const cartier = String((f.properties as { cartier?: string })?.cartier || "").trim();
    return Boolean(cartier) && selected.has(cartier);
  });

  const resolved = feats.map((f) => {
    const props = (f.properties || {}) as Record<string, unknown>;
    const sid = String(props.sid || "");
    const m = resolveStreetMeasurement(sid, props, measurements, seedMeasurements);
    return { f, props, m };
  });

  const safeBikeFeats = resolved.filter(({ props, m }) => streetHasSafeBikeLane(props, m));
  const doorBikeFeats = resolved.filter(({ props, m }) => streetHasDoorZoneBikeLane(props, m));
  const illegalFeats = resolved.filter(({ props }) => featureHasIllegalParking(props));
  const reservedFeats = resolved.filter(({ props }) => featureHasReservedParking(props));
  const assigned = feats.filter((f) => {
    const slug = String((f.properties as { arondat?: string })?.arondat || "").trim();
    return Boolean(slug) && selectedSchools.has(slug);
  }).length;
  const editedLocal = Object.values(measurements).filter(hasAnyEdit).length;
  const schoolCount = (schools?.features || []).filter((f) => {
    const slug = String((f.properties as { slug?: string })?.slug || "");
    return !slug || selectedSchools.has(slug);
  }).length;

  const safeBike = safeBikeFeats.length;
  const doorBike = doorBikeFeats.length;
  const illegal = illegalFeats.length;
  const reserved = reservedFeats.length;
  const safeBikeM = safeBikeFeats.reduce((s, { props }) => s + streetLengthM(props), 0);
  const doorBikeM = doorBikeFeats.reduce((s, { props }) => s + streetLengthM(props), 0);
  const bikeM = safeBikeM + doorBikeM;
  const illegalM = illegalFeats.reduce((s, { props }) => s + streetLengthM(props), 0);
  const reservedM = reservedFeats.reduce((s, { props }) => s + streetLengthM(props), 0);

  const legend: { color: string; label: string }[] = [];
  if (layers.buildings) {
    legend.push(
      { color: "#2f9e44", label: "Casă" },
      { color: "#e03131", label: "Bloc" },
      { color: "#868e96", label: "Altceva" },
      { color: "#ced4da", label: "Necunoscut" }
    );
  } else {
    if (layers.streetsBase) legend.push({ color: LAYER_COLORS.base, label: "Stradă (bază)" });
    if (layers.bike && safeBike > 0) legend.push({ color: LAYER_COLORS.bike, label: "Pistă biciclete" });
    if (layers.bikeDoor && doorBike > 0) legend.push({ color: LAYER_COLORS.bikeDoor, label: "Pistă pe carosabil" });
    if (layers.reserved && reserved > 0) legend.push({ color: LAYER_COLORS.reserved, label: "Parcare amenajată pe trotuar" });
    if (layers.illegal && illegal > 0) legend.push({ color: LAYER_COLORS.illegal, label: "Parcare ilegală pe trotuar" });
    if (layers.schoolAssign && assigned > 0) {
      legend.push({ color: LAYER_COLORS.schoolAssign, label: "Arondată unei școli" });
    }
    if (editMode && editedLocal > 0) {
      legend.push({ color: LAYER_COLORS.edited, label: "Măsurători pe dispozitiv" });
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="panel stats-panel"
          initial={{ x: 28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 20, opacity: 0, pointerEvents: "none" }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
        >
          <div className="panel-head">
            <h2>Statistici</h2>
            <button type="button" className="icon-x" onClick={() => useApp.getState().closeStats()} aria-label="Închide">
              <X size={18} strokeWidth={2.25} />
            </button>
          </div>

          <div className="stat-hero">
            <div className="stat-hero-num">
              {formatKm(bikeM)}
              <span className="stat-hero-unit"> km</span>
            </div>
            <div className="stat-hero-label">pistă de biciclete în cartierele selectate</div>
          </div>

          <div className="stat-row">
            <span>Pistă biciclete</span>
            <b>
              {safeBike}
              {safeBikeM > 0 ? <small> · {formatKm(safeBikeM)} km</small> : null}
            </b>
          </div>
          <div className="stat-row">
            <span>Pistă pe carosabil</span>
            <b>
              {doorBike}
              {doorBikeM > 0 ? <small> · {formatKm(doorBikeM)} km</small> : null}
            </b>
          </div>
          <div className="stat-row">
            <span>Parcare ilegală pe trotuar</span>
            <b>
              {illegal}
              {illegalM > 0 ? <small> · {formatKm(illegalM)} km</small> : null}
            </b>
          </div>
          <div className="stat-row">
            <span>Parcare amenajată pe trotuar</span>
            <b>
              {reserved}
              {reservedM > 0 ? <small> · {formatKm(reservedM)} km</small> : null}
            </b>
          </div>
          <div className="stat-row">
            <span>Școli pe hartă</span>
            <b>{schoolCount}</b>
          </div>
          {layers.schoolAssign && (
            <div className="stat-row">
              <span>Străzi arondate</span>
              <b>{assigned}</b>
            </div>
          )}
          {editedLocal > 0 && (
            <div className="stat-row">
              <span>Editări locale</span>
              <b>{editedLocal}</b>
            </div>
          )}

          <p className="stats-note">Valorile urmează cartierele și școlile selectate în Filtre.</p>
          <div className="legend-mini">
            {legend.map((item) => (
              <span key={item.label}>
                <i style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
