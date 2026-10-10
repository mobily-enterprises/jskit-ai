import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSchema } from "@jskit-ai/kernel/shared/validators";

import { runBoundedAssistantToolLoop } from "../src/server/lib/assistantToolLoop.js";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";
import { parseConversationOutput, validateConversationOutputSchema } from "../src/server/conversation/structuredOutput.js";

const policy = { maximumResponses: 4, timeoutMs: 90_000 };
const outputSchema = { type: "object", additionalProperties: false, required: ["answer"],
  properties: { answer: { type: "string", maxLength: 100 } } };
const finalResponse = result => ({ ok: true, text: JSON.stringify({ response: { kind: "final", result } }) });
const toolResponse = value => ({ ok: true, text: JSON.stringify({ response: {
  kind: "tool", name: "bounded_read", arguments: { value: String(value) }
} }) });

function promptValue(prompt) {
  const marker = "UNTRUSTED_APPLICATION_TOOL_RESULT_JSON_BEGIN\n";
  if (!prompt.includes(marker)) return prompt.split("\n\n")[0];
  return JSON.parse(prompt.split(marker)[1].split("\nUNTRUSTED_APPLICATION_TOOL_RESULT_JSON_END")[0]).result.prompt;
}

function boundedTools(execute) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "bounded.tools", domain: "bounded", actions: [{
    id: "bounded.read", version: 1, kind: "query", channels: ["automation"], surfaces: ["app"],
    permission: { require: "none" }, idempotency: "none",
    input: { schema: createSchema({ value: { type: "string", enum: ["1", "2", "3", "4"], required: true } }), mode: "replace" },
    output: { schema: createSchema({ prompt: { type: "string", required: true } }), mode: "replace" },
    execute({ value }, context) { return execute({ value: Number(value) }, context); }
  }] });
  return createServiceToolCatalog(actions);
}

function responseOptions(options) {
  assert.ok(options.outputSchema.properties.response.anyOf.length > 1);
  assert.doesNotThrow(() => validateConversationOutputSchema(options.outputSchema, { maxOutputCharacters: 1000 }));
  return { timeoutMs: options.timeoutMs };
}

test("bounded response policy accepts the fourth final response with the original per-response deadline", async () => {
  const trace = [];
  const responses = [{ step: 1 }, { step: 2 }, { step: 3 }, { answer: "Done" }];
  let completed = 0;
  const result = await runBoundedAssistantToolLoop({
    prompt: "Initial request", outputSchema, toolContext: { surface: "app" },
    toolCatalog: boundedTools(({ value }) => {
      trace.push({ operation: value });
      return { prompt: `Result ${value}` };
    }),
    policy,
    limitError: new Error("Limit reached"),
    async complete(prompt, options) {
      trace.push({ prompt: promptValue(prompt), options: responseOptions(options) });
      const response = responses[completed++];
      return response.answer ? finalResponse(response) : toolResponse(response.step);
    }
  });
  assert.deepEqual(result, responses[3]);
  assert.equal(completed, 4);
  assert.deepEqual(trace, [
    { prompt: "Initial request", options: { timeoutMs: 90_000 } },
    { operation: 1 },
    { prompt: "Result 1", options: { timeoutMs: 90_000 } },
    { operation: 2 },
    { prompt: "Result 2", options: { timeoutMs: 90_000 } },
    { operation: 3 },
    { prompt: "Result 3", options: { timeoutMs: 90_000 } }
  ]);
});

test("bounded response policy completes operation four before throwing the exact limit error without response five", async () => {
  const trace = [];
  const limitError = Object.assign(new Error("Original limit"), { code: "product_limit" });
  let completed = 0;
  await assert.rejects(runBoundedAssistantToolLoop({
    prompt: "Initial request", outputSchema, toolContext: { surface: "app" },
    toolCatalog: boundedTools(async ({ value }) => {
      trace.push(`operation:${value}`);
      await Promise.resolve();
      trace.push(`prompt:${value}`);
      return { prompt: `Result ${value}` };
    }),
    policy,
    limitError,
    async complete() {
      trace.push(`response:${++completed}`);
      return toolResponse(completed);
    }
  }), error => error === limitError);
  assert.equal(completed, 4);
  assert.deepEqual(trace, [
    "response:1", "operation:1", "prompt:1",
    "response:2", "operation:2", "prompt:2",
    "response:3", "operation:3", "prompt:3",
    "response:4", "operation:4", "prompt:4"
  ]);
});

test("bounded response policy preserves the first response exception without action or recovery", async () => {
  const failure = new Error("Original provider failure");
  let completed = 0;
  await assert.rejects(runBoundedAssistantToolLoop({
    prompt: "Initial request", outputSchema, toolContext: { surface: "app" },
    toolCatalog: boundedTools(() => assert.fail("A failed response must not execute an action")),
    policy,
    limitError: new Error("Limit reached"),
    async complete() {
      completed++;
      throw failure;
    }
  }), error => error === failure);
  assert.equal(completed, 1);
});

test("bounded response policy preserves action and result-prompt errors even on response four", async () => {
  for (const failureRound of [1, 4]) {
    const failure = new Error("Original action or result-bound failure");
    let completed = 0;
    let operations = 0;
    await assert.rejects(runBoundedAssistantToolLoop({
      prompt: "Initial request", outputSchema, toolContext: { surface: "app" },
      toolCatalog: boundedTools(({ value }) => {
        operations++;
        if (value === failureRound) throw failure;
        return { prompt: `Result ${value}` };
      }),
      policy,
      limitError: new Error("Limit reached"),
      async complete() { return toolResponse(++completed); }
    }), error => error === failure);
    assert.equal(completed, failureRound);
    assert.equal(operations, failureRound);
  }
});

test("bounded response policy checks abort before inference and after its identity capture before response policy", async () => {
  const controller = new AbortController();
  const reason = new Error("Cancelled");
  const trace = [];
  await assert.rejects(runBoundedAssistantToolLoop({
    prompt: "Initial request", outputSchema, toolContext: { surface: "app" },
    toolCatalog: boundedTools(() => assert.fail("Abort must precede response parsing or action execution")),
    signal: controller.signal,
    policy,
    limitError: new Error("Limit reached"),
    async complete() {
      trace.push("native identity captured");
      controller.abort(reason);
      return { ok: false };
    }
  }), error => error === reason);
  assert.deepEqual(trace, ["native identity captured"]);
  await assert.rejects(runBoundedAssistantToolLoop({
    prompt: "Initial request", outputSchema, toolContext: { surface: "app" },
    toolCatalog: boundedTools(() => assert.fail("An aborted request must not execute an action")),
    signal: controller.signal,
    policy,
    limitError: new Error("Limit reached"),
    async complete() { assert.fail("An aborted request must not start inference"); }
  }), error => error === reason);
});

test("bounded response policy retains the original action-abort versus exhaustion precedence", async () => {
  for (const abortRound of [1, 4]) {
    const controller = new AbortController();
    const reason = new Error("Cancelled during action");
    const limitError = new Error("Original limit");
    let completed = 0;
    await assert.rejects(runBoundedAssistantToolLoop({
      prompt: "Initial request", outputSchema, toolContext: { surface: "app" },
      toolCatalog: boundedTools(({ value }) => {
        if (value === abortRound) controller.abort(reason);
        return { prompt: `Result ${value}` };
      }),
      signal: controller.signal,
      policy,
      limitError,
      async complete() { return toolResponse(++completed); }
    }), error => error === (abortRound === 4 ? limitError : reason));
    assert.equal(completed, abortRound);
  }
});

test("bounded tools use the existing catalogue once per response and never execute for a final response", async () => {
  const trace = [];
  const actor = { id: "captured-actor" };
  const catalog = boundedTools(async ({ value }, context) => {
    assert.deepEqual(context.actor, actor);
    assert.equal(context.channel, "automation");
    trace.push(`operation:${value}`);
    return { prompt: `Result ${value}` };
  });
  let toolSets = 0;
  let completed = 0;
  const result = await runBoundedAssistantToolLoop({ prompt: "Initial", outputSchema, policy, limitError: new Error("Limit"),
    toolContext: { actor, surface: "app" },
    toolCatalog: { ...catalog,
      resolveToolSet(...args) { toolSets++; return catalog.resolveToolSet(...args); },
      async executeToolCall(...args) {
        const result = await catalog.executeToolCall(...args);
        assert.equal(result.ok, true);
        return result;
      }
    },
    async complete(prompt, options) {
      assert.deepEqual(responseOptions(options), { timeoutMs: 90_000 });
      trace.push(`response:${++completed}:${promptValue(prompt)}`);
      return completed === 4 ? finalResponse({ answer: "4" }) : toolResponse(completed);
    }
  });
  assert.deepEqual(result, { answer: "4" });
  assert.equal(toolSets, 4);
  assert.deepEqual(trace, ["response:1:Initial", "operation:1", "response:2:Result 1", "operation:2",
    "response:3:Result 2", "operation:3", "response:4:Result 3"]);
});

test("bounded tools preserve a fourth-operation host exception without another response", async () => {
  const failure = Object.assign(new Error("Original query failure"), { statusCode: 503 });
  let completed = 0;
  let executions = 0;
  const catalog = boundedTools(async ({ value }) => {
    executions++;
    if (value === 4) throw failure;
    return { prompt: `Result ${value}` };
  });
  await assert.rejects(runBoundedAssistantToolLoop({ prompt: "Initial", outputSchema, policy, limitError: new Error("Limit"),
    toolCatalog: catalog, toolContext: { surface: "app" },
    async complete() { return toolResponse(++completed); }
  }), error => error === failure);
  assert.equal(completed, 4);
  assert.equal(executions, 4);
});

test("bounded tools retain the original successful-operation abort versus exhaustion precedence", async () => {
  for (const abortRound of [1, 4]) {
    const controller = new AbortController();
    const reason = new Error("Cancelled during operation");
    const limitError = new Error("Original limit");
    let completed = 0;
    let executions = 0;
    const catalog = boundedTools(async ({ value }) => {
      executions++;
      if (value === abortRound) controller.abort(reason);
      return { prompt: `Result ${value}` };
    });
    await assert.rejects(runBoundedAssistantToolLoop({ prompt: "Initial", outputSchema, policy, signal: controller.signal, limitError,
      toolCatalog: catalog, toolContext: { surface: "app" },
      async complete() { return toolResponse(++completed); }
    }), error => error === (abortRound === 4 ? limitError : reason));
    assert.equal(completed, abortRound);
    assert.equal(executions, abortRound);
  }
});

test("bounded structured alternatives keep exact output bounds and reject open or ambiguous replies", () => {
  const branch = (kind, maxLength) => ({ type: "object", additionalProperties: false, required: ["kind", "value"],
    properties: { kind: { type: "string", enum: [kind] }, value: { type: "string", maxLength } } });
  const schema = { type: "object", additionalProperties: false, required: ["response"],
    properties: { response: { anyOf: [branch("first", 1), branch("second", 2)] } } };
  const maximum = JSON.stringify({ response: { kind: "second", value: "\u0000\u0000" } }).length;
  assert.doesNotThrow(() => validateConversationOutputSchema(schema, { maxOutputCharacters: maximum }));
  assert.throws(() => validateConversationOutputSchema(schema, { maxOutputCharacters: maximum - 1 }),
    /exceed the resolved output limit/u);
  assert.deepEqual(parseConversationOutput('{"response":{"kind":"first","value":"x"}}', schema),
    { response: { kind: "first", value: "x" } });
  for (const value of [
    { response: { kind: "first", value: "xx" } },
    { response: { kind: "unknown", value: "x" } },
    { response: { kind: "first", value: "x", result: "ambiguous" } }
  ]) assert.throws(() => parseConversationOutput(JSON.stringify(value), schema), /invalid structured response/u);
  const open = structuredClone(schema);
  open.properties.response.anyOf[1].additionalProperties = true;
  assert.throws(() => validateConversationOutputSchema(open, { maxOutputCharacters: maximum }), /reject additional properties/u);
  const empty = structuredClone(schema);
  empty.properties.response.anyOf = [];
  assert.throws(() => validateConversationOutputSchema(empty, { maxOutputCharacters: maximum }), /closed object alternatives/u);
  assert.throws(() => validateConversationOutputSchema(schema.properties.response, { maxOutputCharacters: maximum }),
    /below its root/u);
  let deep = schema;
  for (let index = 0; index < 8; index++) deep = { type: "object", additionalProperties: false,
    required: ["nested"], properties: { nested: deep } };
  assert.throws(() => validateConversationOutputSchema(deep, { maxOutputCharacters: 16_000 }), /nested too deeply/u);
});

// Original fixed-envelope policy: Public 869ebb69 protocol.js:7–39 and
// colleague/service.js:221–224,364–431. Existing default assertions above stay intact.
import { readAssistantResponseEnvelope, readPartialAssistantReply } from "../src/server/lib/assistantToolLoop.js";
import { createConversationTools } from "../src/server/conversation/tools.js";

const envelopeReply = text => JSON.stringify({ kind: "reply", text, toolName: "", arguments: "" });
const envelopeTool = (text = "") => JSON.stringify({ kind: "tool", text, toolName: "bounded_read", arguments: '{"value":"1"}' });
const envelopeCall = value => JSON.stringify({ kind: "tool", text: "", toolName: "bounded_read", arguments: JSON.stringify({ value }) });
const envelopePolicy = { maximumResponses: 24, timeoutMs: 90_000 };
const useEnvelope = ({ phase }) => phase === "before-parse" ? "use" : "end";

function durableEnvelopeTools({ effect = () => ({ prompt: "Verified" }), authorize = () => {}, prepareContext,
  save = () => {}, emit = () => {}, propagateErrors = false, previousCalls = [] } = {}) {
  return createConversationTools({ catalog: boundedTools(effect), context: { actor: { id: "captured" }, surface: "app" },
    signal: new AbortController().signal, authorize, prepareContext, save, emit, propagateErrors, previousCalls });
}

function envelopeLoop(options) {
  let completed = 0;
  return runBoundedAssistantToolLoop({ prompt: "Product-owned prompt", policy: envelopePolicy,
    completedEnvelope: true, settle: useEnvelope, limitError: new Error("Original 24-response limit"),
    invalidResponseError: new Error("Original invalid response"), ...options,
    async complete(...args) {
      // Fixture identities stand for distinct verified completed native responses.
      const result = await options.complete(...args);
      return { toolCallId: `completed-response-${++completed}`, ...result };
    } });
}

test("fixed envelope mode requires its original lifetime policy and explicit application settlement", async () => {
  for (const options of [{ policy }, { settle: undefined }]) {
    await assert.rejects(envelopeLoop({ ...options, complete() { assert.fail("Do not infer with an invalid mode contract"); } }),
      /24 responses and application settlement/u);
  }
  await assert.rejects(envelopeLoop({ completedEnvelope: "yes", complete() { assert.fail("Do not infer"); } }), /must be a boolean/u);
});

test("fixed envelopes preserve decoded reply, progress, name and string-argument bounds", () => {
  assert.equal(readAssistantResponseEnvelope(envelopeReply("x".repeat(16000))).text.length, 16000);
  assert.throws(() => readAssistantResponseEnvelope(envelopeReply("x".repeat(16001))), /Invalid assistant response/u);
  assert.equal(readAssistantResponseEnvelope(envelopeTool("x".repeat(280))).text.length, 280);
  assert.throws(() => readAssistantResponseEnvelope(envelopeTool("x".repeat(281))), /progress text/u);
  const value = { kind: "tool", text: "", toolName: "x".repeat(256), arguments: "x".repeat(262144) };
  assert.equal(readAssistantResponseEnvelope(JSON.stringify(value)).arguments.length, 262144);
  for (const invalid of [{ ...value, toolName: "x".repeat(257) }, { ...value, arguments: "x".repeat(262145) },
    { ...value, arguments: {} }, { ...value, extra: true }, [], { kind: "reply", text: "" },
    { kind: "reply", text: "hello", toolName: "hidden" }]) {
    assert.throws(() => readAssistantResponseEnvelope(JSON.stringify(invalid)));
  }
});

// Body moved from frozen vibe64Colleague.unit.test.js:161–173; generic names only.
test("fixed envelopes decode only reply text, including every split inside JSON escapes", () => {
  const text = 'Hello "there"!\n\\path 🐈 café';
  const encoded = envelopeReply(text).replace("🐈", "\\ud83d\\udc08").replace("é", "\\u00e9");
  for (let end = 0; end <= encoded.length; end += 1) {
    const partial = readPartialAssistantReply(encoded.slice(0, end));
    assert.ok(text.startsWith(partial), JSON.stringify(partial));
    assert.doesNotMatch(partial, /[\uD800-\uDBFF]$/);
  }
  assert.equal(readPartialAssistantReply(encoded), text);
  for (const hidden of [envelopeCall("private arguments"), '{"kind":"tool","text":"secret', 'Thinking first', '{"text":"unknown kind']) {
    assert.equal(readPartialAssistantReply(hidden), "");
  }
});

test("fixed envelope mode passes finite fixed wire fields and actual prior tool results to the product completion", async () => {
  const traces = [];
  let calls = 0;
  const tools = durableEnvelopeTools({ effect({ value }, context) {
    assert.equal(context.actor.id, "captured");
    return { prompt: `Result ${value}` };
  }, save(records) { traces.push(records.map(record => record.status)); } });
  const result = await envelopeLoop({ async complete(prompt, options) {
    assert.equal(prompt, "Product-owned prompt");
    assert.equal(options.timeoutMs, 90_000);
    const properties = options.outputSchema.properties;
    assert.equal(properties.text.maxLength, 16000);
    assert.equal(properties.toolName.maxLength, 256);
    assert.equal(properties.arguments.maxLength, 262144);
    if (++calls === 1) {
      assert.equal(options.previousResponse, undefined);
      return { text: envelopeTool(), tools };
    }
    assert.equal(options.previousResponse.kind, "tool");
    assert.equal(options.previousResponse.arguments, '{"value":"1"}');
    assert.equal(options.previousResponse.result.ok, true);
    assert.equal(options.previousResponse.result.result.prompt, "Result 1");
    return { text: envelopeReply("Done") };
  } });
  assert.equal(result, "Done");
  assert.deepEqual(traces, [["running"], ["complete"]]);
});

test("fixed envelope response 24 executes its effect before the exact limit error and never starts response 25", async () => {
  let responses = 0;
  let effects = 0;
  const limitError = new Error("Original limit");
  await assert.rejects(envelopeLoop({ limitError, async complete() {
    responses++;
    return { text: envelopeTool(), tools: durableEnvelopeTools({ effect() { effects++; return { prompt: "Done" }; } }) };
  } }), error => error === limitError);
  assert.equal(responses, 24);
  assert.equal(effects, 24);
});

test("superseded malformed completed responses consume response slots before parsing without spending invalid allowance", async () => {
  let responses = 0;
  let effects = 0;
  const limitError = new Error("Original limit");
  await assert.rejects(envelopeLoop({ limitError, settle: () => "continue", async complete() {
    responses++;
    return { text: "malformed obsolete response", tools: durableEnvelopeTools({ effect() { effects++; } }) };
  } }), error => error === limitError);
  assert.equal(responses, 24);
  assert.equal(effects, 0);
});

test("invalid allowance is cumulative across valid effects and discarded pending responses", async () => {
  const replies = ["malformed", envelopeTool(), "obsolete malformed", "malformed again", envelopeTool(), "third malformed"];
  let responses = 0;
  let effects = 0;
  const invalidResponseError = new Error("Original third-invalid failure");
  await assert.rejects(envelopeLoop({ invalidResponseError,
    settle: ({ phase }) => phase === "before-parse" && responses === 3 ? "continue" : "use",
    async complete(_prompt, options) {
      if ([2, 5].includes(responses + 1)) assert.deepEqual(options.previousResponse, { kind: "invalid", nativeToolAttempt: false });
      return { text: replies[responses++], tools: durableEnvelopeTools({ effect() { effects++; return { prompt: "Verified" }; } }) };
    }
  }), error => error === invalidResponseError);
  assert.equal(responses, 6);
  assert.equal(effects, 2);
});

test("native application-tool misroutes invalidate replies but permit corrected completed tool envelopes and StructuredOutput replies", async () => {
  let responses = 0;
  let effects = 0;
  const result = await envelopeLoop({ async complete(_prompt, options) {
    responses++;
    if (responses === 1) return { text: envelopeReply("False outage"), nativeToolAttempt: true };
    if (responses === 2) {
      assert.deepEqual(options.previousResponse, { kind: "invalid", nativeToolAttempt: true });
      return { text: envelopeTool(), nativeToolAttempt: true,
        tools: durableEnvelopeTools({ effect() { effects++; return { prompt: "Verified" }; } }) };
    }
    return { text: envelopeReply("Verified answer"), nativeToolAttempt: false };
  } });
  assert.equal(result, "Verified answer");
  assert.equal(effects, 1);
  assert.equal(responses, 3);
});

test("late pending admission after decoded final persistence continues inside the same response budget", async t => {
  const admission = Promise.withResolvers();
  const entered = Promise.withResolvers();
  t.after(() => admission.resolve());
  const saved = [];
  let responses = 0;
  const run = envelopeLoop({ async complete() {
    return { text: envelopeReply(++responses === 1 ? "First answer" : "Latest answer") };
  }, async settle({ phase, response }) {
    if (phase === "before-parse") return "use";
    saved.push(response.text);
    if (saved.length === 1) { entered.resolve(); await admission.promise; return "continue"; }
    return "end";
  } });
  await entered.promise;
  assert.equal(responses, 1, "The next native response waits for the original app admission tail");
  admission.resolve();
  assert.equal(await run, "Latest answer");
  assert.equal(responses, 2);
  assert.deepEqual(saved, ["First answer", "Latest answer"]);
});

test("settlement refuses unknown decisions before effects and final return", async () => {
  for (const final of [false, true]) {
    let effects = 0;
    await assert.rejects(envelopeLoop({ async complete() {
      return { text: final ? envelopeReply("Do not finish") : envelopeTool(),
        tools: durableEnvelopeTools({ effect() { effects++; } }) };
    }, settle: ({ phase }) => final && phase === "before-parse" ? "use" : "unexpected" }), /Invalid completed-response settlement/u);
    assert.equal(effects, 0);
  }
});

test("completed envelope mode preserves abort before settlement and effects", async () => {
  for (const stage of ["completion", "settlement"]) {
    const controller = new AbortController();
    const reason = new Error("Original cancellation");
    let effects = 0;
    await assert.rejects(envelopeLoop({ signal: controller.signal, async complete() {
      if (stage === "completion") controller.abort(reason);
      return { text: envelopeTool(), tools: durableEnvelopeTools({ effect() { effects++; } }) };
    }, settle() {
      assert.equal(stage, "settlement", "Completion cancellation precedes any settlement");
      controller.abort(reason);
      return "use";
    } }), error => error === reason);
    assert.equal(effects, 0);
  }
});

test("completed operations require supplied tools and retain sealed request refusal without effect or new reservation", async () => {
  await assert.rejects(envelopeLoop({ async complete() { return { text: envelopeTool() }; } }), /current durable tools/u);
  const retired = new Error("The original request is sealed");
  let effects = 0;
  let saves = 0;
  const tools = durableEnvelopeTools({ prepareContext() { throw retired; }, effect() { effects++; }, save() { saves++; } });
  await assert.rejects(envelopeLoop({ async complete() { return { text: envelopeTool(), tools }; } }), error => error === retired);
  assert.equal(effects, 0);
  assert.equal(saves, 0);
});

test("completed effect preserves the original host error and rechecks fresh authorization after durable reservation", async () => {
  const failure = new Error("Original effect error");
  await assert.rejects(envelopeLoop({ async complete() {
    return { text: envelopeTool(), tools: durableEnvelopeTools({ effect() { throw failure; }, propagateErrors: true }) };
  } }), error => error === failure);
  const revoked = new Error("Original actor no longer authorized");
  let eligible = true;
  let effects = 0;
  const statuses = [];
  const tools = durableEnvelopeTools({ authorize() { if (!eligible) throw revoked; }, effect() { effects++; },
    save(records) { statuses.push(records.at(-1).status); eligible = false; } });
  await assert.rejects(envelopeLoop({ async complete() { return { text: envelopeTool(), tools }; } }), error => error === revoked);
  assert.equal(effects, 0);
  assert.deepEqual(statuses, ["running", "not-executed"]);
});

test("unknown completed effect stops the bounded loop and its durable receipt cannot replay the effect", async () => {
  let responses = 0;
  let effects = 0;
  const tools = durableEnvelopeTools({ effect() {
    effects++;
    throw Object.assign(new Error("Receipt was lost after execution"), { statusCode: 503 });
  } });
  await assert.rejects(envelopeLoop({ async complete() { responses++; return { text: envelopeTool(), tools }; } }),
    error => error.code === "conversation_tool_outcome_unknown");
  assert.equal(responses, 1);
  assert.equal(effects, 1);
  const receipt = tools.records()[0];
  assert.equal(receipt.status, "unknown");
  await assert.rejects(tools.execute({ id: receipt.id, name: receipt.name, arguments: receipt.arguments }),
    error => error.code === "conversation_tool_outcome_unknown");
  assert.equal(effects, 1);
});


test("oversized completed tool progress is corrected before any reservation and valid progress executes once", async () => {
  let responses = 0;
  let effects = 0;
  let reservations = 0;
  const result = await envelopeLoop({ async complete(_prompt, options) {
    responses++;
    if (responses === 3) return { text: envelopeReply("Done") };
    if (responses === 2) assert.deepEqual(options.previousResponse, { kind: "invalid", nativeToolAttempt: false });
    return { text: envelopeTool("x".repeat(responses === 1 ? 281 : 280)),
      tools: durableEnvelopeTools({ effect() { effects++; return { prompt: "Verified" }; },
        save(records) { if (records.at(-1).status === "running") reservations++; } }) };
  } });
  assert.equal(result, "Done");
  assert.equal(effects, 1);
  assert.equal(reservations, 1);
});


test("third invalid envelope selects the product error from the current native fact only once", async () => {
  const malformed = new Error("Original malformed-response failure");
  const misrouted = new Error("Original native-tool-response failure");
  for (const nativeToolAttempt of [false, true]) {
    let responses = 0;
    const selectedFacts = [];
    await assert.rejects(envelopeLoop({ invalidResponseError(fact) {
      selectedFacts.push(fact);
      return fact.nativeToolAttempt ? misrouted : malformed;
    }, async complete() {
      responses++;
      return responses === 3
        ? { text: nativeToolAttempt ? envelopeReply("False outage") : "malformed", nativeToolAttempt }
        : { text: "malformed", nativeToolAttempt: !nativeToolAttempt };
    } }), error => error === (nativeToolAttempt ? misrouted : malformed));
    assert.equal(responses, 3);
    assert.deepEqual(selectedFacts, [{ nativeToolAttempt }]);
  }
});

test("opt-in third-invalid error factory must return an Error", async () => {
  let calls = 0;
  await assert.rejects(envelopeLoop({ invalidResponseError() { calls++; return "not an Error"; },
    async complete() { return { text: "malformed" }; } }), /Invalid response error must be an Error/u);
  assert.equal(calls, 1);
});


test("completed application operations refuse absent or invalid verified response call ids before reservation", async () => {
  for (const toolCallId of [undefined, "", "x".repeat(257), 42]) {
    let effects = 0;
    let saves = 0;
    const tools = durableEnvelopeTools({ effect() { effects++; }, save() { saves++; } });
    await assert.rejects(envelopeLoop({ async complete() { return { text: envelopeTool(), tools, toolCallId }; } }),
      /verified response call id/u);
    assert.equal(effects, 0);
    assert.equal(saves, 0);
  }
});

test("recovered completed response reuses its restored durable call id without repeating the effect or accepting changed arguments", async () => {
  const toolCallId = "verified-native-response-1:application-operation";
  let effects = 0;
  const initialTools = durableEnvelopeTools({ effect() { effects++; return { prompt: "Verified once" }; } });
  const run = tools => {
    let responses = 0;
    return envelopeLoop({ async complete() {
      return ++responses === 1 ? { text: envelopeTool(), tools, toolCallId } : { text: envelopeReply("Done") };
    } });
  };
  assert.equal(await run(initialTools), "Done");
  const previousCalls = initialTools.records();
  assert.equal(previousCalls[0].id, toolCallId);
  assert.equal(previousCalls[0].status, "complete");
  const restoredTools = durableEnvelopeTools({ previousCalls,
    effect() { assert.fail("Recovery must use the saved verified result"); } });
  assert.equal(await run(restoredTools), "Done");
  assert.equal(effects, 1);
  const changedTools = durableEnvelopeTools({ previousCalls,
    effect() { assert.fail("A response id cannot authorize changed arguments"); } });
  const changed = JSON.stringify({ kind: "tool", text: "", toolName: "bounded_read", arguments: '{"value":"2"}' });
  await assert.rejects(envelopeLoop({ async complete() { return { text: changed, tools: changedTools, toolCallId }; } }),
    /already belongs to different arguments/u);
  assert.equal(effects, 1);
});
