import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRequiredPermissions,
  describeUnknownRoleGrants,
  findUnknownRoleGrants
} from "../src/server/support/roleCatalogGrants.js";

function crudActions(namespace, operations = ["list", "view", "create", "update", "delete"]) {
  return operations.map((operation) => ({
    id: `crud.${namespace}.${operation}`,
    permission: { require: "all", permissions: [`crud.${namespace}.${operation}`] }
  }));
}

const ACTIONS = Object.freeze([
  ...crudActions("labels"),
  ...crudActions("issues"),
  { id: "crud.issues.close", permission: { require: "all", permissions: ["crud.issues.close"] } },
  { id: "workspace.settings.read", permission: { require: "any", permissions: ["workspace.settings.view", "workspace.settings.update"] } },
  { id: "workspace.members.list", permission: { require: "all", permissions: ["workspace.members.view"] } },
  { id: "workspace.member.remove", permission: { require: "all", permissions: ["workspace.members.manage"] } },
  { id: "workspace.invite.create", permission: { require: "all", permissions: ["workspace.members.invite"] } },
  { id: "workspace.workspaces.list", permission: { require: "authenticated", permissions: [] } }
]);

function configWithRoles(roles, extra = {}) {
  return { roleCatalog: { workspace: { defaultInviteRole: "member" }, roles, ...extra } };
}

function required(config, { actions = ACTIONS, routes = [] } = {}) {
  return collectRequiredPermissions({ actions, routes, config });
}

function findings(roles, extra = {}, sources = {}) {
  const config = configWithRoles(roles, extra);
  return findUnknownRoleGrants(config, required(config, sources));
}

test("a grant no action requires is reported at its role, with the operation the grant meant", () => {
  const found = findings({
    owner: { permissions: ["*"] },
    member: { assignable: true, permissions: ["crud.labels.list", "crud.labels.patch", "crud.issues.patch"] }
  });

  assert.deepEqual(found.map(({ roleId, grant, suggestions }) => ({ roleId, grant, suggestions })), [
    { roleId: "member", grant: "crud.labels.patch", suggestions: ["crud.labels.update"] },
    { roleId: "member", grant: "crud.issues.patch", suggestions: ["crud.issues.update"] }
  ]);
  const message = describeUnknownRoleGrants(found);
  assert.match(message, /Role "member" grants "crud\.labels\.patch", which no action requires; did you mean "crud\.labels\.update"\?/u);
  assert.match(message, /Role "member" grants "crud\.issues\.patch", which no action requires; did you mean "crud\.issues\.update"\?/u);
  assert.match(message, /list, view, create, update or delete/u, "the message names the CRUD operations");
  assert.match(message, /roleCatalog\.customPermissions/u, "the message says where an app-checked permission goes");
});

test("every form of grant that covers a required permission is valid", () => {
  assert.deepEqual(findings({
    owner: { permissions: ["*"] },
    admin: { inherits: "member", permissions: ["crud.labels.*", "crud.*", "workspace.*", "crud.issues.close"] },
    member: { assignable: true, permissions: ["crud.issues.update", "workspace.settings.view", "workspace.members.view"] }
  }), []);
});

test("an owner granting everything is valid even when no action requires a permission", () => {
  const config = configWithRoles({ owner: { permissions: ["*"] } });
  assert.deepEqual(findUnknownRoleGrants(config, collectRequiredPermissions({ actions: [], routes: [], config })), []);
});

test("a route's permission, a surface access policy's permissions and the app's custom permissions are required too", () => {
  const roles = {
    member: {
      assignable: true,
      permissions: ["projects.view", "reports.export", "reports.audit", "bookings.view-all"]
    }
  };
  const extra = { customPermissions: ["bookings.view-all"] };
  const config = {
    ...configWithRoles(roles, extra),
    surfaceAccessPolicies: {
      reports: { requireAnyPermissions: ["reports.export"], requireAllPermissions: ["reports.audit"] }
    }
  };
  const routes = [{ method: "GET", path: "/api/w/:workspaceSlug/projects", permission: "projects.view" }, { method: "GET", path: "/api/health" }];

  assert.deepEqual(findUnknownRoleGrants(config, collectRequiredPermissions({ actions: ACTIONS, routes, config })), []);
});

test("a wildcard that covers no required permission is reported with the prefix it meant", () => {
  const found = findings({ member: { assignable: true, permissions: ["crud.lables.*", "billing.*"] } });

  assert.deepEqual(found.map(({ grant, suggestions }) => ({ grant, suggestions })), [
    { grant: "crud.lables.*", suggestions: ["crud.labels.*"] },
    { grant: "billing.*", suggestions: [] }
  ]);
  const message = describeUnknownRoleGrants(found);
  assert.match(message, /Role "member" grants "crud\.lables\.\*", which covers no permission an action requires; did you mean "crud\.labels\.\*"\?/u);
  assert.match(message, /Role "member" grants "billing\.\*", which covers no permission an action requires\./u);
});

test("a wildcard anywhere but alone or at the end matches nothing and is reported", () => {
  const found = findings({ member: { assignable: true, permissions: ["crud.*.view", "crud.labels*"] } });

  assert.deepEqual(found.map(({ grant }) => grant), ["crud.*.view", "crud.labels*"]);
  assert.match(describeUnknownRoleGrants(found), /Role "member" grants "crud\.\*\.view", which matches nothing: "\*" stands alone or ends a grant as "\.\*"\./u);
});

test("a misspelt grant is matched to the nearest required permission, else to its namespace's permissions", () => {
  const found = findings({
    member: { assignable: true, permissions: ["crud.lables.update", "workspace.members.edit", "workspace.settings.read", "reports.run"] }
  });

  assert.deepEqual(found.map(({ grant, suggestions }) => ({ grant, suggestions })), [
    { grant: "crud.lables.update", suggestions: ["crud.labels.update"] },
    { grant: "workspace.members.edit", suggestions: ["workspace.members.invite", "workspace.members.manage", "workspace.members.view"] },
    { grant: "workspace.settings.read", suggestions: ["workspace.settings.view"] },
    { grant: "reports.run", suggestions: [] }
  ]);
  const message = describeUnknownRoleGrants(found);
  assert.match(message, /grants "workspace\.members\.edit", which no action requires; did you mean one of "workspace\.members\.invite", "workspace\.members\.manage", "workspace\.members\.view"\?/u);
  assert.match(message, /grants "reports\.run", which no action requires\./u);
});

test("an inherited grant is reported once, at the role that writes it", () => {
  const found = findings({
    admin: { assignable: true, inherits: "member", permissions: ["crud.labels.delete"] },
    member: { assignable: true, permissions: ["crud.labels.edit"] }
  });

  assert.deepEqual(found.map(({ roleId, grant }) => ({ roleId, grant })), [{ roleId: "member", grant: "crud.labels.edit" }]);
});

test("customPermissions holds permission names only", () => {
  for (const customPermissions of ["bookings.view-all", [""], ["bookings.*"], ["*"], [42]]) {
    const config = configWithRoles({ member: { permissions: [] } }, { customPermissions });
    assert.throws(
      () => collectRequiredPermissions({ actions: ACTIONS, routes: [], config }),
      /roleCatalog\.customPermissions must be a list of permission names/u,
      JSON.stringify(customPermissions)
    );
  }
});

test("an application without a role catalogue has nothing to report", () => {
  assert.deepEqual(findUnknownRoleGrants({}, collectRequiredPermissions({ actions: ACTIONS, routes: [], config: {} })), []);
});
