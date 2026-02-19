import assert from "node:assert/strict";
import test from "node:test";

import {
  createRealtimeTestApp,
  openRealtimeWebSocket,
  waitForOptionalRealtimeMessage,
  waitForRealtimeClose,
  waitForRealtimeMessage
} from "./helpers/realtimeTestHarness.js";

test("realtime route requires websocket auth on handshake", async () => {
  const { app, port } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  await assert.rejects(() => openRealtimeWebSocket(url), /401/);

  await app.close();
});

test("subscribe succeeds for authorized topics and forces server-side context overrides", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-1",
      workspaceSlug: "acme",
      topics: ["projects", "workspace_settings"],
      surface: "app"
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "subscribed");
  assert.equal(message.requestId, "req-1");
  assert.equal(message.workspaceSlug, "acme");
  assert.deepEqual(message.topics, ["projects", "workspace_settings"]);

  assert.equal(workspaceService.calls.length, 1);
  assert.equal(workspaceService.calls[0].headers["x-surface-id"], "admin");
  assert.equal(workspaceService.calls[0].headers["x-workspace-slug"], "acme");

  socket.close();
  await app.close();
});

test("subscribe returns forbidden without projects.read permission", async () => {
  const { app, port } = await createRealtimeTestApp({
    permissionsBySlug: {
      acme: []
    }
  });
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-2",
      workspaceSlug: "acme",
      topics: ["projects"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "error");
  assert.equal(message.requestId, "req-2");
  assert.equal(message.code, "forbidden");

  socket.close();
  await app.close();
});

test("subscribe allows read-only workspace_meta topic without elevated workspace permissions", async () => {
  const { app, port } = await createRealtimeTestApp({
    permissionsBySlug: {
      acme: []
    }
  });
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-2b",
      workspaceSlug: "acme",
      topics: ["workspace_meta"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "subscribed");
  assert.equal(message.requestId, "req-2b");
  assert.deepEqual(message.topics, ["workspace_meta"]);

  socket.close();
  await app.close();
});

test("payload limit is UTF-8 byte accurate and closes oversized frames", async () => {
  const { app, port } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  const closePromise = waitForRealtimeClose(socket);

  const oversizedTs = "😀".repeat(2500);
  socket.send(
    JSON.stringify({
      type: "ping",
      requestId: "req-oversized",
      ts: oversizedTs
    })
  );

  const protocolError = await waitForOptionalRealtimeMessage(socket);
  const closeCode = await closePromise;

  if (protocolError) {
    assert.equal(protocolError.type, "error");
    assert.equal(protocolError.code, "payload_too_large");
  }
  assert.equal(closeCode, 1009);

  await app.close();
});
