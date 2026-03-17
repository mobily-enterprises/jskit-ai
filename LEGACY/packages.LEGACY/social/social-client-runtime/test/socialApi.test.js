import assert from "node:assert/strict";
import test from "node:test";

import { createApi } from "../src/lib/socialApi.js";

test("socialApi maps workspace social endpoints and query parameters", async () => {
  const calls = [];
  const api = createApi({
    request: async (path, options = undefined) => {
      calls.push([path, options]);
      return { ok: true };
    }
  });

  await api.listFeed({ limit: 20, cursor: "42" });
  await api.createPost({ contentText: "hello" });
  await api.getPost("99");
  await api.updatePost("99", { contentText: "updated" });
  await api.deletePost("99");
  await api.createComment("99", { contentText: "reply" });
  await api.deleteComment("101");
  await api.requestFollow({ actorId: 7 });
  await api.undoFollow("8");
  await api.searchActors({ q: "alice" });
  await api.getActorProfile("11");
  await api.listNotifications({ unreadOnly: true });
  await api.markNotificationsRead({ notificationIds: [1, 2] });
  await api.listModerationRules({ ruleScope: "domain" });
  await api.createModerationRule({ ruleScope: "domain", decision: "block", domain: "x.test" });
  await api.deleteModerationRule("17");

  assert.equal(calls[0][0], "/api/workspace/social/feed?limit=20&cursor=42");
  assert.equal(calls[1][0], "/api/workspace/social/posts");
  assert.equal(calls[1][1]?.method, "POST");
  assert.equal(calls[2][0], "/api/workspace/social/posts/99");
  assert.equal(calls[3][0], "/api/workspace/social/posts/99");
  assert.equal(calls[3][1]?.method, "PATCH");
  assert.equal(calls[4][0], "/api/workspace/social/posts/99");
  assert.equal(calls[4][1]?.method, "DELETE");
  assert.equal(calls[5][0], "/api/workspace/social/posts/99/comments");
  assert.equal(calls[6][0], "/api/workspace/social/comments/101");
  assert.equal(calls[7][0], "/api/workspace/social/follows");
  assert.equal(calls[8][0], "/api/workspace/social/follows/8");
  assert.equal(calls[9][0], "/api/workspace/social/actors/search?q=alice");
  assert.equal(calls[10][0], "/api/workspace/social/actors/11");
  assert.equal(calls[11][0], "/api/workspace/social/notifications?unreadOnly=true");
  assert.equal(calls[12][0], "/api/workspace/social/notifications/read");
  assert.equal(calls[13][0], "/api/workspace/admin/social/moderation/rules?ruleScope=domain");
  assert.equal(calls[14][0], "/api/workspace/admin/social/moderation/rules");
  assert.equal(calls[15][0], "/api/workspace/admin/social/moderation/rules/17");
});
