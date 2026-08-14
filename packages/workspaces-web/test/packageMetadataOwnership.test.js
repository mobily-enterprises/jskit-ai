import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("workspaces-web leaves editable workspace scaffolds app-owned", () => {
  const fileMutations = packageMetadata.mutations.files;

  assert.ok(fileMutations.length > 0);
  for (const mutation of fileMutations) {
    assert.equal(
      mutation.ownership,
      "app",
      `${mutation.id} must remain app-owned across package updates.`
    );
  }
});
