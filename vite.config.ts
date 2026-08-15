import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
const measurementsDir = path.resolve(root, "public/data/measurements");
const generatedTs = path.resolve(root, "src/lib/measurementsSlugs.generated.ts");

/** Detectează CSV-urile din public/data/measurements și le scrie în:
 *  - manifest.json (vizibil pe disk / GitHub)
 *  - measurementsSlugs.generated.ts (importat în app — fără fetch fragil la runtime)
 */
function measurementsManifestPlugin(): Plugin {
  const write = () => {
    if (!fs.existsSync(measurementsDir)) fs.mkdirSync(measurementsDir, { recursive: true });
    const slugs = fs
      .readdirSync(measurementsDir)
      .filter((f) => f.toLowerCase().endsWith(".csv"))
      .map((f) => f.replace(/\.csv$/i, ""))
      .sort();
    fs.writeFileSync(path.join(measurementsDir, "manifest.json"), JSON.stringify({ slugs }, null, 2) + "\n");
    fs.writeFileSync(
      generatedTs,
      `/** Generat automat de vite (measurementsManifestPlugin) — nu edita manual. */\n` +
        `export const MEASUREMENT_CSV_SLUGS = ${JSON.stringify(slugs, null, 2)} as const;\n`
    );
  };
  return {
    name: "measurements-manifest",
    buildStart() {
      write();
    },
    configureServer(server) {
      write();
      server.watcher.add(measurementsDir);
      const maybeRewrite = (file: string) => {
        if (file.includes(`${path.sep}measurements${path.sep}`) && file.toLowerCase().endsWith(".csv")) write();
      };
      server.watcher.on("add", maybeRewrite);
      server.watcher.on("unlink", maybeRewrite);
    },
  };
}

export default defineConfig({
  plugins: [react(), measurementsManifestPlugin()],
  base: "./",
  server: { port: 5500, host: true },
});
