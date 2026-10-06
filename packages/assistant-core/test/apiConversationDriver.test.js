import assert from "node:assert/strict";
import test from "node:test";
import { createApiConversationDriver } from "../src/server/conversation/providers/api.js";

const frame = (delta, finish_reason) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const schema = tool => ({ type: "function", function: { name: tool.name, parameters: tool.parameters } });
function fixture({ response, execute, descriptors = [{ name: "action_execute", parameters: { type: "object" } }],
  authorize = () => {}, limits } = {}) {
  const requests = [], executions = [], messages = [];
  let accepted = false;
  const driver = createApiConversationDriver({ limits, connections: { resolve: async () => {
    await authorize();
    return { providerId: "test", model: "exact-model", sdkPackage: "@ai-sdk/openai-compatible",
      apiKey: "test", baseURL: "http://test.invalid/v1" };
  } }, fetch: (_url, request) => {
    requests.push(JSON.parse(request.body));
    const value = response(requests.length);
    return new Response(frame(value.call ? { tool_calls: [{ index: 0, id: `call_${requests.length}`,
      function: { name: value.call, arguments: "{}" } }] } : { content: value.text }, value.call ? "tool_calls" : "stop"),
    { headers: { "content-type": "text/event-stream" } });
  } });
  return { requests, executions, messages, run: (text = "Complete the task.") => driver.run({
    configuration: { systemPrompt: "Use the supplied actions.", integrationId: "assistant" },
    context: { subjectId: "owner" }, input: { messageId: "request", text }, history: [],
    signal: new AbortController().signal, beforeDispatch: async () => {}, accept: async () => { accepted = true; },
    onMessage: async message => { messages.push(message); },
    tools: { descriptors, schemas: descriptors.map(schema), maximumArgumentBytes: 32768,
      async execute(input) {
        assert.equal(accepted, true, "Preflight and ordinary actions require prior admission");
        executions.push(input);
        return execute?.(input, executions.length) ?? { ok: true, result: { sequence: executions.length } };
      }
    }
  }) };
}

// Original assistant-runtime exhaustion assertions, using the actual API driver
// and confirmed provider framing instead of its former private loop harness.
test("the API owner preserves sixteen tool rounds and three recovery passes", async () => {
  const f = fixture({ response: round => round <= 16 ? { call: "action_execute" } : { text: "Let me prepare the answer." } });
  await f.run();
  assert.equal(f.executions.length, 16);
  assert.equal(f.requests.length, 19);
  assert.deepEqual(f.messages.filter(message => message.complete && message.role === "assistant").map(message => message.text),
    ["Limit reached. Start a new conversation."]);
  assert.equal(new Set(f.messages.filter(message => message.complete).map(message => message.id)).size, 4,
    "Recovery commentary and the final answer retain independent identities");
});

test("clock preflight is admitted before execution and precedes model inference", async () => {
  const descriptors = [{ name: "workspace_clock", parameters: { type: "object", properties: {} }, preflight: ["current-time"] }];
  const f = fixture({ descriptors, response: () => ({ text: "It is Tuesday." }),
    execute: () => ({ ok: true, result: { timeZone: "Australia/Perth" } }) });
  await f.run("What day is it today?");
  assert.deepEqual(f.executions.map(call => call.name), ["workspace_clock"]);
  assert.equal(f.requests[0].messages.some(message => message.role === "tool" && /Australia\/Perth/.test(message.content)), true);
  const denied = fixture({ descriptors, authorize: () => { throw new Error("Connection access revoked"); } });
  await assert.rejects(denied.run("What time is it now?"), /Connection access revoked/);
  assert.deepEqual(denied.executions, []);
  assert.deepEqual(denied.requests, []);
  const bounded = fixture({ descriptors, limits: { maxHistoryCharacters: 10 } });
  await assert.rejects(bounded.run("What time is it now?"), /history limit/);
  assert.deepEqual(bounded.executions, []);
});

test("unknown tool outcomes never enter ordinary failure recovery or request another action", async () => {
  const f = fixture({ response: () => ({ call: "action_execute" }), execute: () => {
    throw Object.assign(new Error("Inspect the interrupted action"), { code: "conversation_tool_outcome_unknown" });
  } });
  await assert.rejects(f.run(), { code: "conversation_tool_outcome_unknown" });
  assert.equal(f.executions.length, 1);
  assert.equal(f.requests.length, 1);
});
