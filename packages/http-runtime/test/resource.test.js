import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import {
  createCursorPagedListResponseSchema,
  createResource
} from "../src/shared/validators/resource.js";

test("createCursorPagedListResponseSchema builds items + nextCursor schema", () => {
  const itemSchema = {
    schema: createSchema({
      id: { type: "integer", required: true, min: 1 }
    })
  };
  const listSchema = createCursorPagedListResponseSchema(itemSchema);
  const transportSchema = listSchema.schema.toJsonSchema({ mode: listSchema.mode });

  assert.equal(listSchema.mode, "replace");
  assert.equal(transportSchema.type, "object");
  assert.equal(transportSchema.additionalProperties, false);
  assert.equal(transportSchema.properties.items.type, "array");
  assert.equal(transportSchema.properties.nextCursor.anyOf.length, 2);
});

test("createResource requires record/create/replace/patch schemas", () => {
  assert.throws(
    () => createResource({}),
    /record is required/
  );

  assert.throws(
    () =>
      createResource({
        record: createSchema({}),
        create: { schema: createSchema({}) },
        replace: { schema: createSchema({}) },
        patch: { schema: createSchema({}) }
      }),
    /record must be a schema definition object/
  );
});

test("createResource builds default list schema from record/listItem", () => {
  const recordSchema = {
    schema: createSchema({
      id: { type: "integer", required: true, min: 1 },
      name: { type: "string", required: true, minLength: 1 }
    })
  };
  const writeSchema = {
    schema: createSchema({
      name: { type: "string", required: true, minLength: 1 },
      color: { type: "string", required: true, minLength: 1 }
    })
  };
  const patchSchema = {
    schema: createSchema({
      name: { type: "string", minLength: 1 },
      color: { type: "string", minLength: 1 }
    })
  };
  const resource = createResource({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema
  });
  const listTransportSchema = resource.list.schema.toJsonSchema({ mode: resource.list.mode });

  assert.equal(resource.record.mode, "replace");
  assert.equal(resource.create.mode, "create");
  assert.equal(resource.patch.mode, "patch");
  assert.equal(resource.list.mode, "replace");
  assert.equal(listTransportSchema.properties.items.items.type, "object");
});

test("createResource accepts explicit list schema override", () => {
  const recordSchema = {
    schema: createSchema({
      id: { type: "integer", required: true, min: 1 }
    })
  };
  const writeSchema = {
    schema: createSchema({
      id: { type: "integer", required: true, min: 1 }
    })
  };
  const patchSchema = {
    schema: createSchema({
      id: { type: "integer", min: 1 }
    })
  };
  const explicitListSchema = {
    schema: createSchema({
      rows: {
        type: "array",
        required: true,
        items: recordSchema.schema
      },
      meta: {
        type: "object",
        required: true,
        schema: createSchema({
          page: { type: "integer", required: true, min: 1 },
          pageSize: { type: "integer", required: true, min: 1 }
        })
      }
    }),
    mode: "replace"
  };

  const resource = createResource({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema,
    list: explicitListSchema
  });
  const listTransportSchema = resource.list.schema.toJsonSchema({ mode: resource.list.mode });

  assert.equal(resource.list.mode, "replace");
  assert.equal(listTransportSchema.properties.rows.type, "array");
  assert.equal(listTransportSchema.properties.meta.type, "object");
});
