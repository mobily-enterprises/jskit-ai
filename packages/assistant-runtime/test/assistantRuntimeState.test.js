import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistory,
  interruptPendingToolEvents,
  mapTranscriptEntriesToAssistantState
} from "../src/client/support/assistantRuntimeState.js";

test("restored progress narration is neither rendered nor replayed", () => {
  const restored = mapTranscriptEntriesToAssistantState([
    {
      id: "1",
      role: "user",
      kind: "chat",
      contentText: "Find the booking."
    },
    {
      id: "2",
      role: "assistant",
      kind: "chat",
      contentText: "Let me query the bookings."
    },
    {
      id: "3",
      role: "assistant",
      kind: "chat",
      contentText: "The booking is confirmed."
    },
    {
      id: "4",
      role: "assistant",
      kind: "chat",
      contentText: "Let me check. The second booking is also confirmed."
    }
  ]);

  assert.deepEqual(
    restored.messages.map((message) => message.text),
    [
      "Find the booking.",
      "The booking is confirmed.",
      "Let me check. The second booking is also confirmed."
    ]
  );
  assert.deepEqual(buildHistory(restored.messages), [
    {
      role: "user",
      content: "Find the booking."
    },
    {
      role: "assistant",
      content: "The booking is confirmed."
    },
    {
      role: "assistant",
      content: "Let me check. The second booking is also confirmed."
    }
  ]);
});

test("restored orphaned tool calls are marked interrupted", () => {
  const restored = mapTranscriptEntriesToAssistantState([
    {
      id: "1",
      role: "assistant",
      kind: "tool_call",
      contentText: "{}",
      metadata: {
        toolCallId: "orphaned",
        tool: "action_search"
      }
    },
    {
      id: "2",
      role: "assistant",
      kind: "tool_call",
      contentText: "{}",
      metadata: {
        toolCallId: "completed",
        tool: "action_execute"
      }
    },
    {
      id: "3",
      role: "assistant",
      kind: "tool_result",
      contentText: JSON.stringify({
        ok: true,
        result: {
          id: "41"
        }
      }),
      metadata: {
        toolCallId: "completed",
        tool: "action_execute",
        ok: true
      }
    }
  ]);

  assert.deepEqual(
    restored.pendingToolEvents.map((event) => ({ id: event.id, status: event.status })),
    [
      { id: "orphaned", status: "interrupted" },
      { id: "completed", status: "done" }
    ]
  );
});

test("live stream cleanup interrupts only tool events that remain pending", () => {
  const finalized = interruptPendingToolEvents([
    {
      id: "pending",
      status: "pending"
    },
    {
      id: "done",
      status: "done"
    },
    {
      id: "failed",
      status: "failed"
    }
  ]);

  assert.deepEqual(
    finalized.map((event) => ({ id: event.id, status: event.status })),
    [
      { id: "pending", status: "interrupted" },
      { id: "done", status: "done" },
      { id: "failed", status: "failed" }
    ]
  );
});

test("runtime statuses and tool activity map explicitly without changing message identity or exposing payloads", async () => {
  const { mapAssistantConversationTurns } = await import("../src/client/support/assistantRuntimeState.js");
  const messages = [
    { id: "user-1", role: "user", status: "done", text: "Question" },
    { id: "answer-1", role: "assistant", status: "streaming", text: "" }
  ];
  const tools = [{ id: "tool-1", messageId: "answer-1", name: "Search records", status: "pending", arguments: "secret", result: { private: true } }];
  let turns = mapAssistantConversationTurns(messages, tools);
  assert.equal(turns[0].turnId, "user-1");
  assert.equal(turns[0].pending, true);
  assert.equal(turns[0].messages.at(-1).text, "Search records — pending");
  assert.doesNotMatch(JSON.stringify(turns), /secret|private/);
  for (const [status, expected] of [["done", "completed"], ["error", "failed"], ["canceled", "interrupted"]]) {
    messages[1] = { ...messages[1], text: "Partial answer", status };
    turns = mapAssistantConversationTurns(messages, tools);
    assert.equal(turns[0].assistant.messageId, "answer-1");
    assert.equal(turns[0].assistant.status, expected);
    assert.equal(turns[0].assistant.text, "Partial answer");
    assert.equal(turns[0].pending, false);
  }
  assert.equal(mapAssistantConversationTurns(messages, tools, { showToolActivity: false })[0].messages.length, 2);
});

test("numeric persisted identities and distinct equal-text replies remain distinct", async () => {
  const { mapAssistantConversationTurns } = await import("../src/client/support/assistantRuntimeState.js");
  const restored = mapTranscriptEntriesToAssistantState([
    { id: 1, role: "user", kind: "chat", contentText: "Question" },
    { id: 2, role: "assistant", kind: "chat", contentText: "Same answer" },
    { id: "3", role: "assistant", kind: "chat", contentText: "Same answer" }
  ]);
  const turns = mapAssistantConversationTurns(restored.messages);
  assert.deepEqual(turns.map((turn) => turn.assistant.messageId), ["transcript_2", "transcript_3"]);
});

test("restored tool calls retain their association with the reply they preceded", async () => {
  const { mapAssistantConversationTurns } = await import("../src/client/support/assistantRuntimeState.js");
  const restored = mapTranscriptEntriesToAssistantState([
    { id: 1, role: "user", kind: "chat", contentText: "Question" },
    { id: 2, role: "assistant", kind: "tool_call", contentText: "secret arguments", metadata: { toolCallId: "t", tool: "Search" } },
    { id: 3, role: "assistant", kind: "tool_result", contentText: '{"ok":true,"result":{"private":true}}', metadata: { toolCallId: "t" } },
    { id: 4, role: "assistant", kind: "chat", contentText: "Found it" }
  ]);
  const [turn] = mapAssistantConversationTurns(restored.messages, restored.pendingToolEvents);
  assert.equal(turn.messages[1].text, "Search — done");
  assert.doesNotMatch(JSON.stringify(turn), /secret|private/);
});
