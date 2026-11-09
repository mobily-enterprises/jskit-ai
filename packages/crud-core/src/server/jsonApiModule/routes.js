import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { composeSchemaDefinitions } from "@jskit-ai/kernel/shared/validators";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createCrudJsonApiRouteContracts } from "../routeContracts.js";
import { buildCrudCustomActionId } from "./customActionId.js";

const CUSTOM_ACTION_METHODS = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);

function buildScopeInput(scopeInput, request) {
  if (!scopeInput) {
    return {};
  }
  const result = scopeInput(request);
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("CRUD scopeInput must return an object.");
  }
  return result;
}

/**
 * Refuses a list request that names a query key its route does not take. Fastify's validation drops an undeclared
 * query key without a word, so a filter the list does not know (`filter[status]`) would answer every row, as if it
 * were never sent: the keys the request names that validation left out of request.query are the undeclared ones.
 * @param {{ url?: string, query?: object, routeOptions?: { schema?: { querystring?: { properties?: object } } } }} request
 */
function refuseUndeclaredListQuery(request) {
  const url = String(request.url || "");
  const start = url.indexOf("?");
  if (start < 0) {
    return;
  }
  const taken = new Set(Object.keys(request.query || {}));
  const unknown = [...new Set(new URLSearchParams(url.slice(start + 1)).keys())].filter((key) => key && !taken.has(key));
  if (unknown.length < 1) {
    return;
  }
  const querystring = request.routeOptions?.schema?.querystring || {};
  // A sparse fieldset key is taken by pattern, one per JSON:API type: `fields[<type>]`.
  const patterns = Object.keys(querystring.patternProperties || {}).map((pattern) => (pattern.startsWith("^fields") ? "fields[<type>]" : pattern));
  const known = [...Object.keys(querystring.properties || {}), ...patterns].join(", ") || "none";
  const params = { unknown: unknown.join(", "), known };
  throw new AppError(400,
    `This list does not take ${params.unknown}: an undeclared query key would be dropped, and the list would answer as ` +
    `if it had not been sent. It takes ${known}. To filter on a field, add it to the feature's listFilterQueryValidator ` +
    "and the resource's searchSchema; to search, send filter[q] and give the resource searchSchema.q.",
    { code: "crud.query.undeclaredKeys", params });
}

function buildCustomActionInput(scopeInput, route, request) {
  const scopedInput = buildScopeInput(scopeInput, request);
  if (route.input) {
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

function normalizeCustomActionRoutes(actions, namespace) {
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
    // readable-check: allow method-probe - input validation: a custom action route's input must be a function
    if (route.input != null && typeof route.input !== "function") {
      throw new TypeError(`CRUD custom action "${name}" route.input must be a function.`);
    }
    const statusCode = Number(route.statusCode ?? 200);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new TypeError(`CRUD custom action "${name}" route.statusCode must be a valid HTTP status.`);
    }
    return [Object.freeze({
      name,
      actionId: buildCrudCustomActionId(namespace, name, definition),
      method,
      path,
      contract: route.contract,
      input: route.input || null,
      statusCode,
      summary: String(route.summary || `${name} ${namespace} record.`).trim()
    })];
  }));
}

/**
 * The routes of one CRUD feature, from the options defineCrudFeature resolved: each `{ method, path, contract,
 * handler }`, built from the definition alone, so a feature builds them once and registers them on every router.
 * @param {object} options
 * @param {string} options.namespace
 * @param {import("../types.js").CrudContract} options.resource
 * @param {string} options.routeBase
 * @param {string} options.relativePath
 * @param {string} options.surface
 * @param {string} options.ownershipFilter
 * @param {string} options.access
 * @param {boolean} options.internal
 * @param {readonly string[]} options.operations
 * @param {Record<string, object>} options.actions The feature's custom actions, by name.
 * @param {{ create?: object, update?: object }} options.operationInputs
 * @param {object | null} options.listFilterQueryValidator
 * @param {object | null} options.routeParamsValidator
 * @param {((request: object) => object) | null} options.scopeInput
 */
function createCrudJsonApiRoutes({
  namespace,
  resource,
  routeBase,
  relativePath,
  surface,
  ownershipFilter,
  access,
  internal,
  operations,
  actions,
  operationInputs,
  listFilterQueryValidator,
  routeParamsValidator,
  scopeInput
}) {
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

  const routes = [];
  const route = (method, path, contract, handler) => routes.push(Object.freeze({ method, path, contract, handler }));

  function paramsContract({ record = false } = {}) {
    if (record) {
      return { params: routeContracts.recordRouteParamsValidator };
    }
    return routeParamsValidator ? { params: routeParamsValidator } : {};
  }

  if (enabledOperations.has("list")) route(
    "GET",
    basePath,
    {
      ...routeBaseContract,
      meta: { tags: ["crud"], summary: "List records." },
      ...routeContracts.listRouteContract,
      ...paramsContract()
    },
    async function (request, reply) {
      refuseUndeclaredListQuery(request);
      const response = await request.executeAction({
        actionId: actionId("list"),
        input: {
          ...buildScopeInput(scopeInput, request),
          ...(request.input.query || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  if (enabledOperations.has("view")) route(
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
          ...buildScopeInput(scopeInput, request),
          recordId: request.input.params.recordId,
          ...(request.input.query || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  if (enabledOperations.has("create")) route(
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
          ...buildScopeInput(scopeInput, request),
          ...(request.input.body || {})
        }
      });
      reply.code(201).send(response);
    }
  );

  if (enabledOperations.has("update")) route(
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
          ...buildScopeInput(scopeInput, request),
          recordId: request.input.params.recordId,
          ...(request.input.body || {})
        }
      });
      reply.code(200).send(response);
    }
  );

  if (enabledOperations.has("delete")) route(
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
          ...buildScopeInput(scopeInput, request),
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
    route(
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
          input: buildCustomActionInput(scopeInput, actionRoute, request)
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
  return Object.freeze(routes);
}

/**
 * Registers routes createCrudJsonApiRoutes built, each with its own copy of its contract.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router
 * @param {ReadonlyArray<{ method: string, path: string, contract: object, handler: Function }>} routes
 */
function registerCrudRoutes(router, routes) {
  for (const { method, path, contract, handler } of routes) {
    router.register(method, path, { ...contract }, handler);
  }
}

/**
 * Registers the routes of one CRUD feature, from the options defineCrudFeature resolved.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeRouter} router
 * @param {Parameters<typeof createCrudJsonApiRoutes>[0]} options
 */
function registerCrudJsonApiRoutes(router, options) {
  registerCrudRoutes(router, createCrudJsonApiRoutes(options));
}

export { createCrudJsonApiRoutes, registerCrudJsonApiRoutes, registerCrudRoutes };
