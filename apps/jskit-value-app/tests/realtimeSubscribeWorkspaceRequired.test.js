import assert from "node:assert/strict";
import test from "node:test";

import { createRealtimeTestApp, openRealtimeWebSocket, waitForRealtimeMessage } from "./helpers/realtimeTestHarness.js";

test("missing subscribe workspaceSlug returns workspace_required and does not resolve workspace context", async () => {
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
      requestId: "req-missing",
      topics: ["projects"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "error");
  assert.equal(message.requestId, "req-missing");
  assert.equal(message.code, "workspace_required");
  assert.equal(workspaceService.calls.length, 0);

  socket.close();
  await app.close();
});

test("blank unsubscribe workspaceSlug returns workspace_required and does not resolve workspace context", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "unsubscribe",
      requestId: "req-blank",
      workspaceSlug: "   ",
      topics: ["projects"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "error");
  assert.equal(message.requestId, "req-blank");
  assert.equal(message.code, "workspace_required");
  assert.equal(workspaceService.calls.length, 0);

  socket.close();
  await app.close();
});
