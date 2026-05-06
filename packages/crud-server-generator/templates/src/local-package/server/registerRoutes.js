import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { createCrudJsonApiRouteContracts } from "@jskit-ai/crud-core/server/routeContracts";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { resource } from "../shared/${option:namespace|singular|camel}Resource.js";
__JSKIT_CRUD_ROUTE_WORKSPACE_SUPPORT_IMPORTS__

const {
  listRouteContract,
  viewRouteContract,
  createRouteContract,
  updateRouteContract,
  deleteRouteContract,
  recordRouteParamsValidator
} = createCrudJsonApiRouteContracts({
  resource__JSKIT_CRUD_ROUTE_CONTRACTS_RESOURCE_ARGS__
});

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
__JSKIT_CRUD_ROUTE_INTERNAL_LINE__
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
        actionId: "crud.${option:namespace|snake}.list",
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
__JSKIT_CRUD_ROUTE_INTERNAL_LINE__
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
        actionId: "crud.${option:namespace|snake}.view",
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
__JSKIT_CRUD_ROUTE_INTERNAL_LINE__
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
        actionId: "crud.${option:namespace|snake}.create",
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
__JSKIT_CRUD_ROUTE_INTERNAL_LINE__
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
        actionId: "crud.${option:namespace|snake}.update",
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
__JSKIT_CRUD_ROUTE_INTERNAL_LINE__
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
        actionId: "crud.${option:namespace|snake}.delete",
        input: {
__JSKIT_CRUD_DELETE_ROUTE_INPUT_LINES__
        }
      });
      reply.code(204).send(response);
    }
  );
}

export { registerRoutes };
