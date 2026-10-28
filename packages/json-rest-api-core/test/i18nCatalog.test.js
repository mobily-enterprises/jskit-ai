import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateI18nCatalogContract } from "../../../tooling/test-support/i18nCatalogContract.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");

test("json-rest-api-core English catalog matches its source", () => {
  const { problems } = evaluateI18nCatalogContract({
    repoRoot: REPO_ROOT,
    packageDir: path.join(REPO_ROOT, "packages", "json-rest-api-core"),
    // json-rest-api throws these; their English is fixed by the library.
    externalCodes: ["REST_API_VERSION_CONFLICT", "REST_API_PRECONDITION_FAILED"]
  });
  assert.deepEqual(problems, []);
});
