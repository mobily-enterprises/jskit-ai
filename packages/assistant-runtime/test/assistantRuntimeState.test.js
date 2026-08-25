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
