import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import {
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { isWorkspaceRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";
import {
  assertCrudOperationName,
  createCrudJsonApiActions,
  normalizeCrudOperationLifecycle
} from "./jsonApiModule/actions.js";
import { createCrudJsonApiRepository } from "./jsonApiModule/repository.js";
import { registerCrudJsonApiRoutes } from "./jsonApiModule/routes.js";
import { createCrudJsonApiService as createDefaultService } from "./jsonApiModule/service.js";

const RESERVED_REQUIREMENT_NAMES = Object.freeze([
  "context",
  "database",
  "http",
  "input",
  "jsonRestApi",
  "repository",
  "resource",
  "result",
  "service",
  "standard",
  "trx"
]);
const CRUD_SERVICE_METHOD_BY_OPERATION = Object.freeze({
  list: "queryDocuments",
  view: "getDocumentById",
  create: "createDocument",
  update: "patchDocumentById",
  delete: "deleteDocumentById"
});
const CRUD_SERVICE_METHODS = new Set(Object.values(CRUD_SERVICE_METHOD_BY_OPERATION));

function normalizeAccess(resource = {}) {
  const access = normalizeText(resource.apiAccess).toLowerCase() || "authenticated";
  if (access !== "authenticated" && access !== "public") {
    throw new TypeError('defineCrudJsonApiFeature resource.apiAccess must be "authenticated" or "public".');
  }
  return access;
}

function normalizeScope(scope = {}) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    throw new TypeError("defineCrudJsonApiFeature scope must be an object.");
  }
  return Object.freeze({
    routeBase: normalizeText(scope.routeBase) || "/",
    actionInputValidator: scope.actionInputValidator || null,
    routeParamsValidator: scope.routeParamsValidator || null,
    inputKeys: Object.freeze([...new Set(
      (Array.isArray(scope.inputKeys) ? scope.inputKeys : [])
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    )]),
    input: typeof scope.input === "function" ? scope.input : null
  });
}

function assertWorkspaceScope(scope, ownershipFilter) {
  if (!isWorkspaceRouteVisibility(ownershipFilter)) {
    return;
  }
  const missing = [];
  if (scope.routeBase === "/") missing.push("routeBase");
  if (!scope.actionInputValidator) missing.push("actionInputValidator");
  if (!scope.routeParamsValidator) missing.push("routeParamsValidator");
  if (scope.inputKeys.length < 1) missing.push("inputKeys");
  if (!scope.input) missing.push("input");
  if (missing.length > 0) {
    throw new TypeError(
      `Workspace CRUD feature requires explicit scope ${missing.join(", ")}.`
    );
  }
}

function normalizeFeatureRequirements(requires = {}) {
  if (!requires || typeof requires !== "object" || Array.isArray(requires)) {
    throw new TypeError("defineCrudJsonApiFeature requires must be an object.");
  }
  for (const name of RESERVED_REQUIREMENT_NAMES) {
    if (Object.hasOwn(requires, name)) {
      throw new TypeError(`defineCrudJsonApiFeature requires reserves the local name ${name}.`);
    }
  }
  return Object.freeze({ ...requires });
}

function operationsFromResource(resource) {
  const operationMap = Object.freeze({
    list: "list",
    view: "view",
    create: "create",
    patch: "update",
    delete: "delete"
  });
  return Object.keys(resource?.operations || {})
    .map((operation) => operationMap[operation])
    .filter(Boolean);
}

function normalizeOperations(operations, resource) {
  const source = operations === undefined ? operationsFromResource(resource) : operations;
  if (!Array.isArray(source) || source.length < 1) {
    throw new TypeError("defineCrudJsonApiFeature operations must be a non-empty array.");
  }
  return Object.freeze([...new Set(source.map((operation) => assertCrudOperationName(operation)))]);
}

function resolveActionPermission(actionName, { access, workspaceScoped, permissions } = {}) {
  const normalizedActionName = normalizeText(actionName).toLowerCase();
  if (!normalizedActionName) {
    throw new TypeError("CRUD action name is required.");
  }
  const explicitPermission = permissions?.[normalizedActionName];
  if (explicitPermission && typeof explicitPermission === "object") {
    return explicitPermission;
  }
  if (typeof explicitPermission === "string" && explicitPermission.trim()) {
    return Object.freeze({ require: "all", permissions: [explicitPermission.trim()] });
  }
  if (access === "public") {
    return Object.freeze({ require: "none" });
  }
  if (workspaceScoped) {
    return Object.freeze({
      require: "all",
      permissions: [`crud.${permissions?.namespace || "resource"}.${normalizedActionName}`]
    });
  }
  return Object.freeze({ require: "authenticated" });
}

function projectEnabledServiceOperations(service, operations) {
  const enabledMethods = new Set(operations.map((operation) => CRUD_SERVICE_METHOD_BY_OPERATION[operation]));
  return Object.freeze(Object.fromEntries(
    Object.entries(service).filter(([name]) => !CRUD_SERVICE_METHODS.has(name) || enabledMethods.has(name))
  ));
}

function defineCrudJsonApiFeature({
  resource,
  id = "",
  capability = "",
  surface,
  ownershipFilter = "",
  relativePath = "",
  internal = false,
  routes = true,
  listFilterQueryValidator = null,
  searchSchema = null,
  permissions = null,
  scope = {},
  requires = {},
  decorateRepository = null,
  decorateService = null,
  operationLifecycle = {},
  operationInputs = {},
  actions = {},
  operations = undefined
} = {}) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new TypeError("defineCrudJsonApiFeature requires resource.");
  }
  const namespace = normalizeText(resource.namespace);
  if (!namespace) {
    throw new TypeError("defineCrudJsonApiFeature requires resource.namespace.");
  }
  const featureId = normalizeText(id) || `crud.${namespace}`;
  const featureCapability = normalizeText(capability) || featureId;
  const normalizedSurface = normalizeText(surface).toLowerCase();
  if (!normalizedSurface) {
    throw new TypeError("defineCrudJsonApiFeature requires surface.");
  }
  const normalizedOwnershipFilter = normalizeText(ownershipFilter || resource.autofilter).toLowerCase() || "public";
  const normalizedRelativePath = normalizeText(relativePath) || `/${namespace.replace(/_/gu, "-")}`;
  const access = normalizeAccess(resource);
  if (access === "public" && normalizedOwnershipFilter !== "public") {
    throw new TypeError('A public CRUD feature requires ownershipFilter "public".');
  }
  const normalizedScope = normalizeScope(scope);
  const featureRequirements = normalizeFeatureRequirements(requires);
  const enabledOperations = normalizeOperations(operations, resource);
  if (typeof routes !== "boolean") {
    throw new TypeError("defineCrudJsonApiFeature routes must be a boolean.");
  }
  if (decorateRepository != null && typeof decorateRepository !== "function") {
    throw new TypeError("defineCrudJsonApiFeature decorateRepository must be a function.");
  }
  if (decorateService != null && typeof decorateService !== "function") {
    throw new TypeError("defineCrudJsonApiFeature decorateService must be a function.");
  }
  const normalizedOperationLifecycle = normalizeCrudOperationLifecycle(operationLifecycle);
  if (!operationInputs || typeof operationInputs !== "object" || Array.isArray(operationInputs)) {
    throw new TypeError("defineCrudJsonApiFeature operationInputs must be an object.");
  }
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
    throw new TypeError("defineCrudJsonApiFeature actions must be an object.");
  }
  assertWorkspaceScope(normalizedScope, normalizedOwnershipFilter);
  const workspaceScoped = isWorkspaceRouteVisibility(normalizedOwnershipFilter);
  const resourceScopeName = resolveCrudResourceScopeName(namespace);
  const permissionOptions = permissions && typeof permissions === "object" && !Array.isArray(permissions)
    ? { ...permissions, namespace }
    : { namespace };

  return defineFeature({
    id: featureId,
    domain: "crud",
    requires: {
      database: "runtime.database",
      http: "runtime.http",
      jsonRestApi: "runtime.json-rest-api",
      ...featureRequirements
    },
    provides: {
      resourceApi: featureCapability
    },
    async setup({ database, http, jsonRestApi, ...featureDependencies }) {
      await addResourceIfMissing(
        jsonRestApi,
        resourceScopeName,
        createJsonRestResourceScopeOptions(resource, {
          ...(searchSchema ? { searchSchema } : {}),
          writeSerializers: { "datetime-utc": toDatabaseDateTimeUtc }
        })
      );
      const defaultRepository = createCrudJsonApiRepository({
        api: jsonRestApi,
        knex: database.knex,
        resource,
        resourceScopeName
      });
      const repository = decorateRepository
        ? await decorateRepository(Object.freeze({
            repository: defaultRepository,
            resource,
            database,
            http,
            jsonRestApi,
            ...featureDependencies
          }))
        : defaultRepository;
      const defaultService = createDefaultService({ repository });
      const decoratedService = decorateService
        ? await decorateService(Object.freeze({
            service: defaultService,
            repository,
            resource,
            ...featureDependencies
        }))
        : defaultService;
      const service = projectEnabledServiceOperations(decoratedService, enabledOperations);
      if (routes) {
        registerCrudJsonApiRoutes(http.router, {
          namespace,
          resource,
          routeBase: normalizedScope.routeBase,
          relativePath: normalizedRelativePath,
          surface: normalizedSurface,
          ownershipFilter: normalizedOwnershipFilter,
          access,
          internal,
          operations: enabledOperations,
          actions,
          listFilterQueryValidator,
          operationInputs,
          routeParamsValidator: normalizedScope.routeParamsValidator,
          scopeInput: normalizedScope.input
        });
      }
      return {
        resourceApi: Object.freeze({ repository, resource, service })
      };
    },
    actions(dependencies) {
      const { resourceApi } = dependencies;
      const actionDependencies = Object.freeze(Object.fromEntries(
        Object.keys(featureRequirements).map((name) => [name, dependencies[name]])
      ));
      return createCrudJsonApiActions({
        namespace,
        resource,
        repository: resourceApi.repository,
        service: resourceApi.service,
        surface: normalizedSurface,
        operations: enabledOperations,
        listFilterQueryValidator,
        operationLifecycle: normalizedOperationLifecycle,
        operationInputs,
        actions,
        dependencies: actionDependencies,
        permissionForOperation: (operation) => resolveActionPermission(operation, {
          access,
          workspaceScoped,
          permissions: permissionOptions
        }),
        scopeInputValidator: normalizedScope.actionInputValidator,
        scopeInputKeys: normalizedScope.inputKeys
      });
    }
  });
}

export { defineCrudJsonApiFeature };
