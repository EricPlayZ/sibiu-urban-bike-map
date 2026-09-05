import { List } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { mapLegendItems } from "../lib/mapLegend";
import { popSpring } from "../lib/uiMotion";

export function MapLegend() {
  const ready = useApp((s) => s.ready);
  const legendOpen = useApp((s) => s.legendOpen);
  const toggleLegend = useApp((s) => s.toggleLegend);
  const layers = useApp((s) => s.layers);
  const editMode = useApp((s) => s.editMode);
  const schoolList = useApp((s) => s.schoolList);
  const filters = useApp((s) => s.filters);
  const streets = useApp((s) => s.streets);
  const measurements = useApp((s) => s.measurements);
  const seedMeasurements = useApp((s) => s.seedMeasurements);
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  const { layers: layerItems, schools } = mapLegendItems({
    layers,
    editMode,
    schoolList,
    selectedSchools: filters.schools,
    streets,
    measurements,
    seedMeasurements,
    neighborhoods: filters.neighborhoods,
  });

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!legendOpen || !body) {
      setScrollable(false);
      return;
    }
    const sync = () => {
      setScrollable(body.scrollHeight > body.clientHeight + 1);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(body);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [legendOpen, layerItems, schools]);

  if (!ready) return null;

  return (
    <div className="map-legend-stack">
      <AnimatePresence>
        {legendOpen && (
          <motion.aside
            ref={rootRef}
            className="map-legend"
            aria-label="Legendă hartă"
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96, pointerEvents: "none" }}
            transition={popSpring}
            style={{ originX: 0, originY: 1 }}
          >
            <div ref={bodyRef} className={scrollable ? "map-legend-body is-scrollable" : "map-legend-body"}>
              {layerItems.length > 0 && (
                <div className="map-legend-list">
                  {layerItems.map((item) => (
                    <span key={item.key} className="map-legend-item">
                      <i style={{ background: item.color }} />
                      {item.label}
                    </span>
                  ))}
                </div>
              )}
              {schools.length > 0 && (
                <div className="map-legend-schools">
                  {layerItems.length > 0 && <div className="map-legend-kicker">Școli</div>}
                  <div className="map-legend-list map-legend-list-schools">
                    {schools.map((item) => (
                      <span key={item.key} className="map-legend-item">
                        <i style={{ background: item.color }} />
                        {item.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
      <button
        type="button"
        className={`chip-btn map-legend-launch ${legendOpen ? "on" : ""}`}
        onClick={toggleLegend}
        aria-label={legendOpen ? "Ascunde legenda" : "Arată legenda"}
        aria-expanded={legendOpen}
        aria-pressed={legendOpen}
      >
        <List size={16} strokeWidth={2.25} aria-hidden />
        Legendă
      </button>
    </div>
  );
}
