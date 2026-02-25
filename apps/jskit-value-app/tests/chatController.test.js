import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
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

function createActionExecutorDouble(execute) {
  return {
    async execute(payload) {
      return execute(payload);
    }
  };
}

test("chat controller content endpoint sets attachment security headers", async () => {
  const controller = createChatController({
    actionExecutor: createActionExecutorDouble(async ({ actionId, input }) => {
      assert.equal(actionId, "chat.attachment.content.get");
      assert.equal(input.attachmentId, "3");
      return {
        contentBuffer: Buffer.from("hello"),
        contentType: "text/plain",
        contentDisposition: 'inline; filename="note.txt"'
      };
    })
  });

  const reply = createReplyDouble();
  await controller.getAttachmentContent(
    {
      params: {
        attachmentId: "3"
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

test("chat controller dm candidates endpoint delegates query payload to action executor", async () => {
  const controller = createChatController({
    actionExecutor: createActionExecutorDouble(async ({ actionId, input, context }) => {
      assert.equal(actionId, "chat.dm.candidates.list");
      assert.deepEqual(input, {
        q: "ali",
        limit: 8
      });
      assert.equal(context.channel, "api");
      return {
        items: []
      };
    })
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
});

test("chat controller workspace ensure endpoint delegates to action executor", async () => {
  const controller = createChatController({
    actionExecutor: createActionExecutorDouble(async ({ actionId }) => {
      assert.equal(actionId, "chat.workspace_room.ensure");
      return {
        thread: {
          id: 77
        },
        created: false
      };
    })
  });

  const reply = createReplyDouble();
  await controller.ensureWorkspaceRoom(
    {
      user: { id: 5 }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.thread.id, 77);
  assert.equal(reply.payload.created, false);
});

test("chat controller upload endpoint parses multipart payload and delegates to action executor", async () => {
  const controller = createChatController({
    actionExecutor: createActionExecutorDouble(async ({ actionId, input }) => {
      assert.equal(actionId, "chat.attachment.upload");
      assert.equal(input.threadId, "11");
      assert.equal(input.attachmentId, "3");
      assert.equal(input.payload.uploadFileName, "note.txt");
      assert.equal(input.payload.uploadMimeType, "text/plain");
      assert.equal(input.payload.fileBuffer.toString("utf8"), "hello");
      return {
        attachment: {
          id: 3
        }
      };
    })
  });

  const reply = createReplyDouble();
  await controller.uploadThreadAttachment(
    {
      params: {
        threadId: "11"
      },
      routeOptions: {
        bodyLimit: 20_000_000
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
});

test("chat controller upload endpoint returns validation error when multipart file is missing", async () => {
  const controller = createChatController({
    actionExecutor: createActionExecutorDouble(async () => ({
      attachment: {
        id: 3
      }
    }))
  });

  await assert.rejects(
    () =>
      controller.uploadThreadAttachment(
        {
          params: {
            threadId: "11"
          },
          routeOptions: {
            bodyLimit: 20_000_000
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
