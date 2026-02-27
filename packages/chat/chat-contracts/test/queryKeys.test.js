import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_QUERY_KEY_PREFIX,
  chatInboxInfiniteQueryKey,
  chatRootQueryKey,
  chatScopeQueryKey,
  chatThreadMessagesInfiniteQueryKey,
  chatThreadQueryKey
} from "../src/shared/queryKeys.js";

test("chat query key helpers build normalized stable keys", () => {
  assert.deepEqual(CHAT_QUERY_KEY_PREFIX, ["chat"]);
  assert.deepEqual(chatRootQueryKey(), ["chat"]);
  assert.deepEqual(chatScopeQueryKey(" acme "), ["chat", "acme"]);
  assert.deepEqual(chatScopeQueryKey(""), ["chat", "none"]);

  assert.deepEqual(chatInboxInfiniteQueryKey("acme"), ["chat", "acme", "inbox", "infinite", 20]);
  assert.deepEqual(chatInboxInfiniteQueryKey("acme", { limit: "90" }), ["chat", "acme", "inbox", "infinite", 90]);
  assert.deepEqual(chatInboxInfiniteQueryKey("acme", { limit: 0 }), ["chat", "acme", "inbox", "infinite", 20]);

  assert.deepEqual(chatThreadQueryKey("acme", "22"), ["chat", "acme", "threads", "22"]);
  assert.deepEqual(chatThreadQueryKey("acme", "bad"), ["chat", "acme", "threads", "none"]);

  assert.deepEqual(chatThreadMessagesInfiniteQueryKey("acme", 22), ["chat", "acme", "threads", "22", "messages", "infinite", 50]);
  assert.deepEqual(chatThreadMessagesInfiniteQueryKey("acme", 22, { limit: "5" }), [
    "chat",
    "acme",
    "threads",
    "22",
    "messages",
    "infinite",
    5
  ]);
});
