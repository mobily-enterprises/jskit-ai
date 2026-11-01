import assert from "node:assert/strict";
import test from "node:test";
import { checkTexts } from "@jskit-ai/agent/server";
import { createApiConversationDriver } from "../src/server/conversation/providers/api.js";

const CHECKS = checkTexts("the app");
const frame = (delta, finish_reason) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
const schema = tool => ({ type: "function", function: { name: tool.name, parameters: tool.parameters } });
const lastText = body => body.messages.at(-1).content;

// One step of a streamed reply: words, an action call or both. Calls the engine
// makes without streaming (accounts, checks, summaries) answer with `once`.
function fixture({ reply = () => ({ text: "Done." }), once = () => "Done.", execute, failure,
  descriptors = [{ name: "action_execute", parameters: { type: "object" } }], authorize = () => {}, limits } = {}) {
  const requests = [], streamed = [], executions = [], messages = [], order = [];
  let accepted = false;
  const driver = createApiConversationDriver({ limits, connections: { resolve: async () => {
    await authorize();
    return { providerId: "test", model: "exact-model", sdkPackage: "@ai-sdk/openai-compatible",
      apiKey: "test", baseURL: "http://test.invalid/v1" };
  } }, fetch: (_url, request) => {
    const body = JSON.parse(request.body);
    requests.push(body);
    order.push("model");
    if (failure) return failure(requests.length, request);
    if (!body.stream) {
      return Response.json({ choices: [{ index: 0, message: { role: "assistant", content: once(body) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    streamed.push(body);
    const value = reply(streamed.length, body, request);
    if (value instanceof Promise) return value;
    const call = value.call ? frame({ tool_calls: [{ index: 0, id: value.id || `call_${streamed.length}`,
      function: { name: value.call, arguments: JSON.stringify(value.input || {}) } }] }, "tool_calls") : "";
    return new Response((value.text ? frame({ content: value.text }, call ? undefined : "stop") : "") + call,
      { headers: { "content-type": "text/event-stream" } });
  } });
  return { requests, streamed, executions, messages, order, run: (text = "Complete the task.", options = {}) => driver.run({
    configuration: { systemPrompt: "Use the supplied actions.", integrationId: "assistant" },
    context: { subjectId: "owner" }, input: { messageId: "request", text }, history: [],
    signal: new AbortController().signal, beforeDispatch: async () => {}, accept: async () => { accepted = true; order.push("accept"); },
    onMessage: async message => { messages.push(message); },
    tools: descriptors && { descriptors, schemas: descriptors.map(schema), maximumArgumentBytes: 32768,
      async execute(input) {
        assert.equal(accepted, true, "Actions require prior admission");
        executions.push(input);
        return execute?.(input, executions.length) ?? { ok: true, result: { sequence: executions.length } };
      }
    },
    ...options
  }) };
}

test("each step streams as reply-N, a step with actions ends as commentary and the last step answers", async () => {
  const f = fixture({ reply: round => round === 1 ? { text: "Checking the bookings.", call: "action_execute" } : { text: "You have 3 bookings." } });
  const result = await f.run();
  assert.deepEqual(f.messages.map(({ id, role, complete }) => [id, role, complete]), [
    ["reply-1", "assistant", false], ["reply-1", "commentary", true], ["reply-2", "assistant", false], ["reply-2", "assistant", true]
  ]);
  // The answer leaves out the words already shown as commentary.
  assert.equal(f.messages.at(-1).text, "You have 3 bookings.");
  const quiet = fixture({ reply: round => round === 1 ? { text: "Checking the bookings.", call: "action_execute" } : { text: " " } });
  await quiet.run();
  assert.equal(quiet.messages.at(-1).text, "Checking the bookings.", "Commentary that is all there is stays the answer");
  assert.equal(f.streamed[1].messages.find(message => message.role === "tool").content, JSON.stringify({ sequence: 1 }));
  assert.deepEqual(result, { metadata: {} });
});

test("every action goes through the application receipt with a per-step id and its arguments", async () => {
  const f = fixture({ reply: round => round < 3 ? { call: "action_execute", id: "call_0", input: { round } } : { text: "Both are saved." },
    once: () => JSON.stringify({ unsupported: [] }) });
  await f.run();
  assert.deepEqual(f.executions, [
    { id: "reply-1:call_0", name: "action_execute", arguments: JSON.stringify({ round: 1 }) },
    { id: "reply-2:call_0", name: "action_execute", arguments: JSON.stringify({ round: 2 }) }
  ]);
  const failed = fixture({ reply: round => round === 1 ? { call: "action_execute" } : { text: "It could not run." },
    execute: () => ({ ok: false, error: { code: "action_failed", message: "Not allowed" } }) });
  await failed.run();
  assert.equal(failed.streamed[1].messages.find(message => message.role === "tool").content,
    JSON.stringify({ error: { code: "action_failed", message: "Not allowed" } }), "A failed action reaches the model as its error");
});

test("admission precedes every model call, the state note gives the time, and a denied connection calls nothing", async () => {
  const f = fixture();
  await f.run("What day is it today?");
  assert.deepEqual(f.order, ["accept", "model"]);
  assert.deepEqual(f.executions, [], "The state note's time replaces the former clock preflight");
  assert.match(f.requests[0].messages[0].content, /^Use the supplied actions\.\n\nCurrent state, from the system\. It is the truth; earlier messages may be out of date:\n- The time: .+ UTC\. The person may be in another time zone\.$/u);
  const denied = fixture({ authorize: () => { throw new Error("Connection access revoked"); } });
  await assert.rejects(denied.run(), /Connection access revoked/);
  assert.deepEqual(denied.requests, []);
  let calls = 0;
  const revoked = fixture({ authorize: () => { if (++calls > 1) throw new Error("Connection access revoked"); },
    reply: () => ({ call: "action_execute" }) });
  await assert.rejects(revoked.run(), /Connection access revoked/);
  assert.equal(revoked.requests.length, 1, "Each later model call authorizes the connection again");
  assert.equal(revoked.executions.length, 1);
});

test("unknown tool outcomes never enter ordinary failure recovery or request another action", async () => {
  const f = fixture({ reply: () => ({ call: "action_execute" }), execute: () => {
    throw Object.assign(new Error("Inspect the interrupted action"), { code: "conversation_tool_outcome_unknown" });
  } });
  await assert.rejects(f.run(), { code: "conversation_tool_outcome_unknown" });
  assert.equal(f.executions.length, 1);
  assert.equal(f.requests.length, 1);
});

test("cancelling ends the reply with the signal's reason and no answer", async () => {
  const controller = new AbortController();
  const f = fixture({ reply: (_round, _body, request) => {
    queueMicrotask(() => controller.abort(Object.assign(new Error("Stopped by the person"), { code: "stopped" })));
    return new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }));
  } });
  await assert.rejects(f.run("Work on it.", { signal: controller.signal }), { code: "stopped" });
  assert.equal(f.requests.length, 1);
  assert.equal(f.messages.some(message => message.complete), false);
});

test("raw markup in a reply carries on once, told that nothing in it ran", async () => {
  const f = fixture({ reply: () => ({ text: "<invoke name=\"action_execute\"></invoke>" }) });
  const result = await f.run();
  assert.equal(f.streamed.length, 2, "The check sends the reply back once");
  assert.equal(lastText(f.streamed[1]), CHECKS.markup);
  assert.equal(f.messages.some(message => message.complete && message.role === "assistant"), false, "People never see the markup");
  assert.equal(result.metadata.check, "markup");
});

test("a reply that stops at announcing its next step carries on once", async () => {
  const f = fixture({ reply: round => ({ text: round === 1 ? "Let me check that." : "Here is the result: 3 bookings." }) });
  await f.run();
  assert.equal(f.streamed.length, 2);
  assert.equal(lastText(f.streamed[1]), CHECKS.stoppedShort);
  assert.equal(f.streamed[1].messages.some(message => message.content === "Let me check that."), false, "Its closing words are dropped");
  assert.deepEqual(f.messages.filter(message => message.complete).map(message => [message.id, message.text]),
    [["reply-2", "Here is the result: 3 bookings."]]);
});

test("a claim no action supports carries on once with what was claimed", async () => {
  const f = fixture({ reply: round => round === 1 ? { text: "I've created the booking." } : round === 2 ? { call: "action_execute" } : { text: "The booking is in." },
    once: body => body.messages[0].content.startsWith("You check an assistant's reply") ? JSON.stringify({ unsupported: ["I've created the booking"] }) : "" });
  const result = await f.run();
  assert.equal(f.requests.filter(body => !body.stream).length, 1, "One claim check");
  assert.equal(lastText(f.streamed[1]), CHECKS.unsupported(["I've created the booking"]));
  assert.equal(f.executions.length, 1);
  assert.equal(f.messages.at(-1).text, "The booking is in.");
  assert.equal(result.metadata.check, "unsupported");
});

test("at the step limit the reply ends with the engine's account of where it got to", async () => {
  const account = "I looked twice and stopped there; say the word and I'll carry on.";
  const f = fixture({ limits: { maxSteps: 2 }, reply: () => ({ call: "action_execute" }), once: () => account });
  const result = await f.run();
  assert.equal(f.executions.length, 2);
  const [summing] = f.requests.filter(body => !body.stream);
  assert.match(summing.messages[0].content, /^You are the assistant, a personal assistant bot\. You were working on the person's request but stopped early because I reached the most steps I take in one go\./u);
  assert.deepEqual(f.messages.filter(message => message.complete && message.role === "assistant").map(message => [message.id, message.text]),
    [["reply-3", account]]);
  assert.deepEqual(result, { metadata: { unfinished: "I reached the most steps I take in one go" } });
});

test("a provider failure before anything was done is the reply's error, after the engine's retries", async () => {
  const f = fixture({ failure: () => new Response('{"error":{"message":"Capacity unavailable"}}',
    { status: 429, headers: { "content-type": "application/json", "retry-after-ms": "0" } }) });
  await assert.rejects(f.run(), /Capacity unavailable/);
  assert.equal(f.requests.length, 7, "Six retries, then the error");
  assert.equal(f.messages.length, 0);
});

test("a long history is compacted: the summary and its last turn are saved, and only later turns are read", async () => {
  const turns = Array.from({ length: 6 }, (_, index) => ({ turnId: String(index + 1).padStart(6, "0"),
    user: { role: "user", messageId: `m${index}`, text: `Question ${index} ${"x".repeat(4000)}` },
    assistant: { role: "assistant", text: `Answer ${index}` }, messages: [] }));
  const saved = [], phases = [];
  const f = fixture({ descriptors: null, limits: { contextTokens: 10_000 }, once: () => "The person asked six long questions." });
  await f.run("Next question", { history: turns, summary: "Earlier: hello.",
    saveSummary: async value => { saved.push(value); }, onEvent: async event => { phases.push(event.phase); } });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, "The person asked six long questions.");
  const summarizing = f.requests.find(body => !body.stream);
  assert.match(summarizing.messages.at(-1).content, /The summary so far, of everything before the messages below:\n<<summary>>\nEarlier: hello\./u);
  const kept = turns.slice(turns.findIndex(turn => turn.turnId === saved[0].throughTurnId) + 1);
  assert.ok(kept.length > 0 && kept.length < turns.length);
  const [request] = f.streamed;
  assert.match(request.messages[0].content, /Summary of the earlier part of this conversation[^]*The person asked six long questions\./u);
  assert.deepEqual(request.messages.filter(message => message.role === "user").map(message => message.content),
    [...kept.map(turn => turn.user.text), "Next question"]);
  assert.deepEqual(phases, ["compacting", "working"]);
});

test("a short history is read whole with its stored summary, and nothing is saved", async () => {
  const saved = [];
  const f = fixture({ descriptors: null });
  await f.run("Next question", { summary: "Earlier: hello.", saveSummary: async value => { saved.push(value); },
    history: [{ turnId: "000003", user: { role: "user", messageId: "m3", text: "Hi" }, assistant: { role: "assistant", text: "Hello" }, messages: [] }] });
  assert.deepEqual(saved, []);
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].messages[0].content, /Summary of the earlier part of this conversation[^]*Earlier: hello\./u);
  assert.deepEqual(f.requests[0].messages.slice(1).map(message => message.content), ["Hi", "Hello", "Next question"]);
});
