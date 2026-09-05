import { List, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { mapLegendItems } from "../lib/mapLegend";

export function MapLegend() {
  const ready = useApp((s) => s.ready);
  const legendOpen = useApp((s) => s.legendOpen);
  const closeLegend = useApp((s) => s.closeLegend);
  const openLegend = useApp((s) => s.openLegend);
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
    <aside
      ref={rootRef}
      className={legendOpen ? "map-legend is-open" : "map-legend is-collapsed"}
      aria-label="Legendă hartă"
    >
      {legendOpen ? (
        <>
          <div className="map-legend-head">
            <span>Legendă</span>
            <button type="button" className="icon-x" onClick={closeLegend} aria-label="Ascunde legenda" aria-expanded={true}>
              <X size={16} strokeWidth={2.25} />
            </button>
          </div>
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
        </>
      ) : (
        <button type="button" className="map-legend-launch" onClick={openLegend} aria-label="Arată legenda" aria-expanded={false}>
          <List size={16} strokeWidth={2.25} aria-hidden />
          Legendă
        </button>
      )}
    </aside>
  );
}
