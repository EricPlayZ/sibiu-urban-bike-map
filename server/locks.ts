export type LockKind = "street" | "building" | "sheets";

export type LockRecord = {
  key: string;
  sessionId: string;
  name: string;
  until: number;
};

const TTL_MS = 45_000;
const MAX_LOCKS = 200;

export function lockKey(kind: LockKind, id?: string) {
  if (kind === "sheets") return "sheets";
  return `${kind}:${id}`;
}

export function createLockTable() {
  const locks = new Map<string, LockRecord>();

  function prune(now = Date.now()) {
    for (const [k, v] of locks) {
      if (v.until <= now) locks.delete(k);
    }
  }

  return {
    acquire(key: string, sessionId: string, name: string): { ok: true } | { ok: false; holder: string; until: number } {
      prune();
      const cur = locks.get(key);
      const now = Date.now();
      if (cur && cur.sessionId !== sessionId && cur.until > now) {
        return { ok: false, holder: cur.name, until: cur.until };
      }
      if (!cur && locks.size >= MAX_LOCKS) {
        return { ok: false, holder: "sistem", until: now + TTL_MS };
      }
      const rec: LockRecord = { key, sessionId, name, until: now + TTL_MS };
      locks.set(key, rec);
      return { ok: true };
    },
    release(key: string, sessionId: string): boolean {
      const cur = locks.get(key);
      if (!cur) return true;
      if (cur.sessionId !== sessionId) return false;
      locks.delete(key);
      return true;
    },
    snapshot() {
      prune();
      return [...locks.values()].map((l) => ({ key: l.key, holder: l.name, until: l.until }));
    },
  };
}

export type LockTable = ReturnType<typeof createLockTable>;
