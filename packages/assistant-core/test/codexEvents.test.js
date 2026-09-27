import assert from "node:assert/strict";
import test from "node:test";
import { codexAppServerProviderThreadAssistantSegments } from "../src/server/conversation/codexEvents.js";

test("phase-less Codex progress before tools does not become a final answer", () => {
  const items = [
    { type: "reasoning", id: "reasoning-1", content: ["Details"] },
    { type: "agentMessage", id: "progress-1", text: "Checking sources." },
    { type: "commandExecution", id: "tool-1" },
    { type: "agentMessage", id: "progress-2", text: "Comparing prices." },
    { type: "commandExecution", id: "tool-2" },
    { type: "reasoning", id: "reasoning-2", content: ["More details"] },
    { type: "agentMessage", id: "answer-1", text: "The answer." },
    { type: "agentMessage", id: "answer-2", text: "Supporting sources." }
  ];
  const segments = (status, count = items.length) => codexAppServerProviderThreadAssistantSegments({
    turns: [{ id: "turn", status, items: items.slice(0, count) }]
  }, "turn");
  assert.deepEqual(segments("inProgress"), []);
  assert.deepEqual(segments("failed", 5), [], "a failed tool cannot turn earlier progress into an answer");
  assert.deepEqual(segments("completed"), [
    { itemId: "answer-1", text: "The answer." },
    { itemId: "answer-2", text: "Supporting sources." }
  ]);
  assert.deepEqual(segments(undefined), segments("completed"), "saved history without status retains its trailing response");
});

test("explicit Codex finals remain independent across goal continuation and hooks", () => {
  assert.deepEqual(codexAppServerProviderThreadAssistantSegments({ turns: [{
    id: "turn", status: "inProgress", items: [
      { type: "agentMessage", id: "answer-1", phase: "final_answer", text: "First result." },
      { type: "hookPrompt", id: "hook" },
      { type: "agentMessage", id: "progress", phase: "commentary", text: "Continuing." },
      { type: "agentMessage", id: "answer-2", phase: "final_answer", text: "Second result." }
    ]
  }] }, "turn"), [
    { itemId: "answer-1", text: "First result." },
    { itemId: "answer-2", text: "Second result." }
  ]);
});
