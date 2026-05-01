import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import {
  workspaceListItemOutputValidator,
  workspaceResource
} from "../../shared/resources/workspaceResource.js";
import {
  WORKSPACES_COLLECTION_TRANSPORT,
  WORKSPACES_TRANSPORT
} from "../../shared/jsonApiTransports.js";
import { resolveWorkspaceRoutePath } from "../common/support/workspaceRoutePaths.js";
import { workspaceSlugParamsValidator } from "../common/validators/routeParamsValidator.js";
import { resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig } from "../support/workspaceActionSurfaces.js";

function resolveWorkspaceRecordId(record = {}, context = {}) {
  const workspaceId = record?.workspace?.id ?? record?.id;
  if (workspaceId != null && String(workspaceId).trim()) {
    return workspaceId;
  }

  const workspaceSlug = context?.request?.params?.workspaceSlug;
  if (workspaceSlug != null && String(workspaceSlug).trim()) {
    return workspaceSlug;
  }

  throw new Error("Workspace JSON:API response requires workspace id.");
}

function bootWorkspaceDirectoryRoutes(app) {
  if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
    throw new Error("bootWorkspaceDirectoryRoutes requires application make()/has().");
  }

  const router = app.make("jskit.http.router");
  const appConfig = app.has("appConfig") ? app.make("appConfig") : {};
  const workspaceRouteSurfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig(appConfig);
  const workspaceSelfCreateEnabled = app.has("workspaces.self-create.enabled")
    ? app.make("workspaces.self-create.enabled") === true
    : false;

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
        body: workspaceResource.operations.create.body,
        output: workspaceResource.operations.create.output,
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
            slug: body.slug
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
        output: workspaceResource.operations.view.output,
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
        body: workspaceResource.operations.patch.body,
        output: workspaceResource.operations.patch.output,
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

export { bootWorkspaceDirectoryRoutes };
