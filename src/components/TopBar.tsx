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
  Sun,
  ChartColumn,
  Monitor,
  GraduationCap,
  Bug,
  Table2,
} from "lucide-react";
import { useApp } from "../store";
import { SearchControl } from "./SearchControl";
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
  const toggleImportReport = useApp((s) => s.toggleImportReport);
  const toggleCsvEditor = useApp((s) => s.toggleCsvEditor);
  const filtersOpen = useApp((s) => s.filtersOpen);
  const basemapOpen = useApp((s) => s.basemapOpen);
  const themeOpen = useApp((s) => s.themeOpen);
  const statsOpen = useApp((s) => s.statsOpen);
  const editsOpen = useApp((s) => s.editsOpen);
  const importReportOpen = useApp((s) => s.importReportOpen);
  const csvEditorOpen = useApp((s) => s.csvEditorOpen);
  const importReport = useApp((s) => s.importReport);
  const measurements = useApp((s) => s.measurements);
  const doExport = useApp((s) => s.doExport);
  const basemap = useApp((s) => s.basemap);
  const setBasemap = useApp((s) => s.setBasemap);
  const uiTheme = useApp((s) => s.uiTheme);
  const setUiTheme = useApp((s) => s.setUiTheme);
  const editsCount = Object.values(measurements).filter(hasAnyEdit).length;
  const importErrorCount = importReport ? importReport.issues.filter((i) => i.severity === "error").length : 0;
  const importLabel = importErrorCount > 0 ? `Import (${importErrorCount})` : "Import";
  const editsLabel = editsCount > 0 ? `Editări (${editsCount})` : "Editări";
  const editLabel = editMode ? "Editare ON" : "Editare";

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

        <SearchControl />

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
          <button type="button" className={`chip-btn ${filtersOpen ? "on" : ""}`} onClick={toggleFilters} title="Filtre" aria-label="Filtre" aria-pressed={filtersOpen}>
            <Filter size={16} strokeWidth={2.25} aria-hidden />
            <span className="chip-label" aria-hidden>Filtre</span>
          </button>
          <button type="button" className={`chip-btn ${basemapOpen ? "on" : ""}`} onClick={toggleBasemap} title="Hartă" aria-label="Hartă" aria-pressed={basemapOpen}>
            <Layers size={16} strokeWidth={2.25} aria-hidden />
            <span className="chip-label" aria-hidden>Hartă</span>
          </button>
          <button type="button" className={`chip-btn ${themeOpen ? "on" : ""}`} onClick={toggleTheme} title="Temă" aria-label="Temă" aria-pressed={themeOpen}>
            {uiTheme === "dark" ? <Moon size={16} /> : uiTheme === "light" ? <Sun size={16} /> : <Monitor size={16} />}
            <span className="chip-label" aria-hidden>Temă</span>
          </button>
          <button type="button" className={`chip-btn ${statsOpen ? "on" : ""}`} onClick={toggleStats} title="Stats" aria-label="Stats" aria-pressed={statsOpen}>
            <ChartColumn size={16} strokeWidth={2.25} aria-hidden />
            <span className="chip-label" aria-hidden>Stats</span>
          </button>
          <button type="button" className={`chip-btn ${importReportOpen ? "on" : ""}`} onClick={toggleImportReport} title={importLabel} aria-label={importLabel} aria-pressed={importReportOpen}>
            <Bug size={16} strokeWidth={2.25} aria-hidden />
            <span className="chip-label" aria-hidden>{importLabel}</span>
          </button>
          {import.meta.env.DEV ? (
            <button
              type="button"
              className={`chip-btn ${csvEditorOpen ? "on" : ""}`}
              onClick={toggleCsvEditor}
              title="Măsurători spreadsheet"
              aria-label="Măsurători spreadsheet"
              aria-pressed={csvEditorOpen}
            >
              <Table2 size={16} strokeWidth={2.25} aria-hidden />
              <span className="chip-label" aria-hidden>Sheets</span>
            </button>
          ) : null}
          <button type="button" className={`chip-btn ${editsOpen ? "on" : ""}`} onClick={toggleEdits} title={editsLabel} aria-label={editsLabel} aria-pressed={editsOpen}>
            <ListTree size={16} strokeWidth={2.25} aria-hidden />
            <span className="chip-label" aria-hidden>{editsLabel}</span>
          </button>
          <button type="button" className={`chip-btn edit ${editMode ? "on" : ""}`} onClick={() => setEditMode(!editMode)} title={editLabel} aria-label={editLabel} aria-pressed={editMode}>
            <Pencil size={16} strokeWidth={2.25} aria-hidden />
            <span className="chip-label" aria-hidden>{editLabel}</span>
          </button>
        </div>
      </motion.header>

      <AnimatePresence>
        {editMode && (
          <motion.div className="edit-rail" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <button type="button" onClick={doExport}>
              <Download size={16} />
              Export JSON
            </button>
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
