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

function createActionRequest({ input = {}, executeAction }) {
  return {
    input,
    executeAction,
    user: {
      id: 42
    }
  };
}

test("workspace and settings routes attach input normalizers where controller reads request.input", () => {
  const workspaceRoutes = buildWorkspaceRoutes(createControllerProxy(), {
    workspaceSurfaceDefinitions: [
      {
        id: "coffie",
        prefix: "/coffie"
      }
    ]
  });
  const settingsRoutes = buildSettingsRoutes(createControllerProxy());

  const workspaceBootstrap = findRoute(workspaceRoutes, {
    method: "GET",
    path: "/api/bootstrap"
  });
  const workspaceSettings = findRoute(workspaceRoutes, {
    method: "GET",
    path: "/api/coffie/w/:workspaceSlug/workspace/settings"
  });
  const workspaceMemberRole = findRoute(workspaceRoutes, {
    method: "PATCH",
    path: "/api/coffie/w/:workspaceSlug/workspace/members/:memberUserId/role"
  });
  const workspaceInviteDelete = findRoute(workspaceRoutes, {
    method: "DELETE",
    path: "/api/coffie/w/:workspaceSlug/workspace/invites/:inviteId"
  });
  const settingsProfilePatch = findRoute(settingsRoutes, {
    method: "PATCH",
    path: "/api/settings/profile"
  });
  const settingsOAuthStart = findRoute(settingsRoutes, {
    method: "GET",
    path: "/api/settings/security/oauth/:provider/start"
  });

  assert.equal(typeof workspaceBootstrap?.query?.normalize, "function");
  assert.equal(typeof workspaceSettings?.params?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.params?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.body?.normalize, "function");
  assert.equal(typeof workspaceInviteDelete?.params?.normalize, "function");
  assert.equal(typeof settingsProfilePatch?.body?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.params?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.query?.normalize, "function");
});

test("workspace routes mount workspace-admin endpoints per workspace-enabled surface prefix", () => {
  const workspaceRoutes = buildWorkspaceRoutes(createControllerProxy(), {
    workspaceSurfaceDefinitions: [
      {
        id: "coffie",
        prefix: "/coffie"
      }
    ]
  });
  const workspaceSettings = findRoute(workspaceRoutes, {
    method: "GET",
    path: "/api/coffie/w/:workspaceSlug/workspace/settings"
  });

  assert.equal(workspaceSettings?.workspaceSurface, "coffie");
});

test("workspace controller methods use request.input payloads", async () => {
  const calls = [];
  const controller = new UsersWorkspaceController({
    authService: {},
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug(_user, _workspaceSlug) {
        return {
          workspace: { id: 1, slug: "acme", name: "Acme Workspace" },
          membership: { roleId: "owner", status: "active" },
          permissions: ["workspace.settings.update"]
        };
      }
    },
    consoleService: null
  });
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await controller.respondToPendingInviteByToken(
    createActionRequest({
      input: {
        body: { token: "token-1", decision: "accept" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.updateWorkspaceSettings(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme" },
        body: { name: "Acme Workspace" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.updateWorkspaceMemberRole(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme", memberUserId: "12" },
        body: { roleId: "admin" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.createWorkspaceInvite(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme" },
        body: { email: "user@example.com", roleId: "member" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.revokeWorkspaceInvite(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme", inviteId: "55" }
      },
      executeAction
    }),
    createReplyDouble()
  );

  assert.deepEqual(calls[0].input, { token: "token-1", decision: "accept" });
  assert.deepEqual(calls[1].input, { workspaceSlug: "acme", name: "Acme Workspace" });
  assert.deepEqual(calls[2].input, { workspaceSlug: "acme", memberUserId: "12", roleId: "admin" });
  assert.deepEqual(calls[3].input, { workspaceSlug: "acme", email: "user@example.com", roleId: "member" });
  assert.deepEqual(calls[4].input, { workspaceSlug: "acme", inviteId: "55" });
});

test("settings controller methods use request.input payloads", async () => {
  const calls = [];
  const controller = new UsersSettingsController({
    authService: {
      writeSessionCookies() {}
    }
  });
  const executeAction = async (payload) => {
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
  };

  await controller.updateProfile(
    createActionRequest({
      input: {
        body: { displayName: "Merc" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.updatePreferences(
    createActionRequest({
      input: {
        body: { locale: "en-US" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.updateNotifications(
    createActionRequest({
      input: {
        body: { email: true }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.updateChat(
    createActionRequest({
      input: {
        body: { compactMode: true }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.changePassword(
    createActionRequest({
      input: {
        body: {
          currentPassword: "old-password",
          newPassword: "new-password-123",
          confirmPassword: "new-password-123"
        }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.setPasswordMethodEnabled(
    createActionRequest({
      input: {
        body: { enabled: true }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.startOAuthProviderLink(
    createActionRequest({
      input: {
        params: { provider: "github" },
        query: { returnTo: "/app/settings" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await controller.unlinkOAuthProvider(
    createActionRequest({
      input: {
        params: { provider: "github" }
      },
      executeAction
    }),
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
