import assert from "node:assert/strict";
import test from "node:test";
import { createConversationSystemPrompt } from "../src/server/conversation/systemPrompt.js";

test("retained instructions install once across messages and tool continuations", async () => {
  const prompt = createConversationSystemPrompt();
  const calls = [];
  const input = { systemPrompt: "Use the application tools.", contextIdentity: "thread/model/account",
    install: async (value) => { calls.push(value); return "installed"; } };
  assert.deepEqual(await Promise.all([prompt.ensure(input), prompt.ensure(input), prompt.ensure(input)]),
    ["installed", "installed", "installed"]);
  assert.equal(calls.length, 1);
  assert.equal(prompt.isCurrent(input), true);
  await prompt.ensure({ ...input, systemPrompt: "Use the updated application tools." });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].promptChanged, true);
  assert.equal(calls[1].contextChanged, false);
  assert.equal(prompt.isCurrent(input), false);
  await prompt.ensure({ ...input, systemPrompt: "Use the updated application tools.", contextIdentity: "replacement/model/account" });
  assert.equal(calls[2].contextChanged, true);
});

test("native context loss and controller restart require installation again", async () => {
  let calls = 0;
  const input = { systemPrompt: "Current instructions", contextIdentity: "native-thread",
    install: async () => ++calls };
  const prompt = createConversationSystemPrompt();
  await prompt.ensure(input);
  prompt.invalidate();
  await prompt.ensure(input);
  await createConversationSystemPrompt().ensure(input);
  assert.equal(calls, 3);
});

test("failed installation is retried before accepting the same instructions", async () => {
  const prompt = createConversationSystemPrompt();
  let calls = 0;
  const input = { systemPrompt: "Current instructions", contextIdentity: "native-thread",
    install: async () => { if (++calls === 1) throw new Error("Provider unavailable"); } };
  await assert.rejects(prompt.ensure(input), /Provider unavailable/);
  await prompt.ensure(input);
  await prompt.ensure(input);
  assert.equal(calls, 2);
});

test("invalidation during installation leaves the replacement context unacknowledged", async () => {
  const prompt = createConversationSystemPrompt();
  const entered = Promise.withResolvers(), released = Promise.withResolvers();
  let calls = 0;
  const input = { systemPrompt: "Current instructions", contextIdentity: "native-thread",
    install: async () => { if (++calls === 1) { entered.resolve(); await released.promise; } } };
  const installing = prompt.ensure(input);
  await entered.promise;
  prompt.invalidate();
  released.resolve();
  await assert.rejects(installing, /context changed while installing/);
  await prompt.ensure(input);
  assert.equal(calls, 2);
});

test("request-scoped providers receive one system field per request without history mutation", async () => {
  const prompt = createConversationSystemPrompt();
  const messages = [{ role: "user", content: "Hello" }];
  const requests = [];
  const input = { systemPrompt: "Current instructions", contextIdentity: "api-conversation", retained: false,
    install: async ({ systemPrompt }) => requests.push({ system: systemPrompt, messages }) };
  await prompt.ensure(input);
  await prompt.ensure(input);
  assert.equal(requests.length, 2);
  assert.deepEqual(messages, [{ role: "user", content: "Hello" }]);
});

test("conversation instruction bindings are isolated and preserve exact text", async () => {
  const first = createConversationSystemPrompt(), second = createConversationSystemPrompt();
  const calls = [];
  const input = { systemPrompt: "  Exact instructions.\n", contextIdentity: "same-native-id",
    install: async ({ systemPrompt }) => calls.push(systemPrompt) };
  await first.ensure(input);
  await second.ensure(input);
  assert.deepEqual(calls, [input.systemPrompt, input.systemPrompt]);
  await assert.rejects(first.ensure({ ...input, systemPrompt: " " }), /non-empty string/);
  await assert.rejects(first.ensure({ ...input, contextIdentity: "" }), /contextIdentity/);
  await assert.rejects(first.ensure({ ...input, install: null }), /installation adapter/);
});
