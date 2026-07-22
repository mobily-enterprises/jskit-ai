import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("users-web leaves account surface scaffolds app-owned", () => {
  const expectedIds = [
    "users-web-page-account-root",
    "users-web-component-account-settings-profile",
    "users-web-component-account-settings-preferences",
    "users-web-component-account-settings-notifications"
  ];

  for (const id of expectedIds) {
    const mutation = descriptor.mutations.files.find((entry) => entry.id === id);
    assert.ok(mutation, `Missing users-web scaffold mutation ${id}.`);
    assert.equal(mutation.ownership, "app", `${id} must remain app-owned across package updates.`);
  }
});
