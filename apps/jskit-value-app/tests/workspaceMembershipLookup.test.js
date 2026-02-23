import assert from "node:assert/strict";
import test from "node:test";

import {
  collectInviteWorkspaceIds,
  listInviteMembershipsByWorkspaceId
} from "../server/domain/workspace/lookups/workspaceMembershipLookup.js";

test("workspace membership lookup collects workspace ids from invites", () => {
  const ids = collectInviteWorkspaceIds([
    { workspaceId: 11 },
    { workspaceId: "11" },
    { workspaceId: 12 },
    { workspaceId: "bad" }
  ]);

  assert.deepEqual(ids, [11, 12]);
  assert.deepEqual(collectInviteWorkspaceIds([]), []);
});

test("workspace membership lookup uses batch repository method when available", async () => {
  let batchCalls = 0;
  let pointCalls = 0;

  const membershipByWorkspaceId = await listInviteMembershipsByWorkspaceId({
    workspaceMembershipsRepository: {
      async listByUserIdAndWorkspaceIds(userId, workspaceIds) {
        batchCalls += 1;
        assert.equal(userId, 5);
        assert.deepEqual(workspaceIds, [11, 12]);
        return [
          { workspaceId: 11, userId: 5, status: "active" },
          { workspaceId: 12, userId: 5, status: "pending" }
        ];
      },
      async findByWorkspaceIdAndUserId() {
        pointCalls += 1;
        return null;
      }
    },
    userId: 5,
    invites: [{ workspaceId: 11 }, { workspaceId: 12 }, { workspaceId: 11 }]
  });

  assert.equal(batchCalls, 1);
  assert.equal(pointCalls, 0);
  assert.equal(membershipByWorkspaceId.get(11).status, "active");
  assert.equal(membershipByWorkspaceId.get(12).status, "pending");
});

test("workspace membership lookup falls back to per-workspace lookup", async () => {
  let pointCalls = 0;

  const membershipByWorkspaceId = await listInviteMembershipsByWorkspaceId({
    workspaceMembershipsRepository: {
      async findByWorkspaceIdAndUserId(workspaceId, userId) {
        pointCalls += 1;
        if (workspaceId === 11) {
          return { workspaceId, userId, status: "active" };
        }
        return null;
      }
    },
    userId: 5,
    invites: [{ workspaceId: 11 }, { workspaceId: 12 }]
  });

  assert.equal(pointCalls, 2);
  assert.equal(membershipByWorkspaceId.get(11).status, "active");
  assert.equal(membershipByWorkspaceId.has(12), false);
});
