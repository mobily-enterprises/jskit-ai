import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("auth-web ships reusable views without mutating application source", () => {
  assert.equal(Object.hasOwn(packageMetadata, "mutations"), false);
  assert.equal(Object.keys(packageJson.exports).some((subpath) => subpath.includes("templates")), false);
});
