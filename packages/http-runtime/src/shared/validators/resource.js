import { asSchema } from "./schemaUtils.js";
import { isJsonRestSchemaInstance, resolveValidatorTransportSchema } from "@jskit-ai/kernel/shared/validators";

function resolveTransportSchema(schema, { label = "schema", defaultMode = "replace" } = {}) {
  const normalized = asSchema(schema, label);
  return isJsonRestSchemaInstance(normalized)
    ? resolveValidatorTransportSchema({ schema: normalized, mode: defaultMode }, { defaultMode })
    : normalized;
}

function createCursorPagedListResponseSchema(itemSchema) {
  const normalizedItemSchema = resolveTransportSchema(itemSchema, {
    label: "itemSchema",
    defaultMode: "replace"
  });
  return {
    type: "object",
    additionalProperties: false,
    required: ["items", "nextCursor"],
    properties: {
      items: {
        type: "array",
        items: normalizedItemSchema
      },
      nextCursor: {
        anyOf: [
          { type: "string", minLength: 1 },
          { type: "null" }
        ]
      }
    }
  };
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
