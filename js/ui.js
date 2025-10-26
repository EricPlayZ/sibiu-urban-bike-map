import { data, state } from "./config.js";
import { lid, safeDomId, pretty, walkingColors, cyclingColors } from "./config.js";
import { applyAllVisibility, syncSchoolMarker, syncAllMarkers, addIsoLayersIfNeeded } from "./map.js";

function makeRow(key, label, checked, chipColor, isGroup) {
    const row = document.createElement("div");
    row.className = "row";
    const caretBtn = document.createElement("button");
    caretBtn.className = "caret-btn";
    caretBtn.type = "button";
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = isGroup ? "▸" : "";
    if (isGroup && state.expanded.get(key) !== false) {
        caret.classList.add("expanded");
    }
    caretBtn.appendChild(caret);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    cb.id = safeDomId("cb", key);
    const chip = document.createElement("span");
    chip.className = "chip";
    if (chipColor) chip.style.background = chipColor;
    const lbl = document.createElement("label");
    lbl.htmlFor = cb.id;
    lbl.textContent = label;
    if (isGroup) row.appendChild(caretBtn);
    else {
        const spacer = document.createElement("span");
        spacer.className = "caret";
        spacer.textContent = "";
        row.appendChild(spacer);
    }
    row.appendChild(cb);
    if (chipColor) row.appendChild(chip);
    row.appendChild(lbl);
    return { row, cb, caretBtn, caret };
}

export function buildUI() {
    const host = document.getElementById("layers");
    host.innerHTML = "";
    for (let { slug: hid, name: hname } of data.neighborhoods) {
        const hoodKey = lid(hid);
        if (!state.visible.has(hoodKey)) state.visible.set(hoodKey, true);
        if (!state.expanded.has(hoodKey)) state.expanded.set(hoodKey, false);
        const hasBoundary = !!data.neighborhoodLimitsIndex[hid];
        const hoodChipColor = hasBoundary ? "#00BFFF" : null;
        const wrap = document.createElement("div");
        wrap.className = "group";
        const hoodHeader = makeRow(hoodKey, "Cartierul " + hname, state.visible.get(hoodKey), hoodChipColor, true);
        if (hasBoundary) {
            const clippingKey = lid(hid, "clipping");
            if (!state.visible.has(clippingKey)) state.visible.set(clippingKey, false);
            const clipBtn = document.createElement("button");
            clipBtn.className = "clip-btn";
            clipBtn.title = "Taie la limită";
            clipBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>`;
            if (state.visible.get(clippingKey)) clipBtn.classList.add("active");
            clipBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const isActive = !state.visible.get(clippingKey);
                state.visible.set(clippingKey, isActive);
                clipBtn.classList.toggle("active", isActive);
                applyAllVisibility();
            });
            hoodHeader.row.appendChild(clipBtn);
        }
        wrap.appendChild(hoodHeader.row);
        const hoodBody = document.createElement("div");
        hoodBody.className = "indent";
        hoodBody.style.display = state.expanded.get(hoodKey) === false ? "none" : "";
        const streetsHeaderKey = lid(hid, "streets");
        const bgKey = lid(hid, "bg");
        if (!state.visible.has(streetsHeaderKey)) state.visible.set(streetsHeaderKey, true);
        if (!state.visible.has(bgKey)) state.visible.set(bgKey, true);
        if (!state.expanded.has(streetsHeaderKey)) state.expanded.set(streetsHeaderKey, false);
        const streetsHeader = makeRow(streetsHeaderKey, "Străzi", state.visible.get(streetsHeaderKey), "#666", true);
        const streetsBody = document.createElement("div");
        streetsBody.className = "indent";
        streetsBody.style.display = state.expanded.get(streetsHeaderKey) === false ? "none" : "";
        const bikeKey = lid(hid, "bike");
        if (!state.visible.has(bikeKey)) state.visible.set(bikeKey, true);
        const reservedParkingKey = lid(hid, "reserved_parking");
        if (!state.visible.has(reservedParkingKey)) state.visible.set(reservedParkingKey, true);
        const illegalParkingKey = lid(hid, "illegal_parking");
        if (!state.visible.has(illegalParkingKey)) state.visible.set(illegalParkingKey, true);
        const bikeRow = makeRow(bikeKey, "Pistă de biciclete", state.visible.get(bikeKey), "#00FF88", false);
        const reservedParkingRow = makeRow(reservedParkingKey, "Parcări amenajate pe trotuar", state.visible.get(reservedParkingKey), "#F50057", false);
        const illegalParkingRow = makeRow(illegalParkingKey, "Parcări ilegale pe trotuar", state.visible.get(illegalParkingKey), "#FFD600", false);
        streetsBody.appendChild(bikeRow.row);
        streetsBody.appendChild(reservedParkingRow.row);
        streetsBody.appendChild(illegalParkingRow.row);
        hoodBody.appendChild(streetsHeader.row);
        hoodBody.appendChild(streetsBody);

        const schoolSlugs = data.byNeighborhood[hid].schools;
        const createSchoolUI = (sslug, parent) => {
            const schoolKey = lid(hid, "schools", sslug);
            if (!state.visible.has(schoolKey)) state.visible.set(schoolKey, true);
            if (!state.expanded.has(schoolKey)) state.expanded.set(schoolKey, false);
            const sHeader = makeRow(schoolKey, data.schoolsIndex[sslug] ? data.schoolsIndex[sslug].name : pretty(sslug), state.visible.get(schoolKey), null, true);
            const sBody = document.createElement("div");
            sBody.className = "indent";
            sBody.style.display = state.expanded.get(schoolKey) === false ? "none" : "";
            const assignedKey = lid(hid, "schools", sslug, "assigned");
            if (!state.visible.has(assignedKey)) state.visible.set(assignedKey, false);
            const assignedRow = makeRow(assignedKey, "Străzi arondate", state.visible.get(assignedKey), "#ff9100", false);
            const isoHeaderKey = lid(hid, "schools", sslug, "iso");
            if (!state.visible.has(isoHeaderKey)) state.visible.set(isoHeaderKey, true);
            if (!state.expanded.has(isoHeaderKey)) state.expanded.set(isoHeaderKey, false);
            const isoHeader = makeRow(isoHeaderKey, "Izocrone", state.visible.get(isoHeaderKey), null, true);
            const isoBody = document.createElement("div");
            isoBody.className = "indent";
            isoBody.style.display = state.expanded.get(isoHeaderKey) === false ? "none" : "";
            const walkFill = lid(hid, "schools", sslug, "iso", "walk_fill");
            const walkStroke = lid(hid, "schools", sslug, "iso", "walk_stroke");
            const cycleFill = lid(hid, "schools", sslug, "iso", "cycle_fill");
            const cycleStroke = lid(hid, "schools", sslug, "iso", "cycle_stroke");
            [walkFill, walkStroke].forEach((k) => {
                if (!state.visible.has(k)) state.visible.set(k, false);
            });
            [cycleFill, cycleStroke].forEach((k) => {
                if (!state.visible.has(k)) state.visible.set(k, true);
            });
            const walkRow = makeRow(walkFill, "Pietonal", state.visible.get(walkFill), walkingColors["10-15"], false);
            const cycleRow = makeRow(cycleFill, "Ciclopietonal", state.visible.get(cycleFill), cyclingColors["10-15"], false);
            isoBody.appendChild(walkRow.row);
            isoBody.appendChild(cycleRow.row);
            sBody.appendChild(assignedRow.row);
            sBody.appendChild(isoHeader.row);
            sBody.appendChild(isoBody);
            parent.appendChild(sHeader.row);
            parent.appendChild(sBody);
            sHeader.caretBtn.addEventListener("click", () => {
                const cur = state.expanded.get(schoolKey) !== false;
                state.expanded.set(schoolKey, !cur);
                sBody.style.display = cur ? "none" : "";
                sHeader.caret.classList.toggle("expanded", !cur);
            });
            isoHeader.caretBtn.addEventListener("click", () => {
                const cur = state.expanded.get(isoHeaderKey) !== false;
                state.expanded.set(isoHeaderKey, !cur);
                isoBody.style.display = cur ? "none" : "";
                isoHeader.caret.classList.toggle("expanded", !cur);
            });
            return { sHeader, assignedRow, isoHeader, walkRow, cycleRow, schoolKey, assignedKey, isoHeaderKey, walkFill, walkStroke, cycleFill, cycleStroke };
        };

        if (schoolSlugs.length === 1) {
            const sslug = schoolSlugs[0];
            const schoolsHeaderKey = lid(hid, "schools");
            if (!state.visible.has(schoolsHeaderKey)) state.visible.set(schoolsHeaderKey, true);
            const ui = createSchoolUI(sslug, hoodBody);
            ui.sHeader.cb.addEventListener("change", function () {
                state.visible.set(ui.schoolKey, this.checked);
                state.visible.set(schoolsHeaderKey, this.checked);
                if (this.checked && (state.visible.get(ui.walkFill) === true || state.visible.get(ui.cycleFill) === true)) addIsoLayersIfNeeded(hid, sslug);
                applyAllVisibility();
                syncSchoolMarker(hid, sslug);
            });
            ui.assignedRow.cb.addEventListener("change", function () {
                state.visible.set(ui.assignedKey, this.checked);
                applyAllVisibility();
            });
            ui.isoHeader.cb.addEventListener("change", function () {
                state.visible.set(ui.isoHeaderKey, this.checked);
                if (this.checked && (state.visible.get(ui.walkFill) === true || state.visible.get(ui.cycleFill) === true)) addIsoLayersIfNeeded(hid, sslug);
                applyAllVisibility();
            });
            ui.walkRow.cb.addEventListener("change", function () {
                [ui.walkFill, ui.walkStroke].forEach((k) => state.visible.set(k, this.checked));
                addIsoLayersIfNeeded(hid, sslug);
                applyAllVisibility();
            });
            ui.cycleRow.cb.addEventListener("change", function () {
                [ui.cycleFill, ui.cycleStroke].forEach((k) => state.visible.set(k, this.checked));
                addIsoLayersIfNeeded(hid, sslug);
                applyAllVisibility();
            });
        } else if (schoolSlugs.length > 1) {
            const schoolsHeaderKey = lid(hid, "schools");
            if (!state.visible.has(schoolsHeaderKey)) state.visible.set(schoolsHeaderKey, true);
            if (!state.expanded.has(schoolsHeaderKey)) state.expanded.set(schoolsHeaderKey, false);
            const schoolsHeader = makeRow(schoolsHeaderKey, "Școli", state.visible.get(schoolsHeaderKey), null, true);
            const schoolsBody = document.createElement("div");
            schoolsBody.className = "indent";
            schoolsBody.style.display = state.expanded.get(schoolsHeaderKey) === false ? "none" : "";
            for (let sslug of schoolSlugs) {
                const ui = createSchoolUI(sslug, schoolsBody);
                ui.sHeader.cb.addEventListener("change", function () {
                    state.visible.set(ui.schoolKey, this.checked);
                    if (this.checked && (state.visible.get(ui.walkFill) === true || state.visible.get(ui.cycleFill) === true)) addIsoLayersIfNeeded(hid, sslug);
                    applyAllVisibility();
                    syncSchoolMarker(hid, sslug);
                });
                ui.assignedRow.cb.addEventListener("change", function () {
                    state.visible.set(ui.assignedKey, this.checked);
                    applyAllVisibility();
                });
                ui.isoHeader.cb.addEventListener("change", function () {
                    state.visible.set(ui.isoHeaderKey, this.checked);
                    if (this.checked && (state.visible.get(ui.walkFill) === true || state.visible.get(ui.cycleFill) === true)) addIsoLayersIfNeeded(hid, sslug);
                    applyAllVisibility();
                });
                ui.walkRow.cb.addEventListener("change", function () {
                    [ui.walkFill, ui.walkStroke].forEach((k) => state.visible.set(k, this.checked));
                    addIsoLayersIfNeeded(hid, sslug);
                    applyAllVisibility();
                });
                ui.cycleRow.cb.addEventListener("change", function () {
                    [ui.cycleFill, ui.cycleStroke].forEach((k) => state.visible.set(k, this.checked));
                    addIsoLayersIfNeeded(hid, sslug);
                    applyAllVisibility();
                });
            }
            hoodBody.appendChild(schoolsHeader.row);
            hoodBody.appendChild(schoolsBody);
            schoolsHeader.caretBtn.addEventListener("click", () => {
                const cur = state.expanded.get(schoolsHeaderKey) !== false;
                state.expanded.set(schoolsHeaderKey, !cur);
                schoolsBody.style.display = cur ? "none" : "";
                schoolsHeader.caret.classList.toggle("expanded", !cur);
            });
            schoolsHeader.cb.addEventListener("change", function () {
                state.visible.set(schoolsHeaderKey, this.checked);
                applyAllVisibility();
                syncAllMarkers();
            });
        }

        wrap.appendChild(hoodBody);
        host.appendChild(wrap);
        hoodHeader.caretBtn.addEventListener("click", () => {
            const cur = state.expanded.get(hoodKey) !== false;
            state.expanded.set(hoodKey, !cur);
            hoodBody.style.display = cur ? "none" : "";
            hoodHeader.caret.classList.toggle("expanded", !cur);
        });
        hoodHeader.cb.addEventListener("change", function () {
            state.visible.set(hoodKey, this.checked);
            applyAllVisibility();
            syncAllMarkers();
        });
        streetsHeader.caretBtn.addEventListener("click", () => {
            const cur = state.expanded.get(streetsHeaderKey) !== false;
            state.expanded.set(streetsHeaderKey, !cur);
            streetsBody.style.display = cur ? "none" : "";
            streetsHeader.caret.classList.toggle("expanded", !cur);
        });
        streetsHeader.cb.addEventListener("change", function () {
            state.visible.set(streetsHeaderKey, this.checked);
            state.visible.set(bgKey, this.checked);
            applyAllVisibility();
        });
        bikeRow.cb.addEventListener("change", function () {
            state.visible.set(bikeKey, this.checked);
            applyAllVisibility();
        });
        reservedParkingRow.cb.addEventListener("change", function () {
            state.visible.set(reservedParkingKey, this.checked);
            applyAllVisibility();
        });
        illegalParkingRow.cb.addEventListener("change", function () {
            state.visible.set(illegalParkingKey, this.checked);
            applyAllVisibility();
        });
    }
}

export function calculateAndDisplayStats() {
    const allFeatures = data.streets && data.streets.features ? data.streets.features : [];
    if (allFeatures.length === 0) return;
    const calcStatsFor = (features) => {
        if (features.length === 0) return { bikeLanePercentage: "0.0", illegalParkingPercentage: "0.0" };
        let streetsWithBikeLanes = 0;
        let streetsWithIllegalParking = 0;
        for (const f of features) {
            const p = f.properties;
            if (!p) continue;
            if (p.bike_lane === true) streetsWithBikeLanes++;
            if (p.illgl_park === true) streetsWithIllegalParking++;
        }
        return {
            bikeLanePercentage: ((streetsWithBikeLanes / features.length) * 100).toFixed(1),
            illegalParkingPercentage: ((streetsWithIllegalParking / features.length) * 100).toFixed(1),
        };
    };
    const globalStats = calcStatsFor(allFeatures);
    let html = `
    <h4>Total Oraș</h4>
    <div class="stat-item"><span>Străzi cu pistă de biciclete:</span><b>${globalStats.bikeLanePercentage}%</b></div>
    <div class="stat-item"><span>Străzi cu parcare ilegală:</span><b>${globalStats.illegalParkingPercentage}%</b></div>
    <hr>`;
    data.neighborhoods.forEach((hood) => {
        const hoodFeatures = allFeatures.filter((f) => f.properties.cartier === hood.slug);
        const hoodStats = calcStatsFor(hoodFeatures);
        html += `
        <details class="hood-details">
            <summary>${hood.name}</summary>
            <div>
                <div class="stat-item"><span>Străzi cu pistă de biciclete:</span><b>${hoodStats.bikeLanePercentage}%</b></div>
                <div class="stat-item"><span>Străzi cu parcare ilegală:</span><b>${hoodStats.illegalParkingPercentage}%</b></div>
            </div>
        </details>
    `;
    });
    document.getElementById("stats-content").innerHTML = html;
}

export function setupPanelToggles() {
    const configs = [
        { buttonId: "layers-toggle", panelId: "layers-panel" },
        { buttonId: "stats-toggle", panelId: "stats-panel" },
        { buttonId: "faq-toggle", panelId: "faq-panel" },
        { buttonId: "basemap-toggle-btn", panelId: "footer-panel" },
    ];

    configs.forEach(({ buttonId, panelId }) => {
        const button = document.getElementById(buttonId);
        const panel = document.getElementById(panelId);
        const collapseBtn = panel.querySelector(".panel-collapse-btn");

        // Initial state
        panel.style.display = "none";
        button.style.display = "flex";

        const showPanel = () => {
            panel.style.display = "";
            button.style.display = "none";
            // Use requestAnimationFrame to ensure the display property is applied before adding the class that triggers the animation.
            requestAnimationFrame(() => {
                panel.classList.add("visible");
            });
        };

        const hidePanel = () => {
            panel.classList.remove("visible");
            button.style.display = "flex"; // <-- THE FIX: Show the button immediately.

            // Use the transitionend event ONLY to set display:none after the animation is complete.
            // This prevents the invisible panel from blocking map interactions.
            panel.addEventListener(
                "transitionend",
                (e) => {
                    if (e.propertyName === "opacity" && !panel.classList.contains("visible")) {
                        panel.style.display = "none";
                    }
                },
                { once: true }
            );
        };

        button.addEventListener("click", (e) => {
            e.stopPropagation();
            showPanel();
        });

        collapseBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            hidePanel();
        });
    });
}
