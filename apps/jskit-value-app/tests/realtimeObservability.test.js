import assert from "node:assert/strict";
import test from "node:test";

import { REALTIME_TOPICS } from "../shared/eventTypes.js";
import {
  createRealtimeTestApp,
  openRealtimeWebSocket,
  waitForOptionalRealtimeMessage,
  waitForRealtimeClose,
  waitForRealtimeMessage
} from "./helpers/realtimeTestHarness.js";

test("realtime observability emits subscribe error + socket connect/disconnect events", async () => {
  const observed = [];
  const { app, port } = await createRealtimeTestApp({
    observeRealtimeEvent(payload) {
      observed.push({ ...payload });
    }
  });
  const url = `ws://127.0.0.1:${port}/api/v1/realtime?surface=app`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });
  let socketClosed = false;
  try {
    socket.send(
      JSON.stringify({
        type: "subscribe",
        requestId: "req-observe-subscribe-error",
        topics: [REALTIME_TOPICS.PROJECTS]
      })
    );

    const message = await waitForRealtimeMessage(socket);
    assert.equal(message.type, "error");
    assert.equal(message.code, "workspace_required");
  } finally {
    if (!socketClosed) {
      const closePromise = waitForRealtimeClose(socket);
      socket.close();
      await closePromise;
      socketClosed = true;
    }
    await app.close();
  }

  assert.equal(
    observed.some((entry) => entry.event === "socket_connected"),
    true
  );
  assert.equal(
    observed.some(
      (entry) =>
        entry.event === "subscribe_error" &&
        entry.code === "workspace_required" &&
        entry.phase === "subscribe" &&
        entry.surface === "app"
    ),
    true
  );
  assert.equal(
    observed.some((entry) => entry.event === "socket_disconnected"),
    true
  );
});

test("realtime observability emits subscription eviction events when authorization is revoked", async () => {
  const observed = [];
  const permissionsBySlug = {
    acme: ["chat.read"]
  };

  const { app, port, realtimeEventsService } = await createRealtimeTestApp({
    permissionsBySlug,
    observeRealtimeEvent(payload) {
      observed.push({ ...payload });
    }
  });
  const url = `ws://127.0.0.1:${port}/api/v1/realtime?surface=app`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });
  let socketClosed = false;
  try {
    socket.send(
      JSON.stringify({
        type: "subscribe",
        requestId: "req-observe-evict",
        workspaceSlug: "acme",
        topics: [REALTIME_TOPICS.CHAT]
      })
    );
    const subscribed = await waitForRealtimeMessage(socket);
    assert.equal(subscribed.type, "subscribed");

    realtimeEventsService.publishChatEvent({
      eventType: "chat.message.created",
      threadId: 999,
      scopeKind: "workspace",
      workspaceId: 11,
      workspaceSlug: "acme",
      actorUserId: 7,
      targetUserIds: [7],
      payload: {
        threadId: 999
      }
    });
    const firstEvent = await waitForRealtimeMessage(socket);
    assert.equal(firstEvent.type, "event");

    permissionsBySlug.acme = [];

    realtimeEventsService.publishChatEvent({
      eventType: "chat.message.created",
      threadId: 1000,
      scopeKind: "workspace",
      workspaceId: 11,
      workspaceSlug: "acme",
      actorUserId: 7,
      targetUserIds: [7],
      payload: {
        threadId: 1000
      }
    });
    const secondEvent = await waitForOptionalRealtimeMessage(socket, 600);
    assert.equal(secondEvent, null);
  } finally {
    if (!socketClosed) {
      const closePromise = waitForRealtimeClose(socket);
      socket.close();
      await closePromise;
      socketClosed = true;
    }
    await app.close();
  }

  assert.equal(
    observed.some(
      (entry) => entry.event === "subscription_evicted" && entry.phase === "fanout" && entry.surface === "app"
    ),
    true
  );
});
