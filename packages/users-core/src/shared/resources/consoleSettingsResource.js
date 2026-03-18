import { Type } from "typebox";
import { createOperationMessages } from "../operationMessages.js";
import {
  createCursorListValidator,
  normalizeObjectInput
} from "@jskit-ai/kernel/shared/validators";
import { consoleSettingsFields } from "./consoleSettingsFields.js";

function buildCreateSchema() {
  const properties = {};
  for (const field of consoleSettingsFields) {
    properties[field.key] = field.required === false ? Type.Optional(field.inputSchema) : field.inputSchema;
  }
  return Type.Object(properties, { additionalProperties: false });
}

function buildOutputSchema() {
  const properties = {};
  for (const field of consoleSettingsFields) {
    properties[field.key] = field.outputSchema;
  }
  return Type.Object(properties, { additionalProperties: false });
}

const consoleSettingsValueSchema = buildOutputSchema();

const consoleSettingsRecordSchema = Type.Object(
  {
    settings: consoleSettingsValueSchema
  },
  { additionalProperties: false }
);

const consoleSettingsCreateSchema = buildCreateSchema();

const consoleSettingsReplaceSchema = consoleSettingsCreateSchema;
const consoleSettingsPatchSchema = Type.Partial(consoleSettingsCreateSchema, {
  additionalProperties: false
});

function normalizeConsoleSettingsInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};
  for (const field of consoleSettingsFields) {
    if (!Object.hasOwn(source, field.key)) {
      continue;
    }
    normalized[field.key] = field.normalizeInput(source[field.key], {
      payload: source
    });
  }
  return normalized;
}

const consoleSettingsOutputValidator = Object.freeze({
  schema: consoleSettingsRecordSchema,
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const settingsSource = normalizeObjectInput(source.settings);
    const settings = {};

    for (const field of consoleSettingsFields) {
      const rawValue = Object.hasOwn(settingsSource, field.key)
        ? settingsSource[field.key]
        : field.resolveDefault({
            settings: settingsSource
          });
      settings[field.key] = field.normalizeOutput(rawValue, {
        settings: settingsSource
      });
    }

    return {
      settings
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
        normalize: normalizeConsoleSettingsInput
      }),
      outputValidator: consoleSettingsOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: consoleSettingsReplaceSchema,
        normalize: normalizeConsoleSettingsInput
      }),
      outputValidator: consoleSettingsOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        schema: consoleSettingsPatchSchema,
        normalize: normalizeConsoleSettingsInput
      }),
      outputValidator: consoleSettingsOutputValidator
    })
  })
});

export { consoleSettingsResource };
