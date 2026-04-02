import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  resolveCrudLookupProviderToken,
  resolveCrudLookupNamespaceFromRelation
} from "./lookupPathSupport.js";

const LOOKUP_PROVIDER_OWNERSHIP_FILTER_VALUES = Object.freeze([
  "public",
  "user",
  "workspace",
  "workspace_user"
]);
const LOOKUP_PROVIDER_OWNERSHIP_FILTER_SET = new Set(LOOKUP_PROVIDER_OWNERSHIP_FILTER_VALUES);

function normalizeLookupProviderOwnershipFilter(value, { context = "crudLookupProvider ownershipFilter" } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }

  if (LOOKUP_PROVIDER_OWNERSHIP_FILTER_SET.has(normalized)) {
    return normalized;
  }

  throw new TypeError(
    `${context} must be one of: ${LOOKUP_PROVIDER_OWNERSHIP_FILTER_VALUES.join(", ")}.`
  );
}

function createCrudLookupProviderResolver(scope, { context = "crudLookupProvider" } = {}) {
  if (!scope || typeof scope.make !== "function") {
    throw new Error(`${context} requires scope.make().`);
  }

  return function resolveLookupProvider(relation = {}) {
    const namespace = resolveCrudLookupNamespaceFromRelation(relation, {
      context
    });
    return scope.make(
      resolveCrudLookupProviderToken(namespace, {
        context
      })
    );
  };
}

function createCrudLookupProvider(repository, { context = "crudLookupProvider", ownershipFilter = "" } = {}) {
  if (!repository || typeof repository.listByIds !== "function") {
    throw new Error(`${context} requires repository.listByIds(ids, options).`);
  }

  const normalizedOwnershipFilter = normalizeLookupProviderOwnershipFilter(
    ownershipFilter || repository?.ownershipFilter,
    {
      context: `${context} ownershipFilter`
    }
  );

  return Object.freeze({
    ownershipFilter: normalizedOwnershipFilter || null,
    async listByIds(ids = [], options = {}) {
      const include = options?.include === undefined ? "none" : options.include;
      return repository.listByIds(ids, {
        ...options,
        include
      });
    }
  });
}

export {
  resolveCrudLookupProviderToken,
  createCrudLookupProviderResolver,
  createCrudLookupProvider
};
