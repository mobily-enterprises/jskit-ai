import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import {
  createCursorPagedListResponseSchema,
  createResource
} from "../src/shared/validators/resource.js";

test("createCursorPagedListResponseSchema builds items + nextCursor schema", () => {
  const itemSchema = createSchema({
    id: { type: "integer", required: true, min: 1 }
  });
  const listSchema = createCursorPagedListResponseSchema(itemSchema);

  assert.equal(listSchema.type, "object");
  assert.equal(listSchema.additionalProperties, false);
  assert.equal(listSchema.properties.items.type, "array");
  assert.equal(listSchema.properties.nextCursor.anyOf.length, 2);
});

test("createResource requires record/create/replace/patch schemas", () => {
  assert.throws(
    () => createResource({}),
    /record must be a schema object/
  );
});

test("createResource builds default list schema from record/listItem", () => {
  const recordSchema = createSchema({
    id: { type: "integer", required: true, min: 1 },
    name: { type: "string", required: true, minLength: 1 }
  });
  const writeSchema = createSchema({
    name: { type: "string", required: true, minLength: 1 },
    color: { type: "string", required: true, minLength: 1 }
  });
  const patchSchema = createSchema({
    name: { type: "string", minLength: 1 },
    color: { type: "string", minLength: 1 }
  });
  const resource = createResource({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema
  });

  assert.equal(resource.list.properties.items.items.type, "object");
});

test("createResource accepts explicit list schema override", () => {
  const recordSchema = createSchema({
    id: { type: "integer", required: true, min: 1 }
  });
  const writeSchema = createSchema({
    id: { type: "integer", required: true, min: 1 }
  });
  const patchSchema = createSchema({
    id: { type: "integer", min: 1 }
  });
  const explicitListSchema = {
    type: "object",
    additionalProperties: false,
    required: ["rows", "meta"],
    properties: {
      rows: {
        type: "array",
        items: recordSchema.toJsonSchema({ mode: "replace" })
      },
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["page", "pageSize"],
        properties: {
          page: { type: "integer", minimum: 1 },
          pageSize: { type: "integer", minimum: 1 }
        }
      }
    }
  };

  const resource = createResource({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema,
    list: explicitListSchema
  });

  assert.equal(resource.list, explicitListSchema);
});
