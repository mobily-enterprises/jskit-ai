import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { createCrudJsonApiRouteContracts } from "../routeContracts.js";

function createScopeInput(scopeInput, request) {
  if (typeof scopeInput !== "function") {
    return {};
  }
  const result = scopeInput(request);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("CRUD scopeInput must return an object.");
  }
  return result;
}

function registerCrudJsonApiRoutes(router, {
  namespace,
  resource,
  routeBase = "/",
  relativePath,
  surface,
  ownershipFilter,
  access,
  internal = false,
  operations = ["list", "view", "create", "update", "delete"],
  operationInputs = {},
  listFilterQueryValidator = null,
  routeParamsValidator = null,
  scopeInput = null
} = {}) {
  if (!router || typeof router.register !== "function") {
    throw new TypeError("registerCrudJsonApiRoutes requires router.");
  }
  const normalizedSurface = normalizeSurfaceId(surface);
  const basePath = resolveScopedApiBasePath({
    routeBase,
    relativePath,
    strictParams: false
  });
  const routeContracts = createCrudJsonApiRouteContracts({
    resource,
    operations,
    operationInputs,
    listFilterQueryValidator,
    ...(routeParamsValidator ? { routeParamsValidator } : {})
  });
  const routeBaseContract = Object.freeze({
    auth: access === "public" ? "public" : "required",
    csrfProtection: access !== "public",
    surface: normalizedSurface,
    ...(internal ? { internal: true } : {}),
    visibility: checkRouteVisibility(ownershipFilter)
  });
  const actionId = (operation) => `crud.${namespace}.${operation}`;
  const enabledOperations = new Set(operations);

  function paramsContract({ record = false } = {}) {
    if (record) {
      return { params: routeContracts.recordRouteParamsValidator };
    }
    return routeParamsValidator ? { params: routeParamsValidator } : {};
  }

  if (enabledOperations.has("list")) router.register(
    "GET",
    basePath,
    {
      ...routeBaseContract,
      meta: { tags: ["crud"], summary: "List records." },
      ...routeContracts.listRouteContract,
      ...paramsContract()
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionId("list"),
        input: {
          ...createScopeInput(scopeInput, request),
          ...(request.input.query || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  if (enabledOperations.has("view")) router.register(
    "GET",
    `${basePath}/:recordId`,
    {
      ...routeBaseContract,
      meta: { tags: ["crud"], summary: "View a record." },
      ...routeContracts.viewRouteContract,
      ...paramsContract({ record: true })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionId("view"),
        input: {
          ...createScopeInput(scopeInput, request),
          recordId: request.input.params.recordId,
          ...(request.input.query || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  if (enabledOperations.has("create")) router.register(
    "POST",
    basePath,
    {
      ...routeBaseContract,
      meta: { tags: ["crud"], summary: "Create a record." },
      ...routeContracts.createRouteContract,
      ...paramsContract()
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionId("create"),
        input: {
          ...createScopeInput(scopeInput, request),
          ...(request.input.body || {})
        }
      });
      reply.code(201).send(response);
    }
  );

  if (enabledOperations.has("update")) router.register(
    "PATCH",
    `${basePath}/:recordId`,
    {
      ...routeBaseContract,
      meta: { tags: ["crud"], summary: "Update a record." },
      ...routeContracts.updateRouteContract,
      ...paramsContract({ record: true })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionId("update"),
        input: {
          ...createScopeInput(scopeInput, request),
          recordId: request.input.params.recordId,
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  if (enabledOperations.has("delete")) router.register(
    "DELETE",
    `${basePath}/:recordId`,
    {
      ...routeBaseContract,
      meta: { tags: ["crud"], summary: "Delete a record." },
      ...routeContracts.deleteRouteContract,
      ...paramsContract({ record: true })
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: actionId("delete"),
        input: {
          ...createScopeInput(scopeInput, request),
          recordId: request.input.params.recordId
        }
      });
      reply.code(204).send(response);
    }
  );
}

export { registerCrudJsonApiRoutes };
