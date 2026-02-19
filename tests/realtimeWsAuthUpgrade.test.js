import assert from "node:assert/strict";
import test from "node:test";

import {
  createRealtimeTestApp,
  openRealtimeWebSocket,
  waitForRealtimeMessage
} from "./helpers/realtimeTestHarness.js";

test("websocket auth is enforced on real upgrade path and authenticated subscribe carries auth context", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  await assert.rejects(() => openRealtimeWebSocket(url), /401/);

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-auth-upgrade",
      workspaceSlug: "acme",
      topics: ["projects"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "subscribed");
  assert.equal(message.requestId, "req-auth-upgrade");
  assert.equal(workspaceService.calls.length, 1);
  assert.equal(workspaceService.calls[0].userId, 7);
  assert.equal(workspaceService.calls[0].headers["x-workspace-slug"], "acme");

  socket.close();
  await app.close();
});
