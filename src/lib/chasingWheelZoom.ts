import type { Map } from "maplibre-gl";

type PointLike = { x: number; y: number; sub?: (p: PointLike) => PointLike };

type ScrollZoomHook = {
  isEnabled: () => boolean;
  isActive: () => boolean;
  isZooming: () => boolean;
  wheel: (e: WheelEvent, point: PointLike | PointLike[]) => void;
  renderFrame: (e?: { timeStamp?: number }) => {
    noInertia?: boolean;
    needsRenderFrame?: boolean;
    zoomDelta?: number;
    around?: PointLike;
    originalEvent?: Event;
  } | void;
  reset: () => void;
  _triggerRenderFrame: () => void;
  _active: boolean;
  _zooming: boolean;
};

const ZOOM_TAU_S = 0.09;

function wheelPoint(point: PointLike | PointLike[] | undefined): PointLike | undefined {
  if (!point) return undefined;
  return Array.isArray(point) ? point[0] : point;
}

export type ChasingWheelZoom = {
  abort: () => void;
  isRunning: () => boolean;
  stop: () => void;
};

/**
 * Zoom pe wheel lin (chase către țintă, în jurul cursorului).
 * Rămânem în handler-ul nativ MapLibre (zoomDelta pe renderFrame), ca pan-ul
 * să meargă în același frame — fără jumpTo / RAF separat, care sacadează.
 *
 * Cât `isActive()` e true, MapLibre blochează `mousemove` pe hartă și ține
 * listenerul capturing pe `document` — de aceea abortăm chase-ul când se
 * deschide un panou, altfel overlay-ul rămâne de nefolosit.
 */
export function enableChasingWheelZoom(map: Map): ChasingWheelZoom {
  const h = map.scrollZoom as unknown as ScrollZoomHook;
  if (!map.scrollZoom.isEnabled()) map.scrollZoom.enable();

  const origWheel = h.wheel.bind(h);
  const origRenderFrame = h.renderFrame.bind(h);
  const origReset = h.reset.bind(h);
  const origIsActive = h.isActive.bind(h);
  const origIsZooming = h.isZooming.bind(h);

  let targetZoom = map.getZoom();
  let around: PointLike | undefined;
  let lastEvent: WheelEvent | undefined;
  let running = false;
  let lastTs = 0;

  const clampZoom = (z: number) => Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), z));

  const syncFromMap = () => {
    if (!running) targetZoom = map.getZoom();
  };
  map.on("zoomend", syncFromMap);
  map.on("moveend", syncFromMap);

  const abort = () => {
    running = false;
    lastTs = 0;
    lastEvent = undefined;
    around = undefined;
    try {
      targetZoom = map.getZoom();
    } catch {
      /* map removed */
    }
    h._active = false;
    h._zooming = false;
    origReset();
    try {
      h._triggerRenderFrame();
    } catch {
      /* handler already torn down */
    }
  };

  h.wheel = (e, point) => {
    if (!map.scrollZoom.isEnabled()) return;

    e.preventDefault();

    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? map.getContainer().clientHeight : 1;
    let dy = e.deltaY * scale;
    if (e.shiftKey && dy) dy /= 4;
    const factor = e.ctrlKey ? 0.01 : 0.0022;
    targetZoom = clampZoom(targetZoom - dy * factor);

    around = wheelPoint(point);
    lastEvent = e;
    if (!running) lastTs = 0;
    running = true;
    h._active = true;
    h._zooming = true;
    h._triggerRenderFrame();
  };

  h.renderFrame = (e) => {
    if (!running) return;

    const now = typeof e?.timeStamp === "number" ? e.timeStamp : performance.now();
    const dt = lastTs ? Math.min(0.048, Math.max(0, (now - lastTs) / 1000)) : 1 / 60;
    lastTs = now;

    const cur = map.getZoom();
    const diff = targetZoom - cur;
    if (Math.abs(diff) < 0.0008) {
      const zoomDelta = Math.abs(diff) >= 0.0001 ? diff : 0;
      running = false;
      lastTs = 0;
      h._active = false;
      h._zooming = false;
      return {
        noInertia: true,
        needsRenderFrame: false,
        zoomDelta,
        around,
        originalEvent: lastEvent,
      };
    }

    const k = 1 - Math.exp(-dt / ZOOM_TAU_S);
    h._active = true;
    h._zooming = true;
    return {
      noInertia: true,
      needsRenderFrame: true,
      zoomDelta: diff * k,
      around,
      originalEvent: lastEvent,
    };
  };

  h.isActive = () => running || origIsActive();
  h.isZooming = () => running || origIsZooming();
  h.reset = () => {
    running = false;
    lastTs = 0;
    origReset();
  };

  return {
    abort,
    isRunning: () => running,
    stop: () => {
      abort();
      h.wheel = origWheel;
      h.renderFrame = origRenderFrame;
      h.reset = origReset;
      h.isActive = origIsActive;
      h.isZooming = origIsZooming;
      map.off("zoomend", syncFromMap);
      map.off("moveend", syncFromMap);
    },
  };
}
