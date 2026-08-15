/**
 * Descarcă geometria străzilor din OpenStreetMap pentru municipiul Sibiu (UTF-8, diacritice).
 *
 * IMPORTANT: rulezi asta O SINGURĂ DATĂ (sau când vrei update OSM).
 * Harta în browser încarcă doar fișierul local public/osm-streets.geojson — fără Overpass la runtime.
 * Comite osm-streets.geojson pe GitHub (nu e în .gitignore).
 *
 *   npm run fetch-osm
 *
 * Alternativ: overpass-turbo.eu → Export GeoJSON → public/osm-streets.geojson
 * Relation OSM Sibiu: https://www.openstreetmap.org/relation/1252940
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../public/osm-streets.geojson");
const ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const HIGHWAY_KEEP = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "pedestrian",
  "service",
]);
const HIGHWAY_RE = `^(${[...HIGHWAY_KEEP].join("|")})$`;

const OVERPASS_QUERY = `
[out:json][timeout:300];
// Municipiul Sibiu — relation 1252940; fallback bbox dacă area nu e disponibilă pe server
(
  way["highway"~"${HIGHWAY_RE}"]["name"](area:3601252940);
  way["highway"~"${HIGHWAY_RE}"]["name"](45.75,24.08,45.83,24.22);
);
out body geom;
`.trim();

async function fetchOverpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      console.log("Overpass →", url);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
          "User-Agent": "sibiu-urban-bike-map/2.0 (local fetch-osm script)",
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn("Eșec:", e.message || e);
    }
  }
  throw lastErr || new Error("Toate endpoint-urile Overpass au eșuat");
}

function waysToGeoJSON(osm) {
  const features = [];
  const seen = new Set();
  for (const el of osm.elements || []) {
    if (el.type !== "way" || !el.geometry || !el.tags?.name) continue;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    const hw = el.tags.highway;
    if (!HIGHWAY_KEEP.has(hw)) continue;
    const coords = el.geometry.map((g) => [g.lon, g.lat]);
    if (coords.length < 2) continue;
    features.push({
      type: "Feature",
      properties: {
        osm_id: el.id,
        name: el.tags.name,
        highway: hw,
        name_ro: el.tags["name:ro"] || null,
        source: "openstreetmap",
      },
      geometry: { type: "LineString", coordinates: coords },
    });
  }
  return { type: "FeatureCollection", features };
}

const osm = await fetchOverpass(OVERPASS_QUERY);
const nEl = (osm.elements || []).length;
console.log(`Overpass elements: ${nEl}`);
const geo = waysToGeoJSON(osm);
if (!geo.features.length) {
  console.error("0 străzi după filtrare. Răspuns sample:", JSON.stringify(osm).slice(0, 400));
  process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify(geo));
console.log(`Scris ${geo.features.length} străzi → ${OUT}`);
