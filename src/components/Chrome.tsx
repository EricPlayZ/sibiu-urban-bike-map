import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { Bike, Building2, ChartColumn, Filter, GraduationCap, Layers, ListTree, Monitor, Moon, Pencil, Sun } from "lucide-react";
import { useApp } from "../store";
import { layersMatchPreset } from "../lib/layers";
import { hasAnyEdit } from "../lib/space";

export function Toast() {
  const toast = useApp((s) => s.toast);
  return (
    <AnimatePresence>
      {toast && (
        <motion.div className="toast" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} role="status">
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Loader() {
  const ready = useApp((s) => s.ready);
  const msg = useApp((s) => s.loadingMsg);
  if (ready && !msg) return null;
  return (
    <div className="loader">
      <div className="loader-card">
        <div className="loader-spin" />
        <div>
          <div className="brand-title">Map the City</div>
          <div className="brand-sub">{msg || "Se încarcă…"}</div>
        </div>
      </div>
    </div>
  );
}

export function MobileDock() {
  const setViewMode = useApp((s) => s.setViewMode);
  const layers = useApp((s) => s.layers);
  const editMode = useApp((s) => s.editMode);
  const setEditMode = useApp((s) => s.setEditMode);
  const toggleFilters = useApp((s) => s.toggleFilters);
  const toggleBasemap = useApp((s) => s.toggleBasemap);
  const toggleStats = useApp((s) => s.toggleStats);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const toggleEdits = useApp((s) => s.toggleEdits);
  const themeOpen = useApp((s) => s.themeOpen);
  const filtersOpen = useApp((s) => s.filtersOpen);
  const basemapOpen = useApp((s) => s.basemapOpen);
  const statsOpen = useApp((s) => s.statsOpen);
  const editsOpen = useApp((s) => s.editsOpen);
  const measurements = useApp((s) => s.measurements);
  const uiTheme = useApp((s) => s.uiTheme);
  const ThemeIcon = uiTheme === "dark" ? Moon : uiTheme === "light" ? Sun : Monitor;
  const editsCount = Object.values(measurements).filter(hasAnyEdit).length;
  const dockRef = useRef<HTMLElement>(null);

  // Panourile stau la același gap (8px) deasupra dock-ului de sus, măsurat din layout real.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const sync = () => {
      const top = dock.getBoundingClientRect().top;
      const gap = 8; // la fel ca gap-ul dintre cele două rânduri de dock
      const panelBottom = Math.max(0, window.innerHeight - top + gap);
      document.documentElement.style.setProperty("--mobile-panel-bottom", `${panelBottom}px`);
      document.documentElement.style.setProperty("--mobile-dock-top", `${Math.max(0, window.innerHeight - top)}px`);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(dock);
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
    };
  }, []);

  return (
    <nav ref={dockRef} className="mobile-dock" aria-label="Navigare rapidă">
      <div className="mobile-dock-row" role="group" aria-label="Mod și filtre">
        <button type="button" className={layersMatchPreset(layers, "space", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("space")}>
          <Bike size={18} strokeWidth={2.25} />
          <span>Spațiu</span>
        </button>
        <button type="button" className={layersMatchPreset(layers, "buildings", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("buildings")}>
          <Building2 size={18} strokeWidth={2.25} />
          <span>Clădiri</span>
        </button>
        <button type="button" className={layersMatchPreset(layers, "schools", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("schools")}>
          <GraduationCap size={18} strokeWidth={2.25} />
          <span>Școli</span>
        </button>
        <button type="button" className={filtersOpen ? "on" : ""} onClick={toggleFilters} aria-pressed={filtersOpen}>
          <Filter size={18} strokeWidth={2.25} />
          <span>Filtre</span>
        </button>
      </div>
      <div className="mobile-dock-row mobile-dock-tools with-edits" role="group" aria-label="Unelte">
        <button type="button" className={basemapOpen ? "on" : ""} onClick={toggleBasemap} aria-pressed={basemapOpen}>
          <Layers size={18} strokeWidth={2.25} />
          <span>Hartă</span>
        </button>
        <button type="button" className={editMode ? "on" : ""} onClick={() => setEditMode(!editMode)} aria-pressed={editMode}>
          <Pencil size={18} strokeWidth={2.25} />
          <span>Edit</span>
        </button>
        <button type="button" className={editsOpen ? "on" : ""} onClick={toggleEdits} aria-pressed={editsOpen}>
          <ListTree size={18} strokeWidth={2.25} />
          <span>Editări{editsCount > 0 ? ` (${editsCount})` : ""}</span>
        </button>
        <button type="button" className={themeOpen ? "on" : ""} onClick={toggleTheme} aria-pressed={themeOpen}>
          <ThemeIcon size={18} strokeWidth={2.25} />
          <span>Temă</span>
        </button>
        <button type="button" className={statsOpen ? "on" : ""} onClick={toggleStats} aria-pressed={statsOpen}>
          <ChartColumn size={18} strokeWidth={2.25} />
          <span>Stats</span>
        </button>
      </div>
    </nav>
  );
}
