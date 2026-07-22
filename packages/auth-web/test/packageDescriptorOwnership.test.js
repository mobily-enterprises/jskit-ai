import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("auth-web leaves its editable view and route scaffolds app-owned", () => {
  const expectedIds = [
    "auth-view-login",
    "auth-view-signout",
    "auth-view-reset-password",
    "auth-page-login",
    "auth-page-signout",
    "auth-page-reset-password"
  ];

  for (const id of expectedIds) {
    const mutation = descriptor.mutations.files.find((entry) => entry.id === id);
    assert.ok(mutation, `Missing auth-web scaffold mutation ${id}.`);
    assert.equal(mutation.ownership, "app", `${id} must remain app-owned across package updates.`);
  }
});
