import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceController } from "../controllers/workspaceController.js";

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

test("workspace controller requires all dependencies", () => {
  assert.throws(() => createWorkspaceController({}), /required/);
});

test("workspace controller bootstrap handles transient, cookie management, and payload mapping", async () => {
  const calls = [];
  const authService = {
    async authenticateRequest(request) {
      calls.push(["authenticateRequest", request.state]);
      if (request.state === "transient") {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      if (request.state === "signed-out") {
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
    },
    clearSessionCookies(reply) {
      calls.push(["clearSessionCookies"]);
      reply.cleared = true;
    },
    writeSessionCookies(reply, session) {
      calls.push(["writeSessionCookies", session.access_token]);
      reply.written = true;
    }
  };
  const workspaceService = {
    async buildBootstrapPayload({ user }) {
      calls.push(["buildBootstrapPayload", user ? user.id : null]);
      return {
        session: {
          authenticated: Boolean(user)
        },
        workspaces: []
      };
    }
  };
  const workspaceAdminService = {};

  const controller = createWorkspaceController({
    authService,
    workspaceService,
    workspaceAdminService
  });

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

  assert.equal(
    calls.some((entry) => entry[0] === "buildBootstrapPayload"),
    true
  );
});

test("workspace controller delegates workspace and admin routes to services", async () => {
  const calls = [];
  const authService = {
    async authenticateRequest() {
      return {
        authenticated: false,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    },
    clearSessionCookies() {},
    writeSessionCookies() {}
  };
  const workspaceService = {
    async buildBootstrapPayload() {
      return { session: { authenticated: false } };
    },
    async listWorkspacesForUser(user, options) {
      calls.push(["listWorkspacesForUser", user.id, options.request.marker]);
      return [{ slug: "acme" }];
    },
    async selectWorkspaceForUser(user, selector, options) {
      calls.push(["selectWorkspaceForUser", user.id, selector, options.request.marker]);
      return {
        workspace: { id: 1, slug: "acme" },
        membership: { roleId: "member", status: "active" },
        permissions: ["history.read"],
        workspaceSettings: { invitesEnabled: true }
      };
    },
    async listPendingInvitesForUser(user) {
      calls.push(["listPendingInvitesForUser", user.id]);
      return [
        {
          id: 15,
          workspaceId: 11,
          token: "inviteh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          workspaceSlug: "acme",
          workspaceName: "Acme",
          workspaceAvatarUrl: "",
          roleId: "member",
          status: "pending",
          expiresAt: "2030-01-01T00:00:00.000Z",
          invitedByDisplayName: "Owner",
          invitedByEmail: "owner@example.com"
        }
      ];
    }
  };
  const workspaceAdminService = {
    getRoleCatalog() {
      calls.push(["getRoleCatalog"]);
      return { roles: [] };
    },
    async getWorkspaceSettings(workspace, options) {
      calls.push(["getWorkspaceSettings", workspace.id, options.includeAppSurfaceDenyLists]);
      return { workspace: { id: workspace.id }, settings: {} };
    },
    async updateWorkspaceSettings(workspace, payload) {
      calls.push(["updateWorkspaceSettings", workspace.id, payload.name]);
      return { workspace: { id: workspace.id }, settings: payload };
    },
    async listMembers(workspace) {
      calls.push(["listMembers", workspace.id]);
      return { members: [] };
    },
    async updateMemberRole(workspace, payload) {
      calls.push(["updateMemberRole", workspace.id, payload.memberUserId, payload.roleId]);
      return { members: [{ userId: Number(payload.memberUserId), roleId: payload.roleId }] };
    },
    async listInvites(workspace) {
      calls.push(["listInvites", workspace.id]);
      return { invites: [] };
    },
    async createInvite(workspace, user, payload) {
      calls.push(["createInvite", workspace.id, user.id, payload.email]);
      return { invites: [{ id: 1 }] };
    },
    async revokeInvite(workspace, inviteId) {
      calls.push(["revokeInvite", workspace.id, inviteId]);
      return { invites: [] };
    },
    async respondToPendingInviteByToken({ user, inviteToken, decision }) {
      calls.push(["respondToPendingInviteByToken", user.id, inviteToken, decision]);
      return { ok: true, decision };
    }
  };
  const controller = createWorkspaceController({
    authService,
    workspaceService,
    workspaceAdminService
  });

  const user = { id: 7, email: "user@example.com" };
  const workspace = { id: 11, slug: "acme" };

  const listReply = createReplyDouble();
  await controller.listWorkspaces({ marker: "list", user }, listReply);
  assert.equal(listReply.statusCode, 200);
  assert.deepEqual(listReply.payload, { workspaces: [{ slug: "acme" }] });

  const selectReply = createReplyDouble();
  await controller.selectWorkspace(
    {
      marker: "select",
      user,
      body: {
        workspaceSlug: "acme"
      }
    },
    selectReply
  );
  assert.equal(selectReply.statusCode, 200);
  assert.equal(selectReply.payload.ok, true);
  assert.equal(selectReply.payload.workspace.slug, "acme");

  const selectFallbackReply = createReplyDouble();
  await controller.selectWorkspace(
    {
      marker: "select-fallback",
      user,
      body: {
        slug: "acme-slug"
      }
    },
    selectFallbackReply
  );
  assert.equal(selectFallbackReply.statusCode, 200);

  const selectWorkspaceIdReply = createReplyDouble();
  await controller.selectWorkspace(
    {
      marker: "select-id",
      user,
      body: {
        workspaceId: "22"
      }
    },
    selectWorkspaceIdReply
  );
  assert.equal(selectWorkspaceIdReply.statusCode, 200);

  const settingsReply = createReplyDouble();
  await controller.getWorkspaceSettings(
    {
      workspace,
      permissions: ["workspace.settings.update"]
    },
    settingsReply
  );
  assert.equal(settingsReply.statusCode, 200);

  const settingsViewOnlyReply = createReplyDouble();
  await controller.getWorkspaceSettings(
    {
      workspace,
      permissions: ["workspace.settings.view"]
    },
    settingsViewOnlyReply
  );
  assert.equal(settingsViewOnlyReply.statusCode, 200);

  const updateReply = createReplyDouble();
  await controller.updateWorkspaceSettings(
    {
      workspace,
      body: {
        name: "Acme Prime"
      }
    },
    updateReply
  );
  assert.equal(updateReply.statusCode, 200);

  const updateFallbackReply = createReplyDouble();
  await controller.updateWorkspaceSettings({ workspace }, updateFallbackReply);
  assert.equal(updateFallbackReply.statusCode, 200);

  const rolesReply = createReplyDouble();
  await controller.listWorkspaceRoles({}, rolesReply);
  assert.equal(rolesReply.statusCode, 200);
  assert.deepEqual(rolesReply.payload, {
    roleCatalog: { roles: [] }
  });

  const membersReply = createReplyDouble();
  await controller.listWorkspaceMembers({ workspace }, membersReply);
  assert.equal(membersReply.statusCode, 200);

  const updateMemberReply = createReplyDouble();
  await controller.updateWorkspaceMemberRole(
    {
      workspace,
      params: {
        memberUserId: "19"
      },
      body: {
        roleId: "admin"
      }
    },
    updateMemberReply
  );
  assert.equal(updateMemberReply.statusCode, 200);

  const invitesReply = createReplyDouble();
  await controller.listWorkspaceInvites({ workspace }, invitesReply);
  assert.equal(invitesReply.statusCode, 200);

  const createInviteReply = createReplyDouble();
  await controller.createWorkspaceInvite(
    {
      workspace,
      user,
      body: {
        email: "invitee@example.com"
      }
    },
    createInviteReply
  );
  assert.equal(createInviteReply.statusCode, 200);

  const createInviteFallbackReply = createReplyDouble();
  await controller.createWorkspaceInvite(
    {
      workspace,
      user
    },
    createInviteFallbackReply
  );
  assert.equal(createInviteFallbackReply.statusCode, 200);

  const revokeReply = createReplyDouble();
  await controller.revokeWorkspaceInvite(
    {
      workspace,
      params: {
        inviteId: "77"
      }
    },
    revokeReply
  );
  assert.equal(revokeReply.statusCode, 200);

  const pendingReply = createReplyDouble();
  await controller.listPendingInvites({ user }, pendingReply);
  assert.equal(pendingReply.statusCode, 200);
  assert.deepEqual(pendingReply.payload, {
    pendingInvites: [
      {
        id: 15,
        workspaceId: 11,
        token: "inviteh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        workspaceSlug: "acme",
        workspaceName: "Acme",
        workspaceAvatarUrl: "",
        roleId: "member",
        status: "pending",
        expiresAt: "2030-01-01T00:00:00.000Z",
        invitedByDisplayName: "Owner",
        invitedByEmail: "owner@example.com"
      }
    ]
  });

  const respondByTokenReply = createReplyDouble();
  await controller.respondToPendingInviteByToken(
    {
      user,
      body: {
        token: "invite-token",
        decision: "accept"
      }
    },
    respondByTokenReply
  );
  assert.equal(respondByTokenReply.statusCode, 200);
  assert.equal(respondByTokenReply.payload.ok, true);

  assert.equal(
    calls.some((entry) => entry[0] === "listWorkspacesForUser"),
    true
  );
  assert.equal(
    calls.some((entry) => entry[0] === "respondToPendingInviteByToken"),
    true
  );
});
