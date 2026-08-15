import assert from "node:assert/strict";
import test from "node:test";
import packageJson from "../package.json" with { type: "json" };

const packageMetadata = packageJson.jskit;

test("local auth has no package mutation or CI recipe", () => {
  assert.equal(Object.hasOwn(packageMetadata, "ci"), false);
  assert.equal(Object.hasOwn(packageMetadata, "mutations"), false);
});

test("local auth declares Nodemailer as its own runtime dependency", () => {
  assert.equal(typeof packageJson.dependencies.nodemailer, "string");
});
