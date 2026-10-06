import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2, Minimize2, X } from "lucide-react";
import { mapLegendItems } from "../lib/mapLegend";
import { downloadMapPdf, previewMapSheet, PrintError, type MapPreview } from "../lib/printMap";
import {
  PAPER_IDS,
  PRINT_DPI,
  PRINT_SCALES,
  boundsCenter,
  featureCollectionBounds,
  formatScale,
  lngLatAtFrameFraction,
  parseCustomScale,
  type Orientation,
  type PaperId,
  type PrintDpi,
  type PrintFrame,
  type ScaleCenter,
} from "../lib/printLayout";
import type { BasemapId } from "../lib/space";
import { panelSpring, springExit } from "../lib/uiMotion";
import { useApp } from "../store";
import { Tip } from "./Tip";

let openPrint: (() => void) | null = null;

export function openPrintDialog() {
  openPrint?.();
}

export function PrintDialog() {
  const ready = useApp((s) => s.ready);
  const [open, setOpen] = useState(false);
  const [paper, setPaper] = useState<PaperId>("a3");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [dpi, setDpi] = useState<PrintDpi>(150);
  const [frame, setFrame] = useState<PrintFrame>("city");
  const [scale, setScale] = useState(10000);
  const [scaleDraft, setScaleDraft] = useState("10000");
  const [scaleCenter, setScaleCenter] = useState<ScaleCenter>("city");
  const [printBasemap, setPrintBasemap] = useState<BasemapId>("light");
  const [customCenter, setCustomCenter] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<MapPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [panning, setPanning] = useState(false);
  const [nudge, setNudge] = useState({ x: 0, y: 0 });
  const [expanded, setExpanded] = useState(false);
  const neighborhoods = useApp((s) => s.neighborhoods);
  const streets = useApp((s) => s.streets);
  const imgRef = useRef<HTMLImageElement>(null);
  const crossRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const scaleTimer = useRef<number | null>(null);
  const expandedOn = useRef(false);

  useEffect(() => {
    openPrint = () => {
      setError(null);
      setOpen(true);
    };
    return () => {
      if (openPrint) openPrint = null;
    };
  }, []);

  useEffect(() => {
    expandedOn.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      if (expandedOn.current) {
        setExpanded(false);
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  useEffect(() => () => {
    if (scaleTimer.current) window.clearTimeout(scaleTimer.current);
  }, []);

  const bounds = featureCollectionBounds([neighborhoods, streets]);

  useEffect(() => {
    if (!open || !ready || busy) return;
    let dead = false;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      const state = useApp.getState();
      void previewMapSheet({
        paper,
        orientation,
        dpi,
        basemap: printBasemap,
        frame,
        scale,
        scaleCenter,
        customCenter,
        bounds,
        legend: mapLegendItems({
          layers: state.layers,
          editMode: state.editMode,
          schoolList: state.schoolList,
          selectedSchools: state.filters.schools,
          streets: state.streets,
          measurements: state.measurements,
          seedMeasurements: state.seedMeasurements,
          neighborhoods: state.filters.neighborhoods,
          buildingTypes: state.filters.buildingTypes,
        }),
      })
        .then((shot) => {
          if (dead) return;
          setNudge({ x: 0, y: 0 });
          setPreview(shot);
        })
        .catch((err: unknown) => {
          if (dead) return;
          setNudge({ x: 0, y: 0 });
          setError(err instanceof PrintError ? err.message : "Nu am putut pregăti previzualizarea.");
        })
        .finally(() => {
          if (!dead) setPreviewing(false);
        });
    }, 350);
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [open, ready, busy, paper, orientation, frame, scale, scaleCenter, customCenter, printBasemap, neighborhoods, streets]);

  const close = () => {
    setExpanded(false);
    setOpen(false);
  };

  const commitScale = (raw: string) => {
    const parsed = parseCustomScale(raw);
    if (!parsed) {
      setScaleDraft(String(scale));
      return;
    }
    setScale(parsed);
    setScaleDraft(String(parsed));
  };

  const chooseScale = (value: number) => {
    if (scaleTimer.current) window.clearTimeout(scaleTimer.current);
    setScale(value);
    setScaleDraft(String(value));
  };

  const chooseCustomCenter = () => {
    setScaleCenter("custom");
    setCustomCenter((cur) => cur ?? preview?.center ?? (bounds ? boundsCenter(bounds) : null));
  };

  const toggleFullscreen = () => setExpanded((on) => !on);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (frame !== "scale" || !preview || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    setPanning(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    current.dx = e.clientX - current.x;
    current.dy = e.clientY - current.y;
    setNudge({ x: current.dx, y: current.dy });
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    setPanning(false);
    if (!current || !preview || !imgRef.current) return;
    if (Math.hypot(current.dx, current.dy) < 3) {
      setNudge({ x: 0, y: 0 });
      return;
    }
    const img = imgRef.current;
    const cross = crossRef.current;
    const imgRect = img.getBoundingClientRect();
    const crossRect = cross?.getBoundingClientRect();
    if (!crossRect || imgRect.width < 2 || imgRect.height < 2) {
      setNudge({ x: 0, y: 0 });
      return;
    }
    const pageX = ((crossRect.left + crossRect.width / 2 - imgRect.left) / imgRect.width) * preview.page.w;
    const pageY = ((crossRect.top + crossRect.height / 2 - imgRect.top) / imgRect.height) * preview.page.h;
    const fx = (pageX - preview.map.x) / preview.map.w;
    const fy = (pageY - preview.map.y) / preview.map.h;
    setScaleCenter("custom");
    setCustomCenter(lngLatAtFrameFraction(preview.nw, preview.se, fx, fy));
  };

  const download = async () => {
    if (!ready || busy) return;
    const parsed = parseCustomScale(scaleDraft);
    const scaleNow = parsed ?? scale;
    setBusy(true);
    setError(null);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const state = useApp.getState();
    const legend = mapLegendItems({
      layers: state.layers,
      editMode: state.editMode,
      schoolList: state.schoolList,
      selectedSchools: state.filters.schools,
      streets: state.streets,
      measurements: state.measurements,
      seedMeasurements: state.seedMeasurements,
      neighborhoods: state.filters.neighborhoods,
      buildingTypes: state.filters.buildingTypes,
    });
    const boundsNow = frame === "view" ? null : featureCollectionBounds([state.neighborhoods, state.streets]);
    if ((frame === "city" || (frame === "scale" && scaleCenter === "city")) && !boundsNow) {
      setError("Nu am geometria orașului.");
      setBusy(false);
      return;
    }
    try {
      await downloadMapPdf({
        paper,
        orientation,
        dpi,
        basemap: printBasemap,
        legend,
        frame,
        scale: scaleNow,
        scaleCenter,
        customCenter,
        bounds: boundsNow,
      });
      close();
      useApp.getState().showToast("PDF descărcat");
    } catch (err) {
      setError(err instanceof PrintError ? err.message : "Nu am putut genera PDF-ul.");
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    const img = imgRef.current;
    const cross = crossRef.current;
    if (!img || !cross || !preview || frame !== "scale") return;
    const place = () => {
      const x = img.offsetLeft + ((preview.map.x + preview.map.w / 2) / preview.page.w) * img.clientWidth;
      const y = img.offsetTop + ((preview.map.y + preview.map.h / 2) / preview.page.h) * img.clientHeight;
      cross.style.left = `${x}px`;
      cross.style.top = `${y}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(img);
    return () => observer.disconnect();
  }, [preview, frame, expanded]);

  const previewNode = (
    <div
      className={`print-preview${previewing ? " is-busy" : ""}${expanded ? " is-expanded" : ""}${frame === "scale" ? " is-pannable" : ""}${panning ? " is-panning" : ""}`}
      aria-busy={previewing}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="print-preview-frame">
        {preview ? (
          <img
            ref={imgRef}
            src={preview.url}
            alt="Previzualizare pentru tipar"
            draggable={false}
            style={nudge.x || nudge.y ? { transform: `translate(${nudge.x}px, ${nudge.y}px)` } : undefined}
          />
        ) : null}
        {frame === "scale" && preview ? <span ref={crossRef} className="print-crosshair" /> : null}
      </div>
      {preview ? (
        <button
          type="button"
          className="print-full"
          onClick={toggleFullscreen}
          aria-pressed={expanded}
          aria-label={expanded ? "Ieși din ecran complet" : "Previzualizare pe tot ecranul"}
        >
          {expanded ? <Minimize2 size={16} strokeWidth={2.25} /> : <Maximize2 size={16} strokeWidth={2.25} />}
        </button>
      ) : null}
      {previewing ? <p className="sub">{preview ? "Se actualizează…" : "Se pregătește previzualizarea…"}</p> : null}
    </div>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="print-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={springExit({ opacity: 0 })}
          onClick={() => {
            if (!busy) close();
          }}
        >
          <motion.div
            className="print-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="print-title"
            aria-busy={busy}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={springExit({ y: 12, opacity: 0 })}
            transition={panelSpring}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="print-head">
              <div>
                <h2 id="print-title">PDF pentru tipar</h2>
              </div>
              <Tip text="Închide">
                <button type="button" className="icon-x" onClick={close} disabled={busy} aria-label="Închide">
                  <X size={18} strokeWidth={2.25} />
                </button>
              </Tip>
            </div>

            <div className="print-body">
              <div>
                <fieldset className="print-field">
                  <legend>Cadru</legend>
                  <div className="print-choices">
                    <button type="button" className={frame === "city" ? "on" : ""} aria-pressed={frame === "city"} onClick={() => setFrame("city")}>
                      Tot orașul
                    </button>
                    <button type="button" className={frame === "view" ? "on" : ""} aria-pressed={frame === "view"} onClick={() => setFrame("view")}>
                      Ecran
                    </button>
                    <button type="button" className={frame === "scale" ? "on" : ""} aria-pressed={frame === "scale"} onClick={() => setFrame("scale")}>
                      Scară
                    </button>
                  </div>
                </fieldset>

                {frame === "scale" ? (
                  <>
                    <fieldset className="print-field">
                      <legend>Scară</legend>
                      <div className="print-choices">
                        {PRINT_SCALES.map((value) => (
                          <button key={value} type="button" className={scale === value ? "on" : ""} aria-pressed={scale === value} onClick={() => chooseScale(value)}>
                            {formatScale(value)}
                          </button>
                        ))}
                      </div>
                      <label className="print-custom-scale">
                        <span>1:</span>
                        <input
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          aria-label="Scară proprie"
                          value={scaleDraft}
                          onChange={(e) => {
                            const next = e.target.value;
                            setScaleDraft(next);
                            if (scaleTimer.current) window.clearTimeout(scaleTimer.current);
                            scaleTimer.current = window.setTimeout(() => {
                              const parsed = parseCustomScale(next);
                              if (parsed) setScale(parsed);
                            }, 450);
                          }}
                          onBlur={() => commitScale(scaleDraft)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitScale(scaleDraft);
                            }
                          }}
                        />
                      </label>
                    </fieldset>
                    <fieldset className="print-field">
                      <legend>Centru</legend>
                      <div className="print-choices">
                        <button type="button" className={scaleCenter === "screen" ? "on" : ""} aria-pressed={scaleCenter === "screen"} onClick={() => setScaleCenter("screen")}>
                          Centrul ecranului
                        </button>
                        <button type="button" className={scaleCenter === "city" ? "on" : ""} aria-pressed={scaleCenter === "city"} onClick={() => setScaleCenter("city")}>
                          Centrul orașului
                        </button>
                        <button type="button" className={scaleCenter === "custom" ? "on" : ""} aria-pressed={scaleCenter === "custom"} onClick={chooseCustomCenter}>
                          Manual
                        </button>
                      </div>
                    </fieldset>
                  </>
                ) : null}

                <fieldset className="print-field">
                  <legend>Fundal</legend>
                  <div className="print-choices">
                    {(
                      [
                        ["light", "Alb"],
                        ["dark", "Negru"],
                        ["satellite", "Satelit"],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} type="button" className={printBasemap === id ? "on" : ""} aria-pressed={printBasemap === id} onClick={() => setPrintBasemap(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="print-field">
                  <legend>Format</legend>
                  <div className="print-choices">
                    {PAPER_IDS.map((id) => (
                      <button key={id} type="button" className={paper === id ? "on" : ""} aria-pressed={paper === id} onClick={() => setPaper(id)}>
                        {id.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="print-field">
                  <legend>Orientare</legend>
                  <div className="print-choices">
                    <button type="button" className={orientation === "landscape" ? "on" : ""} aria-pressed={orientation === "landscape"} onClick={() => setOrientation("landscape")}>
                      Peisaj
                    </button>
                    <button type="button" className={orientation === "portrait" ? "on" : ""} aria-pressed={orientation === "portrait"} onClick={() => setOrientation("portrait")}>
                      Portret
                    </button>
                  </div>
                </fieldset>

                <fieldset className="print-field">
                  <legend>Rezoluție</legend>
                  <div className="print-choices">
                    {PRINT_DPI.map((value) => (
                      <button key={value} type="button" className={dpi === value ? "on" : ""} aria-pressed={dpi === value} onClick={() => setDpi(value)}>
                        {value} dpi
                      </button>
                    ))}
                  </div>
                </fieldset>

                {error ? <p className="print-error">{error}</p> : null}

                <div className="print-actions">
                  <button type="button" className="btn" onClick={close} disabled={busy}>
                    Renunță
                  </button>
                  <button type="button" className="btn primary" onClick={() => void download()} disabled={!ready || busy || previewing}>
                    {busy ? "Se generează…" : "Descarcă PDF"}
                  </button>
                </div>
              </div>
              {expanded ? <div className="print-preview is-placeholder" /> : previewNode}
              {expanded ? createPortal(previewNode, document.body) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
