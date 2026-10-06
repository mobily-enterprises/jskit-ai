import assert from "node:assert/strict";
import test from "node:test";
import { createConversationHookBridge } from "../src/server/conversation/index.js";
import { createClaudeConversationTurn } from "../src/server/conversation/claudeTurn.js";
import { createCodexConversationAdapter } from "../src/server/conversation/providers/codex.js";
import { createOpenCodeConversationAdapter } from "../src/server/conversation/providers/opencode.js";

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

function codexHost() {
  const state = { status: "idle", process: "process-1", prompt: "Calendar instructions", provider: "openai", fail: false };
  const requests = [];
  const client = { async request(method, input) {
    requests.push({ method, input });
    if (method === "thread/read") return { thread: { historyMode: "paginated", status: state.status, modelProvider: state.provider } };
    if (method === "thread/goal/get") return { goal: null };
    if (method === "thread/inject_items") return {};
    if (method === "thread/loaded/list") return { data: state.status === "notLoaded" ? [] : ["native-history"] };
    if (method === "thread/unsubscribe") { state.status = "notLoaded"; return { status: "unsubscribed" }; }
    if (method === "thread/resume") {
      if (state.fail) throw new Error("resume failed");
      state.status = "idle";
      return { modelProvider: input.modelProvider || state.provider };
    }
    throw new Error(`Unexpected native request: ${method}`);
  } };
  const runtime = createCodexConversationAdapter({ client: async () => client,
    runtime: () => ({ executionId: state.process }), runRequest: (run) => run(),
    readInstructions: () => state.prompt,
    prepareEnvironment: async () => ({ TOOL_ENDPOINT: "current" }),
    prepareHistory: async (params) => params,
    threadParameters: (params) => params,
    verifyEnvironment: async () => {},
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
