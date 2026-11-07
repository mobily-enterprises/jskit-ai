import { createSchema } from "json-rest-schema";
import { defineApiContract } from "@jskit-ai/resource-core/shared/apiContract";
import { OPERATION_MESSAGES } from "../operationMessages.js";

const consoleSettingsBodySchema = createSchema({});
const consoleSettingsOutputSchema = createSchema({
  settings: {
    type: "object",
    required: true,
    schema: createSchema({})
  }
});

// The console settings over HTTP: read them, and replace them whole.
const consoleSettingsContract = defineApiContract({
  namespace: "consoleSettings",
  messages: OPERATION_MESSAGES,
  operations: {
    view: {
      method: "GET",
      output: consoleSettingsOutputSchema
    },
    replace: {
      method: "PUT",
      body: consoleSettingsBodySchema,
      output: consoleSettingsOutputSchema
    }
  }
});

export { consoleSettingsContract };
