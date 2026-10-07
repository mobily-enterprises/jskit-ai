import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createConversationRuntime, createFileConversationStorage } from "../src/server/conversation/index.js";
import { createLocalConversationExecution } from "../src/server/conversation/localExecution.js";
import { createOpenCodeConversationDriver } from "../src/server/conversation/providers/opencodeDriver.js";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "json-rest-schema";

const configuration = { systemPrompt: "Fresh instructions", integrationId: "assistant" };
const input = { messageId: "first", text: "Hello" };

test("OpenCode exposes the durable native identity before dispatch and respects a rejected gate", async t => {
  const f = await fixture(t);
  await f.first.close();
  const driver = createOpenCodeConversationDriver(f.driverOptions);
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
        assert.deepEqual(identity, { threadId: (await readBinding()).sessionId });
        assert.ok(identity.threadId);
        checked = true;
        throw blocked;
      },
      accept() { assert.fail("A rejected dispatch must not admit the message."); },
      onMessage() {}, onEvent() {}
    }), error => error === blocked);
    assert.equal(checked, true);
    assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 0);
  } finally { await provider.dispose(); }
});

test("OpenCode wraps native commands only for the bound conversation", async t => {
  const f = await fixture(t, { nativeTools: true, commandWrapper: "/host/command wrapper" });
  await f.conversation.send({ messageId: "command", text: "wrapped-command" });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
  assert.deepEqual(JSON.parse(state.conversationLog[0].assistant.text), {
    args: { command: "'/host/command wrapper' 'pwd'", description: "Current directory" }, foreignRejected: true
  });
});

test("OpenCode receives inline authorized images without granting filesystem access", async t => {
  const image = Buffer.from("authorized-image");
  const receipt = { attachmentId: "picture", fileName: "picture.png", size: image.length };
  const f = await fixture(t, { attachments: { resolve: async () => ({
    attachments: [receipt], content: [{ type: "image", image, mediaType: "image/png" }]
  }) } });
  await f.conversation.send({ ...input, attachmentIds: [receipt.attachmentId] });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
  assert.deepEqual(state.conversationLog[0].user.attachments, [receipt]);
  const trace = await f.trace();
  assert.deepEqual(trace.find(row => row.url?.endsWith("/prompt_async")).body.parts, [
    { type: "text", text: input.text }, { type: "file", mime: "image/png", url: `data:image/png;base64,${image.toString("base64")}` }
  ]);
  assert.equal(trace.some(row => row.url?.includes("/permission")), false);
  assert.equal((await f.conversation.send({ ...input, attachmentIds: [receipt.attachmentId] })).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "jskit-opencode-conversation-"));
  const command = path.join(directory, "opencode.mjs");
  const trace = path.join(directory, "trace.jsonl");
  await writeFile(command, `#!${process.execPath}
    import { createServer } from "node:http";
    import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
    import { randomUUID } from "node:crypto";
    const log = value => appendFileSync(${JSON.stringify(trace)}, JSON.stringify(value) + "\\n");
    const configuration = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
    const hooks = await (await import(configuration.plugin[0])).default();
    const file = process.env.OPENCODE_DB;
    const sessions = new Map((existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []).map(session => [session.id, session]));
    const save = () => writeFileSync(file, JSON.stringify([...sessions.values()]));
    const streams = new Set();
    const assistantResponses = ${JSON.stringify(options.assistantResponses || [])};
    const busy = new Set();
    let sequence = [...sessions.values()].reduce((sum, session) => sum + session.messages.length, 0);
    const row = (role, id, parts, extra = {}) => ({ info: { role, id, time: { created: ++sequence }, ...extra }, parts });
    const server = createServer(async (req, res) => {
      let source = "";
      for await (const chunk of req) source += chunk;
      const body = source ? JSON.parse(source) : {};
      const pieces = req.url.split("/");
      const sessionId = pieces[1] === "api" ? pieces[3] : pieces[1] === "session" ? pieces[2] : "";
      let session = sessions.get(sessionId);
      log({ method: req.method, url: req.url, ...(req.url.startsWith("/auth/") ? {} : { body }) });
      if (req.headers.authorization !== "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64")) {
        res.writeHead(401); res.end(); return;
      }
      const reply = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
      if (req.url === "/global/health") {
        if (${Boolean(options.startupWait)}) return;
        return reply({ healthy: true, version: "1.18.31" });
      }
      if (req.url.startsWith("/auth/")) return reply(true);
      if (req.url === "/path") return reply({ directory: req.headers["x-opencode-directory"] });
      if (req.url === "/provider") return reply({ all: Object.entries(configuration.provider).map(([id, provider]) => ({
        id, models: Object.fromEntries(Object.entries({ ...(provider.models || { "test-model": {} }), ...${JSON.stringify(options.modelDefinitions || {})} }).map(([id, model]) => [id, { ...model, id, variants: { low: {}, high: {} } }]))
      })) });
      if (req.url === "/api/session" && req.method === "POST") {
        if (!body.model?.id || body.location?.directory !== process.cwd()) return reply({ message: "Invalid native session parameters" }, 422);
        session = { id: "ses_" + randomUUID().replaceAll("-", ""), messages: [] }; sessions.set(session.id, session); save(); return reply({ data: { id: session.id } });
      }
      if (req.url.startsWith("/api/session/")) return session ? reply({ data: { id: session.id } }) : reply({ message: "Missing session" }, 404);
      if (pieces[1] === "session" && pieces.length === 3 && pieces[2].startsWith("ses_")) {
        if (!session) return reply({ message: "Missing session" }, 404);
        if (req.method === "PATCH") { session.permission = body.permission; save(); }
        return reply({ id: session.id, permission: session.permission || [] });
      }
      if (req.url === "/session/status") return reply(Object.fromEntries([...busy].map(id => [id, { type: "busy" }])));
      if (req.url.endsWith("/abort")) { busy.delete(session.id); return reply(true); }
      if (req.url === "/event") {
        if (${Boolean(options.eventWait)}) return;
        res.writeHead(200, { "content-type": "text/event-stream" }); res.flushHeaders();
        streams.add(res); req.on("close", () => streams.delete(res)); return;
      }
      if (req.url.includes("/message")) {
        if (${Boolean(options.historyUnavailable)}) return reply({ message: "Native history unavailable" }, 503);
        return reply(session.messages);
      }
      if (req.url.endsWith("/prompt_async")) {
        const text = body.parts[0].text;
        if (text === "rejected") return reply({ message: "Native request rejected" }, 422);
        if (!${Boolean(options.unobservedInput)}) session.messages.push(row("user", body.messageID, body.parts));
        save();
        busy.add(session.id);
        if (text === "lost") return;
        reply(null, 204);
        if (text === "wait") return;
        if (text === "steering") {
          session.messages.push(row("assistant", randomUUID(), [{ type: "text", text: "Initial progress" }], { parentID: body.messageID }));
          save(); return;
        }
        if (text === "phases") {
          for (const [type, timeout] of [["retry", 10], ["busy", 25]]) setTimeout(() => {
            for (const stream of streams) stream.write("data: " + JSON.stringify({ type: "session.status",
              properties: { sessionID: session.id, status: { type } } }) + "\\n\\n");
          }, timeout);
        }
        if (text === "disconnect") { for (const stream of streams) stream.end(); return; }
        if (text === "failed") {
          busy.delete(session.id);
          session.messages.push(row("assistant", randomUUID(), [], { error: { data: { message: "Model unavailable" } } })); save(); return;
        }
        const response = assistantResponses.shift();
        if (response) {
          session.messages.push(row("assistant", randomUUID(), response.content || [{ type: "text", text: response.text }], {
            parentID: body.messageID, finish: "stop"
          }));
          busy.delete(session.id); save(); return;
        }
        let answerText = "Answer: " + text;
        if (text === "wrapped-command") {
          const output = { args: { command: "pwd", description: "Current directory" } };
          await hooks["tool.execute.before"]({ tool: "bash", sessionID: session.id }, output);
          try { await hooks["tool.execute.before"]({ tool: "bash", sessionID: "unowned" }, { args: { command: "pwd" } }); }
          catch { output.foreignRejected = true; }
          answerText = JSON.stringify(output);
        }
        if (text === "tools" || text === "foreign-tool") {
          const invoke = async (name, input) => {
            const id = randomUUID();
            const part = { type: "tool", callID: id, tool: name, state: { status: "running", input } };
            const message = row("assistant", randomUUID(), [part], { parentID: body.messageID, finish: "tool-calls" });
            session.messages.push(message); save();
            await hooks["tool.execute.before"]({ tool: name, sessionID: session.id });
            const result = await hooks.tool[name].execute(input, { sessionID: session.id, messageID: message.info.id,
              callID: text === "foreign-tool" ? "foreign-id" : id, abort: new AbortController().signal });
            part.state = { ...part.state, status: "completed", output: result }; save();
            return result;
          };
          try {
            await invoke("assistant_action_search", { query: "numbers" });
            await invoke("assistant_action_contract", { actionId: "numbers.read", version: 1 });
            answerText = await invoke("assistant_action_execute", { actionId: "numbers.read", version: 1, input: {} });
          } catch (error) {
            busy.delete(session.id);
            session.messages.push(row("assistant", randomUUID(), [], { error: { data: { message: error.message } } })); save(); return;
          }
        }
        if (text === "compact") {
          session.messages.push(row("user", randomUUID(), [{ type: "compaction", auto: true }]));
          session.messages.push(row("assistant", randomUUID(), [{ type: "text", text: "Native summary" }], { summary: true, finish: "stop" }));
          session.messages.push(row("user", randomUUID(), [{ type: "text", text: "Continue" }]));
          await hooks.event({ event: { type: "session.compacted", properties: { sessionID: session.id } } });
        }
        const output = { system: ["ambient instructions"] };
        await hooks["experimental.chat.system.transform"]({ sessionID: session.id }, output);
        log({ system: output.system, sessionId: session.id });
        const answer = row("assistant", randomUUID(), [{ type: "reasoning", text: "Reasoning summary" }, { type: "text", text: "Answer: " }]);
        session.messages.push(answer); save();
        setTimeout(() => {
          answer.parts[1].text = answerText;
          answer.info.finish = "stop"; answer.info.time.completed = Date.now(); save();
          busy.delete(session.id);
        }, 100);
        return;
      }
      reply({ message: "Unexpected route" }, 404);
    });
    log({ configuration, isolated: process.env.OPENCODE_DISABLE_PROJECT_CONFIG,
      inheritedSecret: process.env.UNRELATED_SECRET || null });
    server.listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
  `, { mode: 0o700 });
  const storage = createFileConversationStorage({ directory: path.join(directory, "storage") });
  let key = "test-key";
  const runtimes = [];
  t.after(async () => {
    try { for (const runtime of runtimes) await runtime.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const runtime = () => {
    const value = createConversationRuntime({ engine: "opencode", storage, authorize: options.authorize || (() => true), actions: options.actions, attachments: options.attachments,
      connections: { resolve: options.resolve || (async () => ({ providerId: "test", model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
        modelLimits: { context: 32000, output: 4000 }, apiKey: key })) },
      host: { workdir: directory, env: { ...process.env, UNRELATED_SECRET: "must-not-inherit" },
        commands: { opencode: command }, execution: options.execution, nativeTools: options.nativeTools, commandWrapper: options.commandWrapper },
      limits: { admissionTimeoutMs: 250, ...options.limits } });
    runtimes.push(value);
    return value;
  };
  const first = runtime();
  const conversation = await first.open({ id: "conversation", configuration: options.configuration || configuration, context: options.context });
  return { directory, storage, first, runtime, conversation, setKey: value => { key = value; },
    driverOptions: {
      connections: { resolve: options.resolve || (async () => ({ providerId: "test", model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
        modelLimits: { context: 32000, output: 4000 }, apiKey: key })) },
      host: { workdir: directory, env: { ...process.env, UNRELATED_SECRET: "must-not-inherit" },
        commands: { opencode: command }, execution: options.execution, nativeTools: options.nativeTools, commandWrapper: options.commandWrapper },
      limits: { admissionTimeoutMs: 250, ...options.limits }
    },
    binding: () => storage.read("conversation", async tx => (await tx.readMetadata()).runtime.binding),
    async trace() { return (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line)); } };
}

test("OpenCode structured output shares the original prompt and completed-result normalization across reopen", async t => {
  const outputSchema = { type: "object", additionalProperties: false,
    properties: { answer: { type: "string", maxLength: 32 } }, required: ["answer"] };
  const expected = '{"answer":"Done"}';
  const f = await fixture(t, { configuration: { ...configuration, outputSchema },
    assistantResponses: [{ text: `\x60\x60\x60json\n${expected}\n\x60\x60\x60` }] });
  const events = [];
  await f.conversation.subscribe(event => events.push(event));
  await f.conversation.send(input);
  const result = await f.conversation.wait();
  assert.equal(result.capabilities.structuredOutput, true);
  assert.equal(result.conversationLog[0].user.text, input.text, "Schema framing is native context, never authored history");
  assert.equal(result.conversationLog[0].assistant.text, expected);
  const prompt = (await f.trace()).find(row => row.url?.endsWith("/prompt_async")).body.parts[0].text;
  assert.equal(prompt, [input.text, "", "Return only one JSON value matching this JSON Schema. Do not wrap it in Markdown code fences:",
    JSON.stringify(outputSchema)].join("\n"));
  assert.deepEqual(events.filter(event => event.type === "message" && event.role === "assistant" && event.status === "complete").map(event => event.text), [expected]);
  await f.first.close();
  const reopened = await f.runtime().open({ id: "conversation" });
  const saved = await reopened.read();
  assert.deepEqual(saved.configuration.outputSchema, outputSchema);
  assert.equal(saved.conversationLog[0].assistant.text, expected);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
});

test("OpenCode structured output enforces the raw output bound before removing JSON fences", async t => {
  const f = await fixture(t, { configuration: { ...configuration, outputSchema: { type: "string", maxLength: 1 } },
    limits: { maxOutputCharacters: 8 }, assistantResponses: [{ text: '\x60\x60\x60json\n"x"\n\x60\x60\x60' }] });
  await f.conversation.send(input);
  const result = await f.conversation.wait();
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(result.error, /output exceeded the configured limit/);
  assert.equal(result.conversationLog[0].assistant, null);
});

test("OpenCode structured output counts its schema framing before native dispatch", async t => {
  const f = await fixture(t, { configuration: { ...configuration, outputSchema: { type: "string", maxLength: 1 } },
    limits: { maxInputCharacters: 20 } });
  await assert.rejects(f.conversation.send(input), /structured input exceeded the configured limit/);
  assert.equal((await f.trace()).some(row => row.url?.endsWith("/prompt_async")), false);
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
});

test("OpenCode admits once, streams and saves native reasoning through the common runtime", async t => {
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
  assert.equal(trace.filter(item => item.url?.endsWith("/prompt_async")).length, 1);
  assert.equal(trace.find(item => item.url === "/api/session").body.model.id, "test-model");
  assert.equal(trace.find(item => item.url?.endsWith("/prompt_async")).body.model.modelID, "test-model");
  assert.equal(trace[0].inheritedSecret, null);
  assert.deepEqual(trace[0].configuration.agent[trace.find(item => item.url?.endsWith("/prompt_async")).body.agent].permission, { "*": "ask" });
  assert.match(trace[0].configuration.plugin[0], /openCodePlugin\.js$/u);
  assert.deepEqual(trace[0].configuration.provider.test.models["test-model"].limit, { context: 32000, output: 4000 });
  assert.equal(trace[0].configuration.provider.test.models["test-model"].id, "test-model");
  assert.equal(trace[0].isolated, "1");
});

test("independent common conversations share one OpenCode server and keep separate native histories", async t => {
  const f = await fixture(t);
  const second = await f.first.open({ id: "second-conversation", configuration: { ...configuration, systemPrompt: "Second instructions" } });
  await f.conversation.send({ messageId: "first-work", text: "wait" });
  await second.send({ messageId: "second-work", text: "Hello second" });
  const result = await second.wait();
  assert.equal(result.conversationLog[0].assistant.text, "Answer: Hello second");
  let trace = await f.trace();
  assert.equal(trace.filter(item => item.configuration).length, 1);
  const secondBinding = await f.storage.read("second-conversation", async tx => (await tx.readMetadata()).runtime.binding);
  assert.notEqual((await f.binding()).sessionId, secondBinding.sessionId);
  assert.equal((await f.binding()).databasePath, secondBinding.databasePath);
  await f.conversation.cancel();
  assert.equal((await f.conversation.wait()).conversationLog[0].metadata.runtime.status, "cancelled");
  await f.conversation.dispose();
  await second.send({ messageId: "second-more", text: "Continue second" });
  assert.equal((await second.wait()).conversationLog.length, 2);
  trace = await f.trace();
  assert.equal(trace.filter(item => item.configuration).length, 1);
  assert.deepEqual(trace.filter(item => item.system).map(item => item.system), [["Second instructions"], ["Second instructions"]]);
  await f.first.close();
  const resumed = await f.runtime().open({ id: "second-conversation" });
  await resumed.send({ messageId: "after-restart", text: "Resume second" });
  assert.equal((await resumed.wait()).conversationLog.length, 3);
  assert.equal((await f.storage.read("second-conversation", async tx => (await tx.readMetadata()).runtime.binding)).sessionId, secondBinding.sessionId);
});

test("OpenCode reports the same work and retry phases as the other drivers", async t => {
  const f = await fixture(t);
  const phases = [];
  await f.conversation.subscribe(event => { if (event.type === "phase") phases.push(event.phase); });
  await f.conversation.send({ messageId: "phases", text: "phases" });
  assert.equal((await f.conversation.wait()).phase, "");
  assert.deepEqual(phases, ["preparing", "working", "retrying", "working", ""]);
});

test("disposing an unopened restored binding does not stop its recorded shared server", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  const saved = await f.binding();
  const peer = await f.first.open({ id: "peer", configuration });
  await peer.send({ messageId: "peer-work", text: "wait" });
  await f.conversation.dispose();
  // A restart can leave the old server reference in the durable binding.
  // Restoring it grants neither a new acquisition nor ownership of peers.
  await f.storage.write("conversation", async tx => {
    const metadata = await tx.readMetadata();
    metadata.runtime.binding = saved;
    await tx.writeMetadata(metadata);
  });
  const restored = await f.first.open({ id: "conversation" });
  await restored.dispose();
  assert.equal((await peer.read()).status, "working");
  assert.equal((await f.trace()).filter(row => row.configuration).length, 1);
  await peer.cancel();
  assert.equal((await peer.wait()).conversationLog[0].metadata.runtime.status, "cancelled");
});

test("the production reasoning-only recovery keeps one common turn and preserves its reasoning", async t => {
  const f = await fixture(t, { assistantResponses: [{
    content: [{ id: "reasoning-only-part", text: "The command completed and the result is 42.", type: "reasoning" }],
    text: ""
  }, { text: "The result is 42." }] });
  await f.conversation.send({ messageId: "client-message-reasoning-only", text: "Run the command and tell me its result." });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog.length, 1);
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
  assert.equal(state.conversationLog[0].thinking[0].text, "The command completed and the result is 42.");
  assert.equal(state.conversationLog[0].assistant.text, "The result is 42.");
  const prompts = (await f.trace()).filter(row => row.url?.endsWith("/prompt_async"));
  assert.equal(prompts.length, 2);
  assert.match(prompts[1].body.parts[0].text, /previous response ended without a user-facing final answer/u);
});

test("the production recovery stops after two reasoning-only completions through the common runtime", async t => {
  const reasoningOnly = id => ({
    content: [{ id, text: "I have the result but did not emit a final answer.", type: "reasoning" }], text: ""
  });
  const f = await fixture(t, { assistantResponses: [reasoningOnly("reasoning-only-first"), reasoningOnly("reasoning-only-second")] });
  await f.conversation.send({ messageId: "client-message-reasoning-only-twice", text: "Run the command and tell me its result." });
  const state = await f.conversation.wait();
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 2);
  assert.equal(state.conversationLog.length, 1);
  assert.equal(state.conversationLog[0].metadata.runtime.status, "failed");
  assert.equal(state.error, "OpenCode finished without a user-facing final response. Please send your message again.");
  assert.equal(state.conversationLog[0].assistant, null);
});

test("OpenCode steering follows the newly admitted input in the same native conversation", async t => {
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
  for (const turn of state.conversationLog) assert.equal(turn.assistant.messageId,
    events.find(event => event.role === "assistant" && event.turnId === turn.turnId).messageId);
  const trace = await f.trace();
  assert.equal(trace.filter(row => row.configuration).length, 1);
  assert.equal(trace.filter(row => row.url === "/api/session").length, 1);
  assert.equal(trace.filter(row => row.url?.endsWith("/prompt_async")).length, 2);
  assert.equal((await f.conversation.send(steering)).duplicate, true);
});

test("OpenCode steering rejection does not abandon the existing turn", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "before", text: "wait" });
  await assert.rejects(f.conversation.send({ messageId: "rejected", text: "rejected", steer: true }), /Native request rejected/);
  assert.equal((await f.conversation.read()).pendingRequest, null);
  await f.conversation.send({ messageId: "after", text: "Continue", steer: true });
  assert.equal((await f.conversation.wait()).conversationLog.length, 2);
});

test("lost OpenCode steering acknowledgement retains a recoverable receipt without resending", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "before", text: "wait" });
  const steering = { messageId: "lost-steering", text: "lost", steer: true };
  await assert.rejects(f.conversation.send(steering));
  assert.equal((await f.conversation.wait()).status, "unconfirmed");
  assert.equal((await f.conversation.inspectDelivery({ messageId: steering.messageId })).status, "accepted");
  assert.equal((await f.conversation.send(steering)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 2);
});

test("OpenCode validates common model and effort fields against its exact native catalogue", async t => {
  const f = await fixture(t);
  await f.conversation.configure({ model: "test-model", effort: "high" });
  await f.conversation.send(input);
  await f.conversation.wait();
  assert.equal((await f.trace()).find(row => row.url?.endsWith("/prompt_async")).body.variant, "high");
  await f.conversation.configure({ effort: "medium" });
  await assert.rejects(f.conversation.send({ messageId: "unsupported", text: "No" }), /does not support/);
  await f.conversation.configure({ model: "different-model" });
  await assert.rejects(f.conversation.send({ messageId: "mismatch", text: "No" }), /differs from/);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
  const retained = await f.binding();
  await f.conversation.configure({ model: "test-model", effort: "low" });
  await f.conversation.send({ messageId: "changed-effort", text: "Continue with less reasoning" });
  await f.conversation.wait();
  const trace = await f.trace();
  const sessionPath = `/api/session/${retained.sessionId}`;
  assert.deepEqual(trace.filter(row => row.url?.startsWith(sessionPath)).map(row => [row.method, row.url, row.body]), [
    ["GET", sessionPath, {}],
    ["POST", `${sessionPath}/model`, { model: { id: "test-model", providerID: "test", variant: "low" } }],
    ["POST", `${sessionPath}/agent`, { agent: trace.find(row => row.url === "/api/session").body.agent }]
  ]);
  assert.equal((await f.binding()).sessionId, retained.sessionId);
  assert.equal((await f.binding()).databasePath, retained.databasePath);
  assert.equal(trace.filter(row => row.url === "/api/session").length, 1);
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

test("OpenCode shares discovery, saved results and current permissions across native resume", async t => {
  let executions = 0;
  const context = { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] };
  const f = await fixture(t, { context, actions: applicationActions(async () => { executions++; return { value: 42 }; }) });
  await f.conversation.send({ messageId: "tool-turn", text: "tools" });
  const first = await f.conversation.wait();
  assert.equal(first.conversationLog[0].metadata.runtime.status, "complete", first.error);
  assert.equal(first.conversationLog[0].metadata.applicationTools.length, 3);
  assert.equal(JSON.parse(first.conversationLog[0].assistant.text).result.result.value, 42);
  assert.equal(executions, 1);
  const trace = await f.trace();
  assert.deepEqual(trace[0].configuration.agent[trace.find(item => item.url?.endsWith("/prompt_async")).body.agent].permission, { "*": "ask", assistant_action_search: "allow",
    assistant_action_contract: "allow", assistant_action_execute: "allow" });
  const original = await f.binding();
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
  assert.equal((await f.binding()).sessionId, original.sessionId);
  assert.equal((await f.trace()).filter(item => item.configuration).length, 2);
});

test("OpenCode rejects calls that do not match the admitted native tool identity", async t => {
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

test("OpenCode stops after an uncertain application effect and retains its receipt", async t => {
  let executions = 0;
  const f = await fixture(t, {
    actions: applicationActions(async () => {
      executions++;
      throw Object.assign(new Error("Acknowledgement lost"), { statusCode: 503 });
    }),
    context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] }
  });
  await f.conversation.send({ messageId: "uncertain", text: "tools" });
  const result = await f.conversation.wait();
  assert.equal(executions, 1);
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
  assert.equal(result.conversationLog[0].metadata.applicationTools.at(-1).status, "unknown");
  assert.match(result.error, /Inspect its target/);
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 1);
});

test("intermediate tool messages cannot finish a turn and cancellation drains an invoked action", async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  const f = await fixture(t, {
    actions: applicationActions(async () => { entered.resolve(); return complete.promise; }),
    context: { actor: { id: "owner" }, surface: "app", permissions: ["numbers.read"] }
  });
  t.after(() => complete.resolve({ value: 42 }));
  await f.conversation.send({ messageId: "cancel-tools", text: "tools" });
  await entered.promise;
  // Allow several native completion polls to see the finished tool-call message.
  await delay(650);
  assert.equal((await f.conversation.read()).status, "working");
  let finished = false;
  const stopping = f.conversation.cancel().then(() => { finished = true; });
  await delay(50);
  assert.equal(finished, false);
  complete.resolve({ value: 42 });
  await stopping;
  const result = await f.conversation.read();
  assert.equal(result.conversationLog[0].metadata.runtime.status, "cancelled");
  assert.equal(result.conversationLog[0].metadata.applicationTools.at(-1).result.result.result.value, 42);
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 1);
});

test("updated instructions replace the native system lane and survive compaction and process restart", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  const session = (await f.binding()).sessionId;
  await f.conversation.configure({ systemPrompt: "Changed instructions" });
  await f.conversation.send({ messageId: "second", text: "compact" });
  assert.equal((await f.conversation.wait()).conversationLog[1].assistant.text, "Answer: compact");
  assert.equal((await f.trace()).filter(item => item.configuration).length, 1, "prompt updates do not replace this native process");
  assert.equal((await f.trace()).filter(item => item.url?.startsWith(`/api/session/${session}`)).length, 0,
    "the established native selection does not repeat read/model/agent controls");
  await f.first.close();
  const resumed = await f.runtime().open({ id: "conversation" });
  await resumed.send({ messageId: "third", text: "Again" });
  assert.equal((await resumed.wait()).conversationLog.length, 3);
  assert.equal((await f.binding()).sessionId, session);
  assert.deepEqual((await f.trace()).filter(item => item.system).map(item => item.system), [
    ["Fresh instructions"], ["Changed instructions"], ["Changed instructions"]
  ]);
});

test("cancel drains the owned OpenCode process before another native turn", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "waiting", text: "wait" });
  await f.conversation.cancel();
  assert.equal((await f.conversation.wait()).conversationLog[0].metadata.runtime.status, "cancelled");
  assert.equal((await f.binding()).executionId, "");
  await f.conversation.send(input);
  assert.equal((await f.conversation.wait()).conversationLog[1].assistant.text, "Answer: Hello");
});

test("a lost native acknowledgement is inspected by exact message identity without resending", async t => {
  const f = await fixture(t);
  await assert.rejects(f.conversation.send({ messageId: "lost-id", text: "lost" }));
  assert.equal((await f.conversation.read()).status, "unconfirmed");
  const receipt = await f.conversation.inspectDelivery({ messageId: "lost-id" });
  assert.equal(receipt.recovered, true);
  assert.equal((await f.conversation.read()).conversationLog[0].metadata.runtime.status, "interrupted");
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 1);
});

test("unavailable or absent native admission remains unknown without replaying the request", async t => {
  for (const options of [{ historyUnavailable: true }, { unobservedInput: true }]) {
    const f = await fixture(t, options);
    await assert.rejects(f.conversation.send({ messageId: "lost-id", text: "lost" }));
    assert.deepEqual(await f.conversation.inspectDelivery({ messageId: "lost-id" }), {
      status: "unknown", messageId: "lost-id"
    });
    assert.equal((await f.conversation.read()).status, "unconfirmed");
    await assert.rejects(f.conversation.send({ messageId: "retry", text: "Hello" }), /uncertain delivery/);
    assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 1);
  }
});

test("accepted OpenCode output can be recovered after restart without repeating inference", async t => {
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
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
});

test("native rejection and an admitted model failure retain different admission outcomes", async t => {
  const f = await fixture(t);
  await assert.rejects(f.conversation.send({ messageId: "bad", text: "rejected" }), /Native request rejected/);
  assert.equal((await f.conversation.read()).status, "ready");
  assert.equal((await f.conversation.inspectDelivery({ messageId: "bad" })).status, "not-sent");
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 1);
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
  await f.conversation.send({ messageId: "failed", text: "failed" });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog.length, 1);
  assert.equal(state.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(state.error, /Model unavailable/);
});

test("OpenCode refuses a different resolved account before dispatch", async t => {
  const f = await fixture(t);
  await f.conversation.send(input);
  await f.conversation.wait();
  f.setKey("another-account");
  await assert.rejects(f.conversation.send({ messageId: "second", text: "Again" }), /another OpenCode account/);
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 1);
  assert.equal((await f.conversation.inspectDelivery({ messageId: "second" })).status, "not-sent");
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 1);
});

test("loss of the event connection fails accepted work and proves process cleanup", async t => {
  const f = await fixture(t);
  await f.conversation.send({ messageId: "disconnect", text: "disconnect" });
  assert.equal((await f.conversation.wait()).conversationLog[0].metadata.runtime.status, "failed");
  assert.equal((await f.binding()).executionId, "");
});

test("event readiness failure does not submit a native message", async t => {
  const f = await fixture(t, { eventWait: true });
  await assert.rejects(f.conversation.send(input), /admission deadline/);
  assert.equal((await f.conversation.read()).conversationLog.length, 0);
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 0);
});

test("cancel interrupts OpenCode startup instead of waiting for the native health deadline", async t => {
  const f = await fixture(t, { startupWait: true });
  const sending = f.conversation.send(input);
  sending.catch(() => {});
  const deadline = Date.now() + 3000;
  while (!(await f.trace().catch(() => [])).some(item => item.url === "/global/health")) {
    if (Date.now() > deadline) throw new Error("OpenCode did not begin startup.");
    await delay(20);
  }
  const started = Date.now();
  await f.conversation.cancel();
  await assert.rejects(sending);
  assert.ok(Date.now() - started < 1500);
  assert.equal((await f.binding()).executionId, "");
});

test("unconfirmed cleanup blocks replacement until an explicit cleanup retry succeeds", async t => {
  const execution = createLocalConversationExecution();
  let allowStop = false;
  t.after(() => { allowStop = true; });
  const f = await fixture(t, { execution: { start: execution.start, stop: id => allowStop ? execution.stop(id) : { scopeEmpty: false } } });
  t.after(() => execution.close());
  await f.conversation.send({ messageId: "waiting", text: "wait" });
  await assert.rejects(f.conversation.cancel(), /cleanup could not be confirmed/);
  await assert.rejects(f.conversation.send(input), /cleanup could not be confirmed/);
  allowStop = true;
  await f.conversation.cancel();
  await f.conversation.send(input);
  assert.equal((await f.conversation.wait()).conversationLog.at(-1).assistant.text, "Answer: Hello");
});

test("unconfirmed OpenCode startup cleanup stays owned and Stop retries that exact execution", async t => {
  const execution = createLocalConversationExecution();
  let allowStop = false;
  t.after(() => { allowStop = true; });
  const stoppedIds = [];
  const f = await fixture(t, { startupWait: true, execution: { start: execution.start, stop(id, options) {
    stoppedIds.push(id);
    return allowStop ? execution.stop(id, options) : { scopeEmpty: false };
  } } });
  t.after(() => execution.close());
  const sending = f.conversation.send(input);
  sending.catch(() => {});
  const deadline = Date.now() + 3000;
  while (!(await f.trace().catch(() => [])).some(item => item.url === "/global/health")) {
    if (Date.now() > deadline) throw new Error("OpenCode did not begin startup.");
    await delay(20);
  }
  await assert.rejects(f.conversation.cancel(), /cleanup could not be confirmed/);
  await assert.rejects(sending);
  const saved = await f.binding();
  assert.ok(saved.executionId);
  await assert.rejects(f.conversation.cancel(), /cleanup could not be confirmed/);
  await assert.rejects(f.conversation.send(input), /cleanup could not be confirmed/);
  assert.equal((await f.trace()).filter(row => row.configuration).length, 1);
  allowStop = true;
  await f.conversation.cancel();
  assert.equal((await f.binding()).executionId, "");
  assert.equal((await f.conversation.read()).status, "ready");
  assert.ok(stoppedIds.length >= 3);
  assert.deepEqual([...new Set(stoppedIds)], [saved.executionId]);
});

test("access revoked during connection preparation prevents native dispatch", async t => {
  let allowed = true;
  const f = await fixture(t, { authorize: () => allowed, resolve: async () => {
    allowed = false;
    return { providerId: "test", model: "test-model", apiKey: "test", sdkPackage: "@ai-sdk/openai-compatible" };
  } });
  await assert.rejects(f.conversation.send(input), /not available/);
  assert.equal((await f.trace()).filter(item => item.url?.endsWith("/prompt_async")).length, 0);
});

test("OpenCode common dispatch preserves original local image input and exact conversation directory permission", async t => {
  const localFiles = [
    { attachmentId: "image", fileName: "a b.png", path: "/session/artifacts/a b.png", contentType: "image/png", size: 16, reference: "[Image #1]" },
    { attachmentId: "file", fileName: "data.csv", path: "/session/artifacts/data.csv", contentType: "application/octet-stream", size: 24, reference: "[File #1]" }
  ];
  const attachments = localFiles.map(({ attachmentId, fileName, size, reference }) => ({ attachmentId, fileName, size, reference }));
  const f = await fixture(t, { attachments: { resolve: async () => ({ attachments, localFiles }) } });
  const request = { messageId: "local-files", text: "Inspect [Image #1] and [File #1]", attachmentIds: ["image", "file"] };
  await f.conversation.send({ ...request, localFiles: [{ path: "/etc/passwd" }], attachmentManifest: "forged" });
  const state = await f.conversation.wait();
  assert.equal(state.conversationLog[0].metadata.runtime.status, "complete", state.error);
  assert.equal(state.conversationLog[0].user.text, request.text);
  assert.deepEqual(state.conversationLog[0].user.attachments, attachments);
  assert.doesNotMatch(JSON.stringify(state.conversationLog[0].user), /session\/artifacts|contentType|forged|etc\/passwd/);
  const trace = await f.trace();
  const promptIndex = trace.findIndex(row => row.url?.endsWith("/prompt_async"));
  assert.deepEqual(trace[promptIndex].body.parts, [
    { type: "text", text: 'Inspect [Image #1] and [File #1]\n\nAttached files:\n[Image #1] "a b.png": "/session/artifacts/a b.png"\n[File #1] "data.csv": "/session/artifacts/data.csv"' },
    { type: "file", mime: "image/png", filename: "a b.png", url: "file:///session/artifacts/a%20b.png" }
  ]);
  const sessionId = (await f.binding()).sessionId;
  const permissionIndex = trace.findIndex(row => row.method === "PATCH" && row.url === `/session/${sessionId}`);
  assert.ok(permissionIndex >= 0 && permissionIndex < promptIndex);
  assert.deepEqual(trace[permissionIndex].body.permission, [{ permission: "external_directory", pattern: "/session/artifacts/*", action: "allow" }]);
  assert.equal((await f.conversation.send(request)).duplicate, true);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
  await f.conversation.send({ ...request, messageId: "local-again" });
  await f.conversation.wait();
  assert.equal((await f.trace()).filter(row => row.method === "PATCH" && row.url === `/session/${sessionId}`).length, 1);
});


test("OpenCode provider selection rotates only the incompatible binding and retains canonical history", async t => {
  let model = "test-model";
  const f = await fixture(t, { modelDefinitions: { "other-model": {} }, resolve: async ({ integrationId }) => ({
    providerId: integrationId, model, sdkPackage: "@ai-sdk/openai-compatible",
    modelLimits: { context: 32000, output: 4000 }, apiKey: `key-${integrationId}`
  }) });
  await f.conversation.send(input);
  const before = await f.conversation.wait();
  const original = await f.binding();
  model = "other-model";
  await f.conversation.select({ operationId: "same-provider-model", expectedSegmentId: before.segmentId,
    engine: "opencode", configuration: { ...configuration, model, effort: "low" } });
  assert.deepEqual(await f.binding(), original, "A model change within the same provider retains its native session and account");
  assert.equal((await f.conversation.read()).segmentId, before.segmentId);
  await f.conversation.send({ messageId: "second", text: "Same account" });
  const current = await f.conversation.wait();
  const selection = { operationId: "different-provider", expectedSegmentId: current.segmentId,
    engine: "opencode", configuration: { ...configuration, integrationId: "flash", model, effort: "low" } };
  const selected = await f.conversation.select(selection);
  assert.notEqual(selected.segmentId, current.segmentId);
  const inert = await f.binding();
  assert.notEqual(inert.directory, original.directory);
  assert.equal(inert.sessionId, "");
  assert.equal(inert.accountIdentity, undefined);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 2,
    "Selecting another provider must not run inference");
  assert.deepEqual((await f.conversation.read()).conversationLog, current.conversationLog);
  assert.equal((await f.conversation.select(selection)).duplicate, true);
  await f.conversation.send({ messageId: "third", text: "Continue with Flash" });
  const after = await f.conversation.wait();
  assert.equal(after.id, current.id);
  assert.equal(after.error, "");
  assert.deepEqual(after.conversationLog.slice(0, 2), current.conversationLog);
  const fresh = await f.binding();
  assert.notEqual(fresh.sessionId, original.sessionId);
  assert.notEqual(fresh.accountIdentity, original.accountIdentity);
  const prompts = (await f.trace()).filter(row => row.url?.endsWith("/prompt_async"));
  assert.equal(prompts.length, 3);
  assert.match(prompts[2].body.parts[0].text, /Hello/);
  assert.match(prompts[2].body.parts[0].text, /Same account/);
  assert.match(prompts[2].body.parts[0].text, /Continue with Flash/);
  await f.first.close();
  const reopened = await f.runtime().open({ id: "conversation" });
  assert.equal((await reopened.select(selection)).duplicate, true);
  assert.deepEqual(await f.binding(), { ...fresh, executionId: "", processDirectory: "" });
  assert.deepEqual((await reopened.read()).conversationLog, after.conversationLog);
});

for (const change of ["model", "effort"]) {
  test(`OpenCode selection honors a consumer's fresh native policy for ${change} changes without losing written history`, async t => {
    let model = "test-model";
    const f = await fixture(t, { modelDefinitions: { "other-model": {} }, resolve: async () => ({
      providerId: "test", model, sdkPackage: "@ai-sdk/openai-compatible", apiKey: "same-account"
    }) });
    await f.conversation.send(input);
    const before = await f.conversation.wait();
    const original = await f.binding();
    if (change === "model") model = "other-model";
    const selection = { operationId: `fresh-${change}`, expectedSegmentId: before.segmentId, engine: "opencode",
      configuration: { ...configuration, model, effort: change === "effort" ? "high" : "low" }, retireNative: true };
    await assert.rejects(f.conversation.select({ ...selection, retireNative: "yes" }), { code: "conversation_invalid_replacement" });
    assert.deepEqual(await f.binding(), original);
    const selected = await f.conversation.select(selection);
    assert.notEqual(selected.segmentId, before.segmentId);
    const inert = await f.binding();
    assert.notEqual(inert.directory, original.directory);
    assert.equal(inert.sessionId, "");
    assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1,
      "Changing the selection cannot submit another authored request");
    assert.deepEqual((await f.conversation.read()).conversationLog, before.conversationLog);
    assert.equal((await f.conversation.select(selection)).duplicate, true);
    await f.conversation.send({ messageId: "after-change", text: "Continue our discussion" });
    const after = await f.conversation.wait();
    assert.equal(after.error, "");
    assert.equal(after.id, before.id);
    assert.notEqual((await f.binding()).sessionId, original.sessionId);
    assert.equal((await f.binding()).accountIdentity, original.accountIdentity);
    assert.deepEqual(after.conversationLog[0], before.conversationLog[0]);
    const prompts = (await f.trace()).filter(row => row.url?.endsWith("/prompt_async"));
    assert.equal(prompts.length, 2);
    assert.match(prompts[1].body.parts[0].text, /Hello/);
    assert.match(prompts[1].body.parts[0].text, /Continue our discussion/);
    assert.deepEqual(prompts[1].body.model, { providerID: "test", modelID: model });
    assert.equal(prompts[1].body.variant, change === "effort" ? "high" : "low");
    await f.first.close();
    const reopened = await f.runtime().open({ id: "conversation" });
    assert.equal((await reopened.select(selection)).duplicate, true);
    assert.deepEqual((await reopened.read()).conversationLog, after.conversationLog);
  });
}

test("OpenCode explicit selection recovers an older mismatched configuration without replaying its rejected request", async t => {
  const f = await fixture(t, { resolve: async ({ integrationId }) => ({
    providerId: integrationId, model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
    modelLimits: { context: 32000, output: 4000 }, apiKey: `key-${integrationId}`
  }) });
  await f.conversation.send(input);
  const original = await f.conversation.wait();
  const oldBinding = await f.binding();
  // Earlier same-engine selection wrote the new configuration but kept this
  // binding. Configure reproduces those exact persisted facts without replacing
  // the original identity guard or running an alternative sender.
  await f.conversation.configure({ integrationId: "flash" });
  await assert.rejects(f.conversation.send({ messageId: "rejected-greeting", text: "Do not replay this greeting" }),
    /another OpenCode account/);
  await f.conversation.wait();
  const rejected = await f.storage.read("conversation", async tx => (await tx.readMetadata()).runtime.request);
  assert.equal(rejected.messageId, "rejected-greeting");
  assert.equal(rejected.attempted, false);
  assert.deepEqual(await f.binding(), { ...oldBinding, executionId: "", processDirectory: "" });
  const restoring = { operationId: "restore-original-provider", expectedSegmentId: original.segmentId,
    engine: "opencode", configuration };
  const restored = await f.conversation.select(restoring);
  const switchToFlash = { operationId: "select-flash-after-restore", expectedSegmentId: restored.segmentId,
    engine: "opencode", configuration: { ...configuration, integrationId: "flash" } };
  await f.conversation.select(switchToFlash);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
  assert.equal((await f.conversation.inspectDelivery({ messageId: rejected.messageId })).status, "not-sent");
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
  await f.conversation.send({ messageId: "new-authored-message", text: "Continue the same conversation" });
  const after = await f.conversation.wait();
  assert.equal(after.id, original.id);
  assert.equal(after.error, "");
  assert.deepEqual(after.conversationLog[0], original.conversationLog[0]);
  const saved = await f.storage.read("conversation", tx => tx.readMetadata());
  assert.deepEqual(saved.runtime.predecessors.find(segment => segment.request?.messageId === rejected.messageId).request, rejected,
    "The original rejected request remains with its predecessor, not a new dispatch");
  const prompts = (await f.trace()).filter(row => row.url?.endsWith("/prompt_async"));
  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[1].body.parts[0].text, /Do not replay this greeting|rejected-greeting/);
  assert.match(prompts[1].body.parts[0].text, /Hello/);
});

test("OpenCode provider selection retains an uncertain predecessor without resending its authored ID", async t => {
  const f = await fixture(t, { unobservedInput: true, resolve: async ({ integrationId }) => ({
    providerId: integrationId, model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
    modelLimits: { context: 32000, output: 4000 }, apiKey: `key-${integrationId}`
  }) });
  await assert.rejects(f.conversation.send({ messageId: "unknown-old-id", text: "lost" }));
  const before = await f.conversation.wait();
  const metadata = await f.storage.read("conversation", tx => tx.readMetadata());
  assert.equal(metadata.runtime.request.attempted, true);
  await f.conversation.select({ operationId: "switch-with-unknown", expectedSegmentId: before.segmentId,
    engine: "opencode", configuration: { ...configuration, integrationId: "flash" } });
  const saved = await f.storage.read("conversation", tx => tx.readMetadata());
  assert.deepEqual(saved.runtime.predecessors.at(-1).request, metadata.runtime.request);
  assert.deepEqual(await f.conversation.inspectDelivery({ messageId: "unknown-old-id" }), { status: "unknown", messageId: "unknown-old-id" });
  await assert.rejects(f.conversation.send({ messageId: "unknown-old-id", text: "lost" }),
    /pending.*another|another.*pending|another native|uncertain/i);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
});


test("OpenCode fresh native selection retains an uncertain predecessor without resending its authored ID", async t => {
  const f = await fixture(t, { unobservedInput: true });
  await assert.rejects(f.conversation.send({ messageId: "unknown-old-id", text: "lost" }));
  const before = await f.conversation.wait();
  const metadata = await f.storage.read("conversation", tx => tx.readMetadata());
  assert.equal(metadata.runtime.request.attempted, true);
  await f.conversation.select({ operationId: "fresh-with-unknown", expectedSegmentId: before.segmentId,
    engine: "opencode", configuration: { ...configuration, effort: "high" }, retireNative: true });
  const saved = await f.storage.read("conversation", tx => tx.readMetadata());
  assert.deepEqual(saved.runtime.predecessors.at(-1).request, metadata.runtime.request);
  assert.notEqual(saved.runtime.binding.directory, metadata.runtime.binding.directory);
  assert.equal(saved.runtime.binding.sessionId, "");
  await assert.rejects(f.conversation.send({ messageId: "unknown-old-id", text: "lost" }),
    /pending.*another|another.*pending|another native|uncertain/i);
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 1);
});

test("returning to OpenCode restores only a retained binding with the selected integration", async t => {
  const f = await fixture(t, { resolve: async ({ integrationId }) => ({
    providerId: integrationId, model: "test-model", sdkPackage: "@ai-sdk/openai-compatible",
    modelLimits: { context: 32000, output: 4000 }, apiKey: `key-${integrationId}`
  }) });
  await f.conversation.send(input);
  const before = await f.conversation.wait();
  const original = await f.binding();
  const otherEngine = await f.conversation.select({ operationId: "api-between", expectedSegmentId: before.segmentId,
    engine: "api", configuration });
  const selected = await f.conversation.select({ operationId: "return-to-flash", expectedSegmentId: otherEngine.segmentId,
    engine: "opencode", configuration: { ...configuration, integrationId: "flash" } });
  assert.notEqual(selected.segmentId, before.segmentId);
  assert.notEqual((await f.binding()).directory, original.directory);
  assert.equal((await f.binding()).sessionId, "");
  await f.conversation.send({ messageId: "after-api", text: "The same discussion on Flash" });
  const after = await f.conversation.wait();
  assert.equal(after.error, "");
  assert.equal(after.id, before.id);
  assert.deepEqual(after.conversationLog[0], before.conversationLog[0]);
  const flash = await f.binding();
  const apiAgain = await f.conversation.select({ operationId: "api-again", expectedSegmentId: after.segmentId,
    engine: "api", configuration });
  const restored = await f.conversation.select({ operationId: "restore-flash", expectedSegmentId: apiAgain.segmentId,
    engine: "opencode", configuration: { ...configuration, integrationId: "flash" } });
  assert.equal(restored.segmentId, selected.segmentId);
  assert.deepEqual(await f.binding(), { ...flash, executionId: "", processDirectory: "" },
    "Returning to the same integration restores native identity after verified process cleanup");
  assert.equal((await f.trace()).filter(row => row.url?.endsWith("/prompt_async")).length, 2);
});
