import test from "node:test";
import assert from "node:assert/strict";
import { __testables, createController } from "../src/shared/controller.js";

test("controller routes admin transcript list to workspace-wide service when permission exists", async () => {
  const calls = [];
  const controller = createController({
    aiService: {
      async streamChatTurn() {},
      isEnabled() {
        return true;
      }
    },
    aiTranscriptsService: {
      async listWorkspaceConversations(workspace, query) {
        calls.push(["workspace", workspace, query]);
        return { entries: [] };
      },
      async listWorkspaceConversationsForUser(workspace, user, query) {
        calls.push(["user", workspace, user, query]);
        return { entries: [] };
      },
      async getWorkspaceConversationMessages() {
        return { entries: [] };
      },
      async getWorkspaceConversationMessagesForUser() {
        return { entries: [] };
      }
    }
  });

  const reply = {
    statusCode: 0,
    payload: null,
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
    }
  };

  await controller.listConversations(
    {
      headers: {
        "x-surface-id": "admin"
      },
      permissions: ["workspace.ai.transcripts.read"],
      workspace: { id: 10 },
      user: { id: 77 },
      query: { page: 1 }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(calls[0][0], "workspace");
});

test("stream error payload helpers map AppError-like failures", () => {
  const error = new __testables.DefaultAppError(409, "Validation failed.", {
    details: {
      fieldErrors: {
        input: "Input is required."
      }
    }
  });

  const preStream = __testables.buildPreStreamErrorPayload(error, __testables.DefaultAppError);
  assert.equal(preStream.statusCode, 409);
  assert.equal(preStream.payload.error, "Validation failed.");
  assert.equal(preStream.payload.fieldErrors.input, "Input is required.");

  const stream = __testables.buildStreamErrorPayload(error, __testables.DefaultAppError);
  assert.equal(stream.type, "error");
  assert.equal(stream.code, "request_failed");
  assert.equal(stream.status, 409);
});
