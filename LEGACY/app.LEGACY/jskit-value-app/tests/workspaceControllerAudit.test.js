import assert from "node:assert/strict";
import test from "node:test";

import { createController as createWorkspaceController } from "../server/modules/workspace/controller.js";
import { createReplyDouble } from "./helpers/replyDouble.js";

function createBaseRequest(overrides = {}) {
  return {
    id: "req-1",
    method: "POST",
    url: "/api/v1/workspace/acme/invites",
    headers: {
      "x-forwarded-for": "203.0.113.11, 198.51.100.4",
      "user-agent": "workspace-action-test"
    },
    user: {
      id: 9,
      email: "owner@example.com"
    },
    workspace: {
      id: 11,
      slug: "acme"
    },
    ...overrides
  };
}

function createWorkspaceControllerWithActionExecutor(execute) {
  return createWorkspaceController({
    authService: {
      clearSessionCookies() {},
      writeSessionCookies() {}
    },
    consoleService: {
      async ensureInitialConsoleMember() {}
    },
    actionExecutor: {
      async execute(payload) {
        return execute(payload);
      }
    }
  });
}

test("workspace controller delegates critical writes to canonical actions", async () => {
  const calls = [];
  const controller = createWorkspaceControllerWithActionExecutor(async ({ actionId, input, context }) => {
    calls.push({
      actionId,
      input,
      context
    });

    if (actionId === "workspace.member.role.update") {
      return { members: [{ userId: 22, roleId: "admin" }] };
    }
    if (actionId === "workspace.invite.create") {
      return { invites: [], createdInvite: { inviteId: 501 } };
    }
    if (actionId === "workspace.invite.revoke") {
      return { invites: [] };
    }
    if (actionId === "workspace.invite.redeem") {
      return {
        ok: true,
        decision: "accept",
        inviteId: 777,
        workspace: {
          id: 11
        }
      };
    }
    throw new Error(`Unexpected action: ${actionId}`);
  });

  const updateReply = createReplyDouble();
  await controller.updateWorkspaceMemberRole(
    createBaseRequest({
      method: "PATCH",
      url: "/api/v1/workspace/acme/members/22/role",
      params: { memberUserId: "22" },
      body: { roleId: "admin" }
    }),
    updateReply
  );
  assert.equal(updateReply.statusCode, 200);

  const createInviteReply = createReplyDouble();
  await controller.createWorkspaceInvite(
    createBaseRequest({
      method: "POST",
      url: "/api/v1/workspace/acme/invites",
      body: { email: "invitee@example.com", roleId: "member" }
    }),
    createInviteReply
  );
  assert.equal(createInviteReply.statusCode, 200);

  const revokeReply = createReplyDouble();
  await controller.revokeWorkspaceInvite(
    createBaseRequest({
      method: "DELETE",
      url: "/api/v1/workspace/acme/invites/501",
      params: { inviteId: "501" }
    }),
    revokeReply
  );
  assert.equal(revokeReply.statusCode, 200);

  const redeemReply = createReplyDouble();
  await controller.respondToPendingInviteByToken(
    createBaseRequest({
      method: "POST",
      url: "/api/v1/workspace/invitations/redeem",
      body: { token: "invite-secret-token", decision: "accept" }
    }),
    redeemReply
  );
  assert.equal(redeemReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    [
      "workspace.member.role.update",
      "workspace.invite.create",
      "workspace.invite.revoke",
      "workspace.invite.redeem"
    ]
  );
  for (const call of calls) {
    assert.equal(call.context.channel, "api");
  }
});

test("workspace controller rethrows action failures", async () => {
  const expectedError = Object.assign(new Error("failed"), {
    status: 409,
    code: "INVITE_CONFLICT"
  });
  const controller = createWorkspaceControllerWithActionExecutor(async ({ actionId }) => {
    assert.equal(actionId, "workspace.invite.create");
    throw expectedError;
  });

  const reply = createReplyDouble();
  await assert.rejects(
    () =>
      controller.createWorkspaceInvite(
        createBaseRequest({
          body: { email: "invitee@example.com", roleId: "member" }
        }),
        reply
      ),
    (error) => {
      assert.equal(error, expectedError);
      return true;
    }
  );
});
