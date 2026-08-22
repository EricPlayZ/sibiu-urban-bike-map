import type { ServerResponse } from "node:http";

const MAX_CLIENTS = 20;

export type SseEvent = { type: string; [k: string]: unknown };

export function createSseHub() {
  const clients = new Set<ServerResponse>();

  function drop(res: ServerResponse) {
    clients.delete(res);
  }

  return {
    size() {
      return clients.size;
    },
    add(res: ServerResponse): boolean {
      if (clients.size >= MAX_CLIENTS) return false;
      clients.add(res);
      res.on("close", () => drop(res));
      return true;
    },
    send(event: SseEvent) {
      const payload = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) {
        try {
          res.write(payload);
        } catch {
          drop(res);
        }
      }
    },
    ping() {
      for (const res of clients) {
        try {
          res.write(`: ping\n\n`);
        } catch {
          drop(res);
        }
      }
    },
  };
}

export type SseHub = ReturnType<typeof createSseHub>;
