import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { loadConfigFromEnv, type ApiConfig } from "./config";
import {
  clearCookieHeader,
  clientIp,
  cookieHeader,
  createRateLimiter,
  createSessionRevocation,
  csrfOk,
  newSession,
  passwordsMatch,
  sessionFromRequest,
  signSession,
  sanitizeDisplayName,
  type Session,
} from "./auth";
import { ConflictError, createFileStore, seedEditsDir } from "./files";
import { createLockTable, isEditTabId, lockKey, type LockKind } from "./locks";
import { createSseHub } from "./sse";
import { isSafeId } from "./ids";
import { pathnameOf, readBody, sendEmpty, sendJson } from "./http";
import { normalizeBuildingType } from "../src/lib/buildingEdits";
import { SPLIT_SEP } from "../src/lib/streetSplits";

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
  const revoked = createSessionRevocation();
  const ping = setInterval(() => sse.ping(), 15_000);
  ping.unref?.();

  type SseConn = { sid: string; name: string; tab: string };
  const sseOnline = new Map<ServerResponse, SseConn>();

  function presenceUsers() {
    const bySid = new Map<string, string>();
    for (const { sid, name } of sseOnline.values()) bySid.set(sid, name);
    const locksBySid = locks.locksBySession();
    return [...bySid.entries()].map(([sid, name]) => ({
      sid,
      name,
      locks: locksBySid.get(sid) || [],
    }));
  }

  function broadcastPresence() {
    sse.send({ type: "presence", users: presenceUsers() });
  }

  function releaseTabLocks(sid: string, tab: string) {
    if (!tab) return;
    const still = [...sseOnline.values()].some((c) => c.sid === sid && c.tab === tab);
    if (still) return;
    for (const key of locks.releaseTab(sid, tab)) sse.send({ type: "unlock", key });
  }

  function unregisterSse(res: ServerResponse) {
    const conn = sseOnline.get(res);
    if (!sseOnline.delete(res) || !conn) return;
    releaseTabLocks(conn.sid, conn.tab);
    broadcastPresence();
  }

  function tabFromRequest(req: IncomingMessage): string {
    try {
      const tab = new URL(req.url || "/", "http://n").searchParams.get("tab") || "";
      return isEditTabId(tab) ? tab : "";
    } catch {
      return "";
    }
  }

  function requireCsrf(req: IncomingMessage, res: ServerResponse): boolean {
    if (csrfOk(req, config)) return true;
    sendJson(res, 403, { error: "forbidden" });
    return false;
  }

  function liveSession(req: IncomingMessage): Session | null {
    const session = sessionFromRequest(req, config.sessionSecret);
    if (!session || revoked.isRevoked(session.sid)) return null;
    return session;
  }

  /** Scrierile sunt respinse când altcineva ține lock-ul entității (ca doi editori să nu se calce pe picioare). */
  function rejectIfLocked(res: ServerResponse, session: Session, match: (key: string) => boolean): boolean {
    const other = locks.heldByOther(match, session.sid);
    if (!other) return false;
    sendJson(res, 423, { error: "locked", holder: other.holder });
    return true;
  }

  function requireSession(req: IncomingMessage, res: ServerResponse): Session | null {
    const session = liveSession(req);
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
        const ip = clientIp(req);
        const flood = limiter.floodBlocked(ip);
        if (flood.blocked) {
          sendTooMany(res, flood.retryAfterSec);
          return true;
        }
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}") as { password?: unknown; name?: unknown };
        if (!passwordsMatch(body.password, config.password)) {
          const fail = limiter.recordFailure(ip);
          if (fail.blocked) {
            sendTooMany(res, fail.retryAfterSec);
            return true;
          }
          sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        limiter.reset(ip);
        const session = newSession(sanitizeDisplayName(body.name));
        const token = signSession(session, config.sessionSecret);
        res.setHeader("Set-Cookie", cookieHeader(token, config.isProduction));
        sendJson(res, 200, { name: session.name });
        return true;
      }

      if (path === "/api/logout" && method === "POST") {
        if (!requireCsrf(req, res)) return true;
        const session = liveSession(req);
        if (session) revoked.revoke(session.sid, session.exp);
        res.setHeader("Set-Cookie", clearCookieHeader(config.isProduction));
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (path === "/api/me" && method === "GET") {
        const session = liveSession(req);
        if (!session) {
          sendJson(res, 401, { error: "unauthorized" });
          return true;
        }
        sendJson(res, 200, { name: session.name, sid: session.sid });
        return true;
      }

      if (path === "/api/edits" && method === "GET") {
        const snap = await files.snapshot();
        const body = { streets: snap.streets, buildings: snap.buildings, splits: snap.splits };
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
        const tab = tabFromRequest(req);
        // Conexiunea nouă aparține documentului curent. Lock-ul documentului anterior (refresh) cade aici.
        if (tab) {
          for (const key of locks.releaseTab(session.sid, tab)) sse.send({ type: "unlock", key });
        }
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
        sseOnline.set(res, { sid: session.sid, name: session.name, tab });
        res.on("close", () => unregisterSse(res));
        res.write(`data: ${JSON.stringify({ type: "hello", locks: locks.snapshot() })}\n\n`);
        broadcastPresence();
        return true;
      }

      if (path === "/api/locks" && (method === "POST" || method === "DELETE")) {
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}") as {
          kind?: unknown;
          id?: unknown;
          tab?: unknown;
        };
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
          const result = locks.acquire(key, session.sid, session.name, isEditTabId(body.tab) ? body.tab : undefined);
          if (!result.ok) {
            sendJson(res, 409, { error: "locked", holder: result.holder, until: result.until });
            return true;
          }
          sse.send({ type: "lock", key, holder: session.name });
          broadcastPresence();
          sendJson(res, 200, { ok: true });
          return true;
        }
        const released = locks.release(key, session.sid);
        if (released) {
          sse.send({ type: "unlock", key });
          broadcastPresence();
        }
        sendJson(res, released ? 200 : 409, { ok: released });
        return true;
      }

      if (path === "/api/locks/release-tab" && method === "POST") {
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}") as { tab?: unknown };
        if (!isEditTabId(body.tab)) {
          sendJson(res, 400, { error: "bad_tab" });
          return true;
        }
        for (const key of locks.releaseTab(session.sid, body.tab)) sse.send({ type: "unlock", key });
        broadcastPresence();
        sendJson(res, 200, { ok: true });
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

      if (path === "/api/edits/buildings/purge" && method === "POST") {
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        const saved = await files.purgeBuildings();
        sse.send({ type: "buildings_purged", updated_at: saved.updated_at, by: session.name });
        sendJson(res, 200, saved);
        return true;
      }

      if (path === "/api/edits/splits/purge" && method === "POST") {
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        const saved = await files.purgeSplits();
        sse.send({ type: "splits_purged", removed: saved.removed, updated_at: saved.updated_at, by: session.name });
        sendJson(res, 200, saved);
        return true;
      }

      const splitsPut = path.match(/^\/api\/edits\/splits\/([^/]+)$/);
      if (splitsPut && method === "PUT") {
        const root = decodeURIComponent(splitsPut[1]);
        if (!isSafeId(root) || root.includes(SPLIT_SEP)) {
          sendJson(res, 400, { error: "bad_id" });
          return true;
        }
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        if (rejectIfLocked(res, session, (k) => k === `street:${root}` || k.startsWith(`street:${root}${SPLIT_SEP}`))) {
          return true;
        }
        const raw = JSON.parse((await readBody(req, SMALL)).toString("utf8")) as { points?: unknown; inherit?: unknown };
        try {
          const saved = await files.putSplits(root, raw.points, raw.inherit, headerMatch(req));
          sse.send({
            type: "splits_updated",
            sid: root,
            points: saved.points,
            removed: saved.removed,
            inherited: saved.inherited,
            rootEdit: saved.rootEdit,
            updated_at: saved.updated_at,
            by: session.name,
          });
          sendJson(res, 200, saved);
        } catch (e) {
          handleWriteError(res, e);
        }
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
        if (rejectIfLocked(res, session, (k) => k === `street:${sid}`)) return true;
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
      if (bldgPut && (method === "PUT" || method === "DELETE")) {
        const bid = decodeURIComponent(bldgPut[1]);
        if (!isSafeId(bid)) {
          sendJson(res, 400, { error: "bad_id" });
          return true;
        }
        if (!requireCsrf(req, res)) return true;
        const session = requireSession(req, res);
        if (!session) return true;
        if (rejectIfLocked(res, session, (k) => k === `building:${bid}`)) return true;
        if (method === "DELETE") {
          await files.deleteBuilding(bid);
          sse.send({ type: "building_delete", id: bid, by: session.name });
          sendEmpty(res, 204);
          return true;
        }
        const raw = JSON.parse((await readBody(req, SMALL)).toString("utf8")) as { type?: unknown };
        const type = normalizeBuildingType(raw.type);
        if (!type) {
          sendJson(res, 400, { error: "bad_type" });
          return true;
        }
        try {
          const saved = await files.putBuilding(bid, type, headerMatch(req));
          sse.send({ type: "building_upsert", id: bid, buildingType: type, by: session.name });
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

function sendTooMany(res: ServerResponse, retryAfterSec: number) {
  res.setHeader("Retry-After", String(retryAfterSec));
  sendJson(res, 429, { error: "too_many", retryAfterSec });
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
