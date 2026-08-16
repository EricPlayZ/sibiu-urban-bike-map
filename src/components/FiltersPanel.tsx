import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Bike, CheckCheck, Eye, GraduationCap, Leaf, ParkingSquare, Ruler, X } from "lucide-react";
import { DESKTOP_MEDIA } from "../lib/breakpoints";
import { useApp } from "../store";
import { LAYER_META, layersMatchFocus, layersMatchPreset } from "../lib/layers";

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
  const viewMode = useApp((s) => s.viewMode);
  const editMode = useApp((s) => s.editMode);
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
  const presetSynced = layersMatchPreset(layers, viewMode, editMode ? { ignore: ["streetsBase"] } : undefined);
  const hideEmptyOn = !layers.streetsBase;
  const illegalOnlyOn = layersMatchFocus(layers, "illegalOnly");
  const bikeOnlyOn = layersMatchFocus(layers, "bikeOnly");

  return (
    <>
      {open && desktop && (
        <button type="button" className="scrim" onClick={() => useApp.getState().closeFilters()} aria-label="Închide filtre" />
      )}
      <AnimatePresence>
        {open && (
          <motion.aside
            className="panel filters-panel"
            initial={desktop ? { x: 24, opacity: 0 } : { y: 16, opacity: 0 }}
            animate={desktop ? { x: 0, opacity: 1 } : { y: 0, opacity: 1 }}
            exit={{
              ...(desktop ? { x: 16, opacity: 0 } : { y: 12, opacity: 0 }),
              pointerEvents: "none",
              transition: {
                type: "spring",
                stiffness: 380,
                damping: 32,
                pointerEvents: { duration: 0 },
              },
            }}
          >
            <div className="panel-head">
              <h2>Filtre & straturi</h2>
              <button type="button" className="icon-x" onClick={() => useApp.getState().closeFilters()} aria-label="Închide">
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>

            <div className="field-label">Straturi pe hartă</div>
            <p className="hint-text tight">
              Spațiu / Clădiri / Școli și focalizările de mai jos aplică preseturi pe aceste straturi.
              {!presetSynced && " Ai modificat manual straturile față de presetul curent."}
            </p>
            <div className="filter-switch-list" role="group" aria-label="Straturi">
              {LAYER_META.map((L) => (
                <FilterSwitch
                  key={L.id}
                  icon={<Eye size={18} strokeWidth={2.25} />}
                  label={L.label}
                  hint={L.hint}
                  checked={layers[L.id]}
                  onChange={(v) => setLayer(L.id, v)}
                />
              ))}
            </div>

            <div className="field-label">Focalizare</div>
            <p className="hint-text tight">Ca Spațiu / Clădiri: aplică un preset pe straturi. Dacă schimbi straturile manual, focalizarea nu mai e activă.</p>
            <div className="filter-switch-list" role="group" aria-label="Filtre rapide">
              <FilterSwitch
                icon={<Ruler size={18} strokeWidth={2.25} />}
                label="Ascunde străzile fără date"
                hint={
                  editMode
                    ? "În Editare, străzile de bază rămân mereu vizibile ca să poți edita."
                    : "Oprește stratul „Străzi (bază)” — pe hartă rămân doar segmentele colorate (pistă, parcare, arondare)."
                }
                checked={hideEmptyOn}
                onChange={(v) => setLayer("streetsBase", !v)}
              />
              <FilterSwitch
                icon={<ParkingSquare size={18} strokeWidth={2.25} />}
                label="Doar parcare ilegală"
                hint="Preset: doar stratul de parcare ilegală (fără bază, pistă, rezervat, arondare)."
                checked={illegalOnlyOn}
                onChange={(v) => (v ? applyFocus("illegalOnly") : clearFocus())}
              />
              <FilterSwitch
                icon={<Bike size={18} strokeWidth={2.25} />}
                label="Doar piste de biciclete"
                hint="Preset: doar pistele (obișnuită + pe carosabil), fără bază / parcare / arondare."
                checked={bikeOnlyOn}
                onChange={(v) => (v ? applyFocus("bikeOnly") : clearFocus())}
              />
            </div>

            <div className="field-label">Cartiere</div>
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
              {neighborhoodList.map((n) => (
                <button
                  key={n.slug}
                  type="button"
                  className={`chip ${selected.has(n.slug) ? "on" : ""}`}
                  onClick={() => toggleNeighborhood(n.slug)}
                  aria-pressed={selected.has(n.slug)}
                >
                  {n.name}
                </button>
              ))}
            </div>

            <p className="hint-text">
              Cartierele neselectate își ascund conturul și datele colorate; străzile de bază rămân pe hartă (dacă stratul e activ).
            </p>

            <div className="field-label">Școli</div>
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

            <div className="chip-wrap">
              {schoolList.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  className={`chip ${selectedSchools.has(s.slug) ? "on" : ""}`}
                  onClick={() => toggleSchool(s.slug)}
                  aria-pressed={selectedSchools.has(s.slug)}
                >
                  {s.name}
                </button>
              ))}
            </div>

            <p className="hint-text">Școlile neselectate își ascund pin-ul și străzile arondate (portocaliu).</p>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

function FilterSwitch({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
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
        {hint ? <span className="filter-switch-hint">{hint}</span> : null}
      </span>
      <span className={`switch ${checked ? "on" : ""}`} aria-hidden>
        <span className="switch-knob" />
      </span>
    </button>
  );
}
