import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import knexLib from "knex";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import configMigration from "../migrations/assistant_config_initial.cjs";
import transcriptsMigration from "../migrations/assistant_transcripts_initial.cjs";
import summaryMigration from "../migrations/assistant_transcripts_summary.cjs";
import { ResourceRuntimeProvider } from "@jskit-ai/resource-runtime/server";
import { AssistantFeature } from "../src/server/AssistantProvider.js";
import { AssistantStoreFeature } from "../src/server/AssistantStoreFeature.js";
import { createTestAssistantStore } from "./support/assistantStore.js";

// What the assistant's database repositories, and the feature that builds them on
// runtime.database, answer and keep today on MySQL, pinned before their tables move onto
// resources: record shapes and defaults, what each normalizes, scoping by surface, workspace and
// actor, ordering and pagination, transactions, and the errors they raise. The connection uses
// the options database-runtime gives mysql2 (big numbers as strings, UTC).
let knex = null;
let admin = null;
let store = null;
let databaseName = "";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u;
const ID = /^[1-9]\d*$/u;

before(async () => {
  databaseName = `${requireTestDatabase(process.env)}_da_assistant`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [databaseName]);
  await admin.raw("CREATE DATABASE ??", [databaseName]);
  knex = knexLib({
    client: "mysql2",
    connection: { ...server, database: databaseName, supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" },
    pool: { min: 0, max: 4 }
  });
  await configMigration.up(knex);
  await transcriptsMigration.up(knex);
  await summaryMigration.up(knex);
  store = await createTestAssistantStore(knex);
});

after(async () => {
  await store?.close();
  await knex?.destroy();
  if (admin) {
    await admin.raw("DROP DATABASE IF EXISTS ??", [databaseName]);
    await admin.destroy();
  }
});

test("the config repository keeps one record per surface and scope", async () => {
  requireTestDatabase(process.env);
  const repository = store.config;
  assert.deepEqual(Object.keys(repository).sort(), ["createDefaultRecord", "findByScope", "upsertByScope", "withTransaction"]);
  assert.deepEqual(repository.createDefaultRecord({ targetSurfaceId: " Home " }),
    { targetSurfaceId: "home", scopeKey: "home:global", workspaceId: null, settings: { systemPrompt: "" } });
  assert.deepEqual(repository.createDefaultRecord({ targetSurfaceId: "home", workspaceId: 7 }),
    { targetSurfaceId: "home", scopeKey: "home:workspace:7", workspaceId: "7", settings: { systemPrompt: "" } });
  assert.throws(() => repository.createDefaultRecord({}), { name: "TypeError", message: "assistantConfigRepository requires targetSurfaceId." });
  await assert.rejects(repository.findByScope({ targetSurfaceId: " " }), { name: "TypeError", message: "assistantConfigRepository requires targetSurfaceId." });
  await assert.rejects(repository.upsertByScope({ patch: { systemPrompt: "x" } }), { name: "TypeError" });

  assert.equal(await repository.findByScope({ targetSurfaceId: "home" }), null, "nothing saved: null, not a default");
  assert.deepEqual(await repository.upsertByScope({ targetSurfaceId: "HOME", patch: { systemPrompt: "Global prompt" } }),
    { targetSurfaceId: "home", scopeKey: "home:global", workspaceId: null, settings: { systemPrompt: "Global prompt" } });
  assert.deepEqual(await repository.upsertByScope({ targetSurfaceId: "home", workspaceId: "7", patch: { systemPrompt: "Workspace 7" } }),
    { targetSurfaceId: "home", scopeKey: "home:workspace:7", workspaceId: "7", settings: { systemPrompt: "Workspace 7" } });
  assert.deepEqual(await repository.findByScope({ targetSurfaceId: "home" }),
    { targetSurfaceId: "home", scopeKey: "home:global", workspaceId: null, settings: { systemPrompt: "Global prompt" } });
  assert.deepEqual(await repository.findByScope({ targetSurfaceId: "home", workspaceId: 7 }),
    { targetSurfaceId: "home", scopeKey: "home:workspace:7", workspaceId: "7", settings: { systemPrompt: "Workspace 7" } });
  assert.equal(await repository.findByScope({ targetSurfaceId: "home", workspaceId: 8 }), null, "another workspace has its own");
  assert.equal(await repository.findByScope({ targetSurfaceId: "console" }), null, "and another surface");

  assert.equal((await repository.upsertByScope({ targetSurfaceId: "home", patch: {} })).settings.systemPrompt, "Global prompt",
    "a patch without systemPrompt keeps the saved one");
  assert.equal((await repository.upsertByScope({ targetSurfaceId: "home", workspaceId: 7, patch: { systemPrompt: null } })).settings.systemPrompt, "",
    "a null systemPrompt clears it");
  assert.deepEqual(await repository.upsertByScope({ targetSurfaceId: "console", patch: {} }),
    { targetSurfaceId: "console", scopeKey: "console:global", workspaceId: null, settings: { systemPrompt: "" } });
  assert.deepEqual(await repository.findByScope({ targetSurfaceId: "console" }),
    { targetSurfaceId: "console", scopeKey: "console:global", workspaceId: null, settings: { systemPrompt: "" } }, "an empty first save is a record");
  assert.equal((await knex("assistant_config").where({ target_surface_id: "home" })).length, 2, "saving again updates, one row per scope");
});

test("the config repository joins a caller's transaction and rolls back with it", async () => {
  requireTestDatabase(process.env);
  const repository = store.config;
  await assert.rejects(repository.withTransaction({}, async (txOptions) => {
    await repository.upsertByScope({ targetSurfaceId: "home", workspaceId: 9, patch: { systemPrompt: "Uncommitted" } }, txOptions);
    assert.equal((await repository.findByScope({ targetSurfaceId: "home", workspaceId: 9 }, txOptions)).settings.systemPrompt, "Uncommitted",
      "visible inside the transaction");
    assert.equal(await repository.findByScope({ targetSurfaceId: "home", workspaceId: 9 }), null, "not outside it");
    throw new Error("roll back");
  }), /roll back/u);
  assert.equal(await repository.findByScope({ targetSurfaceId: "home", workspaceId: 9 }), null);
  assert.equal(await repository.withTransaction({}, async () => "answer"), "answer", "withTransaction answers the work's result");
});

test("a conversation record has a fixed shape, defaults and normalizations", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  assert.deepEqual(Object.keys(conversations).sort(), ["create", "findById", "findByIdForActorScope", "listForActorScope",
    "readTranscriptState", "transaction", "updateById", "withTransaction", "writeTranscriptState"]);
  await assert.rejects(conversations.create({ createdByUserId: 5 }), { name: "TypeError", message: "conversationsRepository requires surfaceId." });

  const plain = await conversations.create({ surfaceId: " Home ", createdByUserId: 5 });
  assert.deepEqual(Object.keys(plain).sort(), ["createdAt", "createdByUserId", "endedAt", "id", "messageCount", "metadata", "model",
    "provider", "startedAt", "status", "surfaceId", "title", "updatedAt", "workspaceId"]);
  assert.match(plain.id, ID, "ids are strings");
  assert.equal(plain.workspaceId, null);
  assert.equal(plain.createdByUserId, "5");
  assert.equal(plain.title, "New conversation");
  assert.equal(plain.status, "active");
  assert.equal(plain.provider, "");
  assert.equal(plain.model, "");
  assert.equal(plain.surfaceId, "home");
  assert.equal(plain.messageCount, 0);
  assert.deepEqual(plain.metadata, {});
  assert.equal(plain.endedAt, null);
  for (const key of ["startedAt", "createdAt", "updatedAt"]) assert.match(plain[key], ISO, `${key}: ISO text, whole seconds`);
  assert.equal(plain.createdAt, plain.updatedAt);

  const full = await conversations.create({
    workspaceId: "3", createdByUserId: "5", title: "  Trip  ", status: " ARCHIVED ", provider: " openai ", model: " a-model ",
    surfaceId: "home", messageCount: -4, metadata: { topic: "trip", nested: { days: 3 } },
    startedAt: "2026-01-02T03:04:05.400Z", endedAt: "2026-01-02T04:00:00.000Z"
  });
  assert.deepEqual({ ...full, id: "", createdAt: "", updatedAt: "" }, {
    id: "", workspaceId: "3", title: "Trip", createdByUserId: "5", status: "archived", provider: "openai", model: "a-model", surfaceId: "home",
    startedAt: "2026-01-02T03:04:05.000Z", endedAt: "2026-01-02T04:00:00.000Z", messageCount: 0,
    metadata: { topic: "trip", nested: { days: 3 } }, createdAt: "", updatedAt: ""
  }, "text trimmed, status lowercased, a negative count is 0, sub-second time dropped");
  const odd = await conversations.create({ surfaceId: "home", createdByUserId: "x", workspaceId: 0, metadata: ["not", "an", "object"], title: "   " });
  assert.equal(odd.createdByUserId, null, "an invalid creator id is stored as null");
  assert.equal(odd.workspaceId, null);
  assert.deepEqual(odd.metadata, {}, "metadata that is not an object is dropped");
  assert.equal(odd.title, "New conversation");
});

test("conversations are found by id, and by actor scope only in their own surface, workspace and creator", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const global = await conversations.create({ surfaceId: "home", createdByUserId: 21 });
  const inWorkspace = await conversations.create({ surfaceId: "home", createdByUserId: 21, workspaceId: 4 });
  assert.equal(await conversations.findById("abc"), null);
  assert.equal(await conversations.findById(0), null);
  assert.equal(await conversations.findById("999999999"), null);
  assert.deepEqual(await conversations.findById(Number(global.id)), global, "a number id finds it too");
  await assert.rejects(conversations.findById(global.id, { forUpdate: true }),
    { name: "TypeError", message: "Locking a conversation requires its database transaction." });
  assert.deepEqual(await conversations.transaction((txOptions) => conversations.findById(global.id, { ...txOptions, forUpdate: true })), global,
    "locking inside a transaction answers the same record and changes nothing");

  const scope = { actorUserId: 21, surfaceId: "home" };
  assert.deepEqual(await conversations.findByIdForActorScope(global.id, scope), global);
  assert.equal(await conversations.findByIdForActorScope(global.id, { ...scope, actorUserId: 22 }), null, "another actor");
  assert.equal(await conversations.findByIdForActorScope(global.id, { ...scope, surfaceId: "console" }), null, "another surface");
  assert.equal(await conversations.findByIdForActorScope(global.id, { ...scope, workspaceId: 4 }), null, "a workspace scope misses a global one");
  assert.equal(await conversations.findByIdForActorScope(inWorkspace.id, scope), null, "a global scope misses a workspace one");
  assert.deepEqual(await conversations.findByIdForActorScope(inWorkspace.id, { ...scope, workspaceId: "4" }), inWorkspace);
  assert.equal(await conversations.findByIdForActorScope(inWorkspace.id, { ...scope, workspaceId: 5 }), null, "another workspace");
  assert.equal(await conversations.findByIdForActorScope(global.id, { surfaceId: "home" }), null, "no actor: null");
  assert.equal(await conversations.findByIdForActorScope(global.id, { actorUserId: 21 }), null, "no surface: null");
  assert.deepEqual(await conversations.transaction((txOptions) => conversations.findByIdForActorScope(global.id, scope, { ...txOptions, forUpdate: true })), global);
});

test("updateById changes only the fields a patch names, and never the conversation's owner or workspace", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const made = await conversations.create({ surfaceId: "home", createdByUserId: 31, workspaceId: 6, title: "Start", metadata: { a: 1 } });
  await knex("assistant_conversations").where({ id: made.id }).update({ updated_at: new Date(Date.UTC(2026, 0, 1)) });
  const untouched = await conversations.updateById(made.id, {});
  assert.equal(untouched.updatedAt, "2026-01-01T00:00:00.000Z", "an empty patch writes nothing");
  assert.equal(await conversations.updateById("nope", { title: "x" }), null);
  assert.equal(await conversations.updateById("999999999", { title: "x" }), null, "an unknown id answers null");
  await assert.rejects(conversations.updateById(made.id, { surfaceId: "" }), { name: "TypeError", message: "conversationsRepository requires surfaceId." });

  const changed = await conversations.updateById(made.id, {
    title: "", status: " DONE ", provider: " p ", model: " m ", messageCount: "7", endedAt: "2026-03-01T00:00:00.000Z",
    metadata: { b: 2 }, surfaceId: " Console ", workspaceId: 99, createdByUserId: 99, startedAt: "2020-01-01T00:00:00.000Z"
  });
  assert.equal(changed.title, "New conversation", "an empty title falls back to the default");
  assert.equal(changed.status, "done");
  assert.equal(changed.provider, "p");
  assert.equal(changed.model, "m");
  assert.equal(changed.messageCount, 7);
  assert.equal(changed.endedAt, "2026-03-01T00:00:00.000Z");
  assert.deepEqual(changed.metadata, { b: 2 }, "metadata is replaced, not merged");
  assert.equal(changed.surfaceId, "console");
  assert.equal(changed.workspaceId, "6", "workspaceId is not patchable");
  assert.equal(changed.createdByUserId, "31", "nor the creator");
  assert.equal(changed.startedAt, made.startedAt, "nor startedAt");
  assert.notEqual(changed.updatedAt, "2026-01-01T00:00:00.000Z", "a real change moves updatedAt");
  const cleared = await conversations.updateById(made.id, { endedAt: null, status: "", messageCount: -3, metadata: null });
  assert.equal(cleared.endedAt, null);
  assert.equal(cleared.status, "active", "an empty status falls back to active");
  assert.equal(cleared.messageCount, 0);
  assert.deepEqual(cleared.metadata, {});
});

test("listForActorScope pages newest first by id, within one actor, surface and workspace", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const mine = [];
  for (let index = 0; index < 3; index += 1) mine.push(await conversations.create({ surfaceId: "home", createdByUserId: 41, title: `Mine ${index}` }));
  const archived = await conversations.create({ surfaceId: "home", createdByUserId: 41, status: "archived" });
  await conversations.create({ surfaceId: "home", createdByUserId: 41, workspaceId: 2 });
  await conversations.create({ surfaceId: "home", createdByUserId: 42 });
  await conversations.create({ surfaceId: "console", createdByUserId: 41 });

  const scope = { actorUserId: 41, surfaceId: "home" };
  const all = await conversations.listForActorScope(scope);
  assert.deepEqual(Object.keys(all).sort(), ["items", "nextCursor"]);
  assert.deepEqual(all.items.map((item) => item.id), [archived.id, mine[2].id, mine[1].id, mine[0].id], "newest id first, global scope only");
  assert.equal(all.nextCursor, null);
  assert.deepEqual(all.items[1], mine[2], "items are whole conversation records");

  const page = await conversations.listForActorScope({ ...scope, pagination: { limit: 2 } });
  assert.deepEqual(page.items.map((item) => item.id), [archived.id, mine[2].id]);
  assert.equal(page.nextCursor, mine[2].id, "the cursor is the last item's id, as a string");
  const rest = await conversations.listForActorScope({ ...scope, pagination: { limit: 2, cursor: page.nextCursor } });
  assert.deepEqual(rest.items.map((item) => item.id), [mine[1].id, mine[0].id]);
  assert.equal(rest.nextCursor, null, "an exact last page has no cursor");

  assert.deepEqual((await conversations.listForActorScope({ ...scope, filters: { status: " ARCHIVED " } })).items.map((item) => item.id), [archived.id]);
  assert.deepEqual((await conversations.listForActorScope({ ...scope, workspaceId: 2 })).items.length, 1);
  assert.deepEqual(await conversations.listForActorScope({ surfaceId: "home" }), { items: [], nextCursor: null });
  assert.deepEqual(await conversations.listForActorScope({ actorUserId: 41 }), { items: [], nextCursor: null });

  const now = new Date();
  const many = Array.from({ length: 205 }, () => ({ created_by_user_id: 43, surface_id: "home", started_at: now, created_at: now, updated_at: now }));
  await knex.batchInsert("assistant_conversations", many, 100);
  const crowd = { actorUserId: 43, surfaceId: "home" };
  assert.equal((await conversations.listForActorScope(crowd)).items.length, 20, "20 by default");
  assert.equal((await conversations.listForActorScope({ ...crowd, pagination: { limit: 0 } })).items.length, 20, "and for a limit that is not positive");
  const capped = await conversations.listForActorScope({ ...crowd, pagination: { limit: 1000 } });
  assert.equal(capped.items.length, 200, "at most 200");
  assert.match(capped.nextCursor, ID);
});

test("a conversation's transcript state is kept apart from its record", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const made = await conversations.create({ surfaceId: "home", createdByUserId: 51 });
  assert.equal(await conversations.readTranscriptState("nope"), null);
  assert.equal(await conversations.readTranscriptState("999999999"), null);
  assert.deepEqual(await conversations.readTranscriptState(made.id), { revision: "", summary: null });
  await conversations.writeTranscriptState(made.id, { revision: "r1", summary: { text: "The summary.", throughTurnId: "000003" } });
  assert.deepEqual(await conversations.readTranscriptState(made.id), { revision: "r1", summary: { text: "The summary.", throughTurnId: "000003" } });
  assert.deepEqual(await conversations.findById(made.id), made, "the record does not show it");
  await conversations.writeTranscriptState(made.id, { revision: "r2", summary: null });
  assert.deepEqual(await conversations.readTranscriptState(made.id), { revision: "r2", summary: null });
  await conversations.writeTranscriptState(made.id, { revision: "r3", summary: { text: "", throughTurnId: "" } });
  assert.deepEqual(await conversations.readTranscriptState(made.id), { revision: "r3", summary: { text: "", throughTurnId: "" } }, "an empty summary is still a summary");
  await assert.rejects(conversations.writeTranscriptState("nope", { revision: "r", summary: null }),
    { name: "TypeError", message: "writeTranscriptState requires conversationId." });
  assert.equal(await conversations.writeTranscriptState("999999999", { revision: "r", summary: null }), undefined, "an unknown id is written silently");
});

test("a message record has a fixed shape, and seq counts up per conversation", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const messages = store.messages;
  assert.deepEqual(Object.keys(messages).sort(), ["countByConversationScope", "create", "findById", "lastSequence",
    "listByConversationScope", "transaction", "updateById", "withTransaction"]);
  const first = await conversations.create({ surfaceId: "home", createdByUserId: 61 });
  const second = await conversations.create({ surfaceId: "home", createdByUserId: 61 });
  await assert.rejects(messages.create({ role: "user" }), { name: "TypeError", message: "messagesRepository.create requires conversationId." });

  const plain = await messages.create({ conversationId: first.id, role: " USER " });
  assert.deepEqual(Object.keys(plain).sort(), ["actorUserId", "clientMessageSid", "contentText", "conversationId", "createdAt", "id",
    "kind", "metadata", "role", "seq", "workspaceId"]);
  assert.deepEqual({ ...plain, id: "", createdAt: "" }, {
    id: "", conversationId: first.id, workspaceId: null, seq: 1, role: "user", kind: "chat", clientMessageSid: "",
    actorUserId: null, contentText: null, metadata: {}, createdAt: ""
  });
  assert.match(plain.id, ID);
  assert.match(plain.createdAt, ISO);

  const full = await messages.create({
    conversationId: Number(first.id), workspaceId: 3, role: "Assistant", kind: " Tool ", clientMessageSid: " sid-1 ", actorUserId: 61,
    contentText: 42, metadata: { tool: "search" }, createdAt: "2026-02-03T04:05:06.400Z"
  });
  assert.deepEqual({ ...full, id: "" }, {
    id: "", conversationId: first.id, workspaceId: "3", seq: 2, role: "assistant", kind: "tool", clientMessageSid: "sid-1",
    actorUserId: "61", contentText: "42", metadata: { tool: "search" }, createdAt: "2026-02-03T04:05:06.000Z"
  });
  assert.equal((await messages.create({ conversationId: first.id, role: "user", seq: 10 })).seq, 10, "an explicit seq is kept");
  assert.equal((await messages.create({ conversationId: first.id, role: "user", seq: 0 })).seq, 11, "a seq that is not positive is the next one");
  assert.equal((await messages.create({ conversationId: second.id, role: "user" })).seq, 1, "each conversation counts on its own");
  assert.equal(await messages.lastSequence(first.id), 11);
  assert.equal(await messages.lastSequence(second.id), 1);
  assert.equal(await messages.lastSequence("999999999"), 0);
  assert.equal(await messages.lastSequence("nope"), 0);

  await assert.rejects(messages.create({ conversationId: first.id, role: "user", seq: 2 }), { code: "ER_DUP_ENTRY" }, "a taken seq is refused");
  await assert.rejects(messages.create({ conversationId: "999999999", role: "user" }), { code: "ER_NO_REFERENCED_ROW_2" }, "the conversation must exist");
  assert.equal(await messages.findById("nope"), null);
  assert.equal(await messages.findById("999999999"), null);
  assert.deepEqual(await messages.findById(full.id), full);
});

test("messages are listed and counted in seq order within a conversation and workspace scope", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const messages = store.messages;
  const conversation = await conversations.create({ surfaceId: "home", createdByUserId: 71 });
  const other = await conversations.create({ surfaceId: "home", createdByUserId: 71 });
  for (const seq of [3, 1, 2]) await messages.create({ conversationId: conversation.id, role: "user", seq, contentText: `seq ${seq}` });
  await messages.create({ conversationId: conversation.id, role: "user", seq: 4, workspaceId: 8 });
  await messages.create({ conversationId: other.id, role: "user" });

  assert.deepEqual((await messages.listByConversationScope(conversation.id)).map((message) => message.seq), [1, 2, 3], "seq order; a null workspace scope sees null-workspace messages only");
  assert.deepEqual((await messages.listByConversationScope(conversation.id, { workspaceId: 8 })).map((message) => message.seq), [4]);
  assert.deepEqual(await messages.listByConversationScope(conversation.id, { workspaceId: 9 }), []);
  assert.deepEqual((await messages.listByConversationScope(conversation.id, {}, { page: 2, pageSize: 2 })).map((message) => message.seq), [3]);
  assert.deepEqual((await messages.listByConversationScope(conversation.id, {}, { page: 0, pageSize: 0 })).map((message) => message.seq), [1, 2, 3],
    "a page or size that is not positive falls back to the defaults");
  assert.deepEqual(await messages.listByConversationScope("nope"), []);
  assert.equal(await messages.countByConversationScope(conversation.id), 3);
  assert.equal(await messages.countByConversationScope(conversation.id, { workspaceId: "8" }), 1);
  assert.equal(await messages.countByConversationScope(other.id), 1);
  assert.equal(await messages.countByConversationScope("nope"), 0);
  assert.equal(await messages.countByConversationScope("999999999"), 0);

  const crowd = await conversations.create({ surfaceId: "home", createdByUserId: 71 });
  await knex.batchInsert("assistant_messages", Array.from({ length: 520 }, (_, index) => ({ conversation_id: crowd.id, seq: index + 1, role: "user" })), 200);
  assert.equal((await messages.listByConversationScope(crowd.id)).length, 200, "200 a page by default");
  assert.equal((await messages.listByConversationScope(crowd.id, {}, { pageSize: 1000 })).length, 500, "at most 500");
  assert.equal(await messages.countByConversationScope(crowd.id), 520);
});

test("updateById changes a message's text and metadata only", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const messages = store.messages;
  const conversation = await conversations.create({ surfaceId: "home", createdByUserId: 81 });
  const message = await messages.create({ conversationId: conversation.id, role: "assistant", contentText: "Draft", metadata: { a: 1 } });
  assert.deepEqual(await messages.updateById(message.id, {}), message, "an empty patch changes nothing");
  const changed = await messages.updateById(message.id, { contentText: "Final", metadata: { b: 2 }, role: "user", seq: 9, conversationId: "1" });
  assert.deepEqual(changed, { ...message, contentText: "Final", metadata: { b: 2 } }, "role, seq and conversation stay");
  assert.deepEqual(await messages.updateById(message.id, { contentText: null, metadata: "not an object" }), { ...message, contentText: null, metadata: {} });
  assert.equal(await messages.updateById("nope", { contentText: "x" }), null);
  assert.equal(await messages.updateById("999999999", { contentText: "x" }), null);
});

test("conversations and messages written in one transaction roll back together", async () => {
  requireTestDatabase(process.env);
  const conversations = store.conversations;
  const messages = store.messages;
  let made = null;
  await assert.rejects(conversations.transaction(async (txOptions) => {
    made = await conversations.create({ surfaceId: "home", createdByUserId: 91 }, txOptions);
    await messages.create({ conversationId: made.id, role: "user", contentText: "Hello" }, txOptions);
    assert.equal(await messages.countByConversationScope(made.id, {}, txOptions), 1);
    assert.equal(await messages.lastSequence(made.id, txOptions), 1);
    throw new Error("roll back");
  }), /roll back/u);
  assert.equal(await conversations.findById(made.id), null);
  assert.equal(await messages.countByConversationScope(made.id), 0);

  const kept = await messages.transaction(async (txOptions) => {
    const conversation = await conversations.create({ surfaceId: "home", createdByUserId: 91 }, txOptions);
    await messages.create({ conversationId: conversation.id, role: "user" }, txOptions);
    return conversation;
  });
  assert.equal(await messages.countByConversationScope(kept.id), 1, "a transaction that ends well commits, and answers the work's result");
});

test("AssistantFeature on runtime.database keeps its settings in the database's assistant_config", async () => {
  requireTestDatabase(process.env);
  let assistant = null;
  const runtime = createCapabilityRuntime({
    inputs: { "runtime.logger": silentLogger },
    providers: [
      EventProvider, ActionProvider,
      defineProvider({ id: "test.config", provides: { value: "runtime.config" }, setup: () => ({ value: {
        surfaceDefinitions: { desk: { enabled: true, requiresWorkspace: false } },
        assistantSurfaces: { desk: { settingsSurfaceId: "desk", configScope: "global" } },
        assistantServer: { desk: { aiConfigPrefix: "DESK" } }
      } }) }),
      defineProvider({ id: "test.database", provides: { value: "runtime.database" }, setup: () => ({ value: { knex } }) }),
      ResourceRuntimeProvider,
      AssistantStoreFeature,
      defineProvider({ id: "test.env", provides: { value: "runtime.env" }, setup: () => ({ value: {} }) }),
      defineProvider({ id: "test.http", provides: { value: "runtime.http" }, setup: () => ({ value: { router: { register() {} } } }) }),
      AssistantFeature,
      defineProvider({
        id: "test.observer",
        requires: { assistantRuntime: "assistant.runtime" },
        setup(dependencies) {
          assistant = dependencies.assistantRuntime;
          return {};
        }
      })
    ]
  });
  await runtime.start();
  try {
    const context = { actor: { id: "1" }, permissions: ["assistant.settings.update"] };
    assert.deepEqual(await assistant.services.config.getSettings({ targetSurfaceId: "desk" }, { context }),
      { targetSurfaceId: "desk", scopeKey: "desk:global", workspaceId: null, settings: { systemPrompt: "" } }, "the default before any save");
    const saved = await assistant.services.config.updateSettings({ targetSurfaceId: "desk" }, { systemPrompt: "Be brief." }, { context });
    assert.deepEqual(saved, { targetSurfaceId: "desk", scopeKey: "desk:global", workspaceId: null, settings: { systemPrompt: "Be brief." } });
    assert.deepEqual(await store.config.findByScope({ targetSurfaceId: "desk" }), saved, "written to runtime.database");
    assert.equal(await assistant.services.config.resolveSystemPrompt({ targetSurfaceId: "desk" }), "Be brief.");
    await assert.rejects(assistant.services.config.updateSettings({ targetSurfaceId: "desk" }, { systemPrompt: "No." }, { context: { actor: { id: "2" }, permissions: [] } }),
      { code: "assistant.runtime.settings.updateForbidden" });
    assert.equal((await store.config.findByScope({ targetSurfaceId: "desk" })).settings.systemPrompt, "Be brief.");
  } finally {
    await runtime.shutdown();
  }
});
