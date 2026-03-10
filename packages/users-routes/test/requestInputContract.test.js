import assert from "node:assert/strict";
import test from "node:test";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { UsersRouteServiceProvider } from "../src/server/providers/UsersRouteServiceProvider.js";
import { UsersWorkspaceController } from "../src/server/controllers/UsersWorkspaceController.js";
import { WorkspaceSettingsController } from "../src/server/controllers/WorkspaceSettingsController.js";
import { UsersSettingsController } from "../src/server/controllers/UsersSettingsController.js";
import { UsersConsoleSettingsController } from "../src/server/controllers/UsersConsoleSettingsController.js";

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

function findRoute(routes, { method, path }) {
  return routes.find((route) => route.method === method && route.path === path) || null;
}

function registerUsersRoutes() {
  const registeredRoutes = [];
  const router = {
    register(method, path, route, handler) {
      registeredRoutes.push({
        ...route,
        method,
        path,
        handler
      });
    }
  };

  const bindings = new Map([
    [KERNEL_TOKENS.HttpRouter, router],
    ["authService", {}],
    [
      "users.workspace.service",
      {
        async resolveWorkspaceContextForUserBySlug() {
          return {
            workspace: { id: 1, slug: "acme", name: "Acme Workspace" },
            membership: { roleId: "owner", status: "active" },
            permissions: ["workspace.settings.update"]
          };
        }
      }
    ],
    ["actionExecutor", {}],
  ]);

  const app = {
    has(token) {
      return bindings.has(token);
    },
    make(token) {
      if (!bindings.has(token)) {
        throw new Error(`Missing test binding for token: ${String(token)}`);
      }
      return bindings.get(token);
    }
  };

  const provider = new UsersRouteServiceProvider();
  provider.register(app);
  provider.boot(app);

  return registeredRoutes;
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
  const routes = registerUsersRoutes();

  const workspaceBootstrap = findRoute(routes, {
    method: "GET",
    path: "/api/bootstrap"
  });
  const workspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/app/w/:workspaceSlug/workspace/settings"
  });
  const workspaceMemberRole = findRoute(routes, {
    method: "PATCH",
    path: "/api/app/w/:workspaceSlug/workspace/members/:memberUserId/role"
  });
  const workspaceInviteDelete = findRoute(routes, {
    method: "DELETE",
    path: "/api/app/w/:workspaceSlug/workspace/invites/:inviteId"
  });
  const settingsProfilePatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/settings/profile"
  });
  const settingsOAuthStart = findRoute(routes, {
    method: "GET",
    path: "/api/settings/security/oauth/:provider/start"
  });
  const consoleSettingsPatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/console/settings"
  });

  assert.equal(typeof workspaceBootstrap?.query?.normalize, "function");
  assert.equal(typeof workspaceSettings?.params?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.params?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.body?.normalize, "function");
  assert.equal(typeof workspaceInviteDelete?.params?.normalize, "function");
  assert.equal(typeof settingsProfilePatch?.body?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.params?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.query?.normalize, "function");
  assert.equal(typeof consoleSettingsPatch?.body?.normalize, "function");
});

test("workspace routes mount explicit app/admin workspace-admin endpoints", () => {
  const routes = registerUsersRoutes();
  const appWorkspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/app/w/:workspaceSlug/workspace/settings"
  });
  const adminWorkspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/admin/w/:workspaceSlug/workspace/settings"
  });
  const consoleWorkspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/console/w/:workspaceSlug/workspace/settings"
  });

  assert.equal(appWorkspaceSettings?.workspaceSurface, "app");
  assert.equal(adminWorkspaceSettings?.workspaceSurface, "admin");
  assert.equal(consoleWorkspaceSettings, null);
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
  assert.deepEqual(calls[1].input, { workspaceSlug: "acme", memberUserId: "12", roleId: "admin" });
  assert.deepEqual(calls[2].input, { workspaceSlug: "acme", email: "user@example.com", roleId: "member" });
  assert.deepEqual(calls[3].input, { workspaceSlug: "acme", inviteId: "55" });
});

test("workspace settings controller methods use request.input payloads", async () => {
  const calls = [];
  const controller = new WorkspaceSettingsController({
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug(_user, _workspaceSlug) {
        return {
          workspace: { id: 1, slug: "acme", name: "Acme Workspace" },
          membership: { roleId: "owner", status: "active" },
          permissions: ["workspace.settings.update"]
        };
      }
    }
  });
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

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

  assert.deepEqual(calls[0].input, { workspaceSlug: "acme", name: "Acme Workspace" });
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

test("console settings controller methods use request.input payloads", async () => {
  const calls = [];
  const controller = new UsersConsoleSettingsController();
  const executeAction = async (payload) => {
    calls.push(payload);
    return {
      settings: {
        assistantSystemPromptWorkspace: String(payload?.input?.assistantSystemPromptWorkspace || "")
      }
    };
  };

  await controller.get(
    createActionRequest({
      executeAction
    }),
    createReplyDouble()
  );

  await controller.update(
    createActionRequest({
      input: {
        body: {
          assistantSystemPromptWorkspace: "Prompt"
        }
      },
      executeAction
    }),
    createReplyDouble()
  );

  assert.equal(calls[0].actionId, "console.settings.read");
  assert.deepEqual(calls[1], {
    actionId: "console.settings.update",
    input: {
      assistantSystemPromptWorkspace: "Prompt"
    }
  });
});
