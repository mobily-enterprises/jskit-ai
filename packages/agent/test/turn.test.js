import assert from "node:assert/strict";
import test from "node:test";
import { hearWhileWorking, remindOnRepeat } from "../src/server/index.js";

// The same call over and over gets a reminder at the 3rd, 5th and 8th time in a row (after
// DeepSeek Harness G1); a different call starts the count again, and argument order doesn't matter.
test("a repeated identical call is told to change course", async () => {
  const repeats = { key: "", count: 0 };
  const tool = { id: "read_file", execute: async ({ path }) => ({ text: path }) };
  const other = { id: "list_files", execute: async () => ["a"] };
  remindOnRepeat(tool, repeats);
  remindOnRepeat(other, repeats);
  const calls = [];
  for (let n = 0; n < 8; n += 1) calls.push(await tool.execute(n % 2 ? { path: "x", from: 1 } : { from: 1, path: "x" }));
  assert.deepEqual(calls.map((result) => Boolean(result.reminder)), [false, false, true, false, true, false, false, true]);
  assert.match(calls[2].reminder, /exact same tool call/u);
  assert.match(calls[4].reminder, /call number 5/u);
  assert.equal(calls[2].text, "x", "the result itself is kept");
  assert.equal((await other.execute({})).reminder, undefined, "another call starts again");
  const wrapped = [await tool.execute({ path: "x" }), await tool.execute({ path: "x" }), await other.execute({}), await other.execute({}), await other.execute({})];
  assert.equal(wrapped[1].reminder, undefined);
  assert.deepEqual(wrapped[4], { result: ["a"], reminder: wrapped[4].reminder }, "a list result is wrapped");
  assert.ok(wrapped[4].reminder);
});

// What the person writes while a reply works reaches the model with its next tool result (as
// Claude Code takes messages mid-task), once.
test("a message sent mid-reply reaches the model at its next tool result", async () => {
  const inbox = [[], ["Actually make it blue, not red"], []];
  const tool = { id: "get_goal", execute: async () => ({ goal: null }) };
  const list = { id: "list_files", execute: async () => ["a"] };
  hearWhileWorking(tool, async () => inbox.shift() || []);
  hearWhileWorking(list, async () => ["Also the footer", "and the logo"]);
  const results = [await tool.execute({}), await tool.execute({}), await tool.execute({})];
  assert.equal(results[0].personWrote, undefined, "nothing new yet");
  assert.match(results[1].personWrote, /While you were working, the person wrote: "Actually make it blue, not red"\. Take it into account now/u, "the next tool result carries it");
  assert.equal(results[1].goal, null, "the result itself is kept");
  assert.equal(results[2].personWrote, undefined, "said once");
  const wrapped = await list.execute({});
  assert.deepEqual(wrapped.result, ["a"], "a list result is wrapped");
  assert.match(wrapped.personWrote, /"Also the footer" then "and the logo"/u);
  const failing = { id: "x", execute: async () => "ok" };
  hearWhileWorking(failing, async () => {
    throw new Error("inbox unavailable");
  });
  assert.equal(await failing.execute({}), "ok", "an inbox that fails changes nothing");
});
