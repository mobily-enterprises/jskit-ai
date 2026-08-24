import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { WORKSPACE_SETTINGS_TRANSPORT } from "../../shared/jsonApiTransports.js";
import { workspaceSettingsResource } from "../../shared/resources/workspaceSettingsResource.js";
import { resolveWorkspaceRoutePath } from "../common/support/workspaceRoutePaths.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

function resolveWorkspaceSettingsRecordId(record = {}, context = {}) {
  const workspaceId = record?.workspace?.id;
  if (workspaceId != null && String(workspaceId).trim()) {
    return workspaceId;
  }

  const workspaceSlug = context?.request?.params?.workspaceSlug;
  if (workspaceSlug != null && String(workspaceSlug).trim()) {
    return workspaceSlug;
  }

  throw new Error("Workspace settings JSON:API response requires workspace id.");
}

function registerWorkspaceSettingsRoutes(router, { config = {} } = {}) {
  if (!router || typeof router.register !== "function") {
    throw new TypeError("registerWorkspaceSettingsRoutes requires router.register().");
  }
  const workspaceRouteSurfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig(config);

  router.register(
    "GET",
    resolveWorkspaceRoutePath("/settings"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace settings and role catalog by workspace slug"
      },
      params: workspaceSlugParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_SETTINGS_TRANSPORT,
        output: workspaceSettingsResource.operations.view.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceSettingsRecordId
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.settings.read",
        input: {
          workspaceSlug: request.input.params.workspaceSlug
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    resolveWorkspaceRoutePath("/settings"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace settings by workspace slug"
      },
      params: workspaceSlugParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACE_SETTINGS_TRANSPORT,
        body: workspaceSettingsResource.operations.patch.body,
        output: workspaceSettingsResource.operations.patch.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceSettingsRecordId,
        includeValidation400: true
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.settings.update",
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerWorkspaceSettingsRoutes };
