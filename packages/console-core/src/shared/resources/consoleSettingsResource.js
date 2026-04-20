import { Type } from "typebox";
import { createOperationMessages } from "../operationMessages.js";
import {
  createCursorListValidator,
  normalizeObjectInput,
  normalizeSettingsFieldInput,
  normalizeSettingsFieldOutput
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

function buildConsoleSettingsRecordSchema() {
  return Type.Object(
    {
      settings: buildOutputSchema()
    },
    { additionalProperties: false }
  );
}

function buildConsoleSettingsCreateSchema() {
  return buildCreateSchema();
}

function buildConsoleSettingsReplaceSchema() {
  return buildConsoleSettingsCreateSchema();
}

function buildConsoleSettingsPatchSchema() {
  return Type.Partial(buildConsoleSettingsCreateSchema(), {
    additionalProperties: false
  });
}

function normalizeConsoleSettingsInput(payload = {}) {
  return normalizeSettingsFieldInput(payload, consoleSettingsFields);
}

const consoleSettingsOutputValidator = Object.freeze({
  get schema() {
    return buildConsoleSettingsRecordSchema();
  },
  normalize(payload = {}) {
    const source = normalizeObjectInput(payload);
    const settingsSource = normalizeObjectInput(source.settings);

    return {
      settings: normalizeSettingsFieldOutput(settingsSource, consoleSettingsFields)
    };
  }
});

const CONSOLE_SETTINGS_OPERATION_MESSAGES = createOperationMessages();

const consoleSettingsResource = Object.freeze({
  namespace: "consoleSettings",
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
        get schema() {
          return buildConsoleSettingsCreateSchema();
        },
        normalize: normalizeConsoleSettingsInput
      }),
      outputValidator: consoleSettingsOutputValidator
    }),
    replace: Object.freeze({
      method: "PUT",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        get schema() {
          return buildConsoleSettingsReplaceSchema();
        },
        normalize: normalizeConsoleSettingsInput
      }),
      outputValidator: consoleSettingsOutputValidator
    }),
    patch: Object.freeze({
      method: "PATCH",
      messages: CONSOLE_SETTINGS_OPERATION_MESSAGES,
      bodyValidator: Object.freeze({
        get schema() {
          return buildConsoleSettingsPatchSchema();
        },
        normalize: normalizeConsoleSettingsInput
      }),
      outputValidator: consoleSettingsOutputValidator
    })
  })
});

export { consoleSettingsResource };
