import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  createCrudParentFilterQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import {
  cursorPaginationQueryValidator,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { routeParamsValidator } from "@jskit-ai/users-core/server/validators/routeParamsValidator";
import { checkRouteVisibility } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { buildWorkspaceInputFromRouteParams } from "@jskit-ai/users-core/server/support/workspaceRouteInput";
import { resolveApiBasePath } from "@jskit-ai/users-core/shared/support/usersApiPaths";
import { actionIds } from "./actionIds.js";
import { ${option:namespace|singular|camel}Resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(${option:namespace|singular|camel}Resource);

function registerRoutes(
  app,
  {
    routeOwnershipFilter = "public",
    routeSurface = "",
    routeSurfaceRequiresWorkspace = false,
    routeRelativePath = ""
  } = {}
) {
  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveApiBasePath({
    surfaceRequiresWorkspace: routeSurfaceRequiresWorkspace === true,
    relativePath: routeRelativePath
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "required",
      surface: normalizedRouteSurface,
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "List records."
      },
      paramsValidator: routeParamsValidator,
      queryValidator: [
        cursorPaginationQueryValidator,
        listSearchQueryValidator,
        listParentFilterQueryValidator,
        lookupIncludeQueryValidator
      ],
      responseValidators: withStandardErrorResponses({
        200: ${option:namespace|singular|camel}Resource.operations.list.outputValidator
      })
    },
    async function (request, reply) {
      const listInput = {
        ...buildWorkspaceInputFromRouteParams(request.input.params),
        ...(request.input.query || {})
      };
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
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "View a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      queryValidator: [lookupIncludeQueryValidator],
      responseValidators: withStandardErrorResponses({
        200: ${option:namespace|singular|camel}Resource.operations.view.outputValidator
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.view,
        input: {
          ...buildWorkspaceInputFromRouteParams(request.input.params),
          recordId: request.input.params.recordId,
          ...(request.input.query || {})
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
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "Create a record."
      },
      paramsValidator: routeParamsValidator,
      bodyValidator: ${option:namespace|singular|camel}Resource.operations.create.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          201: ${option:namespace|singular|camel}Resource.operations.create.outputValidator
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
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "Update a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      bodyValidator: ${option:namespace|singular|camel}Resource.operations.patch.bodyValidator,
      responseValidators: withStandardErrorResponses(
        {
          200: ${option:namespace|singular|camel}Resource.operations.patch.outputValidator
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
      visibility: checkRouteVisibility(routeOwnershipFilter),
      meta: {
        tags: ["crud"],
        summary: "Delete a record."
      },
      paramsValidator: [routeParamsValidator, recordIdParamsValidator],
      responseValidators: withStandardErrorResponses({
        200: ${option:namespace|singular|camel}Resource.operations.delete.outputValidator
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
