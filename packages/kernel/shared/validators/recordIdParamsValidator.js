import { createSchema } from "json-rest-schema";
import { deepFreeze } from "../support/deepFreeze.js";

const RECORD_ID_PATTERN = "^[1-9][0-9]*$";

const recordIdSchema = deepFreeze({
  type: "string",
  minLength: 1,
  pattern: RECORD_ID_PATTERN
});

const recordIdInputSchema = recordIdSchema;

const nullableRecordIdSchema = deepFreeze({
  ...recordIdSchema,
  nullable: true
});

const nullableRecordIdInputSchema = nullableRecordIdSchema;

const recordIdParamsValidator = deepFreeze({
  schema: createSchema({
    recordId: {
      ...recordIdSchema,
      required: true,
      messages: {
        pattern: "Record id must be a canonical positive integer string."
      }
    }
  }),
  mode: "patch"
});

export {
  RECORD_ID_PATTERN,
  recordIdSchema,
  recordIdInputSchema,
  nullableRecordIdSchema,
  nullableRecordIdInputSchema,
  recordIdParamsValidator
};
