import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type ApiConfig } from "./createApi";
import { originAllowed } from "./config";
import { isSafeId } from "./ids";
import { passwordsMatch, sanitizeDisplayName, signSession, verifySession } from "./auth";

const ORIGIN = "https://map.example";

function cfg(dir: string, extra?: Partial<ApiConfig>): ApiConfig {
  return {
    password: "test-password-12",
    sessionSecret: "s".repeat(32),
    publicOrigin: ORIGIN,
    isProduction: true,
    editsDir: dir,
    ...extra,
  };
}

async function listen(handle: ReturnType<typeof createApi>) {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("addr");
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

function cookieFrom(res: Response) {
  const raw = res.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

describe("ids", () => {
  it("rejects prototype keys and junk", () => {
    expect(isSafeId("st_1")).toBe(true);
    expect(isSafeId("__proto__")).toBe(false);
    expect(isSafeId("constructor")).toBe(false);
    expect(isSafeId("../etc/passwd")).toBe(false);
    expect(isSafeId("a".repeat(201))).toBe(false);
  });
});

describe("auth helpers", () => {
  it("compares passwords without leaking length via hash", () => {
    expect(passwordsMatch("test-password-12", "test-password-12")).toBe(true);
    expect(passwordsMatch("nope", "test-password-12")).toBe(false);
    expect(passwordsMatch("", "test-password-12")).toBe(false);
  });
  it("round-trips signed sessions", () => {
    const secret = "s".repeat(32);
    const token = signSession({ sid: "abc", name: "Ana", exp: Date.now() + 60_000 }, secret);
    expect(verifySession(token, secret)?.name).toBe("Ana");
    expect(verifySession(token, "other-secret-other-secret-other!!")).toBeNull();
  });
  it("sanitizes display names", () => {
    expect(sanitizeDisplayName("  Ana\n")).toBe("Ana");
    expect(sanitizeDisplayName("")).toBe("Editor");
  });
  it("csrf origin allowlist", () => {
    const c = cfg("/tmp", { isProduction: true, publicOrigin: ORIGIN });
    expect(originAllowed(ORIGIN, undefined, c)).toBe(true);
    expect(originAllowed("https://evil.example", undefined, c)).toBe(false);
    expect(originAllowed(undefined, undefined, c)).toBe(false);
  });
});

describe("team api", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  async function boot() {
    const dir = mkdtempSync(join(tmpdir(), "ubr-"));
    dirs.push(dir);
    const handle = createApi(cfg(dir));
    const { server, url } = await listen(handle);
    return { server, url, dir };
  }

  it("GET login is 405; PUT without cookie is 401", async () => {
    const { server, url } = await boot();
    try {
      const get = await fetch(`${url}/api/login`);
      expect(get.status).toBe(405);
      const put = await fetch(`${url}/api/edits/streets/st_1`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ carriageway_m: 7, source: "local" }),
      });
      expect(put.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("rejects mutating requests with the wrong origin", async () => {
    const { server, url } = await boot();
    try {
      const r = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      expect(r.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("merges two street edits without clobbering", async () => {
    const { server, url } = await boot();
    try {
      const login = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      expect(login.status).toBe(200);
      const cookie = cookieFrom(login);
      const headers = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie };
      const a = await fetch(`${url}/api/edits/streets/st_a`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ carriageway_m: 6, source: "local" }),
      });
      const b = await fetch(`${url}/api/edits/streets/st_b`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ bike1_m: 1.5, source: "local" }),
      });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const snap = await fetch(`${url}/api/edits`);
      const json = (await snap.json()) as { streets: { edits: Record<string, { carriageway_m?: number; bike1_m?: number }> } };
      expect(json.streets.edits.st_a.carriageway_m).toBe(6);
      expect(json.streets.edits.st_b.bike1_m).toBe(1.5);
    } finally {
      server.close();
    }
  });

  it("locks the same street for a second session", async () => {
    const { server, url } = await boot();
    try {
      const a = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      const b = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Bogdan" }),
      });
      const ha = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookieFrom(a) };
      const hb = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookieFrom(b) };
      const first = await fetch(`${url}/api/locks`, { method: "POST", headers: ha, body: JSON.stringify({ kind: "street", id: "st_1" }) });
      expect(first.status).toBe(200);
      const second = await fetch(`${url}/api/locks`, { method: "POST", headers: hb, body: JSON.stringify({ kind: "street", id: "st_1" }) });
      expect(second.status).toBe(409);
      const body = (await second.json()) as { holder: string };
      expect(body.holder).toBe("Ana");
    } finally {
      server.close();
    }
  });

  it("If-Match conflict on street overwrite", async () => {
    const { server, url } = await boot();
    try {
      const login = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      const headers = { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookieFrom(login) };
      const first = await fetch(`${url}/api/edits/streets/st_1`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ carriageway_m: 6, source: "local" }),
      });
      const saved = (await first.json()) as { updated_at: string };
      await fetch(`${url}/api/edits/streets/st_1`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ carriageway_m: 8, source: "local" }),
      });
      const stale = await fetch(`${url}/api/edits/streets/st_1`, {
        method: "PUT",
        headers: { ...headers, "If-Match": saved.updated_at },
        body: JSON.stringify({ carriageway_m: 9, source: "local" }),
      });
      expect(stale.status).toBe(409);
    } finally {
      server.close();
    }
  });

  it("rejects __proto__ street ids", async () => {
    const { server, url } = await boot();
    try {
      const login = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      const r = await fetch(`${url}/api/edits/streets/${encodeURIComponent("__proto__")}`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookieFrom(login) },
        body: JSON.stringify({ carriageway_m: 6, source: "local" }),
      });
      expect(r.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("saves street-fixes only when authenticated", async () => {
    const { server, url } = await boot();
    try {
      const anon = await fetch(`${url}/api/edits/street-fixes`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, renames: {}, omit: {}, widths: {}, baselines: {} }),
      });
      expect(anon.status).toBe(401);
      const login = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      const ok = await fetch(`${url}/api/edits/street-fixes`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookieFrom(login) },
        body: JSON.stringify({
          version: 1,
          extra_ignored: true,
          renames: { centru: { foo: "Foo" } },
          omit: {},
          widths: {},
          baselines: {},
        }),
      });
      expect(ok.status).toBe(200);
      const saved = (await ok.json()) as { renames: { centru: { foo: string } }; extra_ignored?: unknown };
      expect(saved.renames.centru.foo).toBe("Foo");
      expect(saved.extra_ignored).toBeUndefined();
    } finally {
      server.close();
    }
  });
});
