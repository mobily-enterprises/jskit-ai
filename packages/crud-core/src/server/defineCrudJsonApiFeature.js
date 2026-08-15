import { toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import {
  addResourceIfMissing,
  createJsonRestResourceScopeOptions
} from "@jskit-ai/json-rest-api-core/server/jsonRestApiHost";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { isWorkspaceRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { resolveCrudResourceScopeName } from "@jskit-ai/resource-crud-core/shared/crudLookup";
import { assertCrudOperationName, createCrudJsonApiActions } from "./jsonApiModule/actions.js";
import { createCrudJsonApiRepository } from "./jsonApiModule/repository.js";
import { registerCrudJsonApiRoutes } from "./jsonApiModule/routes.js";
import { createCrudJsonApiService } from "./jsonApiModule/service.js";

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

function resolveActionPermission(operation, { access, workspaceScoped, permissions } = {}) {
  const operationName = assertCrudOperationName(operation);
  const explicitPermission = permissions?.[operationName];
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
      permissions: [`crud.${permissions?.namespace || "resource"}.${operationName}`]
    });
  }
  return Object.freeze({ require: "authenticated" });
}

function defineCrudJsonApiFeature({
  resource,
  id = "",
  capability = "",
  surface,
  ownershipFilter = "",
  relativePath = "",
  internal = false,
  permissions = null,
  scope = {}
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
      jsonRestApi: "runtime.json-rest-api"
    },
    provides: {
      resourceApi: featureCapability
    },
    async setup({ database, http, jsonRestApi }) {
      await addResourceIfMissing(
        jsonRestApi,
        resourceScopeName,
        createJsonRestResourceScopeOptions(resource, {
          writeSerializers: { "datetime-utc": toDatabaseDateTimeUtc }
        })
      );
      const repository = createCrudJsonApiRepository({
        api: jsonRestApi,
        knex: database.knex,
        resource,
        resourceScopeName
      });
      const service = createCrudJsonApiService({ repository });
      registerCrudJsonApiRoutes(http.router, {
        namespace,
        resource,
        routeBase: normalizedScope.routeBase,
        relativePath: normalizedRelativePath,
        surface: normalizedSurface,
        ownershipFilter: normalizedOwnershipFilter,
        access,
        internal,
        routeParamsValidator: normalizedScope.routeParamsValidator,
        scopeInput: normalizedScope.input
      });
      return {
        resourceApi: Object.freeze({ repository, resource, service })
      };
    },
    actions({ resourceApi }) {
      return createCrudJsonApiActions({
        namespace,
        resource,
        service: resourceApi.service,
        surface: normalizedSurface,
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
