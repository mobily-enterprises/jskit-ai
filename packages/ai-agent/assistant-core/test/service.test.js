import test from "node:test";
import assert from "node:assert/strict";
import { __testables, createService } from "../src/service.js";

function createAssistantServiceForTests(overrides = {}) {
  return createService({
    providerClient: {
      enabled: true,
      provider: "openai",
      async createChatCompletion() {
        return { choices: [{ message: { content: "title" } }] };
      },
      async createChatCompletionStream() {
        throw new Error("not used in this test");
      }
    },
    workspaceSettingsRepository: null,
    consoleSettingsRepository: null,
    realtimeEventsService: null,
    aiTranscriptsService: null,
    auditService: {
      async recordSafe() {}
    },
    ...overrides
  });
}

test("assistant service validates chat turn input and normalizes limits", () => {
  const service = createAssistantServiceForTests({
    aiMaxInputChars: 10,
    aiMaxHistoryMessages: 2
  });

  const payload = service.validateChatTurnInput({
    body: {
      messageId: "m_1",
      input: "hello",
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" }
      ],
      clientContext: {
        locale: "en-US",
        timezone: "UTC"
      }
    }
  });

  assert.equal(payload.messageId, "m_1");
  assert.equal(payload.input, "hello");
  assert.equal(payload.history.length, 2);
  assert.equal(payload.clientContext.locale, "en-US");
});

test("assistant service testables map AppError-like tool failures", () => {
  class CustomAppError extends Error {
    constructor(status, message, options = {}) {
      super(message);
      this.name = "AppError";
      this.status = Number(status) || 500;
      this.statusCode = this.status;
      this.code = options.code || "APP_ERROR";
      this.details = options.details;
    }
  }

  createAssistantServiceForTests({
    appErrorClass: CustomAppError
  });

  const mapped = __testables.mapErrorToEvent(
    new CustomAppError(403, "Forbidden.", {
      code: "AI_TOOL_FORBIDDEN"
    }),
    {
      stage: "tool"
    }
  );

  assert.equal(mapped.code, "tool_forbidden");
  assert.equal(mapped.status, 403);
  assert.equal(mapped.stage, "tool");
});
