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
