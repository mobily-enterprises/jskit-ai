import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { baseConfig } from "../base.js";
import { dataAccessConfig, dataAccessRules } from "../dataAccess.js";
import { jskitPlugin } from "../plugin/index.js";

const DATA_ACCESS_RULES = Object.freeze(["no-direct-knex", "no-transaction-reader", "sql-literal", "no-hand-scope", "no-hand-context", "knex-reason"]);
const PROBE = [
  "export function listOpen(knex, options) {",
  "  return knex(\"receivals\").where(\"workspace_id\", options.context.workspaceId).whereRaw(\"status = \" + options.status);",
  "}",
  ""
].join("\n");

// The data-access rules that report on a file, once each, with their severity.
async function dataAccessFindings(config, filePath) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintText(PROBE, { filePath });
  return [...new Set(result.messages
    .filter((message) => DATA_ACCESS_RULES.includes(message.ruleId?.replace(/^jskit\//u, "")))
    .map((message) => `${message.severity === 2 ? "error" : "warn"} ${message.ruleId}`))].sort();
}

const ERRORS = Object.freeze(["error jskit/no-direct-knex", "error jskit/no-hand-scope", "error jskit/sql-literal"]);

test("baseConfig reports the data-access rules as errors in every source but a package's client, the app's own src/ included", async () => {
  for (const filePath of [
    "packages/receivals/src/server/receivalsService.js",
    "packages/receivals/src/shared/receivalResource.js",
    "packages/receivals/src/receivalsStore.js",
    "packages/receivals/lib/receivalsStore.mjs",
    "src/server/receivalsStore.js",
    "src/shared/receivalResource.js",
    "server/lib/startup.js",
    "server.js",
    "config/server.js",
    "bin/report.cjs",
    "scripts/report.js",
    // An application's own src/ is linted whole, and a seed is told by its folder or a script's place, not its name:
    // server code there, or a service named seed*, is not left alone.
    "src/main.js",
    "src/pages/home/receivals.js",
    "src/ApplicationAiFeature.js",
    "src/jobs/nightlyCleanup.js",
    "packages/receivals/src/server/seedReceivals.js",
    "server/lib/seedService.js",
    // A test, migrations or seeds folder is told apart only at the root of the app or a package: deeper, it is server code.
    "packages/receivals/src/server/test/receivalsService.js",
    "packages/receivals/src/server/migrations/receivals.js",
    "src/server/seeds/demo.js",
    "server/lib/scripts/seedDemo.js"
  ]) {
    assert.deepEqual(await dataAccessFindings(baseConfig, filePath), ERRORS, filePath);
  }
});

test("baseConfig leaves tests, migrations, seeds and client code to reach the database directly", async () => {
  for (const filePath of [
    "packages/receivals/test/receivalsService.js",
    "packages/receivals/src/test/expectScoped.js",
    "packages/receivals/src/server/receivalsService.test.js",
    "tests/server/receivals.spec.js",
    "migrations/20260101000000_receivals.js",
    "packages/receivals/migrations/20260101000000_receivals.cjs",
    "seeds/receivals.js",
    "packages/receivals/seeds/receivals.js",
    "scripts/seed-database.js",
    "packages/receivals/bin/seedDemo.mjs",
    "seed.js",
    "packages/receivals/src/client/composables/useReceivals.js",
    "tests/e2e/receivals.js",
    "dist/assets/index.js"
  ]) {
    assert.deepEqual(await dataAccessFindings(baseConfig, filePath), [], filePath);
  }
});

test("dataAccessConfig sets the rules for the globs a repository lists, and turns them off where its packages are the data layer", async () => {
  const config = [
    ...baseConfig,
    ...dataAccessConfig(["packages/kernel/server/**"]),
    ...dataAccessConfig(["packages/database-runtime/src/server/**"], "off"),
    ...dataAccessConfig(["packages/legacy/src/server/**"], "warn")
  ];
  assert.deepEqual(await dataAccessFindings(config, "packages/kernel/server/runtime.js"), ERRORS);
  assert.deepEqual(await dataAccessFindings(config, "packages/database-runtime/src/server/transactions.js"), []);
  assert.deepEqual(await dataAccessFindings(config, "packages/legacy/src/server/store.js"), [
    "warn jskit/no-direct-knex",
    "warn jskit/no-hand-scope",
    "warn jskit/sql-literal"
  ]);
});

test("dataAccessRules names every data-access rule of the plugin, at one severity", () => {
  assert.deepEqual(Object.keys(dataAccessRules()), DATA_ACCESS_RULES.map((rule) => `jskit/${rule}`));
  assert.deepEqual(new Set(Object.values(dataAccessRules("warn"))), new Set(["warn"]));
  assert.deepEqual(DATA_ACCESS_RULES.filter((rule) => !jskitPlugin.rules[rule]), []);
  const [entry] = dataAccessConfig(["src/server/**"]);
  assert.deepEqual(entry.rules, dataAccessRules("error"));
  assert.equal(entry.plugins.jskit, jskitPlugin);
  assert.throws(() => dataAccessConfig([]), TypeError);
});
