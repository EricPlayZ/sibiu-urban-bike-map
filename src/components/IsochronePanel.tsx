import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bike, ChevronDown, Crosshair, Footprints, GraduationCap, LandPlot, Map, MapPin, Pin, Route, Timer } from "lucide-react";
import { panelSpring, springExit } from "../lib/uiMotion";
import { BIKE_KMH, ISOCHRONE_MINUTES, WALK_KMH, type IsochroneMinutes } from "../lib/isochrone";
import {
  formatStatNumber,
  reachStatSections,
  shortSchoolName,
  type IsochroneStats,
  type ReachStatSectionId,
} from "../lib/isochroneStats";
import { useApp } from "../store";

function fineHover() {
    return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function IsochronePanel() {
  const viewMode = useApp((s) => s.viewMode);
  const profile = useApp((s) => s.isochroneProfile);
  const minutes = useApp((s) => s.isochroneMinutes);
  const pinned = useApp((s) => s.isochronePinned);
  const stats = useApp((s) => s.isochroneStats);
  const hudOpen = useApp((s) => s.reachHudOpen);
  const toggleHud = useApp((s) => s.toggleReachHud);
  const setProfile = useApp((s) => s.setIsochroneProfile);
  const setMinutes = useApp((s) => s.setIsochroneMinutes);
  const setPinned = useApp((s) => s.setIsochronePinned);
  const open = viewMode === "reach";
  const live = fineHover() && !pinned;
  const hasStats = Boolean(stats.here || stats.reachable);

  const hint = live
    ? "Izocrona urmărește cursorul. Click pe hartă ca să fixezi punctul."
    : pinned
      ? "Punct fixat — detaliile sunt aici, în colț."
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

  const ModeIcon = profile === "walk" ? Footprints : Bike;
  const summary = [
    `${minutes} min`,
    profile === "walk" ? "pietonal" : "ciclopietonal",
    stats.reachable ? `${formatStatNumber(stats.areaKm2)} km²` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className={`reach-hud ${profile} ${hudOpen ? "is-open" : "is-collapsed"}`}
          initial={{ opacity: 0, y: -8, scale: 0.98, pointerEvents: "auto" }}
          animate={{ opacity: 1, y: 0, scale: 1, pointerEvents: "auto" }}
          exit={springExit({ opacity: 0, y: -8, scale: 0.98 })}
          transition={{ ...panelSpring, pointerEvents: { duration: 0 } }}
          aria-label="Mod acces"
        >
          <div className="reach-hud-head">
            <button
              type="button"
              className="reach-hud-toggle"
              onClick={toggleHud}
              aria-expanded={hudOpen}
              aria-label={hudOpen ? "Restrânge panoul Acces" : "Extinde panoul Acces"}
            >
              <span className="reach-hud-title">
                <Timer size={16} strokeWidth={2.25} aria-hidden />
                Acces
              </span>
              {!hudOpen ? (
                <span className="reach-hud-summary">
                  <ModeIcon size={13} strokeWidth={2.3} aria-hidden />
                  {summary}
                </span>
              ) : null}
              <ChevronDown size={18} strokeWidth={2.4} className="reach-hud-chevron" aria-hidden />
            </button>
            {hudOpen && fineHover() ? (
              <button
                type="button"
                className={`reach-live-btn ${live ? "on" : ""}`}
                onClick={() => setPinned(!pinned)}
                aria-pressed={live}
              >
                {live ? <Crosshair size={14} strokeWidth={2.4} /> : <Pin size={14} strokeWidth={2.4} />}
                {live ? "Live" : "Fixat"}
              </button>
            ) : null}
          </div>

          <AnimatePresence initial={false}>
            {hudOpen ? (
              <motion.div
                key="reach-hud-body"
                className="reach-hud-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
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
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const SECTION_ICON: Record<ReachStatSectionId, typeof Map> = {
  coverage: LandPlot,
  streets: Route,
  neighborhoods: Map,
  schools: GraduationCap,
};

function ReachStatsCard({ stats }: { stats: IsochroneStats }) {
  const place = stats.here || "În afara cartierelor";
  const schools = stats.schoolNames.map(shortSchoolName);
  const sections = reachStatSections(stats);

  return (
    <div className="reach-hud-stats">
      <div className="reach-stat-loc">
        <MapPin size={15} strokeWidth={2.3} aria-hidden />
        <div>
          <span className="reach-stat-kicker">{stats.here ? "Ești în" : "Locație"}</span>
          <strong>{place}</strong>
        </div>
      </div>

      {sections.length > 0 ? (
        sections.map((section) => {
          const Icon = SECTION_ICON[section.id];
          return (
            <ReachFold
              key={section.id}
              sectionId={section.id}
              icon={<Icon size={13} strokeWidth={2.2} aria-hidden />}
              title={section.title}
              summary={section.summary}
            >
              <ReachSectionBody id={section.id} stats={stats} schools={schools} />
            </ReachFold>
          );
        })
      ) : (
        <p className="reach-stat-empty">Mută punctul mai aproape de o stradă din rețea.</p>
      )}
    </div>
  );
}

function ReachFold({
  icon,
  title,
  summary,
  sectionId,
  children,
}: {
  icon: ReactNode;
  title: string;
  summary: string;
  sectionId: string;
  children: ReactNode;
}) {
  return (
    <details className="reach-fold" data-reach-section={sectionId}>
      <summary>
        <span className="reach-fold-title">
          {icon}
          <span>{title}</span>
        </span>
        <span className="reach-fold-sum">{summary}</span>
      </summary>
      <div className="reach-fold-body">{children}</div>
    </details>
  );
}

function ReachSectionBody({ id, stats, schools }: { id: ReachStatSectionId; stats: IsochroneStats; schools: string[] }) {
  if (id === "coverage") {
    return (
      <div className="reach-stat-metric">
        <LandPlot size={14} strokeWidth={2.2} aria-hidden />
        <b>{formatStatNumber(stats.areaKm2)}</b>
        <span>km²</span>
      </div>
    );
  }
  if (id === "streets") {
    return (
      <div className="reach-stat-metric">
        <Route size={14} strokeWidth={2.2} aria-hidden />
        <b>{formatStatNumber(stats.streetKm)}</b>
        <span>km străzi</span>
      </div>
    );
  }
  const names = id === "neighborhoods" ? stats.reached : schools;
  if (!names.length) return null;
  return (
    <div className="reach-chips">
      {names.map((name, i) => (
        <span key={`${name}-${i}`} className="reach-chip">
          {name}
        </span>
      ))}
    </div>
  );
}
