import assert from "node:assert/strict";
import test from "node:test";

import { createController as createWorkspaceController } from "../server/modules/workspace/controller.js";
import { createReplyDouble } from "./helpers/replyDouble.js";

function createWorkspaceControllerWithExecutor(execute, overrides = {}) {
  return createWorkspaceController({
    authService: {
      clearSessionCookies(reply) {
        reply.cleared = true;
      },
      writeSessionCookies(reply) {
        reply.written = true;
      }
    },
    consoleService: {
      async ensureInitialConsoleMember() {}
    },
    actionExecutor: {
      async execute(payload) {
        return execute(payload);
      }
    },
    ...overrides
  });
}

test("workspace controller requires all dependencies", () => {
  assert.throws(() => createWorkspaceController({}), /required/);
});

test("workspace controller bootstrap handles transient, cookie management, and payload mapping", async () => {
  const calls = [];
  const controller = createWorkspaceControllerWithExecutor(
    async ({ actionId, input, context }) => {
      calls.push([actionId, input, context]);
      const state = context.request.state;
      if (actionId === "auth.session.read") {
        if (state === "transient") {
          return {
            authenticated: false,
            clearSession: false,
            session: null,
            transientFailure: true
          };
        }
        if (state === "signed-out") {
          return {
            authenticated: false,
            clearSession: true,
            session: null,
            transientFailure: false
          };
        }
        return {
          authenticated: true,
          clearSession: false,
          session: { access_token: "at" },
          transientFailure: false,
          profile: { id: 9, displayName: "Tony", email: "tony@example.com" }
        };
      }

      assert.equal(actionId, "workspace.bootstrap.read");
      return {
        session: {
          authenticated: Boolean(input.user)
        },
        workspaces: []
      };
    },
    {
      consoleService: {
        async ensureInitialConsoleMember(userId) {
          calls.push(["ensureInitialConsoleMember", Number(userId)]);
        }
      }
    }
  );

  const transientReply = createReplyDouble();
  await controller.bootstrap({ state: "transient" }, transientReply);
  assert.equal(transientReply.statusCode, 503);
  assert.equal(transientReply.payload.error.includes("temporarily unavailable"), true);

  const signedOutReply = createReplyDouble();
  await controller.bootstrap({ state: "signed-out" }, signedOutReply);
  assert.equal(signedOutReply.statusCode, 200);
  assert.equal(signedOutReply.payload.session.authenticated, false);
  assert.equal(signedOutReply.cleared, true);

  const signedInReply = createReplyDouble();
  await controller.bootstrap({ state: "ok" }, signedInReply);
  assert.equal(signedInReply.statusCode, 200);
  assert.equal(signedInReply.payload.session.authenticated, true);
  assert.equal(signedInReply.written, true);

  assert.equal(calls.some(([actionId]) => actionId === "workspace.bootstrap.read"), true);
  assert.equal(calls.some(([kind, userId]) => kind === "ensureInitialConsoleMember" && userId === 9), true);
});

test("workspace controller delegates routes to action executor", async () => {
  const calls = [];
  const controller = createWorkspaceControllerWithExecutor(async ({ actionId, input, context }) => {
    calls.push({
      actionId,
      input,
      context
    });
    if (actionId === "workspace.workspaces.list") {
      return { workspaces: [{ slug: "acme" }] };
    }
    if (actionId === "workspace.select") {
      return {
        workspace: { id: 1, slug: "acme" },
        membership: { roleId: "member", status: "active" },
        permissions: ["history.read"],
        workspaceSettings: { invitesEnabled: true }
      };
    }
    if (actionId === "workspace.roles.list") {
      return { roleCatalog: { roles: [] } };
    }
    if (actionId === "workspace.invitations.pending.list") {
      return { pendingInvites: [] };
    }
    return { ok: true, invites: [], members: [], settings: {}, workspace: { id: 11 } };
  });

  const workspace = { id: 11, slug: "acme" };

  const listReply = createReplyDouble();
  await controller.listWorkspaces({ marker: "list" }, listReply);
  assert.equal(listReply.statusCode, 200);
  assert.deepEqual(listReply.payload, { workspaces: [{ slug: "acme" }] });

  const selectReply = createReplyDouble();
  await controller.selectWorkspace(
    {
      marker: "select",
      body: {
        workspaceSlug: "acme"
      }
    },
    selectReply
  );
  assert.equal(selectReply.statusCode, 200);
  assert.equal(selectReply.payload.ok, true);
  assert.equal(selectReply.payload.workspace.slug, "acme");

  const rolesReply = createReplyDouble();
  await controller.listWorkspaceRoles({ workspace }, rolesReply);
  assert.equal(rolesReply.statusCode, 200);
  assert.deepEqual(rolesReply.payload, {
    roleCatalog: { roles: [] }
  });

  const pendingReply = createReplyDouble();
  await controller.listPendingInvites({ workspace }, pendingReply);
  assert.equal(pendingReply.statusCode, 200);
  assert.deepEqual(pendingReply.payload, { pendingInvites: [] });

  assert.equal(calls.every((entry) => entry.context.channel === "api"), true);
  assert.equal(calls.some((entry) => entry.actionId === "workspace.select"), true);
});

test("workspace controller publishes realtime events for workspace admin writes", async () => {
  const publishCalls = [];
  const controller = createWorkspaceControllerWithExecutor(async ({ actionId }) => {
    if (actionId === "workspace.invite.create") {
      return { createdInvite: { inviteId: 42 }, invites: [{ id: 42 }] };
    }
    if (actionId === "workspace.invite.redeem") {
      return {
        ok: true,
        inviteId: 42,
        workspace: { id: 11 }
      };
    }
    if (actionId === "workspace.member.role.update") {
      return { members: [{ userId: 22, roleId: "admin" }] };
    }
    if (actionId === "workspace.settings.update") {
      return {
        workspace: { id: 11 },
        settings: { name: "Acme Prime" }
      };
    }
    return { invites: [] };
  }, {
    realtimeEventsService: {
      publishWorkspaceEvent(payload) {
        publishCalls.push(payload);
      }
    }
  });

  const requestBase = {
    workspace: { id: 11, slug: "acme" },
    headers: {
      "x-command-id": "cmd_w_1",
      "x-client-id": "cli_w_1"
    }
  };

  const settingsReply = createReplyDouble();
  await controller.updateWorkspaceSettings(
    {
      ...requestBase,
      body: { name: "Acme Prime" }
    },
    settingsReply
  );
  assert.equal(settingsReply.statusCode, 200);

  const roleReply = createReplyDouble();
  await controller.updateWorkspaceMemberRole(
    {
      ...requestBase,
      params: { memberUserId: "22" },
      body: { roleId: "admin" }
    },
    roleReply
  );
  assert.equal(roleReply.statusCode, 200);

  const inviteReply = createReplyDouble();
  await controller.createWorkspaceInvite(
    {
      ...requestBase,
      body: { email: "invitee@example.com" }
    },
    inviteReply
  );
  assert.equal(inviteReply.statusCode, 200);

  const revokeReply = createReplyDouble();
  await controller.revokeWorkspaceInvite(
    {
      ...requestBase,
      params: { inviteId: "42" }
    },
    revokeReply
  );
  assert.equal(revokeReply.statusCode, 200);

  const redeemReply = createReplyDouble();
  await controller.respondToPendingInviteByToken(
    {
      ...requestBase,
      body: {
        token: "invite-token",
        decision: "accept"
      }
    },
    redeemReply
  );
  assert.equal(redeemReply.statusCode, 200);

  assert.equal(publishCalls.length, 6);
  assert.equal(
    publishCalls.some(
      (payload) => payload.topic === "workspace_meta" && payload.eventType === "workspace.meta.updated"
    ),
    true
  );
});
