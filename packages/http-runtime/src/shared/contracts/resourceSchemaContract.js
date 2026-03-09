import { Type } from "@fastify/type-provider-typebox";

function asSchema(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a TypeBox schema object.`);
  }
  return value;
}

function normalizeRequiredList(value) {
  if (!Array.isArray(value)) {
    return Object.freeze([]);
  }

  const normalized = value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  return Object.freeze(Array.from(new Set(normalized)));
}

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

function createResourceSchemaContract({
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
    list: normalizedListSchema,
    required: Object.freeze({
      create: normalizeRequiredList(normalizedCreateSchema.required),
      replace: normalizeRequiredList(normalizedReplaceSchema.required),
      patch: normalizeRequiredList(normalizedPatchSchema.required)
    })
  });
}

export {
  createCursorPagedListResponseSchema,
  createResourceSchemaContract
};
