import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("assistant-core advertises a portable json-rest-schema runtime dependency for app installs", () => {
  const specifier = String(packageMetadata?.mutations?.dependencies?.runtime?.["json-rest-schema"] || "");

  assert.match(
    specifier,
    /^(?:[~^]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|\d+\.x\.x)$/,
    "assistant-core packageMetadata must not write a repo-local file: dependency into app package.json"
  );
});
