import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { assistantResource } from "../src/shared/assistantResource.js";

test("assistant output schemas accept normalized paginated payloads", () => {
  const conversationsListSchema = assistantResource.operations.conversationsList.outputValidator.schema;
  const conversationMessagesSchema = assistantResource.operations.conversationMessagesList.outputValidator.schema;

  const conversationsPayload = {
    entries: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1
  };

  const messagesPayload = {
    conversation: {
      id: 1,
      workspaceId: 10,
      workspaceSlug: "acme",
      workspaceName: "Acme",
      title: "Conversation",
      createdByUserId: 7,
      createdByUserDisplayName: "Merc",
      createdByUserEmail: "merc@example.com",
      status: "active",
      provider: "openai",
      model: "gpt-4.1",
      surfaceId: "admin",
      startedAt: "2026-03-16T10:00:00.000Z",
      endedAt: null,
      messageCount: 2,
      metadata: {},
      createdAt: "2026-03-16T10:00:00.000Z",
      updatedAt: "2026-03-16T10:01:00.000Z"
    },
    entries: [],
    page: 1,
    pageSize: 200,
    total: 0,
    totalPages: 1
  };

  assert.equal(Check(conversationsListSchema, conversationsPayload), true);
  assert.equal(Check(conversationMessagesSchema, messagesPayload), true);
});

test("assistant conversation message params accept numeric path strings and normalize to integer", () => {
  const paramsValidator = assistantResource.operations.conversationMessagesList.paramsValidator;
  assert.equal(Check(paramsValidator.schema, { conversationId: "2" }), true);
  assert.deepEqual(paramsValidator.normalize({ conversationId: "2" }), {
    conversationId: 2
  });
});
