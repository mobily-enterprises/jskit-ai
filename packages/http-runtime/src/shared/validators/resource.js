import { Type } from "@fastify/type-provider-typebox";
import { asSchema } from "./schemaUtils.js";

function createCursorPagedListResponseSchema(itemSchema) {
  const normalizedItemSchema = asSchema(itemSchema, "itemSchema");
  return Type.Object(
    {
      items: Type.Array(normalizedItemSchema),
      nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
    },
    { additionalProperties: false }
  );
}

function createResource({
  record,
  create,
  replace,
  patch,
  list = null,
  listItem = null
} = {}) {
  const normalizedRecordSchema = asSchema(record, "record");
  const normalizedCreateSchema = asSchema(create, "create");
  const normalizedReplaceSchema = asSchema(replace, "replace");
  const normalizedPatchSchema = asSchema(patch, "patch");
  const normalizedListItemSchema = listItem ? asSchema(listItem, "listItem") : normalizedRecordSchema;
  const normalizedListSchema = list ? asSchema(list, "list") : createCursorPagedListResponseSchema(normalizedListItemSchema);

  return Object.freeze({
    record: normalizedRecordSchema,
    create: normalizedCreateSchema,
    replace: normalizedReplaceSchema,
    patch: normalizedPatchSchema,
    listItem: normalizedListItemSchema,
    list: normalizedListSchema
  });
}

export {
  createCursorPagedListResponseSchema,
  createResource
};
