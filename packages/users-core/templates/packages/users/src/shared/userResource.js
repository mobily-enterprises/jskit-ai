import { createSchema } from "json-rest-schema";
import {
  createCursorListValidator,
  RECORD_ID_PATTERN
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const recordOutputSchema = createSchema({
  id: {
    type: "string",
    required: true,
    minLength: 1,
    pattern: RECORD_ID_PATTERN
  },
  name: {
    type: "string",
    required: false,
    minLength: 1,
    actualField: "display_name"
  },
  email: {
    type: "string",
    required: false
  },
  username: {
    type: "string",
    required: false
  },
  createdAt: {
    type: "dateTime",
    required: true
  }
});

const createBodySchema = createSchema({});

const recordOutputValidator = deepFreeze({
  schema: recordOutputSchema,
  mode: "replace"
});

const createBodyValidator = deepFreeze({
  schema: createBodySchema,
  mode: "create"
});

const resource = deepFreeze({
  namespace: "users",
  tableName: "users",
  idColumn: "id",
  operations: {
    list: {
      method: "GET",
      output: createCursorListValidator(recordOutputValidator)
    },
    view: {
      method: "GET",
      output: recordOutputValidator
    },
    create: {
      method: "POST",
      body: createBodyValidator,
      output: recordOutputValidator
    }
  }
});

export { resource };
