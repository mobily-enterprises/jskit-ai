import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import knex from "knex";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { createConversationTranscript } from "@jskit-ai/assistant-core/server/conversation";
import { verifyConversationStorageContract } from "@jskit-ai/assistant-core/testing/conversation-storage";
import transcriptsMigration from "../migrations/assistant_transcripts_initial.cjs";
import claimsMigration from "../migrations/assistant_turn_requests.cjs";
import { createRepository as createConversationsRepository } from "../src/server/repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "../src/server/repositories/messagesRepository.js";
import { createRepository as createTurnRequestsRepository } from "../src/server/repositories/turnRequestsRepository.js";
import { createSqlConversationStorage } from "../src/server/sqlConversationStorage.js";
import { createAssistantConversationRuntime } from "../src/server/createAssistantRuntime.js";
import { createTranscriptService } from "../src/server/services/transcriptService.js";
import { createChatService } from "../src/server/services/chatService.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "assistant-sql-runtime-"));
  const clients = [];
  function connect() {
    const db = knex({ client: "better-sqlite3", connection: { filename: path.join(directory, "assistant.sqlite") },
      useNullAsDefault: true, pool: { min: 1, max: 1, afterCreate(connection, done) {
        connection.pragma("busy_timeout = 0");
        done(null, connection);
      } } });
    clients.push(db);
    const repositories = { conversationsRepository: createConversationsRepository(db), messagesRepository: createMessagesRepository(db) };
    return { db, ...repositories, storage: createSqlConversationStorage(repositories) };
  }
  t.after(async () => { for (const client of clients) await client.destroy(); await rm(directory, { recursive: true, force: true }); });
  const first = connect();
  await first.db.schema.createTable("users", table => table.bigInteger("id").primary());
  await first.db("users").insert([{ id: 1 }, { id: 2 }]);
  await transcriptsMigration.up(first.db);
  await claimsMigration.up(first.db);
  await first.db.raw("PRAGMA journal_mode = WAL");
  const conversation = actor => first.conversationsRepository.create({ createdByUserId: actor || "1", surfaceId: "assistant", metadata: {} });
  return { ...first, connect, conversation };
}

async function rows(db) {
  return { conversations: await db("assistant_conversations").orderBy("id"), messages: await db("assistant_messages").orderBy("id") };
}

test("the existing runtime storage contract uses the original SQL rows and rolls back row, title, count and metadata together", async t => {
  const f = await fixture(t);
  const first = await f.conversation();
  const other = await f.conversation("2");
  const scopes = new Map([["actor-a:workspace-a:conversation-a", first.id], ["actor-b:workspace-a:conversation-a", other.id]]);
  await verifyConversationStorageContract({
    read: (scope, callback) => f.storage.read(scopes.get(scope), callback),
    write: (scope, callback) => f.storage.write(scopes.get(scope), callback)
  }, { runtime: true });
  const saved = await rows(f.db);
  assert.equal(saved.conversations[0].message_count, saved.messages.length);
  assert.equal(saved.conversations[0].title, "First question");
  assert.equal(saved.messages.filter(row => row.role === "assistant").length, 1);
  assert.equal(saved.messages.find(row => row.role === "assistant").content_text, "Final answer");
  assert.equal(saved.messages[0].client_message_sid, "request-a");

  const failing = createSqlConversationStorage({ conversationsRepository: f.conversationsRepository,
    messagesRepository: { ...f.messagesRepository, async create(input, options) {
      const result = await f.messagesRepository.create(input, options);
      if (input.contentText === "Fail after insert") throw new Error("forced-row-commit-failure");
      return result;
    } } });
  await assert.rejects(failing.write(first.id, async transaction => {
    await transaction.writeMetadata({ runtime: { uncommitted: true } });
    await transaction.updateTurnMetadata("000001", { product: { uncommitted: true } });
    await transaction.appendMessage(await transaction.nextTurnId(), {
      role: "user", messageId: "failed-write", text: "Fail after insert", at: "2026-01-02T00:00:00Z"
    });
  }), /forced-row-commit-failure/);
  assert.deepEqual(await rows(f.db), saved, "A failed SQL commit cannot leave an authored row, count, title or runtime metadata behind");
  let invocations = 0;
  await assert.rejects(f.storage.write(first.id, async () => {
    invocations += 1;
    throw Object.assign(new Error("Caller failure"), { code: "SQLITE_BUSY" });
  }), /Caller failure/);
  assert.equal(invocations, 1, "Lock acquisition retry must never replay a storage callback");
});

test("independent SQL connections serialize authored receipt and sequence allocation", async t => {
  const f = await fixture(t);
  const conversation = await f.conversation();
  const second = f.connect();
  const transcripts = [f.storage, second.storage].map(storage => createConversationTranscript({ storage }));
  const input = { messageId: "invoice/42:follow-up", text: "Only once" };
  const results = await Promise.all(transcripts.map(transcript => transcript.writeConversationUserMessage(conversation.id, input)));
  assert.equal(results.filter(Boolean).length, 1);
  await Promise.all(transcripts.map((transcript, index) => transcript.writeConversationUserMessage(conversation.id,
    { messageId: `next-${index}`, text: `Next ${index}` })));
  const saved = await f.messagesRepository.listByConversationScope(conversation.id);
  assert.deepEqual(saved.map(row => row.seq), [1, 2, 3]);
  assert.equal(saved[0].clientMessageSid, input.messageId);
  assert.equal((await f.conversationsRepository.findById(conversation.id)).messageCount, 3);
  assert.equal((await second.storage.read(conversation.id, transaction => transaction.listTurnIds())).length, 3);
});

test("historical SQL projection preserves exact rows and blocks ambiguous history with read-only preflight", async t => {
  const f = await fixture(t);
  const conversation = await f.conversation();
  const create = fields => f.messagesRepository.create({ conversationId: conversation.id, actorUserId: "1", role: "assistant", kind: "chat", ...fields });
  const user = await create({ role: "user", clientMessageSid: "customer/123:review", contentText: "Existing question", metadata: { surfaceId: "assistant" } });
  await create({ kind: "tool_call", contentText: '{"key":1}', metadata: { toolCallId: "lookup", tool: "inventory_lookup" } });
  await create({ kind: "tool_result", contentText: '{"ok":true,"result":{"found":1}}', metadata: { toolCallId: "lookup", tool: "inventory_lookup", ok: true } });
  await create({ contentText: "Existing answer" });
  const before = await rows(f.db);
  assert.deepEqual((await f.storage.preflight(conversation.id)).issues, []);
  const turn = await f.storage.read(conversation.id, transaction => transaction.readTurn(user.id));
  assert.equal(turn.user.messageId, "customer/123:review");
  assert.equal(turn.assistant.text, "Existing answer");
  assert.deepEqual(turn.metadata.applicationTools[0].result, { ok: true, result: { found: 1 } });
  assert.deepEqual(await rows(f.db), before);
  await f.storage.write(conversation.id, transaction => transaction.writeMetadata({ runtime: { inspection: "metadata only" } }));
  assert.deepEqual((await rows(f.db)).messages, before.messages, "Runtime initialization does not backfill historical message rows");

  const ambiguous = await f.conversation();
  const first = await f.messagesRepository.create({ conversationId: ambiguous.id, role: "user", contentText: "First", clientMessageSid: "first" });
  const next = await f.messagesRepository.create({ conversationId: ambiguous.id, role: "user", contentText: "Overlapping", clientMessageSid: "next" });
  await f.messagesRepository.create({ conversationId: ambiguous.id, role: "assistant", contentText: "Unknown owner" });
  const unchanged = await rows(f.db);
  assert.deepEqual((await f.storage.preflight(ambiguous.id)).issues, [{ code: "overlapping_historical_turns", rowIds: [first.id, next.id] }]);
  await assert.rejects(f.storage.write(ambiguous.id, transaction => transaction.writeMetadata({ runtime: {} })), /ambiguous historical SQL rows/);
  assert.deepEqual(await rows(f.db), unchanged);

  const interrupted = await f.conversation();
  await f.messagesRepository.create({ conversationId: interrupted.id, role: "user", contentText: "Mutate", clientMessageSid: "mutate" });
  const call = await f.messagesRepository.create({ conversationId: interrupted.id, role: "assistant", kind: "tool_call", contentText: "{}", metadata: { toolCallId: "unknown", tool: "mutate" } });
  assert.deepEqual((await f.storage.preflight(interrupted.id)).issues, [{ code: "unconfirmed_historical_tool", rowIds: [call.id] }]);
});

test("the SQL facade uses common inference and durable tool rows while supplied history stays request context", async t => {
  const f = await fixture(t);
  const conversation = await f.conversation();
  await f.messagesRepository.create({ conversationId: conversation.id, role: "user", clientMessageSid: "previous", contentText: "Canonical history outside the selected context" });
  await f.messagesRepository.create({ conversationId: conversation.id, role: "assistant", contentText: "Previous saved answer" });
  await f.conversationsRepository.updateById(conversation.id, { messageCount: 2 });
  const requests = [], resolved = [], events = [];
  let executions = 0;
  const aiClientFactory = { resolveClient(surface, input) {
    resolved.push({ surface, integrationId: input.integrationId, actor: input.context.actor.id });
    return { enabled: true, provider: "test", defaultModel: "fixture-model", async createChatCompletionStream(request) {
      requests.push(structuredClone(request.messages));
      const tool = requests.length === 1;
      return (async function* () {
        yield { choices: [{ delta: tool ? { tool_calls: [{ index: 0, id: "lookup", function: { name: "inventory_lookup", arguments: "{}" } }] }
          : { content: "Stored once." }, finish_reason: tool ? "tool_calls" : "stop" }] };
      })();
    } };
  } };
  const catalog = { limits: { maxToolArgumentBytes: 4096 },
    resolveToolSet: () => ({ tools: [{ name: "inventory_lookup", parameters: { type: "object" } }] }),
    toOpenAiToolSchema: tool => ({ type: "function", function: tool }),
    async executeToolCall() {
      executions += 1;
      const calls = await f.db("assistant_messages").where({ conversation_id: conversation.id, kind: "tool_call" });
      const results = await f.db("assistant_messages").where({ conversation_id: conversation.id, kind: "tool_result" });
      assert.equal(calls.length, 1, "The original tool-call row is committed before the application effect");
      assert.equal(results.length, 0);
      assert.equal(JSON.parse(calls[0].metadata_json).conversationRuntime.status, "running");
      return { ok: true, result: { found: 1 } };
    } };
  const runtime = createAssistantConversationRuntime({ ...f, aiClientFactory, toolCatalog: catalog });
  t.after(() => runtime.close());
  const dependencies = { conversationRuntime: runtime, aiClientFactory, serviceToolCatalog: catalog,
    transcriptService: createTranscriptService(f), turnRequests: createTurnRequestsRepository(f.db),
    assistantConfigService: { resolveSystemPrompt: async () => "Retained SQL instructions" },
    appConfig: { surfaceDefinitions: { assistant: { enabled: true, requiresWorkspace: false } },
      assistantSurfaces: { assistant: { settingsSurfaceId: "assistant", configScope: "global" } } } };
  const service = createChatService(dependencies);
  const input = { targetSurfaceId: "assistant", conversationId: conversation.id, messageId: "order/42:review", input: "Read the record",
    integrationId: "allowed-choice", history: [{ role: "user", content: "Selected request context only" }] };
  const options = { context: { actor: { id: "1" } }, streamWriter: Object.fromEntries(
    ["sendMeta", "sendAssistantDelta", "sendAssistantMessage", "sendToolCall", "sendToolResult", "sendError", "sendDone"]
      .map(name => [name, event => events.push({ name, event })])) };
  assert.equal((await service.streamChat(input, options)).status, "completed");
  assert.equal(executions, 1);
  assert.equal(requests.length, 2);
  assert.equal(resolved.every(value => value.surface === "assistant" && value.integrationId === "allowed-choice" && value.actor === "1"), true);
  assert.equal(requests[0].some(message => message.content === "Selected request context only"), true);
  assert.equal(requests[0].some(message => message.content === "Canonical history outside the selected context"), false);
  assert.deepEqual(JSON.parse(requests[1].find(message => message.role === "tool").content), { found: 1 },
    "The model receives the original action result body, while its durable receipt keeps the full envelope");
  const saved = await rows(f.db);
  assert.equal(saved.messages.filter(row => row.kind === "tool_call").length, 1);
  assert.equal(saved.messages.filter(row => row.kind === "tool_result").length, 1);
  assert.equal(saved.messages.filter(row => row.client_message_sid === input.messageId).length, 1);
  assert.equal(saved.messages.some(row => row.content_text === "Selected request context only"), false);
  assert.doesNotMatch(saved.conversations[0].metadata_json, /Selected request context only/);
  assert.doesNotMatch(saved.messages.find(row => row.client_message_sid === input.messageId).metadata_json, /applicationTools/);
  const claimed = await f.db("assistant_turn_requests").first();
  assert.equal(claimed.status, "completed");
  assert.equal(JSON.parse(claimed.request_json).history[0].content, "Selected request context only");
  assert.equal(events.at(-1).name, "sendDone");
  assert.equal((await service.streamChat(input, options)).status, "completed");
  assert.equal(requests.length, 2, "The original SQL claim replays without inference or duplicate effects");
  for (const change of [{ actor: { id: "2" } }, { surface: "other" }, { assistantRequest: { conversation, workspace: { id: "77" }, history: [] } }]) {
    await assert.rejects(runtime.open({ id: conversation.id,
      context: { actor: { id: "1" }, surface: "assistant", assistantRequest: { conversation, workspace: null, history: [] }, ...change } }),
    { code: "conversation_forbidden" });
  }
});

test("the SQL facade replays historical inspection failures with their exact public code and row IDs without executing work", async t => {
  const f = await fixture(t);
  const conversation = await f.conversation();
  const first = await f.messagesRepository.create({ conversationId: conversation.id, role: "user",
    clientMessageSid: "first-legacy-question", contentText: "First" });
  const next = await f.messagesRepository.create({ conversationId: conversation.id, role: "user",
    clientMessageSid: "next-legacy-question", contentText: "Next" });
  await f.messagesRepository.create({ conversationId: conversation.id, role: "assistant", contentText: "Unknown owner" });
  const unchanged = await rows(f.db);
  let inference = 0;
  let effects = 0;
  const aiClientFactory = { resolveClient: () => ({ enabled: true, provider: "test", defaultModel: "test",
    createChatCompletionStream() { inference++; assert.fail("Historical inspection cannot invoke inference"); } }) };
  const catalog = { resolveToolSet: () => ({ tools: [] }),
    executeToolCall() { effects++; assert.fail("Historical inspection cannot invoke application effects"); } };
  const runtime = createAssistantConversationRuntime({ ...f, aiClientFactory, toolCatalog: catalog });
  t.after(() => runtime.close());
  const turnRequests = createTurnRequestsRepository(f.db);
  const dependencies = { conversationRuntime: runtime, aiClientFactory, serviceToolCatalog: catalog,
    transcriptService: createTranscriptService(f), turnRequests,
    assistantConfigService: { resolveSystemPrompt: async () => "Read the supplied context" },
    appConfig: { surfaceDefinitions: { assistant: { enabled: true, requiresWorkspace: false } },
      assistantSurfaces: { assistant: { settingsSurfaceId: "assistant", configScope: "global" } } } };
  const input = { targetSurfaceId: "assistant", conversationId: conversation.id,
    messageId: "inspect-legacy-history", input: "Continue", history: [] };
  const events = [];
  const options = { context: { actor: { id: "1" } }, streamWriter: Object.fromEntries(
    ["sendMeta", "sendAssistantDelta", "sendAssistantMessage", "sendToolCall", "sendToolResult", "sendError", "sendDone"]
      .map(name => [name, event => events.push({ name, event })])) };
  const expectedDetails = { issues: [{ code: "overlapping_historical_turns", rowIds: [first.id, next.id] }] };
  const requireInspection = error => {
    assert.equal(error instanceof AppError, true);
    assert.equal(error.status, 409);
    assert.equal(error.code, "assistant_history_inspection_required");
    assert.deepEqual(error.details, expectedDetails);
    return true;
  };
  await assert.rejects(createChatService(dependencies).streamChat(input, options), requireInspection);
  const receipt = await f.db("assistant_turn_requests").first();
  assert.equal(receipt.status, "failed");
  const restarted = createChatService({ ...dependencies, turnRequests: createTurnRequestsRepository(f.db) });
  await assert.rejects(restarted.streamChat(input, options), requireInspection);
  assert.deepEqual(JSON.parse(receipt.response_json).failure, {
    message: "This conversation has ambiguous historical SQL rows. Inspect the reported rows offline before using the common runtime; no history was changed.",
    status: 409, code: "assistant_history_inspection_required", details: expectedDetails
  });
  assert.deepEqual(await f.db("assistant_turn_requests"), [receipt], "Replay preserves the original request claim");
  assert.deepEqual(await rows(f.db), unchanged, "Inspection and replay leave historical rows and metadata untouched");
  assert.deepEqual(events, [], "The refused request never starts a stream");
  assert.equal(inference, 0);
  assert.equal(effects, 0);

  const oldFailure = { message: "Previously recorded failure", status: 409 };
  const oldInput = { ...input, messageId: "old-failure-receipt" };
  const oldClaim = await turnRequests.claim({ actorUserId: "1", surfaceId: "assistant", workspaceId: null },
    { conversationId: conversation.id, messageId: oldInput.messageId, input: oldInput.input, history: [], integrationId: "" });
  await turnRequests.update(oldClaim, { failure: oldFailure }, "failed");
  await assert.rejects(restarted.streamChat(oldInput, options), error => {
    assert.equal(error.status, oldFailure.status);
    assert.equal(error.message, oldFailure.message);
    assert.equal(error.code, "APP_ERROR");
    assert.equal(error.details, undefined);
    return true;
  });
  const oldSaved = await turnRequests.find({ actorUserId: "1", surfaceId: "assistant", workspaceId: null }, oldInput.messageId);
  assert.deepEqual(oldSaved.response, { failure: oldFailure }, "Replay does not backfill historical failure receipts");

  for (const [index, failure] of [
    new AppError(403, "Permission denied", { code: "ACTION_PERMISSION_DENIED", details: { privateRule: "private-permission-probe" } }),
    Object.assign(new Error("Request failed"), { status: 503, code: "PRIVATE_ENGINE_ERROR", details: { privateRule: "private-permission-probe" } })
  ].entries()) {
    const hiddenInput = { ...input, messageId: `private-failure-${index}` };
    const denied = createChatService({ ...dependencies, assistantConfigService: {
      resolveSystemPrompt() { throw failure; }
    } });
    await assert.rejects(denied.streamChat(hiddenInput, options), error => error === failure);
    const saved = await turnRequests.find({ actorUserId: "1", surfaceId: "assistant", workspaceId: null }, hiddenInput.messageId);
    assert.deepEqual(saved.response.failure, { message: failure.message, status: failure.status,
      ...(failure instanceof AppError ? { code: "ACTION_PERMISSION_DENIED" } : {}) });
    assert.doesNotMatch(JSON.stringify(saved.response), /private-permission-probe|PRIVATE_ENGINE_ERROR|stack/u);
    await assert.rejects(restarted.streamChat(hiddenInput, options), error => {
      assert.equal(error.status, failure.status);
      assert.equal(error.code, failure instanceof AppError ? "ACTION_PERMISSION_DENIED" : "APP_ERROR");
      assert.equal(error.details, undefined);
      return true;
    });
  }
  assert.equal(inference, 0);
  assert.equal(effects, 0);
  assert.deepEqual(await rows(f.db), unchanged);
});
