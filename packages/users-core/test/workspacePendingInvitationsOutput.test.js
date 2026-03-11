import test from "node:test";
import assert from "node:assert/strict";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import { mapPendingInvites } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsOutput.js";

test("mapPendingInvites shapes raw invite rows into API output", () => {
  const tokenHash = "a".repeat(64);

  const result = mapPendingInvites([
    {
      id: 10,
      workspaceId: 3,
      workspaceSlug: "tonymobily3",
      workspaceName: "",
      workspaceAvatarUrl: "",
      roleId: "Member",
      status: "Pending",
      expiresAt: "2030-01-01T00:00:00.000Z",
      tokenHash
    }
  ]);

  assert.deepEqual(result, [
    {
      id: 10,
      workspaceId: 3,
      workspaceSlug: "tonymobily3",
      workspaceName: "tonymobily3",
      workspaceAvatarUrl: "",
      roleId: "member",
      status: "pending",
      expiresAt: "2030-01-01T00:00:00.000Z",
      token: encodeInviteTokenHash(tokenHash)
    }
  ]);
});
