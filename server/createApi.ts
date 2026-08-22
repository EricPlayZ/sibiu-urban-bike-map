import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { loadConfigFromEnv, type ApiConfig } from "./config";
import {
  clearCookieHeader,
  clientIp,
  cookieHeader,
  createRateLimiter,
  csrfOk,
  newSession,
  passwordsMatch,
  sessionFromRequest,
  signSession,
  sanitizeDisplayName,
  type Session,
} from "./auth";
import { ConflictError, createFileStore, seedEditsDir } from "./files";
import { createLockTable, lockKey, type LockKind } from "./locks";
import { createSseHub } from "./sse";
import { isSafeId } from "./ids";
import { pathnameOf, readBody, sendEmpty, sendJson } from "./http";
import { isBuildingType } from "../src/lib/buildingEdits";

const SMALL = 256 * 1024;
const LARGE = 1024 * 1024;

export { loadConfigFromEnv, seedEditsDir };
export type { ApiConfig };

export function createApi(config: ApiConfig) {
  seedEditsDir(config);
  const files = createFileStore(config);
  const locks = createLockTable();
  const sse = createSseHub();
  const limiter = createRateLimiter();
  const ping = setInterval(() => sse.ping(), 15_000);
  ping.unref?.();

  function requireCsrf(req: IncomingMessage, res: ServerResponse): boolean {
    if (csrfOk(req, config)) return true;
    sendJson(res, 403, { error: "forbidden" });
    return false;
  }

  function requireSession(req: IncomingMessage, res: ServerResponse): Session | null {
    const session = sessionFromRequest(req, config.sessionSecret);
    if (session) return session;
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const method = (req.method || "GET").toUpperCase();
    const path = pathnameOf(req);

    if (path === "/api/healthz" && method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("ok\n");
      return true;
    }

    if (!path.startsWith("/api/")) return false;

    try {
      if (path === "/api/login") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "method" });
          return true;
        }
        if (!requireCsrf(req, res)) return true;
        if (!limiter.allowLogin(clientIp(req))) {
          sendJson(res, 429, { error: "too_many" });
          return true;
        }
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}") as { password?: unknown; name?: unknown };
        if (!passwordsMatch(body.password, config.password)) {
          sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        const session = newSession(sanitizeDisplayName(body.name));
        const token = signSession(session, config.sessionSecret);
        res.setHeader("Set-Cookie", cookieHeader(token, config.isProduction));
        sendJson(res, 200, { name: session.name });
        return true;
      }

      if (path === "/api/logout" && method === "POST") {
        if (!requireCsrf(req, res)) return true;
        res.setHeader("Set-Cookie", clearCookieHeader(config.isProduction));
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (path === "/api/me" && method === "GET") {
        const session = sessionFromRequest(req, config.sessionSecret);
        if (!session) {
          sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        sendJson(res, 200, { name: session.name });
        return true;
      }

      if (path === "/api/edits" && method === "GET") {
        const snap = await files.snapshot();
        const body = { streets: snap.streets, buildings: snap.buildings };
        const etag = `"${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16)}"`;
        if (req.headers["if-none-match"] === etag) {
          sendEmpty(res, 304);
          return true;
        }
        res.setHeader("ETag", etag);
        sendJson(res, 200, body);
        return true;
      }

      if (path === "/api/events" && method === "GET") {
        const session = requireSession(req, res);
        if (!session) return true;
        if (!sse.add(res)) {
          sendJson(res, 503, { error: "busy" });
          return true;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify({ type: "hello", locks: locks.snapshot() })}\n\n`);
        return true;
      }

      if (path === "/api/locks" && (method === "POST" || method === "DELETE")) {
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}") as { kind?: unknown; id?: unknown };
        const kind = body.kind;
        if (kind !== "street" && kind !== "building" && kind !== "sheets") {
          sendJson(res, 400, { error: "bad_lock" });
          return true;
        }
        const id = kind === "sheets" ? undefined : String(body.id || "");
        if (kind !== "sheets" && !isSafeId(id)) {
          sendJson(res, 400, { error: "bad_id" });
          return true;
        }
        const key = lockKey(kind as LockKind, id);
        if (method === "POST") {
          const result = locks.acquire(key, session.sid, session.name);
          if (!result.ok) {
            sendJson(res, 409, { error: "locked", holder: result.holder, until: result.until });
            return true;
          }
          sse.send({ type: "lock", key, holder: session.name });
          sendJson(res, 200, { ok: true });
          return true;
        }
        const released = locks.release(key, session.sid);
        if (released) sse.send({ type: "unlock", key });
        sendJson(res, released ? 200 : 409, { ok: released });
        return true;
      }

      if (path === "/api/edits/street-fixes" && method === "PUT") {
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        const raw = JSON.parse((await readBody(req, LARGE)).toString("utf8"));
        const ifMatch = headerMatch(req);
        try {
          const saved = await files.putStreetFixes(raw, ifMatch);
          sse.send({ type: "street_fixes_updated", updated_at: saved.updated_at, by: session.name });
          sendJson(res, 200, saved);
        } catch (e) {
          handleWriteError(res, e);
        }
        return true;
      }

      if (path === "/api/edits/streets/purge" && method === "POST") {
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        await files.purgeStreets();
        sse.send({ type: "streets_purged", by: session.name });
        sendJson(res, 200, { ok: true });
        return true;
      }

      const streetPut = path.match(/^\/api\/edits\/streets\/([^/]+)$/);
      if (streetPut) {
        const sid = decodeURIComponent(streetPut[1]);
        if (!isSafeId(sid)) {
          sendJson(res, 400, { error: "bad_id" });
          return true;
        }
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        if (method === "PUT") {
          const raw = JSON.parse((await readBody(req, SMALL)).toString("utf8"));
          try {
            const saved = await files.putStreet(sid, raw, headerMatch(req));
            sse.send({ type: "street_upsert", sid, measurement: saved, by: session.name });
            sendJson(res, 200, saved);
          } catch (e) {
            handleWriteError(res, e);
          }
          return true;
        }
        if (method === "DELETE") {
          await files.deleteStreet(sid);
          sse.send({ type: "street_delete", sid, by: session.name });
          sendEmpty(res, 204);
          return true;
        }
      }

      const bldgPut = path.match(/^\/api\/edits\/buildings\/([^/]+)$/);
      if (bldgPut && method === "PUT") {
        const bid = decodeURIComponent(bldgPut[1]);
        if (!isSafeId(bid)) {
          sendJson(res, 400, { error: "bad_id" });
          return true;
        }
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        const raw = JSON.parse((await readBody(req, SMALL)).toString("utf8")) as { type?: unknown };
        if (!isBuildingType(raw.type)) {
          sendJson(res, 400, { error: "bad_type" });
          return true;
        }
        try {
          const saved = await files.putBuilding(bid, raw.type, headerMatch(req));
            sse.send({ type: "building_upsert", id: bid, buildingType: raw.type, by: session.name });
          sendJson(res, 200, saved);
        } catch (e) {
          handleWriteError(res, e);
        }
        return true;
      }

      if (method !== "GET" && method !== "HEAD") {
        sendJson(res, 405, { error: "method" });
        return true;
      }
    } catch (e) {
      if ((e as Error).message === "too_large") {
        sendJson(res, 413, { error: "too_large" });
        return true;
      }
      sendJson(res, 400, { error: "invalid" });
      return true;
    }

    sendJson(res, 404, { error: "not_found" });
    return true;
  }

  return handle;
}

function headerMatch(req: IncomingMessage): string | undefined {
  const v = req.headers["if-match"];
  if (typeof v !== "string" || !v) return undefined;
  return v.replace(/^W\//, "").replaceAll('"', "").trim();
}

function handleWriteError(res: ServerResponse, e: unknown) {
  if (e instanceof ConflictError) {
    sendJson(res, 409, { error: "conflict", current: e.current });
    return;
  }
  const msg = e instanceof Error ? e.message : "";
  if (msg === "empty" || msg === "bad_keys") {
    sendJson(res, 400, { error: msg });
    return;
  }
  if (msg === "too_many") {
    sendJson(res, 413, { error: "too_many" });
    return;
  }
  sendJson(res, 400, { error: "invalid" });
}
