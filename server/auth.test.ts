import { describe, expect, it } from "vitest";
import {
  COOKIE_NAME,
  cookieHeader,
  createRateLimiter,
  createSessionRevocation,
  parseCookies,
  passwordsMatch,
  sanitizeDisplayName,
  signSession,
  verifySession,
} from "./auth";
import type { IncomingMessage } from "node:http";

describe("rate limiter", () => {
  it("blocks only after max failures and resets on success", () => {
    let t = 1_000;
    const limiter = createRateLimiter({
      now: () => t,
      maxFails: 3,
      failWindowMs: 10_000,
      maxFlood: 100,
      floodWindowMs: 60_000,
    });
    expect(limiter.recordFailure("1.1.1.1").blocked).toBe(false);
    expect(limiter.recordFailure("1.1.1.1").blocked).toBe(false);
    expect(limiter.recordFailure("1.1.1.1").blocked).toBe(false);
    expect(limiter.recordFailure("1.1.1.1").blocked).toBe(true);
    limiter.reset("1.1.1.1");
    expect(limiter.recordFailure("1.1.1.1").blocked).toBe(false);
  });

  it("does not share failure counts across IPs", () => {
    const limiter = createRateLimiter({ maxFails: 1, maxFlood: 100 });
    expect(limiter.recordFailure("10.0.0.1").blocked).toBe(false);
    expect(limiter.recordFailure("10.0.0.1").blocked).toBe(true);
    expect(limiter.recordFailure("10.0.0.2").blocked).toBe(false);
  });

  it("expires the failure window", () => {
    let t = 0;
    const limiter = createRateLimiter({
      now: () => t,
      maxFails: 1,
      failWindowMs: 1000,
      maxFlood: 100,
    });
    expect(limiter.recordFailure("ip").blocked).toBe(false);
    expect(limiter.recordFailure("ip").blocked).toBe(true);
    t = 1001;
    expect(limiter.recordFailure("ip").blocked).toBe(false);
  });

  it("flood-blocks a burst of login POSTs", () => {
    const limiter = createRateLimiter({ maxFlood: 3, floodWindowMs: 60_000, maxFails: 100 });
    expect(limiter.floodBlocked("ip").blocked).toBe(false);
    expect(limiter.floodBlocked("ip").blocked).toBe(false);
    expect(limiter.floodBlocked("ip").blocked).toBe(false);
    const blocked = limiter.floodBlocked("ip");
    expect(blocked.blocked).toBe(true);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("sessions and cookies", () => {
  const secret = "k".repeat(32);
  const sid = "ab".repeat(16);

  it("rejects expired, truncated, and forged tokens", () => {
    const good = signSession({ sid, name: "Ana", exp: Date.now() + 60_000 }, secret);
    expect(verifySession(good, secret)?.name).toBe("Ana");
    expect(verifySession(undefined, secret)).toBeNull();
    expect(verifySession(good, "")).toBeNull();
    expect(verifySession("not-a-token", secret)).toBeNull();
    expect(verifySession(good.slice(0, -2) + "xx", secret)).toBeNull();
    expect(verifySession(signSession({ sid, name: "Ana", exp: Date.now() - 1 }, secret), secret)).toBeNull();
    expect(verifySession(signSession({ sid: "short", name: "Ana", exp: Date.now() + 60_000 }, secret), secret)).toBeNull();
    expect(
      verifySession(signSession({ sid, name: "x".repeat(25), exp: Date.now() + 60_000 }, secret), secret)
    ).toBeNull();
  });

  it("sets HttpOnly / SameSite / Secure cookie flags in production", () => {
    const header = cookieHeader("tok.sig", true);
    expect(header.startsWith(`${COOKIE_NAME}=tok.sig`)).toBe(true);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
    expect(cookieHeader("tok.sig", false)).not.toContain("Secure");
  });

  it("parses only the named cookie", () => {
    const req = { headers: { cookie: "a=1; ubr_session=abc.def; b=2" } } as IncomingMessage;
    expect(parseCookies(req)[COOKIE_NAME]).toBe("abc.def");
  });
});

describe("session revocation", () => {
  it("revokes until expiry and then forgets", () => {
    const rev = createSessionRevocation();
    rev.revoke("ab".repeat(16), Date.now() + 60_000);
    expect(rev.isRevoked("ab".repeat(16))).toBe(true);
    expect(rev.isRevoked("cd".repeat(16))).toBe(false);
    rev.revoke("deadbeefdeadbeefdeadbeefdeadbeef", Date.now() - 1);
    expect(rev.isRevoked("deadbeefdeadbeefdeadbeefdeadbeef")).toBe(false);
  });
});

describe("password and display name", () => {
  it("rejects empty, oversized, and mismatched passwords", () => {
    expect(passwordsMatch("secret", "secret")).toBe(true);
    expect(passwordsMatch("secret", "Secret")).toBe(false);
    expect(passwordsMatch("", "secret")).toBe(false);
    expect(passwordsMatch("p".repeat(257), "p".repeat(257))).toBe(false);
    expect(passwordsMatch("secret", "")).toBe(false);
    expect(passwordsMatch(null, "secret")).toBe(false);
  });

  it("strips control chars and caps display names", () => {
    expect(sanitizeDisplayName("  Ana\n<script> ")).toBe("Anascript");
    expect(sanitizeDisplayName("x".repeat(80)).length).toBe(24);
    expect(sanitizeDisplayName("")).toBe("Editor");
  });
});
