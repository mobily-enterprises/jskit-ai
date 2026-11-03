import { jskitPlugin } from "./plugin/index.js";

const SERVER_SOURCE_FILES = "**/*.{js,mjs}";
// Tests and client code. Shared modules are checked where a glob selects them:
// the rules cover every module a capability value is built from.
const NOT_SERVER_SOURCE = Object.freeze([
  "**/{test,tests,client,components,pages}/**",
  "**/*.test.*"
]);
const HAND_WRITTEN_FILES = "**/*.{js,mjs,cjs,vue}";
const TEST_FILES = Object.freeze([
  "**/{test,tests}/**",
  "**/*.{test,spec,vitest}.*"
]);

// Files under 750 lines and functions under 600. A generated or static data module is exempt through its one-line
// header, `/* eslint-disable max-lines -- data: <how it is produced> */`.
function sizeLimitRules(severity) {
  return Object.freeze({
    "max-lines": [severity, { max: 750 }],
    "max-lines-per-function": [severity, { max: 600, IIFEs: true }]
  });
}

// The typed-features rules at one severity: collaborators arrive through
// declared capabilities, typed where they are received and required, never
// probed; slots are optional capabilities; actions are one line, written in a
// create<Name>Actions creator, with no idempotency field; refusals are AppErrors
// with their own code, built in one construction; the environment comes from
// the caller; no test-only exports; one copy of each helper per package; one
// property per line in frozen results and token maps; files under 750 lines and
// functions under 600.
function typedFeaturesRules(severity) {
  return Object.freeze({
    "jskit/typed-dependencies": severity,
    "jskit/required-collaborators": severity,
    "jskit/no-slot-setter": severity,
    "jskit/no-module-registry": severity,
    "jskit/one-line-action": severity,
    "jskit/no-duplicate-helper": severity,
    "jskit/allow-comment-form": severity,
    "jskit/jsdoc-description-inside": severity,
    "jskit/no-dual-shape": severity,
    "jskit/named-repeated-type": severity,
    "jskit/action-execute-shape": severity,
    "jskit/no-factory-spread": severity,
    "jskit/frozen-factory-result": severity,
    "jskit/no-optional-after-default": severity,
    "jskit/one-property-per-line": severity,
    "jskit/action-creator": severity,
    "jskit/no-idempotency": severity,
    "jskit/app-error-code": severity,
    "jskit/no-patched-error": severity,
    "jskit/no-env-default": severity,
    "jskit/no-test-only-export": severity,
    ...sizeLimitRules(severity)
  });
}

function requireGlobs(name, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError(`${name} requires a list of file globs.`);
  }
}

/**
 * The typed-features rules for the server and shared source files the globs
 * select (tests and client code excluded), as errors unless another severity
 * is given. An application lists
 * each package as it converts it, so the rules it already follows stay followed.
 * @param {string[]} files
 * @param {"error" | "warn" | "off"} [severity]
 */
function typedFeaturesConfig(files, severity = "error") {
  requireGlobs("typedFeaturesConfig", files);
  return Object.freeze([
    Object.freeze({
      files: files.map((pattern) => [pattern, SERVER_SOURCE_FILES]),
      ignores: NOT_SERVER_SOURCE,
      plugins: { jskit: jskitPlugin },
      rules: typedFeaturesRules(severity)
    })
  ]);
}

/**
 * The file and function size limits, as errors, for every hand-written source file the globs select, client code
 * and Vue components included; tests are not checked. typedFeaturesConfig already holds server and shared code to
 * them.
 * @param {string[]} files
 * @param {{ ignores?: string[] }} [options] Files the limits leave alone, such as generated output.
 */
function sizeLimitsConfig(files, { ignores = [] } = {}) {
  requireGlobs("sizeLimitsConfig", files);
  return Object.freeze([
    Object.freeze({
      files: files.map((pattern) => [pattern, HAND_WRITTEN_FILES]),
      ignores: [...TEST_FILES, ...ignores],
      rules: sizeLimitRules("error")
    })
  ]);
}

export { sizeLimitRules, sizeLimitsConfig, typedFeaturesConfig };
