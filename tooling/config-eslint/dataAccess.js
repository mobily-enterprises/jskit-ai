import { jskitPlugin } from "./plugin/index.js";

const SOURCE_FILES = "**/*.{js,mjs,cjs}";
// What the data-access rules leave alone, by directory: client code, which never reaches the database (an application's
// own src/ but its src/server and src/shared, and every package's src/client), and tests, migrations and seeds, which
// reach it directly on purpose. Everything else is server code, wherever it sits.
const NOT_DATA_ACCESS_SOURCE = Object.freeze([
  "src/!(server|shared)/**",
  "src/*.{js,mjs,cjs}",
  "**/src/client/**",
  "**/{test,tests,__tests__,e2e,test-support}/**",
  "**/*.{test,spec,vitest}.*",
  "**/migrations/**",
  "**/{seed,seeds}/**",
  "**/seed*.{js,mjs,cjs}",
  "**/{dist,build,coverage}/**"
]);

/**
 * The data-access rules at one severity: the resource is the only door to a table. No Knex past the resource, no
 * transaction read by hand, raw SQL only as one literal with bindings, no hand-written workspace predicate, no system
 * context or context scope made by hand, and every
 * scopedQuery() report a repository method under its `// Knex: <kind> - <reason>` line.
 * @param {"error" | "warn" | "off"} [severity]
 */
function dataAccessRules(severity = "error") {
  return Object.freeze({
    "jskit/no-direct-knex": severity,
    "jskit/no-transaction-reader": severity,
    "jskit/sql-literal": severity,
    "jskit/no-hand-scope": severity,
    "jskit/no-hand-context": severity,
    "jskit/knex-reason": severity
  });
}

/**
 * The data-access rules, as errors unless another severity is given, for the source files the globs select, but
 * client code, tests, migrations and seeds (NOT_DATA_ACCESS_SOURCE). baseConfig already applies them to every file of
 * an application; a repository lists its own trees with this.
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
