import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConversationRuntime, createMemoryConversationStorage } from "../src/server/conversation/index.js";
import { createAiConnectionResolver } from "../../connectors-catalog/src/server/ai.js";

const configuration = { systemPrompt: "Answer the current question.", integrationId: "assistant" };
const connections = createAiConnectionResolver({
  configuration: { schemaVersion: 1, registrations: {}, integrations: {
    assistant: { provider: "ai", accountMode: "shared", scopes: [], authentication: { method: "none" }, settings: { model: "opencode/big-pickle" } }
  } }, authorize: () => ({ applicationId: "test", subjectId: "owner" })
});

async function fixture(t, options = {}) {
  const storage = options.storage || createMemoryConversationStorage();
  const requests = [];
  const runtimes = [];
  const state = { allowed: true, failCommit: false, commitFailures: 0 };
  const failingStorage = { ...storage, write: (id, callback) => storage.write(id, async transaction => {
    const previous = await transaction.readMetadata();
    const result = await callback(transaction);
    const next = await transaction.readMetadata();
    if (state.failCommit && previous.runtime?.replacement && !next.runtime?.replacement) {
      state.commitFailures++;
      throw new Error("Storage offline during replacement commit");
    }
    return result;
  }) };
  function runtime() {
    const value = createConversationRuntime({ storage: failingStorage, connections,
      authorize: () => state.allowed, limits: options.limits, host: options.host,
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body); requests.push(body);
        if (options.fetch) return options.fetch(body, init);
        const text = `Reply ${requests.length}`;
        const chunk = { choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }] };
        return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "content-type": "text/event-stream" } });
      }
    });
    runtimes.push(value);
    return value;
  }
  t.after(async () => { for (const value of runtimes) await value.close(); });
  const first = runtime();
  const conversation = await first.open({ id: "one", configuration });
  async function say(text, messageId) { await conversation.send({ text, messageId }); return conversation.wait(); }
  const replacement = async (patch = {}) => ({ operationId: "replace-one", expectedSegmentId: (await conversation.read()).segmentId,
    reason: "renewal", briefing: "Retain the agreed colour: blue.", ...patch });
  return { storage, conversation, first, runtime, requests, state, say, replacement };
}

test("renewal preserves logical history and receipts while subsequent inference carries the saved briefing", async t => {
  const f = await fixture(t);
  await f.say("Keep my context", "first");
  const operation = await f.replacement();
  const result = await f.conversation.replace(operation);
  assert.notEqual(result.segmentId, operation.expectedSegmentId);
  assert.equal(f.requests.length, 1, "Replacement itself does not perform inference");
  await f.say("Continue", "second");
  const sent = f.requests[1].messages;
  assert.equal(sent.at(-1).content, "Continue");
  assert.match(sent[1].content, /Retain the agreed colour: blue/);
  assert.match(sent[1].content, /Keep my context/);
  assert.match(sent[1].content, /Reply 1/);
  assert.equal(sent.filter(message => message.content === "Keep my context").length, 0);
  const snapshot = await f.conversation.read();
  assert.deepEqual(snapshot.conversationLog.map(turn => turn.user.text), ["Keep my context", "Continue"]);
  assert.equal((await f.conversation.send({ text: "Keep my context", messageId: "first" })).duplicate, true);
  const retry = await f.conversation.replace(operation);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.segmentId, result.segmentId);
  await assert.rejects(f.conversation.replace({ ...operation, briefing: "Different" }), { code: "conversation_replacement_conflict" });
});

test("completed historical branch markers retain history filtering and admission receipts", async t => {
  const f = await fixture(t);
  await f.say("Retained", "first");
  const previous = await f.say("Discarded", "second");
  const discarded = previous.conversationLog[1];
  await f.storage.write("one", transaction => transaction.updateTurnMetadata(discarded.turnId, {
    runtime: { ...discarded.metadata.runtime, supersededBy: "historical-successor" }
  }));
  assert.deepEqual((await f.conversation.read()).conversationLog.map(turn => turn.user.text), ["Retained"]);
  await f.say("Continue", "third");
  assert.match(JSON.stringify(f.requests[2].messages), /Retained/);
  assert.doesNotMatch(JSON.stringify(f.requests[2].messages), /Discarded/);
  assert.equal((await f.conversation.send({ text: "Discarded", messageId: "second" })).duplicate, true);
  const recorded = await f.storage.read("one", async tx => Promise.all((await tx.listTurnIds()).map(id => tx.readTurn(id))));
  assert.equal(recorded.length, 3);
  assert.ok(recorded[1].metadata.runtime.supersededBy);
});

test("unfinished historical Undo operations require offline inspection without changing saved state", async t => {
  const f = await fixture(t);
  await f.say("Before", "first");
  const operation = await f.replacement();
  const metadata = await f.storage.read("one", transaction => transaction.readMetadata());
  for (const patch of [{ reason: "rewind" },
    { request: { ...operation, operation: "replace", reason: "rewind" } },
    { request: { ...operation, operation: "replace", throughTurnId: null } },
    { supersededTurns: ["000001"] }]) {
    const saved = structuredClone(metadata);
    saved.runtime.replacement = { request: { ...operation, operation: "replace" }, reason: "renewal", engine: "api",
      configuration, segmentId: "historical-successor", seen: {}, ...patch };
    await f.storage.write("one", transaction => transaction.writeMetadata(saved));
    await assert.rejects(f.conversation.replace(operation), { code: "conversation_rewind_inspection_required" });
    await assert.rejects(f.runtime().open({ id: "one" }), { code: "conversation_rewind_inspection_required" });
    assert.deepEqual(await f.storage.read("one", transaction => transaction.readMetadata()), saved);
    assert.equal((await f.conversation.read()).conversationLog.length, 1);
    assert.equal(f.requests.length, 1);
  }
});

test("an interrupted replacement blocks sending and resumes exactly once after application restart", async t => {
  const f = await fixture(t);
  await f.say("Before", "first");
  const operation = await f.replacement();
  f.state.failCommit = true;
  await assert.rejects(f.conversation.replace(operation), /Storage offline/);
  assert.equal((await f.conversation.read()).status, "replacement-pending");
  await assert.rejects(f.conversation.send({ text: "Too early", messageId: "early" }), { code: "conversation_replacement_pending" });
  await assert.rejects(f.conversation.configure({ systemPrompt: "Too early" }), { code: "conversation_replacement_pending" });
  await f.first.close();
  f.state.failCommit = false;
  const resumed = await f.runtime().open({ id: "one" });
  const result = await resumed.replace(operation);
  await resumed.send({ text: "After", messageId: "after" });
  const saved = await f.storage.read("one", tx => tx.readMetadata());
  assert.equal(saved.runtime.predecessors.length, 1);
  assert.equal(saved.runtime.segmentId, result.segmentId);
  assert.equal((await resumed.wait()).conversationLog.length, 2);
  assert.equal(f.requests.length, 2);
});

test("invalid, stale and forbidden replacement requests do not alter the conversation", async t => {
  const f = await fixture(t);
  const operation = await f.replacement();
  await assert.rejects(f.conversation.replace({ ...operation, expectedSegmentId: "stale" }), { code: "conversation_replacement_conflict" });
  await assert.rejects(f.conversation.replace({ ...operation, reason: "rewind" }), { code: "conversation_invalid_replacement" });
  await assert.rejects(f.conversation.replace({ ...operation, reason: "rewind", throughTurnId: "missing" }), { code: "conversation_invalid_replacement" });
  await assert.rejects(f.conversation.replace({ ...operation, reason: "rewind", throughTurnId: null }), { code: "conversation_invalid_replacement" });
  await assert.rejects(f.conversation.replace({ ...operation, throughTurnId: null }), { code: "conversation_invalid_replacement" });
  await assert.rejects(f.conversation.replace({ ...operation, engine: "missing" }), /does not yet support/);
  f.state.allowed = false;
  await assert.rejects(f.conversation.replace(operation), { code: "conversation_forbidden" });
  f.state.allowed = true;
  assert.equal((await f.conversation.read()).segmentId, operation.expectedSegmentId);
  assert.equal((await f.conversation.read()).replacement, null);
});

test("carry-over explicitly marks omitted history and rejects an oversized briefing before replacement", async t => {
  const f = await fixture(t, { limits: { maxContinuityCharacters: 800 } });
  await f.say("X".repeat(2500), "first");
  const operation = await f.replacement({ briefing: "" });
  await assert.rejects(f.conversation.replace({ ...operation, briefing: "X".repeat(900) }), /briefing exceeds/);
  assert.equal((await f.conversation.read()).replacement, null);
  await f.conversation.replace(operation);
  await f.say("Continue", "second");
  assert.match(f.requests[1].messages[1].content, /"omittedMessages":1/);
  assert.ok(f.requests[1].messages[1].content.length <= 800);
});

test("host scope belongs to a conversation and cannot be changed through another open handle", async t => {
  const f = await fixture(t);
  const host = { workdir: "/application/one", env: { HOME: "/accounts/one" } };
  const one = await f.first.open({ id: "scoped-one", host, configuration });
  const two = await f.first.open({ id: "scoped-two", host: { workdir: "/application/two" }, configuration });
  await assert.rejects(f.first.open({ id: "scoped-one", host: { workdir: "/application/other" } }), { code: "conversation_host_mismatch" });
  await one.send({ messageId: "one", text: "One" });
  await two.send({ messageId: "two", text: "Two" });
  assert.equal((await one.wait()).conversationLog.length, 1);
  assert.equal((await two.wait()).conversationLog.length, 1);
});


test("interrupted OpenCode integration selection retries the original fresh binding transaction without inference", async t => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-selection-replacement-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = await fixture(t, { host: { workdir: directory, execution: {
    start() { assert.fail("Selection must not start a native process or submit a prompt."); },
    stop() { assert.fail("An inert binding has no process to stop."); }
  } } });
  const initial = await f.conversation.read();
  await f.conversation.select({ operationId: "enter-open-code", expectedSegmentId: initial.segmentId,
    engine: "opencode", configuration });
  const original = await f.conversation.read();
  const operation = { operationId: "switch-integration", expectedSegmentId: original.segmentId,
    engine: "opencode", configuration: { ...configuration, integrationId: "flash" } };
  const metadata = await f.storage.read("one", tx => tx.readMetadata());
  f.state.failCommit = true;
  await assert.rejects(f.conversation.select(operation), /Storage offline during replacement commit/);
  const pending = await f.storage.read("one", tx => tx.readMetadata());
  assert.deepEqual(pending.runtime.replacement.request, { ...operation, operation: "select" });
  assert.notEqual(pending.runtime.replacement.binding.directory, metadata.runtime.binding.directory);
  assert.equal((await f.conversation.read()).status, "replacement-pending");
  await assert.rejects(f.conversation.send({ messageId: "premature", text: "Too early" }),
    { code: "conversation_replacement_pending" });
  await f.first.close();
  f.state.failCommit = false;
  const reopened = await f.runtime().open({ id: "one" });
  const result = await reopened.select(operation);
  assert.equal(result.segmentId, pending.runtime.replacement.segmentId);
  const saved = await f.storage.read("one", tx => tx.readMetadata());
  assert.deepEqual(saved.runtime.binding, pending.runtime.replacement.binding);
  assert.deepEqual(saved.runtime.predecessors.at(-1).binding, metadata.runtime.binding);
  assert.equal(saved.runtime.replacement, undefined);
  assert.equal((await reopened.select(operation)).duplicate, true);
  assert.deepEqual(await f.storage.read("one", tx => tx.readMetadata()), saved);
  assert.equal(f.requests.length, 0);
});

test("interrupted fresh native selection retains its consumer policy and successor on restart", async t => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-fresh-selection-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = await fixture(t, { host: { workdir: directory, execution: {
    start() { assert.fail("Selection cannot start native work."); },
    stop() { assert.fail("An inert binding has no process to stop."); }
  } } });
  await f.conversation.select({ operationId: "enter-open-code", expectedSegmentId: (await f.conversation.read()).segmentId,
    engine: "opencode", configuration });
  const original = await f.storage.read("one", tx => tx.readMetadata());
  const operation = { operationId: "fresh-model", expectedSegmentId: original.runtime.segmentId,
    engine: "opencode", configuration: { ...configuration, effort: "high" }, retireNative: true };
  f.state.failCommit = true;
  await assert.rejects(f.conversation.select(operation), /Storage offline during replacement commit/);
  const pending = await f.storage.read("one", tx => tx.readMetadata());
  assert.deepEqual(pending.runtime.replacement.request, { ...operation, operation: "select" });
  assert.notEqual(pending.runtime.replacement.binding.directory, original.runtime.binding.directory);
  assert.equal((await f.conversation.read()).status, "replacement-pending");
  await assert.rejects(f.conversation.send({ messageId: "too-early", text: "Wait for the change" }),
    { code: "conversation_replacement_pending" });
  await f.first.close();
  f.state.failCommit = false;
  const reopened = await f.runtime().open({ id: "one" });
  const result = await reopened.select(operation);
  const saved = await f.storage.read("one", tx => tx.readMetadata());
  assert.equal(result.segmentId, pending.runtime.replacement.segmentId);
  assert.deepEqual(saved.runtime.binding, pending.runtime.replacement.binding);
  assert.deepEqual(saved.runtime.predecessors.at(-1).binding, original.runtime.binding);
  assert.deepEqual(saved.runtime.predecessors.at(-1).replacement, { ...operation, operation: "select" });
  assert.equal(saved.runtime.replacement, undefined);
  assert.equal((await reopened.select(operation)).duplicate, true);
  assert.deepEqual(await f.storage.read("one", tx => tx.readMetadata()), saved);
  assert.equal(f.requests.length, 0);
});
