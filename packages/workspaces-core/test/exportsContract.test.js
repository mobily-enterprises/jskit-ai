import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluatePackageExportsContract } from "../../../tooling/test-support/exportsContract.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "workspaces-core");

test("workspaces-core exports are explicit and aligned with production usage", () => {
  const result = evaluatePackageExportsContract({
    repoRoot: REPO_ROOT,
    packageDir: PACKAGE_DIR,
    packageId: "@jskit-ai/workspaces-core",
    requiredExports: [
      "./server/WorkspacesCoreServiceProvider"
    ]
  });

  assert.deepEqual(
    result.wildcardExports,
    [],
    `workspaces-core exports must be explicit. Remove wildcard keys: ${result.wildcardExports.join(", ")}`
  );
  assert.deepEqual(
    result.missingRequiredExports,
    [],
    `workspaces-core required exports missing: ${result.missingRequiredExports.join(", ")}`
  );
  assert.deepEqual(
    result.missingExports,
    [],
    `workspaces-core imports missing from package exports:\n${result.missingExports.join("\n")}`
  );
  assert.deepEqual(
    result.staleExports,
    [],
    `Stale workspaces-core exports found. Remove stale keys: ${result.staleExports.join(", ")}`
  );
});
