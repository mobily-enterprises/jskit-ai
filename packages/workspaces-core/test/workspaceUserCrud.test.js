import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { normalizeAuthActor } from "@jskit-ai/auth-core/server/authActor";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { CrudContractsProvider } from "@jskit-ai/crud-core/server/crudContracts";
import { defineCrudFeature } from "@jskit-ai/crud-core/server/defineCrudFeature";
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

// Tables whose rows each belong to one member of one workspace (ownership workspace_user), served over HTTP as an
// application serves them: Fastify, the auth policy, the workspace visibility resolver and context contributors, and a
// CRUD feature on a workspace surface. The member a request reaches is the signed-in user, never an id the request
// sends: on the leases routes, whose visibility is the table's (workspace_user), and on the submissions routes, which
// name visibility "workspace", as an application's workspace screens may.

const memberRows = (name, tableName) => defineTableResource({
  name,
  tableName,
  ownership: "workspace_user",
  schema: {
    workspaceId: { type: "id", storage: { column: "workspace_id" } },
    userId: { type: "id", storage: { column: "user_id" } },
    device: { type: "string", required: true }
  }
});
const leases = memberRows("leases", "leases");
const submissions = memberRows("submissions", "submissions");
// userId is offered to create only to show that a request cannot choose the member with it.
const contract = (resource) => defineCrudContract(resource, {
  namespace: resource.name,
  operations: ["list", "view", "create", "patch", "delete"],
  fields: {
    device: { output: "required", create: "required", patch: "optional" },
    userId: { output: "required", create: "optional" }
  }
});
const LeasesFeature = defineCrudFeature({ crud: contract(leases), surface: "app", scope: WORKSPACE_CRUD_SCOPE });
const SubmissionsFeature = defineCrudFeature({ crud: contract(submissions), surface: "app", scope: WORKSPACE_CRUD_SCOPE, visibility: "workspace" });

const operations = (namespace) => ["list", "view", "create", "update", "delete"].map((operation) => `crud.${namespace}.${operation}`);
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
      member: { assignable: true, permissions: [...operations("leases"), ...operations("submissions")] }
    }
  }
});

// The signed-in user is the profile a header names, as a session would name it.
function headerAuthService(signedIn) {
  return Object.freeze({
    async authenticateRequest(request) {
      const profile = signedIn.get(String(request.headers["x-test-user"] || ""));
      if (!profile) {
        return { authenticated: false, actor: null, transientFailure: false };
      }
      const actor = normalizeAuthActor({
        provider: "local",
        providerUserId: profile.authProviderUserSid,
        email: profile.email,
        displayName: profile.displayName,
        appUserId: profile.id,
        profileSource: "users"
      });
      return { authenticated: true, actor, transientFailure: false };
    }
  });
}

async function memberRowsApp(t) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  const app = Fastify();
  t.after(() => app.close());
  const signedIn = new Map();
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
      LeasesFeature,
      SubmissionsFeature
    ],
    requires: { profiles: "users.profiles", workspaces: "workspaces.core", memberships: "workspaces.memberships" },
    inputs: {
      "auth.service": headerAuthService(signedIn),
      "runtime.app-root": process.cwd(),
      "runtime.bootstrap": createBootstrapRuntime(),
      "runtime.config": config,
      "runtime.env": { APP_ENV: "test" },
      "runtime.fastify": app
    }
  });
  t.after(started.stop);
  const { profiles, workspaces, memberships } = started.capabilities;
  const person = async (name) => {
    const profile = await profiles.upsert({
      authProvider: "local",
      authProviderUserSid: `identity-${name}`,
      email: `${name}@example.com`,
      displayName: name
    });
    signedIn.set(profile.id, profile);
    return profile;
  };
  const owner = await person("owner");
  const member = await person("member");
  const workspace = await workspaces.services.directory.ensurePersonalWorkspaceForUser(owner);
  await memberships.addMember({ workspaceId: workspace.id, userId: member.id });
  // A write carries a CSRF token and its secret cookie, as a signed-in page's does, so each refusal below is the scope's.
  app.get("/api/csrf", { config: { authPolicy: "public" } }, (_request, reply) => ({ token: reply.generateCsrf() }));
  const csrf = await app.inject({ method: "GET", url: "/api/csrf" });
  const csrfCookies = Object.fromEntries(csrf.cookies.map(({ name, value }) => [name, value]));
  const csrfToken = csrf.json().token;

  // A request of `user` (null: signed out) to the workspace's `path` ("leases" or "leases/<id>"), with `attributes` as
  // its JSON:API body.
  async function call(user, method, path, attributes) {
    const [type, id] = path.split("/");
    const write = method !== "GET";
    const response = await app.inject({
      method,
      url: `/api/w/${workspace.slug}/${path}`,
      ...(write ? { cookies: csrfCookies } : {}),
      headers: {
        ...(user ? { "x-test-user": user.id } : {}),
        ...(write ? { "x-csrf-token": csrfToken } : {}),
        ...(attributes ? { "content-type": "application/vnd.api+json" } : {})
      },
      ...(attributes ? { payload: JSON.stringify({ data: { type, ...(id ? { id } : {}), attributes } }) } : {})
    });
    return { statusCode: response.statusCode, body: response.body, json: () => response.json() };
  }
  return { knex, call, owner, member, workspace };
}

test("a workspace_user table's CRUD routes reach the signed-in member's own rows, on workspace_user and workspace routes", async (t) => {
  const { knex, call, owner, member, workspace } = await memberRowsApp(t);
  const devices = (response) => response.json().data.map((record) => record.attributes.device).sort();

  for (const table of ["leases", "submissions"]) {
    const [ownersRow] = await knex(table).insert({ workspace_id: workspace.id, user_id: owner.id, device: "owner's phone" }).returning("id");
    await knex(table).insert({ workspace_id: workspace.id, user_id: member.id, device: "member's phone" });
    const theirs = String(ownersRow?.id ?? ownersRow);
    const stored = async () => (await knex(table).orderBy("id")).map((row) => [String(row.user_id), row.device]);
    const before = await stored();

    // Each member lists only their own rows.
    const listed = await call(member, "GET", table);
    assert.equal(listed.statusCode, 200, `${table}: ${listed.body}`);
    assert.deepEqual(devices(listed), ["member's phone"], table);
    assert.deepEqual(devices(await call(owner, "GET", table)), ["owner's phone"], table);

    // Another member's row is not found to read or change; a delete of it answers as for a row already gone (CRUD's
    // delete is idempotent) and deletes nothing.
    for (const [method, status, attributes] of [["GET", 404], ["PATCH", 404, { device: "taken" }], ["DELETE", 204]]) {
      const response = await call(member, method, `${table}/${theirs}`, attributes);
      assert.equal(response.statusCode, status, `${table} ${method} of another member's row: ${response.body}`);
    }
    assert.deepEqual(await stored(), before, `${table}: another member's row is unchanged`);

    // A create is the signed-in member's; a request naming another member is refused and writes nothing.
    const created = await call(member, "POST", table, { device: "member's tablet" });
    assert.equal(created.statusCode, 201, `${table}: ${created.body}`);
    assert.equal(String(created.json().data.attributes.userId), String(member.id), table);
    const forged = await call(member, "POST", table, { device: "forged", userId: owner.id });
    assert.ok(forged.statusCode >= 400 && forged.statusCode < 500, `${table} create for another member: ${forged.statusCode} ${forged.body}`);
    assert.deepEqual(await stored(), [...before, [String(member.id), "member's tablet"]], `${table}: only the member's own create is stored`);

    // A member changes and deletes their own row.
    const mine = created.json().data.id;
    assert.equal((await call(member, "PATCH", `${table}/${mine}`, { device: "member's laptop" })).statusCode, 200, table);
    assert.equal((await call(member, "DELETE", `${table}/${mine}`)).statusCode, 204, table);
    assert.deepEqual(await stored(), before, table);

    // A signed-out request reaches no row.
    for (const [method, path, attributes] of [["GET", table], ["GET", `${table}/${theirs}`], ["POST", table, { device: "anonymous" }]]) {
      const response = await call(null, method, path, attributes);
      assert.equal(response.statusCode, 401, `${table} ${method} ${path} signed out: ${response.body}`);
    }
    assert.deepEqual(await stored(), before, `${table}: a signed-out request writes nothing`);
  }
});
