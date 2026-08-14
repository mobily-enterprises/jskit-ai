import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const FORBIDDEN_FEATURE_DEPENDENCIES = Object.freeze([
  "@jskit-ai/auth-core",
  "@jskit-ai/auth-web",
  "@jskit-ai/database-runtime",
  "@jskit-ai/storage-runtime",
  "@jskit-ai/uploads-runtime",
  "@jskit-ai/users-core",
  "@jskit-ai/users-web",
  "@jskit-ai/workspaces-core",
  "@jskit-ai/workspaces-web"
]);

test("http-web remains independent of feature products and persistence", () => {
  const declared = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
    ...packageJson.peerDependencies
  };

  for (const packageId of FORBIDDEN_FEATURE_DEPENDENCIES) {
    assert.equal(
      Object.hasOwn(declared, packageId),
      false,
      `Neutral http-web must not depend on ${packageId}.`
    );
  }
});
