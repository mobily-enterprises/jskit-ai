import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildChatRoutes } from "../server/modules/chat/routes.js";

function createThread() {
  return {
    id: 1,
    scopeKind: "global",
    workspaceId: null,
    threadKind: "dm",
    title: null,
    participantCount: 2,
    lastMessageId: null,
    lastMessageSeq: null,
    lastMessageAt: null,
    lastMessagePreview: null,
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z",
    unreadCount: 0,
    participant: {
      status: "active",
      lastReadSeq: 0,
      lastReadMessageId: null,
      lastReadAt: null,
      mutedUntil: null,
      archivedAt: null,
      pinnedAt: null
    }
  };
}

function createMessage() {
  return {
    id: 9,
    threadId: 1,
    threadSeq: 1,
    senderUserId: 3,
    clientMessageId: "cm_1",
    kind: "text",
    text: "hello",
    replyToMessageId: null,
    attachments: [],
    reactions: [],
    sentAt: "2026-02-22T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    metadata: {}
  };
}

function buildControllers() {
  const thread = createThread();
  const message = createMessage();

  return {
    chat: {
      async ensureDm(_request, reply) {
        reply.code(200).send({
          thread,
          created: true
        });
      },
      async listInbox(_request, reply) {
        reply.code(200).send({
          items: [thread],
          nextCursor: null
        });
      },
      async getThread(_request, reply) {
        reply.code(200).send({
          thread
        });
      },
      async listThreadMessages(_request, reply) {
        reply.code(200).send({
          items: [message],
          nextCursor: null
        });
      },
      async sendThreadMessage(_request, reply) {
        reply.code(200).send({
          message,
          thread,
          idempotencyStatus: "created"
        });
      },
      async markThreadRead(_request, reply) {
        reply.code(200).send({
          threadId: 1,
          lastReadSeq: 1,
          lastReadMessageId: 9
        });
      },
      async addReaction(_request, reply) {
        reply.code(200).send({
          messageId: 9,
          reactions: []
        });
      },
      async removeReaction(_request, reply) {
        reply.code(200).send({
          messageId: 9,
          reactions: []
        });
      }
    }
  };
}

function createMissingHandler() {
  return async (_request, reply) => {
    reply.code(501).send({
      error: "missing"
    });
  };
}

test("chat routes use required auth and workspace-agnostic policy", () => {
  const routes = buildChatRoutes(buildControllers(), {
    missingHandler: createMissingHandler()
  });

  assert.equal(routes.length, 8);

  for (const route of routes) {
    assert.equal(route.auth, "required");
    assert.equal(route.workspacePolicy, "none");
  }
});

test("chat dm ensure and message send schemas enforce required fields", async () => {
  const app = Fastify();
  const controllers = buildControllers();

  registerApiRoutes(app, {
    controllers,
    routes: buildChatRoutes(controllers, {
      missingHandler: createMissingHandler()
    })
  });

  const invalidEnsure = await app.inject({
    method: "POST",
    url: "/api/chat/dm/ensure",
    payload: {}
  });
  assert.equal(invalidEnsure.statusCode, 400);

  const validEnsure = await app.inject({
    method: "POST",
    url: "/api/chat/dm/ensure",
    payload: {
      targetPublicChatId: "target_1"
    }
  });
  assert.equal(validEnsure.statusCode, 200);

  const invalidSend = await app.inject({
    method: "POST",
    url: "/api/chat/threads/1/messages",
    payload: {
      text: "hello"
    }
  });
  assert.equal(invalidSend.statusCode, 400);

  const validSend = await app.inject({
    method: "POST",
    url: "/api/chat/threads/1/messages",
    payload: {
      clientMessageId: "cm_1",
      text: "hello"
    }
  });
  assert.equal(validSend.statusCode, 200);

  await app.close();
});

test("chat read schema rejects empty cursor payload", async () => {
  const app = Fastify();
  const controllers = buildControllers();

  registerApiRoutes(app, {
    controllers,
    routes: buildChatRoutes(controllers, {
      missingHandler: createMissingHandler()
    })
  });

  const invalidRead = await app.inject({
    method: "POST",
    url: "/api/chat/threads/1/read",
    payload: {}
  });
  assert.equal(invalidRead.statusCode, 400);

  const validRead = await app.inject({
    method: "POST",
    url: "/api/chat/threads/1/read",
    payload: {
      threadSeq: 1
    }
  });
  assert.equal(validRead.statusCode, 200);

  await app.close();
});
