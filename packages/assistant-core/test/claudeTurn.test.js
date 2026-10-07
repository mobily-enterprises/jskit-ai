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
  f.history.userIds.push(f.uuid);
  f.history.messages.push({ userId: "other", role: "assistant", text: "Unrelated" },
    { userId: f.uuid, role: "thinking", text: "Private reasoning" },
    { userId: f.uuid, role: "assistant", text: "First" }, { userId: f.uuid, role: "assistant", text: "Second" });
  const result = await runClaudeRenewalTurn(f.conversation, f.input);
  assert.deepEqual(result, { text: "First\nSecond", threadId: f.state.id, turnId: f.uuid, reconciled: true,
    clientMessageId: f.input.clientMessageId, freshThread: false, processExitProof: { exited: true } });
  assert.deepEqual(f.events, ["history", ["stop", undefined]]);
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

test("Claude split completions carry the exact live output identity before native block retirement", async () => {
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
    const message = events.filter(event => event.type === "message").at(-1).message;
    assert.equal(message.id, "claude_saved_0");
    if (mode === "explicit-index") assert.equal(message.outputId, "claude_native_3");
    else assert.equal(Object.hasOwn(message, "outputId"), false, mode);
  }
});
