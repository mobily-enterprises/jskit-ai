import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("assistant-core owns its portable json-rest-schema dependency directly", () => {
  const specifier = String(packageJson.dependencies?.["json-rest-schema"] || "");

  assert.match(
    specifier,
    /^(?:[~^]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|\d+\.x\.x)$/,
    "assistant-core must declare a publishable json-rest-schema dependency"
  );
  assert.equal(Object.hasOwn(packageMetadata, "mutations"), false);
});
