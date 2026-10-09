import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rename, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConversationRuntime, createFileConversationStorage, upgradeConversationRuntimeState } from "../src/server/conversation/index.js";
import { createLocalConversationExecution } from "../src/server/conversation/localExecution.js";
import { createClaudeConversationDriver } from "../src/server/conversation/providers/claudeDriver.js";
import { conversationRequestText } from "../src/server/conversation/continuity.js";
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
    const nativeToolUse = ${JSON.stringify(options.nativeToolUse || null)};
    const applicationEventBehavior = ${JSON.stringify(options.applicationEventBehavior || null)};
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
      if (text === "lost" || text === applicationEventBehavior?.lost) { record(answer); return; }
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
      if (nativeToolUse) {
        const use = { type: "assistant", session_id: id, uuid: frame.uuid + "-native-tool",
          ...(nativeToolUse.parentToolUseId ? { parent_tool_use_id: nativeToolUse.parentToolUseId } : {}), message: { content: [
          { type: "tool_use", id: frame.uuid + "-native-tool", name: nativeToolUse.name, input: nativeToolUse.input }
        ] } };
        record(use); emit(use);
      }
      if (text === "wait" || text === applicationEventBehavior?.wait) return;
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
          if (sequence === 1 && ${JSON.stringify(options.toolProgress || "")}) {
            use.message.content.unshift({ type: "text", text: ${JSON.stringify(options.toolProgress || "")} });
          }
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
      connections: options.connections, attachments: options.attachments, persistCommentary: options.persistCommentary,
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

for (const maxFinalReplyCharacters of [12, 11]) {
  test("Claude recovered reply enforces configured final limit of " + maxFinalReplyCharacters, async t => {
    const f = await fixture(t, { limits: { maxFinalReplyCharacters } });
    await assert.rejects(f.conversation.send({ messageId: "bounded-lost", text: "lost" }));
    assert.equal((await f.conversation.read()).status, "unconfirmed");
    const receipt = await f.conversation.inspectDelivery({ messageId: "bounded-lost" });
    assert.equal(receipt.status, "accepted", "A reply rejection must retain the proven user admission");
    assert.equal(receipt.recovered, true);
    const state = await f.conversation.read();
    const turn = state.conversationLog[0];
    assert.equal(turn.user.text, "lost");
    assert.equal(turn.metadata.runtime.status, maxFinalReplyCharacters === 12 ? "interrupted" : "failed");
    assert.equal(turn.assistant?.text, maxFinalReplyCharacters === 12 ? "Answer: lost" : undefined);
    if (maxFinalReplyCharacters === 11) assert.match(state.error, /final reply limit/);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1, "Recovery cannot repeat inference");
  });
}

for (const savedStatus of ["cancelled", "failed", "unknown-tool", "interrupted"]) {
  test("Claude oversized recovery preserves " + savedStatus + " evidence", async t => {
    const limits = { maxFinalReplyCharacters: 13 };
    const f = await fixture(t, { limits });
    await f.conversation.send(input);
    assert.equal((await f.conversation.wait()).conversationLog[0].assistant.text, "Answer: Hello");
    await f.first.close();
    await f.storage.write("conversation", async tx => {
      const turn = await tx.readTurn("000001");
      await tx.replaceAssistant(turn.turnId, { ...turn.assistant, text: "" });
      await tx.updateTurnMetadata(turn.turnId, { runtime: { ...turn.metadata.runtime,
        status: savedStatus === "unknown-tool" ? "interrupted" : savedStatus,
        error: savedStatus === "unknown-tool" ? "" : "Exact prior " + savedStatus + " cause." },
        ...(savedStatus === "unknown-tool" ? { applicationTools: [{ id: "unresolved-tool", status: "unknown" }] } : {}) });
    });
    limits.maxFinalReplyCharacters = 11;
    const reopened = await f.runtime().open({ id: "conversation" });
    const receipt = await reopened.inspectDelivery({ messageId: input.messageId });
    assert.equal(receipt.status, "accepted");
    const state = await reopened.read();
    assert.equal(state.conversationLog[0].metadata.runtime.status, ["unknown-tool", "interrupted"].includes(savedStatus) ? "failed" : savedStatus);
    assert.notEqual(state.conversationLog[0].assistant?.text, "Answer: Hello");
    if (savedStatus === "unknown-tool") {
      assert.match(state.error, /application tool has no verified result.*Inspect its target/);
      assert.deepEqual(state.conversationLog[0].metadata.applicationTools, [{ id: "unresolved-tool", status: "unknown" }]);
    } else if (savedStatus === "interrupted") assert.match(state.error, /final reply limit/);
    else assert.equal(state.error, "Exact prior " + savedStatus + " cause.");
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  });
}

for (const saveFails of [false, true]) test(`Claude retains failed-start custody when binding save ${saveFails ? "fails" : "succeeds"}`, async t => {
  const local = createLocalConversationExecution();
  const executionId = "failed-owned-execution";
  const bindingError = new Error("Binding publication failed");
  const failure = Object.assign(new Error("Managed stream socket did not open"), {
    executionId, stopProof: { scopeEmpty: false }, cleanupFailed: true
  });
  let failStart = true;
  let allowStop = false;
  const stops = [];
  const f = await fixture(t, { execution: {
    start(options) {
      if (failStart && options.args.includes("--print")) throw failure;
      return local.start(options);
    },
    stop(id, options) {
      if (id !== executionId) return local.stop(id, options);
      stops.push(id);
      return Promise.resolve({ scopeEmpty: allowStop });
    }
  } });
  await f.first.close();
  const driver = createClaudeConversationDriver(f.driverOptions);
  const readBinding = () => f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  let rejectSave = saveFails;
  const open = async () => driver.open({ binding: await readBinding(),
    async writeBinding(binding) {
      if (rejectSave && binding.executionId === executionId) throw bindingError;
      await f.storage.write("conversation", async tx => {
        const metadata = await tx.readMetadata();
        metadata.runtime.binding = binding;
        await tx.writeMetadata(metadata);
      });
    },
    onFailure() {}
  });
  const provider = await open();
  let reopened;
  const run = (owner, messageId, text) => owner.run({ configuration,
    input: { messageId, text }, signal: new AbortController().signal,
    beforeDispatch() {}, accept() {}, onEvent() {}, onMessage() {}
  });
  try {
    await assert.rejects(run(provider, "failed-start", "Never sent"), error => {
      assert.equal(error.code, "claude_stop_unconfirmed");
      assert.equal(error.cause, failure);
      assert.equal(error.cause.executionId, executionId);
      assert.equal(error.stopProof.scopeEmpty, false);
      assert.equal(error.cleanupFailed, true);
      if (saveFails) assert.equal(error.cause.bindingError, bindingError);
      return true;
    });
    assert.equal((await readBinding()).executionId, saveFails ? "" : executionId);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 0);
    assert.deepEqual(stops, [executionId]);
    if (!saveFails) {
      const restarted = createClaudeConversationDriver(f.driverOptions);
      await assert.rejects(restarted.open({ binding: await readBinding(),
        writeBinding() { assert.fail("Unconfirmed cleanup cannot release the saved binding."); },
        onFailure() {}
      }), /cleanup could not be confirmed/);
      assert.deepEqual(stops, [executionId, executionId]);
      assert.equal((await readBinding()).executionId, executionId);
    }
    const expectedStops = stops.length;
    await assert.rejects(provider.dispose(), /cleanup could not be confirmed/);
    assert.equal(stops.length, expectedStops + 1);
    assert.ok(stops.every(id => id === executionId));
    assert.equal((await readBinding()).executionId, saveFails ? "" : executionId);
    allowStop = true;
    rejectSave = false;
    await provider.dispose();
    assert.equal(stops.length, expectedStops + 2);
    assert.ok(stops.every(id => id === executionId));
    assert.equal((await readBinding()).executionId, "");
    failStart = false;
    reopened = await open();
    await run(reopened, "fresh-after-cleanup", "After cleanup");
    assert.deepEqual((await f.trace()).filter(row => row.frame?.type === "user").map(row => row.frame.message.content), ["After cleanup"]);
  } finally {
    allowStop = true;
    rejectSave = false;
    await provider.dispose();
    await reopened?.dispose();
    await local.close();
  }
});

test("original scoped Claude history resumes from the authorized credential home while retaining its private scope", async t => {
  const f = await fixture(t);
  await f.first.close();
  const { realpath } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const home = path.join(f.directory, "credential-home");
  const foreignHome = path.join(f.directory, "foreign-home");
  await mkdir(home);
  await mkdir(foreignHome);
  const env = { ...f.driverOptions.host.env, HOME: home };
  const scopeWorkdir = await realpath(f.directory);
  const readBinding = () => f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
  const writeBinding = binding => f.storage.write("conversation", async tx => {
    const metadata = await tx.readMetadata();
    metadata.runtime.binding = binding;
    await tx.writeMetadata(metadata);
  });
  const original = createClaudeConversationDriver({ ...f.driverOptions,
    host: { ...f.driverOptions.host, workdir: home, env } });
  await writeBinding(await original.createBinding());
  const run = (provider, messageId, text) => provider.run({ configuration,
    input: { messageId, text }, signal: new AbortController().signal,
    beforeDispatch() {}, accept() {}, onMessage() {}, onEvent() {}
  });
  const first = await original.open({ binding: await readBinding(), writeBinding, onFailure() {} });
  try { await run(first, "original", "Original scoped words"); }
  finally { await first.dispose(); }
  const receipt = await readBinding();
  assert.equal(receipt.workdir, await realpath(home));
  assert.equal(receipt.executionId, "");
  assert.equal(receipt.sent, true);
  // The original native-OAuth identity has the same exact tuple; only its
  // explicit hash label differs. API/connection tuples are not converted here.
  const originalAccount = "sha256:" + createHash("sha256")
    .update(JSON.stringify([receipt.configRoot, "claude.ai", "owner@example.test"])).digest("hex");
  assert.equal(originalAccount, "sha256:" + receipt.accountIdentity);
  const historyPath = path.join(receipt.configRoot, "projects", home.replace(/[^a-zA-Z0-9]/gu, "-"), receipt.conversationId + ".jsonl");
  const originalHistory = await readFile(historyPath, "utf8");
  assert.match(originalHistory, /Original scoped words/);
  const scoped = createClaudeConversationDriver({ ...f.driverOptions,
    host: { ...f.driverOptions.host, env } });
  await assert.rejects(scoped.open({ binding: receipt, writeBinding, onFailure() {} }), /another working directory or credential home/);
  const binding = { ...receipt, scopeWorkdir };
  for (const wrong of [{ ...binding, scopeWorkdir: await realpath(foreignHome) },
    { ...binding, scopeWorkdir: "" }, { ...binding, workdir: await realpath(foreignHome) },
    { ...binding, configRoot: foreignHome }]) {
    await assert.rejects(scoped.open({ binding: wrong, writeBinding, onFailure() {} }), /another working directory or credential home/);
  }
  const differentHome = createClaudeConversationDriver({ ...f.driverOptions,
    host: { ...f.driverOptions.host, env: { ...env, HOME: foreignHome } } });
  await assert.rejects(differentHome.open({ binding, writeBinding, onFailure() {} }), /another working directory or credential home/);
  assert.equal((await f.trace()).filter(row => row.args?.includes("--print")).length, 1);
  assert.equal(await readFile(historyPath, "utf8"), originalHistory);
  await writeBinding(binding);
  const resumed = await scoped.open({ binding: await readBinding(), writeBinding, onFailure() {} });
  try { await run(resumed, "resumed", "Continue original scope"); }
  finally { await resumed.dispose(); }
  const saved = await readBinding();
  assert.equal(saved.conversationId, receipt.conversationId);
  assert.equal(saved.scopeWorkdir, scopeWorkdir);
  assert.equal(saved.workdir, receipt.workdir);
  assert.equal(saved.accountIdentity, receipt.accountIdentity);
  assert.equal(saved.executionId, "");
  const starts = (await f.trace()).filter(row => row.args?.includes("--print"));
  assert.equal(starts.length, 2);
  assert.equal(starts[1].args[starts[1].args.indexOf("--resume") + 1], receipt.conversationId);
  assert.equal((await readFile(historyPath, "utf8")).startsWith(originalHistory), true);
  assert.deepEqual((await f.trace()).filter(row => row.frame?.type === "user").map(row => row.frame.message.content),
    ["Original scoped words", "Continue original scope"]);
  await writeFile(f.account, "another@example.test");
  const changed = await scoped.open({ binding: await readBinding(), writeBinding, onFailure() {} });
  try { await assert.rejects(run(changed, "foreign-account", "Must not send"), /another Claude account/); }
  finally { await changed.dispose(); }
  const api = createClaudeConversationDriver({ ...f.driverOptions,
    host: { ...f.driverOptions.host, env: { ...env, ANTHROPIC_AUTH_TOKEN: "different-api-identity" } } });
  const changedApi = await api.open({ binding: await readBinding(), writeBinding, onFailure() {} });
  try { await assert.rejects(run(changedApi, "foreign-api", "Must not send"), /another Claude account/); }
  finally { await changedApi.dispose(); }
  assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 2);
  assert.equal((await f.trace()).filter(row => row.args?.includes("--print")).length, 2);
  assert.equal((await readBinding()).accountIdentity, receipt.accountIdentity);
});

// Original accepted-output restart recovery must honor the same transient
// transcript policy without changing native history, receipts or inference.
for (const restoredPolicy of [undefined, false]) {
  test("Claude recovered commentary uses " + (restoredPolicy === false ? "transient" : "default") + " transcript policy", async t => {
    let executions = 0;
    const progress = "Checking the current number.";
    const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
    const options = { context, actions: applicationActions(async () => { executions++; return { value: 42 }; }),
      persistCommentary: false, toolProgress: progress };
    const f = await fixture(t, options);
    await f.conversation.send({ messageId: "recover-progress", text: "tools" });
    const finished = await f.conversation.wait();
    assert.deepEqual(finished.conversationLog[0].commentary, []);
    assert.equal(finished.conversationLog[0].metadata.applicationTools.length, 3);
    assert.equal(executions, 1);
    await f.first.close();
    await f.storage.write("conversation", async transaction => {
      const turn = await transaction.readTurn("000001");
      await transaction.updateTurnMetadata(turn.turnId, { runtime: { ...turn.metadata.runtime, status: "running" } });
      await transaction.replaceAssistant(turn.turnId, { ...turn.assistant, text: "Partial reply" });
    });
    options.persistCommentary = restoredPolicy;
    const reopened = await f.runtime().open({ id: "conversation", context });
    assert.equal((await reopened.inspectDelivery({ messageId: "recover-progress" })).recovered, true);
    const state = await reopened.read();
    assert.equal(state.conversationLog[0].assistant.text, finished.conversationLog[0].assistant.text);
    assert.deepEqual(state.conversationLog[0].commentary.map(message => message.text), restoredPolicy === false ? [] : [progress]);
    assert.equal(state.conversationLog[0].metadata.runtime.status, "interrupted");
    assert.deepEqual(state.conversationLog[0].metadata.applicationTools, finished.conversationLog[0].metadata.applicationTools);
    await reopened.inspectDelivery({ messageId: "recover-progress" });
    assert.deepEqual((await reopened.read()).conversationLog, state.conversationLog);
    assert.equal(executions, 1);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  });
}

// The original initialization-cancel case must join the process factory's
// existing cleanup receipt, not reclaim an already-released execution by ID.
test("Claude startup cancellation shares one cleanup receipt and keeps missing execution refusal", async t => {
  const local = createLocalConversationExecution();
  const started = Promise.withResolvers();
  const stops = [];
  let nativeExecutionId;
  const execution = {
    async start(options) {
      const native = await local.start(options);
      if (options.args.includes("--print")) {
        nativeExecutionId = native.id;
        started.resolve();
      }
      return native;
    },
    async stop(id, options) {
      stops.push(id);
      return local.stop(id, options);
    }
  };
  const f = await fixture(t, { execution, environment: { TEST_STARTUP_WAIT: "1" } });
  const sending = f.conversation.send(input);
  sending.catch(() => {});
  await started.promise;
  try {
    assert.equal(typeof nativeExecutionId, "string");
    await f.conversation.cancel();
    await assert.rejects(sending);
    assert.deepEqual(stops.filter(id => id === nativeExecutionId), [nativeExecutionId],
      "startup failure and cancellation join one verified native cleanup");
    assert.equal((await f.conversation.wait()).conversationLog.length, 0);
    const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
    assert.equal(binding.executionId, "");
    await assert.rejects(local.stop("unowned-execution"), /does not own the requested execution/);
    await assert.rejects(local.stop(nativeExecutionId), /does not own the requested execution/,
      "only the actual cleanup owner retains its receipt; an absent local record is never proof");
  } finally {
    await local.close();
  }
});

// Reuse the original controlled native CLI and its owned history/account roots.
// The opt-in runtime is created only after the fixture's original runtime closes.
const completedEnvelopeValue = { kind: "tool", text: "Checking.", toolName: "numbers_read", arguments: "{}" };
const completedEnvelopeSchema = { type: "object", additionalProperties: false,
  properties: { kind: { type: "string", enum: ["reply", "tool"] }, text: { type: "string", maxLength: 64 },
    toolName: { type: "string", maxLength: 64 }, arguments: { type: "string", maxLength: 64 } },
  required: ["kind", "text", "toolName", "arguments"] };
async function completedEnvelopeFixture(t, options = {}) {
  const context = options.context || { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  let effects = 0;
  const actions = applicationActions(async request => {
    effects++;
    return options.execute ? options.execute(request) : { value: 42 };
  });
  const f = await fixture(t, { ...options, context, actions, structuredResponse: completedEnvelopeValue,
    configuration: { ...configuration, outputSchema: completedEnvelopeSchema, ...options.configuration } });
  await f.first.close();
  let runtime;
  let conversation;
  async function reopen() {
    if (runtime) await runtime.close();
    runtime = createConversationRuntime({ engine: "claude", storage: f.storage, actions,
      authorize: options.authorize || (() => true), completedEnvelope: true, ...f.driverOptions });
    conversation = await runtime.open({ id: "conversation", context });
    return conversation;
  }
  await reopen();
  const controller = new AbortController();
  return { ...f, context, controller, effects: () => effects, reopen,
    get conversation() { return conversation; }, close: () => runtime.close(),
    async complete(messageId = "completed-response") {
      const receipt = await conversation.wake({ messageId, text: "Read a number" });
      const state = await conversation.wait();
      const turn = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
      assert.equal(turn.metadata.runtime.status, "complete", state.error);
      assert.equal(turn.metadata.runtime.completedEnvelope, true);
      assert.equal(turn.assistant.text, JSON.stringify(completedEnvelopeValue));
      return { messageId, turnId: receipt.turnId };
    },
    prepare: receipt => conversation.prepareCompletedResponse(receipt, { signal: controller.signal }) };
}
const executeCompletedEnvelope = (prepared, argumentsText = "{}") => prepared.tools.execute({
  id: prepared.toolCallId, name: "numbers_read", arguments: argumentsText
});

test("completed Claude envelopes reuse one durable receipt across prepared handles and restart", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    const one = await f.prepare(receipt);
    const two = await f.prepare(receipt);
    const [first, second] = await Promise.all([executeCompletedEnvelope(one), executeCompletedEnvelope(two)]);
    assert.equal(first.ok, true);
    assert.deepEqual(second, first);
    assert.equal(f.effects(), 1);
    await assert.rejects(executeCompletedEnvelope(two, '{"different":true}'), /different arguments/);
    await assert.rejects(two.tools.execute({ id: "foreign-operation", name: "numbers_read", arguments: "{}" }), /different completed response identity/);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.applicationTools.length, 1);
    assert.equal(saved.metadata.applicationTools[0].id, one.toolCallId);
    assert.equal(saved.metadata.applicationTools[0].status, "complete");
    await f.reopen();
    assert.deepEqual(await executeCompletedEnvelope(await f.prepare(receipt)), first);
    assert.equal(f.effects(), 1, "Restoring the completed response never repeats its action");
    const starts = (await f.trace()).filter(row => row.args?.includes("--print"));
    assert.equal(starts.length, 1, "Account/history inspection does not launch another native turn");
    assert.deepEqual(JSON.parse(starts[0].args.at(starts[0].args.indexOf("--mcp-config") + 1)), { mcpServers: {} });
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  } finally { await f.close(); }
});

test("completed Claude response authority comes from canonical final custody, not native commentary equality", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    const binding = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
    const project = path.join(f.driverOptions.host.env.CLAUDE_CONFIG_DIR, "projects", f.directory.replace(/[^a-zA-Z0-9]/gu, "-"));
    const historyPath = path.join(project, binding.conversationId + ".jsonl");
    const history = (await readFile(historyPath, "utf8")).trim().split("\n").map(row => JSON.parse(row));
    await writeFile(historyPath, history.filter(row => row.type !== "assistant").map(row => JSON.stringify(row)).join("\n") + "\n");
    assert.equal((await f.prepare(receipt)).text, JSON.stringify(completedEnvelopeValue),
      "StructuredOutput successful canonical completion can have no native assistant text");
    const prepared = await f.prepare(receipt);
    await f.storage.write("conversation", tx => tx.replaceAssistant(receipt.turnId, { text: "Changed final" }));
    await assert.rejects(executeCompletedEnvelope(prepared), /identity changed/);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude envelopes refuse aborted or revoked worker authority before the effect", async t => {
  let eligible = true;
  const f = await completedEnvelopeFixture(t, { authorize: ({ operation }) => operation !== "tool" || eligible });
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    eligible = false;
    await assert.rejects(executeCompletedEnvelope(prepared), error => error.code === "conversation_forbidden");
    eligible = true;
    f.controller.abort(new Error("Original product worker stopped"));
    await assert.rejects(executeCompletedEnvelope(prepared), /Original product worker stopped/);
    assert.equal(f.effects(), 0);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.applicationTools?.length || 0, 0);
  } finally { eligible = true; await f.close(); }
});

test("completed Claude invoked effects retain their result while Stop drains and worker authority is revoked", async t => {
  let eligible = true;
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  const f = await completedEnvelopeFixture(t, { authorize: ({ operation }) => operation !== "tool" || eligible,
    async execute() { entered.resolve(); await released.promise; return { value: 73 }; } });
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    const effect = executeCompletedEnvelope(prepared);
    await entered.promise;
    eligible = false;
    f.controller.abort(new Error("Original worker stopped after invocation"));
    let stopped = false;
    const stopping = f.conversation.cancel().then(result => { stopped = true; return result; });
    await Promise.resolve();
    assert.equal(stopped, false, "Stop joins the existing serial effect owner");
    released.resolve();
    const result = await effect;
    await stopping;
    assert.equal(result.ok, true);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.applicationTools[0].status, "complete");
    assert.deepEqual(saved.metadata.applicationTools[0].result, result);
    assert.equal(f.effects(), 1, "Revoked invocation authority does not discard the original result receipt");
  } finally { released.resolve(); eligible = true; await f.close(); }
});

function completedEnvelopeStorageFault(control) {
  return storage => ({ ...storage, write: (id, callback) => storage.write(id, transaction => callback({ ...transaction,
    async updateTurnMetadata(turnId, metadata) {
      if (metadata.applicationTools?.[0]?.status === control.status && control.fail) {
        control.fail = false;
        throw new Error("Completed application receipt storage offline");
      }
      return transaction.updateTurnMetadata(turnId, metadata);
    }
  })) });
}

test("completed Claude reservation failure executes nothing and installs no result-save retry", async t => {
  const fault = { status: "running", fail: true };
  const f = await completedEnvelopeFixture(t, { wrapStorage: completedEnvelopeStorageFault(fault) });
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    await assert.rejects(executeCompletedEnvelope(prepared), /receipt storage offline/);
    assert.equal(f.effects(), 0);
    assert.deepEqual(await f.conversation.retrySave(), { saved: false });
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.applicationTools?.length || 0, 0);
    assert.equal((await executeCompletedEnvelope(prepared)).ok, true);
    assert.equal(f.effects(), 1);
  } finally { await f.close(); }
});

test("completed Claude result-save retry preserves the exact original result without re-execution", async t => {
  const fault = { status: "complete", fail: true };
  const f = await completedEnvelopeFixture(t, { wrapStorage: completedEnvelopeStorageFault(fault) });
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    await assert.rejects(executeCompletedEnvelope(prepared), /receipt storage offline/);
    assert.equal(f.effects(), 1);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.applicationTools[0].status, "running");
    await assert.rejects(executeCompletedEnvelope(prepared), error => error.code === "conversation_storage_unavailable");
    assert.deepEqual(await f.conversation.retrySave(), { saved: true });
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.applicationTools[0].status, "complete");
    assert.deepEqual(await executeCompletedEnvelope(prepared), saved.metadata.applicationTools[0].result);
    assert.equal(f.effects(), 1);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
  } finally { await f.close(); }
});

test("completed Claude external account changes refuse repeatedly without fingerprint promotion", async t => {
  let apiKey = "completed-old-fixture-key";
  const f = await completedEnvelopeFixture(t, { configuration: { integrationId: "foreign", model: undefined, effort: "low" },
    connections: { resolve: async () => ({ providerId: "deepseek", model: "deepseek-flash", apiKey }) } });
  try {
    const receipt = await f.complete();
    const before = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding);
    apiKey = "completed-replaced-fixture-key";
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.prepare(receipt), /different account or provider connection/);
      assert.deepEqual(await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding), before);
    }
    assert.equal(f.effects(), 0);
    assert.equal((await f.trace()).filter(row => row.frame?.request?.subtype === "interrupt").length, 0,
      "Completion inspection cannot stop/promote the old native binding");
  } finally { await f.close(); }
});

test("completed Claude account inspection never creates a missing historical fingerprint", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    await f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      delete metadata.runtime.binding.accountIdentity;
      await tx.writeMetadata(metadata);
    });
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    await assert.rejects(f.prepare(receipt), /no saved native account fingerprint/);
    assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), before);
    await f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.binding.accountIdentity = "different-persisted-fixture-fingerprint";
      await tx.writeMetadata(metadata);
    });
    const mismatched = await f.storage.read("conversation", tx => tx.readMetadata());
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(f.prepare(receipt), /no longer matches its saved account fingerprint/);
      assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), mismatched);
    }
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude envelopes refuse unmarked history and caller-supplied markers preserve ordinary tool policy", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    await f.storage.write("conversation", async tx => {
      const turn = await tx.readTurn(receipt.turnId);
      const runtime = { ...turn.metadata.runtime };
      delete runtime.completedEnvelope;
      await tx.updateTurnMetadata(receipt.turnId, { runtime });
    });
    await assert.rejects(f.prepare(receipt), /no current verified receipt/);
    const ordinary = await f.conversation.send({ messageId: "ordinary-user", text: "tools", data: { completedEnvelope: true } });
    const state = await f.conversation.wait();
    const turn = state.conversationLog.find(row => row.turnId === ordinary.turnId);
    assert.equal(turn.metadata.runtime.completedEnvelope, undefined);
    assert.equal(turn.metadata.runtime.status, "complete", state.error);
    assert.deepEqual(turn.user.data, { completedEnvelope: true });
    const trace = await f.trace();
    const forged = trace.filter(row => row.frame?.type === "user").at(-1).frame.message.content;
    const forgedText = typeof forged === "string" ? forged : forged.filter(part => part.type === "text").map(part => part.text).join(" ");
    assert.match(forgedText, /\[Application data\]/);
    assert.match(forgedText, /"completedEnvelope":true/);
    assert.equal(f.effects(), 0, "Wrapped data is not the original fixture's exact tools trigger");
    await assert.rejects(f.prepare({ messageId: "ordinary-user", turnId: ordinary.turnId }), /no current verified receipt/);
    const plain = await f.conversation.send({ messageId: "ordinary-tools", text: "tools" });
    const final = await f.conversation.wait();
    const plainTurn = final.conversationLog.find(row => row.turnId === plain.turnId);
    assert.equal(plainTurn.metadata.runtime.completedEnvelope, undefined);
    assert.equal(plainTurn.metadata.runtime.status, "complete", final.error);
    assert.equal(plainTurn.metadata.applicationTools.length, 3, "Ordinary native discovery remains enabled in the opt-in runtime");
    assert.equal(f.effects(), 1);
    await assert.rejects(f.prepare({ messageId: "ordinary-tools", turnId: plain.turnId }), /no current verified receipt/);
    const starts = (await f.trace()).filter(row => row.args?.includes("--print"));
    assert.equal(starts.length, 2, "The existing comparator resumes once when application MCP availability changes");
    assert.deepEqual(JSON.parse(starts[0].args.at(starts[0].args.indexOf("--mcp-config") + 1)), { mcpServers: {} });
    assert.deepEqual(JSON.parse(starts[1].args.at(starts[1].args.indexOf("--mcp-config") + 1)), {
      mcpServers: { application: { type: "sdk", name: "application" } }
    });
  } finally { await f.close(); }
});

test("completed Claude envelopes refuse successors, active native work and foreign binding custody", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const old = await f.complete("older-response");
    const prepared = await f.prepare(old);
    const current = await f.complete("newer-response");
    await assert.rejects(executeCompletedEnvelope(prepared), /newer completed response/);
    const currentPrepared = await f.prepare(current);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    await f.storage.write("conversation", tx => tx.writeMetadata({ ...before,
      runtime: { ...before.runtime, binding: { ...before.runtime.binding, conversationId: "foreign-native-session" } } }));
    await assert.rejects(f.prepare(current), /different native conversation or host scope/,
      "Initial inspection cannot authorize a changed canonical conversation using a cached native entry");
    await assert.rejects(executeCompletedEnvelope(currentPrepared));
    await f.storage.write("conversation", tx => tx.writeMetadata(before));
    await f.conversation.wake({ messageId: "active-response", text: "wait" });
    await assert.rejects(f.prepare(current), error => error.code === "conversation_busy");
    await f.conversation.cancel();
    await f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.request = { messageId: "new-pending-response", origin: "application", text: "Pending",
        at: new Date().toISOString(), attempted: false, completedEnvelope: true };
      await tx.writeMetadata(metadata);
    });
    await assert.rejects(f.prepare(current), /no current verified receipt/);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude envelopes never backfill an old unmarked application reservation", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    await f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.request = { messageId: "old-unmarked", text: "Read a number", origin: "application",
        attachments: [], at: new Date().toISOString(), attempted: false };
      await tx.writeMetadata(metadata);
    });
    const receipt = await f.conversation.wake({ messageId: "old-unmarked", text: "Read a number", data: undefined });
    const state = await f.conversation.wait();
    const turn = state.conversationLog.find(row => row.turnId === receipt.turnId);
    assert.equal(turn.metadata.runtime.status, "complete", state.error);
    assert.equal(turn.metadata.runtime.completedEnvelope, undefined);
    await assert.rejects(f.prepare({ messageId: "old-unmarked", turnId: receipt.turnId, completedEnvelope: true }), /no current verified receipt/);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude effect-boundary revocation records a verified not-executed result", async t => {
  let eligible = true;
  let revoke = false;
  const f = await completedEnvelopeFixture(t, {
    authorize: ({ operation }) => operation !== "tool" || eligible,
    wrapStorage: storage => ({ ...storage, write: (id, callback) => storage.write(id, transaction => callback({ ...transaction,
      async updateTurnMetadata(turnId, metadata) {
        await transaction.updateTurnMetadata(turnId, metadata);
        if (revoke && metadata.applicationTools?.[0]?.status === "running") eligible = false;
      }
    })) })
  });
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    revoke = true;
    await assert.rejects(executeCompletedEnvelope(prepared), error => error.code === "conversation_forbidden");
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.applicationTools[0].status, "not-executed");
    assert.equal(saved.metadata.applicationTools[0].result.error.code, "conversation_tool_not_executed");
    eligible = true;
    const result = await executeCompletedEnvelope(prepared);
    assert.deepEqual(result, saved.metadata.applicationTools[0].result);
    assert.equal(f.effects(), 0, "A saved non-effect receipt also deduplicates without execution");
  } finally { eligible = true; await f.close(); }
});

test("completed Claude custody retains logical binding while existing process references refresh", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    await f.storage.write("conversation", tx => tx.writeMetadata({ ...before,
      runtime: { ...before.runtime, binding: { ...before.runtime.binding, executionId: "", processDirectory: "" } } }));
    try {
      assert.equal((await executeCompletedEnvelope(prepared)).ok, true);
      assert.equal(f.effects(), 1);
      const after = await f.storage.read("conversation", tx => tx.readMetadata());
      const persistent = ({ executionId, processDirectory, ...binding }) => binding;
      assert.deepEqual(persistent(after.runtime.binding), persistent(before.runtime.binding));
    } finally {
      await f.storage.write("conversation", async tx => {
        const current = await tx.readMetadata();
        current.runtime.binding = before.runtime.binding;
        await tx.writeMetadata(current);
      });
    }
  } finally { await f.close(); }
});

test("completed Claude unknown application outcomes never replay after the actual action fails", async t => {
  const f = await completedEnvelopeFixture(t, { execute() { throw new Error("Actual application operation failed"); } });
  try {
    const receipt = await f.complete();
    const first = await f.prepare(receipt);
    const second = await f.prepare(receipt);
    await assert.rejects(executeCompletedEnvelope(first), error => error.code === "conversation_tool_outcome_unknown");
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.applicationTools[0].status, "unknown");
    assert.equal(saved.metadata.applicationTools[0].result.ok, false);
    assert.ok(saved.metadata.applicationTools[0].result.error.status >= 500);
    await assert.rejects(executeCompletedEnvelope(second), error => error.code === "conversation_tool_outcome_unknown");
    await f.reopen();
    await assert.rejects(executeCompletedEnvelope(await f.prepare(receipt)), error => error.code === "conversation_tool_outcome_unknown");
    assert.equal(f.effects(), 1);
  } finally { await f.close(); }
});

test("completed Claude saved running application custody refuses an unconfirmed effect", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    await f.storage.write("conversation", tx => tx.updateTurnMetadata(receipt.turnId, { applicationTools: [{
      id: prepared.toolCallId, name: "numbers_read", arguments: "{}", status: "running", at: new Date().toISOString()
    }] }));
    await assert.rejects(executeCompletedEnvelope(prepared), error => error.code === "conversation_tool_outcome_unknown");
    assert.equal(f.effects(), 0);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.applicationTools[0].status, "running");
  } finally { await f.close(); }
});


for (const name of ["numbers_read", "mcp__application__numbers_read", "StructuredOutput", "unrelated_native_tool"]) {
  test(`completed Claude native-tool tracking classifies the authorized name ${name} without publishing its arguments`, async t => {
    const privateArgument = "native-tool-private-argument-must-not-leak";
    const f = await completedEnvelopeFixture(t, { nativeToolUse: { name, input: { privateArgument } } });
    const events = [];
    await f.conversation.subscribe(event => events.push(event));
    try {
      const receipt = await f.complete();
      const expected = name === "numbers_read" || name === "mcp__application__numbers_read";
      assert.equal((await f.prepare(receipt)).nativeToolAttempt, expected);
      const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
      assert.equal(saved.metadata.runtime.nativeToolAttempt, expected);
      assert.equal(saved.metadata.applicationTools, undefined, "Observing a native attempt does not execute an application action");
      assert.equal(f.effects(), 0);
      assert.equal(events.some(event => event.type === "provider-event"), false);
      assert.equal(JSON.stringify(events).includes(privateArgument), false);
      assert.equal(JSON.stringify(saved).includes(privateArgument), false);
      await f.reopen();
      assert.equal((await f.prepare(receipt)).nativeToolAttempt, expected, "A restart retains actual tracking evidence");
      assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    } finally { await f.close(); }
  });
}

test("completed Claude native-tool tracking refuses an older marked reservation with unknown evidence", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    await f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.request = { messageId: "old-marked-unknown", text: "Read a number", origin: "application",
        attachments: [], at: new Date().toISOString(), attempted: false, completedEnvelope: true };
      await tx.writeMetadata(metadata);
    });
    const receipt = await f.complete("old-marked-unknown");
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.runtime.nativeToolAttempt, undefined);
    await assert.rejects(f.prepare(receipt), /no native tool-attempt evidence/);
    await f.reopen();
    await assert.rejects(f.prepare(receipt), /no native tool-attempt evidence/);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.runtime.nativeToolAttempt, undefined);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude native-tool tracking refuses lost evidence on an already completed receipt", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    await f.storage.write("conversation", async tx => {
      const turn = await tx.readTurn(receipt.turnId);
      delete turn.metadata.runtime.nativeToolAttempt;
      await tx.updateTurnMetadata(receipt.turnId, { runtime: turn.metadata.runtime });
    });
    await assert.rejects(f.prepare(receipt), /no native tool-attempt evidence/);
    await assert.rejects(executeCompletedEnvelope(prepared), /no native tool-attempt evidence/);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude native-tool tracking refuses marked and mixed steering before reserving a successor", async t => {
  const waitEvent = conversationRequestText({ text: "wait", origin: "application" });
  const f = await completedEnvelopeFixture(t, { applicationEventBehavior: { wait: waitEvent } });
  try {
    const marked = await f.conversation.wake({ messageId: "marked-working", text: "wait" });
    assert.equal((await f.conversation.read()).status, "working", "The exact application wait frame genuinely holds the native turn");
    const markedTurn = await f.storage.read("conversation", tx => tx.readTurn(marked.turnId));
    assert.equal(markedTurn.metadata.runtime.status, "running");
    assert.equal(markedTurn.assistant, null);
    assert.equal((await f.trace()).find(row => row.frame?.type === "user").frame.message.content, waitEvent);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    await assert.rejects(f.conversation.send({ messageId: "ordinary-steer", text: "Different instruction", steer: true }),
      error => error.code === "conversation_not_steerable");
    await assert.rejects(f.conversation.wake({ messageId: "marked-steer", text: "Different application instruction", steer: true }),
      error => error.code === "conversation_not_steerable");
    const after = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.deepEqual(after.runtime.request, before.runtime.request);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    assert.equal((await f.trace()).filter(row => row.frame?.request?.subtype === "interrupt").length, 0);
    await f.conversation.cancel();
    const ordinaryReceipt = await f.conversation.send({ messageId: "ordinary-working", text: "wait" });
    assert.equal((await f.conversation.read()).status, "working");
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(ordinaryReceipt.turnId))).metadata.runtime.status, "running");
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").at(-1).frame.message.content, "wait");
    const ordinary = await f.storage.read("conversation", tx => tx.readMetadata());
    await assert.rejects(f.conversation.wake({ messageId: "mixed-marked", text: "New application response", steer: true }),
      error => error.code === "conversation_not_steerable");
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.request, ordinary.runtime.request);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 2);
    assert.equal(f.effects(), 0);
    await f.conversation.cancel();
  } finally { await f.close(); }
});

test("completed Claude native-tool tracking refuses steering a retained marked unconfirmed delivery", async t => {
  const lostEvent = conversationRequestText({ text: "lost", origin: "application" });
  const f = await completedEnvelopeFixture(t, { applicationEventBehavior: { lost: lostEvent } });
  try {
    await assert.rejects(f.conversation.wake({ messageId: "retained-marked", text: "lost" }), /not acknowledged/);
    assert.equal((await f.conversation.wait()).status, "unconfirmed");
    assert.equal((await f.trace()).find(row => row.frame?.type === "user").frame.message.content, lostEvent);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.equal(before.runtime.request.completedEnvelope, true);
    assert.equal(before.runtime.request.attempted, true);
    await assert.rejects(f.conversation.send({ messageId: "retained-mixed-steer", text: "New instruction", steer: true }),
      error => error.code === "conversation_not_steerable");
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.request, before.runtime.request);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude native-tool tracking preserves ordinary native steering in the opted runtime", async t => {
  const f = await completedEnvelopeFixture(t);
  const progress = Promise.withResolvers();
  await f.conversation.subscribe(event => {
    if (event.type === "message" && event.text === "Initial progress") progress.resolve();
  });
  try {
    await f.conversation.send({ messageId: "ordinary-before", text: "steering" });
    await progress.promise;
    await f.conversation.send({ messageId: "ordinary-after", text: "Continue differently", steer: true });
    const state = await f.conversation.wait();
    assert.equal(state.error, "");
    assert.equal(state.conversationLog.length, 2);
    assert.equal(state.conversationLog[0].assistant.text, "Initial progress");
    assert.equal(state.conversationLog[1].assistant.text, JSON.stringify(completedEnvelopeValue));
    for (const turn of state.conversationLog) {
      assert.equal(turn.metadata.runtime.completedEnvelope, undefined);
      assert.equal(turn.metadata.runtime.nativeToolAttempt, undefined);
    }
    const trace = await f.trace();
    assert.equal(trace.filter(row => row.args?.includes("--print")).length, 1);
    assert.equal(trace.filter(row => row.frame?.type === "user").length, 2);
    assert.equal(trace.filter(row => row.frame?.request?.subtype === "interrupt").length, 1);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});


test("completed Claude native-tool tracking excludes nested-agent frames at the original receive owner", async t => {
  const privateArgument = "nested-tool-argument-must-not-leak";
  const f = await completedEnvelopeFixture(t, { nativeToolUse: { name: "mcp__application__numbers_read",
    input: { privateArgument }, parentToolUseId: "parent-native-tool" } });
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  try {
    const receipt = await f.complete();
    assert.equal((await f.prepare(receipt)).nativeToolAttempt, false);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.runtime.nativeToolAttempt, false);
    assert.equal(JSON.stringify(events).includes(privateArgument), false);
    assert.equal(JSON.stringify(saved).includes(privateArgument), false);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude native-tool tracking propagates its receipt write failure before effect preparation", async t => {
  let attempts = 0;
  const f = await completedEnvelopeFixture(t, { nativeToolUse: { name: "numbers_read", input: {} },
    wrapStorage: storage => ({ ...storage, write: (id, callback) => storage.write(id, transaction => callback({ ...transaction,
      async updateTurnMetadata(turnId, metadata) {
        if (metadata.runtime?.nativeToolAttempt === true) {
          attempts++;
          throw new Error("Native attempt persistence failed");
        }
        return transaction.updateTurnMetadata(turnId, metadata);
      }
    })) }) });
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  try {
    const receipt = await f.conversation.wake({ messageId: "native-attempt-write-failure", text: "Read a number" });
    const state = await f.conversation.wait();
    assert.equal(state.error, "Native attempt persistence failed");
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.runtime.status, "interrupted", "Original native failure cleanup stops the admitted turn before rejecting completion");
    assert.equal(saved.metadata.runtime.error, "Native attempt persistence failed");
    assert.equal(saved.assistant, null);
    const settled = events.filter(event => event.type === "settled").at(-1);
    assert.equal(settled.status, "interrupted");
    assert.equal(settled.error, "Native attempt persistence failed");
    assert.equal((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.binding.executionId, "");
    assert.equal(saved.metadata.runtime.nativeToolAttempt, false);
    assert.equal(attempts, 1, "The awaited native callback does not swallow or repeat a failed receipt write");
    await assert.rejects(f.prepare({ messageId: receipt.messageId, turnId: receipt.turnId }),
      error => error.code === "conversation_completed_response_unavailable");
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude native-tool tracking is part of the prepared immutable response identity", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const receipt = await f.complete();
    const prepared = await f.prepare(receipt);
    assert.equal(prepared.nativeToolAttempt, false);
    await f.storage.write("conversation", async tx => {
      const turn = await tx.readTurn(receipt.turnId);
      await tx.updateTurnMetadata(receipt.turnId, { runtime: { ...turn.metadata.runtime, nativeToolAttempt: true } });
    });
    await assert.rejects(executeCompletedEnvelope(prepared), /completed response identity changed/);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});


test("completed Claude presentation pages hide internal carriers while preserving raw completion and current errors", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    await f.storage.write("conversation", tx => tx.appendMessage("000001", {
      role: "user", messageId: "product-a", text: "Visible A", at: "2026-10-10T00:00:00.000Z"
    }));
    const first = await f.complete("internal-a");
    await f.storage.write("conversation", tx => tx.appendMessage("000003", {
      role: "user", messageId: "product-b", text: "Visible B", at: "2026-10-10T00:00:01.000Z"
    }));
    const last = await f.complete("internal-b");
    const all = await f.conversation.read();
    assert.equal(all.status, "ready");
    assert.deepEqual(all.conversationLog.map(turn => turn.user.text), ["Visible A", "Visible B"]);
    const page = await f.conversation.read({ limit: 1, presentation: false });
    assert.deepEqual(page.conversationLog.map(turn => turn.turnId), ["000003"]);
    assert.equal(page.pagination.totalTurnCount, 2);
    assert.equal(page.pagination.count, 1);
    assert.equal(page.pagination.hasMoreBefore, true);
    assert.equal(page.pagination.nextBeforeTurnId, "000003");
    const older = await f.conversation.read({ limit: 1, beforeTurnId: page.pagination.nextBeforeTurnId });
    assert.deepEqual(older.conversationLog.map(turn => turn.turnId), ["000001"]);
    assert.equal(older.pagination.hasMoreBefore, false);
    await f.storage.write("conversation", async tx => {
      const turn = await tx.readTurn(last.turnId);
      await tx.updateTurnMetadata(last.turnId, { runtime: { ...turn.metadata.runtime, error: "Exact private completion error" } });
    });
    assert.equal((await f.conversation.read({ limit: 1, beforeTurnId: "000003" })).error, "Exact private completion error");
    for (const receipt of [first, last]) {
      const raw = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
      assert.equal(raw.metadata.runtime.status, "complete");
      assert.equal(raw.metadata.runtime.completedEnvelope, true);
      assert.equal(raw.assistant.text, JSON.stringify(completedEnvelopeValue));
    }
    assert.equal((await f.storage.read("conversation", tx => tx.listTurnIds())).length, 4);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude wake exclusions retain all product fingerprints only after the actual internal admission", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    await f.storage.write("conversation", async tx => {
      for (const [turnId, messageId, text] of [["000001", "batch-a", "Product A"], ["000002", "batch-b", "Product B"]]) {
        await tx.appendMessage(turnId, { role: "user", messageId, text, at: "2026-10-10T00:00:00.000Z" });
      }
    });
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.seen, {});
    const receipt = await f.conversation.wake({ messageId: "internal-batch", text: "Read a number" },
      { excludedMessageIds: ["batch-a", "batch-b"] });
    const state = await f.conversation.wait();
    assert.equal(state.status, "ready");
    assert.deepEqual(state.conversationLog.map(turn => turn.user.messageId), ["batch-a", "batch-b"]);
    const { claudeNativeMessageId } = await import("../src/server/conversation/claudeTurn.js");
    const nativeMessageId = claudeNativeMessageId(receipt.messageId);
    const frames = (await f.trace()).filter(row => row.frame?.type === "user" && row.frame.uuid === nativeMessageId);
    assert.equal(frames.length, 1, "The original Claude ID mapper identifies exactly one actual admitted native input");
    const frame = frames[0].frame;
    assert.equal(frame.uuid, nativeMessageId);
    assert.doesNotMatch(frame.message.content, /Product A|Product B/);
    const { runtime } = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.ok(runtime.seen["000001/user/"]);
    assert.ok(runtime.seen["000002/user/"]);
    assert.equal(runtime.request, undefined);
    const internal = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(internal.system.messageId, "internal-batch");
    assert.equal(internal.metadata.runtime.completedEnvelope, true);
    assert.equal(internal.metadata.runtime.excludedMessageIds, undefined, "The capture belongs to the private pending request, not a permanent receipt promotion");
    assert.equal(internal.system.data, undefined);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude retained wake exclusions cannot change on a same-ID retry or backfill old reservations", async t => {
  const lostEvent = conversationRequestText({ text: "lost", origin: "application" });
  const f = await completedEnvelopeFixture(t, { applicationEventBehavior: { lost: lostEvent } });
  try {
    const options = { excludedMessageIds: ["batch-a"] };
    await assert.rejects(f.conversation.wake({ messageId: "lost-exclusions", text: "lost" }, options), /not acknowledged/);
    options.excludedMessageIds.push("batch-b");
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.deepEqual(before.runtime.request.excludedMessageIds, ["batch-a"]);
    assert.equal(before.runtime.request.attempted, true);
    assert.deepEqual(before.runtime.seen, {});
    const visible = await f.conversation.read();
    assert.equal(visible.status, "unconfirmed");
    assert.equal(visible.pendingRequest, null);
    assert.deepEqual(visible.conversationLog, []);
    await f.reopen();
    const retained = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.deepEqual(retained.runtime.request.excludedMessageIds, before.runtime.request.excludedMessageIds);
    assert.deepEqual(retained.runtime.request.seen, before.runtime.request.seen);
    assert.equal(retained.runtime.request.message, before.runtime.request.message);
    await assert.rejects(f.conversation.wake({ messageId: "lost-exclusions", text: "lost" }, options),
      error => error.code === "conversation_message_conflict");
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.request, retained.runtime.request);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    await assert.rejects(f.conversation.wake({ messageId: "different-exclusions", text: "Read a number" }, { excludedMessageIds: ["batch-a"] }),
      error => ["conversation_delivery_uncertain", "conversation_not_steerable"].includes(error.code));
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.request, retained.runtime.request);
    await f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.request = { messageId: "old-exclusions", origin: "application", text: "Read a number", attachments: [],
        at: "2026-10-10T00:00:00.000Z", attempted: false };
      await tx.writeMetadata(metadata);
    });
    const old = await f.storage.read("conversation", tx => tx.readMetadata());
    await assert.rejects(f.conversation.wake({ messageId: "old-exclusions", text: "Read a number" }, { excludedMessageIds: ["batch-a"] }),
      error => error.code === "conversation_message_conflict");
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.request, old.runtime.request);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});


test("completed Claude subscribers keep trusted raw carriers while human reads omit private streams and pending input", async t => {
  const f = await completedEnvelopeFixture(t);
  const events = [];
  const observations = [];
  await f.conversation.subscribe(event => {
    events.push(event);
    if (event.type === "message" && event.completedEnvelope === true) observations.push(f.conversation.read());
  });
  try {
    const receipt = await f.complete();
    const raw = events.filter(event => event.type === "message" && event.status === "complete");
    assert.ok(raw.some(event => event.text === JSON.stringify(completedEnvelopeValue) && event.completedEnvelope === true));
    assert.ok(events.some(event => event.type === "message" && event.status === "inProgress" && event.completedEnvelope === true));
    assert.ok(observations.length);
    for (const state of await Promise.all(observations)) {
      assert.deepEqual(state.conversationLog, []);
      assert.equal(state.pendingRequest, null);
      assert.deepEqual(state.streaming.messages, []);
    }
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).assistant.text,
      JSON.stringify(completedEnvelopeValue));
    await f.conversation.send({ messageId: "ordinary-data", text: "Hello", data: {
      completedEnvelope: true, excludedMessageIds: ["ordinary-data"]
    } });
    const ordinary = await f.conversation.wait();
    assert.equal(ordinary.conversationLog.length, 1);
    assert.equal(ordinary.conversationLog[0].metadata.runtime.completedEnvelope, undefined);
    assert.deepEqual(ordinary.conversationLog[0].user.data, { completedEnvelope: true, excludedMessageIds: ["ordinary-data"] });
    assert.ok(events.some(event => event.type === "message" && event.status === "complete" && event.completedEnvelope === undefined));
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude wake rejects invalid private exclusions without creating a native reservation", async t => {
  const f = await completedEnvelopeFixture(t);
  try {
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    for (const excludedMessageIds of [null, [""], [" "], ["x".repeat(129)], ["duplicate", "duplicate"], [1]]) {
      await assert.rejects(f.conversation.wake({ messageId: "invalid-exclusions", text: "Read a number" }, { excludedMessageIds }),
        error => error.code === "conversation_invalid_message");
      assert.deepEqual(await f.storage.read("conversation", tx => tx.readMetadata()), before);
    }
    const trace = await f.trace().catch(error => { if (error.code === "ENOENT") return []; throw error; });
    assert.equal(trace.filter(row => row.frame?.type === "user").length, 0);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});


// A reply carrier uses the same original executable/native history fixture, not
// a manufactured completion or a second product transcript implementation.
async function completedReplyFixture(t, options = {}) {
  const value = { kind: "reply", text: "  Verified plain reply.  ", toolName: "", arguments: "" };
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  let effects = 0;
  const actions = applicationActions(async () => { effects++; return { value: 42 }; });
  const f = await fixture(t, { ...options, context, actions, structuredResponse: value,
    configuration: { ...configuration, outputSchema: completedEnvelopeSchema } });
  await f.first.close();
  const { createConversationTranscript } = await import("../src/server/conversation/transcript.js");
  const transcript = createConversationTranscript({ storage: f.storage });
  let runtime;
  let conversation;
  async function reopen() {
    if (runtime) await runtime.close();
    runtime = createConversationRuntime({ engine: "claude", storage: f.storage, actions,
      authorize: options.authorize || (() => true), completedEnvelope: true, ...f.driverOptions });
    conversation = await runtime.open({ id: "conversation", context });
  }
  await reopen();
  const controller = new AbortController();
  return { ...f, transcript, value, controller, reopen, effects: () => effects,
    get conversation() { return conversation; }, close: () => runtime.close(),
    plain: (messageId, text = "Actual product user words") => transcript.writeConversationUserMessage("conversation", {
      messageId, text, data: { original: true }
    }),
    async complete(messageId = "completed-reply", excludedMessageIds = []) {
      const receipt = await conversation.wake({ messageId, text: "Give a reply" }, { excludedMessageIds });
      const state = await conversation.wait();
      const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
      assert.equal(saved.metadata.runtime.status, "complete", state.error);
      assert.equal(saved.metadata.runtime.completedEnvelope, true);
      assert.equal(saved.assistant.text, JSON.stringify(value));
      return { messageId, turnId: receipt.turnId };
    },
    prepare: receipt => conversation.prepareCompletedResponse(receipt, { signal: controller.signal }) };
}

test("completed Claude prepared reply atomically publishes one plain final across handles and restart", async t => {
  const f = await completedReplyFixture(t);
  try {
    const plain = await f.plain("product-reply");
    const receipt = await f.complete("internal-reply", [plain.user.messageId]);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    const raw = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    const first = await f.prepare(receipt);
    const second = await f.prepare(receipt);
    first.text = JSON.stringify({ kind: "reply", text: "Caller supplied replacement" });
    const [one, two] = await Promise.all([first.publishReply({ turnId: plain.turnId }), second.publishReply({ turnId: plain.turnId })]);
    assert.deepEqual(two, one);
    assert.equal(one.assistant.text, "Verified plain reply.");
    assert.deepEqual(one.user, plain.user);
    assert.equal(one.metadata?.runtime?.engine, undefined);
    const { conversationMessageIdentity, conversationMessageVersion } = await import("../src/server/conversation/continuity.js");
    const identity = conversationMessageIdentity(plain.turnId, one.assistant);
    const after = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.deepEqual(after.runtime.seen, { ...before.runtime.seen,
      [identity]: conversationMessageVersion(one.assistant, { includeData: true }) });
    const internal = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.deepEqual(internal.assistant, raw.assistant);
    assert.deepEqual(internal.system, raw.system);
    assert.deepEqual(internal.metadata.runtime, { ...raw.metadata.runtime, publishedReplyTurnId: plain.turnId });
    assert.equal(internal.metadata.applicationTools, undefined);
    await assert.rejects(second.publishReply({ turnId: plain.turnId, text: "Untrusted text" }), TypeError);
    await f.reopen();
    assert.deepEqual(await (await f.prepare(receipt)).publishReply({ turnId: plain.turnId }), one);
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.seen, after.runtime.seen);
    assert.deepEqual((await f.conversation.read()).conversationLog.map(turn => turn.assistant?.text), ["Verified plain reply."]);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    assert.equal((await f.trace()).filter(row => row.args?.includes("--print")).length, 1);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude prepared reply refuses foreign targets, existing finals and consumed identities", async t => {
  const f = await completedReplyFixture(t);
  try {
    const empty = await f.plain("empty-target");
    const populated = await f.plain("populated-target");
    await f.transcript.upsertConversationAssistantMessage("conversation", { turnId: populated.turnId, text: "Unassociated final" });
    const consumed = await f.plain("consumed-target");
    const owned = await f.plain("native-owned-target");
    const receipt = await f.complete("target-check", [empty.user.messageId, populated.user.messageId, consumed.user.messageId, owned.user.messageId]);
    await f.storage.write("conversation", async tx => {
      const metadata = await tx.readMetadata();
      metadata.runtime.seen[`${consumed.turnId}/assistant/`] = "Retained prior consumption";
      await tx.writeMetadata(metadata);
      await tx.updateTurnMetadata(owned.turnId, { runtime: { engine: "claude" } });
    });
    const prepared = await f.prepare(receipt);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    for (const turnId of ["missing", receipt.turnId, populated.turnId, consumed.turnId, owned.turnId]) {
      await assert.rejects(prepared.publishReply({ turnId }), error => error.code === "conversation_tool_receipt_conflict");
    }
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(populated.turnId))).assistant.text, "Unassociated final");
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(consumed.turnId))).assistant, null);
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.seen, before.runtime.seen);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.runtime.publishedReplyTurnId, undefined);
    const published = await prepared.publishReply({ turnId: empty.turnId });
    await assert.rejects((await f.prepare(receipt)).publishReply({ turnId: consumed.turnId }), /target or text changed/);
    assert.equal(published.assistant.text, "Verified plain reply.");
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude prepared reply refuses edited or cleared finals without rewriting consumption", async t => {
  const f = await completedReplyFixture(t);
  try {
    const plain = await f.plain("edited-target");
    const receipt = await f.complete("edit-check", [plain.user.messageId]);
    const prepared = await f.prepare(receipt);
    const published = await prepared.publishReply({ turnId: plain.turnId });
    const seen = (await f.storage.read("conversation", tx => tx.readMetadata())).runtime.seen;
    await f.transcript.upsertConversationAssistantMessage("conversation", { turnId: plain.turnId, text: "Actual user edit" });
    await assert.rejects(prepared.publishReply({ turnId: plain.turnId }), /target or text changed/);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(plain.turnId))).assistant.text, "Actual user edit");
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.seen, seen);
    // The original replaceAssistant owner clears this saved final, preserving
    // the persisted consumed version instead of acknowledging an edit.
    await f.storage.write("conversation", tx => tx.replaceAssistant(plain.turnId, { text: "" }));
    await f.reopen();
    await assert.rejects((await f.prepare(receipt)).publishReply({ turnId: plain.turnId }), /target or text changed/);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(plain.turnId))).assistant.text, "");
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.seen, seen);
    assert.notEqual(published.assistant.text, "");
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude prepared reply rolls back final and cursor together when receipt persistence fails", async t => {
  let failPublication = false;
  let commits = 0;
  const f = await completedReplyFixture(t, { wrapStorage: storage => ({ ...storage,
    write: (id, callback) => storage.write(id, async tx => {
      let replaced = false;
      const result = await callback({ ...tx,
        async replaceAssistant(...args) { replaced = true; return tx.replaceAssistant(...args); },
        async updateTurnMetadata(turnId, patch) {
          if (failPublication && patch.runtime?.publishedReplyTurnId) throw new Error("Actual reply receipt write failed");
          return tx.updateTurnMetadata(turnId, patch);
        } });
      if (replaced) commits++;
      return result;
    }) }) });
  try {
    const plain = await f.plain("rollback-target");
    const receipt = await f.complete("rollback-check", [plain.user.messageId]);
    const prepared = await f.prepare(receipt);
    const before = await f.storage.read("conversation", tx => tx.readMetadata());
    const raw = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    commits = 0;
    failPublication = true;
    await assert.rejects(prepared.publishReply({ turnId: plain.turnId }), /Actual reply receipt write failed/);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(plain.turnId))).assistant, null);
    assert.deepEqual(await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId)), raw);
    assert.deepEqual((await f.storage.read("conversation", tx => tx.readMetadata())).runtime.seen, before.runtime.seen);
    assert.equal(commits, 0, "The failed nested upsert never commits independently");
    failPublication = false;
    const published = await prepared.publishReply({ turnId: plain.turnId });
    assert.equal(published.assistant.text, "Verified plain reply.");
    assert.equal(commits, 1, "Final, exact response link and assistant cursor share one storage commit");
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    assert.equal(f.effects(), 0);
  } finally { failPublication = false; await f.close(); }
});

test("completed Claude prepared reply checks live worker authority and account again before publication", async t => {
  let eligible = true;
  const f = await completedReplyFixture(t, { authorize: ({ operation }) => operation !== "tool" || eligible });
  try {
    const plain = await f.plain("authority-target");
    const receipt = await f.complete("authority-check", [plain.user.messageId]);
    const prepared = await f.prepare(receipt);
    eligible = false;
    await assert.rejects(prepared.publishReply({ turnId: plain.turnId }), error => error.code === "conversation_forbidden");
    eligible = true;
    await writeFile(f.account, "different@example.test");
    await assert.rejects(prepared.publishReply({ turnId: plain.turnId }));
    await writeFile(f.account, "owner@example.test");
    f.controller.abort(new Error("Original product worker stopped before reply"));
    await assert.rejects(prepared.publishReply({ turnId: plain.turnId }), /Original product worker stopped before reply/);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(plain.turnId))).assistant, null);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.runtime.publishedReplyTurnId, undefined);
    assert.equal(f.effects(), 0);
  } finally { eligible = true; await f.close(); }
});

test("completed Claude receipt cannot publish a final and execute an application effect in either order", async t => {
  for (const effectFirst of [false, true]) {
    await t.test(effectFirst ? "effect before publication" : "publication before effect", async t => {
      const f = await completedReplyFixture(t);
      try {
        const plain = await f.plain("exclusive-target");
        const receipt = await f.complete("exclusive-check", [plain.user.messageId]);
        const one = await f.prepare(receipt);
        const two = await f.prepare(receipt);
        if (effectFirst) {
          assert.equal((await executeCompletedEnvelope(one)).ok, true);
          await assert.rejects(two.publishReply({ turnId: plain.turnId }), /does not own a plain reply/);
          assert.equal((await f.storage.read("conversation", tx => tx.readTurn(plain.turnId))).assistant, null);
          assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.runtime.publishedReplyTurnId, undefined);
          assert.equal(f.effects(), 1);
        } else {
          await one.publishReply({ turnId: plain.turnId });
          await assert.rejects(executeCompletedEnvelope(two), /already published its plain reply/);
          assert.equal((await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId))).metadata.applicationTools, undefined);
          assert.equal(f.effects(), 0);
        }
      } finally { await f.close(); }
    });
  }
});

test("completed Claude prepared reply refuses a native application-tool misroute and a tool envelope", async t => {
  const f = await completedReplyFixture(t, { nativeToolUse: { name: "numbers_read", input: { privateArgument: "Not a reply" } } });
  try {
    const plain = await f.plain("misroute-target");
    const receipt = await f.complete("misroute-reply", [plain.user.messageId]);
    const prepared = await f.prepare(receipt);
    assert.equal(prepared.nativeToolAttempt, true);
    await assert.rejects(prepared.publishReply({ turnId: plain.turnId }), /does not own a plain reply/);
    assert.equal((await f.storage.read("conversation", tx => tx.readTurn(plain.turnId))).assistant, null);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
  const tool = await completedEnvelopeFixture(t);
  try {
    const receipt = await tool.complete("tool-not-final");
    await tool.storage.write("conversation", tx => tx.appendMessage("000002", {
      role: "user", messageId: "tool-target", text: "Product words", at: "2026-10-10T00:00:00.000Z"
    }));
    await assert.rejects((await tool.prepare(receipt)).publishReply({ turnId: "000002" }), /does not own a plain reply/);
    assert.equal((await tool.storage.read("conversation", tx => tx.readTurn("000002"))).assistant, null);
    assert.equal(tool.effects(), 0);
  } finally { await tool.close(); }
});


// Wire capacity belongs to a trusted internal carrier; decoded human/tool fields
// keep the original fixed-envelope bounds. Reuse the original native executable.
const completedClaudeWireSchema = { type: "object", additionalProperties: false,
  required: ["kind", "text", "toolName", "arguments"], properties: {
    kind: { type: "string", enum: ["reply", "tool"] }, text: { type: "string", maxLength: 16000 },
    toolName: { type: "string", maxLength: 256 }, arguments: { type: "string", maxLength: 262144 }
  } };
async function completedClaudeWireFixture(t, value, options = {}) {
  let effects = 0;
  const actions = applicationActions(async () => { effects++; return { value: 42 }; });
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  const f = await fixture(t, { ...options, actions, context, structuredResponse: value,
    configuration: { ...configuration, outputSchema: options.outputSchema || completedClaudeWireSchema },
    limits: { maxFinalReplyCharacters: 16000, maxOutputCharacters: 1670455, ...options.limits } });
  await f.first.close();
  let runtime, conversation;
  async function reopen() {
    if (runtime) await runtime.close();
    runtime = createConversationRuntime({ engine: "claude", storage: f.storage, actions,
      authorize: () => true, completedEnvelope: true, ...f.driverOptions });
    try { conversation = await runtime.open({ id: "conversation", context }); }
    catch (error) { await runtime.close(); throw error; }
  }
  await reopen();
  return { ...f, reopen, effects: () => effects, get conversation() { return conversation; }, close: () => runtime.close() };
}

for (const kind of ["tool", "reply"]) test(`completed Claude ${kind} wire preserves large decoded fields beyond the human cap`, async t => {
  const handover = "😀".repeat(20000);
  const argumentsText = JSON.stringify({ value: handover }).replace(/[\u0080-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const value = kind === "tool" ? { kind, text: "", toolName: "numbers_read", arguments: argumentsText }
    : { kind, text: "\u0000".repeat(16000), toolName: "", arguments: "" };
  const raw = JSON.stringify(value);
  assert.ok(raw.length > (kind === "tool" ? 280000 : 16000));
  if (kind === "tool") assert.equal(value.arguments.length, 240012);
  const f = await completedClaudeWireFixture(t, value);
  try {
    const receipt = await f.conversation.wake({ messageId: `large-claude-${kind}`, text: "Read the completed envelope" });
    const state = await f.conversation.wait();
    assert.equal(state.status, "ready", state.error);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.runtime.status, "complete");
    assert.equal(saved.metadata.runtime.completedEnvelope, true);
    assert.equal(saved.system.origin, "application");
    assert.equal(saved.assistant.text, raw);
    const prepared = await f.conversation.prepareCompletedResponse(receipt, { signal: new AbortController().signal });
    assert.equal(prepared.text, raw);
    const { readAssistantResponseEnvelope } = await import("../src/server/lib/assistantToolLoop.js");
    const decoded = readAssistantResponseEnvelope(prepared.text);
    assert.deepEqual(decoded, value);
    if (kind === "tool") assert.equal(JSON.parse(decoded.arguments).value, handover);
    assert.equal(f.effects(), 0);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    assert.deepEqual((await f.conversation.read()).conversationLog, []);
  } finally { await f.close(); }
});

test("completed Claude wire overflow remains bounded before any decoded effect", async t => {
  const value = { kind: "tool", text: "", toolName: "numbers_read", arguments: JSON.stringify({ content: "x".repeat(2000) }) };
  assert.ok(JSON.stringify(value).length > 2000);
  const f = await completedClaudeWireFixture(t, value, { outputSchema: completedEnvelopeSchema,
    limits: { maxOutputCharacters: 2000, maxFinalReplyCharacters: 16 } });
  try {
    const receipt = await f.conversation.wake({ messageId: "claude-wire-overflow", text: "Read the completed envelope" });
    const state = await f.conversation.wait();
    assert.equal(state.status, "ready", "The thread is idle after its failed admitted turn");
    assert.match(state.error, /output exceeded.*size limit|final reply limit/);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(receipt.status, "accepted");
    assert.equal(saved.metadata.runtime.status, "interrupted");
    assert.equal(saved.metadata.runtime.error, state.error);
    const metadata = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.equal(metadata.runtime.binding.executionId, "", "The original verified Stop released its native execution");
    assert.ok((saved.assistant?.text.length || 0) <= 2000);
    assert.equal(saved.metadata.runtime.completedEnvelope, true);
    assert.notEqual(saved.assistant?.text, JSON.stringify(value));
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

for (const forged of [false, true]) test(`ordinary Claude ${forged ? "forged-data" : "unmarked"} reply keeps its human cap in completed mode`, async t => {
  const value = { kind: "reply", text: "\u0000".repeat(16000), toolName: "", arguments: "" };
  const f = await completedClaudeWireFixture(t, value);
  try {
    const receipt = await f.conversation.send({ messageId: "ordinary-wire", text: "An ordinary request",
      ...(forged ? { data: { completedEnvelope: true } } : {}) });
    const state = await f.conversation.wait();
    assert.equal(state.status, "ready", "The thread is idle after its failed admitted turn");
    assert.match(state.error, /final reply limit/);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(receipt.status, "accepted");
    assert.equal(saved.metadata.runtime.status, "interrupted");
    assert.equal(saved.metadata.runtime.error, state.error);
    const metadata = await f.storage.read("conversation", tx => tx.readMetadata());
    assert.equal(metadata.runtime.binding.executionId, "", "The original verified Stop released its native execution");
    assert.ok((saved.assistant?.text.length || 0) <= 16000);
    assert.equal(saved.metadata.runtime.completedEnvelope, undefined);
    assert.equal(saved.user.origin, "user");
    if (forged) assert.deepEqual(saved.user.data, { completedEnvelope: true });
    assert.notEqual(saved.assistant?.text, JSON.stringify(value));
    assert.equal((await f.conversation.inspectDelivery({ messageId: receipt.messageId })).status, "accepted");
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude marked native recovery retains large raw output without replay", async t => {
  const value = { kind: "reply", text: "\u0000".repeat(16000), toolName: "", arguments: "" };
  const f = await completedClaudeWireFixture(t, value, { applicationEventBehavior: {
    lost: conversationRequestText({ text: "lost", origin: "application" }) } });
  try {
    await assert.rejects(f.conversation.wake({ messageId: "lost-marked-wire", text: "lost" }), /not acknowledged/);
    assert.equal((await f.conversation.read()).status, "unconfirmed");
    await f.reopen();
    const receipt = await f.conversation.inspectDelivery({ messageId: "lost-marked-wire" });
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.recovered, true);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.runtime.completedEnvelope, true);
    assert.equal(saved.metadata.runtime.status, "interrupted", "An acknowledged history row is not a fabricated successful native result");
    assert.equal(saved.assistant.text, JSON.stringify(value));
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});

test("completed Claude marked native recovery retains admission but rejects wire overflow", async t => {
  const value = { kind: "tool", text: "", toolName: "numbers_read", arguments: JSON.stringify({ content: "x".repeat(2000) }) };
  const f = await completedClaudeWireFixture(t, value, { outputSchema: completedEnvelopeSchema,
    limits: { maxOutputCharacters: 2000, maxFinalReplyCharacters: 16 }, applicationEventBehavior: {
      lost: conversationRequestText({ text: "lost", origin: "application" }) } });
  try {
    await assert.rejects(f.conversation.wake({ messageId: "lost-marked-overflow", text: "lost" }), /not acknowledged/);
    await f.reopen();
    const receipt = await f.conversation.inspectDelivery({ messageId: "lost-marked-overflow" });
    assert.equal(receipt.status, "accepted");
    assert.equal(receipt.recovered, true);
    const saved = await f.storage.read("conversation", tx => tx.readTurn(receipt.turnId));
    assert.equal(saved.metadata.runtime.completedEnvelope, true);
    assert.equal(saved.metadata.runtime.status, "failed");
    assert.notEqual(saved.assistant?.text, JSON.stringify(value));
    assert.match((await f.conversation.read()).error, /final reply limit/);
    assert.equal((await f.trace()).filter(row => row.frame?.type === "user").length, 1);
    assert.equal(f.effects(), 0);
  } finally { await f.close(); }
});
