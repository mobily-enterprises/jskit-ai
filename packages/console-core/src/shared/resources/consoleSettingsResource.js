import { createSchema } from "json-rest-schema";
import { createOperationMessages } from "../operationMessages.js";
import {
  createCursorListValidator
} from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const consoleSettingsBodySchema = createSchema({});
const consoleSettingsPatchBodySchema = createSchema({});
const consoleSettingsOutputSchema = createSchema({
  settings: {
    type: "object",
    required: true,
    schema: createSchema({})
  }
});

const consoleSettingsOutputDefinition = deepFreeze({
  schema: consoleSettingsOutputSchema,
  mode: "replace"
});

const CONSOLE_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const consoleSettingsResource = deepFreeze({
  namespace: "consoleSettings",
  operations: {
    view: {
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      output: consoleSettingsOutputDefinition
    },
    list: {
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      output: createCursorListValidator(consoleSettingsOutputDefinition)
    },
    create: {
      method: "POST",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: consoleSettingsBodySchema,
        mode: "create"
      },
      output: consoleSettingsOutputDefinition
    },
    replace: {
      method: "PUT",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: consoleSettingsBodySchema,
        mode: "replace"
      },
      output: consoleSettingsOutputDefinition
    },
    patch: {
      method: "PATCH",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: {
        schema: consoleSettingsPatchBodySchema,
        mode: "patch"
      },
      output: consoleSettingsOutputDefinition
    }
  }
});

export { consoleSettingsResource };
