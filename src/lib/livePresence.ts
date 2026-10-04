export type PresenceLock = { kind: "street" | "building"; id: string };
export type PresenceUser = { sid: string; name: string; locks: PresenceLock[] };
type Listener = (users: PresenceUser[]) => void;
const listeners = new Set<Listener>();
let current: PresenceUser[] = [];
export function getPresence(): PresenceUser[] { return current; }
export function setPresence(users: PresenceUser[]) {
  current = users;
  for (const fn of listeners) fn(users);
}
export function subscribePresence(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => { listeners.delete(fn); };
}
