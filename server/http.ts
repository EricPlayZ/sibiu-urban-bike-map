import type { IncomingMessage, ServerResponse } from "node:http";

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status: number) {
  res.statusCode = status;
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    const onData = (c: Buffer) => {
      n += c.length;
      if (n > maxBytes) {
        req.off("data", onData);
        const err = new Error("too_large");
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function pathnameOf(req: IncomingMessage): string {
  try {
    return new URL(req.url || "/", "http://n").pathname;
  } catch {
    return "/";
  }
}
