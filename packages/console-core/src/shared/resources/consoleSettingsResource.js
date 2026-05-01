import { createSchema } from "json-rest-schema";
import { defineCrudResource } from "@jskit-ai/resource-crud-core/shared/crudResource";
import { createOperationMessages } from "../operationMessages.js";

const consoleSettingsBodySchema = createSchema({});
const consoleSettingsOutputSchema = createSchema({
  settings: {
    type: "object",
    required: true,
    schema: createSchema({})
  }
});

const consoleSettingsResource = defineCrudResource({
  namespace: "consoleSettings",
  messages: createOperationMessages(),
  crudOperations: ["view", "list", "create", "replace", "patch"],
  crud: {
    output: consoleSettingsOutputSchema,
    body: consoleSettingsBodySchema
  }
});

export { consoleSettingsResource };
