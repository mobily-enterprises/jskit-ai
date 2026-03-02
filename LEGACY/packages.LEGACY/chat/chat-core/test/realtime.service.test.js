import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/realtime.service.js";

test("chat realtime service publishes normalized message events", () => {
  const published = [];
  const service = createService({
    realtimeEventsService: {
      publishChatEvent(payload) {
        published.push(payload);
      }
    },
    realtimeEventTypes: {
      CHAT_MESSAGE_CREATED: "custom.chat.message.created"
    }
  });

  service.publishMessageEvent({
    thread: {
      id: 11,
      scopeKind: "workspace",
      workspaceId: 77
    },
    message: {
      id: 900
    },
    idempotencyStatus: "replayed",
    actorUserId: 12,
    targetUserIds: [12, 13, 13]
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].eventType, "custom.chat.message.created");
  assert.equal(published[0].threadId, 11);
  assert.equal(published[0].workspaceId, 77);
  assert.deepEqual(published[0].targetUserIds, [12, 13]);
  assert.equal(published[0].payload.idempotencyStatus, "replayed");
});
