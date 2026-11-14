import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { AuthExtensionsProvider } from "@jskit-ai/auth-core/server/providers/AuthExtensionsProvider";
import { AuthPolicyProvider } from "@jskit-ai/auth-core/server/providers/AuthPolicyProvider";
import { HttpProvider } from "@jskit-ai/kernel/server/http";
import { createBootstrapRuntime } from "@jskit-ai/kernel/server/runtime";
import { createPackageTestKnex, startTestFeatures } from "@jskit-ai/resource-runtime/test";
import { UsersExtensionsProvider } from "@jskit-ai/users-core/server/UsersExtensionsProvider";
import { UsersIdentityProvider } from "@jskit-ai/users-core/server/UsersIdentityProvider";
import { WorkspacesFeature } from "../src/server/WorkspacesFeature.js";
import { WorkspacesIntegrationsProvider } from "../src/server/WorkspacesIntegrationsProvider.js";

// The members and invites lists as the members screen reads them: GET .../members and GET .../invites through
// Fastify, the auth policy, the routes' query validation, the list actions and the JSON:API serializer. The service
// tests call the service directly, so a route that handed its action a bad input went unseen: every first page,
// which names no cursor, answered 400 "Value could not be cast" pointing at /data/attributes/cursor.

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
      member: { assignable: true, permissions: ["workspace.members.view"] },
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

async function membersApp(t) {
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
      WorkspacesIntegrationsProvider
    ],
    requires: { profiles: "users.profiles", workspaces: "workspaces.core", memberships: "workspaces.memberships" },
    inputs: {
      "auth.service": headerAuthService,
      "runtime.app-root": process.cwd(),
      "runtime.bootstrap": createBootstrapRuntime(),
      "runtime.config": config,
      "runtime.env": { APP_ENV: "test" },
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
  await workspaces.services.directory.ensurePersonalWorkspaceForUser(outsider);
  await memberships.addMember({ workspaceId: workspace.id, userId: member.id });
  await memberships.addMember({ workspaceId: workspace.id, userId: guest.id, roleSid: "guest" });
  for (const email of ["ivy@example.com", "jon@example.com", "kim@example.com"]) {
    await workspaces.services.members.createInvite(workspace, owner, { email, roleSid: "member" });
  }

  const get = (user, path, { query = {}, slug = workspace.slug } = {}) => app.inject({
    method: "GET",
    url: `/api/w/${slug}/${path}`,
    query,
    headers: user ? { "x-test-user": user.id } : {}
  });
  return { get, owner, member, guest, outsider, workspace };
}

// A page's query as the JSON:API transport sends it: http-web's useList names its limit (20 unless the screen says
// otherwise) and, from the second page on, the previous page's nextCursor.
const page = (limit, cursor) => ({
  query: {
    ...(limit === undefined ? {} : { "page[limit]": String(limit) }),
    ...(cursor === undefined ? {} : { "page[cursor]": cursor })
  }
});

// A list response's attributes, after checking it answered 200 as a workspace record of its JSON:API type.
function listAttributes(response, type, workspace) {
  assert.equal(response.statusCode, 200, response.body);
  const { data } = response.json();
  assert.equal(data.type, type, response.body);
  assert.equal(data.id, String(workspace.id), response.body);
  return data.attributes;
}

const displayNames = (attributes) => attributes.members.map(({ displayName }) => displayName);
const inviteEmails = (attributes) => attributes.invites.map(({ email }) => email).sort();

test("the members list answers its first page and each next page through its route", async (t) => {
  const { get, owner, member, workspace } = await membersApp(t);

  // The members screen's first page, and a caller that names no page at all.
  for (const user of [owner, member]) {
    for (const request of [page(20), page()]) {
      const all = listAttributes(await get(user, "members", request), "workspace-members", workspace);
      assert.deepEqual(displayNames(all), ["guest", "member", "owner"]);
      assert.equal(all.nextCursor, null);
      assert.equal(all.workspace.slug, workspace.slug);
      assert.ok(all.roleCatalog.roles.length > 0);
    }
  }

  const first = listAttributes(await get(owner, "members", page(2)), "workspace-members", workspace);
  assert.deepEqual(displayNames(first), ["guest", "member"]);
  assert.equal(typeof first.nextCursor, "string");
  const last = listAttributes(await get(owner, "members", page(2, first.nextCursor)), "workspace-members", workspace);
  assert.deepEqual(displayNames(last), ["owner"]);
  assert.equal(last.nextCursor, null);
});

test("the invites list answers its first page and each next page through its route", async (t) => {
  const { get, owner, member, workspace } = await membersApp(t);

  // The members screen's first page, and a caller that names no page at all.
  for (const user of [owner, member]) {
    for (const request of [page(20), page()]) {
      const all = listAttributes(await get(user, "invites", request), "workspace-invites", workspace);
      assert.deepEqual(inviteEmails(all), ["ivy@example.com", "jon@example.com", "kim@example.com"]);
      assert.equal(all.nextCursor, null);
      assert.equal(all.workspace.slug, workspace.slug);
    }
  }

  const first = listAttributes(await get(owner, "invites", page(2)), "workspace-invites", workspace);
  assert.equal(first.invites.length, 2);
  assert.equal(typeof first.nextCursor, "string");
  const last = listAttributes(await get(owner, "invites", page(2, first.nextCursor)), "workspace-invites", workspace);
  assert.equal(last.invites.length, 1);
  assert.equal(last.nextCursor, null);
  assert.deepEqual([...first.invites, ...last.invites].map(({ email }) => email).sort(),
    ["ivy@example.com", "jon@example.com", "kim@example.com"]);
});

test("the members and invites list routes refuse as strictly as before", async (t) => {
  const { get, owner, guest, outsider } = await membersApp(t);

  for (const path of ["members", "invites"]) {
    const refusals = [
      ["signed out", await get(null, path, page(20)), 401, "auth.session.required"],
      ["not a member", await get(outsider, path, page(20)), 403, "workspaces.workspace.accessDenied"],
      ["a member without workspace.members.view", await get(guest, path, page(20)), 403, "ACTION_PERMISSION_DENIED"],
      ["an unknown workspace", await get(owner, path, { ...page(20), slug: "no-such-workspace" }), 404,
        "workspaces.workspace.notFound"],
      ["a limit over 100", await get(owner, path, page(101)), 400, "limit"]
    ];
    for (const [label, response, statusCode, text] of refusals) {
      assert.equal(response.statusCode, statusCode, `${path}, ${label}: ${response.body}`);
      assert.equal(response.body.includes(text), true, `${path}, ${label}: ${response.body}`);
    }
  }
  // A cursor the members list never answered, with no limit named.
  const unknownCursor = await get(owner, "members", page(undefined, "not-a-cursor"));
  assert.equal(unknownCursor.statusCode, 400, unknownCursor.body);
  assert.equal(unknownCursor.body.includes("workspaces.member.cursorInvalid"), true, unknownCursor.body);
});
