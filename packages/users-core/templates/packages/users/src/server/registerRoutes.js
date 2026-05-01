import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator
} from "@jskit-ai/crud-core/server/listQueryValidators";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import { resource } from "../shared/userResource.js";

const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
  orderBy: resource.defaultSort
});
const listRouteQueryValidator = composeSchemaDefinitions([
  listCursorPaginationQueryValidator,
  listSearchQueryValidator
]);
const RESOURCE_ROUTE_CONTRACT_TYPE = resource.namespace;
const listRouteContract = createJsonApiResourceRouteContract({
  type: RESOURCE_ROUTE_CONTRACT_TYPE,
  query: listRouteQueryValidator,
  output: resource.operations.view.output,
  outputKind: "collection"
});
const viewRouteContract = createJsonApiResourceRouteContract({
  type: RESOURCE_ROUTE_CONTRACT_TYPE,
  output: resource.operations.view.output,
  outputKind: "record"
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
    routeBase: "/",
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
        summary: "List users."
      },
      ...listRouteContract
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "crud.users.list",
        input: {
          ...(request.input.query || {})
        }
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
        summary: "View a user."
      },
      ...viewRouteContract,
      params: recordIdParamsValidator
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: "crud.users.view",
        input: {
          recordId: request.input.params.recordId
        }
      });
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
