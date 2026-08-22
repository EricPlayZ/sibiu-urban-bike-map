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

function localEditsWritePlugin(): Plugin {
  const file = path.resolve(root, "public/data/local-edits.json");
  return {
    name: "local-edits-write",
    configureServer(server) {
      server.middlewares.use("/__ubr/local-edits", (req, res, next) => {
        if (req.method !== "POST") return next();
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") throw new Error("bad json");
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n");
            res.statusCode = 204;
            res.end();
          } catch {
            res.statusCode = 400;
            res.end("invalid");
          }
        });
      });
    },
  };
}

/** În `npm run dev`, scrie CSV-urile din editorul de măsurători. */
function measurementsWritePlugin(): Plugin {
  return {
    name: "measurements-write",
    configureServer(server) {
      server.middlewares.use("/__ubr/measurements", (req, res, next) => {
        if (req.method !== "POST") return next();
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { files?: unknown };
            const files = parsed?.files;
            if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("bad files");
            fs.mkdirSync(measurementsDir, { recursive: true });
            const dirReal = fs.realpathSync(measurementsDir);
            for (const [slug, text] of Object.entries(files as Record<string, unknown>)) {
              if (!/^[a-z0-9_]+$/i.test(slug) || typeof text !== "string") throw new Error("bad slug");
              const dest = path.resolve(measurementsDir, `${slug}.csv`);
              if (!fs.existsSync(dest)) throw new Error("unknown csv");
              const destReal = fs.realpathSync(dest);
              const prefix = dirReal.endsWith(path.sep) ? dirReal : dirReal + path.sep;
              if (!destReal.toLowerCase().startsWith(prefix.toLowerCase())) throw new Error("path");
              fs.writeFileSync(dest, text);
            }
            res.statusCode = 204;
            res.end();
          } catch {
            res.statusCode = 400;
            res.end("invalid");
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), measurementsManifestPlugin(), localEditsWritePlugin(), measurementsWritePlugin()],
  base: "./",
  server: { port: 5500, host: true },
});
