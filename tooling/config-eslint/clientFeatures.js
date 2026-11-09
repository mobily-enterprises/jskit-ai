import vuePlugin from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import { jskitPlugin } from "./plugin/index.js";
import { sizeLimitRules } from "./typedFeatures.js";

const CLIENT_SOURCE_FILES = "**/*.{js,mjs,vue}";
const COMPONENT_FILES = "**/*.vue";
const TEST_FILES = Object.freeze([
  "**/{test,tests}/**",
  "**/*.{test,spec,vitest}.*"
]);

// The typed-features rules that read client code, and the client-only rules, at one severity: collaborators of
// composables, client factories and providers are typed where received and required, never probed, in scripts and
// templates; injected values take an exported key, a type and no empty default; props a component calls are required
// and typed by their contract; results keep the shape they are built with and hold Vue state unfrozen; whatever client
// code starts it releases; no module-level mutable state; a selection whose options are not fixed is SelectField with
// loading; one copy of each helper per package; files under 750 lines and functions under 600. The server's action and error rules have no client counterpart, and a composable's result is
// never held to Object.freeze.
function clientFeaturesRules(severity) {
  return Object.freeze({
    "jskit/typed-dependencies": severity,
    "jskit/required-collaborators": severity,
    "jskit/no-slot-setter": severity,
    "jskit/no-module-registry": severity,
    "jskit/no-duplicate-helper": severity,
    "jskit/allow-comment-form": severity,
    "jskit/jsdoc-description-inside": severity,
    "jskit/no-dual-shape": severity,
    "jskit/named-repeated-type": severity,
    "jskit/no-factory-spread": severity,
    "jskit/frozen-factory-result": severity,
    "jskit/no-optional-after-default": severity,
    "jskit/one-property-per-line": severity,
    "jskit/no-env-default": severity,
    "jskit/no-test-only-export": severity,
    "jskit/typed-inject": severity,
    "jskit/collaborator-props": severity,
    "jskit/fixed-result-shape": severity,
    "jskit/released-listeners": severity,
    "jskit/no-module-state": severity,
    "jskit/no-frozen-vue-state": severity,
    "jskit/selection-field": severity,
    ...sizeLimitRules(severity)
  });
}

// Every prop has a type and is required or defaulted (never both), and every emitted event is declared.
function componentRules(severity) {
  return Object.freeze({
    "vue/require-prop-types": severity,
    "vue/require-default-prop": severity,
    "vue/require-valid-default-prop": severity,
    "vue/no-required-prop-with-default": severity,
    "vue/require-explicit-emits": severity
  });
}

/**
 * The typed-features rules for the client source files the globs select (modules and Vue components; tests excluded),
 * as errors unless another severity is given. An application lists each client tree as it converts it, so the rules
 * it already follows stay followed; nothing else changes until it does.
 * @param {string[]} files
 * @param {"error" | "warn" | "off"} [severity]
 */
function clientFeaturesConfig(files, severity = "error") {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("clientFeaturesConfig requires a list of file globs.");
  }
  return Object.freeze([
    Object.freeze({
      files: files.map((pattern) => [pattern, CLIENT_SOURCE_FILES]),
      ignores: TEST_FILES,
      plugins: { jskit: jskitPlugin },
      settings: { jskit: { client: true } },
      rules: clientFeaturesRules(severity)
    }),
    Object.freeze({
      files: files.map((pattern) => [pattern, COMPONENT_FILES]),
      ignores: TEST_FILES,
      plugins: { vue: vuePlugin },
      languageOptions: { parser: vueParser },
      rules: componentRules(severity)
    })
  ]);
}

export { clientFeaturesConfig };
