import test from "node:test";
import assert from "node:assert/strict";
import { __testables } from "../src/useAssistantRuntime.js";

test("assistant runtime buildHistory includes only done user/assistant chat messages", () => {
  const history = __testables.buildHistory([
    { role: "user", kind: "chat", text: "hello", status: "done" },
    { role: "assistant", kind: "chat", text: "reply", status: "done" },
    { role: "assistant", kind: "tool_event", text: "Tool call: x", status: "tool_call" },
    { role: "assistant", kind: "chat", text: "partial", status: "streaming" },
    { role: "assistant", kind: "chat", text: "failed", status: "error" }
  ]);

  assert.deepEqual(history, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "reply" }
  ]);
});

test("assistant runtime normalizes transcript entries into messages and tool event state", () => {
  const restored = __testables.mapTranscriptEntriesToAssistantState([
    {
      id: 1,
      role: "user",
      kind: "chat",
      contentText: "Rename workspace",
      metadata: {}
    },
    {
      id: 2,
      role: "assistant",
      kind: "tool_call",
      contentText: "{\"name\":\"workspace_rename\"}",
      metadata: {
        toolCallId: "call_1",
        tool: "workspace_rename"
      }
    },
    {
      id: 3,
      role: "assistant",
      kind: "tool_result",
      contentText: "{\"toolCallId\":\"call_1\",\"tool\":\"workspace_rename\",\"ok\":true,\"result\":{\"name\":\"ACME\"}}",
      metadata: {}
    },
    {
      id: 4,
      role: "assistant",
      kind: "chat",
      contentText: "Renamed.",
      metadata: {}
    }
  ]);

  assert.equal(restored.messages.length, 4);
  assert.equal(restored.messages[1].status, "tool_call");
  assert.equal(restored.messages[2].status, "tool_result");
  assert.deepEqual(restored.pendingToolEvents, [
    {
      id: "call_1",
      name: "workspace_rename",
      arguments: "{\"name\":\"workspace_rename\"}",
      status: "done",
      result: {
        name: "ACME"
      },
      error: null
    }
  ]);
});

test("assistant runtime conversation status normalizer falls back to unknown", () => {
  assert.equal(__testables.normalizeConversationStatus(" COMPLETED "), "completed");
  assert.equal(__testables.normalizeConversationStatus(""), "unknown");
});
