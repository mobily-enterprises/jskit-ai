import assert from "node:assert/strict";
import test from "node:test";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBootstrapRuntime, EventProvider } from "@jskit-ai/kernel/server/runtime";
import { createUsersExtensions } from "@jskit-ai/users-core/server/usersExtensions";
import { WorkspacesFeature, createWorkspacesRuntime } from "../src/server/WorkspacesFeature.js";
import { WorkspacesIntegrationsProvider } from "../src/server/WorkspacesIntegrationsProvider.js";

function createJsonRestApiFixture() {
  const resources = {};
  return {
    resources,
    async addResource(scopeName) {
      resources[scopeName] = Object.freeze({
        query: async () => ({ data: [] }),
        post: async () => null,
        patch: async () => null
      });
    }
  };
}

function runtimeConfig() {
  return {
    appPublicUrl: "http://localhost:5173",
    tenancyMode: "workspaces",
    tenancyPolicy: { workspace: { allowSelfCreate: true } },
    workspaceInvitations: { enabled: true },
    workspaceMembers: { defaults: { inviteExpiresInMs: 86400000 } },
    workspaceSettings: { defaults: { invitesEnabled: true } },
    surfaceDefaultId: "customer",
    surfaceDefinitions: {
      customer: { id: "customer", requiresWorkspace: true, accessPolicyId: "workspace_authenticated" }
    },
    surfaceAccessPolicies: {
      workspace_authenticated: { requireWorkspaceMembership: false }
    },
    roleCatalog: {
      workspace: { defaultInviteRole: "member" },
      roles: {
        owner: { permissions: ["workspace.*"] },
        member: { assignable: true, permissions: ["workspace.settings.view"] }
      }
    }
  };
}

test("WorkspacesFeature assembles workspace behavior and explicit integrations", async () => {
  const routes = [];
  const visibilityResolvers = [];
  const audienceContributors = [];
  const bootstrap = createBootstrapRuntime();
  const authExtensions = createAuthExtensions();
  const usersExtensions = createUsersExtensions();
  const jsonRestApi = createJsonRestApiFixture();
  let workspaces = null;
  let workspaceRecords = null;
  let memberships = null;
  let actionCatalogue = null;
  const probe = defineProvider({
    id: "test.workspaces.probe",
    requires: {
      actions: "runtime.actions",
      membershipsCapability: "workspaces.memberships",
      recordsCapability: "workspaces",
      workspaceCapability: "workspaces.core"
    },
    setup({ actions, membershipsCapability, recordsCapability, workspaceCapability }) {
      actionCatalogue = actions;
      memberships = membershipsCapability;
      workspaceRecords = recordsCapability;
      workspaces = workspaceCapability;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.logger": silentLogger,
      "auth.extensions": authExtensions,
      "runtime.app-root": process.cwd(),
      "runtime.bootstrap": bootstrap,
      "runtime.config": runtimeConfig(),
      "runtime.env": {},
      "runtime.http": {
        router: {
          register(method, path) {
            routes.push(`${method} ${path}`);
          }
        },
        registerVisibilityResolver(resolver) {
          visibilityResolvers.push(resolver);
        }
      },
      "runtime.json-rest-api": jsonRestApi,
      "runtime.realtime": {
        registerAudienceContributor(contributor) {
          audienceContributors.push(contributor);
        }
      },
      "users.profiles": { async findById() { return null; } },
      "users.settings": { async findByUserId() { return null; } },
      "users.extensions": usersExtensions
    },
    providers: [EventProvider, ActionProvider, WorkspacesFeature, WorkspacesIntegrationsProvider, probe]
  });

  await runtime.start();

  assert.deepEqual(Object.keys(jsonRestApi.resources).sort(), [
    "workspaceInvites",
    "workspaceMemberships",
    "workspaceSettings",
    "workspaces"
  ]);
  assert.equal(typeof workspaces.services.directory.resolveWorkspaceContextForUserBySlug, "function");
  assert.deepEqual(Object.keys(workspaces.repositories).sort(), ["workspaceInvites", "workspaceSettings"]);
  assert.equal(typeof workspaceRecords.findBySlug, "function");
  assert.equal(typeof workspaceRecords.lock, "function");
  assert.equal(typeof memberships.addMember, "function");
  assert.equal(typeof memberships.activeMemberIds, "function");
  assert.equal(typeof workspaces.services.members.prepareInvite, "function");
  assert.equal(typeof workspaces.services.members.sendInvite, "function");
  assert.equal(routes.includes("POST /api/workspaces"), true);
  assert.equal(routes.includes("GET /api/workspace/invitations/resolve"), true);
  assert.equal(actionCatalogue.listDefinitions().length, 16);
  assert.deepEqual(bootstrap.diagnostics().contributorIds, ["workspaces.bootstrap"]);
  assert.deepEqual(visibilityResolvers.map((entry) => entry.id), ["workspaces.visibility"]);
  assert.deepEqual(usersExtensions.diagnostics().profileSyncLifecycleContributorIds, ["workspaces.provisioning"]);
  assert.deepEqual(authExtensions.diagnostics().invitationContextResolverIds, ["workspaces.invitation"]);
  assert.deepEqual(authExtensions.diagnostics().policyContextResolverIds, ["workspaces.policy"]);
  assert.deepEqual(audienceContributors.map((entry) => entry.id), ["workspaces.memberships"]);
});

test("workspace realtime audiences are the actor's active memberships", async () => {
  const audienceContributors = [];
  const noop = () => {};
  WorkspacesIntegrationsProvider.setup({
    actions: { registerContextContributor: noop },
    authExtensions: { registerPolicyContextResolver: noop },
    config: runtimeConfig(),
    http: { registerVisibilityResolver: noop },
    realtime: { registerAudienceContributor: (entry) => audienceContributors.push(entry) },
    usersExtensions: { registerProfileSyncLifecycleContributor: noop },
    workspaceMemberships: {
      async listActiveWorkspaceIdsByUserIds(userIds) {
        assert.deepEqual(userIds, ["9", "10"]);
        return new Map([["9", ["11", "12"]], ["10", []]]);
      }
    },
    workspaces: {
      invitationsEnabled: false,
      services: { directory: { async resolveWorkspaceContextForUserBySlug() { return null; } } }
    }
  });
  assert.equal(audienceContributors.length, 1);
  assert.deepEqual(await audienceContributors[0].resolveActorsScopes(["9", "10"]), new Map([
    ["9", [
      { kind: "workspace", id: "11" },
      { kind: "workspace_user", workspaceId: "11", userId: "9" },
      { kind: "workspace", id: "12" },
      { kind: "workspace_user", workspaceId: "12", userId: "9" }
    ]],
    ["10", []]
  ]));
});

test("workspace settings color defaults must be hex colors", () => {
  const config = runtimeConfig();
  config.workspaceSettings.defaults.lightPrimaryColor = "charcoal";
  const jsonRestApi = createJsonRestApiFixture();
  jsonRestApi.resources.workspaceSettings = {};

  assert.throws(
    () => createWorkspacesRuntime({ config, env: {}, jsonRestApi }),
    /runtime\.config\.workspaceSettings\.defaults\.lightPrimaryColor must be a hex color/
  );
});
