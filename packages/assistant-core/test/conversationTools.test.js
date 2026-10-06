import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createConversationRuntime, createMemoryConversationStorage } from "../src/server/conversation/index.js";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";
import { createConversationTools } from "../src/server/conversation/tools.js";

const configuration = { systemPrompt: "Use the available application operations when needed.", integrationId: "assistant" };
const context = { actor: { id: "owner" }, surface: "app", applicationId: "test", subjectId: "owner" };
const message = { messageId: "request-one", text: "Add two and three." };
const call = { id: "call_one", name: "", arguments: '{"left":2,"right":3}' };
const frame = (delta, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
function response({ name, id = call.id, text = "The total is five." } = {}) {
  return new Response(name ? frame({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: call.arguments } }] }) + frame({}, "tool_calls")
    : frame({ content: text }) + frame({}, "stop"), { headers: { "content-type": "text/event-stream" } });
}
function actionCatalog(execute) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.tools", domain: "test", actions: [{
    id: "numbers.add", version: 1, kind: "command", channels: ["automation"], surfaces: ["app"],
    permission: { require: "authenticated" }, idempotency: "none",
    input: { schema: createSchema({ left: { type: "number", required: true }, right: { type: "number", required: true } }), mode: "replace" },
    output: { schema: createSchema({ total: { type: "number", required: true } }), mode: "replace" }, execute
  }] });
  return actions;
}
async function fixture(t, options = {}) {
  const observed = { requests: [], events: [], executions: [], allowed: true };
  const storage = options.storage || createMemoryConversationStorage();
  const actions = actionCatalog(async input => {
    observed.executions.push(input);
    const saved = await storage.read("one", async transaction => transaction.readTurn((await transaction.listTurnIds()).at(-1)));
    assert.equal(saved.metadata.applicationTools.at(-1).status, "running", "Reservation must precede the application effect");
    return options.execute ? options.execute(input) : { total: 5 };
  });
  const name = createServiceToolCatalog(actions).resolveToolSet(context).tools[0].name;
  const runtime = createConversationRuntime({ storage, actions, toolPolicy: options.toolPolicy, limits: options.limits,
    authorize: ({ operation }) => operation !== "tool" || observed.allowed,
    connections: { resolve: async () => ({ providerId: "test", model: "exact-model", sdkPackage: "@ai-sdk/openai-compatible", apiKey: "test", baseURL: "http://test.invalid/v1" }) },
    fetch: (_url, request) => {
      const body = JSON.parse(request.body);
      observed.requests.push(body);
      return options.response?.(body, observed.requests.length, name) || response(observed.requests.length === 1 ? { name } : {});
    }
  });
  t.after(() => runtime.close());
  const conversation = await runtime.open({ id: "one", context, configuration });
  await conversation.subscribe(event => observed.events.push(event));
  return { runtime, conversation, storage, observed, name };
}

test("API tools use authorized action contracts, save results and resume the same model turn", async t => {
  const f = await fixture(t);
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal(result.capabilities.tools, true);
  assert.equal(result.conversationLog.length, 1);
  assert.equal(result.conversationLog[0].assistant.text, "The total is five.");
  assert.deepEqual(result.conversationLog[0].metadata.applicationTools[0].result, { ok: true, result: { total: 5 } });
  assert.equal(f.observed.executions.length, 1);
  assert.equal(f.observed.requests.length, 2);
  assert.equal(f.observed.requests[1].model, "exact-model");
  assert.deepEqual(JSON.parse(f.observed.requests[1].messages.at(-1).content), { total: 5 });
  assert.deepEqual(f.observed.events.filter(event => event.type === "tool").map(event => event.call.status), ["running", "complete"]);
  await f.conversation.send({ messageId: "next", text: "What did you just calculate?" });
  await f.conversation.wait();
  assert.equal(f.observed.requests[2].messages.filter(message => message.role === "tool").length, 1, "Tool receipts survive into subsequent model context");
  assert.deepEqual(JSON.parse(f.observed.requests[2].messages.find(message => message.role === "tool").content), { total: 5 });
  assert.equal(f.observed.executions.length, 1);
  assert.equal((await f.conversation.send(message)).duplicate, true);
});

// Carried from assistant-runtime's original split-tag lifecycle case. Only the
// action name/arguments and confirmed API framing adapt to the common fixture.
test("split internal tags and tool arguments never become common answer deltas", async t => {
  const f = await fixture(t, { response: (_body, round, name) => round === 1 ? new Response([
    "<th", "ink>private reasoning", "</thi", "nk>", "<｜DSML｜function_",
    `calls><｜DSML｜invoke name="${name}">`, call.arguments,
    "</｜DSML｜invoke></｜DSML｜function_calls>"
  ].map(content => frame({ content })).join("") + frame({}, "stop"), {
    headers: { "content-type": "text/event-stream" }
  }) : response({ text: "The search is complete." }) });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.deepEqual(f.observed.executions, [{ left: 2, right: 3 }]);
  assert.deepEqual(f.observed.events.filter(event => event.type === "message" && event.status !== "complete")
    .map(event => event.text), ["The search is complete."]);
  assert.equal(result.conversationLog[0].assistant.text, "The search is complete.");
});

test("text-encoded calls in separate responses retain separate durable receipts", async t => {
  const f = await fixture(t, { response: (_body, round, name) => round < 3 ? new Response(frame({ content:
    `<function_calls><invoke name="${name}">${round === 1 ? call.arguments : '{"left":4,"right":5}'}</invoke></function_calls>`
  }) + frame({}, "stop"), { headers: { "content-type": "text/event-stream" } }) : response() });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.deepEqual(f.observed.executions, [{ left: 2, right: 3 }, { left: 4, right: 5 }]);
  assert.equal(result.error, "");
  assert.equal(new Set(result.conversationLog[0].metadata.applicationTools.map(call => call.id)).size, 2);
});

test("text-encoded calls still require confirmed completion and raw-output limits", async t => {
  for (const oversized of [false, true]) {
    const f = await fixture(t, { limits: oversized ? { maxOutputCharacters: 100 } : {},
      response: (_body, _round, name) => new Response(frame({ content:
        (oversized ? `<think>${"private".repeat(50)}</think>` : "") +
        `<function_calls><invoke name="${name}">${call.arguments}</invoke></function_calls>`
      }) + (oversized ? frame({}, "stop") : ""), { headers: { "content-type": "text/event-stream" } }) });
    await f.conversation.send(message);
    const result = await f.conversation.wait();
    assert.equal(f.observed.executions.length, 0);
    assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
    assert.match(result.error, oversized ? /response limit/ : /ended without a finish reason/);
  }
});

test("structured calls without a native ID are not made safe by parser-generated IDs", async t => {
  const f = await fixture(t, { response: (_body, _round, name) => new Response(frame({ tool_calls: [{
    index: 0, function: { name, arguments: call.arguments }
  }] }) + frame({}, "tool_calls"), { headers: { "content-type": "text/event-stream" } }) });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal(f.observed.executions.length, 0);
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
});

test("API answer parsing preserves code indentation and blank lines", async t => {
  const text = "Example:\n\n```python\nif ready:\n    run()\n```";
  const f = await fixture(t, { response: () => response({ text }) });
  await f.conversation.send(message);
  assert.equal((await f.conversation.wait()).conversationLog[0].assistant.text, text);
});

test("revocation after model admission prevents an application operation", async t => {
  const f = await fixture(t);
  f.observed.allowed = false;
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal(f.observed.executions.length, 0);
  assert.equal(f.observed.requests.length, 1);
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(result.error, /not available to this identity/);
});

test("tool progress and the final answer keep distinct identities from streaming into saved history", async t => {
  const f = await fixture(t, { response: (_body, round, name) => round === 1 ? new Response(
    frame({ content: "I will check. " }) + frame({ content: "Adding the numbers." }) +
    frame({ tool_calls: [{ index: 0, id: call.id, type: "function", function: { name, arguments: call.arguments } }] }) +
    frame({}, "tool_calls"), { headers: { "content-type": "text/event-stream" } }) : response() });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  const turn = result.conversationLog[0];
  const messages = f.observed.events.filter(event => event.type === "message");
  const progress = messages.filter(event => event.text.startsWith("I will check."));
  const answer = messages.filter(event => event.text === "The total is five.");
  assert.equal(new Set(progress.map(event => event.messageId)).size, 1);
  assert.equal(progress.at(-1).status, "complete");
  assert.equal(progress.at(-1).role, "commentary");
  assert.equal(turn.commentary[0].messageId, progress[0].messageId);
  assert.equal(turn.assistant.messageId, answer[0].messageId);
  assert.notEqual(turn.assistant.messageId, turn.commentary[0].messageId);
  assert.deepEqual([...new Set(progress.map(event => event.outputId))], [progress[0].messageId]);
  assert.deepEqual([...new Set(answer.map(event => event.outputId))], [answer[0].messageId]);
  assert.equal(turn.commentary[0].outputId, progress[0].outputId);
  assert.equal(turn.assistant.outputId, answer[0].outputId);
  assert.equal(answer.at(-1).status, "complete");
  assert.equal(messages.some(event => !event.text), false, "A tool round must not clear an already spoken reply");
  await f.conversation.send({ messageId: "another", text: "Repeat that." });
  const next = await f.conversation.wait();
  assert.notEqual(next.conversationLog[1].assistant.messageId, turn.assistant.messageId);
  assert.notEqual(next.conversationLog[1].assistant.outputId, turn.assistant.outputId);
});

test("the runtime applies application tool policy to schemas and an unsolicited model call", async t => {
  const f = await fixture(t, { toolPolicy: ({ kind, context: actual }) => {
    assert.deepEqual(actual.actor, context.actor);
    return kind === "query";
  } });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal((f.observed.requests[0].tools || []).length, 0);
  assert.equal(f.observed.executions.length, 0);
  assert.equal(f.observed.requests.length, 1);
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
  assert.match(result.error, /unavailable tool|No such tool/i);
});

test("incomplete model tool streams cannot execute application actions", async t => {
  const f = await fixture(t, { response: (_body, _round, name) => new Response(frame({ tool_calls: [{
    index: 0, id: call.id, type: "function", function: { name, arguments: call.arguments }
  }] }), { headers: { "content-type": "text/event-stream" } }) });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal(f.observed.executions.length, 0);
  assert.equal(result.conversationLog[0].metadata.runtime.status, "failed");
});

test("tool limits bound continuation even when the model keeps requesting actions", async t => {
  const f = await fixture(t, { limits: { maxToolCalls: 2 }, response: (_body, round, name) => response({ name, id: `call_${round}` }) });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal(f.observed.executions.length, 2);
  assert.equal(f.observed.requests.length, 3);
  assert.match(result.error, /tool-call limit/);
});

test("cancel waits for an admitted application action to settle and saves its result", async t => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  const f = await fixture(t, { execute: () => { entered.resolve(); return complete.promise; } });
  await f.conversation.send(message);
  await entered.promise;
  let stopped = false;
  const stopping = f.conversation.cancel().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  complete.resolve({ total: 5 });
  await stopping;
  const result = await f.conversation.read();
  assert.equal(result.conversationLog[0].metadata.runtime.status, "cancelled");
  assert.equal(result.conversationLog[0].metadata.applicationTools[0].result.result.total, 5);
  assert.equal(f.observed.requests.length, 1);
});

test("retrySave persists an action result after disk failure without replaying it", async t => {
  const memory = createMemoryConversationStorage();
  let unavailable = false;
  const storage = { ...memory, write(scope, operation) {
    if (unavailable) return Promise.reject(new Error("Disk unavailable"));
    return memory.write(scope, operation);
  } };
  const f = await fixture(t, { storage, execute: () => { unavailable = true; return { total: 5 }; } });
  await f.conversation.send(message);
  const failed = await f.conversation.wait();
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.conversationLog[0].metadata.applicationTools[0].status, "running");
  unavailable = false;
  assert.equal((await f.conversation.retrySave()).saved, true);
  assert.equal((await f.conversation.read()).conversationLog[0].metadata.applicationTools[0].result.result.total, 5);
  assert.equal(f.observed.executions.length, 1);
  assert.equal(f.observed.requests.length, 1);
});

test("repeated calls in one admitted turn reuse receipts; interrupted reservations never execute again", async () => {
  let executions = 0;
  const actions = actionCatalog(async () => { executions++; return { total: 5 }; });
  const catalog = createServiceToolCatalog(actions);
  const input = { ...call, name: catalog.resolveToolSet(context).tools[0].name };
  const records = [];
  const create = previousCalls => createConversationTools({ catalog, context, previousCalls, signal: new AbortController().signal,
    authorize: async () => {}, save: async calls => records.push(structuredClone(calls)), emit: async () => {} });
  const first = create([]);
  const [one, two] = await Promise.all([first.execute(input), first.execute(input)]);
  assert.deepEqual(one, two);
  assert.equal(executions, 1);
  await assert.rejects(first.execute({ ...input, arguments: '{}' }), /different arguments/);
  const resumed = create(records[0]);
  await assert.rejects(resumed.execute(input), { code: "conversation_tool_outcome_unknown" });
  assert.equal(executions, 1);
  const completed = create(records.at(-1));
  assert.deepEqual(await completed.execute(input), one);
  assert.equal(executions, 1);
  assert.deepEqual(completed.records(), first.records(), "Restored receipts remain part of the turn's saved state");
});

test("a later admitted turn can reuse a model's tool id with different arguments", async t => {
  const f = await fixture(t, { execute: ({ left, right }) => ({ total: left + right }),
    response: (_body, round, name) => round % 2 ? new Response(frame({ tool_calls: [{
      index: 0, id: call.id, type: "function", function: { name, arguments: round === 1 ? call.arguments : '{"left":4,"right":5}' }
    }] }) + frame({}, "tool_calls"), { headers: { "content-type": "text/event-stream" } }) : response()
  });
  await f.conversation.send(message);
  await f.conversation.wait();
  await f.conversation.send({ messageId: "request-two", text: "Now add four and five." });
  const result = await f.conversation.wait();
  assert.equal(result.error, "");
  assert.equal(f.observed.executions.length, 2);
  assert.deepEqual(result.conversationLog.map(turn => turn.metadata.applicationTools[0].result.result.total), [5, 9]);
  assert.equal((await f.conversation.send(message)).duplicate, true);
  assert.equal(f.observed.executions.length, 2, "An accepted user message is still never replayed");
});

test("failed reservations and oversized arguments cannot reach application execution", async () => {
  let executions = 0;
  const catalog = createServiceToolCatalog(actionCatalog(async () => { executions++; return { total: 5 }; }), { maxToolArgumentBytes: 32 });
  const input = { ...call, name: catalog.resolveToolSet(context).tools[0].name };
  const tools = createConversationTools({ catalog, context, signal: new AbortController().signal,
    authorize: async () => {}, save: async () => { throw new Error("Disk unavailable"); }, emit: async () => {} });
  await assert.rejects(tools.execute({ ...input, arguments: " ".repeat(33) }), /size limit/);
  await assert.rejects(tools.execute(input), /Disk unavailable/);
  assert.deepEqual(tools.records(), [], "A failed reservation is not an unknown execution");
  assert.equal(executions, 0);
});

test("closing a native tool connection prevents queued calls while retaining an invoked result", async () => {
  const entered = Promise.withResolvers(), complete = Promise.withResolvers();
  let executions = 0;
  const catalog = createServiceToolCatalog(actionCatalog(async () => {
    executions++;
    entered.resolve();
    return complete.promise;
  }));
  const native = new AbortController();
  const tools = createConversationTools({ catalog, context, signal: new AbortController().signal,
    authorize: async () => {}, save: async () => {}, emit: async () => {} });
  const input = { ...call, name: catalog.resolveToolSet(context).tools[0].name };
  const first = tools.execute(input, { signal: native.signal });
  await entered.promise;
  const queued = tools.execute({ ...input, id: "queued" }, { signal: native.signal });
  native.abort(new Error("Native connection closed"));
  const rejected = assert.rejects(queued, /Native connection closed/);
  complete.resolve({ total: 5 });
  assert.deepEqual(await first, { ok: true, result: { total: 5 } });
  await rejected;
  assert.equal(executions, 1);
  assert.deepEqual(tools.records().map(({ id, status }) => ({ id, status })), [{ id: call.id, status: "complete" }]);
});

test("action validation failure is supplied as a tool result, never claimed as success", async t => {
  const f = await fixture(t, { response: (_body, round, name) => round === 1 ? new Response(frame({ tool_calls: [{
    index: 0, id: call.id, type: "function", function: { name, arguments: '{"left":"invalid","right":3}' }
  }] }) + frame({}, "tool_calls"), { headers: { "content-type": "text/event-stream" } }) : response({ text: "The operation failed." }) });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal(f.observed.executions.length, 0);
  assert.equal(result.conversationLog[0].metadata.applicationTools[0].result.ok, false);
  assert.deepEqual(JSON.parse(f.observed.requests[1].messages.at(-1).content), {
    error: result.conversationLog[0].metadata.applicationTools[0].result.error
  });
});

test("uncertain application results stop inference and remain uncertain on a repeated native call", async t => {
  const f = await fixture(t, { execute() { throw Object.assign(new Error("Acknowledgement lost"), { statusCode: 503 }); } });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  const turn = result.conversationLog[0];
  assert.equal(turn.metadata.runtime.status, "failed");
  assert.match(result.error, /Inspect its target/);
  assert.equal(turn.metadata.applicationTools[0].status, "unknown");
  assert.equal(f.observed.executions.length, 1);
  assert.equal(f.observed.requests.length, 1);
  const recovered = createConversationTools({ catalog: createServiceToolCatalog(actionCatalog(() => assert.fail("Do not repeat"))),
    context, previousCalls: turn.metadata.applicationTools, signal: new AbortController().signal,
    authorize: async () => {}, save: async () => {}, emit: async () => {} });
  await assert.rejects(recovered.execute({ ...call, name: f.name }), { code: "conversation_tool_outcome_unknown" });
});

test("API progress preceding a tool is commentary, separate from the final answer", async t => {
  const progress = "I will calculate the total.";
  const f = await fixture(t, { response: (_body, round, name) => round === 1 ? new Response(
    frame({ content: progress }) + frame({ tool_calls: [{ index: 0, id: call.id, type: "function", function: { name, arguments: call.arguments } }] }) + frame({}, "tool_calls"),
    { headers: { "content-type": "text/event-stream" } }) : response() });
  await f.conversation.send(message);
  const result = await f.conversation.wait();
  assert.equal(result.conversationLog[0].assistant.text, "The total is five.");
  assert.deepEqual(result.conversationLog[0].messages.filter(message => message.role === "commentary").map(message => message.text), [progress]);
  assert.ok(f.observed.events.some(event => event.type === "message" && event.role === "commentary" && event.status === "complete" && event.text === progress));
});

test("in-memory application calls require explicit transient ownership and never restore prior calls", async () => {
  let executions = 0;
  const catalog = createServiceToolCatalog(actionCatalog(async () => { executions++; return { total: 5 }; }));
  const options = { catalog, context, signal: new AbortController().signal };
  for (const missing of ["authorize", "save", "emit"]) {
    const hooks = { authorize: async () => {}, save: async () => {}, emit: async () => {} };
    delete hooks[missing];
    assert.throws(() => createConversationTools({ ...options, ...hooks }), /authorization, durable save and event/);
  }
  const tools = createConversationTools({ ...options, transient: true });
  const input = { ...call, name: catalog.resolveToolSet(context).tools[0].name };
  assert.deepEqual(await tools.execute(input), { ok: true, result: { total: 5 } });
  assert.deepEqual(await tools.execute(input), { ok: true, result: { total: 5 } });
  assert.equal(executions, 1);
  assert.equal(tools.records()[0].status, "complete");
  assert.throws(() => createConversationTools({ ...options, transient: true, previousCalls: tools.records() }), /cannot restore/);
});

test("strict application calls settle safe receipts before rethrowing the exact host exception", async () => {
  for (const transient of [false, true]) {
    for (const statusCode of [403, 503]) {
      const trace = [];
      let executions = 0;
      const failure = Object.assign(new Error("Original host failure"), {
        code: "host_failure", statusCode, privateState: "unserialized-host-state"
      });
      const catalog = createServiceToolCatalog(actionCatalog(async () => {
        trace.push("effect");
        executions++;
        throw failure;
      }));
      const saved = [];
      const tools = createConversationTools({ catalog, context, signal: new AbortController().signal,
        transient, propagateErrors: true,
        ...(!transient ? {
          authorize: async () => { trace.push("authorize"); },
          save: async calls => { saved.push(structuredClone(calls)); trace.push(`save:${calls[0].status}`); },
          emit: async event => { trace.push(`emit:${event.call.status}`); }
        } : {}) });
      const input = { ...call, name: catalog.resolveToolSet(context).tools[0].name };
      await assert.rejects(tools.execute(input), error => error === failure);
      const state = statusCode >= 500 ? "unknown" : "complete";
      assert.equal(tools.records()[0].status, state);
      assert.equal(tools.records()[0].result.error.code, "host_failure");
      assert.equal(JSON.stringify(tools.records()).includes("unserialized-host-state"), false);
      assert.equal(executions, 1);
      assert.deepEqual(trace, transient ? ["effect"] : [
        "authorize", "save:running", "emit:running", "authorize", "effect", `save:${state}`, `emit:${state}`
      ]);
      assert.equal(saved.length, transient ? 0 : 2);
      if (statusCode >= 500) {
        await assert.rejects(tools.execute(input), { code: "conversation_tool_outcome_unknown" });
        assert.equal(executions, 1);
      }
    }
  }
});
