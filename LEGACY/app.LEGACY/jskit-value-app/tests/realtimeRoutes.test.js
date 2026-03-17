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

test("realtime registration can require Redis adapter", async () => {
  await assert.rejects(
    () =>
      createRealtimeTestApp({
        requireRedisAdapter: true
      }),
    /REDIS_URL is required/
  );
});

test("realtime route requires websocket auth on handshake", async () => {
  const { app, port } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  await assert.rejects(
    () => openRealtimeWebSocket(url),
    (error) => String(error?.data?.code || "") === "unauthorized"
  );

  await app.close();
});

test("targeted chat events fan out only to requested user rooms", async () => {
  const { app, port, realtimeEventsService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  const recipientOne = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=u11"
    }
  });
  const recipientTwo = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=u12"
    }
  });
  const nonRecipient = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=u13"
    }
  });

  recipientOne.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-chat-subscribe-u11",
      workspaceSlug: "acme",
      topics: [REALTIME_TOPICS.CHAT]
    })
  );
  recipientTwo.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-chat-subscribe-u12",
      workspaceSlug: "acme",
      topics: [REALTIME_TOPICS.CHAT]
    })
  );
  nonRecipient.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-chat-subscribe-u13",
      workspaceSlug: "acme",
      topics: [REALTIME_TOPICS.CHAT]
    })
  );

  const subscribeMessages = await Promise.all([
    waitForRealtimeMessage(recipientOne),
    waitForRealtimeMessage(recipientTwo),
    waitForRealtimeMessage(nonRecipient)
  ]);
  assert.equal(subscribeMessages[0].type, "subscribed");
  assert.equal(subscribeMessages[1].type, "subscribed");
  assert.equal(subscribeMessages[2].type, "subscribed");

  realtimeEventsService.publishChatEvent({
    eventType: "chat.message.created",
    threadId: 501,
    scopeKind: "workspace",
    workspaceId: 11,
    workspaceSlug: "acme",
    actorUserId: 11,
    targetUserIds: [11, 12],
    payload: {
      threadId: 501,
      message: {
        id: 99
      }
    }
  });

  const [firstDelivery, secondDelivery] = await Promise.all([
    waitForRealtimeMessage(recipientOne),
    waitForRealtimeMessage(recipientTwo)
  ]);
  const nonDelivery = await waitForOptionalRealtimeMessage(nonRecipient, 500);

  assert.equal(firstDelivery.type, "event");
  assert.equal(firstDelivery.event.eventType, "chat.message.created");
  assert.equal(firstDelivery.event.threadId, "501");
  assert.equal(secondDelivery.type, "event");
  assert.equal(secondDelivery.event.eventType, "chat.message.created");
  assert.equal(nonDelivery, null);

  recipientOne.close();
  recipientTwo.close();
  nonRecipient.close();
  await app.close();
});

test("targeted chat fanout works for global DM events without workspace subscriptions", async () => {
  const { app, port, realtimeEventsService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime`;

  const leftSocket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=u21"
    }
  });
  const rightSocket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=u22"
    }
  });

  realtimeEventsService.publishChatEvent({
    eventType: "chat.thread.read.updated",
    threadId: 702,
    scopeKind: "global",
    workspaceId: null,
    actorUserId: 21,
    targetUserIds: [21, 22],
    payload: {
      threadId: 702,
      userId: 21,
      lastReadSeq: 7,
      lastReadMessageId: 44
    }
  });

  const [leftDelivery, rightDelivery] = await Promise.all([
    waitForRealtimeMessage(leftSocket),
    waitForRealtimeMessage(rightSocket)
  ]);

  assert.equal(leftDelivery.type, "event");
  assert.equal(leftDelivery.event.scopeKind, "global");
  assert.equal(leftDelivery.event.workspaceId, null);
  assert.equal(rightDelivery.type, "event");
  assert.equal(rightDelivery.event.scopeKind, "global");
  assert.equal(rightDelivery.event.workspaceId, null);

  leftSocket.close();
  rightSocket.close();
  await app.close();
});

test("user-scoped alerts require explicit topic subscription but do not require workspaceSlug", async () => {
  const { app, port, workspaceService, realtimeEventsService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=console`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  realtimeEventsService.publish({
    eventId: "evt-alert-before-subscribe",
    eventType: "user.alert.created",
    topic: REALTIME_TOPICS.ALERTS,
    targetUserIds: [7],
    payload: {
      alertId: 1001
    }
  });

  const beforeSubscribe = await waitForOptionalRealtimeMessage(socket, 350);
  assert.equal(beforeSubscribe, null);

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-alert-subscribe",
      topics: [REALTIME_TOPICS.ALERTS]
    })
  );

  const subscribed = await waitForRealtimeMessage(socket);
  assert.equal(subscribed.type, "subscribed");
  assert.equal(subscribed.requestId, "req-alert-subscribe");
  assert.equal(subscribed.workspaceSlug, "");
  assert.deepEqual(subscribed.topics, [REALTIME_TOPICS.ALERTS]);
  assert.equal(workspaceService.calls.length, 0);

  realtimeEventsService.publish({
    eventId: "evt-alert-after-subscribe",
    eventType: "user.alert.created",
    topic: REALTIME_TOPICS.ALERTS,
    targetUserIds: [7],
    payload: {
      alertId: 1002
    }
  });

  const delivered = await waitForRealtimeMessage(socket);
  assert.equal(delivered.type, "event");
  assert.equal(delivered.event.topic, REALTIME_TOPICS.ALERTS);
  assert.deepEqual(delivered.event.targetUserIds, [7]);

  socket.send(
    JSON.stringify({
      type: "unsubscribe",
      requestId: "req-alert-unsubscribe",
      topics: [REALTIME_TOPICS.ALERTS]
    })
  );

  const unsubscribed = await waitForRealtimeMessage(socket);
  assert.equal(unsubscribed.type, "unsubscribed");
  assert.equal(unsubscribed.requestId, "req-alert-unsubscribe");
  assert.deepEqual(unsubscribed.topics, [REALTIME_TOPICS.ALERTS]);

  realtimeEventsService.publish({
    eventId: "evt-alert-after-unsubscribe",
    eventType: "user.alert.created",
    topic: REALTIME_TOPICS.ALERTS,
    targetUserIds: [7],
    payload: {
      alertId: 1003
    }
  });

  const afterUnsubscribe = await waitForOptionalRealtimeMessage(socket, 350);
  assert.equal(afterUnsubscribe, null);

  socket.close();
  await app.close();
});

test("subscribe succeeds for authorized topics and forces server-side context overrides", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=admin`;

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

test("unsubscribe succeeds after permissions are revoked and removes existing subscription", async () => {
  const permissionsBySlug = {
    acme: ["projects.read"]
  };
  const { app, port, realtimeEventsService } = await createRealtimeTestApp({
    permissionsBySlug
  });
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=app`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-subscribe",
      workspaceSlug: "acme",
      topics: ["projects"]
    })
  );

  const subscribed = await waitForRealtimeMessage(socket);
  assert.equal(subscribed.type, "subscribed");

  permissionsBySlug.acme = [];

  socket.send(
    JSON.stringify({
      type: "unsubscribe",
      requestId: "req-unsubscribe",
      workspaceSlug: "acme",
      topics: ["projects"]
    })
  );

  const unsubscribed = await waitForRealtimeMessage(socket);
  assert.equal(unsubscribed.type, "unsubscribed");
  assert.equal(unsubscribed.requestId, "req-unsubscribe");
  assert.deepEqual(unsubscribed.topics, ["projects"]);

  realtimeEventsService.publishProjectEvent({
    operation: "updated",
    workspace: {
      id: 11,
      slug: "acme"
    },
    project: {
      id: 42
    },
    actorUserId: 7
  });

  const postUnsubscribeMessage = await waitForOptionalRealtimeMessage(socket, 350);
  assert.equal(postUnsubscribeMessage, null);

  socket.close();
  await app.close();
});

test("existing subscriptions are evicted when topic permissions are revoked", async () => {
  const permissionsBySlug = {
    acme: ["projects.read"]
  };
  const { app, port, realtimeEventsService } = await createRealtimeTestApp({
    permissionsBySlug
  });
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=app`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-evict-subscribe",
      workspaceSlug: "acme",
      topics: ["projects"]
    })
  );

  const subscribed = await waitForRealtimeMessage(socket);
  assert.equal(subscribed.type, "subscribed");

  realtimeEventsService.publishProjectEvent({
    operation: "updated",
    workspace: {
      id: 11,
      slug: "acme"
    },
    project: {
      id: 7
    },
    actorUserId: 7
  });

  const initialEvent = await waitForRealtimeMessage(socket);
  assert.equal(initialEvent.type, "event");
  assert.equal(initialEvent.event.topic, "projects");

  permissionsBySlug.acme = [];

  realtimeEventsService.publishProjectEvent({
    operation: "updated",
    workspace: {
      id: 11,
      slug: "acme"
    },
    project: {
      id: 8
    },
    actorUserId: 7
  });

  const postRevokeEvent = await waitForOptionalRealtimeMessage(socket, 500);
  assert.equal(postRevokeEvent, null);

  permissionsBySlug.acme = ["projects.read"];
  realtimeEventsService.publishProjectEvent({
    operation: "updated",
    workspace: {
      id: 11,
      slug: "acme"
    },
    project: {
      id: 9
    },
    actorUserId: 7
  });

  const postRestoreEvent = await waitForOptionalRealtimeMessage(socket, 500);
  assert.equal(postRestoreEvent, null);

  socket.close();
  await app.close();
});

test("workspace-scoped targeted chat fanout re-checks authorization and evicts stale subscriptions", async () => {
  const permissionsBySlug = {
    acme: ["chat.read"]
  };
  const { app, port, realtimeEventsService } = await createRealtimeTestApp({
    permissionsBySlug
  });
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=admin`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-chat-evict-subscribe",
      workspaceSlug: "acme",
      topics: [REALTIME_TOPICS.CHAT]
    })
  );

  const subscribed = await waitForRealtimeMessage(socket);
  assert.equal(subscribed.type, "subscribed");
  assert.deepEqual(subscribed.topics, [REALTIME_TOPICS.CHAT]);

  realtimeEventsService.publishChatEvent({
    eventType: "chat.message.created",
    threadId: 77,
    scopeKind: "workspace",
    workspaceId: 11,
    workspaceSlug: "acme",
    actorUserId: 8,
    targetUserIds: [7],
    payload: {
      threadId: 77,
      message: {
        id: 701
      }
    }
  });

  const initialEvent = await waitForRealtimeMessage(socket);
  assert.equal(initialEvent.type, "event");
  assert.equal(initialEvent.event.topic, REALTIME_TOPICS.CHAT);
  assert.equal(initialEvent.event.workspaceSlug, "acme");

  permissionsBySlug.acme = [];

  realtimeEventsService.publishChatEvent({
    eventType: "chat.message.created",
    threadId: 77,
    scopeKind: "workspace",
    workspaceId: 11,
    workspaceSlug: "acme",
    actorUserId: 8,
    targetUserIds: [7],
    payload: {
      threadId: 77,
      message: {
        id: 702
      }
    }
  });

  const revokedEvent = await waitForOptionalRealtimeMessage(socket, 500);
  assert.equal(revokedEvent, null);

  permissionsBySlug.acme = ["chat.read"];

  realtimeEventsService.publishChatEvent({
    eventType: "chat.message.created",
    threadId: 77,
    scopeKind: "workspace",
    workspaceId: 11,
    workspaceSlug: "acme",
    actorUserId: 8,
    targetUserIds: [7],
    payload: {
      threadId: 77,
      message: {
        id: 703
      }
    }
  });

  const afterRestoreEvent = await waitForOptionalRealtimeMessage(socket, 500);
  assert.equal(afterRestoreEvent, null);

  socket.close();
  await app.close();
});

test("transient event authorization failures do not evict existing subscriptions", async () => {
  let resolveCalls = 0;
  const workspaceService = {
    async resolveRequestContext() {
      resolveCalls += 1;

      if (resolveCalls === 2) {
        throw new Error("Temporary authorization dependency failure.");
      }

      return {
        workspace: {
          id: 11,
          slug: "acme"
        },
        membership: {
          roleId: "member"
        },
        permissions: ["projects.read"],
        workspaces: [],
        userSettings: null
      };
    }
  };

  const { app, port, realtimeEventsService } = await createRealtimeTestApp({
    workspaceService
  });
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=app`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-transient-subscribe",
      workspaceSlug: "acme",
      topics: ["projects"]
    })
  );

  const subscribed = await waitForRealtimeMessage(socket);
  assert.equal(subscribed.type, "subscribed");

  realtimeEventsService.publishProjectEvent({
    operation: "updated",
    workspace: {
      id: 11,
      slug: "acme"
    },
    project: {
      id: 101
    },
    actorUserId: 7
  });

  const skippedEvent = await waitForOptionalRealtimeMessage(socket, 700);
  assert.equal(skippedEvent, null);

  realtimeEventsService.publishProjectEvent({
    operation: "updated",
    workspace: {
      id: 11,
      slug: "acme"
    },
    project: {
      id: 102
    },
    actorUserId: 7
  });

  const recoveredEvent = await waitForOptionalRealtimeMessage(socket, 700);
  assert.ok(recoveredEvent);
  assert.equal(recoveredEvent.type, "event");
  assert.equal(recoveredEvent.event.topic, "projects");
  assert.equal(Number(recoveredEvent.event.payload?.projectId), 102);

  socket.close();
  await app.close();
});

test("realtime route rejects unsupported connection surface without resolving workspace context", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=future`;

  await assert.rejects(
    () =>
      openRealtimeWebSocket(url, {
        headers: {
          cookie: "sid=ok"
        }
      }),
    (error) => String(error?.data?.code || "") === "unsupported_surface"
  );
  assert.equal(workspaceService.calls.length, 0);

  await app.close();
});

test("app-surface subscribe rejects admin-only topics server-side", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp();
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=app`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-app-forbidden",
      workspaceSlug: "acme",
      topics: ["workspace_settings"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "error");
  assert.equal(message.requestId, "req-app-forbidden");
  assert.equal(message.code, "forbidden");
  assert.equal(workspaceService.calls.length, 0);

  socket.close();
  await app.close();
});

test("app-surface deny-list blocks realtime subscribe", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp({
    appDenyUserIdsBySlug: {
      acme: [7]
    }
  });
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=app`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-app-denied",
      workspaceSlug: "acme",
      topics: ["workspace_meta"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "error");
  assert.equal(message.requestId, "req-app-denied");
  assert.equal(message.code, "forbidden");
  assert.equal(workspaceService.calls.length, 1);
  assert.equal(workspaceService.calls[0].surfaceId, "app");

  socket.close();
  await app.close();
});

test("admin surface is not blocked by app deny-list for the same user", async () => {
  const { app, port, workspaceService } = await createRealtimeTestApp({
    appDenyUserIdsBySlug: {
      acme: [7]
    }
  });
  const url = `ws://127.0.0.1:${port}/api/realtime?surface=admin`;

  const socket = await openRealtimeWebSocket(url, {
    headers: {
      cookie: "sid=ok"
    }
  });

  socket.send(
    JSON.stringify({
      type: "subscribe",
      requestId: "req-admin-allowed",
      workspaceSlug: "acme",
      topics: ["workspace_settings"]
    })
  );

  const message = await waitForRealtimeMessage(socket);
  assert.equal(message.type, "subscribed");
  assert.equal(message.requestId, "req-admin-allowed");
  assert.deepEqual(message.topics, ["workspace_settings"]);
  assert.equal(workspaceService.calls.length, 1);
  assert.equal(workspaceService.calls[0].surfaceId, "admin");

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
  try {
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
    const closeReason = await closePromise;

    if (protocolError) {
      assert.equal(protocolError.type, "error");
      assert.equal(protocolError.code, "payload_too_large");
    }
    assert.ok(closeReason === "transport close" || closeReason === "io server disconnect");
  } finally {
    await app.close();
  }
});
