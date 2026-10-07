import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rename, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConversationRuntime, createFileConversationStorage, upgradeConversationRuntimeState } from "../src/server/conversation/index.js";
import { createLocalConversationExecution } from "../src/server/conversation/localExecution.js";
import { createClaudeConversationDriver } from "../src/server/conversation/providers/claudeDriver.js";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "json-rest-schema";

const configuration = { systemPrompt: "Keep these instructions fresh.", model: "test-model", effort: "high" };
const input = { messageId: "first", text: "Hello" };

test("Claude account checks use the supplied finite capture policy without starting a conversation service", async t => {
  const local = createLocalConversationExecution();
  const checks = [];
  const f = await fixture(t, { execution: {
    async run(request) {
      checks.push(request);
      assert.equal(request.mode, "capture");
      assert.equal(request.cwd, request.baseEnv.HOME);
      assert.deepEqual(request.args, ["auth", "status", "--json"]);
      assert.equal(request.timeout, 30_000);
      assert.equal(request.maxBuffer, 64 * 1024);
      assert.equal(request.signal.aborted, false);
      return { ok: true, exitCode: 0, stdout: JSON.stringify({ loggedIn: true,
        authMethod: "claude.ai", email: "owner@example.test" }) };
    },
    start(request) {
      assert.equal(request.args.includes("auth"), false, "Account checks must not borrow the native-turn execution policy");
      return local.start(request);
    },
    stop: local.stop
  } });
  await f.conversation.send(input);
  const result = await f.conversation.wait();
  assert.equal(result.conversationLog[0].metadata.runtime.status, "complete", result.error);
  assert.equal(result.conversationLog[0].assistant.text, "Answer: Hello");
  assert.ok(checks.length > 0);
});

test("Claude exposes the durable native identity before dispatch and respects a rejected gate", async t => {
  const f = await fixture(t);
  await f.first.close();
  const driver = createClaudeConversationDriver(f.driverOptions);
  const readBinding = () => f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  const provider = await driver.open({ binding: await readBinding(),
    writeBinding: binding => f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.binding = binding;
      await tx.writeMetadata(metadata);
    }),
    onFailure() {}
  });
  const blocked = new Error("Dispatch stopped by the persisted delivery gate.");
  let checked = false;
  try {
    await assert.rejects(provider.run({ configuration, input, signal: new AbortController().signal,
      async beforeDispatch(identity) {
        assert.deepEqual(identity, { threadId: (await readBinding()).conversationId });
        assert.ok(identity.threadId);
        checked = true;
        throw blocked;
      },
      accept() { assert.fail("A rejected dispatch must not admit the message."); },
      onMessage() {}, onEvent() {}
    }), error => error === blocked);
    assert.equal(checked, true);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 0);
  } finally { await provider.dispose(); }
});

test("native Claude coding tools require the server-side host grant", async t => {
  const f = await fixture(t, { nativeTools: true });
  await f.conversation.send(input);
  const result = await f.conversation.wait();
  assert.equal(result.conversationLog[0].metadata.runtime.status, "complete", result.error);
  assert.equal(result.capabilities.nativeTools, true);
  const args = (await f.trace()).find(row => row.args?.includes("--print")).args;
  assert.equal(args[args.indexOf("--permission-mode") + 1], "bypassPermissions");
  assert.match(args[args.indexOf("--tools") + 1], /Bash,Read,Edit,Write/);
  assert.equal(args.includes("--restricted"), false);
  assert.equal(args.includes("--safe-mode"), true);
  assert.deepEqual(JSON.parse(args[args.indexOf("--mcp-config") + 1]), { mcpServers: {} });
});

test("Claude installs the host command hook through SDK controls while ambient hooks stay disabled", async t => {
  const f = await fixture(t, { nativeTools: true, commandWrapper: "/host/command wrapper" });
  await f.conversation.send({ messageId: "command", text: "wrapped-command" });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
  const output = JSON.parse(state.conversationLog[0].assistant.text).hookSpecificOutput;
  assert.equal(output.updatedInput.command, "'/host/command wrapper' 'pwd'");
  assert.equal(output.updatedInput.timeout, 100);
  const trace = await f.trace();
  assert.equal(trace.find(row => row.args?.includes("--print")).args.includes("--safe-mode"), true);
  assert.deepEqual(trace.find(row => row.frame?.request?.subtype === "initialize").frame.request.hooks, {
    PreToolUse: [{ matcher: "^Bash$", hookCallbackIds: ["jskit-command-wrapper"], timeout: 30 }]
  });
});

test("Claude receives authorized attachments and carries them into a replacement once", async t => {
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
  assert.deepEqual(first.conversationLog[0].user.attachments, [receipt]);
  assert.deepEqual((await f.trace()).find(row => row.frame?.type === "user").frame.message.content, [
    { type: "text", text: input.text }, { type: "image", source: { type: "base64", media_type: "image/png", data: image.toString("base64") } }
  ]);
  await f.conversation.replace({ operationId: "renew", reason: "renewal", expectedSegmentId: first.segmentId });
  await f.conversation.send({ messageId: "second", text: "Continue" });
  await f.conversation.wait();
  const renewed = (await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content;
  assert.equal(renewed.filter(part => part.type === "image").length, 1);
  await f.conversation.send({ messageId: "third", text: "Next" });
  await f.conversation.wait();
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content, "Next");
  assert.equal(reads, 2);
});

test("native replacement saves preparation before close and retries the same inert successor after an interrupted commit", async t => {
  const local = createLocalConversationExecution();
  const nativeIds = new Set();
  const events = [];
  let failCommit = false;
  let inspectClose = false;
  let readRuntime;
  const f = await fixture(t, {
    execution: {
      async start(options) {
        const native = await local.start(options);
        if (options.args.includes("--print")) nativeIds.add(native.id);
        return native;
      },
      async stop(id) {
        if (inspectClose && nativeIds.has(id)) {
          const saved = await readRuntime();
          assert.ok(saved.replacement.preparedAt, "Preparing is durable before the predecessor is closed");
          events.push("close");
        }
        return local.stop(id);
      }
    },
    wrapStorage: storage => ({ ...storage, write: (id, callback) => storage.write(id, async transaction => {
      const previous = await transaction.readMetadata();
      const result = await callback(transaction);
      const next = await transaction.readMetadata();
      if (next.runtime?.replacement && !previous.runtime?.replacement) events.push("prepared");
      if (previous.runtime?.replacement && !next.runtime?.replacement) {
        events.push("commit");
        if (failCommit) throw new Error("Storage offline during native replacement commit");
      }
      return result;
    }) })
  });
  t.after(() => local.close());
  readRuntime = () => f.storage.read("conversation", async transaction => (await transaction.readMetadata()).runtime);
  await f.conversation.send(input);
  const before = await f.conversation.wait();
  const predecessor = await readRuntime();
  const operation = { operationId: "native-renewal", reason: "renewal", expectedSegmentId: before.segmentId,
    briefing: "Keep the agreed blue clock." };
  failCommit = true;
  inspectClose = true;
  try { await assert.rejects(f.conversation.replace(operation), /Storage offline during native replacement commit/); }
  finally { inspectClose = false; }
  assert.deepEqual(events, ["prepared", "close", "commit"]);
  const interrupted = await readRuntime();
  assert.equal(interrupted.segmentId, predecessor.segmentId);
  assert.equal(interrupted.binding.conversationId, predecessor.binding.conversationId);
  assert.deepEqual(interrupted.seen, predecessor.seen);
  assert.equal(interrupted.predecessors.length, 0);
  assert.ok(interrupted.replacement.preparedAt);
  const successor = interrupted.replacement;
  assert.notEqual(successor.binding.conversationId, predecessor.binding.conversationId);
  assert.equal(successor.binding.sent, false);
  assert.equal(successor.binding.executionId, "");
  assert.equal(nativeIds.size, 1, "Opening a successor handle must not start a native process");
  await assert.rejects(f.conversation.send({ messageId: "early", text: "Too early" }), { code: "conversation_replacement_pending" });
  await assert.rejects(f.conversation.replace({ ...operation, briefing: "Changed" }), { code: "conversation_replacement_pending" });
  await f.first.close();
  failCommit = false;
  const resumed = await f.runtime().open({ id: "conversation" });
  const replaced = await resumed.replace(operation);
  assert.equal(replaced.segmentId, successor.segmentId);
  const ready = await readRuntime();
  assert.equal(ready.binding.conversationId, successor.binding.conversationId);
  assert.equal(ready.replacement, undefined);
  assert.equal(ready.lastEngine, "");
  assert.deepEqual(ready.seen, {});
  assert.equal(ready.predecessors.length, 1);
  assert.equal(ready.predecessors[0].preparedAt, successor.preparedAt);
  assert.equal(ready.predecessors[0].binding.conversationId, predecessor.binding.conversationId);
  assert.deepEqual(ready.predecessors[0].seen, predecessor.seen);
  assert.equal(ready.predecessors[0].acceptedAt, undefined, "Preparation does not retire native history");
  assert.equal(nativeIds.size, 1);
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  assert.deepEqual(await resumed.replace(operation), { ...replaced, duplicate: true });
  await resumed.send({ messageId: "successor", text: "Continue" });
  const delivered = await resumed.wait();
  const accepted = await readRuntime();
  assert.ok(accepted.predecessors[0].acceptedAt);
  assert.equal(accepted.predecessors[0].successorConversationId, successor.binding.conversationId);
  assert.deepEqual(delivered.conversationLog.map(turn => turn.user.text), ["Hello", "Continue"]);
  const firstPrompt = (await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content;
  assert.match(firstPrompt, /Keep the agreed blue clock/);
  assert.equal(nativeIds.size, 2);
  await resumed.send({ messageId: "after-successor", text: "Next" });
  await resumed.wait();
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content, "Next");
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-claude-conversation-"));
  const command = path.join(directory, "claude.mjs");
  const account = path.join(directory, "claude", ".credentials.json");
  const trace = path.join(directory, "trace.jsonl");
  await mkdir(path.dirname(account));
  await writeFile(account, "owner@example.test");
  await writeFile(command, `#!${process.execPath}
    import { createInterface } from "node:readline";
    import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
    import path from "node:path";
    const args = process.argv.slice(2);
    const structuredResponse = ${JSON.stringify(options.structuredResponse || null)};
    const option = name => args[args.indexOf(name) + 1];
    const log = value => appendFileSync(process.env.TEST_TRACE, JSON.stringify(value) + "\\n");
    const emit = value => process.stdout.write(JSON.stringify(value) + "\\n");
    log({ args, routing: Object.fromEntries(["ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_AUTO_COMPACT_WINDOW"].map(key => [key, process.env[key]])) });
    if (args[0] === "auth") {
      emit({ loggedIn: true, authMethod: "claude.ai", email: readFileSync(process.env.TEST_ACCOUNT, "utf8") });
      process.exit(0);
    }
    const id = option(args.includes("--resume") ? "--resume" : "--session-id");
    const project = path.join(process.env.CLAUDE_CONFIG_DIR, "projects", process.cwd().replace(/[^a-zA-Z0-9]/gu, "-"));
    mkdirSync(project, { recursive: true });
    const record = frame => appendFileSync(path.join(project, id + ".jsonl"), JSON.stringify(frame) + "\\n");
    const controls = new Map();
    let controlId = 0;
    const request = value => new Promise((resolve, reject) => {
      const id = "native-control-" + (++controlId);
      controls.set(id, { resolve, reject });
      emit({ type: "control_request", request_id: id, request: value });
    });
    createInterface({ input: process.stdin }).on("line", async line => {
      const frame = JSON.parse(line);
      log({ frame });
      if (frame.type === "control_response") {
        const pending = controls.get(frame.response.request_id); controls.delete(frame.response.request_id);
        if (frame.response.subtype === "error") pending.reject(new Error(frame.response.error));
        else pending.resolve(frame.response.response);
        return;
      }
      if (frame.type === "control_request") {
        if (frame.request.subtype === "initialize" && process.env.TEST_STARTUP_WAIT) return;
        const reject = frame.request.subtype === "apply_flag_settings" && process.env.TEST_REJECT_EFFORT && frame.request.settings.effortLevel === process.env.TEST_REJECT_EFFORT;
        emit({ type: "control_response", response: { request_id: frame.request_id,
          subtype: reject ? "error" : "success", error: reject ? "Settings rejected" : undefined, response: {} } });
        if (frame.request.subtype === "interrupt") emit({ type: "result", subtype: "success", terminal_reason: "aborted_streaming", result: "" });
        return;
      }
      record(frame);
      const text = typeof frame.message.content === "string" ? frame.message.content
        : frame.message.content.filter(part => part.type === "text").map(part => part.text).join(" ");
      let answer = { type: "assistant", uuid: frame.uuid + "-answer", message: { content: [{ type: "text", text: "Answer: " + text }] } };
      if (structuredResponse) answer.message.content[0].text = JSON.stringify(structuredResponse);
      if (text === "lost") { record(answer); return; }
      if (text.startsWith("/goal ")) {
        const condition = text.slice(6);
        record({ type: "attachment", timestamp: new Date().toISOString(),
          attachment: { type: "goal_status", condition, sentinel: true, met: condition === "clear" } });
        if (process.env.TEST_GOAL_LOST_ACK) return;
        emit(frame);
        if (condition === "clear") emit({ type: "result", subtype: "success", result: "" });
        return;
      }
      emit(frame);
      if (text === "wait") return;
      if (text === "steering") {
        answer.message.content[0].text = "Initial progress";
        answer.message.id = frame.uuid + "-before";
        record(answer); emit(answer); return;
      }
      if (text === "phases") {
        emit({ type: "system", subtype: "status", status: "compacting" });
        emit({ type: "system", subtype: "compact_boundary" });
      }
      if (text === "failed") { emit({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["Model connection failed."] }); return; }
      if (text === "wrapped-command") {
        const output = await request({ subtype: "hook_callback", callback_id: "jskit-command-wrapper",
          input: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pwd", timeout: 100 } } });
        answer.message.content[0].text = JSON.stringify(output);
      }
      if (text === "tools" || text === "foreign-tool") {
        let sequence = 0;
        const invoke = async (name, input) => {
          const toolId = frame.uuid + "-tool-" + (++sequence);
          const use = { type: "assistant", uuid: toolId, message: { content: [{ type: "tool_use", id: toolId, name: "mcp__application__" + name, input }] } };
          record(use); emit(use);
          return request({ subtype: "mcp_message", server_name: "application", message: {
            jsonrpc: "2.0", id: sequence, method: "tools/call",
            params: { name, arguments: input, _meta: { "claudecode/toolUseId": text === "foreign-tool" ? "foreign-id" : toolId } }
          } });
        };
        try {
          await invoke("assistant_action_search", { query: "numbers" });
          await invoke("assistant_action_contract", { actionId: "numbers.read", version: 1 });
          const result = await invoke("assistant_action_execute", { actionId: "numbers.read", version: 1, input: {} });
          answer.message.content[0].text = result.mcp_response.result.content[0].text;
        } catch (error) {
          emit({ type: "result", subtype: "error_during_execution", is_error: true, errors: [error.message] }); return;
        }
      }
      emit({ type: "stream_event", event: { type: "message_start", message: { id: frame.uuid + "-stream" } } });
      emit({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
      emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { text: answer.message.content[0].text.slice(0, 8) } } });
      emit({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
      answer.message.id = frame.uuid + "-stream";
      const thinking = { type: "assistant", uuid: frame.uuid + "-thinking", message: { content: [{ type: "thinking", thinking: "Reasoning summary" }] } };
      record(thinking); emit(thinking);
      record(answer); emit(answer);
      emit({ type: "result", subtype: "success", result: answer.message.content[0].text,
        ...(structuredResponse ? { structured_output: structuredResponse } : {}) });
    });
  `, { mode: 0o700 });
  const fileStorage = createFileConversationStorage({ directory: path.join(directory, "storage") });
  const storage = options.wrapStorage ? options.wrapStorage(fileStorage) : fileStorage;
  const runtimes = [];
  t.after(async () => {
    try { for (const runtime of runtimes) await runtime.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const env = { ...process.env, ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_API_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "",
    CLAUDE_CONFIG_DIR: path.join(directory, "claude"), TEST_TRACE: trace, TEST_ACCOUNT: account, ...options.environment };
  function runtime() {
    const value = createConversationRuntime({ engine: "claude", storage, authorize: options.authorize || (() => true), actions: options.actions,
      connections: options.connections, attachments: options.attachments,
      host: { workdir: directory, env, commands: { claude: command }, execution: options.execution, nativeTools: options.nativeTools, commandWrapper: options.commandWrapper },
      limits: { admissionTimeoutMs: 150, ...options.limits } });
    runtimes.push(value);
    return value;
  }
  const first = runtime();
  const conversation = await first.open({ id: "conversation", configuration: options.configuration || configuration, context: options.context });
  return { directory, storage, account, runtime, first, conversation,
    driverOptions: { connections: options.connections,
      host: { workdir: directory, env, commands: { claude: command }, execution: options.execution, nativeTools: options.nativeTools, commandWrapper: options.commandWrapper },
      limits: { admissionTimeoutMs: 150, ...options.limits } },
    async trace() { return (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line)); } };
}

test("Claude structured output reuses the original schema flag and restarts only when its schema changes", async t => {
  const outputSchema = { type: "object", additionalProperties: false,
    properties: { answer: { type: "string", maxLength: 32 } }, required: ["answer"] };
  const f = await fixture(t, { configuration: { ...configuration, outputSchema }, structuredResponse: { answer: "Done" } });
  await f.conversation.send(input);
  const first = await f.conversation.wait();
  assert.equal(first.capabilities.structuredOutput, true);
  assert.deepEqual(first.configuration.outputSchema, outputSchema);
  assert.equal(first.conversationLog[0].assistant.text, '{"answer":"Done"}');
  const launches = async () => (await f.trace()).filter(row => row.args?.includes("--print"));
  const initialArgs = (await launches())[0].args;
  assert.deepEqual(JSON.parse(initialArgs.at(initialArgs.indexOf("--json-schema") + 1)), outputSchema);
  const nativeId = (await f.storage.read("conversation", tx => tx.readMetadata())).runtime.binding.conversationId;
  await f.conversation.configure({ model: "second-model" });
  await f.conversation.send({ messageId: "same-schema", text: "Keep the schema" });
  await f.conversation.wait();
  assert.equal((await launches()).length, 1, "An unchanged output schema permits the existing native model update");
  const changed = { ...outputSchema, properties: { answer: { type: "string", maxLength: 64 } } };
  await f.conversation.configure({ outputSchema: changed });
  await f.conversation.send({ messageId: "new-schema", text: "Use the updated schema" });
  const last = await f.conversation.wait();
  const processes = await launches();
  assert.equal(processes.length, 2);
  assert.deepEqual(JSON.parse(processes[1].args.at(processes[1].args.indexOf("--json-schema") + 1)), changed);
  assert.equal((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.binding.conversationId, nativeId);
  assert.equal(last.conversationLog.length, 3);
});

test("the common Claude API admits, streams, persists reasoning and deduplicates the same request", async t => {
  const f = await fixture(t);
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  const receipt = await f.conversation.send(input);
  assert.equal(receipt.status, "accepted");
  const snapshot = await f.conversation.wait();
  assert.equal(snapshot.conversationLog[0].assistant.text, "Answer: Hello");
  assert.equal(snapshot.conversationLog[0].thinking[0].text, "Reasoning summary");
  assert.equal(snapshot.conversationLog[0].metadata.runtime.status, "complete");
  assert.ok(events.some(event => event.type === "message" && event.text === "Answer: "));
  const replies = events.filter(event => event.type === "message" && event.role === "assistant");
  // Production Claude uses temporary stream ids and native snapshot UUIDs.
  // The discarded receiver invented a shared id that disagreed with history.
  assert.equal(new Set(replies.map(event => event.messageId)).size, 2);
  const partial = replies.find(event => event.status === "inProgress");
  const complete = replies.find(event => event.status === "complete");
  assert.notEqual(partial.messageId, complete.messageId);
  assert.ok(events.some(event => event.type === "message-complete" && event.messageId === partial.messageId));
  assert.equal(snapshot.conversationLog[0].assistant.messageId, complete.messageId);
  assert.deepEqual(snapshot.conversationLog[0].commentary, []);
  assert.deepEqual(snapshot.streaming.messages, []);
  assert.equal((await f.conversation.send(input)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
});

test("Claude reports common work and compaction phases and clears phase after settling", async t => {
  const f = await fixture(t);
  const phases = [];
  await f.conversation.subscribe(event => { if (event.type === "phase") phases.push(event.phase); });
  await f.conversation.send({ messageId: "phases", text: "phases" });
  assert.equal((await f.conversation.wait()).phase, "");
  assert.deepEqual(phases, ["preparing", "working", "compacting", "working", ""]);
});

test("Claude steering interrupts generation and admits a distinct message without replacing its process", async t => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const events = [];
  await f.conversation.subscribe(event => {
    events.push(event);
    if (event.type === "message" && event.text === "Initial progress") started.resolve();
  });
  await f.conversation.send({ messageId: "before", text: "steering" });
  await started.promise;
  const steering = { messageId: "after", text: "Continue differently", steer: true };
  const [one, two] = await Promise.all([f.conversation.send(steering), f.conversation.send(steering)]);
  assert.equal(one.turnId, two.turnId);
  const state = await f.conversation.wait();
  assert.equal(state.error, "");
  assert.equal(state.conversationLog.length, 2);
  assert.equal(state.conversationLog[0].assistant.text, "Initial progress");
  assert.equal(state.conversationLog[1].assistant.text, "Answer: Continue differently");
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.args?.includes("--print")).length, 1);
  assert.equal(trace.filter(row => row.frame?.type === "user").length, 2);
  assert.equal(trace.filter(row => row.frame?.request?.subtype === "interrupt").length, 1);
  assert.equal((await f.conversation.send(steering)).duplicate, true);
  for (const turn of state.conversationLog) assert.equal(turn.assistant.messageId,
    events.find(event => event.role === "assistant" && event.status === "complete" && event.turnId === turn.turnId).messageId);
});

test("lost Claude steering acknowledgement is recovered without another native submission", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "before", text: "wait" });
  const input = { messageId: "lost-steering", text: "lost", steer: true };
  await assert.rejects(f.conversation.send(input), /not acknowledged/);
  assert.equal((await f.conversation.wait()).status, "unconfirmed");
  assert.equal((await f.conversation.inspectDelivery({ messageId: input.messageId })).status, "accepted");
  assert.equal((await f.conversation.send(input)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 2);
});

test("native Send retries inspect the durable prompt receipt before duplicate handling or another dispatch", async t => {
  const f = await fixture(t);
  const request = { messageId: "lost-receipt", text: "lost" };
  await assert.rejects(f.conversation.send(request), /not acknowledged/);
  await f.conversation.wait();
  const saved = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime;
  assert.equal(saved.version, 3);
  assert.equal(saved.request.message, request.text);
  assert.equal(saved.request.displayMessage, request.text);
  assert.equal(saved.request.attempted, true);
  assert.equal(saved.request.threadId, saved.binding.conversationId);
  assert.equal(Object.hasOwn((await f.conversation.read()).pendingRequest, "message"), false);
  await f.first.close();
  const resumed = await f.runtime().open({ id: "conversation" });
  assert.equal((await resumed.send(request)).status, "accepted");
  const recovered = await resumed.wait();
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.conversationLog[0].user.text, request.text);
  assert.equal(recovered.conversationLog[0].assistant.text, "Answer: lost");
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  assert.equal((await resumed.send(request)).duplicate, true);
});

test("native changeover keeps the prepared prompt frozen across rejection, transcript edits and retry", async t => {
  const f = await fixture(t, { environment: { TEST_REJECT_EFFORT: "low" } });
  await f.conversation.send(input);
  const first = await f.conversation.wait();
  await f.conversation.replace({ operationId: "freeze-renewal", reason: "renewal", expectedSegmentId: first.segmentId });
  await f.conversation.configure({ effort: "low" });
  const request = { messageId: "frozen", text: "Continue" };
  await assert.rejects(f.conversation.send(request), /Settings rejected/);
  await f.conversation.wait();
  const pending = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime.request;
  assert.equal(pending.attempted, false);
  assert.match(pending.message, /Answer: Hello/);
  await f.storage.write("conversation", transaction => transaction.replaceAssistant(first.conversationLog[0].turnId,
    { role: "assistant", messageId: first.conversationLog[0].assistant.messageId, text: "Edited after preparation", at: new Date().toISOString() }));
  await f.conversation.configure({ effort: "high" });
  await f.conversation.send(request);
  await f.conversation.wait();
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content, pending.message);
  await f.conversation.send({ messageId: "correction", text: "Continue again" });
  await f.conversation.wait();
  assert.match((await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content, /Edited after preparation/);
});

test("an offline-upgraded native reservation is inspected without reconstructing its missing prompt", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  const previous = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime.seen;
  const request = { messageId: "old-receipt", text: "lost" };
  await assert.rejects(f.conversation.send(request), /not acknowledged/);
  await f.conversation.wait();
  await f.first.close();
  await f.storage.write("conversation", async transaction => {
    const metadata = await transaction.readMetadata();
    const saved = metadata.runtime.request;
    metadata.runtime.version = 2;
    delete metadata.runtime.lastEngine;
    metadata.runtime.request = Object.fromEntries(["messageId", "text", "origin", "attachments", "at", "error"]
      .map(name => [name, saved[name]]));
    const conversationLog = await Promise.all((await transaction.listTurnIds()).map(id => transaction.readTurn(id)));
    await transaction.writeMetadata(upgradeConversationRuntimeState({ metadata, conversationLog }).metadata);
  });
  const before = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime.request;
  assert.equal(before.inspectionOnly, true);
  assert.equal(Object.hasOwn(before, "message"), false);
  assert.equal(Object.hasOwn(before, "seen"), false);
  const resumed = await f.runtime().open({ id: "conversation" });
  assert.equal((await resumed.send(request)).status, "accepted");
  await resumed.wait();
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 2);
  const saved = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime;
  assert.equal(saved.request, undefined);
  assert.deepEqual(saved.seen, previous, "An absent old snapshot cannot acknowledge additional history");
  assert.equal((await resumed.read()).conversationLog[1].user.text, request.text);
});

test("Claude reuses the process, changes compatible settings live and resumes the same history for changed instructions", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  await f.conversation.configure({ model: "another-model", effort: "low" });
  await f.conversation.send({ messageId: "second", text: "Second" });
  await f.conversation.wait();
  let starts = (await f.trace()).filter(row => row.args?.includes("--print"));
  assert.equal(starts.length, 1);
  await f.conversation.configure({ systemPrompt: "New instructions." });
  await f.conversation.send({ messageId: "third", text: "Third" });
  await f.conversation.wait();
  starts = (await f.trace()).filter(row => row.args?.includes("--print"));
  assert.equal(starts.length, 2);
  assert.equal(starts[0].args[starts[0].args.indexOf("--session-id") + 1], starts[1].args[starts[1].args.indexOf("--resume") + 1]);
  assert.equal(starts[1].args[starts[1].args.indexOf("--system-prompt") + 1], "New instructions.");
  assert.equal(starts[1].args[starts[1].args.indexOf("--system-prompt-snapshot") + 1], "off");
  assert.deepEqual((await f.trace()).filter(row => row.frame?.type === "user").map(row => row.frame.message.content), ["Hello", "Second", "Third"]);
});

test("clean shutdown and reopen retain native identity, configuration and application receipts", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  await f.first.close();
  const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  assert.equal(binding.executionId, "");
  const reopened = await f.runtime().open({ id: "conversation" });
  assert.equal((await reopened.send(input)).duplicate, true);
  await reopened.send({ messageId: "after-restart", text: "Continue" });
  assert.equal((await reopened.wait()).conversationLog.length, 2);
  const starts = (await f.trace()).filter(row => row.args?.includes("--print"));
  assert.equal(starts[1].args[starts[1].args.indexOf("--resume") + 1], binding.conversationId);
});

test("cancel drains native work and allows a subsequent request in the same conversation", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "waiting", text: "wait" });
  assert.equal((await f.conversation.read()).status, "working");
  assert.deepEqual(await f.conversation.cancel(), { stopped: true });
  assert.equal((await f.conversation.read()).conversationLog[0].metadata.runtime.status, "cancelled");
  const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  assert.equal(binding.executionId, "");
  await f.conversation.send(input);
  assert.equal((await f.conversation.wait()).conversationLog[1].assistant.text, "Answer: Hello");
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

test("Claude uses shared discovery and durable application results across native resume", async t => {
  let executions = 0;
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  const f = await fixture(t, { context, actions: applicationActions(async () => { executions++; return { value: 42 }; }) });
  await f.conversation.send({ messageId: "tool-turn", text: "tools" });
  const first = await f.conversation.wait();
  assert.equal(first.conversationLog[0].metadata.runtime.status, "complete");
  assert.equal(first.conversationLog[0].metadata.applicationTools.length, 3);
  assert.equal(JSON.parse(first.conversationLog[0].assistant.text).result.result.value, 42);
  assert.equal(executions, 1);
  const started = (await f.trace()).find(row => row.args?.includes("--print"));
  assert.equal(started.args[started.args.indexOf("--tools") + 1], "");
  assert.deepEqual(JSON.parse(started.args[started.args.indexOf("--mcp-config") + 1]), {
    mcpServers: { application: { type: "sdk", name: "application" } }
  });
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
  const starts = (await f.trace()).filter(row => row.args?.includes("--print"));
  assert.equal(starts.length, 2, "Permission changes do not replace the native process");
  assert.equal(starts[0].args[starts[0].args.indexOf("--session-id") + 1], starts[1].args[starts[1].args.indexOf("--resume") + 1]);
});

test("Claude rejects an application call without the preceding native tool identity", async t => {
  let executions = 0;
  const f = await fixture(t, {
    actions: applicationActions(async () => { executions++; return { value: 42 }; }),
    context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] }
  });
  await f.conversation.send({ messageId: "foreign", text: "foreign-tool" });
  const result = await f.conversation.wait();
  assert.equal(executions, 0);
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(result.error, /does not match an admitted native tool use/);
  assert.deepEqual(result.conversationLog[0].metadata.applicationTools, []);
});

test("Claude cancellation waits for an application effect after closing the native process", async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  const f = await fixture(t, {
    actions: applicationActions(async () => { entered.resolve(); return complete.promise; }),
    context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] }
  });
  t.after(() => complete.resolve({ value: 42 }));
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
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
});

test("the common request deadline stops an unfinished native turn and retains its admitted history", async t => {
  const f = await fixture(t, { limits: { timeoutMs: 2000 } });
  await f.conversation.send({ messageId: "waiting", text: "wait" });
  const snapshot = await f.conversation.wait();
  assert.equal(snapshot.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(snapshot.error, /time limit/);
  const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  assert.equal(binding.executionId, "");
});

test("uncertain native delivery is reconciled from history without a second inference", async t => {
  const f = await fixture(t);
  await assert.rejects(f.conversation.send({ messageId: "lost-ack", text: "lost" }), error => error.delivery === "uncertain");
  assert.equal((await f.conversation.wait()).status, "unconfirmed");
  const binding = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime.binding;
  const historyPath = path.join(f.directory, "claude", "projects", f.directory.replace(/[^a-zA-Z0-9]/gu, "-"), `${binding.conversationId}.jsonl`);
  // A production Send checks the previous receipt first. Keep that receipt
  // genuinely unavailable while proving the unknown-delivery refusal.
  await rename(historyPath, `${historyPath}.unavailable`);
  try { await assert.rejects(f.conversation.send(input), { code: "conversation_delivery_uncertain" }); }
  finally { await rename(`${historyPath}.unavailable`, historyPath); }
  const receipt = await f.conversation.inspectDelivery({ messageId: "lost-ack" });
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.recovered, true);
  const snapshot = await f.conversation.read();
  assert.equal(snapshot.conversationLog[0].assistant.text, "Answer: lost");
  assert.equal(snapshot.conversationLog[0].metadata.runtime.status, "interrupted");
  assert.equal(snapshot.status, "ready");
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
});

test("inspecting an older accepted Claude message leaves a different pending receipt untouched", async t => {
  const f = await fixture(t);
  const first = await f.conversation.send(input);
  await f.conversation.wait();
  await assert.rejects(f.conversation.send({ messageId: "later-lost", text: "lost" }), error => error.delivery === "uncertain");
  assert.equal((await f.conversation.wait()).status, "unconfirmed");
  const saved = (await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime;
  const expected = { status: "accepted", messageId: input.messageId, turnId: first.turnId, duplicate: true };
  assert.deepEqual(await f.conversation.inspectDelivery({ messageId: input.messageId }), expected);
  assert.deepEqual((await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime.request, saved.request);
  assert.equal((await f.conversation.read()).conversationLog.length, 1);
  const historyPath = path.join(f.directory, "claude", "projects", f.directory.replace(/[^a-zA-Z0-9]/gu, "-"), `${saved.binding.conversationId}.jsonl`);
  await rename(historyPath, `${historyPath}.unavailable`);
  try {
    assert.deepEqual(await f.conversation.inspectDelivery({ messageId: input.messageId }), expected);
    assert.deepEqual((await f.storage.read("conversation", transaction => transaction.readMetadata())).runtime.request, saved.request);
    assert.equal((await f.conversation.read()).status, "unconfirmed");
  } finally { await rename(`${historyPath}.unavailable`, historyPath); }
  assert.equal((await f.conversation.inspectDelivery({ messageId: "later-lost" })).recovered, true);
  assert.equal((await f.conversation.read()).status, "ready");
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 2);
});

test("accepted Claude output can be recovered after restart without claiming unproven completion", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  const finished = await f.conversation.wait();
  await f.first.close();
  await f.storage.write("conversation", async transaction => {
    const turn = await transaction.readTurn("000001");
    await transaction.updateTurnMetadata(turn.turnId, { runtime: { ...turn.metadata.runtime, status: "running" } });
    await transaction.replaceAssistant(turn.turnId, { ...turn.assistant, text: "Partial reply" });
  });
  const reopened = await f.runtime().open({ id: "conversation" });
  assert.equal((await reopened.inspectDelivery({ messageId: input.messageId })).recovered, true);
  const state = await reopened.read();
  assert.equal(state.conversationLog[0].assistant.text, finished.conversationLog[0].assistant.text);
  assert.equal(state.conversationLog[0].metadata.runtime.status, "interrupted");
  await reopened.inspectDelivery({ messageId: input.messageId });
  assert.deepEqual((await reopened.read()).conversationLog, state.conversationLog);
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
});

test("changed native login cannot continue another account's conversation", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  await writeFile(f.account, "different@example.test");
  await assert.rejects(f.conversation.send({ messageId: "second", text: "No access" }), /another Claude account/);
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  assert.equal((await f.conversation.read()).conversationLog.length, 1);
});

// Ported from the production provider's control-order case. The common fixture
// observes native JSON controls instead of the application's provider wrapper.
test("Claude changes provider controls before model and keeps the native conversation", async t => {
  let apiKey = "fixture-deepseek-secret";
  const f = await fixture(t, { connections: { resolve: async () => ({
    providerId: "deepseek", model: "deepseek-flash", apiKey
  }) } });
  await f.conversation.send({ messageId: "plan", text: "Plan this" });
  await f.conversation.wait();
  const original = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding.conversationId);
  await f.conversation.configure({ integrationId: "foreign", model: undefined });
  await f.conversation.send({ messageId: "code", text: "Implement it" });
  await f.conversation.wait();
  let trace = await f.trace();
  assert.equal(trace.filter(row => row.args?.includes("--print")).length, 1);
  let requests = trace.filter(row => row.frame?.type === "control_request").map(row => row.frame.request);
  assert.deepEqual(requests.slice(-2).map(({ subtype }) => subtype), ["apply_flag_settings", "set_model"]);
  const flags = requests.at(-2).settings;
  assert.equal(flags.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
  assert.equal(flags.env.ANTHROPIC_AUTH_TOKEN, apiKey);
  assert.equal(flags.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "deepseek-flash");
  assert.equal(flags.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "deepseek-flash[1m]");
  assert.equal(flags.env.CLAUDE_CODE_SUBAGENT_MODEL, "deepseek-flash");
  assert.equal(flags.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "786432");
  assert.equal(requests.at(-1).model, "deepseek-flash[1m]");
  assert.deepEqual(flags.fallbackModel, []);
  assert.ok(!JSON.stringify(trace.filter(row => row.args)).includes(apiKey));
  apiKey = "rotated-authorized-key";
  await f.conversation.send({ messageId: "key", text: "Continue" });
  await f.conversation.wait();
  trace = await f.trace();
  requests = trace.filter(row => row.frame?.type === "control_request").map(row => row.frame.request);
  assert.equal(requests.at(-2).settings.env.ANTHROPIC_AUTH_TOKEN, apiKey);
  assert.equal(trace.filter(row => row.args?.includes("--print")).length, 1);
  assert.ok(!JSON.stringify(await f.storage.read("conversation", tx => tx.readMetadata())).includes(apiKey));
  await f.conversation.configure({ integrationId: undefined, model: configuration.model });
  await f.conversation.send({ messageId: "review", text: "Review it" });
  await f.conversation.wait();
  trace = await f.trace();
  requests = trace.filter(row => row.frame?.type === "control_request").map(row => row.frame.request);
  assert.equal(requests.at(-2).settings.env.ANTHROPIC_AUTH_TOKEN, "");
  assert.equal(requests.at(-2).settings.env.ANTHROPIC_BASE_URL, process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com");
  assert.equal(requests.at(-2).settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "");
  assert.equal(requests.at(-2).settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || "");
  assert.equal(requests.at(-2).settings.env.CLAUDE_CODE_SUBAGENT_MODEL, process.env.CLAUDE_CODE_SUBAGENT_MODEL || "");
  assert.equal(trace.filter(row => row.args?.includes("--print")).length, 1);
  assert.equal(await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding.conversationId), original);
});

test("Claude restores explicit standalone host credentials after a selected connection", async t => {
  const f = await fixture(t, {
    environment: { ANTHROPIC_AUTH_TOKEN: "host-token", ANTHROPIC_BASE_URL: "http://host-provider.test" },
    connections: { resolve: async () => ({ providerId: "deepseek", model: "deepseek-flash", apiKey: "connection-token" }) }
  });
  await f.conversation.configure({ integrationId: "foreign", model: undefined });
  await f.conversation.send(input);
  await f.conversation.wait();
  await f.conversation.configure({ integrationId: undefined, model: configuration.model });
  await f.conversation.send({ messageId: "host", text: "Use the host account again" });
  await f.conversation.wait();
  const trace = await f.trace();
  const settings = trace.filter(row => row.frame?.request?.subtype === "apply_flag_settings").at(-1).frame.request.settings;
  assert.equal(settings.env.ANTHROPIC_AUTH_TOKEN, "host-token");
  assert.equal(settings.env.ANTHROPIC_BASE_URL, "http://host-provider.test");
  assert.equal(trace.filter(row => row.args?.includes("--print")).length, 1);
  assert.equal(trace.filter(row => row.args?.[0] === "auth").length, 0);
  assert.ok(!JSON.stringify(await f.storage.read("conversation", tx => tx.readMetadata())).includes("host-token"));
});

test("authorized Claude connections preserve native history across provider changes and process restart", async t => {
  let apiKey = "test-foreign-key";
  const context = { actor: { id: "owner" } };
  const connections = { async resolve(request) {
    assert.equal(request.context, context);
    assert.equal(request.integrationId, "foreign");
    return { providerId: "deepseek", model: "deepseek-flash", apiKey };
  } };
  const f = await fixture(t, { context, connections });
  await f.conversation.send(input);
  await f.conversation.wait();
  const original = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding.conversationId);
  const foreign = { systemPrompt: configuration.systemPrompt, integrationId: "foreign", effort: "low" };
  await f.conversation.select({ operationId: "foreign-model", expectedSegmentId: (await f.conversation.read()).segmentId,
    engine: "claude", configuration: foreign });
  await f.conversation.send({ messageId: "foreign", text: "Continue" });
  await f.conversation.wait();
  await f.first.close();
  const resumed = await f.runtime().open({ id: "conversation", context });
  await resumed.send({ messageId: "restart", text: "After restart" });
  await resumed.wait();
  const trace = await f.trace();
  const starts = trace.filter(row => row.args?.includes("--print"));
  assert.equal(starts.length, 2, "Compatible provider selection keeps the live process; application restart starts its successor");
  for (const row of starts.slice(1)) {
    assert.equal(row.args[row.args.indexOf("--resume") + 1], original);
    assert.equal(row.args.includes("--model"), false, "Selected provider models are installed after initialization");
    assert.deepEqual(row.routing, starts[0].routing, "Selected connection routing is not installed in process startup");
  }
  const flags = trace.filter(row => row.frame?.request?.subtype === "apply_flag_settings").at(-1).frame.request.settings;
  assert.equal(flags.env.ANTHROPIC_AUTH_TOKEN, apiKey);
  assert.equal(flags.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "786432");
  assert.deepEqual(trace.filter(row => row.frame?.request?.subtype === "set_model").at(-1).frame.request,
    { subtype: "set_model", model: "deepseek-flash[1m]" });
  assert.equal(trace.filter(row => row.args?.[0] === "auth").length, 1, "An API connection does not inspect the native login");
  assert.ok(!JSON.stringify(await f.storage.read("conversation", tx => tx.readMetadata())).includes(apiKey));
  apiKey = "rotated-authorized-key";
  await resumed.send({ messageId: "rotated-key", text: "Continue with the rotated key" });
  assert.equal((await resumed.wait()).conversationLog.at(-1).assistant.text, "Answer: Continue with the rotated key");
  const rotated = await f.trace();
  assert.equal(rotated.filter(row => row.frame?.type === "user").length, 4);
  assert.equal(rotated.filter(row => row.args?.includes("--print")).length, 2, "Key rotation updates the existing process");
  const rotatedStart = rotated.filter(row => row.args?.includes("--print")).at(-1);
  assert.equal(rotatedStart.args[rotatedStart.args.indexOf("--resume") + 1], original);
  assert.ok(!JSON.stringify(await f.storage.read("conversation", tx => tx.readMetadata())).includes(apiKey));
  await resumed.select({ operationId: "return-native", expectedSegmentId: (await resumed.read()).segmentId,
    engine: "claude", configuration });
  await resumed.send({ messageId: "back", text: "Back" });
  await resumed.wait();
  const returned = await f.trace();
  assert.equal(returned.filter(row => row.args?.includes("--print")).length, 2, "Returning to the native subscription also updates the live process");
  const last = returned.filter(row => row.args?.includes("--print")).at(-1);
  assert.equal(last.args[last.args.indexOf("--resume") + 1], original);
  assert.deepEqual(returned.filter(row => row.frame?.request?.subtype === "set_model").at(-1).frame.request,
    { subtype: "set_model", model: configuration.model });
  const restored = returned.filter(row => row.frame?.request?.subtype === "apply_flag_settings").at(-1).frame.request.settings;
  assert.equal(restored.env.ANTHROPIC_AUTH_TOKEN, "");
  assert.equal(restored.env.ANTHROPIC_MODEL, "");
  assert.equal(last.routing.ANTHROPIC_MODEL, process.env.ANTHROPIC_MODEL);
});

test("Claude validates exact connection models and supported effort before native dispatch", async t => {
  const f = await fixture(t, { connections: { resolve: async () => ({ providerId: "deepseek", model: "deepseek-flash", apiKey: "test-key" }) } });
  for (const [override, message] of [[{ model: "deepseek-v4-pro" }, /differs from/], [{ effort: "medium" }, /does not support/]]) {
    await f.conversation.select({ operationId: `unsupported-${override.model || override.effort}`,
      expectedSegmentId: (await f.conversation.read()).segmentId, engine: "claude",
      configuration: { systemPrompt: configuration.systemPrompt, integrationId: "foreign", ...override } });
    await assert.rejects(f.conversation.send(input), message);
    assert.equal((await f.conversation.read()).conversationLog.length, 0);
  }
  await assert.rejects(readFile(path.join(f.directory, "trace.jsonl")), { code: "ENOENT" });
  await assert.rejects(f.conversation.configure({ effort: "arbitrary" }), /does not support/);
});

test("failed settings cannot dispatch a prompt and model errors remain failed turns", async t => {
  const f = await fixture(t, { environment: { TEST_REJECT_EFFORT: "low" } });
  await f.conversation.configure({ effort: "low" });
  await assert.rejects(f.conversation.send(input), /Settings rejected/);
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 0);
  await f.conversation.configure({ effort: "high" });
  await f.conversation.send({ messageId: "failure", text: "failed" });
  const snapshot = await f.conversation.wait();
  assert.equal(snapshot.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(snapshot.error, /Model connection failed/);
});

test("native preparation cannot dispatch after the application revokes access", async t => {
  const local = createLocalConversationExecution();
  let allowed = true;
  const execution = { stop: local.stop, async start(options) {
    const native = await local.start(options);
    if (options.args.includes("--print")) allowed = false;
    return native;
  } };
  const f = await fixture(t, { execution, authorize: () => allowed });
  await assert.rejects(f.conversation.send(input), { code: "conversation_forbidden" });
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 0);
  allowed = true;
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
});

test("an unconfirmed process stop blocks work, remains an error and can be retried", async t => {
  const local = createLocalConversationExecution();
  const nativeIds = new Set();
  let allowStop = true;
  const execution = {
    async start(options) {
      const native = await local.start(options);
      if (options.args.includes("--print")) nativeIds.add(native.id);
      return native;
    },
    stop: id => !allowStop && nativeIds.has(id) ? Promise.resolve({ scopeEmpty: false }) : local.stop(id)
  };
  const f = await fixture(t, { execution });
  await f.conversation.send({ messageId: "waiting", text: "wait" });
  allowStop = false;
  await assert.rejects(f.conversation.cancel(), /cleanup could not be confirmed/);
  assert.equal((await f.conversation.read()).status, "unavailable");
  await assert.rejects(f.conversation.send(input), /cleanup could not be confirmed/);
  allowStop = true;
  assert.deepEqual(await f.conversation.cancel(), { stopped: true });
  assert.equal((await f.conversation.read()).status, "ready");
  await f.conversation.send(input);
  assert.equal((await f.conversation.wait()).conversationLog[1].assistant.text, "Answer: Hello");
});

test("lost observation while idle invalidates the process and exposes unconfirmed cleanup", async t => {
  const local = createLocalConversationExecution();
  let nativeProcess;
  let allowStop = true;
  const failed = Promise.withResolvers();
  const execution = {
    async start(options) {
      const native = await local.start(options);
      if (options.args.includes("--print")) nativeProcess = native;
      return native;
    },
    stop: id => !allowStop && id === nativeProcess?.id ? Promise.resolve({ scopeEmpty: false }) : local.stop(id)
  };
  const f = await fixture(t, { execution });
  await f.conversation.subscribe(event => { if (event.type === "error") failed.resolve(); });
  await f.conversation.send(input);
  await f.conversation.wait();
  allowStop = false;
  nativeProcess.stdout.destroy(new Error("Connection lost."));
  await failed.promise;
  assert.equal((await f.conversation.read()).status, "unavailable");
  await assert.rejects(f.conversation.send({ messageId: "blocked", text: "Must not send" }), /cleanup could not be confirmed/);
  allowStop = true;
  await f.conversation.cancel();
  await f.conversation.send({ messageId: "next", text: "Continue" });
  assert.equal((await f.conversation.wait()).conversationLog[1].assistant.text, "Answer: Continue");
});

test("cancel during native initialization drains the process without waiting for its handshake timeout", async t => {
  const local = createLocalConversationExecution();
  const started = Promise.withResolvers();
  const execution = { stop: local.stop, async start(options) {
    const native = await local.start(options);
    if (options.args.includes("--print")) started.resolve();
    return native;
  } };
  const f = await fixture(t, { execution, environment: { TEST_STARTUP_WAIT: "1" } });
  const sending = f.conversation.send(input);
  sending.catch(() => {});
  await started.promise;
  let timer;
  try {
    await Promise.race([f.conversation.cancel(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Cancel waited for the native handshake timeout.")), 2000);
    })]);
    await assert.rejects(sending);
    assert.equal((await f.conversation.wait()).conversationLog.length, 0);
    const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
    assert.equal(binding.executionId, "");
  } finally {
    clearTimeout(timer);
    await local.close();
  }
});


test("Claude native goal commands use ordinary admission, pause retains the goal, and cancel stops before clear", async t => {
  const f = await fixture(t);
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  const { segmentId, capabilities } = await f.conversation.read();
  assert.equal(capabilities.goals, true);
  assert.equal(capabilities.goalBudgets, false);
  assert.deepEqual(capabilities.goalCommands, {
    set: { delivery: "message", interruptsTurn: false }, resume: { delivery: "message", interruptsTurn: false },
    pause: { delivery: "control", interruptsTurn: true }, cancel: { delivery: "message", interruptsTurn: true }
  });
  const start = { action: "set", objective: "Tests pass", messageId: "set-goal", expectedSegmentId: segmentId, tokenBudget: null };
  const started = await f.conversation.updateGoal(start);
  assert.equal(started.status, "accepted");
  assert.equal((await f.conversation.read()).conversationLog[0].user.text, "/goal Tests pass");
  const goal = await f.conversation.readGoal();
  assert.equal(goal.status, "active");
  assert.equal((await f.conversation.updateGoal(start)).duplicate, true);
  await assert.rejects(f.conversation.updateGoal({ ...start, objective: "Different" }), { code: "conversation_message_conflict" });
  const action = { expectedSegmentId: segmentId, expectedGoalId: goal.id };
  await assert.rejects(f.conversation.updateGoal({ ...action, action: "pause", expectedGoalId: "old-goal" }), /goal changed/u);
  await assert.rejects(f.conversation.updateGoal({ ...action, action: "cancel" }), /messageId/u);
  const paused = await f.conversation.updateGoal({ ...action, action: "pause" });
  assert.equal(paused.status, "paused");
  assert.equal((await f.conversation.read()).conversationLog[0].metadata.runtime.status, "cancelled");
  const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  assert.equal(binding.executionId, "");
  const resumed = await f.conversation.updateGoal({ ...action, action: "resume", messageId: "resume-goal" });
  assert.equal(resumed.status, "accepted");
  const resumedGoal = await f.conversation.readGoal();
  assert.equal(resumedGoal.status, "active");
  const cancel = { expectedSegmentId: segmentId, expectedGoalId: resumedGoal.id, action: "cancel", messageId: "clear-goal" };
  assert.equal((await f.conversation.updateGoal(cancel)).status, "accepted");
  await f.conversation.wait();
  assert.equal(await f.conversation.readGoal(), null);
  assert.equal((await f.conversation.updateGoal(cancel)).duplicate, true);
  assert.equal(events.filter(event => event.type === "accepted").length, 3);
  assert.equal(events.some(event => event.type === "goal" && event.goal === null), true);
  const trace = await f.trace();
  assert.deepEqual(trace.filter(row => row.frame?.type === "user").map(row => row.frame.message.content),
    ["/goal Tests pass", "/goal Tests pass", "/goal clear"]);
  const starts = trace.filter(row => row.args?.includes("--print"));
  assert.equal(starts.length, 3);
  assert.equal(starts[1].args.includes("--resume"), true);
  assert.equal(starts[2].args.includes("--resume"), true);
  assert.equal(trace.filter(row => row.frame?.request?.subtype === "interrupt").length, 2);
  await assert.rejects(f.conversation.updateGoal({ ...start, messageId: "budget", tokenBudget: 100 }), /token budget/u);
});

test("Claude rejects reserved goals and waits for ordinary Send to deliver a replacement briefing", async t => {
  const f = await fixture(t);
  let state = await f.conversation.read();
  await assert.rejects(f.conversation.updateGoal({ action: "set", objective: "clear", messageId: "reserved",
    expectedSegmentId: state.segmentId }), /goal condition/u);
  await f.conversation.send(input);
  state = await f.conversation.wait();
  await f.conversation.replace({ operationId: "renew-goal", reason: "renewal", expectedSegmentId: state.segmentId });
  state = await f.conversation.read();
  const goal = { action: "set", objective: "Tests pass", messageId: "goal-after-renewal", expectedSegmentId: state.segmentId };
  await assert.rejects(f.conversation.updateGoal(goal), { code: "conversation_replacement_briefing_pending" });
  await f.conversation.wait();
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  await f.conversation.send({ messageId: "catch-up", text: "Continue" });
  await f.conversation.wait();
  assert.equal((await f.conversation.updateGoal(goal)).status, "accepted");
  const frames = (await f.trace()).filter(row => row.frame?.type === "user");
  assert.match(frames[1].frame.message.content, /Conversation changeover/);
  assert.equal(frames[2].frame.message.content, "/goal Tests pass");
});

test("Claude goal delivery remains uncertain until native history proves admission without replay", async t => {
  const f = await fixture(t, { environment: { TEST_GOAL_LOST_ACK: "1" } });
  const command = { action: "set", objective: "Tests pass", messageId: "lost-goal",
    expectedSegmentId: (await f.conversation.read()).segmentId };
  await assert.rejects(f.conversation.updateGoal(command), error => error.delivery === "uncertain");
  assert.equal((await f.conversation.wait()).status, "unconfirmed");
  await assert.rejects(f.conversation.updateGoal(command), { code: "conversation_delivery_uncertain" });
  assert.equal((await f.conversation.inspectDelivery({ messageId: command.messageId })).status, "accepted");
  assert.equal((await f.conversation.updateGoal(command)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
});


test("Claude goal cancellation requires authorization and confirmed cleanup before sending clear", async t => {
  const local = createLocalConversationExecution();
  const nativeIds = new Set();
  let allowStop = true;
  let allowGoal = true;
  const execution = {
    async start(options) {
      const native = await local.start(options);
      if (options.args.includes("--print")) nativeIds.add(native.id);
      return native;
    },
    stop: id => !allowStop && nativeIds.has(id) ? Promise.resolve({ scopeEmpty: false }) : local.stop(id)
  };
  const f = await fixture(t, { execution, authorize: ({ operation }) => operation !== "goal" || allowGoal });
  const { segmentId } = await f.conversation.read();
  await f.conversation.updateGoal({ action: "set", objective: "Tests pass", messageId: "start", expectedSegmentId: segmentId });
  const goal = await f.conversation.readGoal();
  const cancel = { action: "cancel", messageId: "clear", expectedSegmentId: segmentId, expectedGoalId: goal.id };
  allowGoal = false;
  await assert.rejects(f.conversation.updateGoal(cancel), { code: "conversation_forbidden" });
  assert.equal((await f.conversation.read()).status, "working");
  allowGoal = true;
  allowStop = false;
  await assert.rejects(f.conversation.updateGoal(cancel), /cleanup could not be confirmed/);
  assert.equal((await f.conversation.read()).status, "unavailable");
  assert.deepEqual((await f.trace()).filter(row => row.frame?.type === "user").map(row => row.frame.message.content), ["/goal Tests pass"]);
  allowStop = true;
  await f.conversation.cancel();
  await f.conversation.updateGoal(cancel);
  await f.conversation.wait();
  assert.equal(await f.conversation.readGoal(), null);
  assert.deepEqual((await f.trace()).filter(row => row.frame?.type === "user").map(row => row.frame.message.content), ["/goal Tests pass", "/goal clear"]);
});


test("Stop remains available while a Claude goal waits for native acknowledgement", async t => {
  const f = await fixture(t, { environment: { TEST_GOAL_LOST_ACK: "1" }, limits: { admissionTimeoutMs: 10000 } });
  await f.conversation.readGoal();
  const command = { action: "set", objective: "Tests pass", messageId: "waiting-goal",
    expectedSegmentId: (await f.conversation.read()).segmentId };
  const sending = f.conversation.updateGoal(command);
  const rejected = assert.rejects(sending, error => error.delivery === "uncertain");
  const deadline = Date.now() + 2000;
  while (!(await f.trace()).some(row => row.frame?.type === "user")) {
    if (Date.now() > deadline) throw new Error("The goal command never reached Claude.");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  let timer;
  try {
    await Promise.race([f.conversation.cancel(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Goal admission blocked Stop.")), 2000);
    })]);
    await rejected;
    const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
    assert.equal(binding.executionId, "");
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  } finally { clearTimeout(timer); }
});

test("the same Claude driver reopens a verified closed conversation after retrying failed cleanup", async t => {
  const local = createLocalConversationExecution();
  const nativeIds = new Set();
  let allowStop = true;
  const execution = {
    async start(options) {
      const native = await local.start(options);
      if (options.args.includes("--print")) nativeIds.add(native.id);
      return native;
    },
    stop: id => !allowStop && nativeIds.has(id) ? Promise.resolve({ scopeEmpty: false }) : local.stop(id)
  };
  const f = await fixture(t, { execution });
  await f.first.close();
  const driver = createClaudeConversationDriver(f.driverOptions);
  const readBinding = () => f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  const open = async () => driver.open({ binding: await readBinding(),
    writeBinding: binding => f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.binding = binding;
      await tx.writeMetadata(metadata);
    }),
    onFailure() {}
  });
  const messages = [];
  const run = (provider, messageId, text) => provider.run({ configuration,
    input: { messageId, text }, signal: new AbortController().signal,
    beforeDispatch() {}, accept() {}, onEvent() {}, onMessage: message => messages.push(message)
  });
  const first = await open();
  let reopened;
  try {
    await run(first, "before-close", "Before close");
    const original = await readBinding();
    assert.ok(original.executionId);
    allowStop = false;
    await assert.rejects(first.dispose(), /cleanup could not be confirmed/);
    assert.equal((await readBinding()).executionId, original.executionId);
    assert.equal((await f.trace()).filter(row => row.args?.includes("--print")).length, 1);
    allowStop = true;
    await first.dispose();
    assert.equal((await readBinding()).executionId, "");
    reopened = await open();
    await assert.rejects(run(first, "old-handle", "Must stay closed"), /closed or already working/);
    await run(reopened, "after-close", "After close");
    assert.ok(messages.some(message => message.complete && message.text === "Answer: After close"));
    assert.equal((await readBinding()).conversationId, original.conversationId);
    const launches = (await f.trace()).filter(row => row.args?.includes("--print"));
    assert.equal(launches.length, 2);
    assert.equal(launches[1].args.at(launches[1].args.indexOf("--resume") + 1), original.conversationId);
    assert.deepEqual((await f.trace()).filter(row => row.frame?.type === "user").map(row => row.frame.message.content),
      ["Before close", "After close"]);
    await reopened.dispose();
    assert.equal((await readBinding()).executionId, "");
  } finally {
    allowStop = true;
    await first.dispose();
    await reopened?.dispose();
    await local.close();
  }
});


for (const change of ["model", "effort"]) test(`Claude honors a consumer's fresh native policy for ${change} changes and restart`, async t => {
  const f = await fixture(t);
  const binding = () => f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  await f.conversation.send(input);
  const original = await f.conversation.wait();
  const previous = await binding();
  const beforeSelection = await f.trace();
  const oldHistoryPath = path.join(previous.configRoot, "projects", previous.workdir.replace(/[^a-zA-Z0-9]/gu, "-"), `${previous.conversationId}.jsonl`);
  const oldHistory = await readFile(oldHistoryPath, "utf8");
  const selected = { ...configuration, [change]: change === "model" ? "another-model" : "low" };
  const request = { operationId: `fresh-${change}`, expectedSegmentId: original.segmentId,
    engine: "claude", configuration: selected, retireNative: true };
  const receipt = await f.conversation.select(request);
  assert.notEqual(receipt.segmentId, original.segmentId);
  const inert = await binding();
  assert.notEqual(inert.conversationId, previous.conversationId);
  assert.equal(inert.sent, false);
  assert.equal(inert.configRoot, previous.configRoot);
  assert.equal(inert.workdir, previous.workdir);
  const predecessor = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.predecessors.find(segment => segment.segmentId === original.segmentId));
  assert.equal(predecessor.binding.conversationId, previous.conversationId);
  assert.equal(inert.executionId, "");
  assert.deepEqual(await f.trace(), beforeSelection, "Selecting allocates an inert handle without inference");
  const retained = await f.conversation.read();
  assert.equal(retained.id, original.id);
  assert.deepEqual(retained.conversationLog, original.conversationLog);
  assert.equal((await f.conversation.select(request)).duplicate, true);
  await f.conversation.send({ messageId: "changed", text: "Continue after the change" });
  assert.equal((await f.conversation.wait()).conversationLog.at(-1).metadata.runtime.status, "complete");
  const fresh = await binding();
  assert.equal(fresh.conversationId, inert.conversationId);
  assert.equal(fresh.accountIdentity, previous.accountIdentity);
  assert.equal(await readFile(oldHistoryPath, "utf8"), oldHistory);
  const trace = await f.trace();
  const starts = trace.filter(row => row.args?.includes("--print"));
  assert.equal(starts.length, 2);
  assert.equal(starts[1].args[starts[1].args.indexOf("--session-id") + 1], inert.conversationId);
  assert.equal(starts[1].args.includes("--resume"), false);
  assert.equal(starts[1].args[starts[1].args.indexOf("--model") + 1], selected.model);
  assert.equal(trace.filter(row => row.frame?.request?.subtype === "apply_flag_settings").at(-1).frame.request.settings.effortLevel, selected.effort);
  const nativeMessages = trace.filter(row => row.frame?.type === "user");
  assert.equal(nativeMessages.length, 2);
  const handedHistory = JSON.parse(nativeMessages[1].frame.message.content.split("\n").find(line => line.startsWith('{"messages":')));
  assert.deepEqual(handedHistory.messages.map(({ role, text }) => [role, text]), [["user", "Hello"], ["assistant", "Answer: Hello"]]);
  assert.deepEqual(handedHistory.removedMessageIds, []);
  assert.equal(nativeMessages[1].frame.message.content.split("User's message:\n")[1], "Continue after the change");
  assert.match(nativeMessages[1].frame.message.content, /Hello/);
  assert.match(nativeMessages[1].frame.message.content, /Answer: Hello/);
  assert.match(nativeMessages[1].frame.message.content, /Continue after the change/);
  await f.first.close();
  const resumed = await f.runtime().open({ id: "conversation" });
  assert.equal((await resumed.select(request)).duplicate, true);
  assert.equal((await resumed.send(input)).duplicate, true);
  assert.equal((await binding()).conversationId, inert.conversationId);
  await resumed.send({ messageId: "after-restart", text: "Continue after restart" });
  assert.equal((await resumed.wait()).conversationLog.length, 3);
  const restarted = await f.trace();
  assert.equal(restarted.filter(row => row.frame?.type === "user").length, 3);
  assert.equal(restarted.filter(row => row.frame?.type === "user").at(-1).frame.message.content, "Continue after restart");
  const restart = restarted.filter(row => row.args?.includes("--print")).at(-1);
  assert.equal(restart.args[restart.args.indexOf("--resume") + 1], inert.conversationId);
  const returned = await resumed.select({ operationId: `restore-${change}`, expectedSegmentId: (await resumed.read()).segmentId,
    engine: "claude", configuration, retireNative: true });
  assert.notEqual(returned.segmentId, original.segmentId, "The consumer policy cannot restore an older retained segment");
  assert.notEqual(returned.segmentId, receipt.segmentId);
  await resumed.send({ messageId: "returned", text: "Back to the original settings" });
  assert.equal((await resumed.wait()).conversationLog.length, 4);
  const restored = await binding();
  assert.notEqual(restored.conversationId, previous.conversationId);
  assert.notEqual(restored.conversationId, inert.conversationId);
  assert.equal(restored.accountIdentity, previous.accountIdentity);
  const restoredPrompt = (await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content;
  assert.match(restoredPrompt, /Hello/);
  assert.match(restoredPrompt, /Continue after the change/);
  assert.match(restoredPrompt, /Continue after restart/);
});
