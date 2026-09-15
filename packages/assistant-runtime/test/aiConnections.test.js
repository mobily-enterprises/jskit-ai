import assert from "node:assert/strict";
import test from "node:test";
import { createAiConnectionResolver } from "../../connectors-catalog/src/server/ai.js";
import { createAssistantAiClientFactory } from "../src/server/AssistantProvider.js";

test("assistant connections authorize each request and resolve rotated and individual credentials afresh", async t => {
  const keys = { alice: "alice-first", bob: "bob-only" };
  const authorized = [];
  const usedKeys = [];
  const aiConnections = createAiConnectionResolver({
    configuration: { schemaVersion: 1, registrations: {}, integrations: {
      chat: { provider: "ai", accountMode: "per-user", scopes: [],
        settings: { model: "openai/gpt-4.1-mini" }, authentication: { method: "api-key", secretRef: "account:chat" } }
    } },
    authorize(context, request) {
      authorized.push([context.actor.id, request.integrationId]);
      return context.actor.id === "denied" ? null : { applicationId: "example", subjectId: context.actor.id };
    },
    resolveReference(_reference, owner) { return keys[owner.subjectId]; }
  });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    usedKeys.push(new Headers(options.headers).get("authorization"));
    return new Response([
      { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1" } },
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "Ready" },
      { type: "response.completed", response: { id: "resp_1", created_at: 1, model: "gpt-4.1-mini", status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 1 } } }
    ].map(data => `data: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  });
  const factory = createAssistantAiClientFactory({
    appConfig: { assistantServer: { admin: { aiIntegrationId: "chat" } } }, aiConnections
  });
  async function run(id) {
    const client = await factory.resolveClient("admin", { context: { actor: { id } } });
    return Array.fromAsync(client.createChatCompletionStream({ messages: [{ role: "user", content: "Hi" }] }));
  }
  await run("alice");
  keys.alice = "alice-rotated";
  await run("alice");
  await run("bob");
  assert.deepEqual(usedKeys, ["Bearer alice-first", "Bearer alice-rotated", "Bearer bob-only"]);
  delete keys.alice;
  await assert.rejects(run("alice"), /API key is unavailable/u);
  await assert.rejects(run("denied"), /denied/u);
  await assert.rejects(factory.resolveClient("admin", { context: { actor: { id: "bob" } }, integrationId: "not-allowed" }), /not available/u);
  assert.deepEqual(authorized, [["alice", "chat"], ["alice", "chat"], ["bob", "chat"], ["alice", "chat"], ["denied", "chat"]]);
  assert.equal(usedKeys.length, 3);
});

test("existing explicit environment configuration remains available and rejects connection overrides", async () => {
  const factory = createAssistantAiClientFactory({
    appConfig: { assistantServer: { admin: { aiConfigPrefix: "ADMIN" } } },
    env: { ADMIN_AI_PROVIDER: "openai", ADMIN_AI_API_KEY: "test-key", ADMIN_AI_MODEL: "chosen-model" }
  });
  const first = await factory.resolveClient("admin");
  assert.equal(first.defaultModel, "chosen-model");
  assert.equal(await factory.resolveClient("admin"), first);
  await assert.rejects(factory.resolveClient("admin", { integrationId: "chat" }), /does not allow/u);
});
