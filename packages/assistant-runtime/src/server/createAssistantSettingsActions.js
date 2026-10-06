import { createSchema } from "json-rest-schema";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { assistantConfigResource } from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantTargetSurfaceInputValidator } from "./inputSchemas.js";

const settingsReadInputValidator = assistantTargetSurfaceInputValidator;

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

function createAssistantSettingsActions({ assistantConfigService, settingsSurfaces }) {
  return Object.freeze([
  {
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
    idempotency: "none",
    audit: {
      actionName: actionIds.settingsRead
    },
    observability: {},
    async execute(input, context) {
      return returnJsonApiData(await assistantConfigService.getSettings(input, {
        context
      }));
    }
  },
  {
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
    idempotency: "optional",
    audit: {
      actionName: actionIds.settingsUpdate
    },
    observability: {},
    async execute(input, context) {
      return returnJsonApiData(await assistantConfigService.updateSettings(input, input.patch, {
        context
      }));
    }
  }
  ]);
}

export { createAssistantSettingsActions };
