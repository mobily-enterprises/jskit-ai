import test from "node:test";
import assert from "node:assert/strict";
import { toCamelCase, toSnakeCase } from "../shared/support/stringCase.js";

test("toCamelCase converts snake and kebab to camelCase", () => {
  assert.equal(toCamelCase("created_at"), "createdAt");
  assert.equal(toCamelCase("user-id"), "userId");
  assert.equal(toCamelCase("__leading__dots__"), "leadingDots");
});

test("toSnakeCase converts camelCase and PascalCase to snake_case", () => {
  assert.equal(toSnakeCase("createdAt"), "created_at");
  assert.equal(toSnakeCase("XMLHttpRequest"), "xml_http_request");
  assert.equal(toSnakeCase("userID"), "user_id");
  assert.equal(toSnakeCase("already_snake"), "already_snake");
});

test("toSnakeCase handles empty inputs gracefully", () => {
  assert.equal(toSnakeCase(""), "");
  assert.equal(toSnakeCase(null), "");
  assert.equal(toSnakeCase("  "), "");
});
