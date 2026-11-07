import { jskitPlugin } from "./plugin/index.js";

const SOURCE_FILES = "**/*.{js,mjs,cjs}";
// Tests, migrations and seeds reach the database directly on purpose, so the data-access rules leave them alone.
const NOT_DATA_ACCESS_SOURCE = Object.freeze([
  "**/{test,tests,__tests__}/**",
  "**/*.{test,spec,vitest}.*",
  "**/migrations/**",
  "**/{seed,seeds}/**",
  "**/seed*.{js,mjs,cjs}"
]);

/**
 * The data-access rules at one severity: the resource is the only door to a table. No Knex past the resource, no
 * transaction read by hand, raw SQL only as one literal with bindings, no hand-written workspace predicate, and every
 * scopedQuery() report a repository method under its `// Knex: <kind> - <reason>` line.
 * @param {"error" | "warn" | "off"} [severity]
 */
function dataAccessRules(severity = "error") {
  return Object.freeze({
    "jskit/no-direct-knex": severity,
    "jskit/no-transaction-reader": severity,
    "jskit/sql-literal": severity,
    "jskit/no-hand-scope": severity,
    "jskit/knex-reason": severity
  });
}

/**
 * The data-access rules, as errors unless another severity is given, for the server and shared source files the globs
 * select. Tests, migrations and seeds are not checked. baseConfig already applies them to every application's server
 * and shared code; a repository lists its own trees with this.
 * @param {string[]} files
 * @param {"error" | "warn" | "off"} [severity]
 */
function dataAccessConfig(files, severity = "error") {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("dataAccessConfig requires a list of file globs.");
  }
  return Object.freeze([
    Object.freeze({
      files: files.map((pattern) => [pattern, SOURCE_FILES]),
      ignores: NOT_DATA_ACCESS_SOURCE,
      plugins: { jskit: jskitPlugin },
      rules: dataAccessRules(severity)
    })
  ]);
}

export { dataAccessConfig, dataAccessRules };
