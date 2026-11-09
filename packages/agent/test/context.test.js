import assert from "node:assert/strict";
import test from "node:test";
import { OLD_RESULT_CHARS, clipOldResult, trimOldResults } from "../src/server/index.js";

// Room inside one long turn: past a size, the oldest tool results give way to a note, never the
// newest ones, until the request is back under the target; calls and the model's words stay, and
// what was left out stays left out.
const step = (n) => [
  { role: "assistant", content: [{ type: "text", text: `Reading part ${n}.` }, { type: "tool-call", toolCallId: `c${n}`, toolName: "read_file", input: { part: n } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: `c${n}`, toolName: "read_file", output: { type: "text", value: "x".repeat(4000) } }] }
];
const results = (prompt) => prompt.filter((message) => message.role === "tool").map((message) => (message.content[0].output.value.includes("left out") ? "short" : "whole"));

test("old tool results give way inside a long turn, the newest never", () => {
  const limits = { trimAt: 5000, trimTo: 3000, keepRecent: 2 };
  const prompt = [{ role: "system", content: "You are a bot." }, { role: "user", content: [{ type: "text", text: "Read all six parts." }] }, ...[1, 2, 3, 4, 5, 6].flatMap(step)];
  const left = new Set();
  const trimmed = trimOldResults(prompt, left, limits);
  assert.deepEqual(results(trimmed), ["short", "short", "short", "short", "whole", "whole"]);
  assert.equal(trimmed.filter((message) => message.role === "assistant").length, 6, "the calls and words stay");
  assert.equal(results(prompt).join(), "whole,whole,whole,whole,whole,whole", "the stored messages are untouched");
  assert.equal(results(trimOldResults([...prompt.slice(0, 4)], left, { ...limits, trimAt: 1e9 })).join(), "short", "left out stays left out");
  assert.equal(trimOldResults(prompt, new Set(), { ...limits, trimAt: 1e9 }), prompt, "under the limit nothing changes");
});

// An earlier turn's long tool result is cut, saying so, the same way every time.
test("an earlier turn's long result is cut, the same way every time", () => {
  const long = { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "openWebPage", output: { type: "text", value: "x".repeat(20000) } }] };
  const clipped = clipOldResult(long);
  const value = clipped.content[0].output.value;
  assert.ok(value.length < OLD_RESULT_CHARS + 100 && value.endsWith("no longer shown]"));
  assert.deepEqual(clipOldResult(long), clipped, "deterministic");
  const json = { role: "tool", content: [{ type: "tool-result", toolCallId: "c2", toolName: "list", output: { type: "json", value: { names: ["a", "b"] } } }] };
  assert.equal(clipOldResult(json).content[0], json.content[0], "a short result is left as it is");
  const words = { role: "assistant", content: [{ type: "text", text: "y".repeat(20000) }] };
  assert.equal(clipOldResult(words), words, "only tool results are cut");
});

// Inside a turn, a picture or file the person attached counts by its size, as in the history: its
// bytes written out as JSON made a 0.8 MB picture look like 700k tokens, so every older tool result
// but the newest twenty was left out on every step.
test("an attached picture does not make a turn's old results give way", () => {
  const prompt = [
    { role: "user", content: [{ type: "text", text: "Read all six parts of this." }, { type: "image", image: Buffer.alloc(900_000), mediaType: "image/png" },
      { type: "file", data: Buffer.alloc(900_000), mediaType: "application/pdf" }] },
    ...[1, 2, 3, 4, 5, 6].flatMap(step)
  ];
  const limits = { trimAt: 300_000, trimTo: 200_000, keepRecent: 2 };
  assert.equal(trimOldResults(prompt, new Set(), limits), prompt);
});
