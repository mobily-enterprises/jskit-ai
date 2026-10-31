import assert from "node:assert/strict";
import test from "node:test";
import { ESLint } from "eslint";
import { baseConfig } from "../base.js";
import { typedFeaturesConfig } from "../typedFeatures.js";

const PROBE = "export function createReader({ store } = {}) {\n  return () => store.read?.();\n}\n";

async function typedFeatureFindings(config, filePath) {
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: config });
  const [result] = await eslint.lintText(PROBE, { filePath });
  return result.messages
    .filter((message) => message.ruleId?.startsWith("jskit/"))
    .map((message) => `${message.severity === 2 ? "error" : "warn"} ${message.ruleId}`);
}

test("baseConfig warns about the typed-features rules in server source only", async () => {
  assert.deepEqual(await typedFeatureFindings(baseConfig, "packages/booking/src/server/reader.js"), [
    "warn jskit/typed-dependencies",
    "warn jskit/required-collaborators",
    "warn jskit/required-collaborators"
  ]);
  assert.deepEqual(await typedFeatureFindings(baseConfig, "packages/booking/src/client/reader.js"), []);
  assert.deepEqual(await typedFeatureFindings(baseConfig, "packages/booking/src/server/test/reader.js"), []);
  assert.deepEqual(await typedFeatureFindings(baseConfig, "packages/booking/src/server/reader.test.js"), []);
});

test("typedFeaturesConfig makes the rules errors for the globs an application lists", async () => {
  const config = [...baseConfig, ...typedFeaturesConfig(["packages/booking/src/server/**"])];
  assert.deepEqual(await typedFeatureFindings(config, "packages/booking/src/server/reader.js"), [
    "error jskit/typed-dependencies",
    "error jskit/required-collaborators",
    "error jskit/required-collaborators"
  ]);
  assert.deepEqual(await typedFeatureFindings(config, "packages/invoices/src/server/reader.js"), [
    "warn jskit/typed-dependencies",
    "warn jskit/required-collaborators",
    "warn jskit/required-collaborators"
  ]);
});

test("typedFeaturesConfig sets the file and function size limits", () => {
  const [entry] = typedFeaturesConfig(["src/server/**"]);
  assert.deepEqual(entry.rules["max-lines"], ["error", { max: 750 }]);
  assert.deepEqual(entry.rules["max-lines-per-function"], ["error", { max: 600, IIFEs: true }]);
  assert.throws(() => typedFeaturesConfig([]), TypeError);
});
