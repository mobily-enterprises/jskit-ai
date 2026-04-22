import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluatePackageExportsContract } from "../../../tooling/test-support/exportsContract.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "workspaces-web");

test("workspaces-web exports are explicit and aligned with production usage", () => {
  const result = evaluatePackageExportsContract({
    repoRoot: REPO_ROOT,
    packageDir: PACKAGE_DIR,
    packageId: "@jskit-ai/workspaces-web",
    requiredExports: [
      "./client",
      "./client/components/AccountSettingsInvitesSection",
      "./client/providers/WorkspacesWebClientProvider",
      "./client/composables/useWorkspaceRouteContext"
    ]
  });

  assert.deepEqual(
    result.wildcardExports,
    [],
    `workspaces-web exports must be explicit. Remove wildcard keys: ${result.wildcardExports.join(", ")}`
  );
  assert.deepEqual(
    result.missingRequiredExports,
    [],
    `workspaces-web required exports missing: ${result.missingRequiredExports.join(", ")}`
  );
  assert.deepEqual(
    result.missingExports,
    [],
    `workspaces-web imports missing from package exports:\n${result.missingExports.join("\n")}`
  );
  assert.deepEqual(
    result.staleExports,
    [],
    `Stale workspaces-web exports found. Remove stale keys: ${result.staleExports.join(", ")}`
  );
});
