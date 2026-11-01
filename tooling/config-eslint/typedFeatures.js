import { jskitPlugin } from "./plugin/index.js";

const SERVER_SOURCE_FILES = "**/*.{js,mjs}";
// Tests and client code. Shared modules are checked where a glob selects them:
// the rules cover every module a capability value is built from.
const NOT_SERVER_SOURCE = Object.freeze([
  "**/{test,tests,client,components,pages}/**",
  "**/*.test.*"
]);

// The typed-features rules at one severity: collaborators arrive through
// declared capabilities, typed where they are received and required, never
// probed; slots are optional capabilities; actions are one line; one copy of
// each helper per package; files under 750 lines and functions under 600.
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
    "max-lines": [severity, { max: 750 }],
    "max-lines-per-function": [severity, { max: 600, IIFEs: true }]
  });
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
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("typedFeaturesConfig requires a list of file globs.");
  }
  return Object.freeze([
    Object.freeze({
      files: files.map((pattern) => [pattern, SERVER_SOURCE_FILES]),
      ignores: NOT_SERVER_SOURCE,
      plugins: { jskit: jskitPlugin },
      rules: typedFeaturesRules(severity)
    })
  ]);
}

export { typedFeaturesConfig };
