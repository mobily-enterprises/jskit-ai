import { asSchemaDefinition } from "./schemaUtils.js";
import { createCursorListValidator } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

function createCursorPagedListResponseSchema(itemSchema) {
  return createCursorListValidator(itemSchema);
}

function createResource({
  record,
  create,
  replace,
  patch,
  list = null,
  listItem = null
} = {}) {
  const normalizedRecordSchema = asSchemaDefinition(record, "record", "replace");
  const normalizedCreateSchema = asSchemaDefinition(create, "create", "create");
  const normalizedReplaceSchema = asSchemaDefinition(replace, "replace", "replace");
  const normalizedPatchSchema = asSchemaDefinition(patch, "patch", "patch");
  const normalizedListItemSchema = listItem
    ? asSchemaDefinition(listItem, "listItem", "replace")
    : normalizedRecordSchema;
  const normalizedListSchema = list
    ? asSchemaDefinition(list, "list", "replace")
    : createCursorPagedListResponseSchema(normalizedListItemSchema);

  return deepFreeze({
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
