import test from "node:test";
import assert from "node:assert/strict";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { workspacePendingInvitationsResource } from "../src/shared/resources/workspacePendingInvitationsResource.js";

test("workspacePendingInvitationsResource output normalizer shapes raw invite rows", () => {
  const tokenHash = "a".repeat(64);

  const result = workspacePendingInvitationsResource.operations.list.outputValidator.normalize({
    pendingInvites: [
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
    ]
  }).pendingInvites;

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
