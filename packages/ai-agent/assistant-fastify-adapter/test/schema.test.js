import test from "node:test";
import assert from "node:assert/strict";
import { createSchema, schema } from "../src/shared/schema.js";

test("assistant schema exports default and factory contracts", () => {
  assert.ok(schema);
  const generated = createSchema();
  assert.ok(generated.body.chatStream);
  assert.ok(generated.query.conversations);
  assert.ok(generated.params.conversation);
  assert.ok(generated.response.stream);
});
