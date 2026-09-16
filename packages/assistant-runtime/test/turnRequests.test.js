import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import knex from "knex";
import migration from "../migrations/assistant_turn_requests.cjs";
import { createRepository } from "../src/server/repositories/turnRequestsRepository.js";
import { createChatService } from "../src/server/services/chatService.js";

async function database(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "assistant-requests-"));
  const connections = [];
  const connect = () => {
    const db = knex({ client: "better-sqlite3", connection: { filename: path.join(dir, "requests.db") }, useNullAsDefault: true });
    connections.push(db);
    return db;
  };
  t.after(async () => { for (const db of connections) await db.destroy(); await rm(dir, { recursive: true, force: true }); });
  const db = connect();
  await db.schema.createTable("users", table => table.bigInteger("id").primary());
  await db("users").insert([{ id: 1 }, { id: 2 }]);
  await migration.up(db);
  return { db, connect };
}

const scope = { actorUserId: "1", surfaceId: "assistant", workspaceId: null };
const request = { messageId: "message-1", input: "Do this once.", history: [] };

test("migration preserves existing claims and database uniqueness arbitrates independent connections", async t => {
  const { db, connect } = await database(t);
  const first = createRepository(db);
  const second = createRepository(connect());
  const claims = await Promise.all([first.claim(scope, request), second.claim(scope, request)]);
  assert.equal(claims.filter(claim => claim.acquired).length, 1);
  assert.equal((await db("assistant_turn_requests")).length, 1);
  await migration.up(db);
  assert.equal((await db("assistant_turn_requests")).length, 1);
  assert.equal((await second.claim({ ...scope, actorUserId: "2" }, request)).acquired, true);
  assert.equal((await second.claim({ ...scope, workspaceId: "10" }, request)).acquired, true);
  assert.equal((await second.claim({ ...scope, surfaceId: "other" }, request)).acquired, true);
  await migration.down(db);
  assert.equal(await db.schema.hasTable("assistant_turn_requests"), false);
  assert.equal((await db("users")).length, 2);
});

function service(repository, { provider, transcript = [] } = {}) {
  return createChatService({
    turnRequests: repository,
    aiClientFactory: { resolveClient: () => ({ enabled: true, provider: "test", defaultModel: "test", createChatCompletionStream: provider }) },
    transcriptService: {
      async createConversationForTurn() { return { conversation: { id: "100" } }; },
      async appendMessage(_surface, _id, message) { transcript.push(message); },
      async completeConversation() {}
    },
    serviceToolCatalog: { resolveToolSet: () => ({ tools: [] }) },
    assistantConfigService: { resolveSystemPrompt: async () => "Answer." },
    appConfig: {
      surfaceDefinitions: { assistant: { id: "assistant", enabled: true, requiresWorkspace: false, accessPolicyId: "public" } },
      assistantSurfaces: { assistant: { settingsSurfaceId: "assistant", configScope: "global" } }
    }
  });
}

function run(chat, input = request, { events = [], disconnectAfterCompletion = false } = {}) {
  const streamWriter = Object.fromEntries(["sendMeta", "sendAssistantDelta", "sendAssistantMessage", "sendToolCall", "sendToolResult", "sendError", "sendDone"]
    .map(method => [method, event => {
      if (disconnectAfterCompletion && method === "sendDone") throw new Error("Response lost.");
      events.push({ method, event });
    }]));
  return chat.streamChat({ targetSurfaceId: "assistant", ...input }, { context: { actor: { id: "1" } }, streamWriter });
}

test("concurrent submissions, lost completion responses and a fresh service replay one provider execution", async t => {
  const { db, connect } = await database(t);
  const waiting = Promise.withResolvers();
  const started = Promise.withResolvers();
  let calls = 0;
  const transcript = [];
  const provider = async function* () {
    calls++;
    started.resolve();
    await waiting.promise;
    yield { choices: [{ delta: { content: "Completed once." } }] };
  };
  const first = service(createRepository(db), { provider, transcript });
  const pending = run(first, request, { disconnectAfterCompletion: true });
  const failedResponse = assert.rejects(pending, /Response lost/);
  await started.promise;
  const second = service(createRepository(connect()), { provider, transcript });
  const inFlight = [];
  assert.equal((await run(second, request, { events: inFlight })).status, "unconfirmed");
  assert.equal(inFlight.find(item => item.method === "sendMeta").event.conversationId, "100");
  assert.equal(calls, 1);
  waiting.resolve();
  await failedResponse;
  const replay = [];
  const restarted = service(createRepository(connect()), { provider: () => { throw new Error("Replay must not invoke the provider."); } });
  assert.equal((await run(restarted, request, { events: replay })).status, "completed");
  assert.equal(replay.find(item => item.method === "sendAssistantMessage").event.text, "Completed once.");
  assert.equal(calls, 1);
  assert.deepEqual(transcript.map(message => message.role), ["user", "assistant"]);
  await assert.rejects(run(restarted, { ...request, input: "Different request" }), /different request/);
});

test("an interrupted claim is never stolen after restart, and provider failures replay without executing again", async t => {
  const { db, connect } = await database(t);
  const repository = createRepository(db);
  await repository.claim(scope, { ...request, conversationId: null, integrationId: "" });
  let calls = 0;
  const chat = service(createRepository(connect()), { provider: () => { calls++; throw new Error("Provider failed."); } });
  assert.equal((await run(chat)).status, "unconfirmed");
  assert.equal(calls, 0);
  const failure = { ...request, messageId: "failing-message" };
  assert.equal((await run(chat, failure)).status, "failed");
  const replay = [];
  assert.equal((await run(chat, failure, { events: replay })).status, "failed");
  assert.equal(calls, 1);
  assert.match(replay.find(item => item.method === "sendError").event.message, /Provider failed/);
  await assert.rejects(run(chat, { ...request, messageId: "x".repeat(129) }), /Validation failed/);
  assert.equal(calls, 1);
});
