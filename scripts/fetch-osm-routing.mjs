/**
 * Descarcă rețeaua OSM de mers / bicicletă pentru izocrone (Sibiu).
 *
 * Rulezi când vrei un update. Harta încarcă public/data/routing-graph.json.
 *
 *   npm run fetch-osm-routing
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../public/data/routing-graph.json");
const ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const SKIP_HW = "proposed|construction|abandoned|razed|platform|bus_stop|rest_area|services|elevator|raceway|corridor|emergency_bay|busway";

const OVERPASS_QUERY = `
[out:json][timeout:240];
(
  way["highway"]["highway"!~"^(${SKIP_HW})$"]["area"!="yes"](area:3601252940);
  way["highway"]["highway"!~"^(${SKIP_HW})$"]["area"!="yes"](45.75,24.08,45.83,24.22);
);
out body;
>;
out skel qt;
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
          "User-Agent": "sibiu-urban-bike-map/2.0 (local fetch-osm-routing script)",
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

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

function packWays(osm) {
  const nodeIndex = new Map();
  const nodes = [];
  const addNode = (id, lon, lat) => {
    if (nodeIndex.has(id)) return nodeIndex.get(id);
    const i = nodes.length / 2;
    nodes.push(round6(lon), round6(lat));
    nodeIndex.set(id, i);
    return i;
  };

  for (const el of osm.elements || []) {
    if (el.type !== "node" || el.lon == null || el.lat == null) continue;
    addNode(el.id, el.lon, el.lat);
  }

  const ways = [];
  const seen = new Set();
  for (const el of osm.elements || []) {
    if (el.type !== "way" || !el.nodes?.length || seen.has(el.id)) continue;
    seen.add(el.id);
    const hw = el.tags?.highway;
    if (!hw || hw.match(new RegExp(`^(${SKIP_HW})$`))) continue;
    const service = el.tags?.service;
    if (service === "parking_aisle" || service === "parking") continue;
    const n = [];
    for (const nid of el.nodes) {
      const i = nodeIndex.get(nid);
      if (i == null) continue;
      if (n.length && n[n.length - 1] === i) continue;
      n.push(i);
    }
    if (n.length < 2) continue;
    const rec = { n, h: hw };
    const foot = el.tags?.foot;
    const bicycle = el.tags?.bicycle;
    const access = el.tags?.access;
    const oneway = el.tags?.oneway;
    const onewayBicycle = el.tags?.["oneway:bicycle"];
    const cycleway = el.tags?.cycleway;
    if (foot) rec.f = foot;
    if (bicycle) rec.b = bicycle;
    if (access) rec.a = access;
    if (oneway) rec.o = oneway;
    if (onewayBicycle) rec.ob = onewayBicycle;
    if (cycleway) rec.cw = cycleway;
    ways.push(rec);
  }

  return {
    v: 1,
    bbox: [24.08, 45.75, 24.22, 45.83],
    nodes,
    ways,
  };
}

const osm = await fetchOverpass(OVERPASS_QUERY);
const nEl = (osm.elements || []).length;
console.log(`Overpass elements: ${nEl}`);
const graph = packWays(osm);
if (!graph.ways.length) {
  console.error("0 ways după filtrare. Sample:", JSON.stringify(osm).slice(0, 400));
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(graph));
const mb = (fs.statSync(OUT).size / (1024 * 1024)).toFixed(2);
console.log(`Scris ${graph.ways.length} ways / ${graph.nodes.length / 2} nodes → ${OUT} (${mb} MB)`);
