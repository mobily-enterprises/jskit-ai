import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "../src/server/database.js";
import { createKnexMigrationConfig } from "../src/server/knexMigrationConfig.js";

// A process a test run gave its databases (a `jskit test --databases` file, a browser run's Playwright worker) names
// them in JSKIT_TEST_DATABASE_GUARD; the application's knexfile settings and its runtime's database refuse any other
// name before anything connects, so a test never reaches a development or production database.
const GUARD = "JSKIT_TEST_DATABASE_GUARD";
const guarded = (more = {}) => ({
  DB_HOST: "127.0.0.1", DB_USER: "app", DB_PASSWORD: "",
  [GUARD]: JSON.stringify({ databases: ["app_browser_1"], given: "this Playwright worker was given",
    fix: "Open the database through this worker's environment (process.env)." }),
  ...more
});

test("under a test run, the knexfile settings and the runtime's database refuse a database the run did not give, naming the variable and the fix", async () => {
  const opened = [];
  for (const open of [
    (environment) => createKnexMigrationConfig({ client: "mysql2", environment }),
    // Made, not connected: nothing connects until a statement runs.
    (environment) => opened.push(createDatabase({ driver: { DIALECT_ID: "mysql2" }, env: environment }).knex)
  ]) {
    assert.throws(() => open(guarded({ DB_NAME: "app_development" })), new RegExp("^Error: DB_NAME names app_development, " +
      "which is not one of the test databases this Playwright worker was given \\(app_browser_1\\): a test never reaches a " +
      "development or production database\\. Open the database through this worker's environment \\(process\\.env\\)\\.$", "u"));
    assert.throws(() => open(guarded({ DATABASE_URL: "mysql://app@127.0.0.1/app_production" })),
      /^Error: DATABASE_URL names app_production, which is not one of the test databases/u);
    // The run's own database opens, and a process no test run gave databases opens any.
    assert.doesNotThrow(() => open(guarded({ DB_NAME: "app_browser_1" })));
    assert.doesNotThrow(() => open({ DB_HOST: "127.0.0.1", DB_USER: "app", DB_NAME: "app_development" }));
  }
  await Promise.all(opened.map((knex) => knex.destroy()));
});

test("under a test run that gave a process no database, every database name is refused", () => {
  const none = { DB_HOST: "127.0.0.1", DB_USER: "app", DB_NAME: "app_development",
    [GUARD]: JSON.stringify({ databases: [], given: "this Playwright worker was given", fix: "Name PLAYWRIGHT_PORT." }) };
  assert.throws(() => createKnexMigrationConfig({ client: "pg", environment: none }),
    /^Error: DB_NAME names app_development, which is not one of the test databases this Playwright worker was given \(none\)/u);
});
