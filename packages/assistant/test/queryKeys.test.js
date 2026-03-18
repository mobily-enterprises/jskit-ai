import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_QUERY_KEY_PREFIX,
  assistantRootQueryKey,
  assistantWorkspaceScopeQueryKey,
  assistantConversationsListQueryKey,
  assistantConversationMessagesQueryKey
} from "../src/shared/queryKeys.js";

test("assistant query keys normalize workspace scope and paging", () => {
  assert.deepEqual(ASSISTANT_QUERY_KEY_PREFIX, ["assistant"]);
  assert.deepEqual(assistantRootQueryKey(), ["assistant"]);

  assert.deepEqual(assistantWorkspaceScopeQueryKey({ workspaceSlug: "acme" }), ["assistant", "slug:acme"]);
  assert.deepEqual(assistantWorkspaceScopeQueryKey({ workspaceId: "9" }), ["assistant", "id:9"]);

  assert.deepEqual(assistantConversationsListQueryKey({ workspaceSlug: "acme" }), [
    "assistant",
    "slug:acme",
    "conversations",
    "list",
    20,
    "all"
  ]);

  assert.deepEqual(
    assistantConversationsListQueryKey({ workspaceId: 9 }, { limit: 10, status: "ACTIVE" }),
    ["assistant", "id:9", "conversations", "list", 10, "active"]
  );

  assert.deepEqual(assistantConversationMessagesQueryKey({ workspaceSlug: "acme" }, "22"), [
    "assistant",
    "slug:acme",
    "conversations",
    "22",
    "messages",
    1,
    200
  ]);
});
