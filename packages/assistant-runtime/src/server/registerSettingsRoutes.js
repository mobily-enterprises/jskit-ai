import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import {
  ASSISTANT_SETTINGS_UPDATE_TRANSPORT,
  ASSISTANT_SETTINGS_TRANSPORT,
  assistantConfigResource,
  resolveAssistantApiBasePath
} from "@jskit-ai/assistant-core/shared";
import { actionIds } from "./actionIds.js";
import { assistantSurfaceRouteParamsValidator } from "./inputSchemas.js";
import { requireWorkspaceAssistantRouteParams, resolveRouteRequestState } from "./support/assistantRouteContext.js";

function resolveAssistantSettingsRecordId(record = {}) {
  const scopeKey = String(record?.scopeKey || "").trim();
  if (!scopeKey) {
    throw new Error("Assistant settings JSON:API response requires scopeKey.");
  }

  return scopeKey;
}

function registerSettingsRoutes(
  router,
  resolveCurrentAppConfig,
  { requiresWorkspace = false, workspaceScopeSupport = null } = {}
) {
  const routeBase = resolveAssistantApiBasePath({
    requiresWorkspace
  });
  const visibility = requiresWorkspace ? "workspace" : "public";
  const routePath = `${routeBase}/:surfaceId/settings`;
  const params = requiresWorkspace === true
    ? requireWorkspaceAssistantRouteParams(workspaceScopeSupport)
    : assistantSurfaceRouteParamsValidator;

  router.register(
    "GET",
    routePath,
    {
      auth: "required",
      visibility,
      params,
      meta: {
        tags: ["assistant", "settings"],
        summary: "Get assistant settings."
      },
      ...createJsonApiResourceRouteContract({
        ...ASSISTANT_SETTINGS_TRANSPORT,
        output: assistantConfigResource.operations.view.output,
        outputKind: "record",
        getRecordId: resolveAssistantSettingsRecordId
      })
    },
    async function assistantSettingsReadRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "settings",
        requiresWorkspace,
        workspaceScopeSupport
      });

      const response = await request.executeAction({
        actionId: actionIds.settingsRead,
        surface: routeState.hostSurfaceId,
        input: routeState.actionInput
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    routePath,
    {
      auth: "required",
      visibility,
      params,
      meta: {
        tags: ["assistant", "settings"],
        summary: "Update assistant settings."
      },
      ...createJsonApiResourceRouteContract({
        ...ASSISTANT_SETTINGS_UPDATE_TRANSPORT,
        body: assistantConfigResource.operations.patch.body,
        output: assistantConfigResource.operations.patch.output,
        outputKind: "record",
        getRecordId: resolveAssistantSettingsRecordId,
        includeValidation400: true
      })
    },
    async function assistantSettingsPatchRoute(request, reply) {
      const routeState = resolveRouteRequestState(request, {
        resolveCurrentAppConfig,
        kind: "settings",
        requiresWorkspace,
        workspaceScopeSupport
      });

      const response = await request.executeAction({
        actionId: actionIds.settingsUpdate,
        surface: routeState.hostSurfaceId,
        input: {
          ...routeState.actionInput,
          patch: request.input.body
        }
      });

      reply.code(200).send(response);
    }
  );
}

export { registerSettingsRoutes };
