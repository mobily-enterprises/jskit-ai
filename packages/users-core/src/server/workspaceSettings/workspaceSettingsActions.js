import { Type } from "typebox";
import {
  resolveWorkspace,
  OBJECT_INPUT_SCHEMA
} from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { mergeObjectSchemas } from "@jskit-ai/kernel/shared/contracts/mergeObjectSchemas";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { createWorkspaceRoleCatalog, hasPermission } from "../../shared/roles.js";
import { workspaceSettingsSchema } from "../../shared/schemas/resources/workspaceSettingsSchema.js";

const workspaceSlugInputSchema = Type.Object(
  {
    workspaceSlug: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
);

const workspaceSettingsUpdateInputSchema = mergeObjectSchemas([
  workspaceSlugInputSchema,
  workspaceSettingsSchema.operations.patch.body.schema
]);

function canReadWorkspaceSettings(context) {
  return (
    hasPermission(context?.permissions, "workspace.settings.view") ||
    hasPermission(context?.permissions, "workspace.settings.update")
  );
}

function withWorkspaceRoleCatalog(payload = {}) {
  return {
    ...payload,
    roleCatalog: createWorkspaceRoleCatalog()
  };
}

const workspaceSettingsActions = Object.freeze([
  {
    id: "workspace.settings.read",
    version: 1,
    kind: "query",
    channels: ["api", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: {
      schema: workspaceSlugInputSchema,
      normalize(input = {}) {
        const source = OBJECT_INPUT_SCHEMA.parse(input);

        return {
          ...(Object.prototype.hasOwnProperty.call(source, "workspaceSlug")
            ? {
                workspaceSlug: normalizeLowerText(source.workspaceSlug)
              }
            : {})
        };
      }
    },
    output: workspaceSettingsSchema.operations.view.output,
    permission: canReadWorkspaceSettings,
    idempotency: "none",
    audit: {
      actionName: "workspace.settings.read"
    },
    observability: {},
    async execute(input, context, deps) {
      const response = await deps.workspaceSettingsService.getWorkspaceSettings(resolveWorkspace(context, input));

      return withWorkspaceRoleCatalog(response);
    }
  },
  {
    id: "workspace.settings.update",
    version: 1,
    kind: "command",
    channels: ["api", "assistant_tool", "internal"],
    surfacesFrom: "workspace",
    visibility: "public",
    input: {
      schema: workspaceSettingsUpdateInputSchema,
      normalize(input = {}) {
        const source = OBJECT_INPUT_SCHEMA.parse(input);
        const { workspaceSlug, ...workspaceSettingsPatch } = source;

        return {
          ...(Object.prototype.hasOwnProperty.call(source, "workspaceSlug")
            ? {
                workspaceSlug: normalizeLowerText(workspaceSlug)
              }
            : {}),
          ...workspaceSettingsSchema.operations.patch.body.normalize(workspaceSettingsPatch)
        };
      }
    },
    output: workspaceSettingsSchema.operations.patch.output,
    permission: ["workspace.settings.update"],
    idempotency: "optional",
    audit: {
      actionName: "workspace.settings.update"
    },
    observability: {},
    assistantTool: {
      description: "Update workspace settings.",
      inputJsonSchema: workspaceSettingsSchema.operations.patch.body.schema
    },
    async execute(input, context, deps) {
      const { workspaceSlug: _workspaceSlug, ...workspaceSettingsPatch } = input;
      const response = await deps.workspaceSettingsService.updateWorkspaceSettings(
        resolveWorkspace(context, input),
        workspaceSettingsPatch
      );

      return withWorkspaceRoleCatalog(response);
    }
  }
]);

export { workspaceSettingsActions };
