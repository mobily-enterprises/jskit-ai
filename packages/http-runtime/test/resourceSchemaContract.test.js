import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "@fastify/type-provider-typebox";
import {
  createCursorPagedListResponseSchema,
  createResourceSchemaContract
} from "../src/shared/contracts/resourceSchemaContract.js";

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

test("createResourceSchemaContract requires record/create/replace/patch schemas", () => {
  assert.throws(
    () => createResourceSchemaContract({}),
    /record must be a TypeBox schema object/
  );
});

test("createResourceSchemaContract builds default list schema from record/listItem", () => {
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
  const contract = createResourceSchemaContract({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema
  });

  assert.equal(contract.list.properties.items.items.type, "object");
});

test("createResourceSchemaContract accepts explicit list schema override", () => {
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

  const contract = createResourceSchemaContract({
    record: recordSchema,
    create: writeSchema,
    replace: writeSchema,
    patch: patchSchema,
    list: explicitListSchema
  });

  assert.equal(contract.list, explicitListSchema);
});
