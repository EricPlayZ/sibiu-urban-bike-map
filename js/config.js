export const baseMaps = [
    { name: "OpenStreetMap", style: "https://raw.githubusercontent.com/go2garret/maps/main/src/assets/json/openStreetMap.json" },
    {
        name: "Google-like",
        style: {
            version: 8,
            sources: {
                cartoLight: {
                    type: "raster",
                    tiles: ["https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}{scale}.png", "https://cartodb-basemaps-b.global.ssl.fastly.net/light_all/{z}/{x}/{y}{scale}.png", "https://cartodb-basemaps-c.global.ssl.fastly.net/light_all/{z}/{x}/{y}{scale}.png", "https://cartodb-basemaps-d.global.ssl.fastly.net/light_all/{z}/{x}/{y}{scale}.png"],
                    tileSize: 256,
                    attribution: "© OpenStreetMap contributors © CARTO",
                },
            },
            layers: [
                {
                    id: "cartoLight",
                    type: "raster",
                    source: "cartoLight",
                    minzoom: 0,
                    maxzoom: 20,
                },
            ],
        },
    },
    {
        name: "Dark (OSM / CARTO)",
        style: {
            version: 8,
            sources: {
                cartoDark: {
                    type: "raster",
                    tiles: ["https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}{scale}.png", "https://cartodb-basemaps-b.global.ssl.fastly.net/dark_all/{z}/{x}/{y}{scale}.png", "https://cartodb-basemaps-c.global.ssl.fastly.net/dark_all/{z}/{x}/{y}{scale}.png", "https://cartodb-basemaps-d.global.ssl.fastly.net/dark_all/{z}/{x}/{y}{scale}.png"],
                    tileSize: 256,
                    attribution: "© OpenStreetMap contributors © CARTO",
                },
            },
            layers: [{ id: "cartoDark", type: "raster", source: "cartoDark", minzoom: 0, maxzoom: 20 }],
        },
    },
    { name: "None", style: { version: 8, sources: {}, layers: [] } },
];

export const NS = "nb";
export const lid = (...parts) => NS + "__" + parts.join("__");
export const isOurLayerId = (id) => id && id.indexOf(NS + "__") === 0;
export const splitId = (id) => (isOurLayerId(id) ? id.slice(NS.length + 2).split("__") : []);
export const safeDomId = (prefix, key) => prefix + "_" + btoa(key).replace(/=+/g, "");
export const pretty = (s) =>
    String(s || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());

export const BIKE_EXPR = ["==", ["get", "bike_lane"], true];
export const ILLEGAL_PARKING_EXPR = ["==", ["get", "illgl_park"], true];
export const RESERVED_PARKING_EXPR = ["==", ["get", "rsrvd_park"], true];

//export const walkingColors = { "0-5": "#A7FFEB", "5-10": "#64FFDA", "10-15": "#18FFFF", "15+": "#00E5FF" };
//export const cyclingColors = { "0-5": "#B388FF", "5-10": "#7C4DFF", "10-15": "#651FFF", "15+": "#6200EA" };
export const walkingColors = { "0-5": "#A7FFEB", "5-10": "#A7FFEB", "10-15": "#64FFDA", "15+": "#64FFDA" };
export const cyclingColors = { "0-5": "#B388FF", "5-10": "#B388FF", "10-15": "#7C4DFF", "15+": "#7C4DFF" };
export const bandColorExpr = (colors) => ["match", ["get", "band"], "0-5", colors["0-5"], "5-10", colors["5-10"], "10-15", colors["10-15"], "15+", colors["15+"], colors["0-5"]];
export const BAND_OPACITY_EXPR = ["match", ["get", "band"], "0-5", 0.65, "5-10", 0.55, "10-15", 0.45, "15+", 0.35, 0.5];
export const BAND_SORT_KEY_EXPR = ["match", ["get", "band"], "0-5", 3, "5-10", 2, "10-15", 1, "15+", 0, 0];
export const MAP_DARK_BG = getComputedStyle(document.documentElement).getPropertyValue("--map-dark-bg").trim();

export const data = {
    streets: null,
    schools: null,
    neighborhoodLimits: null,
    buildings: null,
    neighborhoods: [],
    byNeighborhood: {},
    schoolsIndex: {},
    isochrones: {},
    neighborhoodLimitsIndex: {},
};

export const state = {
    visible: new Map(),
    expanded: new Map(),
    markers: new Map(),
    isoLoaded: new Set(),
    preloaded: false,
};
