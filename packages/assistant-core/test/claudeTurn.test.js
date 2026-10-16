import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeConversationTurn, claudeNativeMessageId, runClaudeRenewalTurn,
  waitForClaudeConversationTurn } from "../src/server/conversation/claudeTurn.js";

function fixture() {
  const events = [];
  const turn = createClaudeConversationTurn({ conversationId: "native-session", onEvent: async event => events.push(event) });
  const client = { async send(_message, { messageId }) {
    await turn.receive({ type: "user", uuid: messageId, session_id: "native-session" });
  }, async interrupt() {} };
  const send = (id = "first", options = {}) => turn.send(client, "Hello", {
    messageId: claudeNativeMessageId(id), accept: async () => {}, ...options
  });
  turn.begin({ id: "turn-1" });
  return { turn, events, client, send };
}

test("native local command output retains protocol provenance through transcript storage", async () => {
  const { createConversationTranscript, createMemoryConversationStorage } = await import("../src/server/conversation/index.js");
  const { turn, send, events } = fixture();
  await send();
  await turn.receive({ type: "system", subtype: "local_command_output", uuid: "goal-confirmation", content: "Goal cleared: Finish checks" });
  const message = events.find(event => event.type === "message").message;
  assert.deepEqual(message.data, { native: { engineId: "claude", type: "system", subtype: "local_command_output" } });
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  await transcript.writeConversationUserMessage("test", { messageId: "user", text: "/goal clear" });
  await transcript.writeConversationCommentaryMessage("test", { ...message, messageId: message.id });
  const [saved] = await transcript.readConversationLog("test");
  assert.deepEqual(saved.commentary[0].data, message.data);
  message.data.native.subtype = "changed";
  assert.equal((await transcript.readConversationLog("test"))[0].commentary[0].data.native.subtype, "local_command_output");
  turn.stop();
});

test("actual Claude synthetic goal confirmations retain command provenance without relabelling ordinary replies", async () => {
  const { turn, send, events } = fixture();
  await send();
  // Captured from Claude 2.1.289's stream-json /goal clear operation. Native
  // history stores system/local_command, but the live protocol uses assistant.
  await turn.receive({ type: "assistant", uuid: "clear-confirmation", local_command_run: { command: "goal", args: "clear" },
    local_command_source: "<local-command-stdout>No goal set</local-command-stdout>",
    message: { id: "synthetic-command", model: "<synthetic>", stop_reason: "end_turn", content: [{ type: "text", text: "No goal set" }] } });
  await turn.receive({ type: "result", subtype: "success", local_command: "goal", result: "No goal set" });
  const output = events.filter(event => event.type === "message" && event.message.complete);
  assert.equal(output.length, 1, "The result does not duplicate its synthetic assistant carrier");
  assert.deepEqual(output[0].message.data, { native: { engineId: "claude", type: "assistant", command: "goal", output: "stdout" } });
  const transcript = createConversationTranscript({ storage: createMemoryConversationStorage() });
  await transcript.writeConversationUserMessage("test", { messageId: "clear", text: "/goal clear" });
  await transcript.writeConversationAssistantMessage("test", { ...output[0].message, messageId: output[0].message.id });
  assert.deepEqual((await transcript.readConversationLog("test"))[0].assistant.data, output[0].message.data);
  turn.begin({ id: "ordinary" });
  await send("ordinary");
  await turn.receive({ type: "assistant", uuid: "ordinary-answer", message: { id: "ordinary-api", model: "haiku", stop_reason: "end_turn",
    content: [{ type: "text", text: "Goal set: I will work through the checks." }] } });
  assert.equal(events.findLast(event => event.type === "message").message.data, undefined);
  turn.stop();
});

test("Claude local-command error output stays distinguishable and result-only success retains provenance", async () => {
  const { turn, send, events } = fixture();
  await send();
  await turn.receive({ type: "assistant", uuid: "command-error", local_command_run: { command: "goal", args: "invalid" },
    local_command_source: "<local-command-stderr>Goal cannot be changed</local-command-stderr>",
    message: { id: "error-command", stop_reason: "end_turn", content: [{ type: "text", text: "Goal cannot be changed" }] } });
  assert.deepEqual(events.find(event => event.type === "message").message.data,
    { native: { engineId: "claude", type: "assistant", command: "goal", output: "stderr" } });
  turn.stop();
  turn.begin({ id: "result-only" });
  await send("result-only");
  await turn.receive({ type: "result", subtype: "success", local_command: "goal", result: "Goal cleared: Previous objective" });
  assert.deepEqual(events.findLast(event => event.type === "message").message.data,
    { native: { engineId: "claude", type: "result", command: "goal", output: "stdout" } });
});

test("a pipe write is not admission; queued and replayed acknowledgements persist the user exactly once", async () => {
  const { turn, client, send, events } = fixture();
  client.send = async () => {};
  let saved = 0;
  let delivered = false;
  const sending = send("first", { accept: async () => { saved += 1; } }).then(() => { delivered = true; });
  await turn.receive({ type: "user", uuid: "tool-result" });
  await Promise.resolve();
  assert.equal(delivered, false);
  const uuid = claudeNativeMessageId("first");
  await turn.receive({ type: "command_lifecycle", command_uuid: uuid, state: "queued" });
  await sending;
  await turn.receive({ type: "user", uuid });
  assert.equal(saved, 1);
  assert.equal(events.filter(event => event.type === "admitted").length, 2);
  turn.stop();
});

test("steering waits for the generation's terminal event after the control acknowledgement", async () => {
  const { turn, send, client, events } = fixture();
  await send();
  let interrupted = false;
  const steering = turn.interruptGeneration(client).then(() => { interrupted = true; });
  await Promise.resolve();
  assert.equal(interrupted, false);
  await turn.receive({ type: "result", subtype: "success", terminal_reason: "aborted_streaming", result: "" });
  await steering;
  assert.equal(events.some(event => event.type === "settled"), false);
  await send("follow-up");
  await turn.receive({ type: "result", subtype: "success", result: "Revised answer" });
  assert.equal(turn.read().text, "Revised answer");
  assert.equal(turn.read().status, "completed");
});

test("interrupted Claude output keeps its input identity after a follow-up is accepted", async t => {
  const f = await publishedClaudeFixture(t);
  await f.owner.send(f.entry, { messageId: "first", message: "First request" });
  const native = f.processes.at(-1);
  await native.options.onEvent({ type: "stream_event", event: { type: "message_start", message: { id: "first-api" } } });
  await native.options.onEvent({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  await native.options.onEvent({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { text: "FIRST-PARTIAL" } } });
  await native.options.onEvent({ type: "assistant", uuid: "first-output", message: { id: "first-api", content: [{ type: "text", text: "FIRST-PARTIAL" }] } });
  await f.owner.send(f.entry, { messageId: "second", message: "Second request" });
  await native.options.onEvent({ type: "assistant", uuid: "second-output", message: { id: "second-api", content: [{ type: "text", text: "SECOND-OK" }], stop_reason: "end_turn" } });
  await native.options.onEvent({ type: "result", subtype: "success", result: "SECOND-OK" });
  const read = await f.owner.read(f.entry, { messageId: "second", requestMessageIds: ["first", "second"] });
  assert.equal(read.messages.find(message => message.text === "FIRST-PARTIAL").requestMessageId, "first");
  assert.equal(read.messages.find(message => message.text === "FIRST-PARTIAL").role, "commentary");
  assert.equal(read.messages.find(message => message.text === "SECOND-OK").requestMessageId, "second");
  // A cold read uses the original native input identities, without live state.
  const directory = path.join(f.context.workdir, "projects", f.context.workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${f.conversationId}.jsonl`), [
    { type: "user", uuid: claudeNativeMessageId("first"), message: { content: "First request" } },
    { type: "assistant", uuid: "first-output", message: { id: "first-api", content: [{ type: "text", text: "FIRST-PARTIAL" }] } },
    { type: "user", uuid: claudeNativeMessageId("second"), message: { content: "Second request" } },
    { type: "assistant", uuid: "second-output", message: { id: "second-api", content: [{ type: "text", text: "SECOND-OK" }] } }
  ].map(JSON.stringify).join("\n") + "\n");
  f.entry.nativeTurn.reset();
  const restored = await f.owner.read(f.entry, { messageId: "second", requestMessageIds: ["first", "second"] });
  assert.deepEqual(restored.messages.map(message => [message.text, message.requestMessageId]),
    [["FIRST-PARTIAL", "first"], ["SECOND-OK", "second"]]);
});

for (const savedFrame of [false, true]) test(`verified Claude Stop retains partial output for transcript reads, savedFrame=${savedFrame}`, async t => {
  const f = await publishedClaudeFixture(t);
  await f.send("stopped-request");
  await f.frame({ type: "stream_event", event: { type: "message_start", message: { id: "stopped-api" } } });
  await f.frame({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  await f.frame({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { text: "Already visible partial answer" } } });
  if (savedFrame) await f.frame({ type: "assistant", uuid: "stopped-output", message: { id: "stopped-api",
    content: [{ type: "text", text: "Already visible partial answer" }] } });
  // The control acknowledgement need not deliver a terminal generation frame
  // before the managed process is drained, as observed in the live Stop case.
  const native = f.entry.process;
  native.client.interrupt = async () => {};
  native.stop = async () => ({ scopeEmpty: false, exited: false });
  await assert.rejects(f.owner.interrupt(f.entry), { code: "claude_stop_unconfirmed" });
  const unconfirmed = await f.owner.read(f.entry, { messageId: "stopped-request" });
  assert.equal(unconfirmed.messages.find(m => m.text === "Already visible partial answer").complete, false);
  native.stop = async () => ({ scopeEmpty: true, exited: true });
  await f.owner.interrupt(f.entry);
  const stopped = await f.owner.read(f.entry, { messageId: "stopped-request" });
  assert.equal(stopped.status, "interrupted");
  assert.equal(stopped.messages.length, 1, "Saved-frame and streaming aliases are one interrupted output");
  assert.deepEqual(stopped.messages.map(m => ({ text: m.text, role: m.role, complete: m.complete,
    requestMessageId: m.requestMessageId, outputId: m.outputId })), [{
    text: "Already visible partial answer", role: "commentary", complete: true,
    requestMessageId: "stopped-request", outputId: "claude_stopped-api_0"
  }]);
  assert.equal(f.final(), null, "An interrupted partial is never a completed answer receipt");
  await f.owner.interrupt(f.entry);
  assert.deepEqual((await f.owner.read(f.entry, { messageId: "stopped-request" })).messages, stopped.messages);
  const { readPersistentConversation, projectStoredPersistentConversation } = await import("../src/server/conversation/providers/scoped.js");
  const transcript = createConversationTranscript({ storage: createMemoryConversationStorage() });
  const store = Object.fromEntries(Object.entries(transcript).map(([name, operation]) =>
    [name, (scope, ...args) => operation(JSON.stringify([scope.sessionId, scope.conversationId]), ...args)]));
  store.readConversationStream = () => ({ messages: [] });
  const scope = { sessionId: "session", conversationId: "temporary" };
  await store.writeConversationUserMessage(scope, { messageId: "stopped-request", text: "Explain" });
  const options = { ...scope, store, context: {},
    record: { conversationId: "temporary", providerConversationId: f.conversationId, messageId: "stopped-request", status: "interrupted" },
    operations: { readConversation: (_sessionId, input) => f.owner.read(f.entry, input) },
    records: { input: (record, input) => ({ ...record, ...input }), save: async (_context, record, patch) => ({ ...record, ...patch }) },
    receipts: { persisted: () => true },
    projection: { context: context => context, messageScope: (_context, scope) => scope,
      message: message => message, messageMetadata: () => ({}), snapshot: value => value }, publish: async () => {}
  };
  await readPersistentConversation(options);
  await readPersistentConversation(options);
  f.entry.nativeTurn.reset();
  const restored = await projectStoredPersistentConversation(options);
  assert.deepEqual(restored.messages.map(m => [m.role, m.text]), [
    ["user", "Explain"], ["commentary", "Already visible partial answer"]
  ], "Canonical history retains exactly one interrupted partial after live state is gone");
});

// Claude 2.1.289 folds internal commands into the outer turn. Their lifecycle
// completes before result; the original input's completion follows result.
for (const background of [false, true]) test(`folded native command cannot strand its outer input, background=${background}`, async () => {
  const { turn, send, events } = fixture();
  await send();
  const outer = claudeNativeMessageId("first");
  await turn.receive({ type: "command_lifecycle", command_uuid: outer, state: "started" });
  if (background) await turn.receive({ type: "system", subtype: "task_started", task_id: "background" });
  await turn.receive({ type: "command_lifecycle", command_uuid: "internal-notification", state: "started" });
  await turn.receive({ type: "command_lifecycle", command_uuid: "internal-notification", state: "completed" });
  assert.equal(turn.read().active, true, "A folded command's completion does not complete its outer generation");
  await turn.receive({ type: "result", subtype: "success", result: "Done" });
  await turn.receive({ type: "command_lifecycle", command_uuid: outer, state: "completed" });
  assert.equal(turn.read().pendingCommands, 0);
  assert.equal(turn.read().active, background);
  if (background) await turn.receive({ type: "system", subtype: "task_notification", task_id: "background", status: "completed" });
  assert.equal(turn.read().status, "completed");
  assert.equal(events.filter(event => event.type === "settled").length, 1);
});

test("folded lifecycle completion cannot acknowledge interruption before the generation result", async () => {
  const { turn, send, client } = fixture();
  await send();
  await turn.receive({ type: "command_lifecycle", command_uuid: "internal-notification", state: "started" });
  let confirmed = false;
  const steering = turn.interruptGeneration(client).then(() => { confirmed = true; });
  await turn.receive({ type: "command_lifecycle", command_uuid: "internal-notification", state: "completed" });
  await Promise.resolve();
  assert.equal(confirmed, false);
  await turn.receive({ type: "result", subtype: "success", terminal_reason: "aborted_streaming", result: "" });
  await steering;
  await send("goal");
  await turn.receive({ type: "result", subtype: "success", result: "Goal accepted" });
  await turn.receive({ type: "command_lifecycle", command_uuid: claudeNativeMessageId("goal"), state: "completed" });
  assert.equal(turn.read().pendingCommands, 0);
  assert.equal(turn.read().status, "completed");
});

test("late input completion cannot settle a newer native continuation", async () => {
  const { turn, send } = fixture();
  await send();
  await turn.receive({ type: "result", subtype: "success", result: "First answer" });
  await turn.receive({ type: "command_lifecycle", command_uuid: "native-successor", state: "started" });
  await turn.receive({ type: "command_lifecycle", command_uuid: claudeNativeMessageId("first"), state: "completed" });
  assert.equal(turn.read().active, true);
  await turn.receive({ type: "result", subtype: "success", result: "Successor answer" });
  assert.equal(turn.read().status, "completed");
});

test("Claude native follow-ups reactivate a completed turn without admitting another human message", async () => {
  for (const start of [
    { type: "user", uuid: "notification", origin: { kind: "task-notification" } },
    { type: "stream_event", event: { type: "message_start", message: { id: "continued-message" } } },
    { type: "assistant", uuid: "continued-answer", message: { content: [{ type: "text", text: "Still working" }] } }
  ]) {
    const { turn, send, events } = fixture();
    await send();
    await turn.receive({ type: "result", subtype: "success", result: "Background work launched" });
    assert.equal(turn.read().active, false);
    const admitted = events.filter(event => event.type === "admitted").length;
    await turn.receive(start);
    assert.equal(turn.read().active, true);
    assert.equal(turn.read().status, "inProgress");
    assert.equal(turn.read().text, "");
    assert.equal(events.filter(event => event.type === "continued").length, 1);
    assert.equal(events.filter(event => event.type === "admitted").length, admitted);
    await turn.receive({ type: "system", subtype: "status", status: null });
    assert.equal(turn.read().active, true, "The previous result cannot complete the follow-up");
    await turn.receive({ type: "result", subtype: "success", result: "Background work finished" });
    assert.equal(turn.read().active, false);
    assert.equal(turn.read().text, "Background work finished");
    turn.stop();
    await turn.receive(start);
    assert.equal(turn.read().active, false, "Late native frames cannot restart stopped work");
  }
});

test("Claude authoritative task snapshots repair membership and ignore ambient work", async () => {
  const { turn, send, events } = fixture();
  await send();
  await turn.receive({ type: "system", subtype: "task_started", task_id: "missed-completion", task_type: "local_agent" });
  await turn.receive({ type: "system", subtype: "background_tasks_changed", tasks: [
    { task_id: "build", task_type: "local_bash" }, { task_id: "remote", task_type: "remote_agent" },
    { task_id: "watcher", task_type: "local_bash", ambient: true }
  ] });
  assert.equal(turn.read().backgroundTasks, 2);
  await turn.receive({ type: "result", subtype: "success", result: "Launched" });
  assert.equal(turn.read().active, true);
  await turn.receive({ type: "system", subtype: "background_tasks_changed", tasks: [
    { task_id: "watcher", task_type: "local_bash", ambient: true }
  ] });
  assert.equal(turn.read().active, false);
  await turn.receive({ type: "system", subtype: "status", status: null });
  await turn.receive({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  assert.equal(events.filter(event => event.type === "settled").length, 1);
  await turn.receive({ type: "system", subtype: "background_tasks_changed", tasks: [{ task_id: "late", task_type: "local_bash" }] });
  assert.equal(turn.read().active, true, "A later task snapshot restores the working state");
  await turn.receive({ type: "system", subtype: "task_updated", task_id: "late", patch: { status: "completed" } });
  assert.equal(turn.read().active, false);
});

test("Claude can steer background-only work without waiting for an already completed generation", async () => {
  const { turn, send, client } = fixture();
  await send();
  await turn.receive({ type: "system", subtype: "task_started", task_id: "build", task_type: "local_bash" });
  await turn.receive({ type: "result", subtype: "success", result: "Build started" });
  client.interrupt = () => assert.fail("There is no active generation to interrupt");
  await turn.interruptGeneration(client, { timeoutMs: 5 });
  await send("follow-up");
  await turn.receive({ type: "system", subtype: "task_notification", task_id: "build", status: "completed" });
  assert.equal(turn.read().active, true, "The new human input still needs its own result");
  await turn.receive({ type: "result", subtype: "success", result: "Revised answer" });
  assert.equal(turn.read().status, "completed");
});

test("interruption does not claim process exit or complete work on a control acknowledgement", async () => {
  const { turn, send, client, events } = fixture();
  await send();
  await turn.receive({ type: "system", subtype: "status", status: "compacting" });
  await turn.interrupt(client);
  await turn.receive({ type: "result", subtype: "success", terminal_reason: "aborted_tools", result: "" });
  assert.equal(turn.read().active, true);
  assert.equal(events.some(event => event.type === "settled"), false);
  turn.stop("Owned process scope drained.");
  assert.equal(turn.read().active, false);
  assert.equal(turn.read().phase, "");
  assert.equal(turn.read().status, "interrupted");
  turn.begin({ id: "next" });
  await send("next");
  await turn.receive({ type: "result", subtype: "success", result: "Resumed" });
  assert.equal(turn.read().text, "Resumed");
});

test("Claude steering survives background completion while the follow-up is being prepared", async () => {
  const { turn, send, client, events } = fixture();
  await send();
  await turn.receive({ type: "system", subtype: "task_started", task_id: "build", task_type: "local_bash" });
  await turn.receive({ type: "result", subtype: "success", result: "Build started" });
  client.interrupt = () => assert.fail("The generation has already completed");
  await turn.interruptGeneration(client);
  await turn.receive({ type: "system", subtype: "task_notification", task_id: "build", status: "completed" });
  assert.equal(events.some(event => event.type === "settled"), false, "The reserved steering input still needs admission");
  await send("follow-up");
  await turn.receive({ type: "result", subtype: "success", result: "Revised answer" });
  assert.equal(turn.read().status, "completed");
  assert.equal(turn.read().text, "Revised answer");
});

test("lost acknowledgement stays uncertain and stop rejects pending admission", async () => {
  const { turn, client, send } = fixture();
  client.send = async () => {};
  await assert.rejects(send("timeout", { timeoutMs: 5 }), error => error.delivery === "uncertain");
  const pending = send("stopped");
  turn.stop("Connection lost.");
  await assert.rejects(pending, /Connection lost/);
  assert.equal(turn.read().pendingCommands, 0);
  await turn.receive({ type: "result", subtype: "success", result: "Late reply" });
  assert.equal(turn.read().text, "");
});

test("storage failure rejects admission and a slow acknowledged write is not a native timeout", async () => {
  const { turn, send } = fixture();
  await send("slow", { timeoutMs: 5, accept: async () => delay(15) });
  await assert.rejects(send("failed", { accept: async () => { throw new Error("Storage offline"); } }), /Storage offline/);
  turn.stop();
});

test("native session identity and helper output bounds are enforced without truncating answers", async () => {
  const { turn, send } = fixture();
  await assert.rejects(turn.receive({ type: "user", session_id: "another-session" }), /different conversation id/);
  turn.stop();
  turn.begin({ id: "bounded", maxOutputCharacters: 5 });
  await send();
  await turn.receive({ type: "assistant", uuid: "reasoning", message: { content: [{ type: "thinking", thinking: "Longer reasoning summary" }] } });
  await assert.rejects(turn.receive({ type: "assistant", uuid: "answer", message: { content: [{ type: "text", text: "Too long" }] } }), /size limit/);
  await assert.rejects(turn.receive({ type: "result", subtype: "success", structured_output: { text: "Too long" } }), /size limit/);
  turn.stop();
});

test("a native error result is failure information rather than an assistant answer", async () => {
  const { turn, send, events } = fixture();
  await send();
  await turn.receive({ type: "result", subtype: "error_during_execution", is_error: true, result: "The model connection failed." });
  assert.equal(turn.read().status, "failed");
  assert.equal(turn.read().error, "The model connection failed.");
  assert.equal(turn.read().text, "");
  assert.equal(events.some(event => event.type === "message"), false);
});

function renewalFixture() {
  const input = { clientMessageId: "renewal-operation", prompt: "Approved prompt", timeoutMs: 100 };
  const uuid = claudeNativeMessageId(input.clientMessageId);
  const events = [];
  const history = { userIds: [], messages: [] };
  const state = { id: "exact-native-conversation", lastMessageId: "", turn: null, process: null };
  const conversation = {
    state,
    async readHistory() { events.push("history"); return history; },
    async send(value, options) {
      events.push(["send", value, options]);
      state.lastMessageId = uuid;
      state.turn = { id: uuid, active: true };
    },
    async wait(value) { events.push(["wait", value]); return { status: "completed", text: "Finished", threadId: state.id, turnId: uuid }; },
    async stop(reason) { events.push(["stop", reason]); return { exited: true }; }
  };
  return { input, uuid, events, history, state, conversation };
}

test("renewal recovers the exact accepted native answer without another dispatch and closes before returning", async () => {
  const f = renewalFixture();
  f.state.turn = { id: f.uuid, state: "completed", active: false };
  f.history.userIds.push(f.uuid);
  f.history.messages.push({ userId: "other", role: "assistant", text: "Unrelated" },
    { userId: f.uuid, role: "thinking", text: "Private reasoning" },
    { userId: f.uuid, role: "assistant", text: "First" }, { userId: f.uuid, role: "assistant", text: "Second" });
  const result = await runClaudeRenewalTurn(f.conversation, f.input);
  assert.deepEqual(result, { text: "First\nSecond", threadId: f.state.id, turnId: f.uuid, reconciled: true,
    clientMessageId: f.input.clientMessageId, freshThread: false, processExitProof: { exited: true } });
  assert.deepEqual(f.events, ["history", ["stop", undefined]]);
});

test("renewal never treats partial or unrelated accepted output as completed", async () => {
  for (const state of ["active", "failed", "interrupted", "completed"]) {
    const f = renewalFixture();
    f.history.userIds.push(f.uuid);
    f.history.messages.push({ userId: f.uuid, role: "assistant", text: "A plausible but unconfirmed answer" });
    f.state.turn = { id: state === "completed" ? "other-turn" : f.uuid, state, active: state === "active" };
    await assert.rejects(runClaudeRenewalTurn(f.conversation, f.input), error =>
      error.code === "assistant_claude_turn_unreadable" && error.details.inputAccepted === true);
    assert.deepEqual(f.events.map(event => Array.isArray(event) ? event[0] : event), ["history", "stop"]);
  }
});

test("renewal joins an accepted running turn before stopping without resubmitting", async () => {
  const f = renewalFixture();
  f.history.userIds.push(f.uuid);
  f.state.turn = { id: f.uuid, state: "active", active: true };
  f.state.process = {};
  const result = await runClaudeRenewalTurn(f.conversation, f.input);
  assert.equal(result.text, "Finished");
  assert.deepEqual(f.events, ["history", ["wait", { conversationId: f.state.id, timeoutMs: 100 }], ["stop", undefined]]);
});

test("renewal refuses changed or unrelated successor history before native work and never resends unreadable accepted input", async () => {
  const f = renewalFixture();
  await assert.rejects(runClaudeRenewalTurn(f.conversation, { ...f.input, expectedThreadId: "different" }), /expected native history/);
  await assert.rejects(runClaudeRenewalTurn(f.conversation, { ...f.input, requireFreshHistory: true,
    forbiddenThreadId: f.state.id }), /expected native history/);
  assert.deepEqual(f.events, []);
  f.history.userIds.push("unrelated");
  await assert.rejects(runClaudeRenewalTurn(f.conversation, { ...f.input, requireFreshHistory: true }), /unrelated messages/);
  assert.deepEqual(f.events, ["history"]);
  f.history.userIds.splice(0, 1, f.uuid);
  await assert.rejects(runClaudeRenewalTurn(f.conversation, f.input), error => {
    assert.equal(error.code, "assistant_claude_turn_unreadable");
    assert.deepEqual(error.details, { clientMessageId: f.input.clientMessageId, inputAccepted: true,
      threadId: f.state.id, turnId: f.uuid });
    return true;
  });
  assert.equal(f.events.some(event => event[0] === "send"), false);
  assert.match(f.events.at(-1)[1], /will not be submitted again/);
});

test("renewal dispatches once with the original schema and waits before confirmed cleanup", async () => {
  const f = renewalFixture();
  const outputSchema = { type: "object" };
  const result = await runClaudeRenewalTurn(f.conversation, { ...f.input, outputSchema, requireFreshHistory: true });
  assert.equal(result.freshThread, true);
  assert.deepEqual(f.events, ["history", ["send", { message: f.input.prompt,
    messageId: f.input.clientMessageId, outputSchema }, { renewal: true }],
  ["wait", { conversationId: f.state.id, timeoutMs: 100 }], ["stop", undefined]]);
  assert.deepEqual(result.processExitProof, { exited: true });
});

test("renewal preserves acceptance evidence and retries cleanup when the successful turn's close fails", async () => {
  const f = renewalFixture();
  const problem = Object.assign(new Error("Exit proof unavailable"), { details: { retained: true } });
  let stops = 0;
  f.conversation.stop = async reason => {
    f.events.push(["stop", reason]);
    if (++stops === 1) throw problem;
    return { exited: true };
  };
  await assert.rejects(runClaudeRenewalTurn(f.conversation, f.input, { acceptedField: "handoverPromptAccepted" }), error => {
    assert.equal(error, problem);
    assert.deepEqual(error.details, { retained: true, clientMessageId: f.input.clientMessageId,
      handoverPromptAccepted: true, threadId: f.state.id, turnId: f.uuid });
    return true;
  });
  assert.equal(f.events.filter(event => event[0] === "send").length, 1);
  assert.deepEqual(f.events.slice(-2), [["stop", undefined], ["stop", problem.message]]);
});

test("wait cleans up a restored execution before reading saved output and keeps the existing completion on success", async () => {
  const events = [];
  const state = { executionId: "owned-process", process: null, turn: { active: false } };
  const saved = { text: "Saved output", status: "completed" };
  const conversation = { state,
    async stop(reason) { events.push(["stop", reason]); },
    async read(input) { events.push(["read", input]); return saved; },
    async interrupt() { events.push("interrupt"); }
  };
  const input = { messageId: "accepted" };
  assert.equal(await waitForClaudeConversationTurn(conversation, input), saved);
  assert.deepEqual(events, [["stop", "Claude was interrupted when the application disconnected."], ["read", input]]);
  state.process = {};
  state.turn.active = true;
  state.completion = Promise.withResolvers();
  const controller = new AbortController();
  const waiting = waitForClaudeConversationTurn(conversation, {}, { signal: controller.signal, defaultTimeoutMs: Infinity });
  state.completion.resolve(saved);
  assert.equal(await waiting, saved);
  controller.abort();
  assert.equal(events.includes("interrupt"), false, "Completed waits remove their abort listener");
});

test("wait interrupts on its bounded timeout or caller abort without replacing the conversation completion", async () => {
  let interrupts = 0;
  const state = { process: {}, turn: { active: true }, completion: Promise.withResolvers() };
  const conversation = { state, async interrupt() { interrupts++; } };
  await assert.rejects(waitForClaudeConversationTurn(conversation, { timeoutMs: 10_000 }, { maximumTimeoutMs: 5 }), /within the time limit/);
  assert.equal(interrupts, 1);
  const controller = new AbortController();
  conversation.interrupt = async () => { interrupts++; state.completion.resolve({ status: "interrupted" }); };
  const waiting = waitForClaudeConversationTurn(conversation, {}, { signal: controller.signal, defaultTimeoutMs: Infinity });
  controller.abort();
  assert.deepEqual(await waiting, { status: "interrupted" });
  assert.equal(interrupts, 2);
});

test("Claude split completions retain exact output identity until the message role is known", async () => {
  const { turn, events, send } = fixture();
  await send();
  await turn.receive({ type: "stream_event", event: { type: "message_start", message: { id: "same-api-message" } } });
  for (const [index, block] of [
    { type: "thinking", thinking: "The reasoning." }, { type: "text", text: "The answer." }
  ].entries()) {
    await turn.receive({ type: "stream_event", event: { type: "content_block_start", index, content_block: { type: block.type } } });
    await turn.receive({ type: "stream_event", event: { type: "content_block_delta", index,
      delta: block.type === "thinking" ? { thinking: block.thinking } : { text: block.text } } });
    // Claude's documented wire order completes the split frame before its stop.
    await turn.receive({ type: "assistant", uuid: `saved-block-${index}`, message: { id: "same-api-message", content: [block] } });
    if (block.type === "text") {
      assert.equal(events.filter(event => event.type === "message" && event.message.complete && event.message.role === "assistant").length, 0);
      await turn.receive({ type: "stream_event", event: { type: "content_block_stop", index } });
      assert.ok(turn.read().messages.some(message => message.id === `claude_same-api-message_${index}`));
      await turn.receive({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "end_turn" } } });
    }
    const complete = events.filter(event => event.type === "message" && event.message.complete).at(-1).message;
    assert.equal(complete.id, `claude_saved-block-${index}_0`, "Native history keeps its frame UUID and local index");
    assert.equal(complete.outputId, `claude_same-api-message_${index}`, "The existing live map supplies the global block index");
    await turn.receive({ type: "stream_event", event: { type: "content_block_stop", index } });
    assert.equal(events.at(-1).messageId, complete.outputId);
  }
  assert.deepEqual(turn.read().messages.map(message => message.id), ["claude_saved-block-0_0", "claude_saved-block-1_0"]);
  assert.deepEqual(turn.read().messages.map(message => message.outputId), ["claude_same-api-message_0", "claude_same-api-message_1"]);
});

test("Claude output identity is absent without unique live proof or with a conflicting explicit index", async () => {
  for (const mode of ["retired", "ambiguous", "foreign", "missing-id", "wrong-index", "invalid-index", "explicit-index"]) {
    const { turn, events } = fixture();
    const receive = event => turn.receive({ type: "stream_event", event });
    await receive({ type: "message_start", message: { id: mode === "missing-id" ? undefined : "native" } });
    await receive({ type: "content_block_start", index: 3, content_block: { type: "text", text: "Partial" } });
    if (mode === "retired") await receive({ type: "content_block_stop", index: 3 });
    if (mode === "ambiguous") await receive({ type: "content_block_start", index: 4, content_block: { type: "text", text: "Another" } });
    await turn.receive({ type: "assistant", uuid: "saved", message: {
      id: mode === "missing-id" ? undefined : mode === "foreign" ? "other" : "native", content: [{ type: "text", text: "Complete" }]
    }, ...(mode === "wrong-index" ? { apiBlockIndex: 4 } : mode === "invalid-index" ? { apiBlockIndex: "3" }
      : mode === "explicit-index" ? { apiBlockIndex: 3 } : {}) });
    await turn.receive({ type: "result", subtype: "success", result: "" });
    const message = events.filter(event => event.type === "message").at(-1).message;
    assert.equal(message.id, "claude_saved_0");
    if (mode === "explicit-index") assert.equal(message.outputId, "claude_native_3");
    else assert.equal(Object.hasOwn(message, "outputId"), false, mode);
  }
});

test("Claude split text followed by a tool is commentary, never a final answer", async () => {
  const { turn, events, send } = fixture();
  await send();
  await turn.receive({ type: "assistant", uuid: "progress", message: { id: "tool-message", content: [{ type: "text", text: "Checking files" }] } });
  assert.equal(events.some(event => event.type === "message" && event.message.complete), false);
  await turn.receive({ type: "assistant", uuid: "tool", message: { id: "tool-message", content: [{ type: "tool_use", id: "read", name: "Read", input: {} }] } });
  const progress = events.filter(event => event.type === "message").at(-1).message;
  assert.equal(progress.role, "commentary");
  assert.equal(progress.id, "claude_progress_0");
  await turn.receive({ type: "assistant", uuid: "answer", message: { id: "final-message", content: [{ type: "text", text: "Done" }] } });
  await turn.receive({ type: "result", subtype: "success", result: "Done" });
  assert.deepEqual(events.filter(event => event.type === "message" && event.message.role === "assistant").map(event => event.message.text), ["Done"]);
});


import { createClaudeConversationOwner } from "../src/server/conversation/claudeTurn.js";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationRuntime, createMemoryConversationStorage, createConversationTranscript } from "../src/server/conversation/index.js";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "json-rest-schema";

// Exercise the original supplied-store Send/process/event owner, without the
// standalone execution-release capability or application-tool branch.
async function publishedClaudeFixture(t, { publication = true, providerId = "anthropic", releaseExecution, canonicalAdmission = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-final-receipt-"));
  const context = { key: root, workdir: root };
  const saved = new Map();
  const messages = [];
  const processes = [];
  const behavior = { account: "account-a", publication };
  let beforeState;
  const owner = createClaudeConversationOwner({ configRoot: root,
    store: {
      ...(releaseExecution ? { releaseExecution } : {}),
      select() {}, read: (_context, id) => saved.get(id),
      async save(entry) { saved.set(entry.id, JSON.stringify({ turnId: entry.turn?.id,
        state: entry.turn?.state, accountIdentity: entry.accountIdentity })); },
      async hasMessage() { return false; },
      readSessionConversations: () => ({ ids: [...saved.keys()], context })
    },
    preparation: {
      context: async () => context,
      entry: () => ({ options: { mainId: conversationId }, check() {} }),
      check() {}, account: () => ({ identity: behavior.account, providerId }),
      async configuration() { await behavior.configure?.(); return { systemPrompt: "Retained host instructions", settings: {}, model: providerId === "deepseek" ? "deepseek-flash" : "sonnet" }; },
      async message(_entry, _input, { message }) { return message; }
    },
    process: {
      configure() { return {}; },
      async create(options) {
        const native = { executionId: `execution-${processes.length}`, options,
          async stop() { return { scopeEmpty: true, exited: true }; },
          client: { async request() { return {}; },
            async send(_message, input) {
              await options.onEvent({ type: "user", uuid: input.messageId, session_id: options.sessionId });
              if (_message.startsWith("/goal ")) {
                behavior.goalAttachmentWork = (async () => {
                  await behavior.beforeGoalAttachment?.();
                  const directory = path.join(root, "projects", root.replace(/[^a-zA-Z0-9]/gu, "-"));
                  await mkdir(directory, { recursive: true });
                  const condition = _message.slice(6);
                  const marker = { type: "attachment", uuid: `${input.messageId}-goal`, timestamp: new Date().toISOString(),
                    attachment: { type: "goal_status", condition, sentinel: true, met: condition === "clear" } };
                  const user = { type: "user", uuid: input.messageId, parentUuid: marker.uuid, message: { content: _message } };
                  await appendFile(path.join(directory, `${options.sessionId}.jsonl`), [marker, user].map(JSON.stringify).join("\n") + "\n");
                })();
                void behavior.goalAttachmentWork.catch(() => {});
              }
            },
            async interrupt() {
              await options.onEvent({ type: "result", subtype: "success", result: "", terminal_reason: "aborted_streaming" });
            } }
        };
        processes.push(native);
        await options.onStarted(native.executionId, () => native.stop());
        await behavior.initialize?.(native);
        return native;
      }
    },
    async onEvent(entry, event) {
      if (event.type === "before-state") await beforeState?.(entry, event);
      if (event.type === "admit-message" && canonicalAdmission) {
        await behavior.beforeAdmit?.();
        if (behavior.admit) return behavior.admit(event);
        return { turnId: `authored-${event.messageId}`, messages: [{ role: "user", messageId: event.messageId, text: event.message }] };
      }
      if (event.type === "message" && event.message.complete && event.message.role === "assistant") {
        await behavior.beforePublish?.();
        if (behavior.publish) return behavior.publish(event.message);
        const turn = { id: `host-${messages.length}`, messages: [{ messageId: event.message.id,
          outputId: event.message.outputId || event.message.id, role: "assistant", text: event.message.text }] };
        messages.push(turn);
        return behavior.publication ? turn : undefined;
      }
    }
  });
  const conversationId = "12345678-1234-4234-8234-123456789abc";
  let entry = await owner.open(context, { mainId: conversationId });
  t.after(async () => { for (const retained of owner.entries.values()) await owner.close(retained);
    await rm(root, { recursive: true, force: true }); });
  const send = (id = "request") => owner.send(entry, { message: "Explain", messageId: id });
  const frame = input => entry.process.options.onEvent({ session_id: conversationId, ...input });
  const final = () => owner.readFinalAssistantResult(context.key, conversationId, entry.turn?.id || "");
  return { owner, context, conversationId, messages, processes, behavior, send, frame, final,
    get entry() { return entry; }, setBeforeState(callback) { beforeState = callback; },
    async reopen() { entry = await owner.open(context, { mainId: conversationId }); return entry; } };
}

test("Claude continuation supersedes an older completion checkpoint", { timeout: 10_000 }, async t => {
  const f = await publishedClaudeFixture(t);
  await f.send();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let checkpoints = 0;
  f.setBeforeState(async (_entry, event) => {
    if (event.state === "completed" && ++checkpoints === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  const oldResult = f.frame({ type: "result", subtype: "success", result: "First answer" });
  await entered.promise;
  const originalWaiter = f.entry.completion.promise;
  await f.frame({ type: "user", uuid: "background-notification", origin: { kind: "task-notification" } });
  const completion = f.entry.completion;
  release.resolve();
  await oldResult;
  assert.equal(f.entry.turn.state, "active");
  assert.equal(f.entry.turn.active, true);
  assert.equal(f.entry.completion, completion);
  await f.frame({ type: "result", subtype: "success", result: "Follow-up answer" });
  assert.equal((await completion.promise).text, "Follow-up answer");
  assert.equal((await originalWaiter).text, "Follow-up answer");
  assert.equal(f.entry.turn.state, "completed");
});

test("Claude concurrent cleanup callers join the same process stop and interrupted checkpoint", { timeout: 3_000 }, async t => {
  const f = await publishedClaudeFixture(t);
  await f.send();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let stops = 0;
  f.entry.process.stop = async () => { stops++; return { scopeEmpty: true }; };
  f.setBeforeState(async (_entry, event) => {
    if (event.state === "interrupted") { entered.resolve(); await release.promise; }
  });
  const first = f.entry.nativeTurn.stopProcess("Observation lost");
  await entered.promise;
  const second = f.entry.nativeTurn.stopProcess("Concurrent Stop");
  assert.equal(stops, 1);
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(f.entry.turn.active, false);
  assert.equal(f.entry.turn.state, "interrupted");
  assert.equal(f.entry.turn.error, "Observation lost");
});

test("Claude final receipt uses the original supplied-store publication and is available before retained idle checkpoint", async t => {
  const f = await publishedClaudeFixture(t);
  await f.send();
  assert.equal(f.final(), null);
  let atCheckpoint;
  f.setBeforeState((entry, event) => {
    if (event.state === "completed") {
      assert.equal(entry.turn.active, true, "Original checkpoint precedes retained idle mutation");
      assert.equal(entry.nativeTurn.read().active, false, "Original native settlement already completed");
      atCheckpoint = f.final();
    }
  });
  await f.frame({ type: "result", subtype: "success", result: "The answer", uuid: "result-native-id" });
  const result = f.final();
  assert.deepEqual(result, atCheckpoint);
  assert.equal(result.threadId, f.conversationId);
  assert.equal(result.turnId, claudeNativeMessageId("request"));
  assert.equal(result.inputMessageId, claudeNativeMessageId("request"));
  assert.equal(result.itemId, "claude_result-native-id_result");
  assert.equal(result.outputId, result.itemId);
  assert.deepEqual(result.conversationTurn, f.messages[0]);
  result.conversationTurn.messages[0].text = "Mutated caller copy";
  assert.equal(f.final().conversationTurn.messages[0].text, "The answer");
  assert.equal(f.owner.readFinalAssistantResult("foreign-context", f.conversationId, result.turnId), null);
  assert.equal(f.owner.readFinalAssistantResult(f.context.key, "foreign-thread", result.turnId), null);
  assert.equal(f.owner.readFinalAssistantResult(f.context.key, f.conversationId, "foreign-turn"), null);
});

test("Claude final receipt waits for original background settlement and preserves saved split output identity", async t => {
  const f = await publishedClaudeFixture(t);
  await f.send();
  await f.frame({ type: "system", subtype: "task_started", task_type: "local_agent", task_id: "background" });
  await f.frame({ type: "stream_event", event: { type: "message_start", message: { id: "api-answer" } } });
  await f.frame({ type: "stream_event", event: { type: "content_block_start", index: 3,
    content_block: { type: "text", text: "" } } });
  await f.frame({ type: "stream_event", event: { type: "content_block_delta", index: 3, delta: { text: "The answer" } } });
  await f.frame({ type: "assistant", uuid: "saved-answer", message: { id: "api-answer",
    content: [{ type: "text", text: "The answer" }] } });
  await f.frame({ type: "result", subtype: "success", result: "The answer" });
  assert.equal(f.final(), null);
  assert.equal(f.entry.nativeTurn.read().active, true);
  await f.frame({ type: "system", subtype: "task_notification", task_id: "background", status: "completed" });
  assert.equal(f.final().itemId, "claude_saved-answer_0");
  assert.equal(f.final().outputId, "claude_api-answer_3");
  assert.equal(f.messages.length, 1, "Original duplicate result adds no synthetic assistant carrier");
});

test("Claude default sink and failed publication cannot supply a canonical final receipt", async t => {
  const f = await publishedClaudeFixture(t, { publication: false });
  await f.send();
  await f.frame({ type: "result", subtype: "success", result: "No host receipt" });
  assert.equal(f.final(), null);
  f.behavior.publication = true;
  await f.send("publication-failure");
  f.behavior.beforePublish = async () => { throw new Error("Host publication failed"); };
  await assert.rejects(f.frame({ type: "result", subtype: "success", result: "Not published" }), /Host publication failed/);
  assert.equal(f.final(), null);
  await f.owner.interrupt(f.entry);
  f.behavior.beforePublish = undefined;
  await f.send("checkpoint-failure");
  f.setBeforeState((_entry, event) => { if (event.state === "completed") throw new Error("Checkpoint failed"); });
  await assert.rejects(f.frame({ type: "result", subtype: "success", result: "Written but not settled" }), /Checkpoint failed/);
  assert.equal(f.final(), null);
  await f.owner.interrupt(f.entry);
});

test("Claude receipt refuses Stop, account/process replacement and closed restored entries", async t => {
  const f = await publishedClaudeFixture(t, { providerId: "deepseek" });
  await f.send();
  await f.frame({ type: "result", subtype: "success", result: "The answer" });
  const originalProcess = f.entry.process;
  f.entry.process = { ...originalProcess };
  assert.equal(f.final(), null);
  f.entry.process = originalProcess;
  f.entry.executionId = "replacement-execution";
  assert.equal(f.final(), null);
  f.entry.executionId = originalProcess.executionId;
  assert.ok(f.final());
  f.behavior.account = "account-b";
  await f.owner.ensureProcess(f.entry);
  assert.equal(f.final(), null);
  f.behavior.account = "account-a";
  await f.owner.ensureProcess(f.entry);
  assert.equal(f.final(), null, "Original account change-back cannot revive the old receipt");
  await f.owner.close(f.entry);
  assert.equal(f.final(), null);
  await f.reopen();
  assert.equal(f.entry.turn.state, "completed", "Existing retained metadata may still describe completion");
  assert.equal(f.final(), null, "Saved completion cannot reconstruct native receipt proof");
  await f.send("next-input");
  await f.owner.interrupt(f.entry);
  assert.equal(f.final(), null);
});

test("Claude steering never adopts an older same-text carrier and current accepted input can publish its own final", async t => {
  const f = await publishedClaudeFixture(t);
  await f.send();
  await f.frame({ type: "assistant", uuid: "first-answer", message: { content: [{ type: "text", text: "Same words" }] } });
  await f.send("steer");
  await f.frame({ type: "result", subtype: "success", result: "Same words" });
  assert.equal(f.final(), null, "Original result deduplication is not evidence for a newer admitted command");
  assert.equal(f.messages.length, 1);
  await f.send("current");
  await f.frame({ type: "result", subtype: "success", result: "Current answer" });
  assert.equal(f.final().inputMessageId, claudeNativeMessageId("current"));
  assert.equal(f.final().text, "Current answer");
});


test("Claude final receipt refuses original generic execution release while native exit is pending", async t => {
  let releases = 0;
  const f = await publishedClaudeFixture(t, { releaseExecution: async () => { releases++; } });
  await f.send();
  await f.frame({ type: "result", subtype: "success", result: "Completed before exit" });
  assert.ok(f.final());
  const exit = Promise.withResolvers();
  const entered = Promise.withResolvers();
  f.entry.process.stop = async () => { entered.resolve(); return exit.promise; };
  const stopping = f.entry.nativeTurn.stopProcess("Closing generic execution");
  try {
    await entered.promise;
    assert.equal(f.entry.stopping, false, "Original generic release does not set retained-host stopping");
    assert.ok(f.entry.stopPending, "The original pending-stop owner is visible before exit proof");
    assert.equal(f.final(), null, "Completed receipt cannot be used during native cleanup");
    assert.equal(releases, 0, "Original execution release still waits for the native exit proof");
  } finally {
    exit.resolve({ exited: true, scopeEmpty: true });
    await stopping;
  }
  assert.equal(releases, 1);
  assert.equal(f.entry.process, null);
  assert.equal(f.entry.stopPending, null);
  assert.equal(f.final(), null);
});


test("Claude failed generic native exit cannot revive a completed receipt and original cleanup retries", async t => {
  let releases = 0;
  const f = await publishedClaudeFixture(t, { releaseExecution: async () => { releases++; } });
  await f.send();
  await f.frame({ type: "result", subtype: "success", result: "Completed before failed exit" });
  assert.ok(f.final());
  const native = f.entry.process;
  const exit = Promise.withResolvers();
  const entered = Promise.withResolvers();
  const problem = new Error("Native exit unavailable");
  native.stop = async () => { entered.resolve(); return exit.promise; };
  const stopping = f.entry.nativeTurn.stopProcess("Closing generic execution");
  const failed = assert.rejects(stopping, error => error === problem);
  try {
    await entered.promise;
    assert.equal(f.entry.stopping, false);
    assert.ok(f.entry.stopPending);
    assert.equal(f.final(), null);
    assert.equal(releases, 0);
    exit.reject(problem);
    await failed;
    assert.equal(f.entry.stopPending, null, "Original failed-stop finally clears its pending handle");
    assert.equal(f.entry.process, native, "Original failed-exit ownership remains available for retry");
    assert.equal(f.final(), null, "Failed native exit cannot revive the old completed receipt");
    assert.equal(releases, 0, "Failed exit must not release execution ownership");
  } finally {
    exit.reject(problem);
    await failed;
    native.stop = async () => ({ exited: true, scopeEmpty: true });
  }
  await f.entry.nativeTurn.stopProcess("Retry original native cleanup");
  assert.equal(releases, 1);
  assert.equal(f.entry.process, null);
  assert.equal(f.entry.stopPending, null);
  assert.equal(f.final(), null);
});


async function claudeSuppliedToolFixture(t) {
  const f = await publishedClaudeFixture(t, { canonicalAdmission: true });
  const control = { current: null, disposed: false };
  const signal = new AbortController();
  const accepted = [];
  const effects = [];
  const schemas = [{ type: "function", function: { name: "inspect_lesson", description: "Inspect the admitted lesson",
    parameters: { type: "object", properties: { attemptId: { type: "string" } }, additionalProperties: false } } }];
  const tools = { schemas, async execute(input, options) {
    assert.ok(accepted.some(value => value.messageId === options.messageId), "The same Core accept callback precedes effects");
    effects.push({ input, messageId: options.messageId });
    await f.behavior.toolWait;
    if (f.behavior.toolError) throw f.behavior.toolError;
    return { ok: true, result: { lesson: "current" } };
  } };
  function command(messageId) {
    return { context: f.context, input: { messageId, nativeMessage: { messageId, message: "Teach this lesson" } },
      signal: signal.signal, tools,
      async beforeDispatch(native) { assert.equal(native.threadId, f.conversationId); },
      async accept(value) {
        assert.equal(value.conversationTurn.turnId, `authored-${messageId}`);
        assert.equal(value.nativeTurnId, f.entry.turn.id);
        accepted.push({ messageId, value });
      } };
  }
  const acquire = async () => f.entry;
  const options = { acquire, reportFailure: async () => {}, maximumToolCalls: 2 };
  function call(id, name = "inspect_lesson", input = { attemptId: "saved-attempt" }) {
    return f.entry.process.options.onControlRequest({ subtype: "mcp_message", server_name: "application",
      message: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: input,
        _meta: { "claudecode/toolUseId": id } } } }, { signal: signal.signal });
  }
  async function nativeTool(id, input = { attemptId: "saved-attempt" }) {
    await f.frame({ type: "assistant", uuid: `native-${id}`, message: { content: [
      { type: "tool_use", id, name: "mcp__application__inspect_lesson", input }
    ] } });
  }
  return { ...f, get entry() { return f.entry; }, control, signal, accepted, effects, tools, command, options, call, nativeTool };
}

test("Claude supplied store adopts the actual canonical ACK before existing native application tools", async t => {
  const f = await claudeSuppliedToolFixture(t);
  const admitted = Promise.withResolvers();
  f.behavior.beforeAdmit = async () => { admitted.resolve(); await f.behavior.admissionWait; };
  const hold = Promise.withResolvers();
  f.behavior.admissionWait = hold.promise;
  const running = f.owner.run(f.control, f.command("tools-request"), f.options);
  void running.catch(() => {});
  await admitted.promise;
  assert.equal(f.entry.command.admitted, false);
  assert.equal(f.accepted.length, 0);
  await f.nativeTool("early-call");
  await assert.rejects(f.call("early-call"), /admitted native tool use/);
  assert.equal(f.effects.length, 0);
  hold.resolve();
  while (!f.accepted.length) await new Promise(resolve => setImmediate(resolve));
  const native = f.entry.process;
  assert.equal(typeof native.options.onControlRequest, "function");
  assert.equal(f.owner.applicationToolsSupported, true);
  await f.nativeTool("current-call");
  const response = await f.call("current-call");
  assert.equal(JSON.parse(response.mcp_response.result.content[0].text).ok, true);
  assert.equal(f.effects[0].messageId, "tools-request");
  await assert.rejects(f.call("forged-call"), /admitted native tool use/);
  await assert.rejects(f.call("current-call", "inspect_lesson", { attemptId: "foreign" }), /admitted native tool use/);
  await f.frame({ type: "result", subtype: "success", result: "Current lesson" });
  await running;
  assert.equal(f.entry.command, null);
  assert.equal(f.entry.process, native, "Original supplied-store completion retains its process");
  assert.equal(f.entry.turn.state, "completed");
});

test("Claude supplied tools retain the originating tool message while steering adopts its own canonical ACK", async t => {
  const f = await claudeSuppliedToolFixture(t);
  const running = f.owner.run(f.control, f.command("first-tool-request"), f.options);
  void running.catch(() => {});
  while (!f.accepted.length) await new Promise(resolve => setImmediate(resolve));
  await f.nativeTool("first-owned-call");
  await f.owner.steer(f.control, f.command("steered-tool-request"), f.options);
  await f.nativeTool("steered-owned-call");
  await assert.rejects(f.call("first-owned-call"), /retired input/);
  await f.call("steered-owned-call");
  assert.deepEqual(f.effects.map(value => value.messageId), ["steered-tool-request"]);
  assert.deepEqual(f.accepted.map(value => value.messageId), ["first-tool-request", "steered-tool-request"]);
  await f.frame({ type: "result", subtype: "success", result: "Steered lesson" });
  await running;
  assert.equal(f.entry.command, null);
});

test("Claude supplied run joins existing native tool work before dropping its command custody", async t => {
  const f = await claudeSuppliedToolFixture(t);
  const running = f.owner.run(f.control, f.command("held-tool-request"), f.options);
  void running.catch(() => {});
  while (!f.accepted.length) await new Promise(resolve => setImmediate(resolve));
  const finishTool = Promise.withResolvers();
  f.behavior.toolWait = finishTool.promise;
  await f.nativeTool("held-native-call");
  const tool = f.call("held-native-call");
  while (!f.effects.length) await new Promise(resolve => setImmediate(resolve));
  let finished = false;
  const finishedRun = running.then(() => { finished = true; });
  await f.frame({ type: "result", subtype: "success", result: "Cannot overtake tool work" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  assert.ok(f.entry.command);
  assert.equal(f.final(), null, "A result observed before its original tool work finishes has no usable final proof");
  finishTool.resolve();
  await tool;
  await finishedRun;
  assert.equal(f.entry.command, null);
});


test("Claude current supplied turn reader refuses restored/process/account/closing stand-ins", async t => {
  const f = await claudeSuppliedToolFixture(t);
  const read = () => f.owner.readRetainedTurn(f.context.key, f.conversationId, { saved: { turnId: "saved", state: "active" }, current: true });
  assert.equal(read(), null);
  const running = f.owner.run(f.control, f.command("live-reader-request"), f.options);
  void running.catch(() => {});
  while (!f.accepted.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(read().id, f.entry.turn.id);
  const native = f.entry.process;
  f.entry.process = null;
  assert.equal(read(), null);
  f.entry.process = native;
  const account = f.entry.accountIdentity;
  f.entry.accountIdentity = "different-account";
  assert.equal(read(), null);
  f.entry.accountIdentity = account;
  f.entry.stopping = true;
  assert.equal(read(), null);
  f.entry.stopping = false;
  assert.equal(read().active, true);
  await f.frame({ type: "result", subtype: "success", result: "Complete live turn" });
  await running;
  assert.equal(read(), null, "A retained completed turn cannot admit a new effect");
  assert.equal(f.owner.readRetainedTurn(f.context.key, f.conversationId, { saved: null }).state, "completed",
    "Original read-only retained presentation remains unchanged");
});

test("Claude supplied current executor failure uses original Stop and command drain", async t => {
  const f = await claudeSuppliedToolFixture(t);
  const running = f.owner.run(f.control, f.command("current-effect-failure"), f.options);
  void running.catch(() => {});
  while (!f.accepted.length) await new Promise(resolve => setImmediate(resolve));
  const native = f.entry.process;
  let stops = 0;
  const stop = native.stop;
  native.stop = async () => { stops++; return stop.call(native); };
  f.behavior.toolError = new Error("Actual supplied executor failure");
  await f.nativeTool("owned-failure");
  await assert.rejects(f.call("owned-failure"), /Actual supplied executor failure/);
  await assert.rejects(running, /Actual supplied executor failure/);
  assert.equal(stops, 1);
  assert.equal(f.entry.process, null);
  assert.equal(f.entry.command, null);
  assert.equal(f.final(), null);
});

test("Claude admitted old executor failure cannot stop its accepted steering successor", async t => {
  const f = await claudeSuppliedToolFixture(t);
  const running = f.owner.run(f.control, f.command("old-held-effect"), f.options);
  void running.catch(() => {});
  while (!f.accepted.length) await new Promise(resolve => setImmediate(resolve));
  const native = f.entry.process;
  let stops = 0;
  const stop = native.stop;
  native.stop = async () => { stops++; return stop.call(native); };
  const held = Promise.withResolvers();
  f.behavior.toolWait = held.promise;
  await f.nativeTool("old-held-call");
  const old = f.call("old-held-call");
  void old.catch(() => {});
  while (!f.effects.length) await new Promise(resolve => setImmediate(resolve));
  await f.owner.steer(f.control, f.command("accepted-successor"), f.options);
  held.reject(new Error("Old admitted effect failed late"));
  await assert.rejects(old, /Old admitted effect failed late/);
  assert.equal(f.entry.command.messageId, "accepted-successor");
  assert.equal(f.entry.command.toolFailure, undefined);
  assert.equal(stops, 0);
  f.behavior.toolWait = undefined;
  await f.frame({ type: "result", subtype: "success", result: "Successor completed" });
  await running;
  assert.equal(stops, 0);
  assert.equal(f.entry.process, native);
});


test("Claude verified native cleanup retains interrupted checkpoint refusal without leaving saved work active", async t => {
  const f = await publishedClaudeFixture(t);
  await f.send("checkpoint-refused-stop");
  const native = f.entry.process;
  const refusal = new Error("Saved lesson checkpoint refused");
  let stopped = false;
  native.stop = async () => { stopped = true; return { exited: true, scopeEmpty: true }; };
  f.setBeforeState((_entry, event) => {
    if (event.state === "interrupted") {
      assert.equal(stopped, true, "Original native cleanup precedes the host checkpoint");
      throw refusal;
    }
  });
  const completion = f.entry.completion.promise;
  await assert.rejects(f.entry.nativeTurn.stopProcess("Broken stream"), error => error === refusal);
  assert.equal(f.entry.process, null);
  assert.equal(f.entry.executionId, "");
  assert.deepEqual(f.entry.exitProof, { exited: true, scopeEmpty: true });
  assert.equal(f.entry.turn.active, false);
  assert.equal(f.entry.turn.state, "interrupted");
  assert.equal(f.entry.turn.error, refusal.message);
  const settled = await completion;
  assert.equal(settled.status, "interrupted");
  assert.equal(settled.error, refusal.message);
  assert.equal(f.final(), null, "Refused checkpoint supplies no completed answer receipt");
  await f.reopen();
  assert.equal(f.entry.turn.active, false, "Original supplied store retained the truthful interruption");
  assert.equal(f.entry.turn.state, "interrupted");
});

// Retain the original supplied-store/native process fixture and drive it through
// the actual common runtime, including its completion-only admitted receipt.
async function suppliedCommonFixture(t, { tools = true, onDeliveryTiming, representation = "canonical", beforeToolWrite, signal } = {}) {
  const f = await publishedClaudeFixture(t, { canonicalAdmission: true });
  const storage = createMemoryConversationStorage();
  const transcript = createConversationTranscript({ storage });
  const context = { actor: { id: "owner" }, surface: "app", signal };
  const admissions = [];
  const checkpoints = [];
  const actions = createActionCatalogue();
  actions.register({ contributorId: "lesson", domain: "lesson", actions: [{
    id: "lesson.inspect", version: 1, kind: "query", channels: ["automation"], surfaces: ["app"],
    permission: { require: "authenticated" }, idempotency: "none",
    input: { schema: createSchema({}), mode: "replace" },
    output: { schema: createSchema({}), mode: "replace" }, execute: async () => ({})
  }] });
  let delivery;
  f.behavior.admit = event => transcript.writeConversationUserMessage("lesson", {
    messageId: event.messageId, text: event.message
  });
  f.behavior.publish = message => storage.write("lesson", async transaction => {
    const turnId = await transaction.nextTurnId();
    await transaction.appendMessage(turnId, { ...message, role: "assistant", messageId: message.id });
    const turn = await transaction.readTurn(turnId);
    f.messages.push(turn);
    return turn;
  });
  const binding = { sessionId: "lesson", namespace: f.context.key, engine: "claude", runtime: { store: {} },
    native: { owner: f.owner, preparation: { cleanup: () => ({ context: f.context, application: {
      readContext: async () => f.context, terminals: { close: async () => ({ ok: true }) }
    } }) } },
    admission() {}, prepareInput: async input => input,
    read: async () => ({ threadId: f.conversationId, configuration: { model: "native" },
      turn: f.owner.snapshot(f.entry), delivery }),
    readStream: async () => ({ messages: [] }),
    state: { read: async () => delivery, write: async value => { delivery = structuredClone(value); } },
    transcript: { history: async () => [], readConversationLog: () => transcript.readConversationLog("lesson"),
      hasMessage: id => transcript.conversationMessageIdExists("lesson", id),
      writeUserMessage: input => transcript.writeConversationUserMessage("lesson", input) },
    ...(tools ? { applicationTools: { storage: beforeToolWrite ? { ...storage, async write(...args) {
      await beforeToolWrite(); return storage.write(...args);
    } } : storage, prepareContext(actual, admission) {
      admissions.push(admission); return actual;
    } } } : {}) };
  const runtime = createConversationRuntime({ ...(tools ? { actions } : {}), authorize: () => true, onDeliveryTiming,
    host: { conversation: () => binding } });
  t.after(() => runtime.close());
  const conversation = await runtime.open({ id: "lesson", context, representation });
  f.setBeforeState((entry, event) => {
    if (event.state !== "completed") return;
    assert.equal(entry.turn.active, true, "Retained checkpoint still precedes saved idle state");
    assert.equal(entry.nativeTurn.read().active, false);
    const final = f.final();
    assert.ok(final, "The original canonical FINAL is available at the checkpoint");
    const admission = admissions.at(-1);
    if (tools) admission.assertCompletionCurrent();
    checkpoints.push({ final, admission });
  });
  async function loadContract(id = "contract") {
    await f.frame({ type: "assistant", uuid: `tool-${id}`, message: { content: [
      { type: "tool_use", id, name: "mcp__application__assistant_action_contract",
        input: { actionId: "lesson.inspect", version: 1 } }
    ] } });
    return f.entry.process.options.onControlRequest({ subtype: "mcp_message", server_name: "application",
      message: { jsonrpc: "2.0", id, method: "tools/call", params: { name: "assistant_action_contract",
        arguments: { actionId: "lesson.inspect", version: 1 }, _meta: { "claudecode/toolUseId": id } } }
    }, { signal: new AbortController().signal });
  }
  return { ...f, get entry() { return f.entry; }, runtime, conversation, binding, admissions, checkpoints, loadContract, testSignal: t.signal };
}

async function sendCommon(f, messageId) {
  const receipt = await f.conversation.send({ messageId, text: "Prepare the question." });
  while (!f.entry.command?.admitted) {
    f.testSignal.throwIfAborted();
    await new Promise(resolve => setImmediate(resolve));
  }
  return receipt;
}

test("Claude fast follow-up completes while the earlier common checkpoint is held", { timeout: 3_000 }, async t => {
  const f = await suppliedCommonFixture(t);
  await sendCommon(f, "checkpoint-follow-up");
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let checkpoints = 0;
  f.setBeforeState(async (_entry, event) => {
    if (event.state === "completed" && ++checkpoints === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  const waiting = f.entry.completion.promise;
  await f.frame({ type: "result", subtype: "success", result: "First answer" });
  await entered.promise;
  try {
    await f.frame({ type: "user", uuid: "automatic", origin: { kind: "task-notification" } });
    await f.frame({ type: "result", subtype: "success", result: "Latest answer" });
  } finally { release.resolve(); }
  await f.conversation.wait();
  assert.equal(f.entry.turn.state, "completed");
  assert.equal((await waiting).text, "Latest answer");
  assert.equal(f.entry.process.stopped, undefined);
});

for (const failedSave of [false, true]) test(`Claude goal waits for common final saving, failedSave=${failedSave}`, { timeout: 5_000 }, async t => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let held = false;
  const f = await suppliedCommonFixture(t, { async beforeToolWrite() {
    if (!held && f.entry.turn.state === "completed") {
      held = true;
      entered.resolve();
      await release.promise;
      if (failedSave) throw new Error("Final save unavailable");
    }
  } });
  await sendCommon(f, "before-goal");
  await f.loadContract();
  const completing = f.frame({ type: "result", subtype: "success", result: "First answer" });
  await entered.promise;
  const command = { action: "set", objective: "Finish the checks", messageId: "finishing-goal",
    expectedSegmentId: `claude:${f.conversationId}` };
  f.setBeforeState(() => {});
  const goalChecked = Promise.withResolvers();
  f.binding.admission = (_context, operation) => { if (operation === "goal") goalChecked.resolve(); };
  let result;
  const setting = f.conversation.updateGoal(command).then(value => { result = value; return value; }, error => { result = error; throw error; });
  void setting.catch(() => {});
  try {
    await goalChecked.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(result, undefined, "The goal waits for the original final save before dispatch");
    assert.equal(f.entry.command, null);
  } finally { release.resolve(); }
  await completing;
  if (failedSave) {
    await assert.rejects(setting, { code: "conversation_storage_unavailable" });
    assert.equal(f.entry.command, null, "Failed saving must not dispatch a goal");
  } else {
    assert.equal((await setting).status, "accepted");
    assert.equal(f.entry.command.messageId, command.messageId);
    await f.frame({ type: "result", subtype: "success", result: "Checks complete" });
    await f.conversation.wait();
    assert.equal((await f.conversation.updateGoal(command)).duplicate, true);
    const log = await f.binding.transcript.readConversationLog();
    assert.equal(log.flatMap(turn => turn.messages).filter(message => message.messageId === command.messageId).length, 1);
  }
});

test("Claude delivery timing separates native acknowledgement from the held canonical receipt", { timeout: 10_000 }, async t => {
  const timings = [];
  const f = await suppliedCommonFixture(t, { onDeliveryTiming: event => timings.push(event) });
  const writing = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.behavior.beforeAdmit = async () => { writing.resolve(); await release.promise; };
  const sending = f.conversation.send({ messageId: "timed-request", text: "Private message" });
  await writing.promise;
  assert.deepEqual(timings.map(event => event.stage), [
    "received", "preparation-started", "provider-started", "runtime-ready", "dispatch-started", "native-acknowledged"
  ]);
  release.resolve();
  assert.equal((await sending).status, "accepted");
  assert.deepEqual(timings.slice(-2).map(event => event.stage), ["receipt-persisted", "accepted"]);
  await f.frame({ type: "result", subtype: "success", result: "Public answer" });
  await f.conversation.wait();
  assert.equal(JSON.stringify(timings).includes("Private message"), false);
});

for (const tools of [true, false]) test(`Claude supplied common runtime checkpoints after its completion fence with tools=${tools}`, { timeout: 10_000 }, async t => {
  const f = await suppliedCommonFixture(t, { tools });
  const receipt = await sendCommon(f, "common-question");
  assert.equal(receipt.status, "accepted");
  assert.equal(typeof f.entry.command.finishIfCurrent, "function");
  if (tools) {
    await f.loadContract();
    assert.throws(() => f.admissions.at(-1).assertCompletionCurrent(), { code: "conversation_tool_request_retired" });
  } else assert.equal(f.entry.command.tools, undefined);
  await f.frame({ type: "result", subtype: "success", result: "Where would you try the application?", uuid: "question-final" });
  await f.conversation.wait();
  assert.equal(f.checkpoints.length, 1);
  assert.notEqual(f.checkpoints[0].final.conversationTurn.turnId, receipt.turnId,
    "The true native FINAL keeps its separate original carrier");
  assert.equal(f.entry.turn.state, "completed");
  assert.equal(f.entry.command, null);
  if (tools) f.admissions.at(-1).assertCompletionCurrent();
});

test("Claude supplied common completion joins accepted steering and checkpoints only its own final", { timeout: 10_000 }, async t => {
  const f = await suppliedCommonFixture(t);
  await sendCommon(f, "common-first");
  await f.loadContract("first-contract");
  const first = f.admissions.at(-1);
  const legacyCompletion = f.entry.completion.promise;
  const receipt = await f.conversation.send({ messageId: "common-successor", text: "Use this new question.", steer: true });
  assert.equal(receipt.status, "accepted");
  assert.equal(f.entry.completion.promise, legacyCompletion, "Original same-turn steering retains the direct wait owner");
  while (f.entry.command.messageId !== "common-successor") {
    f.testSignal.throwIfAborted();
    await new Promise(resolve => setImmediate(resolve));
  }
  await f.loadContract("successor-contract");
  assert.throws(() => first.assertCompletionCurrent(), { code: "conversation_tool_request_retired" });
  await f.frame({ type: "result", subtype: "success", result: "The successor question", uuid: "successor-final" });
  await f.conversation.wait();
  assert.equal((await legacyCompletion).status, "completed");
  assert.equal(f.checkpoints.length, 1);
  assert.equal(f.checkpoints[0].final.inputMessageId, claudeNativeMessageId("common-successor"));
  assert.equal(f.checkpoints[0].admission.messageId, "common-successor");
  assert.throws(() => first.assertCompletionCurrent(), { code: "conversation_tool_request_retired" });
});

test("Claude supplied completion retains the original waiter when a reserved successor is rejected before dispatch", { timeout: 10_000 }, async t => {
  const f = await suppliedCommonFixture(t);
  await sendCommon(f, "unreplaced-first");
  await f.loadContract();
  const first = f.admissions.at(-1);
  const legacyCompletion = f.entry.completion.promise;
  const preparing = Promise.withResolvers();
  const held = Promise.withResolvers();
  f.binding.prepareInput = async () => { preparing.resolve(); await held.promise; };
  const steering = f.conversation.send({ messageId: "never-dispatched-successor", text: "Rejected before native work.", steer: true });
  void steering.catch(() => {});
  await preparing.promise;
  await f.frame({ type: "result", subtype: "success", result: "The still-current question", uuid: "unreplaced-final" });
  assert.equal(f.checkpoints.length, 0);
  held.reject(new Error("The host rejected preparation before dispatch."));
  await assert.rejects(steering, /host rejected preparation/);
  await f.conversation.wait();
  assert.equal((await legacyCompletion).status, "completed");
  assert.equal(f.checkpoints.length, 1);
  assert.equal(f.checkpoints[0].final.inputMessageId, claudeNativeMessageId("unreplaced-first"));
  first.assertCompletionCurrent();
});

for (const cancelled of [false, true]) test(`Claude supplied native settlement releases its queue while reserved steering waits, cancelled=${cancelled}`, { timeout: 10_000 }, async t => {
  const f = await suppliedCommonFixture(t);
  await sendCommon(f, "reserved-first");
  await f.loadContract();
  const first = f.admissions.at(-1);
  const preparing = Promise.withResolvers();
  const held = Promise.withResolvers();
  f.binding.prepareInput = async input => { preparing.resolve(); await held.promise; return input; };
  const steering = f.conversation.send({ messageId: "reserved-successor", text: "A reserved new instruction.", steer: true });
  void steering.catch(() => {});
  await preparing.promise;
  const legacyCompletion = f.entry.completion.promise;
  let cancellation;
  try {
    await f.frame({ type: "result", subtype: "success", result: "The prior question", uuid: "reserved-final" });
    assert.equal(f.entry.nativeTurn.read().active, false);
    assert.equal(f.entry.turn.active, true);
    assert.equal(f.checkpoints.length, 0, "Native queue does not await the reserved common admission");
    assert.throws(() => first.assertCompletionCurrent(), { code: "conversation_tool_request_retired" });
    if (cancelled) cancellation = f.conversation.cancel();
  } finally { held.resolve(); }
  await cancellation;
  await assert.rejects(steering);
  assert.equal((await legacyCompletion).status, "interrupted", "Legacy wait keeps its original settlement and cleanup result");
  await f.conversation.wait();
  assert.equal(f.checkpoints.length, 0);
  assert.equal(f.final(), null, "Rejected steering or Stop cannot revive the prior FINAL");
  assert.equal(f.entry.process, null);
  assert.equal(f.entry.command, null);
  assert.throws(() => first.assertCompletionCurrent());
});

test("Claude supplied common checkpoint failure preserves original refusal and native cleanup", { timeout: 10_000 }, async t => {
  const f = await suppliedCommonFixture(t);
  await sendCommon(f, "refused-common-question");
  await f.loadContract();
  const refusal = new Error("The original lesson checkpoint refused this completion.");
  f.setBeforeState((entry, event) => {
    if (event.state !== "completed") return;
    assert.equal(entry.turn.active, true);
    f.admissions.at(-1).assertCompletionCurrent();
    throw refusal;
  });
  await f.frame({ type: "result", subtype: "success", result: "Never delivered", uuid: "refused-final" });
  const state = await f.conversation.wait();
  assert.equal(state.error, refusal.message);
  assert.equal(f.final(), null);
  assert.equal(f.entry.process, null);
  assert.equal(f.entry.command, null);
  assert.equal(f.entry.turn.active, false);
});


test("Claude failed Stop retains cleanup for an explicit retry without a hidden second attempt", async t => {
  const f = await claudeSuppliedToolFixture(t);
  const running = f.owner.run(f.control, f.command("stop-retry"), f.options);
  const failedRun = assert.rejects(running, error => error.cleanupFailed === true);
  while (!f.accepted.length) await new Promise(resolve => setImmediate(resolve));
  let stops = 0;
  let allowed = false;
  t.after(() => { allowed = true; });
  f.entry.process.stop = async () => { stops++; return { scopeEmpty: allowed, exited: allowed }; };
  await assert.rejects(f.owner.cancel(f.control, { context: f.context, ...f.options }), { code: "claude_stop_unconfirmed" });
  await failedRun;
  assert.equal(stops, 1, "Turn failure must not retry unconfirmed cleanup behind the caller");
  allowed = true;
  await f.owner.cancel(f.control, { context: f.context, ...f.options });
  assert.equal(stops, 2);
  assert.equal(f.entry.turn.active, false);
});


for (const scope of ["session", "conversation"]) test(`Claude ${scope} close stops pending initialization before waiting for preparation`, { timeout: 3000 }, async t => {
  const f = await publishedClaudeFixture(t);
  const entered = Promise.withResolvers();
  const initialization = Promise.withResolvers();
  f.behavior.initialize = async native => {
    native.stop = async () => {
      initialization.reject(new Error("Startup stopped"));
      return { scopeEmpty: true, exited: true };
    };
    entered.resolve();
    await initialization.promise;
  };
  const preparing = f.owner.ensureProcess(f.entry);
  const rejected = assert.rejects(preparing, /Startup stopped/);
  await entered.promise;
  const closed = scope === "conversation" ? f.owner.close(f.entry) :
    f.owner.closeSession(f.context, { readContext: async () => f.context,
      terminals: { close: async () => ({ ok: true, closed: 0 }) } });
  let timer;
  try {
    await Promise.race([closed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Session close waited for initialization before stopping it")), 300);
    })]);
    await rejected;
    assert.equal(f.entry.executionId, "");
  } finally {
    clearTimeout(timer);
    initialization.reject(new Error("Startup stopped"));
    await Promise.allSettled([closed, preparing, rejected]);
  }
});

test("Claude Stop cancels configuration that has not started its native process", async t => {
  const f = await publishedClaudeFixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  f.behavior.configure = async () => { entered.resolve(); await release.promise; };
  const preparing = f.owner.ensureProcess(f.entry);
  await entered.promise;
  await f.entry.nativeTurn.stopProcess();
  release.resolve();
  await assert.rejects(preparing, /stopped|closing/);
  assert.equal(f.processes.length, 0, "Stopped configuration must not launch Claude later");
});

// The application has persisted dispatch intent, but the native guard has not
// written anything. Its rejection must clear that intent, not trap Retry forever.
test("Claude supplied runtime records rejection when the native turn ends before the pipe write", { timeout: 10_000 }, async t => {
  const f = await suppliedCommonFixture(t, { representation: "native" });
  let rejected = 0;
  let sent = 0;
  f.behavior.initialize = native => {
    const send = native.client.send;
    native.client.send = (...args) => { sent += 1; return send(...args); };
  };
  await assert.rejects(f.conversation.send({
    messageId: "stopped-before-write", text: "Do the work",
    onPromptSending() { f.entry.nativeTurn.stop(); },
    onPromptRejected() { rejected += 1; }
  }), error => error.delivery === "not-sent");
  assert.equal(sent, 0);
  assert.equal(rejected, 1);
  assert.equal(f.messages.length, 0);
});

test("only natural completion marks a rejected steer eligible for ordinary Send; Stop and cancellation do not", async () => {
  for (const ending of ["complete", "stop", "cancel"]) {
    const f = fixture();
    await f.send();
    if (ending === "complete") await f.turn.receive({ type: "result", subtype: "success", result: "Done" });
    else if (ending === "stop") f.turn.stop();
    else await f.turn.interrupt(f.client);
    let writes = 0;
    f.client.send = async () => { writes += 1; };
    await assert.rejects(f.send("late"), error => {
      assert.equal(error.delivery, "not-sent");
      assert.equal(error.code, ending === "complete" ? "conversation_steer_turn_finished" : "assistant_claude_turn_failed");
      assert.equal(error.statusCode, ending === "complete" ? 409 : undefined);
      return true;
    });
    assert.equal(writes, 0);
    f.turn.stop();
  }
});

test("interruption before a late steer distinguishes completed work from Stop, cancellation and idle state", async () => {
  for (const ending of ["complete", "stop", "cancel", "idle", "steering"]) {
    const f = fixture();
    await f.send();
    let firstInterrupt;
    if (ending === "complete" || ending === "idle") {
      await f.turn.receive({ type: "result", subtype: "success", result: "Done" });
      if (ending === "idle") f.turn.reset();
    } else if (ending === "stop") f.turn.stop();
    else if (ending === "cancel") await f.turn.interrupt(f.client);
    else {
      const began = Promise.withResolvers();
      f.client.interrupt = async () => { began.resolve(); };
      firstInterrupt = f.turn.interruptGeneration(f.client).catch(() => {});
      await began.promise;
    }
    let interrupts = 0;
    f.client.interrupt = async () => { interrupts += 1; };
    await assert.rejects(f.turn.interruptGeneration(f.client), error => {
      assert.equal(error.delivery, "not-sent");
      assert.equal(error.code, ending === "complete" ? "conversation_steer_turn_finished" : "assistant_claude_turn_failed");
      assert.equal(error.statusCode, ending === "complete" ? 409 : undefined);
      return true;
    });
    assert.equal(interrupts, 0);
    f.turn.stop();
    await firstInterrupt;
  }
});

test("folded internal command preserves the original published answer owner", async t => {
  const f = await publishedClaudeFixture(t);
  await f.send();
  await f.frame({ type: "command_lifecycle", command_uuid: "internal-notification", state: "started" });
  await f.frame({ type: "command_lifecycle", command_uuid: "internal-notification", state: "completed" });
  await f.frame({ type: "result", subtype: "success", result: "The user's answer" });
  await f.frame({ type: "command_lifecycle", command_uuid: claudeNativeMessageId("request"), state: "completed" });
  assert.equal(f.entry.turn.active, false);
  assert.equal(f.final()?.text, "The user's answer");
});


test("failed interruption reports definite non-delivery after the original process cleanup", async t => {
  const f = await publishedClaudeFixture(t);
  await f.send("original-input");
  let writes = 0;
  f.entry.process.client.send = async () => { writes++; };
  f.entry.process.client.interrupt = async () => { throw new Error("Interrupt was not acknowledged"); };
  await assert.rejects(f.send("goal-input"), error => error.delivery === "not-sent" &&
    error.message === "Interrupt was not acknowledged");
  assert.equal(writes, 0);
  assert.equal(f.entry.process, null, "The original stop owner still proves cleanup before returning");
});

test("interrupt confirmation timeout is a recoverable typed failure, not a generic server error", async () => {
  const { turn, send, client } = fixture();
  await send();
  await assert.rejects(turn.interruptGeneration(client, { timeoutMs: 5 }), error =>
    error.code === "assistant_claude_interrupt_timeout" && error.statusCode === 503 && /not sent/.test(error.message));
  turn.stop();
});


test("failed cleanup after interrupt failure retains the cleanup error and execution custody", async t => {
  const f = await publishedClaudeFixture(t);
  await f.send("original-input");
  const native = f.entry.process;
  const originalStop = native.stop;
  native.client.interrupt = async () => { throw new Error("Interrupt was not acknowledged"); };
  native.stop = async () => ({ scopeEmpty: false, exited: false });
  try {
    await assert.rejects(f.send("goal-input"), error => error.code === "claude_stop_unconfirmed" &&
      error.delivery !== "not-sent");
    assert.equal(f.entry.process, native);
    assert.ok(f.entry.executionId);
  } finally { native.stop = originalStop; }
});

for (const stage of ["preparation", "native-ready"]) test(`cancelled Claude goal cannot dispatch after ${stage}`, { timeout: 5_000 }, async t => {
  const controller = new AbortController();
  const f = await suppliedCommonFixture(t, { tools: false, signal: controller.signal });
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let sends = 0;
  if (stage === "preparation") f.binding.prepareInput = async input => {
    entered.resolve(); await release.promise; return input;
  };
  f.behavior.initialize = async native => {
    const send = native.client.send;
    native.client.send = (...args) => { sends++; return send(...args); };
    if (stage === "native-ready") { entered.resolve(); await release.promise; }
  };
  const operation = f.conversation.updateGoal({ action: "set", objective: "Finish the checks", messageId: "stopped-goal",
    expectedSegmentId: `claude:${f.conversationId}` });
  void operation.catch(() => {});
  await entered.promise;
  controller.abort(new Error("The person stopped this goal"));
  release.resolve();
  await assert.rejects(operation, error => error.delivery === "not-sent" && /goal command was stopped before delivery/.test(error.message));
  assert.equal(sends, 0, "No cancelled goal reaches the native input");
  assert.equal((await f.binding.transcript.readConversationLog()).length, 0, "An unsent goal has no accepted receipt");
});

test("raw Claude goal cancellation during native preparation prevents its write", { timeout: 5_000 }, async t => {
  const f = await publishedClaudeFixture(t);
  const controller = new AbortController();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let sends = 0;
  f.behavior.initialize = async native => {
    native.client.send = async () => { sends++; };
    entered.resolve(); await release.promise;
  };
  const operation = f.owner.updateGoal(f.entry, { action: "set", objective: "Finish the checks" }, { signal: controller.signal });
  void operation.catch(() => {});
  await entered.promise;
  controller.abort(new Error("Goal stopped"));
  release.resolve();
  await assert.rejects(operation, error => error.delivery === "not-sent");
  assert.equal(sends, 0);
});

test("aborting an admitted Claude goal preserves its receipt and final output", { timeout: 5_000 }, async t => {
  const controller = new AbortController();
  const f = await suppliedCommonFixture(t, { tools: false, signal: controller.signal });
  const result = await f.conversation.updateGoal({ action: "set", objective: "Finish the checks", messageId: "admitted-goal",
    expectedSegmentId: `claude:${f.conversationId}` });
  assert.equal(result.status, "accepted");
  controller.abort(new Error("The person stopped this goal"));
  await f.frame({ type: "result", subtype: "success", result: "Work already delivered" });
  await f.conversation.wait();
  const log = await f.binding.transcript.readConversationLog();
  assert.equal(log.flatMap(turn => turn.messages).filter(message => message.messageId === "admitted-goal").length, 1);
  assert.equal(f.entry.turn.state, "completed");
});

test("Claude goal cancellation at the final native write preserves definite non-delivery", { timeout: 5_000 }, async t => {
  const controller = new AbortController();
  const f = await suppliedCommonFixture(t, { tools: false, signal: controller.signal });
  let sends = 0;
  f.behavior.initialize = async native => { native.client.send = async () => { sends++; }; };
  f.setBeforeState((_entry, event) => { if (event.state === "starting") controller.abort(new Error("Stopped at write boundary")); });
  await assert.rejects(f.conversation.updateGoal({ action: "set", objective: "Finish the checks", messageId: "write-stopped-goal",
    expectedSegmentId: `claude:${f.conversationId}` }), error => error.delivery === "not-sent");
  assert.equal(sends, 0);
  assert.equal((await f.binding.transcript.readConversationLog()).length, 0);
});

for (const action of ["set", "resume"]) for (const finishCount of [1, 2]) test(`Claude goal re-admits a definite finished-turn race once, action=${action}, finishes=${finishCount}`, { timeout: 5_000 }, async t => {
  const f = await suppliedCommonFixture(t, { tools: false });
  let preparations = 0;
  let writes = 0;
  f.behavior.initialize = async native => {
    const send = native.client.send;
    native.client.send = async (...args) => { writes++; return send(...args); };
  };
  f.setBeforeState(async (_entry, event) => {
    // A resumed native process can finish its previous generation during the
    // host's asynchronous new-input checkpoint, before this input is written.
    if (event.state === "starting" && ++preparations <= finishCount) {
      await f.frame({ type: "result", subtype: "success", result: "Previous work finished" });
    }
  });
  let expectedGoalId;
  if (action === "resume") {
    const directory = path.join(f.context.workdir, "projects", f.context.workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${f.conversationId}.jsonl`), `${JSON.stringify({ type: "attachment",
      timestamp: "2026-10-16T00:00:00.000Z", attachment: { type: "goal_status", condition: "Finish the checks", met: false } })}\n`);
    expectedGoalId = (await f.conversation.readGoal()).id;
  }
  const input = { action, objective: "Finish the checks", messageId: "racing-goal", expectedGoalId,
    expectedSegmentId: `claude:${f.conversationId}` };
  const pending = f.conversation.updateGoal(input);
  if (finishCount === 2) {
    await assert.rejects(pending, error => error.code === "conversation_steer_turn_finished" && error.delivery === "not-sent");
    assert.equal(writes, 0);
  } else {
    assert.equal((await pending).status, "accepted");
    assert.equal(writes, 1, "The same goal is written only after definite non-delivery");
    await f.frame({ type: "result", subtype: "success", result: "Checks finished" });
    await f.conversation.wait();
    assert.equal((await f.conversation.updateGoal(input)).duplicate, true);
    const log = await f.binding.transcript.readConversationLog();
    assert.equal(log.flatMap(turn => turn.messages).filter(message => message.messageId === input.messageId).length, 1);
  }
  assert.equal(preparations, 2, "Only one re-admission is allowed");
});

test("Claude goal does not re-admit uncertain native delivery", { timeout: 5_000 }, async t => {
  const f = await suppliedCommonFixture(t, { tools: false });
  let writes = 0;
  f.behavior.initialize = async native => {
    native.client.send = async () => { writes++; throw Object.assign(new Error("Receipt unknown"), { delivery: "uncertain" }); };
  };
  await assert.rejects(f.conversation.updateGoal({ action: "set", objective: "Finish the checks",
    messageId: "uncertain-goal", expectedSegmentId: `claude:${f.conversationId}` }),
  error => error.delivery === "uncertain");
  assert.equal(writes, 1);
});

test("Claude goal re-admission preserves Stop during rejected dispatch cleanup", { timeout: 5_000 }, async t => {
  const controller = new AbortController();
  const f = await suppliedCommonFixture(t, { tools: false, signal: controller.signal });
  let preparations = 0;
  let writes = 0;
  f.behavior.initialize = async native => {
    const send = native.client.send;
    const stop = native.stop;
    native.client.send = async (...args) => { writes++; return send(...args); };
    native.stop = async () => { controller.abort(new Error("The person stopped this goal")); return stop(); };
  };
  f.setBeforeState(async (_entry, event) => {
    if (event.state === "starting") {
      preparations++;
      await f.frame({ type: "result", subtype: "success", result: "Previous work finished" });
    }
  });
  await assert.rejects(f.conversation.updateGoal({ action: "set", objective: "Finish the checks",
    messageId: "race-stopped-goal", expectedSegmentId: `claude:${f.conversationId}` }), /person stopped/);
  assert.equal(preparations, 1);
  assert.equal(writes, 0);
});

for (const observation of ["read", "ensureReady", "recover", "wait"]) test(`Claude ${observation} preserves its own pending startup lease`, { timeout: 5_000 }, async t => {
  const f = await publishedClaudeFixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let stops = 0;
  f.behavior.initialize = async native => {
    const stop = native.stop;
    native.stop = async () => { stops++; return stop(); };
    entered.resolve();
    await release.promise;
  };
  const starting = f.owner.ensureProcess(f.entry);
  void starting.catch(() => {});
  try {
    await entered.promise;
    assert.ok(f.entry.executionId);
    assert.equal(f.entry.process, null);
    if (observation === "recover") await f.owner.recover([f.entry]);
    else if (observation === "wait") await waitForClaudeConversationTurn({ state: f.entry,
      stop: reason => f.entry.nativeTurn.stopProcess(reason), read: () => f.owner.read(f.entry) });
    else await f.owner[observation](f.entry);
    assert.equal(stops, 0, "A live startup's retained cleanup handle is not an orphaned execution");
  } finally { release.resolve(); }
  await starting;
  assert.ok(f.entry.process);
  await f.owner.close(f.entry);
  assert.equal(stops, 1, "Explicit close still proves cleanup through the original owner");
});

test("Claude failed startup no longer exempts retained cleanup from reconciliation", { timeout: 5_000 }, async t => {
  const f = await publishedClaudeFixture(t);
  let stops = 0;
  f.behavior.initialize = async native => {
    const stop = native.stop;
    native.stop = async () => { stops++; return stop(); };
    throw new Error("Initialization failed with cleanup still owned");
  };
  await assert.rejects(f.owner.ensureProcess(f.entry), /Initialization failed/);
  await f.owner.recover([f.entry]);
  assert.equal(stops, 1);
  assert.equal(f.entry.executionId, "");
});

for (const action of ["set", "resume"]) test(`Claude ${action} waits for its exact delayed goal attachment`, { timeout: 5000 }, async t => {
  const f = await suppliedCommonFixture(t, { tools: false });
  const directory = path.join(f.context.workdir, "projects", f.context.workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${f.conversationId}.jsonl`), JSON.stringify({ type: "attachment", uuid: "previous-marker",
    timestamp: "2026-10-16T00:00:00.000Z", attachment: { type: "goal_status", condition: "Finish the checks", met: action === "set", sentinel: false } }) + "\n");
  const previous = await f.conversation.readGoal();
  const attached = Promise.withResolvers();
  f.behavior.beforeGoalAttachment = () => attached.promise;
  let finished = false;
  const updating = f.conversation.updateGoal({ action, objective: "Finish the checks", expectedGoalId: previous.id,
    messageId: "delayed-goal", expectedSegmentId: `claude:${f.conversationId}` }).then(result => { finished = true; return result; });
  while (!(await f.binding.transcript.hasMessage("delayed-goal"))) await delay(1);
  await delay(20);
  assert.equal(finished, false, "Admission must not return the previous goal as the command's result");
  attached.resolve();
  assert.equal((await updating).status, "accepted");
  const current = await f.owner.readGoal(f.entry);
  assert.equal(current.goalCommandId, claudeNativeMessageId("delayed-goal"));
  assert.notEqual(current.goal.createdAt, Date.parse("2026-10-16T00:00:00.000Z") / 1000);
  assert.equal(current.goal.status, "active");
});

test("Claude goal attachment timeout retains accepted delivery instead of returning an older goal", { timeout: 5000 }, async t => {
  const f = await publishedClaudeFixture(t);
  const attached = Promise.withResolvers();
  f.behavior.beforeGoalAttachment = () => attached.promise;
  await assert.rejects(f.owner.updateGoal(f.entry, { action: "set", objective: "Finish checks", messageId: "timeout-goal" },
    { attachmentTimeoutMs: 10 }), { code: "assistant_claude_goal_attachment_pending", delivery: "accepted" });
  attached.resolve();
  await f.behavior.goalAttachmentWork;
  assert.equal((await f.owner.readGoal(f.entry)).goalCommandId, claudeNativeMessageId("timeout-goal"));
});

test("Stop after Claude goal admission aborts attachment waiting without losing the accepted receipt", { timeout: 5000 }, async t => {
  const controller = new AbortController();
  const f = await suppliedCommonFixture(t, { tools: false, signal: controller.signal });
  const attached = Promise.withResolvers();
  f.behavior.beforeGoalAttachment = () => attached.promise;
  const updating = f.conversation.updateGoal({ action: "set", objective: "Finish checks", messageId: "stopped-attaching-goal",
    expectedSegmentId: `claude:${f.conversationId}` });
  const rejected = assert.rejects(updating, /abort|stopped/iu);
  while (!(await f.binding.transcript.hasMessage("stopped-attaching-goal"))) await delay(1);
  controller.abort(new Error("The goal was stopped"));
  await rejected;
  assert.equal(await f.binding.transcript.hasMessage("stopped-attaching-goal"), true);
  attached.resolve();
  await f.behavior.goalAttachmentWork;
});

test("Claude goal command proof survives only evaluations of its own condition", { timeout: 5000 }, async t => {
  const f = await suppliedCommonFixture(t, { tools: false });
  await f.conversation.updateGoal({ action: "set", objective: "Finish checks", messageId: "condition-proof",
    expectedSegmentId: `claude:${f.conversationId}` });
  const file = path.join(f.context.workdir, "projects", f.context.workdir.replace(/[^a-zA-Z0-9]/gu, "-"), `${f.conversationId}.jsonl`);
  const append = condition => appendFile(file, JSON.stringify({ type: "attachment", timestamp: new Date().toISOString(),
    attachment: { type: "goal_status", condition, met: false } }) + "\n");
  await append("Finish checks");
  assert.equal((await f.owner.readGoal(f.entry)).goalCommandId, claudeNativeMessageId("condition-proof"));
  await append("A different condition");
  const changed = await f.owner.readGoal(f.entry);
  assert.equal(changed.goal.objective, "A different condition");
  assert.equal(changed.goalCommandId, null, "an old command cannot prove a different goal");
});
