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
