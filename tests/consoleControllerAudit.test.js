import assert from "node:assert/strict";
import test from "node:test";

import { createController as createConsoleController } from "../server/modules/console/controller.js";

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
    id: "req-console-1",
    method: "POST",
    url: "/api/console/invites",
    headers: {
      "x-forwarded-for": "198.51.100.10, 203.0.113.4",
      "user-agent": "console-audit-test"
    },
    user: {
      id: 5,
      email: "console-owner@example.com"
    },
    ...overrides
  };
}

test("console controller emits success security audit events for critical actions", async () => {
  const auditEvents = [];
  const controller = createConsoleController({
    consoleService: {
      async updateMemberRole() {
        return { members: [{ userId: 22, roleId: "moderator" }] };
      },
      async createInvite() {
        return {
          invites: [],
          createdInvite: {
            inviteId: 401
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
          inviteId: 902
        };
      }
    },
    auditService: {
      async recordSafe(event) {
        auditEvents.push(event);
      }
    }
  });

  const updateReply = createReplyDouble();
  await controller.updateMemberRole(
    createBaseRequest({
      method: "PATCH",
      url: "/api/console/members/22/role",
      params: { memberUserId: "22" },
      body: { roleId: "moderator" }
    }),
    updateReply
  );
  assert.equal(updateReply.statusCode, 200);

  const createReply = createReplyDouble();
  await controller.createInvite(
    createBaseRequest({
      method: "POST",
      url: "/api/console/invites",
      body: { email: "invitee@example.com", roleId: "moderator" }
    }),
    createReply
  );
  assert.equal(createReply.statusCode, 200);

  const revokeReply = createReplyDouble();
  await controller.revokeInvite(
    createBaseRequest({
      method: "DELETE",
      url: "/api/console/invites/401",
      params: { inviteId: "401" }
    }),
    revokeReply
  );
  assert.equal(revokeReply.statusCode, 200);

  const redeemReply = createReplyDouble();
  await controller.respondToPendingInviteByToken(
    createBaseRequest({
      method: "POST",
      url: "/api/console/invitations/redeem",
      body: { token: "console-secret-token", decision: "accept" }
    }),
    redeemReply
  );
  assert.equal(redeemReply.statusCode, 200);

  assert.deepEqual(
    auditEvents.map((event) => [event.action, event.outcome]),
    [
      ["console.member.role.updated", "success"],
      ["console.invite.created", "success"],
      ["console.invite.revoked", "success"],
      ["console.invite.redeemed", "success"]
    ]
  );
  assert.equal(auditEvents[0].targetUserId, 22);
  assert.equal(auditEvents[1].metadata.inviteId, 401);
  assert.equal(auditEvents[3].metadata.decision, "accept");
  assert.equal(Object.prototype.hasOwnProperty.call(auditEvents[3].metadata, "token"), false);
});

test("console controller emits failure security audit events and rethrows", async () => {
  const auditEvents = [];
  const expectedError = Object.assign(new Error("not found"), {
    status: 404,
    code: "INVITE_NOT_FOUND"
  });
  const controller = createConsoleController({
    consoleService: {
      async revokeInvite() {
        throw expectedError;
      }
    },
    auditService: {
      async recordSafe(event) {
        auditEvents.push(event);
      }
    }
  });

  const reply = createReplyDouble();
  await assert.rejects(
    () =>
      controller.revokeInvite(
        createBaseRequest({
          method: "DELETE",
          url: "/api/console/invites/999",
          params: { inviteId: "999" }
        }),
        reply
      ),
    (error) => {
      assert.equal(error, expectedError);
      return true;
    }
  );

  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].action, "console.invite.revoked");
  assert.equal(auditEvents[0].outcome, "failure");
  assert.equal(auditEvents[0].metadata.error.status, 404);
  assert.equal(auditEvents[0].metadata.error.code, "INVITE_NOT_FOUND");
});
