import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createConversationRuntime, createFileConversationStorage } from "../src/server/conversation/index.js";
import { createCodexConversationStore } from "../src/server/conversation/agentRun.js";
import { createReentrantConversationStorage } from "../src/server/conversation/storage.js";
import { createConversationTranscript } from "../src/server/conversation/transcript.js";
import { createConversationStreams } from "../src/server/conversation/streams.js";
import { createLocalConversationExecution } from "../src/server/conversation/localExecution.js";
import { createCodexConversationDriver } from "../src/server/conversation/providers/codexDriver.js";
import { createCodexAppServerProviderOwner } from "../src/server/conversation/codexProviderOwner.js";
import { CodexAppServerJsonRpcClient } from "../src/server/conversation/codexClient.js";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "json-rest-schema";
import { createAiConnectionResolver } from "../../connectors-catalog/src/server/ai.js";

const configuration = { systemPrompt: "Keep these instructions fresh.", model: "test-model", effort: "high" };
const input = { messageId: "first", text: "Hello" };

test("Codex structured output uses the existing native turn setting without changing conversation identity", async t => {
  const outputSchema = { type: "object", additionalProperties: false,
    properties: { answer: { type: "string", maxLength: 32 } }, required: ["answer"] };
  const f = await fixture(t, { configuration: { ...configuration, outputSchema } });
  await f.conversation.send(input);
  const first = await f.conversation.wait();
  assert.equal(first.capabilities.structuredOutput, true);
  assert.deepEqual(first.configuration.outputSchema, outputSchema);
  const turns = () => f.trace().then(rows => rows.filter(row => row.method === "turn/start"));
  assert.deepEqual((await turns())[0].params.outputSchema, outputSchema);
  const threadId = (await f.storage.read("conversation", tx => tx.readMetadata())).runtime.binding.threadId;
  await assert.rejects(f.conversation.configure({ outputSchema: { type: "string" } }), /finite positive maxLength/);
  assert.equal((await turns()).length, 1, "An unbounded schema fails before another provider turn");
  assert.deepEqual((await f.conversation.read()).configuration.outputSchema, outputSchema);
  await f.conversation.configure({ outputSchema: undefined });
  await f.conversation.send({ messageId: "ordinary", text: "Use ordinary output" });
  await f.conversation.wait();
  assert.equal(Object.hasOwn((await turns())[1].params, "outputSchema"), false);
  assert.equal((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.binding.threadId, threadId);
});

test("native binding writes preserve the current original run without copying it to a replacement", async t => {
  const f = await fixture(t);
  const savedRun = { id: "codex_app_server", state: "completed", active: false,
    outerTurnId: "outer-before-open", providerTurnId: "native-before-open", sentinel: { kept: true },
    events: [{ kind: "complete", detail: { kept: true } }] };
  async function writeRun(run) {
    await f.storage.write("conversation", async transaction => {
      const metadata = await transaction.readMetadata();
      metadata.runtime.binding.codexAppServerRun = run;
      await transaction.writeMetadata(metadata);
    });
  }
  const state = () => f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime);
  await writeRun(savedRun);
  await f.conversation.send(input);
  await f.conversation.wait();
  function assertAdvanced(run, previous, messageId, threadId) {
    assert.deepEqual(run.sentinel, previous.sentinel);
    assert.deepEqual(run.events.slice(0, previous.events.length), previous.events,
      "Binding writes preserve the exact ordered event prefix from the current store.");
    const kinds = run.events.slice(previous.events.length).map(event => event.kind);
    const claimed = kinds.indexOf("codex-app-server-turn-claimed");
    const active = kinds.indexOf("codex-app-server-turn-active");
    const finalizing = kinds.indexOf("codex-app-server-turn-finalizing");
    const idle = kinds.indexOf("codex-app-server-turn-idle");
    assert.ok(claimed >= 0 && claimed < active && active < finalizing && finalizing < idle);
    assert.equal(run.outerTurnId, messageId);
    assert.equal(run.providerThreadId, threadId);
    assert.ok(run.providerTurnId);
    assert.notEqual(run.providerTurnId, previous.providerTurnId);
    assert.equal(run.state, "completed");
    assert.equal(run.active, false);
  }
  const firstState = await state();
  assertAdvanced(firstState.binding.codexAppServerRun, savedRun, input.messageId, firstState.binding.threadId);
  await f.first.close();
  const reopened = await f.runtime().open({ id: "conversation" });
  const latestRun = { ...savedRun, outerTurnId: "outer-latest", providerTurnId: "native-latest",
    events: [...savedRun.events, { kind: "later-record", unknownField: [1, 2] }] };
  await writeRun(latestRun);
  await reopened.send({ messageId: "after-open", text: "Continue" });
  const completed = await reopened.wait();
  const latestState = await state();
  const advancedRun = latestState.binding.codexAppServerRun;
  assertAdvanced(advancedRun, latestRun, "after-open", latestState.binding.threadId);
  await reopened.replace({ operationId: "fresh-native", expectedSegmentId: completed.segmentId,
    reason: "renewal", briefing: "Continue the saved work." });
  const replacement = await state();
  assert.equal(Object.hasOwn(replacement.binding, "codexAppServerRun"), false);
  assert.deepEqual(replacement.predecessors.at(-1).binding.codexAppServerRun, advancedRun);
});

test("Codex exposes the durable native identity before dispatch and respects a rejected gate", async t => {
  const f = await fixture(t);
  await f.first.close();
  const driver = createCodexConversationDriver(f.driverOptions);
  const readBinding = () => f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  const storage = createReentrantConversationStorage(f.storage);
  const segmentId = await storage.read("conversation", async tx => (await tx.readMetadata()).runtime.segmentId);
  const store = createCodexConversationStore({ storage, scope: "conversation", segmentId, isCurrent: () => true,
    transcript: createConversationTranscript({ storage }), streams: createConversationStreams() });
  const provider = await driver.open({ binding: await readBinding(),
    conversation: { sessionId: "conversation", runtime: { store, getSession: store.getSession }, publish() {}, checkpoint() {} },
    writeBinding: binding => f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      const { codexAppServerRun: _stale, ...next } = binding;
      metadata.runtime.binding = { ...next, ...(metadata.runtime.binding.codexAppServerRun
        ? { codexAppServerRun: metadata.runtime.binding.codexAppServerRun } : {}) };
      await tx.writeMetadata(metadata);
    }),
    onFailure() {}
  });
  const blocked = new Error("Dispatch stopped by the persisted delivery gate.");
  let checked = false;
  try {
    await assert.rejects(provider.run({ configuration, input, signal: new AbortController().signal,
      async beforeDispatch(identity) {
        assert.deepEqual(identity, { threadId: (await readBinding()).threadId });
        assert.ok(identity.threadId);
        checked = true;
        throw blocked;
      },
      accept() { assert.fail("A rejected dispatch must not admit the message."); },
      onMessage() {}, onEvent() {}
    }), error => error === blocked);
    assert.equal(checked, true);
    assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 0);
  } finally { await provider.dispose(); }
});

test("Codex goal controls preserve native scheduling without authored command messages", async t => {
  const f = await fixture(t);
  const state = await f.conversation.read();
  assert.deepEqual(state.capabilities.goalCommands, {
    set: { delivery: "control", interruptsTurn: false }, resume: { delivery: "control", interruptsTurn: false },
    pause: { delivery: "control", interruptsTurn: false }, cancel: { delivery: "control", interruptsTurn: false }
  });
  const command = { action: "set", objective: "Finish the goal", expectedSegmentId: state.segmentId, tokenBudget: 40 };
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  assert.equal((await f.conversation.updateGoal(command)).objective, command.objective);
  const completed = await settledNativeGoal(f);
  assert.equal(completed.error, "");
  assert.equal(completed.goal.status, "budgetLimited");
  assert.equal(completed.goal.tokensUsed, 45);
  assert.equal(completed.conversationLog.some(turn => turn.user || turn.system), false);
  assert.equal(completed.pendingRequest, null);
  const saved = await f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime);
  assert.equal(Object.hasOwn(saved.binding, "goalRequest"), false);
  assert.equal(Object.hasOwn(saved.binding, "goalReceipt"), false);
  assert.equal(saved.binding.codexAppServerRun.providerThreadId, saved.binding.threadId);
  assert.equal(saved.binding.codexAppServerRun.providerGoalStatus, "budgetLimited");
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "thread/goal/set").length, 1);
  assert.equal(trace.filter(row => row.method === "turn/start").length, 0);
  assert.equal(trace.some(row => row.method === "thread/inject_items"), false);
  assert.equal(trace.find(row => row.method === "thread/start").params.config.features.goals, true);
  assert.equal(events.filter(event => event.type === "accepted").length, 0);
  assert.ok(events.some(event => event.type === "goal" && event.goal?.status === "budgetLimited"));
});

test("a goal added during ordinary Codex work preserves its answer, tool receipt and native turn", async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  let calls = 0;
  const authorized = [];
  const context = { actor: { id: "original" }, surface: "app", permissions: ["numbers.read"] };
  const f = await fixture(t, { context, checkpoints: true,
    actions: applicationActions(async () => {
      calls++;
      if (calls === 1) { entered.resolve(); return complete.promise; }
      return { value: calls };
    }),
    authorize: ({ context, operation }) => { if (operation === "tool") authorized.push(context.actor.id); return true; }
  });
  await f.conversation.send({ messageId: "ordinary", text: "tools" });
  await entered.promise;
  const before = await f.conversation.read();
  const other = await f.first.open({ id: "conversation", context: { ...context, actor: { id: "goal-owner" } } });
  const command = { action: "set", messageId: "during", objective: "tools goal", expectedSegmentId: before.segmentId, tokenBudget: 40 };
  await other.updateGoal(command);
  const admitted = await other.read();
  assert.equal(admitted.conversationLog[0].metadata.runtime.nativeTurnId, before.conversationLog[0].metadata.runtime.nativeTurnId);
  assert.equal(admitted.conversationLog[0].metadata.applicationTools.at(-1).status, "running");
  assert.equal(admitted.conversationLog.length, 1);
  assert.equal(admitted.pendingRequest, null);
  complete.resolve({ value: 42 });
  const state = await other.wait();
  assert.equal(state.error, "");
  assert.equal(state.goal.status, "budgetLimited");
  assert.equal(state.conversationLog.filter(turn => turn.user || turn.system).length, 1);
  assert.equal(state.conversationLog[0].metadata.applicationTools.find(call => call.name === "assistant_action_execute").result.result.result.value, 42);
  assert.equal(state.conversationLog[0].metadata.runtime.goalMessageId, undefined);
  assert.equal(state.conversationLog[0].metadata.runtime.nativeTurnId, before.conversationLog[0].metadata.runtime.nativeTurnId);
  assert.equal(state.conversationLog[0].metadata.applicationTools.length, 12);
  assert.equal(calls, 4);
  assert.ok(authorized.includes("original"));
  assert.equal(authorized.every(actor => actor === "original"), true);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  assert.equal(trace.filter(row => row.method === "thread/goal/set").length, 1);
  assert.equal(trace.filter(row => row.args).length, 1);
  assert.equal(trace.some(row => row.method === "thread/inject_items"), false);
});

test("older uncertain Codex goal-message records remain inspection-only", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  const before = await f.conversation.wait();
  const command = { action: "set", expectedGoalId: null, expectedSegmentId: before.segmentId, objective: "Old goal" };
  await f.storage.write("conversation", async transaction => {
    const metadata = await transaction.readMetadata();
    const pending = { messageId: "old-goal", text: command.objective, origin: "user", attachments: [], goal: command,
      at: "2026-01-01T00:00:00.000Z", attempted: true, threadId: metadata.runtime.binding.threadId,
      message: "Old frozen native prompt", seen: metadata.runtime.seen };
    metadata.runtime.request = pending;
    metadata.runtime.binding.goalRequest = { messageId: pending.messageId, afterTurnId: "old-boundary", command };
    metadata.runtime.binding.goalReceipt = { messageId: pending.messageId, afterTurnId: "old-boundary" };
    await transaction.writeMetadata(metadata);
    const turnId = await transaction.nextTurnId();
    await transaction.appendMessage(turnId, { role: "user", ...pending,
      turnMetadata: { runtime: { engine: "codex", segmentId: before.segmentId, status: "interrupted" } } });
  });
  const snapshot = () => f.storage.read("conversation", async transaction => ({ metadata: await transaction.readMetadata(),
    turns: await Promise.all((await transaction.listTurnIds()).map(id => transaction.readTurn(id))) }));
  const saved = await snapshot();
  await assert.rejects(f.conversation.updateGoal(command), { code: "conversation_delivery_uncertain" });
  const inspected = await f.conversation.inspectDelivery({ messageId: "old-goal" });
  assert.equal(inspected.status, "accepted");
  assert.match(inspected.recoveryLimitation, /offline inspection/);
  assert.deepEqual(await snapshot(), saved);
  await f.storage.write("conversation", async transaction => {
    const metadata = await transaction.readMetadata();
    delete metadata.runtime.request;
    await transaction.writeMetadata(metadata);
  });
  const bindingOnly = await snapshot();
  await assert.rejects(f.conversation.updateGoal(command), { code: "conversation_delivery_uncertain" });
  assert.deepEqual(await snapshot(), bindingOnly);
  assert.equal((await f.trace()).filter(row => row.method === "thread/goal/set").length, 0);
});

test("Cancel stops observed Codex work without implicitly pausing its standalone goal", async t => {
  const f = await fixture(t);
  const { segmentId } = await f.conversation.read();
  const goal = await f.conversation.updateGoal({ action: "set", objective: "wait goal", expectedSegmentId: segmentId });
  assert.equal((await f.conversation.read()).status, "working");
  assert.deepEqual(await f.conversation.cancel(), { stopped: true });
  assert.equal((await f.conversation.read()).status, "ready");
  assert.equal((await f.conversation.readGoal()).status, "active");
  assert.equal((await f.conversation.read()).conversationLog.some(turn => turn.user || turn.system), false);
  assert.deepEqual((await f.trace()).filter(row => row.method === "thread/goal/set").map(row => row.params.status), ["active"]);
  await f.conversation.updateGoal({ action: "pause", expectedGoalId: goal.id, expectedSegmentId: segmentId });
  assert.equal((await f.conversation.readGoal()).status, "paused");
  assert.deepEqual(await f.conversation.cancel(), { stopped: false });
});

test("explicit Codex steering joins the original active goal without inventing a starting run", async t => {
  const f = await fixture(t);
  const { segmentId } = await f.conversation.read();
  const goal = await f.conversation.updateGoal({ action: "set", objective: "wait goal", expectedSegmentId: segmentId });
  const original = await f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime.binding.codexAppServerRun);
  assert.equal(original.active, true);
  const receipt = await f.conversation.send({ messageId: "steer-control", text: "Finish this part", steer: true });
  assert.equal(receipt.status, "accepted");
  await f.conversation.updateGoal({ action: "pause", expectedGoalId: goal.id, expectedSegmentId: segmentId });
  const completed = await f.conversation.wait();
  assert.equal(completed.error, "");
  const authored = completed.conversationLog.filter(turn => turn.user || turn.system);
  assert.equal(authored.length, 1);
  assert.equal(authored[0].user.messageId, "steer-control");
  assert.equal(authored[0].metadata.runtime.nativeTurnId, original.providerTurnId);
  assert.equal(authored[0].assistant.text, "Steered: Finish this part");
  const stored = await f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime.binding.codexAppServerRun);
  assert.equal(stored.outerTurnId, original.outerTurnId);
  assert.equal(stored.events.some(event => event.kind === "codex-app-server-turn-claimed"), false);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/start").length, 0);
  assert.deepEqual(trace.filter(row => row.method === "turn/steer").map(row => ({
    threadId: row.params.threadId, turnId: row.params.expectedTurnId, messageId: row.params.clientUserMessageId
  })), [{ threadId: original.providerThreadId, turnId: original.providerTurnId, messageId: "steer-control" }]);
});

test("a rejected goal leaves ordinary Codex work running and steerable", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "ordinary", text: "steering" });
  const { segmentId } = await f.conversation.read();
  await assert.rejects(f.conversation.updateGoal({ action: "set", messageId: "rejected-goal", objective: "rejected goal",
    expectedSegmentId: segmentId }), /Goal rejected/);
  const pending = await f.conversation.read();
  assert.equal(pending.pendingRequest, null);
  assert.equal(pending.conversationLog.length, 1);
  await f.conversation.send({ messageId: "finish", text: "Finish now", steer: true });
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.equal(state.conversationLog.at(-1).assistant.text, "Steered: Finish now");
  assert.equal((await f.trace()).filter(row => row.args).length, 1);
});

test("a native create_goal retains its authored owner and recovers only the exact tracked result", async t => {
  const f = await fixture(t, { checkpoints: true });
  await f.conversation.send({ messageId: "native", text: "native-goal" });
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.equal(state.goal.status, "complete");
  assert.deepEqual(state.conversationLog.filter(turn => turn.user || turn.system).map(turn => turn.user.messageId), ["native"]);
  assert.equal(state.conversationLog.some(turn => turn.system?.text === "Continue working on the goal."), false);
  const native = JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8"));
  const lastTurnId = native.turns.at(-1).id;
  const checkpoint = f.checkpoints.find(record => record.metadata.runtime.binding.codexAppServerRun?.providerTurnId === lastTurnId &&
    record.metadata.runtime.binding.codexAppServerRun.active &&
    !record.turns.some(([, turn]) => turn.messages.some(message => message.role === "assistant" && message.text === "Goal reply 3")));
  assert.ok(checkpoint, "The original owner must persist successor ownership before its output.");
  assert.equal(checkpoint.metadata.runtime.binding.codexAppServerRun.outerTurnId, "native");
  const savedReplies = checkpoint.turns.flatMap(([, turn]) => turn.messages.filter(message => message.role === "assistant"));
  await f.restore(checkpoint);
  const reopened = await f.runtime().open({ id: "conversation" });
  const receipt = await reopened.inspectDelivery({ messageId: "native" });
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.recoveryLimitation, undefined);
  const recovered = await reopened.read();
  const replies = recovered.conversationLog.flatMap(turn => turn.messages.filter(message => message.role === "assistant"));
  for (const saved of savedReplies) assert.deepEqual(replies.find(message => message.messageId === saved.messageId), saved);
  assert.equal(replies.filter(message => message.text === "Goal reply 3").length, 1);
  assert.deepEqual(recovered.conversationLog.filter(turn => turn.user || turn.system).map(turn => turn.user.messageId), ["native"]);
  await reopened.inspectDelivery({ messageId: "native" });
  assert.deepEqual((await reopened.read()).conversationLog, recovered.conversationLog);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
  assert.equal((await f.trace()).some(row => row.method === "thread/goal/set"), false);
});

test("Codex goal pause, process restart, resume and clear retain the same goal identity", async t => {
  const f = await fixture(t);
  const { segmentId } = await f.conversation.read();
  await f.conversation.updateGoal({ action: "set", messageId: "start", objective: "wait goal", expectedSegmentId: segmentId });
  const goal = await f.conversation.readGoal();
  assert.equal(goal.status, "active");
  await f.conversation.updateGoal({ action: "pause", expectedGoalId: goal.id, expectedSegmentId: segmentId });
  assert.equal((await f.conversation.readGoal()).status, "paused");
  await f.first.close();
  const reopened = await f.runtime().open({ id: "conversation" });
  assert.equal((await reopened.readGoal()).id, goal.id);
  await reopened.updateGoal({ action: "resume", messageId: "resume", expectedGoalId: goal.id, expectedSegmentId: segmentId });
  assert.equal((await reopened.readGoal()).status, "active");
  assert.equal(await reopened.updateGoal({ action: "cancel", expectedGoalId: goal.id, expectedSegmentId: segmentId }), null);
  assert.equal(await reopened.readGoal(), null);
  await reopened.cancel();
  assert.equal((await reopened.wait()).status, "ready");
});

test("reading a Codex goal started by another native client does not pause it", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  assert.equal((await f.conversation.wait()).status, "ready");
  const { args } = (await f.trace()).find(row => row.args);
  const external = new CodexAppServerJsonRpcClient({ endpoint: args[args.indexOf("--listen") + 1] });
  await external.connect();
  try {
    await external.initialize();
    const { id: threadId } = JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8"));
    const { goal } = await external.request("thread/goal/set", { threadId, objective: "wait goal", status: "active" });
    for (let index = 0; index < 2; index++) {
      const observed = await f.conversation.readGoal();
      assert.equal(observed.status, "active");
      assert.equal(observed.objective, goal.objective);
    }
    assert.equal((await external.request("thread/goal/get", { threadId })).goal.status, "active");
    assert.equal((await f.trace()).filter(row => row.method === "thread/goal/set").length, 1);
  } finally { external.close(); }
});

test("goal commands reject stale identity, invalid budgets and unauthorized callers", async t => {
  const f = await fixture(t);
  const { segmentId } = await f.conversation.read();
  const command = { action: "set", objective: "Finish the goal", expectedSegmentId: segmentId };
  await assert.rejects(f.conversation.updateGoal({ ...command, tokenBudget: 0 }), /positive token budget/);
  await assert.rejects(f.conversation.updateGoal({ ...command, expectedSegmentId: "old" }), /conversation changed/);
  await f.conversation.updateGoal(command);
  await f.conversation.wait();
  await assert.rejects(f.conversation.updateGoal(command), /native goal changed/);
  await assert.rejects(f.conversation.updateGoal({ action: "cancel", expectedSegmentId: segmentId, expectedGoalId: "stale" }), /native goal changed/);
  const denied = await fixture(t, { authorize: ({ operation }) => operation !== "goal" });
  await assert.rejects(denied.conversation.updateGoal({ ...command, expectedSegmentId: (await denied.conversation.read()).segmentId }), { statusCode: 403 });
});

test("accepted Codex output is recovered after a restart without resending the request", async t => {
  const f = await fixture(t, { checkpoints: true });
  await f.conversation.send({ ...input, text: "blocks-without-phase" });
  const finished = await f.conversation.wait();
  const checkpoint = f.checkpoints.find(record => record.turns[0]?.[1].metadata?.runtime?.nativeTurnId &&
    record.turns[0][1].metadata.runtime.status === "running" &&
    record.turns[0][1].messages.some(message => message.role === "commentary" && message.text === "Checking the numbers.") &&
    !record.turns[0][1].messages.some(message => message.role === "assistant"));
  assert.ok(checkpoint);
  await f.restore(checkpoint);
  const reopened = await f.runtime().open({ id: "conversation" });
  const receipt = await reopened.inspectDelivery({ messageId: input.messageId });
  assert.equal(receipt.duplicate, true);
  assert.equal(receipt.recovered, true);
  const state = await reopened.read();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete");
  assert.equal(state.conversationLog[0].assistant.text, finished.conversationLog[0].assistant.text);
  assert.equal(state.conversationLog[0].commentary[0].text, "Checking the numbers.");
  await reopened.inspectDelivery({ messageId: input.messageId });
  assert.deepEqual((await reopened.read()).conversationLog, state.conversationLog);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
});

test("a native completed goal cannot certify an application tool with an unknown outcome", async t => {
  let calls = 0;
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  const f = await fixture(t, { actions: applicationActions(async () => ({ value: ++calls })), context, checkpoints: true,
    nativeGoalObjective: "tools goal", limits: { maxToolCalls: 9 } });
  await f.conversation.send({ messageId: "uncertain-effect", text: "native-goal" });
  assert.equal((await f.conversation.wait()).goal.status, "complete");
  const checkpoint = f.checkpoints.find(record => record.turns.some(([, turn]) =>
    turn.messages.some(message => message.role === "user" && message.messageId === "uncertain-effect") &&
    turn.metadata?.applicationTools?.length === 3 && turn.metadata.applicationTools[2].status === "running"));
  assert.ok(checkpoint, "The authored effect reservation must be durable before its result.");
  const [turnId, reserved] = checkpoint.turns.find(([, turn]) =>
    turn.messages.some(message => message.role === "user" && message.messageId === "uncertain-effect"));
  assert.equal(checkpoint.metadata.runtime.binding.codexAppServerRun.outerTurnId, "uncertain-effect");
  await f.restore(checkpoint);
  const reopened = await f.runtime().open({ id: "conversation", context });
  const receipt = await reopened.inspectDelivery({ messageId: "uncertain-effect" });
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.turnId, turnId);
  const state = await reopened.read();
  const authored = state.conversationLog.filter(turn => turn.user || turn.system);
  assert.equal(authored.length, 1);
  assert.equal(authored[0].user.messageId, "uncertain-effect");
  assert.equal(authored[0].metadata.runtime.status, "interrupted");
  assert.match(authored[0].metadata.runtime.error, /tool has no verified result/);
  assert.match(state.error, /tool has no verified result/);
  assert.deepEqual(authored[0].metadata.applicationTools, reserved.metadata.applicationTools);
  await reopened.inspectDelivery({ messageId: "uncertain-effect" });
  assert.deepEqual((await reopened.read()).conversationLog, state.conversationLog);
  assert.equal(calls, 3);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  assert.equal(trace.filter(row => row.toolResponse).length, 9);
  assert.equal(trace.some(row => row.method === "thread/inject_items" || row.method === "thread/goal/set"), false);
});

test("native history cannot overwrite cancelled work or turn a failed answer into success", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "cancelled", text: "steering" });
  await f.conversation.cancel();
  await f.conversation.inspectDelivery({ messageId: "cancelled" });
  assert.equal((await f.conversation.read()).conversationLog[0].metadata.runtime.status, "cancelled");
  await f.conversation.send({ messageId: "failed", text: "failed" });
  await f.conversation.wait();
  await f.conversation.inspectDelivery({ messageId: "failed" });
  assert.equal((await f.conversation.read()).conversationLog[1].metadata.runtime.status, "failed");
});

test("automatic goal turns retain all nine application tool receipts on their authored request", async t => {
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  let calls = 0;
  const actions = applicationActions(async () => ({ value: ++calls }));
  const f = await fixture(t, { actions, context, nativeGoalObjective: "tools goal", limits: { maxToolCalls: 9 } });
  await f.conversation.send({ messageId: "tools-goal", text: "native-goal" });
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.equal(calls, 3);
  const authored = state.conversationLog.filter(turn => turn.user || turn.system);
  assert.equal(authored.length, 1);
  assert.equal(authored[0].user.messageId, "tools-goal");
  assert.equal(authored[0].metadata.applicationTools.length, 9);
  assert.equal(new Set(authored[0].metadata.applicationTools.map(call => call.id)).size, 9);
  assert.ok(authored[0].metadata.applicationTools.every(call => call.status === "complete"));
  assert.deepEqual(authored[0].metadata.applicationTools.filter(call => call.name === "assistant_action_execute")
    .map(call => call.result.result.result.value), [1, 2, 3]);
  for (const turn of state.conversationLog) {
    assert.equal(turn.metadata.runtime.status, "complete");
    if (turn !== authored[0]) assert.equal(turn.metadata.applicationTools, undefined);
  }
  const replies = state.conversationLog.flatMap(turn => turn.messages.filter(message => message.role === "assistant"));
  for (const text of ["Goal reply 1", "Goal reply 2", "Goal reply 3"]) {
    assert.equal(replies.filter(message => message.text === text).length, 1);
  }
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  assert.equal(trace.filter(row => row.toolResponse).length, 9);
  assert.equal(trace.some(row => row.method === "thread/inject_items" || row.method === "thread/goal/set"), false);
});

for (const deferBudgetCompletion of [false, true]) test(deferBudgetCompletion
  ? "automatic goal tool failure verifies recovery when native completion follows the saved terminal"
  : "automatic goal turns cannot reset their authored request's application tool budget", async t => {
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  let calls = 0;
  const f = await fixture(t, { actions: applicationActions(async () => ({ value: ++calls })), context,
    nativeGoalObjective: "tools goal", limits: { maxToolCalls: 3 }, deferBudgetCompletion });
  await f.conversation.send({ messageId: "bounded-goal", text: "native-goal" });
  const state = await f.conversation.wait();
  const trace = await f.trace();
  const responses = trace.filter(row => row.toolResponse);
  assert.equal(responses.length, 4);
  assert.match(responses.at(-1).toolResponse.error.message, /application tool-call limit/);
  assert.equal(state.status, "ready");
  assert.match(state.error, /application tool-call limit/);
  assert.equal(calls, 1);
  const authored = state.conversationLog.filter(turn => turn.user || turn.system);
  assert.equal(authored.length, 1);
  assert.equal(authored[0].user.messageId, "bounded-goal");
  assert.equal(authored[0].metadata.runtime.status, "failed");
  assert.equal(authored[0].metadata.applicationTools.length, 3);
  assert.ok(authored[0].metadata.applicationTools.every(call => call.status === "complete"));
  assert.equal(authored[0].metadata.applicationTools.at(-1).result.result.result.value, 1);
  assert.equal(state.conversationLog.some(turn => turn.messages.some(message => message.role === "assistant" && message.text === "Goal reply 2")), false);
  const stopped = await f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime.binding);
  assert.equal(stopped.observationLoss.stopped, true);
  assert.equal(stopped.observationLoss.message, "Codex observation failed. Work must be stopped before it can continue.");
  assert.equal(stopped.codexAppServerRun.state, "interrupted");
  assert.equal(stopped.codexAppServerRun.active, false);
  assert.equal(stopped.codexAppServerRun.providerStatus, "observation_lost");
  assert.equal(stopped.codexAppServerRun.outerTurnId, "bounded-goal");
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  if (deferBudgetCompletion) {
    const fourth = trace.find(row => row.budgetCompletion?.kind === "fourth-request").budgetCompletion;
    assert.equal(fourth.threadId, stopped.threadId);
    assert.equal(fourth.turnId, stopped.codexAppServerRun.providerTurnId);
    assert.equal(fourth.callId, fourth.turnId + "-4");
    assert.equal(trace.find(row => row.budgetCompletion?.kind === "fourth-response").budgetCompletion.budgetFailure, true);
    for (const kind of ["failed-held", "interrupted-held"]) {
      assert.ok(trace.some(row => row.budgetCompletion?.kind === kind &&
        row.budgetCompletion.threadId === fourth.threadId && row.budgetCompletion.turnId === fourth.turnId));
    }
    const release = JSON.parse(await readFile(path.join(f.directory, "history.json") + ".budget-terminal-" + fourth.turnId, "utf8"));
    assert.deepEqual(release, { threadId: fourth.threadId, turnId: fourth.turnId, outerTurnId: "bounded-goal" });
    const native = JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8"));
    assert.equal(native.id, fourth.threadId);
    assert.equal(native.goal.status, "paused");
  }
});

test("failed tracked Codex history storage stops owned work and recovers the exact result without replay", async t => {
  let rejectHistory = false;
  const f = await fixture(t, { checkpoints: true, storage: disk => ({ read: disk.read,
    write: (scope, callback) => disk.write(scope, async transaction => {
      const result = await callback(transaction);
      if (rejectHistory) for (const id of await transaction.listTurnIds()) {
        const turn = await transaction.readTurn(id);
        if (turn.messages.some(message => message.role === "assistant" && message.text === "Goal reply 3")) {
          throw new Error("Goal storage failed");
        }
      }
      return result;
    })
  }) });
  await f.conversation.send({ messageId: "storage-goal", text: "native-goal" });
  assert.equal((await f.conversation.wait()).error, "");
  const native = JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8"));
  const nativeTurnId = native.turns.at(-1).id;
  const checkpoint = f.checkpoints.find(record => record.metadata.runtime.binding.codexAppServerRun?.providerTurnId === nativeTurnId &&
    record.metadata.runtime.binding.codexAppServerRun.active &&
    !record.turns.some(([, turn]) => turn.messages.some(message => message.role === "assistant" && message.text === "Goal reply 3")));
  assert.ok(checkpoint, "The original run must own the exact missing result before startup recovery.");
  const previousReplies = checkpoint.turns.flatMap(([, turn]) => turn.messages.filter(message => message.role === "assistant"));
  await f.restore(checkpoint);
  const recoveryTraceStart = (await f.trace()).length;
  const reopened = await f.runtime().open({ id: "conversation" });
  rejectHistory = true;
  try {
    await assert.rejects(reopened.inspectDelivery({ messageId: "storage-goal" }), /Goal storage failed/);
    let stopped;
    for (let attempt = 0; attempt < 500; attempt++) {
      stopped = await f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime.binding);
      if (stopped.observationLoss?.stopped && stopped.codexAppServerRun.providerStatus === "observation_lost" &&
          !stopped.codexAppServerRun.active) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(stopped.observationLoss, "The original inspected-turn failure must retain its observation barrier.");
    assert.equal(stopped.observationLoss.stopped, true);
    assert.equal(stopped.codexAppServerRun.active, false);
    assert.equal(stopped.codexAppServerRun.providerStatus, "observation_lost");
    assert.equal(stopped.codexAppServerRun.providerThreadId, native.id);
    assert.equal(stopped.codexAppServerRun.providerTurnId, nativeTurnId);
    assert.equal(stopped.codexAppServerRun.outerTurnId, "storage-goal");
    const failed = await reopened.read();
    assert.deepEqual(failed.conversationLog.flatMap(turn => turn.messages.filter(message => message.role === "assistant")), previousReplies);
    assert.equal(failed.conversationLog.filter(turn => turn.user || turn.system).length, 1);
  } finally { rejectHistory = false; }
  const receipt = await reopened.inspectDelivery({ messageId: "storage-goal" });
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.recovered, true);
  const recovered = await reopened.read();
  const replies = recovered.conversationLog.flatMap(turn => turn.messages.filter(message => message.role === "assistant"));
  for (const previous of previousReplies) assert.deepEqual(replies.find(message => message.messageId === previous.messageId), previous);
  assert.equal(replies.filter(message => message.text === "Goal reply 3").length, 1);
  assert.equal(recovered.conversationLog[0].user.messageId, "storage-goal");
  assert.equal(recovered.conversationLog[0].metadata.runtime.status, "interrupted");
  await reopened.inspectDelivery({ messageId: "storage-goal" });
  assert.deepEqual((await reopened.read()).conversationLog, recovered.conversationLog);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  assert.equal(trace.slice(recoveryTraceStart).some(row => row.method === "thread/resume" || row.method === "turn/start"), false);
});

test("goal continuations stop when authorization changes at the next native turn", async t => {
  let allowed = true;
  let calls = 0;
  let firstToolTurnId;
  const denied = [];
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  const f = await fixture(t, { actions: applicationActions(async () => ({ value: ++calls })), context,
    nativeGoalObjective: "tools goal", limits: { maxToolCalls: 9 },
    authorize: input => {
      if (input.operation !== "send" || allowed) return true;
      denied.push({ operation: input.operation, actorId: input.context.actor.id, conversationId: input.conversationId });
      return false;
    },
    storage: disk => ({ read: disk.read, write: (scope, callback) => disk.write(scope, async transaction => {
      const result = await callback(transaction);
      const run = (await transaction.readMetadata()).runtime.binding.codexAppServerRun;
      if (!firstToolTurnId) for (const id of await transaction.listTurnIds()) {
        const calls = (await transaction.readTurn(id)).metadata?.applicationTools;
        if (calls?.length === 3 && calls.every(call => call.status === "complete")) {
          firstToolTurnId = run.providerTurnId;
          assert.ok(calls.every(call => call.id.startsWith(`${firstToolTurnId}-`)));
        }
      }
      // The saved first effect precedes its native response. Revoke when the
      // original owner adopts that exact turn's successor, before publication.
      if (firstToolTurnId && run.events.some(event => event.kind === "codex-app-server-turn-continued" &&
          event.previousProviderTurnId === firstToolTurnId)) allowed = false;
      return result;
    }) }) });
  await f.conversation.send({ messageId: "revoked-goal", text: "native-goal" });
  const state = await f.conversation.wait();
  assert.ok(denied.length, "The next native turn must recheck its admitted actor.");
  for (const request of denied) assert.deepEqual(request, { operation: "send", actorId: "owner", conversationId: "conversation" });
  const authored = state.conversationLog.filter(turn => turn.user || turn.system);
  assert.equal(authored.length, 1);
  assert.equal(authored[0].user.messageId, "revoked-goal");
  assert.equal(authored[0].metadata.applicationTools.length, 3);
  assert.ok(authored[0].metadata.applicationTools.every(call => call.status === "complete"));
  assert.equal(authored[0].metadata.applicationTools.at(-1).result.result.result.value, 1);
  assert.equal(calls, 1);
  const replies = state.conversationLog.flatMap(turn => turn.messages.filter(message => message.role === "assistant"));
  assert.equal(replies.filter(message => message.text === "Goal reply 1").length, 1);
  assert.equal(replies.some(message => message.text === "Goal reply 2"), false);
  assert.match(state.error, /not available to this identity/);
  const trace = await f.trace();
  const responses = trace.filter(row => row.toolResponse);
  assert.equal(responses.length, 4);
  assert.match(responses.at(-1).toolResponse.error.message, /not available to this identity/);
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  assert.equal(trace.some(row => row.method === "thread/inject_items"), false);
  const stopped = await f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime.binding);
  assert.deepEqual(trace.filter(row => row.method === "thread/goal/set").map(row => row.params), [
    { threadId: stopped.threadId, status: "paused" }
  ]);
  assert.equal(stopped.observationLoss.stopped, true);
  assert.equal(stopped.codexAppServerRun.active, false);
  assert.equal(stopped.codexAppServerRun.providerStatus, "observation_lost");
  assert.equal(stopped.codexAppServerRun.outerTurnId, "revoked-goal");
});

test("a paused goal stays with its native conversation when another engine is selected", async t => {
  const f = await fixture(t, apiOptions());
  const { segmentId } = await f.conversation.read();
  await f.conversation.updateGoal({ action: "set", messageId: "retained-goal", objective: "wait goal", expectedSegmentId: segmentId });
  const goal = await f.conversation.readGoal();
  await f.conversation.updateGoal({ action: "pause", expectedGoalId: goal.id, expectedSegmentId: segmentId });
  assert.equal((await f.conversation.read()).status, "working");
  assert.equal((await f.trace()).some(row => row.method === "turn/interrupt"), false);
  await f.conversation.cancel();
  await select(f.conversation, "api", "to-api");
  assert.equal((await f.conversation.read()).goal, null);
  assert.equal(await f.conversation.readGoal(), null);
  await select(f.conversation, "codex", "back-to-codex");
  assert.equal((await f.conversation.readGoal()).id, goal.id);
  assert.equal((await f.conversation.readGoal()).status, "paused");
});

test("the host can grant and revoke native Codex coding tools without enabling ambient integrations", async t => {
  const f = await fixture(t, { nativeTools: true });
  assert.equal(f.conversation.capabilities.nativeTools, true);
  await f.conversation.send(input);
  await f.conversation.wait();
  const params = (await f.trace()).find(row => row.method === "thread/start").params;
  assert.equal(params.sandbox, "danger-full-access");
  assert.equal(params.config.features.unified_exec, true);
  assert.equal(params.config.features.shell_tool, true);
  assert.equal(params.config.features.hooks, false);
  assert.equal(params.config.features.plugins, false);
  assert.equal(params.environments, undefined);
  assert.equal(params.runtimeWorkspaceRoots, undefined);
  assert.equal(params.selectedCapabilityRoots, undefined);
  assert.equal(params.config.shell_environment_policy.set.TEST_ACCOUNT, f.account);
  await f.first.close();
  const revoked = await f.runtime({ nativeTools: false }).open({ id: "conversation", configuration });
  await revoked.send({ messageId: "second", text: "No tools now" });
  await revoked.wait();
  const resumed = (await f.trace()).find(row => row.method === "thread/resume").params;
  assert.equal(resumed.sandbox, "read-only");
  assert.equal(resumed.config.features.shell_tool, false);
  assert.deepEqual(resumed.environments, []);
  assert.deepEqual(Object.keys(resumed.config.shell_environment_policy.set).sort(), ["JSKIT_CONVERSATION_INSTRUCTIONS", "PATH"]);
});

test("Codex enables only the host command hook and disables ambient hooks", async t => {
  const f = await fixture(t, { nativeTools: true, commandWrapper: "/host/command wrapper" });
  await f.conversation.send(input);
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
  const params = (await f.trace()).find(row => row.method === "thread/start").params;
  assert.equal(params.config.features.hooks, true);
  assert.deepEqual(params.config.hooks.state, { ambient: { enabled: false }, command: { enabled: true, trusted_hash: "sha256:owned" } });
  const trace = await f.trace();
  assert.equal(trace.some(row => row.method === "config/batchWrite"), false);
  assert.equal(trace.filter(row => row.args).length, 1);
  assert.match(params.config.hooks.PreToolUse[0].hooks[0].command, /commandHook.js/);
});

test("Codex refuses dispatch when its required command hook is missing", async t => {
  const f = await fixture(t, { nativeTools: true, commandWrapper: "/host/wrapper", missingCommandHook: true });
  await assert.rejects(f.conversation.send(input), /required command wrapper/);
  assert.equal((await f.trace()).some(row => row.method === "thread/start"), false);
});

test("Codex receives authorized image content and retains receipts through uncertain admission", async t => {
  const image = Buffer.from("authorized-image");
  const receipt = { attachmentId: "picture", fileName: "picture.png", size: image.length };
  let reads = 0;
  const f = await fixture(t, { attachments: { resolve: async () => {
    reads++;
    return { attachments: [receipt], content: [{ type: "image", image, mediaType: "image/png" }] };
  } } });
  await f.conversation.send({ ...input, attachmentIds: [receipt.attachmentId] });
  const first = await f.conversation.wait();
  assert.equal(first.conversationLog[0].metadata.runtime.status, "complete", first.error);
  assert.deepEqual((await f.trace()).find(row => row.method === "turn/start").params.input, [
    { type: "text", text: input.text, text_elements: [] }, { type: "image", url: `data:image/png;base64,${image.toString("base64")}` }
  ]);
  const missing = { messageId: "lost-image", text: "lost", attachmentIds: [receipt.attachmentId] };
  await assert.rejects(f.conversation.send(missing));
  const uncertain = await f.conversation.read();
  assert.deepEqual(uncertain.pendingRequest.attachments, [receipt]);
  assert.doesNotMatch(JSON.stringify(uncertain), /YXV0aG9yaXplZC1pbWFnZQ==/);
  assert.equal((await f.conversation.inspectDelivery({ messageId: missing.messageId })).status, "accepted");
  assert.deepEqual((await f.conversation.read()).conversationLog.at(-1).user.attachments, [receipt]);
  assert.equal(reads, 2);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 2);
});

function apiOptions() {
  return { connections: createAiConnectionResolver({ configuration: { schemaVersion: 1, registrations: {}, integrations: {
    assistant: { provider: "ai", accountMode: "shared", scopes: [], authentication: { method: "none" }, settings: { model: "opencode/big-pickle" } }
  } }, authorize: () => ({ applicationId: "test", subjectId: "owner" }) }), fetch: async () => {
    const chunk = { choices: [{ index: 0, delta: { content: "API answer" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  } };
}

async function settledNativeGoal(f) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const state = await f.conversation.read();
    if (state.goal && state.goal.status !== "active" && state.status !== "working") {
      // Original goal publication precedes durable run reconciliation. Wait for
      // both owners before asserting their settled state; neither can be skipped.
      const run = await f.storage.read("conversation", async transaction =>
        (await transaction.readMetadata()).runtime.binding.codexAppServerRun);
      if (run?.providerGoalStatus === state.goal.status) return state;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("The original native goal owner did not publish its settled state.");
}

async function select(conversation, engine, operationId) {
  return conversation.select({ operationId, expectedSegmentId: (await conversation.read()).segmentId,
    engine, configuration: engine === "codex" ? configuration : { systemPrompt: "Continue this conversation.", integrationId: "assistant" } });
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-codex-conversation-"));
  const command = path.join(directory, "codex.mjs");
  const account = path.join(directory, "account.txt");
  const trace = path.join(directory, "trace.jsonl");
  await writeFile(account, "owner@example.test");
  await writeFile(command, `#!${process.execPath}
    import { createServer } from "node:http";
    import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
    import { randomUUID } from "node:crypto";
    import { execFileSync } from "node:child_process";
    import { WebSocketServer } from ${JSON.stringify(import.meta.resolve("ws"))};
    const args = process.argv.slice(2);
    const structuredResponse = ${JSON.stringify(options.structuredResponse || null)};
    if (args.includes("debug") && args.includes("models")) {
      process.stdout.write(JSON.stringify({ models: [{ slug: "test-model", priority: 0 }] }));
      process.exit(0);
    }
    const socket = args[args.indexOf("--listen") + 1].slice(7);
    const log = value => appendFileSync(process.env.TEST_TRACE, JSON.stringify(value) + "\\n");
    log({ args });
    const file = process.env.TEST_HISTORY;
    const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    const threads = new Map((saved?.threads || (saved ? [saved] : []))
      .map(thread => [thread.id, { thread, loaded: false, runningTurn: null }]));
    const save = () => {
      const histories = [...threads.values()].map(state => state.thread);
      writeFileSync(file, JSON.stringify(histories.length === 1 ? histories[0] : { threads: histories }));
    };
    const server = createServer();
    const wss = new WebSocketServer({ server });
    const toolRequests = new Map();
    let requestId = 0;
    wss.on("connection", ws => ws.on("message", async data => {
      const { id, method, params = {}, result, error } = JSON.parse(data);
      if (!method) {
        log({ toolResponse: { id, result, error } });
        const pending = toolRequests.get(id); toolRequests.delete(id);
        if (${Boolean(options.deferBudgetCompletion)} && id === "tool-request-4") {
          log({ budgetCompletion: { kind: "fourth-response", requestId: id,
            budgetFailure: !!error && /application tool-call limit/.test(error.message) } });
        }
        if (error) pending.reject(new Error(error.message)); else pending.resolve(result);
        return;
      }
      const state = threads.get(params.threadId) || { thread: null, loaded: false, runningTurn: null };
      let thread = state.thread;
      log({ method, params });
      const reply = result => ws.send(JSON.stringify({ id, result }));
      if (["thread/read", "thread/turns/list"].includes(method) && existsSync(file + ".unavailable")) {
        ws.send(JSON.stringify({ id, error: { code: -32000, message: "Native history is temporarily unavailable" } }));
        return;
      }
      const emit = (method, params) => ws.send(JSON.stringify({ method, params: { threadId: thread.id, ...params } }));
      const callTool = (turn, tool, arguments_, foreign = false) => new Promise((resolve, reject) => {
        const id = "tool-request-" + (++requestId);
        toolRequests.set(id, { resolve, reject });
        if (${Boolean(options.deferBudgetCompletion)} && requestId === 4) {
          state.budgetFailureTurnId = turn.id;
          log({ budgetCompletion: { kind: "fourth-request", threadId: thread.id, turnId: turn.id, callId: turn.id + "-" + requestId } });
        }
        ws.send(JSON.stringify({ id, method: "item/tool/call", params: {
          threadId: foreign ? "another-thread" : thread.id, turnId: turn.id,
          callId: turn.id + "-" + requestId, tool, arguments: arguments_
        } }));
      });
      async function goalTurns() {
        if (!thread.goalsEnabled) return;
        const previous = state.runningTurn;
        while (previous?.status === "inProgress" && ws.readyState === 1) await new Promise(resolve => setTimeout(resolve, 5));
        for (let index = 0; index < 3; index++) {
          if (ws.readyState !== 1 || thread.goal?.status !== "active") return;
          const turn = { id: randomUUID(), status: "inProgress", items: [] };
          state.runningTurn = turn;
          thread.turns.push(turn); save(); emit("turn/started", { turn });
          if (thread.goal.objective === "tools goal") {
            try {
              await callTool(turn, "assistant_action_search", { query: "numbers" });
              await callTool(turn, "assistant_action_contract", { actionId: "numbers.read", version: 1 });
              await callTool(turn, "assistant_action_execute", { actionId: "numbers.read", version: 1, input: {} });
            } catch (error) {
              turn.status = "failed"; save();
              const failedTurn = { ...turn, error: { message: error.message } };
              if (${Boolean(options.deferBudgetCompletion)} && state.budgetFailureTurnId === turn.id && /application tool-call limit/.test(error.message)) {
                log({ budgetCompletion: { kind: "failed-held", threadId: thread.id, turnId: turn.id } });
                while (!existsSync(file + ".budget-terminal-" + turn.id) && ws.readyState === 1) await new Promise(resolve => setTimeout(resolve, 5));
                log({ budgetCompletion: { kind: "failed-released", threadId: thread.id, turnId: turn.id } });
              }
              if (ws.readyState === 1) emit("turn/completed", { turnId: turn.id, turn: failedTurn });
              return;
            }
          }
          const item = { id: randomUUID(), type: "agentMessage", phase: "final_answer", text: "Goal reply " + (index + 1) };
          turn.items.push(item); save();
          emit("item/started", { turnId: turn.id, item });
          emit("item/completed", { turnId: turn.id, item });
          if (thread.goal.objective === "wait goal") return;
          thread.goal.tokensUsed += 15;
          if (index === 2) thread.goal.status = thread.goal.tokenBudget ? "budgetLimited" : "complete";
          save(); emit("thread/goal/updated", { turnId: turn.id, goal: thread.goal });
          turn.status = "completed"; save(); emit("turn/completed", { turn });
        }
      }
      if (method === "initialize") {
        while (process.env.TEST_STARTUP_WAIT && !existsSync(process.env.TEST_STARTUP_WAIT) && ws.readyState === 1) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        if (ws.readyState === 1) reply({});
        return;
      }
      if (method === "initialized") return;
      if (method === "account/read") return reply({ account: { type: "chatgpt", email: readFileSync(process.env.TEST_ACCOUNT, "utf8") } });
      if (method === "config/read") return reply({ config: { mcp_servers: { ambient: {} } } });
      if (method === "hooks/list") {
        const flag = args.find(arg => arg.startsWith("hooks.PreToolUse="));
        const trusted = args.some(arg => arg.startsWith("hooks.state="));
        const hooks = [{ key: "ambient", source: "project", enabled: !trusted }];
        if (flag && !${Boolean(options.missingCommandHook)}) hooks.push({ key: "command", source: "sessionFlags",
          eventName: "preToolUse", handlerType: "command", currentHash: "sha256:owned", enabled: true,
          trustStatus: trusted ? "trusted" : "untrusted", command: JSON.parse(flag.match(/command=(.*),timeout=30/u)[1]) });
        return reply({ data: [{ cwd: params.cwds[0], hooks, errors: [] }] });
      }
      if (method === "thread/start") {
        thread = { id: randomUUID(), historyMode: "paginated", modelProvider: params.modelProvider,
          environment: params.config.shell_environment_policy.set,
          goalsEnabled: params.config.features.goals, turns: [] };
        state.thread = thread; state.loaded = true; threads.set(thread.id, state); save();
        return reply({ thread, modelProvider: thread.modelProvider });
      }
      if (method === "thread/read") return reply({ thread: { ...thread,
        status: { type: !state.loaded ? "notLoaded" : state.runningTurn?.status === "inProgress" ? "active" : "idle" } } });
      if (method === "thread/turns/list") return reply({ data: [...thread.turns].reverse(), nextCursor: null });
      if (method === "thread/resume") { state.loaded = true; thread.modelProvider = params.modelProvider;
        thread.environment = params.config.shell_environment_policy.set;
        thread.goalsEnabled = params.config.features.goals; save(); return reply({ thread, modelProvider: thread.modelProvider }); }
      if (method === "thread/shellCommand") {
        const turn = { id: randomUUID(), status: "completed", items: [] };
        const item = { id: randomUUID(), type: "commandExecution", command: params.command, exitCode: 0,
          aggregatedOutput: execFileSync("/bin/sh", ["-c", params.command], {
            env: { ...process.env, ...thread.environment }, encoding: "utf8"
          }) };
        turn.items.push(item);
        thread.turns.push(turn); save();
        emit("turn/started", { turn });
        emit("item/started", { turnId: turn.id, item });
        emit("item/completed", { turnId: turn.id, item });
        emit("turn/completed", { turn });
        return reply({});
      }
      if (method === "thread/goal/get") return reply({ goal: thread?.goal || null });
      if (method === "thread/unsubscribe") { state.loaded = false; return reply({ status: "unsubscribed" }); }
      if (method === "turn/interrupt") {
        if (state.runningTurn?.id === params.turnId) state.runningTurn.status = "interrupted";
        save();
        reply({});
        if (state.runningTurn?.id === params.turnId) {
          const interruptedTurn = { ...state.runningTurn };
          if (${Boolean(options.deferBudgetCompletion)} && state.budgetFailureTurnId === params.turnId) {
            log({ budgetCompletion: { kind: "interrupted-held", threadId: thread.id, turnId: params.turnId } });
            while (!existsSync(file + ".budget-terminal-" + params.turnId) && ws.readyState === 1) await new Promise(resolve => setTimeout(resolve, 5));
            log({ budgetCompletion: { kind: "interrupted-released", threadId: thread.id, turnId: params.turnId } });
          }
          if (ws.readyState === 1) emit("turn/completed", { turn: interruptedTurn });
        }
        return;
      }
      if (method === "thread/goal/clear") {
        thread.goal = null; save(); reply({}); emit("thread/goal/cleared", {}); return;
      }
      if (method === "thread/goal/set") {
        if (params.objective === "rejected goal") return ws.send(JSON.stringify({ id, error: { code: -32602, message: "Goal rejected" } }));
        const now = Math.floor(Date.now() / 1000);
        thread.goal = params.objective ? { threadId: thread.id, objective: params.objective, status: params.status,
          createdAt: now, updatedAt: now, tokensUsed: 0, timeUsedSeconds: 0, tokenBudget: params.tokenBudget ?? null }
          : { ...thread.goal, status: params.status, updatedAt: now };
        save();
        if (params.objective !== "lost goal") reply({ goal: thread.goal });
        emit("thread/goal/updated", { goal: thread.goal });
        if (params.status !== "active") return;
        await goalTurns();
        return;
      }
      if (method === "thread/inject_items" || method === "thread/name/set") return reply({});
      if (method === "turn/steer") {
        const turn = thread.turns.at(-1);
        const text = params.input[0].text;
        if (text === "rejected-steer" || turn.status !== "inProgress" || params.expectedTurnId !== turn.id) {
          return ws.send(JSON.stringify({ id, error: { code: -32602, message: "Steering rejected" } }));
        }
        turn.items.push({ id: "steering-user", type: "userMessage", clientId: params.clientUserMessageId, content: params.input });
        save();
        if (text === "lost-steer") return;
        reply({ turnId: turn.id });
        if (turn.items.some(item => item.id === "before-steer")) emit("item/agentMessage/delta", { turnId: turn.id, itemId: "before-steer", delta: " late old text" });
        const answer = { id: "after-steer", type: "agentMessage", phase: "final_answer", text: "Steered: " + text };
        turn.items.push(answer);
        emit("item/started", { turnId: turn.id, item: answer });
        emit("item/agentMessage/delta", { turnId: turn.id, itemId: answer.id, delta: answer.text });
        emit("item/completed", { turnId: turn.id, item: answer });
        turn.status = "completed"; save();
        emit("turn/completed", { turnId: turn.id, turn });
        return;
      }
      if (method === "turn/start") {
        const text = params.input[0].text;
        if (text === "rejected") return ws.send(JSON.stringify({ id, error: { code: -32602, message: "Turn rejected" } }));
        const turn = { id: randomUUID(), status: "inProgress", items: [{ id: "user", type: "userMessage", clientId: params.clientUserMessageId, content: params.input }] };
        state.runningTurn = turn;
        thread.turns.push(turn); save();
        emit("turn/started", { turn });
        if (text === "lost") return;
        reply({ turn });
        const emitTurn = (method, value) => emit(method, { turnId: turn.id, ...value });
        if (text === "native-goal") {
          const now = Math.floor(Date.now() / 1000);
          thread.goal = { threadId: thread.id, objective: ${JSON.stringify(options.nativeGoalObjective || "A goal from native create_goal")}, status: "active",
            createdAt: now, updatedAt: now, tokensUsed: 0, timeUsedSeconds: 0, tokenBudget: null };
          save(); emit("thread/goal/updated", { goal: thread.goal });
        }
        if (text === "wait") return;
        if (text === "steering") {
          const answer = { id: "before-steer", type: "agentMessage", phase: "final_answer", text: "Initial progress" };
          turn.items.push(answer); save();
          emitTurn("item/started", { item: answer });
          emitTurn("item/agentMessage/delta", { itemId: answer.id, delta: answer.text });
          return;
        }
        if (text === "phases") {
          emitTurn("item/started", { item: { id: "compact", type: "contextCompaction" } });
          emitTurn("item/completed", { item: { id: "compact", type: "contextCompaction" } });
          emitTurn("error", { error: { message: "Temporarily unavailable" }, willRetry: true });
        }
        if (text === "failed") { turn.status = "failed"; save(); emitTurn("turn/completed", { turn: { ...turn, error: { message: "Model unavailable" } } }); return; }
        if (text === "disconnect") { setTimeout(() => ws.close(), 50); return; }
        let toolAnswer;
        if (text === "tools" || text === "foreign-tool") {
          const invoke = (tool, arguments_) => callTool(turn, tool, arguments_, text === "foreign-tool");
          try {
            await invoke("assistant_action_search", { query: "numbers" });
            await invoke("assistant_action_contract", { actionId: "numbers.read", version: 1 });
            const result = await invoke("assistant_action_execute", { actionId: "numbers.read", version: 1, input: {} });
            toolAnswer = result.contentItems[0].text;
          } catch (error) {
            turn.status = "failed"; save();
            if (ws.readyState === 1) emitTurn("turn/completed", { turn: { ...turn, error: { message: error.message } } });
            return;
          }
        }
        const split = text.startsWith("blocks");
        const phase = text === "blocks-without-phase" ? "" : "final_answer";
        if (split) {
          const progress = { id: "progress", type: "agentMessage", text: "Checking the numbers." };
          turn.items.push(progress);
          emitTurn("item/started", { item: progress });
          emitTurn("item/agentMessage/delta", { itemId: progress.id, delta: progress.text });
          emitTurn("item/completed", { item: progress });
          const tool = { id: "tool", type: "commandExecution" };
          turn.items.push(tool); emitTurn("item/started", { item: tool });
        }
        emitTurn("item/started", { item: { id: "answer", type: "agentMessage", phase } });
        emitTurn("item/reasoning/summaryTextDelta", { itemId: "reasoning", delta: "Reasoning" });
        emitTurn("item/reasoning/summaryTextDelta", { itemId: "reasoning", delta: " summary" });
        const answerText = toolAnswer || (structuredResponse ? JSON.stringify(structuredResponse) : "Answer: " + text);
        emitTurn("item/agentMessage/delta", { itemId: "answer", delta: structuredResponse ? answerText.slice(0, 8) : "Answer: " });
        const answer = { id: "answer", type: "agentMessage", phase, text: answerText };
        turn.items.push(answer);
        emitTurn("item/completed", { item: answer });
        if (split) {
          const tail = { id: "tail", type: "agentMessage", phase, text: "The second paragraph." };
          turn.items.push(tail);
          emitTurn("item/started", { item: tail });
          emitTurn("item/agentMessage/delta", { itemId: tail.id, delta: tail.text });
          emitTurn("item/completed", { item: tail });
        }
        turn.status = "completed"; save();
        if (split) emitTurn("task_complete", { last_agent_message: answer.text + "\\n\\nThe second paragraph." });
        emitTurn("turn/completed", { turn });
        if (text === "native-goal") await goalTurns();
        return;
      }
      ws.send(JSON.stringify({ id, error: { code: -32601, message: "Unsupported method: " + method } }));
    }));
    server.listen(socket);
  `, { mode: 0o700 });
  const disk = createFileConversationStorage({ directory: path.join(directory, "storage") });
  const storageFile = path.join(directory, "storage", `${createHash("sha256").update("conversation").digest("hex")}.json`);
  const checkpoints = [];
  const originalBacking = options.storage ? options.storage(disk) : disk;
  const backing = options.deferBudgetCompletion ? { read: originalBacking.read, async write(scope, callback) {
    const result = await originalBacking.write(scope, callback);
    const run = (await disk.read(scope, transaction => transaction.readMetadata())).runtime?.binding?.codexAppServerRun;
    if (scope === "conversation" && run?.outerTurnId === "bounded-goal" && run.providerThreadId && run.providerTurnId &&
        run.active === false && ["interrupted", "failed"].includes(run.state)) {
      await writeFile(path.join(directory, "history.json") + ".budget-terminal-" + run.providerTurnId,
        JSON.stringify({ threadId: run.providerThreadId, turnId: run.providerTurnId, outerTurnId: run.outerTurnId }));
    }
    return result;
  } } : originalBacking;
  const storage = options.checkpoints ? { read: backing.read, async write(scope, callback) {
    const result = await backing.write(scope, callback);
    checkpoints.push(JSON.parse(await readFile(storageFile, "utf8")));
    return result;
  } } : backing;
  const runtimes = [];
  const execution = options.execution || createLocalConversationExecution();
  t.after(async () => {
    try { for (const runtime of runtimes) await runtime.close(); }
    finally {
      if (!options.execution) await execution.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  const env = { ...process.env, CODEX_HOME: path.join(directory, "codex"), TEST_TRACE: trace, TEST_ACCOUNT: account,
    TEST_HISTORY: path.join(directory, "history.json"), ...options.environment };
  function runtime({ nativeTools = options.nativeTools } = {}) {
    const value = createConversationRuntime({ engine: "codex", storage, authorize: options.authorize || (() => true),
      actions: options.actions, connections: options.connections, fetch: options.fetch, attachments: options.attachments,
      host: { workdir: directory, runtimeDirectory: directory, env, commands: { codex: command }, execution, nativeTools, commandWrapper: options.commandWrapper },
      limits: { admissionTimeoutMs: 2000, ...options.limits } });
    runtimes.push(value);
    return value;
  }
  const first = runtime();
  const conversation = await first.open({ id: "conversation", configuration: options.configuration || configuration, context: options.context });
  return { directory, storage, account, runtime, first, conversation, checkpoints,
    driverOptions: { connections: options.connections,
      host: { workdir: directory, runtimeDirectory: directory, env, commands: { codex: command }, execution, nativeTools: options.nativeTools, commandWrapper: options.commandWrapper },
      limits: { admissionTimeoutMs: 2000, ...options.limits } },
    async restore(checkpoint) {
      assert.ok(checkpoint);
      await first.close();
      // Restore application persistence while retaining native history.
      await writeFile(storageFile, JSON.stringify(checkpoint));
    },
    async trace() { return (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line)); } };
}

test("Codex admits, streams, persists reasoning and deduplicates using native receipts", async t => {
  const f = await fixture(t);
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  assert.equal((await f.conversation.send(input)).status, "accepted");
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete");
  assert.equal(state.conversationLog[0].assistant.text, "Answer: Hello");
  assert.equal(state.conversationLog[0].thinking[0].text, "Reasoning summary");
  assert.ok(events.some(event => event.type === "message" && event.text === "Answer: "));
  const replies = events.filter(event => event.type === "message" && event.role === "assistant");
  assert.equal(new Set(replies.map(event => event.messageId)).size, 1);
  assert.equal(state.conversationLog[0].assistant.messageId, replies[0].messageId);
  assert.equal((await f.conversation.send(input)).duplicate, true);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  assert.equal(trace.find(row => row.method === "thread/start").params.config.mcp_servers.ambient.enabled, false);
});

test("Codex reports common compaction and retry phases without exposing native status values", async t => {
  const f = await fixture(t);
  const phases = [];
  await f.conversation.subscribe(event => { if (event.type === "phase") phases.push(event.phase); });
  await f.conversation.send({ messageId: "phases", text: "phases" });
  assert.equal((await f.conversation.wait()).phase, "");
  assert.deepEqual(phases, ["preparing", "working", "compacting", "working", "retrying", "working", ""]);
});

test("Codex steering admits once and preserves original unfinished-reply grouping and identities", async t => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const events = [];
  await f.conversation.subscribe(event => {
    events.push(event);
    if (event.type === "message" && event.text === "Initial progress") started.resolve();
  });
  await f.conversation.send({ messageId: "before", text: "steering" });
  await started.promise;
  const steering = { messageId: "after", text: "New instruction", steer: true };
  const [one, two] = await Promise.all([f.conversation.send(steering), f.conversation.send(steering)]);
  assert.equal(one.turnId, two.turnId);
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.equal(state.conversationLog.length, 3);
  assert.deepEqual(state.conversationLog.filter(turn => turn.user).map(turn => turn.user.messageId), ["before", "after"]);
  assert.equal(state.conversationLog[0].assistant, null);
  assert.equal(state.conversationLog[0].metadata.runtime.continuedBy, "after");
  assert.equal(state.conversationLog[1].assistant.text, "Initial progress");
  assert.equal(state.conversationLog[2].user, null);
  assert.equal(state.conversationLog[2].assistant.text, "Steered: New instruction");
  assert.equal(state.conversationLog[2].metadata.runtime.origin, "user");
  assert.equal(events.some(event => event.status === "inProgress" && event.text === "Initial progress late old text"), true);
  const live = events.filter(event => event.type === "message" && event.status === "inProgress");
  assert.ok(live.length);
  assert.equal(live.every(event => event.origin === "user" && event.turnId === undefined), true);
  const replies = state.conversationLog.filter(turn => turn.assistant);
  assert.equal(new Set(replies.map(turn => turn.assistant.messageId)).size, 2);
  for (const turn of replies) {
    const publications = events.filter(event => event.type === "message" && event.status === "complete" &&
      event.messageId === turn.assistant.messageId);
    assert.ok(publications.length);
    assert.equal(publications.every(event => event.turnId === turn.turnId && event.text === turn.assistant.text), true);
    assert.equal(publications.every(event => event.origin === "user"), true);
  }
  assert.deepEqual(events.filter(event => event.type === "accepted").map(event => event.messageId), ["before", "after"]);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/start").length, 1);
  assert.equal(trace.filter(row => row.method === "turn/steer").length, 1);
  assert.equal(trace.find(row => row.method === "turn/steer").params.clientUserMessageId, "after");
  assert.equal((await f.conversation.send(steering)).duplicate, true);
  await assert.rejects(f.conversation.send({ ...steering, messageId: "idle" }), { code: "conversation_not_steerable" });
});

test("Codex steering rejection leaves the active turn available and checks authorization before dispatch", async t => {
  let allowed = true;
  const f = await fixture(t, { authorize: ({ operation }) => operation !== "steer" || allowed });
  await f.conversation.send({ messageId: "before", text: "wait" });
  await assert.rejects(f.conversation.send({ messageId: "rejected", text: "rejected-steer", steer: true }), /Steering rejected/);
  assert.equal((await f.conversation.read()).pendingRequest, null);
  allowed = false;
  await assert.rejects(f.conversation.send({ messageId: "forbidden", text: "New instruction", steer: true }), { code: "conversation_forbidden" });
  assert.equal((await f.trace()).filter(row => row.method === "turn/steer").length, 1);
  allowed = true;
  await f.conversation.send({ messageId: "accepted", text: "Continue", steer: true });
  assert.equal((await f.conversation.wait()).conversationLog.length, 2);
});

test("lost Codex steering acknowledgement keeps its own durable request without resending", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "before", text: "wait" });
  const input = { messageId: "lost-steering", text: "lost-steer", steer: true };
  await assert.rejects(f.conversation.send(input), /timed out/);
  const active = await f.conversation.read();
  assert.equal(active.status, "working");
  assert.equal(active.pendingRequest.messageId, input.messageId);
  assert.equal((await f.trace()).filter(row => row.method === "turn/interrupt").length, 0);
  assert.deepEqual(await f.conversation.cancel(), { stopped: true });
  const state = await f.conversation.wait();
  assert.equal(state.status, "unconfirmed");
  assert.equal(state.pendingRequest.messageId, input.messageId);
  assert.equal(state.pendingRequest.steering, true);
  assert.equal((await f.conversation.inspectDelivery({ messageId: input.messageId })).status, "accepted");
  assert.equal((await f.conversation.send(input)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.method === "turn/steer").length, 1);
  assert.equal((await f.conversation.read()).conversationLog.length, 2);
});

for (const text of ["blocks", "blocks-without-phase"]) test(`Codex preserves speech identities across progress and ${text}`, async t => {
  const f = await fixture(t);
  const events = [];
  await f.conversation.subscribe(event => { if (event.type === "message") events.push(event); });
  await f.conversation.send({ messageId: "blocks", text });
  const state = await f.conversation.wait();
  const turn = state.conversationLog[0];
  const replies = state.conversationLog.filter(row => row.assistant);
  assert.equal(replies.map(row => row.assistant.text).join("\n\n"), `Answer: ${text}\n\nThe second paragraph.`);
  assert.deepEqual(replies.map(row => row.assistant.text), [`Answer: ${text}`, "The second paragraph."]);
  const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  const nativeMessageId = itemId => `codex-${createHash("sha256").update([
    binding.threadId, turn.metadata.runtime.nativeTurnId, "assistant-item", itemId
  ].join("\u0000")).digest("hex")}`;
  assert.deepEqual(replies.map(row => row.assistant.messageId), ["answer", "tail"].map(nativeMessageId));
  assert.deepEqual(replies.map(row => row.assistant.outputId), ["answer", "tail"].map(nativeMessageId));
  assert.equal(turn.commentary[0].text, "Checking the numbers.");
  const progress = events.filter(message => message.text === "Checking the numbers.");
  assert.equal(new Set(progress.map(message => message.outputId)).size, 1);
  assert.equal(progress.at(-1).role, "commentary");
  assert.equal(progress.at(-1).status, "complete");
  assert.equal(turn.commentary[0].outputId, nativeMessageId("progress"));
  assert.notEqual(turn.commentary[0].messageId, progress.find(message => message.status === "inProgress").messageId);
  const answers = events.filter(message => message.role === "assistant" && message.text.startsWith("Answer:"));
  assert.equal(new Set(answers.map(message => message.messageId)).size, 1);
  assert.equal(answers.at(-1).messageId, turn.assistant.messageId);
  assert.notEqual(turn.assistant.messageId, turn.commentary[0].messageId);
  for (let index = 1; index < answers.length; index++) assert.ok(answers[index].text.startsWith(answers[index - 1].text));
  for (const itemId of ["answer", "tail"]) {
    const output = events.filter(message => message.role === "assistant" && message.messageId === nativeMessageId(itemId));
    // Explicit final history can retire the tail before its queued live events.
    assert.equal(output.some(message => message.status === "inProgress"), itemId === "answer" || text === "blocks-without-phase");
    const completed = output.findIndex(message => message.status === "complete");
    assert.ok(completed >= 0);
    assert.equal(output.slice(completed).some(message => message.status === "inProgress"), false);
    assert.deepEqual([...new Set(output.map(message => message.outputId))], [nativeMessageId(itemId)]);
  }
});

test("Codex changes instructions on its existing shared process and native history", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  await f.conversation.send({ messageId: "unchanged", text: "Again" });
  await f.conversation.wait();
  assert.equal((await f.trace()).filter(row => row.args).length, 1);
  const beforeChange = (await f.trace()).length;
  await f.conversation.configure({ systemPrompt: "New instructions", model: "new-model" });
  await f.conversation.send({ messageId: "changed", text: "Continue" });
  await f.conversation.wait();
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.args).length, 1);
  assert.equal(trace.filter(row => row.method === "thread/start").length, 1);
  assert.equal(trace.slice(beforeChange).find(row => row.method === "thread/resume").params.developerInstructions, "New instructions");
  assert.equal(trace.filter(row => row.method === "thread/inject_items").length, 1);
});

test("Codex shutdown and reopen retain native identity, settings and accepted messages", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  await f.first.close();
  const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  assert.ok(binding.executionId);
  const reopened = await f.runtime().open({ id: "conversation" });
  assert.equal((await reopened.send(input)).duplicate, true);
  await reopened.send({ messageId: "restart", text: "Continue" });
  assert.equal((await reopened.wait()).conversationLog.length, 2);
  assert.equal((await f.trace()).find(row => row.method === "thread/resume").params.threadId, binding.threadId);
  // The production owner stops the service when its last consumer closes.
  // Reopening starts a service, while retaining the same native history.
  assert.equal((await f.trace()).filter(row => row.args).length, 2);
});

for (const closeFirst of [true, false]) test(`closing one common runtime retains its working Codex peer (first: ${closeFirst})`, async t => {
  const f = await fixture(t);
  const peerRuntime = f.runtime();
  const peer = await peerRuntime.open({ id: "peer", configuration });
  const closing = closeFirst ? f.conversation : peer;
  const working = closeFirst ? peer : f.conversation;
  await closing.send(input);
  await closing.wait();
  await working.send({ messageId: "working", text: "wait" });
  await (closeFirst ? f.first : peerRuntime).close();
  assert.equal((await working.read()).status, "working");
  await working.send({ messageId: "steer", text: "Continue", steer: true });
  assert.equal((await working.wait()).conversationLog.at(-1).assistant.text, "Steered: Continue");
  assert.equal((await f.trace()).filter(row => row.args).length, 1);
});

test("concurrent final common-runtime closes stop the shared Codex service once", async t => {
  const execution = createLocalConversationExecution();
  let stops = 0;
  const f = await fixture(t, { execution: { ...execution, async stop(options) {
    stops++;
    return execution.stop(options);
  } } });
  t.after(() => execution.close());
  const peerRuntime = f.runtime();
  const peer = await peerRuntime.open({ id: "peer", configuration });
  await f.conversation.send(input);
  await f.conversation.wait();
  await peer.send(input);
  await peer.wait();
  const before = stops;
  await Promise.all([f.first.close(), peerRuntime.close()]);
  assert.equal(stops - before, 1);
});

for (const loseFirst of [true, false]) test(`shared Codex fallback records both common-runtime barriers before stop (first: ${loseFirst})`, async t => {
  const providers = new Map();
  const startThread = CodexAppServerAgentProvider.prototype.startThread;
  t.mock.method(CodexAppServerAgentProvider.prototype, "startThread", async function (...args) {
    const thread = await startThread.apply(this, args);
    providers.set(thread.id, this);
    return thread;
  });
  const execution = createLocalConversationExecution();
  const barriers = [];
  let storage;
  const f = await fixture(t, { execution: { ...execution, async stop(options) {
    if (storage) barriers.push(await Promise.all(["conversation", "peer"].map(id => storage.read(id,
      async transaction => (await transaction.readMetadata()).runtime.binding.observationLoss))));
    return execution.stop(options);
  } } });
  t.after(() => execution.close());
  storage = f.storage;
  const peer = await f.runtime().open({ id: "peer", configuration });
  await f.conversation.send({ messageId: "first-working", text: "wait" });
  await peer.send({ messageId: "peer-working", text: "wait" });
  const binding = await storage.read(loseFirst ? "conversation" : "peer",
    async transaction => (await transaction.readMetadata()).runtime.binding);
  const source = providers.get(binding.threadId);
  assert.ok(source);
  source.client.close();
  await source.failObservation(new Error("Forced observation loss"));
  const states = await Promise.all([f.conversation.wait(), peer.wait()]);
  assert.ok(barriers.some(values => values.every(value => value?.stopped === false)),
    "both durable admission barriers must precede shared process stop");
  assert.ok(states.every(state => state.status === "ready"));
  for (const id of ["conversation", "peer"]) {
    const saved = await storage.read(id, async transaction => (await transaction.readMetadata()).runtime.binding);
    assert.equal(saved.observationLoss.stopped, true);
  }
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 2, "recovery must not replay work");
});

test("account invalidation reaches common consumers without stopping another runtime scope", async t => {
  const f = await fixture(t);
  const other = await fixture(t);
  const peer = await f.runtime().open({ id: "peer", configuration });
  await f.conversation.send({ messageId: "first-working", text: "wait" });
  await peer.send({ messageId: "peer-working", text: "wait" });
  await other.conversation.send({ messageId: "other-working", text: "wait" });
  const owner = createCodexAppServerProviderOwner({ runtimeRoot: f.directory });
  const result = await owner.invalidateRuntimes({ includeOwned: true, requireVerifiedExit: true, stopOwnedRuntimes: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.providerCount, 2);
  assert.equal(result.stopped, 1);
  const states = await Promise.race([
    Promise.all([f.conversation.wait(), peer.wait()]),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Invalidated consumers did not settle")), 2000))
  ]);
  assert.ok(states.every(state => state.status === "ready"));
  assert.equal((await other.conversation.read()).status, "working");
  await other.conversation.cancel();
});

test("unverified account invalidation keeps both common cleanup owners and settles their waiters unavailable", async t => {
  const execution = createLocalConversationExecution();
  let allowStop = true;
  const f = await fixture(t, { execution: { ...execution, authoritative: true, async stop(...args) {
    if (!allowStop) return { ok: false, scopeEmpty: false };
    return { ok: true, ...await execution.stop(...args) };
  } } });
  t.after(() => execution.close());
  const other = await fixture(t);
  const peer = await f.runtime().open({ id: "peer", configuration });
  await f.conversation.send({ messageId: "first-working", text: "wait" });
  await peer.send({ messageId: "peer-working", text: "wait" });
  await other.conversation.send({ messageId: "other-working", text: "wait" });
  const owner = createCodexAppServerProviderOwner({ runtimeRoot: f.directory });
  allowStop = false;
  try {
    const result = await owner.invalidateRuntimes({ includeOwned: true, requireVerifiedExit: true, stopOwnedRuntimes: true });
    assert.equal(result.ok, false);
    assert.equal(result.providerCount, 2);
    assert.equal(result.stopped, 0);
    assert.ok(result.failed.some(failure => failure.code === "codex_runtime_exit_unverified" && failure.retryable));
    const states = await Promise.race([
      Promise.all([f.conversation.wait(), peer.wait()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Unverified consumers did not settle")), 2000))
    ]);
    assert.ok(states.every(state => state.status === "unavailable"));
    for (const id of ["conversation", "peer"]) {
      const saved = await f.storage.read(id, async transaction => (await transaction.readMetadata()).runtime.binding);
      assert.equal(saved.observationLoss.stopped, false);
      assert.ok(saved.observationLoss.runtime.executionId);
      assert.equal(saved.codexAppServerRun.providerStatus, "observation_lost");
      assert.equal(saved.codexAppServerRun.active, true);
    }
    await assert.rejects(f.conversation.send(input), { code: "codex_runtime_invalidated" });
    assert.equal((await other.conversation.read()).status, "working");
  } finally { allowStop = true; }
  await f.conversation.cancel();
  await peer.cancel();
  assert.ok((await Promise.all([f.conversation.read(), peer.read()])).every(state => state.status === "ready"));
  assert.equal((await f.trace()).filter(row => row.args).length, 1, "cleanup cannot start another native process");
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 2, "cleanup cannot replay either request");
  assert.equal((await other.conversation.read()).status, "working");
  await other.conversation.cancel();
});

for (const stage of ["preparation", "completion"]) test(`account invalidation retains durable retry ownership after failed ${stage} storage`, async t => {
  let rejectStorage = false;
  const failure = new Error(`Invalidation ${stage} could not be persisted`);
  const f = await fixture(t, { storage: disk => ({ read: disk.read,
    write: (scope, callback) => disk.write(scope, transaction => callback({
      ...transaction,
      async writeMetadata(metadata) {
        const binding = metadata.runtime?.binding;
        const rejected = stage === "preparation"
          ? binding?.codexAppServerRun?.providerStatus === "observation_lost"
          : binding?.observationLoss?.stopped;
        if (rejectStorage && rejected) throw failure;
        return transaction.writeMetadata(metadata);
      }
    }))
  }) });
  const peer = await f.runtime().open({ id: "peer", configuration });
  await f.conversation.send({ messageId: "first-working", text: "wait" });
  await peer.send({ messageId: "peer-working", text: "wait" });
  const owner = createCodexAppServerProviderOwner({ runtimeRoot: f.directory });
  rejectStorage = true;
  try {
    const result = await owner.invalidateRuntimes({ includeOwned: true, requireVerifiedExit: true, stopOwnedRuntimes: true });
    assert.equal(result.ok, false);
    assert.equal(result.providerCount, 2);
    assert.equal(result.stopped, 1);
    assert.equal(result.failed.filter(value => value.error === failure.message && value.retryable).length, 2);
    const states = await Promise.race([
      Promise.all([f.conversation.wait(), peer.wait()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Failed invalidation consumers did not settle")), 2000))
    ]);
    assert.ok(states.every(state => state.status === "unavailable"));
    for (const id of ["conversation", "peer"]) {
      const saved = await f.storage.read(id, async transaction => (await transaction.readMetadata()).runtime.binding);
      assert.equal(saved.observationLoss.stopped, false);
      assert.ok(saved.observationLoss.runtime.executionId);
      assert.equal(saved.codexAppServerRun.active, true);
    }
  } finally { rejectStorage = false; }
  await f.conversation.cancel();
  await peer.cancel();
  assert.ok((await Promise.all([f.conversation.read(), peer.read()])).every(state => state.status === "ready"));
  for (const id of ["conversation", "peer"]) {
    const saved = await f.storage.read(id, async transaction => (await transaction.readMetadata()).runtime.binding);
    assert.equal(saved.observationLoss.stopped, true);
    assert.equal(saved.codexAppServerRun.active, false);
  }
  assert.equal((await f.trace()).filter(row => row.args).length, 1, "storage retry cannot start another native process");
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 2, "storage retry cannot repeat inference");
});

test("failed stopped-state persistence retains Codex recovery across reopening without starting work", async t => {
  let source;
  let rejectStopped = false;
  const startThread = CodexAppServerAgentProvider.prototype.startThread;
  t.mock.method(CodexAppServerAgentProvider.prototype, "startThread", async function (...args) {
    source = this;
    return startThread.apply(this, args);
  });
  const f = await fixture(t, { checkpoints: true, storage: disk => ({
    read: disk.read,
    write: (scope, callback) => disk.write(scope, transaction => callback({
      ...transaction,
      async writeMetadata(metadata) {
        if (rejectStopped && metadata.runtime?.binding?.observationLoss?.stopped) {
          throw new Error("Stopped state could not be persisted");
        }
        return transaction.writeMetadata(metadata);
      }
    }))
  }) });
  await f.conversation.send({ messageId: "unfinished", text: "wait" });
  rejectStopped = true;
  source.client.close();
  await assert.rejects(source.failObservation(new Error("Lost observation")), /Stopped state could not be persisted/);
  await f.conversation.wait();
  assert.equal((await f.conversation.read()).status, "unavailable");
  const checkpoint = f.checkpoints.findLast(record => record.metadata.runtime?.binding?.observationLoss?.stopped === false);
  assert.ok(checkpoint, "the pending barrier and exact runtime owner must remain durable");
  rejectStopped = false;
  await f.restore(checkpoint);
  const starts = (await f.trace()).filter(row => row.args).length;
  const reopened = await f.runtime().open({ id: "conversation", configuration });
  assert.equal((await reopened.read()).status, "unavailable");
  await reopened.cancel();
  const saved = await f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime.binding);
  assert.equal(saved.observationLoss.stopped, true);
  assert.equal((await f.trace()).filter(row => row.args).length, starts, "cleanup cannot launch a new native server");
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1, "cleanup cannot replay the user message");
});

test("shared provider invalidation selects the exact account and workspace", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-codex-owner-"));
  const main = createCodexAppServerProviderOwner({ runtimeRoot: root });
  const common = createCodexAppServerProviderOwner();
  const calls = [];
  t.after(async () => {
    for (const owner of [main, common]) await owner.invalidateRuntimes({ includeOwned: true, stopOwnedRuntimes: true });
    await rm(root, { recursive: true, force: true });
  });
  for (const [owner, key, runtimeDir, toolHomeSource] of [
    [main, "main-a", path.join(root, "a"), "account-a"],
    [common, "common-a", path.join(root, "a"), "account-a"],
    [common, "common-b", path.join(root, "b"), "account-b"],
    [common, "other-workspace", `${root}-other/a`, "account-a"]
  ]) {
    const providerOptions = { runtimeDir, toolHomeSource };
    const provider = owner.createProvider({ providerKey: key, providerOptions, create: () => ({
      close() { calls.push([key, "close"]); },
      async stopRuntime() { calls.push([key, "stop"]); return { stopped: true }; }
    }) });
    await owner.acquireRuntime({ providerKey: key, providerOptions, provider, operation: async () => {} });
  }
  const result = await main.invalidateRuntimes({ includeOwned: true, requireVerifiedExit: true,
    stopOwnedRuntimes: true, toolHomeSource: "account-a" });
  assert.equal(result.ok, true);
  assert.equal(result.providerCount, 2);
  assert.equal(result.stopped, 1);
  assert.deepEqual(calls, [["main-a", "close"], ["common-a", "stop"]]);
  assert.ok(common.providers.get("common-b"));
  assert.ok(common.providers.get("other-workspace"));
});

test("Codex cancellation drains owned work, and a deadline saves a failed turn", async t => {
  const f = await fixture(t, { limits: { timeoutMs: 2000 } });
  await f.conversation.send({ messageId: "cancel", text: "wait" });
  assert.deepEqual(await f.conversation.cancel(), { stopped: true });
  await f.conversation.send({ messageId: "timeout", text: "wait" });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "cancelled");
  assert.equal(state.conversationLog[1].metadata.runtime.status, "failed");
  assert.match(state.error, /time limit/);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "turn/interrupt").length, 2);
  assert.equal(trace.filter(row => row.args).length, 1);
});

test("lost Codex acknowledgement stays uncertain until native history proves the exact message", async t => {
  const f = await fixture(t);
  const lost = { messageId: "lost-id", text: "lost" };
  await assert.rejects(f.conversation.send(lost), /timed out/);
  assert.equal((await f.conversation.read()).status, "unconfirmed");
  await writeFile(path.join(f.directory, "history.json.unavailable"), "");
  try { await assert.rejects(f.conversation.send(lost), /uncertain/); }
  finally { await rm(path.join(f.directory, "history.json.unavailable")); }
  const recovered = await f.conversation.inspectDelivery({ messageId: lost.messageId });
  assert.equal(recovered.status, "accepted");
  assert.equal((await f.conversation.send(lost)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
});

test("explicit rejection and a failed native turn do not become successful answers", async t => {
  const f = await fixture(t);
  await assert.rejects(f.conversation.send({ messageId: "rejected", text: "rejected" }), /Turn rejected/);
  assert.equal((await f.conversation.read()).status, "ready");
  await f.conversation.send({ messageId: "failed", text: "failed" });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "failed");
  assert.equal(state.conversationLog[0].assistant, null);
});

test("changing the native account cannot submit more work to the previous account's thread", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  await writeFile(f.account, "another@example.test");
  await assert.rejects(f.conversation.send({ messageId: "different", text: "Continue" }), /another Codex account/);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
});

test("Codex distinguishes native account IDs sharing an email without treating token refresh as a new account", async t => {
  const f = await fixture(t);
  const root = path.join(f.directory, "codex");
  await mkdir(root);
  const credential = accountId => writeFile(path.join(root, "auth.json"), JSON.stringify({ tokens: {
    account_id: accountId, access_token: Math.random().toString()
  } }));
  await credential("first-account");
  await f.conversation.send(input);
  await f.conversation.wait();
  await credential("first-account");
  await f.conversation.send({ messageId: "refreshed", text: "Continue" });
  await f.conversation.wait();
  await credential("different-account");
  await assert.rejects(f.conversation.send({ messageId: "different", text: "Continue" }), /another Codex account/);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 2);
});

test("losing the Codex socket stops its process and preserves the failed accepted turn", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "disconnect", text: "disconnect" });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "failed");
  const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  assert.equal(binding.executionId, "");
  await f.conversation.send(input);
  assert.equal((await f.conversation.wait()).conversationLog[1].assistant.text, "Answer: Hello");
});

test("cancel during a shared Codex handshake releases its caller and leaves startup available to a peer", async t => {
  const gateDirectory = await mkdtemp(path.join(tmpdir(), "jskit-codex-startup-gate-"));
  t.after(() => rm(gateDirectory, { recursive: true, force: true }));
  const gate = path.join(gateDirectory, "ready");
  const f = await fixture(t, { environment: { TEST_STARTUP_WAIT: gate }, limits: { admissionTimeoutMs: 30_000 } });
  const sending = f.conversation.send(input);
  sending.catch(() => {});
  const deadline = Date.now() + 3000;
  while (!(await f.trace().catch(() => [])).some(row => row.method === "initialize")) {
    if (Date.now() > deadline) throw new Error("Codex did not begin its initialization.");
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const started = Date.now();
  await f.conversation.cancel();
  await assert.rejects(sending);
  assert.ok(Date.now() - started < 1500, "cancel must not wait for the 30-second handshake timeout");
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
  await writeFile(gate, "ready");
  const peer = await f.first.open({ id: "peer", configuration });
  await peer.send({ messageId: "peer-first", text: "Hello from the peer" });
  assert.equal((await peer.wait()).conversationLog[0].assistant.text, "Answer: Hello from the peer");
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.args).length, 1);
  assert.deepEqual(trace.filter(row => row.method === "turn/start").map(row => row.params.clientUserMessageId), ["peer-first"]);
});

test("an unconfirmed Codex stop blocks new work and supports an explicit cleanup retry", async t => {
  const execution = createLocalConversationExecution();
  let allowStop = false;
  const f = await fixture(t, { execution: { ...execution, authoritative: true, async stop(...args) { if (!allowStop) return { ok: false, scopeEmpty: false }; return { ok: true, ...await execution.stop(...args) }; } } });
  t.after(() => execution.close());
  await f.conversation.send({ messageId: "waiting", text: "disconnect" });
  await f.conversation.wait();
  assert.equal((await f.conversation.read()).status, "unavailable");
  await assert.rejects(f.conversation.send(input), { code: "codex_runtime_exit_unverified" });
  allowStop = true;
  await f.conversation.cancel();
  await f.conversation.send(input);
  assert.equal((await f.conversation.wait()).status, "ready");
});

test("access revoked during native preparation prevents the user message from being sent", async t => {
  let allowed = true;
  const execution = createLocalConversationExecution();
  const f = await fixture(t, { authorize: () => allowed,
    execution: { ...execution, async run(params) { const native = await execution.run(params); if (params.mode === "detached") allowed = false; return native; } } });
  t.after(() => execution.close());
  await assert.rejects(f.conversation.send(input), /not available/);
  assert.equal((await f.trace()).some(row => row.method === "turn/start"), false);
  allowed = true;
});

function applicationActions(execute) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.tools", domain: "numbers", actions: [{
    id: "numbers.read", version: 1, kind: "query", channels: ["automation"], surfaces: ["app"],
    permission: { require: "all", permissions: ["numbers.read"] }, idempotency: "none",
    input: { schema: createSchema({}), mode: "replace" },
    output: { schema: createSchema({ value: { type: "number", required: true } }), mode: "replace" }, execute
  }] });
  return actions;
}

test("Codex uses shared discovery and durable application results across native resume", async t => {
  let executions = 0;
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  const actions = applicationActions(async () => { executions++; return { value: 42 }; });
  const f = await fixture(t, { actions, context });
  await f.conversation.send({ messageId: "tool-turn", text: "tools" });
  const first = await f.conversation.wait();
  assert.equal(first.conversationLog[0].metadata.runtime.status, "complete");
  assert.equal(first.conversationLog[0].metadata.applicationTools.length, 3);
  assert.equal(JSON.parse(first.conversationLog[0].assistant.text).result.result.value, 42);
  assert.equal(executions, 1);
  const started = (await f.trace()).find(row => row.method === "thread/start");
  assert.deepEqual(started.params.dynamicTools.map(tool => tool.name), ["assistant_action_search", "assistant_action_contract", "assistant_action_execute"]);
  assert.equal(started.params.config.features.shell_tool, false);
  await f.first.close();
  const resumed = await f.runtime().open({ id: "conversation", context });
  await resumed.send({ messageId: "resumed-tools", text: "tools" });
  assert.equal((await resumed.wait()).conversationLog[1].metadata.runtime.status, "complete");
  assert.equal(executions, 2);
  context.permissions = [];
  await resumed.send({ messageId: "revoked-tools", text: "tools" });
  const revoked = await resumed.wait();
  assert.equal(revoked.conversationLog[2].metadata.applicationTools.at(-1).result.ok, false);
  assert.equal(executions, 2);
  assert.equal((await f.trace()).filter(row => row.method === "thread/start").length, 1, "Permission changes do not replace native history");
});

test("a native tool request cannot target another application conversation", async t => {
  let executions = 0;
  const actions = applicationActions(async () => { executions++; return { value: 42 }; });
  const f = await fixture(t, { actions, context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] } });
  await f.conversation.send({ messageId: "foreign", text: "foreign-tool" });
  const result = await f.conversation.wait();
  assert.equal(executions, 0);
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(result.error, /does not authorize/);
});

test("Codex cancellation waits for an application effect after closing the native process", async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  const actions = applicationActions(async () => { entered.resolve(); return complete.promise; });
  const f = await fixture(t, { actions, context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] } });
  await f.conversation.send({ messageId: "cancel-tools", text: "tools" });
  await entered.promise;
  let finished = false;
  const stopping = f.conversation.cancel().then(() => { finished = true; });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(finished, false);
  complete.resolve({ value: 42 });
  await stopping;
  const result = await f.conversation.read();
  assert.equal(result.conversationLog[0].metadata.runtime.status, "cancelled");
  assert.equal(result.conversationLog[0].metadata.applicationTools.at(-1).result.result.result.value, 42);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
});

test("steering keeps an in-flight application effect and its receipt on the original message", async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  let executions = 0;
  const actions = applicationActions(async () => { executions++; entered.resolve(); return complete.promise; });
  const f = await fixture(t, { actions, context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] } });
  await f.conversation.send({ messageId: "original-tools", text: "tools" });
  await entered.promise;
  await f.conversation.send({ messageId: "new-instruction", text: "Continue differently", steer: true });
  const pending = await f.conversation.read();
  assert.equal(pending.conversationLog[0].metadata.applicationTools.at(-1).status, "running");
  complete.resolve({ value: 42 });
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.equal(state.conversationLog[0].metadata.applicationTools.at(-1).result.result.result.value, 42);
  assert.deepEqual(state.conversationLog[1].metadata.applicationTools, []);
  assert.equal(state.conversationLog[1].assistant.text, "Steered: Continue differently");
  assert.equal(executions, 1);
});

test("steering resolves current attachment access and saves only its authorized receipt", async t => {
  const image = Buffer.from("authorized-steering-image");
  const receipt = { attachmentId: "picture", fileName: "picture.png", size: image.length };
  let reads = 0;
  const f = await fixture(t, { attachments: { resolve: async () => {
    reads++;
    return { attachments: [receipt], content: [{ type: "image", image, mediaType: "image/png" }] };
  } } });
  await f.conversation.send({ messageId: "before", text: "wait" });
  const instruction = { messageId: "image-steer", text: "Use this image", attachmentIds: [receipt.attachmentId], steer: true };
  await f.conversation.send(instruction);
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.deepEqual(state.conversationLog[1].user.attachments, [receipt]);
  assert.equal((await f.trace()).find(row => row.method === "turn/steer").params.input[1].url,
    `data:image/png;base64,${image.toString("base64")}`);
  assert.equal((await f.conversation.send(instruction)).duplicate, true);
  assert.equal(reads, 1);
});

test("an uncertain application effect cannot become successful when steering has already produced an answer", async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  const actions = applicationActions(async () => { entered.resolve(); return complete.promise; });
  const f = await fixture(t, { actions, context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] } });
  await f.conversation.send({ messageId: "original-tools", text: "tools" });
  await entered.promise;
  await f.conversation.send({ messageId: "new-instruction", text: "Continue differently", steer: true });
  complete.reject(new Error("The external effect could not be confirmed."));
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.applicationTools.at(-1).status, "unknown");
  assert.equal(state.conversationLog[1].metadata.runtime.status, "failed");
  assert.match(state.error, /did not return a verified result/);
});

test("a failed write while recording rejected steering can be recovered when the active run is saved", async t => {
  let rejectedPending = false;
  let failureInjected = false;
  const f = await fixture(t, { storage: disk => ({ ...disk, write(id, callback) {
    return disk.write(id, transaction => callback({ ...transaction, async writeMetadata(metadata) {
      if (metadata.runtime.request?.messageId === "rejected" && metadata.runtime.request.attempted) rejectedPending = true;
      if (rejectedPending && !failureInjected && metadata.runtime.request?.messageId === "rejected" && metadata.runtime.request.attempted === false) {
        failureInjected = true;
        throw new Error("Disk temporarily unavailable");
      }
      await transaction.writeMetadata(metadata);
    } }));
  } }) });
  await f.conversation.send({ messageId: "before", text: "wait" });
  await assert.rejects(f.conversation.send({ messageId: "rejected", text: "rejected-steer", steer: true }), /Disk temporarily/);
  await f.conversation.cancel();
  const state = await f.conversation.read();
  assert.equal(state.pendingRequest, null);
  assert.equal(state.status, "ready");
  assert.equal(state.conversationLog.length, 1);
});

test("one logical conversation switches between Codex and API across restart without duplicating the displayed history", async t => {
  const requests = [];
  const connections = createAiConnectionResolver({ configuration: { schemaVersion: 1, registrations: {}, integrations: {
    assistant: { provider: "ai", accountMode: "shared", scopes: [], authentication: { method: "none" }, settings: { model: "opencode/big-pickle" } }
  } }, authorize: () => ({ applicationId: "test", subjectId: "owner" }) });
  const f = await fixture(t, { connections, fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const chunk = { choices: [{ index: 0, delta: { content: "API answer" }, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  } });
  await f.conversation.send(input);
  const initial = await f.conversation.wait();
  await f.conversation.replace({ operationId: "to-api", expectedSegmentId: initial.segmentId, reason: "engine-change", engine: "api",
    configuration: { systemPrompt: "Continue this conversation.", integrationId: "assistant" } });
  assert.equal((await f.conversation.read()).engine, "api");
  const departure = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime);
  assert.ok(departure.predecessors[0].preparedAt, "Initialized native departure uses the original prepared replacement");
  assert.ok(departure.predecessors[0].binding.threadId);
  assert.equal(requests.length, 0, "Preparing an API successor performs no inference");
  assert.equal((await f.trace()).filter(row => row.method === "thread/start").length, 1);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
  await f.conversation.send({ messageId: "api", text: "Continue through API" });
  await f.conversation.wait();
  assert.match(requests[0].messages[1].content, /Hello/);
  await f.first.close();
  const reopened = await f.runtime().open({ id: "conversation" });
  const saved = await reopened.read();
  assert.equal(saved.engine, "api", "Reopen uses the saved selection, not the runtime default");
  await reopened.replace({ operationId: "to-codex", expectedSegmentId: saved.segmentId, reason: "engine-change", engine: "codex", configuration });
  await reopened.send({ messageId: "native-again", text: "Continue native" });
  await reopened.wait();
  await reopened.send({ messageId: "native-next", text: "Next" });
  const result = await reopened.wait();
  assert.deepEqual(result.conversationLog.map(turn => turn.user.text), ["Hello", "Continue through API", "Continue native", "Next"]);
  const trace = await f.trace();
  const turns = trace.filter(row => row.method === "turn/start");
  assert.equal(trace.filter(row => row.method === "thread/start").length, 2);
  assert.match(turns[1].params.input[0].text, /API answer/);
  assert.equal(turns[2].params.input[0].text, "Next", "The successor receives its briefing only once");
  const metadata = await f.storage.read("conversation", tx => tx.readMetadata());
  assert.equal(metadata.runtime.predecessors.length, 2);
  assert.ok(metadata.runtime.predecessors[0].binding.executionId, "Retain the production execution reference as exit-proof identity.");
  assert.notEqual(metadata.runtime.predecessors[0].binding.threadId, metadata.runtime.binding.threadId);
});

test("replacement retains the predecessor and blocks a successor until native cleanup is confirmed", async t => {
  const execution = createLocalConversationExecution();
  let allowStop = false;
  const f = await fixture(t, { execution: { ...execution, authoritative: true, async stop(...args) { if (!allowStop) return { ok: false, scopeEmpty: false }; return { ok: true, ...await execution.stop(...args) }; } } });
  t.after(() => execution.close());
  await f.conversation.send(input);
  const state = await f.conversation.wait();
  const operation = { operationId: "renew", expectedSegmentId: state.segmentId, reason: "renewal", briefing: "Continue from the saved work." };
  await assert.rejects(f.conversation.replace(operation), { code: "codex_runtime_exit_unverified" });
  const preparing = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime);
  assert.ok(preparing.replacement.preparedAt);
  assert.equal(preparing.segmentId, state.segmentId);
  assert.equal(preparing.predecessors.length, 0);
  assert.equal(Object.hasOwn(preparing.replacement, "binding"), false, "Successor allocation waits for confirmed native cleanup");
  await assert.rejects(f.conversation.send({ messageId: "blocked", text: "Too early" }), { code: "codex_runtime_exit_unverified" });
  assert.equal((await f.trace()).filter(row => row.method === "thread/start").length, 1);
  allowStop = true;
  await f.conversation.replace(operation);
  await f.conversation.send({ messageId: "renewed", text: "Continue" });
  const result = await f.conversation.wait();
  assert.equal(result.conversationLog.length, 2);
  assert.equal((await f.trace()).filter(row => row.method === "thread/start").length, 2);
});

test("one runtime starts conversations in separate worktrees and account homes", async t => {
  const f = await fixture(t);
  const otherDirectory = path.join(f.directory, "another-worktree");
  await mkdir(otherDirectory);
  const trace = path.join(otherDirectory, "trace.jsonl");
  const account = path.join(otherDirectory, "account.txt");
  await writeFile(account, "another@example.test");
  const host = { workdir: otherDirectory, commands: { codex: path.join(f.directory, "codex.mjs") },
    env: { ...process.env, CODEX_HOME: path.join(otherDirectory, "credentials"), TEST_ACCOUNT: account,
      TEST_TRACE: trace, TEST_HISTORY: path.join(otherDirectory, "history.json") } };
  const other = await f.first.open({ id: "another", engine: "codex", host, configuration });
  await f.conversation.send(input);
  await f.conversation.wait();
  await other.send({ messageId: "other", text: "Other worktree" });
  await other.wait();
  const one = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  const two = await f.storage.read("another", async tx => (await tx.readMetadata()).runtime.binding);
  assert.equal(one.workdir, f.directory);
  assert.equal(two.workdir, otherDirectory);
  assert.notEqual(one.configRoot, two.configRoot);
  assert.notEqual(one.accountIdentity, two.accountIdentity);
  assert.notEqual(one.executionId, two.executionId);
  await f.conversation.dispose();
  await other.send({ messageId: "other-next", text: "Still active" });
  assert.equal((await other.wait()).conversationLog.length, 2);
});

test("an application wake uses native admission without becoming a user message", async t => {
  const f = await fixture(t);
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  const input = { messageId: "watch", text: "The watched session completed." };
  await f.conversation.wake(input);
  const result = await f.conversation.wait();
  assert.equal(result.conversationLog[0].user, null);
  assert.equal(result.conversationLog[0].system.text, input.text);
  assert.equal(result.conversationLog[0].metadata.runtime.origin, "application");
  const replies = events.filter(event => event.type === "message" && event.role === "assistant");
  assert.ok(replies.some(event => event.status === "inProgress"));
  assert.ok(replies.some(event => event.status === "complete"));
  assert.equal(replies.every(event => event.origin === "application"), true);
  assert.equal(replies.filter(event => event.status === "inProgress").every(event => event.turnId === undefined), true);
  assert.equal(replies.filter(event => event.status === "complete").every(event => event.turnId === result.conversationLog[0].turnId), true);
  assert.equal(JSON.stringify(replies).includes("nativeIdentity"), false);
  assert.equal((await f.conversation.wake(input)).duplicate, true);
  const calls = (await f.trace()).filter(row => row.method === "turn/start");
  assert.equal(calls.length, 1);
  assert.match(calls[0].params.input[0].text, /\[Application event\]/);
  assert.equal(calls[0].params.clientUserMessageId, "watch");
});

test("select returns to retained native history after restart and sends all missed, edited and removed messages once", async t => {
  const f = await fixture(t, apiOptions());
  await f.conversation.send(input);
  const original = await f.conversation.wait();
  await f.conversation.send({ messageId: "remove", text: "This turn will be removed" });
  const second = await f.conversation.wait();
  await select(f.conversation, "api", "choose-api");
  for (let i = 0; i < 31; i++) {
    await f.conversation.send({ messageId: `api-${i}`, text: `Missed message ${i}` });
    await f.conversation.wait();
  }
  await f.storage.write("conversation", async tx => {
    await tx.replaceAssistant(original.conversationLog[0].turnId, { role: "assistant", text: "Corrected original answer" });
    const removed = second.conversationLog[1];
    await tx.updateTurnMetadata(removed.turnId, { runtime: { ...removed.metadata.runtime, supersededBy: "application-edit" } });
  });
  await f.first.close();
  const reopened = await f.runtime().open({ id: "conversation" });
  const operation = { operationId: "return-codex", expectedSegmentId: (await reopened.read()).segmentId, engine: "codex", configuration };
  const receipt = await reopened.select(operation);
  assert.equal(receipt.segmentId, original.segmentId);
  assert.equal((await reopened.select(operation)).duplicate, true);
  await reopened.send({ messageId: "return", text: "Resume here" });
  await reopened.wait();
  const calls = (await f.trace()).filter(row => row.method === "turn/start");
  const catchup = calls[2].params.input[0].text;
  assert.match(catchup, /Corrected original answer/);
  assert.match(catchup, /"corrected":true/);
  assert.match(catchup, /Missed message 0/);
  assert.match(catchup, /Missed message 30/);
  assert.match(catchup, /"removedMessageIds":\["000002\/user\/","000002\/assistant\/"\]/);
  assert.doesNotMatch(catchup, /This turn will be removed/);
  assert.equal((await f.trace()).filter(row => row.method === "thread/start").length, 1);
  await reopened.send({ messageId: "next", text: "Next" });
  await reopened.wait();
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").at(-1).params.input[0].text, "Next");
});

test("an uncertain native receipt stays with its engine while another engine can work", async t => {
  const f = await fixture(t, apiOptions());
  const lost = { messageId: "lost-id", text: "lost" };
  await assert.rejects(f.conversation.send(lost), /timed out/);
  await select(f.conversation, "api", "choose-api");
  await assert.rejects(f.conversation.send(lost), { code: "conversation_delivery_uncertain" });
  await f.conversation.send({ messageId: "api-work", text: "Different work" });
  await f.conversation.wait();
  await f.first.close();
  const reopened = await f.runtime().open({ id: "conversation" });
  await select(reopened, "codex", "return-codex");
  assert.equal((await reopened.read()).status, "unconfirmed");
  await writeFile(path.join(f.directory, "history.json.unavailable"), "");
  try { await assert.rejects(reopened.send({ messageId: "new", text: "Too early" }), { code: "conversation_delivery_uncertain" }); }
  finally { await rm(path.join(f.directory, "history.json.unavailable")); }
  assert.equal((await reopened.inspectDelivery({ messageId: lost.messageId })).recovered, true);
  assert.equal((await reopened.send(lost)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
  await reopened.send({ messageId: "confirmed", text: "Now continue" });
  await reopened.wait();
  const sent = (await f.trace()).filter(row => row.method === "turn/start");
  assert.match(sent[1].params.input[0].text, /Different work/);
});

test("selecting another model on the current engine preserves its native identity", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  const original = await f.conversation.wait();
  const receipt = await f.conversation.select({ operationId: "model", expectedSegmentId: original.segmentId,
    engine: "codex", configuration: { ...configuration, model: "another-model" } });
  assert.equal(receipt.segmentId, original.segmentId);
  await f.conversation.send({ messageId: "next", text: "Continue" });
  await f.conversation.wait();
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "thread/start").length, 1);
  assert.equal(trace.filter(row => row.method === "turn/start").at(-1).params.model, "another-model");
});

test("Codex uses an authorized foreign connection, exact catalogue IDs and recovery without replacing native history", async t => {
  let apiKey = "test-foreign-key";
  const context = { user: "owner" };
  const f = await fixture(t, { context,
    connections: { async resolve(request) {
      assert.equal(request.context, context);
      assert.equal(request.integrationId, "foreign");
      return { providerId: "deepseek", model: "deepseek-flash", apiKey };
    } }
  });
  await f.conversation.send(input);
  await f.conversation.wait();
  const original = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding.threadId);
  await f.conversation.select({ operationId: "foreign-model", expectedSegmentId: (await f.conversation.read()).segmentId,
    engine: "codex", configuration: { systemPrompt: configuration.systemPrompt, integrationId: "foreign", effort: "low" } });
  await f.conversation.send({ messageId: "foreign", text: "Continue" });
  await f.conversation.wait();
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.method === "thread/start").length, 1);
  const resumed = trace.find(row => row.method === "thread/resume").params;
  assert.equal(resumed.threadId, original);
  assert.equal(resumed.model, "deepseek-flash");
  assert.equal(resumed.modelProvider, "deepseek");
  const routing = resumed.config["model_providers.deepseek"];
  assert.equal(routing.experimental_bearer_token, apiKey);
  assert.equal(routing.wire_api, "responses");
  assert.equal(routing.requires_openai_auth, false);
  // The moved native service owns its history proxy. HTTP reconstruction is
  // covered by the original history-adapter tests; this boundary proves routing.
  assert.match(routing.base_url, /^http:\/\/127\.0\.0\.1:\d+\/[^/]+\/v2\/deepseek(?:\/history\/[^/]+)?$/u);
  assert.equal((await fetch(`${routing.base_url}/unsupported-route`)).status, 404);
  const args = trace.filter(row => row.args).at(-1).args;
  const cataloguePath = JSON.parse(args.find(value => value.startsWith("model_catalog_json=")).slice("model_catalog_json=".length));
  const catalogue = JSON.parse(await readFile(cataloguePath, "utf8"));
  const foreignModel = catalogue.models.find(model => model.slug === "deepseek-flash");
  assert.ok(foreignModel, "The production catalogue retains native and curated models together.");
  assert.equal(foreignModel.context_window, 1048576);
  assert.ok(!JSON.stringify(await f.storage.read("conversation", tx => tx.readMetadata())).includes(apiKey));
  apiKey = "different-account";
  await assert.rejects(f.conversation.send({ messageId: "wrong-account", text: "No" }), /another Codex provider account/);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 2);
  apiKey = "test-foreign-key";
  await f.conversation.select({ operationId: "return-native", expectedSegmentId: (await f.conversation.read()).segmentId,
    engine: "codex", configuration });
  await f.conversation.send({ messageId: "back", text: "Back" });
  await f.conversation.wait();
  assert.equal((await f.trace()).filter(row => row.method === "thread/resume").at(-1).params.threadId, original);
});

test("Codex rejects mismatched model identities and unsupported effort before dispatch", async t => {
  const f = await fixture(t, { connections: { resolve: async () => ({ providerId: "deepseek", model: "deepseek-flash", apiKey: "test-key" }) } });
  for (const [override, message] of [[{ model: "deepseek-v4-pro" }, /differs from/], [{ effort: "ultra" }, /does not support/]]) {
    await f.conversation.select({ operationId: `unsupported-${override.model || override.effort}`,
      expectedSegmentId: (await f.conversation.read()).segmentId, engine: "codex",
      configuration: { systemPrompt: configuration.systemPrompt, integrationId: "foreign", ...override } });
    await assert.rejects(f.conversation.send(input), message);
    assert.equal((await f.conversation.read()).conversationLog.length, 0);
  }
  await assert.rejects(readFile(path.join(f.directory, "trace.jsonl")), { code: "ENOENT" });
});
import { CodexAppServerAgentProvider } from "../src/server/conversation/codexProvider.js";

const nativeAttachmentFiles = [
  { attachmentId: "image", fileName: "a b.png", path: "/session/artifacts/a b.png", contentType: "image/png", size: 16, reference: "[Image #1]" },
  { attachmentId: "file", fileName: "data.csv", path: "/session/artifacts/data.csv", contentType: "application/octet-stream", size: 24, reference: "[File #1]" }
];
const nativeAttachmentReceipt = ({ attachmentId, fileName, size, reference }) => ({ attachmentId, fileName, size, reference });
const nativeAttachmentResolver = ({ attachmentIds }) => {
  const localFiles = attachmentIds.map(id => nativeAttachmentFiles.find(file => file.attachmentId === id));
  return { attachments: localFiles.map(nativeAttachmentReceipt), localFiles };
};
const nativeAttachmentManifest = '\n\nAttached files:\n[Image #1] "a b.png": "/session/artifacts/a b.png"\n[File #1] "data.csv": "/session/artifacts/data.csv"';

test("Codex common dispatch preserves the original local image and file manifest with authored receipts", async t => {
  const f = await fixture(t, { attachments: { resolve: nativeAttachmentResolver }, checkpoints: true });
  const request = { messageId: "local-files", text: "Inspect [Image #1] and [File #1]", attachmentIds: ["image", "file"] };
  await f.conversation.send({ ...request, localFiles: [{ path: "/etc/passwd" }], attachmentManifest: "forged" });
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.deepEqual((await f.trace()).find(row => row.method === "turn/start").params.input, [
    { type: "text", text: request.text + nativeAttachmentManifest, text_elements: [] },
    { type: "localImage", path: nativeAttachmentFiles[0].path }
  ]);
  assert.equal(state.conversationLog[0].user.text, request.text);
  assert.deepEqual(state.conversationLog[0].user.attachments, nativeAttachmentFiles.map(nativeAttachmentReceipt));
  assert.doesNotMatch(JSON.stringify(state.conversationLog[0].user), /session\/artifacts|contentType|forged|etc\/passwd/);
  const frozen = f.checkpoints.find(record => record.metadata.runtime.request?.attachmentManifest);
  assert.equal(frozen.metadata.runtime.request.attachmentManifest, nativeAttachmentManifest);
  assert.equal(Object.hasOwn(frozen.metadata.runtime.request, "localFiles"), false);
  assert.equal((await f.conversation.send(request)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
});

test("Codex common steering uses the original local image input on its exact active turn", async t => {
  const f = await fixture(t, { attachments: { resolve: nativeAttachmentResolver } });
  await f.conversation.send({ messageId: "local-before", text: "wait" });
  const request = { messageId: "local-steer", text: "Inspect [Image #1] and [File #1]", attachmentIds: ["image", "file"], steer: true };
  await f.conversation.send(request);
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.deepEqual((await f.trace()).find(row => row.method === "turn/steer").params.input, [
    { type: "text", text: request.text + nativeAttachmentManifest, text_elements: [] },
    { type: "localImage", path: nativeAttachmentFiles[0].path }
  ]);
  assert.deepEqual(state.conversationLog[1].user.attachments, nativeAttachmentFiles.map(nativeAttachmentReceipt));
  assert.equal(state.conversationLog[1].user.text, request.text);
  assert.equal((await f.conversation.send(request)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
  assert.equal((await f.trace()).filter(row => row.method === "turn/steer").length, 1);
});

test("Codex local attachment context and current files form one ordered manifest", async t => {
  const f = await fixture(t, { attachments: { resolve: nativeAttachmentResolver } });
  await f.storage.write("conversation", transaction => transaction.appendMessage("000001", {
    role: "user", messageId: "old-image", text: "The original picture", at: new Date().toISOString(),
    attachments: [nativeAttachmentReceipt(nativeAttachmentFiles[0])],
    turnMetadata: { runtime: { engine: "api", segmentId: "previous", origin: "user", status: "complete" } }
  }));
  await f.conversation.send({ messageId: "new-file", text: "Inspect the data", attachmentIds: ["file"] });
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  const parts = (await f.trace()).find(row => row.method === "turn/start").params.input;
  assert.equal(parts[0].text.endsWith(nativeAttachmentManifest), true);
  assert.equal(parts[0].text.match(/Attached files:/gu).length, 1);
  assert.deepEqual(parts.slice(1), [{ type: "localImage", path: nativeAttachmentFiles[0].path }]);
  assert.deepEqual(state.conversationLog.at(-1).user.attachments, [nativeAttachmentReceipt(nativeAttachmentFiles[1])]);
});

test("Codex retries retain their frozen local file manifest and cannot retarget authorized paths", async t => {
  let connectionReads = 0;
  let files = nativeAttachmentFiles;
  const f = await fixture(t, { configuration: { ...configuration, integrationId: "assistant" },
    attachments: { resolve: async () => ({ attachments: files.map(nativeAttachmentReceipt), localFiles: files }) },
    connections: { resolve: async () => { connectionReads++; throw new Error("Connection temporarily unavailable"); } }
  });
  const request = { messageId: "retry-local", text: "Inspect", attachmentIds: ["image", "file"] };
  await assert.rejects(f.conversation.send(request), /Connection temporarily unavailable/);
  const pending = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime.request;
  assert.equal(pending.attachmentManifest, nativeAttachmentManifest);
  assert.equal(Object.hasOwn(pending, "localFiles"), false);
  assert.doesNotMatch(JSON.stringify((await f.conversation.read()).pendingRequest), /session\/artifacts|attachmentManifest|localFiles/);
  files = nativeAttachmentFiles.map(file => ({ ...file, path: file.path + ".changed" }));
  await assert.rejects(f.conversation.send(request), { code: "conversation_attachment_manifest_changed" });
  assert.equal(connectionReads, 1);
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
  await assert.rejects(readFile(path.join(f.directory, "trace.jsonl")), { code: "ENOENT" });
});

test("Codex goal controls reject local attachments before native work", async t => {
  const f = await fixture(t, { attachments: { resolve: nativeAttachmentResolver } });
  await assert.rejects(f.conversation.updateGoal({ action: "set", messageId: "local-goal", objective: "Inspect the files",
    attachmentIds: ["image", "file"], expectedSegmentId: (await f.conversation.read()).segmentId }), { code: "conversation_unsupported" });
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
  await assert.rejects(readFile(path.join(f.directory, "trace.jsonl")), { code: "ENOENT" });
});


for (const change of ["model", "effort"]) test(`Codex honors a consumer's fresh native policy for ${change} changes without retiring its shared peer`, async t => {
  const f = await fixture(t);
  const binding = (id = "conversation") => f.storage.read(id, async tx => (await tx.readMetadata()).runtime.binding);
  const peer = await f.first.open({ id: "peer", configuration });
  await peer.send({ messageId: "peer-first", text: "Peer history" });
  await peer.wait();
  const peerBinding = await binding("peer");
  await f.conversation.send(input);
  const original = await f.conversation.wait();
  const previous = await binding();
  const beforeSelection = await f.trace();
  const oldHistory = JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8")).threads.find(thread => thread.id === previous.threadId);
  const selected = { ...configuration, [change]: change === "model" ? "another-model" : "low" };
  const request = { operationId: `fresh-${change}`, expectedSegmentId: original.segmentId,
    engine: "codex", configuration: selected, retireNative: true };
  const receipt = await f.conversation.select(request);
  assert.notEqual(receipt.segmentId, original.segmentId);
  const inert = await binding();
  assert.equal(inert.threadId, "");
  assert.equal(inert.configRoot, previous.configRoot);
  assert.equal(inert.workdir, previous.workdir);
  const predecessor = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.predecessors.find(segment => segment.segmentId === original.segmentId));
  assert.equal(predecessor.binding.threadId, previous.threadId);
  const selectedTrace = await f.trace();
  assert.deepEqual(selectedTrace.filter(row => row.args || ["thread/start", "turn/start"].includes(row.method)),
    beforeSelection.filter(row => row.args || ["thread/start", "turn/start"].includes(row.method)),
    "Selecting inspects readiness without creating a thread, process or inference");
  const retained = await f.conversation.read();
  assert.equal(retained.id, original.id);
  assert.deepEqual(retained.conversationLog, original.conversationLog);
  assert.equal((await f.conversation.select(request)).duplicate, true);
  await f.conversation.send({ messageId: "changed", text: "Continue after the change" });
  assert.equal((await f.conversation.wait()).conversationLog.at(-1).metadata.runtime.status, "complete");
  const fresh = await binding();
  assert.ok(fresh.threadId);
  assert.notEqual(fresh.threadId, previous.threadId);
  assert.equal(fresh.accountIdentity, previous.accountIdentity);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8")).threads.find(thread => thread.id === previous.threadId), oldHistory);
  let trace = await f.trace();
  assert.equal(trace.filter(row => row.args).length, 1, "A peer retains the original shared account service");
  assert.equal(trace.filter(row => row.method === "thread/start").length, 3);
  const calls = trace.filter(row => row.method === "turn/start");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].params.threadId, fresh.threadId);
  assert.equal(calls[2].params.model, selected.model);
  assert.equal(calls[2].params.effort, selected.effort);
  const handedHistory = JSON.parse(calls[2].params.input[0].text.split("\n").find(line => line.startsWith('{"messages":')));
  assert.deepEqual(handedHistory.messages.map(({ role, text }) => [role, text]), [["user", "Hello"], ["assistant", "Answer: Hello"]]);
  assert.deepEqual(handedHistory.removedMessageIds, []);
  assert.equal(calls[2].params.input[0].text.split("User's message:\n")[1], "Continue after the change");
  assert.match(calls[2].params.input[0].text, /Hello/);
  assert.match(calls[2].params.input[0].text, /Answer: Hello/);
  assert.match(calls[2].params.input[0].text, /Continue after the change/);
  assert.doesNotMatch(calls[2].params.input[0].text, /Peer history/);
  await peer.send({ messageId: "peer-next", text: "Peer continues" });
  assert.equal((await peer.wait()).conversationLog.length, 2);
  assert.equal((await binding("peer")).threadId, peerBinding.threadId);
  trace = await f.trace();
  assert.equal(trace.filter(row => row.args).length, 1);
  assert.equal(trace.filter(row => row.method === "turn/start").at(-1).params.input[0].text, "Peer continues");
  await f.first.close();
  const resumed = await f.runtime().open({ id: "conversation" });
  assert.equal((await resumed.select(request)).duplicate, true);
  assert.equal((await resumed.send(input)).duplicate, true);
  assert.equal((await binding()).threadId, fresh.threadId);
  await resumed.send({ messageId: "after-restart", text: "Continue after restart" });
  assert.equal((await resumed.wait()).conversationLog.length, 3);
  trace = await f.trace();
  assert.equal(trace.filter(row => row.args).length, 2);
  assert.equal(trace.filter(row => row.method === "thread/start").length, 3);
  assert.equal(trace.filter(row => row.method === "thread/resume").at(-1).params.threadId, fresh.threadId);
  assert.equal(trace.filter(row => row.method === "turn/start").at(-1).params.input[0].text, "Continue after restart");
  const returned = await resumed.select({ operationId: `restore-${change}`, expectedSegmentId: (await resumed.read()).segmentId,
    engine: "codex", configuration, retireNative: true });
  assert.notEqual(returned.segmentId, original.segmentId, "The consumer policy cannot restore an older retained segment");
  assert.notEqual(returned.segmentId, receipt.segmentId);
  await resumed.send({ messageId: "returned", text: "Back to the original settings" });
  assert.equal((await resumed.wait()).conversationLog.length, 4);
  const restored = await binding();
  assert.notEqual(restored.threadId, previous.threadId);
  assert.notEqual(restored.threadId, fresh.threadId);
  assert.equal(restored.accountIdentity, previous.accountIdentity);
  const restoredPrompt = (await f.trace()).filter(row => row.method === "turn/start").at(-1).params.input[0].text;
  assert.match(restoredPrompt, /Hello/);
  assert.match(restoredPrompt, /Continue after the change/);
  assert.match(restoredPrompt, /Continue after restart/);
});

test("held lifecycle catalogue work does not block another owner's runtime stop or acquisition", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-codex-lifecycle-"));
  const first = createCodexAppServerProviderOwner({ runtimeRoot: path.join(root, "a") });
  const other = createCodexAppServerProviderOwner({ runtimeRoot: path.join(root, "b") });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const events = [];
  const firstOptions = { runtimeDir: path.join(root, "a", "runtime") };
  const stopOptions = { runtimeDir: path.join(root, "b", "stop") };
  const acquireOptions = { runtimeDir: path.join(root, "b", "acquire") };
  t.after(async () => {
    for (const owner of [first, other]) await owner.invalidateRuntimes({ includeOwned: true, stopOwnedRuntimes: true });
    await rm(root, { recursive: true, force: true });
  });
  const firstProvider = first.createProvider({ providerKey: "a", providerOptions: firstOptions, create: () => ({
    async currentRuntimeInfo() { return { runtimeDir: firstOptions.runtimeDir }; },
    async listModels() { entered.resolve(); await release.promise; events.push("a-catalogue-finished"); return { data: [] }; },
    async stopRuntime() { events.push("a-stop"); return { stopped: true }; },
    close() {}
  }) });
  await first.acquireRuntime({ providerKey: "a", providerOptions: firstOptions, provider: firstProvider, operation: async () => {} });
  other.createProvider({ providerKey: "b-stop", providerOptions: stopOptions, create: () => ({
    async stopRuntime() { events.push("b-stop"); return { stopped: true }; }, close() {}
  }) });
  const acquiredProvider = other.createProvider({ providerKey: "b-acquire", providerOptions: acquireOptions, create: () => ({
    async ensureRuntime() { events.push("b-acquire"); return {}; },
    async stopRuntime() { return { stopped: true }; }, close() {}
  }) });
  const catalogue = first.readModelCatalog({ prepareProviderOptions: async () => firstOptions,
    providerFactory() { throw new Error("The existing provider must be reused."); } });
  await entered.promise;
  const stopping = other.stopCachedProvider("b-stop", { requireStopped: true });
  const acquiring = other.ensureSession({ sessionId: "b", providerKey: "b-acquire", providerOptions: acquireOptions,
    assertAdmission() {} });
  let deadline;
  try {
    const [stopped, acquired] = await Promise.race([
      Promise.all([stopping, acquiring]),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("An unrelated runtime waited for the held catalogue.")), 2000); })
    ]);
    assert.equal(stopped.stopped, true);
    assert.equal(acquired, acquiredProvider);
    assert.deepEqual(events, ["b-stop", "b-acquire"]);
    assert.equal(first.providers.get("a"), firstProvider);
  } finally {
    clearTimeout(deadline);
    release.resolve();
    await Promise.allSettled([catalogue, stopping, acquiring]);
  }
});

test("held lifecycle catalogue work preserves same-runtime peer ordering and the final participant stop", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-codex-lifecycle-peer-"));
  const first = createCodexAppServerProviderOwner({ runtimeRoot: root });
  const peer = createCodexAppServerProviderOwner({ runtimeRoot: root });
  const providerOptions = { runtimeDir: path.join(root, "runtime") };
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const events = [];
  t.after(async () => {
    for (const owner of [first, peer]) await owner.invalidateRuntimes({ includeOwned: true, stopOwnedRuntimes: true });
    await rm(root, { recursive: true, force: true });
  });
  const provider = first.createProvider({ providerKey: "first", providerOptions, create: () => ({
    async currentRuntimeInfo() { return { runtimeDir: providerOptions.runtimeDir }; },
    async listModels() { entered.resolve(); await release.promise; events.push("catalogue"); return { data: [] }; },
    async stopRuntime() { events.push("first-stop"); return { stopped: true }; }, close() {}
  }) });
  await first.acquireRuntime({ providerKey: "first", providerOptions, provider, operation: async () => {} });
  peer.createProvider({ providerKey: "peer", providerOptions, create: () => ({
    async stopRuntime() { events.push("peer-stop"); return { stopped: true }; },
    close() { events.push("peer-close"); }
  }) });
  const catalogue = first.readModelCatalog({ prepareProviderOptions: async () => providerOptions,
    providerFactory() { throw new Error("The existing provider must be reused."); } });
  await entered.promise;
  let finished = false;
  const stopping = peer.stopCachedProvider("peer", { requireStopped: true }).then(value => { finished = true; return value; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    assert.deepEqual(events, []);
  } finally {
    release.resolve();
    await catalogue;
  }
  const stopped = await stopping;
  assert.equal(stopped.sharedProcessRetained, true);
  assert.equal(stopped.stopped, false);
  assert.equal(first.providers.get("first"), provider);
  assert.equal(peer.providers.get("peer"), undefined);
  assert.deepEqual(events, ["catalogue", "peer-close"]);
  assert.equal((await first.stopCachedProvider("first", { requireStopped: true })).stopped, true);
  assert.deepEqual(events, ["catalogue", "peer-close", "first-stop"]);
});

test("held lifecycle catalogue work preserves one owner's FIFO across different runtimes", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-codex-lifecycle-fifo-"));
  const owner = createCodexAppServerProviderOwner({ runtimeRoot: root });
  const providerOptions = { runtimeDir: path.join(root, "catalogue") };
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const events = [];
  t.after(async () => {
    await owner.invalidateRuntimes({ includeOwned: true, stopOwnedRuntimes: true });
    await rm(root, { recursive: true, force: true });
  });
  const provider = owner.createProvider({ providerKey: "catalogue", providerOptions, create: () => ({
    async currentRuntimeInfo() { return { runtimeDir: providerOptions.runtimeDir }; },
    async listModels() { entered.resolve(); await release.promise; events.push("catalogue"); return { data: [] }; },
    async stopRuntime() { return { stopped: true }; }, close() {}
  }) });
  await owner.acquireRuntime({ providerKey: "catalogue", providerOptions, provider, operation: async () => {} });
  owner.createProvider({ providerKey: "other", providerOptions: { runtimeDir: path.join(root, "other") }, create: () => ({
    async stopRuntime() { events.push("other-stop"); return { stopped: true }; }, close() {}
  }) });
  const catalogue = owner.readModelCatalog({ prepareProviderOptions: async () => providerOptions,
    providerFactory() { throw new Error("The existing provider must be reused."); } });
  await entered.promise;
  let finished = false;
  const stopping = owner.stopCachedProvider("other", { requireStopped: true }).then(value => { finished = true; return value; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    assert.deepEqual(events, []);
  } finally {
    release.resolve();
    await catalogue;
  }
  assert.equal((await stopping).stopped, true);
  assert.deepEqual(events, ["catalogue", "other-stop"]);
});

test("held lifecycle catalogue preparation remains tracked through shutdown before its runtime key is known", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-codex-lifecycle-shutdown-"));
  let closing = false;
  const owner = createCodexAppServerProviderOwner({ runtimeRoot: root,
    assertOpen() { if (closing) throw new Error("The application is shutting down."); } });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const events = [];
  t.after(() => rm(root, { recursive: true, force: true }));
  const catalogue = owner.readModelCatalog({
    async prepareProviderOptions() { entered.resolve(); await release.promise; return { runtimeDir: path.join(root, "runtime") }; },
    providerFactory() {
      return {
        async currentRuntimeInfo() { return {}; },
        async ensureRuntime() { events.push("acquire"); return { reused: false }; },
        async listModels() { events.push("catalogue"); return { data: [] }; },
        close() { events.push("close"); }
      };
    }
  });
  await entered.promise;
  assert.equal(owner.lifecycleTasks.size, 1);
  closing = true;
  owner.beginShutdown();
  let drained = false;
  const draining = Promise.allSettled([...owner.lifecycleTasks]).then(() => { drained = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drained, false);
    assert.deepEqual(events, []);
  } finally {
    release.resolve();
  }
  await assert.rejects(catalogue, /application is shutting down/);
  await draining;
  assert.equal(drained, true);
  assert.equal(owner.lifecycleTasks.size, 0);
  assert.deepEqual(events, ["close"]);
});

test("held lifecycle catalogue rejection preserves a newer same-runtime tail and later owner work", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-codex-lifecycle-rejection-"));
  const owners = [0, 1, 2].map(() => createCodexAppServerProviderOwner({ runtimeRoot: root }));
  const providerOptions = { runtimeDir: path.join(root, "runtime") };
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const nextEntered = Promise.withResolvers();
  const nextRelease = Promise.withResolvers();
  const failure = new Error("Catalogue unavailable.");
  const catalogue = { data: [{ id: "model" }] };
  let calls = 0;
  t.after(async () => {
    for (const owner of owners) await owner.invalidateRuntimes({ includeOwned: true, stopOwnedRuntimes: true });
    await rm(root, { recursive: true, force: true });
  });
  const provider = owners[0].createProvider({ providerKey: "catalogue", providerOptions, create: () => ({
    async currentRuntimeInfo() { return { runtimeDir: providerOptions.runtimeDir }; },
    async listModels() {
      calls += 1;
      if (calls === 1) { entered.resolve(); await release.promise; throw failure; }
      if (calls === 2) { nextEntered.resolve(); await nextRelease.promise; }
      return catalogue;
    },
    async stopRuntime() { return { stopped: true }; }, close() {}
  }) });
  await owners[0].acquireRuntime({ providerKey: "catalogue", providerOptions, provider, operation: async () => {} });
  const options = { prepareProviderOptions: async () => providerOptions,
    providerFactory() { throw new Error("The existing provider must be reused."); } };
  const failed = assert.rejects(owners[0].readModelCatalog(options), error => error === failure);
  await entered.promise;
  const next = owners[1].readModelCatalog(options);
  let last;
  try {
    release.resolve();
    await failed;
    await nextEntered.promise;
    let finished = false;
    last = owners[2].readModelCatalog(options).then(value => { finished = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    assert.equal(calls, 2, "The rejected task cannot remove the newer runtime tail.");
    nextRelease.resolve();
    assert.equal(await next, catalogue);
    assert.equal(await last, catalogue);
    assert.equal(calls, 3);
    assert.equal(await owners[0].readModelCatalog(options), catalogue);
    assert.equal(calls, 4, "The original owner's queue also continues after rejection.");
    await Promise.all(owners.flatMap(owner => [...owner.lifecycleTasks]));
    assert.deepEqual(owners.map(owner => owner.lifecycleTasks.size), [0, 0, 0]);
  } finally {
    release.resolve();
    nextRelease.resolve();
    await Promise.allSettled([failed, next, last]);
  }
});

// Bound-host contract additions retain the original native app-server fixture,
// schemas, tool-call framing, transcript store and run owner. Public Main's
// identity/authority/readiness composition is a separate adoption prerequisite.
import { createCodexAppServerRunOwner, codexAppServerTurnState } from "../src/server/conversation/codexTurn.js";
import { codexApplicationToolConfiguration, ensureCodexAppServerThread } from "../src/server/conversation/codexProvider.js";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";

async function boundCodexToolsFixture(t, options = {}) {
  let sharedProvider;
  const startThread = CodexAppServerAgentProvider.prototype.startThread;
  t.mock.method(CodexAppServerAgentProvider.prototype, "startThread", async function (...args) {
    sharedProvider ||= this;
    return startThread.apply(this, args);
  });
  const cleanups = [];
  let boundRuntime, owner;
  t.after(async () => {
    try { await boundRuntime?.close(); }
    finally {
      if (owner) {
        for (const id of ["bound-one", "bound-two"]) owner.clearSessionRecoveryTimers(id);
        for (const key of [...owner.eventSubscriptions.keys()]) owner.unsubscribeEventSubscription(key);
      }
      for (const cleanup of cleanups) await cleanup();
    }
  });
  const f = await fixture({ after: callback => cleanups.push(callback) });
  await f.conversation.send({ messageId: "original-process-seed", text: "Hello" });
  await f.conversation.wait();
  assert.ok(sharedProvider);
  const initialParams = (await f.trace()).find(row => row.method === "thread/start").params;
  const storage = createReentrantConversationStorage(f.storage);
  const transcript = createConversationTranscript({ storage });
  const streams = createConversationStreams();
  const runtimes = new Map(), bindings = new Map();
  const effects = [], mappings = [];
  const actor = { actor: { id: "bound-owner" }, surface: "app", permissions: ["numbers.read"] };
  const actions = applicationActions(async (_input, actual) => {
    effects.push(actual.boundAdmission);
    return options.execute ? options.execute(actual) : { value: 7 };
  });
  const catalog = createServiceToolCatalog(actions);
  const hostRuntime = {
    getSession: id => runtimes.get(id).getSession(id),
    store: new Proxy({}, { get(_target, key) {
      const originalStore = runtimes.values().next().value?.store;
      if (typeof originalStore?.[key] !== "function") return originalStore?.[key];
      return (id, ...args) => runtimes.get(id).store[key](id, ...args);
    } })
  };
  owner = createCodexAppServerRunOwner({
    createRuntime: async () => hostRuntime, createStore: async id => runtimes.get(id).store,
    acquireProvider: async () => sharedProvider,
    publish: (id, event) => boundRuntime?.publishNative({ namespace: `main-${id}`, sessionId: id, event }),
    hasRuntime: () => true
  });
  // The fixture's host owns shared-provider retention and scoped cleanup. It
  // supplies the same direct control context used by the original standalone
  // owner, and never closes the process held by the original fixture/peer.
  t.mock.method(owner, "controlContext", (_id, prepared) => prepared);
  t.mock.method(owner, "closeSession", async id => {
    for (const [key, subscription] of owner.eventSubscriptions) {
      if (subscription.sessionId === id) owner.unsubscribeEventSubscription(key);
    }
    owner.clearSessionRecoveryTimers(id);
    return { ok: true };
  });
  for (const id of ["bound-one", "bound-two"]) {
    const segmentId = `original-host-${id}`;
    await storage.write(id, async transaction => transaction.writeMetadata({ runtime: {
      engine: "codex", segmentId, configuration, binding: { threadId: "" }
    } }));
    const store = createCodexConversationStore({ storage, scope: id, segmentId, isCurrent: () => true, transcript, streams });
    const runtime = { store, getSession: store.getSession };
    runtimes.set(id, runtime);
    const readBinding = () => storage.read(id, async transaction => (await transaction.readMetadata()).runtime.binding);
    const identity = { read: async () => (await readBinding()).threadId,
      readToolSchemaIdentity: async () => (await readBinding()).toolSchemaIdentity };
    const messagePreparation = {
      async readContext() {
        const binding = await readBinding();
        return { runtime, session: await runtime.getSession(id), workdir: f.directory, binding,
          selection: { runtime, session: await runtime.getSession(id), threadId: () => binding.threadId,
            acquireProvider: async () => ({ provider: sharedProvider, reused: true }) } };
      },
      threadPreparation(_input, prepared) {
        return { provider: async () => ({ provider: sharedProvider, workdir: f.directory, observerOptions: { providerKey: "bound-shared-original-provider" },
          preparation: { settings: () => ({ threadSettings: initialParams, threadStartSettings: initialParams }),
            identity: { read: () => prepared.binding.threadId,
              readToolSchemaIdentity: () => prepared.binding.toolSchemaIdentity,
              async write({ threadId, toolSchemaIdentity }) {
                await storage.write(id, async transaction => {
                  const metadata = await transaction.readMetadata();
                  metadata.runtime.binding = { ...metadata.runtime.binding, threadId, toolSchemaIdentity };
                  await transaction.writeMetadata(metadata);
                });
              } } } }) };
      },
      async prepareMessage(input, _prepared, { starting }) {
        if (options.prepareMessage) await options.prepareMessage(input, { starting });
        return starting ? { renderedPrompt: input.message, turnSettings: { cwd: f.directory, model: "test-model" } } : null;
      },
      finishMessage(_input, _prepared, outcome) { if (outcome.error) throw outcome.error; }
    };
    bindings.set(id, { sessionId: id, namespace: `main-${id}`, engine: "codex", runtime, identity,
      admission() {}, prepareInput: async input => input,
      applicationTools: { storage, prepareContext(context, admission) {
        mappings.push({ context, admission });
        return { ...context, boundAdmission: admission };
      } },
      read: async () => { const binding = await readBinding(); return { threadId: binding.threadId, configuration,
        run: binding.codexAppServerRun }; },
      readStream: () => Promise.resolve(streams.read(id)),
      state: { read: () => storage.read(id, transaction => transaction.readMetadata()).then(metadata => metadata.delivery),
        write: delivery => storage.write(id, async transaction => {
          const metadata = await transaction.readMetadata(); metadata.delivery = delivery; await transaction.writeMetadata(metadata);
        }) },
      transcript: { history: async () => [], readConversationLog: () => transcript.readConversationLog(id),
        hasMessage: messageId => transcript.conversationMessageIdExists(id, messageId),
        writeUserMessage: input => store.writeConversationUserMessage(id, input) },
      native: { runOwner: owner, providerOwner: {}, messagePreparation,
        admission: () => ({ ok: true, release() {} }),
        controlPreparation: async () => {
          const binding = await readBinding();
          return { runtime, session: await runtime.getSession(id), admissionError: () => null,
            threadId: () => binding.threadId, acquireProvider: async () => sharedProvider };
        },
        preparation: { cleanup: () => ({}) } }
    });
  }
  const runtime = createConversationRuntime({ engine: "codex", toolCatalog: catalog, authorize: () => true,
    host: { ...f.driverOptions.host, conversation: ({ id }) => bindings.get(id) } });
  boundRuntime = runtime;
  const one = await runtime.open({ id: "bound-one", context: actor });
  const two = await runtime.open({ id: "bound-two", context: actor });
  return { ...f, one, two, boundRuntime: runtime, sharedProvider, owner, effects, mappings, bindings, storage, catalog };
}

test("two bound Codex tool threads share the original provider and retain exact receipts through independent Stop", async t => {
  const entered = Promise.withResolvers(), effect = Promise.withResolvers();
  let hold = true;
  const f = await boundCodexToolsFixture(t, { execute: async () => {
    if (hold) { entered.resolve(); return effect.promise; }
    return { value: 7 };
  } });
  await f.one.send({ messageId: "bound-operation-one", text: "tools" });
  await entered.promise;
  assert.equal(f.sharedProvider.threadRequestHandlers.size, 1);
  await f.two.send({ messageId: "bound-peer-wait", text: "wait" });
  assert.equal(f.sharedProvider.threadRequestHandlers.size, 2);
  let stopped = false;
  const stopping = f.one.cancel().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  effect.resolve({ value: 7 });
  await stopping;
  assert.equal((await f.two.read()).status, "working", "Stopping one exact thread retains its peer");
  assert.equal(f.sharedProvider.threadRequestHandlers.size, 1);
  await f.two.send({ messageId: "bound-peer-steer", text: "Continue", steer: true });
  await f.two.wait();
  assert.equal(f.sharedProvider.threadRequestHandlers.size, 0);
  hold = false;
  await f.two.send({ messageId: "bound-operation-two", text: "tools" });
  const second = await f.two.wait();
  const first = await f.one.wait();
  assert.equal(f.effects.length, 2);
  assert.deepEqual(f.effects.map(admission => admission.conversationId), ["bound-one", "bound-two"]);
  assert.deepEqual(f.effects.map(admission => admission.messageId), ["bound-operation-one", "bound-operation-two"]);
  assert.equal(first.conversationLog[0].metadata.applicationTools.length, 3);
  assert.equal(second.conversationLog.at(-1).metadata.applicationTools.length, 3);
  assert.equal(second.conversationLog.at(-1).metadata.applicationTools.at(-1).result.result.result.value, 7);
  const starts = (await f.trace()).filter(row => row.method === "thread/start");
  assert.equal(starts.length, 3, "Only the original seed and two actual native bound threads were created");
  assert.deepEqual(starts[1].params.dynamicTools, codexApplicationToolConfiguration({
    schemas: f.catalog.resolveToolSet({ actor: { id: "bound-owner" }, surface: "app", permissions: ["numbers.read"] }, { discoveryOnly: true }).tools.map(f.catalog.toOpenAiToolSchema)
  }).dynamicTools);
  assert.deepEqual(starts[2].params.dynamicTools, starts[1].params.dynamicTools);
  assert.equal((await f.trace()).filter(row => row.args).length, 1, "All threads retain the original account-shared app-server process");
});

test("bound Codex refuses stale turns, foreign threads and retired handlers without executing their calls", async t => {
  const f = await boundCodexToolsFixture(t);
  await f.one.send({ messageId: "bound-old", text: "Hello" });
  await f.one.wait();
  const oldTurn = codexAppServerTurnState(await f.bindings.get("bound-one").runtime.getSession("bound-one"));
  await f.one.send({ messageId: "bound-current", text: "wait" });
  await f.two.send({ messageId: "bound-peer", text: "wait" });
  const threadId = await f.bindings.get("bound-one").identity.read();
  const handler = f.sharedProvider.threadRequestHandlers.get(threadId).handler;
  const request = { method: "item/tool/call", params: { threadId, turnId: oldTurn.turnId, callId: "stale-call",
    tool: "assistant_action_search", arguments: { query: "numbers" } } };
  f.sharedProvider.observationFailure = { cause: new Error("Unrelated retained observation failure") };
  try { await assert.rejects(handler(request), /another turn/); }
  finally { f.sharedProvider.observationFailure = null; }
  const peerTurn = codexAppServerTurnState(await f.bindings.get("bound-two").runtime.getSession("bound-two"));
  await assert.rejects(handler({ ...request, params: { ...request.params, turnId: peerTurn.turnId } }), /another turn/);
  await assert.rejects(handler({ ...request, params: { ...request.params, namespace: "unsupported" } }), /does not authorize/);
  const currentTurn = codexAppServerTurnState(await f.bindings.get("bound-one").runtime.getSession("bound-one"));
  const originalClient = f.sharedProvider.client;
  f.sharedProvider.client = {};
  try {
    await assert.rejects(handler({ ...request, params: { ...request.params, turnId: currentTurn.turnId } }), /does not authorize/);
  } finally { f.sharedProvider.client = originalClient; }
  assert.equal((await f.one.read()).status, "working");
  assert.equal((await f.two.read()).status, "working");
  assert.equal((await f.trace()).filter(row => row.method === "turn/interrupt").length, 0);
  await f.one.send({ messageId: "healthy-current", text: "Continue", steer: true });
  await f.two.send({ messageId: "healthy-peer", text: "Continue", steer: true });
  await f.one.wait();
  await f.two.wait();
  assert.equal(f.effects.length, 0);
  assert.equal(f.sharedProvider.threadRequestHandlers.size, 0);
  await assert.rejects(handler(request), /does not authorize/);
  await assert.rejects(f.sharedProvider.handleServerRequest({ ...request, params: { ...request.params, threadId: "foreign-thread" } }), /not supported/);
  assert.equal(f.effects.length, 0);
});

test("shared Codex thread registrations retain ownership tokens and Helper request precedence", async t => {
  const provider = new CodexAppServerAgentProvider();
  const calls = [];
  let originalClientRequest;
  provider.client = { setRequestHandler(callback) { originalClientRequest = callback; }, close() {} };
  provider.setServerRequestHandler(async request => { calls.push("fallback"); return request.method; });
  const first = provider.registerThreadRequestHandler("first-thread", async () => "first");
  const peer = provider.registerThreadRequestHandler("peer-thread", async () => "peer");
  const request = threadId => ({ method: "item/tool/call", params: { threadId } });
  assert.equal(await provider.handleServerRequest(request("first-thread")), "first");
  assert.equal(await provider.handleServerRequest(request("peer-thread")), "peer");
  assert.equal(await provider.handleServerRequest({ method: "other", params: { threadId: "peer-thread" } }), "other");
  assert.throws(() => provider.registerThreadRequestHandler("peer-thread", () => {}), /already has/);
  first.release();
  const oldClientRequest = originalClientRequest;
  let replacementClientRequest;
  provider.client = { setRequestHandler(callback) { replacementClientRequest = callback; }, close() {} };
  const replacement = provider.registerThreadRequestHandler("first-thread", async () => "replacement");
  await assert.rejects(oldClientRequest(request("first-thread")), /retired Codex connection/);
  assert.equal(await replacementClientRequest(request("first-thread")), "replacement");
  assert.equal(await replacementClientRequest(request("peer-thread")), "peer");
  first.release();
  assert.equal(replacement.isCurrent(), true);
  assert.equal(peer.isCurrent(), true);
  t.mock.method(provider, "isHelperProvider", () => true);
  t.mock.method(provider, "refreshHelperChatgptAuth", async params => ({ refreshed: params }));
  await assert.rejects(provider.handleServerRequest(request("peer-thread")), /isolated helper/);
  assert.deepEqual(await provider.handleServerRequest({ method: "account/chatgptAuthTokens/refresh", params: { original: true } }), { refreshed: { original: true } });
  assert.deepEqual(await oldClientRequest({ method: "account/chatgptAuthTokens/refresh", params: { oldClient: true } }), { refreshed: { oldClient: true } });
  await assert.rejects(oldClientRequest(request("first-thread")), /isolated helper/);
  assert.deepEqual(calls, ["fallback"]);
  provider.close();
  assert.equal(replacement.isCurrent(), false);
  assert.equal(peer.isCurrent(), false);
  const newer = provider.registerThreadRequestHandler("first-thread", () => "newer");
  replacement.release();
  assert.equal(newer.isCurrent(), true);
  newer.release();
});

test("bound Codex readiness publishes exact schemas before start/resume and rejects retained mismatches", async () => {
  const tools = { schemas: [{ type: "function", function: { name: "stable-tool", description: "Stable", parameters: { type: "object", properties: {} } } }] };
  const configuration = codexApplicationToolConfiguration(tools);
  let threadId = "", schemaIdentity, resumed = 0, started = 0;
  const events = [];
  const provider = { ensureAvailable: async () => ({ runtime: {} }),
    startThread: async params => { started++; assert.deepEqual(params.dynamicTools, configuration.dynamicTools); return { id: "exact-thread" }; },
    resumeThread: async (id, params) => { resumed++; assert.equal(id, threadId); assert.deepEqual(params.dynamicTools, configuration.dynamicTools); return { id }; } };
  const preparation = { provider, workdir: "/original", applicationTools: tools,
    settings: () => ({ threadSettings: { model: "original-model" }, threadStartSettings: { model: "original-model" } }),
    observeThread: id => events.push(["observe", id]), providerReady: value => events.push(["provider", value.threadId]),
    identity: { read: () => threadId, readToolSchemaIdentity: () => schemaIdentity,
      write: value => { threadId = value.threadId; schemaIdentity = value.toolSchemaIdentity; events.push(["write", threadId]); } } };
  await ensureCodexAppServerThread(preparation);
  assert.equal(schemaIdentity, configuration.toolSchemaIdentity);
  assert.deepEqual(events, [["provider", ""], ["write", "exact-thread"], ["provider", "exact-thread"]]);
  events.length = 0;
  await ensureCodexAppServerThread(preparation);
  assert.deepEqual(events, [["provider", "exact-thread"], ["observe", "exact-thread"], ["write", "exact-thread"], ["provider", "exact-thread"]]);
  schemaIdentity = "different-saved-schema";
  await assert.rejects(ensureCodexAppServerThread(preparation), /different application tool entry points/);
  assert.equal(resumed, 1);
  assert.equal(started, 1);
  assert.equal(threadId, "exact-thread");
  assert.equal(schemaIdentity, "different-saved-schema");
  delete preparation.identity.readToolSchemaIdentity;
  await assert.rejects(ensureCodexAppServerThread(preparation), /original schema identity/);
  assert.equal(resumed, 1);
});

test("an owned bound tool failure interrupts only its native thread and preserves the peer", async t => {
  const f = await boundCodexToolsFixture(t, { execute: async () => { throw new Error("Owned action result unavailable"); } });
  await f.two.send({ messageId: "owned-failure-peer", text: "wait" });
  const peerThread = await f.bindings.get("bound-two").identity.read();
  await f.one.send({ messageId: "owned-failure", text: "tools" });
  const failed = await f.one.wait();
  const native = codexAppServerTurnState(await f.bindings.get("bound-one").runtime.getSession("bound-one"));
  assert.equal(native.active, false);
  assert.equal(f.effects.length, 1);
  assert.equal(failed.conversationLog[0].metadata.applicationTools.at(-1).status, "unknown");
  assert.equal((await f.two.read()).status, "working");
  assert.equal(f.sharedProvider.threadRequestHandlers.has(peerThread), true);
  const interrupts = (await f.trace()).filter(row => row.method === "turn/interrupt");
  assert.equal(interrupts.length, 1, "An owned executor failure must stop its admitted native turn");
  assert.equal(interrupts[0].params.threadId, await f.bindings.get("bound-one").identity.read());
  assert.notEqual(interrupts[0].params.threadId, peerThread);
  await f.two.send({ messageId: "owned-failure-peer-finish", text: "Continue", steer: true });
  await f.two.wait();
});


test("closing a bound native owner refuses tool callbacks before and after input readiness and drains cleanup", async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const f = await boundCodexToolsFixture(t, { prepareMessage: async (_input, { starting }) => {
    if (!starting) { entered.resolve(); await release.promise; throw new Error("Held steering refused"); }
  } });
  await f.one.send({ messageId: "closing-owned", text: "wait" });
  await f.two.send({ messageId: "closing-peer", text: "wait" });
  // This direct-provider host has no providerSessions lifecycle. Supply only
  // its controlled shutdown flag, read by the ORIGINAL notification queue.
  let closing = false;
  f.owner.runtimeLifecycle = { get closing() { return closing; } };
  const native = codexAppServerTurnState(await f.bindings.get("bound-one").runtime.getSession("bound-one"));
  const handler = f.sharedProvider.threadRequestHandlers.get(native.threadId).handler;
  const request = { method: "item/tool/call", params: { threadId: native.threadId, turnId: native.turnId,
    callId: "closing-call", tool: "assistant_action_search", arguments: { query: "numbers" } } };
  closing = true;
  try { await assert.rejects(handler(request), /does not authorize/); }
  finally { closing = false; }
  const steering = assert.rejects(f.one.send({ messageId: "closing-held-steer", text: "Continue", steer: true }), /Held steering refused/);
  await entered.promise;
  const heldTool = assert.rejects(handler(request), /does not authorize/);
  await new Promise(resolve => setImmediate(resolve));
  closing = true;
  try {
    release.resolve();
    await steering;
    await heldTool;
  } finally { closing = false; release.resolve(); }
  assert.equal(f.effects.length, 0);
  assert.equal((await f.one.read()).status, "working");
  assert.equal((await f.two.read()).status, "working");
  await f.one.cancel();
  await f.two.cancel();
  await f.owner.notificationQueue.drain("bound-one");
  await f.owner.notificationQueue.drain("bound-two");
  assert.equal(f.sharedProvider.threadRequestHandlers.size, 0);
});

// The original supplied Main owner keeps its own canonical policy. A runtime
// cannot opt that shared owner out of persistence or replace its process.
test("supplied Codex commentary remains host-owned and refuses a runtime opt-out before opening", async t => {
  const f = await boundCodexToolsFixture(t);
  await f.one.send({ messageId: "host-policy-default", text: "blocks" });
  const first = await f.one.wait();
  assert.deepEqual(first.conversationLog.flatMap(turn => turn.commentary || []).map(message => message.text), ["Checking the numbers."]);
  const nativeThreadId = await f.bindings.get("bound-one").identity.read();
  const before = await f.trace();
  const originalOwner = f.bindings.get("bound-one").native.runOwner;
  const refused = createConversationRuntime({ engine: "codex", authorize: () => true, persistCommentary: false,
    host: { ...f.driverOptions.host, conversation: ({ id }) => f.bindings.get(id) } });
  t.after(() => refused.close());
  await assert.rejects(refused.open({ id: "bound-one" }), /runtime-owned transcript/);
  assert.deepEqual(await f.trace(), before, "refusal opens no native thread and issues no request or interrupt");
  assert.equal(f.bindings.get("bound-one").native.runOwner, originalOwner);
  await f.one.send({ messageId: "host-policy-continue", text: "Continue" });
  const continued = await f.one.wait();
  assert.equal(continued.conversationLog.at(-1).assistant.text, "Answer: Continue");
  assert.equal(await f.bindings.get("bound-one").identity.read(), nativeThreadId);
  assert.deepEqual(f.effects, []);
});


test("default Codex commentary publishes its saved output identity rather than a second transient completion", async t => {
  const f = await fixture(t);
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  await f.conversation.send({ messageId: "default-carrier-dedup", text: "blocks" });
  const state = await f.conversation.wait();
  const progress = state.conversationLog.flatMap(turn => turn.commentary || []);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].text, "Checking the numbers.");
  assert.notEqual(progress[0].messageId, progress[0].outputId);
  const completed = events.filter(event => event.type === "message" && event.role === "commentary" && event.status === "complete");
  assert.ok(completed.length);
  assert.equal(completed.every(event => event.messageId === progress[0].messageId), true,
    "The existing canonical publication owns this exact output; its native stream must not complete a second identity");
  assert.equal(completed.every(event => event.outputId === progress[0].outputId && event.text === progress[0].text), true);
  assert.equal((await f.conversation.read()).streaming.completedMessages, undefined);
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
});


for (const text of ["blocks", "blocks-without-phase"]) test(`transient Codex completed ${text} waits for its exact accepted publication without replay`, async t => {
  let runtime;
  t.after(() => runtime?.close());
  const f = await fixture(t);
  await f.first.close();
  runtime = createConversationRuntime({ engine: "codex", storage: f.storage, authorize: () => true,
    persistCommentary: false, host: f.driverOptions.host, limits: f.driverOptions.limits });
  const conversation = await runtime.open({ id: "conversation" });
  const events = [];
  await conversation.subscribe(event => events.push(event));
  const receipt = await conversation.send({ messageId: "transient-admission-order", text });
  const state = await conversation.wait();
  assert.equal(state.status, "ready", state.error);
  const accepted = events.findIndex(event => event.type === "accepted" && event.messageId === receipt.messageId);
  assert.ok(accepted >= 0);
  const progress = events.filter(event => event.type === "message" && event.status === "complete" &&
    event.role === "commentary" && event.text === "Checking the numbers.");
  assert.equal(progress.length, 1);
  assert.ok(events.indexOf(progress[0]) > accepted, "The exact accepted event must precede this completed native carrier");
  assert.equal(progress[0].turnId, receipt.turnId);
  assert.equal(progress[0].origin, "user");
  assert.deepEqual(state.conversationLog.flatMap(turn => turn.commentary || []), []);
  assert.deepEqual(state.conversationLog.filter(turn => turn.assistant).map(turn => turn.assistant.text),
    [`Answer: ${text}`, "The second paragraph."]);
  const count = events.length;
  assert.equal((await conversation.read()).streaming.completedMessages, undefined);
  assert.equal((await conversation.read()).streaming.completedMessages, undefined);
  assert.equal(events.length, count, "Ordinary reads cannot replay completed progress");
  assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
});


for (const ending of ["steer", "close"]) test(`transient native completion declines ${ending} after subscriber authorization starts`, { timeout: 10_000 }, async t => {
  const authorization = Promise.withResolvers();
  const releaseAuthorization = Promise.withResolvers();
  t.after(() => releaseAuthorization.resolve());
  let runtime;
  t.after(() => runtime?.close());
  const f = await fixture(t);
  await f.first.close();
  const command = path.join(f.directory, "codex.mjs");
  const original = await readFile(command, "utf8");
  const marker = 'emitTurn("item/completed", { item: progress });';
  assert.equal(original.split(marker).length, 2, "The original generated progress completion is transformed exactly once");
  const gated = original.replace(marker, `
          while (!existsSync(file + ".r07-release-completion") && ws.readyState === 1) await new Promise(resolve => setTimeout(resolve, 5));
          ${marker}
          while (!existsSync(file + ".r07-release-final") && ws.readyState === 1) await new Promise(resolve => setTimeout(resolve, 5));`);
  const [prefix, suffix] = original.split(marker);
  assert.equal(gated.startsWith(prefix), true);
  assert.equal(gated.endsWith(suffix), true, "All other original native command behavior remains unchanged");
  await writeFile(command, gated);
  let armed = false, claimed = false;
  runtime = createConversationRuntime({ engine: "codex", storage: f.storage, persistCommentary: false,
    host: f.driverOptions.host, limits: f.driverOptions.limits, async authorize({ operation }) {
      if (operation === "subscribe" && armed && !claimed) {
        claimed = true;
        authorization.resolve();
        await releaseAuthorization.promise;
      }
      return true;
    } });
  const conversation = await runtime.open({ id: "conversation" });
  const events = [];
  const firstDelta = Promise.withResolvers();
  const initialWorking = Promise.withResolvers();
  await conversation.subscribe(event => {
    events.push(event);
    if (event.type === "phase" && event.phase === "working") initialWorking.resolve();
    if (event.type === "message" && event.status === "inProgress" && event.text === "Checking the numbers.") firstDelta.resolve();
  });
  const first = await conversation.send({ messageId: "predecessor-race", text: "blocks" });
  await firstDelta.promise;
  await initialWorking.promise;
  assert.equal(events.some(event => event.type === "accepted" && event.messageId === first.messageId), true);
  // The original accepted and working events have been published. Allow their
  // synchronous authorization continuation to finish the delivery commit.
  await new Promise(resolve => setImmediate(resolve));
  armed = true;
  await writeFile(path.join(f.directory, "history.json.r07-release-completion"), "release");
  await authorization.promise;
  if (ending === "steer") {
    const successor = await conversation.send({ messageId: "successor-race", text: "Keep the successor", steer: true });
    assert.notEqual(successor.turnId, first.turnId);
    releaseAuthorization.resolve();
    const state = await conversation.wait();
    assert.equal(state.status, "ready", state.error);
    assert.equal(events.some(event => event.type === "accepted" && event.messageId === "successor-race"), true);
    assert.equal(events.some(event => event.type === "message" && event.status === "complete" &&
      event.turnId === successor.turnId && event.text === "Steered: Keep the successor"), true,
      "Declining the sealed carrier retains the legitimate successor subscription");
    assert.equal((await f.trace()).filter(row => row.method === "turn/steer").length, 1);
  } else {
    const closing = runtime.close();
    releaseAuthorization.resolve();
    await closing;
    await assert.rejects(conversation.read(), { code: "conversation_closed" });
  }
  assert.equal(events.some(event => event.type === "message" && event.status === "complete" &&
    event.role === "commentary" && event.text === "Checking the numbers."), false,
    "Subscriber authorization must not deliver the stale completed carrier after its owner changes");
});

// The original controlled app-server owns every generated thread and turn below.
const completedCodexValue = { kind: "tool", text: "Checking.", toolName: "numbers_read", arguments: "{}" };
const completedCodexSchema = { type: "object", additionalProperties: false,
  required: ["kind", "text", "toolName", "arguments"],
  properties: { kind: { type: "string", enum: ["reply", "tool"] }, text: { type: "string", maxLength: 64 },
    toolName: { type: "string", maxLength: 64 }, arguments: { type: "string", maxLength: 64 } } };
async function completedCodexFixture(t, options = {}) {
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  let effects = 0;
  const appendedRows = [];
  const actions = applicationActions(async () => { effects++; return { value: 42 }; });
  const f = await fixture(t, { ...options, context, actions, structuredResponse: completedCodexValue,
    configuration: { ...configuration, outputSchema: completedCodexSchema, ...options.configuration },
    storage: disk => ({ ...disk, write: (id, callback) => disk.write(id, transaction => callback({ ...transaction,
      async appendMessage(turnId, message) {
        await transaction.appendMessage(turnId, message);
        if (message.role === "system" && message.origin === "application") {
          appendedRows.push(structuredClone(await transaction.readTurn(turnId)));
        }
      }
    })) }) });
  await f.first.close();
  let runtime;
  let conversation;
  async function reopen() {
    if (runtime) await runtime.close();
    runtime = createConversationRuntime({ engine: "codex", storage: f.storage, actions,
      authorize: () => true, completedEnvelope: true, ...f.driverOptions });
    try { conversation = await runtime.open({ id: "conversation", context }); }
    catch (error) { await runtime.close(); throw error; }
    return conversation;
  }
  await reopen();
  const controller = new AbortController();
  return { ...f, controller, appendedRows, context, actions, effects: () => effects, reopen,
    get conversation() { return conversation; }, close: () => runtime.close(),
    async complete(messageId = "completed-codex-response") {
      const receipt = await conversation.wake({ messageId, text: "Read a number" });
      const state = await conversation.wait();
      const turn = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
      assert.equal(turn.metadata.runtime.status, "complete", state.error);
      assert.equal(turn.assistant.text, JSON.stringify(completedCodexValue));
      return { messageId, turnId: receipt.turnId };
    },
    prepare: receipt => conversation.prepareCompletedResponse(receipt, { signal: controller.signal }) };
}
const executeCompletedCodex = (prepared, argumentsText = "{}") => prepared.tools.execute({
  id: prepared.toolCallId, name: "numbers_read", arguments: argumentsText
});

test("completed Codex canonical admission preserves its trusted marker and actual native completed tuple", async t => {
  const f = await completedCodexFixture(t);
  try {
    const receipt = await f.complete();
    const firstAppend = f.appendedRows.find(row => row.system.messageId === receipt.messageId);
    assert.ok(firstAppend, "The actual canonical writer must append the admitted application row");
    assert.equal(firstAppend.user, null);
    assert.equal(firstAppend.system.origin, "application");
    assert.equal(firstAppend.metadata.runtime.completedEnvelope, true);
    assert.equal(firstAppend.metadata.runtime.status, "running");
    const metadata = await f.storage.read("conversation", tx => tx.readMetadata());
    const turn = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    const run = metadata.runtime.binding.codexAppServerRun;
    const savedHistory = JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8"));
    const nativeThread = (savedHistory.threads || [savedHistory]).find(row => row.id === metadata.runtime.binding.threadId);
    const nativeTurn = nativeThread.turns.find(row => row.id === turn.metadata.runtime.nativeTurnId);
    assert.ok(nativeTurn, "The original app-server must persist this generated native turn");
    assert.equal(nativeTurn.status, "completed");
    assert.equal(nativeTurn.items.find(row => row.type === "userMessage").clientId, receipt.messageId);
    assert.equal(nativeTurn.items.find(row => row.type === "agentMessage").text, turn.assistant.text);
    assert.equal(turn.metadata.runtime.completedEnvelope, true);
    assert.equal(turn.metadata.runtime.origin, "application");
    assert.equal(turn.metadata.runtime.segmentId, metadata.runtime.segmentId);
    assert.equal(turn.metadata.runtime.nativeTurnId, firstAppend.metadata.runtime.nativeTurnId);
    assert.equal(run.outerTurnId, receipt.messageId);
    assert.equal(run.providerThreadId, nativeThread.id);
    assert.equal(run.providerTurnId, nativeTurn.id);
    assert.equal(run.state, "completed");
    assert.equal(run.active, false);
    assert.equal(f.effects(), 0);
    const starts = (await f.trace()).filter(row => row.method === "turn/start");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].params.clientUserMessageId, receipt.messageId);
    assert.equal((await f.trace()).find(row => row.method === "thread/start").params.dynamicTools.length, 0);
  } finally { await f.close(); }
});

test("completed Codex prepared handles and reopen retain one durable effect without native replay", async t => {
  const f = await completedCodexFixture(t);
  try {
    const receipt = await f.complete();
    const one = await f.prepare(receipt), two = await f.prepare(receipt);
    assert.equal(one.text, JSON.stringify(completedCodexValue));
    assert.equal(one.toolCallId, `${receipt.messageId}:operation`);
    assert.equal(two.toolCallId, one.toolCallId);
    const [first, second] = await Promise.all([executeCompletedCodex(one), executeCompletedCodex(two)]);
    assert.equal(first.ok, true);
    assert.deepEqual(second, first);
    assert.equal(f.effects(), 1);
    await assert.rejects(executeCompletedCodex(two, '{"changed":true}'), /different arguments/);
    const before = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(before.metadata.applicationTools.length, 1);
    assert.equal(before.metadata.applicationTools[0].id, one.toolCallId);
    assert.equal(before.metadata.applicationTools[0].status, "complete");
    await f.reopen();
    assert.deepEqual(await executeCompletedCodex(await f.prepare(receipt)), first);
    assert.deepEqual(await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId)), before);
    assert.equal(f.effects(), 1);
    assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
    assert.equal((await f.trace()).filter(row => row.method === "thread/start").length, 1);
  } finally { await f.close(); }
});

test("completed Codex cached bindings cannot mask missing or changed persisted native fingerprints", async t => {
  const f = await completedCodexFixture(t);
  try {
    const receipt = await f.complete();
    await f.prepare(receipt);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    for (const missing of [true, false]) {
      const changed = structuredClone(before);
      if (missing) delete changed.runtime.binding.accountIdentity;
      else changed.runtime.binding.accountIdentity = "different-persisted-fixture-identity";
      await f.storage.write("conversation", tx => tx.writeMetadata(changed));
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          await assert.rejects(f.prepare(receipt), missing ? /no saved native account fingerprint/ : /different native account binding/);
          assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), changed);
        }
      } finally { await f.storage.write("conversation", tx => tx.writeMetadata(before)); }
    }
    assert.equal(f.effects(), 0);
    assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
  } finally { await f.close(); }
});

test("completed Codex cached processes still read the actual native account before an effect", async t => {
  const f = await completedCodexFixture(t);
  try {
    const receipt = await f.complete();
    await f.prepare(receipt);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    const reads = (await f.trace()).filter(row => row.method === "account/read").length;
    await writeFile(f.account, "another@example.test");
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(f.prepare(receipt), /another Codex account/);
        assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), before);
      }
      assert.ok((await f.trace()).filter(row => row.method === "account/read").length >= reads + 2);
      assert.equal(f.effects(), 0);
      assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
    } finally { await writeFile(f.account, "owner@example.test"); }
  } finally { await f.close(); }
});

test("completed Codex foreign accounts compare persisted cached and freshly resolved identity without promotion", async t => {
  let apiKey = "completed-codex-original-fixture-key";
  const f = await completedCodexFixture(t, { configuration: { model: undefined, integrationId: "foreign", effort: "low" },
    connections: { resolve: async () => ({ providerId: "deepseek", model: "deepseek-flash", apiKey }) } });
  try {
    const receipt = await f.complete();
    await f.prepare(receipt);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    for (const missing of [true, false]) {
      const changed = structuredClone(before);
      if (missing) delete changed.runtime.binding.connectionIdentities.deepseek;
      else changed.runtime.binding.connectionIdentities.deepseek = "different-persisted-fixture-identity";
      await f.storage.write("conversation", tx => tx.writeMetadata(changed));
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          await assert.rejects(f.prepare(receipt), missing ? /no saved provider account fingerprint/ : /different provider account binding/);
          assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), changed);
        }
      } finally { await f.storage.write("conversation", tx => tx.writeMetadata(before)); }
    }
    apiKey = "completed-codex-changed-fixture-key";
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.prepare(receipt), /different provider account binding/);
      assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), before);
    }
    assert.equal(f.effects(), 0);
    assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
    assert.equal((await f.trace()).filter(row => row.method === "turn/interrupt").length, 0);
  } finally { apiKey = "completed-codex-original-fixture-key"; await f.close(); }
});

test("completed Codex response custody refuses foreign native tuples and host scope before effects", async t => {
  const f = await completedCodexFixture(t);
  try {
    const receipt = await f.complete();
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    const row = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    for (const alter of [
      binding => { binding.codexAppServerRun.outerTurnId = "different-authored-request"; },
      binding => { binding.codexAppServerRun.providerThreadId = "foreign-native-thread"; },
      binding => { binding.codexAppServerRun.providerTurnId = "foreign-native-turn"; },
      binding => { binding.codexAppServerRun.active = true; },
      binding => { binding.codexAppServerRun.state = "failed"; },
      binding => { binding.workdir = "/different-fixture-workdir"; },
      binding => { binding.configRoot = "/different-fixture-config-root"; }
    ]) {
      const changed = structuredClone(before); alter(changed.runtime.binding);
      await f.storage.write("conversation", tx => tx.writeMetadata(changed));
      try {
        await assert.rejects(f.prepare(receipt), /no exact native turn receipt|different native conversation or host scope/);
        assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), changed);
        assert.deepEqual(await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId)), row);
      } finally { await f.storage.write("conversation", tx => tx.writeMetadata(before)); }
    }
    await f.storage.write("conversation", tx => tx.updateTurnMetadata(receipt.turnId, {
      runtime: { ...row.metadata.runtime, nativeTurnId: "foreign-canonical-turn" }
    }));
    try { await assert.rejects(f.prepare(receipt), /no exact native turn receipt/); }
    finally { await f.storage.write("conversation", tx => tx.updateTurnMetadata(receipt.turnId, { runtime: row.metadata.runtime })); }
    assert.equal(f.effects(), 0);
    assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, 1);
  } finally { await f.close(); }
});

test("completed Codex caller markers do not replace ordinary native discovery or create completion authority", async t => {
  const f = await completedCodexFixture(t);
  try {
    const receipt = await f.conversation.send({ messageId: "ordinary-codex", text: "tools", data: { completedEnvelope: true } });
    const state = await f.conversation.wait();
    const turn = state.conversationLog.find(row => row.turnId === receipt.turnId);
    assert.equal(turn.metadata.runtime.status, "complete", state.error);
    assert.equal(turn.metadata.runtime.completedEnvelope, undefined);
    assert.equal(f.effects(), 0, "Caller data does not itself request or authorize an effect");
    const initialTrace = await f.trace();
    assert.deepEqual(initialTrace.find(row => row.method === "thread/start").params.dynamicTools.map(tool => tool.name),
      ["assistant_action_search", "assistant_action_contract", "assistant_action_execute"]);
    assert.match(initialTrace.find(row => row.method === "turn/start").params.input[0].text, /\[Application data\]/);
    await assert.rejects(f.prepare({ messageId: "ordinary-codex", turnId: receipt.turnId }), /no current verified receipt/);
    // The original controlled CLI invokes discovery only for exact plain "tools".
    const toolReceipt = await f.conversation.send({ messageId: "ordinary-tools", text: "tools" });
    const toolsState = await f.conversation.wait();
    const toolsTurn = toolsState.conversationLog.find(row => row.turnId === toolReceipt.turnId);
    assert.equal(toolsTurn.metadata.runtime.status, "complete", toolsState.error);
    assert.equal(toolsTurn.metadata.runtime.completedEnvelope, undefined);
    assert.equal(toolsTurn.metadata.applicationTools.length, 3);
    assert.equal(f.effects(), 1);
    await assert.rejects(f.prepare({ messageId: "ordinary-tools", turnId: toolReceipt.turnId }), /no current verified receipt/);
    const trace = await f.trace();
    assert.equal(trace.filter(row => row.method === "thread/start").length, 1);
    const starts = trace.filter(row => row.method === "turn/start");
    assert.equal(starts.length, 2);
    assert.equal(starts[1].params.input[0].text, "tools");
  } finally { await f.close(); }
});

for (const markedFirst of [true, false]) test(`completed Codex ${markedFirst ? "marked to ordinary" : "ordinary to marked"} transitions retain the original incompatible-schema refusal`, async t => {
  const f = await completedCodexFixture(t);
  try {
    if (markedFirst) await f.complete();
    else {
      await f.conversation.send({ messageId: "ordinary-first", text: "tools" });
      const state = await f.conversation.wait();
      assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
      assert.equal(state.conversationLog[0].metadata.applicationTools.length, 3);
    }
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    const starts = (await f.trace()).filter(row => row.method === "turn/start").length;
    const effects = f.effects();
    const submit = markedFirst
      ? f.conversation.send({ messageId: "ordinary-next", text: "tools" })
      : f.conversation.wake({ messageId: "marked-next", text: "Read a number" });
    await assert.rejects(submit, /different application tool entry points/);
    assert.equal(f.effects(), effects);
    assert.equal((await f.trace()).filter(row => row.method === "turn/start").length, starts);
    const after = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.equal(after.runtime.binding.threadId, before.runtime.binding.threadId);
    assert.equal(after.runtime.binding.toolSchemaIdentity, before.runtime.binding.toolSchemaIdentity);
    assert.equal(after.runtime.binding.accountIdentity, before.runtime.binding.accountIdentity);
    assert.equal((await f.trace()).filter(row => row.method === "turn/interrupt").length, 0);
  } finally { await f.close(); }
});


test("completed Codex human presentation retains product history and private actual native receipts", async t => {
  const f = await completedCodexFixture(t);
  const events = [];
  const observations = [];
  await f.conversation.subscribe(event => {
    events.push(event);
    if (event.type === "message" && event.completedEnvelope === true) observations.push(f.conversation.read());
  });
  try {
    await f.storage.write("conversation", async tx => {
      await tx.appendMessage("000001", { role: "user", messageId: "product-question", text: "Visible product question",
        at: "2026-10-10T00:00:00.000Z" });
      await tx.replaceAssistant("000001", { role: "assistant", messageId: "product-reply", text: "Visible prior reply",
        at: "2026-10-10T00:00:01.000Z" });
    });
    const receipt = await f.complete("internal-presentation-response");
    const state = await f.conversation.read();
    assert.equal(state.status, "ready", state.error);
    assert.equal(state.error, "");
    assert.equal(state.pendingRequest, null);
    assert.deepEqual(state.streaming.messages, []);
    assert.deepEqual(state.conversationLog.map(turn => turn.turnId), ["000001"]);
    assert.equal(state.conversationLog[0].user.messageId, "product-question");
    assert.equal(state.conversationLog[0].assistant.messageId, "product-reply");
    assert.equal(state.conversationLog[0].assistant.text, "Visible prior reply");
    const page = await f.conversation.read({ limit: 1, presentation: false });
    assert.deepEqual(page.conversationLog, state.conversationLog);
    assert.equal(page.pagination.totalTurnCount, 1);
    assert.equal(page.pagination.count, 1);
    assert.equal(page.pagination.oldestTurnId, "000001");
    assert.equal(page.pagination.newestTurnId, "000001");
    assert.equal(page.pagination.hasMoreBefore, false);
    const raw = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    const metadata = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.equal(raw.system.messageId, receipt.messageId);
    assert.equal(raw.metadata.runtime.completedEnvelope, true);
    assert.equal(raw.metadata.runtime.status, "complete");
    assert.equal(raw.metadata.runtime.segmentId, state.segmentId);
    assert.equal(raw.assistant.text, JSON.stringify(completedCodexValue));
    assert.ok(raw.metadata.runtime.nativeTurnId);
    assert.equal(metadata.runtime.binding.codexAppServerRun.providerTurnId, raw.metadata.runtime.nativeTurnId);
    assert.equal(metadata.runtime.binding.codexAppServerRun.outerTurnId, receipt.messageId);
    const savedHistory = JSON.parse(await readFile(path.join(f.directory, "history.json"), "utf8"));
    const nativeThread = (savedHistory.threads || [savedHistory]).find(thread => thread.id === metadata.runtime.binding.threadId);
    const nativeTurn = nativeThread.turns.find(turn => turn.id === raw.metadata.runtime.nativeTurnId);
    assert.equal(nativeTurn.status, "completed");
    assert.equal(nativeTurn.items.find(item => item.type === "userMessage").clientId, receipt.messageId);
    assert.equal(nativeTurn.items.find(item => item.type === "agentMessage").text, raw.assistant.text);
    const rawFinal = events.filter(event => event.type === "message" && event.status === "complete")
      .find(event => event.turnId === receipt.turnId && event.text === raw.assistant.text);
    assert.ok(rawFinal, "The raw worker subscriber still receives this actual native completed response");
    assert.equal(rawFinal.completedEnvelope, true);
    assert.ok(events.some(event => event.type === "message" && event.status === "inProgress" &&
      event.completedEnvelope === true && event.streaming.messages.some(message => message.completedEnvelope === true)),
    "The original app-server emits a trusted marked native stream, not a manufactured canonical completion");
    assert.ok(observations.length);
    for (const observed of await Promise.all(observations)) {
      assert.ok(["working", "ready"].includes(observed.status), observed.error);
      assert.deepEqual(observed.conversationLog.map(turn => turn.turnId), ["000001"]);
      assert.equal(observed.pendingRequest, null);
      assert.deepEqual(observed.streaming.messages, []);
    }
    const trace = await f.trace();
    const starts = trace.filter(row => row.method === "turn/start");
    assert.equal(starts.length, 1);
    assert.equal(starts[0].params.clientUserMessageId, receipt.messageId);
    assert.equal(trace.find(row => row.method === "thread/start").params.dynamicTools.length, 0);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});
