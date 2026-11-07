import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import {
  workspaceListItemOutputValidator,
  workspaceCrud
} from "../../shared/resources/workspaceResource.js";
import {
  WORKSPACES_COLLECTION_TRANSPORT,
  WORKSPACES_TRANSPORT
} from "../../shared/jsonApiTransports.js";
import { resolveWorkspaceRecordId } from "../common/support/workspaceRecordId.js";
import { resolveWorkspaceRoutePath } from "../support/workspaceRoutePaths.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

/**
 * @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router
 * @param {{ config: import("@jskit-ai/kernel/server/types").RuntimeConfig, workspaceSelfCreateEnabled: boolean }} options
 */
function registerWorkspaceDirectoryRoutes(router, { config, workspaceSelfCreateEnabled }) {
  const workspaceRouteSurfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig(config);

  if (workspaceSelfCreateEnabled) {
    router.register(
      "POST",
      "/api/workspaces",
      {
        auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "Create a workspace for the authenticated user"
      },
      ...createJsonApiResourceRouteContract({
        ...WORKSPACES_TRANSPORT,
        body: workspaceCrud.operations.create.body,
        output: workspaceCrud.operations.create.output,
        outputKind: "record",
        includeValidation400: true
      })
    },
      async function (request, reply) {
        const body = request.input.body || {};
        const response = await request.executeAction({
          actionId: "workspace.workspaces.create",
          input: {
            name: body.name,
            ...(Object.hasOwn(body, "slug") ? { slug: body.slug } : {})
          }
        });
        reply.code(200).send(response);
      }
    );
  }

  router.register(
    "GET",
    "/api/workspaces",
    {
      auth: "required",
      meta: {
        tags: ["workspace"],
        summary: "List workspaces visible to authenticated user"
      },
      ...createJsonApiResourceRouteContract({
        ...WORKSPACES_COLLECTION_TRANSPORT,
        output: workspaceListItemOutputValidator,
        outputKind: "collection"
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.list",
        input: {}
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    resolveWorkspaceRoutePath("/"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Get workspace profile by workspace slug"
      },
      params: workspaceSlugParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACES_TRANSPORT,
        output: workspaceCrud.operations.view.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceRecordId
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.read",
        input: {
          workspaceSlug: request.input.params.workspaceSlug
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "PATCH",
    resolveWorkspaceRoutePath("/"),
    {
      auth: "required",
      surface: workspaceRouteSurfaceId,
      visibility: "workspace",
      meta: {
        tags: ["workspace"],
        summary: "Update workspace profile by workspace slug"
      },
      params: workspaceSlugParamsValidator,
      ...createJsonApiResourceRouteContract({
        ...WORKSPACES_TRANSPORT,
        body: workspaceCrud.operations.patch.body,
        output: workspaceCrud.operations.patch.output,
        outputKind: "record",
        getRecordId: resolveWorkspaceRecordId,
        includeValidation400: true
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "workspace.workspaces.update",
        input: {
          workspaceSlug: request.input.params.workspaceSlug,
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerWorkspaceDirectoryRoutes };
