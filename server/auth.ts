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
    if (!session || typeof session.sid !== "string" || typeof session.name !== "string") return null;
    if (typeof session.exp !== "number" || session.exp < Date.now()) return null;
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

export type RateLimiter = {
  allowLogin: (ip: string) => boolean;
};

export function createRateLimiter(): RateLimiter {
  const perIp = new Map<string, { count: number; reset: number }>();
  let globalCount = 0;
  let globalReset = Date.now() + 60_000;

  return {
    allowLogin(ip: string) {
      const now = Date.now();
      if (now > globalReset) {
        globalCount = 0;
        globalReset = now + 60_000;
      }
      globalCount += 1;
      if (globalCount > 30) return false;

      let row = perIp.get(ip);
      if (!row || now > row.reset) {
        row = { count: 0, reset: now + 15 * 60_000 };
        perIp.set(ip, row);
      }
      row.count += 1;
      if (perIp.size > 2000) {
        for (const [k, v] of perIp) {
          if (now > v.reset) perIp.delete(k);
        }
      }
      return row.count <= 5;
    },
  };
}

export function clientIp(req: IncomingMessage): string {
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim().slice(0, 64);
  return req.socket.remoteAddress || "unknown";
}
