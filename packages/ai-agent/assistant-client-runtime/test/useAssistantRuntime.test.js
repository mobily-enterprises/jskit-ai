import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantRuntime, assistantRuntimeTestables } from "../src/shared/useAssistantRuntime.js";

function createPolicy(seed = 0) {
  return {
    streamTimeoutMs: 60_000 + seed,
    historyPageSize: 50 + seed,
    restoreMessagesPageSize: 500 + seed
  };
}

test("assistant runtime buildHistory includes only done user/assistant chat messages", () => {
  const history = assistantRuntimeTestables.buildHistory([
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
  const restored = assistantRuntimeTestables.mapTranscriptEntriesToAssistantState([
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
  assert.equal(assistantRuntimeTestables.normalizeConversationStatus(" COMPLETED "), "completed");
  assert.equal(assistantRuntimeTestables.normalizeConversationStatus(""), "unknown");
});

test("assistant runtime policy resolver requires positive integer fields", () => {
  const policy = assistantRuntimeTestables.resolveAssistantRuntimePolicy({
    streamTimeoutMs: "90000",
    historyPageSize: 100,
    restoreMessagesPageSize: "200"
  });
  assert.deepEqual(policy, {
    streamTimeoutMs: 90_000,
    historyPageSize: 100,
    restoreMessagesPageSize: 200
  });
  assert.equal(Object.isFrozen(policy), true);

  assert.throws(
    () => assistantRuntimeTestables.resolveAssistantRuntimePolicy(null),
    /missing required policy object/i
  );
  assert.throws(
    () =>
      assistantRuntimeTestables.resolveAssistantRuntimePolicy({
        streamTimeoutMs: 0,
        historyPageSize: 100,
        restoreMessagesPageSize: 200
      }),
    /policy fields must be positive integers: streamTimeoutMs/i
  );
});

test("assistant runtime factory returns isolated runtime instances", () => {
  const apiA = {
    ai: {
      listConversations: async () => ({ entries: [] }),
      getConversationMessages: async () => ({ entries: [] }),
      streamChat: async () => undefined
    }
  };
  const apiB = {
    ai: {
      listConversations: async () => ({ entries: [{ id: 1 }] }),
      getConversationMessages: async () => ({ entries: [{ id: 1 }] }),
      streamChat: async () => undefined
    }
  };

  const runtimeA = createAssistantRuntime({
    api: apiA,
    useWorkspaceStore: () => ({ activeWorkspaceSlug: "alpha" }),
    resolveSurfaceFromPathname: () => "app",
    policy: createPolicy(0)
  });
  const runtimeB = createAssistantRuntime({
    api: apiB,
    useWorkspaceStore: () => ({ activeWorkspaceSlug: "beta" }),
    resolveSurfaceFromPathname: () => "admin",
    policy: createPolicy(25)
  });

  assert.notEqual(runtimeA.useAssistantRuntime, runtimeB.useAssistantRuntime);
  assert.equal(runtimeA.useAssistantView, runtimeA.useAssistantRuntime);
  assert.equal(runtimeB.useAssistantView, runtimeB.useAssistantRuntime);
  assert.notEqual(runtimeA.assistantRuntimeTestables, runtimeB.assistantRuntimeTestables);
  assert.notEqual(runtimeA.assistantRuntimeTestables, assistantRuntimeTestables);
  assert.notEqual(runtimeB.assistantRuntimeTestables, assistantRuntimeTestables);
  assert.equal(runtimeA.assistantRuntimeTestables.ASSISTANT_STREAM_TIMEOUT_MS, 60_000);
  assert.equal(runtimeA.assistantRuntimeTestables.HISTORY_PAGE_SIZE, 50);
  assert.equal(runtimeA.assistantRuntimeTestables.RESTORE_MESSAGES_PAGE_SIZE, 500);
  assert.equal(runtimeB.assistantRuntimeTestables.ASSISTANT_STREAM_TIMEOUT_MS, 60_025);
  assert.equal(runtimeB.assistantRuntimeTestables.HISTORY_PAGE_SIZE, 75);
  assert.equal(runtimeB.assistantRuntimeTestables.RESTORE_MESSAGES_PAGE_SIZE, 525);
  assert.equal(runtimeA.assistantRuntimeTestables.buildHistory, assistantRuntimeTestables.buildHistory);
  assert.equal(runtimeB.assistantRuntimeTestables.buildHistory, assistantRuntimeTestables.buildHistory);
  assert.equal(runtimeA.assistantRuntimeTestables.policy.streamTimeoutMs, 60_000);
  assert.equal(runtimeB.assistantRuntimeTestables.policy.streamTimeoutMs, 60_025);
});

test("assistant runtime factory requires policy", () => {
  assert.throws(
    () =>
      createAssistantRuntime({
        api: {
          ai: {
            listConversations: async () => ({ entries: [] }),
            getConversationMessages: async () => ({ entries: [] }),
            streamChat: async () => undefined
          }
        },
        useWorkspaceStore: () => ({ activeWorkspaceSlug: "alpha" }),
        resolveSurfaceFromPathname: () => "app"
      }),
    /missing required policy object/i
  );
});
