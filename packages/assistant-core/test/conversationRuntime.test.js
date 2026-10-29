import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationHookBridge, createConversationRuntime } from "../src/server/conversation/index.js";
import { createClaudeConversationTurn } from "../src/server/conversation/claudeTurn.js";
import { createCodexConversationAdapter } from "../src/server/conversation/providers/codex.js";
import { createOpenCodeConversationAdapter } from "../src/server/conversation/providers/opencode.js";
import { readPersistentConversation } from "../src/server/conversation/providers/scoped.js";
import { createConversationTranscript, createMemoryConversationStorage } from "../src/server/conversation/index.js";

test("scoped reads retain each request's output when an accepted steer interrupts the earlier reply", async () => {
  const transcript = createConversationTranscript({ storage: createMemoryConversationStorage() });
  const store = Object.fromEntries(Object.entries(transcript).map(([name, operation]) =>
    [name, (scope, ...args) => operation(JSON.stringify([scope.sessionId, scope.conversationId]), ...args)]));
  store.readConversationStream = () => ({ messages: [] });
  const scope = { sessionId: "session", conversationId: "chat" };
  await store.writeConversationUserMessage(scope, { messageId: "first", text: "First request" });
  await store.writeConversationUserMessage(scope, { messageId: "second", text: "Second request" });
  const record = { conversationId: "chat", providerConversationId: "native", messageId: "second", status: "completed" };
  const observed = [];
  const options = {
    ...scope, record, context: {}, store,
    operations: { async readConversation(_sessionId, input) {
      observed.push(input.requestMessageIds);
      return { status: "completed", messages: [
        { id: "partial-first", requestMessageId: "first", role: "commentary", text: "FIRST-PARTIAL", complete: true },
        { id: "answer-second", requestMessageId: "second", role: "assistant", text: "SECOND-OK", complete: true },
        { id: "late-first", requestMessageId: "first", role: "commentary", text: "FIRST-TAIL", complete: true },
        { id: "unmatched", requestMessageId: "", role: "assistant", text: "Unmatched native input", complete: true }
      ] };
    } },
    records: { input: (record, input) => ({ ...record, ...input }), save: async (_context, record, patch) => ({ ...record, ...patch }) },
    receipts: { persisted: () => true },
    projection: { context: context => context, messageScope: (_context, scope) => scope,
      message: message => message, messageMetadata: () => ({}), snapshot: value => value },
    publish: async () => {}
  };
  await readPersistentConversation(options);
  await readPersistentConversation(options);
  const [first, second] = await store.readConversationLog(scope);
  assert.deepEqual(first.commentary.map(message => message.text), ["FIRST-PARTIAL", "FIRST-TAIL"]);
  assert.equal(first.assistant, null);
  assert.equal(second.assistant.text, "SECOND-OK");
  assert.deepEqual(second.commentary, []);
  assert.equal((await store.readConversationLog(scope)).length, 2);
  assert.deepEqual(observed, [["first", "second"], ["first", "second"]]);
});

function claudeHost() {
  let process = null;
  const launches = [], requests = [];
  const state = { active: false, fail: false, stopFails: false };
  const runtime = createClaudeConversationTurn({ conversationId: "retained-history", process: {
    getProcess: () => process, isActive: () => state.active,
    startProcess: async (input) => {
      launches.push(input);
      process = { client: { request: async (request) => {
        requests.push(request);
        if (state.fail) throw new Error("native failure");
      } } };
      return process;
    },
    stopProcess: async () => { if (state.stopFails) throw new Error("cleanup unverified"); process = null; }
  } });
  return { runtime, state, launches, requests, loseProcess: () => { process = null; } };
}
const claudeInput = { systemPrompt: "Use the calendar tools.", contextIdentity: "calendar/model-one",
  model: "one", settings: { effortLevel: "high" }, liveUpdateIdentity: "calendar-schema" };

test("saved persistent history projects receipts and pages without native observation or writes", async () => {
  const runtime = createConversationRuntime({ authorize: async () => true, host: { conversation: () => ({}) } });
  const turn = { turnId: "turn-1", user: { messageId: "user-1", attachments: [] },
    messages: [{ role: "user", messageId: "user-1", text: "Saved draft", at: "2026-01-01T00:00:00Z" }] };
  const calls = [];
  const options = {
    sessionId: "session-1", record: { conversationId: "chat-1", status: "starting", runId: "run-1", messageId: "user-1" },
    context: { actor: "owner" }, includeAccess: true, transcriptQuery: { limit: 10 },
    store: {
      async readConversationLog(scope) { calls.push(["log", scope]); return [turn]; },
      async readConversationLogPage(scope, query) { calls.push(["page", scope, query]); return { conversationLog: [turn], pagination: { more: false } }; }
    },
    operations: new Proxy({}, { get() { throw new Error("native operation must not run"); } }),
    receipts: { persisted: () => false },
    projection: {
      context: (context) => context,
      messageMetadata: () => ({}),
      async snapshot(input) { return { ...input, page: await input.readPage() }; }
    }
  };
  const result = await runtime.projectStoredPersistentConversation(options);
  assert.equal(result.includeAccess, true);
  assert.equal(result.response.status, "starting");
  assert.equal(result.messages[0].receipt, false);
  assert.equal(result.page.conversationLog[0].user.receipt, false);
  assert.deepEqual(calls.map(([kind]) => kind), ["log", "page"]);
  await runtime.close();
  await assert.rejects(runtime.projectStoredPersistentConversation(options), { code: "conversation_closed" });
});

test("a standalone Claude consumer reuses, updates and replaces processes without changing native history", async () => {
  const f = claudeHost();
  const input = { ...claudeInput, nativeId: "retained-history" };
  await Promise.all([f.runtime.prepare(input), f.runtime.prepare(input)]);
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.launches[0].instructionArguments, ["--append-system-prompt", input.systemPrompt, "--system-prompt-snapshot", "off"]);
  await f.runtime.prepare({ ...input, contextIdentity: "calendar/model-two", model: "two" });
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.requests.at(-1), { subtype: "set_model", model: "two" });
  const changed = { ...input, systemPrompt: "Use the updated calendar tools.", instructionMode: "replace" };
  await f.runtime.prepare(changed);
  assert.equal(f.launches.length, 2);
  assert.equal(f.launches[1].nativeId, "retained-history");
  assert.deepEqual(f.launches[1].instructionArguments, ["--system-prompt", changed.systemPrompt, "--system-prompt-snapshot", "off"]);
  f.loseProcess();
  await f.runtime.prepare(changed);
  assert.equal(f.launches.length, 3);
});

test("Claude rejects active prompt changes without invalidating ordinary steering", async () => {
  const f = claudeHost();
  await f.runtime.prepare(claudeInput);
  f.state.active = true;
  await assert.rejects(f.runtime.prepare({ ...claudeInput, systemPrompt: "Changed" }), /Stop the current/);
  await f.runtime.prepare(claudeInput);
  assert.equal(f.launches.length, 1);
});

test("Claude applies model and effort changes during work without restarting its process", async () => {
  const f = claudeHost();
  await f.runtime.prepare(claudeInput);
  f.state.active = true;
  await f.runtime.prepare({ ...claudeInput, contextIdentity: "calendar/model-two", model: "two",
    settings: { effortLevel: "low" } });
  assert.equal(f.state.active, true);
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.requests.slice(-2), [
    { subtype: "apply_flag_settings", settings: { effortLevel: "low" } },
    { subtype: "set_model", model: "two" }
  ]);
  await assert.rejects(f.runtime.prepare({ ...claudeInput, liveUpdateIdentity: "changed-tools" }), /Stop the current/);
});

test("Claude restarts when only the native instruction mode changes", async () => {
  const f = claudeHost();
  await f.runtime.prepare(claudeInput);
  await f.runtime.prepare({ ...claudeInput, instructionMode: "replace" });
  assert.equal(f.launches.length, 2);
  assert.deepEqual(f.launches[1].instructionArguments, ["--system-prompt", claudeInput.systemPrompt, "--system-prompt-snapshot", "off"]);
});

test("Claude does not acknowledge failed native settings or launch past failed cleanup", async () => {
  const f = claudeHost();
  f.state.fail = true;
  await assert.rejects(f.runtime.prepare(claudeInput), /native failure/);
  f.state.fail = false;
  await f.runtime.prepare(claudeInput);
  assert.equal(f.launches.length, 2);
  f.state.stopFails = true;
  await assert.rejects(f.runtime.prepare({ ...claudeInput, systemPrompt: "Updated" }), /cleanup unverified/);
  assert.equal(f.launches.length, 2);
});

function codexHost({ readInstructions } = {}) {
  const state = { status: "idle", process: "process-1", prompt: "Calendar instructions", provider: "openai", fail: false,
    environment: { TOOL_ENDPOINT: "current" } };
  const requests = [];
  const client = { isOpen: () => true, async request(method, input) {
    requests.push({ method, input });
    if (method === "thread/read") return { thread: { historyMode: "paginated", status: state.status, modelProvider: state.provider } };
    if (method === "thread/goal/get") return { goal: state.goal ? { ...state.goal } : null };
    if (method === "thread/goal/set") {
      state.goal = { ...state.goal, status: input.status, updatedAt: state.goal.updatedAt + 1 };
      return { goal: { ...state.goal } };
    }
    if (method === "thread/turns/list") return { data: [{ id: "active-turn" }] };
    if (method === "turn/interrupt") { state.status = "idle"; return {}; }
    if (method === "thread/inject_items") return {};
    if (method === "thread/loaded/list") return { data: state.status === "notLoaded" ? [] : ["native-history"] };
    if (method === "thread/unsubscribe") { state.status = "notLoaded"; return { status: "unsubscribed" }; }
    if (method === "thread/resume") {
      if (state.fail) throw new Error("resume failed");
      state.status = "idle";
      state.provider = input.modelProvider || state.provider;
      return { modelProvider: state.provider };
    }
    throw new Error(`Unexpected native request: ${method}`);
  } };
  const runtime = createCodexConversationAdapter({ client: async () => client,
    runtime: () => ({ executionId: state.process }), runRequest: (run) => run(),
    readInstructions: readInstructions || (() => state.prompt),
    prepareEnvironment: async () => ({ ...state.environment }),
    prepareHistory: async (params) => params,
    threadParameters: (params) => params,
    verifyEnvironment: async () => {},
    publishGoal: (threadId, goal) => requests.push({ method: "host.goal", input: { threadId, goal } }),
    recordInterruption: (threadId, turnId) => requests.push({ method: "host.recordInterruption", input: { threadId, turnId } }),
    prepareResume: async (id, params) => { requests.push({ method: "host.prepareResume", input: { id } }); return params; }
  });
  return { runtime, state, requests, client };
}

test("a standalone Codex consumer installs developer instructions and recovers the same thread without replay", async () => {
  const f = codexHost();
  const params = await f.runtime.prepareInstructions({ cwd: "/calendar", systemPrompt: f.state.prompt });
  assert.equal(params.developerInstructions, f.state.prompt);
  assert.equal(Object.hasOwn(params, "systemPrompt"), false);
  let sent = 0;
  const send = () => { sent += 1; };
  await f.runtime.withThreadContext("native-history", {}, send);
  assert.equal(f.requests.find(r => r.method === "thread/resume").input.developerInstructions, f.state.prompt);
  f.requests.length = 0;
  await f.runtime.withThreadContext("native-history", {}, send);
  assert.equal(f.requests.some(r => r.method === "thread/resume"), false);
  assert.equal(f.requests.some(r => r.method === "thread/inject_items"), false);
  f.state.prompt = "Changed calendar instructions";
  await f.runtime.withThreadContext("native-history", {}, send);
  assert.equal(f.requests.find(r => r.method === "thread/resume").input.threadId, "native-history");
  const revision = f.requests.find(r => r.method === "thread/inject_items").input.items[0];
  assert.equal(revision.role, "developer");
  assert.match(revision.content[0].text, /Changed calendar instructions/);
  assert.equal(sent, 3);
  f.state.fail = true;
  f.state.prompt = "Unavailable installation";
  await assert.rejects(f.runtime.withThreadContext("native-history", {}, send), /could not be verified/);
  assert.equal(sent, 3);
  assert.equal(f.runtime.bindingCount, 0);
  f.state.fail = false;
  await f.runtime.withThreadContext("native-history", {}, () => { sent += 1; throw new Error("ambiguous send"); }).catch(error => {
    assert.match(error.message, /ambiguous send/);
  });
  assert.equal(sent, 4, "an uncertain caller operation is never replayed");
});

test("Codex refreshes restricted persistent conversations without importing host execution resources", async () => {
  const f = codexHost();
  const params = f.runtime.threadParameters({
    ...(await f.runtime.prepareInstructions({ systemPrompt: f.state.prompt })),
    config: { shell_environment_policy: { inherit: "none", set: {} } }
  }, {});
  f.runtime.registerThread("restricted", { client: f.client, params, managed: false });
  await f.runtime.withThreadContext("restricted", {}, () => {});
  assert.equal(f.requests.some(r => r.method === "thread/resume"), false);
  f.state.prompt = "Updated restricted instructions";
  await f.runtime.withThreadContext("restricted", {}, () => {});
  const resumed = f.requests.find(r => r.method === "thread/resume").input;
  assert.equal(resumed.developerInstructions, f.state.prompt);
  assert.equal(resumed.config.shell_environment_policy.set.TOOL_ENDPOINT, undefined);
  assert.deepEqual(Object.keys(resumed.config.shell_environment_policy.set), ["JSKIT_CONVERSATION_INSTRUCTIONS"]);
});

test("Codex distinguishes native process replacement from a retained loaded thread", async () => {
  const f = codexHost();
  await f.runtime.withThreadContext("history", {}, () => {});
  f.requests.length = 0;
  f.state.process = "process-2";
  f.state.status = "notLoaded";
  await f.runtime.withThreadContext("history", {}, () => {});
  assert.equal(f.requests.filter(r => r.method === "host.prepareResume").length, 1);
  assert.equal(f.requests.filter(r => r.method === "thread/resume").length, 1);
});

test("OpenCode restores current system instructions after compaction, changes and failed reads", async () => {
  let version = "one", reads = 0, fail = false;
  const runtime = createOpenCodeConversationAdapter({ resolveInstructions: async (id) => id === "unknown" ? null : ({
    identity: version, placement: "replace", read: async () => { reads += 1; if (fail) throw new Error("owner unavailable"); return `Calendar ${version}`; }
  }) });
  const output = { system: ["Native defaults"] };
  await runtime.transformSystem({ sessionID: "calendar" }, output);
  await runtime.transformSystem({ sessionID: "calendar" }, output);
  assert.equal(reads, 1);
  assert.deepEqual(output.system, ["Calendar one"]);
  version = "two";
  await runtime.transformSystem({ sessionID: "calendar" }, output);
  assert.deepEqual(output.system, ["Calendar two"]);
  runtime.event({ event: { type: "session.compacted", properties: { sessionID: "calendar" } } });
  fail = true;
  await assert.rejects(runtime.transformSystem({ sessionID: "calendar" }, output), /owner unavailable/);
  fail = false;
  await runtime.transformSystem({ sessionID: "calendar" }, output);
  assert.equal(reads, 4);
  const standalone = { system: ["Standalone guidance"] };
  await runtime.transformSystem({ sessionID: "unknown" }, standalone);
  assert.deepEqual(standalone.system, ["Standalone guidance"]);
});

test("OpenCode rereads unversioned instructions before each inference without duplicate contributions", async () => {
  let text = "Initial project guidance", reads = 0;
  const runtime = createOpenCodeConversationAdapter({ resolveInstructions: () => ({
    read: () => { reads += 1; return text; }
  }) });
  const output = { system: ["Native defaults"] };
  await runtime.transformSystem({ sessionID: "project" }, output);
  text = "Changed project guidance";
  await runtime.transformSystem({ sessionID: "project" }, output);
  assert.equal(reads, 2);
  assert.deepEqual(output.system, ["Native defaults", text]);
});

test("hook delivery distinguishes unclaimed sessions, native placement and a missing declared owner", async () => {
  let prompt = "Complete project and application instructions";
  const deliver = createConversationHookBridge({
    resolveConversation: async ({ providerSessionId }) => providerSessionId === "standalone" ? null : {
      delivery: providerSessionId === "native" ? "native" : "hook"
    },
    readInstructions: async () => { if (!prompt) throw new Error("owner unavailable"); return prompt; }
  });
  assert.deepEqual(await deliver({ scope: "session", providerSessionId: "standalone" }), { kind: "unclaimed" });
  assert.deepEqual(await deliver({ scope: "session", providerSessionId: "native" }), { kind: "delivery", text: "" });
  assert.deepEqual(await deliver({ scope: "session", providerSessionId: "managed" }), { kind: "delivery", text: prompt });
  prompt = "Refreshed at compaction";
  assert.equal((await deliver({ scope: "session", providerSessionId: "managed" })).text, prompt);
  prompt = "";
  await assert.rejects(deliver({ scope: "session", providerSessionId: "managed" }), /owner unavailable/);
  const native = createConversationHookBridge({ resolveConversation: () => ({ delivery: "native" }) });
  assert.deepEqual(await native({ scope: "session" }), { kind: "delivery", text: "" });
  const missing = createConversationHookBridge({ resolveConversation: () => ({ delivery: "hook" }) });
  await assert.rejects(missing({ scope: "session" }), /instruction resolver/);
});

test("OpenCode retries invalid content and rejects an invalidated in-flight read", async () => {
  let content = " ";
  let release;
  const runtime = createOpenCodeConversationAdapter({ resolveInstructions: async () => ({
    identity: "same-source", read: () => content === "pending" ? new Promise(resolve => { release = resolve; }) : content
  }) });
  await assert.rejects(runtime.transformSystem({ sessionID: "one" }, { system: [] }), /must contain text/);
  content = "Current instructions";
  const output = { system: [] };
  await runtime.transformSystem({ sessionID: "one" }, output);
  assert.deepEqual(output.system, [content]);
  content = "pending";
  const inFlight = runtime.transformSystem({ sessionID: "two" }, { system: [] });
  await new Promise(resolve => setImmediate(resolve));
  runtime.invalidate("two");
  release("Obsolete instructions");
  await assert.rejects(inFlight, /context changed while reading/);
});

test("Codex keeps active installed instructions through source changes, deletion and restoration", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-instructions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "instructions.md");
  const original = "Original project and application instructions";
  await writeFile(file, original);
  let reads = 0;
  const f = codexHost({ readInstructions: () => { reads += 1; return readFile(file, "utf8"); } });
  await f.runtime.withThreadContext("native-history", {}, () => {});
  const installed = f.runtime.threadEnvironments.get("native-history");
  const revision = installed.params.config.shell_environment_policy.set.JSKIT_CONVERSATION_INSTRUCTIONS;
  const initialReads = reads;
  f.requests.length = 0;
  f.state.status = "active";
  let operations = 0;
  for (const content of ["A temporarily changed reference", null, original]) {
    if (content === null) await rm(file);
    else await writeFile(file, content);
    await f.runtime.withThreadContext("native-history", {}, params => {
      operations += 1;
      assert.equal(params.developerInstructions, original);
      assert.equal(params.config.shell_environment_policy.set.JSKIT_CONVERSATION_INSTRUCTIONS, revision);
    });
  }
  assert.equal(operations, 3);
  assert.equal(reads, initialReads, "A healthy active observation must not reread an unavailable prompt source");
  assert.equal(f.runtime.threadEnvironments.get("native-history"), installed);
  assert.equal(f.requests.some(request => ["turn/interrupt", "thread/unsubscribe", "thread/resume", "thread/inject_items"].includes(request.method)), false);
  assert.equal(f.requests.filter(request => request.method === "thread/read").length, 3, "Native status and current controls are still checked");
  await writeFile(file, "Latest restored application instructions");
  f.state.status = "idle";
  await f.runtime.withThreadContext("native-history", {}, params => {
    assert.equal(params.developerInstructions, "Latest restored application instructions");
  });
  assert.equal(reads, initialReads + 1, "The safe admission rereads the source rather than using a queued stale value");
  assert.equal(f.requests.find(request => request.method === "thread/resume").input.threadId, "native-history");
  assert.equal(f.requests.filter(request => request.method === "thread/inject_items").length, 1);
  assert.match(f.requests.find(request => request.method === "thread/inject_items").input.items[0].content[0].text, /Latest restored application instructions/);
  assert.equal(f.runtime.threadEnvironments.get("native-history").client, f.client);
});

test("Codex defers explicit instruction changes while active but installs them at idle admission", async () => {
  const f = codexHost();
  await f.runtime.withThreadContext("native-history", {}, () => {});
  f.requests.length = 0;
  f.state.status = "active";
  const changed = { systemPrompt: "Explicit new application instructions" };
  await f.runtime.withThreadContext("native-history", changed, params => {
    assert.equal(params.developerInstructions, "Calendar instructions");
  });
  assert.equal(f.requests.some(request => request.method === "turn/interrupt" || request.method === "thread/resume"), false);
  f.state.status = "idle";
  await f.runtime.withThreadContext("native-history", changed, params => {
    assert.equal(params.developerInstructions, changed.systemPrompt);
  });
  assert.equal(f.requests.filter(request => request.method === "thread/inject_items").length, 1);
});

test("Codex still recovers real active control changes with current instructions and an exact interruption cause", async () => {
  const f = codexHost();
  await f.runtime.withThreadContext("native-history", {}, () => {});
  f.requests.length = 0;
  f.state.status = "active";
  f.state.prompt = "Current instructions after a real control change";
  f.state.environment.TOOL_ENDPOINT = "replacement";
  await f.runtime.withThreadContext("native-history", {}, params => {
    assert.equal(params.developerInstructions, f.state.prompt);
    assert.equal(params.config.shell_environment_policy.set.TOOL_ENDPOINT, "replacement");
  });
  const interrupt = f.requests.findIndex(request => request.method === "turn/interrupt");
  assert.deepEqual(f.requests[interrupt - 1], { method: "host.recordInterruption", input: { threadId: "native-history", turnId: "active-turn" } });
  assert.deepEqual(f.requests[interrupt].input, { threadId: "native-history", turnId: "active-turn" });
  assert.equal(f.requests.filter(request => request.method === "thread/resume").length, 1);
  assert.equal(f.requests.filter(request => request.method === "thread/inject_items").length, 1);
});

test("Codex does not reinstall a closed binding after an idle instruction read settles", async () => {
  const reading = Promise.withResolvers();
  const instructions = Promise.withResolvers();
  let pending = false;
  const f = codexHost({ readInstructions: () => {
    if (!pending) return "Initial instructions";
    reading.resolve();
    return instructions.promise;
  } });
  await f.runtime.withThreadContext("native-history", {}, () => {});
  pending = true;
  let operations = 0;
  const refresh = f.runtime.withThreadContext("native-history", {}, () => { operations += 1; });
  await reading.promise;
  f.requests.length = 0;
  f.runtime.close();
  instructions.resolve("Late instructions after close");
  await assert.rejects(refresh, /could not be verified/);
  assert.equal(operations, 0);
  assert.equal(f.runtime.bindingCount, 0);
  assert.deepEqual(f.requests, [], "A retired instruction refresh cannot issue native recovery commands");
});

test("Codex defers an instruction-only refresh when native work starts during the prompt read", async () => {
  const reading = Promise.withResolvers();
  const instructions = Promise.withResolvers();
  let pending = false;
  const f = codexHost({ readInstructions: () => {
    if (!pending) return "Installed instructions";
    reading.resolve();
    return instructions.promise;
  } });
  await f.runtime.withThreadContext("native-history", {}, () => {});
  const installed = f.runtime.threadEnvironments.get("native-history");
  f.requests.length = 0;
  pending = true;
  let operations = 0;
  const refresh = f.runtime.withThreadContext("native-history", {}, params => {
    operations += 1;
    assert.equal(params.developerInstructions, installed.params.developerInstructions);
    assert.deepEqual(params.config.shell_environment_policy, installed.params.config.shell_environment_policy);
  });
  await reading.promise;
  f.state.status = "active";
  instructions.resolve("Instructions composed after native work began");
  await refresh;
  assert.equal(operations, 1);
  assert.equal(f.runtime.threadEnvironments.get("native-history"), installed);
  assert.equal(f.requests.filter(request => request.method === "thread/read").length, 2);
  assert.equal(f.requests.some(request => ["thread/goal/get", "turn/interrupt", "thread/unsubscribe", "thread/resume", "thread/inject_items"].includes(request.method)), false);
});

test("Codex never interrupts a late active turn for instructions and restores its paused goal", async () => {
  const f = codexHost();
  await f.runtime.withThreadContext("native-history", {}, () => {});
  const installed = f.runtime.threadEnvironments.get("native-history");
  f.requests.length = 0;
  f.state.prompt = "New instructions for a later admission";
  let goal = { status: "active", createdAt: 1, updatedAt: 1, objective: "Continue the same task" };
  const originalRequest = f.client.request;
  f.client.request = async (method, input) => {
    if (method === "thread/goal/get") {
      f.requests.push({ method, input });
      return { goal: { ...goal } };
    }
    if (method === "thread/goal/set") {
      f.requests.push({ method, input });
      goal = { ...goal, status: input.status, updatedAt: goal.updatedAt + 1 };
      if (input.status === "paused") f.state.status = "active";
      return { goal: { ...goal } };
    }
    return originalRequest(method, input);
  };
  let operations = 0;
  await f.runtime.withThreadContext("native-history", {}, params => {
    operations += 1;
    assert.equal(params.developerInstructions, installed.params.developerInstructions);
    assert.deepEqual(params.config.shell_environment_policy, installed.params.config.shell_environment_policy);
  });
  assert.equal(operations, 1);
  assert.equal(f.runtime.threadEnvironments.get("native-history"), installed);
  assert.deepEqual(f.requests.filter(request => request.method === "thread/goal/set").map(request => request.input.status), ["paused", "active"]);
  assert.equal(goal.status, "active");
  assert.equal(f.requests.some(request => ["host.recordInterruption", "turn/interrupt", "thread/unsubscribe", "thread/resume", "thread/inject_items"].includes(request.method)), false);
});


test("Codex excludes deferred instruction composition without replenishing spent native-control time", async t => {
  for (const mode of ["idle", "became active", "native timed out", "native refused", "binding closed", "budget exhausted before composition"]) {
    await t.test(mode, async t => {
      let now = 0;
      const deadlines = [];
      t.mock.method(performance, "now", () => now);
      t.mock.method(AbortSignal, "timeout", duration => {
        const controller = new AbortController();
        deadlines.push({ duration, due: now + duration, controller });
        return controller.signal;
      });
      const advance = duration => {
        now += duration;
        for (const deadline of deadlines) {
          if (deadline.due <= now && !deadline.controller.signal.aborted) {
            deadline.controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
          }
        }
      };
      let refresh = false, instructionReads = 0;
      const f = codexHost({ readInstructions: () => {
        instructionReads += 1;
        if (!refresh) return "Installed project instructions";
        advance(15_000);
        if (mode === "became active") f.state.status = "active";
        if (mode === "binding closed") f.runtime.close();
        return "Fresh composed project instructions";
      } });
      await f.runtime.withThreadContext("native-history", {}, () => {});
      const installed = f.runtime.threadEnvironments.get("native-history");
      f.requests.length = 0;
      const request = f.client.request;
      let statusReads = 0;
      f.client.request = async (method, input, options) => {
        if (method === "thread/read") {
          statusReads += 1;
          if (statusReads === 1) {
            if (mode === "budget exhausted before composition") now += 10_000;
            else advance(2_500);
          }
          if (statusReads === 2 && mode === "native timed out") {
            advance(7_501);
            options.signal.throwIfAborted();
          }
          if (statusReads === 2 && mode === "native refused") throw new Error("Native read refused");
        }
        options.signal.throwIfAborted();
        return request(method, input, options);
      };
      refresh = true;
      let operations = 0;
      const operation = f.runtime.withThreadContext("native-history", {}, params => {
        operations += 1;
        assert.equal(params.developerInstructions, mode === "became active"
          ? installed.params.developerInstructions : "Fresh composed project instructions");
      });
      if (mode === "budget exhausted before composition") {
        await assert.rejects(operation, { name: "TimeoutError" });
        assert.equal(instructionReads, 1, "An exhausted native budget cannot begin deferred composition");
        assert.equal(operations, 0);
        assert.equal(statusReads, 1);
      } else if (["native timed out", "native refused"].includes(mode)) {
        await assert.rejects(operation, error => {
          assert.match(error.message, /could not be verified/);
          assert.equal(error.cause.name, mode === "native timed out" ? "TimeoutError" : "Error");
          return true;
        });
        assert.equal(operations, 0);
        assert.equal(f.runtime.bindingCount, 0);
      } else if (mode === "binding closed") {
        await assert.rejects(operation, error => {
          assert.match(error.message, /could not be verified/);
          assert.match(error.cause.message, /closed during recovery/);
          return true;
        });
        assert.equal(operations, 0);
        assert.equal(statusReads, 1, "Retired instructions cannot issue a later native request");
      } else {
        await operation;
        assert.equal(operations, 1);
        if (mode === "became active") {
          assert.equal(f.runtime.threadEnvironments.get("native-history"), installed);
          assert.equal(f.requests.some(r => ["thread/goal/get", "turn/interrupt", "thread/unsubscribe", "thread/resume", "thread/inject_items"].includes(r.method)), false);
        } else {
          assert.equal(f.requests.filter(r => r.method === "thread/inject_items").length, 1);
        }
      }
      assert.deepEqual(deadlines.map(deadline => deadline.duration), mode === "budget exhausted before composition"
        ? [10_000, 10_000] : [10_000, 10_000, 7_500],
        "Only host composition is excluded; the 2.5 seconds already spent are not replenished");
    });
  }
});


for (const action of ["continue", "pause", "cancel", "complete", "close", "invalidate", "failure"]) {
  test(`next-turn Codex provider settings preserve the current turn and ${action}`, async () => {
    const f = codexHost();
    const id = "native-history";
    await f.runtime.withThreadContext(id, { modelProvider: "openai" }, () => {});
    f.requests.length = 0;
    f.state.status = "active";
    f.state.goal = { status: "active", createdAt: 1, updatedAt: 1, objective: "Finish the same goal", tokenBudget: 100, tokensUsed: 40 };
    const applied = [];
    const update = params => { applied.push(params.model); return { ok: true }; };
    const first = { modelProvider: "deepseek", model: "first", config: { "model_providers.deepseek": { base_url: "https://example.test" } } };
    assert.deepEqual(await f.runtime.scheduleSettings(id, first, update), { ok: true, pending: true });
    const task = f.runtime.threadEnvironmentTasks.get(id);
    assert.equal(f.state.goal.status, "paused");
    assert.equal(f.runtime.projectGoal(id, f.state.goal).status, "active", "An internal scheduling hold is not a user Pause");
    assert.equal(f.requests.some(r => ["turn/interrupt", "thread/resume", "thread/unsubscribe"].includes(r.method)), false);
    assert.deepEqual(await f.runtime.scheduleSettings(id, { ...first, model: "latest" }, update), { ok: true, pending: true });
    if (["pause", "cancel"].includes(action)) f.runtime.goalChanged(id);
    if (action === "pause") f.state.goal = { ...f.state.goal, status: "paused", updatedAt: 3 };
    if (action === "cancel") f.state.goal = null;
    if (action === "complete") f.state.goal = { ...f.state.goal, status: "complete", updatedAt: 3 };
    if (action === "failure") f.state.fail = true;
    if (action === "close") f.runtime.close();
    if (action === "invalidate") f.runtime.invalidateThread(id);
    f.state.status = "idle";
    if (["close", "invalidate", "failure"].includes(action)) {
      await assert.rejects(task);
      assert.deepEqual(applied, []);
      assert.equal(f.runtime.projectGoal(id, f.state.goal).status, "paused");
    } else {
      await task;
      assert.deepEqual(applied, ["latest"]);
      assert.equal(f.state.provider, "deepseek");
      assert.equal(f.state.goal?.status || null, { continue: "active", pause: "paused", cancel: null, complete: "complete" }[action]);
      if (f.state.goal) for (const [key, value] of Object.entries({ createdAt: 1, objective: "Finish the same goal", tokenBudget: 100, tokensUsed: 40 })) {
        assert.equal(f.state.goal[key], value);
      }
    }
    assert.equal(f.requests.some(r => r.method === "turn/interrupt"), false);
    f.runtime.close();
  });
}

test("a settings save during Codex reload replaces the older choice before its goal resumes", async () => {
  const f = codexHost();
  const id = "native-history";
  await f.runtime.withThreadContext(id, { modelProvider: "openai" }, () => {});
  f.state.goal = { status: "active", createdAt: 1, updatedAt: 1, objective: "Continue" };
  const params = { modelProvider: "deepseek", model: "first" };
  const applied = [];
  await f.runtime.scheduleSettings(id, params, async selected => {
    applied.push(selected.model);
    if (selected.model === "first") {
      void f.runtime.scheduleSettings(id, { ...params, model: "latest" }, () => assert.fail("The retained owner handles later saves"));
    }
    assert.equal(f.state.goal.status, "paused");
  });
  assert.deepEqual(applied, ["first", "latest"]);
  assert.equal(f.state.goal.status, "active");
  assert.equal(f.requests.filter(r => r.method === "thread/goal/set" && r.input.status === "active").length, 1);
  f.runtime.close();
});

test("Codex retains settings saved during goal resume acknowledgement and after completion", async () => {
  const f = codexHost();
  const id = "native-history";
  await f.runtime.withThreadContext(id, { modelProvider: "openai" }, () => {});
  f.state.goal = { status: "active", createdAt: 1, updatedAt: 1, objective: "Continue" };
  const params = { modelProvider: "deepseek", model: "first" };
  const applied = [];
  const update = selected => { applied.push(selected.model); };
  const request = f.client.request.bind(f.client);
  let savedDuringResume = false;
  f.client.request = async (method, input) => {
    const result = await request(method, input);
    if (method === "thread/goal/set" && input.status === "active" && !savedDuringResume) {
      savedDuringResume = true;
      void f.runtime.scheduleSettings(id, { ...params, model: "during-resume" }, update);
    }
    return result;
  };
  await f.runtime.scheduleSettings(id, params, update);
  assert.deepEqual(applied, ["first", "during-resume"]);
  assert.equal(f.runtime.hasPendingSettings(id), false);
  await f.runtime.scheduleSettings(id, { ...params, model: "after-completion" }, update);
  assert.deepEqual(applied, ["first", "during-resume", "after-completion"]);
  assert.equal(f.state.goal.status, "active");
  assert.equal(f.requests.some(r => r.method === "turn/interrupt"), false);
  f.runtime.close();
});

test("a user Pause during the final goal read prevents automatic settings recovery from resuming it", async () => {
  const f = codexHost();
  const id = "native-history";
  await f.runtime.withThreadContext(id, { modelProvider: "openai" }, () => {});
  f.state.goal = { status: "active", createdAt: 1, updatedAt: 1, objective: "Continue" };
  const request = f.client.request.bind(f.client);
  let settingsApplied = false;
  f.client.request = async (method, input) => {
    const result = await request(method, input);
    if (method === "thread/goal/get" && settingsApplied) {
      f.runtime.goalChanged(id);
      f.state.goal = { ...f.state.goal, status: "paused", updatedAt: f.state.goal.updatedAt + 1 };
    }
    return result;
  };
  await f.runtime.scheduleSettings(id, { modelProvider: "deepseek", model: "next" }, () => { settingsApplied = true; });
  assert.equal(f.state.goal.status, "paused");
  assert.equal(f.requests.some(r => r.method === "thread/goal/set" && r.input.status === "active"), false);
  f.runtime.close();
});

test("a deleted logical conversation retires its open entry without opening another", async () => {
  const opened = [];
  const binding = namespace => ({
    sessionId: "session", namespace, engine: "claude",
    read: async () => ({ engine: "claude", conversationLog: [], status: "ready" }),
    readStream: async () => ({ messages: [] }),
    commands: { send: async () => ({ status: "accepted" }), cancel: async () => ({ ok: true }),
      select: async () => ({ ok: true }), inspectDelivery: async () => ({ status: "unknown" }) }
  });
  const runtime = createConversationRuntime({ authorize: () => true,
    host: { conversation: ({ context }) => { opened.push(context.chat); return binding(`temporary-${context.chat}`); } } });
  try {
    const handle = await runtime.open({ id: "session", context: { chat: "one" } });
    await handle.subscribe(() => {});
    assert.deepEqual(await runtime.retireOpenConversation({ namespace: "temporary-one", sessionId: "session" }), { retired: true });
    await assert.rejects(handle.read(), { code: "conversation_closed" });
    await assert.rejects(handle.subscribe(() => {}), { code: "conversation_closed" });
    assert.deepEqual(await runtime.retireOpenConversation({ namespace: "temporary-one", sessionId: "session" }), { retired: false },
      "an absent entry is already retired; nothing is opened to retire it");
    assert.deepEqual(await runtime.retireOpenConversation({ namespace: "temporary-two", sessionId: "session" }), { retired: false });
    assert.deepEqual(opened, ["one"]);
    const reopened = await runtime.open({ id: "session", context: { chat: "one" } });
    assert.equal((await reopened.read()).status, "ready", "a later open starts a fresh entry");
  } finally {
    await runtime.close();
  }
});
