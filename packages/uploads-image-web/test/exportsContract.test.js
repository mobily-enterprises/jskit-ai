import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluatePackageExportsContract } from "../../../tooling/test-support/exportsContract.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "uploads-image-web");

test("uploads-image-web exports are explicit and aligned with usage", () => {
  const result = evaluatePackageExportsContract({
    repoRoot: REPO_ROOT,
    packageDir: PACKAGE_DIR,
    packageId: "@jskit-ai/uploads-image-web",
    requiredExports: [
      "./client",
      "./client/composables/createImageUploadRuntime",
      "./client/composables/createManagedImageAssetRuntime",
      "./shared"
    ]
  });

  assert.deepEqual(result.wildcardExports, []);
  assert.deepEqual(result.missingRequiredExports, []);
  assert.deepEqual(result.missingExports, []);
  assert.deepEqual(result.staleExports, []);
});
