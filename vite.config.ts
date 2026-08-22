import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createApi } from "./server/createApi";

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

function teamApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: "team-api",
    configureServer(server) {
      const editsDir = path.resolve(root, "public/data");
      if (!env.EDIT_PASSWORD) {
        console.warn("[ubr] EDIT_PASSWORD lipsește din .env.local — login-ul de echipă nu va funcționa.");
      }
      const handle = createApi({
        password: env.EDIT_PASSWORD || "",
        sessionSecret: env.SESSION_SECRET || "dev-session-secret-please-set-env-local!!",
        publicOrigin: (env.PUBLIC_ORIGIN || "http://localhost:5500").replace(/\/$/, ""),
        isProduction: false,
        editsDir,
        seedDir: editsDir,
      });
      server.middlewares.use((req, res, next) => {
        const url = req.url || "";
        if (!url.startsWith("/api/") && url !== "/api") {
          next();
          return;
        }
        void handle(req, res).then((ok) => {
          if (!ok) next();
        });
      });
    },
  };
}

const SHEET_ID = "1Xi_cYqgpAp45mNvv6YeNCdBSRnmpwKUE3VoyfN-cLT8";

/** Proxy CSV Google Sheets în `npm run dev` (evită CORS). */
function googleSheetProxyPlugin(): Plugin {
  return {
    name: "google-sheet-proxy",
    configureServer(server) {
      server.middlewares.use("/__ubr/google-sheet", (req, res, next) => {
        if (req.method !== "GET") return next();
        const url = new URL(req.url || "", "http://localhost");
        const gid = url.searchParams.get("gid") || "";
        if (!/^\d+$/.test(gid)) {
          res.statusCode = 400;
          res.end("bad gid");
          return;
        }
        const target = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
        fetch(target)
          .then(async (r) => {
            const text = await r.text();
            res.statusCode = r.ok ? 200 : r.status;
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.end(text);
          })
          .catch(() => {
            res.statusCode = 502;
            res.end("sheet fetch failed");
          });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  return {
    plugins: [
      react(),
      measurementsManifestPlugin(),
      teamApiPlugin(env),
      googleSheetProxyPlugin(),
    ],
    base: "./",
    server: { port: 5500, host: true },
  };
});
