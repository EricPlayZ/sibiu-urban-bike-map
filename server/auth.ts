import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { originAllowed, type ApiConfig } from "./config";

export const COOKIE_NAME = "ubr_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_NAME = 24;
const MAX_PASSWORD = 256;

export type Session = {
  sid: string;
  name: string;
  exp: number;
};

export function sanitizeDisplayName(raw: unknown): string {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
  return s || "Editor";
}

export function passwordsMatch(submitted: unknown, expected: string): boolean {
  if (!expected) return false;
  if (typeof submitted !== "string" || submitted.length === 0 || submitted.length > MAX_PASSWORD) return false;
  const a = createHash("sha256").update(submitted).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string): Session | null {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!session || typeof session.sid !== "string" || !/^[a-f0-9]{32}$/.test(session.sid)) return null;
    if (typeof session.name !== "string" || session.name.length === 0 || session.name.length > MAX_NAME) return null;
    if (typeof session.exp !== "number" || !Number.isFinite(session.exp) || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function newSession(name: string): Session {
  return { sid: randomBytes(16).toString("hex"), name: sanitizeDisplayName(name), exp: Date.now() + SESSION_TTL_MS };
}

export function cookieHeader(token: string, isProduction: boolean, maxAgeSec = SESSION_TTL_MS / 1000): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (isProduction) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader(isProduction: boolean): string {
  return cookieHeader("deleted", isProduction, 0);
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export function sessionFromRequest(req: IncomingMessage, secret: string): Session | null {
  return verifySession(parseCookies(req)[COOKIE_NAME], secret);
}

export function csrfOk(req: IncomingMessage, config: ApiConfig): boolean {
  const method = (req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined;
  return originAllowed(origin, referer, config);
}

/** Failed passwords per IP before further wrong guesses return 429. A correct password always signs in. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_FAIL_WINDOW_MS = 15 * 60 * 1000;
/** Cheap flood cap on /api/login POSTs (any outcome) per IP. */
export const LOGIN_MAX_FLOOD = 60;
export const LOGIN_FLOOD_WINDOW_MS = 60_000;

export type RetryWait = { blocked: boolean; retryAfterSec: number };

export type RateLimiter = {
  floodBlocked: (ip: string) => RetryWait;
  recordFailure: (ip: string) => RetryWait;
  reset: (ip: string) => void;
};

export type SessionRevocation = {
  revoke: (sid: string, exp: number) => void;
  isRevoked: (sid: string) => boolean;
};

export function createSessionRevocation(): SessionRevocation {
  const sids = new Map<string, number>();

  function prune(now: number) {
    for (const [k, exp] of sids) {
      if (exp < now) sids.delete(k);
    }
  }

  return {
    revoke(sid, exp) {
      sids.set(sid, exp);
      if (sids.size > 2000) prune(Date.now());
    },
    isRevoked(sid) {
      const exp = sids.get(sid);
      if (exp == null) return false;
      if (exp < Date.now()) {
        sids.delete(sid);
        return false;
      }
      return true;
    },
  };
}

export type RateLimiterOptions = {
  now?: () => number;
  maxFails?: number;
  failWindowMs?: number;
  maxFlood?: number;
  floodWindowMs?: number;
};

type Bucket = { fails: number; failReset: number; flood: number; floodReset: number };

export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const nowFn = opts.now ?? Date.now;
  const maxFails = opts.maxFails ?? LOGIN_MAX_FAILURES;
  const failWindowMs = opts.failWindowMs ?? LOGIN_FAIL_WINDOW_MS;
  const maxFlood = opts.maxFlood ?? LOGIN_MAX_FLOOD;
  const floodWindowMs = opts.floodWindowMs ?? LOGIN_FLOOD_WINDOW_MS;
  const perIp = new Map<string, Bucket>();

  function prune(t: number) {
    if (perIp.size <= 2000) return;
    for (const [k, v] of perIp) {
      if (t > v.failReset && t > v.floodReset) perIp.delete(k);
    }
  }

  function bucket(ip: string): Bucket {
    const t = nowFn();
    let row = perIp.get(ip);
    if (!row) {
      row = { fails: 0, failReset: t + failWindowMs, flood: 0, floodReset: t + floodWindowMs };
      perIp.set(ip, row);
      prune(t);
      return row;
    }
    if (t > row.failReset) {
      row.fails = 0;
      row.failReset = t + failWindowMs;
    }
    if (t > row.floodReset) {
      row.flood = 0;
      row.floodReset = t + floodWindowMs;
    }
    return row;
  }

  function retryAfter(resetAt: number): number {
    return Math.max(1, Math.ceil((resetAt - nowFn()) / 1000));
  }

  return {
    floodBlocked(ip: string) {
      const row = bucket(ip);
      row.flood += 1;
      if (row.flood > maxFlood) return { blocked: true, retryAfterSec: retryAfter(row.floodReset) };
      return { blocked: false, retryAfterSec: 0 };
    },
    recordFailure(ip: string) {
      const row = bucket(ip);
      row.fails += 1;
      if (row.fails > maxFails) return { blocked: true, retryAfterSec: retryAfter(row.failReset) };
      return { blocked: false, retryAfterSec: 0 };
    },
    reset(ip: string) {
      const row = perIp.get(ip);
      if (row) row.fails = 0;
    },
  };
}

const IP_LIKE = /^[0-9a-fA-F.:]{2,64}$/;

export function clientIp(req: IncomingMessage): string {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string") {
    const ip = real.trim();
    if (IP_LIKE.test(ip) && !ip.includes(",")) return ip;
  }
  return req.socket.remoteAddress || "unknown";
}
