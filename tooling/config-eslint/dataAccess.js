import { jskitPlugin } from "./plugin/index.js";

const SOURCE_FILES = "**/*.{js,mjs,cjs}";
// What the data-access rules leave alone: client code, which never reaches the database, and tests, migrations and
// seeds, which reach it directly on purpose. Each is told by a name that says so, not by a folder that merely tends to
// hold it, and a folder only at the root of the app or of one of its packages (ROOT), where its name says what the whole
// tree is: a migrations/, seeds/ or test/ folder deeper in server code is server code. Client code is a package's
// src/client; a seed is a seeds/ (or seed/) folder, or a seed script in a scripts/ or bin/ folder or at the root. An
// application's own src/ is linted whole: it holds the browser app, but server code sits there too (an AI feature in
// src/, a src/jobs/ folder) and no folder name tells them apart. Client code has nothing for these rules to report, so
// linting it costs nothing; skipping src/ by folder, and every seed*.js anywhere, let server code escape every rule.
const ROOT = "{,packages/*/,tooling/*/}";
const NOT_DATA_ACCESS_SOURCE = Object.freeze([
  `${ROOT}src/client/**`,
  `${ROOT}{test,tests,__tests__,e2e,test-support,src/test}/**`,
  "**/*.{test,spec,vitest}.*",
  `${ROOT}migrations/**`,
  `${ROOT}{seed,seeds}/**`,
  `${ROOT}{scripts,bin}/seed*.{js,mjs,cjs}`,
  `${ROOT}seed*.{js,mjs,cjs}`,
  `${ROOT}{dist,build,coverage}/**`
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
 * client code, tests, migrations and seeds (NOT_DATA_ACCESS_SOURCE, which says how each is told apart). baseConfig already applies them to every file of
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
