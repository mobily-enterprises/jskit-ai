import assert from "node:assert/strict";
import test from "node:test";
import { UsersCoreServiceProvider } from "../../users-core/src/server/UsersCoreServiceProvider.js";
import { resolveTenancyProfile } from "../src/shared/tenancyProfile.js";
import { WorkspacesCoreServiceProvider } from "../src/server/WorkspacesCoreServiceProvider.js";

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

async function registerRoutes({
  authService = {},
  consoleService = null,
  workspaceEnabled = true,
  workspaceTenancyEnabled = true,
  workspaceInvitationsEnabled = true,
  workspaceSelfCreateEnabled = true
} = {}) {
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
    ["jskit.http.router", router],
    ["authService", authService],
    [
      "users.accountProfile.service",
      {
        async readAvatar() {
          return {
            mimeType: "image/png",
            buffer: Buffer.from([])
          };
        }
      }
    ],
    ["actionExecutor", {}],
    ["workspaces.enabled", workspaceEnabled],
    ["workspaces.tenancy.enabled", workspaceTenancyEnabled],
    ["workspaces.invitations.enabled", workspaceInvitationsEnabled],
    ["workspaces.self-create.enabled", workspaceSelfCreateEnabled]
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

  const usersCoreProvider = new UsersCoreServiceProvider();
  const workspacesCoreProvider = new WorkspacesCoreServiceProvider();
  await usersCoreProvider.boot(app);
  await workspacesCoreProvider.boot(app);

  return registeredRoutes;
}

async function registerRoutesForMode({
  tenancyMode = "none",
  tenancyPolicy = {}
} = {}) {
  const tenancyProfile = resolveTenancyProfile({
    tenancyMode,
    tenancyPolicy
  });
  return registerRoutes({
    workspaceEnabled: tenancyProfile.workspace.enabled === true,
    workspaceTenancyEnabled: tenancyProfile.mode === "workspaces",
    workspaceInvitationsEnabled:
      tenancyProfile.workspace.enabled === true && tenancyProfile.mode !== "none",
    workspaceSelfCreateEnabled: tenancyProfile.workspace.allowSelfCreate === true
  });
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

test("workspace and settings routes attach only the shared transport normalizers they actually use", async () => {
  const routes = await registerRoutes();

  const workspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/w/:workspaceSlug/settings"
  });
  const workspacePatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug"
  });
  const workspaceSettingsPatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/settings"
  });
  const workspaceMemberRole = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/members/:memberUserId/role"
  });
  const workspaceMemberDelete = findRoute(routes, {
    method: "DELETE",
    path: "/api/w/:workspaceSlug/members/:memberUserId"
  });
  const workspaceInviteDelete = findRoute(routes, {
    method: "DELETE",
    path: "/api/w/:workspaceSlug/invites/:inviteId"
  });

  assert.equal(typeof workspaceSettings?.paramsValidator?.normalize, "function");
  assert.equal(typeof workspacePatch?.bodyValidator?.normalize, "function");
  assert.equal(typeof workspaceSettingsPatch?.bodyValidator?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.paramsValidator?.normalize, "function");
  assert.equal(typeof workspaceMemberRole?.bodyValidator?.normalize, "function");
  assert.equal(typeof workspaceMemberDelete?.paramsValidator?.normalize, "function");
  assert.equal(typeof workspaceInviteDelete?.paramsValidator?.normalize, "function");
});

test("workspace core/settings routes mount one canonical workspace endpoint", async () => {
  const routes = await registerRoutes();
  const workspace = findRoute(routes, {
    method: "GET",
    path: "/api/w/:workspaceSlug"
  });
  const workspacePatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug"
  });
  const workspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/w/:workspaceSlug/settings"
  });
  const workspaceSettingsPatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/settings"
  });
  const adminWorkspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/admin/w/:workspaceSlug/workspace/settings"
  });
  const consoleWorkspaceSettings = findRoute(routes, {
    method: "GET",
    path: "/api/console/w/:workspaceSlug/workspace/settings"
  });

  assert.ok(workspace);
  assert.equal(workspace?.visibility, "workspace");
  assert.equal(workspacePatch?.visibility, "workspace");
  assert.equal(workspace?.surface, "");
  assert.equal(workspacePatch?.surface, "");
  assert.ok(workspaceSettings);
  assert.equal(workspaceSettings?.visibility, "workspace");
  assert.equal(workspaceSettingsPatch?.visibility, "workspace");
  assert.equal(workspaceSettings?.surface, "");
  assert.equal(workspaceSettingsPatch?.surface, "");
  assert.equal(adminWorkspaceSettings, null);
  assert.equal(consoleWorkspaceSettings, null);
});

test("workspaces-core boot skips workspace routes when workspace policy is disabled", async () => {
  const routes = await registerRoutes({
    workspaceEnabled: false,
    workspaceTenancyEnabled: false,
    workspaceInvitationsEnabled: false,
    workspaceSelfCreateEnabled: false
  });

  assert.equal(findRoute(routes, { method: "GET", path: "/api/workspaces" }), null);
  assert.equal(findRoute(routes, { method: "POST", path: "/api/workspaces" }), null);
  assert.equal(findRoute(routes, { method: "GET", path: "/api/w/:workspaceSlug" }), null);
  assert.equal(findRoute(routes, { method: "PATCH", path: "/api/w/:workspaceSlug" }), null);
  assert.equal(findRoute(routes, { method: "GET", path: "/api/w/:workspaceSlug/settings" }), null);
  assert.equal(findRoute(routes, { method: "GET", path: "/api/settings" })?.path, "/api/settings");
});

test("workspaces-core boot skips workspace create route when self-create policy is disabled", async () => {
  const routes = await registerRoutes({
    workspaceEnabled: true,
    workspaceTenancyEnabled: true,
    workspaceInvitationsEnabled: true,
    workspaceSelfCreateEnabled: false
  });

  assert.equal(findRoute(routes, { method: "POST", path: "/api/workspaces" }), null);
  assert.equal(findRoute(routes, { method: "GET", path: "/api/workspaces" })?.path, "/api/workspaces");
});

test("workspaces-core route registration follows tenancy mode matrix", async () => {
  const noneRoutes = await registerRoutesForMode({
    tenancyMode: "none"
  });
  const personalRoutes = await registerRoutesForMode({
    tenancyMode: "personal"
  });
  const workspaceRoutes = await registerRoutesForMode({
    tenancyMode: "workspaces"
  });
  const workspaceSelfCreateRoutes = await registerRoutesForMode({
    tenancyMode: "workspaces",
    tenancyPolicy: {
      workspace: {
        allowSelfCreate: true
      }
    }
  });

  assert.equal(findRoute(noneRoutes, { method: "GET", path: "/api/workspaces" }), null);
  assert.equal(findRoute(noneRoutes, { method: "POST", path: "/api/workspaces" }), null);
  assert.equal(findRoute(noneRoutes, { method: "GET", path: "/api/w/:workspaceSlug" }), null);
  assert.equal(findRoute(noneRoutes, { method: "PATCH", path: "/api/w/:workspaceSlug" }), null);
  assert.equal(findRoute(noneRoutes, { method: "GET", path: "/api/w/:workspaceSlug/settings" }), null);
  assert.equal(findRoute(noneRoutes, { method: "GET", path: "/api/workspace/invitations/pending" }), null);

  assert.equal(findRoute(personalRoutes, { method: "GET", path: "/api/workspaces" })?.path, "/api/workspaces");
  assert.equal(findRoute(personalRoutes, { method: "POST", path: "/api/workspaces" }), null);
  assert.equal(
    findRoute(personalRoutes, { method: "GET", path: "/api/w/:workspaceSlug" })?.path,
    "/api/w/:workspaceSlug"
  );
  assert.equal(
    findRoute(personalRoutes, { method: "PATCH", path: "/api/w/:workspaceSlug" })?.path,
    "/api/w/:workspaceSlug"
  );
  assert.equal(
    findRoute(personalRoutes, { method: "GET", path: "/api/w/:workspaceSlug/settings" })?.path,
    "/api/w/:workspaceSlug/settings"
  );
  assert.equal(
    findRoute(personalRoutes, { method: "GET", path: "/api/workspace/invitations/pending" })?.path,
    "/api/workspace/invitations/pending"
  );

  assert.equal(findRoute(workspaceRoutes, { method: "GET", path: "/api/workspaces" })?.path, "/api/workspaces");
  assert.equal(findRoute(workspaceRoutes, { method: "POST", path: "/api/workspaces" }), null);
  assert.equal(
    findRoute(workspaceRoutes, { method: "GET", path: "/api/w/:workspaceSlug" })?.path,
    "/api/w/:workspaceSlug"
  );
  assert.equal(
    findRoute(workspaceRoutes, { method: "PATCH", path: "/api/w/:workspaceSlug" })?.path,
    "/api/w/:workspaceSlug"
  );
  assert.equal(
    findRoute(workspaceRoutes, { method: "GET", path: "/api/w/:workspaceSlug/settings" })?.path,
    "/api/w/:workspaceSlug/settings"
  );
  assert.equal(
    findRoute(workspaceRoutes, { method: "GET", path: "/api/workspace/invitations/pending" })?.path,
    "/api/workspace/invitations/pending"
  );

  assert.equal(
    findRoute(workspaceSelfCreateRoutes, { method: "POST", path: "/api/workspaces" })?.path,
    "/api/workspaces"
  );
});

test("workspaces-core boot skips invitation redeem/list routes when workspace invitations are disabled", async () => {
  const routes = await registerRoutes({
    workspaceEnabled: true,
    workspaceTenancyEnabled: true,
    workspaceInvitationsEnabled: false,
    workspaceSelfCreateEnabled: false
  });

  assert.equal(findRoute(routes, { method: "GET", path: "/api/workspace/invitations/pending" }), null);
  assert.equal(findRoute(routes, { method: "POST", path: "/api/workspace/invitations/redeem" }), null);
  assert.equal(findRoute(routes, { method: "GET", path: "/api/w/:workspaceSlug/invites" }), null);
  assert.equal(findRoute(routes, { method: "POST", path: "/api/w/:workspaceSlug/invites" }), null);
  assert.equal(findRoute(routes, { method: "DELETE", path: "/api/w/:workspaceSlug/invites/:inviteId" }), null);
});

test("workspace invite and member handlers build action input from request.input", async () => {
  const routes = await registerRoutes();
  const workspaceCreate = findRoute(routes, {
    method: "POST",
    path: "/api/workspaces"
  });
  const workspaceInviteRedeem = findRoute(routes, {
    method: "POST",
    path: "/api/workspace/invitations/redeem"
  });
  const workspaceMemberRolePatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/members/:memberUserId/role"
  });
  const workspaceMemberDelete = findRoute(routes, {
    method: "DELETE",
    path: "/api/w/:workspaceSlug/members/:memberUserId"
  });
  const workspaceInviteCreate = findRoute(routes, {
    method: "POST",
    path: "/api/w/:workspaceSlug/invites"
  });
  const workspaceInviteDelete = findRoute(routes, {
    method: "DELETE",
    path: "/api/w/:workspaceSlug/invites/:inviteId"
  });
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await workspaceCreate.handler(
    createActionRequest({
      input: {
        body: { name: "Operations", slug: "operations" }
      },
      executeAction
    }),
    createReplyDouble()
  );
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
        body: { roleSid: "admin" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await workspaceInviteCreate.handler(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme" },
        body: { email: "user@example.com", roleSid: "member" }
      },
      executeAction
    }),
    createReplyDouble()
  );
  await workspaceMemberDelete.handler(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme", memberUserId: "44" }
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

  assert.deepEqual(calls[0], {
    actionId: "workspace.workspaces.create",
    input: { name: "Operations", slug: "operations" }
  });
  assert.deepEqual(calls[1].input, { payload: { token: "token-1", decision: "accept" } });
  assert.deepEqual(calls[2].input, { workspaceSlug: "acme", memberUserId: "12", roleSid: "admin" });
  assert.deepEqual(calls[3].input, { workspaceSlug: "acme", email: "user@example.com", roleSid: "member" });
  assert.deepEqual(calls[4].input, { workspaceSlug: "acme", memberUserId: "44" });
  assert.deepEqual(calls[5].input, { workspaceSlug: "acme", inviteId: "55" });
});

test("workspace settings route handlers build action input from request.input", async () => {
  const routes = await registerRoutes();
  const workspaceSettingsPatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug/settings"
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
        body: { lightPrimaryColor: "#0F6B54" }
      },
      executeAction
    }),
    createReplyDouble()
  );

  assert.deepEqual(calls[0], {
    actionId: "workspace.settings.update",
    input: { workspaceSlug: "acme", patch: { lightPrimaryColor: "#0F6B54" } }
  });
});

test("workspace route handlers build action input from request.input", async () => {
  const routes = await registerRoutes();
  const workspacePatch = findRoute(routes, {
    method: "PATCH",
    path: "/api/w/:workspaceSlug"
  });
  const calls = [];
  const executeAction = async (payload) => {
    calls.push(payload);
    return {};
  };

  await workspacePatch.handler(
    createActionRequest({
      input: {
        params: { workspaceSlug: "acme" },
        body: { name: "Acme", avatarUrl: "https://example.com/acme.png" }
      },
      executeAction
    }),
    createReplyDouble()
  );

  assert.deepEqual(calls[0], {
    actionId: "workspace.workspaces.update",
    input: {
      workspaceSlug: "acme",
      patch: { name: "Acme", avatarUrl: "https://example.com/acme.png" }
    }
  });
});
