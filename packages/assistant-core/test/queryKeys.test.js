import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_QUERY_KEY_PREFIX,
  assistantRootQueryKey,
  assistantScopeQueryKey,
  assistantSettingsQueryKey,
  assistantConversationsListQueryKey,
  assistantConversationMessagesQueryKey
} from "../src/shared/queryKeys.js";

test("assistant query keys normalize scope and paging", () => {
  assert.deepEqual(ASSISTANT_QUERY_KEY_PREFIX, ["assistant"]);
  assert.deepEqual(assistantRootQueryKey(), ["assistant"]);

  assert.deepEqual(assistantScopeQueryKey({ targetSurfaceId: "app" }), ["assistant", "app:global"]);
  assert.deepEqual(assistantScopeQueryKey({ targetSurfaceId: "admin", workspaceSlug: "acme" }), ["assistant", "admin:slug:acme"]);
  assert.deepEqual(assistantScopeQueryKey({ targetSurfaceId: "admin", workspaceId: "9" }), ["assistant", "admin:workspace:9"]);
  assert.deepEqual(assistantSettingsQueryKey({ targetSurfaceId: "app" }), ["assistant", "app:global", "settings"]);

  assert.deepEqual(assistantConversationsListQueryKey({ targetSurfaceId: "admin", workspaceSlug: "acme" }), [
    "assistant",
    "admin:slug:acme",
    "conversations",
    "list",
    20,
    "all"
  ]);

  assert.deepEqual(
    assistantConversationsListQueryKey(
      { targetSurfaceId: "admin", workspaceId: "9" },
      { limit: 10, status: "ACTIVE" }
    ),
    ["assistant", "admin:workspace:9", "conversations", "list", 10, "active"]
  );

  assert.deepEqual(assistantConversationMessagesQueryKey({ targetSurfaceId: "admin", workspaceSlug: "acme" }, "22"), [
    "assistant",
    "admin:slug:acme",
    "conversations",
    "22",
    "messages",
    1,
    200
  ]);
});
