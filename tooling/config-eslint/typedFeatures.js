import { jskitPlugin } from "./plugin/index.js";

const SERVER_SOURCE_FILES = "**/*.{js,mjs}";
const NOT_SERVER_SOURCE = Object.freeze([
  "**/{test,tests,client,components,pages,shared}/**",
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
    "max-lines": [severity, { max: 750 }],
    "max-lines-per-function": [severity, { max: 600, IIFEs: true }]
  });
}

/**
 * The typed-features rules for the server source files the globs select (tests
 * excluded), as errors unless another severity is given. An application lists
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
