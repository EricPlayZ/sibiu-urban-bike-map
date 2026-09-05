/**
 * Copiază editările live de pe mapthecity.aeanet.dev în public/data.
 * Nu atinge serverul — doar citește JSON-ul public și îl scrie local (ca să-l poți comite).
 *
 *   npm run pull-edits
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public/data");
const ORIGIN = process.env.UBR_PROD_ORIGIN || "https://mapthecity.aeanet.dev";

const FILES = ["local-edits.json", "building-edits.json", "street-fixes.json"];

async function download(name) {
  const url = `${ORIGIN.replace(/\/$/, "")}/data/${name}`;
  const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const text = await r.text();
  JSON.parse(text);
  return text.endsWith("\n") ? text : `${text}\n`;
}

const t0 = Date.now();
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const name of FILES) {
  const text = await download(name);
  fs.writeFileSync(path.join(OUT_DIR, name), text, "utf8");
  console.log("ok", name, `${text.length} bytes`);
}
console.log(`gata în ${Date.now() - t0}ms — comite public/data/*.json când vrei snapshot în git`);
