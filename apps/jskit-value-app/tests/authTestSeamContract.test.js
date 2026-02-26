import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_FILES = Object.freeze([
  "authRequestScopedSupabaseClient.test.js",
  "oauthFlowsAndAuthMethods.test.js",
  "authServiceHelpersBranches.test.js"
]);

const FORBIDDEN_IMPORT_PATTERN = /\.\.\/server\/modules\/auth\/lib\//;
const REQUIRED_IMPORT_PATTERN = /@jskit-ai\/auth-provider-supabase-core\/test-utils/;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

test("auth helper tests import package test seam instead of app-local auth lib copies", async () => {
  for (const fileName of TEST_FILES) {
    const filePath = path.join(testDirectory, fileName);
    const source = await readFile(filePath, "utf8");

    assert.equal(
      FORBIDDEN_IMPORT_PATTERN.test(source),
      false,
      `${fileName} imports app-local auth lib files; use @jskit-ai/auth-provider-supabase-core/test-utils instead.`
    );
    assert.equal(
      REQUIRED_IMPORT_PATTERN.test(source),
      true,
      `${fileName} must import auth helpers from @jskit-ai/auth-provider-supabase-core/test-utils.`
    );
  }
});
