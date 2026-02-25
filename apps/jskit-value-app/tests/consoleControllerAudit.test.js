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
    url: "/api/v1/console/invites",
    headers: {
      "x-forwarded-for": "198.51.100.10, 203.0.113.4",
      "user-agent": "console-action-test"
    },
    user: {
      id: 5,
      email: "console-owner@example.com"
    },
    ...overrides
  };
}

test("console controller delegates critical writes to canonical actions", async () => {
  const calls = [];
  const controller = createConsoleController({
    actionExecutor: {
      async execute({ actionId, input, context }) {
        calls.push({
          actionId,
          input,
          context
        });

        if (actionId === "console.member.role.update") {
          return { members: [{ userId: 22, roleId: "moderator" }] };
        }
        if (actionId === "console.invite.create") {
          return { invites: [], createdInvite: { inviteId: 401 } };
        }
        if (actionId === "console.settings.update") {
          return { settings: { assistantSystemPromptWorkspace: "Use concise language." } };
        }
        if (actionId === "console.invite.revoke") {
          return { invites: [] };
        }
        if (actionId === "console.invite.redeem") {
          return { ok: true, decision: "accept", inviteId: 902 };
        }
        throw new Error(`Unexpected action: ${actionId}`);
      }
    }
  });

  const updateReply = createReplyDouble();
  await controller.updateMemberRole(
    createBaseRequest({
      method: "PATCH",
      url: "/api/v1/console/members/22/role",
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
      url: "/api/v1/console/invites",
      body: { email: "invitee@example.com", roleId: "moderator" }
    }),
    createReply
  );
  assert.equal(createReply.statusCode, 200);

  const settingsReply = createReplyDouble();
  await controller.updateAssistantSettings(
    createBaseRequest({
      method: "PATCH",
      url: "/api/v1/console/settings",
      body: {
        assistantSystemPromptWorkspace: "Use concise language."
      }
    }),
    settingsReply
  );
  assert.equal(settingsReply.statusCode, 200);

  const revokeReply = createReplyDouble();
  await controller.revokeInvite(
    createBaseRequest({
      method: "DELETE",
      url: "/api/v1/console/invites/401",
      params: { inviteId: "401" }
    }),
    revokeReply
  );
  assert.equal(revokeReply.statusCode, 200);

  const redeemReply = createReplyDouble();
  await controller.respondToPendingInviteByToken(
    createBaseRequest({
      method: "POST",
      url: "/api/v1/console/invitations/redeem",
      body: { token: "console-secret-token", decision: "accept" }
    }),
    redeemReply
  );
  assert.equal(redeemReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    [
      "console.member.role.update",
      "console.invite.create",
      "console.settings.update",
      "console.invite.revoke",
      "console.invite.redeem"
    ]
  );
  for (const call of calls) {
    assert.equal(call.context.channel, "api");
  }
});

test("console controller rethrows action errors", async () => {
  const expectedError = Object.assign(new Error("not found"), {
    status: 404,
    code: "INVITE_NOT_FOUND"
  });
  const controller = createConsoleController({
    actionExecutor: {
      async execute({ actionId }) {
        assert.equal(actionId, "console.invite.revoke");
        throw expectedError;
      }
    }
  });

  const reply = createReplyDouble();
  await assert.rejects(
    () =>
      controller.revokeInvite(
        createBaseRequest({
          method: "DELETE",
          url: "/api/v1/console/invites/999",
          params: { inviteId: "999" }
        }),
        reply
      ),
    (error) => {
      assert.equal(error, expectedError);
      return true;
    }
  );
});
