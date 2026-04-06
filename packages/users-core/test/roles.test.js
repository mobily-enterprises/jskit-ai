import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceRoleCatalog,
  cloneWorkspaceRoleCatalog,
  resolveRolePermissions,
  hasPermission
} from "../src/shared/roles.js";

test("createWorkspaceRoleCatalog resolves role descriptors only from appConfig.roleCatalog", () => {
  const emptyCatalog = createWorkspaceRoleCatalog();
  assert.deepEqual(emptyCatalog.roles, []);
  assert.deepEqual(emptyCatalog.assignableRoleIds, []);
  assert.equal(emptyCatalog.defaultInviteRole, "");
  assert.equal(emptyCatalog.collaborationEnabled, false);

  const appConfig = {
    roleCatalog: {
      workspace: {
        defaultInviteRole: "editor"
      },
      roles: {
        owner: {
          assignable: false,
          permissions: ["workspace.settings.update"]
        },
        editor: {
          assignable: true,
          permissions: ["crud.contacts.*"]
        }
      }
    }
  };
  const roleCatalog = createWorkspaceRoleCatalog(appConfig);
  const editorRole = roleCatalog.roles.find((role) => role.id === "editor");

  assert.equal(roleCatalog.defaultInviteRole, "editor");
  assert.equal(roleCatalog.assignableRoleIds.includes("editor"), true);
  assert.deepEqual(resolveRolePermissions("owner", appConfig), ["workspace.settings.update"]);
  assert.equal(hasPermission(editorRole?.permissions, "crud.contacts.update"), true);
});

test("createWorkspaceRoleCatalog resolves inherited role permissions with parent permissions first", () => {
  const appConfig = {
    roleCatalog: {
      workspace: {
        defaultInviteRole: "member"
      },
      roles: {
        member: {
          assignable: true,
          permissions: [
            "workspace.settings.view",
            "crud.contacts.list"
          ]
        },
        admin: {
          assignable: true,
          inherits: "member",
          permissions: [
            "workspace.settings.update",
            "workspace.members.manage",
            "workspace.settings.view"
          ]
        }
      }
    }
  };

  const roleCatalog = createWorkspaceRoleCatalog(appConfig);
  const adminRole = roleCatalog.roles.find((role) => role.id === "admin");

  assert.deepEqual(adminRole, {
    id: "admin",
    assignable: true,
    permissions: [
      "workspace.settings.view",
      "crud.contacts.list",
      "workspace.settings.update",
      "workspace.members.manage"
    ]
  });
});

test("createWorkspaceRoleCatalog rejects unknown inherited roles", () => {
  assert.throws(
    () =>
      createWorkspaceRoleCatalog({
        roleCatalog: {
          roles: {
            admin: {
              assignable: true,
              inherits: "member",
              permissions: []
            }
          }
        }
      }),
    /inherits unknown role "member"/
  );
});

test("createWorkspaceRoleCatalog rejects circular inherited roles", () => {
  assert.throws(
    () =>
      createWorkspaceRoleCatalog({
        roleCatalog: {
          roles: {
            member: {
              assignable: true,
              inherits: "admin",
              permissions: []
            },
            admin: {
              assignable: true,
              inherits: "member",
              permissions: []
            }
          }
        }
      }),
    /circular inheritance/
  );
});

test("cloneWorkspaceRoleCatalog normalizes role ids and returns detached arrays", () => {
  const source = {
    collaborationEnabled: true,
    defaultInviteRole: "member",
    roles: [
      {
        id: " MEMBER ",
        assignable: true,
        permissions: ["workspace.members.view"]
      }
    ],
    assignableRoleIds: ["member"]
  };

  const cloned = cloneWorkspaceRoleCatalog(source);
  assert.deepEqual(cloned, {
    collaborationEnabled: true,
    defaultInviteRole: "member",
    roles: [
      {
        id: "member",
        assignable: true,
        permissions: ["workspace.members.view"]
      }
    ],
    assignableRoleIds: ["member"]
  });

  cloned.roles[0].permissions.push("workspace.members.manage");
  cloned.assignableRoleIds.push("admin");

  assert.deepEqual(source.roles[0].permissions, ["workspace.members.view"]);
  assert.deepEqual(source.assignableRoleIds, ["member"]);
});
