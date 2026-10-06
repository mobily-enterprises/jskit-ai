import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationRuntime, createMemoryConversationStorage, createFileConversationStorage, normalizeConversationConfiguration } from "../src/server/conversation/index.js";
import { validateConversationConfiguration } from "../src/server/conversation/configuration.js";

test("configuration shorthand retains native login, explicit connection defaults and JSON-stable optional fields", () => {
  const input = Object.freeze({ systemPrompt: "Answer briefly.", integrationId: undefined,
    model: undefined, effort: undefined, outputSchema: undefined });
  for (const engine of ["api", "opencode", "claude", "codex"]) {
    const configuration = normalizeConversationConfiguration(input, { engine, defaultIntegrationId: "assistant" });
    assert.deepEqual(configuration, engine === "api" || engine === "opencode"
      ? { systemPrompt: input.systemPrompt, integrationId: "assistant" } : { systemPrompt: input.systemPrompt });
    assert.deepEqual(JSON.parse(JSON.stringify(configuration)), configuration);
    const explicit = { ...input, integrationId: "authorized-choice", model: "exact-model-id", effort: "high" };
    assert.deepEqual(normalizeConversationConfiguration(explicit, { engine, defaultIntegrationId: "assistant" }), {
      systemPrompt: input.systemPrompt, integrationId: "authorized-choice", model: "exact-model-id", effort: "high"
    });
  }
  assert.equal(Object.hasOwn(input, "integrationId"), true);
  assert.equal(input.integrationId, undefined);
  const withoutDefault = normalizeConversationConfiguration(input, { engine: "api" });
  assert.deepEqual(withoutDefault, { systemPrompt: input.systemPrompt });
  assert.throws(() => validateConversationConfiguration(withoutDefault, {
    engine: "API", connectionRequired: true, connections: { resolve() {} }
  }), /requires an authorized integrationId/);
  const invalid = normalizeConversationConfiguration({ systemPrompt: input.systemPrompt, integrationId: "" }, {
    engine: "api", defaultIntegrationId: "assistant"
  });
  assert.equal(invalid.integrationId, "");
  assert.throws(() => validateConversationConfiguration(invalid), /configuration requires/);
  const unsupported = normalizeConversationConfiguration({ systemPrompt: input.systemPrompt, unexpected: undefined });
  assert.equal(Object.hasOwn(unsupported, "unexpected"), true);
  assert.throws(() => validateConversationConfiguration(unsupported), /configuration requires/);
});

async function fixture(t, { file = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "conversation-configuration-"));
  const storage = file ? createFileConversationStorage({ directory: join(directory, "conversations") }) : createMemoryConversationStorage();
  const runtimes = [];
  t.after(async () => {
    try { for (const runtime of runtimes) await runtime.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  function runtime(options = {}) {
    const value = createConversationRuntime({ storage, defaultIntegrationId: "assistant", authorize: () => true,
      connections: { resolve() { assert.fail("Configuration must not resolve credentials or run inference."); } },
      fetch() { assert.fail("Configuration must not issue a provider request."); },
      host: { workdir: directory, env: { HOME: directory }, execution: {
        start() { assert.fail("Configuration must not start a native process."); },
        stop() { assert.fail("An unopened native conversation has no process to stop."); }
      } }, ...options });
    runtimes.push(value);
    return value;
  }
  return { runtime, storage };
}

test("runtime normalizes open and configure inputs with only an explicit connection default", async t => {
  const f = await fixture(t);
  const runtime = f.runtime();
  const input = Object.freeze({ systemPrompt: "Answer briefly.", integrationId: undefined,
    model: undefined, effort: undefined, outputSchema: undefined });
  const expected = { systemPrompt: input.systemPrompt, integrationId: "assistant" };
  const conversation = await runtime.open({ id: "one", configuration: input });
  assert.deepEqual((await conversation.read()).configuration, expected);
  assert.deepEqual((await (await runtime.open({ id: "one", configuration: input })).read()).configuration, expected);
  assert.deepEqual(await conversation.configure({ integrationId: "explicit", model: "exact-model-id", effort: "high" }), {
    systemPrompt: input.systemPrompt, integrationId: "explicit", model: "exact-model-id", effort: "high"
  });
  assert.deepEqual(await conversation.configure({ integrationId: undefined, model: undefined, effort: undefined }), expected);
  await assert.rejects(conversation.configure({ integrationId: "" }), /configuration requires/);
  await assert.rejects(conversation.configure({ unexpected: undefined }), /configuration requires/);
  assert.deepEqual((await conversation.read()).configuration, expected);
  assert.equal(Object.hasOwn(input, "integrationId"), true);
  assert.equal(input.integrationId, undefined);
  await assert.rejects(f.runtime({ defaultIntegrationId: undefined }).open({ id: "without-default", configuration: input }),
    /requires an authorized integrationId/);
});

test("runtime normalization uses the saved engine on reopen and never rewrites saved configuration", async t => {
  const f = await fixture(t);
  for (const engine of ["api", "claude"]) {
    const options = { engine: engine === "api" ? "claude" : "api" };
    const input = { systemPrompt: "Keep this configuration.", integrationId: undefined,
      model: undefined, effort: undefined, outputSchema: undefined };
    const expected = { systemPrompt: input.systemPrompt, ...(engine === "api" ? { integrationId: "assistant" } : {}) };
    const first = f.runtime(options);
    await first.open({ id: engine, engine, configuration: input });
    await first.close();
    const second = f.runtime(options);
    const reopened = await second.open({ id: engine, configuration: input });
    assert.equal((await reopened.read()).engine, engine);
    assert.deepEqual((await reopened.read()).configuration, expected);
    await reopened.configure({ integrationId: "explicit", model: "exact-model-id", effort: "high" });
    assert.deepEqual(await reopened.configure({ integrationId: undefined, model: undefined, effort: undefined }), expected);
    await second.close();
    await f.storage.write(engine, async transaction => {
      const metadata = await transaction.readMetadata();
      metadata.runtime.configuration.model = undefined;
      await transaction.writeMetadata(metadata);
    });
    const saved = await f.storage.read(engine, transaction => transaction.readMetadata());
    const restored = await f.runtime(options).open({ id: engine });
    assert.deepEqual((await restored.read()).configuration, saved.runtime.configuration);
    assert.equal(Object.hasOwn((await restored.read()).configuration, "model"), true);
    assert.deepEqual(await f.storage.read(engine, transaction => transaction.readMetadata()), saved);
  }
});

test("runtime normalizes destination settings and retains file-backed selection and replacement retries", async t => {
  const f = await fixture(t, { file: true });
  const first = f.runtime();
  let conversation = await first.open({ id: "one", configuration: { systemPrompt: "Initial instructions." } });
  const selection = { operationId: "native", expectedSegmentId: (await conversation.read()).segmentId, engine: "claude",
    configuration: { systemPrompt: "Native instructions.", integrationId: undefined, model: "exact-model-id", effort: "high" } };
  const selected = await conversation.select(selection);
  assert.equal((await conversation.read()).engine, "claude");
  assert.deepEqual((await conversation.read()).configuration, {
    systemPrompt: "Native instructions.", model: "exact-model-id", effort: "high"
  });
  assert.deepEqual((await f.storage.read("one", transaction => transaction.readMetadata())).runtime.predecessors.at(-1).replacement,
    { ...selection, configuration: { systemPrompt: "Native instructions.", model: "exact-model-id", effort: "high" }, operation: "select" });
  await first.close();
  const second = f.runtime({ defaultIntegrationId: "next-default" });
  conversation = await second.open({ id: "one" });
  assert.equal((await conversation.select(selection)).duplicate, true);
  await assert.rejects(conversation.select({ ...selection, configuration: { ...selection.configuration, model: "changed-model" } }),
    { code: "conversation_replacement_conflict" });
  const replacement = { operationId: "api", expectedSegmentId: selected.segmentId, reason: "engine-change", engine: "api",
    configuration: { systemPrompt: "API instructions.", integrationId: undefined, model: undefined, effort: undefined } };
  await conversation.replace(replacement);
  assert.equal((await conversation.read()).engine, "api");
  assert.deepEqual((await conversation.read()).configuration, { systemPrompt: "API instructions.", integrationId: "next-default" });
  assert.deepEqual((await f.storage.read("one", transaction => transaction.readMetadata())).runtime.predecessors.at(-1).replacement,
    { ...replacement, configuration: { systemPrompt: "API instructions." }, operation: "replace" });
  await second.close();
  conversation = await f.runtime({ defaultIntegrationId: "later-default" }).open({ id: "one" });
  assert.equal((await conversation.replace(replacement)).duplicate, true);
  await assert.rejects(conversation.replace({ ...replacement, configuration: { ...replacement.configuration, integrationId: "changed" } }),
    { code: "conversation_replacement_conflict" });
  assert.deepEqual((await conversation.read()).configuration, { systemPrompt: "API instructions.", integrationId: "next-default" });
  assert.deepEqual((await conversation.read()).conversationLog, []);
});

test("file-backed pending replacement keeps its admitted configuration across a new runtime default", async t => {
  const f = await fixture(t, { file: true });
  const interruptedStorage = { ...f.storage, write: (id, callback) => f.storage.write(id, async transaction => {
    const previous = await transaction.readMetadata();
    const value = await callback(transaction);
    const next = await transaction.readMetadata();
    if (previous.runtime?.replacement && !next.runtime?.replacement) throw new Error("Storage unavailable during replacement commit.");
    return value;
  }) };
  const first = f.runtime({ storage: interruptedStorage });
  const conversation = await first.open({ id: "one", configuration: { systemPrompt: "Initial instructions." } });
  const input = { operationId: "pending", expectedSegmentId: (await conversation.read()).segmentId, reason: "model-change",
    engine: undefined, briefing: undefined,
    configuration: { systemPrompt: "Replacement instructions.", integrationId: undefined, model: undefined, effort: undefined } };
  await assert.rejects(conversation.replace(input), /Storage unavailable during replacement commit/);
  const saved = await f.storage.read("one", transaction => transaction.readMetadata());
  assert.deepEqual(saved.runtime.replacement.configuration, { systemPrompt: "Replacement instructions.", integrationId: "assistant" });
  assert.deepEqual(saved.runtime.replacement.request.configuration, { systemPrompt: "Replacement instructions." });
  await first.close();
  const resumed = await f.runtime({ defaultIntegrationId: "later-default" }).open({ id: "one" });
  await assert.rejects(resumed.replace({ ...input, configuration: { ...input.configuration, systemPrompt: "Different instructions." } }),
    { code: "conversation_replacement_pending" });
  assert.deepEqual(await f.storage.read("one", transaction => transaction.readMetadata()), saved);
  await resumed.replace(input);
  assert.deepEqual((await resumed.read()).configuration, { systemPrompt: "Replacement instructions.", integrationId: "assistant" });
  assert.equal((await resumed.replace(input)).duplicate, true);
});
