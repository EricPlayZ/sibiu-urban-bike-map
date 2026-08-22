const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
const SLUG_RE = /^[a-z0-9_]{1,80}$/;

const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id) && !FORBIDDEN.has(id);
}

export function isSafeSlug(slug: unknown): slug is string {
  return typeof slug === "string" && SLUG_RE.test(slug) && !FORBIDDEN.has(slug);
}

export function rejectForbiddenKeys(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  for (const key of Object.keys(obj as object)) {
    if (FORBIDDEN.has(key)) return true;
  }
  return false;
}
