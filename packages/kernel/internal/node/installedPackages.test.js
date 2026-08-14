import assert from "node:assert/strict";
import test from "node:test";
import {
  createPackageMetadata,
  JSKIT_PACKAGE_CONFIG_KEYS
} from "./installedPackages.js";

test("createPackageMetadata derives package identity from package.json", () => {
  const metadata = createPackageMetadata({
    name: "@example/runtime",
    version: "0.1.0",
    description: "Example runtime.",
    jskit: {
      kind: "runtime",
      runtime: {
        server: {
          providers: []
        }
      }
    }
  });

  assert.equal(metadata.packageId, "@example/runtime");
  assert.equal(metadata.version, "0.1.0");
  assert.equal(metadata.description, "Example runtime.");
});

test("createPackageMetadata accepts only the canonical package.json.jskit fields", () => {
  assert.deepEqual(JSKIT_PACKAGE_CONFIG_KEYS, [
    "capabilities",
    "ci",
    "kind",
    "lifecycle",
    "metadata",
    "mutations",
    "optionPolicies",
    "options",
    "runtime"
  ]);
  assert.throws(
    () => createPackageMetadata({
      name: "@example/runtime",
      version: "0.1.0",
      jskit: {
        kind: "runtime",
        packageId: "@example/other-runtime"
      }
    }),
    /unknown field: packageId/
  );
});
