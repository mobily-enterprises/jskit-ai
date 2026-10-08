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


import { createClaudeConversationOwner } from "../src/server/conversation/claudeTurn.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Exercise the original supplied-store Send/process/event owner, without the
// standalone execution-release capability or application-tool branch.
async function publishedClaudeFixture(t, { publication = true, providerId = "anthropic", releaseExecution } = {}) {
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
      async hasMessage() { return false; }
    },
    preparation: {
      check() {}, account: () => ({ identity: behavior.account, providerId }),
      async configuration() { return { systemPrompt: "Retained host instructions", settings: {}, model: providerId === "deepseek" ? "deepseek-flash" : "sonnet" }; },
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
            },
            async interrupt() {
              await options.onEvent({ type: "result", subtype: "success", result: "", terminal_reason: "aborted_streaming" });
            } }
        };
        processes.push(native);
        await options.onStarted(native.executionId);
        return native;
      }
    },
    async onEvent(entry, event) {
      if (event.type === "before-state") await beforeState?.(entry, event);
      if (event.type === "message" && event.message.complete && event.message.role === "assistant") {
        await behavior.beforePublish?.();
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
