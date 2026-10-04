import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type ApiConfig } from "./createApi";
import { pieceSid } from "../src/lib/streetSplits";
import { originAllowed } from "./config";
import { isSafeId } from "./ids";
import { LOGIN_MAX_FAILURES, passwordsMatch, sanitizeDisplayName, signSession, verifySession } from "./auth";

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
    const token = signSession({ sid: "a".repeat(32), name: "Ana", exp: Date.now() + 60_000 }, secret);
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

  function loginHeaders(extra?: Record<string, string>) {
    return { Origin: ORIGIN, "Content-Type": "application/json", ...extra };
  }

  async function login(url: string, password: string, name = "Ana", extra?: Record<string, string>) {
    return fetch(`${url}/api/login`, {
      method: "POST",
      headers: loginHeaders(extra),
      body: JSON.stringify({ password, name }),
    });
  }

  it("lets the correct password through after several failures (no 429 on success)", async () => {
    const { server, url } = await boot();
    try {
      for (let i = 0; i < 5; i++) {
        const bad = await login(url, "wrong-password");
        expect(bad.status).toBe(401);
      }
      const ok = await login(url, "test-password-12");
      expect(ok.status).toBe(200);
      expect((await ok.json()).name).toBe("Ana");
      const setCookie = ok.headers.get("set-cookie") || "";
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Secure/i);
      expect(setCookie).toMatch(/Path=\//i);
    } finally {
      server.close();
    }
  });

  it("returns 429 only for further wrong guesses; the real password still signs in", async () => {
    const { server, url } = await boot();
    try {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
        expect((await login(url, "wrong-password")).status).toBe(401);
      }
      const locked = await login(url, "still-wrong");
      expect(locked.status).toBe(429);
      expect(locked.headers.get("retry-after")).toBeTruthy();
      const body = (await locked.json()) as { error: string; retryAfterSec: number };
      expect(body.error).toBe("too_many");
      expect(body.retryAfterSec).toBeGreaterThan(0);

      const ok = await login(url, "test-password-12", "Bogdan");
      expect(ok.status).toBe(200);
      expect((await ok.json()).name).toBe("Bogdan");
    } finally {
      server.close();
    }
  });

  it("isolates login failures per client IP", async () => {
    const { server, url } = await boot();
    try {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
        expect((await login(url, "wrong-password", "Ana", { "X-Real-IP": "10.1.1.1" })).status).toBe(401);
      }
      expect((await login(url, "wrong-password", "Ana", { "X-Real-IP": "10.1.1.1" })).status).toBe(429);
      expect((await login(url, "wrong-password", "Ana", { "X-Real-IP": "10.1.1.2" })).status).toBe(401);
      expect((await login(url, "test-password-12", "Ana", { "X-Real-IP": "10.1.1.2" })).status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("rejects login without Origin in production", async () => {
    const { server, url } = await boot();
    try {
      const r = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      expect(r.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("accepts Referer when Origin is missing", async () => {
    const { server, url } = await boot();
    try {
      const r = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: { Referer: `${ORIGIN}/echipa`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "test-password-12", name: "Ana" }),
      });
      expect(r.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("rejects expired and tampered session cookies", async () => {
    const { server, url } = await boot();
    try {
      const expired = signSession({ sid: "ab".repeat(16), name: "Ana", exp: Date.now() - 1000 }, "s".repeat(32));
      const meExpired = await fetch(`${url}/api/me`, { headers: { Cookie: `ubr_session=${expired}` } });
      expect(meExpired.status).toBe(401);

      const loginRes = await login(url, "test-password-12");
      const cookie = cookieFrom(loginRes);
      const tampered = cookie.replace(/.$/, cookie.endsWith("a") ? "b" : "a");
      const meBad = await fetch(`${url}/api/me`, { headers: { Cookie: tampered } });
      expect(meBad.status).toBe(401);

      const meOk = await fetch(`${url}/api/me`, { headers: { Cookie: cookie } });
      expect(meOk.status).toBe(200);

      const events = await fetch(`${url}/api/events`);
      expect(events.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("requires CSRF origin on authenticated writes even with a cookie", async () => {
    const { server, url } = await boot();
    try {
      const loginRes = await login(url, "test-password-12");
      const cookie = cookieFrom(loginRes);
      const r = await fetch(`${url}/api/edits/streets/st_1`, {
        method: "PUT",
        headers: { Origin: "https://evil.example", "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ carriageway_m: 7, source: "local" }),
      });
      expect(r.status).toBe(403);
    } finally {
      server.close();
    }
  });

  it("logout revokes the session cookie", async () => {
    const { server, url } = await boot();
    try {
      const loginRes = await login(url, "test-password-12");
      const cookie = cookieFrom(loginRes);
      const out = await fetch(`${url}/api/logout`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      expect(out.status).toBe(200);
      const clear = out.headers.get("set-cookie") || "";
      expect(clear).toMatch(/Max-Age=0/i);
      const me = await fetch(`${url}/api/me`, { headers: { Cookie: cookie } });
      expect(me.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("rejects oversized login bodies and overlong passwords", async () => {
    const { server, url } = await boot();
    try {
      const huge = await fetch(`${url}/api/login`, {
        method: "POST",
        headers: loginHeaders(),
        body: "x".repeat(5000),
      });
      expect(huge.status).toBe(413);
      const longPw = await login(url, "p".repeat(300));
      expect(longPw.status).toBe(401);
    } finally {
      server.close();
    }
  });

  it("GET /api/me includes session sid for authed users", async () => {
    const { server, url } = await boot();
    try {
      const loginRes = await login(url, "test-password-12", "Ana");
      const cookie = cookieFrom(loginRes);
      const me = await fetch(`${url}/api/me`, { headers: { Cookie: cookie } });
      expect(me.status).toBe(200);
      const body = (await me.json()) as { name: string; sid: string };
      expect(body.name).toBe("Ana");
      expect(typeof body.sid).toBe("string");
      expect(body.sid.length).toBeGreaterThan(8);
    } finally {
      server.close();
    }
  });

  it("DELETE building edit removes override", async () => {
    const { server, url } = await boot();
    try {
      const headers = await sessionHeaders(url, "Ana");
      await fetch(`${url}/api/edits/buildings/b_9`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ type: "casa" }),
      });
      const del = await fetch(`${url}/api/edits/buildings/b_9`, { method: "DELETE", headers });
      expect(del.status).toBe(204);
      const snap = (await (await fetch(`${url}/api/edits`)).json()) as { buildings: { edits: Record<string, unknown> } };
      expect(snap.buildings.edits.b_9).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("GET /api/edits is public; building PUT is not", async () => {
    const { server, url } = await boot();
    try {
      const pub = await fetch(`${url}/api/edits`);
      expect(pub.status).toBe(200);
      const anon = await fetch(`${url}/api/edits/buildings/b_1`, {
        method: "PUT",
        headers: loginHeaders(),
        body: JSON.stringify({ type: "casa" }),
      });
      expect(anon.status).toBe(401);
    } finally {
      server.close();
    }
  });

  async function sessionHeaders(url: string, name: string) {
    const res = await login(url, "test-password-12", name);
    return { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookieFrom(res) };
  }

  it("rejects street and building writes while another session holds the lock", async () => {
    const { server, url } = await boot();
    try {
      const ana = await sessionHeaders(url, "Ana");
      const bogdan = await sessionHeaders(url, "Bogdan");
      await fetch(`${url}/api/locks`, { method: "POST", headers: ana, body: JSON.stringify({ kind: "street", id: "st_1" }) });
      await fetch(`${url}/api/locks`, { method: "POST", headers: ana, body: JSON.stringify({ kind: "building", id: "b_1" }) });

      const street = await fetch(`${url}/api/edits/streets/st_1`, {
        method: "PUT",
        headers: bogdan,
        body: JSON.stringify({ carriageway_m: 7, source: "local" }),
      });
      expect(street.status).toBe(423);
      expect(((await street.json()) as { holder: string }).holder).toBe("Ana");

      const bld = await fetch(`${url}/api/edits/buildings/b_1`, {
        method: "PUT",
        headers: bogdan,
        body: JSON.stringify({ type: "casa" }),
      });
      expect(bld.status).toBe(423);

      // Cel care ține lock-ul poate scrie; alte entități rămân libere.
      const own = await fetch(`${url}/api/edits/streets/st_1`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ carriageway_m: 7, source: "local" }),
      });
      expect(own.status).toBe(200);
      const other = await fetch(`${url}/api/edits/streets/st_2`, {
        method: "PUT",
        headers: bogdan,
        body: JSON.stringify({ carriageway_m: 7, source: "local" }),
      });
      expect(other.status).toBe(200);
    } finally {
      server.close();
    }
  });

  it("saves street splits, hands the old measurements to the new piece and clears them on merge", async () => {
    const { server, url } = await boot();
    try {
      const ana = await sessionHeaders(url, "Ana");
      await fetch(`${url}/api/edits/streets/st_a`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ carriageway_m: 6, length_m: 400, source: "local" }),
      });
      const point = [24.16, 45.79];
      const newSid = "st_a:s" + Math.round(24.16 * 1e6).toString(36) + "-" + Math.round(45.79 * 1e6).toString(36);

      const split = await fetch(`${url}/api/edits/splits/st_a`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ points: [point], inherit: { [newSid]: "st_a" } }),
      });
      expect(split.status).toBe(200);
      const saved = (await split.json()) as { points: number[][]; inherited: Record<string, { carriageway_m?: number; length_m?: number }> };
      expect(saved.points).toEqual([point]);
      expect(saved.inherited[newSid]?.carriageway_m).toBe(6);
      expect(saved.inherited[newSid]?.length_m).toBeUndefined();

      const snap = (await (await fetch(`${url}/api/edits`)).json()) as {
        splits: { splits: Record<string, number[][]> };
        streets: { edits: Record<string, { carriageway_m?: number; length_m?: number }> };
      };
      expect(snap.splits.splits.st_a).toEqual([point]);
      expect(snap.streets.edits[newSid].carriageway_m).toBe(6);
      // Lungimea veche era a întregii străzi: nu mai are sens după tăiere.
      expect(snap.streets.edits.st_a.length_m).toBeUndefined();
      expect(snap.streets.edits.st_a.carriageway_m).toBe(6);

      const merged = await fetch(`${url}/api/edits/splits/st_a`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ points: [] }),
      });
      expect(merged.status).toBe(200);
      const after = (await (await fetch(`${url}/api/edits`)).json()) as {
        splits: { splits: Record<string, unknown> };
        streets: { edits: Record<string, unknown> };
      };
      expect(after.splits.splits.st_a).toBeUndefined();
      expect(after.streets.edits[newSid]).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("requires auth and a free street for splits", async () => {
    const { server, url } = await boot();
    try {
      const anon = await fetch(`${url}/api/edits/splits/st_a`, {
        method: "PUT",
        headers: loginHeaders(),
        body: JSON.stringify({ points: [[24.16, 45.79]] }),
      });
      expect(anon.status).toBe(401);

      const ana = await sessionHeaders(url, "Ana");
      const bogdan = await sessionHeaders(url, "Bogdan");
      await fetch(`${url}/api/locks`, { method: "POST", headers: ana, body: JSON.stringify({ kind: "street", id: "st_a" }) });
      const blocked = await fetch(`${url}/api/edits/splits/st_a`, {
        method: "PUT",
        headers: bogdan,
        body: JSON.stringify({ points: [[24.16, 45.79]] }),
      });
      expect(blocked.status).toBe(423);

      const bad = await fetch(`${url}/api/edits/splits/${encodeURIComponent("st_a:s1")}`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ points: [[24.16, 45.79]] }),
      });
      expect(bad.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("drops prototype keys in street-fixes without polluting Object.prototype", async () => {
    const { server, url } = await boot();
    try {
      const loginRes = await login(url, "test-password-12");
      const protoKey = "__proto__";
      const payload = {
        version: 1,
        renames: { [protoKey]: { polluted: "yes" }, centru: { ok_street: "Ok" } },
        omit: {},
        widths: {},
        baselines: {},
      };
      const r = await fetch(`${url}/api/edits/street-fixes`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookieFrom(loginRes) },
        body: JSON.stringify(payload),
      });
      expect(r.status).toBe(200);
      const saved = (await r.json()) as { renames: Record<string, Record<string, string>> };
      expect(saved.renames.centru.ok_street).toBe("Ok");
      expect(Object.prototype.hasOwnProperty("polluted")).toBe(false);
      expect(({} as { polluted?: string }).polluted).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("purges every building type and every split, including piece measurements", async () => {
    const { server, url } = await boot();
    try {
      const ana = await sessionHeaders(url, "Ana");
      const point: [number, number] = [24.16, 45.79];
      const piece = pieceSid("st_a", point);
      const building = await fetch(`${url}/api/edits/buildings/b_1`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ type: "casa" }),
      });
      const street = await fetch(`${url}/api/edits/streets/${encodeURIComponent(piece)}`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ carriageway_m: 4, source: "local" }),
      });
      const split = await fetch(`${url}/api/edits/splits/st_a`, {
        method: "PUT",
        headers: ana,
        body: JSON.stringify({ points: [point], inherit: {} }),
      });
      expect(building.status).toBe(200);
      expect(street.status).toBe(200);
      expect(split.status).toBe(200);

      const anon = await fetch(`${url}/api/edits/buildings/purge`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(anon.status).toBe(401);

      const purgedBuildings = await fetch(`${url}/api/edits/buildings/purge`, { method: "POST", headers: ana, body: "{}" });
      const purgedSplits = await fetch(`${url}/api/edits/splits/purge`, { method: "POST", headers: ana, body: "{}" });
      expect(purgedBuildings.status).toBe(200);
      expect(purgedSplits.status).toBe(200);
      const splitBody = (await purgedSplits.json()) as { removed: string[] };
      expect(splitBody.removed).toEqual([piece]);

      const snap = (await (await fetch(`${url}/api/edits`)).json()) as {
        buildings: { edits: Record<string, unknown> };
        splits: { splits: Record<string, unknown> };
        streets: { edits: Record<string, unknown> };
      };
      expect(snap.buildings.edits.b_1).toBeUndefined();
      expect(snap.splits.splits.st_a).toBeUndefined();
      expect(snap.streets.edits[piece]).toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("drops the edit lock when its tab disconnects and leaves the other tab alone", async () => {
    const { server, url } = await boot();
    const controllers: AbortController[] = [];
    const openEvents = async (cookie: string, tab: string) => {
      const ac = new AbortController();
      controllers.push(ac);
      const res = await fetch(`${url}/api/events?tab=${tab}`, { headers: { Cookie: cookie }, signal: ac.signal });
      expect(res.status).toBe(200);
      const reader = res.body?.getReader();
      const chunk = await reader?.read();
      expect(Buffer.from(chunk?.value || []).toString()).toContain("hello");
      return ac;
    };
    const tryLock = (headers: Record<string, string>, id: string) =>
      fetch(`${url}/api/locks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "street", id, tab: "cccccccc3ccccccc" }),
      });
    try {
      const ana = await sessionHeaders(url, "Ana");
      const bogdan = await sessionHeaders(url, "Bogdan");
      const tabA = "aaaaaaa1aaaaaaaa";
      const tabB = "bbbbbbb2bbbbbbbb";
      const eventsA = await openEvents(ana.Cookie, tabA);
      const eventsB = await openEvents(ana.Cookie, tabB);
      const lock = await fetch(`${url}/api/locks`, {
        method: "POST",
        headers: ana,
        body: JSON.stringify({ kind: "street", id: "st_1", tab: tabA }),
      });
      expect(lock.status).toBe(200);

      eventsB.abort();
      await new Promise((r) => setTimeout(r, 80));
      expect((await tryLock(bogdan, "st_1")).status).toBe(409);

      eventsA.abort();
      let status = 409;
      for (let i = 0; i < 20 && status === 409; i++) {
        status = (await tryLock(bogdan, "st_1")).status;
        if (status === 409) await new Promise((r) => setTimeout(r, 25));
      }
      expect(status).toBe(200);
    } finally {
      for (const ac of controllers) ac.abort();
      server.close();
    }
  });

  it("release-tab drops only that tab's lock", async () => {
    const { server, url } = await boot();
    try {
      const ana = await sessionHeaders(url, "Ana");
      const bogdan = await sessionHeaders(url, "Bogdan");
      const tabA = "aaaaaaa1aaaaaaaa";
      const tabB = "bbbbbbb2bbbbbbbb";
      expect((await fetch(`${url}/api/locks`, { method: "POST", headers: ana, body: JSON.stringify({ kind: "street", id: "st_1", tab: tabA }) })).status).toBe(200);
      expect((await fetch(`${url}/api/locks`, { method: "POST", headers: ana, body: JSON.stringify({ kind: "building", id: "b_1", tab: tabB }) })).status).toBe(200);
      const released = await fetch(`${url}/api/locks/release-tab`, {
        method: "POST",
        headers: ana,
        body: JSON.stringify({ tab: tabA }),
      });
      expect(released.status).toBe(200);
      expect((await fetch(`${url}/api/locks`, { method: "POST", headers: bogdan, body: JSON.stringify({ kind: "street", id: "st_1", tab: "cccccccc3ccccccc" }) })).status).toBe(200);
      expect((await fetch(`${url}/api/locks`, { method: "POST", headers: bogdan, body: JSON.stringify({ kind: "building", id: "b_1", tab: "cccccccc3ccccccc" }) })).status).toBe(409);
    } finally {
      server.close();
    }
  });
});

