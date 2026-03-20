import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceRoleCatalog,
  resolveRolePermissions,
  hasPermission
} from "../src/shared/roles.js";

test("createWorkspaceRoleCatalog resolves role descriptors only from appConfig.workspaceRoles", () => {
  const emptyCatalog = createWorkspaceRoleCatalog();
  assert.deepEqual(emptyCatalog.roles, []);
  assert.deepEqual(emptyCatalog.assignableRoleIds, []);
  assert.equal(emptyCatalog.defaultInviteRole, "");
  assert.equal(emptyCatalog.collaborationEnabled, false);

  const appConfig = {
    workspaceRoles: {
      defaultInviteRole: "editor",
      roles: {
        owner: {
          assignable: false,
          permissions: ["workspace.settings.update"]
        },
        editor: {
          assignable: true,
          permissions: ["crud_contacts.*"]
        }
      }
    }
  };
  const roleCatalog = createWorkspaceRoleCatalog(appConfig);
  const editorRole = roleCatalog.roles.find((role) => role.id === "editor");

  assert.equal(roleCatalog.defaultInviteRole, "editor");
  assert.equal(roleCatalog.assignableRoleIds.includes("editor"), true);
  assert.deepEqual(resolveRolePermissions("owner", appConfig), ["workspace.settings.update"]);
  assert.equal(hasPermission(editorRole?.permissions, "crud_contacts.update"), true);
});
