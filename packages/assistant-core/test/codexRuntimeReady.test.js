import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CODEX_APP_SERVER_ENDPOINT_STATUS } from "../src/server/conversation/codexProcess.js";
import { waitForCodexAppServerEndpoint } from "../src/server/conversation/codexRuntime.js";

/**
 * A Unix socket server whose `answer(connectionNumber)` says whether that connection is answered or dropped, as a
 * starting app-server drops the connections it is not yet ready for; it records how many came.
 */
async function startSocketServer(t, answer) {
  const dir = await mkdtemp(join(tmpdir(), "jskit-codex-ready-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "app-server.sock");
  const server = { socketPath, connections: 0 };
  const listener = createServer((socket) => {
    server.connections += 1;
    if (answer(server.connections)) {
      socket.end("ready");
    } else {
      socket.destroy();
    }
  });
  await new Promise((resolve) => listener.listen(socketPath, resolve));
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  return server;
}

/** A probe over the socket: responsive when the server answers, unreachable when it refuses or drops the connection. */
function socketProbe(socketPath) {
  return () => new Promise((resolve) => {
    const socket = createConnection(socketPath);
    socket.once("data", () => {
      socket.destroy();
      resolve(CODEX_APP_SERVER_ENDPOINT_STATUS.RESPONSIVE);
    });
    socket.once("error", () => resolve(CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE));
    socket.once("close", () => resolve(CODEX_APP_SERVER_ENDPOINT_STATUS.UNREACHABLE));
  });
}

test("a Codex app-server whose socket refuses its first connection is ready once it answers, well before the deadline", async (t) => {
  const server = await startSocketServer(t, (connection) => connection > 1);
  const startedAt = Date.now();
  const ready = await waitForCodexAppServerEndpoint(server.socketPath, { timeoutMs: 10_000, probe: socketProbe(server.socketPath) });
  assert.equal(ready, true);
  assert.equal(server.connections, 2);
  assert.ok(Date.now() - startedAt < 5_000, "the second probe follows after a short pause, not at the deadline");
});

test("a Codex app-server whose socket never answers is not ready at the deadline, probed after a pause each time, not in a busy loop", async (t) => {
  const server = await startSocketServer(t, () => false);
  const startedAt = Date.now();
  const ready = await waitForCodexAppServerEndpoint(server.socketPath, { timeoutMs: 600, probe: socketProbe(server.socketPath) });
  const elapsed = Date.now() - startedAt;
  assert.equal(ready, false);
  assert.ok(elapsed >= 600 && elapsed < 3_000, `the wait ends at its deadline (${elapsed} ms)`);
  assert.ok(server.connections >= 2 && server.connections <= 8, `a probe every 100 ms or so (${server.connections} in 600 ms)`);
});
