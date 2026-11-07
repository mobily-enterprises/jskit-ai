import assert from "node:assert/strict";
import test from "node:test";
import { createSchema, normalizeSingleSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import {
  createSchemaDefinition,
  defineApiContract,
  normalizeSchemaDefinitionLike
} from "../src/shared/apiContract.js";

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

test("defineApiContract normalizes operation messages and schema sections", () => {
  const contract = defineApiContract({
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

  assert.equal(contract.namespace, "assistantConfig");
  assert.equal(contract.operations.view.output.mode, "replace");
  assert.equal(contract.operations.patch.body.mode, "patch");
  assert.equal(contract.operations.patch.messages, contract.messages);
});

test("defineApiContract rejects invalid operation schema section values eagerly", () => {
  assert.throws(() => defineApiContract({
    namespace: "assistantConfig",
    operations: {
      view: {
        method: "GET",
        output: true
      }
    }
  }), /operations\.view\.output must be a schema definition object/);

  assert.throws(() => defineApiContract({
    namespace: "assistantConfig",
    operations: {
      patch: {
        method: "PATCH",
        body: "invalid"
      }
    }
  }), /operations\.patch\.body must be a schema definition object/);
});

test("contract schema definitions follow the kernel's definition rules", () => {
  const schema = createSchema({ ok: { type: "boolean", required: true } });

  assert.deepEqual(
    normalizeSchemaDefinitionLike({ schema, mode: "replace" }, { context: "output" }),
    normalizeSingleSchemaDefinition({ schema, mode: "replace" }, { context: "output" })
  );
  assert.deepEqual(normalizeSchemaDefinitionLike(schema, { defaultMode: "create" }), { schema, mode: "create" });
  assert.equal(normalizeSchemaDefinitionLike(null), null);

  const kernelModeError = (() => {
    try {
      normalizeSingleSchemaDefinition({ schema, mode: "upsert" }, { context: "body" });
    } catch (error) {
      return error.message;
    }
    return "";
  })();
  assert.ok(kernelModeError);
  assert.throws(() => createSchemaDefinition(schema, "upsert", { context: "body" }), { message: kernelModeError });
  assert.throws(() => normalizeSchemaDefinitionLike({ schema, mode: "upsert" }, { context: "body" }), { message: kernelModeError });
});
