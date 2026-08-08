import type { Map } from "maplibre-gl";

/**
 * Zoom pe wheel tip Google/OSM:
 * - scroll rapid doar actualizează targetZoom
 * - un loop RAF face lerp către țintă
 * - zoom în jurul cursorului (jumpTo ignoră `around` — corectăm cu panBy)
 */
export function enableChasingWheelZoom(map: Map) {
    map.scrollZoom.disable();

    let targetZoom = map.getZoom();
    let anchorPx: { x: number; y: number } | null = null;
    let raf = 0;
    let running = false;

    const syncFromMap = () => {
        if (!running) targetZoom = map.getZoom();
    };
    map.on("zoomend", syncFromMap);
    map.on("moveend", syncFromMap);

    /** Zoom + păstrează același punct geografic sub pixelul cursorului. */
    const jumpZoomAt = (zoom: number, pt: { x: number; y: number }) => {
        const lngLat = map.unproject([pt.x, pt.y]);
        map.jumpTo({ zoom });
        const after = map.project(lngLat);
        map.panBy([-(pt.x - after.x), -(pt.y - after.y)], { animate: false });
    };

    const tick = () => {
        raf = 0;
        const cur = map.getZoom();
        const diff = targetZoom - cur;
        if (!anchorPx || Math.abs(diff) < 0.0008) {
            if (anchorPx && Math.abs(diff) >= 0.0001) jumpZoomAt(targetZoom, anchorPx);
            running = false;
            return;
        }
        const alpha = Math.min(0.32, 0.14 + Math.abs(diff) * 0.1);
        jumpZoomAt(cur + diff * alpha, anchorPx);
        running = true;
        raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
        e.preventDefault();

        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? map.getContainer().clientHeight : 1;
        const dy = e.deltaY * scale;
        const factor = e.ctrlKey ? 0.01 : 0.0022;
        targetZoom = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), targetZoom - dy * factor));

        const rect = map.getCanvas().getBoundingClientRect();
        anchorPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };

        if (!raf) raf = requestAnimationFrame(tick);
        running = true;
    };

    const canvas = map.getCanvas();
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
        canvas.removeEventListener("wheel", onWheel);
        map.off("zoomend", syncFromMap);
        map.off("moveend", syncFromMap);
        if (raf) cancelAnimationFrame(raf);
        map.scrollZoom.enable();
    };
}
