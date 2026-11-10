import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import knex from "knex";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes as registerFastifyRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import transcriptsMigration from "../migrations/assistant_transcripts_initial.cjs";
import summaryMigration from "../migrations/assistant_transcripts_summary.cjs";
import claimsMigration from "../migrations/assistant_turn_requests.cjs";
import { createAssistantActions } from "../src/server/actions.js";
import { registerRoutes } from "../src/server/registerRoutes.js";
import { createChatService } from "../src/server/services/chatService.js";
import { createTranscriptService } from "../src/server/services/transcriptService.js";
import { createTestAssistantStore } from "./support/assistantStore.js";

const config = Object.freeze({
  surfaceDefinitions: { assistant: { enabled: true, requiresWorkspace: false } },
  assistantSurfaces: { assistant: { settingsSurfaceId: "assistant", configScope: "global" } }
});

// The saved-conversations list as an application serves it: the assistant's SQL repositories on SQLite, its chat
// service and actions, and its routes on Fastify, with the signed-in user "1".
async function listApp(t) {
  const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
  const store = await createTestAssistantStore(db);
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await store.close();
    await db.destroy();
  });
  await db.schema.createTable("users", (table) => table.bigInteger("id").primary());
  await db("users").insert([{ id: 1 }]);
  await transcriptsMigration.up(db);
  await summaryMigration.up(db);
  await claimsMigration.up(db);

  const chatService = createChatService({
    transcriptService: createTranscriptService({ conversationsRepository: store.conversations, messagesRepository: store.messages }),
    turnRequests: store.turnRequests,
    appConfig: config
  });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.assistant", domain: "assistant", actions: createAssistantActions({ config, chatService, assistantConfigService: {} }) });
  actions.registerContextContributor({ id: "test.actor", contribute: () => ({ actor: { id: "1" } }) });
  const router = createRouter();
  registerRoutes(router, { config });
  registerApiErrorHandler(app);
  registerFastifyRoutes(app, { routes: router.list(), actions });
  return { app, conversations: store.conversations };
}

test("the saved-conversations list answers its conversations over HTTP, without their runtime metadata", async (t) => {
  const { app, conversations } = await listApp(t);
  const saved = await conversations.create({ createdByUserId: "1", surfaceId: "assistant", title: "Order follow-up",
    metadata: { runtime: { systemPrompt: "Answer briefly." } } });

  const response = await app.inject({ method: "GET", url: "/api/assistant/assistant/conversations", headers: { "x-jskit-surface": "assistant" } });

  // Before, the route serialized each item with the conversation's read schema, which requires metadata: a 500.
  assert.equal(response.statusCode, 200, response.body);
  const { data } = response.json();
  assert.deepEqual(data.map((item) => [item.type, item.id, item.attributes.title]), [["assistant-conversations", saved.id, "Order follow-up"]]);
  assert.equal(Object.hasOwn(data[0].attributes, "metadata"), false);
  assert.equal(data[0].attributes.createdByUserId, "1");
});
