import { data, state, baseMaps, lid, isOurLayerId, splitId, BIKE_EXPR, ILLEGAL_PARKING_EXPR, RESERVED_PARKING_EXPR, walkingColors, cyclingColors, bandColorExpr, BAND_OPACITY_EXPR, BAND_SORT_KEY_EXPR, MAP_DARK_BG } from "./config.js";

export const map = new maplibregl.Map({
    container: "map",
    style: baseMaps[2].style,
    center: [24.161728, 45.790919],
    zoom: 14,
});

export let streetLayerIds = [];
let hoverCursorBound = false;
let clickBound = false;

function createMaskGeoJSON(boundaryFeature) {
    if (!boundaryFeature || !boundaryFeature.geometry || !boundaryFeature.geometry.coordinates) return null;
    const boundaryCoords = boundaryFeature.geometry.type === "Polygon" ? boundaryFeature.geometry.coordinates[0] : boundaryFeature.geometry.coordinates[0][0];
    return {
        type: "Feature",
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [-180, -90],
                    [180, -90],
                    [180, 90],
                    [-180, 90],
                    [-180, -90],
                ],
                boundaryCoords,
            ],
        },
    };
}

export function addAllLayersFromMemory() {
    streetLayerIds = [];
    const srcIdForHood = (hid) => lid("src", hid);

    function ensureHoodSource(hid) {
        const sid = srcIdForHood(hid);
        if (!map.getSource(sid)) {
            map.addSource(sid, { type: "geojson", data: { type: "FeatureCollection", features: data.byNeighborhood[hid].features } });
        }
    }

    for (let { slug: hid } of data.neighborhoods) {
        ensureHoodSource(hid);
        const bgId = lid(hid, "bg");
        if (!map.getLayer(bgId)) map.addLayer({ id: bgId, type: "line", source: srcIdForHood(hid), paint: { "line-color": "#666", "line-width": 4, "line-opacity": 0.8 }, layout: { visibility: "none", "line-cap": "round", "line-join": "round" } });
        streetLayerIds.push(bgId);

        const bikeId = lid(hid, "bike");
        if (!map.getLayer(bikeId)) map.addLayer({ id: bikeId, type: "line", source: srcIdForHood(hid), filter: BIKE_EXPR, paint: { "line-color": "#00FF88", "line-width": 5, "line-opacity": 0.9 }, layout: { visibility: "none", "line-cap": "round", "line-join": "round" } });
        streetLayerIds.push(bikeId);

        const reservedParkingId = lid(hid, "reserved_parking");
        if (!map.getLayer(reservedParkingId)) map.addLayer({ id: reservedParkingId, type: "line", source: srcIdForHood(hid), filter: RESERVED_PARKING_EXPR, paint: { "line-color": "#F50057", "line-width": 5, "line-opacity": 0.9 }, layout: { visibility: "none", "line-cap": "round", "line-join": "round" } });
        streetLayerIds.push(reservedParkingId);

        const illegalParkingId = lid(hid, "illegal_parking");
        if (!map.getLayer(illegalParkingId)) map.addLayer({ id: illegalParkingId, type: "line", source: srcIdForHood(hid), filter: ILLEGAL_PARKING_EXPR, paint: { "line-color": "#FFD600", "line-width": 5, "line-opacity": 0.9 }, layout: { visibility: "none", "line-cap": "round", "line-join": "round" } });
        streetLayerIds.push(illegalParkingId);

        const schools = data.byNeighborhood[hid].schools;
        for (let sslug of schools) {
            const assignedId = lid(hid, "schools", sslug, "assigned");
            if (!map.getLayer(assignedId)) map.addLayer({ id: assignedId, type: "line", source: srcIdForHood(hid), filter: ["==", ["get", "arondat"], sslug], paint: { "line-color": "#ff9100", "line-width": 8, "line-opacity": 0.8 }, layout: { visibility: "none", "line-cap": "round", "line-join": "round" } });
            streetLayerIds.push(assignedId);
        }

        const boundaryFeature = data.neighborhoodLimitsIndex[hid];
        if (boundaryFeature) {
            const limitSrcId = lid(hid, "limit_src");
            const maskSrcId = lid(hid, "mask_src");
            if (!map.getSource(limitSrcId)) map.addSource(limitSrcId, { type: "geojson", data: boundaryFeature });

            const maskGeoJSON = createMaskGeoJSON(boundaryFeature);
            if (maskGeoJSON && !map.getSource(maskSrcId)) map.addSource(maskSrcId, { type: "geojson", data: maskGeoJSON });

            const maskLayerId = lid(hid, "mask");
            if (!map.getLayer(maskLayerId)) map.addLayer({ id: maskLayerId, type: "fill", source: maskSrcId, paint: { "fill-color": MAP_DARK_BG, "fill-opacity": 1 }, layout: { visibility: "none" } });

            const limitLayerId = lid(hid, "limit");
            if (!map.getLayer(limitLayerId)) map.addLayer({ id: limitLayerId, type: "line", source: limitSrcId, paint: { "line-color": "#00BFFF", "line-width": 10, "line-opacity": 0.9 }, layout: { visibility: "none" } });
        }
    }
}

export function addIsoLayersIfNeeded(hid, sslug) {
    const bucket = data.isochrones[sslug];
    if (!bucket) return;
    const files = [
        { kind: "cycle", gj: bucket.cycle, stroke: "#FF00FF" },
        { kind: "walk", gj: bucket.walk, stroke: "#ADFF2F" },
    ];
    for (let f of files) {
        if (!f.gj) continue;
        const srcId = lid("iso_src", sslug, f.kind);
        const fillId = lid(hid, "schools", sslug, "iso", f.kind + "_fill");
        const lineId = lid(hid, "schools", sslug, "iso", f.kind + "_stroke");
        const loadedKey = fillId + "::loaded";
        if (state.isoLoaded.has(loadedKey)) continue;

        if (!map.getSource(srcId)) map.addSource(srcId, { type: "geojson", data: f.gj });
        const colors = f.kind === "walk" ? walkingColors : cyclingColors;
        if (!map.getLayer(fillId)) map.addLayer({ id: fillId, type: "fill", source: srcId, paint: { "fill-color": bandColorExpr(colors), "fill-opacity": BAND_OPACITY_EXPR }, layout: { visibility: "none", "fill-sort-key": BAND_SORT_KEY_EXPR } });
        if (!map.getLayer(lineId)) map.addLayer({ id: lineId, type: "line", source: srcId, paint: { "line-color": f.stroke, "line-width": 2.5 }, layout: { visibility: "none" } });
        state.isoLoaded.add(loadedKey);
    }
    ensureCorrectLayerOrder();
}

export function addIsoLayersForAnyChecked() {
    for (let { slug: hid } of data.neighborhoods) {
        const slugs = data.byNeighborhood[hid].schools;
        for (let sslug of slugs) {
            const isoParentOn = state.visible.get(lid(hid, "schools", sslug, "iso")) === true;
            const anyChildOn = state.visible.get(lid(hid, "schools", sslug, "iso", "walk_fill")) === true || state.visible.get(lid(hid, "schools", sslug, "iso", "cycle_fill")) === true;
            if (isoParentOn && anyChildOn) addIsoLayersIfNeeded(hid, sslug);
        }
    }
}

export function ensureCorrectLayerOrder() {
    map.once("idle", () => {
        const allLayers = map.getStyle().layers;
        const ourLayerIds = allLayers.map((l) => l.id).filter((id) => isOurLayerId(id));
        const layerGroups = {
            isos: ourLayerIds.filter((id) => id.includes("__iso_")),
            streets: ourLayerIds.filter((id) => !id.includes("__iso_") && !id.includes("__limit") && !id.includes("__mask")),
            masks: ourLayerIds.filter((id) => id.includes("__mask")),
            limits: ourLayerIds.filter((id) => id.includes("__limit")),
        };
        const firstMapLabel = allLayers.find((l) => l.type === "symbol")?.id;
        const orderedLayers = [...layerGroups.isos, ...layerGroups.streets, ...layerGroups.masks, ...layerGroups.limits];
        for (const layerId of orderedLayers) {
            if (map.getLayer(layerId)) {
                try {
                    if (firstMapLabel) map.moveLayer(layerId, firstMapLabel);
                    else map.moveLayer(layerId);
                } catch (e) {
                    console.warn(`Could not move layer ${layerId}:`, e.message);
                }
            }
        }
    });
}

function keysRequiredForLayer(layerIdStr) {
    const parts = splitId(layerIdStr);
    if (!parts.length) return null;
    const keys = [];
    const hid = parts[0];
    if (parts[1] === "limit") return [lid(hid)];
    if (parts[1] === "mask") return [lid(hid), lid(hid, "clipping")];
    keys.push(lid(hid));
    if (parts[1] === "bg") {
        keys.push(lid(hid, "streets"));
        return keys;
    }
    if (["bike", "illegal_parking", "reserved_parking"].includes(parts[1])) {
        keys.push(lid(hid, "streets"));
        keys.push(lid(hid, parts[1]));
        return keys;
    }
    if (parts[1] === "schools") {
        keys.push(lid(hid, "schools"));
        if (parts.length >= 3) {
            const sslug = parts[2];
            keys.push(lid(hid, "schools", sslug));
            if (parts.length >= 4) {
                if (parts[3] === "assigned") {
                    keys.push(lid(hid, "schools", sslug, "assigned"));
                    return keys;
                }
                if (parts[3] === "iso") {
                    keys.push(lid(hid, "schools", sslug, "iso"));
                    if (parts.length >= 5) keys.push(lid(...parts));
                    return keys;
                }
            }
        }
    }
    return [];
}

export function applyAllVisibility() {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    for (let L of style.layers.map((x) => x.id)) {
        if (!isOurLayerId(L)) continue;
        const req = keysRequiredForLayer(L);
        if (!req) continue;
        let visible = true;
        for (let k of req) {
            if (state.visible.get(k) !== true) {
                visible = false;
                break;
            }
        }
        try {
            map.setLayoutProperty(L, "visibility", visible ? "visible" : "none");
        } catch (_) {}
    }
}

export function syncAllMarkers() {
    for (let { slug: hid } of data.neighborhoods) {
        for (let sslug of data.byNeighborhood[hid].schools) {
            syncSchoolMarker(hid, sslug);
        }
    }
}

export function syncSchoolMarker(hid, sslug) {
    const key = lid(hid, "schools", sslug);
    const req = [lid(hid), lid(hid, "schools"), key];
    const eff = req.every((k) => state.visible.get(k) === true);
    const idx = data.schoolsIndex[sslug];
    if (!idx || !idx.coord) return;
    const existing = state.markers.get(key);
    if (eff && !existing) {
        const el = document.createElement("button");
        el.className = "marker";
        el.title = idx.name || "Școală";
        const m = new maplibregl.Marker({ element: el }).setLngLat(idx.coord).addTo(map);
        state.markers.set(key, m);
    }
    if (!eff && existing) {
        existing.remove();
        state.markers.delete(key);
    }
}

export function bindGlobalStreetInteractivity() {
    if (!hoverCursorBound) {
        map.on("mousemove", function (e) {
            const feats = map.queryRenderedFeatures(e.point, { layers: streetLayerIds });
            map.getCanvas().style.cursor = feats && feats.length ? "pointer" : "";
        });
        hoverCursorBound = true;
    }
    const handleClick = function (e) {
        const feats = map.queryRenderedFeatures(e.point, { layers: streetLayerIds });
        if (!feats || !feats.length) return;
        const f = feats[0];
        const p = f.properties || {};
        const title = p.name || p.denumire || "Stradă";
        let summary = "";
        const hasBikeLane = p.bike_lane === true;
        const hasIllegalParking = p.illgl_park === true;
        const hasReservedParking = p.rsrvd_park === true;
        if (hasBikeLane) {
            summary += `<p><span class="status-icon" style="color: #00FF88;">✔</span> Pistă de biciclete: <b>Da</b></p>`;
        } else {
            summary += `<p><span class="status-icon" style="color: #ff4d4d;">✖</span> Pistă de biciclete: <b>Nu</b></p>`;
        }
        if (hasIllegalParking) {
            summary += `<p><span class="status-icon" style="color: #FFD600;">⚠</span> Parcări ilegale pe trotuar: <b>Da</b></p>`;
        }
        if (hasReservedParking) {
            summary += `<p><span class="status-icon" style="color: #F50057;">🅿️</span> Parcări amenajate pe trotuar: <b>Da</b></p>`;
        }
        if (p.arondat && data.schoolsIndex[p.arondat]) {
            summary += `<p><span class="status-icon">🏫</span> Arondată la: <b>${data.schoolsIndex[p.arondat].name}</b></p>`;
        }
        if (summary === "") {
            summary = "<p>Nu există date specifice pentru această stradă.</p>";
        }
        const html = `
        <div style="max-width:320px">
          <img class="popup-img" src="assets/street-example.jpg" alt="Exemplu stradă" />
          <div style="font-weight:700; margin:2px 0 8px 0;">${title}</div>
          <div class="popup-summary">${summary}</div>
        </div>
      `;
        new maplibregl.Popup({ closeOnClick: true, maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
    };
    if (!clickBound) {
        map.on("click", handleClick);
        clickBound = true;
    }
}

export function reinstallOverlays() {
    state.isoLoaded.clear();
    addAllLayersFromMemory();
    addIsoLayersForAnyChecked();
    ensureCorrectLayerOrder();
    applyAllVisibility();
    syncAllMarkers();
    bindGlobalStreetInteractivity();
}
