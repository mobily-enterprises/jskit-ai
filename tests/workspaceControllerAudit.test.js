import assert from "node:assert/strict";
import test from "node:test";

import { createController as createWorkspaceController } from "../server/modules/workspace/controller.js";

function createReplyDouble() {
  return {
    statusCode: null,
    payload: null,
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function createBaseRequest(overrides = {}) {
  return {
    id: "req-1",
    method: "POST",
    url: "/api/workspace/acme/invites",
    headers: {
      "x-forwarded-for": "203.0.113.11, 198.51.100.4",
      "user-agent": "workspace-audit-test"
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

test("workspace controller emits success security audit events for critical actions", async () => {
  const auditEvents = [];
  const controller = createWorkspaceController({
    authService: {},
    workspaceService: {},
    workspaceAdminService: {
      async updateMemberRole() {
        return { members: [{ userId: 22, roleId: "admin" }] };
      },
      async createInvite() {
        return {
          invites: [],
          createdInvite: {
            inviteId: 501
          }
        };
      },
      async revokeInvite() {
        return { invites: [] };
      },
      async respondToPendingInviteByToken() {
        return {
          ok: true,
          decision: "accept",
          inviteId: 777,
          workspace: {
            id: 11
          }
        };
      }
    },
    consoleService: {},
    auditService: {
      async recordSafe(event) {
        auditEvents.push(event);
      }
    }
  });

  const updateReply = createReplyDouble();
  await controller.updateWorkspaceMemberRole(
    createBaseRequest({
      method: "PATCH",
      url: "/api/workspace/acme/members/22/role",
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
      url: "/api/workspace/acme/invites",
      body: { email: "invitee@example.com", roleId: "member" }
    }),
    createInviteReply
  );
  assert.equal(createInviteReply.statusCode, 200);

  const revokeReply = createReplyDouble();
  await controller.revokeWorkspaceInvite(
    createBaseRequest({
      method: "DELETE",
      url: "/api/workspace/acme/invites/501",
      params: { inviteId: "501" }
    }),
    revokeReply
  );
  assert.equal(revokeReply.statusCode, 200);

  const redeemReply = createReplyDouble();
  await controller.respondToPendingInviteByToken(
    createBaseRequest({
      method: "POST",
      url: "/api/workspace/invitations/redeem",
      body: { token: "invite-secret-token", decision: "accept" }
    }),
    redeemReply
  );
  assert.equal(redeemReply.statusCode, 200);

  assert.deepEqual(
    auditEvents.map((event) => [event.action, event.outcome]),
    [
      ["workspace.member.role.updated", "success"],
      ["workspace.invite.created", "success"],
      ["workspace.invite.revoked", "success"],
      ["workspace.invite.redeemed", "success"]
    ]
  );
  assert.equal(auditEvents[0].targetUserId, 22);
  assert.equal(auditEvents[1].metadata.inviteId, 501);
  assert.equal(auditEvents[3].metadata.decision, "accept");
  assert.equal(Object.prototype.hasOwnProperty.call(auditEvents[3].metadata, "token"), false);
});

test("workspace controller emits failure security audit events and rethrows", async () => {
  const auditEvents = [];
  const expectedError = Object.assign(new Error("failed"), {
    status: 409,
    code: "INVITE_CONFLICT"
  });
  const controller = createWorkspaceController({
    authService: {},
    workspaceService: {},
    workspaceAdminService: {
      async createInvite() {
        throw expectedError;
      }
    },
    consoleService: {},
    auditService: {
      async recordSafe(event) {
        auditEvents.push(event);
      }
    }
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

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "workspace.invite.created");
  assert.equal(auditEvents[0].outcome, "failure");
  assert.equal(auditEvents[0].metadata.error.status, 409);
  assert.equal(auditEvents[0].metadata.error.code, "INVITE_CONFLICT");
});
