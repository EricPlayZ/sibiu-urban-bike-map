import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfigFromEnv, originAllowed } from "./config";

const KEYS = ["NODE_ENV", "EDIT_PASSWORD", "SESSION_SECRET", "PUBLIC_ORIGIN", "EDITS_DIR", "SEED_DIR"] as const;

describe("loadConfigFromEnv", () => {
  const prev: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of KEYS) prev[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      const v = prev[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("trims CR/LF and wrapping quotes from secrets", () => {
    process.env.NODE_ENV = "production";
    process.env.EDIT_PASSWORD = '"super-secret-pw"\r';
    process.env.SESSION_SECRET = `'${"s".repeat(32)}'\r\n`;
    process.env.PUBLIC_ORIGIN = "https://mapthecity.aeanet.dev/";
    process.env.EDITS_DIR = "/data";
    const cfg = loadConfigFromEnv();
    expect(cfg.password).toBe("super-secret-pw");
    expect(cfg.sessionSecret).toBe("s".repeat(32));
    expect(cfg.publicOrigin).toBe("https://mapthecity.aeanet.dev");
    expect(cfg.isProduction).toBe(true);
  });

  it("rejects a missing production password", () => {
    process.env.NODE_ENV = "production";
    process.env.EDIT_PASSWORD = "short";
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.PUBLIC_ORIGIN = "https://map.example";
    process.env.EDITS_DIR = "/data";
    expect(() => loadConfigFromEnv()).toThrow(/EDIT_PASSWORD/);
  });

  it("rejects a non-https public origin in production", () => {
    process.env.NODE_ENV = "production";
    process.env.EDIT_PASSWORD = "long-enough-password";
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.PUBLIC_ORIGIN = "http://mapthecity.aeanet.dev";
    process.env.EDITS_DIR = "/data";
    expect(() => loadConfigFromEnv()).toThrow(/PUBLIC_ORIGIN/);
  });
});

describe("originAllowed", () => {
  const prod = {
    password: "x",
    sessionSecret: "s".repeat(32),
    publicOrigin: "https://mapthecity.aeanet.dev",
    isProduction: true,
    editsDir: "/data",
  };

  it("allows only the configured origin in production", () => {
    expect(originAllowed("https://mapthecity.aeanet.dev", undefined, prod)).toBe(true);
    expect(originAllowed("https://mapthecity.aeanet.dev.", undefined, prod)).toBe(false);
    expect(originAllowed("https://evil.example", undefined, prod)).toBe(false);
    expect(originAllowed("null", undefined, prod)).toBe(false);
    expect(originAllowed(undefined, undefined, prod)).toBe(false);
    expect(originAllowed(undefined, "https://mapthecity.aeanet.dev/echipa", prod)).toBe(true);
  });
});
