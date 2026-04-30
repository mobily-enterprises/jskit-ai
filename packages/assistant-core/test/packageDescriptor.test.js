import assert from "node:assert/strict";
import test from "node:test";
import descriptor from "../package.descriptor.mjs";

test("assistant-core advertises a portable json-rest-schema runtime dependency for app installs", () => {
  const specifier = String(descriptor?.mutations?.dependencies?.runtime?.["json-rest-schema"] || "");

  assert.match(
    specifier,
    /^[~^]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/,
    "assistant-core descriptor must not write a repo-local file: dependency into app package.json"
  );
});
