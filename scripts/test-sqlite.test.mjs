import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sqliteTestFiles } from "./test-sqlite.mjs";

test("test:sqlite runs the package test files whose data tests take the run's Knex, and none a dialect of its own runs", () => {
  const files = sqliteTestFiles();
  for (const file of [
    "packages/resource-runtime/test/lockPolicy.test.js",
    "packages/resource-runtime/test/lockWhereOrder.test.js",
    "packages/resource-runtime/test/policyTransaction.test.js",
    "packages/crud-core/test/crudOnHandles.test.js"
  ]) {
    assert.ok(files.includes(file), file);
  }
  assert.deepEqual(files.filter((file) => /\.(?:mysql|postgres|browser)\.test\.js$/u.test(file)), []);
  for (const file of files) assert.match(readFileSync(file, "utf8"), /createPackageTestKnex\(/u, file);
});

test("npm run verify runs the package data tests on SQLite after the packages' own tests, which a DB_CLIENT run gives its database", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(scripts.verify, /npm --workspaces --if-present test && npm run test:sqlite$/u);
  assert.equal(scripts["test:sqlite"], "node ./scripts/test-sqlite.mjs");
});
