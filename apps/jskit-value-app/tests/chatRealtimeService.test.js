import assert from "node:assert/strict";
import test from "node:test";

import { createService as createChatRealtimeService } from "../server/modules/chat/realtime.service.js";
import { REALTIME_EVENT_TYPES } from "../shared/eventTypes.js";

test("chat realtime service publishes durable message events via realtimeEventsService", () => {
  const published = [];
  const chatRealtimeService = createChatRealtimeService({
    realtimeEventsService: {
      publishChatEvent(payload) {
        published.push(payload);
        return payload;
      }
    }
  });

  chatRealtimeService.publishMessageEvent({
    thread: {
      id: 91,
      scopeKind: "workspace",
      workspaceId: 11
    },
    message: {
      id: 3
    },
    idempotencyStatus: "created",
    actorUserId: 7,
    targetUserIds: [7, 8],
    commandId: "cmd_1",
    sourceClientId: "cli_1"
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, REALTIME_EVENT_TYPES.CHAT_MESSAGE_CREATED);
  assert.equal(published[0].threadId, 91);
  assert.equal(published[0].scopeKind, "workspace");
  assert.equal(published[0].workspaceId, 11);
  assert.deepEqual(published[0].targetUserIds, [7, 8]);
  assert.equal(published[0].payload.idempotencyStatus, "created");
});

test("chat realtime service typing emits exclude actor and normalize recipients", () => {
  const published = [];
  const chatRealtimeService = createChatRealtimeService({
    realtimeEventsService: {
      publishChatEvent(payload) {
        published.push(payload);
        return payload;
      }
    }
  });

  chatRealtimeService.emitTyping({
    thread: {
      id: 44,
      scopeKind: "global",
      workspaceId: null
    },
    actorUserId: 5,
    targetUserIds: [5, 5, 6, "7", 0],
    state: "started",
    expiresAt: "2026-02-22T00:00:08.000Z"
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, REALTIME_EVENT_TYPES.CHAT_TYPING_STARTED);
  assert.deepEqual(published[0].targetUserIds, [6, 7]);
  assert.equal(published[0].payload.userId, 5);
  assert.equal(published[0].payload.threadId, 44);
});

test("chat realtime service publishes attachment updated events", () => {
  const published = [];
  const chatRealtimeService = createChatRealtimeService({
    realtimeEventsService: {
      publishChatEvent(payload) {
        published.push(payload);
        return payload;
      }
    }
  });

  chatRealtimeService.publishAttachmentUpdated({
    thread: {
      id: 77,
      scopeKind: "global",
      workspaceId: null
    },
    attachment: {
      id: 3
    },
    actorUserId: 5,
    targetUserIds: [5, 8]
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, REALTIME_EVENT_TYPES.CHAT_ATTACHMENT_UPDATED);
  assert.equal(published[0].threadId, 77);
  assert.deepEqual(published[0].targetUserIds, [5, 8]);
  assert.equal(published[0].payload.attachment.id, 3);
});
