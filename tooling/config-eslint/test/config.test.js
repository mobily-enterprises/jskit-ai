import assert from "node:assert/strict";
import test from "node:test";
import { baseConfig, nodeConfig, webConfig, vueConfig } from "../index.js";

test("exports flat config arrays", () => {
  assert.equal(Array.isArray(baseConfig), true);
  assert.equal(Array.isArray(nodeConfig), true);
  assert.equal(Array.isArray(webConfig), true);
  assert.equal(Array.isArray(vueConfig), true);
});

test("vue config keeps practical rule relaxations", () => {
  const override = vueConfig.find(
    (config) => config?.files?.includes("**/*.{js,mjs,cjs,vue}") && config?.rules && !config.plugins
  );

  assert.ok(override);
  assert.equal(override.rules["vue/multi-word-component-names"], "off");
  assert.equal(override.rules["vue/one-component-per-file"], "off");
});

test("node config includes commonjs override for cjs files", () => {
  const cjsOverride = nodeConfig.find((config) => config?.files?.includes("**/*.cjs"));

  assert.ok(cjsOverride);
  assert.equal(cjsOverride.languageOptions.sourceType, "commonjs");
});

test("base config restricts only bare @jskit-ai package imports", () => {
  const baseRules = baseConfig.find((config) => config?.rules?.["no-restricted-imports"]);
  assert.ok(baseRules);

  const rule = baseRules.rules["no-restricted-imports"];
  assert.equal(Array.isArray(rule), true);
  const patterns = rule[1]?.patterns;
  assert.equal(Array.isArray(patterns), true);

  const packageBoundaryPattern = patterns.find(
    (entry) => entry?.message === "Use explicit JSKIT subpath imports: @jskit-ai/<package>/server or /client."
  );
  assert.ok(packageBoundaryPattern);
  assert.equal(packageBoundaryPattern.regex, "^@jskit-ai/[^/]+$");
});
