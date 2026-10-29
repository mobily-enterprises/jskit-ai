import assert from "node:assert/strict";
import test from "node:test";
import { codexAppServerNotificationError, codexAppServerProviderThreadAssistantSegments, codexAppServerProviderTurnError } from "../src/server/conversation/codexEvents.js";

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

// A running app-server keeps the credentials it started with (Codex 0.163,
// local mock): once they are rejected after a sign-out or account switch, its
// turns end with these native errors, which say nothing about reconnecting.
test("a Codex turn whose OpenAI sign-in is gone asks the person to sign in again", () => {
  const signedOut = "Codex (OpenAI) isn't connected. Sign in to Codex, then send your message again.";
  for (const message of [
    "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.",
    "unexpected status 401 Unauthorized: Incorrect API key provided, url: https://api.openai.com/v1/responses",
    "unexpected status 401 Unauthorized: unauthorized, url: https://chatgpt.com/backend-api/codex/responses"
  ]) {
    assert.equal(codexAppServerNotificationError({ method: "error", params: { error: { message } } }), signedOut);
    assert.equal(codexAppServerNotificationError({ method: "turn/completed",
      params: { turn: { status: "failed", error: { message } } } }), signedOut);
    assert.equal(codexAppServerProviderTurnError({ status: "failed", error: { message } }), signedOut);
  }
  // Another provider's rejected key and other failures keep their own text.
  for (const message of ["unexpected status 401 Unauthorized: invalid key, url: https://api.deepseek.com/v1/responses",
    "stream disconnected before completion: stream closed before response.completed"]) {
    assert.equal(codexAppServerNotificationError({ method: "error", params: { error: { message } } }), message);
  }
});
