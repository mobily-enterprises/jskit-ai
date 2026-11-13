import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import knex from "knex";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes as registerFastifyRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import transcriptsMigration from "../migrations/assistant_transcripts_initial.cjs";
import summaryMigration from "../migrations/assistant_transcripts_summary.cjs";
import claimsMigration from "../migrations/assistant_turn_requests.cjs";
import { createAssistantActions } from "../src/server/actions.js";
import { registerRoutes } from "../src/server/registerRoutes.js";
import { createAssistantConversationRuntime } from "../src/server/createAssistantRuntime.js";
import { createSqlConversationStorage } from "../src/server/sqlConversationStorage.js";
import { createChatService } from "../src/server/services/chatService.js";
import { createTranscriptService } from "../src/server/services/transcriptService.js";
import { NO_PERSON_CONTEXT, createPersonContextPrompt } from "../src/server/support/personContext.js";
import { NO_TURN_GUARD, createTurnAdmission } from "../src/server/support/turnGuard.js";
import { createScriptedModel } from "./support/scriptedModel.js";
import { createTestAssistantStore } from "./support/assistantStore.js";

const config = Object.freeze({
  surfaceDefinitions: { assistant: { enabled: true, requiresWorkspace: false } },
  assistantSurfaces: { assistant: { settingsSurfaceId: "assistant", configScope: "global" } }
});
const STREAM_URL = "/api/assistant/assistant/chat/stream";
const HEADERS = Object.freeze({ "x-jskit-surface": "assistant" });

// The database-backed assistant as an application serves it, with the application's turn guard:
// its SQL rows on SQLite, the conversation runtime over them with a scripted model, its chat
// service and actions, and its routes on Fastify, with the signed-in user "1".
async function guardedApp(t, turnGuard) {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  const store = await createTestAssistantStore(db);
  const app = Fastify();
  const logged = [];
  const logger = { debug() {}, info() {}, warn() {}, error: (fields, message) => logged.push({ fields, message }) };
  const model = { clients: 0, replies: [], checks: 0 };
  const repositories = { conversationsRepository: store.conversations, messagesRepository: store.messages };
  const aiClientFactory = { resolveClient() {
    model.clients += 1;
    return { enabled: true, provider: "test", defaultModel: "fixture-model", model: createScriptedModel(body => {
      model.replies.push(body.messages);
      return (async function* () {
        yield { choices: [{ delta: { content: "Your order ships today." }, finish_reason: "stop" }] };
      })();
    }, { once: () => { model.checks += 1; return ""; }, model: "fixture-model" }) };
  } };
  const toolCatalog = { resolveToolSet: () => ({ tools: [], limits: { maxToolArgumentBytes: 4096 } }),
    toOpenAiToolSchema: tool => ({ type: "function", function: tool }) };
  const conversationStorage = createSqlConversationStorage(repositories);
  const conversationRuntime = createAssistantConversationRuntime({ storage: conversationStorage,
    conversationsRepository: store.conversations, aiClientFactory, toolCatalog });
  t.after(async () => {
    await app.close();
    await conversationRuntime.close();
    await store.close();
    await db.destroy();
  });
  await db.schema.createTable("users", table => table.bigInteger("id").primary());
  await db("users").insert([{ id: 1 }]);
  await transcriptsMigration.up(db);
  await summaryMigration.up(db);
  await claimsMigration.up(db);

  const chatService = createChatService({
    conversationRuntime, conversationStorage, aiClientFactory, serviceToolCatalog: toolCatalog,
    transcriptService: createTranscriptService(repositories), turnRequests: store.turnRequests,
    assistantConfigService: { resolveSystemPrompt: async () => "Answer questions about orders." },
    personContextPrompt: createPersonContextPrompt({ personContext: NO_PERSON_CONTEXT, logger }),
    turnAdmission: createTurnAdmission({ turnGuard, logger }), appConfig: config, logger
  });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.assistant", domain: "assistant", actions: createAssistantActions({ config, chatService, assistantConfigService: {} }) });
  actions.registerContextContributor({ id: "test.actor", contribute: () => ({ actor: { id: "1" } }) });
  const router = createRouter();
  registerRoutes(router, { config });
  registerApiErrorHandler(app);
  registerFastifyRoutes(app, { routes: router.list(), actions });

  async function send(body) {
    const response = await app.inject({ method: "POST", url: STREAM_URL, headers: HEADERS, payload: body });
    const events = response.headers["content-type"]?.includes("ndjson")
      ? response.body.trim().split("\n").map(line => JSON.parse(line)) : null;
    return { status: response.statusCode, events, body: events ? null : response.json() };
  }
  async function saved() {
    return {
      conversations: await db("assistant_conversations").orderBy("id"),
      messages: await db("assistant_messages").orderBy("id"),
      requests: await db("assistant_turn_requests")
    };
  }
  return { app, model, logged, send, saved };
}

// A turn guard that answers from a list of decisions and records each request it decides.
function scriptedGuard(...decisions) {
  const requests = [];
  return { requests, admit(request) {
    requests.push(request);
    const decision = decisions.shift();
    if (decision instanceof Error) throw decision;
    return decision;
  } };
}

test("a turn guard's reply saves the message and the reply as one completed turn, and never calls the model", async t => {
  const guard = scriptedGuard({ reply: "I can only help with orders." }, { allowed: true });
  const f = await guardedApp(t, guard);

  const refused = await f.send({ input: "What is the weather?", messageId: "off-topic" });
  assert.equal(refused.status, 200);
  const { conversations, messages } = await f.saved();
  assert.equal(conversations.length, 1);
  const conversationId = String(conversations[0].id);
  assert.deepEqual(messages.map(row => [row.role, row.kind, row.content_text, row.client_message_sid]), [
    ["user", "chat", "What is the weather?", "off-topic"],
    ["assistant", "chat", "I can only help with orders.", ""]
  ]);
  assert.equal(conversations[0].message_count, 2);
  assert.equal(conversations[0].status, "completed");
  assert.deepEqual(refused.events, [
    { type: "meta", messageId: "off-topic", conversationId },
    { type: "assistant_message", text: "I can only help with orders." },
    { type: "done", messageId: "off-topic", status: "completed",
      storedMessageIds: { user: String(messages[0].id), assistant: String(messages[1].id) } }
  ]);
  assert.deepEqual({ clients: f.model.clients, replies: f.model.replies.length, checks: f.model.checks },
    { clients: 0, replies: 0, checks: 0 }, "A fixed reply needs neither the AI connection nor the model");
  // The guard decides with the person's message and the turn's ids, before anything is saved.
  assert.equal(guard.requests.length, 1);
  const [request] = guard.requests;
  assert.deepEqual({ ...request, context: undefined },
    { targetSurfaceId: "assistant", context: undefined, input: "What is the weather?", conversationId: null, messageId: "off-topic" });
  assert.equal(request.context.actor.id, "1");

  // The saved turn is ordinary history: the conversation lists it, and the next turn's model reads it.
  const listed = await f.app.inject({ method: "GET", url: `/api/assistant/assistant/conversations/${conversationId}/messages`, headers: HEADERS });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(listed.json().data.attributes.entries.map(entry => [entry.role, entry.contentText]),
    [["user", "What is the weather?"], ["assistant", "I can only help with orders."]]);
  const answered = await f.send({ input: "Where is my order?", messageId: "on-topic", conversationId });
  assert.equal(answered.events.at(-1).status, "completed");
  assert.deepEqual(guard.requests[1], { targetSurfaceId: "assistant", context: guard.requests[1].context,
    input: "Where is my order?", conversationId, messageId: "on-topic" });
  assert.equal(f.model.replies.length, 1);
  const history = f.model.replies[0].map(message => typeof message.content === "string" ? message.content : JSON.stringify(message.content));
  for (const text of ["What is the weather?", "I can only help with orders.", "Where is my order?"]) {
    assert.ok(history.some(content => content.includes(text)), `The model's history includes "${text}"`);
  }

  // A replayed message id answers from its saved turn and never asks the guard again.
  const replayed = await f.send({ input: "What is the weather?", messageId: "off-topic" });
  assert.deepEqual(replayed.events, refused.events);
  assert.equal(guard.requests.length, 2);
  assert.equal((await f.saved()).messages.length, 4);
});

test("a turn guard's AppError refuses the turn on the route with its status, code and details, and saves nothing", async t => {
  const limit = new AppError(429, "Weekly message limit reached.", { code: "weekly_limit", details: { resetsOn: "2026-11-16" } });
  const guard = scriptedGuard(limit, { allowed: true });
  const f = await guardedApp(t, guard);

  const refused = await f.send({ input: "One more question", messageId: "over-limit" });
  assert.equal(refused.status, 429);
  assert.equal(refused.events, null, "A refused turn starts no stream");
  assert.equal(refused.body.code, "weekly_limit");
  assert.equal(refused.body.error, "Weekly message limit reached.");
  assert.deepEqual(refused.body.details, { resetsOn: "2026-11-16" });
  assert.deepEqual(await f.saved(), { conversations: [], messages: [], requests: [] });
  assert.equal(f.model.clients, 0);

  // Nothing was claimed, so the same message sent again is a new turn the guard decides again.
  const retried = await f.send({ input: "One more question", messageId: "over-limit" });
  assert.equal(retried.status, 200);
  assert.equal(guard.requests.length, 2);
  assert.equal(retried.events.at(-1).status, "completed");
  assert.equal(f.model.replies.length, 1);
});

test("an application without a turn guard runs each turn through the model as before", async t => {
  const f = await guardedApp(t, NO_TURN_GUARD);

  const answered = await f.send({ input: "Where is my order?", messageId: "first" });
  assert.equal(answered.status, 200);
  const { conversations, messages } = await f.saved();
  assert.deepEqual(messages.map(row => [row.role, row.content_text]),
    [["user", "Where is my order?"], ["assistant", "Your order ships today."]]);
  assert.deepEqual(answered.events, [
    { type: "meta", messageId: "first", conversationId: String(conversations[0].id), provider: "test", model: "fixture-model" },
    { type: "assistant_delta", delta: "Your order ships today." },
    { type: "assistant_message", text: "Your order ships today." },
    { type: "done", messageId: "first", status: "completed",
      storedMessageIds: { user: String(messages[0].id), assistant: String(messages[1].id) } }
  ]);
  // The chat service checks the AI connection, and the conversation runtime resolves it for the turn.
  assert.equal(f.model.clients, 2);
  assert.equal(f.model.replies.length, 1);
});

test("a turn guard's other answers fail the turn loudly and save nothing", async t => {
  const answers = [undefined, null, "yes", { allowed: false }, { reply: "  " }, { reply: 42 },
    { allowed: true, reply: "Both" }, [{ allowed: true }]];
  const f = await guardedApp(t, scriptedGuard(...answers));

  for (const [index, answer] of answers.entries()) {
    const failed = await f.send({ input: "Hello", messageId: `answer-${index}` });
    assert.equal(failed.status, 500, JSON.stringify(answer));
    assert.equal(f.logged.length, index + 1, `The server logs ${JSON.stringify(answer)}`);
    assert.match(f.logged.at(-1).message, /^assistant\.turnGuard\.admit\(\) returned .+; it must return \{ allowed: true \} or \{ reply \}/);
    assert.deepEqual(f.logged.at(-1).fields, { surfaceId: "assistant", messageId: `answer-${index}` });
  }
  assert.equal(f.logged.length, answers.length);
  assert.match(f.logged[3].message, /returned \{"allowed":false\};/);
  assert.match(f.logged[0].message, /returned undefined;/);
  assert.deepEqual(await f.saved(), { conversations: [], messages: [], requests: [] });
  assert.equal(f.model.clients, 0);

  assert.throws(() => createTurnAdmission({ turnGuard: { decide() {} }, logger: {} }),
    { name: "TypeError", message: "assistant.turnGuard requires admit({ targetSurfaceId, context, input, conversationId, messageId })." });
});
