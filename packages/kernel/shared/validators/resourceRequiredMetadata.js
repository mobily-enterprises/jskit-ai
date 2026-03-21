import { normalizeUniqueTextList } from "../support/normalize.js";

function normalizeRequiredFieldList(value) {
  return Object.freeze(normalizeUniqueTextList(value));
}

function deriveRequiredFieldsFromSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return Object.freeze([]);
  }

  return normalizeRequiredFieldList(schema.required);
}

function deriveResourceRequiredMetadata(resourceSchema) {
  const operations = resourceSchema && typeof resourceSchema === "object"
    ? resourceSchema.operations
    : null;

  const createSchema = operations?.create?.bodyValidator?.schema;
  const replaceSchema = operations?.replace?.bodyValidator?.schema;
  const patchSchema = operations?.patch?.bodyValidator?.schema;

  return Object.freeze({
    create: deriveRequiredFieldsFromSchema(createSchema),
    replace: deriveRequiredFieldsFromSchema(replaceSchema),
    patch: deriveRequiredFieldsFromSchema(patchSchema)
  });
}

export {
  normalizeRequiredFieldList,
  deriveRequiredFieldsFromSchema,
  deriveResourceRequiredMetadata
};
