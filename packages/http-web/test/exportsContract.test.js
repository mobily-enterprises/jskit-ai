import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluatePackageExportsContract } from "../../../tooling/test-support/exportsContract.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages", "http-web");

test("http-web exports are explicit and aligned with production and generated usage", () => {
  const result = evaluatePackageExportsContract({
    repoRoot: REPO_ROOT,
    packageDir: PACKAGE_DIR,
    packageId: "@jskit-ai/http-web",
    requiredExports: [
      "./client",
      "./client/components/CrudAddEditScreen",
      "./client/components/CrudDeleteAction",
      "./client/components/CrudListBulkActionSurface",
      "./client/components/CrudListFilterSurface",
      "./client/components/CrudListScreen",
      "./client/components/CrudViewScreen",
      "./client/bulkActions",
      "./client/filters",
      "./client/rowActions",
      "./client/composables/useAddEdit",
      "./client/composables/useAccess",
      "./client/composables/useCommand",
      "./client/composables/useCrudAddEdit",
      "./client/composables/useCrudAddEditScreen",
      "./client/composables/useCrudDeleteAction",
      "./client/composables/useCrudList",
      "./client/composables/useCrudListBulkActions",
      "./client/composables/useCrudListFilterLookups",
      "./client/composables/useCrudListFilters",
      "./client/composables/useCrudListParentTitle",
      "./client/composables/useCrudListRowActions",
      "./client/composables/useCrudListScreen",
      "./client/composables/useCrudView",
      "./client/composables/useCrudViewScreen",
      "./client/composables/crudLookupFieldRuntime",
      "./client/composables/useEndpointResource",
      "./client/composables/useList",
      "./client/composables/usePagedCollection",
      "./client/composables/useRealtimeQueryInvalidation",
      "./client/composables/useUiFeedback",
      "./client/composables/useView",
      "./client/crudHttpClient",
      "./client/lib/httpClient",
      "./client/lib/permissions",
      "./client/support/contractGuards"
    ]
  });

  assert.deepEqual(result.wildcardExports, []);
  assert.deepEqual(result.missingRequiredExports, []);
  assert.deepEqual(
    result.missingExports,
    [],
    `http-web imports missing from package exports:\n${result.missingExports.join("\n")}`
  );
  assert.deepEqual(
    result.staleExports,
    [],
    `Stale http-web exports found: ${result.staleExports.join(", ")}`
  );
});
