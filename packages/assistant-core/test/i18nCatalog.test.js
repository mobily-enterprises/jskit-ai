import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateI18nCatalogContract } from "../../../tooling/test-support/i18nCatalogContract.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");

test("assistant-core English catalog matches its source", () => {
  const { problems } = evaluateI18nCatalogContract({
    repoRoot: REPO_ROOT,
    packageDir: path.join(REPO_ROOT, "packages", "assistant-core"),
    // runOpenCodeConversationTurn builds these codes as `assistant_opencode_turn_${reason}`.
    externalCodes: [
      "assistant_opencode_turn_thread_mismatch",
      "assistant_opencode_turn_fresh_thread_required",
      "assistant_opencode_turn_unrelated_history"
    ]
  });
  assert.deepEqual(problems, []);
});
