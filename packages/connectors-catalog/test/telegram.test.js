import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { telegramProvider } from "../src/server/telegram.js";

test("Telegram sends plain messages and polls without hidden acknowledgement or retry", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "telegram-workflows-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  let response = { ok: true, result: { id: 123, is_bot: true, first_name: "Fixture" } }, status = 200;
  const service = createConnectionService({
    configuration: { schemaVersion: 1, registrations: {}, integrations: { forms: {
      provider: "telegram", accountMode: "shared", displayName: "Forms", scopes: [],
      authentication: { method: "api-key", secretRef: "env:TELEGRAM_BOT_TOKEN" }
    } } }, providers: [telegramProvider], authorize: async (owner) => owner,
    resolveReference: async () => "123456:fixture_token",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, options) => { requests.push({ url: new URL(url), options }); return Response.json(response, { status }); }
  });
  const identity = { context: { applicationId: "app", subjectId: "owner" }, integrationId: "forms" };
  await service.connectApiKey(identity);
  const invoke = (operation, input) => service.invoke({ ...identity, operation, input });
  const message = { message_id: 42, chat: { id: -100123 }, text: "Hello <world>" };
  response = { ok: true, result: message };
  assert.deepEqual(await invoke("messages.send", { chat_id: "-100123", text: message.text }), response);
  assert.equal(requests.at(-1).url.href, "https://api.telegram.org/bot123456:fixture_token/sendMessage");
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { chat_id: "-100123", text: message.text, disable_notification: false, protect_content: false });
  assert.equal(requests.at(-1).options.method, "POST");
  response = { ok: true, result: true };
  assert.deepEqual(await invoke("chats.action", { chat_id: "@example_bot", action: "typing" }), response);
  response = { ok: true, result: [{ update_id: 90, message: { message_id: 3, chat: { id: 456 }, text: "/start" } }] };
  assert.deepEqual(await invoke("updates.poll", {}), response);
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { limit: 100, timeout: 20, allowed_updates: ["message"] });
  response = { ok: true, result: [] };
  await invoke("updates.poll", { offset: 91, timeout: 0, limit: 1 });
  assert.equal(JSON.parse(requests.at(-1).options.body).offset, 91);
  const before = requests.length;
  for (const [operation, input] of [["messages.send", { chat_id: "../leak", text: "Hello" }],
    ["messages.send", { chat_id: "123", text: "" }], ["messages.send", { chat_id: "123", text: "a".repeat(4097) }],
    ["messages.send", { chat_id: "123", text: "Hello", allow_paid_broadcast: true }],
    ["chats.action", { chat_id: "123", action: "arbitrary" }],
    ["updates.poll", { offset: -1 }], ["updates.poll", { timeout: 21 }], ["updates.poll", { allowed_updates: [] }]]) {
    await assert.rejects(invoke(operation, input), { code: "connector_input_invalid" });
  }
  assert.equal(requests.length, before);
  response = { ok: true, result: [{ update_id: "bad" }] };
  await assert.rejects(invoke("updates.poll", {}), { code: "connector_response_invalid" });
  for (const code of [403, 429, 500]) {
    response = { ok: false, error_code: code, description: "secret-provider-message" };
    const count = requests.length;
    await assert.rejects(invoke("messages.send", { chat_id: "123", text: "Hello" }), (error) => !JSON.stringify(error).includes("secret-provider-message"));
    assert.equal(requests.length, count + 1);
  }
});
