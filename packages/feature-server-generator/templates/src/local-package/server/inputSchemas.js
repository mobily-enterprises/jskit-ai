import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const statusQueryInputValidator = deepFreeze({
  schema: createSchema({
    scope: {
      type: "string",
      required: false,
      minLength: 1
    },
    verbose: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
});

const executeCommandInputValidator = deepFreeze({
  schema: createSchema({
    command: {
      type: "string",
      required: true,
      minLength: 1
    },
    payload: {
      type: "object",
      required: false,
      additionalProperties: true
    }
  }),
  mode: "patch"
});

export {
  statusQueryInputValidator,
  executeCommandInputValidator
};
