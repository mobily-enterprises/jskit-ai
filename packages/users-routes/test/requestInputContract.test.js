import assert from "node:assert/strict";
import test from "node:test";
import { buildRoutes as buildWorkspaceRoutes } from "../src/server/routes/workspaceRoutes.js";
import { buildRoutes as buildSettingsRoutes } from "../src/server/routes/settingsRoutes.js";
import { UsersWorkspaceController } from "../src/server/controllers/UsersWorkspaceController.js";
import { UsersSettingsController } from "../src/server/controllers/UsersSettingsController.js";

function createReplyDouble() {
  return {
    statusCode: 200,
    payload: null,
    redirectedTo: "",
    code(value) {
      this.statusCode = value;
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    },
    redirect(value) {
      this.redirectedTo = String(value || "");
      return this;
    }
  };
}

function createControllerProxy() {
  const noop = async () => {};
  return new Proxy(
    {},
    {
      get() {
        return noop;
      }
    }
  );
}

function findRoute(routes, { method, path }) {
  return routes.find((route) => route.method === method && route.path === path) || null;
}

test("workspace and settings routes attach input normalizers where controller reads request.input", () => {
  const workspaceRoutes = buildWorkspaceRoutes(createControllerProxy());
  const settingsRoutes = buildSettingsRoutes(createControllerProxy());

  const workspaceSelect = findRoute(workspaceRoutes, {
    method: "POST",
    path: "/api/workspaces/select"
  });
  const workspaceMemberRole = findRoute(workspaceRoutes, {
    method: "PATCH",
    path: "/api/admin/workspace/members/:memberUserId/role"
  });
  const workspaceInviteDelete = findRoute(workspaceRoutes, {
    method: "DELETE",
    path: "/api/admin/workspace/invites/:inviteId"
  });
  const settingsProfilePatch = findRoute(settingsRoutes, {
    method: "PATCH",
    path: "/api/settings/profile"
  });
  const settingsOAuthStart = findRoute(settingsRoutes, {
    method: "GET",
    path: "/api/settings/security/oauth/:provider/start"
  });

  assert.equal(typeof workspaceSelect?.body?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.params?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.body?.normalize, "function");
  assert.equal(typeof workspaceInviteDelete?.params?.normalize, "function");
  assert.equal(typeof settingsProfilePatch?.body?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.params?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.query?.normalize, "function");
});

test("workspace controller methods use request.input payloads", async () => {
  const calls = [];
  const controller = new UsersWorkspaceController({
    authService: {},
    actionExecutor: {
      async execute(payload) {
        calls.push(payload);
        return {};
      }
    },
    consoleService: null
  });

  await controller.selectWorkspace(
    {
      input: {
        body: { workspaceSlug: "acme" }
      }
    },
    createReplyDouble()
  );
  await controller.respondToPendingInviteByToken(
    {
      input: {
        body: { token: "token-1", decision: "accept" }
      }
    },
    createReplyDouble()
  );
  await controller.updateWorkspaceSettings(
    {
      input: {
        body: { name: "Acme Workspace" }
      }
    },
    createReplyDouble()
  );
  await controller.updateWorkspaceMemberRole(
    {
      input: {
        params: { memberUserId: "12" },
        body: { roleId: "admin" }
      }
    },
    createReplyDouble()
  );
  await controller.createWorkspaceInvite(
    {
      input: {
        body: { email: "user@example.com", roleId: "member" }
      }
    },
    createReplyDouble()
  );
  await controller.revokeWorkspaceInvite(
    {
      input: {
        params: { inviteId: "55" }
      }
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, { workspaceSlug: "acme" });
  assert.deepEqual(calls[1].input, { token: "token-1", decision: "accept" });
  assert.deepEqual(calls[2].input, { name: "Acme Workspace" });
  assert.deepEqual(calls[3].input, { memberUserId: "12", roleId: "admin" });
  assert.deepEqual(calls[4].input, { email: "user@example.com", roleId: "member" });
  assert.deepEqual(calls[5].input, { inviteId: "55" });
});

test("settings controller methods use request.input payloads", async () => {
  const calls = [];
  const controller = new UsersSettingsController({
    authService: {
      writeSessionCookies() {}
    },
    actionExecutor: {
      async execute(payload) {
        calls.push(payload);
        if (payload.actionId === "settings.security.oauth.link.start") {
          return { url: "/oauth/link" };
        }
        if (payload.actionId === "settings.profile.update") {
          return { settings: {}, session: null };
        }
        if (payload.actionId === "settings.security.password.change") {
          return { message: "ok", session: null };
        }
        return {};
      }
    }
  });

  await controller.updateProfile(
    {
      input: {
        body: { displayName: "Merc" }
      }
    },
    createReplyDouble()
  );
  await controller.updatePreferences(
    {
      input: {
        body: { locale: "en-US" }
      }
    },
    createReplyDouble()
  );
  await controller.updateNotifications(
    {
      input: {
        body: { email: true }
      }
    },
    createReplyDouble()
  );
  await controller.updateChat(
    {
      input: {
        body: { compactMode: true }
      }
    },
    createReplyDouble()
  );
  await controller.changePassword(
    {
      input: {
        body: {
          currentPassword: "old-password",
          newPassword: "new-password-123",
          confirmPassword: "new-password-123"
        }
      }
    },
    createReplyDouble()
  );
  await controller.setPasswordMethodEnabled(
    {
      input: {
        body: { enabled: true }
      }
    },
    createReplyDouble()
  );
  await controller.startOAuthProviderLink(
    {
      input: {
        params: { provider: "github" },
        query: { returnTo: "/app/settings" }
      }
    },
    createReplyDouble()
  );
  await controller.unlinkOAuthProvider(
    {
      input: {
        params: { provider: "github" }
      }
    },
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, { displayName: "Merc" });
  assert.deepEqual(calls[1].input, { locale: "en-US" });
  assert.deepEqual(calls[2].input, { email: true });
  assert.deepEqual(calls[3].input, { compactMode: true });
  assert.deepEqual(calls[4].input, {
    currentPassword: "old-password",
    newPassword: "new-password-123",
    confirmPassword: "new-password-123"
  });
  assert.deepEqual(calls[5].input, { enabled: true });
  assert.deepEqual(calls[6].input, { provider: "github", returnTo: "/app/settings" });
  assert.deepEqual(calls[7].input, { provider: "github" });
});
