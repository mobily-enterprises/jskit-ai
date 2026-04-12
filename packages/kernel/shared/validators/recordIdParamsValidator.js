import { Type } from "typebox";
import { normalizeObjectInput } from "./inputNormalization.js";
import { normalizePositiveInteger, normalizeRecordId } from "../support/normalize.js";

const RECORD_ID_PATTERN = "^[1-9][0-9]*$";

const recordIdSchema = Type.String({
  minLength: 1,
  pattern: RECORD_ID_PATTERN
});

const recordIdInputSchema = recordIdSchema;

const nullableRecordIdSchema = Type.Union([recordIdSchema, Type.Null()]);
const nullableRecordIdInputSchema = Type.Union([recordIdInputSchema, Type.Null()]);

const positiveIntegerValidator = Object.freeze({
  schema: Type.Union([
    Type.Integer({ minimum: 1 }),
    Type.String({ minLength: 1, pattern: RECORD_ID_PATTERN })
  ]),
  normalize(value) {
    return normalizePositiveInteger(value);
  }
});

const recordIdValidator = Object.freeze({
  schema: recordIdInputSchema,
  normalize(value) {
    return normalizeRecordId(value, {
      fallback: ""
    });
  }
});

const nullableRecordIdValidator = Object.freeze({
  schema: nullableRecordIdInputSchema,
  normalize(value) {
    return normalizeRecordId(value, {
      fallback: null
    });
  }
});

const recordIdParamsValidator = Object.freeze({
  schema: Type.Object(
    {
      recordId: Type.Optional(recordIdInputSchema)
    },
    { additionalProperties: false }
  ),
  normalize(input = {}) {
    const source = normalizeObjectInput(input);
    const normalized = {};

    if (Object.hasOwn(source, "recordId")) {
      normalized.recordId = recordIdValidator.normalize(source.recordId);
    }

    return normalized;
  }
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
