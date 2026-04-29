import { createSchema } from "json-rest-schema";
import { normalizePositiveInteger, normalizeRecordId } from "../support/normalize.js";

const RECORD_ID_PATTERN = "^[1-9][0-9]*$";

const recordIdSchema = Object.freeze({
  type: "string",
  minLength: 1,
  pattern: RECORD_ID_PATTERN
});

const recordIdInputSchema = recordIdSchema;

const nullableRecordIdSchema = Object.freeze({
  ...recordIdSchema,
  nullable: true
});
const nullableRecordIdInputSchema = nullableRecordIdSchema;

const positiveIntegerValidator = Object.freeze({
  schema: {
    anyOf: [
      {
        type: "integer",
        minimum: 1
      },
      {
        type: "string",
        minLength: 1,
        pattern: RECORD_ID_PATTERN
      }
    ]
  },
  parse(value) {
    return normalizePositiveInteger(value);
  }
});

function validateCanonicalRecordId(value) {
  return new RegExp(RECORD_ID_PATTERN).test(value)
    ? undefined
    : "Record id must be a canonical positive integer string.";
}

const recordIdParamSchema = createSchema({
  recordId: {
    type: "string",
    validator: validateCanonicalRecordId
  }
});

const recordIdValidator = Object.freeze({
  parse(value) {
    const normalized = normalizeRecordId(value, {
      fallback: ""
    });
    if (!normalized) {
      throw new Error("Record id must be a canonical positive integer string.");
    }
    return normalized;
  }
});

const nullableRecordIdValidator = Object.freeze({
  parse(value) {
    return normalizeRecordId(value, {
      fallback: null
    });
  }
});

const recordIdParamsValidator = Object.freeze({
  schema: recordIdParamSchema,
  mode: "patch"
});

export {
  RECORD_ID_PATTERN,
  recordIdSchema,
  recordIdInputSchema,
  nullableRecordIdSchema,
  nullableRecordIdInputSchema,
  recordIdValidator,
  nullableRecordIdValidator,
  recordIdParamsValidator,
  positiveIntegerValidator
};
