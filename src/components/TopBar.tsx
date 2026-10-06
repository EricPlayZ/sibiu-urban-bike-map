import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bike,
  Building2,
  Filter,
  Layers,
  ListTree,
  LocateFixed,
  Map as MapIcon,
  Moon,
  Pencil,
  Sun,
  User,
  ChartColumn,
  LogOut,
  Monitor,
  GraduationCap,
  Bug,
  FileDown,
  Table2,
  Timer,
  Users,
} from "lucide-react";
import { countSavedEdits } from "../lib/editBundle";
import { useApp } from "../store";
import type { PresenceLock, PresenceUser } from "../lib/teamApi";
import { buildingFeatureForFocus, editMapHit, lockTargetLabel, streetFeatureForFocus } from "../lib/editFocus";
import { panelSpring, popExit } from "../lib/uiMotion";
import { SearchControl } from "./SearchControl";
import { BASEMAPS } from "../lib/basemaps";
import type { BasemapId } from "../lib/space";
import type { UiTheme } from "../lib/theme";
import { layersMatchPreset } from "../lib/layers";
import { Tip } from "./Tip";
import { openPrintDialog } from "./PrintDialog";

type TeamRow = PresenceUser & { self: boolean };

function teamMenuRows(presence: PresenceUser[], teamSid: string | null, teamName: string | null): TeamRow[] {
  const rows: TeamRow[] = presence.map((u) => ({
    ...u,
    self: Boolean(teamSid && u.sid === teamSid),
  }));
  if (!rows.some((u) => u.self)) {
    rows.unshift({
      sid: teamSid || "self",
      name: teamName?.trim() || "Tu",
      locks: [],
      self: true,
    });
  }
  return rows;
}

function teamMenuBox(btn: HTMLElement): CSSProperties {
  const r = btn.getBoundingClientRect();
  const width = Math.min(280, Math.max(220, window.innerWidth - 16));
  if (r.width < 1 && r.height < 1) {
    return { position: "fixed", top: 64, left: Math.max(8, window.innerWidth - width - 12), width, zIndex: 100 };
  }
  let left = r.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  return { position: "fixed", top: Math.max(8, r.bottom + 6), left, width, zIndex: 100 };
}

export function TopBar() {
  const editMode = useApp((s) => s.editMode);
  const toggleEditAccess = useApp((s) => s.toggleEditAccess);
  const viewMode = useApp((s) => s.viewMode);
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
  const committedEdits = useApp((s) => s.committedEdits);
  const streetSplits = useApp((s) => s.streetSplits);
  const basemap = useApp((s) => s.basemap);
  const setBasemap = useApp((s) => s.setBasemap);
  const uiTheme = useApp((s) => s.uiTheme);
  const setUiTheme = useApp((s) => s.setUiTheme);
  const teamAuthed = useApp((s) => s.teamAuthed);
  const teamName = useApp((s) => s.teamName);
  const teamSid = useApp((s) => s.teamSid);
  const presence = useApp((s) => s.presence);
  const pipelineStreetsRaw = useApp((s) => s.pipelineStreetsRaw);
  const streets = useApp((s) => s.streets);
  const buildingTypes = useApp((s) => s.buildingTypes);
  const buildings = useApp((s) => s.buildings);
  const focusEditsHit = useApp((s) => s.focusEditsHit);
  const showToast = useApp((s) => s.showToast);
  const teamLogout = useApp((s) => s.teamLogout);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const teamBtnRef = useRef<HTMLDivElement>(null);
  const teamMenuRef = useRef<HTMLDivElement>(null);
  const [teamMenuStyle, setTeamMenuStyle] = useState<CSSProperties | null>(null);
  const teamRows = teamMenuRows(presence, teamSid, teamName);
  const teamAlone = teamRows.length === 1;

  useLayoutEffect(() => {
    if (!teamMenuOpen) return;
    const place = () => {
      const btn = teamBtnRef.current;
      if (!btn) return;
      setTeamMenuStyle(teamMenuBox(btn));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [teamMenuOpen]);

  useEffect(() => {
    if (!teamAuthed) setTeamMenuOpen(false);
  }, [teamAuthed]);

  useEffect(() => {
    if (!teamMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTeamMenuOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (teamBtnRef.current?.contains(t)) return;
      if (teamMenuRef.current?.contains(t)) return;
      setTeamMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [teamMenuOpen]);

  const lockLabel = (lock: PresenceLock) =>
    lockTargetLabel(lock, { streets, pipeline: pipelineStreetsRaw, buildings, buildingTypes });

  const flyToLock = (lock: PresenceLock) => {
    const feature =
      lock.kind === "building"
        ? buildingFeatureForFocus(buildings, lock.id)
        : streetFeatureForFocus(streets, pipelineStreetsRaw, lock.id);
    const label = lockLabel(lock);
    const hit = editMapHit(
      `presence:${lock.kind}:${lock.id}`,
      label,
      lock.kind === "building" ? "Clădire" : "Stradă",
      feature,
    );
    if (!hit) {
      showToast("Nu găsesc geometria");
      return;
    }
    focusEditsHit(hit);
  };
  const editsCount = countSavedEdits(committedEdits, buildingTypes, streetSplits).total;
  const importErrorCount = importReport ? importReport.issues.filter((i) => i.severity === "error").length : 0;
  const importLabel = importErrorCount > 0 ? `Import (${importErrorCount})` : "Import";
  const editsLabel = editsCount > 0 ? `Editări (${editsCount})` : "Editări";
  const editLabel = editMode ? "Editare ON" : "Editare";
  const pencilLabel = teamAuthed ? editLabel : "Acces editare";

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
            Străzi
          </button>
          <button type="button" className={layersMatchPreset(layers, "buildings", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("buildings")}>
            <Building2 size={16} strokeWidth={2.25} aria-hidden />
            Clădiri
          </button>
          <button type="button" className={layersMatchPreset(layers, "schools", editMode ? { ignore: ["streetsBase"] } : undefined) ? "on" : ""} onClick={() => setViewMode("schools")}>
            <GraduationCap size={16} strokeWidth={2.25} aria-hidden />
            Școli
          </button>
          <Tip text="Izocrone 5 / 10 / 15 min">
            <button type="button" className={viewMode === "reach" ? "on" : ""} onClick={() => setViewMode("reach")} aria-pressed={viewMode === "reach"}>
              <Timer size={16} strokeWidth={2.25} aria-hidden />
              Acces
            </button>
          </Tip>
        </div>

        <div className="top-actions">
          <Tip text="Filtre">
            <button type="button" className={`chip-btn ${filtersOpen ? "on" : ""}`} onClick={toggleFilters} aria-label="Filtre" aria-pressed={filtersOpen}>
              <Filter size={16} strokeWidth={2.25} aria-hidden />
              <span className="chip-label" aria-hidden>Filtre</span>
            </button>
          </Tip>
          <Tip text="Hartă">
            <button type="button" className={`chip-btn ${basemapOpen ? "on" : ""}`} onClick={toggleBasemap} aria-label="Hartă" aria-pressed={basemapOpen}>
              <Layers size={16} strokeWidth={2.25} aria-hidden />
              <span className="chip-label" aria-hidden>Hartă</span>
            </button>
          </Tip>
          <Tip text="Temă">
            <button type="button" className={`chip-btn ${themeOpen ? "on" : ""}`} onClick={toggleTheme} aria-label="Temă" aria-pressed={themeOpen}>
              {uiTheme === "dark" ? <Moon size={16} /> : uiTheme === "light" ? <Sun size={16} /> : <Monitor size={16} />}
              <span className="chip-label" aria-hidden>Temă</span>
            </button>
          </Tip>
          <Tip text="PDF pentru tipar">
            <button type="button" className="chip-btn" onClick={openPrintDialog} aria-label="PDF pentru tipar">
              <FileDown size={16} strokeWidth={2.25} aria-hidden />
              <span className="chip-label" aria-hidden>PDF</span>
            </button>
          </Tip>
          <Tip text="Stats">
            <button type="button" className={`chip-btn ${statsOpen ? "on" : ""}`} onClick={toggleStats} aria-label="Stats" aria-pressed={statsOpen}>
              <ChartColumn size={16} strokeWidth={2.25} aria-hidden />
              <span className="chip-label" aria-hidden>Stats</span>
            </button>
          </Tip>
          {teamAuthed ? (
            <>
              <div className="team-presence" ref={teamBtnRef}>
                <Tip text="Echipă online">
                  <button
                    type="button"
                    className={`chip-btn ${teamMenuOpen ? "on" : ""}`}
                    aria-expanded={teamMenuOpen}
                    aria-haspopup="menu"
                    aria-label={`Echipă online (${teamRows.length})`}
                    onClick={() => setTeamMenuOpen((v) => !v)}
                  >
                    <Users size={16} strokeWidth={2.25} aria-hidden />
                    <span className="chip-label" aria-hidden>Echipă ({teamRows.length})</span>
                  </button>
                </Tip>
                {teamMenuOpen && teamMenuStyle
                  ? createPortal(
                      <div ref={teamMenuRef} className="team-presence-menu" role="menu" style={teamMenuStyle}>
                        {teamRows.map((u) => (
                          <div key={u.sid} className={`team-presence-row${u.self ? " is-self" : ""}`} role="menuitem">
                            <span className="team-presence-avatar" aria-hidden>
                              <User size={14} strokeWidth={2.25} />
                            </span>
                            <div>
                              <div className="team-presence-name">
                                {u.name}
                                {u.self ? <span className="team-you"> (tu)</span> : null}
                              </div>
                              {teamAlone && u.locks.length === 0 ? (
                                <div className="sub">Ești singurul online.</div>
                              ) : u.locks.length ? (
                                u.locks.map((lock) => (
                                  <div key={`${lock.kind}:${lock.id}`} className="team-lock-line">
                                    <Pencil size={13} strokeWidth={2.25} aria-hidden />
                                    <span>editează {lockLabel(lock)}</span>
                                    <Tip text="Arată pe hartă">
                                      <button
                                        type="button"
                                        className="icon-mini"
                                        aria-label="Arată pe hartă"
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={() => flyToLock(lock)}
                                      >
                                        <LocateFixed size={14} strokeWidth={2.25} aria-hidden />
                                      </button>
                                    </Tip>
                                  </div>
                                ))
                              ) : (
                                <div className="sub">nu editează</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>,
                      document.body,
                    )
                  : null}
              </div>
              <Tip text={importLabel}>
                <button type="button" className={`chip-btn ${importReportOpen ? "on" : ""}`} onClick={toggleImportReport} aria-label={importLabel} aria-pressed={importReportOpen}>
                  <Bug size={16} strokeWidth={2.25} aria-hidden />
                  <span className="chip-label" aria-hidden>{importLabel}</span>
                </button>
              </Tip>
              {editMode ? (
                <Tip text="Măsurători spreadsheet">
                  <button
                    type="button"
                    className={`chip-btn ${csvEditorOpen ? "on" : ""}`}
                    onClick={toggleCsvEditor}
                    aria-label="Măsurători spreadsheet"
                    aria-pressed={csvEditorOpen}
                  >
                    <Table2 size={16} strokeWidth={2.25} aria-hidden />
                    <span className="chip-label" aria-hidden>Sheets</span>
                  </button>
                </Tip>
              ) : null}
              {editMode ? (
                <Tip text={editsLabel}>
                  <button type="button" className={`chip-btn ${editsOpen ? "on" : ""}`} onClick={toggleEdits} aria-label={editsLabel} aria-pressed={editsOpen}>
                    <ListTree size={16} strokeWidth={2.25} aria-hidden />
                    <span className="chip-label" aria-hidden>{editsLabel}</span>
                  </button>
                </Tip>
              ) : null}
            </>
          ) : null}
          <Tip text={pencilLabel}>
            <button
              type="button"
              className={`chip-btn edit ${teamAuthed && editMode ? "on" : ""}`}
              onClick={toggleEditAccess}
              aria-label={pencilLabel}
              aria-pressed={teamAuthed && editMode}
            >
              <Pencil size={16} strokeWidth={2.25} aria-hidden />
              <span className="chip-label" aria-hidden>{pencilLabel}</span>
            </button>
          </Tip>
        </div>
        {teamAuthed ? (
          <Tip text={teamName ? `Logout (${teamName})` : "Logout"}>
            <button type="button" className="chip-btn edit-logout" onClick={() => void teamLogout()} aria-label={teamName ? `Logout (${teamName})` : "Logout"}>
              <LogOut size={16} strokeWidth={2.25} aria-hidden />
              <span className="chip-label">Logout</span>
            </button>
          </Tip>
        ) : null}
      </motion.header>

      <AnimatePresence>
        {basemapOpen && (
          <motion.div
            className="popover basemap-pop"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={popExit()}
            transition={panelSpring}
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
            exit={popExit()}
            transition={panelSpring}
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
