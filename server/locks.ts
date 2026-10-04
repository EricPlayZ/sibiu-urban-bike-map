export type LockKind = "street" | "building" | "sheets";

export type LockRecord = {
  key: string;
  sessionId: string;
  name: string;
  until: number;
  /** Tab-ul care a cerut lock-ul. Gol = client vechi, eliberat doar la TTL. */
  tabId: string;
};

const TTL_MS = 45_000;
const MAX_LOCKS = 200;

export function isEditTabId(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9]{8,32}$/.test(v);
}

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
    acquire(key: string, sessionId: string, name: string, tabId?: string): { ok: true } | { ok: false; holder: string; until: number } {
      prune();
      const cur = locks.get(key);
      const now = Date.now();
      if (cur && cur.sessionId !== sessionId && cur.until > now) {
        return { ok: false, holder: cur.name, until: cur.until };
      }
      if (!cur && locks.size >= MAX_LOCKS) {
        return { ok: false, holder: "sistem", until: now + TTL_MS };
      }
      const rec: LockRecord = {
        key,
        sessionId,
        name,
        until: now + TTL_MS,
        tabId: isEditTabId(tabId) ? tabId : "",
      };
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
    /** Lock-urile ținute de un tab anume. Refresh-ul închide conexiunea acelui tab. */
    releaseTab(sessionId: string, tabId: string): string[] {
      if (!isEditTabId(tabId)) return [];
      const released: string[] = [];
      for (const [key, rec] of locks) {
        if (rec.sessionId !== sessionId || rec.tabId !== tabId) continue;
        locks.delete(key);
        released.push(key);
      }
      return released;
    },
    /** Cine (altcineva decât `sessionId`) ține un lock activ pe o cheie care satisface `match`. */
    heldByOther(match: (key: string) => boolean, sessionId: string): { holder: string; key: string } | null {
      prune();
      for (const rec of locks.values()) {
        if (rec.sessionId !== sessionId && match(rec.key)) return { holder: rec.name, key: rec.key };
      }
      return null;
    },
    snapshot() {
      prune();
      return [...locks.values()].map((l) => ({ key: l.key, holder: l.name, until: l.until }));
    },
    /** Lock-uri active pe sesiune (doar străzi și clădiri — pentru prezență echipă). */
    locksBySession() {
      prune();
      const out = new Map<string, { kind: "street" | "building"; id: string }[]>();
      for (const rec of locks.values()) {
        let kind: "street" | "building" | null = null;
        let id = "";
        if (rec.key.startsWith("street:")) {
          kind = "street";
          id = rec.key.slice("street:".length);
        } else if (rec.key.startsWith("building:")) {
          kind = "building";
          id = rec.key.slice("building:".length);
        }
        if (!kind || !id) continue;
        const list = out.get(rec.sessionId) || [];
        list.push({ kind, id });
        out.set(rec.sessionId, list);
      }
      return out;
    },
  };
}

export type LockTable = ReturnType<typeof createLockTable>;
