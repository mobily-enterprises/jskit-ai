import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

/** Private transport from the native plugin to the application's shared executor. */
export async function createOpenCodeToolBridge({ execute, maxArgumentBytes, schemas }) {
  const token = randomBytes(32).toString("hex");
  const pending = new Map();
  let closed = false;
  let stopped;
  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, (request, response) => {
    if (closed || request.method !== "POST" || request.url !== "/call" ||
        request.headers.authorization !== `Bearer ${token}` || request.headers.origin ||
        request.headers["content-type"] !== "application/json") {
      response.writeHead(403).end();
      return;
    }
    if (pending.size >= 32) { response.writeHead(429).end(); return; }
    const controller = new AbortController();
    response.on("close", () => {
      if (!response.writableFinished) controller.abort(new Error("OpenCode tool connection closed."));
    });
    const work = (async () => {
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > maxArgumentBytes + 4096) throw new Error("OpenCode application tool arguments exceeded their size limit.");
          chunks.push(chunk);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        controller.signal.throwIfAborted();
        const result = await execute(input, controller.signal);
        if (!response.destroyed) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
      } catch (error) {
        if (!response.destroyed) response.writeHead(400, { "content-type": "application/json" })
          .end(JSON.stringify({ error: error instanceof SyntaxError ? "Invalid application tool request." : error.message }));
      }
    })().finally(() => pending.delete(controller));
    pending.set(controller, work);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    configuration: { url: `http://127.0.0.1:${server.address().port}/call`, token, schemas },
    whenIdle: () => Promise.allSettled([...pending.values()]),
    async close() {
      if (!closed) {
        closed = true;
        for (const controller of pending.keys()) controller.abort(new Error("OpenCode application tools closed."));
        stopped = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
      }
      await stopped;
      await Promise.allSettled([...pending.values()]);
    }
  };
}
