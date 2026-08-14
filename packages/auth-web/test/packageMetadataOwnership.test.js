import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

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
    const mutation = packageMetadata.mutations.files.find((entry) => entry.id === id);
    assert.ok(mutation, `Missing auth-web scaffold mutation ${id}.`);
    assert.equal(mutation.ownership, "app", `${id} must remain app-owned across package updates.`);
  }
});
