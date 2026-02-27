import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "../src/shared/schema.js";

test("createSchema returns expected top-level contract groups", () => {
  const schema = createSchema();
  assert.ok(schema);
  assert.ok(schema.query);
  assert.ok(schema.params);
  assert.ok(schema.body);
  assert.ok(schema.response);
});
