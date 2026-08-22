import { randomBytes } from "node:crypto";

export type ApiConfig = {
  password: string;
  sessionSecret: string;
  publicOrigin: string;
  isProduction: boolean;
  editsDir: string;
  seedDir?: string;
};

const MIN_PASSWORD_PROD = 12;
const MIN_SECRET = 32;

export function loadConfigFromEnv(): ApiConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const password = process.env.EDIT_PASSWORD || "";
  let sessionSecret = process.env.SESSION_SECRET || "";
  const publicOrigin = (process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  const editsDir = process.env.EDITS_DIR || (isProduction ? "/data" : "");
  const seedDir = process.env.SEED_DIR || (isProduction ? "/seed" : undefined);

  if (isProduction) {
    if (password.length < MIN_PASSWORD_PROD) {
      throw new Error("EDIT_PASSWORD must be set (min 12 characters) in production");
    }
    if (sessionSecret.length < MIN_SECRET) {
      throw new Error("SESSION_SECRET must be at least 32 characters in production");
    }
    if (!/^https:\/\/[^/\s]+$/i.test(publicOrigin) && !/^http:\/\/localhost(?::\d+)?$/i.test(publicOrigin)) {
      throw new Error("PUBLIC_ORIGIN must be an absolute origin (https://host) in production");
    }
    if (!editsDir) throw new Error("EDITS_DIR is required");
  } else if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString("hex");
  }

  return { password, sessionSecret, publicOrigin, isProduction, editsDir, seedDir };
}

export function originAllowed(origin: string | undefined, referer: string | undefined, config: ApiConfig): boolean {
  const candidate = origin || (referer ? originFromUrl(referer) : "");
  if (!candidate) return false;
  if (config.publicOrigin && originsEqual(candidate, config.publicOrigin)) return true;
  if (!config.isProduction) {
    try {
      const u = new URL(candidate);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }
  return false;
}

function originFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return "";
  }
}

function originsEqual(a: string, b: string) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a.replace(/\/$/, "") === b.replace(/\/$/, "");
  }
}
