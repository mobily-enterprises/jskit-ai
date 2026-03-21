import { Type } from "typebox";
import {
  normalizeObjectInput,
  normalizeSettingsFieldInput,
  normalizeSettingsFieldOutput
} from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

const MAX_SYSTEM_PROMPT_CHARS = 12_000;

function createPromptSchema(promptLabel) {
  return Type.String({
    maxLength: MAX_SYSTEM_PROMPT_CHARS,
    messages: {
      maxLength: `${promptLabel} must be at most ${MAX_SYSTEM_PROMPT_CHARS} characters.`,
      default: `${promptLabel} must be valid text.`
    }
  });
}

function createPromptSettingsResource({
  resourceId = "",
  fields = [],
  validationMessage = "Fix invalid values and try again.",
  saveSuccessMessage = "Saved.",
  saveErrorMessage = "Unable to save settings."
} = {}) {
  const settingsOutputProperties = {};
  const settingsCreateProperties = {};
  for (const field of fields) {
    settingsOutputProperties[field.key] = field.outputSchema;
    settingsCreateProperties[field.key] =
      field.required === false ? Type.Optional(field.inputSchema) : field.inputSchema;
  }

  const settingsOutputSchema = Type.Object(settingsOutputProperties, { additionalProperties: false });
  const settingsCreateSchema = Type.Object(settingsCreateProperties, { additionalProperties: false });
  const settingsPatchSchema = Type.Partial(settingsCreateSchema, {
    additionalProperties: false
  });
  const recordSchema = Type.Object(
    {
      settings: settingsOutputSchema
    },
    { additionalProperties: false }
  );

  function normalizeInput(payload = {}) {
    return normalizeSettingsFieldInput(payload, fields);
  }

  function normalizeOutput(payload = {}) {
    const source = normalizeObjectInput(payload);
    const settingsSource = normalizeObjectInput(source.settings);
    return {
      settings: normalizeSettingsFieldOutput(settingsSource, fields)
    };
  }

  const outputValidator = Object.freeze({
    schema: recordSchema,
    normalize: normalizeOutput
  });

  return Object.freeze({
    resource: resourceId,
    messages: {
      validation: validationMessage,
      saveSuccess: saveSuccessMessage,
      saveError: saveErrorMessage
    },
    operations: Object.freeze({
      view: Object.freeze({
        method: "GET",
        outputValidator
      }),
      create: Object.freeze({
        method: "POST",
        bodyValidator: Object.freeze({
          schema: settingsCreateSchema,
          normalize: normalizeInput
        }),
        outputValidator
      }),
      replace: Object.freeze({
        method: "PUT",
        bodyValidator: Object.freeze({
          schema: settingsCreateSchema,
          normalize: normalizeInput
        }),
        outputValidator
      }),
      patch: Object.freeze({
        method: "PATCH",
        bodyValidator: Object.freeze({
          schema: settingsPatchSchema,
          normalize: normalizeInput
        }),
        outputValidator
      })
    })
  });
}

function createFieldRegistry(scopeLabel) {
  const fields = [];

  function defineField(field = {}) {
    const key = normalizeText(field.key);
    if (!key) {
      throw new TypeError(`${scopeLabel}.defineField requires field.key.`);
    }
    if (fields.some((entry) => entry.key === key)) {
      throw new Error(`${scopeLabel}.defineField duplicate key: ${key}`);
    }
    if (!field.inputSchema || typeof field.inputSchema !== "object") {
      throw new TypeError(`${scopeLabel}.defineField("${key}") requires inputSchema.`);
    }
    if (!field.outputSchema || typeof field.outputSchema !== "object") {
      throw new TypeError(`${scopeLabel}.defineField("${key}") requires outputSchema.`);
    }
    if (typeof field.normalizeInput !== "function") {
      throw new TypeError(`${scopeLabel}.defineField("${key}") requires normalizeInput.`);
    }
    if (typeof field.normalizeOutput !== "function") {
      throw new TypeError(`${scopeLabel}.defineField("${key}") requires normalizeOutput.`);
    }
    if (typeof field.resolveDefault !== "function") {
      throw new TypeError(`${scopeLabel}.defineField("${key}") requires resolveDefault.`);
    }

    fields.push({
      key,
      required: field.required !== false,
      inputSchema: field.inputSchema,
      outputSchema: field.outputSchema,
      normalizeInput: field.normalizeInput,
      normalizeOutput: field.normalizeOutput,
      resolveDefault: field.resolveDefault
    });
  }

  return {
    fields,
    defineField
  };
}

const assistantConsoleSettingsFields = (() => {
  const registry = createFieldRegistry("assistantConsoleSettingsFields");
  const { fields, defineField } = registry;
  defineField({
    key: "workspaceSurfacePrompt",
    required: true,
    inputSchema: createPromptSchema("Workspace surface system prompt"),
    outputSchema: Type.String({ maxLength: MAX_SYSTEM_PROMPT_CHARS }),
    normalizeInput: (value) => String(value || ""),
    normalizeOutput: (value) => String(value || ""),
    resolveDefault: () => ""
  });
  return fields;
})();

const assistantWorkspaceSettingsFields = (() => {
  const registry = createFieldRegistry("assistantWorkspaceSettingsFields");
  const { fields, defineField } = registry;
  defineField({
    key: "appSurfacePrompt",
    required: true,
    inputSchema: createPromptSchema("App surface system prompt"),
    outputSchema: Type.String({ maxLength: MAX_SYSTEM_PROMPT_CHARS }),
    normalizeInput: (value) => String(value || ""),
    normalizeOutput: (value) => String(value || ""),
    resolveDefault: () => ""
  });
  return fields;
})();

const assistantConsoleSettingsResource = createPromptSettingsResource({
  resourceId: "assistantConsoleSettings",
  fields: assistantConsoleSettingsFields,
  saveSuccessMessage: "Assistant console settings updated.",
  saveErrorMessage: "Unable to update assistant console settings."
});

const assistantWorkspaceSettingsResource = createPromptSettingsResource({
  resourceId: "assistantWorkspaceSettings",
  fields: assistantWorkspaceSettingsFields,
  saveSuccessMessage: "Assistant workspace settings updated.",
  saveErrorMessage: "Unable to update assistant workspace settings."
});

export {
  MAX_SYSTEM_PROMPT_CHARS,
  assistantConsoleSettingsResource,
  assistantWorkspaceSettingsResource
};
