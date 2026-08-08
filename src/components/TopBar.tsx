import { motion, AnimatePresence } from "framer-motion";
import {
  Bike,
  Building2,
  Download,
  Filter,
  Layers,
  ListTree,
  Map as MapIcon,
  Moon,
  Pencil,
  Pentagon,
  Sun,
  ChartColumn,
  Monitor,
  GraduationCap,
  X,
} from "lucide-react";
import { useApp } from "../store";
import { BASEMAPS } from "../lib/basemaps";
import type { BasemapId } from "../lib/space";
import { hasAnyEdit } from "../lib/space";
import type { UiTheme } from "../lib/theme";
import { layersMatchPreset } from "../lib/layers";

export function TopBar() {
  const editMode = useApp((s) => s.editMode);
  const setEditMode = useApp((s) => s.setEditMode);
  const setViewMode = useApp((s) => s.setViewMode);
  const layers = useApp((s) => s.layers);
  const toggleFilters = useApp((s) => s.toggleFilters);
  const toggleBasemap = useApp((s) => s.toggleBasemap);
  const toggleStats = useApp((s) => s.toggleStats);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const toggleEdits = useApp((s) => s.toggleEdits);
  const filtersOpen = useApp((s) => s.filtersOpen);
  const basemapOpen = useApp((s) => s.basemapOpen);
  const themeOpen = useApp((s) => s.themeOpen);
  const statsOpen = useApp((s) => s.statsOpen);
  const editsOpen = useApp((s) => s.editsOpen);
  const measurements = useApp((s) => s.measurements);
  const startDraw = useApp((s) => s.startDraw);
  const cancelDraw = useApp((s) => s.cancelDraw);
  const drawing = useApp((s) => s.drawing);
  const doExport = useApp((s) => s.doExport);
  const basemap = useApp((s) => s.basemap);
  const setBasemap = useApp((s) => s.setBasemap);
  const uiTheme = useApp((s) => s.uiTheme);
  const setUiTheme = useApp((s) => s.setUiTheme);
  const editsCount = Object.values(measurements).filter(hasAnyEdit).length;

  return (
    <>
      <motion.header
        className="topbar"
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
      >
        <div className="brand-block">
          <span className="brand-mark" aria-hidden />
          <div>
            <div className="brand-title">Map the City</div>
            <div className="brand-sub">Sibiu</div>
          </div>
        </div>

        <div className="seg" role="group" aria-label="Mod vizualizare">
          <button type="button" className={layersMatchPreset(layers, "space", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("space")}>
            <Bike size={16} strokeWidth={2.25} aria-hidden />
            Spațiu
          </button>
          <button type="button" className={layersMatchPreset(layers, "buildings", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("buildings")}>
            <Building2 size={16} strokeWidth={2.25} aria-hidden />
            Clădiri
          </button>
          <button type="button" className={layersMatchPreset(layers, "schools", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("schools")}>
            <GraduationCap size={16} strokeWidth={2.25} aria-hidden />
            Școli
          </button>
        </div>

        <div className="top-actions">
          <button type="button" className={`chip-btn ${filtersOpen ? "on" : ""}`} onClick={toggleFilters} aria-pressed={filtersOpen}>
            <Filter size={16} strokeWidth={2.25} aria-hidden />
            Filtre
          </button>
          <button type="button" className={`chip-btn ${basemapOpen ? "on" : ""}`} onClick={toggleBasemap} aria-pressed={basemapOpen}>
            <Layers size={16} strokeWidth={2.25} aria-hidden />
            Hartă
          </button>
          <button type="button" className={`chip-btn ${themeOpen ? "on" : ""}`} onClick={toggleTheme} title="Temă interfață" aria-pressed={themeOpen}>
            {uiTheme === "dark" ? <Moon size={16} /> : uiTheme === "light" ? <Sun size={16} /> : <Monitor size={16} />}
            Temă
          </button>
          <button type="button" className={`chip-btn ${statsOpen ? "on" : ""}`} onClick={toggleStats} aria-pressed={statsOpen}>
            <ChartColumn size={16} strokeWidth={2.25} aria-hidden />
            Stats
          </button>
          <button type="button" className={`chip-btn ${editsOpen ? "on" : ""}`} onClick={toggleEdits} aria-pressed={editsOpen}>
            <ListTree size={16} strokeWidth={2.25} aria-hidden />
            Editări{editsCount > 0 ? ` (${editsCount})` : ""}
          </button>
          <button type="button" className={`chip-btn edit ${editMode ? "on" : ""}`} onClick={() => setEditMode(!editMode)}>
            <Pencil size={16} strokeWidth={2.25} aria-hidden />
            {editMode ? "Editare ON" : "Editare"}
          </button>
        </div>
      </motion.header>

      <AnimatePresence>
        {editMode && (
          <motion.div className="edit-rail" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <button type="button" className={drawing ? "on" : ""} onClick={() => (drawing ? cancelDraw() : startDraw())}>
              {drawing ? <X size={16} /> : <Pentagon size={16} />}
              {drawing ? "Anulează desen" : "Desenează cartier"}
            </button>
            <button type="button" onClick={doExport}>
              <Download size={16} />
              Export JSON
            </button>
            {drawing && <span className="pulse-hint">Click colțuri · dublu-click = gata</span>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {basemapOpen && (
          <motion.div
            className="popover basemap-pop"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6, pointerEvents: "none", transition: { pointerEvents: { duration: 0 } } }}
          >
            <div className="pop-title">
              <MapIcon size={18} /> Fundal hartă
            </div>
            <div className="basemap-grid">
              {(Object.keys(BASEMAPS) as BasemapId[]).map((id) => (
                <button key={id} type="button" className={`basemap-card ${basemap === id ? "on" : ""} bm-${id}`} onClick={() => setBasemap(id)}>
                  <span>{BASEMAPS[id].label}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {themeOpen && (
          <motion.div
            className="popover theme-pop"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6, pointerEvents: "none", transition: { pointerEvents: { duration: 0 } } }}
          >
            <div className="pop-title">Temă interfață</div>
            <div className="theme-grid">
              {(
                [
                  ["system", "Sistem", Monitor],
                  ["light", "Luminos", Sun],
                  ["dark", "Întunecat", Moon],
                ] as [UiTheme, string, typeof Sun][]
              ).map(([id, label, Icon]) => (
                <button key={id} type="button" className={`theme-card ${uiTheme === id ? "on" : ""}`} onClick={() => setUiTheme(id)}>
                  <Icon size={20} strokeWidth={2.25} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <p className="hint-text">„Sistem” urmează setarea OS / browser (Windows, macOS, iOS, Android, Linux).</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
