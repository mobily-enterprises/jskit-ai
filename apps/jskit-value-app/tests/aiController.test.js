import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { AppError } from "../server/lib/errors.js";
import { createController as createAiController } from "../server/modules/ai/controller.js";

function createReplyDouble() {
  const raw = {
    writes: [],
    ended: false,
    flushHeaders() {},
    write(chunk) {
      this.writes.push(String(chunk));
    },
    end() {
      this.ended = true;
    }
  };

  return {
    statusCode: null,
    payload: null,
    headers: {},
    hijacked: false,
    raw,
    header(name, value) {
      this.headers[String(name || "").toLowerCase()] = value;
      return this;
    },
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    },
    hijack() {
      this.hijacked = true;
      return this;
    }
  };
}

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

test("ai controller returns normal 404 payload when ai service is disabled", async () => {
  const controller = createAiController({
    aiService: {
      isEnabled() {
        return false;
      },
      async streamChatTurn() {
        throw new Error("should not run");
      }
    }
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

test("ai controller returns pre-stream validation errors from ai service helper", async () => {
  const controller = createAiController({
    aiService: {
      isEnabled() {
        return true;
      },
      validateChatTurnInput() {
        throw new AppError(400, "Validation failed.", {
          details: {
            fieldErrors: {
              input: "Input is required."
            }
          }
        });
      },
      async streamChatTurn() {
        throw new Error("should not run");
      }
    }
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

test("ai controller streams ndjson responses", async () => {
  const controller = createAiController({
    aiService: {
      isEnabled() {
        return true;
      },
      async streamChatTurn({ streamWriter }) {
        streamWriter.sendMeta({ messageId: "m1" });
        streamWriter.sendAssistantDelta("Hello");
        streamWriter.sendAssistantMessage("Hello");
        streamWriter.sendDone({ messageId: "m1" });
      }
    }
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

test("ai controller emits stream error event when service throws after stream starts", async () => {
  const controller = createAiController({
    aiService: {
      isEnabled() {
        return true;
      },
      async streamChatTurn() {
        throw new Error("provider failed");
      }
    }
  });

  const request = createRequestDouble();
  const reply = createReplyDouble();

  await controller.chatStream(request, reply);

  assert.equal(reply.statusCode, 200);
  const lines = parseNdjsonLines(reply.raw.writes);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].type, "error");
  assert.equal(lines[0].code, "stream_failure");
  assert.equal(reply.raw.ended, true);
});

test("ai controller aborts active service call when request socket closes", async () => {
  let aborted = false;
  const controller = createAiController({
    aiService: {
      isEnabled() {
        return true;
      },
      async streamChatTurn({ abortSignal }) {
        await new Promise((resolve) => {
          abortSignal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });

          setTimeout(resolve, 30);
        });
      }
    }
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

test("ai controller lists assistant conversations for current user", async () => {
  const controller = createAiController({
    aiService: {
      async streamChatTurn() {},
      isEnabled() {
        return true;
      }
    },
    aiTranscriptsService: {
      async listWorkspaceConversations() {
        throw new Error("not used");
      },
      async listWorkspaceConversationsForUser(workspace, user, query) {
        assert.equal(workspace.id, 11);
        assert.equal(user.id, 7);
        assert.equal(query.page, "2");
        return {
          entries: [{ id: 42 }],
          page: 2,
          pageSize: 20,
          total: 1,
          totalPages: 1
        };
      },
      async getWorkspaceConversationMessages() {
        throw new Error("not used");
      },
      async getWorkspaceConversationMessagesForUser() {
        throw new Error("not used");
      }
    }
  });

  const request = createRequestDouble({
    workspace: { id: 11 },
    user: { id: 7 },
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

test("ai controller lists workspace-wide conversations in admin surface when transcript permission is present", async () => {
  const controller = createAiController({
    aiService: {
      async streamChatTurn() {},
      isEnabled() {
        return true;
      }
    },
    aiTranscriptsService: {
      async listWorkspaceConversations(workspace, query) {
        assert.equal(workspace.id, 11);
        assert.equal(query.pageSize, "50");
        return {
          entries: [{ id: 99, createdByUserDisplayName: "Alex Admin" }],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1
        };
      },
      async listWorkspaceConversationsForUser() {
        throw new Error("not used");
      },
      async getWorkspaceConversationMessages() {
        throw new Error("not used");
      },
      async getWorkspaceConversationMessagesForUser() {
        throw new Error("not used");
      }
    }
  });

  const request = createRequestDouble({
    workspace: { id: 11 },
    user: { id: 7 },
    headers: {
      "x-surface-id": "admin"
    },
    permissions: ["workspace.ai.transcripts.read"],
    query: {
      pageSize: "50"
    }
  });
  const reply = createReplyDouble();

  await controller.listConversations(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    entries: [{ id: 99, createdByUserDisplayName: "Alex Admin" }],
    page: 1,
    pageSize: 50,
    total: 1,
    totalPages: 1
  });
});

test("ai controller loads messages for one assistant conversation", async () => {
  const controller = createAiController({
    aiService: {
      async streamChatTurn() {},
      isEnabled() {
        return true;
      }
    },
    aiTranscriptsService: {
      async listWorkspaceConversations() {
        throw new Error("not used");
      },
      async listWorkspaceConversationsForUser() {
        throw new Error("not used");
      },
      async getWorkspaceConversationMessages() {
        throw new Error("not used");
      },
      async getWorkspaceConversationMessagesForUser(workspace, user, conversationId, query) {
        assert.equal(workspace.id, 11);
        assert.equal(user.id, 7);
        assert.equal(conversationId, "19");
        assert.equal(query.pageSize, "100");
        return {
          conversation: { id: 19 },
          entries: [],
          page: 1,
          pageSize: 100,
          total: 0,
          totalPages: 1
        };
      }
    }
  });

  const request = createRequestDouble({
    workspace: { id: 11 },
    user: { id: 7 },
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

test("ai controller loads workspace-wide conversation messages in admin surface with transcript permission", async () => {
  const controller = createAiController({
    aiService: {
      async streamChatTurn() {},
      isEnabled() {
        return true;
      }
    },
    aiTranscriptsService: {
      async listWorkspaceConversations() {
        throw new Error("not used");
      },
      async listWorkspaceConversationsForUser() {
        throw new Error("not used");
      },
      async getWorkspaceConversationMessages(workspace, conversationId, query) {
        assert.equal(workspace.id, 11);
        assert.equal(conversationId, "200");
        assert.equal(query.page, "1");
        return {
          conversation: { id: 200 },
          entries: [{ id: 1 }],
          page: 1,
          pageSize: 500,
          total: 1,
          totalPages: 1
        };
      },
      async getWorkspaceConversationMessagesForUser() {
        throw new Error("not used");
      }
    }
  });

  const request = createRequestDouble({
    workspace: { id: 11 },
    user: { id: 7 },
    headers: {
      "x-surface-id": "admin"
    },
    permissions: ["workspace.ai.transcripts.read"],
    params: {
      conversationId: "200"
    },
    query: {
      page: "1"
    }
  });
  const reply = createReplyDouble();

  await controller.getConversationMessages(request, reply);

  assert.equal(reply.statusCode, 200);
  assert.deepEqual(reply.payload, {
    conversation: { id: 200 },
    entries: [{ id: 1 }],
    page: 1,
    pageSize: 500,
    total: 1,
    totalPages: 1
  });
});

test("ai controller returns 501 when transcripts service is not wired for list routes", async () => {
  const controller = createAiController({
    aiService: {
      async streamChatTurn() {},
      isEnabled() {
        return true;
      }
    }
  });

  const request = createRequestDouble();
  const reply = createReplyDouble();

  await assert.rejects(() => controller.listConversations(request, reply), (error) => {
    assert.equal(error.status, 501);
    assert.equal(error.message, "AI transcripts service is not available.");
    return true;
  });
});
