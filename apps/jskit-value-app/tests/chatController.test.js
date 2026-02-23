import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { createController as createChatController } from "../server/modules/chat/controller.js";

function createReplyDouble() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    contentType: null,
    code(status) {
      this.statusCode = status;
      return this;
    },
    header(name, value) {
      this.headers[String(name)] = value;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test("chat controller content endpoint sets attachment security headers", async () => {
  const controller = createChatController({
    chatService: {
      async getAttachmentContent() {
        return {
          contentBuffer: Buffer.from("hello"),
          contentType: "text/plain",
          contentDisposition: 'inline; filename="note.txt"'
        };
      }
    }
  });

  const reply = createReplyDouble();
  await controller.getAttachmentContent(
    {
      user: { id: 5 },
      params: {
        attachmentId: "3"
      },
      headers: {
        "x-surface-id": "app"
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.headers["Cache-Control"], "private, no-store");
  assert.equal(reply.headers.Vary, "Authorization, Cookie");
  assert.equal(reply.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(reply.headers["Content-Disposition"], 'inline; filename="note.txt"');
  assert.equal(reply.contentType, "text/plain");
  assert.equal(reply.payload.toString("utf8"), "hello");
});

test("chat controller dm candidates endpoint forwards query payload", async () => {
  const calls = [];
  const controller = createChatController({
    chatService: {
      async listDmCandidates(payload) {
        calls.push(payload);
        return {
          items: []
        };
      }
    }
  });

  const reply = createReplyDouble();
  await controller.listDmCandidates(
    {
      user: { id: 5 },
      query: {
        q: "ali",
        limit: 8
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, { items: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].user.id, 5);
  assert.deepEqual(calls[0].query, {
    q: "ali",
    limit: 8
  });
});

test("chat controller workspace ensure endpoint forwards user context", async () => {
  const calls = [];
  const controller = createChatController({
    chatService: {
      async ensureWorkspaceRoom(payload) {
        calls.push(payload);
        return {
          thread: {
            id: 77
          },
          created: false
        };
      }
    }
  });

  const reply = createReplyDouble();
  await controller.ensureWorkspaceRoom(
    {
      user: { id: 5 },
      headers: {
        "x-surface-id": "app"
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.thread.id, 77);
  assert.equal(reply.payload.created, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].user.id, 5);
});

test("chat controller upload endpoint parses multipart payload and forwards to service", async () => {
  const calls = [];
  const controller = createChatController({
    chatService: {
      async uploadThreadAttachment(payload) {
        calls.push(payload);
        return {
          attachment: {
            id: 3
          }
        };
      }
    }
  });

  const reply = createReplyDouble();
  await controller.uploadThreadAttachment(
    {
      user: { id: 5 },
      params: {
        threadId: "11"
      },
      routeOptions: {
        bodyLimit: 20_000_000
      },
      headers: {
        "x-surface-id": "app"
      },
      async file() {
        return {
          fields: {
            attachmentId: {
              value: "3"
            }
          },
          filename: "note.txt",
          mimetype: "text/plain",
          file: {
            truncated: false
          },
          async toBuffer() {
            return Buffer.from("hello");
          }
        };
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.attachment.id, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].attachmentId, "3");
  assert.equal(calls[0].payload.uploadFileName, "note.txt");
  assert.equal(calls[0].payload.uploadMimeType, "text/plain");
  assert.equal(calls[0].payload.fileBuffer.toString("utf8"), "hello");
});

test("chat controller upload endpoint returns validation error when multipart file is missing", async () => {
  const controller = createChatController({
    chatService: {
      async uploadThreadAttachment() {
        return {
          attachment: {
            id: 3
          }
        };
      }
    }
  });

  await assert.rejects(
    () =>
      controller.uploadThreadAttachment(
        {
          user: { id: 5 },
          params: {
            threadId: "11"
          },
          routeOptions: {
            bodyLimit: 20_000_000
          },
          headers: {
            "x-surface-id": "app"
          },
          async file() {
            return null;
          }
        },
        createReplyDouble()
      ),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.details?.code, "CHAT_VALIDATION_FAILED");
      return true;
    }
  );
});
