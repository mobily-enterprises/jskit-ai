import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EXPECTED_EXPORTS = Object.freeze({
  "./server/providers/AuthSupabaseServiceProvider": "./src/server/providers/AuthSupabaseServiceProvider.js",
  "./server/providers/AuthProviderServiceProvider": "./src/server/providers/AuthProviderServiceProvider.js",
  "./server/lib/index": "./src/server/lib/index.js",
  "./client": "./src/client/index.js"
});

test("auth-provider-supabase-core exports only curated entrypoints", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const exportsMap = packageJson && typeof packageJson === "object" ? packageJson.exports : {};

  assert.deepEqual(exportsMap, EXPECTED_EXPORTS);
  assert.equal(exportsMap["./server/lib/service"], undefined);
  assert.equal(exportsMap["./server/lib/test-utils"], undefined);
  assert.equal(exportsMap["./server/lib/oauthFlows"], undefined);
});
