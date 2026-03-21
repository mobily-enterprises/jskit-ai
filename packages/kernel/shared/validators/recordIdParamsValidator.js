import { Type } from "typebox";
import { normalizeObjectInput } from "./inputNormalization.js";
import { normalizePositiveInteger, normalizeText } from "../support/normalize.js";

function normalizeRecordId(value) {
  return normalizePositiveInteger(normalizeText(value));
}

const positiveIntegerValidator = Object.freeze({
  schema: Type.Union([
    Type.Integer({ minimum: 1 }),
    Type.String({ minLength: 1, pattern: "^[1-9][0-9]*$" })
  ]),
  normalize: normalizeRecordId
});

const recordIdParamsValidator = Object.freeze({
  schema: Type.Object(
    {
      recordId: Type.Optional(positiveIntegerValidator.schema)
    },
    { additionalProperties: false }
  ),
  normalize(input = {}) {
    const source = normalizeObjectInput(input);
    const normalized = {};

    if (Object.hasOwn(source, "recordId")) {
      normalized.recordId = normalizeRecordId(source.recordId);
    }

    return normalized;
  }
});

export { recordIdParamsValidator, positiveIntegerValidator };
