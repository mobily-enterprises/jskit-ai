import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { createSchema } from "json-rest-schema";

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

export { statusQueryInputValidator };
