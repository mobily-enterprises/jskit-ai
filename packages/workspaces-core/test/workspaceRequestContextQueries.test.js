import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { normalizeAuthActor } from "@jskit-ai/auth-core/server/authActor";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { CrudContractsProvider } from "@jskit-ai/crud-core/server/crudContracts";
import { defineCrudFeature } from "@jskit-ai/crud-core/server/defineCrudFeature";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { jsonApiResultValue } from "@jskit-ai/http-runtime/shared/validators/jsonApiResult";
import { resolveActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { defineFeature } from "@jskit-ai/kernel/server/features";
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
import { workspaceSlugParamsValidator } from "../src/server/common/validators/routeParamsValidator.js";

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

// A hand-written route with contextPolicy "optional" and no permission: the auth policy resolves the workspace context
// without requiring membership, and the action's context contributor resolves it again requiring it.
const ACTION_READ_NOTICE = "test.workspace-notice.read";
const NoticeFeature = defineFeature({
  id: "test.workspace-notice",
  requires: { http: "runtime.http" },
  setup({ http }) {
    http.router.register(
      "GET",
      "/api/w/:workspaceSlug/notice",
      {
        auth: "required",
        surface: "app",
        visibility: "workspace",
        contextPolicy: "optional",
        meta: { summary: "Reads the workspace's notice." },
        params: workspaceSlugParamsValidator
      },
      async function readNotice(request, reply) {
        reply.code(200).send(await request.executeAction({ actionId: ACTION_READ_NOTICE, input: request.input.params }));
      }
    );
    return {};
  },
  actions: [
    Object.freeze({
      id: ACTION_READ_NOTICE,
      version: 1,
      kind: "query",
      channels: ["api"],
      surfaces: ["app"],
      input: workspaceSlugParamsValidator,
      output: null,
      execute: (_input, context) => ({ workspaceId: context.workspace.id, roleSid: context.membership.roleSid })
    })
  ]
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

// A workspace_user route whose action answers what a member's code reads from its context, to set a member context's
// beside the request's.
const ACTION_READ_CONTEXT = "test.workspace-context.read";
const ContextFeature = defineFeature({
  id: "test.workspace-context",
  requires: { http: "runtime.http" },
  setup({ http }) {
    http.router.register(
      "GET",
      "/api/w/:workspaceSlug/context",
      {
        auth: "required",
        surface: "app",
        visibility: "workspace_user",
        meta: { summary: "Reads the member's context." },
        params: workspaceSlugParamsValidator
      },
      async function readContext(request, reply) {
        reply.code(200).send(await request.executeAction({ actionId: ACTION_READ_CONTEXT, input: request.input.params }));
      }
    );
    return {};
  },
  actions: [
    Object.freeze({
      id: ACTION_READ_CONTEXT,
      version: 1,
      kind: "query",
      channels: ["api", "internal"],
      surfaces: ["app"],
      input: workspaceSlugParamsValidator,
      output: null,
      execute: (_input, context) => ({
        actorId: resolveActorId(context),
        actor: context.actor,
        workspace: context.workspace,
        membership: context.membership,
        permissions: context.permissions,
        visibilityContext: context.visibilityContext,
        requestVisibilityContext: context.requestMeta.visibilityContext,
        resolvedWorkspaceContext: context.requestMeta.resolvedWorkspaceContext
      })
    })
  ]
});

// The signed-in user is the profile the test names in a header, as a session would name it, with the actor the local
// sign-in provider builds from its account and the profile.
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

async function issuesApp(t) {
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
      IssuesFeature,
      NoticeFeature,
      ContextFeature
    ],
    requires: { profiles: "users.profiles", workspaces: "workspaces.core", memberships: "workspaces.memberships", actions: "runtime.actions" },
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
  const { profiles, workspaces, memberships, actions } = started.capabilities;
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

  async function get(user, slug, suffix) {
    const { result: response, queries } = await countQueries(knex, () => app.inject({
      method: "GET",
      url: `/api/w/${slug}/${suffix}`,
      headers: user ? { "x-test-user": user.id } : {}
    }));
    return { response, queries };
  }
  const list = (user, slug = workspace.slug) => get(user, slug, "issues");
  const notice = (user, slug = workspace.slug) => get(user, slug, "notice");
  const context = (user, slug = workspace.slug) => get(user, slug, "context");
  // A background job of a feature with a system scope, running one action as a member of the workspace.
  const systemContext = started.resources.declareSystemScope("test.member-jobs", "act for members of every workspace");
  async function runAsMember(user, actionId) {
    const member = await workspaces.memberContext(
      { workspaceId: workspace.id, userId: user.id },
      { context: systemContext("run a member's action") }
    );
    return countQueries(knex, () => actions.execute({ actionId, input: { workspaceSlug: workspace.slug }, context: { ...member, surface: "app" } }));
  }
  // The same job running one action as a user in a role of the catalog, for installer work.
  async function runInRole(user, role, actionId) {
    const acting = await workspaces.roleContext(
      { workspaceId: workspace.id, userId: user.id, role, reason: "install the workspace's required records" },
      { context: systemContext("install each workspace's required records") }
    );
    return countQueries(knex, () => actions.execute({ actionId, input: { workspaceSlug: workspace.slug }, context: { ...acting, surface: "app" } }));
  }
  return { list, notice, context, runAsMember, runInRole, owner, member, guest, outsider, workspace };
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

test("a route whose auth policy and action context differ in requiring membership reads the context once", async (t) => {
  const { notice, owner, member, outsider, workspace } = await issuesApp(t);

  for (const [user, roleSid] of [[owner, "owner"], [member, "member"]]) {
    const { response, queries } = await notice(user);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { workspaceId: workspace.id, roleSid });
    const statements = queries.join("\n");
    t.diagnostic(`a contextPolicy "optional" request for the ${roleSid} sends ${queries.length} statements`);
    // Before, the auth policy's read (membership optional) and the action context's (membership required) were two.
    assert.equal(reading(queries, "workspace").length, 1, statements);
    assert.equal(reading(queries, "membership").length, 1, statements);
    assert.equal(reading(queries, "settings").length, 1, statements);
  }

  // The shared read still refuses a non-member where membership is required.
  const { response, queries } = await notice(outsider);
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.body.includes("workspaces.workspace.accessDenied"), true, response.body);
  assert.equal(reading(queries, "workspace").length, 1, queries.join("\n"));
});

test("a member context runs an action in the context the member's own request runs it in", async (t) => {
  const { context, runAsMember, owner, member, guest } = await issuesApp(t);

  for (const [user, roleSid] of [[owner, "owner"], [member, "member"], [guest, "guest"]]) {
    const { response } = await context(user);
    assert.equal(response.statusCode, 200, response.body);
    const request = response.json();
    assert.equal(request.actorId, user.id);
    assert.equal(request.membership.roleSid, roleSid);
    assert.equal(request.visibilityContext.userId, user.id);
    const { result } = await runAsMember(user, ACTION_READ_CONTEXT);
    // The actor, the workspace, the membership, its permissions, the visibility and the whole resolution, as JSON.
    assert.deepEqual(JSON.parse(JSON.stringify(result)), request, `${roleSid}: the member context's action sees the request's context`);
  }
});

test("a member context lists the member's workspace's rows as the member's request does, and is refused where the request is", async (t) => {
  const { list, runAsMember, owner, member, guest } = await issuesApp(t);

  for (const user of [owner, member]) {
    const { response } = await list(user);
    assert.equal(response.statusCode, 200, response.body);
    // The list action answers a tagged JSON:API document, which the route's transport sends without its links.
    const document = jsonApiResultValue((await runAsMember(user, "crud.issues.list")).result);
    const records = (data) => data.map(({ type, id, attributes }) => ({ type, id, attributes }));
    assert.deepEqual(document.data.map((record) => record.attributes.title).sort(), ["Door sticks", "Lamp flickers"]);
    assert.deepEqual(records(JSON.parse(JSON.stringify(document.data))), records(response.json().data));
  }

  const { response } = await list(guest);
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.body.includes("ACTION_PERMISSION_DENIED"), true, response.body);
  await assert.rejects(runAsMember(guest, "crud.issues.list"), (error) => error.status === 403 && error.code === "ACTION_PERMISSION_DENIED");
});

test("a role context runs an action as a member in that role would, for a user who is no member or a member in another role, and writes nothing", async (t) => {
  const { context, list, runInRole, member, guest, outsider } = await issuesApp(t);

  // The action sees what a member in that role sees at their own request, with an unsaved membership.
  const request = (await context(member)).response.json();
  for (const user of [outsider, guest]) {
    const { result, queries } = await runInRole(user, "member", ACTION_READ_CONTEXT);
    const seen = JSON.parse(JSON.stringify(result));
    assert.deepEqual(seen.membership, { workspaceId: request.workspace.id, userId: user.id, roleSid: "member", status: "active" });
    assert.equal(seen.actorId, user.id);
    assert.deepEqual(seen.permissions, request.permissions, "the role's permissions");
    assert.deepEqual(seen.workspace, request.workspace);
    assert.deepEqual(seen.visibilityContext, { ...request.visibilityContext, userId: user.id });
    assert.ok(queries.every((sql) => /^select\b/iu.test(sql.trim())), `nothing is written: ${queries.join("\n")}`);
  }

  // The permission check passes as the role: the member role lists the workspace's issues, which the outsider's and
  // the guest's own requests may not, and the guest role is refused as a guest's request is.
  assert.equal((await list(outsider)).response.statusCode, 403);
  assert.equal((await list(guest)).response.statusCode, 403);
  const memberTitles = (await list(member)).response.json().data.map((record) => record.attributes.title).sort();
  for (const user of [outsider, guest]) {
    const { result, queries } = await runInRole(user, "member", "crud.issues.list");
    assert.deepEqual(jsonApiResultValue(result).data.map((record) => record.attributes.title).sort(), memberTitles);
    assert.ok(queries.every((sql) => /^select\b/iu.test(sql.trim())), `nothing is written: ${queries.join("\n")}`);
  }
  await assert.rejects(runInRole(member, "guest", "crud.issues.list"), (error) => error.status === 403 && error.code === "ACTION_PERMISSION_DENIED");
});
