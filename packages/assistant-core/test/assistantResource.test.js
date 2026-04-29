import test from "node:test";
import assert from "node:assert/strict";
import { Check } from "typebox/value";
import { validateOperationSectionAsync } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import { assistantResource } from "../src/shared/assistantResource.js";

test("assistant output schemas accept normalized paginated payloads", () => {
  const conversationsListSchema = resolveStructuredSchemaTransportSchema(
    assistantResource.operations.conversationsList.output,
    {
      context: "assistant conversations list output",
      defaultMode: "replace"
    }
  );
  const conversationMessagesSchema = resolveStructuredSchemaTransportSchema(
    assistantResource.operations.conversationMessagesList.output,
    {
      context: "assistant conversation messages output",
      defaultMode: "replace"
    }
  );

  const conversationsPayload = {
    items: [],
    nextCursor: null
  };

  const messagesPayload = {
    conversation: {
      id: "1",
      workspaceId: "10",
      title: "Conversation",
      createdByUserId: "7",
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

test("assistant conversation message params accept numeric path strings", async () => {
  const params = resolveStructuredSchemaTransportSchema(
    assistantResource.operations.conversationMessagesList.params,
    {
      context: "assistant conversation message params",
      defaultMode: "patch"
    }
  );
  const parsed = await validateOperationSectionAsync({
    operation: assistantResource.operations.conversationMessagesList,
    section: "params",
    value: { conversationId: "2" }
  });

  assert.equal(Check(params, { conversationId: "2" }), true);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, { conversationId: 2 });
});
