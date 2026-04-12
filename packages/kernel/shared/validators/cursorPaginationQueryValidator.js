import { Type } from "typebox";
import { normalizeObjectInput } from "./inputNormalization.js";
import { positiveIntegerValidator, recordIdInputSchema, recordIdValidator } from "./recordIdParamsValidator.js";

function normalizeCursorPaginationQuery(input = {}) {
  const source = normalizeObjectInput(input);
  const normalized = {};

  if (Object.hasOwn(source, "cursor")) {
    normalized.cursor = recordIdValidator.normalize(source.cursor);
  }

  if (Object.hasOwn(source, "limit")) {
    normalized.limit = positiveIntegerValidator.normalize(source.limit);
  }

  return normalized;
}

const cursorPaginationQueryValidator = Object.freeze({
  schema: Type.Object(
    {
      cursor: Type.Optional(recordIdInputSchema),
      limit: Type.Optional(positiveIntegerValidator.schema)
    },
    { additionalProperties: false }
  ),
  normalize: normalizeCursorPaginationQuery
});

export {
  cursorPaginationQueryValidator
};
