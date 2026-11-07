import { createSchema } from "json-rest-schema";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { assistantConfigContract } from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantTargetSurfaceInputValidator } from "./inputSchemas.js";

/** @typedef {import("./types.js").AssistantConfigService} AssistantConfigService */

const settingsReadInputValidator = deepFreeze({ schema: assistantTargetSurfaceInputValidator.schema });

const settingsUpdatePatchInputValidator = deepFreeze({
  schema: createSchema({
    patch: {
      type: "object",
      required: true,
      schema: assistantConfigContract.operations.patch.body.schema
    }
  }),
  mode: "patch"
});

const settingsUpdateInputValidator = composeSchemaDefinitions(
  [assistantTargetSurfaceInputValidator, settingsUpdatePatchInputValidator],
  {
    mode: "patch",
    context: "assistant-runtime settings update action input"
  }
);

/**
 * The JSON:API document of a surface's assistant settings, with whether the reader may change them (`canUpdate`).
 * @param {AssistantConfigService} assistantConfigService
 * @param {object} input
 * @param {object} context
 */
async function readSettingsDocument(assistantConfigService, input, context) {
  const settings = await assistantConfigService.getSettings(input, {
    context
  });
  const canUpdate = await assistantConfigService.canUpdateSettings(input, {
    context
  });
  return returnJsonApiData({ ...settings, canUpdate });
}

/**
 * The JSON:API document of a surface's assistant settings after the input's patch, which only someone who may change
 * them gets.
 * @param {AssistantConfigService} assistantConfigService
 * @param {object} input
 * @param {object} context
 */
async function updateSettingsDocument(assistantConfigService, input, context) {
  return returnJsonApiData({
    ...(await assistantConfigService.updateSettings(input, input.patch, {
      context
    })),
    canUpdate: true
  });
}

/**
 * The settings actions of the assistant surfaces' settings screens.
 * @param {object} dependencies
 * @param {AssistantConfigService} dependencies.assistantConfigService
 * @param {string[]} dependencies.settingsSurfaces
 */
function createAssistantSettingsActions({ assistantConfigService, settingsSurfaces }) {
  return Object.freeze([
    Object.freeze({
      id: actionIds.settingsRead,
      version: 1,
      kind: "query",
      channels: ["api", "automation", "internal"],
      surfaces: settingsSurfaces,
      permission: {
        require: "authenticated"
      },
      input: settingsReadInputValidator,
      output: null,
      extensions: {
        assistant: {
          exclude: "Assistant self-configuration is disabled; use the authenticated assistant settings screen."
        }
      },
      execute: (input, context) => readSettingsDocument(assistantConfigService, input, context)
    }),
    Object.freeze({
      id: actionIds.settingsUpdate,
      version: 1,
      kind: "command",
      channels: ["api", "automation", "internal"],
      surfaces: settingsSurfaces,
      permission: {
        require: "authenticated"
      },
      input: settingsUpdateInputValidator,
      output: null,
      extensions: {
        assistant: {
          exclude: "Assistant self-configuration is disabled; use the authenticated assistant settings screen."
        }
      },
      execute: (input, context) => updateSettingsDocument(assistantConfigService, input, context)
    })
  ]);
}

export { createAssistantSettingsActions };
