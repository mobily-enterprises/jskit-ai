import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("workspaces-web leaves editable workspace scaffolds app-owned", () => {
  const fileMutations = descriptor.mutations.files;

  assert.ok(fileMutations.length > 0);
  for (const mutation of fileMutations) {
    assert.equal(
      mutation.ownership,
      "app",
      `${mutation.id} must remain app-owned across package updates.`
    );
  }
});
