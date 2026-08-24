import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

test("database-runtime exposes migration configuration without authoring mutations", () => {
  assert.equal(packageJson.exports?.["./server/knexMigrationConfig"], "./src/server/knexMigrationConfig.js");
  assert.equal(packageJson.exports?.["./server/databaseSetup"], "./src/server/databaseSetup.js");
  assert.equal(Object.hasOwn(packageJson.jskit, "mutations"), false);
  assert.equal(Object.hasOwn(packageJson.jskit, "ci"), false);
  assert.equal(Object.hasOwn(packageJson.jskit, "options"), false);
  assert.equal(Object.hasOwn(packageJson.jskit.metadata.apiSummary, "containerTokens"), false);
  assert.deepEqual(packageJson.jskit.capabilities, {
    provides: ["runtime.database"],
    requires: ["runtime.database.driver"]
  });
});
