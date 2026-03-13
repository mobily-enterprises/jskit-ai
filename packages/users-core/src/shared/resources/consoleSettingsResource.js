import { Type } from "typebox";
import { createOperationMessages } from "../operationMessages.js";
import {
  createCursorListValidator,
  normalizeObjectInput
} from "@jskit-ai/kernel/shared/validators";

const consoleSettingsValueSchema = Type.Object(
  {
    assistantSystemPromptWorkspace: Type.String()
  },
  { additionalProperties: false }
);

const consoleSettingsRecordSchema = Type.Object(
  {
    settings: consoleSettingsValueSchema
  },
  { additionalProperties: false }
);

const consoleSettingsCreateSchema = Type.Object(
  {
    assistantSystemPromptWorkspace: Type.String()
  },
  { additionalProperties: false }
);

const consoleSettingsReplaceSchema = consoleSettingsCreateSchema;
const consoleSettingsPatchSchema = Type.Partial(consoleSettingsCreateSchema, {
  additionalProperties: false
});

const consoleSettingsOutputValidator = Object.freeze({
  schema: consoleSettingsRecordSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const settingsSource = normalizeObjectInput(source.settings);

    return {
      settings: {
        assistantSystemPromptWorkspace: String(settingsSource.assistantSystemPromptWorkspace || "")
      }
    };
  }
});

const CONSOLE_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const consoleSettingsResource = Object.freeze({
  resource: "consoleSettings",
  operations: Object.freeze({
    view: Object.freeze({
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      outputValidator: consoleSettingsOutputValidator
    }),
    list: Object.freeze({
      method: "GET",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      outputValidator: createCursorListValidator(consoleSettingsOutputValidator)
    }),
    create: Object.freeze({
      method: "POST",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: consoleSettingsCreateSchema,
        normalize: normalizeObjectInput
      }),
      outputValidator: consoleSettingsOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: consoleSettingsReplaceSchema,
        normalize: normalizeObjectInput
      }),
      outputValidator: consoleSettingsOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: consoleSettingsPatchSchema,
        normalize: normalizeObjectInput
      }),
      outputValidator: consoleSettingsOutputValidator
    })
  })
});

export { consoleSettingsResource };
