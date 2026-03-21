import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/users-core/server/support/workspaceRouteInput";
import { resolveUsersApiBasePath } from "@jskit-ai/users-core/shared/support/usersApiPaths";
import { actionIds } from "./actionIds.js";
import { crudResource } from "../shared/${option:namespace|singular|camel}Resource.js";
import { crudModuleConfig } from "../shared/moduleConfig.js";

function registerRoutes(
  app,
  {
    routeOwnershipFilter = "",
    routeSurface = "",
    routeSurfaceRequiresWorkspace = false,
    routeRelativePath = crudModuleConfig.relativePath
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make(KERNEL_TOKENS.HttpRouter);
  const routeVisibility = String(routeOwnershipFilter || "").trim() || "public";
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveUsersApiBasePath({
    surfaceRequiresWorkspace: routeSurfaceRequiresWorkspace === true,
    relativePath: routeRelativePath
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: routeVisibility,
      meta: {
        tags: ["crud"],
        summary: "List records."
      },
      paramsValidator: routeParamsValidator,
      queryValidator: cursorPaginationQueryValidator,
      responseValidators: withStandardErrorResponses({
        200: crudResource.operations.list.outputValidator
      })
    },
    async function (request, reply) {
      const listInput = {
        ...buildWorkspaceInputFromRouteParams(request.input.params)
      };
      if (request.input.query.cursor != null) {
        listInput.cursor = request.input.query.cursor;
      }
      if (request.input.query.limit != null) {
        listInput.limit = request.input.query.limit;
      }
      const response = await request.executeAction({
        actionId: actionIds.list,
        input: listInput
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/:recordId`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: routeVisibility,
      meta: {
        tags: ["crud"],
        summary: "View a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      responseValidators: withStandardErrorResponses({
        200: crudResource.operations.view.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.view,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    routeBase,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: routeVisibility,
      meta: {
        tags: ["crud"],
        summary: "Create a record."
      },
      paramsValidator: routeParamsValidator,
      bodyValidator: crudResource.operations.create.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          201: crudResource.operations.create.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.create,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          payload: request.input.body
        }
      });
      reply.code(201).send(response);
    }
  );

  router.register(
    "PATCH",
    `${routeBase}/:recordId`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: routeVisibility,
      meta: {
        tags: ["crud"],
        summary: "Update a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      bodyValidator: crudResource.operations.patch.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: crudResource.operations.patch.outputValidator
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.update,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId,
          patch: request.input.body
        }
      });
      reply.code(200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/:recordId`,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: routeVisibility,
      meta: {
        tags: ["crud"],
        summary: "Delete a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      responseValidators: withStandardErrorResponses({
        200: crudResource.operations.delete.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.delete,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
