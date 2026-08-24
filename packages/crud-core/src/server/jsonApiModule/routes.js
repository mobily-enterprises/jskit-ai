import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { createCrudJsonApiRouteContracts } from "../routeContracts.js";

const CUSTOM_ACTION_METHODS = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);

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

function createCustomActionInput(scopeInput, route, request) {
  const scopedInput = createScopeInput(scopeInput, request);
  if (typeof route.input === "function") {
    const input = route.input(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("CRUD custom action route.input() must return an object.");
    }
    return { ...scopedInput, ...input };
  }
  return {
    ...scopedInput,
    ...(request.input?.params || {}),
    ...(request.input?.query || {}),
    ...(request.input?.body || {})
  };
}

function normalizeCustomActionRoutes(actions = {}, namespace = "") {
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
    throw new TypeError("CRUD actions must be an object.");
  }

  return Object.freeze(Object.entries(actions).flatMap(([name, definition]) => {
    if (!definition?.route) return [];
    const route = definition.route;
    if (!route || typeof route !== "object" || Array.isArray(route)) {
      throw new TypeError(`CRUD custom action "${name}" route must be an object.`);
    }
    const method = String(route.method || "POST").trim().toUpperCase();
    if (!CUSTOM_ACTION_METHODS.has(method)) {
      throw new TypeError(`CRUD custom action "${name}" route.method is unsupported.`);
    }
    const path = String(route.path || "").trim();
    if (!path.startsWith("/")) {
      throw new TypeError(`CRUD custom action "${name}" route.path must start with "/".`);
    }
    if (!route.contract || typeof route.contract !== "object" || Array.isArray(route.contract)) {
      throw new TypeError(`CRUD custom action "${name}" route.contract must be an object.`);
    }
    if (route.input != null && typeof route.input !== "function") {
      throw new TypeError(`CRUD custom action "${name}" route.input must be a function.`);
    }
    const statusCode = Number(route.statusCode ?? 200);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new TypeError(`CRUD custom action "${name}" route.statusCode must be a valid HTTP status.`);
    }
    return [Object.freeze({
      name,
      actionId: String(definition.id || `${namespace}.${name}`).trim(),
      method,
      path,
      contract: route.contract,
      input: route.input || null,
      statusCode,
      summary: String(route.summary || `${name} ${namespace} record.`).trim()
    })];
  }));
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
  actions = {},
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
  const customActionRoutes = normalizeCustomActionRoutes(actions, namespace);

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

  for (const actionRoute of customActionRoutes) {
    const customContract = {
      ...actionRoute.contract,
      ...(routeParamsValidator
        ? {
            params: actionRoute.contract.params
              ? composeSchemaDefinitions([routeParamsValidator, actionRoute.contract.params])
              : routeParamsValidator
          }
        : {})
    };
    router.register(
      actionRoute.method,
      `${basePath}${actionRoute.path}`,
      {
        ...customContract,
        ...routeBaseContract,
        meta: {
          ...(customContract.meta || {}),
          tags: customContract.meta?.tags || ["crud"],
          summary: customContract.meta?.summary || actionRoute.summary
        }
      },
      async function (request, reply) {
        const response = await request.executeAction({
          actionId: actionRoute.actionId,
          input: createCustomActionInput(scopeInput, actionRoute, request)
        });
        const nextReply = reply.code(actionRoute.statusCode);
        if (actionRoute.statusCode === 204) {
          nextReply.send();
          return;
        }
        nextReply.send(response);
      }
    );
  }
}

export { normalizeCustomActionRoutes, registerCrudJsonApiRoutes };
