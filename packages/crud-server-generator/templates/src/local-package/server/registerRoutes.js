import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
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
import { jsonRestResource } from "./jsonRestResource.js";
__JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
  orderBy: jsonRestResource.defaultSort
});
const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
const listRouteQueryValidator = composeSchemaDefinitions([
  listCursorPaginationQueryValidator,
  listSearchQueryValidator,
  listParentFilterQueryValidator,
  lookupIncludeQueryValidator
]);
const RESOURCE_ROUTE_CONTRACT_TYPE = resource.namespace;
const listRouteContract = createJsonApiResourceRouteContract({
  type: RESOURCE_ROUTE_CONTRACT_TYPE,
  query: listRouteQueryValidator,
  output: resource.operations.view.output,
  outputKind: "collection",
  wrapResponse: false
});
const viewRouteContract = createJsonApiResourceRouteContract({
  type: RESOURCE_ROUTE_CONTRACT_TYPE,
  query: lookupIncludeQueryValidator,
  output: resource.operations.view.output,
  outputKind: "record",
  wrapResponse: false
});
const createRouteContract = createJsonApiResourceRouteContract({
  type: RESOURCE_ROUTE_CONTRACT_TYPE,
  body: resource.operations.create.body,
  output: resource.operations.create.output,
  outputKind: "record",
  successStatus: 201,
  includeValidation400: true,
  wrapResponse: false
});
const updateRouteContract = createJsonApiResourceRouteContract({
  type: RESOURCE_ROUTE_CONTRACT_TYPE,
  body: resource.operations.patch.body,
  output: resource.operations.patch.output,
  outputKind: "record",
  includeValidation400: true,
  wrapResponse: false
});
const deleteRouteContract = createJsonApiResourceRouteContract({
  type: RESOURCE_ROUTE_CONTRACT_TYPE,
  outputKind: "no-content",
  successStatus: 204,
  wrapResponse: false
});
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
      ...listRouteContract,
__JSKIT_CRUD_LIST_ROUTE_PARAMS_VALIDATOR_LINE__
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
      ...viewRouteContract,
__JSKIT_CRUD_VIEW_ROUTE_PARAMS_VALIDATOR_LINE__
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
      ...createRouteContract,
__JSKIT_CRUD_CREATE_ROUTE_PARAMS_VALIDATOR_LINE__
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
      ...updateRouteContract,
__JSKIT_CRUD_UPDATE_ROUTE_PARAMS_VALIDATOR_LINE__
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
      ...deleteRouteContract,
__JSKIT_CRUD_DELETE_ROUTE_PARAMS_VALIDATOR_LINE__
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionIds.delete,
        input: {
__JSKIT_CRUD_DELETE_ROUTE_INPUT_LINES__
        }
      });
      reply.code(204).send(response);
    }
  );
}

export { registerRoutes };
