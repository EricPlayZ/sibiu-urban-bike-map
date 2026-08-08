import type { IControl, Map } from "maplibre-gl";

/**
 * Busolă mare rotabilă (touch / mouse):
 * - tragi pe inel ca să rotești harta
 * - tap pe „N” (centru) = reset bearing + pitch
 */
export class CompassDialControl implements IControl {
    private _map: Map | null = null;
    private _root: HTMLDivElement | null = null;
    private _dial: HTMLDivElement | null = null;
    private _dragging = false;
    private _startAngle = 0;
    private _startBearing = 0;
    private _moved = false;

    private _onMapRotate = () => this._syncFromMap();

    onAdd(map: Map) {
        this._map = map;
        const root = document.createElement("div");
        root.className = "maplibregl-ctrl ubr-compass-wrap";

        const dial = document.createElement("div");
        dial.className = "ubr-compass-dial";
        dial.title = "Trage ca să rotești · tap pe N = nord";
        dial.setAttribute("role", "slider");
        dial.setAttribute("aria-label", "Rotește harta");
        dial.innerHTML = `
      <div class="ubr-compass-ring" aria-hidden="true">
        <span class="ubr-compass-tick ubr-compass-tick-n">N</span>
        <span class="ubr-compass-tick ubr-compass-tick-e">E</span>
        <span class="ubr-compass-tick ubr-compass-tick-s">S</span>
        <span class="ubr-compass-tick ubr-compass-tick-w">V</span>
      </div>
      <button type="button" class="ubr-compass-hub" title="Resetează nordul" aria-label="Resetează nordul">N</button>
    `;

        const hub = dial.querySelector(".ubr-compass-hub") as HTMLButtonElement;
        hub.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this._moved) return;
            map.easeTo({ bearing: 0, pitch: 0, duration: 450 });
        });

        dial.addEventListener("pointerdown", (e) => this._onPointerDown(e));
        window.addEventListener("pointermove", this._onPointerMove);
        window.addEventListener("pointerup", this._onPointerUp);
        window.addEventListener("pointercancel", this._onPointerUp);

        root.appendChild(dial);
        this._root = root;
        this._dial = dial;
        map.on("rotate", this._onMapRotate);
        this._syncFromMap();
        return root;
    }

    onRemove() {
        window.removeEventListener("pointermove", this._onPointerMove);
        window.removeEventListener("pointerup", this._onPointerUp);
        window.removeEventListener("pointercancel", this._onPointerUp);
        this._map?.off("rotate", this._onMapRotate);
        this._root?.remove();
        this._map = null;
        this._root = null;
        this._dial = null;
    }

    private _angleAt(e: PointerEvent) {
        if (!this._dial) return 0;
        const r = this._dial.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        return (Math.atan2(e.clientX - cx, cy - e.clientY) * 180) / Math.PI;
    }

    private _onPointerDown = (e: PointerEvent) => {
        const t = e.target as HTMLElement;
        if (t.closest(".ubr-compass-hub")) return;
        if (!this._map || !this._dial) return;
        e.preventDefault();
        this._dragging = true;
        this._moved = false;
        this._startAngle = this._angleAt(e);
        this._startBearing = this._map.getBearing();
        this._dial.setPointerCapture?.(e.pointerId);
        this._dial.classList.add("dragging");
    };

    private _onPointerMove = (e: PointerEvent) => {
        if (!this._dragging || !this._map) return;
        const ang = this._angleAt(e);
        let delta = -(ang - this._startAngle);
        if (Math.abs(delta) > 2) this._moved = true;
        // Normalizare
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        this._map.setBearing(this._startBearing + delta);
    };

    private _onPointerUp = () => {
        if (!this._dragging) return;
        this._dragging = false;
        this._dial?.classList.remove("dragging");
        // Permite click pe hub imediat după un drag scurt
        window.setTimeout(() => {
            this._moved = false;
        }, 40);
    };

    private _syncFromMap() {
        if (!this._map || !this._dial) return;
        const ring = this._dial.querySelector(".ubr-compass-ring") as HTMLElement | null;
        if (ring) ring.style.transform = `rotate(${-this._map.getBearing()}deg)`;
    }
}
