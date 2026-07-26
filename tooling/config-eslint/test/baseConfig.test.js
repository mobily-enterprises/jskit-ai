import assert from "node:assert/strict";
import test from "node:test";
import { baseConfig } from "../base.js";

test("baseConfig ignores generated JSKIT runtime and build artifacts", () => {
  const ignoreEntries = baseConfig
    .filter((entry) => Array.isArray(entry?.ignores))
    .flatMap((entry) => entry.ignores);

  assert.deepEqual(
    [
      ".jskit/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "test-results/**"
    ].filter((pattern) => !ignoreEntries.includes(pattern)),
    []
  );
});

test("baseConfig preserves the established lint policy across ESLint 10", () => {
  const sourceRules = baseConfig.find(
    (entry) => Array.isArray(entry?.files) && entry.files.includes("**/*.{js,mjs,cjs,vue}")
  )?.rules;

  assert.equal(sourceRules?.["no-useless-assignment"], "off");
  assert.equal(sourceRules?.["preserve-caught-error"], "off");
});
