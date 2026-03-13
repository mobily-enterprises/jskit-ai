import { Type } from "typebox";
import { normalizeObjectInput } from "./inputNormalization.js";
import { normalizeText } from "../support/normalize.js";

const positiveIntegerInputSchema = Type.Union([
  Type.Integer({ minimum: 1 }),
  Type.String({ minLength: 1, pattern: "^[1-9][0-9]*$" })
]);

function toPositiveInteger(value) {
  const normalized = normalizeText(value);
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

const recordIdParamsValidator = Object.freeze({
  schema: Type.Object(
    {
      recordId: Type.Optional(positiveIntegerInputSchema)
    },
    { additionalProperties: false }
  ),
  normalize(input = {}) {
    const source = normalizeObjectInput(input);
    const normalized = {};

    if (Object.hasOwn(source, "recordId")) {
      normalized.recordId = toPositiveInteger(source.recordId);
    }

    return normalized;
  }
});

export { recordIdParamsValidator, positiveIntegerInputSchema, toPositiveInteger };
