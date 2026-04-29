import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { composeSchemaDefinitions } from "./composeSchemaDefinitions.js";

test("composeSchemaDefinitions merges multiple schema definitions into one contract", () => {
  const params = {
    schema: createSchema({
      workspaceSlug: {
        type: "string",
        required: true,
        minLength: 1
      }
    }),
    mode: "patch"
  };
  const query = {
    schema: createSchema({
      q: {
        type: "string",
        required: false,
        minLength: 1
      }
    }),
    mode: "patch"
  };

  const definition = composeSchemaDefinitions([params, query], {
    mode: "patch",
    context: "test.compose"
  });

  assert.equal(definition.mode, "patch");
  assert.deepEqual(Object.keys(definition.schema.getFieldDefinitions()).sort(), ["q", "workspaceSlug"]);
});

test("composeSchemaDefinitions rejects duplicate fields", () => {
  const a = {
    schema: createSchema({
      recordId: {
        type: "string",
        required: true,
        minLength: 1
      }
    }),
    mode: "patch"
  };
  const b = {
    schema: createSchema({
      recordId: {
        type: "string",
        required: true,
        minLength: 1
      }
    }),
    mode: "patch"
  };

  assert.throws(
    () => composeSchemaDefinitions([a, b], {
      mode: "patch",
      context: "test.compose"
    }),
    /test\.compose cannot compose duplicate field "recordId"/
  );
});

test("composeSchemaDefinitions requires an explicit mode", () => {
  const params = {
    schema: createSchema({
      workspaceSlug: {
        type: "string",
        required: true,
        minLength: 1
      }
    }),
    mode: "patch"
  };
  const query = {
    schema: createSchema({
      q: {
        type: "string",
        required: false,
        minLength: 1
      }
    }),
    mode: "patch"
  };

  assert.throws(
    () => composeSchemaDefinitions([params, query], { context: "test.compose" }),
    /test\.compose requires an explicit mode/
  );
});
