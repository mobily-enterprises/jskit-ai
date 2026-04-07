import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluatePackageExportsContract } from "../../../tooling/test-support/exportsContract.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "users-web");

test("users-web exports are explicit and aligned with production/template usage", () => {
  const result = evaluatePackageExportsContract({
    repoRoot: REPO_ROOT,
    packageDir: PACKAGE_DIR,
    packageId: "@jskit-ai/users-web",
    requiredExports: [
      "./client",
      "./client/composables/useAddEdit",
      "./client/composables/useList",
      "./client/composables/useView",
      "./client/composables/useCrudAddEdit",
      "./client/composables/useCrudList",
      "./client/composables/useCrudView",
      "./client/support/menuLinkTarget"
    ]
  });

  assert.deepEqual(
    result.wildcardExports,
    [],
    `users-web exports must be explicit. Remove wildcard keys: ${result.wildcardExports.join(", ")}`
  );
  assert.deepEqual(
    result.missingRequiredExports,
    [],
    `users-web required exports missing: ${result.missingRequiredExports.join(", ")}`
  );
  assert.deepEqual(
    result.missingExports,
    [],
    `users-web imports missing from package exports:\n${result.missingExports.join("\n")}`
  );
  assert.deepEqual(
    result.staleExports,
    [],
    `Stale users-web exports found. Remove stale keys: ${result.staleExports.join(", ")}`
  );
});
