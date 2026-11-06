import assert from "node:assert/strict";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { compactMessages, runLoop } from "../src/server/index.js";

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
};
const answering = (text) => new MockLanguageModelV4({
  doGenerate: async () => ({ content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" }, usage: USAGE, warnings: [] })
});
const failing = () => new MockLanguageModelV4({
  doGenerate: async () => {
    throw new Error("The model is down.");
  }
});
const loop = (options) => runLoop({ name: "Helper", instructions: "Help.", history: [{ role: "user", content: "Hello" }], maxSteps: 2, ...options });

// A wrong callback would otherwise fail inside a model step, where the AI SDK drops the error.
test("a callback option given as null fails at runLoop entry with a TypeError naming it", async () => {
  for (const option of ["onSteps", "onStep", "clean", "throwIf"]) {
    const model = answering("Hi.");
    await assert.rejects(loop({ model, [option]: null }), { name: "TypeError", message: `runLoop: ${option} must be a function, or left out for its default.` });
    assert.equal(model.doGenerateCalls.length, 0, `${option} is refused before the model is called`);
  }
  await assert.rejects(compactMessages({ model: answering("Summary."), messages: [], onCompacting: null }), {
    name: "TypeError",
    message: "compactMessages: onCompacting must be a function, or left out for its default."
  });
});

test("an omitted callback option takes its named default", async () => {
  const answered = await loop({ model: answering("Hi there.") });
  assert.equal(answered.text, "Hi there.", "with no onStep or onSteps, the steps finish unheard");
  const stopped = await loop({ model: failing() });
  assert.match(stopped.text, /^I stopped before finishing, because something went wrong on my side\./u, "with no throwIf, a failed call ends with an account");
  await assert.rejects(loop({ model: failing(), throwIf: () => true }), { message: "The model is down." });
});

// A prompt cache reuses only an unchanged start, and the state note changes every turn (it
// carries the time): ahead of the history it would leave the whole history uncached.
test("from one turn to the next, the prompt starts with everything the previous turn sent except its note", async () => {
  const model = answering("Hi there.");
  const note = (time) => `Current state, from the system:\n- The time: ${time} UTC.`;
  const first = await loop({ model, summary: "They asked about the weather.", state: note("10:00") });
  const history = [{ role: "user", content: "Hello" }, ...first.transcript, { role: "user", content: "And tomorrow?" }];
  await loop({ model, history, summary: "They asked about the weather.", state: note("10:10") });

  const [before, after] = model.doGenerateCalls.map((call) => call.prompt);
  const said = ({ role, content }) => ({ role, content });
  assert.deepEqual(said(before.at(-1)), { role: "user", content: [{ type: "text", text: note("10:00") }] }, "The note is the last message");
  assert.deepEqual(said(after.at(-1)), { role: "user", content: [{ type: "text", text: note("10:10") }] });
  assert.deepEqual(after.slice(0, before.length - 1), before.slice(0, -1), "The next turn's prompt starts with the previous one, without its note");
  assert.equal(before[0].role, "system");
  assert.match(before[0].content, /They asked about the weather/u, "The summary stays in the system prompt");
  assert.doesNotMatch(before[0].content, /The time:/u, "The note is not in the system prompt");
  assert.deepEqual(after.slice(before.length - 1, -1).map((message) => message.role), ["assistant", "user"], "Then the previous reply and the new request");
});

test("the account of a reply that stopped early reads the person's request, not the state note", async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      if (++calls === 1) throw new Error("The model is down.");
      return { content: [{ type: "text", text: "I couldn't reach the model." }], finishReason: { unified: "stop", raw: "stop" }, usage: USAGE, warnings: [] };
    }
  });
  const stopped = await loop({ model, state: "Current state, from the system:\n- The time: 10:00 UTC." });
  assert.equal(stopped.account, "I couldn't reach the model.");
  assert.match(model.doGenerateCalls[1].prompt.at(-1).content[0].text, /^The request: Hello\n/u);
});
