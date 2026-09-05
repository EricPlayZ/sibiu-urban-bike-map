import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runImportPipeline } from "./importPipeline";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = join(root, "public");

describe("runImportPipeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finishes with live Google Sheets through the Vite proxy", async () => {
    const origFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("google-sheet") || url.includes("docs.google.com")) {
        const gid = new URL(url, "http://localhost").searchParams.get("gid") || url.match(/gid=(\d+)/)?.[1];
        if (!gid) return new Response("bad gid", { status: 400 });
        return origFetch(`http://localhost:5500/__ubr/google-sheet?gid=${gid}`, init);
      }
      const rel = url
        .replace(/^[a-z]+:\/\/[^/]+/i, "")
        .replace(/^\.\//, "")
        .replace(/^\//, "")
        .split("?")[0];
      try {
        const buf = readFileSync(join(publicDir, rel));
        const ext = rel.split(".").pop();
        const type = ext === "json" || ext === "geojson" ? "application/json" : "text/csv";
        return new Response(buf, { status: 200, headers: { "content-type": type } });
      } catch {
        return new Response("missing", { status: 404 });
      }
    });

    const limits = JSON.parse(readFileSync(join(publicDir, "neighborhood_limits.geojson"), "utf8")) as GeoJSON.FeatureCollection;
    const t0 = Date.now();
    const result = await runImportPipeline(limits);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(result.streets.features.length).toBeGreaterThan(0);
    expect(result.report.catchment.osmMatched).toBeGreaterThan(0);
    expect(["google-sheets", "csv"]).toContain(result.report.measurementSource);
  }, 90_000);

  it("finishes with local files when Sheets fail", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("google-sheet") || url.includes("docs.google.com")) {
        return new Response("nope", { status: 502, headers: { "content-type": "text/plain" } });
      }
      const rel = url
        .replace(/^[a-z]+:\/\/[^/]+/i, "")
        .replace(/^\.\//, "")
        .replace(/^\//, "")
        .split("?")[0];
      try {
        const buf = readFileSync(join(publicDir, rel));
        const ext = rel.split(".").pop();
        const type = ext === "json" || ext === "geojson" ? "application/json" : "text/csv";
        return new Response(buf, { status: 200, headers: { "content-type": type } });
      } catch {
        return new Response("missing", { status: 404 });
      }
    });

    const limits = JSON.parse(readFileSync(join(publicDir, "neighborhood_limits.geojson"), "utf8")) as GeoJSON.FeatureCollection;
    const t0 = Date.now();
    const result = await runImportPipeline(limits);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(result.streets.features.length).toBeGreaterThan(0);
    expect(result.report.catchment.osmMatched).toBeGreaterThan(0);
  }, 90_000);
});
