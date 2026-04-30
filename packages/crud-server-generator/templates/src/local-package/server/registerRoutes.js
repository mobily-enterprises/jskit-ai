import { withStandardErrorResponses } from "@jskit-ai/http-runtime/shared/validators/errorResponses";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator,
  lookupIncludeQueryValidator,
  createCrudParentFilterQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import {
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { actionIds } from "./actionIds.js";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
import { LIST_CONFIG } from "./listConfig.js";
__JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator(LIST_CONFIG);
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
const listRouteQueryValidator = composeSchemaDefinitions([
  listCursorPaginationQueryValidator,
  listSearchQueryValidator,
  listParentFilterQueryValidator,
  lookupIncludeQueryValidator
]);
__JSKIT_CRUD_ROUTE_VALIDATOR_CONSTANTS__

function registerRoutes(
  app,
  {
    routeOwnershipFilter = "public",
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: __JSKIT_CRUD_ROUTE_BASE__,
    relativePath: routeRelativePath,
    strictParams: false
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
__JSKIT_CRUD_LIST_ROUTE_PARAMS_VALIDATOR_LINE__
      query: listRouteQueryValidator,
      responses: withStandardErrorResponses({
        200: resource.operations.list.output
      })
    },
    async function (request, reply) {
      const listInput = {
__JSKIT_CRUD_LIST_ROUTE_INPUT_LINES__
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
__JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__
      query: lookupIncludeQueryValidator,
      responses: withStandardErrorResponses({
        200: resource.operations.view.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.view,
        input: {
__JSKIT_CRUD_VIEW_ROUTE_INPUT_LINES__
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
__JSKIT_CRUD_CREATE_ROUTE_PARAMS_VALIDATOR_LINE__
      body: resource.operations.create.body,
      responses: withStandardErrorResponses(
        {
          201: resource.operations.create.output
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.create,
        input: {
__JSKIT_CRUD_CREATE_ROUTE_INPUT_LINES__
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
__JSKIT_CRUD_UPDATE_ROUTE_PARAMS_VALIDATOR_LINE__
      body: resource.operations.patch.body,
      responses: withStandardErrorResponses(
        {
          200: resource.operations.patch.output
        },
        { includeValidation400: true }
      )
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.update,
        input: {
__JSKIT_CRUD_UPDATE_ROUTE_INPUT_LINES__
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
__JSKIT_CRUD_DELETE_ROUTE_PARAMS_VALIDATOR_LINE__
      responses: withStandardErrorResponses({
        200: resource.operations.delete.output
      })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.delete,
        input: {
__JSKIT_CRUD_DELETE_ROUTE_INPUT_LINES__
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
