import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_QUERY_KEY_PREFIX,
  assistantConversationMessagesQueryKey,
  assistantConversationsListQueryKey,
  assistantRootQueryKey,
  assistantWorkspaceScopeQueryKey
} from "../src/shared/queryKeys.js";

test("assistant query keys normalize scope and paging values", () => {
  assert.deepEqual(ASSISTANT_QUERY_KEY_PREFIX, ["assistant"]);
  assert.deepEqual(assistantRootQueryKey(), ["assistant"]);

  assert.deepEqual(assistantWorkspaceScopeQueryKey({ workspaceSlug: "acme" }), ["assistant", "slug:acme"]);
  assert.deepEqual(assistantWorkspaceScopeQueryKey({ workspaceId: "19" }), ["assistant", "id:19"]);
  assert.deepEqual(assistantWorkspaceScopeQueryKey({}), ["assistant", "slug:none"]);

  assert.deepEqual(assistantConversationsListQueryKey({ workspaceSlug: "acme" }), [
    "assistant",
    "slug:acme",
    "conversations",
    "list",
    1,
    50,
    "all"
  ]);
  assert.deepEqual(
    assistantConversationsListQueryKey({ workspaceId: 9 }, { page: "3", pageSize: 10, status: "ACTIVE" }),
    ["assistant", "id:9", "conversations", "list", 3, 10, "active"]
  );

  assert.deepEqual(assistantConversationMessagesQueryKey({ workspaceSlug: "acme" }, "22"), [
    "assistant",
    "slug:acme",
    "conversations",
    "22",
    "messages",
    1,
    500
  ]);
  assert.deepEqual(assistantConversationMessagesQueryKey({ workspaceSlug: "acme" }, "bad", { page: 0, pageSize: 0 }), [
    "assistant",
    "slug:acme",
    "conversations",
    "none",
    "messages",
    1,
    500
  ]);
});
