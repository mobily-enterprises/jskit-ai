import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { registerApiRoutes } from "../server/fastify/registerApiRoutes.js";
import { buildRoutes as buildChatRoutes } from "../server/modules/chat/routes.js";
import { createMissingHandler } from "./helpers/missingHandler.js";

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
    },
    peerUser: null
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

function createAttachment() {
  return {
    id: 3,
    threadId: 1,
    messageId: null,
    uploadedByUserId: 3,
    clientAttachmentId: "ca_1",
    position: null,
    kind: "file",
    status: "uploaded",
    mimeType: "text/plain",
    fileName: "note.txt",
    sizeBytes: 5,
    width: null,
    height: null,
    durationMs: null,
    deliveryPath: "/api/chat/attachments/3/content",
    previewDeliveryPath: null,
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  };
}

function buildControllers() {
  const thread = createThread();
  const message = createMessage();
  const attachment = createAttachment();

  return {
    chat: {
      async ensureWorkspaceRoom(_request, reply) {
        reply.code(200).send({
          thread,
          created: false
        });
      },
      async ensureDm(_request, reply) {
        reply.code(200).send({
          thread,
          created: true
        });
      },
      async listDmCandidates(_request, reply) {
        reply.code(200).send({
          items: [
            {
              userId: 8,
              displayName: "User 8",
              avatarUrl: null,
              publicChatId: "u8",
              sharedWorkspaceCount: 1
            }
          ]
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
      async reserveThreadAttachment(_request, reply) {
        reply.code(200).send({
          attachment
        });
      },
      async uploadThreadAttachment(_request, reply) {
        reply.code(200).send({
          attachment
        });
      },
      async deleteThreadAttachment(_request, reply) {
        reply.code(204).send();
      },
      async getAttachmentContent(_request, reply) {
        reply.type("text/plain").send("hello");
      },
      async markThreadRead(_request, reply) {
        reply.code(200).send({
          threadId: 1,
          lastReadSeq: 1,
          lastReadMessageId: 9
        });
      },
      async emitThreadTyping(_request, reply) {
        reply.code(202).send({
          accepted: true,
          expiresAt: "2026-02-22T00:00:08.000Z"
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

test("chat routes use required auth and workspace-agnostic policy", () => {
  const routes = buildChatRoutes(buildControllers(), {
    missingHandler: createMissingHandler()
  });

  assert.equal(routes.length, 15);

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

  const validWorkspaceEnsure = await app.inject({
    method: "POST",
    url: "/api/chat/workspace/ensure",
    payload: {}
  });
  assert.equal(validWorkspaceEnsure.statusCode, 200);

  const invalidWorkspaceEnsure = await app.inject({
    method: "POST",
    url: "/api/chat/workspace/ensure",
    payload: {
      unexpected: true
    }
  });
  assert.equal(invalidWorkspaceEnsure.statusCode, 200);

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

  const invalidCandidates = await app.inject({
    method: "GET",
    url: "/api/chat/dm/candidates?limit=0"
  });
  assert.equal(invalidCandidates.statusCode, 400);

  const validCandidates = await app.inject({
    method: "GET",
    url: "/api/chat/dm/candidates?q=u&limit=10"
  });
  assert.equal(validCandidates.statusCode, 200);

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

  const invalidReserve = await app.inject({
    method: "POST",
    url: "/api/chat/threads/1/attachments/reserve",
    payload: {}
  });
  assert.equal(invalidReserve.statusCode, 400);

  const validReserve = await app.inject({
    method: "POST",
    url: "/api/chat/threads/1/attachments/reserve",
    payload: {
      clientAttachmentId: "ca_1",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5
    }
  });
  assert.equal(validReserve.statusCode, 200);

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

  const typing = await app.inject({
    method: "POST",
    url: "/api/chat/threads/1/typing"
  });
  assert.equal(typing.statusCode, 202);

  const deleteAttachment = await app.inject({
    method: "DELETE",
    url: "/api/chat/threads/1/attachments/3"
  });
  assert.equal(deleteAttachment.statusCode, 204);

  const attachmentContent = await app.inject({
    method: "GET",
    url: "/api/chat/attachments/3/content"
  });
  assert.equal(attachmentContent.statusCode, 200);

  await app.close();
});
