import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createOpenCodeToolBridge } from "../src/server/conversation/openCodeTools.js";
import conversationInstructions from "../src/server/conversation/openCodePlugin.js";
import { createOpenCodeSharedRuntime } from "../src/server/conversation/openCodeRuntime.js";
import { openCodeConversationAgents } from "../src/server/conversation/openCodeProcess.js";

test("native OpenCode tools and shell environment require the bound conversation's host grant", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-native-tools-"));
  const file = path.join(directory, "instructions.json");
  const names = ["JSKIT_OPENCODE_ENV_REGISTRY"];
  const previous = names.map(name => process.env[name]);
  t.after(async () => {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    await rm(directory, { recursive: true, force: true });
  });
  process.env.JSKIT_OPENCODE_ENV_REGISTRY = file;
  const binding = { upstreamSessionId: "owned", env: { PROJECT_VALUE: "application-owned" },
    conversation: { nativeTools: true, systemPrompt: "Current instructions" } };
  await writeFile(file, JSON.stringify({ sessions: [binding] }));
  const plugin = await conversationInstructions();
  await plugin["tool.execute.before"]({ sessionID: "owned", tool: "bash" });
  const output = { env: {} };
  await plugin["shell.env"]({ sessionID: "owned" }, output);
  assert.deepEqual(output.env, { PROJECT_VALUE: "application-owned" });
  await assert.rejects(plugin["tool.execute.before"]({ sessionID: "foreign", tool: "bash" }), /no instruction owner/);
  await assert.rejects(plugin["shell.env"]({ sessionID: "foreign" }, { env: {} }), /no instruction owner/);
  binding.conversation.nativeTools = false;
  await writeFile(file, JSON.stringify({ sessions: [binding] }));
  await assert.rejects(plugin["tool.execute.before"]({ sessionID: "owned", tool: "bash" }), /no authorization/);
  const revoked = { env: {} };
  await plugin["shell.env"]({ sessionID: "owned" }, revoked);
  assert.deepEqual(revoked.env, {});
});

test("the native tool connection requires its private credential and bounds incoming arguments", async t => {
  const calls = [];
  const bridge = await createOpenCodeToolBridge({ schemas: [], maxArgumentBytes: 16,
    execute: async value => { calls.push(value); return { ok: true }; } });
  t.after(() => bridge.close());
  const { url, token } = bridge.configuration;
  const request = { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: '{}' };
  assert.equal((await fetch(url, { ...request, headers: { "content-type": "application/json" } })).status, 403);
  assert.equal((await fetch(url, { ...request, headers: { ...request.headers, origin: "https://another.invalid" } })).status, 403);
  assert.equal((await fetch(url, { ...request, body: "{" })).status, 400);
  const tooLarge = await fetch(url, { ...request, body: '"' + "x".repeat(5000) + '"' });
  assert.equal(tooLarge.status, 400);
  assert.match((await tooLarge.json()).error, /size limit/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await (await fetch(url, request)).json(), { ok: true });
  assert.deepEqual(calls, [{}]);
});

test("native plugin definitions retain exact schemas and native identity without enabling built-in tools", async t => {
  const schema = { type: "object", properties: { query: { type: "string" } }, additionalProperties: false };
  const calls = [];
  const bridge = await createOpenCodeToolBridge({ schemas: [{ type: "function", function: {
    name: "assistant_action_search", description: "Search operations", parameters: schema
  } }], maxArgumentBytes: 1024, execute: async value => { calls.push(value); return { ok: true, result: [] }; } });
  t.after(() => bridge.close());
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-opencode-tool-binding-"));
  const file = path.join(directory, "environments.json");
  const names = ["JSKIT_OPENCODE_ENV_REGISTRY", "JSKIT_OPENCODE_TOOL_SCHEMAS"];
  const previous = names.map(name => process.env[name]);
  process.env.JSKIT_OPENCODE_ENV_REGISTRY = file;
  process.env.JSKIT_OPENCODE_TOOL_SCHEMAS = JSON.stringify(bridge.configuration.schemas);
  await writeFile(file, JSON.stringify({ sessions: [{ upstreamSessionId: "session",
    conversation: { tools: bridge.configuration, nativeTools: false } }] }));
  t.after(async () => {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    await rm(directory, { recursive: true, force: true });
  });
  const plugin = await conversationInstructions();
  const output = {};
  plugin["tool.definition"]({ toolID: "assistant_action_search" }, output);
  assert.deepEqual(output.jsonSchema, schema);
  await assert.rejects(plugin["tool.execute.before"]({ tool: "bash", sessionID: "session" }), /no authorization/);
  const tool = plugin.tool.assistant_action_search;
  await assert.rejects(tool.execute({}, { sessionID: "session", messageID: "message" }), /tool identity/);
  assert.equal(await tool.execute({}, { sessionID: "session", messageID: "message", callID: "call", abort: new AbortController().signal }),
    '{"ok":true,"result":[]}');
  assert.deepEqual(calls, [{ sessionId: "session", messageId: "message", id: "call", name: "assistant_action_search", input: {} }]);
});

test("closing the private connection aborts native work and waits for the invoked operation", async () => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  let signal;
  const bridge = await createOpenCodeToolBridge({ schemas: [], maxArgumentBytes: 1024,
    async execute(_input, incoming) { signal = incoming; entered.resolve(); return complete.promise; } });
  const { url, token } = bridge.configuration;
  const request = fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: '{}' });
  const rejected = assert.rejects(request, /fetch failed/);
  await entered.promise;
  let stopped = false;
  const stopping = bridge.close().then(() => { stopped = true; });
  try {
    assert.equal(signal.aborted, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, false);
  } finally { complete.resolve({ ok: true }); await stopping; }
  await rejected;
  await assert.rejects(fetch(url), /fetch failed/);
});

test("one native plugin routes current instructions, command policy and tools by registered conversation", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-opencode-shared-plugin-"));
  const registry = path.join(directory, "environments.json");
  const names = ["JSKIT_OPENCODE_ENV_REGISTRY", "JSKIT_OPENCODE_TOOL_SCHEMAS"];
  const previous = names.map(name => process.env[name]);
  t.after(async () => {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
    await rm(directory, { recursive: true, force: true });
  });
  const schemas = [{ type: "function", function: { name: "assistant_action_search", description: "Search",
    parameters: { type: "object", properties: { query: { type: "string" } } } } }];
  process.env.JSKIT_OPENCODE_ENV_REGISTRY = registry;
  process.env.JSKIT_OPENCODE_TOOL_SCHEMAS = JSON.stringify(schemas);
  const owner = createOpenCodeSharedRuntime();
  const calls = [];
  const bindings = [];
  for (const id of ["first", "second"]) {
    const bridge = await createOpenCodeToolBridge({ schemas, maxArgumentBytes: 1024,
      execute: async input => { calls.push({ owner: id, ...input }); return { owner: id }; } });
    t.after(() => bridge.close());
    bindings.push({ upstreamSessionId: id, workdir: path.join(directory, id), env: { OWNER: id },
      conversation: { systemPrompt: `${id} instructions`, nativeTools: id === "first",
        commandWrapper: `/host/${id}`, tools: bridge.configuration } });
  }
  const [first, second] = bindings;
  await owner.writeBindings(registry, "first", [first]);
  const plugin = await conversationInstructions({ client: { session: { get: async ({ path: { id } }) => ({
    data: { parentID: id === "child" ? "second" : "" }
  }) } } });
  const firstSystem = { system: ["native default"] };
  await plugin["experimental.chat.system.transform"]({ sessionID: "first" }, firstSystem);
  assert.deepEqual(firstSystem.system, ["first instructions"]);
  await owner.writeBindings(registry, "second", [second]);
  const secondSystem = { system: ["native default"] };
  await plugin["experimental.chat.system.transform"]({ sessionID: "child" }, secondSystem);
  assert.deepEqual(secondSystem.system, ["second instructions"]);
  for (const id of ["first", "second"]) {
    await plugin["tool.execute.before"]({ tool: "assistant_action_search", sessionID: id });
    assert.deepEqual(JSON.parse(await plugin.tool.assistant_action_search.execute({ query: id }, {
      sessionID: id, messageID: `message-${id}`, callID: `call-${id}`, abort: new AbortController().signal
    })), { owner: id });
  }
  assert.deepEqual(calls, ["first", "second"].map(id => ({ owner: id, sessionId: id,
    messageId: `message-${id}`, id: `call-${id}`, name: "assistant_action_search", input: { query: id } })));
  const command = { args: { command: "pwd" } };
  await plugin["tool.execute.before"]({ tool: "bash", sessionID: "first" }, command);
  assert.equal(command.args.command, "'/host/first' 'pwd'");
  await assert.rejects(plugin["tool.execute.before"]({ tool: "bash", sessionID: "second" }, { args: { command: "pwd" } }), /no authorization/);
  const environment = { env: {} };
  await plugin["shell.env"]({ cwd: first.workdir }, environment);
  assert.deepEqual(environment.env, { OWNER: "first" });
  const ungranted = { env: {} };
  await plugin["shell.env"]({ sessionID: "second" }, ungranted);
  assert.deepEqual(ungranted.env, {});
  first.conversation.systemPrompt = "updated first instructions";
  await owner.writeBindings(registry, "first", [first]);
  await plugin["experimental.chat.system.transform"]({ sessionID: "first" }, firstSystem);
  assert.deepEqual(firstSystem.system, ["updated first instructions"]);
  delete second.conversation.tools;
  await owner.writeBindings(registry, "second", [second]);
  await assert.rejects(plugin.tool.assistant_action_search.execute({}, {
    sessionID: "second", messageID: "later", callID: "later", abort: new AbortController().signal
  }), /no authorization/);
  await owner.writeBindings(registry, "first", []);
  await assert.rejects(plugin["experimental.chat.system.transform"]({ sessionID: "first" }, { system: [] }), /no instruction owner/);
  await plugin["experimental.chat.system.transform"]({ sessionID: "second" }, secondSystem);
  assert.deepEqual(secondSystem.system, ["second instructions"]);
  assert.equal(calls.length, 2);
});

test("the shared plugin retains host instruction routing, repeated resolution and compaction invalidation", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-opencode-host-instructions-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = path.join(directory, "environments.json");
  await writeFile(registry, JSON.stringify({ sessions: [{ upstreamSessionId: "shared",
    conversation: { systemPrompt: "Native instructions from the captured registry" } }] }));
  let route = "host", revision = "first", reads = 0, changeDuringSelection = false;
  const resolutions = [];
  const plugin = await conversationInstructions({ registryPath: registry,
    async resolveHostInstructions(id) {
      resolutions.push(id);
      const selectedRoute = route;
      const selectedRevision = revision;
      if (changeDuringSelection) {
        changeDuringSelection = false;
        route = "native";
        revision = "changed between reads";
      }
      return {
        conversation: selectedRoute === "native" ? { systemPrompt: "Outer selection is not the native prompt" } : undefined,
        instructions: id === "unknown" ? null : { identity: selectedRevision, placement: "append",
          read: () => { reads++; return `Host ${selectedRevision}`; } }
      };
    }
  });
  const output = { system: ["Native default"] };
  const system = output.system;
  await plugin["experimental.chat.system.transform"]({ sessionID: "shared" }, output);
  await plugin["experimental.chat.system.transform"]({ sessionID: "shared" }, output);
  assert.deepEqual(resolutions, ["shared", "shared", "shared", "shared"]);
  assert.equal(reads, 1);
  assert.equal(output.system, system);
  assert.deepEqual(output.system, ["Native default", "Host first"]);
  plugin.event({ event: { type: "session.compacted", properties: { sessionID: "shared" } } });
  await plugin["experimental.chat.system.transform"]({ sessionID: "shared" }, output);
  assert.equal(reads, 2);
  assert.deepEqual(output.system, ["Native default", "Host first"]);

  resolutions.length = 0;
  route = "native";
  await plugin["experimental.chat.system.transform"]({ sessionID: "shared" }, output);
  assert.deepEqual(resolutions, ["shared"]);
  assert.deepEqual(output.system, ["Native instructions from the captured registry"]);
  assert.equal(reads, 2);

  resolutions.length = 0;
  route = "host";
  changeDuringSelection = true;
  await plugin["experimental.chat.system.transform"]({ sessionID: "shared" }, output);
  assert.deepEqual(resolutions, ["shared", "shared"]);
  assert.deepEqual(output.system, ["Native instructions from the captured registry", "Host changed between reads"]);
  assert.equal(reads, 3);
  route = "host";
  const unknown = { system: ["Unowned native guidance"] };
  await plugin["experimental.chat.system.transform"]({ sessionID: "unknown" }, unknown);
  assert.deepEqual(unknown.system, ["Unowned native guidance"]);
});

// Original non-project agent policy and denial cases from Vibe64's server/plugin
// tests. Common bindings replace promptContext; assertion semantics are retained.
test("non-project common OpenCode tools stay behind approval and require the execution guard", () => {
  const unguarded = openCodeConversationAgents();
  assert.equal(unguarded["jskit-assistant"].permission, "deny");
  assert.equal(unguarded["jskit-assistant-actions"].permission["*"], "deny");
  const guarded = openCodeConversationAgents({ sessionEnvironmentRegistry: "/private/sessions.json" });
  assert.equal(guarded["jskit-assistant"].permission["*"], "ask");
  assert.equal(guarded["jskit-assistant-actions"].permission["*"], "ask");
});

test("common non-project OpenCode calls retain the original fail-closed execution guard", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-opencode-original-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registryPath = path.join(directory, "sessions.json");
  const sessions = [{ upstreamSessionId: "private-conversation", conversation: {
    systemPrompt: "You have no tools or shell. Trusted host snapshot: active.", nativeTools: false
  } }];
  await writeFile(registryPath, JSON.stringify({ sessions }));
  const plugin = await conversationInstructions({ registryPath });
  for (const tool of ["bash", "shell", "read", "glob", "grep", "edit", "write", "apply_patch", "task", "webfetch", "websearch", "skill", "todowrite", "question", "future-tool"]) {
    const output = { args: { command: "ls -la /private/conversation", subagent_type: "general" } };
    const before = structuredClone(output);
    await assert.rejects(
      plugin["tool.execute.before"]({ sessionID: "private-conversation", tool }, output),
      /no authorization/u
    );
    assert.deepEqual(output, before);
  }
  const childPlugin = await conversationInstructions({ registryPath, client: { session: {
    async get() { return { data: { parentID: "private-conversation" } }; }
  } } });
  await assert.rejects(
    childPlugin["tool.execute.before"]({ sessionID: "native-child", tool: "read" }, {}),
    /no authorization/u
  );
  for (const sessionID of ["unregistered-conversation", ""]) {
    await assert.rejects(
      plugin["tool.execute.before"]({ sessionID, tool: "read" }, {}),
      /no instruction owner/u
    );
  }
  const absent = await conversationInstructions({ registryPath: "" });
  await assert.rejects(absent["tool.execute.before"]({ sessionID: "private-conversation", tool: "read" }, {}), /no instruction owner/u);
  const missing = await conversationInstructions({ registryPath: path.join(directory, "missing.json") });
  await assert.rejects(missing["tool.execute.before"]({ sessionID: "private-conversation", tool: "read" }, {}), { code: "ENOENT" });
  delete sessions[0].conversation;
  await writeFile(registryPath, JSON.stringify({ sessions }));
  await assert.rejects(plugin["tool.execute.before"]({ sessionID: "private-conversation", tool: "read" }, {}), /no authorization/u);
  await writeFile(registryPath, "unreadable registry");
  await assert.rejects(plugin["tool.execute.before"]({ sessionID: "private-conversation", tool: "read" }, {}), SyntaxError);
});
