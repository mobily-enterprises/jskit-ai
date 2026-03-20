import test from "node:test";
import assert from "node:assert/strict";
import { arePermissionListsEqual, hasPermission, normalizePermissionList } from "../src/client/lib/permissions.js";

test("normalizePermissionList trims, removes duplicates, and ignores empty entries", () => {
  assert.deepEqual(
    normalizePermissionList([" workspace.settings.view ", "", null, "workspace.settings.view", "workspace.members.view"]),
    ["workspace.settings.view", "workspace.members.view"]
  );
});

test("arePermissionListsEqual compares permission sets regardless of order or duplicates", () => {
  assert.equal(
    arePermissionListsEqual(
      ["workspace.settings.view", "workspace.members.view", "workspace.settings.view"],
      ["workspace.members.view", "workspace.settings.view"]
    ),
    true
  );
});

test("arePermissionListsEqual returns false for different permission sets", () => {
  assert.equal(
    arePermissionListsEqual(
      ["workspace.settings.view"],
      ["workspace.members.view"]
    ),
    false
  );
});

test("hasPermission supports namespace wildcard matches", () => {
  assert.equal(hasPermission(["crud_contacts.*"], "crud_contacts.update"), true);
  assert.equal(hasPermission(["crud_contacts.*"], "crud_projects.update"), false);
});
