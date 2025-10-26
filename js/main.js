import { data, state, baseMaps } from "./config.js";
import { map, reinstallOverlays } from "./map.js";
import { buildUI, calculateAndDisplayStats, setupPanelToggles } from "./ui.js";

function indexData() {
    // 1. Use neighborhood_limits.geojson as the source of truth for neighborhoods.
    data.neighborhoods = [];
    const slugToNameMap = new Map();
    data.neighborhoodLimitsIndex = {};

    if (data.neighborhoodLimits && data.neighborhoodLimits.features) {
        for (const feature of data.neighborhoodLimits.features) {
            const props = feature.properties;
            if (props && props.denumire && props.slug) {
                data.neighborhoods.push({ name: props.denumire, slug: props.slug });
                slugToNameMap.set(props.slug, props.denumire);
                data.neighborhoodLimitsIndex[props.slug] = feature;
            }
        }
    }
    data.neighborhoods.sort((a, b) => a.name.localeCompare(b.name));

    // 2. Group streets by their neighborhood slug (`p.cartier`).
    const byHood = {};
    const feats = data.streets && data.streets.features ? data.streets.features : [];
    for (let f of feats) {
        const p = f.properties || {};
        const hid = p.cartier || null; // This is the SLUG.
        if (!hid || !slugToNameMap.has(hid)) {
            continue;
        }

        if (!byHood[hid]) byHood[hid] = { features: [], schoolsSet: {} };
        byHood[hid].features.push(f);
        const s = p.arondat || null;
        if (s) byHood[hid].schoolsSet[s] = true;
    }

    // 3. Finalize the `byNeighborhood` data structure.
    data.byNeighborhood = {};
    for (let { slug: hid } of data.neighborhoods) {
        const hoodData = byHood[hid] || { features: [], schoolsSet: {} };
        data.byNeighborhood[hid] = {
            features: hoodData.features,
            schools: Object.keys(hoodData.schoolsSet).sort(),
            buildingCount: 0, // Initialize building count
        };
        console.log("Neighborhood", hid, "has", hoodData.features.length, "street features and", Object.keys(hoodData.schoolsSet).length, "schools assigned.");
    }

    // 4. Count buildings per neighborhood.
    const buildingFeats = data.buildings && data.buildings.features ? data.buildings.features : [];
    for (const building of buildingFeats) {
        const p = building.properties || {};
        const hid = p.cartier || null;
        if (hid && data.byNeighborhood[hid]) {
            data.byNeighborhood[hid].buildingCount++;
        }
    }

    // 5. Index schools using the 'slug' property directly.
    data.schoolsIndex = {};
    const sFeats = data.schools && data.schools.features ? data.schools.features : [];
    for (let sf of sFeats) {
        const sp = sf.properties || {};
        const sslug = sp.slug; // <-- CORRECT: Use the slug from the GeoJSON.
        if (!sslug) {
            console.warn("School feature is missing a 'slug' property, skipping:", sp);
            continue;
        }
        const nm = sp.denumire || sp.name || "";
        const numMatch = nm.match(/\d+/);

        data.schoolsIndex[sslug] = {
            name: nm,
            coord: sf.geometry && sf.geometry.coordinates,
            number: numMatch ? numMatch[0] : null,
        };
    }
}

async function prefetchIsochrones() {
    data.isochrones = {};
    for (let sslug in data.schoolsIndex) {
        data.isochrones[sslug] = {
            walk: { type: "FeatureCollection", features: [] },
            cycle: { type: "FeatureCollection", features: [] },
        };
    }

    try {
        const response = await fetch("school_isochrones.geojson", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const allIsochrones = await response.json();

        if (allIsochrones && allIsochrones.features) {
            for (const feature of allIsochrones.features) {
                const p = feature.properties;
                if (!p || !p.den_scoala || !p.tip || p.cost_level === undefined) continue;

                const sslug = p.den_scoala;
                const type = p.tip;
                const cost = p.cost_level;

                if (cost <= 300) feature.properties.band = "0-5";
                else if (cost <= 600) feature.properties.band = "5-10";
                else if (cost <= 900) feature.properties.band = "10-15";
                else feature.properties.band = "15+";

                if (data.isochrones[sslug]) {
                    if (type === "walking") {
                        data.isochrones[sslug].walk.features.push(feature);
                    } else if (type === "cycling") {
                        data.isochrones[sslug].cycle.features.push(feature);
                    }
                }
            }
        }
        for (let sslug in data.isochrones) {
            if (data.isochrones[sslug].walk.features.length === 0) data.isochrones[sslug].walk = null;
            if (data.isochrones[sslug].cycle.features.length === 0) data.isochrones[sslug].cycle = null;
        }
    } catch (e) {
        console.error("Failed to load or process school_isochrones.geojson:", e);
        for (let sslug in data.isochrones) {
            data.isochrones[sslug].walk = null;
            data.isochrones[sslug].cycle = null;
        }
    }
}

(async function preloadAll() {
    try {
        const [streets, schools, neighborhoodLimits, buildings] = await Promise.all([fetch("streets.geojson", { cache: "no-store" }).then((r) => r.json()), fetch("schools.geojson", { cache: "no-store" }).then((r) => r.json()), fetch("neighborhood_limits.geojson", { cache: "no-store" }).then((r) => r.json()), fetch("buildings.geojson", { cache: "no-store" }).then((r) => r.json())]);
        data.streets = streets;
        data.schools = schools;
        data.neighborhoodLimits = neighborhoodLimits;
        data.buildings = buildings;
        indexData();
        calculateAndDisplayStats();
        await prefetchIsochrones();
        buildUI();
        setupPanelToggles();
        state.preloaded = true;
        if (map.isStyleLoaded()) reinstallOverlays();
    } catch (e) {
        console.error("Preload failed:", e);
        document.getElementById("layers").innerHTML = "Nu s-au putut încărca fișierele .geojson";
    }
})();

const basemapSelect = document.getElementById("basemap-toggle");
baseMaps.forEach((bm, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = bm.name;
    basemapSelect.appendChild(o);
});
basemapSelect.value = 2;
basemapSelect.addEventListener("change", function () {
    map.setStyle(baseMaps[+this.value].style, { diff: false });
});

let debounceTimer = null;
map.on("styledata", () => {
    if (!state.preloaded) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => reinstallOverlays(), 0);
});
map.on("load", () => {
    if (state.preloaded) reinstallOverlays();
});
map.on("idle", () => {
    if (!state.preloaded) return;
    const firstNeighborhoodSlug = data.neighborhoods.length > 0 ? data.neighborhoods[0].slug : null;
    if (firstNeighborhoodSlug && !map.getLayer(`nb__${firstNeighborhoodSlug}__bg`)) {
        reinstallOverlays();
    }
});
