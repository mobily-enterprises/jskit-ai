import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createController as createAiController } from "../server/modules/ai/controller.js";
import { createReplyDouble } from "./helpers/replyDouble.js";

function createRequestDouble(payload = {}) {
  return {
    body: {},
    raw: new EventEmitter(),
    ...payload
  };
}

function parseNdjsonLines(rawWrites) {
  return rawWrites
    .join("")
    .split(/\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createActionExecutorDouble({
  execute = async () => {
    throw new Error("execute handler not configured");
  },
  executeStream = async () => {
    throw new Error("executeStream handler not configured");
  }
} = {}) {
  return {
    execute,
    executeStream
  };
}

test("ai controller returns normal 404 payload when assistant stream action is disabled", async () => {
  const controller = createAiController({
    actionExecutor: createActionExecutorDouble({
      async executeStream() {
        throw new AppError(404, "Not found.");
      }
    })
  });

  const request = createRequestDouble();
  const reply = createReplyDouble();

  await controller.chatStream(request, reply);

  assert.equal(reply.statusCode, 404);
  assert.equal(reply.hijacked, false);
  assert.deepEqual(reply.payload, {
    error: "Not found."
  });
});

test("ai controller returns pre-stream validation errors from action pipeline", async () => {
  const controller = createAiController({
    actionExecutor: createActionExecutorDouble({
      async executeStream() {
        throw new AppError(400, "Validation failed.", {
          details: {
            fieldErrors: {
              input: "Input is required."
            }
          }
        });
      }
    })
  });

  const request = createRequestDouble();
  const reply = createReplyDouble();

  await controller.chatStream(request, reply);

  assert.equal(reply.statusCode, 400);
  assert.equal(reply.hijacked, false);
  assert.deepEqual(reply.payload, {
    error: "Validation failed.",
    details: {
      fieldErrors: {
        input: "Input is required."
      }
    },
    fieldErrors: {
      input: "Input is required."
    }
  });
});

test("ai controller streams ndjson responses from executeStream deps writer", async () => {
  const controller = createAiController({
    actionExecutor: createActionExecutorDouble({
      async executeStream({ actionId, deps }) {
        assert.equal(actionId, "assistant.chat.stream");
        deps.streamWriter.sendMeta({ messageId: "m1" });
        deps.streamWriter.sendAssistantDelta("Hello");
        deps.streamWriter.sendAssistantMessage("Hello");
        deps.streamWriter.sendDone({ messageId: "m1" });
      }
    })
  });

  const request = createRequestDouble();
  const reply = createReplyDouble();

  await controller.chatStream(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.hijacked, true);
  assert.equal(reply.raw.ended, true);
  assert.equal(reply.headers["content-type"], "application/x-ndjson; charset=utf-8");

  const lines = parseNdjsonLines(reply.raw.writes);
  assert.deepEqual(
    lines.map((line) => line.type),
    ["meta", "assistant_delta", "assistant_message", "done"]
  );
});

test("ai controller emits stream error event when executeStream fails after stream start", async () => {
  const controller = createAiController({
    actionExecutor: createActionExecutorDouble({
      async executeStream({ deps }) {
        deps.streamWriter.sendMeta({ started: true });
        throw new Error("provider failed");
      }
    })
  });

  const request = createRequestDouble();
  const reply = createReplyDouble();

  await controller.chatStream(request, reply);

  assert.equal(reply.statusCode, 200);
  const lines = parseNdjsonLines(reply.raw.writes);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, "meta");
  assert.equal(lines[1].type, "error");
  assert.equal(lines[1].code, "stream_failure");
  assert.equal(reply.raw.ended, true);
});

test("ai controller aborts active stream action when request socket closes", async () => {
  let aborted = false;
  const controller = createAiController({
    actionExecutor: createActionExecutorDouble({
      async executeStream({ deps }) {
        await new Promise((resolve) => {
          deps.abortSignal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });

          setTimeout(resolve, 30);
        });
      }
    })
  });

  const request = createRequestDouble();
  const reply = createReplyDouble();

  const execution = controller.chatStream(request, reply);
  setTimeout(() => {
    request.raw.emit("close");
  }, 0);

  await execution;

  assert.equal(aborted, true);
  assert.equal(request.raw.listenerCount("close"), 0);
});

test("ai controller delegates conversation list to assistant action", async () => {
  const controller = createAiController({
    actionExecutor: createActionExecutorDouble({
      async execute({ actionId, input, context }) {
        assert.equal(actionId, "assistant.conversations.list");
        assert.equal(input.page, "2");
        assert.equal(context.channel, "api");
        return {
          entries: [{ id: 42 }],
          page: 2,
          pageSize: 20,
          total: 1,
          totalPages: 1
        };
      }
    })
  });

  const request = createRequestDouble({
    query: {
      page: "2"
    }
  });
  const reply = createReplyDouble();

  await controller.listConversations(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    entries: [{ id: 42 }],
    page: 2,
    pageSize: 20,
    total: 1,
    totalPages: 1
  });
});

test("ai controller delegates message list to assistant conversation messages action", async () => {
  const controller = createAiController({
    actionExecutor: createActionExecutorDouble({
      async execute({ actionId, input }) {
        assert.equal(actionId, "assistant.conversation.messages.list");
        assert.equal(input.conversationId, "19");
        assert.equal(input.pageSize, "100");
        return {
          conversation: { id: 19 },
          entries: [],
          page: 1,
          pageSize: 100,
          total: 0,
          totalPages: 1
        };
      }
    })
  });

  const request = createRequestDouble({
    params: {
      conversationId: "19"
    },
    query: {
      pageSize: "100"
    }
  });
  const reply = createReplyDouble();

  await controller.getConversationMessages(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    conversation: { id: 19 },
    entries: [],
    page: 1,
    pageSize: 100,
    total: 0,
    totalPages: 1
  });
});
