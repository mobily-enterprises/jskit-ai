import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { postgresTestFiles } from "./test-postgres.mjs";
import { runKnexTestFiles } from "./test-sqlite.mjs";

test("test:postgres runs every PostgreSQL test file and every package test file whose data tests take the run's Knex, and no MariaDB or browser one", () => {
  const files = postgresTestFiles();
  for (const file of [
    "packages/resource-runtime/test/locks.postgres.test.js",
    "packages/auth-provider-local-db-core/test/secondFactor.postgres.test.js",
    "packages/workspaces-core/test/transferOwnership.postgres.test.js",
    // Data tests on the run's Knex that CI's PostgreSQL job, when it named its files by hand, left out.
    "packages/crud-core/test/listFilterRoutes.test.js",
    "packages/crud-core/test/nestedIncludeFieldsets.test.js",
    "packages/resource-runtime/test/requestCallOptions.test.js",
    "packages/workspaces-core/test/workspaceMemberListRoutes.test.js",
    "packages/workspaces-core/test/workspaceRequestContextQueries.test.js",
    "packages/workspaces-core/test/workspaceUserCrud.test.js"
  ]) {
    assert.ok(files.includes(file), file);
  }
  for (const file of runKnexTestFiles()) assert.ok(files.includes(file), file);
  assert.deepEqual(files.filter((file) => /\.(?:mysql|browser)\.test\.js$/u.test(file)), []);
});

test("CI's PostgreSQL job runs npm run test:postgres, which npm run verify leaves to it", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(scripts["test:postgres"], "node ./scripts/test-postgres.mjs");
  assert.doesNotMatch(scripts.verify, /test:postgres/u);
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const job = workflow.slice(workflow.indexOf("\n  test-databases-postgres:"), workflow.indexOf("\n  deploy-docs:"));
  assert.match(job, /^ +DB_CLIENT: pg$/mu);
  assert.match(job, /^ +run: npm run test:postgres$/mu);
  assert.doesNotMatch(job, /jskit test/u);
});

test("test:postgres refuses a run that is not on a PostgreSQL test database, naming what to set", () => {
  const run = (environment) => spawnSync(process.execPath, ["./scripts/test-postgres.mjs"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...environment }
  });
  for (const environment of [
    { DB_CLIENT: "mysql2", DB_NAME: "jskit_test", TEST_DB_NAME: "jskit_test" },
    { DB_CLIENT: "pg", DB_NAME: "jskit_test" },
    { DB_CLIENT: "pg", DB_NAME: "jskit_application", TEST_DB_NAME: "jskit_test" }
  ]) {
    const { status, stderr } = run(environment);
    assert.notEqual(status, 0, JSON.stringify(environment));
    assert.match(stderr, /test:postgres runs on a PostgreSQL test database: set DB_CLIENT=pg, TEST_DB_NAME, DB_NAME to the same name/u);
    assert.doesNotMatch(stderr, /test:postgres: \d+ package test file/u);
  }
});
