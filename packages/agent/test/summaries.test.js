import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_LIMITS as LIMITS, clipOldResult, cutPoint, estimateTokens, transcriptText } from "../src/server/index.js";

// Compaction's pure parts: where to cut, what the summariser reads, and how an earlier reply's tool
// calls are replayed.
const turn = (id, text) => ({ id: String(id), kind: "text", role: "user", body: { text } });
const answer = (id, text) => ({ id: String(id), kind: "text", role: "bot", body: { text } });

test("the latest turns stay word for word, fewer when they're big", () => {
  const messages = [turn(1, "a"), answer(2, "b"), turn(3, "c"), answer(4, "d"), turn(5, "e"), answer(6, "f"), turn(7, "g"), answer(8, "h")];
  const small = messages.map(() => 10);
  assert.equal(cutPoint(messages, small, { ...LIMITS, keepTurns: 2 }), 4, "keeps the last two turns");
  assert.equal(cutPoint(messages, small, { ...LIMITS, keepTurns: 10 }), 2, "always leaves the first turn to summarise");
  const bigLast = [10, 10, 10, 10, 10, 10, 10, 5000];
  assert.equal(cutPoint(messages, bigLast, { ...LIMITS, keepTurns: 3, keepTokens: 1000 }), 6, "at least the last turn, even when it's big");
  assert.equal(cutPoint([turn(1, "only")], [10], LIMITS), 0, "a single turn has nothing to summarise");
  assert.equal(cutPoint([answer(1, "x"), answer(2, "y")], [10, 10], LIMITS), 0, "no turn boundary, no cut");
});

test("the summariser reads each message as a line, tool calls with their arguments, results shortened", () => {
  const transcript = [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "openWebPage", input: { url: "https://example.com" } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "openWebPage", output: { type: "text", value: "x".repeat(20000) } }] },
    { role: "assistant", content: [{ type: "text", text: "The page says hello." }] }
  ];
  // The model messages an app replays for "Open it" and the reply that answered it.
  const history = [{ role: "user", content: "Open it" }, ...transcript.map(clipOldResult)];
  const text = transcriptText(history);
  assert.match(text, /^Person: Open it$/mu);
  assert.match(text, /Bot used openWebPage\(\{"url":"https:\/\/example\.com"\}\)/u);
  assert.match(text, /Result of openWebPage: x{100}/u);
  assert.match(text, /^Bot: The page says hello\.$/mu);
  assert.ok(!text.includes("x".repeat(900)), "the summariser reads results shortened");
  assert.ok(estimateTokens(history) > 1500 && estimateTokens(history) < 2000);
  const named = transcriptText([{ role: "user", content: "Ada: what's next?" }, { role: "assistant", content: "Plan step 2." }, { role: "user", content: [{ type: "image", image: "data" }] }], { named: true });
  assert.equal(named, "Ada: what's next?\nBot: Plan step 2.\nPerson: [a picture]", "in a group, people's lines already say who");
});
