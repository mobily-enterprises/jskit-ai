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

const consoleSettingsOutputValidator = deepFreeze({
  schema: consoleSettingsOutputSchema,
  mode: "replace"
});

const consoleSettingsCreateBodyValidator = deepFreeze({
  schema: consoleSettingsBodySchema,
  mode: "create"
});

const consoleSettingsReplaceBodyValidator = deepFreeze({
  schema: consoleSettingsBodySchema,
  mode: "replace"
});

const consoleSettingsPatchBodyValidator = deepFreeze({
  schema: consoleSettingsPatchBodySchema,
  mode: "patch"
});

const CONSOLE_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const consoleSettingsResource = deepFreeze({
  namespace: "consoleSettings",
  operations: {
    view: {
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      output: consoleSettingsOutputValidator
    },
    list: {
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      output: createCursorListValidator(consoleSettingsOutputValidator)
    },
    create: {
      method: "POST",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: consoleSettingsCreateBodyValidator,
      output: consoleSettingsOutputValidator
    },
    replace: {
      method: "PUT",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: consoleSettingsReplaceBodyValidator,
      output: consoleSettingsOutputValidator
    },
    patch: {
      method: "PATCH",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      body: consoleSettingsPatchBodyValidator,
      output: consoleSettingsOutputValidator
    }
  }
});

export { consoleSettingsResource };
