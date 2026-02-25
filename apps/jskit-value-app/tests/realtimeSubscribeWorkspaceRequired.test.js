import assert from "node:assert/strict";
import test from "node:test";

import { createRealtimeTestApp, openRealtimeWebSocket, waitForRealtimeMessage } from "./helpers/realtimeTestHarness.js";

test("missing subscribe workspaceSlug returns workspace_required and does not resolve workspace context", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/v1/realtime`;

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

test("missing subscribe workspaceSlug is allowed for user-scoped topics and skips workspace context resolution", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/v1/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-user-scope",
      topics: ["alerts"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "subscribed");
  assert.equal(message.requestId, "req-user-scope");
  assert.equal(message.workspaceSlug, "");
  assert.deepEqual(message.topics, ["alerts"]);
  assert.equal(workspaceService.calls.length, 0);

  socket.close();
  await app.close();
});

test("missing subscribe workspaceSlug with mixed topic scopes still returns workspace_required", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/v1/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-mixed-scope",
      topics: ["alerts", "projects"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "error");
  assert.equal(message.requestId, "req-mixed-scope");
  assert.equal(message.code, "workspace_required");
  assert.equal(workspaceService.calls.length, 0);

  socket.close();
  await app.close();
});

test("blank unsubscribe workspaceSlug returns workspace_required and does not resolve workspace context", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/v1/realtime`;

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

test("blank unsubscribe workspaceSlug is allowed for user-scoped topics", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/v1/realtime`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-subscribe-user",
      topics: ["alerts"]
    })
  );

  const subscribed = await waitForRealtimeMessage(socket);
  assert.equal(subscribed.type, "subscribed");

  socket.send(
    JSON.stringify({
      type: "unsubscribe",
      requestId: "req-unsubscribe-user",
      workspaceSlug: "   ",
      topics: ["alerts"]
    })
  );

  const unsubscribed = await waitForRealtimeMessage(socket);
  assert.equal(unsubscribed.type, "unsubscribed");
  assert.equal(unsubscribed.requestId, "req-unsubscribe-user");
  assert.deepEqual(unsubscribed.topics, ["alerts"]);
  assert.equal(workspaceService.calls.length, 0);

  socket.close();
  await app.close();
});
