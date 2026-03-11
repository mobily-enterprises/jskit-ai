import assert from "node:assert/strict";
import test from "node:test";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { UsersCoreServiceProvider } from "../src/server/UsersCoreServiceProvider.js";

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

function registerUsersRoutes({ authService = {}, consoleService = null } = {}) {
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
    ["authService", authService],
    ["actionExecutor", {}],
    ["users.workspace.tenancy.enabled", true]
  ]);

  if (consoleService) {
    bindings.set("consoleService", consoleService);
  }

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

  const provider = new UsersCoreServiceProvider();
  provider.boot(app);

  return registeredRoutes;
}

function createActionRequest({ input = {}, executeAction, file = null }) {
  return {
    input,
    executeAction,
    file,
    user: {
      id: 42
    }
  };
}

test("workspace and settings routes attach only the shared transport normalizers they actually use", () => {
  const routes = registerUsersRoutes();

  const workspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/w/:workspaceSlug/workspace/settings"
  });
  const workspaceSettingsPatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/workspace/settings"
  });
  const workspaceMemberRole = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/workspace/members/:memberUserId/role"
  });
  const workspaceInviteDelete = findRoute(routes, {
    method: "DELETE",
    path: "/api/w/:workspaceSlug/workspace/invites/:inviteId"
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

  assert.equal(typeof workspaceSettings?.params?.normalize, "function");
  assert.equal(typeof workspaceSettingsPatch?.body?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.params?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.body?.normalize, "function");
  assert.equal(typeof workspaceInviteDelete?.params?.normalize, "function");
  assert.equal(typeof settingsProfilePatch?.body?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.params?.normalize, "function");
  assert.equal(typeof settingsOAuthStart?.query?.normalize, "function");
  assert.equal(typeof consoleSettingsPatch?.body?.normalize, "function");
});

test("workspace settings routes mount one canonical workspace endpoint", () => {
  const routes = registerUsersRoutes();
  const workspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/w/:workspaceSlug/workspace/settings"
  });
  const adminWorkspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/admin/w/:workspaceSlug/workspace/settings"
  });
  const consoleWorkspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/console/w/:workspaceSlug/workspace/settings"
  });

  assert.ok(workspaceSettings);
  assert.equal(workspaceSettings?.workspaceSurface, undefined);
  assert.equal(adminWorkspaceSettings, null);
  assert.equal(consoleWorkspaceSettings, null);
});

test("workspace invite and member handlers build action input from request.input", async () => {
  const routes = registerUsersRoutes();
  const workspaceInviteRedeem = findRoute(routes, {
    method: "POST",
    path: "/api/workspace/invitations/redeem"
  });
  const workspaceMemberRolePatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/workspace/members/:memberUserId/role"
  });
  const workspaceInviteCreate = findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/workspace/invites"
  });
  const workspaceInviteDelete = findRoute(routes, {
    method: "DELETE",
    path: "/api/w/:workspaceSlug/workspace/invites/:inviteId"
  });
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await workspaceInviteRedeem.handler(
    createActionRequest({
      input: {
        body: { token: "token-1", decision: "accept" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await workspaceMemberRolePatch.handler(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme", memberUserId: "12" },
        body: { roleId: "admin" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await workspaceInviteCreate.handler(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme" },
        body: { email: "user@example.com", roleId: "member" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await workspaceInviteDelete.handler(
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

test("workspace settings route handlers build action input from request.input", async () => {
  const routes = registerUsersRoutes();
  const workspaceSettingsPatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/workspace/settings"
  });
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await workspaceSettingsPatch.handler(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme" },
        body: { name: "Acme Workspace" }
      },
      executeAction
    }),
    createReplyDouble()
  );

  assert.deepEqual(calls[0], {
    actionId: "workspace.settings.update",
    input: { workspaceSlug: "acme", name: "Acme Workspace" }
  });
});

test("account route handlers build action input from request.input", async () => {
  const routes = registerUsersRoutes({
    authService: {
      writeSessionCookies() {}
    }
  });
  const calls = [];
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

  await findRoute(routes, { method: "PATCH", path: "/api/settings/profile" }).handler(
    createActionRequest({
      input: { body: { displayName: "Merc" } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "PATCH", path: "/api/settings/preferences" }).handler(
    createActionRequest({
      input: { body: { locale: "en-US" } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "PATCH", path: "/api/settings/notifications" }).handler(
    createActionRequest({
      input: { body: { email: true } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "PATCH", path: "/api/settings/chat" }).handler(
    createActionRequest({
      input: { body: { compactMode: true } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "POST", path: "/api/settings/security/change-password" }).handler(
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
  await findRoute(routes, { method: "PATCH", path: "/api/settings/security/methods/password" }).handler(
    createActionRequest({
      input: { body: { enabled: true } },
      executeAction
    }),
    createReplyDouble()
  );
  const oauthReply = createReplyDouble();
  await findRoute(routes, { method: "GET", path: "/api/settings/security/oauth/:provider/start" }).handler(
    createActionRequest({
      input: {
        params: { provider: "github" },
        query: { returnTo: "/app/settings" }
      },
      executeAction
    }),
    oauthReply
  );
  await findRoute(routes, { method: "DELETE", path: "/api/settings/security/oauth/:provider" }).handler(
    createActionRequest({
      input: { params: { provider: "github" } },
      executeAction
    }),
    createReplyDouble()
  );
  await findRoute(routes, { method: "POST", path: "/api/settings/security/logout-others" }).handler(
    createActionRequest({
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
  assert.equal(oauthReply.redirectedTo, "/oauth/link");
  assert.deepEqual(calls[7].input, { provider: "github" });
  assert.equal(calls[8].actionId, "settings.security.sessions.logout_others");
});

test("console settings route handlers use request.input payloads", async () => {
  const routes = registerUsersRoutes();
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {
      settings: {
        assistantSystemPromptWorkspace: String(payload?.input?.assistantSystemPromptWorkspace || "")
      }
    };
  };

  await findRoute(routes, { method: "GET", path: "/api/console/settings" }).handler(
    createActionRequest({ executeAction }),
    createReplyDouble()
  );

  await findRoute(routes, { method: "PATCH", path: "/api/console/settings" }).handler(
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
