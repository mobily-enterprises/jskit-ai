import assert from "node:assert/strict";
import test from "node:test";

import {
  socialActorSearchQueryKey,
  socialFeedQueryKey,
  socialNotificationsQueryKey,
  socialPostQueryKey,
  socialScopeQueryKey
} from "../src/shared/queryKeys.js";

test("social query keys normalize workspace scope and primitives", () => {
  assert.deepEqual(socialScopeQueryKey("acme"), ["social", "acme"]);
  assert.deepEqual(socialFeedQueryKey("", { limit: 0 }), ["social", "none", "feed", "none", 20]);
  assert.deepEqual(socialPostQueryKey("acme", "9"), ["social", "acme", "posts", 9]);
  assert.deepEqual(socialNotificationsQueryKey("acme", { unreadOnly: true, limit: 12 }), [
    "social",
    "acme",
    "notifications",
    "unread",
    12
  ]);
  assert.deepEqual(socialActorSearchQueryKey("acme", { query: " Alice ", limit: 15 }), [
    "social",
    "acme",
    "actors",
    "search",
    "alice",
    15
  ]);
});
