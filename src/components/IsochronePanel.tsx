import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bike, Crosshair, Footprints, GraduationCap, LandPlot, Map, MapPin, Pin, Route, Timer } from "lucide-react";
import { panelSpring, springExit } from "../lib/uiMotion";
import { BIKE_KMH, ISOCHRONE_MINUTES, WALK_KMH, type IsochroneMinutes } from "../lib/isochrone";
import { formatStatNumber, shortSchoolName, type IsochroneStats } from "../lib/isochroneStats";
import { useApp } from "../store";

function fineHover() {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function IsochronePanel() {
  const viewMode = useApp((s) => s.viewMode);
  const editMode = useApp((s) => s.editMode);
  const profile = useApp((s) => s.isochroneProfile);
  const minutes = useApp((s) => s.isochroneMinutes);
  const pinned = useApp((s) => s.isochronePinned);
  const stats = useApp((s) => s.isochroneStats);
  const setProfile = useApp((s) => s.setIsochroneProfile);
  const setMinutes = useApp((s) => s.setIsochroneMinutes);
  const setPinned = useApp((s) => s.setIsochronePinned);
  const open = viewMode === "reach";
  const live = fineHover() && !pinned;
  const hasStats = Boolean(stats.here || stats.reachable);

  const hint = live
    ? "Izocrona urmărește cursorul. Click pe hartă ca să fixezi punctul."
    : pinned
      ? "Punct fixat — detaliile sunt pe pin."
      : "Atinge harta ca să plasezi punctul.";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === "b" || e.key === "B") useApp.getState().setIsochroneProfile("bike");
      else if (e.key === "p" || e.key === "P") useApp.getState().setIsochroneProfile("walk");
      else if (e.key === "Escape") {
        const st = useApp.getState();
        if (st.isochronePinned) st.setIsochronePinned(false);
        else st.clearIsochrone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className={`reach-hud ${editMode ? "is-below-edit" : ""} ${profile}`}
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={springExit({ opacity: 0, y: -8, scale: 0.98 })}
          transition={panelSpring}
          aria-label="Mod acces"
        >
          <div className="reach-hud-head">
            <div className="reach-hud-title">
              <Timer size={16} strokeWidth={2.25} aria-hidden />
              Acces
            </div>
            {fineHover() ? (
              <button
                type="button"
                className={`reach-live-btn ${live ? "on" : ""}`}
                onClick={() => setPinned(!pinned)}
                aria-pressed={live}
                title={live ? "Urmărește cursorul" : "Fixează unde e cursorul acum"}
              >
                {live ? <Crosshair size={14} strokeWidth={2.4} /> : <Pin size={14} strokeWidth={2.4} />}
                {live ? "Live" : "Fixat"}
              </button>
            ) : null}
          </div>

          <p className="reach-hud-hint">{hint}</p>

          <div className="reach-hud-modes" role="radiogroup" aria-label="Mod de deplasare">
            <button
              type="button"
              className={`reach-mode bike ${profile === "bike" ? "on" : ""}`}
              onClick={() => setProfile("bike")}
              aria-pressed={profile === "bike"}
              aria-label={`Ciclopietonal, ${BIKE_KMH} km/h`}
            >
              <span className="reach-mode-main">
                <Bike size={16} strokeWidth={2.25} aria-hidden />
                Ciclopietonal
              </span>
              <span className="reach-mode-speed">
                {BIKE_KMH}
                <small>km/h</small>
              </span>
            </button>
            <button
              type="button"
              className={`reach-mode walk ${profile === "walk" ? "on" : ""}`}
              onClick={() => setProfile("walk")}
              aria-pressed={profile === "walk"}
              aria-label={`Pietonal, ${WALK_KMH} km/h`}
            >
              <span className="reach-mode-main">
                <Footprints size={16} strokeWidth={2.25} aria-hidden />
                Pietonal
              </span>
              <span className="reach-mode-speed">
                {WALK_KMH}
                <small>km/h</small>
              </span>
            </button>
          </div>

          <div className="reach-times" role="radiogroup" aria-label="Timp">
            {ISOCHRONE_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                className={minutes === m ? "on" : ""}
                onClick={() => setMinutes(m as IsochroneMinutes)}
                aria-pressed={minutes === m}
              >
                {m} min
              </button>
            ))}
          </div>

          {hasStats ? <ReachStatsCard stats={stats} /> : null}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function ReachStatsCard({ stats }: { stats: IsochroneStats }) {
  const place = stats.here || "În afara cartierelor";
  const schools = stats.schoolNames.map(shortSchoolName);

  return (
    <div className="reach-hud-stats">
      <div className="reach-stat-loc">
        <MapPin size={15} strokeWidth={2.3} aria-hidden />
        <div>
          <span className="reach-stat-kicker">{stats.here ? "Ești în" : "Locație"}</span>
          <strong>{place}</strong>
        </div>
      </div>

      {stats.reachable ? (
        <>
          <div className="reach-stat-metrics">
            <div className="reach-stat-metric">
              <LandPlot size={14} strokeWidth={2.2} aria-hidden />
              <b>{formatStatNumber(stats.areaKm2)}</b>
              <span>km²</span>
            </div>
            <div className="reach-stat-metric">
              <Route size={14} strokeWidth={2.2} aria-hidden />
              <b>{formatStatNumber(stats.streetKm)}</b>
              <span>km străzi</span>
            </div>
          </div>

          {stats.reached.length > 0 ? (
            <ChipBlock
              icon={<Map size={13} strokeWidth={2.2} aria-hidden />}
              label="Cartiere"
              count={stats.reached.length}
              names={stats.reached}
              countLabel={stats.reached.length === 1 ? "cartier" : "cartiere"}
            />
          ) : null}

          {stats.schoolCount > 0 ? (
            <ChipBlock
              icon={<GraduationCap size={13} strokeWidth={2.2} aria-hidden />}
              label="Școli"
              count={stats.schoolCount}
              names={schools}
              countLabel={stats.schoolCount === 1 ? "școală" : "școli"}
            />
          ) : null}
        </>
      ) : (
        <p className="reach-stat-empty">Mută punctul mai aproape de o stradă din rețea.</p>
      )}
    </div>
  );
}

function ChipBlock({
  icon,
  label,
  count,
  names,
  countLabel,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  names: string[];
  countLabel: string;
}) {
  return (
    <div className="reach-stat-block">
      <div className="reach-stat-label">
        {icon}
        <span>{label}</span>
        <em>
          {count} {countLabel}
        </em>
      </div>
      <div className="reach-chips">
        {names.map((name, i) => (
          <span key={`${name}-${i}`} className="reach-chip">
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
