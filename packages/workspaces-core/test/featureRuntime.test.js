import assert from "node:assert/strict";
import test from "node:test";
import { createAuthExtensions } from "@jskit-ai/auth-core/server/authExtensions";
import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBootstrapRuntime } from "@jskit-ai/kernel/server/runtime";
import { createUsersExtensions } from "@jskit-ai/users-core/server/usersExtensions";
import { WorkspacesFeature } from "../src/server/WorkspacesFeature.js";
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
  const bootstrap = createBootstrapRuntime();
  const authExtensions = createAuthExtensions();
  const usersExtensions = createUsersExtensions();
  const jsonRestApi = createJsonRestApiFixture();
  let workspaces = null;
  let actionCatalogue = null;
  const probe = defineProvider({
    id: "test.workspaces.probe",
    requires: {
      actions: "runtime.actions",
      workspaceCapability: "workspaces.core"
    },
    setup({ actions, workspaceCapability }) {
      actionCatalogue = actions;
      workspaces = workspaceCapability;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    inputs: {
      "auth.extensions": authExtensions,
      "runtime.bootstrap": bootstrap,
      "runtime.config": runtimeConfig(),
      "runtime.database": { knex() {} },
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
      "users.core": {
        repositories: {
          userProfiles: { async findById() { return null; } }
        }
      },
      "users.extensions": usersExtensions
    },
    providers: [createActionProvider(), WorkspacesFeature, WorkspacesIntegrationsProvider, probe]
  });

  await runtime.start();

  assert.deepEqual(Object.keys(jsonRestApi.resources).sort(), [
    "workspaceInvites",
    "workspaceMemberships",
    "workspaceSettings",
    "workspaces"
  ]);
  assert.equal(typeof workspaces.services.directory.resolveWorkspaceContextForUserBySlug, "function");
  assert.equal(routes.includes("POST /api/workspaces"), true);
  assert.equal(routes.includes("GET /api/workspace/invitations/resolve"), true);
  assert.equal(actionCatalogue.listDefinitions().length, 16);
  assert.deepEqual(bootstrap.diagnostics().contributorIds, ["workspaces.bootstrap"]);
  assert.deepEqual(visibilityResolvers.map((entry) => entry.id), ["workspaces.visibility"]);
  assert.deepEqual(usersExtensions.diagnostics().profileSyncLifecycleContributorIds, ["workspaces.provisioning"]);
  assert.deepEqual(authExtensions.diagnostics().invitationContextResolverIds, ["workspaces.invitation"]);
  assert.deepEqual(authExtensions.diagnostics().policyContextResolverIds, ["workspaces.policy"]);
});
