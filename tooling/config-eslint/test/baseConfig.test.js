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
