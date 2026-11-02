import { createSchema } from "json-rest-schema";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { assistantConfigResource } from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantTargetSurfaceInputValidator } from "./inputSchemas.js";

/** @typedef {import("./types.js").AssistantConfigService} AssistantConfigService */

const settingsReadInputValidator = deepFreeze({ schema: assistantTargetSurfaceInputValidator.schema });

const settingsUpdatePatchInputValidator = deepFreeze({
  schema: createSchema({
    patch: {
      type: "object",
      required: true,
      schema: assistantConfigResource.operations.patch.body.schema
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
 * The JSON:API documents the settings actions answer with.
 * @param {{ assistantConfigService: AssistantConfigService }} dependencies
 */
function createSettingsDocuments({ assistantConfigService }) {
  async function readSettings(input, context) {
    return returnJsonApiData(await assistantConfigService.getSettings(input, {
      context
    }));
  }

  async function updateSettings(input, context) {
    return returnJsonApiData(await assistantConfigService.updateSettings(input, input.patch, {
      context
    }));
  }

  return Object.freeze({
    readSettings,
    updateSettings
  });
}

/**
 * The settings actions of the assistant surfaces' settings screens.
 * @param {object} dependencies
 * @param {AssistantConfigService} dependencies.assistantConfigService
 * @param {string[]} dependencies.settingsSurfaces
 */
function createAssistantSettingsActions({ assistantConfigService, settingsSurfaces }) {
  const settingsDocuments = createSettingsDocuments({ assistantConfigService });
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
      execute: (input, context) => settingsDocuments.readSettings(input, context)
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
      execute: (input, context) => settingsDocuments.updateSettings(input, context)
    })
  ]);
}

export { createAssistantSettingsActions };
