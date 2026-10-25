import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectOpenCodeMessageAdmission,
  readOpenCodeMessagesUntil,
  runOpenCodeConversationTurn,
  waitForOpenCodeMessages
} from "../src/server/conversation/openCodeTurn.js";

// Mirrors the native message route: a limited read returns the newest rows in
// chronological order and an opaque cursor that continues with older rows.
function pagedClient(history) {
  const reads = [];
  const prompts = [];
  return {
    reads,
    prompts,
    async messages(_sessionId, { limit, before } = {}) {
      reads.push({ limit, before });
      const end = before ? Number(before.slice("cursor-".length)) : history.length;
      const start = Math.max(0, end - limit);
      return { data: history.slice(start, end), ...(start > 0 ? { nextCursor: `cursor-${start}` } : {}) };
    },
    async sessionStatus() { return { type: "idle" }; },
    async prompt(_sessionId, input) { prompts.push(input); return { id: input.id }; }
  };
}

// One user input followed by many native model steps, the last one final.
function longTurnHistory(steps = 150) {
  const history = [
    { id: "msg_older", type: "user", time: { created: 1 }, content: [{ type: "text", text: "earlier" }] },
    { id: "msg_input", type: "user", time: { created: 2 }, content: [{ type: "text", text: "build it" }] }
  ];
  for (let step = 1; step <= steps; step += 1) {
    const final = step === steps;
    history.push({
      id: `msg_step_${step}`,
      type: "assistant",
      time: { created: 2 + step, ...(final ? { completed: 3 + step } : {}) },
      finish: final ? "stop" : "tool-calls",
      content: final ? [{ type: "text", text: "Done." }] : [{ type: "tool", tool: "bash", callID: `call_${step}` }]
    });
  }
  return history;
}

test("a turn with more than one native page of steps after its input still completes", async () => {
  const client = pagedClient(longTurnHistory());
  const completion = await waitForOpenCodeMessages(client, "ses_long", "msg_input", {
    signal: AbortSignal.timeout(5_000)
  });
  assert.equal(completion.result.complete, true);
  assert.equal(completion.result.text, "Done.");
  assert.equal(completion.result.turnId, "msg_step_150");
  // The input sits on the second page; reading stops there instead of exhausting history.
  assert.deepEqual(client.reads.slice(0, 2), [{ limit: 100, before: undefined }, { limit: 100, before: "cursor-52" }]);
});

test("admission of an input followed by more than one native page of steps is still proven", async () => {
  const client = pagedClient(longTurnHistory());
  const observation = await inspectOpenCodeMessageAdmission(client, "ses_long", "msg_input");
  assert.equal(observation.accepted, true);
});

test("a bounded turn whose input left the newest native page is not dispatched again", async () => {
  const client = pagedClient(longTurnHistory());
  const result = await runOpenCodeConversationTurn(client, "ses_long", {
    inputMessageId: "msg_input", prompt: "build it", timeoutMs: 5_000
  }, { completeResult: value => value });
  assert.deepEqual(client.prompts, []);
  assert.equal(result.text, "Done.");
});

test("paged native history reading stops when its rows are found or history ends", async () => {
  const history = longTurnHistory(250);
  const client = pagedClient(history);
  const newest = await readOpenCodeMessagesUntil(client, "ses_long", () => true);
  assert.equal(newest.data.length, 100);
  assert.equal(client.reads.length, 1);

  client.reads.length = 0;
  const whole = await readOpenCodeMessagesUntil(client, "ses_long", () => false);
  assert.deepEqual(whole.data.map(row => row.id), history.map(row => row.id));
  assert.equal(client.reads.length, 3);

  const repeating = { async messages() { return { data: [], nextCursor: "same" }; } };
  await assert.rejects(readOpenCodeMessagesUntil(repeating, "ses_long", () => false), /repeated a native history cursor/u);
});
