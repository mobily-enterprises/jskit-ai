import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";

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
  promptKey = "",
  promptLabel = "System prompt",
  validationMessage = "Fix invalid values and try again.",
  saveSuccessMessage = "Saved.",
  saveErrorMessage = "Unable to save settings."
} = {}) {
  const promptSchema = createPromptSchema(promptLabel);
  const settingsSchema = Type.Object(
    {
      [promptKey]: promptSchema
    },
    { additionalProperties: false }
  );
  const recordSchema = Type.Object(
    {
      settings: settingsSchema
    },
    { additionalProperties: false }
  );
  const createSchema = Type.Object(
    {
      [promptKey]: promptSchema
    },
    { additionalProperties: false }
  );
  const patchSchema = Type.Partial(createSchema, {
    additionalProperties: false
  });

  function normalizeOutput(payload = {}) {
    const source = normalizeObjectInput(payload);
    const settingsSource = normalizeObjectInput(source.settings);

    return {
      settings: {
        [promptKey]: String(settingsSource[promptKey] || "")
      }
    };
  }

  function normalizeInput(payload = {}) {
    const source = normalizeObjectInput(payload);
    const normalized = {};
    if (Object.hasOwn(source, promptKey)) {
      normalized[promptKey] = String(source[promptKey] || "");
    }
    return normalized;
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
          schema: createSchema,
          normalize: normalizeInput
        }),
        outputValidator
      }),
      replace: Object.freeze({
        method: "PUT",
        bodyValidator: Object.freeze({
          schema: createSchema,
          normalize: normalizeInput
        }),
        outputValidator
      }),
      patch: Object.freeze({
        method: "PATCH",
        bodyValidator: Object.freeze({
          schema: patchSchema,
          normalize: normalizeInput
        }),
        outputValidator
      })
    })
  });
}

const assistantConsoleSettingsResource = createPromptSettingsResource({
  resourceId: "assistantConsoleSettings",
  promptKey: "workspaceSurfacePrompt",
  promptLabel: "Workspace surface system prompt",
  saveSuccessMessage: "Assistant console settings updated.",
  saveErrorMessage: "Unable to update assistant console settings."
});

const assistantWorkspaceSettingsResource = createPromptSettingsResource({
  resourceId: "assistantWorkspaceSettings",
  promptKey: "appSurfacePrompt",
  promptLabel: "App surface system prompt",
  saveSuccessMessage: "Assistant workspace settings updated.",
  saveErrorMessage: "Unable to update assistant workspace settings."
});

export {
  MAX_SYSTEM_PROMPT_CHARS,
  assistantConsoleSettingsResource,
  assistantWorkspaceSettingsResource
};
