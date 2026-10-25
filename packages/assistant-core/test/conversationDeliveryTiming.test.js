import assert from "node:assert/strict";
import test from "node:test";
import { createConversationDeliveryTiming } from "../src/server/conversation/deliveryTiming.js";
import { createConversationRuntime, createMemoryConversationStorage } from "../src/server/conversation/index.js";

test("native engines share bounded, content-free timing and independent message identities", () => {
  for (const engine of ["codex", "claude", "opencode"]) {
    let now = 0;
    const events = [];
    const mark = createConversationDeliveryTiming({ engine, conversationId: "chat", messageId: "one",
      report: event => events.push(event), clock: () => now });
    mark("received");
    now = 3; mark("dispatch-started");
    now = 1003; mark("native-acknowledged");
    now = 1013; mark("receipt-persisted");
    now = 1015; mark("accepted");
    now = 1020; mark("first-response");
    mark("first-response");
    mark("arbitrary-provider-payload");
    assert.equal(events.length, 6);
    assert.equal(events[2].durationMs, 1000);
    assert.equal(events[3].durationMs, 10);
    assert.deepEqual(events[4].timings, {
      received: 0, "dispatch-started": 3, "native-acknowledged": 1003, "receipt-persisted": 1013, accepted: 1015
    });
    assert.equal(events[0].timings.accepted, undefined, "Earlier reports are snapshots");
    for (const event of events) assert.deepEqual(Object.keys(event).sort(),
      ["engine", "conversationId", "messageId", "stage", "previousStage", "durationMs", "elapsedMs", "timings"].sort());
    const next = createConversationDeliveryTiming({ engine, conversationId: "chat", messageId: "two",
      report: event => events.push(event), clock: () => now });
    next("received");
    assert.equal(events.at(-1).messageId, "two");
    assert.equal(events.at(-1).elapsedMs, 0);
  }
});

test("diagnostic failures and unfinished asynchronous observers never block delivery", async () => {
  const pending = Promise.withResolvers();
  let calls = 0;
  const mark = createConversationDeliveryTiming({ engine: "claude", conversationId: "chat", messageId: "one",
    report() {
      calls++;
      if (calls === 1) throw new Error("Observer unavailable");
      if (calls === 2) return Promise.reject(new Error("Observer rejected"));
      return pending.promise;
    } });
  mark("received"); mark("dispatch-started"); mark("native-acknowledged"); mark("receipt-persisted");
  assert.equal(calls, 4);
  await Promise.resolve();
  pending.resolve();
});

test("host preparation stages are reported only when the host declares them", () => {
  const events = [];
  const report = event => events.push(event.stage);
  const plain = createConversationDeliveryTiming({ engine: "claude", conversationId: "chat", messageId: "one", report });
  plain("received"); plain("host-step");
  assert.deepEqual(events, ["received"]);
  const declared = createConversationDeliveryTiming({ engine: "claude", conversationId: "chat", messageId: "two", report,
    hostStages: ["host-step"] });
  declared("host-step"); declared("other-step");
  assert.deepEqual(events, ["received", "host-step"]);
});

test("conversation runtimes reject malformed host delivery stage names", () => {
  for (const hostDeliveryStages of ["host-step", ["Host"], ["host step"], [7], ["-step"]]) {
    assert.throws(() => createConversationRuntime({ authorize: () => true, hostDeliveryStages }),
      { name: "TypeError", message: "Host delivery stages must be lowercase hyphenated names." });
  }
  createConversationRuntime({ authorize: () => true, storage: createMemoryConversationStorage(), hostDeliveryStages: ["git-step"] });
});
