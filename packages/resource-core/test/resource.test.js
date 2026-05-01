import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import {
  createSchemaDefinition,
  defineResource,
  normalizeSchemaDefinitionLike
} from "../src/shared/resource.js";

test("createSchemaDefinition wraps json-rest-schema instances with an explicit mode", () => {
  const definition = createSchemaDefinition(createSchema({
    ok: {
      type: "boolean",
      required: true
    }
  }), "replace");

  assert.equal(typeof definition.schema.toJsonSchema, "function");
  assert.equal(definition.mode, "replace");
});

test("normalizeSchemaDefinitionLike accepts raw schemas and schema definition objects", () => {
  const schema = createSchema({
    name: {
      type: "string",
      required: true
    }
  });

  const fromSchema = normalizeSchemaDefinitionLike(schema, {
    context: "test raw schema",
    defaultMode: "create"
  });
  const fromDefinition = normalizeSchemaDefinitionLike({
    schema,
    mode: "patch"
  }, {
    context: "test schema definition"
  });

  assert.equal(fromSchema.mode, "create");
  assert.equal(fromDefinition.mode, "patch");
});

test("defineResource normalizes operation messages and schema sections", () => {
  const resource = defineResource({
    namespace: "assistantConfig",
    messages: {
      validation: "Fix invalid values."
    },
    operations: {
      view: {
        method: "GET",
        output: createSchema({
          ok: {
            type: "boolean",
            required: true
          }
        })
      },
      patch: {
        method: "PATCH",
        body: createSchema({
          name: {
            type: "string",
            required: false
          }
        }),
        output: createSchema({
          ok: {
            type: "boolean",
            required: true
          }
        })
      }
    }
  });

  assert.equal(resource.namespace, "assistantConfig");
  assert.equal(resource.operations.view.output.mode, "replace");
  assert.equal(resource.operations.patch.body.mode, "patch");
  assert.equal(resource.operations.patch.messages, resource.messages);
});

test("defineResource rejects invalid operation schema section values eagerly", () => {
  assert.throws(() => defineResource({
    namespace: "assistantConfig",
    operations: {
      view: {
        method: "GET",
        output: true
      }
    }
  }), /operations\.view\.output must be a json-rest-schema schema instance or schema definition object/);

  assert.throws(() => defineResource({
    namespace: "assistantConfig",
    operations: {
      patch: {
        method: "PATCH",
        body: "invalid"
      }
    }
  }), /operations\.patch\.body must be a json-rest-schema schema instance or schema definition object/);
});
