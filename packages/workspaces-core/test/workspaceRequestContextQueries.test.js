import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { CrudContractsProvider } from "@jskit-ai/crud-core/server/crudContracts";
import { defineCrudFeature } from "@jskit-ai/crud-core/server/defineCrudFeature";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { createBootstrapRuntime } from "@jskit-ai/kernel/server/runtime";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { defineCrudContract } from "@jskit-ai/resource-crud-core/shared/crudContract";
import { createPackageTestKnex, startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { WorkspacesFeature } from "../src/server/WorkspacesFeature.js";
import { WorkspacesIntegrationsProvider } from "../src/server/WorkspacesIntegrationsProvider.js";
import { WORKSPACE_CRUD_SCOPE } from "../src/server/support/workspaceCrud.js";

// A workspace CRUD list served as an application serves it: Fastify, the auth policy plugin, the HTTP runtime's
// visibility resolvers, the action context contributors and a CRUD feature on a workspace surface, over the users and
// workspaces owners. Its route names no permission, so the auth policy resolves no workspace context; the action's
// context contributors do (the route visibility resolver for the scope, the workspace contributor for the permissions).

const issues = defineTableResource({
  name: "issues",
  tableName: "issues",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", storage: { column: "workspace_id" } },
    title: { type: "string", required: true }
  }
});

const IssuesFeature = defineCrudFeature({
  crud: defineCrudContract(issues, {
    namespace: "issues",
    operations: ["list", "view"],
    fields: { title: { output: "required" } }
  }),
  operations: ["list"],
  surface: "app",
  scope: WORKSPACE_CRUD_SCOPE
});

const config = Object.freeze({
  appPublicUrl: "http://localhost:5173",
  tenancyMode: "workspaces",
  tenancyPolicy: { workspace: { allowSelfCreate: true } },
  workspaceInvitations: { enabled: true },
  workspaceMembers: { defaults: { inviteExpiresInMs: 86400000 } },
  workspaceSettings: { defaults: { invitesEnabled: true } },
  surfaceDefaultId: "app",
  surfaceDefinitions: { app: { id: "app", requiresWorkspace: true, accessPolicyId: "workspace_member" } },
  surfaceAccessPolicies: { workspace_member: { requireWorkspaceMembership: true } },
  roleCatalog: {
    workspace: { defaultInviteRole: "member" },
    roles: {
      owner: { permissions: ["*"] },
      member: { assignable: true, permissions: ["crud.issues.list"] },
      guest: { assignable: true, permissions: [] }
    }
  }
});

// The signed-in user is the profile the test names in a header, as a session would name it.
const headerAuthService = Object.freeze({
  async authenticateRequest(request) {
    const id = String(request.headers["x-test-user"] || "");
    return id
      ? { authenticated: true, actor: { id, email: `${id}@example.com`, displayName: id }, transientFailure: false }
      : { authenticated: false, actor: null, transientFailure: false };
  }
});

async function issuesApp(t) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  const app = Fastify();
  t.after(() => app.close());
  const started = await startTestFeatures({
    knex,
    createTables: true,
    features: [
      HttpProvider,
      AuthExtensionsProvider,
      AuthPolicyProvider,
      UsersExtensionsProvider,
      UsersIdentityProvider,
      WorkspacesFeature,
      WorkspacesIntegrationsProvider,
      CrudContractsProvider,
      IssuesFeature
    ],
    requires: { profiles: "users.profiles", workspaces: "workspaces.core", memberships: "workspaces.memberships" },
    inputs: {
      "auth.service": headerAuthService,
      "runtime.app-root": process.cwd(),
      "runtime.bootstrap": createBootstrapRuntime(),
      "runtime.config": config,
      "runtime.env": {},
      "runtime.fastify": app
    }
  });
  t.after(started.stop);
  const { profiles, workspaces, memberships } = started.capabilities;
  const person = (name) => profiles.upsert({
    authProvider: "local",
    authProviderUserSid: `identity-${name}`,
    email: `${name}@example.com`,
    displayName: name
  });
  const owner = await person("owner");
  const member = await person("member");
  const guest = await person("guest");
  const outsider = await person("outsider");
  const workspace = await workspaces.services.directory.ensurePersonalWorkspaceForUser(owner);
  const other = await workspaces.services.directory.ensurePersonalWorkspaceForUser(outsider);
  await memberships.addMember({ workspaceId: workspace.id, userId: member.id });
  await memberships.addMember({ workspaceId: workspace.id, userId: guest.id, roleSid: "guest" });
  await knex("issues").insert([
    { workspace_id: workspace.id, title: "Door sticks" },
    { workspace_id: workspace.id, title: "Lamp flickers" },
    { workspace_id: other.id, title: "Another workspace's issue" }
  ]);

  async function list(user, slug = workspace.slug) {
    const { result: response, queries } = await countQueries(knex, () => app.inject({
      method: "GET",
      url: `/api/w/${slug}/issues`,
      headers: user ? { "x-test-user": user.id } : {}
    }));
    return { response, queries };
  }
  return { list, owner, member, guest, outsider, workspace };
}

// The statements of one read of the workspace context, whatever the database quotes its names with: the workspace by
// its slug, the actor's membership and the workspace's settings. (Reading a row also checks that the rows it refers to
// exist, a `select distinct id` of each, which these leave out.)
const quoted = (name) => `["\`]${name}["\`]`;
const CONTEXT_READS = Object.freeze({
  workspace: new RegExp(`from ${quoted("workspaces")} where .*${quoted("slug")} =`, "u"),
  membership: new RegExp(`from ${quoted("workspace_memberships")} where`, "u"),
  settings: new RegExp(`from ${quoted("workspace_settings")} where`, "u"),
  issues: new RegExp(`from ${quoted("issues")}`, "u")
});
const reading = (queries, read) => queries.filter((sql) => CONTEXT_READS[read].test(sql));

test("a workspace CRUD list request resolves its workspace, membership and settings once", async (t) => {
  const { list, owner, member } = await issuesApp(t);

  for (const user of [owner, member]) {
    const { response, queries } = await list(user);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json().data.map((record) => record.attributes.title).sort(), ["Door sticks", "Lamp flickers"]);
    const statements = queries.join("\n");
    t.diagnostic(`a list request for the ${user === owner ? "owner" : "member"} sends ${queries.length} statements`);
    // Before, the route visibility resolver read them for the scope and the workspace contributor again for the
    // permissions: two of each.
    assert.equal(reading(queries, "workspace").length, 1, statements);
    assert.equal(reading(queries, "membership").length, 1, statements);
    assert.equal(reading(queries, "settings").length, 1, statements);
    assert.equal(reading(queries, "issues").length, 1, statements);
  }
});

test("a workspace CRUD list request refuses as strictly as before", async (t) => {
  const { list, guest, outsider, owner } = await issuesApp(t);

  const refusals = [
    ["signed out", await list(null), 401, "auth.session.required"],
    ["not a member", await list(outsider), 403, "workspaces.workspace.accessDenied"],
    ["a member without crud.issues.list", await list(guest), 403, "ACTION_PERMISSION_DENIED"],
    ["an unknown workspace", await list(owner, "no-such-workspace"), 404, "workspaces.workspace.notFound"]
  ];
  for (const [label, { response, queries }, statusCode, code] of refusals) {
    assert.equal(response.statusCode, statusCode, `${label}: ${response.body}`);
    assert.equal(response.body.includes(code), true, `${label}: ${response.body}`);
    assert.equal(reading(queries, "issues").length, 0, `${label} reads no issue: ${queries.join("\n")}`);
    assert.ok(reading(queries, "workspace").length <= 1, `${label} reads the workspace at most once: ${queries.join("\n")}`);
  }
});
