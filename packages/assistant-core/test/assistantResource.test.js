import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { assistantContract } from "../src/shared/assistantResource.js";

test("assistant output schemas accept normalized paginated payloads", () => {
  const conversationsListSchema = resolveSchemaTransportSchemaDefinition(
    assistantContract.operations.conversationsList.output,
    {
      context: "assistant conversations list output",
      defaultMode: "replace"
    }
  );
  const conversationMessagesSchema = resolveSchemaTransportSchemaDefinition(
    assistantContract.operations.conversationMessagesList.output,
    {
      context: "assistant conversation messages output",
      defaultMode: "replace"
    }
  );

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

  assert.equal(conversationsListSchema.type, "object");
  assert.equal(conversationsListSchema.properties.items.type, "array");
  assert.equal(conversationMessagesSchema.type, "object");
  assert.equal(conversationMessagesSchema.properties.entries.type, "array");
  assert.equal(messagesPayload.conversation.provider, "openai");
});

test("assistant conversation message params accept numeric path strings", async () => {
  const params = resolveSchemaTransportSchemaDefinition(
    assistantContract.operations.conversationMessagesList.params,
    {
      context: "assistant conversation message params",
      defaultMode: "patch"
    }
  );
  const parsed = await validateOperationSection({
    operation: assistantContract.operations.conversationMessagesList,
    section: "params",
    value: { conversationId: "2" }
  });

  assert.equal(params.type, "object");
  assert.equal(typeof params.properties.conversationId, "object");
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, { conversationId: 2 });
});

// A list shows each conversation without its runtime metadata (the system prompt, every tool's
// schema and a note per message), which grows with every message; a read of the conversation keeps it.
test("a conversation list item carries no runtime metadata, and a read of the conversation does", async () => {
  const item = { id: "1", workspaceId: null, title: "Trip", createdByUserId: "7", status: "active", provider: "openai",
    model: "gpt-4.1", surfaceId: "home", startedAt: "2026-03-16T10:00:00.000Z", endedAt: null, messageCount: 2,
    createdAt: "2026-03-16T10:00:00.000Z", updatedAt: "2026-03-16T10:01:00.000Z" };
  const listed = await validateOperationSection({ operation: assistantContract.operations.conversationsList,
    section: "output", value: { items: [item], nextCursor: null } });
  assert.equal(listed.ok, true);
  assert.equal(Object.hasOwn(listed.value.items[0], "metadata"), false);
  const read = await validateOperationSection({ operation: assistantContract.operations.conversationMessagesList,
    section: "output", value: { conversation: item, entries: [], page: 1, pageSize: 200, total: 0, totalPages: 1 } });
  assert.equal(read.ok, false, "a conversation read still requires its metadata");
});

const chatBody = value => validateOperationSection({ operation: assistantContract.operations.chatStream, section: "body", value });
const chatMessage = Object.freeze({ messageId: "m1", input: "What's this job's vessel?" });

// The page the person has open, sent with each message: within its limits, and nothing else.
test("a chat message carries an optional page context up to its limits", async () => {
  const record = { type: "t".repeat(64), id: "9".repeat(64), label: "L".repeat(200) };
  const atLimits = { path: `/${"p".repeat(2047)}`, title: "T".repeat(200), records: Array.from({ length: 10 }, () => record) };
  const accepted = await chatBody({ ...chatMessage, pageContext: atLimits });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.fieldErrors));
  assert.deepEqual(accepted.value.pageContext, atLimits);
  for (const pageContext of [{}, { path: "/jobs/42" }, { records: [{ type: "job", id: "42" }] }]) {
    assert.equal((await chatBody({ ...chatMessage, pageContext })).ok, true, JSON.stringify(pageContext));
  }
  const without = await chatBody(chatMessage);
  assert.equal(without.ok, true);
  assert.equal(Object.hasOwn(without.value, "pageContext"), false, "A message without one is as before");
});

test("a page context past a limit, or with a field it does not define, is refused with an error naming the field", async () => {
  const job = { type: "job", id: "42" };
  for (const [pageContext, field, limit] of [
    [{ path: `/${"p".repeat(2048)}` }, "path", "2048"],
    [{ title: "T".repeat(201) }, "title", "200"],
    [{ records: Array.from({ length: 11 }, () => job) }, "records", "10"],
    [{ records: [{ ...job, type: "t".repeat(65) }] }, "type", "64"],
    [{ records: [{ ...job, id: "9".repeat(65) }] }, "id", "64"],
    [{ records: [{ ...job, label: "L".repeat(201) }] }, "label", "200"],
    [{ records: [{ id: "42" }] }, "type", ""],
    [{ path: "/jobs/42", permissions: ["jobs.read"] }, "permissions", ""],
    [{ records: [{ ...job, grant: "read" }] }, "grant", ""]
  ]) {
    const refused = await chatBody({ ...chatMessage, pageContext });
    assert.equal(refused.ok, false, JSON.stringify(pageContext));
    const [named] = Object.entries(refused.fieldErrors);
    assert.ok(named[0].startsWith("pageContext") && named[0].endsWith(field), `The error names ${field}: ${named[0]}`);
    assert.ok(JSON.stringify(named[1]).includes(limit), `The error gives the limit: ${JSON.stringify(named[1])}`);
  }
});
