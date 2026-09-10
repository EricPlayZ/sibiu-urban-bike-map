import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Bike, CheckCheck, Eye, GraduationCap, Leaf, ParkingSquare, Ruler, Search, X } from "lucide-react";
import { DESKTOP_MEDIA } from "../lib/breakpoints";
import { filterByQuery } from "../lib/listSearch";
import { panelSpring, springExit } from "../lib/uiMotion";
import { useApp } from "../store";
import { FadeScrim } from "./FadeScrim";
import { schoolColor } from "../lib/schoolColors";
import { shortSchoolName } from "../lib/isochroneStats";
import { LAYER_META, layersMatchFocus } from "../lib/layers";

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(DESKTOP_MEDIA).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MEDIA);
    const onChange = () => setDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

export function FiltersPanel() {
  const open = useApp((s) => s.filtersOpen);
  const filters = useApp((s) => s.filters);
  const layers = useApp((s) => s.layers);
  const setLayer = useApp((s) => s.setLayer);
  const applyFocus = useApp((s) => s.applyFocus);
  const clearFocus = useApp((s) => s.clearFocus);
  const neighborhoodList = useApp((s) => s.neighborhoodList);
  const schoolList = useApp((s) => s.schoolList);
  const toggleNeighborhood = useApp((s) => s.toggleNeighborhood);
  const toggleAllNeighborhoods = useApp((s) => s.toggleAllNeighborhoods);
  const toggleSchool = useApp((s) => s.toggleSchool);
  const toggleAllSchools = useApp((s) => s.toggleAllSchools);
  const desktop = useIsDesktop();
  const [nbQuery, setNbQuery] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");

  useEffect(() => {
    if (open) return;
    setNbQuery("");
    setSchoolQuery("");
  }, [open]);

  useLayoutEffect(() => {
    if (open) return;
    document.querySelectorAll<HTMLElement>(".filters-panel").forEach((el) => {
      el.style.pointerEvents = "none";
      el.setAttribute("aria-hidden", "true");
    });
  }, [open]);

  const selected = new Set(filters.neighborhoods);
  const allOn = neighborhoodList.length > 0 && neighborhoodList.every((n) => selected.has(n.slug));
  const selectedCount = filters.neighborhoods.length;
  const selectedSchools = new Set(filters.schools);
  const allSchoolsOn = schoolList.length > 0 && schoolList.every((s) => selectedSchools.has(s.slug));
  const schoolSelectedCount = filters.schools.length;
  const hideEmptyOn = !layers.streetsBase;
  const illegalOnlyOn = layersMatchFocus(layers, "illegalOnly");
  const bikeOnlyOn = layersMatchFocus(layers, "bikeOnly");
  const visibleNeighborhoods = useMemo(() => filterByQuery(neighborhoodList, nbQuery), [neighborhoodList, nbQuery]);
  const visibleSchools = useMemo(() => filterByQuery(schoolList, schoolQuery), [schoolList, schoolQuery]);

  return (
    <AnimatePresence>
      {open && desktop && (
        <FadeScrim key="filters-scrim" onClick={() => useApp.getState().closeFilters()} label="Închide filtre" />
      )}
      {open && (
          <motion.aside
            key="filters-panel"
            className="panel filters-panel"
            initial={desktop ? { x: 24, opacity: 0 } : { y: 16, opacity: 0 }}
            animate={desktop ? { x: 0, opacity: 1 } : { y: 0, opacity: 1 }}
            exit={springExit(desktop ? { x: 16, opacity: 0 } : { y: 12, opacity: 0 })}
            transition={panelSpring}
          >
            <div className="panel-head">
              <h2>Filtre & straturi</h2>
              <button type="button" className="icon-x" onClick={() => useApp.getState().closeFilters()} aria-label="Închide">
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>

            <div className="field-label">Straturi pe hartă</div>
            <div className="filter-switch-list" role="group" aria-label="Straturi">
              {LAYER_META.map((L) => (
                <FilterSwitch
                  key={L.id}
                  icon={<Eye size={18} strokeWidth={2.25} />}
                  label={L.label}
                  checked={layers[L.id]}
                  onChange={(v) => setLayer(L.id, v)}
                />
              ))}
            </div>

            <div className="field-label">Focalizare</div>
            <div className="filter-switch-list" role="group" aria-label="Filtre rapide">
              <FilterSwitch
                icon={<Ruler size={18} strokeWidth={2.25} />}
                label="Ascunde străzile fără date"
                checked={hideEmptyOn}
                onChange={(v) => setLayer("streetsBase", !v)}
              />
              <FilterSwitch
                icon={<ParkingSquare size={18} strokeWidth={2.25} />}
                label="Doar parcare ilegală"
                checked={illegalOnlyOn}
                onChange={(v) => (v ? applyFocus("illegalOnly") : clearFocus())}
              />
              <FilterSwitch
                icon={<Bike size={18} strokeWidth={2.25} />}
                label="Doar piste de biciclete"
                checked={bikeOnlyOn}
                onChange={(v) => (v ? applyFocus("bikeOnly") : clearFocus())}
              />
            </div>

            <div className="field-label">Cartiere</div>
            <FilterSearch value={nbQuery} onChange={setNbQuery} placeholder="Caută cartier…" label="Caută cartier" />
            <button
              type="button"
              className={`select-all-btn ${allOn ? "on" : ""}`}
              onClick={toggleAllNeighborhoods}
              aria-pressed={allOn}
            >
              <span className="select-all-icon" aria-hidden>
                {allOn ? <CheckCheck size={18} /> : <Leaf size={18} />}
              </span>
              <span className="select-all-copy">
                <strong>{allOn ? "Toate selectate" : "Selectează tot"}</strong>
                <small>
                  {selectedCount}/{neighborhoodList.length} cartiere
                </small>
              </span>
              <span className={`switch ${allOn ? "on" : ""}`} aria-hidden>
                <span className="switch-knob" />
              </span>
            </button>

            <div className="chip-wrap">
              {visibleNeighborhoods.map((n) => (
                <button
                  key={n.slug}
                  type="button"
                  className={`chip ${selected.has(n.slug) ? "on" : ""}`}
                  onClick={() => toggleNeighborhood(n.slug)}
                  aria-pressed={selected.has(n.slug)}
                  title={n.name}
                >
                  <span className="chip-text">{n.name}</span>
                </button>
              ))}
            </div>
            {visibleNeighborhoods.length === 0 ? <p className="filter-empty">Niciun cartier nu se potrivește</p> : null}

            <div className="field-label">Școli</div>
            <FilterSearch value={schoolQuery} onChange={setSchoolQuery} placeholder="Caută școală…" label="Caută școală" />
            <button
              type="button"
              className={`select-all-btn ${allSchoolsOn ? "on" : ""}`}
              onClick={toggleAllSchools}
              aria-pressed={allSchoolsOn}
            >
              <span className="select-all-icon" aria-hidden>
                {allSchoolsOn ? <CheckCheck size={18} /> : <GraduationCap size={18} />}
              </span>
              <span className="select-all-copy">
                <strong>{allSchoolsOn ? "Toate selectate" : "Selectează tot"}</strong>
                <small>
                  {schoolSelectedCount}/{schoolList.length} școli
                </small>
              </span>
              <span className={`switch ${allSchoolsOn ? "on" : ""}`} aria-hidden>
                <span className="switch-knob" />
              </span>
            </button>

            <div className="chip-wrap chip-wrap-schools">
              {visibleSchools.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  className={`chip chip-school ${selectedSchools.has(s.slug) ? "on" : ""}`}
                  onClick={() => toggleSchool(s.slug)}
                  aria-pressed={selectedSchools.has(s.slug)}
                  aria-label={s.name}
                  title={s.name}
                >
                  <span className="chip-swatch" style={{ background: schoolColor(s.slug) }} aria-hidden />
                  <span className="chip-text">{shortSchoolName(s.name)}</span>
                </button>
              ))}
            </div>
            {visibleSchools.length === 0 ? <p className="filter-empty">Nicio școală nu se potrivește</p> : null}
          </motion.aside>
        )}
    </AnimatePresence>
  );
}

function FilterSearch({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <label className="filter-search">
      <Search size={15} strokeWidth={2.25} aria-hidden />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
      />
      {value ? (
        <button type="button" className="filter-search-clear" onClick={() => onChange("")} aria-label="Șterge căutarea">
          <X size={14} strokeWidth={2.4} />
        </button>
      ) : null}
    </label>
  );
}

function FilterSwitch({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" className={`filter-switch ${checked ? "on" : ""}`} aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span className="filter-switch-icon" aria-hidden>
        {icon}
      </span>
      <span className="filter-switch-copy">
        <span className="filter-switch-label">{label}</span>
      </span>
      <span className={`switch ${checked ? "on" : ""}`} aria-hidden>
        <span className="switch-knob" />
      </span>
    </button>
  );
}
