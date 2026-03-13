import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import {
  createCursorPagedListResponseSchema,
  createResource
} from "../src/shared/validators/resource.js";

test("createCursorPagedListResponseSchema builds items + nextCursor schema", () => {
  const itemSchema = Type.Object(
    {
      id: Type.Integer({ minimum: 1 })
    },
    { additionalProperties: false }
  );
  const listSchema = createCursorPagedListResponseSchema(itemSchema);

  assert.equal(listSchema.type, "object");
  assert.equal(listSchema.additionalProperties, false);
  assert.equal(listSchema.properties.items.type, "array");
  assert.equal(listSchema.properties.nextCursor.anyOf.length, 2);
});

test("createResource requires record/create/replace/patch schemas", () => {
  assert.throws(
    () => createResource({}),
    /record must be a TypeBox schema object/
  );
});

test("createResource builds default list schema from record/listItem", () => {
  const recordSchema = Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      name: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  );
  const writeSchema = Type.Object(
    {
      name: Type.String({ minLength: 1 }),
      color: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  );
  const patchSchema = Type.Partial(writeSchema, { additionalProperties: false });
  const resource = createResource({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema
  });

  assert.equal(resource.list.properties.items.items.type, "object");
});

test("createResource accepts explicit list schema override", () => {
  const recordSchema = Type.Object(
    {
      id: Type.Integer({ minimum: 1 })
    },
    { additionalProperties: false }
  );
  const writeSchema = Type.Object(
    {
      id: Type.Integer({ minimum: 1 })
    },
    { additionalProperties: false }
  );
  const patchSchema = Type.Partial(writeSchema, { additionalProperties: false });
  const explicitListSchema = Type.Object(
    {
      rows: Type.Array(recordSchema),
      meta: Type.Object(
        {
          page: Type.Integer({ minimum: 1 }),
          pageSize: Type.Integer({ minimum: 1 })
        },
        { additionalProperties: false }
      )
    },
    { additionalProperties: false }
  );

  const resource = createResource({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema,
    list: explicitListSchema
  });

  assert.equal(resource.list, explicitListSchema);
});
