import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useApp } from "../store";
import {
  featureHasBikeLane,
  featureHasIllegalParking,
  featureHasReservedParking,
  hasAnyEdit,
  LAYER_COLORS,
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
  const filters = useApp((s) => s.filters);
  const layers = useApp((s) => s.layers);
  const editMode = useApp((s) => s.editMode);

  const selected = new Set(filters.neighborhoods);
  // Doar străzi din cartierele selectate (fără cele fără cartier — altfel cifra e înșelătoare)
  const feats = (streets?.features || []).filter((f) => {
    const cartier = String((f.properties as { cartier?: string })?.cartier || "").trim();
    return Boolean(cartier) && selected.has(cartier);
  });

  const bikeFeats = feats.filter((f) => featureHasBikeLane(f.properties as Record<string, unknown>));
  const illegalFeats = feats.filter((f) => featureHasIllegalParking(f.properties as Record<string, unknown>));
  const reservedFeats = feats.filter((f) => featureHasReservedParking(f.properties as Record<string, unknown>));
  const assigned = feats.filter((f) => Boolean(String((f.properties as { arondat?: string })?.arondat || "").trim())).length;
  const editedLocal = Object.values(measurements).filter(hasAnyEdit).length;
  const schoolCount = schools?.features.length || 0;

  const bike = bikeFeats.length;
  const illegal = illegalFeats.length;
  const reserved = reservedFeats.length;
  const bikeM = bikeFeats.reduce((s, f) => s + streetLengthM((f.properties || {}) as Record<string, unknown>), 0);
  const illegalM = illegalFeats.reduce((s, f) => s + streetLengthM((f.properties || {}) as Record<string, unknown>), 0);
  const reservedM = reservedFeats.reduce((s, f) => s + streetLengthM((f.properties || {}) as Record<string, unknown>), 0);

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
    if (layers.bike && bike > 0) legend.push({ color: LAYER_COLORS.bike, label: "Pistă biciclete" });
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
              {bike}
              {bikeM > 0 ? <small> · {formatKm(bikeM)} km</small> : null}
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

          <p className="stats-note">Valorile urmează cartierele selectate în Filtre. Culorile din legendă urmează straturile active pe hartă.</p>
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
